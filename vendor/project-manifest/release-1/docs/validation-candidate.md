# C2 candidate declaration validation

This unreleased extension adds executable semantic and exact-tree checks to
the [byte and shape reader](specification-candidate.md). It does not acquire
Git objects, verify a release or establish complete Specification 1 validity.

## Pure interface and evidence

Import `TreeEntry`, `TreeSnapshot` and `check_declaration` from
`project_manifest` with the local src directory on Python's import path:

```python
tree = TreeSnapshot((
    TreeEntry("docs", "directory"),
    TreeEntry("docs/status.example", "file"),
    TreeEntry("tools", "directory"),
    TreeEntry("tools/check.example", "file", executable=True),
))
result = check_declaration(document_bytes, tree=tree, reference_date="2026-01-01")
```

Tree records and document vectors are in memory; no fixture repository or
manifest file is created. The snapshot is caller-supplied and unverified.
It must declare completeness and contain a tuple of immutable TreeEntry
records. Every directory component is explicit; the root is implicit.
Records may be in any order. Duplicate paths, missing/non-directory parents,
unknown kinds, malformed paths or flags, and incomplete snapshots return
not checked. Kinds are file, directory, symlink and submodule. Only files
can carry a Boolean executable flag. No symlink target or submodule content
is represented or followed.

Unrelated tree names may be Unicode, but document references remain ASCII.
Tree paths cannot be empty, absolute, drive-prefixed, contain control bytes
or have empty/dot/dot-dot segments. Snapshot structure is validated without
filesystem access. Its completeness assertion is caller testimony, not proof
that records match a repository, revision or index.

The reference day is required: either an exact stdlib date or a valid
YYYY-MM-DD string. Datetime, missing values and malformed/impossible dates
return not checked. The API never reads a clock. Successful and semantic/tree
failure diagnostics record the normalized supplied reference day.

## Implemented semantics

The stated as_of must be a real Gregorian calendar date no later than the
reference day. Old dates never expire solely through age.

Canonical is uniformly required. It is null exactly when role is canonical;
otherwise it names an ID different from the project's own ID. Peers exclude
the own ID. C2 checks all five owner-adopted manifest enum sets described in the
[snapshot](enum-provenance.md). Cross-project ID/entity membership and
uniqueness remain producer responsibilities.

Peer, platform and requirement lists reject duplicates as an explicit C2
candidate default. Order is preserved. Empty platforms means no platform
claim; acceptance never supplies a portability receipt. The declaration API
checks candidate membership in macos-arm64, macos-x86_64, linux-arm64, linux-x86_64,
windows-arm64 and windows-x86_64. Unknown-axis tokens are excluded by
candidate policy; the generic axes themselves provide no pair restriction.
Activation-owner membership is implemented for none/direnv/mise/project;
the owner froze this contract policy on 2026-10-13; actual activation behavior
and complete release approval remain separate.

The producer runtime floor is Python 3.11+, so the declaration API uses that
candidate floor and returns not checked below it when import is possible.
The contract gate uses the project's pinned Python 3.13.16; supported-floor
qualification runs the same pure corpus separately on installed Python 3.11.
The version-guard test alone simulates branches and is not a live floor receipt.
The source CLI bootstrap enforces the floor before importing candidate
annotations on unsupported runtimes; branch simulation is not a live receipt.

## Candidate development policy

The owner froze these exact closed sets as contract policy on 2026-10-13.
They are not an approved complete immutable release:

| Field | Candidate policy |
| --- | --- |
| Activation owner | none, direnv, mise or project |
| Command runner | script or mise |
| Stack scope | host or checkout |
| Stack port_policy | unpublished or loopback_only |
| Host requirement | container_engine or android_sdk |

Activation owner selects project activation and non-secret configuration loading:

- none: no project activation/loading; a documentation-only template may exist.
- direnv: `.envrc` coordinates activation, including use-mise when appropriate;
  mise still owns runtime selection.
- mise: direct mise-native activation/non-secret configuration loading.
- project: tracked command-scoped native loading; there is no per-tool owner enum.

The exact set is closed; native is not an alias. Owner, template and secret_launcher
are independent declarations. No template/launcher is implied by an owner, and
their presence does not force a different owner. A null launcher declares that
no role uses secrets. Loader/task existence, activation effects and secretless
check behavior are separate conformance; no environment is loaded here.

Nonempty stacks require container_engine. Each non-null script role references
a supplied-tree regular executable file; all seven command roles use the same
rule. Optional environment templates reference regular files. Non-null secret
launchers reference regular executable files. Stack Compose declarations
reference regular files without parsing/interpolation. Null launcher means no
role may use secrets; that behavioral assertion remains conformance work.

Script and launcher paths use a candidate portable alphabet:
ASCII letters/digits, dot, underscore, hyphen and slash only. Segments must also
satisfy the path rules; spaces and shell/argv characters are rejected. The path
limit is 255 bytes. Paths are literal references, never executable authorization.

Mise targets are native task names, not file paths or argv. Their candidate
spelling is one or more lowercase token-shaped segments separated by single
colons, at most 64 bytes total. Single hyphen/underscore separators are allowed
within a segment; leading/trailing/adjacent separators fail. Examples such as
check and format:check describe task syntax, not approved project tasks.
Quoted task names need not exclude YAML reserved words. Task existence and role
effects require separate native-file conformance; mise is never evaluated.

## Proposed development-policy freeze

The owner accepted the exact reviewed table below on **2026-10-13** as
contract policy. The historical heading is retained for stable section links.
This decision does not approve a release, publication, migration or runtime
acceptance. The frozen literal sets and bounds are:

| Decision | Accepted contract rule |
| --- | --- |
| Platform tokens | macos-arm64, macos-x86_64, linux-arm64, linux-x86_64, windows-arm64, windows-x86_64; empty means no platform claim |
| Runner tokens | script or mise; every non-null command role uses the same runner-specific rules |
| Activation owner tokens | none, direnv, mise or project, with the independent template/launcher semantics above |
| Stack keys and tokens | compose, instance_scope and literal port_policy; scope host/checkout; policy unpublished/loopback_only |
| Requirement tokens and implication | container_engine/android_sdk; any nonempty stacks require container_engine |
| List policy | Peer, platform and requirement duplicates are invalid; retain declared order; no deduplication or inferred values |
| Script/launcher targets | Literal relative portable paths, maximum 255 bytes, exact regular executable tree reference, no .git component in any letter case or argv |
| Mise targets | Quoted task names, maximum 64 bytes, lowercase token segments separated by single colons; no path/argv interpretation or task evaluation |
| Token spelling | Retain current literal underscore-bearing values, including container_engine, android_sdk and loopback_only; no blanket kebab-only restriction |

General bare tokens continue to allow single hyphen or underscore separators.
Closed sets require exact literal membership; aliases, case folding and hidden
normalization are excluded. A future replacement of existing underscores with
hyphens requires a new owner decision with compatibility and release review. The five generic manifest domains, uniform canonical
relation and full development shape are settled and are not reopened here.
These development rules are owner-frozen contract policy. Native task/effect/
activation and Compose safety acceptance are not implied; complete release
and pilot/runtime acceptance remain separate.


## Exact-tree references

All declared paths are relative, nonempty slash-separated ASCII segments.
Dot/dot-dot, absolute/drive-prefixed paths and .git in any letter case fail.
C2's case-insensitive reservation is an explicit candidate default; actual
tree lookup is always byte-exact and case-sensitive.

Each component must be present in the complete supplied tree. Intermediate
components must be directories; final components must be regular files.
Symlink, submodule or directory at a final file path is invalid. Executable
references additionally require the executable flag. A wrong-case or absent
path in a known complete snapshot is invalid. Unavailable, incomplete or
internally inconsistent evidence is not checked, never an empty healthy tree.

The pure API reads no referenced content and performs no Git, filesystem,
network, process or runtime operation. Its caller records remain unverified.
The separate [C3 adapter](acquisition-candidate.md) acquires bounded evidence
and exposes the exact TreeSnapshot used by C2 beside accepted Python records.
A staged or working observation is never mislabeled as a committed verdict.

## Declaration corpus coverage

This is the single finite rule-to-fixture index. IDs below are local documentation
labels, not published diagnostic or observation-protocol identifiers. Normative
clauses remain in the [grammar](specification-candidate.md),
[field inventory](field-table.md), [enum snapshot](enum-provenance.md) and the
policy sections above. A shared guard can cite a common boundary test plus its
positional loop; method names alone are not evidence of every loop case.

Fixtures are fresh inline synthetic bytes and supplied tree records. C1 checks
bytes and shape; C2 adds declaration semantics and tree evidence. Neither validates native task effects,
producer membership, release trust or runtime acceptance. Boundary/unavailable
classes are explicit below; inapplicable classes are not silently counted as passes.

Test prefixes: **C** = `tests/test_candidate.py:CandidateTests`, **D** =
`tests/test_validation.py:DeclarationTests`, **A** =
`tests/test_acquisition.py:AcquisitionTests`, **B** =
`tests/test_binding.py:ReleaseBindingTests`, **L** =
`tests/test_candidate.py:LoaderComparisonTests`, and **R** =
`tests/test_acquisition.py:ReleasedObservationTests`. Implementation symbols are in
`src/project_manifest/candidate.py` (C1), `validation.py` (C2), `acquire.py` (C3),
the separately trusted `bootstrap/release_verifier.py` (C4), or the optional
preparation harness `tests/compare_loaders.py` (L).

| Local ID / exact clause | Implementation | Positive, refusal and boundary/unavailable fixture cases |
| --- | --- | --- |
| C1-01: LF printable ASCII; file 65,536 bytes, line 2,048 content bytes; comments/blanks count | `_lines` | C.test_bytes: empty/missing final LF, BOM, NUL/tab/CR/DEL, non-ASCII, invisible and combining/homoglyph prefixes, CRLF/trailing spaces refused. C.test_file_and_line_boundaries: exact file 65,536 accepted / 65,537 refused, line 2,048 accepted / 2,049 refused. C.test_comments_blanks_and_unordered_keys: pre-version/end/interior and odd/deep comment indentation accepted. Non-bytes is unavailable, not grammar invalid: C.test_wrong_input_type_not_checked (str/bytearray/None/int/memoryview). |
| C1-02: first content is exact quoted version 1; three exact legacy lines rejected distinctly | `_lines`, `LEGACY_LINES` | C.test_version_line: quoted 2, bare 1, 0.10 forms, extra spacing/indent/comment, missing/duplicate version; the exact bare/double/single-quoted 0.1 forms produce LEGACY_VERSION. D.test_legacy_forms_remain_invalid_and_dispatchable repeats all three with/without intro comment and rejects 0.10 as VERSION_LINE. Producer dispatch is outside this index. |
| C1-03: block maps, exact two-space levels, depth four, key/scalar separation; no broader YAML forms | `_mapping`, `_scalar` | C.test_spacing_indentation_and_depth: odd/skipped indentation, missing/double separator/space-before-colon, empty opener, fifth-level child; six list-spacing failures plus accepted comma-space list. C.test_prohibited_forms: anchors/aliases/tags, nonempty flow map, block/multiline scalars, single quotes, inline comments, document/merge/sequence/explicit-key markers. C.test_comments_blanks_and_unordered_keys accepts root reorder. Required map empties use C1-04 below. |
| C1-04: fixed keys all required, closed records; nullable only at ten positions; dynamic stack-name map | `_shape`, `SHAPE`, `_OptionalRecord`, `_DynamicRecords` | C.test_every_fixed_field_is_required_even_when_nullable removes all 51 independent fixed positions; version removal is C1-02; sole authority child uses explicit empty map. C.test_nullability_of_every_fixed_record_and_leaf covers all 51, ten nullable positions and present stack-record null refusal. Duplicate loop covers eleven mapping contexts; unknown/missing loops cover fixed mapping classes. Dynamic stack names have no fixed-key unknown case: other_stack-name accepted, token bounds apply. C.test_nonnullable_records_and_leaf_types covers mapping/list/text/token/optional-record mismatches. |
| C1-05: lowercase token/key alphabet, single hyphen/underscore separators, 1–64 bytes, reserved words excluded | `_token`, `TOKEN`, `RESERVED` | C.test_token_boundaries_and_reserved_spellings: a / 64 bytes / a-b_c2 accepted, 65 refused; reserved y/n/yes/no/on/off/true/false and case/numeric/separator probes refused; null has wrong token-field type, [null] is grammar invalid; dynamic name 64/65, yes/a--b cases. Common `_token` guards keys, scalar tokens and list items. Empty token is not a valid representation. |
| C1-06: quoted nonempty ASCII text, no escapes/edge spaces; bounds 100/400/255 by field; null distinct from quoted text | `_scalar`, `_shape`, `_Leaf` | C.test_text_boundaries: display/alias 100, phase 400, target 255 each at 1/max/max+1, empty and edge-space/backslash/quote refusals. C.test_quoted_punctuation_and_null_text: literal #/colon/brackets/braces retained, alias quoted null remains text, quoted null is invalid for canonical token-or-null. C.test_full_development_shape exercises populated optional records/text. |
| C1-07: literal relative ASCII paths, no empty/dot/dot-dot/drive/lowercase .git segment; 1–255 | `_path`, `_shape` | C.test_path_boundaries_and_lexical_rules loops authority/template/launcher/Compose: 1/255 accepted, 256/empty and twelve unsafe spellings refused. Uppercase .GIT is deliberately accepted by C1 lexical scope and separately refused by C2. Command target is C1 quoted text until runner-specific C2 checks. No filesystem unavailability class belongs to C1. |
| C1-08: quoted YYYY-MM-DD lexical form; byte reader preserves list order/duplicates and defers semantics | `_shape`, `_record` | C.test_date_format_and_semantic_deferrals: format/type/length failures, but impossible lexical dates, own canonical/peer, duplicate lists and 255-byte mise target are accepted by C1. C.test_full_development_shape asserts ordered two-peer record. Calendar/membership/duplicate policy belongs to C2; loader representations L-01 are not semantic products. |
| C2-01: exact supported runtime and explicit real reference day; Gregorian as_of ≤ supplied day, no age expiry | `check_declaration`, `_reference_day`, `_semantics` | D.test_runtime_floor_guard_is_not_live_minimum_evidence simulates 3.10/3.11; actual runtime receipts remain separate. D.test_valid_normalized_record_and_explicit_replay compares exact date and string replay. D.test_calendar_dates_and_future_boundary: eight year/month/day/nonleap/future refusals, four min-year/2000/2024-leap/equality positives and reference 9999. D.test_reference_date_evidence_not_checked: None/bytes/malformed/impossible/year-zero/Z/datetime/int yields 2, not invalid declaration. |
| C2-02: five adopted domains; canonical null iff canonical role; canonical/peer exclude own ID | `_semantics`, `MANIFEST_ENUMS` | D.test_all_five_owner_adopted_enum_sets_and_unknown_rejection loops 5 role / 11 posture / 8 state / 5 visibility / 2 link values; each domain unknown plus wrong-domain role refused. D.test_selected_uniform_canonical_and_own_id_rules covers null/referenced canonical, own-ID and own-peer refusals plus unrelated peer. Cross-project membership/uniqueness is producer-owned, not an unavailable lookup invented here. |
| C2-03: peer/platform/requirement duplicates invalid, preserve declared order; six platform literals, empty no claim | `_unique`, `_semantics` | D.test_list_uniqueness_and_empty_platform_claim has all three duplicate classes and empty/singleton positives. D.test_candidate_platform_domain_is_closed_and_empty_remains_no_claim has all six literals and four unknown-axis refusals. D.test_distinct_list_order_is_preserved_with_stack_engine_independent_of_order has three distinct two-item list classes in both orders, with stack engine implication in both requirement orders. No normalization or portability receipt is inferred. |
| C2-04: every non-null role runner is script/mise; literal executable script path 255 or native task spelling 64 | `_semantics`, `TASK`, `_safe_path`, `_references` | D.test_closed_candidate_runner_vocabulary, test_task_spelling_and_bounds (1/64/65, reserved quoted true, namespace/separator/path/argv failures), test_script_target_literal_path_and_bounds (255/256 plus argv/.GIT failures). test_each_command_role_requires_executable_script loops six optional roles positive/missing and required check missing/mode; test_optional_script_roles_require_their_own_executable_mode uses separate optional file per role. test_mise_target_rules_in_every_role_do_not_check_native_existence loops all seven with 64/65/path/unsupported runner while denying I/O. Native task existence/effects are outside declaration rules. |
| C2-05: activation owner closed; owner/template/launcher independent; optional references and launcher executable | `_semantics`, `_references`, `_check_reference` | D.test_activation_owner_domain_and_rejected_alias: four owners, native/sample/python/unknown refused. test_activation_template_and_secret_launcher_are_independent: 4 owners × 2 template states × 2 launcher states = 16 positives. test_environment_optional_references_and_launcher_mode covers regular presence/absence, missing references, launcher mode and unsafe executable path. Null launcher’s behavioral secret claim needs consumer conformance. |
| C2-06: nonempty stacks imply container_engine; scopes host/checkout, port policies unpublished/loopback_only; Compose regular file | `_semantics`, `_references`, `_check_reference` | D.test_stack_requirement_scope_policy_and_compose: both scopes/policies, unknown values, Compose missing, missing engine implication; android_sdk positive/unknown requirement refusal. C1-04 supplies stack closed-key/null/empty-map cases. Native Compose parsing/ports/concurrency is not declaration acceptance. |
| C2-07: complete coherent immutable caller tree; literal case/kind/parent/executable references, no link following | `_tree_index`, `_check_reference`, `_safe_path` | D.test_exact_case_lookup_and_directory_nodes: three case variants/final directory refused, reversed records/unrelated Unicode accepted. test_symlink_and_submodule_components_are_never_followed: both kinds at final/reference parent/executable target. test_git_reservation_and_literal_nonexecutable_paths covers .git casefold reservation and literal nonexecutable space path. test_unavailable_or_malformed_tree_is_not_checked names incomplete/mutable/nonentry/type/path/parent/duplicate/kind/flag cases yielding 2; known-empty complete tree gives REFERENCE_MISSING / 1. |
| C2-08: first phase ordering, coded value-blind diagnostics and no native I/O/clock; candidate not released verdict | `check_declaration`, `DeclarationResult.diagnostics`, `Finding.diagnostic` | D.test_syntax_then_semantics_then_evidence_order; diagnostic marker cases cover values/paths/dynamic keys and silence; test_no_filesystem_process_network_or_clock_operations denies native I/O; test_policy_approval_is_not_release_native_or_runtime_acceptance keeps remaining gates and complete_v1_validity not_checked. C.test_diagnostics_are_value_blind_and_silent supplies byte-parser findings. |

### Acquisition and binding evidence partitions

These partitions reference existing safety corpora; they do not add declaration
semantics. The detailed [acquisition envelope](acquisition-candidate.md) and
[candidate binding](offline-binding-candidate.md) remain authoritative for their
own modes, limits and external trust. A mapped case is not complete release approval.

| Local ID / clause | Implementation | Inspected fixture cases and evidence class |
| --- | --- | --- |
| C3-01: explicit rev/staged/worktree; mode-specific provenance, no source execution | `observe_repository`, `ObservationResult`, CLI `main` | A.test_valid_rev_staged_and_worktree_have_actual_mode_provenance loops three modes and object-ID presence/absence. test_source_selection_distinguishes_object_index_and_working_bytes, test_replay_is_stable_and_changed_working_bytes_change_digest; tests/test_cli.py:test_source_module_cli_exits_and_never_prints_record checks coded source output with no record. Staged/worktree are observations, not committed verdicts. |
| C3-02: exact reference case/kind/mode, measured working metadata | `_references`, `_tree`, `_index`, `_working`, `observe_repository` | A.test_missing_wrong_case_nonexecutable_symlink_and_gitlink_references is five failure classes × three modes. test_working_mode_is_measured_instead_of_taken_from_index and case-only rename distinguish real working state. Pure tree cases remain C2-07. |
| C3-03: qualified local storage, config namespaces/versions, no implicit fetch/hooks/includes | `_config`, `FrozenStore`, `GitView`, `bounded_process` | A.test_all_storage_keys_refuse_subsections_in_common_and_worktree_config: two locations × two styles × seven keys. Unknown extensions tested in versions 0/1; objectFormat sha1/sha256 × versions 0/1; worktreeConfig true/false × versions; partialClone empty/nonempty/missing scalar × versions. Missing object remains not_checked with no remote-helper marker. Existing includes/alternates/promisor/hook/filter/replacement/layout corpora remain linked by their named tests; no new native actor operation follows. |
| C3-04: bounded acquisition and stable observation; unavailable evidence is coded 2 | `Budget`, `bounded_process`, `FrozenStore`, `_working` | A.test_public_bounds_fail_closed lowers each named cap and checks not_checked; this does not claim literal default maximum/equality coverage for every cap. test_deep_repository_paths_are_not_checked covers depth 17 × three modes. Existing child deadline/output and config/index/ref/object/working-byte/mode mutation tests retain first-failure and owned-child cancellation. Diagnostics marker tests omit source/child values. R.test_three_modes_and_both_oid_widths_use_the_existing_acquisition_once; test_distinct_revision_index_and_working_bytes_keep_their_own_identity; test_unresolved_revision_is_unavailable_without_reacquisition_or_raw_ref; test_same_accepted_record_and_tree_objects_are_returned_without_revalidation; test_known_invalid_manifest_cases_keep_acquired_provenance_and_explicit_day; test_unavailable_storage_and_bad_inputs_are_closed_and_value_blind; test_mixed_pure_and_malformed_candidate_observations_do_not_enter_the_protocol; test_observer_failure_is_not_retried_or_echoed_and_cancellation_propagates cover the [released source observation](acquisition-candidate.md#released-source-observation-protocol), one acquisition, closed 0/1/2 and no direct-source promotion. |
| C4-01: separately trusted candidate table/digest, closed payload/protocol, bytes verified before import | `verify_release` in independent bootstrap | B.test_exact_canonical_binding_requires_independent_domain_separated_expectation plus external mismatch; missing descriptor/every listed payload and every normative doc; changed/truncated/extended; nine byte-count/hash type/value controls; closed protocol/revision and four noncanonical-JSON cases. Candidate success never approves its own release. B.test_released_profile_binds_closed_nine_fields_without_approving_itself; test_candidate_and_released_profiles_never_fall_back_to_each_other; test_unknown_expected_profile_is_unavailable_before_any_read; test_released_headers_keys_and_every_payload_row_remain_closed; test_released_profile_keeps_external_expectation_tamper_and_no_import_boundary cover the [released source descriptor](offline-binding-candidate.md#released-source-descriptor-profile), exact profile selection and unchanged trust/tamper boundary. |
| C4-02: namespace/type/budget/tamper/no-import use boundary | `_open_root`, `_namespace`, `_read`, `_descriptor`, `verify_release` | B.test_byte_budgets_refuse_resealed_oversized_files_and_aggregate_payload accepts exact 1 MiB and refuses next byte/aggregate excess; table budget refuses before parse; file-container/missing path/bytes/hash loops. Existing symlink/hardlink/FIFO/extra-file/root/object-race controls preserve immutable bytes. test_payload_modules_are_verified_as_bytes_without_import_side_effects poisons all Python payloads while denying imports. Consumer immutable capture/import qualification remains separate. |

### Optional selected-loader representation and version coverage

The preparation harness compares **C1 normalized records**, not every semantic
Cartesian product. It does not replace the strict reader or add a validator,
runtime dependency or ordinary project-CI loader requirement.

| Local ID / representation or preparation contract | Selected vector / stdlib control |
| --- | --- |
| L-01: token/text/null/empty shapes and populated records | base, stack, full_shape, four activation owners; quoted_reserved; quoted_null_and_numeric preserves text null/001 versus base literal null; quoted_punctuation preserves literal #/colon/brackets/braces |
| L-02: nonempty list shapes and order/duplicates retained by C1 | singleton_list, ordered_lists, duplicate_list; these are not C2 duplicate acceptance |
| L-03: comment/key ordering and repeated dynamic maps | comment, interior_comments (odd/deep mapping-interior indentation), reordered_keys (root/nested), two_mixed_stack_keys (two underscore/hyphen names) |
| L-04: accepted lexical edges | minimum_scalars, token_limits (64-byte value and dynamic key), text_and_path_limits (100/400/255), file_limit 65,536, line_limit 2,048. C1-01/05/06/07 supply refusal neighbors; no larger input is selected as accepted |
| L-05: closed selected set, exact expected versions, no discovery/fallback/extras; every selected engine/every accepted vector | L.test_selected_requires_every_engine_and_every_accepted_vector_without_discovery; test_unknown_duplicate_or_unqualified_profile_is_refused_before_engine_activity; test_missing_version_and_initialization_failures_never_reduce_selected_set; test_python_context_mismatch_stops_before_initialization; test_explicit_invalid_selected_cli_input_never_falls_back_to_reconnaissance |
| L-06: failure classes, observed linked-library metadata and honest reconnaissance | L.test_accepted_record_disagreement_and_strict_control_failure_are_exit_one; test_post_initialization_loss_is_unavailable_in_both_vector_loops_without_fallback; test_parser_refusal_of_accepted_input_is_mismatch_and_strict_refusal_is_informational; test_ruby_parser_refusal_is_distinct_from_process_loss_or_malformed_output; test_linked_libyaml_version_is_observed_from_extension_not_boolean; test_reconnaissance_remains_incomplete_and_does_not_adopt_a_release_profile; test_selected_representation_classes_have_explicit_strict_record_controls |

`python -B tests/compare_loaders.py` retains optional installed-engine
reconnaissance. Its available-engine success remains `selected_comparison` and
`release_qualification` **not_checked**; missing engines are reported.

`python -B tests/compare_loaders.py --selected-profiles FILE` selects an
operator-supplied JSON preparation input. No profile/version/legacy-Psych
requirement is built into source. Its closed top-level keys are `python` (exact
expected interpreter version) and `profiles` (one to eight records). Each record
has a unique token `id`, a closed `engine` of PyYAML.SafeLoader, PyYAML.CSafeLoader
or Ruby.Psych, and exact `versions`. PyYAML versions require `pyyaml` and actual
linked `libyaml` triple, or null for an unlinked pure SafeLoader. Ruby versions
require `ruby`, `psych`, `libyaml` triple and an explicit absolute `executable`.
Multiple explicitly selected Ruby profiles are permitted; none is silently
discovered or substituted. Unknown/extra/duplicate keys and range/latest
versions are refused. The input is not a registry or an approved release profile.

Selected missing/version/initialization/context/input failures and post-initialization
process/OS/timeout/unavailable failures in either vector loop are coded exit 2
with not_checked. No smaller selected set or retry supplies a substitute result;
prior comparison differences remain recorded. Parser refusal of an accepted vector,
accepted-record disagreement or strict-control failure is exit 1. The Ruby helper
uses a fixed parser-refusal status; other nonzero/signal termination or malformed
output is unavailable, without raw process errors. Exit 0 requires all selected
version requirements and all accepted-vector
agreements. Broader YAML acceptance of strict-refused bytes is informational,
not a requirement that general loaders reject the strict subset's exclusions.
Actual interpreter/host, source/vector/selection hashes and measured
Python/PyYAML/Ruby/Psych/linked-LibYAML versions bind the preparation receipt.
The PyYAML linked version uses its extension's `get_version()` API, not the
presence Boolean (see [official extension source](https://github.com/yaml/pyyaml/blob/6.0.3/yaml/_yaml.pyx)).

Ordinary source tests inject synthetic observations/callables and deny optional
package imports/process execution. They do not constitute an actual selected
loader run. Required tuples/host/current/floor contexts must be freshly measured
and separately selected for later qualification; historical receipts are not
adopted pins. Even selected-comparison success keeps `release_qualification`
**not_checked**. Release format/protocol/binding, private grammar diagnostic,
producer admission and project/consumer/runtime acceptance remain later gates.


## Results and remaining gates

DeclarationResult provides exit_code, candidate_declaration_accepted, findings
and a normalized record only on success. Exit 0 covers C2 candidate declaration
checks; exit 1 rejects the document; exit 2 means required evidence is unreliable.
The syntax phase uses the C1 reader, including the three source-confirmed legacy
rejections, and retains its safe findings.
Then reference-day evidence is checked, followed by enum/semantic rules, snapshot
structure and references in fixed order. Semantic/tree findings have zero
line/column; predefined fields and wildcard stack classes never echo values.

`diagnostics()` excludes the record, labels caller-supplied-unverified tree
evidence, owner-adopted manifest domains and owner-frozen contract policy with
its 2026-10-13 approval date, and always returns
`complete_v1_validity: not_checked`. Input-derived records remain data,
not safe diagnostic output.

New provisional codes are DATE_RULE, ROLE_RELATION, LIST_DUPLICATE,
FIELD_RELATION, ENUM_UNSUPPORTED, TARGET_RULE, REFERENCE_MISSING and
REFERENCE_MODE; FIELD_BOUND, REFERENCE_PATH and NOT_CHECKED retain their
candidate meanings. These are not published compatibility identifiers.

The development-policy freeze is settled by the 2026-10-13 owner decision.
Any subsequently selected missing validity rule or policy change requires its
own owner-approved source/corpus delta. Native task existence, role effects, secretless check, activation behavior
and Compose runtime safety belong to project/consumer acceptance, not execution
inside the validator. Producer legacy dispatch and cross-project identity/join
invariance remain producer-owned.

Complete-release provenance, approved artifact/consumer lock and bootstrap trust,
full runtime/platform/loader qualification, the private diagnostic, producer
admission and pilot/runtime acceptance remain separate. Existing source receipts
qualify only their exact bytes and execution envelopes. Bounded acquisition and
candidate byte binding are implemented source mechanisms, not complete release
or offline-vendor acceptance. No release/publication/adoption or discoverable v1
root manifest follows from declaration acceptance.
