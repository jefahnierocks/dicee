# Jefahnierocks organization alignment

This guide prepares Dicee for the owner's intended move into Jefahnierocks. It explains the ownership, governance and Cloudflare design to preserve while current work continues. It is an intake proposal, not an adoption record, a deployment runbook or permission to transfer resources.

Dicee's selected [Cloudflare governance strategy](../cloudflare.md#governance-strategy) translates this proposal into project direction, recorded in [status decision 9](../status.md#decisions). Selection of that direction does not establish accepted organizational intake, infrastructure execution authority or live enforcement.

The source basis was inspected on 2026-09-13. Dicee still declares `verlyn13` as its owner in [project.yaml](../../project.yaml), and its configured Git remote points to `verlyn13/dicee`. No live provider or GitHub controls were checked for this guide. [Status](../status.md) owns decisions and live readbacks; [roadmap section 7](../roadmap.md#7-organization-move-with-governance-and-iac) owns the move's sequence; [Cloudflare](../cloudflare.md) owns current topology and deployment details.

## What joining Jefahnierocks means

Jefahnierocks is a personal workspace for creative, upstream, family, academic, utility, infrastructure and experimental projects. Its practical standard is work one person can understand, run and maintain. Dicee's family learning-game identity fits that purpose; joining does not turn it into an LLC product or require a new application architecture. This character and the project-root model come from the [Jefahnierocks workspace README](https://github.com/jefahnierocks/jefahnierocks/blob/main/README.md).

Jefahnierocks makes its own project decisions. Shared organizational specifications are adopted by restating the relevant rules locally, in its own voice and on its own authority. They are not inherited by adding a parent-document include to an agent file. Ordinary project sessions use the local contract; integration references are for the adoption review. Keep external governance branding, role titles and policy identifiers out of normal project instructions.

The workspace shell coordinates ownership and cross-project work. Child repositories own their implementation, tests, operating procedures and evidence. The shell is not the Cloudflare apply repository. Jefahnierocks' [repository boundaries](https://github.com/jefahnierocks/jefahnierocks/blob/main/docs/repo-boundaries.md) and [change discipline](https://github.com/jefahnierocks/jefahnierocks/blob/main/CONTRIBUTING.md) establish this distinction; the shell's conventions need a deliberate project-level adoption where Dicee differs.

| Responsibility | Expected home after acceptance |
|---|---|
| Product, code, tests and release decisions | Dicee, under Jefahnierocks' ownership |
| Entity intake, project placement and cross-repository coordination | Jefahnierocks workspace shell |
| Dicee-specific Cloudflare infrastructure configuration | One explicitly designated infrastructure repository/root; placement described below |
| Shared account administration and cross-entity controls | The existing shared-account steward until an accepted ownership handoff |
| Credentials and live operations | The named operator/automation consumer in the repository that owns the operation |

The local agent roles are **Builder**, **Maintainer**, **Reviewer** and **Operator**. They describe work, not extra account privileges or independent human approval. Routine local implementation is different from changing integrations, deployment flows, accounts, billing or credentials. The [Jefahnierocks agent shell](https://github.com/jefahnierocks/jefahnierocks/blob/main/CLAUDE.md) supplies that vocabulary; Dicee's [AGENTS.md](../../AGENTS.md) remains the project contract.

## Names and repository shape

| Name or surface | Intended treatment |
|---|---|
| Product and public URL | Keep **Dicee** and `https://dicee.games`; organization ownership does not require a new brand or hostname. |
| GitHub repository | Intended destination: `jefahnierocks/dicee`. Transfer is a later operator action. |
| Local checkout | Proposed home: `~/Organizations/jefahnierocks/dicee/`, as an independent Git repository. The workspace also permits apps/packages layouts; this existing monorepo needs no internal reshuffle. |
| Project manifest | Keep project id `dicee`; change the owner declaration only with accepted intake. Preserve the manifest's existing schema and status home. |
| Pages project | Keep `dicee`. A Pages project name and Worker script name identify different resources. |
| Default production Worker | Source targets `dicee`; preserve that name pending the live namespace-owner check. |
| Other existing Worker | `dicee-production` is unclassified. Its suffix proves neither its role nor that it is safe to remove. |
| Runtime interfaces | Keep `GAME_WORKER`, `GAME_ROOM`, `GLOBAL_LOBBY`, `AI`, `GameRoom` and `GlobalLobby`. These are application interfaces, not places to add organization prefixes. |
| Future environments | Use explicit, consistent environment labels. A candidate staging script is `dicee-staging`; check the name against live inventory before choosing it. Do not introduce a named production environment merely to standardize spelling. |

For new human-facing infrastructure labels, a useful proposed pattern is `jefahnierocks-dicee-<environment>-<purpose>`, for example `jefahnierocks-dicee-production-deploy`. This is a descriptive convention, not an existing organization-wide naming rule, a credential value or an IAM boundary. Do not apply it retrospectively to stateful Worker names.

Keep Dicee's existing package structure, `wrangler.jsonc` files, [toolchain pins](toolchain.md), generated types and lowercase documentation homes. Jefahnierocks' shell uses uppercase status entrypoints; that shell convention does not justify renaming this project's status or roadmap. Use kebab-case for new ordinary documents/directories and preserve language-specific names such as Python's snake_case.

When the checkout eventually moves, the Jefahnierocks shell must exclude the child repository from its own Git tracking and record the accepted boundary. Dicee keeps its own history. Recheck project-local Git identity routing before the first commit from the new location; do not repair it through global identity changes.

## Principles translated into project expectations

These are the proposed adoption criteria, applied through Dicee's own contract rather than a new parallel policy hierarchy.

| Expectation | Concrete application |
|---|---|
| Understandable change history | Conventional commits, focused PRs, a deliberate merge policy and an explanation of purpose, validation and remaining risk. |
| Reviewed and reproducible changes | Exact project/provider pins, lockfiles, generated configuration types and proportionate tests. Preserve the repository's completion gate. |
| Infrastructure described in source | Reviewed infrastructure changes with a known owner, plan, execution path and readback; console edits are an explicitly authorized exception. |
| Least privilege | Separate read, infrastructure-write and application-deploy consumers; distinguish production from test data and credentials. |
| Protect state and family data | Preserve namespace ownership and existing privacy requirements. Require recovery evidence appropriate to the resource before destructive changes. |
| Evidence supports the claim | Source configuration, local tests, authenticated provider observations and human approval are separate evidence. A document or green local check cannot establish live enforcement. |
| Keep maintenance proportionate | Add staging, storage products, policy automation or another repository for a demonstrated need with an owner. Organization membership alone is not that need. |

The adoption review must name the actual reviewers and available platform controls. A second login or an agent review does not establish another independent human reviewer. Inspect repository rulesets, organization rulesets, required checks, direct-push protection and deployment-environment protection separately. Existing workflow YAML and membership in an organization do not prove those protections are active.

## Cloudflare ownership and management shape

Separate three questions: **who owns the service**, **which account hosts it**, and **which repository/tool writes each setting**. Dicee is intended to become Jefahnierocks-owned while the shared Cloudflare account can remain its temporary host. A GitHub transfer, Cloudflare account relocation and infrastructure import are different operations; none automatically implies the others.

The placement expectation supplied for this intake is that a resource serving only Dicee/Jefahnierocks belongs in the owning workspace root, even when Cloudflare exposes it at account scope. A global root is for resources actually shared across owners. Jefahnierocks' [Cloudflare consult](https://github.com/jefahnierocks/jefahnierocks/blob/main/docs/orchestration/2026-05-19-cloudflare-rationalization-consult.md#target-state) also distinguishes service ownership from provider stewardship and assigns infrastructure execution to explicit child repositories. That dated consult supplies design provenance, not a live ownership inventory.

The existing centrally stewarded placement convention can be represented as:

```text
<designated-infrastructure-repository>/
  terraform/
    orgs/
      jefahnierocks/   # Dicee-specific resources during shared stewardship
    global/           # only genuinely shared resources
```

This is a placement example, not a directory to create in Dicee now. Jefahnierocks and the current steward must accept the exact repository, root, backend/state boundary and writer before implementation. A later Jefahnierocks-operated infrastructure root can preserve the same ownership split. Do not place Dicee resources in a household network-policy repository merely because it also uses Cloudflare.

### Proposed division between OpenTofu and Wrangler

OpenTofu is the intended infrastructure engine; its adoption is still future work here. Divide responsibility by resource **and field**, not by a blanket label such as "account-level resources."

| Surface | API scope / dependency | Proposed configuration writer |
|---|---|---|
| Zone, DNS, redirects and Pages domain attachment | Zone belongs to an account; DNS records are zone-scoped; Pages domains belong to a project | The designated Jefahnierocks infrastructure root, after discovery and import/no-op review. Registrar ownership is a separate intake question. |
| Pages project identity and infrastructure-owned settings | Account-scoped but Dicee-specific | OpenTofu only for explicitly assigned fields that do not compete with the application deployment configuration. |
| Pages application artifact, bindings, vars and compatibility settings | Pages project production/preview configuration | Dicee's web Wrangler configuration and application release workflow. Public Supabase values are also build inputs and must match the release environment. |
| Worker code, bindings, compatibility settings and observability | Account-scoped Worker scripts | Dicee's Worker Wrangler configuration and release workflow. |
| Durable Object class lifecycle and bindings | Worker/class namespaces and existing data | Wrangler, preserving the chosen legacy migration history and verified state owner. |
| Workers AI use | Worker `AI` binding and transcription code | Dicee; keep the current binding and model configuration in their existing source homes. |
| Runtime secret values | Per authorized consumer/environment | Approved secret delivery at execution time; do not feed application secret values through infrastructure state. |

**Resolve the Pages overlap before importing its project.** Pages treats a deployed Wrangler file as its configuration source of truth, while the provider's Pages-project resource also exposes deployment configuration fields. The implementation must document who writes production/preview service bindings, variables, compatibility settings and build settings; verify import/no-op behavior, an ordinary Wrangler release and the next infrastructure plan. If the pinned provider cannot preserve this separation, leave those fields/resource unmanaged by that root until the boundary is resolved. A broad drift-ignore rule is not evidence that another writer owns the field. See [Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/) and the [provider resource schema](https://developers.cloudflare.com/api/terraform/resources/pages/subresources/projects/).

Keeping Worker and Durable Object lifecycle in Wrangler is a chosen responsibility boundary. It is not a claim that provider tooling is incapable of expressing that lifecycle. Do not manage the same Worker deployment with both tools.

The first infrastructure adoption should aim to describe existing resources without recreation. It needs read-only discovery, a placement rationale, pinned tools/provider and lockfile, a reviewed plan, explicit human authority for the first write, and a fresh readback. Use the infrastructure owner's accepted execution path; this guide establishes no functioning central plan/apply service. State and plan artifacts need the owner's approved protected storage, access control and recovery arrangements, never Git; provision ignore rules before generating them. Initial source-only validation should be credential-free.

## Runtime and environment boundaries to preserve

The retained shape is browser → Pages → `GAME_WORKER` → Worker → SQLite Durable Objects, with Supabase for Auth/Postgres/Storage. The public application origin remains `dicee.games`; the Worker is intended to be reachable only through the service binding. Do not add a direct Worker hostname, Tunnel, Access application, D1, R2, KV, Queues or a frontend platform migration merely for organizational alignment. Such additions need their own product or security reason.

Preserve the project's existing hard stops:

- Before any Worker deployment, resolve which script owns the live `GameRoom` and `GlobalLobby` namespaces and what Pages actually targets. The default deployment remains held unless the required ownership/tag evidence supports it. Treat `dicee-production` as unresolved until then.
- Preserve applied v1/v2 `new_sqlite_classes` migrations. Do not rename a Worker/class, introduce a new namespace or switch to declarative `exports` as a naming cleanup. Lifecycle work remains a separate operator change with a state-preservation plan.
- A new Worker script or account is not a transparent move of existing data. Cloudflare class-transfer migrations move namespaces between Worker scripts in the same account; do not create the destination class first and then expect a later transfer to preserve the old namespace. Account relocation requires a separate migration/recovery design and must not assume namespace or data continuity. See [legacy class transfers](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#transfer-migration).
- Inventory all ingress: Worker subdomains, version Preview URLs, routes, custom domains, Pages domains/preview URLs and binding targets. The reported disabling of Worker subdomains does not prove the other paths absent. Keep sensitive admin authorization enforced in application code as well as the intended ingress design.

| Environment | Current source shape | Adoption intention |
|---|---|---|
| Local development | Named Worker development configuration; local services subject to the documented auth limitations | Preserve isolated local testing and project-owned tooling. |
| Production | Default Worker `dicee`, Pages `dicee`; manual deployment from `main`, Worker before Pages | Keep the release order and namespace precondition; establish actual review/deployment protections at intake. |
| Pages preview | `GAME_WORKER` also targets production `dicee` | Keep this visible as an open owner decision. It is not an isolated test environment. |
| Future staging | Named Worker configuration exists, but the current CI does not use it | Activate only when the roadmap trigger is met; choose an explicit backend, separate DO state and suitable non-production Supabase/OAuth/secret configuration together. |

Cloudflare Worker environments normally use separate script names and Durable Object storage unless explicitly bound to another script. Pages' preview branch label alone does not isolate the backend. Verify bindings and data dependencies before advertising a safe testing environment. See [Durable Object environments](https://developers.cloudflare.com/durable-objects/reference/environments/) and [Pages service bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings).

## Credentials, releases and operational evidence

Keep local operator access through Dicee's existing 1Password-per-command wrapper and CI through its existing GitHub Environment wiring until a separately accepted replacement exists. Resolve secrets at execution time; do not place values, account/zone/namespace identifiers, project refs, credential locators or dashboard exports in this public repository. A future managed workload-identity/secret service is a target, not an available dependency assumed by this guide.

The proposed credential split is:

| Consumer | Intended capability |
|---|---|
| Inventory / plan reader | Only the reads required for discovery/planning; no deploy or infrastructure mutation. |
| Infrastructure apply | Only the approved root's resources; admitted after plan review. |
| Application release | Only the Worker/Pages release capabilities actually needed; no unrelated DNS/account administration. |
| Local operator | A distinct, scoped interactive path, not an unrestricted credential copied into every consumer. |

Separate credentials by consumer and environment where supported. Verify effective Cloudflare permissions: some operations are account-scoped, so a friendly token name or workspace directory cannot restrict access to one script. Document remaining reach and choose a dedicated account or equivalent enforceable credential boundary when the service footprint and risk justify it. Account separation needs its own migration plan.

Keep authenticated capability separate from approval: OAuth login, a stored Wrangler login, an API token or an MCP session does not authorize a deployment. The local wrapper is a useful convention, not a complete execution barrier. Do not restore retired credential tooling or enable automatic Git-triggered deployment during this documentation/intake work.

A future release record should identify the source commit, target environment, configuration owner, validated artifact, human approval where required, operation result and post-deploy checks. Use references and redacted outcomes rather than raw logs. Recheck sign-in against the intended Supabase environment, room/lobby WebSockets, transcription, security headers and refusal of non-admin access. Keep operational results in the existing status/readback and release evidence homes.

## What is enforced, and what still needs proof

This guide is **advisory design documentation**. It refuses no action. Its readback is the eventual adopted local contract plus source checks and authenticated evidence from each owning system. The Dicee owner and Jefahnierocks intake owner can accept project adoption; the shared-account steward and designated infrastructure operator must satisfy their own control-plane responsibilities. An agent cannot manufacture those approvals.

| Claim | Existing refusal or limitation | Readback needed |
|---|---|---|
| Worker subdomains stay disabled in source | `pnpm cf:audit` errors on enabled/missing `workers_dev` or `preview_urls`. | Actual settings on every Dicee script; routes/custom domains are separate. |
| Existing DO migration mode is preserved | The audit checks legacy mode, tags/classes, bindings and class exports. | Live namespace owner and lifecycle state; source checks cannot see them. |
| Pages uses a declared backend | The audit checks service-binding shape and agreement with configured Worker names. | Deployed Pages target. Matching edits to two files do not prove safe namespace continuity. |
| Preview is isolated | Currently advisory warning F7; ordinary audit success permits the shared production target. | An accepted decision and, if isolation is implemented, separate backend/data evidence. |
| Worker has no other ingress | Declared project rule. The audit's explicit route/custom-domain-key check currently applies to Pages, not the backend. | Full ingress inventory; any additional blocking source check is future implementation. |
| Protected merges and deployments | YAML and written policy are insufficient evidence. | Separate current GitHub control readbacks, including bypass behavior. |
| Infrastructure has one writer | Proposed field-ownership boundary only. | Import/no-op plan, release readback and subsequent plan with no unintended reset. |

The relevant local control is [cloudflare-config-audit.mjs](../../scripts/cloudflare-config-audit.mjs), with the [CI workflow](../../.github/workflows/ci.yml) as source evidence of invocation. Do not promote a warning to blocking policy or describe a control as live merely by editing this guide.

## Adoption deliverable and order

Use the existing roadmap, not a second phase system. Its credential prerequisites remain: Supabase key migration, HS256 removal and Infisical retirement before ownership changes. Current application/privacy safety work keeps its existing priority. Documentation and source design can proceed while those operations remain pending.

For the organization-move item, prepare one reviewable intake that answers:

1. **Ownership and names:** intended GitHub/local home, accepted Jefahnierocks project contract, service owner, infrastructure root, shared-account steward, credential consumers and the disposition of both existing scripts.
2. **Fresh inventory:** Pages bindings/domains, Worker routes/subdomains, namespace owners, secret names and token reach; zone/registrar/redirect ownership; GitHub Apps, Actions configuration and each protection surface. Record unknowns explicitly and keep private identifiers out of the repository.
3. **Transfer continuity:** repository protections and integrations before/after transfer; updates to the remote, manifest and repository references already named by the roadmap; preservation of public URLs and application identity. Do not recreate the old GitHub repository path after transfer.
4. **Infrastructure boundary:** accepted resource/field ownership, protected state location, pinned toolchain, credential split, source validation, import/no-op plan, first-write authority and readback. Infrastructure adoption and any later account move have separate acceptance evidence.
5. **State and recovery:** no accidental namespace creation or Worker rename; a resource-appropriate recovery/cutover plan before account moves or destructive cleanup; legacy scripts retained until their bindings, data and consumers are resolved.
6. **Completion evidence:** accepted local declarations and successful source checks, fresh provider/control readbacks, application smoke checks, and explicit remaining gaps. Cleanup of old credentials/scripts/memberships follows those dependencies and its own authorization.

The result should be a Jefahnierocks-owned Dicee with an explicit, testable management boundary and preserved application state. Transfer completion, infrastructure management and live governance enforcement must each be demonstrated separately.
