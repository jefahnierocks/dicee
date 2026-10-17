"""Unreleased pure declaration checks over explicit dates and tree records."""

from dataclasses import dataclass
from datetime import date
import re
import sys
from types import MappingProxyType

from .candidate import Finding, ROLES, _path, check_candidate

# Owner-adopted generic domains; complete release approval is separate.
MINIMUM_PYTHON = (3, 11)
MANIFEST_ENUMS = MappingProxyType({
    "role": frozenset({"canonical", "component", "satellite", "peer", "predecessor"}),
    "status.posture": frozenset({
        "deployed-system", "public-package", "public-repo", "private-tool",
        "course-taught", "published-artifact", "client-deliverable",
        "working-prototype", "design-spec", "source-held", "archive-only",
    }),
    "status.operational_state": frozenset({
        "production-live", "staging-live", "active-build", "maintained",
        "paused", "retired", "unverified", "unknown",
    }),
    "presentation.visibility": frozenset({
        "public-promoted", "public-available", "shareable-private", "internal", "archive",
    }),
    "presentation.link_policy": frozenset({"link-ok", "no-link"}),
})
# Owner-frozen contract policy; complete immutable release remains separate.
DEVELOPMENT_POLICY_APPROVAL_DATE = "2026-10-13"
PLATFORMS = frozenset({
    "macos-arm64", "macos-x86_64", "linux-arm64", "linux-x86_64",
    "windows-arm64", "windows-x86_64",
})
ACTIVATION_OWNERS = frozenset({"none", "direnv", "mise", "project"})
RUNNERS = frozenset({"script", "mise"})
SCOPES = frozenset({"host", "checkout"})
PORT_POLICIES = frozenset({"unpublished", "loopback_only"})
HOST_REQUIREMENTS = frozenset({"container_engine", "android_sdk"})
TASK_PART = r"[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*"
TASK = re.compile(TASK_PART + r"(?::" + TASK_PART + r")*", re.ASCII)
EXECUTABLE_PATH = re.compile(r"[A-Za-z0-9._/-]+", re.ASCII)
REMAINING = (
    "release_runtime_qualification",
    "producer_legacy_dispatch", "cross_loader_agreement", "git_observation_acquisition",
    "release_binding", "native_task_and_declaration_conformance",
    "producer_admission", "runtime_acceptance",
)


@dataclass(frozen=True)
class TreeEntry:
    """One literal tree path; kind is file/directory/symlink/submodule."""

    path: str
    kind: str
    executable: bool = False


@dataclass(frozen=True)
class TreeSnapshot:
    """Caller-supplied complete tree records, not verified Git acquisition."""

    entries: tuple[TreeEntry, ...]
    complete: bool = True


@dataclass(frozen=True)
class DeclarationResult:
    exit_code: int
    record: dict | None
    findings: tuple[Finding, ...]
    reference_date: str | None = None

    @property
    def candidate_declaration_accepted(self):
        return self.exit_code == 0

    def diagnostics(self):
        return {
            "scope": "candidate-declaration-tree-records",
            "candidate_declaration_accepted": self.candidate_declaration_accepted,
            "complete_v1_validity": "not_checked",
            "tree_observation": "caller-supplied-unverified",
            "vocabulary_state": {
                "manifest_domains": "owner-adopted-generic-snapshot",
                "development_policy": "owner-frozen-contract-policy",
                "development_policy_approval_date": DEVELOPMENT_POLICY_APPROVAL_DATE,
            },
            "exit_code": self.exit_code,
            "reference_date": self.reference_date,
            "findings": [item.diagnostic() for item in self.findings],
            "checks_remaining": list(REMAINING),
        }


class _Failure(Exception):
    def __init__(self, code, field, exit_code=1):
        self.finding = Finding(code, field, 0, 0)
        self.exit_code = exit_code


def _reject(code, field):
    raise _Failure(code, field)


def _reference_day(value):
    if type(value) is date:
        return value
    if type(value) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise _Failure("NOT_CHECKED", "reference_date", 2)


def _safe_path(value, executable=False):
    # Reserve .git case-insensitively; tree lookup itself is exact-case.
    safe = _path(value) and all(part.casefold() != ".git" for part in value.split("/"))
    return safe and (not executable or bool(EXECUTABLE_PATH.fullmatch(value)))


def _unique(items, field):
    if len(items) != len(set(items)):
        _reject("LIST_DUPLICATE", field)


def _semantics(record, reference_day):
    for field, value in (
        ("role", record["role"]),
        ("status.posture", record["status"]["posture"]),
        ("status.operational_state", record["status"]["operational_state"]),
        ("presentation.visibility", record["presentation"]["visibility"]),
        ("presentation.link_policy", record["presentation"]["link_policy"]),
    ):
        if value not in MANIFEST_ENUMS[field]:
            _reject("ENUM_UNSUPPORTED", field)
    try:
        stated_day = date.fromisoformat(record["status"]["as_of"])
    except ValueError:
        _reject("DATE_RULE", "status.as_of")
    if stated_day > reference_day:
        _reject("DATE_RULE", "status.as_of")

    own_id = record["project"]["id"]
    canonical = record["canonical"]
    if (record["role"] == "canonical") != (canonical is None) or canonical == own_id:
        _reject("ROLE_RELATION", "canonical")
    if own_id in record["peers"]:
        _reject("ROLE_RELATION", "peers")
    _unique(record["peers"], "peers")
    development = record["development"]
    if development["environment"]["owner"] not in ACTIVATION_OWNERS:
        _reject("ENUM_UNSUPPORTED", "development.environment.owner")
    _unique(development["platforms"], "development.platforms")
    if any(item not in PLATFORMS for item in development["platforms"]):
        _reject("ENUM_UNSUPPORTED", "development.platforms")
    _unique(development["host_requirements"], "development.host_requirements")
    if any(item not in HOST_REQUIREMENTS for item in development["host_requirements"]):
        _reject("ENUM_UNSUPPORTED", "development.host_requirements")
    if development["stacks"] and "container_engine" not in development["host_requirements"]:
        _reject("FIELD_RELATION", "development.host_requirements")
    for role in ROLES:
        command = development["commands"][role]
        if command is None:
            continue
        field = "development.commands." + role
        if command["runner"] not in RUNNERS:
            _reject("ENUM_UNSUPPORTED", field + ".runner")
        target = command["target"]
        if command["runner"] == "mise":
            if len(target) > 64:
                _reject("FIELD_BOUND", field + ".target")
            if not TASK.fullmatch(target):
                _reject("TARGET_RULE", field + ".target")
        elif not _safe_path(target, executable=True):
            _reject("TARGET_RULE", field + ".target")
    for stack in development["stacks"].values():
        if stack["instance_scope"] not in SCOPES:
            _reject("ENUM_UNSUPPORTED", "development.stacks.*.instance_scope")
        if stack["port_policy"] not in PORT_POLICIES:
            _reject("ENUM_UNSUPPORTED", "development.stacks.*.port_policy")


def _tree_index(snapshot):
    if type(snapshot) is not TreeSnapshot or snapshot.complete is not True:
        raise _Failure("NOT_CHECKED", "tree", 2)
    if type(snapshot.entries) is not tuple:
        raise _Failure("NOT_CHECKED", "tree", 2)
    entries = {}
    for entry in snapshot.entries:
        if type(entry) is not TreeEntry or type(entry.path) is not str:
            raise _Failure("NOT_CHECKED", "tree", 2)
        parts = entry.path.split("/")
        if (not entry.path or entry.path.startswith("/") or re.match(r"^[A-Za-z]:", entry.path)
                or any(not part or part in {".", ".."} for part in parts)
                or any(ord(char) < 32 or ord(char) == 127 for char in entry.path)
                or entry.path in entries or type(entry.kind) is not str or entry.kind not in
                {"file", "directory", "symlink", "submodule"}
                or type(entry.executable) is not bool
                or (entry.kind != "file" and entry.executable)):
            raise _Failure("NOT_CHECKED", "tree", 2)
        entries[entry.path] = entry
    # A complete tree explicitly includes directory nodes; no inferred parents.
    for path in entries:
        parts = path.split("/")
        for depth in range(1, len(parts)):
            parent = entries.get("/".join(parts[:depth]))
            if parent is None or parent.kind != "directory":
                raise _Failure("NOT_CHECKED", "tree", 2)
    return entries


def _references(record):
    yield "authority.status_of_record", record["authority"]["status_of_record"], False
    environment = record["development"]["environment"]
    for key in ("template", "secret_launcher"):
        if environment[key] is not None:
            yield "development.environment." + key, environment[key], key == "secret_launcher"
    for role in ROLES:
        command = record["development"]["commands"][role]
        if command is not None and command["runner"] == "script":
            yield "development.commands." + role + ".target", command["target"], True
    for stack in record["development"]["stacks"].values():
        yield "development.stacks.*.compose", stack["compose"], False


def _check_reference(entries, field, value, executable):
    if not _safe_path(value, executable=executable):
        _reject("REFERENCE_PATH", field)
    parts = value.split("/")
    for depth in range(1, len(parts) + 1):
        entry = entries.get("/".join(parts[:depth]))
        if entry is None:
            _reject("REFERENCE_MISSING", field)
        required_kind = "file" if depth == len(parts) else "directory"
        if entry.kind != required_kind:
            _reject("REFERENCE_PATH", field)
        if depth == len(parts) and executable and not entry.executable:
            _reject("REFERENCE_MODE", field)


def check_declaration(data, *, tree, reference_date):
    """Check candidate semantics and literal references, with no I/O or clock.

    Exit 0 covers this candidate policy only, never complete v1 validity.
    Exit 1 rejects the declaration; exit 2 rejects unavailable/incoherent
    caller-supplied evidence. No finding echoes a path, value or dynamic name.
    """
    if sys.version_info < MINIMUM_PYTHON:
        return DeclarationResult(2, None, (Finding("NOT_CHECKED", "runtime", 0, 0),))
    parsed = check_candidate(data)
    if parsed.exit_code:
        return DeclarationResult(parsed.exit_code, None, parsed.findings)
    reference_day = None
    try:
        reference_day = _reference_day(reference_date)
        _semantics(parsed.record, reference_day)
        entries = _tree_index(tree)
        for field, value, executable in _references(parsed.record):
            _check_reference(entries, field, value, executable)
        return DeclarationResult(0, parsed.record, (), reference_day.isoformat())
    except _Failure as error:
        return DeclarationResult(error.exit_code, None, (error.finding,),
                                 reference_day.isoformat() if reference_day else None)
