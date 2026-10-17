"""Runtime bootstrap is parseable before importing candidate annotations."""
import json
import sys

if sys.version_info < (3, 11):
    print(json.dumps({"scope": "candidate-git-observation",
        "candidate_declaration_accepted": False, "complete_v1_validity": "not_checked",
        "exit_code": 2, "findings": [{"code": "NOT_CHECKED", "field": "runtime",
                                    "line": 0, "column": 0}]}, sort_keys=True))
    raise SystemExit(2)

from .cli import main

raise SystemExit(main())
