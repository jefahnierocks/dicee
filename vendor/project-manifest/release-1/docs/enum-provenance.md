# Owner-adopted generic enum snapshot

The owner adopted these five existing generic sets into the MIT specification
candidate, with fresh definitions. C2 validates membership. This settles the
candidate values and future specification ownership; it does not approve a
complete immutable release, binding, publication or project migration.

Role and link policy are explicit specification policy sets. Posture,
operational state and visibility retain ontology-derived provenance in the
owner's private evidence. This public-safe source contains generic vocabulary
and new definitions only: no private paths, identifiers, membership data,
source comments or operational receipts. The producer proposes additions and
adopts complete releases first; changing approved values requires release review.

## Role

Role describes a project's declared relationship to other projects. Under the
selected uniform rule, canonical is null only for canonical role; every other
role declares a non-self canonical ID. Graph membership remains producer-owned.

| Token | Fresh candidate definition |
| --- | --- |
| canonical | The primary project in its declared relationship group. |
| component | A project that contributes a constituent part to that group. |
| satellite | A related auxiliary project. |
| peer | A related project with an independent counterpart role. |
| predecessor | A project representing an earlier related implementation or line. |

## Posture

Posture names the primary kind of evidence represented by a project. It does
not certify current operations, disclosure permission or public linkability.

| Token | Fresh candidate definition |
| --- | --- |
| deployed-system | A system represented through deployment evidence. |
| public-package | A package intended for public distribution. |
| public-repo | A repository represented as public source work. |
| private-tool | A tool maintained for restricted use. |
| course-taught | A course represented through delivered teaching work. |
| published-artifact | A completed artifact represented through publication. |
| client-deliverable | Work represented as a client delivery. |
| working-prototype | An implemented prototype still being developed or evaluated. |
| design-spec | Work represented by a design or specification. |
| source-held | Source retained without another asserted evidence posture. |
| archive-only | Material retained for archival reference. |

## Operational state

Operational state is a declared current state, separate from posture. A token
is testimony, not a runtime measurement or acceptance receipt.

| Token | Fresh candidate definition |
| --- | --- |
| production-live | Declared to be operating in production. |
| staging-live | Declared to be operating in a staging environment. |
| active-build | Under active implementation. |
| maintained | Kept current through ongoing maintenance. |
| paused | Work or operation is temporarily suspended. |
| retired | No longer maintained for its previous active purpose. |
| unverified | The asserted operational condition has not been verified. |
| unknown | No operational condition is asserted as known. |

## Visibility

Visibility governs outward presentation of project material; it is separate
from hosting visibility and never permits disclosure of private identifiers.

| Token | Fresh candidate definition |
| --- | --- |
| public-promoted | Public material selected for active presentation. |
| public-available | Public material available without active promotion. |
| shareable-private | Restricted material that may be shared through an approved path. |
| internal | Material intended for an internal audience. |
| archive | Material presented or retained as archival work. |

## Link policy

Link policy governs whether public linking is permitted by the declaration;
it does not itself establish that a destination is public or reachable.

| Token | Fresh candidate definition |
| --- | --- |
| link-ok | Public linking is permitted subject to the applicable disclosure rules. |
| no-link | Public links are suppressed. |

## Other vocabularies and remaining authority

The development shape uses separate platform, runner, activation-owner, stack
and requirement vocabularies. The owner froze the implemented literal sets
and rules as contract policy on 2026-10-13: script/mise, host/checkout,
unpublished/loopback_only and container_engine/android_sdk. Actual consumer
behavior and complete immutable release approval remain separate. Platform
membership is the
six determinate combinations of OS macos/linux/windows and architecture
arm64/x86_64: macos-arm64, macos-x86_64, linux-arm64, linux-x86_64,
windows-arm64 and windows-x86_64. These generic axes impose no pair limits;
combined spelling and exclusion of unknown are owner-frozen contract policy.
Empty means no platform claim, never host observation or portability proof.
The declaration API checks the frozen activation/non-secret-loading set
none/direnv/mise/project. Native is not an alias; no per-tool dependency owner
is introduced. Contract policy acceptance grants no native activation proof.

General tokens allow single hyphens or underscores. The concrete
[owner-frozen development policy](validation-candidate.md#proposed-development-policy-freeze)
retains implemented literal underscore-bearing values rather than a blanket
kebab-only rule. No alias or hidden normalization is permitted. Any future
incompatible spelling change is a new owner decision with compatibility/
release review, not a style-only update.


The complete release must bind specification, fields, this adopted snapshot,
reader and corpus under one immutable identity. A shape version alone does not
reproduce a verdict. Fresh loader/runtime evidence, approved artifact/binding
format, the private grammar diagnostic and producer admission/identity evidence
remain required. Private provenance remains owner-held; source adoption is not
a public release or an authoritative inventory.
