"""Exercise the actual public API through disposable repository-owned adapters."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
GIT = str(Path(os.environ.get("DICEE_MANIFEST_GIT") or shutil.which("git")).resolve())


class ManifestGate(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dicee-manifest-test-")
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name).resolve()
        (self.repo / "scripts").mkdir()
        (self.repo / "docs").mkdir()
        self.adapter = self.repo / "scripts/check-project-manifest.py"
        shutil.copyfile(ROOT / "scripts/check-project-manifest.py", self.adapter)
        self.adapter.chmod(0o755)
        shutil.copyfile(ROOT / "scripts/manifest-hook.py", self.repo / "scripts/manifest-hook.py")
        shutil.copyfile(ROOT / ".gitattributes", self.repo / ".gitattributes")
        shutil.copytree(ROOT / "vendor", self.repo / "vendor")
        shutil.copyfile(ROOT / "scripts/tests/fixtures/project-manifest.yaml", self.repo / "project.yaml")
        (self.repo / "docs/status.md").write_text("# Fixture status\n")
        # These are newly created synthetic repositories, never source acquisition.
        local_names = subprocess.check_output([GIT, "rev-parse", "--local-env-vars"], text=True).splitlines()
        self.env = os.environ.copy()
        for key in (*local_names, "GITHUB_ACTIONS", "GITHUB_SHA", "DICEE_MANIFEST_COMMON_DIR"):
            self.env.pop(key, None)
        self.env["DICEE_MANIFEST_GIT"] = GIT
        self.git("init", "--quiet", "--initial-branch=main")
        self.commit()

    def git(self, *args):
        env = {**self.env, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"}
        return subprocess.check_output([GIT, "-C", str(self.repo), *args], env=env, stderr=subprocess.PIPE, text=True).strip()

    def commit(self):
        self.git("add", "-A")
        self.git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.com",
                 "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", "fixture")
        return self.git("rev-parse", "HEAD")

    def run_gate(self, expected, *args, extra_env=None):
        result = subprocess.run([sys.executable, "-I", "-S", "-B", str(self.adapter), *args],
                                env={**self.env, **(extra_env or {})}, capture_output=True, text=True, timeout=65)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        report = json.loads(result.stdout)
        self.assertEqual(report["exit_code"], expected)
        self.assertEqual(report["complete_v1_validity"], ("valid", "invalid", "not_checked")[expected])
        self.assertEqual(report["runtime_acceptance"], "not_checked")
        return report

    def test_actual_worktree_and_checked_projection(self):
        report = self.run_gate(0, "--status-json")
        self.assertTrue(report["bytes_verified"])
        self.assertEqual(report["status_record"], {"local_phase": "fixture phase", "as_of": "2026-01-02", "status_of_record": "docs/status.md"})
        for scope in (report["binding"], report["observation"]):
            self.assertEqual(scope["complete_v1_validity"], "not_checked")
        self.assertEqual(report["observation"]["mode"], "worktree")
        self.assertIsNone(report["observation"]["commit_oid"])

    def test_legacy_and_value_blind_invalid_result(self):
        (self.repo / "project.yaml").write_text('spec_version: 0.1\ncanary: "do-not-echo-this-input"\n')
        report = self.run_gate(1, "--status-json")
        self.assertNotIn("status_record", report)
        self.assertNotIn("do-not-echo-this-input", json.dumps(report))
        self.assertTrue(report["observation"]["manifest_sha256"])

    def test_missing_tracked_reference_is_invalid(self):
        (self.repo / "docs/status.md").unlink()
        self.run_gate(1)

    def test_untracked_reference_does_not_satisfy_declaration(self):
        self.git("rm", "--cached", "docs/status.md")
        self.run_gate(1)

    def test_fixed_bootstrap_pin_prevents_execution(self):
        path = self.repo / "vendor/project-manifest/bootstrap.py"
        path.write_text(path.read_text() + '\nraise RuntimeError("UNVERIFIED_EXECUTION")\n')
        self.run_gate(2)

    def test_payload_and_namespace_binding_fail_closed(self):
        for change in ("content", "extra", "symlink", "hardlink"):
            with self.subTest(change=change):
                release = self.repo / "vendor/project-manifest/release-1"
                path = release / "LICENSE"
                original = path.read_bytes()
                extra = release / "unapproved.txt"
                if change == "content":
                    path.write_bytes(original + b"tamper")
                elif change == "extra":
                    extra.write_text("extra")
                elif change == "symlink":
                    path.unlink()
                    path.symlink_to(self.repo / "docs/status.md")
                else:
                    os.link(path, extra)
                self.run_gate(2)
                if extra.exists():
                    extra.unlink()
                if path.is_symlink():
                    path.unlink()
                path.write_bytes(original)

    def test_revision_is_literal_and_worktree_is_not_substituted(self):
        oid = self.git("rev-parse", "HEAD")
        original = (self.repo / "project.yaml").read_bytes()
        (self.repo / "project.yaml").write_text("invalid worktree\n")
        report = self.run_gate(0, "--rev", oid)
        self.assertEqual(report["observation"]["commit_oid"], oid)
        self.assertEqual(report["observation"]["manifest_sha256"], hashlib.sha256(original).hexdigest())
        self.assertNotIn("status_record", report)
        self.run_gate(1)

    def test_ci_always_uses_exact_event_revision(self):
        oid = self.git("rev-parse", "HEAD")
        (self.repo / "project.yaml").write_text("invalid worktree\n")
        report = self.run_gate(0, extra_env={"GITHUB_ACTIONS": "true", "GITHUB_SHA": oid})
        self.assertEqual(report["observation"]["commit_oid"], oid)
        self.run_gate(2, extra_env={"GITHUB_ACTIONS": "true", "GITHUB_SHA": "HEAD"})
        self.run_gate(2, "--rev", "0" * 40, extra_env={"GITHUB_ACTIONS": "true", "GITHUB_SHA": oid})

    def test_inherited_git_override_is_refused_not_cleared(self):
        self.run_gate(2, extra_env={"GIT_DIR": str(self.repo / ".git")})

    def test_script_shim_cannot_impersonate_native_git(self):
        directory = self.repo / "shim"
        directory.mkdir()
        shim = directory / "git"
        shim.write_text('#!/bin/sh\necho "git version 2.56.0"\n')
        shim.chmod(0o755)
        self.run_gate(2, extra_env={"DICEE_MANIFEST_GIT": str(shim)})

    def test_checkout_attributes_preserve_exact_manifest_and_vendor_bytes(self):
        attributes = self.repo / "inherited-attributes"
        patterns = ("project.yaml", "vendor/project-manifest/bootstrap.py", "vendor/project-manifest/release-1/**")
        attributes.write_text("".join(pattern + " text eol=crlf filter=poison ident working-tree-encoding=UTF-16\n" for pattern in patterns))
        target = self.repo / "transformed-checkout"
        target.mkdir()
        self.git("-c", "core.autocrlf=true", "-c", "core.attributesFile=" + str(attributes),
                 "-c", "filter.poison.required=true", "-c", "filter.poison.smudge=false",
                 "checkout-index", "--all", "--prefix=" + str(target) + "/")
        protected = [self.repo / "project.yaml", self.repo / "vendor/project-manifest/bootstrap.py"]
        protected.extend(p for p in (self.repo / "vendor/project-manifest/release-1").rglob("*") if p.is_file())
        for path in protected:
            self.assertEqual((target / path.relative_to(self.repo)).read_bytes(), path.read_bytes())
        self.assertNotIn(b"\r", (target / "project.yaml").read_bytes())

    def run_hook_caller(self, expected, extra_env=None, cwd=None):
        result = subprocess.run([sys.executable, "-I", "-S", "-B", str(self.repo / "scripts/manifest-hook.py"), "docs"],
                                cwd=cwd or self.repo, env={**self.env, **(extra_env or {})},
                                capture_output=True, text=True, timeout=65)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def prepare_native_hooks(self):
        # Controlled fixture HOME avoids introducing forbidden Git config overrides.
        home = self.repo / "fixture-home"
        home.mkdir()
        self.env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / "xdg"))
        for key, value in (("user.name", "Fixture"), ("user.email", "fixture@example.com"), ("commit.gpgsign", "false")):
            self.git("config", "--local", key, value)
        (self.repo / "scripts/check-docs.mjs").write_text(
            'import {spawnSync} from "node:child_process";\n'
            'const r=spawnSync(process.env.FIXTURE_PYTHON,["-I","-S","-B","scripts/check-project-manifest.py"],{encoding:"utf8"});\n'
            'process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.status ?? 2);\n')
        (self.repo / "package.json").write_text(json.dumps({"name": "fixture", "private": True,
            "packageManager": "pnpm@11.15.1", "scripts": {"validate:ci": "node scripts/check-docs.mjs"}}))
        self.env["FIXTURE_PYTHON"] = sys.executable
        self.commit()

    def test_hook_caller_refuses_substituted_context(self):
        cases = {
            "foreign_index": {"GIT_INDEX_FILE": str(self.repo / "foreign-index")},
            "partial_commit_index": {"GIT_INDEX_FILE": str(self.repo / ".git/index.lock")},
            "foreign_gitdir": {"GIT_DIR": str(self.repo / "foreign-gitdir")},
            "foreign_exec": {"GIT_EXEC_PATH": str(self.repo / "foreign-exec")},
            "config_injection": {"GIT_CONFIG_PARAMETERS": "fixture-config-canary"},
            "storage_override": {"GIT_OBJECT_DIRECTORY": str(self.repo / "foreign-objects")},
            "foreign_common": {"DICEE_MANIFEST_COMMON_DIR": str(self.repo / "foreign-common")},
        }
        for name, env in cases.items():
            with self.subTest(name=name):
                result = self.run_hook_caller(2, env)
                self.assertEqual(json.loads(result.stdout)["finding"], "HOOK_CONTEXT_UNAVAILABLE")
                self.assertNotIn("fixture-config-canary", result.stdout)

    def test_hook_caller_refuses_index_links(self):
        index = self.repo / ".git/index"
        data = index.read_bytes()
        outside = self.repo / "index-copy"
        outside.write_bytes(data)
        for kind in ("symlink", "hardlink"):
            with self.subTest(kind=kind):
                index.unlink()
                if kind == "symlink":
                    index.symlink_to(outside)
                else:
                    os.link(outside, index)
                self.run_hook_caller(2, {"GIT_INDEX_FILE": str(index)})
                index.unlink()
                index.write_bytes(data)

    def native_commit_and_push(self, linked):
        self.prepare_native_hooks()
        root, env = self.repo, self.env.copy()
        if linked:
            root = self.repo / "linked-checkout"
            self.git("worktree", "add", "--quiet", "-b", "linked-fixture", str(root))
            env["DICEE_MANIFEST_COMMON_DIR"] = str(self.repo / ".git")
        for name, mode in (("pre-commit", "docs"), ("pre-push", "validate-ci")):
            path = self.repo / ".git/hooks" / name
            path.write_text('#!/usr/bin/env -S ' + sys.executable + ' -I -S -B\n'
                'import os,sys\n'
                'os.execv(sys.executable,[sys.executable,"-I","-S","-B","scripts/manifest-hook.py",' + repr(mode) + '])\n')
            path.chmod(0o755)
        (root / "docs/status.md").write_text("# Fixture status\nNative hook candidate\n")
        subprocess.run([GIT, "-C", str(root), "add", "docs/status.md"], env=env, check=True, capture_output=True)
        result = subprocess.run([GIT, "-C", str(root), "commit", "--quiet", "-m", "native hook candidate"],
                                env=env, capture_output=True, text=True, timeout=65)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        records = [json.loads(line) for line in (result.stdout + "\n" + result.stderr).splitlines() if line.startswith("{")]
        context = next(item for item in records if item.get("scope") == "dicee-native-hook-context")
        self.assertIn("GIT_INDEX_FILE", context["validated_native_exports"])
        self.assertIn("GIT_EXEC_PATH", context["validated_native_exports"])
        self.assertEqual(next(item for item in records if item.get("scope") == "dicee-project-manifest-1")["exit_code"], 0)
        remote = self.repo / "fixture-remote.git"
        subprocess.run([GIT, "init", "--bare", "--quiet", str(remote)], env=env, check=True, capture_output=True)
        result = subprocess.run([GIT, "-C", str(root), "push", str(remote), "HEAD:refs/heads/fixture"],
                                env=env, capture_output=True, text=True, timeout=65)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        records = [json.loads(line) for line in (result.stdout + "\n" + result.stderr).splitlines() if line.startswith("{")]
        context = next(item for item in records if item.get("scope") == "dicee-native-hook-context")
        self.assertIn("GIT_EXEC_PATH", context["validated_native_exports"])
        self.assertEqual(next(item for item in records if item.get("scope") == "dicee-project-manifest-1")["exit_code"], 0)

    def test_hook_launcher_preserves_incoming_runtime_path(self):
        self.prepare_native_hooks()
        tools = tempfile.TemporaryDirectory(prefix="dicee-native-git-prefix-")
        self.addCleanup(tools.cleanup)
        prefix = Path(tools.name).resolve()
        selected = prefix / "git"
        shutil.copyfile(GIT, selected)
        selected.chmod(0o755)
        marker = prefix / "runtime-trap-fired"
        for name in ("node", "pnpm"):
            trap = prefix / name
            trap.write_text('#!/bin/sh\n: > "$DICEE_GIT_COLLISION_MARKER"\nexit 97\n')
            trap.chmod(0o755)
        native_exec = subprocess.check_output([str(selected), "--exec-path"], cwd="/",
            env={"PATH": self.env["PATH"], "LC_ALL": "C"}, text=True).strip()
        linked = self.repo / "collision-linked"
        self.git("worktree", "add", "--quiet", "-b", "collision-linked", str(linked))
        for kind, root, gitdir in (("ordinary", self.repo, self.repo / ".git"),
                                  ("linked", linked, self.repo / ".git/worktrees/collision-linked")):
            env = {**self.env, "DICEE_MANIFEST_GIT": str(selected),
                   "DICEE_GIT_COLLISION_MARKER": str(marker), "GIT_DIR": str(gitdir),
                   "GIT_INDEX_FILE": str(gitdir / "index"), "GIT_EXEC_PATH": native_exec}
            if kind == "linked":
                env["DICEE_MANIFEST_COMMON_DIR"] = str(self.repo / ".git")
            for mode in ("docs", "validate-ci"):
                with self.subTest(kind=kind, mode=mode):
                    result = subprocess.run([sys.executable, "-I", "-S", "-B", str(root / "scripts/manifest-hook.py"), mode],
                        cwd=root, env=env, capture_output=True, text=True, timeout=65)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    records = [json.loads(line) for line in (result.stdout + "\n" + result.stderr).splitlines() if line.startswith("{")]
                    checked = next(item for item in records if item.get("scope") == "dicee-project-manifest-1")
                    self.assertEqual(checked["exit_code"], 0)
                    self.assertFalse(marker.exists(), "Git's sibling node/pnpm overrode incoming runtime PATH")

    def test_ordinary_native_precommit_and_prepush(self):
        self.native_commit_and_push(linked=False)

    def test_linked_native_precommit_and_prepush(self):
        self.native_commit_and_push(linked=True)

    def test_runtime_import_uses_only_captured_authenticated_bytes(self):
        spec = importlib.util.spec_from_file_location("dicee_adapter_fixture", self.adapter)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        loader, _ = module.captured_release()
        path = self.repo / "vendor/project-manifest/release-1/src/project_manifest/acquire.py"
        path.write_text('raise RuntimeError("MUTABLE_PATH_EXECUTED")\n')
        sys.meta_path.insert(0, loader)
        try:
            api = __import__(module.PREFIX + ".acquire", fromlist=["observe_released_repository"])
            self.assertTrue(callable(api.observe_released_repository))
        finally:
            sys.meta_path.remove(loader)
            for name in tuple(sys.modules):
                if name == module.PREFIX or name.startswith(module.PREFIX + "."):
                    del sys.modules[name]


if __name__ == "__main__":
    unittest.main(verbosity=2)
