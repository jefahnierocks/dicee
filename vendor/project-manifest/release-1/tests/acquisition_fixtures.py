"""Owned synthetic Git graphs, created only under the approved temporary root."""

from dataclasses import dataclass
import os
import platform
from pathlib import Path
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile


TEST_HOST_ROOTS = {("Darwin", "arm64"): Path("/private/tmp"),
                   ("Linux", "x86_64"): Path("/tmp")}


def fixture_parent(system=None, machine=None):
    host = (platform.system() if system is None else system,
            platform.machine() if machine is None else machine)
    if host not in TEST_HOST_ROOTS:
        raise AssertionError("Unsupported synthetic acquisition test host")
    return TEST_HOST_ROOTS[host]


@dataclass(frozen=True)
class FileSpec:
    mode: str
    data: bytes | None = None
    oid: str | None = None


def _safe_parts(path):
    parts = path.split("/")
    if not parts or any(not part or part in {".", ".."} for part in parts):
        raise AssertionError("Unsafe synthetic fixture path")
    if path.startswith("/") or any(char in path for char in "\x00\n\t"):
        raise AssertionError("Unsafe synthetic fixture path")
    return parts


class FixtureOwner:
    """Cleanup is deferred until unittest has recorded failures, including subtests."""

    def __init__(self, testcase):
        self.testcase = testcase
        self.roots = []
        result = testcase._outcome.result
        self.before = self._failure_count(result)
        testcase.addCleanup(self.finish)

    @staticmethod
    def _failure_count(result):
        return sum(len(getattr(result, name, ())) for name in
                   ("failures", "errors", "unexpectedSuccesses"))

    def create_root(self):
        parent = fixture_parent()
        root = Path(tempfile.mkdtemp(prefix="project-manifest-c3-", dir=parent))
        if (root.is_symlink() or root.resolve().parent != parent.resolve()
                or root.stat().st_uid != os.getuid()):
            raise AssertionError("Synthetic fixture escaped its approved temporary root")
        token = secrets.token_hex(24)
        marker = root / "fixture-owner"
        marker.write_text(token, encoding="ascii")
        info = root.stat()
        self.roots.append((root, token, (info.st_dev, info.st_ino)))
        return root

    def finish(self):
        result = self.testcase._outcome.result
        failed = self._failure_count(result) != self.before
        failed = failed or not self.testcase._outcome.success
        for root, token, identity in self.roots:
            if failed:
                print("Retained synthetic fixture for failed test: " + str(root), file=sys.stderr)
                continue
            info = root.lstat()
            if not stat.S_ISDIR(info.st_mode) or (info.st_dev, info.st_ino) != identity:
                raise AssertionError("Synthetic fixture ownership changed; root retained")
            marker = root / "fixture-owner"
            fd = os.open(marker, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                marker_info = os.fstat(fd)
                if not stat.S_ISREG(marker_info.st_mode) or marker_info.st_size != len(token):
                    raise AssertionError("Synthetic fixture marker changed; root retained")
                if os.read(fd, len(token) + 1).decode("ascii") != token:
                    raise AssertionError("Synthetic fixture ownership changed; root retained")
            finally:
                os.close(fd)
            shutil.rmtree(root)


class GitFixture:
    """Plumbing only: no real author, commit invocation, hooks, transport or signing."""

    def __init__(self, owner, *, bare=False, object_format="sha1"):
        if object_format not in {"sha1", "sha256"}:
            raise AssertionError("Unsupported synthetic fixture object format")
        self.root = owner.create_root()
        self.path = self.root / "repository"
        self.path.mkdir()
        self.bare = bare
        self.object_format = object_format
        self.owned_loose_objects = set()
        self.git_dir = self.path if bare else self.path / ".git"
        self.env = {name: value for name, value in os.environ.items()
                    if not name.startswith("GIT_")}
        self.env.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1",
                        GIT_TERMINAL_PROMPT="0", GCM_INTERACTIVE="never")
        self.executable = shutil.which("git")
        if self.executable is None:
            raise AssertionError("Required Git executable is unavailable")
        template = self.root / "empty-template"
        template.mkdir()
        args = ["init", "--quiet", "--template=" + str(template),
                "--initial-branch=synthetic", "--object-format=" + object_format]
        if bare:
            args.append("--bare")
        self._run(args + [str(self.path)], initialized=False)
        self.head = None
        self.tree = None
        self.files = {}
        self.blobs = {}

    def _run(self, args, *, data=None, initialized=True):
        prefix = [self.executable]
        if initialized:
            prefix += ["--git-dir=" + str(self.git_dir)]
            if not self.bare:
                prefix += ["--work-tree=" + str(self.path)]
        result = subprocess.run(prefix + list(args), input=data, capture_output=True,
                                env=self.env, cwd=self.root, timeout=10, check=False)
        if result.returncode:
            raise AssertionError("Synthetic fixture Git plumbing failed: " + args[0])
        return result.stdout

    def blob(self, data, kind="blob"):
        oid = self._run(["hash-object", "-w", "-t", kind, "--stdin"], data=data).strip().decode("ascii")
        self.owned_loose_objects.add(oid)
        return oid

    def commit_files(self, files, *, update_head=True):
        graph = {}
        blobs = {}
        for path, spec in files.items():
            parts = _safe_parts(path)
            if spec.mode not in {"100644", "100755", "120000", "160000"}:
                raise AssertionError("Unsupported synthetic fixture mode")
            if (spec.data is None) == (spec.oid is None):
                raise AssertionError("Synthetic fixture needs exactly one payload or object ID")
            oid = spec.oid if spec.oid is not None else self.blob(spec.data)
            blobs[path] = oid
            node = graph
            for part in parts[:-1]:
                node = node.setdefault(part, {})
                if not isinstance(node, dict):
                    raise AssertionError("Conflicting synthetic fixture paths")
            if parts[-1] in node:
                raise AssertionError("Duplicate synthetic fixture path")
            node[parts[-1]] = (spec.mode, oid)

        def write_tree(node):
            records = []
            for name, value in sorted(node.items()):
                if isinstance(value, dict):
                    mode, kind, oid = "040000", "tree", write_tree(value)
                else:
                    mode, oid = value
                    kind = "commit" if mode == "160000" else "blob"
                records.append((mode + " " + kind + " " + oid + "\t" + name).encode() + b"\0")
            oid = self._run(["mktree", "-z"], data=b"".join(records)).strip().decode("ascii")
            self.owned_loose_objects.add(oid)
            return oid

        tree = write_tree(graph)
        address = b"fixture" + b"@" + b"example.invalid"
        identity = b"Synthetic Fixture <" + address + b"> 0 +0000\n"
        commit = b"tree " + tree.encode() + b"\nauthor " + identity
        commit += b"committer " + identity + b"\nSynthetic graph\n"
        oid = self.blob(commit, "commit")
        if update_head:
            self._run(["update-ref", "refs/heads/synthetic", oid])
            self.head, self.tree, self.files, self.blobs = oid, tree, dict(files), blobs
        return oid

    def seed(self, files):
        self.commit_files(files)
        if not self.bare:
            self.set_index(files)
            self.materialize(files, self.path)
        return self

    def set_index(self, files):
        if self.bare:
            raise AssertionError("Bare fixture cannot have an observation index")
        lines = []
        for path, spec in sorted(files.items()):
            _safe_parts(path)
            oid = spec.oid if spec.oid is not None else self.blob(spec.data)
            lines.append((spec.mode + " " + oid + "\t" + path).encode() + b"\0")
        self._run(["update-index", "-z", "--index-info"], data=b"".join(lines))

    @staticmethod
    def materialize(files, target):
        for path, spec in files.items():
            _safe_parts(path)
            leaf = target.joinpath(*path.split("/"))
            leaf.parent.mkdir(parents=True, exist_ok=True)
            if spec.mode == "160000":
                leaf.mkdir()
            elif spec.mode == "120000":
                leaf.symlink_to(spec.data.decode("utf-8"))
            else:
                if spec.data is None:
                    raise AssertionError("Synthetic working file requires bytes")
                leaf.write_bytes(spec.data)
                leaf.chmod(0o755 if spec.mode == "100755" else 0o644)

    def append_config(self, text, *, path=None):
        target = self.git_dir / "config" if path is None else path
        with target.open("a", encoding="utf-8") as stream:
            stream.write(text)

    def linked(self):
        if self.bare:
            raise AssertionError("Linked fixture requires nonbare common storage")
        linked = self.root / "linked"
        linked.mkdir()
        admin = self.git_dir / "worktrees" / "synthetic"
        admin.mkdir(parents=True)
        (linked / ".git").write_text("gitdir: " + str(admin) + "\n")
        (admin / "commondir").write_text("../..\n")
        (admin / "gitdir").write_text(str(linked / ".git") + "\n")
        (admin / "HEAD").write_text(self.head + "\n")
        (admin / "index").write_bytes((self.git_dir / "index").read_bytes())
        self.materialize(self.files, linked)
        return linked, admin

    def unmerged_index(self, path):
        oid = self.blobs[path]
        zero = "0" * len(oid)
        rows = ["0 " + zero + "\t" + path]
        rows += ["100644 " + oid + " " + str(stage) + "\t" + path for stage in (1, 2, 3)]
        self._run(["update-index", "-z", "--index-info"],
                  data=b"\0".join(row.encode() for row in rows) + b"\0")

    def intent_index(self, path):
        leaf = self.path.joinpath(*_safe_parts(path))
        leaf.parent.mkdir(parents=True, exist_ok=True)
        leaf.write_bytes(b"Synthetic pending entry\n")
        self._run(["add", "--intent-to-add", "--", path])

    def pack_only(self):
        """Pack every owned object, then remove only this fixture's loose files."""
        pack_dir = self.git_dir / "objects/pack"
        pack_dir.mkdir(exist_ok=True)
        expected = 40 if self.object_format == "sha1" else 64
        if any(len(oid) != expected or any(char not in "0123456789abcdef" for char in oid)
               for oid in self.owned_loose_objects):
            raise AssertionError("Synthetic owned object identifier was malformed")
        objects = b"\n".join(oid.encode("ascii") for oid in sorted(self.owned_loose_objects)) + b"\n"
        pack_oid = self._run(["pack-objects", str(pack_dir / "pack")],
                             data=objects).strip().decode("ascii")
        if len(pack_oid) != expected or any(char not in "0123456789abcdef" for char in pack_oid):
            raise AssertionError("Synthetic pack identifier was malformed")
        pack = pack_dir / ("pack-" + pack_oid + ".pack")
        index = pack_dir / ("pack-" + pack_oid + ".idx")
        if not pack.is_file() or not index.is_file():
            raise AssertionError("Synthetic pack plumbing omitted pack or index")
        for oid in self.owned_loose_objects:
            path = self.git_dir / "objects" / oid[:2] / oid[2:]
            if not stat.S_ISREG(path.lstat().st_mode):
                raise AssertionError("Synthetic loose object ownership changed")
            path.unlink()
        return pack, index

    def sentinel(self):
        marker = self.root / "executed-sentinel"
        executable = self.root / "sentinel-command"
        executable.write_text("#!/bin/sh\nprintf executed >> " + shlex.quote(str(marker))
                              + "\nprintf synthetic-child-marker\nexit 91\n")
        executable.chmod(0o755)
        return marker, executable
