"""C2 public semantics and exact-tree behavior, entirely in memory."""

import contextlib
from dataclasses import replace
from datetime import date, datetime
import io
import json
import os
import socket
import subprocess
import time
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).absolute().parent.parent / "src"))
from project_manifest import TreeEntry, TreeSnapshot, check_declaration
from test_candidate import BASE, OPTIONAL_ROLES, STACK, changed

DATA = BASE.replace(b"role: sample-role\n", b"role: canonical\n").replace(
    b"      runner: sample-runner\n", b"      runner: script\n").replace(
    b'      target: "check-example"\n', b'      target: "tools/check.example"\n').replace(
    b"  posture: sample-posture\n", b"  posture: working-prototype\n").replace(
    b"  operational_state: sample-state\n", b"  operational_state: maintained\n").replace(
    b"  visibility: sample-visibility\n", b"  visibility: internal\n").replace(
    b"  link_policy: sample-link\n", b"  link_policy: no-link\n").replace(
    b"    owner: sample-activation\n", b"    owner: none\n")
TREE = TreeSnapshot((
    TreeEntry("docs", "directory"),
    TreeEntry("docs/status.example", "file"),
    TreeEntry("tools", "directory"),
    TreeEntry("tools/check.example", "file", True),
))


def modified_tree(path, **changes):
    return TreeSnapshot(tuple(replace(entry, **changes) if entry.path == path else entry
                              for entry in TREE.entries))


def with_stack(data=DATA):
    stack = STACK.replace(b"instance_scope: sample-scope", b"instance_scope: checkout").replace(
        b"port_policy: sample-policy", b"port_policy: loopback_only")
    return changed(b"  stacks: {}\n", stack, data).replace(
        b"  host_requirements: []\n", b"  host_requirements: [container_engine]\n")


STACK_TREE = TreeSnapshot(TREE.entries + (
    TreeEntry("stacks", "directory"), TreeEntry("stacks/compose.example", "file"),
))


class DeclarationTests(unittest.TestCase):
    def result(self, data=DATA, tree=TREE, reference_date="2026-01-01"):
        return check_declaration(data, tree=tree, reference_date=reference_date)

    def accepted(self, data=DATA, **kwargs):
        result = self.result(data, **kwargs)
        self.assertEqual(result.exit_code, 0, result.diagnostics())
        self.assertTrue(result.candidate_declaration_accepted)
        self.assertIsInstance(result.record, dict)
        self.assertEqual(result.diagnostics()["complete_v1_validity"], "not_checked")
        self.assertEqual(result.diagnostics()["tree_observation"], "caller-supplied-unverified")
        self.assertEqual(result.diagnostics()["vocabulary_state"], {
            "manifest_domains": "owner-adopted-generic-snapshot",
            "development_policy": "owner-frozen-contract-policy",
            "development_policy_approval_date": "2026-10-13",
        })
        self.assertNotIn("record", result.diagnostics())
        return result

    def rejected(self, data, code, exit_code=1, **kwargs):
        result = self.result(data, **kwargs)
        self.assertEqual(result.exit_code, exit_code, result.diagnostics())
        self.assertFalse(result.candidate_declaration_accepted)
        self.assertIsNone(result.record)
        self.assertEqual(len(result.findings), 1)
        self.assertEqual(result.findings[0].code, code)
        return result

    def test_valid_normalized_record_and_explicit_replay(self):
        first = self.accepted()
        self.assertEqual(first.record["canonical"], None)
        self.assertEqual(first.reference_date, "2026-01-01")
        self.assertEqual(first, self.accepted(reference_date=date(2026, 1, 1)))
        self.assertEqual(first, self.result())
        self.assertNotIn("manifest_enum_membership", first.diagnostics()["checks_remaining"])

    def test_activation_owner_domain_and_rejected_alias(self):
        for owner in ("none", "direnv", "mise", "project"):
            with self.subTest(owner=owner):
                self.accepted(changed(b"    owner: none\n", b"    owner: " + owner.encode() + b"\n", DATA))
        for owner in ("native", "sample-activation", "python", "unknown"):
            result = self.rejected(changed(b"    owner: none\n", b"    owner: " + owner.encode() + b"\n", DATA),
                                   "ENUM_UNSUPPORTED")
            self.assertEqual(result.findings[0].field, "development.environment.owner")

    def test_activation_template_and_secret_launcher_are_independent(self):
        tree = TreeSnapshot(TREE.entries + (TreeEntry("docs/environment.example", "file"),
                                           TreeEntry("tools/environment.example", "file", True)))
        for owner in ("none", "direnv", "mise", "project"):
            for template in (False, True):
                for launcher in (False, True):
                    with self.subTest(owner=owner, template=template, launcher=launcher):
                        data = changed(b"    owner: none\n", b"    owner: " + owner.encode() + b"\n", DATA)
                        if template:
                            data = changed(b"    template: null\n", b'    template: "docs/environment.example"\n', data)
                        if launcher:
                            data = changed(b"    secret_launcher: null\n", b'    secret_launcher: "tools/environment.example"\n', data)
                        self.accepted(data, tree=tree)

    def test_policy_approval_is_not_release_native_or_runtime_acceptance(self):
        report = self.accepted().diagnostics()
        self.assertEqual(report["vocabulary_state"]["development_policy"],
                         "owner-frozen-contract-policy")
        self.assertEqual(report["vocabulary_state"]["development_policy_approval_date"],
                         "2026-10-13")
        self.assertNotIn("development_vocabulary_approval", report["checks_remaining"])
        for check in ("release_runtime_qualification", "release_binding",
                      "native_task_and_declaration_conformance", "producer_admission",
                      "runtime_acceptance"):
            self.assertIn(check, report["checks_remaining"])
        self.assertEqual(report["complete_v1_validity"], "not_checked")
        self.assertEqual(report["tree_observation"], "caller-supplied-unverified")

    def test_calendar_dates_and_future_boundary(self):
        for value in (b"0000-01-01", b"2026-00-01", b"2026-13-01", b"2026-01-00",
                      b"2026-02-29", b"1900-02-29", b"2026-04-31", b"2026-01-02"):
            with self.subTest(value=value):
                self.rejected(changed(b'  as_of: "2026-01-01"\n', b'  as_of: "' + value + b'"\n', DATA),
                              "DATE_RULE")
        for value in (b"0001-01-01", b"2000-02-29", b"2024-02-29", b"2026-01-01"):
            self.accepted(changed(b'  as_of: "2026-01-01"\n', b'  as_of: "' + value + b'"\n', DATA))
        self.accepted(reference_date="9999-12-31")

    def test_reference_date_evidence_not_checked(self):
        for value in (None, b"2026-01-01", "2026-1-1", "2026-02-29", "0000-01-01",
                      "2026-01-01Z", datetime(2026, 1, 1), 1):
            with self.subTest(kind=type(value).__name__):
                self.rejected(DATA, "NOT_CHECKED", 2, reference_date=value)

    def test_selected_uniform_canonical_and_own_id_rules(self):
        self.rejected(changed(b"canonical: null\n", b"canonical: sample-parent\n", DATA), "ROLE_RELATION")
        noncanonical = changed(b"role: canonical\n", b"role: component\n", DATA)
        self.rejected(noncanonical, "ROLE_RELATION")
        self.accepted(changed(b"canonical: null\n", b"canonical: sample-parent\n", noncanonical))
        self.rejected(changed(b"canonical: null\n", b"canonical: sample-project\n", noncanonical), "ROLE_RELATION")
        self.rejected(changed(b"peers: []\n", b"peers: [sample-project]\n", DATA), "ROLE_RELATION")
        self.accepted(changed(b"peers: []\n", b"peers: [sample-peer]\n", DATA))

    def test_candidate_platform_domain_is_closed_and_empty_remains_no_claim(self):
        for token in ("macos-arm64", "macos-x86_64", "linux-arm64", "linux-x86_64",
                      "windows-arm64", "windows-x86_64"):
            with self.subTest(token=token):
                self.accepted(changed(b"  platforms: []\n",
                    ("  platforms: [" + token + "]\n").encode(), DATA))
        for token in ("unknown", "macos-unknown", "unknown-arm64", "sample-platform"):
            with self.subTest(token=token):
                self.rejected(changed(b"  platforms: []\n",
                    ("  platforms: [" + token + "]\n").encode(), DATA), "ENUM_UNSUPPORTED")

    def test_list_uniqueness_and_empty_platform_claim(self):
        for old, new in (
            (b"peers: []\n", b"peers: [sample-peer, sample-peer]\n"),
            (b"  platforms: []\n", b"  platforms: [sample-platform, sample-platform]\n"),
            (b"  host_requirements: []\n", b"  host_requirements: [android_sdk, android_sdk]\n"),
        ):
            self.rejected(changed(old, new, DATA), "LIST_DUPLICATE")
        self.accepted()
        self.accepted(changed(b"  platforms: []\n", b"  platforms: [macos-arm64]\n", DATA))

    def test_closed_candidate_runner_vocabulary(self):
        self.rejected(changed(b"      runner: script\n", b"      runner: sample-runner\n", DATA),
                      "ENUM_UNSUPPORTED")
        self.accepted(changed(b"      runner: script\n", b"      runner: mise\n", DATA).replace(
            b'      target: "tools/check.example"\n', b'      target: "check"\n'))

    def test_task_spelling_and_bounds(self):
        data = changed(b"      runner: script\n", b"      runner: mise\n", DATA)
        old = b'      target: "tools/check.example"\n'
        for value in (b"a", b"a" * 64, b"format:check", b"task_one:task-two", b"true"):
            self.accepted(changed(old, b'      target: "' + value + b'"\n', data))
        self.rejected(changed(old, b'      target: "' + b"a" * 65 + b'"\n', data), "FIELD_BOUND")
        for value in (b"Task", b"task value", b"task;other", b"a/b", b":task", b"task:",
                      b"task::name", b"a--b", b"a__b", b"task$var", b"task(arg)", b"../task"):
            with self.subTest(value=value):
                self.rejected(changed(old, b'      target: "' + value + b'"\n', data), "TARGET_RULE")

    def test_script_target_literal_path_and_bounds(self):
        old = b'      target: "tools/check.example"\n'
        for value in (b"tools/check.example --flag", b"tools/check.example;other", b"tools/check$var",
                      b"tools/check(arg)", b"tools/.GIT/check", b"tools/check:task"):
            self.rejected(changed(old, b'      target: "' + value + b'"\n', DATA), "TARGET_RULE")
        path = "s" * 255
        tree = TreeSnapshot(TREE.entries + (TreeEntry(path, "file", True),))
        self.accepted(changed(old, b'      target: "' + path.encode() + b'"\n', DATA), tree=tree)
        self.rejected(changed(old, b'      target: "' + b"s" * 256 + b'"\n', DATA), "FIELD_BOUND")

    def test_each_command_role_requires_executable_script(self):
        for role in OPTIONAL_ROLES:
            with self.subTest(role=role):
                data = changed(b"    " + role + b": null\n", b"    " + role + b":\n"
                    b"      runner: script\n" b'      target: "tools/check.example"\n', DATA)
                self.accepted(data)
                bad = changed(b'      target: "tools/check.example"\n', b'      target: "missing"\n',
                              DATA)
                # The optional role has a separate missing target.
                data = changed(b"    " + role + b": null\n", b"    " + role + b":\n"
                    b"      runner: script\n" b'      target: "missing"\n', DATA)
                self.rejected(data, "REFERENCE_MISSING")
                self.rejected(bad, "REFERENCE_MISSING")
        self.rejected(DATA, "REFERENCE_MODE",
                      tree=modified_tree("tools/check.example", executable=False))

    def test_optional_script_roles_require_their_own_executable_mode(self):
        good = TreeSnapshot(TREE.entries + (TreeEntry("tools/optional.example", "file", True),))
        bad = TreeSnapshot(TREE.entries + (TreeEntry("tools/optional.example", "file", False),))
        for role in OPTIONAL_ROLES:
            with self.subTest(role=role):
                data = changed(b"    " + role + b": null\n", b"    " + role + b":\n"
                    b"      runner: script\n" b'      target: "tools/optional.example"\n', DATA)
                self.accepted(data, tree=good)
                result = self.rejected(data, "REFERENCE_MODE", tree=bad)
                self.assertEqual(result.findings[0].field,
                                 "development.commands." + role.decode() + ".target")

    def test_mise_target_rules_in_every_role_do_not_check_native_existence(self):
        for role in (b"check",) + OPTIONAL_ROLES:
            with self.subTest(role=role):
                old = (b'    check:\n      runner: script\n      target: "tools/check.example"\n'
                       if role == b"check" else b"    " + role + b": null\n")
                def declare(target):
                    return changed(old, b"    " + role + b":\n      runner: mise\n"
                                   b'      target: "' + target + b'"\n', DATA)
                # These names have no supplied mise task declaration. Validity
                # cannot infer existence/effects or execute native project tools.
                with contextlib.ExitStack() as stack:
                    for target in ("builtins.open", "pathlib.Path.read_bytes", "subprocess.run"):
                        stack.enter_context(patch(target, side_effect=AssertionError("Native task was evaluated")))
                    result = self.accepted(declare(b"synthetic_missing:task-name"))
                    self.accepted(declare(b"a" * 64))
                    too_long = self.rejected(declare(b"a" * 65), "FIELD_BOUND")
                    self.rejected(declare(b"a/b"), "TARGET_RULE")
                    unsupported = changed(b"      runner: mise\n", b"      runner: sample-runner\n",
                                          declare(b"check"))
                    self.rejected(unsupported, "ENUM_UNSUPPORTED")
                self.assertEqual(too_long.findings[0].field,
                                 "development.commands." + role.decode() + ".target")
                self.assertIn("native_task_and_declaration_conformance",
                              result.diagnostics()["checks_remaining"])

    def test_environment_optional_references_and_launcher_mode(self):
        tree = TreeSnapshot(TREE.entries + (TreeEntry("config", "directory"),
            TreeEntry("config/example.env", "file"), TreeEntry("tools/launcher.example", "file", True)))
        data = changed(b"    template: null\n", b'    template: "config/example.env"\n', DATA)
        data = changed(b"    secret_launcher: null\n", b'    secret_launcher: "tools/launcher.example"\n', data)
        self.accepted(data, tree=tree)
        self.rejected(data, "REFERENCE_MISSING")
        noexec = TreeSnapshot(tuple(replace(e, executable=False) if e.path == "tools/launcher.example" else e
                                   for e in tree.entries))
        self.rejected(data, "REFERENCE_MODE", tree=noexec)
        self.accepted()
        self.rejected(changed(b"    secret_launcher: null\n",
                      b'    secret_launcher: "tools/a launcher"\n', DATA), "REFERENCE_PATH",
                      tree=TreeSnapshot(TREE.entries + (TreeEntry("tools/a launcher", "file", True),)))

    def test_stack_requirement_scope_policy_and_compose(self):
        data = with_stack()
        self.accepted(data, tree=STACK_TREE)
        self.rejected(data, "REFERENCE_MISSING")
        self.rejected(changed(b"  host_requirements: [container_engine]\n",
                              b"  host_requirements: []\n", data), "FIELD_RELATION", tree=STACK_TREE)
        self.accepted(changed(b"      instance_scope: checkout\n", b"      instance_scope: host\n", data),
                      tree=STACK_TREE)
        self.accepted(changed(b"      port_policy: loopback_only\n", b"      port_policy: unpublished\n", data),
                      tree=STACK_TREE)
        self.rejected(changed(b"      instance_scope: checkout\n", b"      instance_scope: sample-scope\n", data),
                      "ENUM_UNSUPPORTED", tree=STACK_TREE)
        self.rejected(changed(b"      port_policy: loopback_only\n", b"      port_policy: public\n", data),
                      "ENUM_UNSUPPORTED", tree=STACK_TREE)
        self.rejected(changed(b"  host_requirements: []\n",
                              b"  host_requirements: [sample-engine]\n", DATA), "ENUM_UNSUPPORTED")
        self.accepted(changed(b"  host_requirements: []\n",
                              b"  host_requirements: [android_sdk]\n", DATA))

    def test_exact_case_lookup_and_directory_nodes(self):
        for path in (b"Docs/status.example", b"docs/Status.example", b"docs/status.Example"):
            self.rejected(changed(b'  status_of_record: "docs/status.example"\n',
                                  b'  status_of_record: "' + path + b'"\n', DATA), "REFERENCE_MISSING")
        self.rejected(DATA, "REFERENCE_PATH",
                      tree=modified_tree("docs/status.example", kind="directory"))
        self.accepted(tree=TreeSnapshot(tuple(reversed(TREE.entries))))
        self.accepted(tree=TreeSnapshot(TREE.entries + (TreeEntry("unrelated-\u00e9", "file"),)))

    def test_symlink_and_submodule_components_are_never_followed(self):
        for kind in ("symlink", "submodule"):
            with self.subTest(kind=kind):
                self.rejected(DATA, "REFERENCE_PATH", tree=modified_tree("docs/status.example", kind=kind))
                no_children = TreeSnapshot(tuple(e for e in TREE.entries if not e.path.startswith("tools/") and
                    e.path != "tools") + (TreeEntry("tools", kind),))
                self.rejected(DATA, "REFERENCE_PATH", tree=no_children)
                target = modified_tree("tools/check.example", kind=kind, executable=False)
                self.rejected(DATA, "REFERENCE_PATH", tree=target)

    def test_git_reservation_and_literal_nonexecutable_paths(self):
        for path in (b".GIT/config", b"docs/.Git/status", b"docs/.gIt/status"):
            self.rejected(changed(b'  status_of_record: "docs/status.example"\n',
                                  b'  status_of_record: "' + path + b'"\n', DATA), "REFERENCE_PATH")
        data = changed(b'  status_of_record: "docs/status.example"\n',
                       b'  status_of_record: "docs/example status"\n', DATA)
        self.accepted(data, tree=TreeSnapshot(TREE.entries + (TreeEntry("docs/example status", "file"),)))

    def test_unavailable_or_malformed_tree_is_not_checked(self):
        for tree in (None, {}, TreeSnapshot((), False), TreeSnapshot([], True),
                     TreeSnapshot((object(),)), TreeSnapshot((TreeEntry("", "file"),)),
                     TreeSnapshot((TreeEntry("/absolute", "file"),)),
                     TreeSnapshot((TreeEntry("../escape", "file"),)),
                     TreeSnapshot((TreeEntry("C:/drive", "file"),)),
                     TreeSnapshot((TreeEntry("a//b", "file"),)),
                     TreeSnapshot((TreeEntry("a\nb", "file"),)),
                     TreeSnapshot((TreeEntry("a", []),)),
                     TreeSnapshot((TreeEntry("a", "other"),)),
                     TreeSnapshot((TreeEntry("a", "directory", True),)),
                     TreeSnapshot((TreeEntry("a", "file", 1),)),
                     TreeSnapshot((TreeEntry(1, "file"),)),
                     TreeSnapshot((TreeEntry("a/b", "file"),)),
                     TreeSnapshot((TreeEntry("a", "file"), TreeEntry("a", "file"))),
                     TreeSnapshot((TreeEntry("a", "symlink"), TreeEntry("a/b", "file")))):
            with self.subTest(kind=type(tree).__name__):
                self.rejected(DATA, "NOT_CHECKED", 2, tree=tree)
        self.rejected(DATA, "REFERENCE_MISSING", tree=TreeSnapshot(()))

    def test_syntax_then_semantics_then_evidence_order(self):
        self.rejected(b"bad\n", "VERSION_LINE", tree=None, reference_date=None)
        self.rejected(changed(b"canonical: null\n", b"canonical: sample-parent\n", DATA),
                      "ROLE_RELATION", tree=None)
        self.rejected(DATA, "NOT_CHECKED", 2, tree=None)
        self.rejected(DATA, "NOT_CHECKED", 2, reference_date=None)

    def test_diagnostics_do_not_disclose_values_paths_or_dynamic_keys(self):
        marker = b"synthetic-marker-abcdef"
        data = with_stack().replace(b"sample-stack:", marker + b":").replace(
            b'"stacks/compose.example"', b'"stacks/' + marker + b'"')
        cases = (
            (data, STACK_TREE, "2026-01-01"),
            (changed(b"      runner: script\n", b"      runner: " + marker + b"\n", DATA), TREE, "2026-01-01"),
            (DATA, TreeSnapshot((TreeEntry(marker.decode(), "file"),
                                TreeEntry(marker.decode(), "file"))), "2026-01-01"),
            (DATA, TREE, marker.decode()),
        )
        for data, tree, day in cases:
            stdout, stderr = io.StringIO(), io.StringIO()
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                result = self.result(data, tree=tree, reference_date=day)
            self.assertIn(result.exit_code, (1, 2))
            self.assertIsNone(result.record)
            self.assertNotIn(marker.decode(), json.dumps(result.diagnostics()))
            self.assertNotIn(marker.decode(), repr(result))
            self.assertNotIn(marker.decode(), stdout.getvalue() + stderr.getvalue())
            self.assertNotIn("sample-stack", result.findings[0].field)

    def test_all_five_owner_adopted_enum_sets_and_unknown_rejection(self):
        cases = (
            (b"role: canonical\n", b"role: ", ("canonical", "component", "satellite", "peer", "predecessor")),
            (b"  posture: working-prototype\n", b"  posture: ", (
                "deployed-system", "public-package", "public-repo", "private-tool",
                "course-taught", "published-artifact", "client-deliverable",
                "working-prototype", "design-spec", "source-held", "archive-only")),
            (b"  operational_state: maintained\n", b"  operational_state: ", (
                "production-live", "staging-live", "active-build", "maintained",
                "paused", "retired", "unverified", "unknown")),
            (b"  visibility: internal\n", b"  visibility: ", (
                "public-promoted", "public-available", "shareable-private", "internal", "archive")),
            (b"  link_policy: no-link\n", b"  link_policy: ", ("link-ok", "no-link")),
        )
        for old, prefix, values in cases:
            for value in values:
                with self.subTest(field=prefix, value=value):
                    data = changed(old, prefix + value.encode() + b"\n", DATA)
                    if prefix == b"role: " and value != "canonical":
                        data = changed(b"canonical: null\n", b"canonical: sample-parent\n", data)
                    self.accepted(data)
            self.rejected(changed(old, prefix + b"synthetic-unsupported\n", DATA), "ENUM_UNSUPPORTED")
        self.rejected(changed(b"role: canonical\n", b"role: internal\n", DATA), "ENUM_UNSUPPORTED")

    def test_legacy_forms_remain_invalid_and_dispatchable(self):
        for line in (b"spec_version: 0.1\n", b'spec_version: "0.1"\n', b"spec_version: '0.1'\n"):
            self.rejected(changed(b'spec_version: "1"\n', line, DATA), "LEGACY_VERSION")
            self.rejected(b"# Intro\n" + changed(b'spec_version: "1"\n', line, DATA), "LEGACY_VERSION")
        self.rejected(changed(b'spec_version: "1"\n', b"spec_version: 0.10\n", DATA), "VERSION_LINE")

    def test_runtime_floor_guard_is_not_live_minimum_evidence(self):
        with patch("project_manifest.validation.sys.version_info", (3, 10)):
            self.rejected(DATA, "NOT_CHECKED", 2)
        with patch("project_manifest.validation.sys.version_info", (3, 11)):
            self.accepted()

    def test_no_filesystem_process_network_or_clock_operations(self):
        with contextlib.ExitStack() as stack:
            for target in ("builtins.open", "pathlib.Path.read_bytes", "subprocess.run",
                           "os.system", "socket.socket", "time.time"):
                stack.enter_context(patch(target, side_effect=AssertionError("Pure API performed I/O")))
            self.accepted()

    def test_distinct_list_order_is_preserved_with_stack_engine_independent_of_order(self):
        cases = (
            (b"peers: []\n", b"peers: ", ("sample-two", "sample-one"), ("peers",)),
            (b"  platforms: []\n", b"  platforms: ", ("linux-x86_64", "macos-arm64"), ("development", "platforms")),
            (b"  host_requirements: []\n", b"  host_requirements: ", ("android_sdk", "container_engine"), ("development", "host_requirements")),
        )
        for old, prefix, values, path in cases:
            for order in (values, tuple(reversed(values))):
                with self.subTest(field=path, order=order):
                    data = changed(old, prefix + ("[" + ", ".join(order) + "]\n").encode(), DATA)
                    result = self.accepted(data)
                    value = result.record
                    for part in path:
                        value = value[part]
                    self.assertEqual(value, list(order))
                    if path == ("development", "host_requirements"):
                        # A stack's engine implication must not sort or reduce the list.
                        stack = STACK.replace(b"instance_scope: sample-scope", b"instance_scope: checkout").replace(
                            b"port_policy: sample-policy", b"port_policy: loopback_only")
                        result = self.accepted(changed(b"  stacks: {}\n", stack, data), tree=STACK_TREE)
                        self.assertEqual(result.record["development"]["host_requirements"], list(order))



if __name__ == "__main__":
    unittest.main()
