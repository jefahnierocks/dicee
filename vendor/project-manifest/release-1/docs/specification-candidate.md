# Specification candidate: C1

This is an unreleased design and implementation candidate. The implemented
API accepts a byte document for syntax and closed field shape only. Acceptance
is never a complete Specification 1 verdict, a release, or permission to act
on a declaration. [C2](validation-candidate.md) adds implemented semantic and
pure tree-record checks through a separate API; this byte API retains its scope.

The [field table](field-table.md) inventories the intended contract, including
semantic rules not implemented here. The [enum worksheet](enum-provenance.md)
records missing authority inputs. YAML 1.2 is informative: this bounded line
grammar defines candidate acceptance. Fresh cross-loader comparison is still
required before release; no earlier prototype result qualifies these bytes.

## Byte and line grammar

Inputs are exact Python bytes. A document contains only printable ASCII
(0x20 through 0x7e) and LF (0x0a), ends with LF, and contains no trailing space
on any line. BOM, CR, TAB, DEL, all other controls, Unicode and invisible
characters are rejected before parsing. Lengths therefore count bytes.

The file limit is 65,536 bytes, including every LF, comment and blank line.
A line limit of 2,048 bytes counts its content and indentation, excluding LF.
An empty file is invalid. Empty lines and full-line comments may occur anywhere,
including before the version. A comment begins with # after optional spaces.
Comment indentation has no structural meaning; even odd or deep indentation
is allowed within the line limit. Whitespace-only lines fail the trailing-space
rule. These precise choices are candidate defaults requiring freeze review.

The first content line has zero indentation and is exactly
`spec_version: "1"`. There is no additional key ordering requirement.
Other versions or spellings get `VERSION_LINE`, except the three source-confirmed
exact legacy lines: `spec_version: 0.1`, `spec_version: "0.1"` and
`spec_version: '0.1'`. These produce `LEGACY_VERSION` and no accepted record.
This class permits later producer dispatch; it never accepts legacy as version 1
or expands its whitespace/comment grammar.

Content uses block mappings. Root keys have zero indentation; each child
level adds exactly two spaces. Four key-path levels are allowed, including
command-role and dynamic stack-name levels. Indentation cannot skip a level.
A key followed immediately by a colon and LF opens a nonempty child mapping.
A scalar entry is a key, colon, exactly one space, scalar and LF. There is
no space before the colon. A scalar cannot have indented children.

Keys and unquoted scalar tokens match:

`[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*`

They have at most 64 bytes and exclude `y`, `n`, `yes`, `no`,
`on`, `off`, `true`, `false` and `null`. Separators cannot be
leading, trailing or adjacent. Mixed single hyphens and underscores are
allowed in general tokens as a candidate default. Fixed keys are the literal
snake_case names in the table; only stack names are dynamic general tokens.
Enum spelling and membership have separate, unresolved release rules.

A scalar is one of:

- A token.
- Nonempty double-quoted printable ASCII text with no interior quotation mark
  or backslash and no leading or trailing space. There are no escapes.
  Literal # and colon inside quotes are text, not comment syntax.
- The exact unquoted literal `null`, permitted only at listed nullable fields.
  Quoted `"null"` is text and is never converted into null.
- `[]`, or a nonempty single-line token list with exactly comma-space between
  items, such as `[example-one, example_two]`. There are no edge spaces.
- `{}`, an empty mapping, accepted only where the shape permits it.

This byte API preserves list order and duplicate items. The separately
approved declaration policy rejects peer/platform/requirement duplicates and
preserves order; the owner froze that policy on 2026-10-13. Empty collections must use their explicit spelling; bare empty
mapping openers and alternate spaced flow empties are invalid.

Duplicate keys, unknown keys and missing required keys are rejected.
No extension namespace exists. Nonempty flow maps, block sequences,
anchors, aliases, tags, merges, document markers, single-quoted strings,
inline comments and block or multiline scalars are forbidden. Input is not
handed to a general YAML loader.

## Intrinsic field checks

The reader preserves token, text, null, list and mapping kinds until after
shape validation. Parent records are never nullable. Only the six optional
command records, canonical ID, public alias, environment template and secret
launcher can be null. The check role must be a record.

Text bounds are 1 through 100 bytes for display names and aliases; 1 through
400 for the phase; and 1 through 255 for path fields. All tokens are bounded
at 64. Command targets receive a provisional 1 through 255 text bound only:
the owner-frozen runner-specific task maximum of 64, task spelling, script-
path interpretation and argv prohibition belong to the separate declaration
API and are not implemented by this byte-only API.

Date text is exactly the lexical pattern `[0-9]{4}-[0-9]{2}-[0-9]{2}`.
Calendar validity, an explicit UTC reference date and future-date rejection
are still missing. A lexically accepted date can be impossible.

Path fields use slash-separated, nonempty ASCII segments; absolute and
drive-prefixed paths, dot, dot-dot and exact lowercase .git segments fail.
Segments cannot have edge spaces. This is case-sensitive lexical checking:
case variants such as .GIT are not silently canonicalized. No tree lookup,
existence, exact-case resolution, tracked/regular-file test, symlink/submodule
inspection or executability check occurs in this byte API. The declaration
API separately enforces the owner-frozen case-insensitive .git reservation
and exact tree-reference rules; that policy was accepted on 2026-10-13.

## API and findings

Import `check_candidate` from `project_manifest` with the local `src`
directory on Python's import path. The function performs no I/O, Git command,
clock read, configuration evaluation, command execution or logging.

It returns a CandidateResult:

- `exit_code == 0` and `syntax_shape_accepted == True` mean only the checks
  described here passed. The normalized record is available as programmatic
  data, with null as None and ordered lists retained.
- `exit_code == 1` means candidate rejection and no record.
- `exit_code == 2` means not checked; currently only a non-bytes input uses
  this result. Source acquisition, runtime compatibility and Git modes are
  not part of this API.

The `diagnostics()` method always declares `candidate-syntax-shape` scope
and `complete_v1_validity: not_checked`. It omits the record and lists
remaining checks. Findings include only a code, predefined field class,
one-based line/column or zero for a document-wide location. A dynamic stack
name is replaced by a wildcard field class. Offending values, dynamic names
and paths are never echoed. Accepted records contain input data and must
not be mistaken for safe diagnostic output.

Candidate codes are `BYTE_PROFILE`, `GRAMMAR`, `VERSION_LINE`,
`KEY_REQUIRED`, `KEY_DUPLICATE`, `KEY_UNKNOWN`, `FIELD_TYPE`,
`FIELD_BOUND`, `REFERENCE_PATH`, `DATE_FORMAT`, `LEGACY_VERSION` and `NOT_CHECKED`.
These are provisional names, not a published compatibility interface.
The first failure is reported. Document-wide final-LF, file-size and byte
checks run before line parsing. For each line in source order, length and
trailing-space checks precede its content-indentation check. The first content
line's exact version is checked after this pass; mapping grammar and shape
follow. Each closed record checks unknown keys, missing keys and then its
fields in the table's fixed order. Reordering content can change which
failure appears first.

## Freeze and later implementation

The selected intended contract uses canonical uniformly, with null exactly
for canonical role, and the full development shape. Those selected decisions
are not reopened by the reader's scope limits. The owner froze the reviewed
development contract policy on 2026-10-13; complete release work remains:

- Bind the adopted five-domain snapshot and [frozen development policy](validation-candidate.md#proposed-development-policy-freeze)
  into the complete immutable release; source policy approval is not release approval.
- Integrate the source-confirmed legacy rejection with the producer dispatch contract.
- Preserve implemented calendar/reference-date and settled canonical/self/peer
  relations; qualification of the complete normative/runtime envelope remains separate.
- Qualify native role/task/activation and Compose safety in project/consumer
  acceptance. Frozen declaration rules for targets, literals and references
  never execute project code or prove those effects.
- Name the first pilot consumer for platforms, stacks and host requirements.
  Platform claims do not prove portability; unsupported host operations are
  neither inferred nor invoked.
- Extend the [C3 bounded modes](acquisition-candidate.md) only with fresh safety
  and platform evidence; separately qualify release binding and offline vendoring.
- Obtain producer runtime requirements, approve the validator minimum and
  run fresh pinned cross-loader comparison. The bootstrap Python pin is
  execution evidence on one host platform, not the release minimum.
- Complete the owner-authorized private grammar diagnostic and producer
  admission/identity evidence in their own lanes.

A complete immutable release must bind specification, field rules, approved
enum snapshot, reader, corpus and all artifact hashes together. Selection of
a shape version alone cannot reproduce a verdict. New values or changed
verdict rules require a new complete release, producer-first support and
owner approval. C4 implements an unreleased [closed byte-binding candidate](offline-binding-candidate.md)
and separately trusted consumer bootstrap; no vendor command or release artifact
is implemented here. External expected trust and pre-import verification are
mandatory; self-reported payload digests do not establish trust.

Declaration validity eventually includes grammar, fields and tree references.
Declaration conformance separately checks native task/role/environment claims.
Producer admission checks joins and accepted authority/evidence. Runtime
acceptance checks actual systems. None grants another layer's approval.

No discoverable repository-root v1 manifest may be introduced under harvested
roots or this origin before landed lock-only producer admission. C1/C2 keep
vectors inline. C3's owner-authorized synthetic graphs stay in guarded system
temporary roots outside harvested roots. No producer discovery, enrollment,
migration, publication or runtime operation is performed.
