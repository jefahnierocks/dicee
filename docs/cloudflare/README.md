# Dicee Cloudflare authority

- **Status:** authoritative repository navigation and governance contract
- **Last reviewed:** 2026-07-22
- **Scope:** Cloudflare architecture, configuration, development, testing, observability, and deployment guidance for Dicee

This is the starting point for every Dicee Cloudflare task. It tells agents and
developers which evidence controls a decision; it does not replace executable
configuration or live provider evidence.

## Authority model

Cloudflare work has two related authority lanes:

| Question | Authority order |
|---|---|
| What Dicee intends and currently implements | Applicable organization policy -> `AGENTS.md` -> current source, tests, `wrangler.jsonc`, generated bindings, package scripts, and CI -> this hub -> current descriptive docs -> planning and archive material |
| How Cloudflare behaves | Live official Cloudflare documentation and changelogs -> installed Wrangler schema and generated types -> current project configuration and verified dry runs -> cached or historical references |

If the lanes disagree, stop and resolve the conflict explicitly. Do not silently
change project architecture to match a platform example, and do not preserve a
project pattern that current official documentation says is invalid or unsafe.

Dicee's organization-level Cloudflare policies have not yet been incorporated
into this repository. Any architecture or deployment change remains pending
organization-policy conformance until those policies are identified, mapped,
and either satisfied or granted a documented exception.

## Current repository baseline

The current local source and configuration describe this architecture:

- `packages/web` is a SvelteKit application built for Cloudflare Pages.
- `packages/web/wrangler.jsonc` exposes one `GAME_WORKER` Service Binding to the
  Worker named `dicee`.
- `packages/cloudflare-do` is the Worker containing SQLite-backed `GameRoom`
  and `GlobalLobby` Durable Objects plus a Workers AI binding.
- The Worker has `workers_dev` disabled and is intended to be reached through
  the web application's Service Binding.
- Supabase remains the authentication and durable relational-data provider.
- No OpenTofu module, Cloudflare D1 database, or R2 audio bucket is currently
  implemented in this repository.
- Production deployment is defined by `.github/workflows/ci.yml` and requires
  an explicit manual dispatch in the current working tree.

This is repository evidence, not proof of live Cloudflare state. Confirm live
bindings, routes, secrets, deployments, and account policy only in an authorized
operator lane.

### Known reconciliation blockers

- This review found no receipt proving that the current Pages configuration was
  downloaded from Cloudflare and compared with `packages/web/wrangler.jsonc`.
  Before the first configuration-driven Pages deployment, retrieve the live
  project configuration through the current supported Cloudflare workflow and
  review the diff in an authorized read-only lane.
- The baseline Durable Objects Worker keeps the legacy `migrations` v1
  (`GameRoom`) and v2 (`GlobalLobby`) with `new_sqlite_classes` (owner decision,
  2026-09-12). Declarative `exports` is deferred to a standalone operator deploy
  after [ADR-005](../rfcs/adr-005-durable-object-lifecycle.md) is accepted,
  because rollback and gradual deployment are unavailable across that
  transition. Only local dry runs have been performed. The first baseline deploy
  is gated on OPS-02: confirm which Worker script holds the live namespaces and
  its migration tag.
- `.github/workflows/ci.yml` currently consumes GitHub Environment secrets,
  while `.claude/environment-strategy.yaml` identifies Infisical as the runtime
  secret authority and 1Password as local bootstrap custody. No reviewed sync
  or brokerage path connecting those models is documented. Treat production
  credential custody as unresolved until organization policy selects and proves
  the path.

## Current sources

### Cloudflare workstream documents

These five documents plus the RFC stubs are the resumable state of the Cloudflare
consolidation workstream. They describe current evidence and open decisions; none
authorizes a deployment, migration, secret change, or provider mutation.

- [`docs/cloudflare/current-state.md`](current-state.md) — evidence-cited implemented topology: bindings, secrets, ingress, data ownership, deploy paths, and the verified `CS-1`…`CS-9` defects.
- [`docs/cloudflare/decision-register.md`](decision-register.md) — `CF-D01`…`CF-D17`, the resumable open-decision state this hub means by "an approved RFC or decision from the consolidation plan".
- [`docs/cloudflare/risk-register.md`](risk-register.md) — `CF-R01`…`CF-R21`, one-way doors, agent hard stops, and false-comfort items.
- [`docs/cloudflare/roadmap.md`](roadmap.md) — dependency-ordered waves. Active wave: Wave 0 (understanding and scaffolding, no live mutation).
- [`docs/cloudflare/operator-evidence.md`](operator-evidence.md) — read-only live-evidence runbook. **Canonical for `OPS-NN` identifiers**; every other document cites these and never renumbers them.

### Project contract and executable truth

- [`AGENTS.md`](../../AGENTS.md) — repository-wide agent authority and remote-operation gates.
- [`packages/cloudflare-do/wrangler.jsonc`](../../packages/cloudflare-do/wrangler.jsonc) — Worker, Durable Object, AI, secret, and observability configuration.
- [`packages/web/wrangler.jsonc`](../../packages/web/wrangler.jsonc) — Pages output and Service Binding configuration.
- [`packages/cloudflare-do/worker-configuration.d.ts`](../../packages/cloudflare-do/worker-configuration.d.ts) and [`packages/web/worker-configuration.d.ts`](../../packages/web/worker-configuration.d.ts) — generated binding types.
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — validation and deployment orchestration.
- [`package.json`](../../package.json), [`packages/web/package.json`](../../packages/web/package.json), and [`packages/cloudflare-do/package.json`](../../packages/cloudflare-do/package.json) — executable local/package commands. Their deploy scripts are operator-only escape hatches, do not run the complete validation gate themselves, and are not the canonical routine production path.
- [`docs/development/toolchain.md`](../development/toolchain.md) — version and configuration strategy.
- [`scripts/cloudflare-config-audit.mjs`](../../scripts/cloudflare-config-audit.mjs) — offline, read-only static audit of the Wrangler configuration invariants. Advisory (exits 0) without `--strict`; not yet wired into any gate.

### Agent and operator access

- [`docs/PROJECT-MCP-CONFIG.md`](../PROJECT-MCP-CONFIG.md) — tool-selection and authentication model.
- [`docs/MCP-SETUP.md`](../MCP-SETUP.md) — client setup and security boundaries.
- `.mcp.json` `cloudflare-docs` (enabled) and `cloudflare-api` (opt-in, per-client OAuth) — official Cloudflare MCP services; see [`docs/MCP-SETUP.md`](../MCP-SETUP.md).
- [`scripts/with-dicee-cloudflare.sh`](../../scripts/with-dicee-cloudflare.sh) — command-scoped Wrangler/API authentication.

### Current descriptive context

- [`docs/architecture/MULTIPLAYER_PERSISTENCE_ARCHITECTURE.md`](../architecture/MULTIPLAYER_PERSISTENCE_ARCHITECTURE.md) — storage-first room/lobby design and reconnection model.
- [`docs/architecture/GAME_ROOM_TECHNICAL_REPORT.md`](../architecture/GAME_ROOM_TECHNICAL_REPORT.md) — detailed game-room description.
- [`docs/testing/durable-objects-testing.md`](../testing/durable-objects-testing.md) — legacy testing guide pending reconciliation; current tests and package scripts outrank it.

### Consolidation plan

- [`docs/planning/dicee-cloudflare-resource-guidance.md`](../planning/dicee-cloudflare-resource-guidance.md) — researched target-state proposal and the plan for consolidating Cloudflare documentation.

The plan proposes substantial changes, including OpenTofu ownership of D1/R2,
separate `dicee-web` and `dicee-game` Workers, a possible `GlobalLobby` to
`LobbyShard` transition, and eventual Supabase coexistence or migration. None of
those proposals describe current implementation or carry deployment authority.

Three draft RFC stubs capture the decisions that warrant durable records. All are
**Draft — not accepted**; each links back to the decision id it will resolve:

- [`docs/rfcs/adr-005-durable-object-lifecycle.md`](../rfcs/adr-005-durable-object-lifecycle.md) — Durable Object lifecycle: `migrations` baseline and the deferred standalone `exports` deploy (`CF-D10`).
- [`docs/rfcs/rfc-004-frontend-platform-and-ingress.md`](../rfcs/rfc-004-frontend-platform-and-ingress.md) — Pages vs. Workers Static Assets, and in-Worker authorization (`CF-D02`, `CF-D11`).
- [`docs/rfcs/rfc-005-durable-data-strategy.md`](../rfcs/rfc-005-durable-data-strategy.md) — D1, R2, and the Supabase future (`CF-D06`, `CF-D01`).

## Legacy and historical material

The following files contain useful evidence but are not operational authority:

- `docs/deployment-checklist.md` — safe supersession pointer; not an operational runbook.
- `docs/debugging-protocol.md` and `.claude/DEBUGGING.md` — legacy direct-deploy debugging instructions.
- `.claude/cli-reference.yaml` — versioned CLI snapshot with obsolete Cloudflare examples.
- `Telemetry-Observability-Report.md` — historical observability report that predates current redaction rules.
- `docs/bug-reporter-plan.md` and `docs/planning/*` — plans and investigations, not current configuration.
- `docs/archive/*` — explicitly historical.
- `docs/references/cloudflare/*` — ignored local cache of external documentation; useful for discovery only and never authoritative over live official sources.

## Required workflow for Cloudflare changes

1. Read `AGENTS.md`, this hub, the nearest source and tests, and both relevant
   `wrangler.jsonc` files.
2. Classify the task as current-state maintenance or target-state architecture.
   Target-state work must reference an approved RFC or decision from the
   consolidation plan.
3. Retrieve current official Cloudflare documentation and changelogs for every
   version-sensitive API, schema, limit, billing, or lifecycle claim.
4. Check the applicable organization policy. Until that policy is incorporated,
   record the check as pending rather than assuming conformance.
5. Keep bindings least-privileged, secrets command-scoped, and public ingress
   explicit. Never infer live state from repository configuration.
6. After `wrangler.jsonc` changes, regenerate and check the package's Worker
   types, run focused tests, and perform a Wrangler dry run.
7. Treat deployment, secret changes, live reads beyond an authorized scope, and
   provider/IaC mutation as operator-gated actions.
   `.github/workflows/ci.yml` is the canonical production deployment route; do
   not substitute root or package deploy scripts for its validation and approval
   path.
8. Update this hub and the affected current-state document in the same change;
   archive or label superseded guidance.

## Consolidation completion criteria

The Cloudflare documentation refresh is complete only when:

- organization policies are mapped to explicit Dicee controls;
- the target architecture decisions are accepted or rejected in durable RFCs;
- one current architecture document describes the implemented topology;
- one deployment runbook matches CI, rollback, secrets, and environment policy;
- one testing/observability guide matches current tooling and redaction rules;
- legacy commands are removed or archived;
- all active entry points link here; and
- a clean clone contains the complete authority chain.
