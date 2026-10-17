"""Trusted consumer bootstrap; inspect candidate bytes before importing them."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
import re
import stat
import sys

PAYLOAD_FILES = tuple(sorted((
    "LICENSE", "docs/specification-candidate.md", "docs/field-table.md",
    "docs/enum-provenance.md", "docs/validation-candidate.md",
    "docs/acquisition-candidate.md", "docs/offline-binding-candidate.md",
    "src/project_manifest/__init__.py", "src/project_manifest/__main__.py",
    "src/project_manifest/candidate.py", "src/project_manifest/validation.py",
    "src/project_manifest/acquire.py", "src/project_manifest/cli.py",
    "tests/acquisition_fixtures.py", "tests/test_candidate.py",
    "tests/test_validation.py", "tests/test_acquisition.py", "tests/test_cli.py",
    "tests/run_corpus.py", "tests/compare_loaders.py",
)))
TABLE_NAME = "release.json"
DOMAIN = b"project-manifest-release-table-v1\0"
MAX_TABLE_BYTES = 65_536
MAX_FILE_BYTES = 1_048_576
MAX_TOTAL_BYTES = 16_777_216
HEADERS = {
    "format": "candidate-binding-1", "origin": "jefahnierocks/project-manifest",
    "spec_version": "1", "release_id": "candidate-1", "python_minimum": "3.11",
    "git_minimum": "2.56.0",
}
RELEASE_HEADERS = {
    **HEADERS, "format": "project-manifest-release-1", "release_id": "1",
    "observation_protocol": "project-manifest-git-observation-1",
}
BINDING_FORMATS = frozenset({"candidate-binding-1", "project-manifest-release-1"})
DIRECTORIES = frozenset(
    "/".join(path.split("/")[:depth])
    for path in PAYLOAD_FILES for depth in range(1, len(path.split("/")))
)


@dataclass(frozen=True)
class VerificationResult:
    exit_code: int
    findings: tuple[str, ...]
    descriptor: dict | None = None
    binding_format: str | None = "candidate-binding-1"

    def diagnostics(self):
        return {
            "scope": {
                "candidate-binding-1": "candidate-offline-byte-binding",
                "project-manifest-release-1": "project-manifest-release-byte-binding-1",
            }.get(self.binding_format, "offline-byte-binding-protocol-unavailable"),
            "exit_code": self.exit_code, "findings": list(self.findings),
            "bytes_verified": self.exit_code == 0,
            "release_approval": "not_checked", "complete_v1_validity": "not_checked",
            "producer_admission": "not_checked", "runtime_acceptance": "not_checked",
        }


class _Failure(Exception):
    def __init__(self, code, exit_code=1):
        self.code = code
        self.exit_code = exit_code


def _require(condition, code):
    if not condition:
        raise _Failure(code)


def _fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def _identity(info):
    return info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode)


def _open_root(root):
    try:
        raw = os.fspath(root)
        if type(raw) is not str or not raw.startswith("/"):
            raise _Failure("ROOT_UNAVAILABLE", 2)
        parts = raw.split("/")[1:]
        if not parts or any(part in {"", ".", ".."} for part in parts):
            raise _Failure("ROOT_UNAVAILABLE", 2)
        fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for part in parts:
                observed = os.stat(part, dir_fd=fd, follow_symlinks=False)
                _require(stat.S_ISDIR(observed.st_mode), "ROOT_TYPE")
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=fd)
                try:
                    _require(_identity(observed) == _identity(os.fstat(child)),
                             "BINDING_CHANGED")
                except BaseException:
                    os.close(child)
                    raise
                os.close(fd)
                fd = child
            return fd
        except BaseException:
            os.close(fd)
            raise
    except (TypeError, ValueError, OSError):
        raise _Failure("ROOT_UNAVAILABLE", 2) from None


def _namespace(fd, prefix=""):
    observed = {}
    # Fixed paths bound width/depth before any nonregular payload is opened.
    with os.scandir(fd) as entries:
        for entry in entries:
            _require(len(observed) <= len(PAYLOAD_FILES) + len(DIRECTORIES), "LAYOUT")
            name = prefix + entry.name
            _require(name in DIRECTORIES or name in PAYLOAD_FILES or name == TABLE_NAME,
                     "LAYOUT")
            info = entry.stat(follow_symlinks=False)
            observed[name] = _fingerprint(info)
            if name in DIRECTORIES:
                _require(stat.S_ISDIR(info.st_mode), "FILE_TYPE")
                child = os.open(entry.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                                dir_fd=fd)
                try:
                    _require(_fingerprint(info) == _fingerprint(os.fstat(child)),
                             "BINDING_CHANGED")
                    observed.update(_namespace(child, name + "/"))
                finally:
                    os.close(child)
            else:
                _require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "FILE_TYPE")
    return observed


def _read(fd, name, maximum):
    parent = os.dup(fd)
    parts = name.split("/")
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                            dir_fd=parent)
            os.close(parent)
            parent = child
        file_fd = os.open(parts[-1], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW,
                          dir_fd=parent)
        try:
            before = os.fstat(file_fd)
            _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "FILE_TYPE")
            _require(before.st_size <= maximum, "BYTE_BOUND")
            chunks, count = [], 0
            while True:
                chunk = os.read(file_fd, min(65_536, maximum + 1 - count))
                if not chunk:
                    break
                count += len(chunk)
                _require(count <= maximum, "BYTE_BOUND")
                chunks.append(chunk)
            after = os.fstat(file_fd)
            bound = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            _require(_fingerprint(before) == _fingerprint(after) == _fingerprint(bound)
                     and count == before.st_size, "BINDING_CHANGED")
            return b"".join(chunks), _fingerprint(before)
        finally:
            os.close(file_fd)
    finally:
        os.close(parent)


def _object(pairs):
    record = {}
    for key, value in pairs:
        _require(key not in record, "TABLE_FORMAT")
        record[key] = value
    return record


def canonical_table_bytes(record):
    """One pure canonical encoder; no filesystem, packaging or approval behavior."""
    return (json.dumps(record, ensure_ascii=True, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("ascii")


def _descriptor(data, *, expected_format="candidate-binding-1"):
    headers = HEADERS if expected_format == "candidate-binding-1" else RELEASE_HEADERS
    try:
        record = json.loads(data.decode("ascii"), object_pairs_hook=_object)
        canonical = canonical_table_bytes(record)
    except (UnicodeError, ValueError, RecursionError, TypeError):
        raise _Failure("TABLE_FORMAT") from None
    _require(data == canonical and type(record) is dict, "TABLE_FORMAT")
    if "format" in record:
        _require(record["format"] == expected_format, "TABLE_IDENTITY")
    _require(set(record) == set(headers) | {"source_revision", "files"}, "TABLE_FORMAT")
    _require(all(record[key] == value for key, value in headers.items()), "TABLE_IDENTITY")
    revision = record["source_revision"]
    _require(type(revision) is str and bool(re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", revision)),
             "TABLE_IDENTITY")
    rows = record["files"]
    _require(type(rows) is list and len(rows) == len(PAYLOAD_FILES), "TABLE_FILES")
    total = 0
    for path, row in zip(PAYLOAD_FILES, rows):
        _require(type(row) is dict and set(row) == {"path", "bytes", "sha256"}, "TABLE_FILES")
        _require(row["path"] == path, "TABLE_FILES")
        _require(type(row["bytes"]) is int and 0 <= row["bytes"] <= MAX_FILE_BYTES,
                 "BYTE_BOUND")
        _require(type(row["sha256"]) is str and
                 bool(re.fullmatch(r"[0-9a-f]{64}", row["sha256"])), "TABLE_FILES")
        total += row["bytes"]
    _require(total <= MAX_TOTAL_BYTES, "BYTE_BOUND")
    return record


def verify_release(root, *, expected_digest, expected_format="candidate-binding-1"):
    """Inspect one explicitly selected byte profile; never approve or import it."""
    if type(expected_format) is not str or expected_format not in BINDING_FORMATS:
        return VerificationResult(2, ("BINDING_PROTOCOL",), binding_format=None)

    def result(exit_code, findings, descriptor=None):
        return VerificationResult(exit_code, findings, descriptor, expected_format)
    if type(expected_digest) is not str or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        return result(2, ("EXPECTED_DIGEST_UNAVAILABLE",))
    if sys.version_info < (3, 11) or os.name != "posix" or not all(
        hasattr(os, flag) for flag in ("O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK")
    ):
        return result(2, ("RUNTIME_UNAVAILABLE",))
    fd = None
    try:
        fd = _open_root(root)
        root_info = _fingerprint(os.fstat(fd))
        layout = _namespace(fd)
        _require(set(layout) == set(PAYLOAD_FILES) | DIRECTORIES | {TABLE_NAME}, "LAYOUT")
        table, table_info = _read(fd, TABLE_NAME, MAX_TABLE_BYTES)
        _require(table_info == layout[TABLE_NAME], "BINDING_CHANGED")
        descriptor = _descriptor(table, expected_format=expected_format)
        _require(hashlib.sha256(DOMAIN + table).hexdigest() == expected_digest, "EXPECTED_DIGEST")
        for row in descriptor["files"]:
            data, info = _read(fd, row["path"], MAX_FILE_BYTES)
            _require(info == layout[row["path"]], "BINDING_CHANGED")
            _require(len(data) == row["bytes"] and
                     hashlib.sha256(data).hexdigest() == row["sha256"], "PAYLOAD_DIGEST")
        _require(_namespace(fd) == layout and _fingerprint(os.fstat(fd)) == root_info,
                 "BINDING_CHANGED")
        rebound = _open_root(root)
        try:
            _require(_fingerprint(os.fstat(rebound)) == root_info, "BINDING_CHANGED")
        finally:
            os.close(rebound)
        return result(0, (), descriptor)
    except _Failure as error:
        return result(error.exit_code, (error.code,))
    except (OSError, ValueError, RecursionError, OverflowError):
        return result(1, ("BINDING_UNAVAILABLE_OR_CHANGED",))
    finally:
        if fd is not None:
            os.close(fd)


def main():
    parser = argparse.ArgumentParser(description="Trusted candidate byte-binding verifier")
    parser.add_argument("--root", required=True)
    parser.add_argument("--expected-digest", required=True)
    args = parser.parse_args()
    result = verify_release(args.root, expected_digest=args.expected_digest)
    print(json.dumps(result.diagnostics(), sort_keys=True))
    return result.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
