#!/usr/bin/env -S python3 -I -S -B
"""Dicee's offline declaration gate against the approved public release API.

No project commands, environment loaders, network access or host probes run here.
The public bootstrap checks the full release; only captured, hash-checked module
bytes are imported. Approval is this reviewed literal, never caller input.
"""

import argparse
import datetime
import hashlib
import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import types

ROOT = Path(__file__).resolve().parent.parent
APPROVED_RELEASE = {
    "origin": "jefahnierocks/project-manifest",
    "format": "project-manifest-release-1",
    "release_id": "1",
    "source_revision": "56e3920089726e585eaa0fd7f4dc94e6938a1e0c",
    "table_digest": "f7ff9dd0972af5d3a6a3348c3e092de1a6acd97fa3975e13e522cf80ce5e7df2",
    "bootstrap_sha256": "2ccf58e0da97bbbd9dae173d1cca047d465c4a2d950ee6e56052309a9689cf4f",
}
MODULES = ("__init__", "__main__", "candidate", "validation", "acquire", "cli")
PREFIX = "dicee_manifest_reference"


class Unavailable(Exception):
    pass


class Arguments(argparse.ArgumentParser):
    def error(self, message):
        raise Unavailable("ARGUMENTS")


def require(condition, code):
    if not condition:
        raise Unavailable(code)


def read_regular(path, maximum):
    """Read bounded single-link bytes through no-follow parent descriptors."""
    parts = path.parts
    require(path.is_absolute() and ".." not in parts, "FILE_LAYOUT")
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        leaf = os.open(parts[-1], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=fd)
        try:
            before = os.fstat(leaf)
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                    and before.st_size <= maximum, "FILE_LAYOUT")
            chunks, total = [], 0
            while chunk := os.read(leaf, min(65536, maximum + 1 - total)):
                total += len(chunk)
                require(total <= maximum, "FILE_BOUND")
                chunks.append(chunk)
            after = os.fstat(leaf)
            rebound = os.stat(parts[-1], dir_fd=fd, follow_symlinks=False)
            fields = ("st_dev", "st_ino", "st_mode", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns")
            fingerprint = lambda info: tuple(getattr(info, field) for field in fields)
            require(fingerprint(before) == fingerprint(after) == fingerprint(rebound)
                    and total == before.st_size, "FILE_CHANGED")
            return b"".join(chunks)
        finally:
            os.close(leaf)
    finally:
        os.close(fd)


class CapturedModules(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """No filesystem fallback for the reference package or its descendants."""
    def __init__(self, sources):
        self.sources = sources

    def find_spec(self, fullname, path=None, target=None):
        if fullname == PREFIX or fullname.startswith(PREFIX + "."):
            require(fullname in self.sources, "MODULE_SET")
            return importlib.util.spec_from_loader(fullname, self, is_package=fullname == PREFIX)
        return None

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        name = module.__name__
        module.__file__ = "<approved-public-release/" + name + ">"
        exec(compile(self.sources[name], module.__file__, "exec"), module.__dict__)


def captured_release():
    vendor = ROOT / "vendor/project-manifest"
    bootstrap = read_regular(vendor / "bootstrap.py", 32768)
    require(hashlib.sha256(bootstrap).hexdigest() == APPROVED_RELEASE["bootstrap_sha256"],
            "BOOTSTRAP_BINDING")
    module = types.ModuleType("_dicee_manifest_bootstrap")
    sys.modules[module.__name__] = module
    exec(compile(bootstrap, "<approved-public-bootstrap>", "exec"), module.__dict__)
    release = vendor / "release-1"
    binding = module.verify_release(str(release), expected_digest=APPROVED_RELEASE["table_digest"],
                                    expected_format=APPROVED_RELEASE["format"])
    require(binding.exit_code == 0 and binding.descriptor is not None, "RELEASE_BINDING")
    descriptor = binding.descriptor
    require(all(descriptor[key] == APPROVED_RELEASE[key] for key in
                ("origin", "format", "release_id", "source_revision")), "RELEASE_IDENTITY")
    rows = {row["path"]: row for row in descriptor["files"]}
    sources = {}
    for name in MODULES:
        path = "src/project_manifest/" + name + ".py"
        data = read_regular(release / path, 1048576)
        row = rows[path]
        require(len(data) == row["bytes"] and hashlib.sha256(data).hexdigest() == row["sha256"],
                "CAPTURE_BINDING")
        sources[PREFIX if name == "__init__" else PREFIX + "." + name] = data
    return CapturedModules(sources), binding.diagnostics()


def select_git():
    selected = os.environ.get("DICEE_MANIFEST_GIT") or shutil.which("git")
    require(selected is not None and Path(selected).is_absolute(), "NATIVE_GIT")
    git = Path(selected).resolve(strict=True)
    require(git.name == "git" and git.is_file() and os.access(git, os.X_OK), "NATIVE_GIT")
    # Reject shims/scripts: acquisition must use the selected native executable.
    with git.open("rb") as stream:
        magic = stream.read(4)
    require(magic in (b"\x7fELF", b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf",
                      b"\xca\xfe\xba\xbe", b"\xbe\xba\xfe\xca"), "NATIVE_GIT")
    os.environ["PATH"] = str(git.parent) + os.pathsep + os.environ.get("PATH", "")
    return str(git)


def main(argv=None):
    report = {
        "scope": "dicee-project-manifest-1", "exit_code": 2,
        "release_approval": "approved", "approved_release": APPROVED_RELEASE,
        "bytes_verified": False, "declaration_checks": "not_checked",
        "complete_v1_validity": "not_checked", "native_conformance": "not_checked",
        "producer_admission": "not_checked", "runtime_acceptance": "not_checked",
        "binding": None, "observation": None, "findings": [],
    }
    loader = None
    try:
        parser = Arguments(description=__doc__)
        parser.add_argument("--rev")
        parser.add_argument("--git-common-dir", default=os.environ.get("DICEE_MANIFEST_COMMON_DIR"))
        parser.add_argument("--reference-date", default=datetime.datetime.now(datetime.timezone.utc).date().isoformat())
        parser.add_argument("--status-json", action="store_true")
        args = parser.parse_args(argv)
        require(sys.version_info[:3] == (3, 13, 14), "PROJECT_PYTHON_PIN")
        rev = args.rev
        if os.environ.get("GITHUB_ACTIONS") == "true":
            expected = os.environ.get("GITHUB_SHA", "")
            require(bool(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", expected))
                    and (rev is None or rev == expected), "CI_REVISION")
            rev = expected
        require(rev is None or bool(re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", rev)), "REVISION")
        loader, report["binding"] = captured_release()
        report["bytes_verified"] = True
        select_git()
        require(not any(name == PREFIX or name.startswith(PREFIX + ".") for name in sys.modules),
                "AMBIENT_MODULE")
        sys.meta_path.insert(0, loader)
        api = __import__(PREFIX + ".acquire", fromlist=["observe_released_repository"])
        observed = api.observe_released_repository(
            str(ROOT), mode="rev" if rev else "worktree", rev=rev,
            reference_date=args.reference_date, common_dir=args.git_common_dir)
        # Exactly one actual released observation; its library scope stays unchanged.
        report["observation"] = observed.diagnostics
        status = observed.exit_code
        report.update(exit_code=status, declaration_checks=("passed", "failed", "not_checked")[status],
                      complete_v1_validity=("valid", "invalid", "not_checked")[status])
        if status == 0 and args.status_json:
            record = observed.record
            report["status_record"] = {
                "local_phase": record["status"]["local_phase"], "as_of": record["status"]["as_of"],
                "status_of_record": record["authority"]["status_of_record"],
            }
    except Unavailable as error:
        report.update(exit_code=2, declaration_checks="not_checked", complete_v1_validity="not_checked",
                      findings=[str(error)])
    except (OSError, ValueError, KeyError, TypeError, ImportError):
        report.update(exit_code=2, declaration_checks="not_checked", complete_v1_validity="not_checked",
                      findings=["GATE_UNAVAILABLE"])
    finally:
        if loader in sys.meta_path:
            sys.meta_path.remove(loader)
        for name in tuple(sys.modules):
            if name == PREFIX or name.startswith(PREFIX + "."):
                del sys.modules[name]
    print(json.dumps(report, sort_keys=True))
    return report["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
