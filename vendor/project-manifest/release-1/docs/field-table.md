# Candidate field and shape worksheet

Every listed fixed key is required, including nullable keys. All parent records
are closed and non-null. The root contains exactly spec_version, project, role,
canonical, peers, status, authority, presentation and development. Only
development.stacks has dynamic token keys. Root depth is one; command and
stack leaf depth is four.

The implementation column distinguishes C1 byte/shape checks and C2 pure
semantic/tree-record checks. The remaining-checks column identifies missing
implementation or approval. Syntax acceptance alone does not establish semantics. See the
[grammar and limits](specification-candidate.md) and
[enum authority worksheet](enum-provenance.md) and [C2 policy](validation-candidate.md).
C2 tree evidence is caller-supplied. The [C3 adapter](acquisition-candidate.md)
acquires bounded same-observation records; it grants no execution authority.

| Path / required record | Implemented candidate checks | Intended meaning and remaining checks |
| --- | --- | --- |
| spec_version | Exact first content line, double-quoted 1 | Selects shape only; complete release binding and producer legacy dispatch remain separate. |
| project | Exactly id, display_name, owner_entity | Identity record; no registry or hosted-repository lookup. |
| project.id | Token, 1-64 bytes | Stable declared identifier; membership and uniqueness are producer-owned. |
| project.display_name | Quoted text, 1-100 bytes | Presentation label, not identity. |
| project.owner_entity | Token, 1-64 bytes | Declared entity; membership is producer-owned. |
| role | Token, 1-64 bytes | C2 checks the owner-adopted role set; no inferred role. |
| canonical | Token, 1-64 bytes, or null; always present | Selected uniform key. Must be null exactly for canonical role; otherwise an ID differing from own id. C2 checks these relations; alternate presence is not proposed. |
| peers | Token list; C1 preserves order/duplicates, C2 rejects duplicates | C2 excludes own id and duplicate peers; producer owns cross-project relationships. Duplicate refusal is owner-frozen contract policy. |
| status | Exactly posture, operational_state, local_phase, as_of | Status summary without ledger/receipt extension keys. |
| status.posture | Token, 1-64 bytes | C2 checks the owner-adopted posture set; release binding remains. |
| status.operational_state | Token, 1-64 bytes | C2 checks the required owner-adopted operational-state set. |
| status.local_phase | Quoted text, 1-400 bytes | Concise current phase; detailed status belongs in status of record. |
| status.as_of | Quoted YYYY-MM-DD lexical format, 10 bytes | Valid calendar date no later than explicit UTC reference day; no age-based expiry. C2 checks calendar validity against a required explicit day, never a clock. |
| authority | Exactly status_of_record | Source authority reference, no duplicate status ledger. |
| authority.status_of_record | Quoted lexical relative path, 1-255 bytes | Tracked regular file with exact tree case and no symlink/submodule component; C2 checks supplied tree records; C3 supports bounded acquisition. |
| presentation | Exactly visibility, public_alias, link_policy | Disclosure policy, separate from remote repository visibility. |
| presentation.visibility | Token, 1-64 bytes | C2 checks the owner-adopted visibility set. No network lookup. |
| presentation.public_alias | Quoted text, 1-100 bytes, or null | Null means no alternate label; quoted null remains a label. |
| presentation.link_policy | Token, 1-64 bytes | C2 checks the owner-adopted link-policy set. |
| development | Exactly platforms, commands, environment, stacks, host_requirements | Full selected shape; all keys remain even without a development server. |
| development.platforms | Token list; C1 preserves order/duplicates, C2 rejects duplicates | Six determinate macos/linux/windows plus arm64/x86_64 frozen tokens. Combined spelling and unknown exclusion are accepted contract policy, never pair restrictions, host observation or portability proof. Empty remains no claim; identify the pilot consumer. |
| development.commands | Exactly setup, check, test, build, dev, format_check, format_write | Native command roles, never executable authorization. |
| development.commands.setup | Closed runner/target record or null | Prepare local development; null means inapplicable. Exact role effects/conformance pending. |
| development.commands.check | Closed runner/target record; null forbidden | Secretless source acceptance entrypoint. C2 checks script references in supplied tree records; native task existence and secretless behavior remain conformance. |
| development.commands.test | Closed runner/target record or null | Native tests; applicability and effect contract pending. |
| development.commands.build | Closed runner/target record or null | Produce project outputs; effect contract pending. |
| development.commands.dev | Closed runner/target record or null | Development workflow; concurrency/runtime safety not implied. |
| development.commands.format_check | Closed runner/target record or null | Formatting verification; effect contract pending. |
| development.commands.format_write | Closed runner/target record or null | Formatting mutation; invocation still requires project authority. |
| development.commands.ROLE.runner | Token, 1-64 bytes | C2 checks owner-frozen script/mise contract semantics; native task and pilot acceptance remain separate. |
| development.commands.ROLE.target | C1 quoted text, 1-255 bytes; C2 script path 255 or mise task 64 | Script means tracked executable path; mise means native task, maximum 64 bytes; every other runner is unsupported. C2 checks frozen contract bounds/spelling/argv exclusion and script executable tree mode; native task existence and effects remain conformance. |
| development.environment | Exactly owner, template, secret_launcher | Owner is activation and non-secret configuration loading, not every tool/dependency environment. |
| development.environment.owner | Token, 1-64 bytes | The declaration API checks none/direnv/mise/project for activation and non-secret loading; native is not an alias. Runtime/dependency ownership remains independent; contract policy was accepted on 2026-10-13; behavioral conformance and complete release approval remain separate. |
| development.environment.template | Quoted lexical relative path, 1-255 bytes, or null | Null means absent; C2 checks supplied regular-file records; C3 supports bounded acquisition. |
| development.environment.secret_launcher | Quoted lexical relative path, 1-255 bytes, or null | Null means no role consumes secrets. C2 requires a portable regular executable reference. Role/secret-use conformance remains pending; C3 supports bounded acquisition and never delivers a value. |
| development.stacks | Dynamic token-keyed closed records; empty map allowed | Nonempty stacks require container-engine declaration; C2 checks the owner-frozen container_engine implication; actual engine capability remains separate. |
| development.stacks.NAME | Exactly compose, instance_scope, port_policy | The literal port_policy key is frozen contract policy. No arbitrary stack extensions. |
| development.stacks.NAME.compose | Quoted lexical relative path, 1-255 bytes | Tracked Compose file, no interpolation or engine probe. C2 checks supplied regular-file records; C3 acquisition is bounded; Compose conformance remains pending. |
| development.stacks.NAME.instance_scope | Token, 1-64 bytes | C2 checks owner-frozen host/checkout scope. Checkout scope alone does not prove concurrency. |
| development.stacks.NAME.port_policy | Token, 1-64 bytes | C2 checks owner-frozen unpublished/loopback_only literals; actual port exposure remains consumer/runtime acceptance. No wider exposure value is invented. |
| development.host_requirements | Token list; C1 preserves order/duplicates, C2 rejects duplicates | The owner-frozen container_engine/android_sdk vocabulary declares requirements, not kernel Capability records or allocated resources. C2 checks the frozen stack implication and duplicate refusal; actual consumer/host readiness remains separate. |

## Absence, types and paths

Omission is always different from null. Null is available only for canonical,
public_alias, template, secret_launcher and the six command roles other than
check. An empty map is useful only for stacks; any other required empty record
fails missing-key checks. Empty peer, platform and requirement lists are
syntactically allowed. C2's empty-platform default and duplicate policy are explicit; broader applicability remains separate.

C1 applies lexical path rules. C2 checks complete caller-supplied tree records
and candidate task/portable-script syntax. Neither authenticates tree acquisition
or grants execution through acceptance.

## Remaining declaration authority and separate acceptance

The owner accepted the [development contract policy](validation-candidate.md#proposed-development-policy-freeze)
on 2026-10-13, freezing current literal values and reference/task/list/stack/
activation semantics. Complete release and actual acceptance remain separate. The selected uniform canonical and full
development shape, adopted five-domain snapshot, calendar replay and pure tree
checks are not reopened. The [corpus map](validation-candidate.md#declaration-corpus-coverage)
distinguishes inspected positive, negative and limit fixtures.

Native task existence, role effects, secretless check, activation behavior and
Compose safety require project/consumer acceptance without execution by this
validator. Complete release/artifact/runtime/platform qualification, private
grammar and producer identity/admission evidence are separate owner lanes;
private source is never copied into this origin.
