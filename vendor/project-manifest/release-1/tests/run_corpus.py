"""Portable stdlib harness; unsupported full acquisition hosts return not checked."""

import argparse
import json
from pathlib import Path
import platform
import sys
import unittest

ROOT = Path(__file__).absolute().parent.parent
PURE_MODULES = ("test_candidate", "test_validation")


def main():
    parser = argparse.ArgumentParser(description="Candidate reference corpus, never release approval")
    parser.add_argument("--scope", choices=("pure", "all"), default="all")
    args = parser.parse_args()
    host_supported = (platform.system(), platform.machine()) in {
        ("Darwin", "arm64"), ("Linux", "x86_64"),
    }
    if sys.version_info < (3, 11) or (args.scope == "all" and not host_supported):
        print(json.dumps({"scope": args.scope, "exit_code": 2,
                          "qualification": "not_checked", "reason": "UNQUALIFIED_RUNTIME_OR_HOST"}))
        return 2
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(ROOT / "src"))
    sys.path.insert(0, str(ROOT / "tests"))
    loader = unittest.TestLoader()
    suite = (loader.discover(str(ROOT / "tests"), pattern="test_*.py") if args.scope == "all"
             else loader.loadTestsFromNames(PURE_MODULES))
    result = unittest.TextTestRunner(verbosity=2, failfast=True).run(suite)
    code = 0 if result.wasSuccessful() and result.testsRun else 1
    print(json.dumps({"scope": args.scope, "exit_code": code, "tests": result.testsRun,
                      "complete_v1_validity": "not_checked", "release_approval": "not_checked",
                      "linux_acquisition": "not_checked"}, sort_keys=True))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
