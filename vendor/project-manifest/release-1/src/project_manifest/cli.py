"""Offline source CLI; diagnostics contain no manifest-derived record."""
import argparse
import json
import os
import sys

from .acquire import observe_repository


class UsageError(Exception):
    pass


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError()


def _unavailable(field):
    return {"scope": "candidate-git-observation",
            "candidate_declaration_accepted": False,
            "complete_v1_validity": "not_checked", "exit_code": 2,
            "findings": [{"code": "NOT_CHECKED", "field": field,
                          "line": 0, "column": 0}]}


def main(argv=None):
    parser = Parser(prog="project-manifest", allow_abbrev=False,
        description="Offline candidate declaration checks; complete v1 validity is not checked.")
    parser.add_argument("--repo", default=".", help="One explicitly selected repository root.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--rev", metavar="REV", help="Resolve one commit once; do not fetch.")
    source.add_argument("--staged", action="store_true", help="Read the captured stage-zero index.")
    source.add_argument("--worktree", action="store_true", help="Read only index-tracked working paths.")
    parser.add_argument("--git-common-dir", help="Explicit storage scope required for a linked worktree.")
    parser.add_argument("--reference-date", metavar="YYYY-MM-DD",
        help="Explicit reference day; default is today's UTC day captured once.")
    try:
        args = parser.parse_args(argv)
    except UsageError:
        print(json.dumps(_unavailable("arguments"), sort_keys=True))
        return 2
    mode = "rev" if args.rev is not None else "staged" if args.staged else "worktree"
    result = observe_repository(args.repo, mode=mode, rev=args.rev,
        reference_date=args.reference_date, common_dir=args.git_common_dir)
    report = dict(result.diagnostics)
    report["exit_code"] = result.exit_code
    print(json.dumps(report, sort_keys=True, ensure_ascii=True))
    return result.exit_code
