"""Candidate acquisition behavior using freshly owned, public-safe Git graphs."""

import contextlib
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import signal
import stat
import sys
import subprocess
import unittest
from unittest.mock import patch
import zlib

sys.path.insert(0, str(Path(__file__).absolute().parent.parent / "src"))
from project_manifest import acquire as acquisition
from project_manifest.acquire import observe_repository
from acquisition_fixtures import FileSpec, FixtureOwner, GitFixture, fixture_parent


DATA = b'''spec_version: "1"
project:
  id: sample-project
  display_name: "Synthetic example"
  owner_entity: sample-owner
role: canonical
canonical: null
peers: []
status:
  posture: working-prototype
  operational_state: maintained
  local_phase: "Synthetic phase"
  as_of: "2026-01-01"
authority:
  status_of_record: "docs/status.example"
presentation:
  visibility: internal
  public_alias: null
  link_policy: no-link
development:
  platforms: []
  commands:
    setup: null
    check:
      runner: script
      target: "tools/check.example"
    test: null
    build: null
    dev: null
    format_check: null
    format_write: null
  environment:
    owner: none
    template: null
    secret_launcher: null
  stacks: {}
  host_requirements: []
'''


def files(data=DATA):
    return {
        "project.yaml": FileSpec("100644", data),
        "docs/status.example": FileSpec("100644", b"Synthetic status\n"),
        "tools/check.example": FileSpec("100755", b"#!/bin/sh\nexit 0\n"),
    }


class AcquisitionTests(unittest.TestCase):
    def setUp(self):
        self.owner = FixtureOwner(self)

    def fixture(self, entries=None, *, bare=False, object_format="sha1"):
        return GitFixture(self.owner, bare=bare, object_format=object_format).seed(
            files() if entries is None else entries)

    def observe(self, fixture, mode="rev", *, root=None, rev="HEAD", **kwargs):
        return observe_repository(fixture.path if root is None else root, mode=mode,
                                  rev=rev if mode == "rev" else None,
                                  reference_date="2026-01-01", **kwargs)

    def accepted(self, result, mode):
        self.assertEqual(result.exit_code, 0, result.diagnostics)
        self.assertIsInstance(result.record, dict)
        self.assertTrue(result.diagnostics["candidate_declaration_accepted"])
        self.assertEqual(result.diagnostics["complete_v1_validity"], "not_checked")
        self.assertEqual(result.diagnostics["scope"], "candidate-git-observation")
        self.assertEqual(result.diagnostics["mode"], mode)
        self.assertEqual(result.diagnostics["reference_date"], "2026-01-01")
        self.assertNotIn("record", result.diagnostics)
        return result

    def rejected(self, result, code=None, *, not_checked=False):
        self.assertEqual(result.exit_code, 2 if not_checked else 1, result.diagnostics)
        self.assertIsNone(result.record)
        self.assertFalse(result.diagnostics["candidate_declaration_accepted"])
        self.assertEqual(result.diagnostics["complete_v1_validity"], "not_checked")
        if code is not None:
            self.assertEqual(result.diagnostics["findings"][0]["code"], code)
        return result

    def test_valid_rev_staged_and_worktree_have_actual_mode_provenance(self):
        fixture = self.fixture()
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                result = self.accepted(self.observe(fixture, mode), mode)
                self.assertEqual(result.diagnostics["manifest_sha256"], hashlib.sha256(DATA).hexdigest())
                self.assertRegex(result.diagnostics["observation_digest"], r"^[a-f0-9]{64}$")
                if mode == "rev":
                    self.assertEqual(result.diagnostics["commit_oid"], fixture.head)
                    self.assertEqual(result.diagnostics["tree_oid"], fixture.tree)
                    self.assertEqual(result.diagnostics["manifest_blob_oid"], fixture.blobs["project.yaml"])
                elif mode == "staged":
                    self.assertIsNone(result.diagnostics["commit_oid"])
                    self.assertIsNone(result.diagnostics["tree_oid"])
                    self.assertEqual(result.diagnostics["manifest_blob_oid"], fixture.blobs["project.yaml"])
                else:
                    self.assertIsNone(result.diagnostics["commit_oid"])
                    self.assertIsNone(result.diagnostics["tree_oid"])
                    self.assertIsNone(result.diagnostics["manifest_blob_oid"])

    def test_sha256_repository_has_qualified_object_ids_and_valid_observations(self):
        fixture = self.fixture(object_format="sha256")
        self.assertEqual(len(fixture.head), 64)
        expected = hashlib.sha256(b"blob " + str(len(DATA)).encode() + b"\0" + DATA).hexdigest()
        self.assertEqual(fixture.blobs["project.yaml"], expected)
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                result = self.accepted(self.observe(fixture, mode), mode)
                self.assertEqual(result.record["project"]["id"], "sample-project")
                self.assertIsNotNone(result.tree)
                self.assertEqual(result.diagnostics["manifest_sha256"], hashlib.sha256(DATA).hexdigest())
                if mode == "rev":
                    self.assertEqual(result.diagnostics["commit_oid"], fixture.head)
                    self.assertEqual(result.diagnostics["tree_oid"], fixture.tree)
                if mode != "worktree":
                    self.assertEqual(result.diagnostics["manifest_blob_oid"], expected)

    def test_pack_only_revision_and_index_read_descriptor_bound_pack_files(self):
        for object_format in ("sha1", "sha256"):
            with self.subTest(object_format=object_format):
                fixture = self.fixture(object_format=object_format)
                staged_data = DATA.replace(b"Synthetic example", b"Synthetic packed index")
                fixture.set_index(files(staged_data))
                before = {mode: self.accepted(self.observe(fixture, mode), mode)
                          for mode in ("rev", "staged")}
                self.assertEqual(before["rev"].record["project"]["display_name"], "Synthetic example")
                self.assertEqual(before["staged"].record["project"]["display_name"], "Synthetic packed index")
                pack, pack_index = fixture.pack_only()
                self.assertTrue(pack.is_file())
                self.assertTrue(pack_index.is_file())
                for oid in fixture.owned_loose_objects:
                    self.assertFalse((fixture.git_dir / "objects" / oid[:2] / oid[2:]).exists())
                original = acquisition.bounded_process
                pack_reads = []
                def inspected(argv, **kwargs):
                    pack_identity = {(path.stat().st_dev, path.stat().st_ino)
                                     for path in (pack, pack_index)}
                    fds = kwargs["pass_fds"]
                    self.assertEqual({(os.fstat(fd).st_dev, os.fstat(fd).st_ino) for fd in fds},
                                     pack_identity)
                    mirror = Path(next(arg.split("=", 1)[1] for arg in argv if arg.startswith("--git-dir=")))
                    for source in (pack, pack_index):
                        projected = mirror / "objects/pack" / source.name
                        self.assertTrue(projected.is_symlink())
                        self.assertIn(int(os.readlink(projected).removeprefix("/dev/fd/")), fds)
                    pack_reads.append(argv)
                    return original(argv, **kwargs)
                with patch.object(acquisition, "bounded_process", side_effect=inspected):
                    for mode in ("rev", "staged"):
                        with self.subTest(mode=mode):
                            after = self.accepted(self.observe(fixture, mode), mode)
                            self.assertEqual(after.record, before[mode].record)
                            self.assertEqual(after.tree, before[mode].tree)
                            self.assertEqual(after.diagnostics["manifest_blob_oid"],
                                             before[mode].diagnostics["manifest_blob_oid"])
                            self.assertEqual(after.diagnostics["observation_digest"],
                                             before[mode].diagnostics["observation_digest"])
                self.assertTrue(pack_reads)

    def test_many_loose_objects_do_not_consume_one_descriptor_per_object(self):
        fixture = self.fixture()
        for number in range(160):
            fixture.blob(("Synthetic unreferenced object " + str(number) + "\n").encode())
        self.assertGreater(len(fixture.owned_loose_objects), 128)
        original = acquisition.bounded_process
        calls = []
        def inspected(argv, **kwargs):
            calls.append(argv)
            self.assertEqual(kwargs["pass_fds"], ())
            mirror = Path(next(arg.split("=", 1)[1] for arg in argv if arg.startswith("--git-dir=")))
            for oid in fixture.owned_loose_objects:
                copied = mirror / "objects" / oid[:2] / oid[2:]
                self.assertTrue(copied.is_file())
                self.assertFalse(copied.is_symlink())
            return original(argv, **kwargs)
        with patch.object(acquisition, "bounded_process", side_effect=inspected):
            for mode in ("rev", "staged", "worktree"):
                with self.subTest(mode=mode):
                    result = self.accepted(self.observe(fixture, mode), mode)
                    self.assertIsNotNone(result.tree)
        self.assertTrue(calls)

    def test_file_obstructing_virtual_directory_is_never_read(self):
        fixture = self.fixture()
        (fixture.path / "docs/status.example").unlink()
        (fixture.path / "docs").rmdir()
        obstruction = fixture.path / "docs"
        obstruction.write_bytes(b"synthetic-untracked-prefix-marker")
        identity = obstruction.stat().st_dev, obstruction.stat().st_ino
        original = acquisition._read_fd
        def guarded(fd, *args, **kwargs):
            info = os.fstat(fd)
            if (info.st_dev, info.st_ino) == identity:
                raise AssertionError("Untracked directory-prefix bytes were consumed")
            return original(fd, *args, **kwargs)
        with patch.object(acquisition, "_read_fd", side_effect=guarded):
            result = self.rejected(self.observe(fixture, "worktree"), "REFERENCE_PATH")
        self.assertNotIn("synthetic-untracked-prefix-marker", json.dumps(result.diagnostics))

    def test_unqualified_index_storage_is_refused_without_blocking_revision(self):
        for variant in ("version4", "split", "skip"):
            with self.subTest(variant=variant):
                fixture = self.fixture()
                if variant == "version4":
                    fixture._run(["update-index", "--index-version=4"])
                elif variant == "split":
                    fixture._run(["update-index", "--split-index"])
                else:
                    fixture._run(["update-index", "--skip-worktree", "--", "docs/status.example"])
                self.accepted(self.observe(fixture), "rev")
                for mode in ("staged", "worktree"):
                    with self.subTest(mode=mode):
                        self.rejected(self.observe(fixture, mode), "NOT_CHECKED", not_checked=True)

    def test_source_selection_distinguishes_object_index_and_working_bytes(self):
        fixture = self.fixture()
        index_data = DATA.replace(b"Synthetic example", b"Synthetic index")
        working_data = DATA.replace(b"Synthetic example", b"Synthetic working")
        fixture.set_index(files(index_data))
        (fixture.path / "project.yaml").write_bytes(working_data)
        for mode, name, data in (("rev", "Synthetic example", DATA),
                                 ("staged", "Synthetic index", index_data),
                                 ("worktree", "Synthetic working", working_data)):
            with self.subTest(mode=mode):
                result = self.accepted(self.observe(fixture, mode), mode)
                self.assertEqual(result.record["project"]["display_name"], name)
                self.assertEqual(result.diagnostics["manifest_sha256"], hashlib.sha256(data).hexdigest())

    def test_replay_is_stable_and_changed_working_bytes_change_digest(self):
        fixture = self.fixture()
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                self.assertEqual(self.observe(fixture, mode), self.observe(fixture, mode))
        first = self.accepted(self.observe(fixture, "worktree"), "worktree")
        (fixture.path / "docs/status.example").write_bytes(b"Synthetic changed status\n")
        second = self.accepted(self.observe(fixture, "worktree"), "worktree")
        self.assertNotEqual(first.diagnostics["observation_digest"], second.diagnostics["observation_digest"])
        self.assertEqual(first.diagnostics["manifest_sha256"], second.diagnostics["manifest_sha256"])

    def test_untracked_files_and_global_excludes_do_not_join_observation(self):
        fixture = self.fixture()
        before = self.accepted(self.observe(fixture, "worktree"), "worktree")
        (fixture.path / "synthetic-untracked-marker").write_bytes(b"Untracked synthetic bytes\n")
        config_home = fixture.root / "synthetic-xdg"
        (config_home / "git").mkdir(parents=True)
        excludes = fixture.root / "synthetic-global-ignore"
        excludes.write_text("project.yaml\ndocs/**\ntools/**\n")
        (config_home / "git/config").write_text("[core]\nexcludesFile = " + str(excludes) + "\n")
        home_before = os.environ.get("HOME")
        with patch.dict(os.environ, {"XDG_CONFIG_HOME": str(config_home)}):
            after = self.accepted(self.observe(fixture, "worktree"), "worktree")
        self.assertEqual(os.environ.get("HOME"), home_before)
        self.assertEqual(before.diagnostics["observation_digest"], after.diagnostics["observation_digest"])

    def test_missing_wrong_case_nonexecutable_symlink_and_gitlink_references(self):
        changes = (
            ("missing", "REFERENCE_MISSING"), ("wrong-case", "REFERENCE_MISSING"),
            ("nonexecutable", "REFERENCE_MODE"), ("symlink", "REFERENCE_PATH"),
            ("gitlink", "REFERENCE_PATH"),
        )
        for kind, code in changes:
            for mode in ("rev", "staged", "worktree"):
                with self.subTest(kind=kind, mode=mode):
                    entries = files()
                    if kind == "missing":
                        entries.pop("docs/status.example")
                    elif kind == "wrong-case":
                        entries["docs/Status.example"] = entries.pop("docs/status.example")
                    elif kind == "nonexecutable":
                        entries["tools/check.example"] = FileSpec("100644", b"Synthetic script\n")
                    elif kind == "symlink":
                        entries["tools/check.example"] = FileSpec("120000", b"../synthetic-target")
                    else:
                        fixture = self.fixture()
                        entries["tools/check.example"] = FileSpec("160000", oid=fixture.head)
                        fixture.commit_files(entries)
                        fixture.set_index(entries)
                        (fixture.path / "tools/check.example").unlink()
                        (fixture.path / "tools/check.example").mkdir()
                        self.rejected(self.observe(fixture, mode), code)
                        continue
                    fixture = self.fixture(entries)
                    self.rejected(self.observe(fixture, mode), code)

    def test_working_mode_is_measured_instead_of_taken_from_index(self):
        fixture = self.fixture()
        (fixture.path / "tools/check.example").chmod(0o644)
        self.accepted(self.observe(fixture, "staged"), "staged")
        self.rejected(self.observe(fixture, "worktree"), "REFERENCE_MODE")

    def test_case_only_working_rename_is_missing_even_on_case_insensitive_host(self):
        fixture = self.fixture()
        status = fixture.path / "docs/status.example"
        status.rename(status.with_name("Status.example"))
        self.assertIn("Status.example", os.listdir(fixture.path / "docs"))
        self.rejected(self.observe(fixture, "worktree"), "REFERENCE_MISSING")

    def test_missing_or_nonregular_manifest_is_rejected_without_following(self):
        entries = files()
        entries.pop("project.yaml")
        fixture = self.fixture(entries)
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                self.rejected(self.observe(fixture, mode), "KEY_REQUIRED")
        entries = files()
        entries["project.yaml"] = FileSpec("120000", b"synthetic-target")
        fixture = self.fixture(entries)
        (fixture.path / "synthetic-target").write_bytes(DATA)
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                self.rejected(self.observe(fixture, mode))

    def test_bare_root_supports_rev_and_refuses_index_or_worktree(self):
        fixture = self.fixture(bare=True)
        self.accepted(self.observe(fixture), "rev")
        for mode in ("staged", "worktree"):
            with self.subTest(mode=mode):
                self.rejected(self.observe(fixture, mode), "NOT_CHECKED", not_checked=True)

    def test_linked_worktree_requires_explicit_common_storage(self):
        fixture = self.fixture()
        linked, _ = fixture.linked()
        self.rejected(self.observe(fixture, root=linked), "NOT_CHECKED", not_checked=True)
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                self.accepted(self.observe(fixture, mode, root=linked, common_dir=fixture.git_dir), mode)

    def test_local_external_conditional_and_worktree_includes_are_refused_before_git(self):
        for section in ("include", 'includeIf "gitdir:synthetic/"'):
            for external in (False, True):
                with self.subTest(section=section, external=external):
                    fixture = self.fixture()
                    target = fixture.root / "synthetic-external-config" if external else fixture.git_dir / "synthetic-local-config"
                    target.write_text("[core]\nsynthetic = synthetic-include-marker\n")
                    fixture.append_config("[" + section + "]\npath = " + str(target) + "\n")
                    with patch.object(acquisition, "bounded_process", side_effect=AssertionError("Git ran before include guard")):
                        self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        fixture = self.fixture()
        linked, admin = fixture.linked()
        fixture.append_config("[extensions]\nworktreeConfig = true\n")
        target = fixture.root / "synthetic-worktree-include"
        target.write_text("[core]\nsynthetic = synthetic-worktree-marker\n")
        (admin / "config.worktree").write_text("[include]\npath = " + str(target) + "\n")
        with patch.object(acquisition, "bounded_process", side_effect=AssertionError("Git ran before worktree include guard")):
            self.rejected(self.observe(fixture, root=linked, common_dir=fixture.git_dir), "NOT_CHECKED", not_checked=True)

    def test_include_target_is_not_opened(self):
        fixture = self.fixture()
        target = fixture.root / "synthetic-never-open-config"
        target.write_bytes(b"synthetic-private-value-marker\n")
        fixture.append_config('[include]\npath = "' + str(target) + '"\n')
        real_open = os.open
        def guarded_open(path, *args, **kwargs):
            if os.fspath(path) in {str(target), target.name}:
                raise AssertionError("Adapter opened an include target")
            return real_open(path, *args, **kwargs)
        with patch.object(acquisition.os, "open", side_effect=guarded_open):
            result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        self.assertNotIn("synthetic-private-value-marker", json.dumps(result.diagnostics))

    def test_layout_redirects_are_refused_before_git(self):
        fixture = self.fixture()
        target = fixture.root / "synthetic-outside-worktree"
        fixture.append_config('[core]\nworktree = "' + str(target) + '"\n')
        with patch.object(acquisition, "bounded_process", side_effect=AssertionError("Git ran before redirect guard")):
            self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        fixture = self.fixture()
        linked, admin = fixture.linked()
        (admin / "commondir").write_text(str(fixture.root / "synthetic-outside-common") + "\n")
        with patch.object(acquisition, "bounded_process", side_effect=AssertionError("Git ran before common-dir guard")):
            self.rejected(self.observe(fixture, root=linked, common_dir=fixture.git_dir), "NOT_CHECKED", not_checked=True)

    def test_hooks_fsmonitor_filters_textconv_aliases_and_credentials_never_execute(self):
        entries = files()
        entries[".gitattributes"] = FileSpec("100644", b"* filter=synthetic diff=synthetic\n")
        fixture = self.fixture(entries)
        marker, command = fixture.sentinel()
        hooks = fixture.root / "synthetic-hooks"
        hooks.mkdir()
        for hook in ("post-checkout", "pre-commit", "post-index-change", "reference-transaction"):
            (hooks / hook).symlink_to(command)
        fixture.append_config('[core]\nhooksPath = "' + str(hooks) + '"\nfsmonitor = "' + str(command)
            + '"\n[filter "synthetic"]\nclean = "' + str(command) + '"\nsmudge = "' + str(command)
            + '"\nrequired = true\n[diff "synthetic"]\ntextconv = "' + str(command)
            + '"\ncommand = "' + str(command) + '"\n[alias]\nstatus = !' + str(command)
            + '\n[credential]\nhelper = !' + str(command) + '\n')
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                self.accepted(self.observe(fixture, mode), mode)
                self.assertFalse(marker.exists(), "Synthetic execution sentinel was invoked")

    def test_git_child_has_sanitized_config_and_descriptor_bound_objects(self):
        fixture = self.fixture()
        fixture.append_config("[alias]\nsynthetic = synthetic-raw-config-marker\n")
        original = acquisition.bounded_process
        calls = []
        home = os.environ.get("HOME")
        def inspected(argv, **kwargs):
            calls.append(argv)
            self.assertEqual(kwargs["env"].get("HOME"), home)
            self.assertEqual(kwargs["env"]["GIT_CONFIG_GLOBAL"], os.devnull)
            self.assertEqual(kwargs["env"]["GIT_CONFIG_NOSYSTEM"], "1")
            self.assertEqual(kwargs["env"]["GIT_NO_LAZY_FETCH"], "1")
            self.assertEqual(kwargs["env"]["GIT_NO_REPLACE_OBJECTS"], "1")
            self.assertIn("--no-lazy-fetch", argv)
            self.assertIn("--no-replace-objects", argv)
            mirror = Path(next(arg.split("=", 1)[1] for arg in argv if arg.startswith("--git-dir=")))
            self.assertNotIn("synthetic-raw-config-marker", (mirror / "config").read_text())
            bound = set(kwargs["pass_fds"])
            for fd in bound:
                self.assertTrue(stat.S_ISREG(os.fstat(fd).st_mode))
                self.assertEqual(fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE, os.O_RDONLY)
            for path in (mirror / "objects").rglob("*"):
                if path.is_symlink():
                    self.assertIn(int(os.readlink(path).removeprefix("/dev/fd/")), bound)
                elif path.is_file():
                    relative = path.relative_to(mirror)
                    self.assertEqual(path.read_bytes(), (fixture.git_dir / relative).read_bytes())
                else:
                    self.assertTrue(path.is_dir())
            return original(argv, **kwargs)
        with patch.object(acquisition, "bounded_process", side_effect=inspected):
            self.accepted(self.observe(fixture), "rev")
        self.assertGreater(len(calls), 1)

    def test_replacement_refs_do_not_change_requested_commit(self):
        fixture = self.fixture()
        requested = fixture.head
        replacement = fixture.commit_files(files(DATA.replace(b"Synthetic example", b"Synthetic replacement")), update_head=False)
        fixture._run(["update-ref", "refs/replace/" + requested, replacement])
        result = self.accepted(self.observe(fixture, rev=requested), "rev")
        self.assertEqual(result.record["project"]["display_name"], "Synthetic example")
        self.assertEqual(result.diagnostics["commit_oid"], requested)

    def test_missing_promisor_object_does_not_trigger_lazy_fetch(self):
        fixture = self.fixture()
        missing = fixture.blobs["docs/status.example"]
        (fixture.git_dir / "objects" / missing[:2] / missing[2:]).unlink()
        marker, command = fixture.sentinel()
        helper = fixture.root / "git-remote-synthetic"
        helper.symlink_to(command)
        fixture.append_config('[extensions]\npartialClone = origin\n[remote "origin"]\n'
                              'promisor = true\npartialCloneFilter = blob:none\n'
                              'url = synthetic::synthetic-remote-marker\n')
        with patch.dict(os.environ, {"PATH": str(fixture.root) + os.pathsep + os.environ.get("PATH", "")}):
            self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        self.assertFalse(marker.exists(), "Synthetic remote helper was invoked")

    def test_object_alternates_are_refused_before_git(self):
        for name in ("alternates", "http-alternates"):
            with self.subTest(name=name):
                fixture = self.fixture()
                target = fixture.root / "synthetic-alternate-object-store"
                target.mkdir()
                info = fixture.git_dir / "objects/info"
                info.mkdir(exist_ok=True)
                (info / name).write_text(str(target) + "\n")
                with patch.object(acquisition, "bounded_process", side_effect=AssertionError("Git ran before alternates guard")):
                    self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)

    def test_unmerged_and_intent_to_add_index_are_not_checked(self):
        for kind in ("unmerged", "intent"):
            with self.subTest(kind=kind):
                fixture = self.fixture()
                if kind == "unmerged":
                    fixture.unmerged_index("docs/status.example")
                else:
                    fixture.intent_index("synthetic-pending")
                for mode in ("staged", "worktree"):
                    with self.subTest(mode=mode):
                        self.rejected(self.observe(fixture, mode), "NOT_CHECKED", not_checked=True)

    def test_source_config_index_and_ref_mutations_are_not_checked(self):
        for kind in ("config", "index", "ref"):
            with self.subTest(kind=kind):
                fixture = self.fixture()
                original = acquisition.GitView.run
                mutated = False
                def mutate(view, args, *call_args, **kwargs):
                    nonlocal mutated
                    output = original(view, args, *call_args, **kwargs)
                    if not mutated and args[0] in {"ls-tree", "ls-files"}:
                        mutated = True
                        if kind == "config":
                            fixture.append_config("# synthetic-source-mutation\n")
                        elif kind == "index":
                            with (fixture.git_dir / "index").open("ab") as stream:
                                stream.write(b"synthetic-index-mutation")
                        else:
                            (fixture.git_dir / "refs/heads/synthetic").write_text("0" * len(fixture.head) + "\n")
                    return output
                mode = "staged" if kind == "index" else "rev"
                with patch.object(acquisition.GitView, "run", new=mutate):
                    self.rejected(self.observe(fixture, mode), "NOT_CHECKED", not_checked=True)
                self.assertTrue(mutated)

    def test_working_byte_and_mode_mutations_are_not_checked(self):
        for kind in ("bytes", "mode"):
            with self.subTest(kind=kind):
                fixture = self.fixture()
                original = acquisition._working
                calls = 0
                def mutate(*args, **kwargs):
                    nonlocal calls
                    output = original(*args, **kwargs)
                    calls += 1
                    if calls == 1:
                        if kind == "bytes":
                            (fixture.path / "project.yaml").write_bytes(DATA.replace(b"Synthetic example", b"Synthetic mutation"))
                        else:
                            (fixture.path / "tools/check.example").chmod(0o644)
                    return output
                with patch.object(acquisition, "_working", side_effect=mutate):
                    self.rejected(self.observe(fixture, "worktree"), "NOT_CHECKED", not_checked=True)
                self.assertGreaterEqual(calls, 2)

    def test_added_ref_or_object_during_observation_is_not_checked(self):
        for kind in ("ref", "object"):
            with self.subTest(kind=kind):
                fixture = self.fixture()
                original = acquisition.GitView.run
                mutated = False
                def mutate(view, args, *call_args, **kwargs):
                    nonlocal mutated
                    output = original(view, args, *call_args, **kwargs)
                    if not mutated and args[0] == "ls-tree":
                        mutated = True
                        if kind == "ref":
                            (fixture.git_dir / "refs/heads/synthetic-added").write_text(fixture.head + "\n")
                        else:
                            payload = b"blob 23\0Synthetic added object\n"
                            oid = hashlib.sha1(payload).hexdigest()
                            directory = fixture.git_dir / "objects" / oid[:2]
                            directory.mkdir(exist_ok=True)
                            (directory / oid[2:]).write_bytes(zlib.compress(payload))
                    return output
                with patch.object(acquisition.GitView, "run", new=mutate):
                    self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertTrue(mutated)

    def test_replaced_object_path_does_not_redirect_descriptor_bound_read(self):
        fixture = self.fixture()
        oid = fixture.blobs["project.yaml"]
        object_path = fixture.git_dir / "objects" / oid[:2] / oid[2:]
        target = fixture.root / "synthetic-never-open-object"
        target.write_bytes(b"synthetic-object-redirect-marker")
        original = acquisition.GitView.run
        real_open = os.open
        replaced = False
        def mutate(view, args, *call_args, **kwargs):
            nonlocal replaced
            if not replaced and args[0] == "ls-tree":
                replaced = True
                object_path.unlink()
                object_path.symlink_to(target)
            return original(view, args, *call_args, **kwargs)
        def guarded_open(path, *args, **kwargs):
            if os.fspath(path) in {str(target), target.name}:
                raise AssertionError("Adapter opened redirected object target")
            return real_open(path, *args, **kwargs)
        with patch.object(acquisition.GitView, "run", new=mutate):
            with patch.object(acquisition.os, "open", side_effect=guarded_open):
                result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        self.assertTrue(replaced)
        self.assertNotIn("synthetic-object-redirect-marker", json.dumps(result.diagnostics))

    def test_child_deadline_kills_only_the_owned_child_and_returns_not_checked(self):
        fixture = self.fixture()
        shim = fixture.root / "synthetic-git-timeout"
        shim.write_text("#!/bin/sh\nexec /bin/sleep 30\n")
        shim.chmod(0o755)
        real_popen = acquisition.subprocess.Popen
        real_killpg = acquisition.os.killpg
        children, group_signals = [], []
        def captured_popen(*args, **kwargs):
            child = real_popen(*args, **kwargs)
            children.append((child, kwargs.get("start_new_session")))
            return child
        def captured_killpg(group, sent_signal):
            group_signals.append((group, sent_signal))
            return real_killpg(group, sent_signal)
        # Capture only observation children, after all fixture plumbing finished.
        with patch.object(acquisition.shutil, "which", return_value=str(shim)):
            with patch.object(acquisition.subprocess, "Popen", side_effect=captured_popen):
                with patch.object(acquisition.os, "killpg", side_effect=captured_killpg):
                    with patch.object(acquisition, "CALL_SECONDS", 0.5):
                        result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        self.assertEqual(result.diagnostics["acquisition_reason"], "child_timeout")
        self.assertEqual(len(children), 1)
        child, own_session = children[0]
        self.assertIs(own_session, True)
        self.assertEqual(group_signals, [(child.pid, signal.SIGKILL)])
        self.assertEqual(child.returncode, -signal.SIGKILL)
        with self.assertRaises(ChildProcessError):
            os.waitpid(child.pid, os.WNOHANG)
        with self.assertRaises(ProcessLookupError):
            os.kill(child.pid, 0)
        with self.assertRaises(ProcessLookupError):
            os.killpg(child.pid, 0)

    def test_child_output_bound_discards_raw_stdout_and_stderr(self):
        fixture = self.fixture()
        shim = fixture.root / "synthetic-git-output"
        marker = "synthetic-child-output-marker"
        shim.write_text("#!/bin/sh\nwhile :; do printf " + shlex.quote(marker)
                        + "; printf " + shlex.quote(marker) + " >&2; done\n")
        shim.chmod(0o755)
        original = acquisition.bounded_process
        def short_bound(argv, **kwargs):
            kwargs["limit"] = 2048
            kwargs["seconds"] = min(kwargs["seconds"], 1.0)
            return original(argv, **kwargs)
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with patch.object(acquisition.shutil, "which", return_value=str(shim)):
                with patch.object(acquisition, "bounded_process", side_effect=short_bound):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        self.assertEqual(result.diagnostics["acquisition_reason"], "child_output_bound")
        self.assertNotIn(marker, json.dumps(result.diagnostics))
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")

    def test_public_bounds_fail_closed(self):
        limits = (("MAX_METADATA", 1, "rev"), ("MAX_INDEX", 1, "staged"),
                  ("MAX_METADATA_TOTAL", 1, "rev"), ("MAX_DIRECTORY_NAMES", 1, "rev"),
                  ("MAX_OBJECT_STORAGE", 1, "rev"), ("MAX_OBJECT_FDS", 1, "rev"),
                  ("MAX_WORKING_FILE", 1, "worktree"), ("MAX_WORKING_BYTES", 1, "worktree"),
                  ("MAX_ENTRIES", 1, "rev"), ("MAX_PATH_BYTES", 8, "rev"),
                  ("MAX_PATH_DEPTH", 1, "rev"))
        fixture = self.fixture()
        packed_fixture = self.fixture()
        packed_fixture.pack_only()
        for name, limit, mode in limits + (("MAX_LOOSE_OBJECTS", 1, "rev"),
                                          ("MAX_LOOSE_FILE", 1, "rev"),
                                          ("MAX_LOOSE_BYTES", 1, "rev")):
            with self.subTest(bound=name):
                selected = packed_fixture if name == "MAX_OBJECT_FDS" else fixture
                with patch.object(acquisition, name, limit):
                    self.rejected(self.observe(selected, mode), "NOT_CHECKED", not_checked=True)

    def test_deep_repository_paths_are_not_checked(self):
        entries = files()
        entries["/".join(["synthetic"] * 17)] = FileSpec("100644", b"Synthetic depth\n")
        fixture = self.fixture(entries)
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                self.rejected(self.observe(fixture, mode), "NOT_CHECKED", not_checked=True)

    def test_unsupported_git_is_not_checked(self):
        fixture = self.fixture()
        with patch.object(acquisition, "bounded_process", return_value=(0, b"git version 2.55.9\n", b"")):
            self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)

    def test_supported_config_booleans_with_comments_match_git(self):
        variants = ("true # comment", "yes ; comment", '"on" # comment', "1", None)
        for raw in variants:
            with self.subTest(raw=raw):
                fixture = self.fixture(bare=True)
                fixture.append_config("[core]\nbare" + ("\n" if raw is None else " = " + raw + "\n"))
                self.assertEqual(fixture._run(["config", "--bool", "--get", "core.bare"]).strip(), b"true")
                self.accepted(self.observe(fixture), "rev")
        for raw in ("false # comment", "no ; comment", '"off" # comment', "0", ""):
            with self.subTest(raw=raw):
                fixture = self.fixture()
                fixture.append_config("[core]\nbare = " + raw + "\n")
                self.assertEqual(fixture._run(["config", "--bool", "--get", "core.bare"]).strip(), b"false")
                self.accepted(self.observe(fixture), "rev")

    def test_worktree_boolean_comments_cannot_skip_include_guard(self):
        for raw in ("true # comment", '"yes" ; comment', "on", "1"):
            with self.subTest(raw=raw):
                fixture = self.fixture()
                fixture.append_config("[core]\nrepositoryformatversion = 1\n[extensions]\nworktreeConfig = " + raw + "\n")
                self.assertEqual(fixture._run(["config", "--no-includes", "--file", str(fixture.git_dir / "config"),
                                              "--bool", "--get", "extensions.worktreeConfig"]).strip(), b"true")
                outside = fixture.root / "synthetic-comment-include-target"
                outside.write_text("[core]\nsynthetic = synthetic-comment-marker\n")
                (fixture.git_dir / "config.worktree").write_text("[include]\npath = " + str(outside) + "\n")
                with patch.object(acquisition, "bounded_process",
                                  side_effect=AssertionError("Git ran before worktree include guard")):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "outside_include")

    def test_unknown_or_ambiguous_config_booleans_are_not_defaulted_false(self):
        for key in ("bare", "worktreeConfig"):
            for raw in ("synthetic-ambiguous-marker", '"true # quoted marker"', '"true" trailing', '"true "'):
                with self.subTest(key=key, raw=raw):
                    fixture = self.fixture()
                    section = "core" if key == "bare" else "extensions"
                    fixture.append_config("[" + section + "]\n" + key + " = " + raw + "\n")
                    with patch.object(acquisition, "bounded_process",
                                      side_effect=AssertionError("Git ran before invalid boolean guard")):
                        result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                    self.assertNotIn("synthetic-ambiguous-marker", json.dumps(result.diagnostics))

    def test_quoted_and_dotted_core_subsections_cannot_mask_top_level_bare(self):
        for section in ('core "synthetic-subsection"', "core.synthetic-subsection"):
            with self.subTest(section=section):
                fixture = self.fixture()
                fixture.append_config("[core]\nbare = true\n[" + section + "]\nbare = false\n")
                self.assertEqual(fixture._run(["config", "--bool", "--get", "core.bare"]).strip(), b"true")
                with patch.object(acquisition, "bounded_process",
                                  side_effect=AssertionError("Git ran before storage namespace guard")):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_storage_subsection")

    def test_quoted_and_dotted_extensions_cannot_mask_worktree_include_guard(self):
        for section in ('extensions "synthetic-subsection"', "extensions.synthetic-subsection"):
            with self.subTest(section=section):
                fixture = self.fixture()
                fixture.append_config("[core]\nrepositoryformatversion = 1\n"
                    "[extensions]\nworktreeConfig = true\n[" + section + "]\nworktreeConfig = false\n")
                self.assertEqual(fixture._run(["config", "--no-includes", "--file", str(fixture.git_dir / "config"),
                                              "--bool", "--get", "extensions.worktreeConfig"]).strip(), b"true")
                target = fixture.root / "synthetic-subsection-include-target"
                target.write_text("[core]\nsynthetic = synthetic-subsection-marker\n")
                (fixture.git_dir / "config.worktree").write_text("[include]\npath = " + str(target) + "\n")
                real_open = os.open
                def guarded(path, *args, **kwargs):
                    if os.fspath(path) in {str(target), target.name}:
                        raise AssertionError("External include target was opened")
                    return real_open(path, *args, **kwargs)
                with patch.object(acquisition.os, "open", side_effect=guarded):
                    with patch.object(acquisition, "bounded_process",
                                      side_effect=AssertionError("Git ran before storage namespace guard")):
                        result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_storage_subsection")
                self.assertNotIn("synthetic-subsection-marker", json.dumps(result.diagnostics))

    def test_all_storage_keys_refuse_subsections_in_common_and_worktree_config(self):
        keys = (("core", "bare", "false"), ("core", "repositoryformatversion", "0"),
                ("core", "worktree", "synthetic-path"),
                ("extensions", "objectformat", "sha1"),
                ("extensions", "worktreeConfig", "false"),
                ("extensions", "refstorage", "files"),
                ("extensions", "relativeworktrees", "false"))
        for location in ("common", "worktree"):
            for style in ("quoted", "dotted"):
                for base_section, key, value in keys:
                    with self.subTest(location=location, style=style, key=key):
                        fixture = self.fixture()
                        if location == "worktree":
                            fixture.append_config("[core]\nrepositoryformatversion = 1\n"
                                                  "[extensions]\nworktreeConfig = true\n")
                        section = (base_section + ' "synthetic-subsection"' if style == "quoted"
                                   else base_section + ".synthetic-subsection")
                        text = "[" + section + "]\n" + key + " = " + value + "\n"
                        if location == "common":
                            fixture.append_config(text)
                        else:
                            (fixture.git_dir / "config.worktree").write_text(text)
                        with patch.object(acquisition, "bounded_process",
                                          side_effect=AssertionError("Git ran before storage namespace guard")):
                            result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                        self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_storage_subsection")

    def test_control_and_unicode_separators_cannot_invent_storage_lines(self):
        for separator in ("\u0085", "\u2028", "\u2029", "\x0b", "\x0c", "\r"):
            with self.subTest(codepoint=ord(separator)):
                fixture = self.fixture()
                fixture.append_config("[core]\nbare=true\n# ignored " + separator
                                      + "[core]" + separator + "bare=false\n")
                native = fixture._run(["config", "--no-includes", "--file",
                                      str(fixture.git_dir / "config"), "--bool", "--get", "core.bare"])
                self.assertEqual(native.strip(), b"true")
                with patch.object(acquisition, "bounded_process",
                                  side_effect=AssertionError("Git ran before config line guard")):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_config_line_characters")

    def test_non_ascii_syntax_padding_is_refused_before_any_git(self):
        for padding in ("\u00a0", "\u2003", "\u202f"):
            for position in ("section", "key", "assignment", "scalar"):
                with self.subTest(codepoint=ord(padding), position=position):
                    fixture = self.fixture()
                    if position == "section":
                        text = padding + "[core]\nbare=false\n"
                    elif position == "key":
                        text = "[core]\n" + padding + "bare=false\n"
                    elif position == "assignment":
                        text = "[core]\nbare" + padding + "=" + padding + "false\n"
                    else:
                        text = "[core]\nbare=" + padding + "false" + padding + "\n"
                    fixture.append_config(text)
                    query = subprocess.run([fixture.executable, "config", "--no-includes", "--file",
                        str(fixture.git_dir / "config"), "--bool", "--get", "core.bare"],
                        cwd=fixture.root, env=fixture.env, capture_output=True, check=False, timeout=5)
                    self.assertEqual(query.returncode, 128)
                    with patch.object(acquisition, "bounded_process",
                                      side_effect=AssertionError("Git ran before config syntax guard")):
                        self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)

    def test_other_config_controls_are_explicitly_unsupported(self):
        for separator in ("\x00", "\x07", "\x1c", "\x1d", "\x1e", "\x7f"):
            with self.subTest(codepoint=ord(separator)):
                fixture = self.fixture()
                fixture.append_config("# ignored " + separator + "synthetic\n")
                with patch.object(acquisition, "bounded_process",
                                  side_effect=AssertionError("Git ran before config control guard")):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_config_line_characters")

    def test_supported_lf_crlf_and_unicode_comments_keep_git_meaning(self):
        for newline in ("\n", "\r\n"):
            with self.subTest(newline_length=len(newline)):
                fixture = self.fixture()
                path = fixture.git_dir / "config"
                original = path.read_text()
                text = original + "# Synthetic café\n[user]\nname = Synthetic café\n"
                path.write_bytes(text.replace("\n", newline).encode("utf-8"))
                self.assertEqual(fixture._run(["config", "--no-includes", "--file", str(path),
                                              "--bool", "--get", "core.bare"]).strip(), b"false")
                self.accepted(self.observe(fixture), "rev")

    def test_ignored_continuations_cannot_fabricate_core_storage_sections(self):
        for section in ("user", "synthetic", 'remote "synthetic"', "remote.synthetic"):
            with self.subTest(section=section):
                fixture = self.fixture()
                fixture.append_config("[core]\nbare=true\n[" + section + "]\n"
                                      "name=synthetic" + chr(92) + "\n[core]\nbare=false\n")
                query = fixture._run(["config", "--no-includes", "--file",
                                     str(fixture.git_dir / "config"), "--bool", "--get", "core.bare"])
                self.assertEqual(query.strip(), b"true")
                with patch.object(acquisition, "bounded_process",
                                  side_effect=AssertionError("Git ran before ignored-value lexical guard")):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_config_scalar")

    def test_ignored_continuation_cannot_mask_worktree_config_include(self):
        for section in ("user", 'remote "synthetic"', "remote.synthetic"):
            with self.subTest(section=section):
                fixture = self.fixture()
                fixture.append_config("[core]\nrepositoryformatversion=1\n"
                    "[extensions]\nworktreeConfig=true\n[" + section + "]\n"
                    "name=synthetic" + chr(92) + "\n[extensions]\nworktreeConfig=false\n")
                self.assertEqual(fixture._run(["config", "--no-includes", "--file",
                    str(fixture.git_dir / "config"), "--bool", "--get",
                    "extensions.worktreeConfig"]).strip(), b"true")
                target = fixture.root / "synthetic-continuation-include-target"
                target.write_text("[core]\nsynthetic = synthetic-continuation-marker\n")
                (fixture.git_dir / "config.worktree").write_text("[include]\npath=" + str(target) + "\n")
                real_open = os.open
                def guarded(path, *args, **kwargs):
                    if os.fspath(path) in {str(target), target.name}:
                        raise AssertionError("Continuation-masked include target opened")
                    return real_open(path, *args, **kwargs)
                with patch.object(acquisition.os, "open", side_effect=guarded):
                    with patch.object(acquisition, "bounded_process",
                                      side_effect=AssertionError("Git ran before ignored-value lexical guard")):
                        result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_config_scalar")

    def test_ignored_escaped_and_multiline_quoted_values_are_refused_before_git(self):
        backslash = chr(92)
        values = ("synthetic" + backslash + backslash + "tail",
                  '"synthetic' + backslash + 'nvalue"',
                  '"synthetic' + backslash + '"value"',
                  '"synthetic" "pieces"', '"synthetic"tail',
                  '"synthetic\nnext"', '"synthetic' + backslash + '\nnext"',
                  '"synthetic')
        for location in ("common", "worktree"):
            for section in ("user", 'remote "synthetic"', "remote.synthetic"):
                for value in values:
                    with self.subTest(location=location, section=section, value_length=len(value)):
                        fixture = self.fixture()
                        if location == "worktree":
                            fixture.append_config("[core]\nrepositoryformatversion=1\n"
                                                  "[extensions]\nworktreeConfig=true\n")
                        text = "[" + section + "]\nname=" + value + "\n"
                        if location == "common":
                            fixture.append_config(text)
                        else:
                            (fixture.git_dir / "config.worktree").write_text(text)
                        with patch.object(acquisition, "bounded_process",
                                          side_effect=AssertionError("Git ran before ignored-value lexical guard")):
                            result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                        self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_config_scalar")

    def test_simple_ignored_config_values_comments_and_quoted_spaces_remain_supported(self):
        fixture = self.fixture()
        fixture.append_config('[user]\nname=" Synthetic café " # comment\n'
                              '[remote "synthetic"]\nurl=synthetic-value ; comment\n'
                              'description="Synthetic # data ; kept"\n'
                              'enabled\n# A comment may contain ' + chr(92) + '\n')
        self.assertEqual(fixture._run(["config", "--no-includes", "--file",
            str(fixture.git_dir / "config"), "--get", "user.name"]).rstrip(b"\n"),
            " Synthetic café ".encode())
        self.assertEqual(fixture._run(["config", "--no-includes", "--file",
            str(fixture.git_dir / "config"), "--bool", "--get", "core.bare"]).strip(), b"false")
        self.accepted(self.observe(fixture), "rev")

    def test_unknown_extensions_are_refused_before_git_in_both_versions(self):
        for version in (0, 1):
            fixture = self.fixture()
            fixture.append_config("[core]\nrepositoryformatversion=" + str(version) +
                                  "\n[extensions]\nsyntheticUnsupported=true\n")
            query = subprocess.run([fixture.executable, "--git-dir=" + str(fixture.git_dir),
                "rev-parse", "--show-object-format"], cwd=fixture.root, env=fixture.env,
                capture_output=True, check=False, timeout=5)
            self.assertEqual(query.returncode, 0 if version == 0 else 128)
            with patch.object(acquisition, "bounded_process",
                              side_effect=AssertionError("Git ran before extension allowlist")):
                result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
            self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_repository_extension")

    def test_objectformat_requires_version_one_for_both_supported_algorithms(self):
        for algorithm in ("sha1", "sha256"):
            fixture = GitFixture(self.owner, object_format=algorithm).seed(files())
            for version in (0, 1):
                with self.subTest(algorithm=algorithm, version=version):
                    fixture.append_config("[core]\nrepositoryformatversion=" + str(version) +
                                          "\n[extensions]\nobjectFormat=" + algorithm + "\n")
                    query = subprocess.run([fixture.executable, "--git-dir=" + str(fixture.git_dir),
                        "rev-parse", "--show-object-format"], cwd=fixture.root, env=fixture.env,
                        capture_output=True, check=False, timeout=5)
                    if version == 0:
                        self.assertEqual(query.returncode, 128)
                        with patch.object(acquisition, "bounded_process",
                                          side_effect=AssertionError("Git ran before extension version guard")):
                            result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                        self.assertEqual(result.diagnostics["acquisition_reason"], "extension_repository_version")
                    else:
                        self.assertEqual(query.returncode, 0)
                        self.assertEqual(query.stdout.strip().decode(), algorithm)
                        self.accepted(self.observe(fixture), "rev")

    def test_worktree_config_true_false_behavior_is_qualified_in_both_versions(self):
        for version in (0, 1):
            for enabled in (False, True):
                with self.subTest(version=version, enabled=enabled):
                    fixture = self.fixture()
                    flag = "true" if enabled else "false"
                    fixture.append_config("[core]\nrepositoryformatversion=" + str(version) +
                                          "\n[extensions]\nworktreeConfig=" + flag + "\n")
                    local = fixture.git_dir / "config.worktree"
                    local.write_text("[core]\nsyntheticWorktreeProbe=present\n")
                    query = subprocess.run([fixture.executable, "--git-dir=" + str(fixture.git_dir),
                        "config", "--get", "core.syntheticWorktreeProbe"], cwd=fixture.root,
                        env=fixture.env, capture_output=True, check=False, timeout=5)
                    self.assertEqual(query.returncode, 0 if enabled else 1)
                    if enabled:
                        self.assertEqual(query.stdout.strip(), b"present")
                        self.accepted(self.observe(fixture), "rev")
                    else:
                        real_open = os.open
                        def guarded(path, *args, **kwargs):
                            if os.fspath(path) in {str(local), local.name}:
                                raise AssertionError("Disabled worktree config opened")
                            return real_open(path, *args, **kwargs)
                        with patch.object(acquisition.os, "open", side_effect=guarded):
                            self.accepted(self.observe(fixture), "rev")

    def test_partialclone_values_and_no_fetch_are_qualified_in_both_versions(self):
        for version in (0, 1):
            for value in ("origin", ""):
                with self.subTest(version=version, empty=value == ""):
                    fixture = self.fixture()
                    fixture.append_config("[core]\nrepositoryformatversion=" + str(version) +
                                          "\n[extensions]\npartialClone=" + value + "\n")
                    self.assertEqual(fixture._run(["rev-parse", "--show-object-format"]).strip(), b"sha1")
                    self.accepted(self.observe(fixture), "rev")
                    missing = fixture.blobs["docs/status.example"]
                    (fixture.git_dir / "objects" / missing[:2] / missing[2:]).unlink()
                    marker, command = fixture.sentinel()
                    helper = fixture.root / "git-remote-synthetic"
                    helper.symlink_to(command)
                    fixture.append_config('[remote "origin"]\npromisor=true\n'
                                          'url=synthetic::synthetic-remote-marker\n')
                    with patch.dict(os.environ, {"PATH": str(fixture.root) + os.pathsep +
                                                 os.environ.get("PATH", "")}):
                        result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                    self.assertEqual(result.diagnostics["acquisition_reason"], "object_unavailable")
                    self.assertFalse(marker.exists())

    def test_missing_partialclone_scalar_is_refused_before_git_in_both_versions(self):
        for version in (0, 1):
            with self.subTest(version=version):
                fixture = self.fixture()
                fixture.append_config("[core]\nrepositoryformatversion=" + str(version) +
                                      "\n[extensions]\npartialClone\n")
                query = subprocess.run([fixture.executable, "--git-dir=" + str(fixture.git_dir),
                    "rev-parse", "--show-object-format"], cwd=fixture.root, env=fixture.env,
                    capture_output=True, check=False, timeout=5)
                self.assertEqual(query.returncode, 128)
                with patch.object(acquisition, "bounded_process",
                                  side_effect=AssertionError("Git ran before extension scalar guard")):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "unsupported_config_scalar")

    def test_external_shallow_and_graft_environment_is_refused_before_any_git(self):
        fixture = self.fixture()
        target = fixture.root / "synthetic-external-git-metadata"
        target.write_bytes(b"synthetic-outside-metadata-marker")
        real_open = os.open
        def guarded(path, *args, **kwargs):
            if os.fspath(path) in {str(target), target.name}:
                raise AssertionError("External environment metadata was opened")
            return real_open(path, *args, **kwargs)
        for name in ("GIT_SHALLOW_FILE", "GIT_GRAFT_FILE"):
            with self.subTest(variable=name):
                with patch.dict(os.environ, {name: str(target)}):
                    with patch.object(acquisition.os, "open", side_effect=guarded):
                        with patch.object(acquisition, "bounded_process",
                                          side_effect=AssertionError("Git ran before environment guard")):
                            result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertEqual(result.diagnostics["acquisition_reason"], "inherited_git_context")
                self.assertNotIn("synthetic-outside-metadata-marker", json.dumps(result.diagnostics))

    def test_invalid_selection_and_inherited_git_context_are_not_checked(self):
        fixture = self.fixture()
        for mode, rev in (("synthetic-invalid-mode", "HEAD"), ("rev", None), ("rev", 1)):
            with self.subTest(mode=mode, rev=rev):
                result = observe_repository(fixture.path, mode=mode, rev=rev, reference_date="2026-01-01")
                self.rejected(result, "NOT_CHECKED", not_checked=True)
        for name in ("GIT_DIR", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
            with self.subTest(name=name):
                with patch.dict(os.environ, {name: "synthetic-inherited-marker"}):
                    result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
                self.assertNotIn("synthetic-inherited-marker", json.dumps(result.diagnostics))

    def test_diagnostics_stdout_stderr_and_repr_do_not_echo_source_or_child_values(self):
        marker = "synthetic-nondisclosure-marker"
        entries = files(DATA.replace(b"runner: script", b"runner: " + marker.encode()))
        fixture = self.fixture(entries)
        for mode in ("rev", "staged", "worktree"):
            with self.subTest(mode=mode):
                stdout, stderr = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    result = self.rejected(self.observe(fixture, mode), "ENUM_UNSUPPORTED")
                self.assertNotIn(marker, json.dumps(result.diagnostics))
                self.assertNotIn(marker, repr(result))
                self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")
        fixture = self.fixture()
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            with patch.object(acquisition, "bounded_process", return_value=(91, marker.encode(), marker.encode())):
                result = self.rejected(self.observe(fixture), "NOT_CHECKED", not_checked=True)
        self.assertNotIn(marker, json.dumps(result.diagnostics))
        self.assertNotIn(marker, repr(result))
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")


if __name__ == "__main__":
    unittest.main()


class ReleasedObservationTests(unittest.TestCase):
    """New transport, the same one C3 acquisition, no independent approval."""

    def setUp(self):
        self.owner = FixtureOwner(self)

    def fixture(self, entries=None, *, object_format="sha1"):
        return GitFixture(self.owner, object_format=object_format).seed(files() if entries is None else entries)

    def observe(self, fixture, mode="rev", **kwargs):
        return acquisition.observe_released_repository(fixture.path, mode=mode,
            rev="HEAD" if mode == "rev" else None, reference_date="2026-01-01", **kwargs)

    def closed(self, result, status):
        self.assertEqual(result.exit_code, status)
        report = result.diagnostics
        self.assertEqual(set(report), {"scope", "exit_code", "declaration_checks", "complete_v1_validity",
            "findings", "mode", "reference_date", "commit_oid", "tree_oid", "manifest_blob_oid",
            "manifest_sha256", "observation_digest", "git_version", "tree_observation"})
        self.assertEqual(report["scope"], "project-manifest-git-observation-1")
        self.assertEqual(report["exit_code"], status)
        self.assertEqual(report["declaration_checks"], ("passed", "failed", "not_checked")[status])
        self.assertEqual(report["complete_v1_validity"], "not_checked")
        self.assertNotIn("candidate_declaration_accepted", report)
        self.assertEqual(len(report["findings"]), int(status != 0))
        for item in report["findings"]:
            self.assertEqual(set(item), {"code", "line", "column"})
        if status:
            self.assertIsNone(result.record)
            self.assertIsNone(result.tree)
        return report

    def test_three_modes_and_both_oid_widths_use_the_existing_acquisition_once(self):
        for object_format in ("sha1", "sha256"):
            fixture = self.fixture(object_format=object_format)
            for mode in ("rev", "staged", "worktree"):
                with self.subTest(mode=mode, format=object_format):
                    original = acquisition.observe_repository
                    with patch.object(acquisition, "observe_repository", wraps=original) as observer:
                        result = self.observe(fixture, mode)
                    observer.assert_called_once_with(fixture.path, mode=mode,
                        rev="HEAD" if mode == "rev" else None, reference_date="2026-01-01", common_dir=None)
                    report = self.closed(result, 0)
                    self.assertEqual(report["reference_date"], "2026-01-01")
                    self.assertEqual(report["manifest_sha256"], hashlib.sha256(DATA).hexdigest())
                    self.assertRegex(report["observation_digest"], r"^[a-f0-9]{64}$")
                    self.assertEqual(report["tree_observation"],
                        {"rev":"frozen-revision-tree", "staged":"frozen-stage-zero-index",
                         "worktree":"tracked-working-bytes"}[mode])
                    self.assertEqual(report["commit_oid"], fixture.head if mode == "rev" else None)
                    self.assertEqual(report["tree_oid"], fixture.tree if mode == "rev" else None)
                    self.assertEqual(report["manifest_blob_oid"], fixture.blobs["project.yaml"] if mode != "worktree" else None)

    def test_distinct_revision_index_and_working_bytes_keep_their_own_identity(self):
        fixture = self.fixture()
        staged = DATA.replace(b"Synthetic example", b"Synthetic staged")
        working = DATA.replace(b"Synthetic example", b"Synthetic working")
        fixture.set_index(files(staged))
        (fixture.path / "project.yaml").write_bytes(working)
        reports = {}
        for mode, data, name in (("rev", DATA, "Synthetic example"),
                                ("staged", staged, "Synthetic staged"),
                                ("worktree", working, "Synthetic working")):
            with self.subTest(mode=mode):
                result = self.observe(fixture, mode)
                reports[mode] = self.closed(result, 0)
                self.assertEqual(reports[mode]["manifest_sha256"], hashlib.sha256(data).hexdigest())
                self.assertEqual(result.record["project"]["display_name"], name)
        self.assertEqual(len({r["manifest_sha256"] for r in reports.values()}), 3)
        self.assertIsNone(reports["staged"]["commit_oid"])
        self.assertIsNone(reports["worktree"]["manifest_blob_oid"])

    def test_unresolved_revision_is_unavailable_without_reacquisition_or_raw_ref(self):
        fixture = self.fixture()
        original = acquisition.observe_repository
        with patch.object(acquisition, "observe_repository", wraps=original) as observer:
            result = acquisition.observe_released_repository(fixture.path, mode="rev",
                rev="synthetic-unresolved-reference", reference_date="2026-01-01")
        observer.assert_called_once_with(fixture.path, mode="rev", rev="synthetic-unresolved-reference",
                                        reference_date="2026-01-01", common_dir=None)
        report = self.closed(result, 2)
        self.assertEqual(report["reference_date"], "2026-01-01")
        self.assertIsNone(report["observation_digest"])
        self.assertNotIn("synthetic-unresolved-reference", json.dumps(report))

    def test_same_accepted_record_and_tree_objects_are_returned_without_revalidation(self):
        fixture = self.fixture()
        observed = observe_repository(fixture.path, mode="rev", rev="HEAD", reference_date="2026-01-01")
        with patch.object(acquisition, "observe_repository", return_value=observed) as observer, \
             patch.object(acquisition, "check_declaration", side_effect=AssertionError("Second declaration check")):
            result = self.observe(fixture)
        observer.assert_called_once()
        self.closed(result, 0)
        self.assertIs(result.record, observed.record)
        self.assertIs(result.tree, observed.tree)

    def test_known_invalid_manifest_cases_keep_acquired_provenance_and_explicit_day(self):
        cases = [
            ("missing", {k:v for k,v in files().items() if k != "project.yaml"}, "KEY_REQUIRED"),
            ("nonregular", dict(files(), **{"project.yaml":FileSpec("120000", b"docs/status.example")}), "REFERENCE_PATH"),
            ("oversized", files(DATA + b"\n" * (65_537-len(DATA))), "FIELD_BOUND"),
            ("syntax", files(DATA.replace(b"role: canonical", b"role: yes")), None),
        ]
        for label, entries, code in cases:
            fixture = self.fixture(entries)
            for mode in ("rev", "staged", "worktree"):
                with self.subTest(case=label, mode=mode):
                    report = self.closed(self.observe(fixture, mode), 1)
                    if code is not None:
                        self.assertEqual(report["findings"][0]["code"], code)
                    self.assertNotEqual(report["findings"][0]["code"], "NOT_CHECKED")
                    self.assertEqual(report["reference_date"], "2026-01-01")
                    self.assertRegex(report["observation_digest"], r"^[a-f0-9]{64}$")
                    self.assertEqual(report["commit_oid"], fixture.head if mode == "rev" else None)

    def test_unavailable_storage_and_bad_inputs_are_closed_and_value_blind(self):
        result = acquisition.observe_released_repository("/synthetic/absent-source", mode="rev",
            rev="HEAD", reference_date="2026-01-01")
        report = self.closed(result, 2)
        self.assertTrue(all(report[key] is None for key in ("commit_oid","tree_oid","manifest_blob_oid",
            "manifest_sha256","observation_digest","git_version","tree_observation")))
        self.assertEqual(report["reference_date"], "2026-01-01")
        for day in (None, "2026-02-30", "synthetic-raw-day", False, b"2026-01-01"):
            with self.subTest(day=type(day).__name__), \
                 patch.object(acquisition, "observe_repository", side_effect=AssertionError("Missing day acquired")):
                report = self.closed(acquisition.observe_released_repository("/synthetic/root",
                    mode="rev", rev="HEAD", reference_date=day), 2)
                self.assertIsNone(report["reference_date"])
                self.assertNotIn("synthetic-raw", json.dumps(report))

    def test_mixed_pure_and_malformed_candidate_observations_do_not_enter_the_protocol(self):
        from copy import deepcopy
        from dataclasses import replace
        fixture = self.fixture()
        accepted = observe_repository(fixture.path, mode="rev", rev="HEAD", reference_date="2026-01-01")
        changes = [
            ("scope", "candidate-declaration-tree-records"), ("exit_code", False),
            ("candidate_declaration_accepted", False), ("complete_v1_validity", "valid"),
            ("manifest_sha256", None), ("observation_digest", "invalid"),
            ("git_version", "synthetic-raw-version"), ("commit_oid", None), ("mode", "staged"),
            ("reference_date", "2025-01-01"),
            ("findings", [{"code":"synthetic-raw-code","line":0,"column":0}]),
        ]
        for key,value in changes:
            with self.subTest(key=key):
                diagnostics = deepcopy(accepted.diagnostics)
                diagnostics[key] = value
                with patch.object(acquisition, "observe_repository",
                                  return_value=replace(accepted, diagnostics=diagnostics)) as observer:
                    report = self.closed(self.observe(fixture), 2)
                observer.assert_called_once()
                self.assertNotIn("synthetic-raw", json.dumps(report))
        from project_manifest import check_declaration
        pure = check_declaration(DATA, tree=accepted.tree, reference_date="2026-01-01")
        with patch.object(acquisition, "observe_repository", return_value=pure):
            self.closed(self.observe(fixture), 2)

    def test_observer_failure_is_not_retried_or_echoed_and_cancellation_propagates(self):
        with patch.object(acquisition, "observe_repository",
                          side_effect=RuntimeError("synthetic-raw-observer-error")) as observer:
            report = self.closed(acquisition.observe_released_repository("/synthetic/root",
                mode="rev", rev="HEAD", reference_date="2026-01-01"), 2)
            observer.assert_called_once()
            self.assertNotIn("synthetic-raw", json.dumps(report))
        for error in (KeyboardInterrupt, SystemExit):
            with patch.object(acquisition, "observe_repository", side_effect=error):
                with self.assertRaises(error):
                    acquisition.observe_released_repository("/synthetic/root", mode="rev",
                        rev="HEAD", reference_date="2026-01-01")


class TestHostGuardTests(unittest.TestCase):
    def test_selected_hosts_have_fixed_roots_without_fixture_creation(self):
        with patch("acquisition_fixtures.tempfile.mkdtemp", side_effect=AssertionError("unexpected fixture")):
            self.assertEqual(fixture_parent("Darwin", "arm64"), Path("/private/tmp"))
            self.assertEqual(fixture_parent("Linux", "x86_64"), Path("/tmp"))

    def test_unused_host_profiles_refuse_before_any_temporary_creation(self):
        with patch("acquisition_fixtures.tempfile.mkdtemp", side_effect=AssertionError("unexpected fixture")):
            for system, machine in (("Linux", "aarch64"), ("Darwin", "x86_64"), ("Windows", "AMD64")):
                with self.subTest(system=system, machine=machine):
                    with self.assertRaisesRegex(AssertionError, "Unsupported"):
                        fixture_parent(system, machine)

    def test_fixture_creation_uses_selected_parent_and_retains_existing_ownership_contract(self):
        owner = FixtureOwner(self)
        root = owner.create_root()
        self.assertEqual(root.resolve().parent, fixture_parent().resolve())
        self.assertTrue((root / "fixture-owner").is_file())
        self.assertEqual(root.stat().st_uid, os.getuid())
