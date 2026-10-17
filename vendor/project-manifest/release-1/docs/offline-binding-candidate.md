# Candidate offline byte binding

This unreleased C4 source candidate binds a closed set of bytes. It does not
create, export, install, vendor, sign or approve a release. Complete Specification
1 validity, native conformance, producer admission and runtime acceptance remain
separate. No release artifact or approved consumer lock exists here.

## Trusted consumer bootstrap

A consumer separately reviews and pins `bootstrap/release_verifier.py`, together
with its trusted interpreter and standard library. That bootstrap is outside
the unverified payload and is never imported from it. The consumer also obtains
the expected digest through an independently trusted lock or owner-approved
record. A digest supplied by the payload does not establish trust. The table
contains neither its own digest nor the verifier's digest.

The trusted bootstrap exposes `verify_release(root, expected_digest=...)`.
`root` must be an explicit absolute directory with no symlink component. Before
importing any payload module, the consumer requires exit 0 against its external
digest. The standalone inspection interface may run with Python's isolated
mode, from the trusted bootstrap location:

```sh
python -I -B release_verifier.py --root /absolute/closed-bundle --expected-digest EXPECTED_SHA256
```

This is byte inspection, not an install or release command. Exit 0 means the
candidate bytes match; exit 1 means malformed, changed or mismatched evidence;
exit 2 means the external trust input, root or runtime is unavailable. Findings
are fixed codes and omit payload values and paths. The result retains the
verified public descriptor only on success. Python 3.11 and POSIX directory
descriptors with no-follow opens are prerequisites; that check is not a platform
qualification receipt.

Verification does not lock the filesystem after return. The trusted consumer
must hold the verified snapshot immutable through import and use, or reacquire
and verify it immediately before use. Importing from a concurrently writable
directory after verification is not covered. The verifier neither executes
payload code nor enforces a consumer's isolation boundary.

## Closed table and byte identity

The root contains exactly `release.json` and the twenty sorted paths in the
trusted bootstrap's `PAYLOAD_FILES`, plus only their derived directories. The
set includes the MIT license, all six normative/usage candidate documents, the
six runtime modules, five declaration/acquisition test and fixture modules,
and the corpus and loader-comparison harnesses. The trusted bootstrap and its
own tamper tests are reviewed separately; neither is acquired as payload code.
Origin-only governance, setup pins/lock, source gate and working reports are
not payload. Extra files/directories, missing paths, alternate lexical spelling,
symlinks, hardlinks and special files fail. No root project manifest is part of
this set.

The descriptor has exactly these fields:

| Field | Candidate rule |
| --- | --- |
| format | `candidate-binding-1` |
| origin | `jefahnierocks/project-manifest` |
| spec_version | String `1`; grammar selection alone grants no verdict |
| release_id | `candidate-1`; explicitly unreleased |
| source_revision | Full lowercase 40- or 64-digit source object identity |
| python_minimum | `3.11`; subject to release qualification |
| git_minimum | `2.56.0`; bounded acquisition requirement |
| files | Complete sorted list of exact `path`, integer `bytes`, lowercase SHA-256 |

Canonical encoding is ASCII JSON with sorted keys, separators comma/colon,
`ensure_ascii=True`, no non-finite numbers, and one final LF. Duplicate keys
and any noncanonical encoding fail. Each row binds a path, exact byte length
and content digest. Paths are fixed by the trusted bootstrap, not interpolated
from arbitrary table input. Boolean sizes, duplicate/unsorted/missing/extra rows
and undeclared metadata fail.

The externally expected digest is SHA-256 of the literal ASCII domain
`project-manifest-release-table-v1`, one NUL byte, then the canonical table
bytes. The table thereby binds origin, candidate identity, specification/runtime
claims, source revision and every selected content hash together. Content
hashes establish byte identity, not truthful provenance or approval. POSIX
permissions are observed for safe regular-file reads, not a released executable
mode contract.

Inspection bounds are 65,536 table bytes, 1,048,576 bytes per payload file and
16,777,216 declared payload bytes total. No-follow descriptor-relative reads
check file identity and size before/after; namespace and root identity are
rechecked. Changes cause failure. There is no network, Git child, target command,
environment activation or payload import in verification.

## Corpus and fresh loader evidence

The stdlib harness `python -B tests/run_corpus.py --scope pure` exercises byte and
semantic controls without synthetic Git graphs. CLI tests belong to the full
acquisition lane because some create synthetic Git graphs. `--scope all` also runs
guarded acquisition and, in the trusted origin source, bootstrap tamper tests.
Those fixtures use fixed owned macOS-arm64 or Linux-x86_64 temporary roots.
Other full-acquisition hosts return exit 2 before fixture creation. Linux
full-acquisition qualification requires an actual exact-source execution receipt
from the prepared hosted job. Pure test portability and source-only host support
are not full acquisition qualification and do not qualify other hosts. These are
source test interfaces, not an installed command.

`python -B tests/compare_loaders.py` compares fresh inline synthetic vectors
with already-installed PyYAML SafeLoader/CSafeLoader and Ruby Psych safe loading.
It installs nothing and adds no validator dependency. Every accepted vector
must yield the exact stdlib-reader record; known broader YAML acceptance is
recorded while the strict reader still refuses those bytes. Missing engines
are reported, and other loaders remain not checked. Fresh receipts bind the
exact source snapshot and installed engine versions outside publication source.
Neither an earlier prototype comparison nor this bounded engine sample is
complete release qualification.

The closed normative/runtime/corpus inventory, bootstrap trust mechanism,
approved vocabulary, full platform/runtime corpus, private grammar diagnostic
and consumer trust/binding/admission design require separate owner review before
a complete immutable release is approved. Actual consumer binding and adoption
follow that approved release under their separate gates. C4 adds no exporter,
installer, vendoring command, CI change or runtime operation.

## Released source descriptor profile

The bootstrap now accepts a second explicitly selected engineering profile through
verify_release(root, expected_digest=..., expected_format="project-manifest-release-1").
The default and standalone candidate invocation retain candidate-binding-1.
An unknown expected_format returns BINDING_PROTOCOL / 2 before filesystem access.
A mixed candidate/released table is TABLE_IDENTITY / 1, with no fallback.

The released profile has nine closed fields: format, origin, spec_version,
release_id, source_revision, python_minimum, git_minimum, observation_protocol,
files. Format is project-manifest-release-1; release_id is string 1 and
observation_protocol is project-manifest-git-observation-1. Other fixed headers
retain the existing origin, string specification 1, Python 3.11 and Git 2.56.0
prerequisites. Source-revision/row rules, the twenty payload paths, table hash
domain, canonical encoding, bounds and no-follow/tamper checks are unchanged.
No runtime tuple field or version-equality policy is added.

This interface verifies bytes, not release approval. Its diagnostics use
project-manifest-release-byte-binding-1 and still report release_approval and
complete_v1_validity as not_checked. The bootstrap remains independently reviewed
and pinned outside the payload. A consumer selects its repo-owned reviewed
vendoring binding at its trusted entrypoint, captures verified runtime bytes
before import, and invokes the selected observation protocol once. An argv digest,
table identity, caller Boolean or arbitrary approval file cannot supply that trust.
The six runtime paths remain fixed; module names are not supplied by the table.

No released artifact, export, consumer binding, installation or publication is
created by this source profile. Actual support/qualification receipts, final
immutable release/trust and normal consumer acceptance remain separate.

## Origin-only candidate assembler source

The origin script scripts/assemble-release.py prepares an unapproved local
candidate; it is not distributed as payload or loaded by consumers. Its API is
assemble_candidate(source_root, expected_revision=..., output_parent=...,
common_dir=...). The CLI derives its own source root and takes --source-revision,
--output-parent and optional --git-common-dir. Assembly execution still needs
its task authority; source preparation is not release approval.

The selected full committed OID must equal captured HEAD. Existing C3 FrozenStore
and GitView supply contained literal Git-object reads, tree/index evidence and
source-storage rechecks. Every tracked leaf is a regular file; literal index
object/mode identities and descriptor-relative working bytes must match the
commit. Plain status/diff, source filters/hooks/fsmonitor and export substitution
are not used. The twenty payload bytes come from their verified committed blob
IDs, never from later worktree/index content. The existing source gate alone
does not prove that revision/byte relationship.

Committed ignore files are projected into owned capture storage. Contained
Git check-ignore classifies bounded untracked names against those captured rules,
with its cwd explicitly anchored to the projection and blanket literal-pathspec
mode disabled only for this path-input command. Source configuration is not
imported and ignored file contents are not opened. Nonignored
extra source, changed revision/index/working evidence, unavailable storage or
unexpected mutation stops candidate finalization.

Output parent is an existing no-symlink build/dist directory under this origin,
with a newly exclusive private container. A marker outside the closed staged
bundle identifies ownership. Files are written descriptor-relative with exclusive
no-follow creation. The only shared encoder is the bootstrap's pure
canonical_table_bytes; inventory, headers, domain and bounds come from that
read-only verifier. The assembler verifies the completed stage with the real
released-profile verifier initially and again after final source checks, before
an atomic no-replace local rename to bundle. Output parent, container and retained
staging directories use assembler-local device/inode/type/mode/ownership identities
that permit the assembler's own entry creation; C3's full source identities are
unchanged. Exact container membership and the owner token remain required.
Unavailable atomic no-replace support is coded unavailable, not a weaker fallback.
Finalization is a local candidate operation, never publication or approval.

Temporary capture cleanup and source descriptor closes finish before final output
checks. The unnecessary parent descriptor closes before final closed byte
verification. Every transferred
owned descriptor is closed independently at most once, including after an earlier
close error. Ordinary precommit cleanup failure prevents finalization. Successful
atomic no-replace rename is the commit point: an ordinary final descriptor-close
error preserves exit 0 with CANDIDATE_FINALIZED_CLEANUP_WARNING and the same byte
receipt, without exposing the raw error. The candidate already exists at that point.

The last closed byte verification detects intervening staged-byte mutation during
source checks and cleanup. It does not freeze files against another process
with write access
after verification returns. Mutation between final verification and rename, or
later changes to the candidate, remains outside this assembly receipt; final
immutable artifact freeze and consumer trust require their separate acceptance.

An ordinary precommit failure creates no finalized candidate. Fatal interruption
and concurrent mutation remain outside the receipt, including the interval after
verification or a commit completed before interruption. Partial owned output
remains private for diagnosis; no existing output or foreign marker is overwritten or recursively
removed. A successful fixed-code receipt records actual commit/tree identities,
table digest and relative bundle name, with release_approval/full-v1 not_checked.
No archive/tag/upload/install/consumer-binding or root-manifest action is added.

Origin assembly tests remain in tests/test_binding.py and reuse the existing
owned synthetic Git fixtures, whose plumbing strips inherited Git context.
The gate includes the origin-only script in its 35-file source/corpus-copy set;
PAYLOAD_FILES stays twenty and the six runtime paths, pins and workflow are
unchanged. Actual final artifact freeze requires the private diagnostic and the
owner's exact artifact, bootstrap trust and release acceptance. Consumer binding
and adoption follow the approved release under their separate acceptance gates.
