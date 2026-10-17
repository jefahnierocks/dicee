#!/usr/bin/env -S python3 -I -S -B
"""Prepare Git only in an owned Linux CI prefix; never replace runner tools.

Adapted from the public MIT project-manifest scripts/prepare-linux-tools.py at
9797b48786f6da0e4e5167a25c2a873e6945269c. Its release LICENSE is vendored.
Source trust: official HTTPS-published SHA-256, not a tar-signature claim.
"""

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
from urllib.request import urlopen

URL = "https://www.kernel.org/pub/software/scm/git/git-2.56.0.tar.xz"
SHA256 = "26c56c296b38c0695b26fa95f475f1d01704d2d38e73465ca30b0b2f5dc789d3"


def require(condition):
    if not condition:
        raise ValueError("PREPARATION_UNAVAILABLE")


def main():
    require(platform.system() == "Linux" and platform.machine() == "x86_64"
            and os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("RUNNER_OS") == "Linux" and os.environ.get("RUNNER_ARCH") == "X64"
            and sys.version_info[:3] == (3, 13, 14))
    parent = Path(os.environ["RUNNER_TEMP"])
    root = Path(__file__).resolve().parent.parent
    require(parent.is_absolute() and parent.is_dir() and not parent.is_symlink()
            and root != parent.resolve() and root not in parent.resolve().parents)
    owned = Path(tempfile.mkdtemp(prefix="dicee-manifest-git-", dir=parent))
    archive = owned / "git.tar.xz"
    digest, count, deadline = hashlib.sha256(), 0, time.monotonic() + 60
    with urlopen(URL, timeout=30) as response, archive.open("xb") as output:
        require(response.url.startswith("https://"))
        while chunk := response.read(65536):
            count += len(chunk)
            require(count <= 64 * 1024 * 1024 and time.monotonic() <= deadline)
            digest.update(chunk)
            output.write(chunk)
    require(digest.hexdigest() == SHA256)
    source = owned / "source"
    with tarfile.open(archive, "r:xz") as tar:
        members = tar.getmembers()
        require(len(members) <= 25000 and sum(m.size for m in members) <= 512 * 1024 * 1024)
        for member in members:
            parts = PurePosixPath(member.name).parts
            require(parts and parts[0] == "git-2.56.0" and ".." not in parts
                    and not member.name.startswith("/") and "\\" not in member.name
                    and (member.isfile() or member.isdir() or member.issym()))
        tar.extractall(source, members=members, filter="data")
    prefix = owned / "prefix"
    # Disable optional bindings, including ambient Rust, for a minimal object reader.
    flags = ["NO_OPENSSL", "NO_CURL", "NO_EXPAT", "NO_GETTEXT", "NO_TCLTK", "NO_PERL", "NO_PYTHON", "NO_RUST"]
    argv = ["make", "-j2", "prefix=" + str(prefix), *(flag + "=YesPlease" for flag in flags), "all", "install"]
    child = subprocess.Popen(argv, cwd=source / "git-2.56.0", start_new_session=True)
    try:
        require(child.wait(timeout=600) == 0)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
        raise ValueError("PREPARATION_TIMEOUT") from None
    git = prefix / "bin/git"
    result = subprocess.run([str(git), "--version"], capture_output=True, timeout=10, check=True)
    require(result.stdout == b"git version 2.56.0\n" and not git.is_symlink())
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write("git=" + str(git) + "\n")
    print(json.dumps({"scope": "dicee-manifest-git-preparation", "version": "2.56.0",
                      "source_sha256": SHA256, "binary_sha256": hashlib.sha256(git.read_bytes()).hexdigest(),
                      "trust": "official-HTTPS-published-SHA256; tar-signature-not-verified"}, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, tarfile.TarError, subprocess.SubprocessError):
        print('{"scope":"dicee-manifest-git-preparation","exit_code":2}')
        raise SystemExit(2)
