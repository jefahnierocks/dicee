"""Synthetic public behavior vectors; no manifest or Git fixture files."""

import contextlib
import io
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).absolute().parent.parent / "src"))
from project_manifest import check_candidate

BASE = b'''spec_version: "1"
project:
  id: sample-project
  display_name: "Synthetic example"
  owner_entity: sample-owner
role: sample-role
canonical: null
peers: []
status:
  posture: sample-posture
  operational_state: sample-state
  local_phase: "Synthetic phase"
  as_of: "2026-01-01"
authority:
  status_of_record: "docs/status.example"
presentation:
  visibility: sample-visibility
  public_alias: null
  link_policy: sample-link
development:
  platforms: []
  commands:
    setup: null
    check:
      runner: sample-runner
      target: "check-example"
    test: null
    build: null
    dev: null
    format_check: null
    format_write: null
  environment:
    owner: sample-activation
    template: null
    secret_launcher: null
  stacks: {}
  host_requirements: []
'''
STACK = b'''  stacks:
    sample-stack:
      compose: "stacks/compose.example"
      instance_scope: sample-scope
      port_policy: sample-policy
'''
EXPANDED = BASE.replace(b"  stacks: {}\n", STACK)
OPTIONAL_ROLES = (b"setup", b"test", b"build", b"dev", b"format_check", b"format_write")


def changed(old, new, data=BASE):
    if data.count(old) != 1:
        raise AssertionError("Synthetic replacement is not unique")
    return data.replace(old, new)


def full_declaration_shape():
    data = EXPANDED
    for role in OPTIONAL_ROLES:
        data = changed(b"    " + role + b": null\n", b"    " + role + b":\n"
                       b"      runner: sample-runner\n" b'      target: "sample-task"\n', data)
    for old, new in (
        (b"canonical: null\n", b"canonical: sample-parent\n"),
        (b"  public_alias: null\n", b'  public_alias: "Synthetic alias"\n'),
        (b"    template: null\n", b'    template: "config/example.env"\n'),
        (b"    secret_launcher: null\n", b'    secret_launcher: "scripts/example-launcher"\n'),
    ):
        data = changed(old, new, data)
    return data


# Independent public contract positions, not imported from the reader's SHAPE.
REQUIRED_POSITIONS = (
    "project", "role", "canonical", "peers", "status", "authority",
    "presentation", "development",
) + tuple(parent + "." + key for parent, keys in (
    ("project", ("id", "display_name", "owner_entity")),
    ("status", ("posture", "operational_state", "local_phase", "as_of")),
    ("authority", ("status_of_record",)),
    ("presentation", ("visibility", "public_alias", "link_policy")),
    ("development", ("platforms", "commands", "environment", "stacks", "host_requirements")),
    ("development.environment", ("owner", "template", "secret_launcher")),
    ("development.stacks.sample-stack", ("compose", "instance_scope", "port_policy")),
) for key in keys) + tuple(
    "development.commands." + role.decode() + suffix
    for role in (b"check",) + OPTIONAL_ROLES for suffix in ("", ".runner", ".target")
)
NULLABLE_POSITIONS = frozenset((
    "canonical", "presentation.public_alias", "development.environment.template",
    "development.environment.secret_launcher",
)) | frozenset("development.commands." + role.decode() for role in OPTIONAL_ROLES)


def edit_fixture_field(data, field, *, omit=False):
    # Locate only this trusted fixture's line block; no validator/parser internals.
    lines, stack = data.splitlines(keepends=True), []
    for start, line in enumerate(lines):
        depth = (len(line) - len(line.lstrip(b" "))) // 2
        key = line.lstrip(b" ").split(b":", 1)[0].decode("ascii")
        stack = stack[:depth] + [key]
        if ".".join(stack) != field:
            continue
        end = start + 1
        while end < len(lines) and len(lines[end]) - len(lines[end].lstrip(b" ")) > depth * 2:
            end += 1
        replacement = b"" if omit else b" " * (depth * 2) + key.encode() + b": null\n"
        changed_data = b"".join(lines[:start]) + replacement + b"".join(lines[end:])
        # Keep a sole-child omission syntactically valid so shape requiredness,
        # rather than an orphan empty-header grammar error, determines rejection.
        if omit and field == "authority.status_of_record":
            changed_data = changed(b"authority:\n", b"authority: {}\n", changed_data)
        return changed_data
    raise AssertionError("Public fixture field was not found")


class CandidateTests(unittest.TestCase):
    def accepted(self, data):
        result = check_candidate(data)
        self.assertEqual(result.exit_code, 0, result.diagnostics())
        self.assertTrue(result.syntax_shape_accepted)
        self.assertEqual(result.findings, ())
        self.assertIsInstance(result.record, dict)
        self.assertEqual(result.diagnostics()["complete_v1_validity"], "not_checked")
        self.assertNotIn("record", result.diagnostics())
        return result.record

    def rejected(self, data, code):
        result = check_candidate(data)
        self.assertEqual(result.exit_code, 1, result.diagnostics())
        self.assertFalse(result.syntax_shape_accepted)
        self.assertIsNone(result.record)
        self.assertEqual(len(result.findings), 1)
        self.assertEqual(result.findings[0].code, code)
        self.assertEqual(result.diagnostics()["complete_v1_validity"], "not_checked")
        return result

    def test_normalized_record_and_determinism(self):
        record = self.accepted(BASE)
        self.assertEqual(record["spec_version"], "1")
        self.assertEqual(record["project"], {
            "id": "sample-project", "display_name": "Synthetic example",
            "owner_entity": "sample-owner",
        })
        self.assertIsNone(record["canonical"])
        self.assertEqual(record["peers"], [])
        self.assertEqual(record["development"]["stacks"], {})
        self.assertEqual(record["development"]["commands"]["check"], {
            "runner": "sample-runner", "target": "check-example",
        })
        self.assertEqual(check_candidate(BASE), check_candidate(BASE))

    def test_every_fixed_field_is_required_even_when_nullable(self):
        data = full_declaration_shape()
        self.accepted(data)
        self.assertEqual(len(REQUIRED_POSITIONS), 51)
        self.assertEqual(len(set(REQUIRED_POSITIONS)), 51)
        for field in REQUIRED_POSITIONS:
            with self.subTest(field=field):
                self.rejected(edit_fixture_field(data, field, omit=True), "KEY_REQUIRED")
        # Version removal belongs to first-content selection, not map requiredness.
        self.rejected(changed(b'spec_version: "1"\n', b"", data), "VERSION_LINE")

    def test_nullability_of_every_fixed_record_and_leaf(self):
        data = full_declaration_shape()
        for field in REQUIRED_POSITIONS:
            with self.subTest(field=field):
                candidate = edit_fixture_field(data, field)
                if field in NULLABLE_POSITIONS:
                    self.accepted(candidate)
                else:
                    self.rejected(candidate, "FIELD_TYPE")
        self.rejected(edit_fixture_field(data, "development.stacks.sample-stack"), "FIELD_TYPE")

    def test_full_development_shape(self):
        data = EXPANDED
        for role in OPTIONAL_ROLES:
            data = changed(b"    " + role + b": null\n",
                           b"    " + role + b":\n"
                           b"      runner: sample-runner\n"
                           b'      target: "sample-task"\n', data)
        data = changed(b"    template: null\n", b'    template: "config/example.env"\n', data)
        data = changed(b"    secret_launcher: null\n",
                       b'    secret_launcher: "scripts/example-launcher"\n', data)
        data = changed(b"canonical: null\n", b"canonical: sample-parent\n", data)
        data = changed(b"  public_alias: null\n", b'  public_alias: "Example alias"\n', data)
        data = changed(b"peers: []\n", b"peers: [sample-peer, other-peer]\n", data)
        data = changed(b"  platforms: []\n",
                       b"  platforms: [sample-platform, other-platform]\n", data)
        data = changed(b"  host_requirements: []\n",
                       b"  host_requirements: [sample-engine]\n", data)
        record = self.accepted(data)
        self.assertEqual(len(record["development"]["commands"]), 7)
        self.assertEqual(record["development"]["stacks"]["sample-stack"]["compose"],
                         "stacks/compose.example")
        self.assertEqual(record["peers"], ["sample-peer", "other-peer"])

    def test_comments_blanks_and_unordered_keys(self):
        self.accepted(b"# Before version\n\n   # Odd comment indentation\n" + BASE + b"\n# End\n")
        self.accepted(changed(b"role: sample-role\ncanonical: null\n",
                              b"canonical: null\nrole: sample-role\n"))
        self.accepted(changed(b"  id: sample-project\n", b"# Outside indentation\n  id: sample-project\n"))
        self.accepted(b" " * 2047 + b"#\n" + BASE)

    def test_quoted_punctuation_and_null_text(self):
        record = self.accepted(changed(b'  display_name: "Synthetic example"\n',
                                       b'  display_name: "# literal: punctuation [] {}"\n'))
        self.assertEqual(record["project"]["display_name"], "# literal: punctuation [] {}")
        record = self.accepted(changed(b"  public_alias: null\n", b'  public_alias: "null"\n'))
        self.assertEqual(record["presentation"]["public_alias"], "null")
        self.rejected(changed(b"canonical: null\n", b'canonical: "null"\n'), "FIELD_TYPE")

    def test_version_line(self):
        for first in (b'spec_version: "2"', b"spec_version: 1", b'spec_version: "0.10"',
                      b"spec_version: 0.10", b'spec_version: "0.1"',
                      b"spec_version: '0.1'", b"spec_version: 0.1",
                      b' spec_version: "1"', b'  spec_version: "1"',
                      b'spec_version:  "1"', b'spec_version:"1"',
                      b'spec_version: "1" # comment'):
            with self.subTest(first=first):
                code = "GRAMMAR" if first.startswith(b" ") and not first.startswith(b"  ") else "VERSION_LINE"
                if first in (b'spec_version: "0.1"', b"spec_version: '0.1'", b"spec_version: 0.1"):
                    code = "LEGACY_VERSION"
                self.rejected(changed(b'spec_version: "1"\n', first + b"\n"), code)
        self.rejected(b"# Nothing\n\n", "KEY_REQUIRED")
        self.rejected(changed(b'spec_version: "1"\n', b""), "VERSION_LINE")
        self.rejected(BASE + b'spec_version: "1"\n', "KEY_DUPLICATE")

    def test_bytes(self):
        self.rejected(b"", "BYTE_PROFILE")
        self.rejected(BASE[:-1], "BYTE_PROFILE")
        for prefix in (b"\xef\xbb\xbf", b"\x00", b"\t", b"\r", b"\x7f", b"\x85",
                       "\u2028".encode(), "\u2029".encode(), "\u200b".encode(),
                       "\u00e9".encode(), "e\u0301".encode(), "\u0441".encode()):
            with self.subTest(prefix=prefix):
                self.rejected(prefix + BASE, "BYTE_PROFILE")
        self.rejected(BASE.replace(b"\n", b"\r\n"), "BYTE_PROFILE")
        self.rejected(BASE + b" \n", "BYTE_PROFILE")
        self.rejected(changed(b"peers: []\n", b"peers: [] \n"), "BYTE_PROFILE")
        self.rejected(changed(b"project:\n", b"project:\t\n"), "BYTE_PROFILE")

    def test_prohibited_forms(self):
        for value in (b"&sample", b"*sample", b"!sample", b"!!str sample",
                      b"{sample: value}", b"|", b">", b"'sample'", b"~",
                      b"sample # comment", b'"sample" # comment',
                      b'["sample"]', b"[sample,\n  other]", b"[ ]"):
            with self.subTest(value=value):
                self.rejected(changed(b"role: sample-role\n", b"role: " + value + b"\n"), "GRAMMAR")
        for line in (b"---\n", b"...\n", b"<<: *sample\n", b"- sample\n", b"? sample\n"):
            with self.subTest(line=line):
                self.rejected(BASE + line, "GRAMMAR")
        self.rejected(changed(b"peers: []\n", b"peers:\n  - sample\n"), "GRAMMAR")
        self.rejected(changed(b'  local_phase: "Synthetic phase"\n',
                              b'  local_phase: "first\n    second"\n'), "GRAMMAR")

    def test_spacing_indentation_and_depth(self):
        for old, new in (
            (b"  id: sample-project\n", b" id: sample-project\n"),
            (b"  id: sample-project\n", b"    id: sample-project\n"),
            (b"  id: sample-project\n", b"  id:sample-project\n"),
            (b"  id: sample-project\n", b"  id:  sample-project\n"),
            (b"  id: sample-project\n", b"  id : sample-project\n"),
            (b"project:\n", b"project: {}\n"),
            (b"peers: []\n", b"peers:\n"),
            (b"  stacks: {}\n", b"  stacks:\n"),
            (b'      target: "check-example"\n', b"      target:\n        deep: sample\n"),
        ):
            with self.subTest(new=new):
                self.rejected(changed(old, new), "GRAMMAR")
        for value in (b"[sample,other]", b"[sample,  other]", b"[ sample, other]",
                      b"[sample, other ]", b"[sample,]", b"[sample , other]"):
            with self.subTest(value=value):
                self.rejected(changed(b"peers: []\n", b"peers: " + value + b"\n"), "GRAMMAR")
        self.accepted(changed(b"peers: []\n", b"peers: [sample, other]\n"))

    def test_duplicate_keys_at_all_mapping_levels(self):
        for line, data in (
            (b"role: sample-role\n", BASE),
            (b"  id: sample-project\n", BASE),
            (b"  posture: sample-posture\n", BASE),
            (b'  status_of_record: "docs/status.example"\n', BASE),
            (b"  visibility: sample-visibility\n", BASE),
            (b"  platforms: []\n", BASE),
            (b"    setup: null\n", BASE),
            (b"      runner: sample-runner\n", BASE),
            (b"    owner: sample-activation\n", BASE),
            (b"    sample-stack:\n", EXPANDED),
            (b"      port_policy: sample-policy\n", EXPANDED),
        ):
            with self.subTest(line=line):
                if line == b"    sample-stack:\n":
                    duplicate = STACK[STACK.index(line):]
                    candidate = EXPANDED.replace(STACK, STACK + duplicate)
                else:
                    candidate = changed(line, line + line, data)
                self.rejected(candidate, "KEY_DUPLICATE")

    def test_unknown_keys_at_all_mapping_levels(self):
        for line, data in (
            (b"role: sample-role\n", BASE),
            (b"  id: sample-project\n", BASE),
            (b"  posture: sample-posture\n", BASE),
            (b'  status_of_record: "docs/status.example"\n', BASE),
            (b"  visibility: sample-visibility\n", BASE),
            (b"  platforms: []\n", BASE),
            (b"    setup: null\n", BASE),
            (b"      runner: sample-runner\n", BASE),
            (b"    owner: sample-activation\n", BASE),
            (b"      port_policy: sample-policy\n", EXPANDED),
        ):
            with self.subTest(line=line):
                indent = len(line) - len(line.lstrip(b" "))
                self.rejected(changed(line, line + b" " * indent + b"extra: sample\n", data),
                              "KEY_UNKNOWN")
        self.accepted(EXPANDED.replace(b"sample-stack:", b"other_stack-name:"))

    def test_missing_keys_at_all_mapping_levels(self):
        for line, data in (
            (b"role: sample-role\n", BASE),
            (b"canonical: null\n", BASE),
            (b"  id: sample-project\n", BASE),
            (b"  posture: sample-posture\n", BASE),
            (b"  visibility: sample-visibility\n", BASE),
            (b"  platforms: []\n", BASE),
            (b"    setup: null\n", BASE),
            (b"      runner: sample-runner\n", BASE),
            (b"    owner: sample-activation\n", BASE),
            (b"      port_policy: sample-policy\n", EXPANDED),
        ):
            with self.subTest(line=line):
                self.rejected(changed(line, b"", data), "KEY_REQUIRED")
        self.rejected(changed(b'  status_of_record: "docs/status.example"\n', b"  extra: sample\n"),
                      "KEY_UNKNOWN")
        self.rejected(changed(b'authority:\n  status_of_record: "docs/status.example"\n',
                              b"authority: {}\n"), "KEY_REQUIRED")

    def test_nonnullable_records_and_leaf_types(self):
        for old, new in (
            (b"project:\n  id: sample-project\n  display_name: \"Synthetic example\"\n  owner_entity: sample-owner\n",
             b"project: null\n"),
            (b'authority:\n  status_of_record: "docs/status.example"\n', b"authority: null\n"),
            (b'    check:\n      runner: sample-runner\n      target: "check-example"\n', b"    check: null\n"),
            (b"  stacks: {}\n", b"  stacks: null\n"),
            (b"peers: []\n", b"peers: null\n"),
            (b"  platforms: []\n", b'  platforms: "sample-platform"\n'),
            (b"  host_requirements: []\n", b"  host_requirements: {}\n"),
            (b'  display_name: "Synthetic example"\n', b"  display_name: sample\n"),
            (b"  id: sample-project\n", b'  id: "sample"\n'),
            (b"    setup: null\n", b"    setup: sample\n"),
        ):
            with self.subTest(new=new):
                self.rejected(changed(old, new), "FIELD_TYPE")
        for key in (b"template", b"secret_launcher"):
            self.rejected(changed(b"    " + key + b": null\n", b"    " + key + b": sample\n"),
                          "FIELD_TYPE")
        self.rejected(changed(b"    setup: null\n", b"    setup: {}\n"), "KEY_REQUIRED")

    def test_token_boundaries_and_reserved_spellings(self):
        for value in (b"a", b"a" * 64, b"a-b_c2"):
            self.accepted(changed(b"  id: sample-project\n", b"  id: " + value + b"\n"))
        self.rejected(changed(b"  id: sample-project\n", b"  id: " + b"a" * 65 + b"\n"), "FIELD_BOUND")
        for value in (b"y", b"n", b"yes", b"no", b"on", b"off", b"true", b"false",
                      b"Null", b"NULL", b"Yes", b"TRUE", b"1", b"0x10", b".inf", b"1e3",
                      b"a--b", b"a__b", b"a-_b", b"a_-b", b"-a", b"a-", b"a_", b"A"):
            with self.subTest(value=value):
                self.rejected(changed(b"  id: sample-project\n", b"  id: " + value + b"\n"), "GRAMMAR")
        self.rejected(changed(b"  id: sample-project\n", b"  id: null\n"), "FIELD_TYPE")
        self.rejected(changed(b"peers: []\n", b"peers: [null]\n"), "GRAMMAR")
        for name, code in ((b"a" * 64, None), (b"a" * 65, "FIELD_BOUND"),
                           (b"yes", "GRAMMAR"), (b"a--b", "GRAMMAR")):
            data = EXPANDED.replace(b"sample-stack:", name + b":")
            if code:
                self.rejected(data, code)
            else:
                self.accepted(data)

    def test_text_boundaries(self):
        for old, maximum in (
            (b'  display_name: "Synthetic example"\n', 100),
            (b"  public_alias: null\n", 100),
            (b'  local_phase: "Synthetic phase"\n', 400),
            (b'      target: "check-example"\n', 255),
        ):
            key = old.split(b":", 1)[0]
            for length in (1, maximum):
                with self.subTest(key=key, length=length):
                    self.accepted(changed(old, key + b': "' + b"x" * length + b'"\n'))
            self.rejected(changed(old, key + b': "' + b"x" * (maximum + 1) + b'"\n'), "FIELD_BOUND")
            self.rejected(changed(old, key + b': ""\n'), "GRAMMAR")
        for value in (b'" leading"', b'"trailing "', b'"contains\\"quote"', b'"back\\slash"'):
            self.rejected(changed(b'  display_name: "Synthetic example"\n',
                                  b"  display_name: " + value + b"\n"), "GRAMMAR")

    def test_path_boundaries_and_lexical_rules(self):
        for old, data in (
            (b'  status_of_record: "docs/status.example"\n', BASE),
            (b"    template: null\n", BASE),
            (b"    secret_launcher: null\n", BASE),
            (b'      compose: "stacks/compose.example"\n', EXPANDED),
        ):
            key = old.split(b":", 1)[0]
            for length in (1, 255):
                self.accepted(changed(old, key + b': "' + b"x" * length + b'"\n', data))
            self.rejected(changed(old, key + b': "' + b"x" * 256 + b'"\n', data), "FIELD_BOUND")
            self.rejected(changed(old, key + b': ""\n', data), "GRAMMAR")
            for path in (b"/absolute", b"C:/absolute", b"a//b", b"a/", b".", b"..",
                         b"a/../b", b"a/./b", b".git/config", b"a/.git/b",
                         b"a/ b", b"a /b"):
                with self.subTest(key=key, path=path):
                    self.rejected(changed(old, key + b': "' + path + b'"\n', data), "REFERENCE_PATH")
        self.accepted(changed(b'  status_of_record: "docs/status.example"\n',
                              b'  status_of_record: ".GIT/Not-a-tree-proof"\n'))

    def test_date_format_and_semantic_deferrals(self):
        for value, code in ((b'"2026-1-01"', "DATE_FORMAT"),
                            (b'"2026-aa-01"', "DATE_FORMAT"),
                            (b'"20260-01-01"', "FIELD_BOUND"), (b"sample-date", "FIELD_TYPE")):
            self.rejected(changed(b'  as_of: "2026-01-01"\n', b"  as_of: " + value + b"\n"), code)
        for date in (b"0000-00-00", b"2026-02-31", b"9999-12-31"):
            self.accepted(changed(b'  as_of: "2026-01-01"\n', b'  as_of: "' + date + b'"\n'))
        self.accepted(changed(b"role: sample-role\n", b"role: canonical\n"))
        self.accepted(changed(b"canonical: null\n", b"canonical: sample-project\n"))
        self.accepted(changed(b"peers: []\n", b"peers: [sample-project, sample-project]\n"))
        self.accepted(changed(b"  platforms: []\n", b"  platforms: [sample, sample]\n"))
        self.accepted(changed(b"  host_requirements: []\n", b"  host_requirements: [sample, sample]\n"))
        self.accepted(changed(b"      runner: sample-runner\n", b"      runner: mise\n").replace(
            b'      target: "check-example"\n', b'      target: "' + b"x" * 255 + b'"\n'))

    def test_file_and_line_boundaries(self):
        self.accepted(BASE + b"\n" * (65_536 - len(BASE)))
        self.rejected(BASE + b"\n" * (65_537 - len(BASE)), "FIELD_BOUND")
        self.accepted(BASE + b"#" + b"x" * 2047 + b"\n")
        self.rejected(BASE + b"#" + b"x" * 2048 + b"\n", "FIELD_BOUND")

    def test_diagnostics_are_value_blind_and_silent(self):
        marker = b"synthetic-marker-abcdef"
        cases = (
            BASE + marker + b": sample\n",
            EXPANDED.replace(b"sample-stack:", marker + b":").replace(
                b"      port_policy: sample-policy\n", b"      " + marker + b": sample\n"),
            changed(b"  id: sample-project\n", b'  id: "' + marker + b'"\n'),
            changed(b'  status_of_record: "docs/status.example"\n',
                    b'  status_of_record: "../' + marker + b'"\n'),
        )
        for data in cases:
            with self.subTest(case=len(data)):
                stdout, stderr = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                    result = check_candidate(data)
                self.assertEqual(result.exit_code, 1)
                self.assertNotIn(marker.decode(), json.dumps(result.diagnostics()))
                self.assertNotIn(marker.decode(), repr(result))
                self.assertNotIn(marker.decode(), stdout.getvalue() + stderr.getvalue())
                finding = result.findings[0]
                self.assertGreater(finding.line, 0)
                self.assertGreater(finding.column, 0)
                self.assertNotIn("sample-stack", finding.field)

    def test_wrong_input_type_not_checked(self):
        for data in (BASE.decode(), bytearray(BASE), None, 1, memoryview(BASE)):
            with self.subTest(kind=type(data).__name__):
                result = check_candidate(data)
                self.assertEqual(result.exit_code, 2)
                self.assertEqual(result.findings[0].code, "NOT_CHECKED")
                self.assertIsNone(result.record)
                self.assertFalse(result.syntax_shape_accepted)


class LoaderComparisonTests(unittest.TestCase):
    """Stdlib injected preparation controls, never actual optional engines."""

    def setUp(self):
        import compare_loaders
        self.comparison = compare_loaders

    def selection(self):
        # These versions/executable are synthetic controls, not a release profile.
        return {"python": "1.2.3", "profiles": [
            {"id": "safe", "engine": "PyYAML.SafeLoader", "versions": {"pyyaml": "1.2.3", "libyaml": None}},
            {"id": "compiled", "engine": "PyYAML.CSafeLoader", "versions": {"pyyaml": "1.2.3", "libyaml": [0, 1, 2]}},
            {"id": "psych", "engine": "Ruby.Psych", "executable": "/synthetic/prepared/ruby",
             "versions": {"ruby": "1.2.3", "psych": "4.5.6", "libyaml": [0, 1, 2]}},
        ]}

    def run_injected(self, initializer, **kwargs):
        from unittest.mock import patch
        with patch.object(self.comparison, "discover", side_effect=AssertionError("Selected discovery ran")), \
             patch.object(self.comparison.importlib, "import_module", side_effect=AssertionError("Optional module imported")), \
             patch.object(self.comparison.subprocess, "run", side_effect=AssertionError("Optional runtime executed")):
            return self.comparison.compare(initializer=initializer, python_version="1.2.3", **kwargs)

    def test_selected_requires_every_engine_and_every_accepted_vector_without_discovery(self):
        selected = self.selection()
        initialized, loaded = [], []
        def initialize(profile):
            initialized.append(profile["id"])
            def load(data):
                loaded.append(profile["id"])
                return check_candidate(data).record
            return profile["versions"], load
        report = self.run_injected(initialize, selection=selected)
        accepted, refused = self.comparison.vectors()
        self.assertEqual(report["exit_code"], 0)
        self.assertEqual(report["selected_comparison"], "passed")
        self.assertEqual(report["release_qualification"], "not_checked")
        self.assertEqual(initialized, ["safe", "compiled", "psych"])
        self.assertEqual(len(loaded), len(initialized) * (len(accepted) + len(refused)))
        for engine in report["loaders"]:
            self.assertEqual(engine["agreements"], list(accepted))
            self.assertEqual(engine["differences"], [])
            # General acceptance of strict-refused input is informational.
            self.assertEqual(engine["broader_yaml_acceptance"], list(refused))
        self.assertEqual(len(report["requirements"]), 3)
        self.assertTrue(all(item["code"] == "SATISFIED" for item in report["requirements"]))

    def test_missing_version_and_initialization_failures_never_reduce_selected_set(self):
        for condition, expected in (("missing", "ENGINE_MISSING"), ("version", "VERSION_MISMATCH"),
                                    ("initialization", "ENGINE_INIT_FAILED")):
            with self.subTest(condition=condition):
                loaded = []
                def initialize(profile):
                    if profile["id"] == "compiled":
                        if condition == "missing":
                            raise self.comparison.Unavailable("ENGINE_MISSING")
                        if condition == "initialization":
                            raise RuntimeError("synthetic-raw-error-never-reported")
                        version = dict(profile["versions"], pyyaml="9.9.9")
                    else:
                        version = profile["versions"]
                    return version, lambda data: loaded.append(data)
                report = self.run_injected(initialize, selection=self.selection())
                self.assertEqual(report["exit_code"], 2)
                self.assertEqual(report["selected_comparison"], "not_checked")
                self.assertEqual(len(report["requirements"]), 3)
                self.assertEqual(report["requirements"][1]["code"], expected)
                self.assertEqual(loaded, [])
                self.assertNotIn("synthetic-raw-error", json.dumps(report))

    def test_python_context_mismatch_stops_before_initialization(self):
        def initialize(profile):
            raise AssertionError("Unqualified interpreter initialized an engine")
        selected = self.selection()
        selected["python"] = "9.9.9"
        report = self.run_injected(initialize, selection=selected)
        self.assertEqual(report["exit_code"], 2)
        self.assertEqual(report["reason"], "PYTHON_VERSION_MISMATCH")

    def test_unknown_duplicate_or_unqualified_profile_is_refused_before_engine_activity(self):
        cases = []
        for change in ({"engine": "Synthetic.Other"}, {"engine": []}, {"versions": {"pyyaml": "latest", "libyaml": None}}):
            value = self.selection()
            value["profiles"][0].update(change)
            cases.append(value)
        duplicate = self.selection()
        duplicate["profiles"][1]["id"] = "safe"
        cases.append(duplicate)
        relative = self.selection()
        relative["profiles"][2]["executable"] = "relative/ruby"
        cases.append(relative)
        extra = self.selection()
        extra["profiles"][0]["fallback"] = True
        cases.append(extra)
        cases.extend(({"python": "1.2.3", "profiles": []}, None))
        for index, value in enumerate(cases):
            with self.subTest(case=index):
                if value is None:
                    self.assertFalse(self.comparison.selection_valid(value))
                    continue
                report = self.run_injected(lambda profile: self.fail("Unqualified profile initialized"), selection=value)
                self.assertEqual(report["exit_code"], 2)
                self.assertEqual(report["reason"], "SELECTION_INPUT")

    def test_accepted_record_disagreement_and_strict_control_failure_are_exit_one(self):
        selected = self.selection()
        report = self.run_injected(lambda profile: (profile["versions"], lambda data: {}), selection=selected)
        self.assertEqual(report["exit_code"], 1)
        self.assertEqual(report["selected_comparison"], "failed")
        def initialize(profile):
            self.fail("Strict control failure initialized optional engine")
        report = self.run_injected(initialize, selection=selected, supplied_vectors=({"bad": b"not-a-manifest\n"}, {}))
        self.assertEqual(report["exit_code"], 1)
        self.assertEqual(report["reason"], "STRICT_CONTROL_FAILED")

    def test_post_initialization_loss_is_unavailable_in_both_vector_loops_without_fallback(self):
        import subprocess
        accepted, refused = self.comparison.vectors()
        sample = {"base": accepted["base"]}
        exclusion = {"reserved_token": refused["reserved_token"]}
        for phase in ("accepted", "strict_refusal"):
            for failure in ("os", "timeout", "unavailable"):
                for earlier_mismatch in (False, True):
                    with self.subTest(phase=phase, failure=failure, earlier_mismatch=earlier_mismatch):
                        initialized, loaded = [], []
                        def initialize(profile):
                            initialized.append(profile["id"])
                            def load(data):
                                loaded.append(profile["id"])
                                if profile["id"] == "psych":
                                    self.fail("Lost selected loader was skipped or retried through another profile")
                                is_refused = data == exclusion["reserved_token"]
                                if profile["id"] == "compiled" and is_refused == (phase == "strict_refusal"):
                                    if failure == "os":
                                        raise OSError("synthetic-raw-operational-error")
                                    if failure == "timeout":
                                        raise subprocess.TimeoutExpired("synthetic-raw-command", 5,
                                                                          output=b"synthetic-raw-output")
                                    raise self.comparison.Unavailable("synthetic-raw-operational-error")
                                if is_refused:
                                    raise ValueError("synthetic-parser-refusal")
                                return {} if earlier_mismatch and profile["id"] == "safe" else check_candidate(data).record
                            return profile["versions"], load
                        report = self.run_injected(initialize, selection=self.selection(),
                                                   supplied_vectors=(sample, exclusion))
                        self.assertEqual(report["exit_code"], 2)
                        self.assertEqual(report["reason"], "LOADER_EXECUTION_UNAVAILABLE")
                        self.assertEqual(report["selected_comparison"], "not_checked")
                        self.assertEqual(report["release_qualification"], "not_checked")
                        self.assertEqual(initialized, ["safe", "compiled", "psych"])
                        self.assertEqual(report["unavailable"], ["compiled"])
                        self.assertNotIn("psych", loaded)
                        self.assertEqual(report["loaders"][-1]["phase"], phase)
                        self.assertEqual(report["loaders"][-1]["execution"], "unavailable")
                        self.assertEqual(report["loaders"][0]["differences"], ["base"] if earlier_mismatch else [])
                        self.assertNotIn("synthetic-raw", json.dumps(report))

    def test_parser_refusal_of_accepted_input_is_mismatch_and_strict_refusal_is_informational(self):
        accepted, refused = self.comparison.vectors()
        sample = {"base": accepted["base"]}
        exclusion = {"reserved_token": refused["reserved_token"]}
        for refuse_accepted in (False, True):
            def initialize(profile):
                def load(data):
                    if refuse_accepted or data == exclusion["reserved_token"]:
                        raise ValueError("synthetic-parser-refusal")
                    return check_candidate(data).record
                return profile["versions"], load
            report = self.run_injected(initialize, selection=self.selection(),
                                       supplied_vectors=(sample, exclusion))
            self.assertEqual(report["exit_code"], 1 if refuse_accepted else 0)
            self.assertEqual(report["selected_comparison"], "failed" if refuse_accepted else "passed")
            self.assertEqual(report["unavailable"], [])
            self.assertEqual(report["loaders"][0]["differences"], ["base"] if refuse_accepted else [])

    def test_ruby_parser_refusal_is_distinct_from_process_loss_or_malformed_output(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        cases = ((65, b"", ValueError), (1, b"", self.comparison.Unavailable),
                 (-9, b"", self.comparison.Unavailable), (0, b"invalid-output", self.comparison.Unavailable))
        for code, output, error in cases:
            with self.subTest(code=code), patch.object(self.comparison.subprocess, "run",
                    return_value=SimpleNamespace(returncode=code, stdout=output,
                                                 stderr=b"synthetic-raw-ruby-error")):
                with self.assertRaises(error) as raised:
                    self.comparison.ruby_loader("/synthetic/prepared/ruby", BASE)
                self.assertNotIn("synthetic-raw", str(raised.exception))
        with patch.object(self.comparison.subprocess, "run",
                          return_value=SimpleNamespace(returncode=0, stdout=b'{"sample":1}', stderr=b"")):
            self.assertEqual(self.comparison.ruby_loader("/synthetic/prepared/ruby", BASE), {"sample": 1})

    def test_reconnaissance_remains_incomplete_and_does_not_adopt_a_release_profile(self):
        report = self.comparison.compare(discovery=lambda: (
            [("synthetic-one", {"pyyaml": "1.2.3", "libyaml": None}, lambda data: check_candidate(data).record)],
            ["PyYAML.CSafeLoader", "Ruby.Psych"]))
        self.assertEqual(report["exit_code"], 0)
        self.assertEqual(report["selected_comparison"], "not_checked")
        self.assertEqual(report["release_qualification"], "not_checked")
        self.assertEqual(report["unavailable"], ["PyYAML.CSafeLoader", "Ruby.Psych"])

    def test_linked_libyaml_version_is_observed_from_extension_not_boolean(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        yaml = SimpleNamespace(__version__="1.2.3", __with_libyaml__=True, CSafeLoader=object())
        extension = SimpleNamespace(get_version=lambda: (0, 1, 2))
        names = []
        def imported(name):
            names.append(name)
            return {"yaml": yaml, "yaml._yaml": extension}[name]
        with patch.object(self.comparison.importlib, "import_module", side_effect=imported):
            versions, load = self.comparison.initialize({"engine": "PyYAML.CSafeLoader"})
        self.assertEqual(versions, {"pyyaml": "1.2.3", "libyaml": [0, 1, 2]})
        self.assertTrue(callable(load))
        self.assertEqual(names, ["yaml", "yaml._yaml"])

    def test_explicit_invalid_selected_cli_input_never_falls_back_to_reconnaissance(self):
        from unittest.mock import patch
        for argv in (["--selected-profiles", ""], ["--selected-profiles"], ["--unknown"]):
            with self.subTest(argv=argv), \
                 patch.object(self.comparison, "discover", side_effect=AssertionError("CLI selection fell back")), \
                 patch.object(self.comparison, "initialize", side_effect=AssertionError("CLI selection initialized")):
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    code = self.comparison.main(argv)
                report = json.loads(output.getvalue())
                self.assertEqual(code, 2)
                self.assertEqual(report["reason"], "SELECTION_INPUT")
                self.assertEqual(report["selected_comparison"], "not_checked")

    def test_selected_representation_classes_have_explicit_strict_record_controls(self):
        accepted, refused = self.comparison.vectors()
        records = {label: self.comparison.check_candidate(data) for label, data in accepted.items()}
        self.assertTrue(all(result.exit_code == 0 for result in records.values()))
        self.assertTrue(all(self.comparison.check_candidate(data).exit_code == 1 for data in refused.values()))
        self.assertEqual(records["singleton_list"].record["peers"], ["a"])
        self.assertEqual(records["ordered_lists"].record["peers"], ["sample_two", "sample-one"])
        self.assertEqual(records["duplicate_list"].record["peers"], ["sample-peer", "sample-peer"])
        self.assertEqual(records["quoted_null_and_numeric"].record["presentation"]["public_alias"], "null")
        self.assertEqual(records["quoted_null_and_numeric"].record["project"]["display_name"], "001")
        self.assertIsNone(records["base"].record["presentation"]["public_alias"])
        self.assertEqual(records["quoted_punctuation"].record["project"]["display_name"], "# literal: [] {}")
        self.assertEqual(records["reordered_keys"].record, records["base"].record)
        self.assertEqual(records["interior_comments"].record, records["base"].record)
        self.assertEqual(list(records["two_mixed_stack_keys"].record["development"]["stacks"]), ["first_stack-one", "second-stack_two"])
        self.assertEqual(len(records["full_shape"].record["development"]["commands"]), 7)
        self.assertEqual(len(records["token_limits"].record["project"]["id"]), 64)
        self.assertEqual(len(next(iter(records["token_limits"].record["development"]["stacks"]))), 64)
        self.assertEqual(len(records["text_and_path_limits"].record["status"]["local_phase"]), 400)
        self.assertEqual(len(records["text_and_path_limits"].record["authority"]["status_of_record"]), 255)
        self.assertEqual(len(accepted["file_limit"]), 65_536)
        self.assertEqual(len(accepted["line_limit"].splitlines()[-1]), 2_048)


if __name__ == "__main__":
    unittest.main()
