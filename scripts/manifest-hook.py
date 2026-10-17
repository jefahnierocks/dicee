#!/usr/bin/env -S python3 -I -S -B
"""Validate native hook context before launching one fixed repository gate.

The direct declaration adapter still refuses inherited Git overrides. This
caller accepts only native exports bound to this checkout's ordinary index,
explicitly authorized linked storage and selected native Git installation.
"""
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
NORMALIZED = ("GIT_DIR", "GIT_INDEX_FILE", "GIT_EXEC_PATH")
FORBIDDEN = (
    "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_GLOBAL",
    "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS",
    "GIT_NAMESPACE", "GIT_REPLACE_REF_BASE", "GIT_SHALLOW_FILE", "GIT_GRAFT_FILE",
)


def directory(path):
    """Authorize no symlink traversal, including in explicitly supplied storage."""
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
    finally:
        os.close(fd)


def absolute(raw):
    path = Path(raw)
    if not path.is_absolute() or str(path) != raw or ".." in path.parts:
        raise ValueError
    return path


def normalized_child(adapter):
    env = os.environ.copy()
    if Path.cwd() != ROOT or any(env.get(key) for key in FORBIDDEN) or env.get("GIT_PREFIX", ""):
        raise ValueError
    read = adapter["read_regular"]
    marker = ROOT / ".git"
    kind = marker.lstat().st_mode
    common = env.get("DICEE_MANIFEST_COMMON_DIR")
    if stat.S_ISDIR(kind):
        gitdir = marker
        directory(gitdir)
        if common and absolute(common) != gitdir:
            raise ValueError
    elif stat.S_ISREG(kind):
        # Linked authority is explicit; never discover an outside common root.
        storage = absolute(common) if common else None
        if storage is None:
            raise ValueError
        directory(storage)
        pointer = read(marker, 4096)
        if not pointer.startswith(b"gitdir: ") or pointer.count(b"\n") != 1 or not pointer.endswith(b"\n"):
            raise ValueError
        gitdir = absolute(pointer[8:-1].decode("utf-8"))
        if len(gitdir.relative_to(storage / "worktrees").parts) != 1:
            raise ValueError
        directory(gitdir)
        if (read(gitdir / "commondir", 4096) != b"../..\n"
                or read(gitdir / "gitdir", 4096) != os.fsencode(str(marker)) + b"\n"):
            raise ValueError
    else:
        raise ValueError
    expected = {"GIT_DIR": gitdir, "GIT_INDEX_FILE": gitdir / "index"}
    for key, path in expected.items():
        raw = env.get(key)
        # Native ordinary hooks may use .git/index; linked exports are absolute.
        accepted = {str(path)}
        if gitdir == marker:
            accepted.add(str(path.relative_to(ROOT)))
        if raw and raw not in accepted:
            raise ValueError
    # Refuse symlink/hardlink, missing and alternate/partial-commit index evidence.
    read(expected["GIT_INDEX_FILE"], 16 * 1024 * 1024)
    # Git selection may alter PATH for its own reader process. Keep the hook
    # child on the incoming mise-selected Node/pnpm authority.
    incoming_path = env.get("PATH", "")
    try:
        git = adapter["select_git"]()
    finally:
        os.environ["PATH"] = incoming_path
    # This native global option exits before repository setup. No source config
    # or inherited Git override enters this outside-repository query.
    observed = subprocess.run([git, "--exec-path"], cwd="/", env={"PATH": incoming_path, "LC_ALL": "C"},
                              capture_output=True, timeout=5, check=True)
    if observed.stderr or len(observed.stdout) > 4096:
        raise ValueError
    native_exec = observed.stdout.decode("utf-8").removesuffix("\n")
    absolute(native_exec)
    if env.get("GIT_EXEC_PATH") and env["GIT_EXEC_PATH"] != native_exec:
        raise ValueError
    validated = [key for key in NORMALIZED if env.get(key)]
    for key in validated:
        del env[key]
    return env, validated


def main():
    commands = {"docs": ["node", str(ROOT / "scripts/check-docs.mjs")],
                "validate-ci": ["pnpm", "validate:ci"]}
    try:
        if len(sys.argv) != 2 or sys.argv[1] not in commands or sys.version_info[:3] != (3, 13, 14):
            raise ValueError
        adapter = runpy.run_path(str(ROOT / "scripts/check-project-manifest.py"), run_name="dicee_hook_caller")
        env, validated = normalized_child(adapter)
    except Exception:
        print('{"scope":"dicee-native-hook-context","exit_code":2,"finding":"HOOK_CONTEXT_UNAVAILABLE"}')
        return 2
    print(json.dumps({"scope": "dicee-native-hook-context", "validated_native_exports": validated}), flush=True)
    os.execvpe(commands[sys.argv[1]][0], commands[sys.argv[1]], env)


if __name__ == "__main__":
    raise SystemExit(main())
