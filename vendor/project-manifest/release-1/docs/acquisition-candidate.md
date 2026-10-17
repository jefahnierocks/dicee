# C3 bounded offline acquisition candidate

The unreleased adapter supplies repository evidence to the pure
[declaration checker](validation-candidate.md). It never executes project targets,
loads environments, evaluates Compose or mise, fetches objects, discovers
repositories, verifies a release, or establishes complete Specification 1 validity.

## Source invocation and same-observation API

Use trusted Python 3.11+ and Git 2.56+ with the local src directory:

```sh
PYTHONPATH=src python -B -m project_manifest --repo /path/to/repository --rev HEAD --reference-date 2026-01-01
PYTHONPATH=src python -B -m project_manifest --repo /path/to/repository --staged
PYTHONPATH=src python -B -m project_manifest --repo /path/to/repository --worktree
```

Exactly one mode is required. The root defaults to cwd; callers should select
it explicitly. The reference day is explicit or today's UTC day captured once.
Invalid arguments/dates produce value-blind not-checked diagnostics. This is a
source invocation, not an installed/vendor command. The bootstrap reports an
unsupported Python before importing modules with candidate annotation syntax.

Python callers use
`observe_repository(root, mode="rev", rev="HEAD", reference_date="2026-01-01")`.
ObservationResult has exit_code, diagnostics and record/tree only on acceptance.
The tree is exactly the immutable TreeSnapshot consumed by check_declaration.
A pure consumer can use that record and same-observation tree without acquiring
another revision. Input-derived records/tree paths remain data; CLI output omits
both. A rejected/unavailable acquisition supplies neither.

Exit 0 accepts candidate declaration checks; exit 1 rejects a known declaration
or reference; exit 2 means required evidence is unavailable, unsupported, changed
or outside bounds. Every result retains complete_v1_validity: not_checked.
Producer admission and runtime acceptance remain separate.

## Literal observations and provenance

| Mode | Selected evidence | Recorded provenance |
| --- | --- | --- |
| rev | Resolve REV once to a full commit; read its literal complete tree and manifest blob. | Commit/tree/blob IDs, manifest SHA-256 and observation digest. |
| staged | Captured ordinary stage-zero index with Git executable modes and derived directories. | Manifest blob ID/SHA-256 and index-observation digest; no commit/tree claim. |
| worktree | Only index-tracked paths, literal case and no symlink following. | Manifest byte SHA-256 and working-observation digest; no Git blob/commit/tree claim. |

Untracked file contents never enter observation; global excludes do not affect
tracked paths. Working mode hashes tracked regular bytes, literal symlink targets
and observed kinds/modes, then repeats the observation to reject changes.
Deletions are known missing references. Only ordinary version-2 index records are
qualified here; v3/v4, split, skip-worktree, unmerged and intent-to-add indexes
return not checked. Revision mode does not read the unrelated index.
The index debug parser is version-qualified, never a stable Git ABI.

Ordinary repositories support three bounded modes; bare storage supports rev.
Linked worktrees require explicit `--git-common-dir` (Python common_dir)
authority for common storage. Their gitdir pointer must select worktrees/NAME
within that scope with the expected common-dir backlink. Arbitrary external
storage authority is never inferred.

## Containment before Git

Python validates source layout/config, refs, selected index and object metadata
without following symlinks before any Git child. Local/worktree includes,
quoted or dotted core/extensions subsections, unsupported control/Unicode line
separators or syntax padding, worktree redirects, unsupported
reference storage, nonempty object alternates
and grafts are refused without opening outside targets. Config syntax supports
LF/CRLF and ASCII space/tab; ordinary Unicode comments and ignored value text
are retained without Unicode whitespace normalization. Every assignment value
is lexically checked, including ignored keys/subsections: one simple unquoted or
whole double-quoted scalar with optional outside comment. Unsupported escapes,
continuations, mixed/multiline/unclosed quotes are refused before Git. Quoted
ordinary value spaces are preserved; only storage booleans normalize case.
Only top-level objectFormat, worktreeConfig and partialClone extensions are
supported; every other extension is refused, even where native format 0 ignores
it. ObjectFormat sha1/sha256 requires repository format 1. WorktreeConfig true/
false and a supplied simple partialClone string (including explicit empty) are
qualified for formats 0/1; a missing partialClone value is refused. Partial-clone
source config is never forwarded to the child and missing objects never fetch.
No new reference/storage implementation is added. Inherited Git
repository/config/storage overrides are refused, including external shallow-file
and graft-file environment paths before any source acquisition or Git child.

Git receives only an owned temporary metadata view: fresh minimal bare config,
validated refs/index, compressed loose-object copies and pack paths bound to
already-open read-only file descriptors. It never evaluates source config. Replacing a source object pathname
with an outside symlink cannot redirect a read. Loose objects are copied by
sequential no-follow reads, with initial identity/hash captured and rechecked;
pack files stay descriptor-bound. Raw decoded Git content is not copied to the view. Rechecks reject source metadata, layout,
object identity and index drift, including initial linked common-dir identity.

The child retains HOME. System/global config is excluded only for literal object
and tracked-index operations; no untracked discovery or ignore verdict occurs.
The minimal config omits hooks, filters, fsmonitor, aliases, credentials and
remotes. Flags separately suppress lazy fetching, replacement objects, optional
writes and submodule recursion; protocols/prompts are disabled. Git launches
without a shell. Raw child output/errors never enter diagnostics.

Selected commit/manifest and all acquired tree objects have their literal Git
hashes checked. Referenced regular blob availability/type is checked; referenced
content is not interpreted or executed. Missing/corrupt objects and source changes
return not checked, without repair, refresh or retry.

## Bounds and qualification

| Resource | Candidate bound |
| --- | --- |
| Metadata child output including stderr | 8 MiB |
| Copied source metadata in aggregate | 32 MiB |
| Index file | 16 MiB |
| Object storage | 512 MiB physical bytes; 128 descriptors for pack/idx files |
| Compressed loose snapshot | 20,000 files; 16 MiB per file; 64 MiB aggregate |
| Parsed entries including derived directories | 20,000 |
| Path | 1,024 bytes; 16 segments |
| Directory names | 20,000 per directory; 40,000 per observation |
| Working regular bytes | 64 MiB per file; 256 MiB per pass |
| Git child | Five seconds per call; bounded pipes; owned process-group cancellation |
| Observation | Thirty-second aggregate deadline checked during acquisition, parsing and revalidation |

Large databases, outside alternates, changed storage, unsupported formats/hosts
and exhausted bounds return not checked. The adapter never enlarges limits,
runs GC, installs tools or weakens permissions to obtain a verdict. Local
qualification is macOS arm64, Git 2.56 and POSIX `/dev/fd` descriptor binding.
Bounded loose copies cost additional RAM/temporary storage, avoiding descriptor
exhaustion for ordinary stores without mutating/repacking them. Generic platform
declarations do not expand acquisition qualification; other
hosts/future layouts need fresh evidence. The source-only Linux-x86_64 hosted
job is prepared for that evidence; no execution receipt follows from preparation.
It preserves all safety bounds and uses lock-authoritative Python/Gitleaks,
separate exact floor/Git qualification pins and an owned temporary tool prefix.
Git source trust is its official HTTPS-published checksum, not a tar-signature
verification claim. No runtime module or acquisition acceptance rule changes.

The source gate runs exact source copies and guarded synthetic Git graphs in
ownership-marked `/private/tmp/project-manifest-c3-*` roots on macOS arm64 or
`/tmp/project-manifest-c3-*` roots on Linux x86_64, outside harvested roots. Graphs use fresh generic bytes/raw synthetic identities, never source
commits, real project manifests or producer inventory. Successful fixtures are
removed after outcome; unexpected failures retain owned roots and stop the gate.
Earlier C2 passes never qualify amended C3 source.

Development contract policy is owner-frozen as of 2026-10-13.
Activation/native conformance, broader
runtime/cross-loader qualification, complete release binding, offline vendoring,
producer admission and live acceptance remain separate.

## Git source contracts

The adapter uses [Git command/environment controls](https://git-scm.com/docs/git),
[commit resolution](https://git-scm.com/docs/git-rev-parse),
[literal object reads](https://git-scm.com/docs/git-cat-file) and
[NUL-delimited index output](https://git-scm.com/docs/git-ls-files).
The index debug format can change; unsupported output is refused.

## Released source observation protocol

The new API in project_manifest.acquire is observe_released_repository(root,
mode=..., reference_date=..., rev=..., common_dir=...). It normalizes the explicit
reference day through the existing day checker and calls observe_repository once.
Candidate CLI/API behavior is unchanged. The accepted record and same immutable
TreeSnapshot are returned by identity, without another declaration check,
acquisition or caller-tree acceptance lane. Interrupt/cancellation propagates.

The diagnostics mapping has exactly fourteen keys: scope, exit_code,
declaration_checks, complete_v1_validity, findings, mode, reference_date,
commit_oid, tree_oid, manifest_blob_oid, manifest_sha256, observation_digest,
git_version, tree_observation. Scope is project-manifest-git-observation-1.
Declaration status remains 0/1/2 with passed/failed/not_checked respectively.
Complete-v1 validity is always not_checked in direct source output; independently
reviewed consumer approval/binding and authenticated acquired evidence are needed
to derive valid/invalid. Native conformance/admission/runtime acceptance remain
separate, and later conformance exits cannot replace the declaration result.

A passed result has no findings and retains the record/tree. Failed/unavailable
results have neither. One finding contains only the existing fixed code and
nonnegative bounded integer line/column; field names, raw acquisition reasons,
paths and records are omitted. The existing twenty code identifiers are closed;
NOT_CHECKED means unavailable, never a known-invalid declaration. Inconsistent
candidate or pure-tree results become unavailable rather than being promoted.
Every optional provenance key is present, using null for unavailable evidence.

Known invalid results retain reliable mode-specific observation metadata and the
explicit request day, including missing/nonregular/oversized or syntax-invalid
manifest cases. Rev records full commit/tree and available manifest-blob identity;
staged has no commit/tree claim; worktree has no blob/commit/tree claim. Object IDs
have one consistent 40/64 width. Acquired accepted bytes bind manifest/observation
SHA-256 and measured Git version. Unavailable acquisition attests no partial
provenance. The three tree_observation values remain frozen-revision-tree,
frozen-stage-zero-index and tracked-working-bytes; only rev is committed evidence.

This serialization profile changes no C1/C2 rule, storage bound or runtime
prerequisite. It adds no release approval, discovery, execution, runtime equality
allowlist or installed host reader. Changed source must receive its own executed
qualification; earlier candidate/hosted receipts do not qualify these new bytes.
