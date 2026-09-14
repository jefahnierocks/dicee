# Jefahnierocks organization alignment

This guide records Dicee's completed GitHub/local move into Jefahnierocks and describes the remaining governance and Cloudflare ownership boundaries. It is not a deployment runbook or permission to transfer provider resources.

Dicee's selected [Cloudflare governance strategy](../cloudflare.md#governance-strategy) translates this proposal into project direction, recorded in [status decision 9](../status.md#decisions). Selection of that direction does not establish accepted organizational intake, infrastructure execution authority or live enforcement.

The GitHub repository was transferred to `jefahnierocks/dicee` on 2026-09-14, the local checkout moved to `~/Organizations/jefahnierocks/dicee`, and [project.yaml](../../project.yaml) now declares `jefahnierocks` as owner. Provider ownership and infrastructure authority remain separate questions. [Status](../status.md) owns decisions and live readbacks; [roadmap section 7](../roadmap.md#7-organization-move-with-governance-and-iac) owns the move's sequence; [Cloudflare](../cloudflare.md) owns current topology and deployment details.

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
| GitHub repository | Current home: `jefahnierocks/dicee`; transfer completed 2026-09-14. |
| Local checkout | Current home: `~/Organizations/jefahnierocks/dicee/`, as an independent Git repository. This existing monorepo needs no internal reshuffle. |
| Project manifest | Keep project id `dicee`; owner is now `jefahnierocks`. Preserve the manifest's existing schema and status home. |
| Web Worker | `dicee-web` serves the SvelteKit app (status decision 8); the Pages project `dicee` is deleted after the cutover. A Pages project name and a Worker script name identify different resources. |
| Default production Worker | Source targets `dicee`; preserve that name pending the live namespace-owner check. |
| Other existing Worker | `dicee-production` is unclassified. Its suffix proves neither its role nor that it is safe to remove. |
| Runtime interfaces | Keep `GAME_WORKER`, `GAME_ROOM`, `GLOBAL_LOBBY`, `AI`, `GameRoom` and `GlobalLobby`. These are application interfaces, not places to add organization prefixes. |
| Future environments | Use explicit, consistent environment labels. A candidate staging script is `dicee-staging`; check the name against live inventory before choosing it. Do not introduce a named production environment merely to standardize spelling. |

For new human-facing infrastructure labels, a useful proposed pattern is `jefahnierocks-dicee-<environment>-<purpose>`, for example `jefahnierocks-dicee-production-deploy`. This is a descriptive convention, not an existing organization-wide naming rule, a credential value or an IAM boundary. Do not apply it retrospectively to stateful Worker names.

Keep Dicee's existing package structure, `wrangler.jsonc` files, [toolchain pins](toolchain.md), generated types and lowercase documentation homes. Jefahnierocks' shell uses uppercase status entrypoints; that shell convention does not justify renaming this project's status or roadmap. Use kebab-case for new ordinary documents/directories and preserve language-specific names such as Python's snake_case.

The checkout now lives under the Jefahnierocks workspace as an independent child repository. The parent workspace must exclude it from its own Git tracking. Dicee keeps its own history, remote and project-local Git identity; do not repair identity through global Git changes.

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
| Zone, DNS, redirect rules and the web Worker's custom domain | Zone belongs to an account; DNS records and Worker custom domains are zone-scoped | The designated Jefahnierocks infrastructure root, after discovery and import/no-op review. Registrar ownership is a separate intake question. |
| Web Worker artifact, service binding, compatibility and observability | `dicee-web` script settings | Dicee's web Wrangler configuration and application release workflow. Public Supabase values are also build inputs and must match the release environment. |
| Game Worker code, bindings, compatibility settings and observability | Account-scoped Worker script `dicee` | Dicee's Worker Wrangler configuration and release workflow. |
| Durable Object class lifecycle and bindings | Worker/class namespaces and existing data | Wrangler, preserving the chosen legacy migration history and verified state owner. |
| Workers AI use | Worker `AI` binding and transcription code | Dicee; keep the current binding and model configuration in their existing source homes. |
| Runtime secret values | Per authorized consumer/environment | Approved secret delivery at execution time; do not feed application secret values through infrastructure state. |

**Keep one writer per Worker field.** Wrangler configuration is the source of truth for both Workers' script settings. Before OpenTofu manages a resource that touches them (a custom domain, a Worker setting), document the field map and verify import/no-op behavior, an ordinary Wrangler release and the next infrastructure plan. If the pinned provider cannot preserve this separation, leave those fields unmanaged by that root. A broad drift-ignore rule is not evidence that another writer owns the field.

Keeping Worker and Durable Object lifecycle in Wrangler is a chosen responsibility boundary. It is not a claim that provider tooling is incapable of expressing that lifecycle. Do not manage the same Worker deployment with both tools.

The first infrastructure adoption should aim to describe existing resources without recreation. It needs read-only discovery, a placement rationale, pinned tools/provider and lockfile, a reviewed plan, explicit human authority for the first write, and a fresh readback. Use the infrastructure owner's accepted execution path; this guide establishes no functioning central plan/apply service. State and plan artifacts need the owner's approved protected storage, access control and recovery arrangements, never Git; provision ignore rules before generating them. Initial source-only validation should be credential-free.

## Runtime and environment boundaries to preserve

The shape is browser → `dicee-web` Worker → `GAME_WORKER` → `dicee` Worker → SQLite Durable Objects, with Supabase for Auth/Postgres/Storage; status decision 8 moved the web app off Pages for platform reasons, not for alignment. The public application origin remains `dicee.games`; `dicee` is reachable only through the service binding. Do not add a direct game-Worker hostname, Tunnel, Access application, D1, R2, KV or Queues merely for organizational alignment. Such additions need their own product or security reason.

Preserve the project's existing hard stops:

- Before any `dicee` deployment, read back which script owns the live `GameRoom` and `GlobalLobby` namespaces. `dicee` is the one game backend (status decision 1): a cutover from another script accepts a live-state reset, and obsolete scripts such as `dicee-production` are deleted once classified.
- Preserve applied v1/v2 `new_sqlite_classes` migrations. Do not rename a Worker/class, introduce a new namespace or switch to declarative `exports` as a naming cleanup. Lifecycle work remains a separate operator change with a state-preservation plan.
- A new Worker script or account is not a transparent move of existing data. Cloudflare class-transfer migrations move namespaces between Worker scripts in the same account; do not create the destination class first and then expect a later transfer to preserve the old namespace. Account relocation requires a separate migration/recovery design and must not assume namespace or data continuity. See [legacy class transfers](https://developers.cloudflare.com/durable-objects/reference/durable-object-class-migrations-legacy/#transfer-migration).
- Inventory all ingress: Worker subdomains, version Preview URLs, routes, custom domains, Pages domains until the Pages project is deleted, and binding targets. The reported disabling of Worker subdomains does not prove the other paths absent. Keep sensitive admin authorization enforced in application code as well as the intended ingress design.

| Environment | Current source shape | Adoption intention |
|---|---|---|
| Local development | Named Worker development configuration; local services subject to the documented auth limitations | Preserve isolated local testing and project-owned tooling. |
| Production | Workers `dicee` and `dicee-web`; manual deployment from `main` | Keep the namespace precondition; establish actual review/deployment protections at intake. |
| Hosted preview | None (status decision 8) | Add one only with an isolated backend, data and credentials. |
| Future staging | Named Worker configuration exists, but the current CI does not use it | Activate only when the roadmap trigger is met; choose an explicit backend, separate DO state and suitable non-production Supabase/OAuth/secret configuration together. |

Cloudflare Worker environments normally use separate script names and Durable Object storage unless explicitly bound to another script. Verify bindings and data dependencies before advertising a safe testing environment. See [Durable Object environments](https://developers.cloudflare.com/durable-objects/reference/environments/).

## Credentials, releases and operational evidence

Keep local operator access through Dicee's existing 1Password-per-command wrapper and CI through its existing GitHub Environment wiring until a separately accepted replacement exists. Resolve secrets at execution time; do not place values, account/zone/namespace identifiers, project refs, credential locators or dashboard exports in this public repository. A future managed workload-identity/secret service is a target, not an available dependency assumed by this guide.

The proposed credential split is:

| Consumer | Intended capability |
|---|---|
| Inventory / plan reader | Only the reads required for discovery/planning; no deploy or infrastructure mutation. |
| Infrastructure apply | Only the approved root's resources; admitted after plan review. |
| Application release | Only the Worker release capabilities actually needed; no unrelated DNS/account administration. |
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
| The web Worker uses a declared backend | The audit checks service-binding shape, agreement with configured Worker names and a web name distinct from the game Worker. | Deployed `dicee-web` binding. Matching edits to two files do not prove safe namespace continuity. |
| No hosted preview | The audit errors on web `workers_dev` or `preview_urls` and warns (F7) on a named environment bound to production. | Actual settings on `dicee-web`. |
| Worker has no other ingress | Declared project rule. The audit's explicit route/custom-domain-key check applies to the web config, not the backend. | Full ingress inventory; any additional blocking source check is future implementation. |
| Protected merges and deployments | YAML and written policy are insufficient evidence. | Separate current GitHub control readbacks, including bypass behavior. |
| Infrastructure has one writer | Proposed field-ownership boundary only. | Import/no-op plan, release readback and subsequent plan with no unintended reset. |

The relevant local control is [cloudflare-config-audit.mjs](../../scripts/cloudflare-config-audit.mjs), with the [CI workflow](../../.github/workflows/ci.yml) as source evidence of invocation. Do not promote a warning to blocking policy or describe a control as live merely by editing this guide.

## Adoption deliverable and order

Use the existing roadmap, not a second phase system. Its credential prerequisites remain: Supabase key migration, HS256 removal and Infisical retirement before ownership changes. Current application/privacy safety work keeps its existing priority. Documentation and source design can proceed while those operations remain pending.

For the organization-move item, prepare one reviewable intake that answers:

1. **Ownership and names:** intended GitHub/local home, accepted Jefahnierocks project contract, service owner, infrastructure root, shared-account steward, credential consumers and the disposition of both existing scripts.
2. **Fresh inventory:** Pages domains until deletion, Worker routes/subdomains and bindings, namespace owners, secret names and token reach; zone/registrar/redirect ownership; GitHub Apps, Actions configuration and each protection surface. Record unknowns explicitly and keep private identifiers out of the repository.
3. **Transfer continuity:** repository protections and integrations before/after transfer; updates to the remote, manifest and repository references already named by the roadmap; preservation of public URLs and application identity. Do not recreate the old GitHub repository path after transfer.
4. **Infrastructure boundary:** accepted resource/field ownership, protected state location, pinned toolchain, credential split, source validation, import/no-op plan, first-write authority and readback. Infrastructure adoption and any later account move have separate acceptance evidence.
5. **State and recovery:** no accidental namespace creation or Worker rename; a resource-appropriate recovery/cutover plan before account moves or destructive cleanup; legacy scripts deleted once their ingress and consumers are classified.
6. **Completion evidence:** accepted local declarations and successful source checks, fresh provider/control readbacks, application smoke checks, and explicit remaining gaps. Cleanup of old credentials/scripts/memberships follows those dependencies and its own authorization.

The result should be a Jefahnierocks-owned Dicee with an explicit, testable management boundary and preserved application state. Transfer completion, infrastructure management and live governance enforcement must each be demonstrated separately.
