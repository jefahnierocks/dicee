"""Offline CLI boundary tests using only guarded synthetic fixtures."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).absolute().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from project_manifest.cli import main
from acquisition_fixtures import FixtureOwner, GitFixture
from test_acquisition import files


class CliTests(unittest.TestCase):
    def capture(self, argv):
        output = io.StringIO()
        with redirect_stdout(output):
            code = main(argv)
        report = json.loads(output.getvalue())
        self.assertEqual(report["exit_code"], code)
        self.assertEqual(report["complete_v1_validity"], "not_checked")
        return code, report, output.getvalue()

    def test_invalid_arguments_are_value_blind(self):
        marker = "SYNTHETIC_CLI_ARGUMENT_MARKER"
        for args in ([], ["--rev", marker, "--staged"],
                     ["--unknown-" + marker], ["--rev"]):
            with self.subTest(args=args):
                code, report, output = self.capture(args)
                self.assertEqual(code, 2)
                self.assertNotIn(marker, output)
                self.assertEqual(report["findings"][0]["field"], "arguments")

    def test_invalid_date_and_root_are_value_blind(self):
        marker = "SYNTHETIC_CLI_PATH_MARKER"
        code, _, output = self.capture(["--repo", "/" + marker,
                                      "--rev", "HEAD", "--reference-date", marker])
        self.assertEqual(code, 2)
        self.assertNotIn(marker, output)

    def test_module_bootstrap_reports_unsupported_runtime(self):
        output = io.StringIO()
        with patch("sys.version_info", (3, 10, 99)), redirect_stdout(output):
            with self.assertRaises(SystemExit) as caught:
                runpy.run_module("project_manifest.__main__", run_name="__main__")
        self.assertEqual(caught.exception.code, 2)
        self.assertEqual(json.loads(output.getvalue())["findings"][0]["field"], "runtime")

    def test_source_module_cli_exits_and_never_prints_record(self):
        # This remains a source invocation, not an installed or vendored command.
        owner = FixtureOwner(self)
        fixture = GitFixture(owner).seed(files())
        env = os.environ.copy()
        env["PYTHONPATH"] = str(ROOT / "src")
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run([sys.executable, "-B", "-m", "project_manifest",
            "--repo", str(fixture.path), "--rev", "HEAD",
            "--reference-date", "2026-01-01"], env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        self.assertEqual(result.stderr, b"")
        report = json.loads(result.stdout)
        self.assertTrue(report["candidate_declaration_accepted"])
        self.assertEqual(report["vocabulary_state"]["development_policy"],
                         "owner-frozen-contract-policy")
        self.assertEqual(report["vocabulary_state"]["development_policy_approval_date"],
                         "2026-10-13")
        self.assertNotIn("development_vocabulary_approval", report["checks_remaining"])
        self.assertIn("release_binding", report["checks_remaining"])
        self.assertIn("native_task_and_declaration_conformance", report["checks_remaining"])
        self.assertEqual(report["mode"], "rev")
        self.assertEqual(report["complete_v1_validity"], "not_checked")
        self.assertNotIn("record", report)
        self.assertNotIn("project", report)
        self.assertEqual(len(report["commit_oid"]), 40)

    def test_deleted_cwd_keeps_explicit_repository_and_coded_default_failure(self):
        owner = FixtureOwner(self)
        fixture = GitFixture(owner).seed(files())
        with patch("os.getcwd", side_effect=FileNotFoundError("synthetic-cwd-error-marker")):
            code, report, output = self.capture(["--repo", str(fixture.path), "--rev", "HEAD",
                                               "--reference-date", "2026-01-01"])
            self.assertEqual(code, 0)
            self.assertTrue(report["candidate_declaration_accepted"])
            self.assertNotIn("synthetic-cwd-error-marker", output)
            code, report, output = self.capture(["--rev", "HEAD", "--reference-date", "2026-01-01"])
            self.assertEqual(code, 2)
            self.assertEqual(report["findings"][0]["code"], "NOT_CHECKED")
            self.assertNotIn("synthetic-cwd-error-marker", output)

    def test_cli_requires_source_selection(self):
        code, report, _ = self.capture(["--repo", "/private/tmp"])
        self.assertEqual(code, 2)
        self.assertEqual(report["findings"][0]["field"], "arguments")
