"""Bounded candidate observations; Git reads a private frozen metadata view."""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import signal
import stat
import subprocess
import tempfile
import time

from .candidate import Finding, MAX_FILE_BYTES
from .validation import ROLES, TreeEntry, TreeSnapshot, _Failure, _reference_day, check_declaration

MAX_METADATA = 8 * 1024 * 1024
MAX_INDEX = 16 * 1024 * 1024
MAX_METADATA_TOTAL = 32 * 1024 * 1024
MAX_DIRECTORY_NAMES = 40_000
MAX_OBJECT_STORAGE = 512 * 1024 * 1024
MAX_WORKING_BYTES = 256 * 1024 * 1024
MAX_WORKING_FILE = 64 * 1024 * 1024
MAX_ENTRIES = 20_000
MAX_PATH_BYTES = 1_024
MAX_PATH_DEPTH = 16
MAX_OBJECT_FDS = 128
MAX_LOOSE_OBJECTS = 20_000
MAX_LOOSE_FILE = 16 * 1024 * 1024
MAX_LOOSE_BYTES = 64 * 1024 * 1024
CALL_SECONDS = 5.0
OBSERVATION_SECONDS = 30.0
SUPPORTED_EXTENSIONS = frozenset({"objectformat", "worktreeconfig", "partialclone"})
OID = re.compile(rb"(?:[0-9a-f]{40}|[0-9a-f]{64})")
MODES = {b"100644": ("file", False), b"100755": ("file", True),
         b"120000": ("symlink", False), b"160000": ("submodule", False),
         b"040000": ("directory", False)}
BAD_ENV = (
    "GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_INDEX_FILE", "GIT_CONFIG",
    "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT",
    "GIT_CONFIG_PARAMETERS", "GIT_NAMESPACE", "GIT_REPLACE_REF_BASE", "GIT_EXEC_PATH",
    "GIT_SHALLOW_FILE", "GIT_GRAFT_FILE",
)


class AcquisitionFailure(Exception):
    def __init__(self, reason):
        self.reason = reason


@dataclass(frozen=True)
class ObservationResult:
    exit_code: int
    diagnostics: dict
    record: dict | None = None
    tree: TreeSnapshot | None = None


class Budget:
    def __init__(self, seconds=OBSERVATION_SECONDS):
        self.end = time.monotonic() + seconds
        self.names = 0

    def check(self):
        if time.monotonic() >= self.end:
            raise AcquisitionFailure("deadline")

    def remaining(self):
        self.check()
        return self.end - time.monotonic()


def bounded_process(argv, *, env, cwd, pass_fds=(), data=b"",
                    limit=MAX_METADATA, seconds=CALL_SECONDS):
    """No shell; bounded bidirectional pipes and only this child-group cleanup."""
    if os.name != "posix":
        raise AcquisitionFailure("unsupported_platform")
    deadline = time.monotonic() + seconds
    process = subprocess.Popen(argv, cwd=cwd, env=env, pass_fds=pass_fds,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        start_new_session=True)
    streams = selectors.DefaultSelector()
    stdout, stderr = bytearray(), bytearray()
    position = 0
    completed = False
    try:
        for stream in (process.stdin, process.stdout, process.stderr):
            os.set_blocking(stream.fileno(), False)
        if data:
            streams.register(process.stdin, selectors.EVENT_WRITE, "input")
        else:
            process.stdin.close()
        streams.register(process.stdout, selectors.EVENT_READ, "output")
        streams.register(process.stderr, selectors.EVENT_READ, "error")
        while streams.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise AcquisitionFailure("child_timeout")
            for key, _ in streams.select(min(remaining, 0.1)):
                if key.data == "input":
                    try:
                        written = os.write(key.fd, data[position:position + 4096])
                    except BlockingIOError:
                        continue
                    except BrokenPipeError:
                        written = len(data) - position
                    position += written
                    if position == len(data):
                        streams.unregister(key.fileobj)
                        key.fileobj.close()
                else:
                    try:
                        chunk = os.read(key.fd, 65536)
                    except BlockingIOError:
                        continue
                    if not chunk:
                        streams.unregister(key.fileobj)
                        key.fileobj.close()
                        continue
                    target = stdout if key.data == "output" else stderr
                    target.extend(chunk)
                    if len(stdout) + len(stderr) > limit:
                        raise AcquisitionFailure("child_output_bound")
        try:
            process.wait(timeout=max(0.001, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            raise AcquisitionFailure("child_timeout") from None
        completed = True
        return process.returncode, bytes(stdout), bytes(stderr)
    finally:
        if not completed:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.wait()
        streams.close()
        for stream in (process.stdin, process.stdout, process.stderr):
            if not stream.closed:
                stream.close()


def _parts(path):
    encoded = path.encode("utf-8", "surrogateescape")
    parts = path.split("/")
    if (not path or len(encoded) > MAX_PATH_BYTES or len(parts) > MAX_PATH_DEPTH
            or any(not part or part in {".", ".."} for part in parts)
            or any(ord(char) < 32 or ord(char) == 127 for char in path)):
        raise AcquisitionFailure("path_bound_or_format")
    return parts


def _identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _open_at(root_fd, parts, directory=False):
    current = os.dup(root_fd)
    try:
        for offset, part in enumerate(parts):
            info = os.stat(part, dir_fd=current, follow_symlinks=False)
            expected_directory = offset < len(parts) - 1 or directory
            if not (stat.S_ISDIR(info.st_mode) if expected_directory else stat.S_ISREG(info.st_mode)):
                raise AcquisitionFailure("unsupported_file_kind")
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if offset < len(parts) - 1 or directory:
                flags |= os.O_DIRECTORY
            child = os.open(part, flags, dir_fd=current)
            if _identity(os.fstat(child)) != _identity(info):
                os.close(child)
                raise AcquisitionFailure("observation_changed")
            os.close(current)
            current = child
        result = current
        current = None
        return result
    finally:
        if current is not None:
            os.close(current)


def _open_directory(path):
    absolute = os.path.abspath(os.fspath(path))
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        return _open_at(fd, Path(absolute).parts[1:], directory=True), absolute
    finally:
        os.close(fd)


def _names(fd, budget):
    """Bound directory metadata; contents of untracked files are never opened."""
    info = os.fstat(fd)
    names = []
    with os.scandir(fd) as entries:
        for entry in entries:
            budget.check()
            budget.names += 1
            if budget.names > MAX_DIRECTORY_NAMES or len(names) >= MAX_ENTRIES:
                raise AcquisitionFailure("directory_name_bound")
            names.append(entry.name)
    if _identity(os.fstat(fd)) != _identity(info):
        raise AcquisitionFailure("observation_changed")
    return sorted(names)


def _read_fd(fd, maximum, budget):
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_size > maximum:
        raise AcquisitionFailure("file_kind_or_bound")
    os.lseek(fd, 0, os.SEEK_SET)
    data = bytearray()
    while True:
        budget.check()
        block = os.read(fd, min(65536, maximum + 1 - len(data)))
        if not block:
            break
        data.extend(block)
        if len(data) > maximum:
            raise AcquisitionFailure("file_bound")
    if _identity(os.fstat(fd)) != _identity(info):
        raise AcquisitionFailure("observation_changed")
    return bytes(data)


def _config_scalar(raw):
    """One supported config scalar; comments are outside double quotes only."""
    if raw is None:
        return None
    match = re.fullmatch(r'[ \t]*(?:"([^"\\]*)"|([^#;"\\]*?))[ \t]*(?:[#;].*)?', raw)
    if not match:
        raise AcquisitionFailure("unsupported_config_scalar")
    if match[1] is not None:
        return match[1]
    return match[2].strip(" \t")


def _config(data):
    """Never evaluate includes; recognize only storage/layout-relevant values."""
    text = data.decode("utf-8")
    if any((ord(char) < 32 and char not in "\t\n\r")
           or char in "\x7f\u0085\u2028\u2029" for char in text):
        raise AcquisitionFailure("unsupported_config_line_characters")
    section = ""
    values = {}
    for raw in text.split("\n"):
        if raw.endswith("\r"):
            raw = raw[:-1]
        if "\r" in raw:
            raise AcquisitionFailure("unsupported_config_line_characters")
        line = raw.strip(" \t")
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("["):
            match = re.fullmatch(r'\[[ \t]*([A-Za-z0-9.-]+)(?:[ \t]+"([^"\\]*)")?[ \t]*\](?:[ \t]*[#;].*)?', line)
            if not match:
                raise AcquisitionFailure("unsupported_config")
            section = match[1].lower()
            base_section = section.split(".", 1)[0]
            subsection = "." in section or match[2] is not None
            if base_section in {"include", "includeif"}:
                raise AcquisitionFailure("outside_include")
            if base_section in {"core", "extensions"} and subsection:
                raise AcquisitionFailure("unsupported_storage_subsection")
            if subsection:
                # Other subsections are ignored, never promoted to top-level keys.
                section = "__ignored_subsection__"
            continue
        match = re.match(r"([A-Za-z][A-Za-z0-9-]*)[ \t]*(?:=[ \t]*(.*))?$", line)
        if not match or not section:
            raise AcquisitionFailure("unsupported_config")
        # Validate framing even when the key/namespace has no storage meaning.
        # Ignoring an escaped or unclosed value could invent later sections.
        value = _config_scalar(match[2])
        key = match[1].lower()
        name = section + "." + key
        if section == "extensions" and key not in SUPPORTED_EXTENSIONS:
            raise AcquisitionFailure("unsupported_repository_extension")
        if name in {"core.worktree", "extensions.refstorage", "extensions.relativeworktrees"}:
            raise AcquisitionFailure("unsupported_layout_config")
        if name in {"core.bare", "core.repositoryformatversion",
                    "extensions.objectformat", "extensions.worktreeconfig",
                    "extensions.partialclone"}:
            if name in {"core.bare", "extensions.worktreeconfig"}:
                value = value.lower() if value is not None else None
                if value is None or value in {"true", "yes", "on", "1"}:
                    value = "true"
                elif value in {"", "false", "no", "off", "0"}:
                    value = "false"
                else:
                    raise AcquisitionFailure("unsupported_config_boolean")
            elif value is None:
                raise AcquisitionFailure("unsupported_config_scalar")
            values[name] = value
    if values.get("core.repositoryformatversion", "0") not in {"0", "1"}:
        raise AcquisitionFailure("unsupported_repository_format")
    if values.get("extensions.objectformat", "sha1") not in {"sha1", "sha256"}:
        raise AcquisitionFailure("unsupported_object_format")
    if ("extensions.objectformat" in values
            and values.get("core.repositoryformatversion", "0") != "1"):
        raise AcquisitionFailure("extension_repository_version")
    return values


def _ref_data(data):
    if OID.fullmatch(data.strip()):
        return
    value = data.decode("utf-8").strip()
    if not value.startswith("ref: "):
        raise AcquisitionFailure("unsupported_ref")
    _ref_name(value[5:])


def _ref_name(value):
    parts = _parts(value)
    if (not value.startswith("refs/") or any(part.startswith(".") or part.endswith(".lock")
            for part in parts) or any(char in value for char in " ~^:?*[\\")
            or ".." in value or "@{" in value):
        raise AcquisitionFailure("unsupported_ref")


class FrozenStore:
    """Git sees frozen compressed loose bytes and descriptor-bound packs."""

    def __init__(self, root, common_dir, budget, include_index=True):
        self.fds = []
        try:
            self._initialize(root, common_dir, budget, include_index)
        except BaseException:
            self.close()
            raise

    def _initialize(self, root, common_dir, budget, include_index):
        self.budget = budget
        self.fds = []
        self.objects = []
        self.loose = []
        self.bindings = []
        self.metadata = {}
        self.metadata_bytes = 0
        self.root_fd, self.root_path = _open_directory(root)
        self.fds.append(self.root_fd)
        self.root_identity = _identity(os.fstat(self.root_fd))
        self.common_path = None
        self.common_identity = None
        try:
            info = os.stat(".git", dir_fd=self.root_fd, follow_symlinks=False)
        except FileNotFoundError:
            self.common_fd = self.root_fd
            self.git_fd = self.root_fd
            self.bare = True
        else:
            if stat.S_ISDIR(info.st_mode):
                self.common_fd = _open_at(self.root_fd, [".git"], directory=True)
                self.fds.append(self.common_fd)
                self.git_fd = self.common_fd
                self.bare = False
                self.bindings.append((self.root_fd, [".git"], _identity(info), None))
            elif stat.S_ISREG(info.st_mode):
                pointer = self.read(self.root_fd, [".git"], 4096).decode("utf-8").strip()
                if not pointer.startswith("gitdir: ") or common_dir is None:
                    raise AcquisitionFailure("linked_storage_scope_required")
                self.common_fd, common_path = _open_directory(common_dir)
                self.fds.append(self.common_fd)
                self.common_path = common_path
                linked = os.path.normpath(os.path.join(self.root_path, pointer[8:]))
                relative = os.path.relpath(linked, common_path)
                parts = _parts(relative)
                if len(parts) != 2 or parts[0] != "worktrees":
                    raise AcquisitionFailure("unsupported_linked_layout")
                self.git_fd = _open_at(self.common_fd, parts, directory=True)
                self.fds.append(self.git_fd)
                self.bindings.append((self.common_fd, parts, _identity(os.fstat(self.git_fd)), None))
                common = self.read(self.git_fd, ["commondir"], 4096).strip()
                backlink = self.read(self.git_fd, ["gitdir"], 4096).decode().strip()
                if common != b"../.." or os.path.normpath(backlink) != os.path.join(self.root_path, ".git"):
                    raise AcquisitionFailure("unsupported_linked_layout")
                self.bare = False
            else:
                raise AcquisitionFailure("unsupported_layout")
        self.common_identity = _identity(os.fstat(self.common_fd))
        config = self.read(self.common_fd, ["config"], MAX_METADATA)
        values = _config(config)
        worktree = values.get("extensions.worktreeconfig", "false") in {"true", "yes", "1", "on"}
        if worktree:
            local = self.read(self.git_fd, ["config.worktree"], MAX_METADATA, optional=True)
            values.update(_config(local) if local else {})
        configured_bare = values.get("core.bare", "false") in {"true", "yes", "1", "on"}
        if configured_bare != self.bare:
            raise AcquisitionFailure("unsupported_layout")
        self.algorithm = values.get("extensions.objectformat", "sha1")
        self.head = self.read(self.git_fd, ["HEAD"], 4096)
        _ref_data(self.head)
        self.metadata["HEAD"] = self.head
        packed = self.read(self.common_fd, ["packed-refs"], MAX_METADATA, optional=True)
        for line in packed.splitlines():
            if not line or line.startswith(b"#"):
                continue
            if line.startswith(b"^"):
                if not OID.fullmatch(line[1:]):
                    raise AcquisitionFailure("unsupported_ref")
            else:
                oid, sep, name = line.partition(b" ")
                if not sep or not OID.fullmatch(oid):
                    raise AcquisitionFailure("unsupported_ref")
                _ref_name(name.decode("utf-8"))
        if packed:
            self.metadata["packed-refs"] = packed
        shallow = self.read(self.common_fd, ["shallow"], MAX_METADATA, optional=True)
        if shallow:
            if any(not OID.fullmatch(line) for line in shallow.splitlines()):
                raise AcquisitionFailure("unsupported_shallow")
            self.metadata["shallow"] = shallow
        grafts = self.read(self.common_fd, ["info", "grafts"], MAX_METADATA, optional=True)
        if grafts.strip():
            raise AcquisitionFailure("unsupported_grafts")
        self._refs()
        for name in _names(self.git_fd, self.budget):
            self.budget.check()
            if include_index and (name == "index" or re.fullmatch(r"sharedindex\.[0-9a-f]{40,64}", name)):
                if name != "index":
                    raise AcquisitionFailure("unsupported_split_index")
                index_data = self.read(self.git_fd, [name], MAX_INDEX)
                if index_data[:4] != b"DIRC" or index_data[4:8] != b"\0\0\0\2":
                    raise AcquisitionFailure("unsupported_index_version")
                self.metadata[name] = index_data
        self._objects()
        self.budget.check()

    def read(self, root_fd, parts, bound, optional=False):
        self.budget.check()
        try:
            fd = _open_at(root_fd, parts)
        except FileNotFoundError:
            if optional:
                self.bindings.append((root_fd, parts, None, None))
                return b""
            raise
        try:
            info = os.fstat(fd)
            data = _read_fd(fd, bound, self.budget)
            self.metadata_bytes += len(data)
            if self.metadata_bytes > MAX_METADATA_TOTAL:
                raise AcquisitionFailure("metadata_bound")
            self.bindings.append((root_fd, parts, _identity(info), hashlib.sha256(data).digest()))
            return data
        finally:
            os.close(fd)

    def _refs(self):
        try:
            fd = _open_at(self.common_fd, ["refs"], directory=True)
        except FileNotFoundError:
            self.bindings.append((self.common_fd, ["refs"], None, None))
            return
        os.close(fd)
        names = []
        def walk(parts):
            self.budget.check()
            fd = _open_at(self.common_fd, parts, directory=True)
            self.bindings.append((self.common_fd, parts, _identity(os.fstat(fd)), None))
            try:
                for name in _names(fd, self.budget):
                    self.budget.check()
                    path = parts + [name]
                    _parts("/".join(path))
                    info = os.stat(name, dir_fd=fd, follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        walk(path)
                    elif stat.S_ISREG(info.st_mode):
                        ref = "/".join(path)
                        _ref_name(ref)
                        data = self.read(self.common_fd, path, 4096)
                        _ref_data(data)
                        names.append(ref)
                        if len(names) > 1024:
                            raise AcquisitionFailure("ref_bound")
                        self.metadata[ref] = data
                    else:
                        raise AcquisitionFailure("unsupported_ref")
            finally:
                os.close(fd)
        walk(["refs"])

    def _objects(self):
        for name in ("alternates", "http-alternates"):
            data = self.read(self.common_fd, ["objects", "info", name], 4096, optional=True)
            if data.strip():
                raise AcquisitionFailure("object_alternates")
        root = _open_at(self.common_fd, ["objects"], directory=True)
        self.bindings.append((self.common_fd, ["objects"], _identity(os.fstat(root)), None))
        total = loose_total = 0
        try:
            for directory in _names(root, self.budget):
                self.budget.check()
                if directory != "pack" and not re.fullmatch(r"[0-9a-f]{2}", directory):
                    continue
                fd = _open_at(root, [directory], directory=True)
                self.bindings.append((self.common_fd, ["objects", directory], _identity(os.fstat(fd)), None))
                try:
                    for name in _names(fd, self.budget):
                        self.budget.check()
                        if directory == "pack":
                            if not re.fullmatch(r"pack-[0-9a-f]{40,64}\.(?:pack|idx)", name):
                                continue
                        elif not re.fullmatch(r"[0-9a-f]{" + ("38" if self.algorithm == "sha1" else "62") + "}", name):
                            continue
                        path = ["objects", directory, name]
                        object_fd = _open_at(self.common_fd, path)
                        info = os.fstat(object_fd)
                        if not stat.S_ISREG(info.st_mode):
                            os.close(object_fd)
                            raise AcquisitionFailure("object_layout")
                        total += info.st_size
                        if directory == "pack":
                            self.fds.append(object_fd)
                            self.objects.append(("/".join(path), object_fd))
                            self.bindings.append((self.common_fd, path, _identity(info), None))
                        else:
                            try:
                                data = _read_fd(object_fd, MAX_LOOSE_FILE, self.budget)
                            finally:
                                os.close(object_fd)
                            loose_total += len(data)
                            if len(self.loose) >= MAX_LOOSE_OBJECTS or loose_total > MAX_LOOSE_BYTES:
                                raise AcquisitionFailure("loose_object_bound")
                            self.loose.append(("/".join(path), data))
                            self.bindings.append((self.common_fd, path, _identity(info), hashlib.sha256(data).digest()))
                        if len(self.objects) > MAX_OBJECT_FDS or total > MAX_OBJECT_STORAGE:
                            raise AcquisitionFailure("object_storage_bound")
                finally:
                    os.close(fd)
        finally:
            os.close(root)

    def materialize(self, target):
        target.mkdir()
        (target / "objects").mkdir()
        (target / "refs").mkdir()
        config = "[core]\nrepositoryformatversion = " + ("1" if self.algorithm == "sha256" else "0") + "\nbare = true\n"
        if self.algorithm == "sha256":
            config += "[extensions]\nobjectformat = sha256\n"
        (target / "config").write_text(config)
        for name, data in self.metadata.items():
            self.budget.check()
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        for name, data in self.loose:
            self.budget.check()
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        for name, fd in self.objects:
            self.budget.check()
            path = target / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.symlink_to("/dev/fd/" + str(fd))

    def recheck(self):
        current, _ = _open_directory(self.root_path)
        try:
            if _identity(os.fstat(current)) != self.root_identity:
                raise AcquisitionFailure("observation_changed")
        finally:
            os.close(current)
        if self.common_path is not None:
            current, _ = _open_directory(self.common_path)
            try:
                if _identity(os.fstat(current)) != self.common_identity:
                    raise AcquisitionFailure("observation_changed")
            finally:
                os.close(current)
        for root_fd, parts, expected, digest in self.bindings:
            self.budget.check()
            try:
                fd = _open_at(root_fd, parts, directory=expected is not None and stat.S_ISDIR(expected[2]))
            except FileNotFoundError:
                if expected is None:
                    continue
                raise AcquisitionFailure("observation_changed") from None
            try:
                if expected is None or _identity(os.fstat(fd)) != expected:
                    raise AcquisitionFailure("observation_changed")
                if digest is not None:
                    data = _read_fd(fd, max(MAX_INDEX, MAX_METADATA), self.budget)
                    if hashlib.sha256(data).digest() != digest:
                        raise AcquisitionFailure("observation_changed")
            finally:
                os.close(fd)

    def close(self):
        for fd in reversed(self.fds):
            os.close(fd)


class GitView:
    def __init__(self, store, mirror, budget):
        self.store, self.mirror, self.budget = store, mirror, budget
        self.executable = shutil.which("git")
        if self.executable is None:
            raise AcquisitionFailure("git_unavailable")
        self.env = os.environ.copy()
        if any(self.env.get(name) for name in BAD_ENV):
            raise AcquisitionFailure("inherited_git_context")
        for name in list(self.env):
            if name.startswith("GIT_TRACE"):
                self.env[name] = "0"
        self.env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
            GIT_OPTIONAL_LOCKS="0", GIT_NO_LAZY_FETCH="1", GIT_NO_REPLACE_OBJECTS="1",
            GIT_LITERAL_PATHSPECS="1", GIT_ALLOW_PROTOCOL="", GIT_TERMINAL_PROMPT="0",
            GCM_INTERACTIVE="never", GIT_TRACE="0", GIT_TRACE2="0",
            GIT_TRACE2_EVENT="0", GIT_TRACE2_PERF="0", GIT_TRACE_REDACT="1")
        version = self.run(["--version"])
        match = re.fullmatch(rb"git version (\d+)\.(\d+)\.(\d+)(?:[^\r\n]*)\n", version)
        if not match or tuple(int(item) for item in match.groups()) < (2, 56, 0):
            raise AcquisitionFailure("unsupported_git")
        self.version = ".".join(part.decode() for part in match.groups())

    def run(self, args, data=b"", limit=MAX_METADATA, optional=False):
        self.budget.check()
        for _, fd in self.store.objects:
            os.lseek(fd, 0, os.SEEK_SET)
        base = [self.executable, "--no-pager", "--no-optional-locks",
                "--no-lazy-fetch", "--no-replace-objects", "--literal-pathspecs",
                "-c", "core.fsmonitor=false", "-c", "submodule.recurse=false",
                "--git-dir=" + str(self.mirror)]
        code, output, _ = bounded_process(base + args, env=self.env, cwd=self.mirror,
            pass_fds=tuple(fd for _, fd in self.store.objects), data=data,
            limit=limit, seconds=min(CALL_SECONDS, self.budget.remaining()))
        self.budget.check()
        if code:
            if optional:
                return None
            raise AcquisitionFailure("git_read")
        return output

    def resolve(self, rev):
        data = self.run(["rev-parse", "--verify", "--end-of-options", rev + "^{commit}"])
        value = data.strip()
        if not OID.fullmatch(value):
            raise AcquisitionFailure("object_identifier")
        return value

    def info(self, oids):
        if not oids:
            return {}
        output = self.run(["cat-file", "--batch-check"], data=b"\n".join(oids) + b"\n")
        lines = output.splitlines()
        if len(lines) != len(oids):
            raise AcquisitionFailure("object_metadata")
        result = {}
        for wanted, line in zip(oids, lines):
            self.budget.check()
            fields = line.split(b" ")
            if len(fields) != 3 or fields[0] != wanted or fields[1] not in {b"blob", b"tree", b"commit", b"tag"} or not fields[2].isdigit():
                raise AcquisitionFailure("object_unavailable")
            result[wanted] = (fields[1], int(fields[2]))
        return result

    def raw(self, kind, oid, bound):
        info = self.info([oid])[oid]
        if info[0] != kind or info[1] > bound:
            raise AcquisitionFailure("object_type_or_bound")
        data = self.run(["cat-file", kind.decode(), oid.decode()], limit=bound + 4096)
        digest = hashlib.new(self.store.algorithm, kind + b" " + str(len(data)).encode() + b"\0" + data).hexdigest().encode()
        if len(data) != info[1] or digest != oid:
            raise AcquisitionFailure("object_integrity")
        return data


    def verify_trees(self, oids):
        wanted = sorted(set(oids))
        if not wanted:
            return
        metadata = self.info(wanted)
        if (any(kind != b"tree" for kind, _ in metadata.values())
                or sum(size for _, size in metadata.values()) > MAX_METADATA):
            raise AcquisitionFailure("tree_object_bound")
        output = self.run(["cat-file", "--batch"], data=b"\n".join(wanted) + b"\n",
                          limit=MAX_METADATA + len(wanted) * 128)
        position = 0
        for oid in wanted:
            self.budget.check()
            end = output.find(b"\n", position)
            header = output[position:end].split(b" ")
            if end < position or header != [oid, b"tree", str(metadata[oid][1]).encode()]:
                raise AcquisitionFailure("tree_object_metadata")
            position = end + 1
            size = metadata[oid][1]
            data = output[position:position + size]
            position += size
            digest = hashlib.new(self.store.algorithm,
                b"tree " + str(size).encode() + b"\0" + data).hexdigest().encode()
            if digest != oid or output[position:position + 1] != b"\n":
                raise AcquisitionFailure("object_integrity")
            position += 1
        if position != len(output):
            raise AcquisitionFailure("tree_object_metadata")


def _tree(data, budget):
    records, objects = [], {}
    for item in data.split(b"\0"):
        budget.check()
        if not item:
            continue
        header, sep, raw_path = item.partition(b"\t")
        fields = header.split(b" ")
        if not sep or len(fields) != 3 or fields[0] not in MODES or not OID.fullmatch(fields[2]):
            raise AcquisitionFailure("tree_metadata")
        path = raw_path.decode("utf-8", "surrogateescape")
        _parts(path)
        kind, executable = MODES[fields[0]]
        expected_type = b"tree" if kind == "directory" else b"commit" if kind == "submodule" else b"blob"
        if fields[1] != expected_type:
            raise AcquisitionFailure("tree_metadata")
        records.append(TreeEntry(path, kind, executable))
        objects[path] = fields[2]
        if len(records) > MAX_ENTRIES:
            raise AcquisitionFailure("entry_bound")
    return records, objects


def _index(data, budget):
    records, objects = [], {}
    position = 0
    # Debug records are deliberately version-qualified, not treated as stable Git ABI.
    debug = re.compile(rb"  ctime: \d+:\d+\n  mtime: \d+:\d+\n  dev: \d+\s+ino: \d+\n  uid: \d+\s+gid: \d+\n  size: \d+\s+flags: ([0-9a-f]+)\n")
    while position < len(data):
        budget.check()
        end = data.find(b"\0", position)
        if end < 0:
            raise AcquisitionFailure("unsupported_index")
        raw = data[position:end]
        position = end + 1
        header, tab, path_bytes = raw.partition(b"\t")
        fields = header.split(b" ")
        match = debug.match(data, position)
        if not tab or len(fields) != 3 or not match or fields[0] not in MODES or not OID.fullmatch(fields[1]):
            raise AcquisitionFailure("unsupported_index")
        if fields[2] != b"0" or int(match[1], 16) & 0x60000000:
            raise AcquisitionFailure("unmerged_or_intent_index")
        position = match.end()
        path = path_bytes.decode("utf-8", "surrogateescape")
        _parts(path)
        kind, executable = MODES[fields[0]]
        if kind == "directory" or path in objects:
            raise AcquisitionFailure("unsupported_index")
        records.append(TreeEntry(path, kind, executable))
        objects[path] = fields[1]
        if len(records) > MAX_ENTRIES:
            raise AcquisitionFailure("entry_bound")
    parents = {}
    leaves = {entry.path for entry in records}
    for entry in records:
        budget.check()
        parts = _parts(entry.path)
        for depth in range(1, len(parts)):
            path = "/".join(parts[:depth])
            if path in leaves:
                raise AcquisitionFailure("index_path_conflict")
            parents[path] = TreeEntry(path, "directory")
            if len(parents) + len(records) > MAX_ENTRIES:
                raise AcquisitionFailure("entry_bound")
    return list(parents.values()) + records, objects


def _working(store, records, budget):
    observed = {}
    manifest = None
    fingerprint = hashlib.sha256(b"candidate-working-bytes\0")
    total = 0
    directories = {}
    for entry in sorted(records, key=lambda item: item.path):
        budget.check()
        parts = _parts(entry.path)
        current = os.dup(store.root_fd)
        try:
            for depth, part in enumerate(parts, 1):
                budget.check()
                prefix = "/".join(parts[:depth])
                directory_info = os.fstat(current)
                directory_key = _identity(directory_info)
                if directory_key not in directories:
                    directories[directory_key] = frozenset(_names(current, budget))
                if part not in directories[directory_key]:
                    fingerprint.update(b"missing\0" + prefix.encode("utf-8", "surrogateescape") + b"\0")
                    break
                info = os.stat(part, dir_fd=current, follow_symlinks=False)
                if stat.S_ISLNK(info.st_mode):
                    observed[prefix] = TreeEntry(prefix, "symlink")
                    target = os.readlink(part, dir_fd=current)
                    if _identity(os.stat(part, dir_fd=current, follow_symlinks=False)) != _identity(info):
                        raise AcquisitionFailure("observation_changed")
                    fingerprint.update(json.dumps(["symlink", prefix, target], ensure_ascii=True).encode() + b"\0")
                    break
                if depth < len(parts):
                    if not stat.S_ISDIR(info.st_mode):
                        observed[prefix] = TreeEntry(prefix, "file", bool(info.st_mode & 0o111))
                        break
                    observed[prefix] = TreeEntry(prefix, "directory")
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
                    if _identity(os.fstat(child)) != _identity(info):
                        os.close(child)
                        raise AcquisitionFailure("observation_changed")
                    os.close(current)
                    current = child
                elif entry.kind == "submodule":
                    observed[prefix] = TreeEntry(prefix, "submodule")
                    fingerprint.update(b"submodule\0" + prefix.encode())
                elif entry.kind == "directory" and stat.S_ISREG(info.st_mode):
                    # A file obstructing a derived directory is not an index leaf.
                    # Record only its kind/mode; never consume untracked bytes.
                    observed[prefix] = TreeEntry(prefix, "file", bool(info.st_mode & 0o111))
                elif stat.S_ISREG(info.st_mode):
                    fd = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=current)
                    try:
                        if _identity(os.fstat(fd)) != _identity(info):
                            raise AcquisitionFailure("observation_changed")
                        data = _read_fd(fd, MAX_WORKING_FILE, budget)
                        if _identity(os.stat(part, dir_fd=current, follow_symlinks=False)) != _identity(os.fstat(fd)):
                            raise AcquisitionFailure("observation_changed")
                    finally:
                        os.close(fd)
                    total += len(data)
                    if total > MAX_WORKING_BYTES:
                        raise AcquisitionFailure("working_byte_bound")
                    executable = bool(info.st_mode & 0o111)
                    observed[prefix] = TreeEntry(prefix, "file", executable)
                    framed = json.dumps([prefix, executable, len(data)], ensure_ascii=True).encode()
                    fingerprint.update(framed + b"\0" + hashlib.sha256(data).digest())
                    if prefix == "project.yaml":
                        manifest = data
                elif stat.S_ISDIR(info.st_mode):
                    observed[prefix] = TreeEntry(prefix, "directory")
                else:
                    raise AcquisitionFailure("working_file_kind")
        finally:
            os.close(current)
    for entry in sorted(observed.values(), key=lambda item: item.path):
        budget.check()
        fingerprint.update(json.dumps([entry.path, entry.kind, entry.executable],
                                      ensure_ascii=True).encode() + b"\0")
    budget.check()
    return list(observed.values()), manifest, fingerprint.hexdigest()


def _references(record):
    yield record["authority"]["status_of_record"]
    environment = record["development"]["environment"]
    for key in ("template", "secret_launcher"):
        if environment[key] is not None:
            yield environment[key]
    for role in ROLES:
        value = record["development"]["commands"][role]
        if value is not None and value["runner"] == "script":
            yield value["target"]
    for value in record["development"]["stacks"].values():
        yield value["compose"]


def _finding(code, field, reference_date=None):
    return {"scope": "candidate-git-observation", "complete_v1_validity": "not_checked",
        "candidate_declaration_accepted": False, "reference_date": reference_date,
        "exit_code": 2 if code == "NOT_CHECKED" else 1,
        "findings": [Finding(code, field, 0, 0).diagnostic()]}


def observe_repository(root, *, mode, rev=None, reference_date=None, common_dir=None):
    """Read one explicitly scoped root; no repository mutation or source execution."""
    store = None
    budget = Budget()
    try:
        if (type(mode) is not str or mode not in {"rev", "staged", "worktree"}
                or (mode == "rev" and (type(rev) is not str or not rev
                    or len(rev.encode("utf-8")) > MAX_PATH_BYTES
                    or any(ord(char) < 32 or ord(char) == 127 for char in rev)))
                or (mode != "rev" and rev is not None)):
            raise AcquisitionFailure("source_selection")
        if any(os.environ.get(name) for name in BAD_ENV):
            raise AcquisitionFailure("inherited_git_context")
        if reference_date is None:
            reference_date = datetime.now(timezone.utc).date().isoformat()
        try:
            reference_date = _reference_day(reference_date).isoformat()
        except _Failure:
            return ObservationResult(2, _finding("NOT_CHECKED", "reference_date"))
        store = FrozenStore(root, common_dir, budget, include_index=mode != "rev")
        if mode != "rev" and store.bare:
            raise AcquisitionFailure("bare_observation")
        with tempfile.TemporaryDirectory(prefix="project-manifest-observation-") as temp:
            mirror = Path(temp) / "git"
            store.materialize(mirror)
            git = GitView(store, mirror, budget)
            commit = tree_oid = manifest_oid = None
            if mode == "rev":
                commit = git.resolve(rev)
                commit_data = git.raw(b"commit", commit, MAX_METADATA)
                first = commit_data.split(b"\n", 1)[0]
                if not first.startswith(b"tree ") or not OID.fullmatch(first[5:]):
                    raise AcquisitionFailure("commit_metadata")
                tree_oid = first[5:]
                git.raw(b"tree", tree_oid, MAX_METADATA)
                metadata = git.run(["ls-tree", "-r", "-t", "-z", "--full-tree", tree_oid.decode()])
                records, objects = _tree(metadata, budget)
                git.verify_trees([tree_oid] + [objects[e.path] for e in records if e.kind == "directory"])
            else:
                metadata = git.run(["ls-files", "--stage", "--debug", "-z"])
                records, objects = _index(metadata, budget)
            fingerprint = hashlib.sha256(mode.encode() + b"\0" + metadata).hexdigest()
            if mode == "worktree":
                records, data, fingerprint = _working(store, records, budget)
            else:
                entry = next((entry for entry in records if entry.path == "project.yaml"), None)
                if entry is None:
                    data = None
                elif entry.kind != "file":
                    result = ObservationResult(1, _finding("REFERENCE_PATH", "manifest", reference_date))
                    result.diagnostics.update(mode=mode, commit_oid=commit.decode() if commit else None,
                        tree_oid=tree_oid.decode() if tree_oid else None,
                        manifest_blob_oid=manifest_oid.decode() if manifest_oid else None,
                        manifest_sha256=None, observation_digest=fingerprint, git_version=git.version)
                    store.recheck()
                    budget.check()
                    return result
                else:
                    manifest_oid = objects["project.yaml"]
                    info = git.info([manifest_oid])[manifest_oid]
                    if info[0] != b"blob":
                        raise AcquisitionFailure("manifest_object")
                    if info[1] > MAX_FILE_BYTES:
                        result = ObservationResult(1, _finding("FIELD_BOUND", "document", reference_date))
                        result.diagnostics.update(mode=mode, commit_oid=commit.decode() if commit else None,
                            tree_oid=tree_oid.decode() if tree_oid else None,
                            manifest_blob_oid=manifest_oid.decode() if manifest_oid else None,
                            manifest_sha256=None, observation_digest=fingerprint, git_version=git.version)
                        store.recheck()
                        budget.check()
                        return result
                    data = git.raw(b"blob", manifest_oid, MAX_FILE_BYTES)
            if data is None:
                known = next((entry for entry in records if entry.path == "project.yaml"), None)
                code = "REFERENCE_PATH" if known is not None else "KEY_REQUIRED"
                result = ObservationResult(1, _finding(code, "manifest", reference_date))
            else:
                budget.check()
                snapshot = TreeSnapshot(tuple(records))
                declared = check_declaration(data, tree=snapshot,
                                             reference_date=reference_date)
                budget.check()
                if declared.exit_code == 0 and mode != "worktree":
                    ids = sorted({objects[path] for path in _references(declared.record)})
                    availability = git.info(ids)
                    if any(kind != b"blob" for kind, _ in availability.values()):
                        raise AcquisitionFailure("reference_object")
                report = declared.diagnostics()
                report["checks_remaining"] = [item for item in report["checks_remaining"]
                    if item != "git_observation_acquisition"] + ["acquisition_portability_qualification"]
                report["tree_observation"] = {
                    "rev": "frozen-revision-tree", "staged": "frozen-stage-zero-index",
                    "worktree": "tracked-working-bytes"}[mode]
                report.update(scope="candidate-git-observation", mode=mode,
                    commit_oid=commit.decode() if commit else None,
                    tree_oid=tree_oid.decode() if tree_oid else None,
                    manifest_blob_oid=manifest_oid.decode() if manifest_oid else None,
                    manifest_sha256=hashlib.sha256(data).hexdigest(),
                    observation_digest=fingerprint, git_version=git.version,
                    acquired_tree="frozen-git-objects" if mode != "worktree" else "tracked-working-bytes")
                result = ObservationResult(declared.exit_code, report, declared.record,
                                           snapshot if declared.exit_code == 0 else None)
            result.diagnostics.update(mode=mode, commit_oid=commit.decode() if commit else None,
                tree_oid=tree_oid.decode() if tree_oid else None,
                manifest_blob_oid=manifest_oid.decode() if manifest_oid else None,
                manifest_sha256=hashlib.sha256(data).hexdigest() if data is not None else None,
                observation_digest=fingerprint, git_version=git.version)
            if mode == "worktree":
                _, repeated_data, repeated_fingerprint = _working(store, _index(metadata, budget)[0], budget)
                if repeated_data != data or repeated_fingerprint != fingerprint:
                    raise AcquisitionFailure("observation_changed")
            store.recheck()
            budget.check()
            return result
    except (AcquisitionFailure, OSError, UnicodeError, ValueError, TypeError) as error:
        reason = error.reason if isinstance(error, AcquisitionFailure) else "source_io_or_format"
        report = _finding("NOT_CHECKED", "acquisition")
        report.update(mode=mode if type(mode) is str and mode in {"rev", "staged", "worktree"} else None,
                      acquisition_reason=reason)
        return ObservationResult(2, report)
    finally:
        if store is not None:
            store.close()


# Transport identity only: direct source cannot authenticate release approval.
RELEASED_OBSERVATION_SCOPE = "project-manifest-git-observation-1"
RELEASED_FINDING_CODES = frozenset({
    "BYTE_PROFILE", "DATE_FORMAT", "FIELD_BOUND", "FIELD_TYPE", "GRAMMAR",
    "KEY_DUPLICATE", "KEY_REQUIRED", "KEY_UNKNOWN", "LEGACY_VERSION",
    "NOT_CHECKED", "REFERENCE_PATH", "VERSION_LINE", "DATE_RULE",
    "ENUM_UNSUPPORTED", "FIELD_RELATION", "LIST_DUPLICATE", "REFERENCE_MISSING",
    "REFERENCE_MODE", "ROLE_RELATION", "TARGET_RULE",
})
_RELEASED_TREES = {
    "rev": "frozen-revision-tree", "staged": "frozen-stage-zero-index",
    "worktree": "tracked-working-bytes",
}


def _released_unavailable(mode, day):
    return {
        "scope": RELEASED_OBSERVATION_SCOPE, "exit_code": 2,
        "declaration_checks": "not_checked", "complete_v1_validity": "not_checked",
        "findings": [{"code": "NOT_CHECKED", "line": 0, "column": 0}],
        "mode": mode if type(mode) is str and mode in _RELEASED_TREES else None,
        "reference_date": day, "commit_oid": None, "tree_oid": None,
        "manifest_blob_oid": None, "manifest_sha256": None,
        "observation_digest": None, "git_version": None, "tree_observation": None,
    }


def observe_released_repository(root, *, mode, reference_date, rev=None, common_dir=None):
    """Serialize one C3 observation; approval/binding remain consumer prerequisites.

    A day is explicit, with the existing date normalization. No caller-tree API,
    second acquisition, declaration algorithm or complete-v1 approval is added.
    Candidate APIs and diagnostics are unchanged. Interrupt/cancellation propagates.
    """
    report = _released_unavailable(mode, None)
    try:
        day = _reference_day(reference_date).isoformat()
    except _Failure:
        return ObservationResult(2, report)
    report = _released_unavailable(mode, day)
    try:
        observed = observe_repository(root, mode=mode, rev=rev,
                                      reference_date=day, common_dir=common_dir)
        status, diagnostics = observed.exit_code, observed.diagnostics
        if (type(observed) is not ObservationResult or type(status) is not int
                or status not in (0, 1, 2) or type(diagnostics) is not dict
                or diagnostics.get("scope") != "candidate-git-observation"
                or type(diagnostics.get("exit_code")) is not int
                or diagnostics["exit_code"] != status
                or diagnostics.get("candidate_declaration_accepted") is not (status == 0)
                or diagnostics.get("complete_v1_validity") != "not_checked"
                or diagnostics.get("mode") != report["mode"]
                or (diagnostics.get("reference_date") != day
                    and (status == 0 or diagnostics.get("reference_date") is not None))):
            raise ValueError
        raw_findings = diagnostics.get("findings")
        if type(raw_findings) is not list or len(raw_findings) != int(status != 0):
            raise ValueError
        findings = []
        for item in raw_findings:
            if (type(item) is not dict or type(item.get("code")) is not str
                    or item["code"] not in RELEASED_FINDING_CODES
                    or (item["code"] == "NOT_CHECKED") is not (status == 2)
                    or any(type(item.get(key)) is not int or not 0 <= item[key] <= 65_536
                           for key in ("line", "column"))):
                raise ValueError
            findings.append({key: item[key] for key in ("code", "line", "column")})
        if status == 0:
            if (type(observed.record) is not dict or type(observed.tree) is not TreeSnapshot
                    or observed.tree.complete is not True or type(observed.tree.entries) is not tuple):
                raise ValueError
        elif observed.record is not None or observed.tree is not None:
            raise ValueError
        provenance = {key: diagnostics.get(key) for key in
                      ("commit_oid", "tree_oid", "manifest_blob_oid", "manifest_sha256",
                       "observation_digest", "git_version")}
        if status != 2:
            if (not re.fullmatch(r"[0-9a-f]{64}", provenance["observation_digest"] or "")
                    or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", provenance["git_version"] or "")
                    or (status == 0 and provenance["manifest_sha256"] is None)):
                raise ValueError
            if provenance["manifest_sha256"] is not None and not re.fullmatch(
                    r"[0-9a-f]{64}", provenance["manifest_sha256"]):
                raise ValueError
            required = {"commit_oid", "tree_oid"} if mode == "rev" else set()
            if status == 0 and mode != "worktree":
                required.add("manifest_blob_oid")
            present = []
            for key in ("commit_oid", "tree_oid", "manifest_blob_oid"):
                value = provenance[key]
                if value is None:
                    if key in required:
                        raise ValueError
                    continue
                if (mode == "worktree" or (mode == "staged" and key != "manifest_blob_oid")
                        or type(value) is not str
                        or re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", value) is None):
                    raise ValueError
                present.append(len(value))
            if len(set(present)) > 1:
                raise ValueError
        else:
            # Unavailable acquisition cannot attest partially computed provenance.
            provenance = {key: None for key in provenance}
        report.update(exit_code=status, declaration_checks=("passed", "failed", "not_checked")[status],
                      findings=findings, tree_observation=_RELEASED_TREES.get(mode) if status != 2 else None,
                      **provenance)
        return ObservationResult(status, report, observed.record, observed.tree)
    except Exception:
        return ObservationResult(2, _released_unavailable(mode, day))
