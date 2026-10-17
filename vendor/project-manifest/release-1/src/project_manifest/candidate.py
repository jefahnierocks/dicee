"""Pure C1 syntax/shape reader. Success is never a complete v1 verdict."""

from dataclasses import dataclass
import re

MAX_FILE_BYTES = 65_536
MAX_LINE_BYTES = 2_048  # Content, including indentation; excludes LF.
MAX_TOKEN_BYTES = 64
TOKEN = re.compile(r"[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*", re.ASCII)
RESERVED = frozenset({"y", "n", "yes", "no", "on", "off", "true", "false", "null"})
LEGACY_LINES = frozenset({
    'spec_version: "0.1"', "spec_version: '0.1'", "spec_version: 0.1",
})
REMAINING = (
    "enum_membership", "calendar_and_reference_date", "role_peer_relations",
    "producer_legacy_dispatch", "list_uniqueness", "cross_loader_agreement",
    "runner_target_semantics", "tree_references", "declaration_conformance",
    "release_binding", "producer_admission", "runtime_acceptance",
)


@dataclass(frozen=True)
class Finding:
    code: str
    field: str
    line: int
    column: int

    def diagnostic(self):
        return {"code": self.code, "field": self.field,
                "line": self.line, "column": self.column}


@dataclass(frozen=True)
class CandidateResult:
    exit_code: int
    record: dict | None
    findings: tuple[Finding, ...]

    @property
    def syntax_shape_accepted(self):
        return self.exit_code == 0

    def diagnostics(self):
        return {
            "scope": "candidate-syntax-shape",
            "syntax_shape_accepted": self.syntax_shape_accepted,
            "complete_v1_validity": "not_checked",
            "exit_code": self.exit_code,
            "findings": [finding.diagnostic() for finding in self.findings],
            "checks_remaining": list(REMAINING),
        }


@dataclass(frozen=True)
class _Node:
    kind: str
    value: object
    line: int
    column: int


@dataclass(frozen=True)
class _Leaf:
    kind: str
    maximum: int = 0
    nullable: bool = False
    path: bool = False
    date_format: bool = False


@dataclass(frozen=True)
class _OptionalRecord:
    fields: dict


@dataclass(frozen=True)
class _DynamicRecords:
    fields: dict


class _Rejected(Exception):
    def __init__(self, code, field, line=0, column=0):
        self.finding = Finding(code, field, line, column)


def _fail(code, field, node=None):
    raise _Rejected(code, field, node.line if node else 0,
                    node.column if node else 0)


def _token(value, line, column):
    if len(value) > MAX_TOKEN_BYTES:
        raise _Rejected("FIELD_BOUND", "token", line, column)
    if not TOKEN.fullmatch(value) or value in RESERVED:
        raise _Rejected("GRAMMAR", "token", line, column)
    return value


def _scalar(value, line, column):
    if value == "null":
        return _Node("null", None, line, column)
    if value == "{}":
        return _Node("mapping", {}, line, column)
    if value == "[]":
        return _Node("list", [], line, column)
    if value.startswith('"'):
        if not re.fullmatch(r'"[^"\\]+"', value):
            raise _Rejected("GRAMMAR", "scalar", line, column)
        text = value[1:-1]
        if text.startswith(" ") or text.endswith(" "):
            raise _Rejected("GRAMMAR", "scalar", line, column)
        return _Node("text", text, line, column)
    if value.startswith("["):
        if not value.endswith("]") or len(value) < 3:
            raise _Rejected("GRAMMAR", "list", line, column)
        parts = value[1:-1].split(", ")
        return _Node("list", [_token(part, line, column) for part in parts],
                     line, column)
    return _Node("token", _token(value, line, column), line, column)


def _lines(data):
    if not data or not data.endswith(b"\n"):
        raise _Rejected("BYTE_PROFILE", "document")
    if len(data) > MAX_FILE_BYTES:
        raise _Rejected("FIELD_BOUND", "document")
    for offset, byte in enumerate(data):
        if byte != 10 and not 32 <= byte <= 126:
            line = data.count(b"\n", 0, offset) + 1
            column = offset - data.rfind(b"\n", 0, offset)
            raise _Rejected("BYTE_PROFILE", "document", line, column)
    content = []
    for number, raw in enumerate(data[:-1].split(b"\n"), 1):
        if len(raw) > MAX_LINE_BYTES:
            raise _Rejected("FIELD_BOUND", "line", number, 1)
        if raw.endswith(b" "):
            raise _Rejected("BYTE_PROFILE", "line", number, len(raw))
        text = raw.decode("ascii")
        body = text.lstrip(" ")
        if not body or body.startswith("#"):
            continue
        indent = len(text) - len(body)
        if indent % 2 or indent > 6:
            raise _Rejected("GRAMMAR", "indentation", number, 1)
        content.append((number, indent, body))
    if not content:
        raise _Rejected("KEY_REQUIRED", "root")
    first = content[0]
    if first[1] == 0 and first[2] in LEGACY_LINES:
        raise _Rejected("LEGACY_VERSION", "spec_version", first[0], 1)
    if first[1] != 0 or first[2] != 'spec_version: "1"':
        raise _Rejected("VERSION_LINE", "spec_version", first[0], 1)
    return content


def _mapping(lines, position, indent, depth):
    if depth > 4:
        raise _Rejected("GRAMMAR", "depth", lines[position][0], 1)
    children = {}
    opening_line = lines[position][0]
    while position < len(lines):
        line, current, body = lines[position]
        if current < indent:
            break
        if current != indent or ":" not in body:
            raise _Rejected("GRAMMAR", "mapping", line, current + 1)
        key, rest = body.split(":", 1)
        _token(key, line, current + 1)
        if key in children:
            raise _Rejected("KEY_DUPLICATE", "mapping", line, current + 1)
        position += 1
        if rest == "":
            if position == len(lines) or lines[position][1] != indent + 2:
                raise _Rejected("GRAMMAR", "mapping", line, current + 1)
            node, position = _mapping(lines, position, indent + 2, depth + 1)
        else:
            if not rest.startswith(" ") or len(rest) == 1 or rest[1] == " ":
                raise _Rejected("GRAMMAR", "separator", line, current + 1)
            node = _scalar(rest[1:], line, current + len(key) + 3)
            if position < len(lines) and lines[position][1] > indent:
                raise _Rejected("GRAMMAR", "mapping", lines[position][0], 1)
        children[key] = node
    return _Node("mapping", children, opening_line, indent + 1), position


TEXT100 = _Leaf("text", 100)
TOKEN64 = _Leaf("token", 64)
PATH255 = _Leaf("text", 255, path=True)
OPTIONAL_PATH255 = _Leaf("text", 255, nullable=True, path=True)
TOKEN_LIST = _Leaf("list")
COMMAND = {"runner": TOKEN64, "target": _Leaf("text", 255)}
STACK = {"compose": PATH255, "instance_scope": TOKEN64, "port_policy": TOKEN64}
ROLES = ("setup", "check", "test", "build", "dev", "format_check", "format_write")
SHAPE = {
    "spec_version": _Leaf("text", 1),
    "project": {"id": TOKEN64, "display_name": TEXT100, "owner_entity": TOKEN64},
    "role": TOKEN64,
    "canonical": _Leaf("token", 64, nullable=True),
    "peers": TOKEN_LIST,
    "status": {
        "posture": TOKEN64, "operational_state": TOKEN64,
        "local_phase": _Leaf("text", 400),
        "as_of": _Leaf("text", 10, date_format=True),
    },
    "authority": {"status_of_record": PATH255},
    "presentation": {
        "visibility": TOKEN64, "public_alias": _Leaf("text", 100, nullable=True),
        "link_policy": TOKEN64,
    },
    "development": {
        "platforms": TOKEN_LIST,
        "commands": {
            role: COMMAND if role == "check" else _OptionalRecord(COMMAND)
            for role in ROLES
        },
        "environment": {
            "owner": TOKEN64, "template": OPTIONAL_PATH255,
            "secret_launcher": OPTIONAL_PATH255,
        },
        "stacks": _DynamicRecords(STACK),
        "host_requirements": TOKEN_LIST,
    },
}


def _path(value):
    # Candidate lexical default; no filesystem or tree access.
    parts = value.split("/")
    return (
        not value.startswith("/") and not re.match(r"^[A-Za-z]:", value)
        and all(part and part not in {".", "..", ".git"}
                and part == part.strip(" ") for part in parts)
    )


def _shape(node, rule, field):
    if isinstance(rule, _OptionalRecord):
        if node.kind == "null":
            return
        return _shape(node, rule.fields, field)
    if isinstance(rule, _DynamicRecords):
        if node.kind != "mapping":
            _fail("FIELD_TYPE", field, node)
        for child in node.value.values():
            _shape(child, rule.fields, field + ".*")
        return
    if isinstance(rule, dict):
        if node.kind != "mapping":
            _fail("FIELD_TYPE", field, node)
        unknown = next((key for key in node.value if key not in rule), None)
        if unknown is not None:
            _fail("KEY_UNKNOWN", field, node.value[unknown])
        if any(key not in node.value for key in rule):
            _fail("KEY_REQUIRED", field, node)
        for key, child_rule in rule.items():
            child_field = key if field == "root" else field + "." + key
            _shape(node.value[key], child_rule, child_field)
        return
    if node.kind == "null" and rule.nullable:
        return
    if node.kind != rule.kind:
        _fail("FIELD_TYPE", field, node)
    if rule.maximum and not 1 <= len(node.value) <= rule.maximum:
        _fail("FIELD_BOUND", field, node)
    if rule.path and not _path(node.value):
        _fail("REFERENCE_PATH", field, node)
    if rule.date_format and not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", node.value):
        _fail("DATE_FORMAT", field, node)


def _record(node):
    if node.kind == "mapping":
        return {key: _record(child) for key, child in node.value.items()}
    if node.kind == "list":
        return list(node.value)
    return node.value


def check_candidate(data):
    """Check only C1 bytes/grammar/shape and intrinsic lexical field limits.

    No enum membership, clock, Git/tree resolver, conformance or admission.
    Diagnostics never contain input values or dynamic key names.
    """
    if type(data) is not bytes:
        return CandidateResult(2, None, (Finding("NOT_CHECKED", "input", 0, 0),))
    try:
        lines = _lines(data)
        node, consumed = _mapping(lines, 0, 0, 1)
        if consumed != len(lines):
            _fail("GRAMMAR", "mapping")
        _shape(node, SHAPE, "root")
        return CandidateResult(0, _record(node), ())
    except _Rejected as error:
        return CandidateResult(1, None, (error.finding,))
