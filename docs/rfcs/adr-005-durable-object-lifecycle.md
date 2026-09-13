# ADR-005: Durable Object Lifecycle and Namespace Ownership

**Project:** Dicee — Cloudflare Platform Workstream
**ADR Status:** Draft — not accepted
**Lifecycle mode:** `migrations` (baseline, owner decision 2026-09-12; `exports` deferred)
**Version:** 0.2
**Date:** July 22, 2026
**Last reviewed:** 2026-09-12
**Authors:** Cloudflare workstream (agent-drafted stub)
**Reviewers:** Operator decision required — not yet reviewed

> **Machine-read header.** `scripts/cloudflare-config-audit.mjs` rule B3 reads the two lines
> above. While the status is not `Accepted`, the Worker config must use `migrations`. Once
> the ADR is accepted, the config must use the mode named on the **Lifecycle mode:** line.
> Change both lines in the same commit as the config change they authorise.

---

## Document Status & Versioning

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1 | 2026-07-22 | Initial stub. Context captured from the 2026-07-22 evidence bundle. Identifiers normalized to the canonical `OPS-` and `CF-D` registers in the same day's review pass. No decision made. | Superseded |
| 0.2 | 2026-09-12 | Records the binding owner decision for the baseline: `packages/cloudflare-do/wrangler.jsonc` keeps the legacy `migrations` array (v1 `GameRoom`, v2 `GlobalLobby`, `new_sqlite_classes`), and `exports` adoption is deferred to a standalone operator deploy with OPS-02 evidence. Adds the machine-read **Lifecycle mode:** header line. Adoption itself is still undecided. | Current |

**Related Documents:**
- Operator evidence runbook: [`../cloudflare/operator-evidence.md`](../cloudflare/operator-evidence.md) — sole authority for `OPS-` identifiers
- Decision register: [`../cloudflare/decision-register.md`](../cloudflare/decision-register.md) — will resolve **CF-D10** when accepted; sets standing policy for **CF-D03** and **CF-D05**
- Cloudflare authority hub: [`../cloudflare/README.md`](../cloudflare/README.md)
- Target-state research: [`../planning/dicee-cloudflare-resource-guidance.md`](../planning/dicee-cloudflare-resource-guidance.md) §7, §8
- [RFC-004: Frontend Platform, Worker Identity, and Ingress Ownership](./rfc-004-frontend-platform-and-ingress.md) — depends on the rename policy set here
- [RFC-005: Durable Data Strategy — D1, R2, and Supabase](./rfc-005-durable-data-strategy.md)

> **Numbering note.** `rfc-001-statistical-engine.md` reserved "ADR-005: Property-Based Testing
> Requirements — Planned (Phase 6)" in its Related ADRs list. That ADR was never written and no
> file exists for it. The directory is the authority for numbering, so this ADR takes `adr-005`.
> The same list also mislabels RFC-002 (it became UI/UX Canvas, not curriculum integration), so
> treat those forward references as stale planning text.

---

## Abstract

This ADR will decide how Dicee sequences its first `wrangler deploy` under the declarative
Durable Object `exports` configuration, and what standing procedure governs any future Durable
Object class rename or cross-Worker move. The change is irreversible in a specific, documented
way: once a Worker has been deployed with `exports`, subsequent deploys cannot return to the
legacy `migrations` array, and rollbacks cannot cross a lifecycle change. The decision is
therefore about **sequencing and pre-flight**, not about whether `exports` is correct.

**No adoption decision has been made.** This stub captures the context so a future author does
not have to re-derive it.

**Baseline decision (owner, 2026-09-12, binding).** The baseline commit keeps the legacy
`migrations` array in `packages/cloudflare-do/wrangler.jsonc`. Its tags match the history
HEAD's `wrangler.toml` already applied: `v1` creates `GameRoom` and `v2` creates `GlobalLobby`,
both as `new_sqlite_classes`. Adopting declarative `exports` is **deferred**. It becomes a
standalone operator deploy, run only after this ADR is accepted and only with OPS-02 evidence
on file; see [Deferred `exports` adoption](#deferred-exports-adoption). This implements
Option C for the baseline, and it removes the one-way door from the baseline deploy. It does
not decide how or when `exports` is adopted.

---

## Context

### C1. The configuration that would be deployed is not committed

Both Cloudflare configs and the entire supporting authority chain are untracked in Git, and the
superseded TOML configs are deleted in the working tree but still present at HEAD.

```
$ git status --porcelain | grep -Ei 'wrangler|AGENTS|cloudflare'
?? AGENTS.md
?? docs/cloudflare/
?? docs/planning/dicee-cloudflare-resource-guidance.md
?? packages/cloudflare-do/wrangler.jsonc
?? packages/web/wrangler.jsonc
 D packages/cloudflare-do/wrangler.toml
 D packages/web/wrangler.toml

$ git archive HEAD | tar -t | grep wrangler
packages/cloudflare-do/wrangler.toml
packages/web/wrangler.toml
```

`git check-ignore` returns nothing for any of the untracked paths, so they are untracked by
omission, not by ignore rule. A clean clone gets the superseded configuration:
`git show HEAD:packages/cloudflare-do/wrangler.toml` has `compatibility_date = "2025-01-01"`
(line 6) and `[[migrations]]` / `new_sqlite_classes` at lines 26–32, repeated under
`[[env.production.migrations]]` at lines 60–66.

### C2. CI does not validate wrangler configuration — at either revision

This corrects a natural but wrong assumption. `.github/workflows/ci.yml` contains **no** wrangler
config validation of any kind at HEAD: its only two wrangler references are `wrangler-action`
deploy steps, and the `cloudflare-do` type check is `tsc --noEmit`, which never parses wrangler
config.

`.github/workflows/ci.yml` is itself modified in the working tree, and the two revisions deploy
under materially different conditions:

| | HEAD (`git show HEAD:.github/workflows/ci.yml`) | Working tree |
|---|---|---|
| Deploy trigger | `if: github.ref == 'refs/heads/main' && github.event_name == 'push'` (line 271) | `if: github.event_name == 'workflow_dispatch' && inputs.deploy` (line 102) |
| Worker deploy command | `command: deploy --env production` (line 301) | `command: deploy --env=""` (line 130) |
| Action pin | `cloudflare/wrangler-action@v3` (line 296) | SHA-pinned `@ebbaa158…` v4 (line 125) |

> **Update 2026-09-12.** The working-tree `ci.yml` deploy jobs now also require
> `github.ref == 'refs/heads/main'` (lines 99 and 146), run in a non-cancellable
> `production-deploy` job concurrency group, and build `@dicee/shared` before deploying
> (P1-08). HEAD still deploys on push. The coupling hazard below is unchanged: the config and
> `ci.yml` must land together.

This produces a coupling hazard that is sharper than "CI validates the wrong file". The untracked
`packages/cloudflare-do/wrangler.jsonc` declares **no `production` environment** — only the
top-level config plus `env.development` (line 37) and `env.staging` (line 50). Committing the
JSONC without simultaneously landing the working-tree `ci.yml` would leave a push to `main`
invoking `deploy --env production` against a config in which that environment does not exist.
**The config file and the deploy command must change in the same commit.**

### C3. What the `exports` adoption actually is

> **Superseded in the working tree (2026-09-12).** The block quoted below is the 2026-07-22
> revision. Under the baseline decision, `packages/cloudflare-do/wrangler.jsonc:12-15` now
> declares the `migrations` array (`v1` / `v2`, `new_sqlite_classes`) and has no `exports` key.
> The analysis below still describes what the deferred adoption deploy would change.

The 2026-07-22 revision of `packages/cloudflare-do/wrangler.jsonc:8-17` declared:

```jsonc
"exports": {
    "GameRoom":    { "type": "durable-object", "storage": "sqlite" },
    "GlobalLobby": { "type": "durable-object", "storage": "sqlite" }
}
```

with no `migrations` array anywhere in the file. Storage declaration is correct by construction:
HEAD's `wrangler.toml` created both classes with `new_sqlite_classes`, which maps to
`"storage": "sqlite"`. Code agreement holds: `packages/cloudflare-do/src/worker.ts:15` is
`export { GameRoom, GlobalLobby };`.

Verified live against `developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/`
(retrieved 2026-07-22, page dated 2026-07-15):

- Adoption over a `migrations`-provisioned Worker requires **no data migration** — "the
  provisioned namespaces remain in place; only the configuration shape changes."
- There is **no silent-delete path**. Deletion requires an explicit `"state": "deleted"`
  tombstone, and even then two preconditions are enforced at deploy time
  (`tombstone_delete_class_still_in_code`, `tombstone_delete_blocked_by_external_bindings`).
  Config/code/provisioned disagreements surface as deploy-failing errors:
  `orphaned_provisioned_namespace`, `provisioned_class_missing_from_config`,
  `config_export_not_in_code`, `storage_type_mismatch`.
- **Do not generalise this to "everything is fail-closed."** The same page states that
  disagreements are surfaced as structured errors "or, where the intent is unambiguous, actions
  that Cloudflare applies for you," and never enumerates which disagreements fall in the second
  branch. The `Updated` reconciliation action line is likewise unexplained.

### C4. The irreversible properties

| Property | Source |
|---|---|
| "Once a Worker has been deployed with `exports`, subsequent deploys cannot return to the legacy `migrations` array." | DO migrations reference (live, 2026-07-22) |
| Rollbacks "will not be allowed if a Durable Object class lifecycle change … has occurred between the version in the active deployment and the version selected to roll back to." | `workers/versions-and-deployments/rollbacks/` |
| "Versions of Worker bundles that change Durable Object class lifecycle cannot be uploaded" — so `wrangler versions upload` fails fast and there is no stage-then-promote path. | `workers/versions-and-deployments/deployment-management/` |
| Gradual deployments are unsupported for lifecycle changes; Cloudflare advises "Durable Object lifecycle changes should be deployed independently of other code changes." | `gradual-deployments/with-durable-objects/` |

### C5. `--dry-run` gives zero lifecycle signal

Reconciliation is computed server-side and returned only in the PUT response body as
`exports_reconciliation`. Confirmed in the installed wrangler 4.113.0 bundle: with `exports`
present, `resolveDoLifecyclePayload` sends the map verbatim with no client-side lookup (unlike
the legacy `migrations` path, which did fetch the deployed `migration_tag`). Confirmed
empirically — a dry run against this repo's config printed only the bindings table
(`GAME_ROOM`, `GLOBAL_LOBBY`, `AI`, `ENVIRONMENT`) and exited.

**A clean local dry run is not evidence of lifecycle safety.** There is no documented way to
preview the planned lifecycle diff without deploying.

### C6. The current diff bundles the lifecycle change with everything else

The uncommitted working tree changes, in one diff:

| Change | From (HEAD `wrangler.toml`) | To (`wrangler.jsonc`) |
|---|---|---|
| DO lifecycle | `[[migrations]]` | declarative `exports` (lines 8–17) |
| `compatibility_date` | `2025-01-01` | `2026-07-21` (line 6) |
| `secrets.required` | absent | 3 names (line 26) — a **deploy-time gate** |
| `observability` | absent | logs 100%, traces 10% (lines 28–32) |
| `workers_dev` | absent (platform default `true`) | `false` (line 5) |
| Environments | `[env.production]` | `env.development`, `env.staging`; production moved to top level |

This is roughly eighteen months of runtime-behaviour change plus a new hard deploy gate plus an
irreversible lifecycle transition, in a single deploy, against Cloudflare's explicit advice.

> **Update 2026-09-12.** The DO lifecycle row no longer applies to the baseline. The working tree
> keeps `migrations` (`wrangler.jsonc:12-15`), identical to HEAD, and adds `preview_urls: false`
> (`:6`). The other rows still ship together in the first baseline deploy, and the Worker target
> changes from HEAD CI's `dicee-production` to `dicee`. That target change is why OPS-02 gates
> the baseline deploy.

### C7. `secrets.required` semantics, stated precisely

`secrets.required` is GA since wrangler 4.88.0 (installed is 4.113.0, which is also npm-latest).
Per the live configuration reference and the installed `config-schema.json`, it does exactly three
things:

1. Drives `wrangler types` generation, replacing `.dev.vars`/`.env` inference.
2. Causes `wrangler deploy` and `wrangler versions upload` to fail when a listed secret is not
   configured on the Worker.
3. Enables local-dev validation warnings, and scopes which `.dev.vars`/`.env` keys load.

It does **not** control what the runtime `env` contains. Secrets provisioned with
`wrangler secret put` remain bound whether or not they are listed. Two facts follow:

- `SUPABASE_JWT_SECRET` is read at `packages/cloudflare-do/src/GameRoom.ts:699` and
  `packages/cloudflare-do/src/api/transcribe.ts:47` but is absent from every `secrets.required`
  list. The consequence is a **silent local-dev drop** (once `secrets` is declared, keys not in
  `required` and not in `vars` are not loaded from `.dev.vars`), plus no deploy-time presence
  guardrail. It is not a runtime break, and deployments never delete secrets, so an
  already-provisioned value survives.
- Conversely, **adding** a name to `required` that is not set on the target Worker will hard-fail
  the deploy. The research doc's §6 proposal at
  `docs/planning/dicee-cloudflare-resource-guidance.md:372` adds `SUPABASE_JWT_SECRET` to
  `required`; under the documented validation that would block any deploy to an environment which
  has not provisioned the legacy HS256 secret. That same line also drops `SUPABASE_URL` and
  `SUPABASE_ANON_KEY`, both of which are genuinely read (`GameRoom.ts:295,328,346,698`,
  `api/transcribe.ts:47`, `auth.ts:183` builds the JWKS URL, `auth.ts:241-247` fails closed
  without it; `GameRoom.ts:296,347` → `persistence-queue.ts:261,267,271`) — so the block's inline
  comment "the backend reads these" is inaccurate. Dropping them would forfeit the deploy-time
  presence guardrail and shrink typegen; it would still compile, because
  `packages/cloudflare-do/src/types.ts:34-48` hand-declares all four in `SecretBindings`.

There is also a first-deploy interaction worth recording: `addRequiredSecretsInheritBindings` in
the installed wrangler throws on a first deploy to a Worker that does not yet exist, directing
you to `wrangler deploy --secrets-file <path>`. Dicee's CI avoids this only by accident — the
`wrangler-action` `secrets:` input runs `wrangler secret bulk` *before* the deploy command, and
`secret bulk` auto-creates a placeholder draft Worker in non-interactive contexts.

### C8. Renames — what the repository actually costs

**Worker service rename** (`dicee` → `dicee-game-{env}`, CF-D03): Durable Object namespaces are
keyed to the Worker script name. A service rename produces a **new Worker with empty namespaces**
unless the four-deploy `expecting-transfer` / `transferred` two-phase transfer is executed across
both configs. It also breaks exactly one repository reference — `packages/web/wrangler.jsonc:7`
`{ "binding": "GAME_WORKER", "service": "dicee" }` (repeated at line 14 for `env.preview`) — after
which every backend route 503s. No CI job deploys the Worker, so nothing would catch it.

**DO class rename** (`GlobalLobby` → `LobbyShard`, CF-D05): 7 repository sites plus generated
types plus an `exports` `renamed` / `renamed_to` lifecycle entry. Cloudflare documents a
three-deploy alias / rename / remove-alias procedure for zero downtime; a single-deploy rename has
a brief window where the namespace class pointer and the exported code disagree.

A commonly-stated risk here needs correcting: the AKG invariant
`packages/web/src/tools/akg/invariants/definitions/globallobby-uses-shared.ts:32-40` does **not**
fail open on a *class* rename. AKG has no class-level nodes — `NodeType` in
`schema/graph.schema.ts` has no `Class`, and node names are derived from the file basename
(`discovery/node-factory.ts:66-67`). Renaming the class leaves the `Module` node named
`GlobalLobby` intact. The fail-open at lines 36–40 triggers when the **file** is renamed or moved,
which is the realistic restructure move. Separately,
`invariants/definitions/shared-isolation.ts:37` hardcodes `packages/cloudflare-do/` as a forbidden
import target, so AKG does provide reverse-direction coverage — "zero coverage" is too strong.
What is true: `pnpm akg:check` reads the committed `docs/architecture/akg/graph/current.json`
(`cli/check.ts:72-93`) and never re-discovers source, and neither `pnpm lint` nor CI runs
`akg:discover` — so after a file move the invariants would keep validating a stale graph and
report green.

### C9. Storage is never reclaimed

`rg -c "deleteAll" packages/cloudflare-do/src` returns no matches. On game over the room is
flipped to `completed` / `abandoned` and written back; `room`, `room_code`, `game_state`,
`alarm_queue`, `chat:*` and the per-room SQLite tables persist indefinitely. Durable Object SQLite
storage is priced at 5 GB-month included on Workers Paid, then $0.20/GB-month — treat it as billed
for planning purposes, subject to the enablement caveat recorded with the operator questions below.
Related: `GlobalLobby.ts:950-958`
uses `setTimeout` inside a Durable Object for deferred room removal — the code comment concedes
it — so finished-room directory entries leak whenever the lobby hibernates inside the window.

These are fix items, not decisions, but they bear on the storage-lifecycle policy this ADR sets.

---

## Decision Drivers

1. **Irreversibility.** No return to `migrations`, no rollback across the change, no
   `versions upload` staging, no gradual deployment. Whatever is decided is load-bearing.
2. **No preview mechanism.** `--dry-run` cannot show the lifecycle diff, so confidence must come
   from a read-only pre-flight against live state rather than from local validation.
3. **Blast-radius isolation.** Cloudflare's explicit guidance is to deploy lifecycle changes
   independently. The current diff does the opposite.
4. **Proportionality.** Dicee is a roughly ten-user test application. A procedure that is correct
   but requires reintroducing a deleted `wrangler.toml` to stage a split deploy may cost more
   churn than it buys.
5. **Committed-state honesty.** HEAD does not contain the configuration every document describes,
   and HEAD's CI deploys to an environment the new config does not define.
6. **Standing policy.** Future rename or resharding proposals need a procedure to point at, not a
   fresh investigation each time.

---

## Options Considered

### Option A — Single deploy of the current working tree, gated on a read-only pre-flight

Commit the authority chain (config **and** `ci.yml` together, per C2), run the operator pre-flight,
then deploy once in a low-traffic window.

**Pros:** one deploy; no reintroduction of a deleted TOML config; the pre-flight converts the
main unknown into a checked precondition; reconciliation is fail-closed for every disagreement
Cloudflare enumerates.

**Cons:** if it fails, it fails with eighteen months of compatibility-date change in the same
version, so attribution is harder; accepts the bundling Cloudflare advises against; the
`secrets.required` gate fires in the same deploy.

**Note:** the success signal is **silence** — Cloudflare "omits the block when nothing changed
and there are no notices." An operator who expects a reconciliation report will misread a clean
deploy as a failure. Brief this in advance.

### Option B — Split into two deploys

Deploy (a) compatibility date + observability + `workers_dev` + `secrets.required` on the
**existing `migrations`** config, verify, then deploy (b) `exports` adoption alone.

**Pros:** matches Cloudflare's guidance exactly; deploy (a) is rollback-able, so only the isolated
lifecycle change is one-way; a failure in (b) is unambiguously attributable.

**Cons:** requires reintroducing `packages/cloudflare-do/wrangler.toml` (deleted in the working
tree) or hand-authoring an interim JSONC with a `migrations` array, purely as scaffolding; two
production deploys instead of one for a ten-user app; the interim config is itself untested.

### Option C — Defer adoption entirely

Keep `migrations`, commit the rest of the working tree with the lifecycle change backed out.

**Pros:** no irreversible action; no forcing function exists — the Wrangler deprecations page does
not mention `migrations`, and the 2026-06-30 changelog says existing Workers "continue to work
unchanged."

**Cons:** leaves the repository's documented configuration permanently divergent from what is
deployable; new namespaces are SQLite-only regardless, so the direction is settled; postpones
without reducing the eventual cost.

### Rename policy sub-options (standing, not immediate)

| Sub-option | Applies to | Cost |
|---|---|---|
| Accept fresh, empty namespaces | Worker service rename | Loses `lobby:activeRooms`, `lobby:chatHistory`, and all live room state. Defensible for a test app **if written down as a decision**. |
| Four-deploy `expecting-transfer` / `transferred` | Worker service rename | Data-preserving; same-account only; ordering errors are pre-commit and fail-closed except `phase_one_transfer_after_commit_mismatch`, which is unrecoverable. |
| Three-deploy alias / rename / remove-alias | DO class rename | Data-preserving and zero-downtime; emits an expected `tombstone_class_still_in_code` info notice at step 2. |
| Single-deploy `renamed` entry | DO class rename | Schema-valid but has a brief runtime-error window; the research doc's snippet is explicitly labelled schema, not a rollout. |

---

## Consequences and Reversibility

**Irreversible under every option except C:**

- `migrations` can never be used again on this Worker.
- `wrangler rollback` cannot cross the lifecycle change. Whether the barrier is armed by a deploy
  whose reconciliation is a genuine no-op is **not documented** — assume it is.
- After adoption, deploying a config with neither `exports` nor `migrations` reconciles against an
  empty config, which Cloudflare calls "usually a mistake."

**Reversible:**

- Everything in Option B's deploy (a).
- Committing the authority chain (Git-reversible — though the *deploy* it enables is not).
- Any decision recorded here, by superseding ADR.

**Honest residual risk:** the "actions that Cloudflare applies for you" branch (C3) is
unenumerated. This is why the pre-flight in OPS-03 should be treated as mandatory rather than
prudent — it is the only way to know the inputs the control plane will reconcile.

**Not consequences of this ADR:** the storage-cleanup and `setTimeout` items in C9, and the
`SUPABASE_JWT_SECRET` question in C7, are fix items and a factual lookup respectively. They should
not block this decision, though C7 should be settled before the deploy so `secrets.required` is
correct when the gate first fires.

---

## Open Questions & Evidence Required

### Operator-only (read-only; none mutate state)

`OPS-` identifiers are canonical in
[`../cloudflare/operator-evidence.md`](../cloudflare/operator-evidence.md), and that file is the
sole authority for the numbering. Questions with no entry there are listed here without an id and
must not be assigned one.

| Id | Question | Method | Blocks |
|---|---|---|---|
| **OPS-03** | Do the namespaces provisioned for the script that owns Dicee's live state consist of exactly `GameRoom` and `GlobalLobby`, both with `use_sqlite: true`, and on the **same** script? Any extra namespace, or any KV-backed one? | `GET /accounts/{id}/workers/durable_objects/namespaces`. Needs only `Workers Scripts Read`. | The deploy. This is the single highest-value check. |
| **OPS-01** | Does a Worker named `dicee` exist, and what is deployed to it? | `wrangler deployments list --name dicee` | Which first-deploy path applies |
| **OPS-02** | Does a legacy `dicee-production` Worker exist from the deleted `[env.production]` block? Do `dicee-staging` / `dicee-development` exist? | account Workers list | Orphaned-resource risk, and whether live namespaces sit on a script the new config does not target |
| **OPS-06** | Which secret **names** are set on the script that owns live state (and on any named environment)? | `wrangler secret list` | The `secrets.required` gate |
| **OPS-04** | Did the live Durable Object state come from a legacy `migrations` array? | No confirmed read-only endpoint reports a script's migration tag — **verify before running** anything that claims to, and do not substitute a write-capable call. | Nothing on its own. Worth capturing, but adoption over a `migrations`-provisioned Worker requires no data migration, so OPS-03 — not this — is the determinative check. |
| **OPS-15** | Which Workers plan and usage model is the account on? | Dashboard, account-level settings | Nothing here directly; the runbook records it as the prerequisite for any later billing question |
| *(no canonical `OPS-` id)* | Actual Durable Object SQL stored data, rows written per month, and GB-s duration — and whether SQLite storage billing is actually being charged on this account. | The account's own Durable Objects usage and billing view | C9 sizing. See the note below. |
| *(no canonical `OPS-` id)* | Does the Supabase project still issue legacy HS256 tokens, or only asymmetric keys? | Supabase JWT signing keys, or `GET /auth/v1/.well-known/jwks.json` | C7 — whether to add `SUPABASE_JWT_SECRET` to `required` or delete the HS256 fallback. This is a Supabase question; the Cloudflare operator runbook has no entry for it and none should be invented. |

**On the storage-billing question.** Cloudflare's Durable Objects pricing page, retrieved live on
2026-07-22, is **still worded in future tense**. It carries a callout reading that storage billing
on SQLite-backed Durable Objects "will be enabled in January 2026, with a target date of January 7,
2026 (no earlier)", and that "only SQLite storage usage on and after the billing target date will
incur charges." Rates on the same page are 5 GB-month included on Workers Paid, then $0.20/GB-month.
The announced target date is now roughly six months past, but the page has not been rewritten out of
the future tense — so the documentation **alone** does not confirm that billing was switched on, and
equally does not show that it was not. Whether this account is actually being charged is answerable
only from its own billing and usage view, which is why the question above routes to an operator
lookup rather than to a documentation assertion. **Plan as though storage is billed** — that is the
prudent assumption and the C9 analysis is built on it — while recording the enablement question as
open.

### Undocumented / unresolved upstream

- Which class-level disagreements fall into the "actions that Cloudflare applies for you" branch
  rather than the structured-error branch, and what the `Updated` reconciliation line means.
- Whether the rollback barrier is armed by a lifecycle *adoption* that creates, renames and
  deletes nothing.
- Whether deploying `exports` on top of a `secret bulk`-created draft Worker (`export default
  { fetch() {} }`, no `exports`, no `compatibility_date`) transitions both classes cleanly. Only
  matters for a first deploy to a brand-new Worker name.

### Repository decisions this ADR does not make

- Whether to keep `env.development` / `env.staging` at all. Nothing in the repository consumes
  either: `packages/web/wrangler.jsonc:14` binds Pages **preview** to `service: "dicee"`, i.e.
  production Durable Object state, and CI has no staging job. Pages accepts only `preview` and
  `production` as environment names, so a Worker `staging` env has no one-to-one Pages mirror.

---

## Decision

### Baseline (owner decision, 2026-09-12 — binding)

The baseline keeps `migrations`. `packages/cloudflare-do/wrangler.jsonc:12-15` declares
`{ "tag": "v1", "new_sqlite_classes": ["GameRoom"] }` and
`{ "tag": "v2", "new_sqlite_classes": ["GlobalLobby"] }`. That is the history HEAD's
`wrangler.toml` applied (lines 26-32, repeated under `[env.production]` at 60-66). Both keys are
inheritable in wrangler 4.113.0 (`inheritable(… "migrations" …)` in the installed normalizer),
so the array is declared once at the top level and inherited by `env.development` and
`env.staging`. The same commit adds `"preview_urls": false` next to `"workers_dev": false`.

What this does and does not buy:

- Wrangler 4.113.0 `getMigrationsToUpload` reads the target script's `migration_tag`. If the tag
  is `v2`, it uploads no migration step, so the baseline deploy is a Durable Object lifecycle
  no-op. If the script has no tag, it uploads `v1` and `v2` as a first provision.
- `resolveDoLifecyclePayload` skips that lookup under `--dry-run`, so a dry run proves nothing
  about the lifecycle in `migrations` mode either (C5 still applies).
- OPS-02 is therefore a precondition for the **baseline** deploy, not just for adoption. If the
  live namespaces belong to `dicee-production`, deploying the top-level `dicee` target creates
  empty namespaces on `dicee`. That is not destructive, but it is a cross-Worker discontinuity:
  stop and decide.
- The baseline deploy still carries the compatibility-date jump, `secrets.required`, and the
  Worker target change. All of those can be rolled back; the lifecycle change is the part that
  cannot, and it is no longer in the bundle.

`scripts/cloudflare-config-audit.mjs` enforces the baseline:

- B2 requires exactly one lifecycle mode.
- B3 requires the mode this ADR authorises, read from the header.
- B3E keeps the lifecycle keys at the top level.
- B2H fails if an applied tag is edited or reordered.
- B1 and B1P require `workers_dev` and `preview_urls` to be `false`.

### Deferred `exports` adoption

Adopting `exports` is a **standalone operator deploy**. It may not be bundled with any other
code, config, secret or compatibility-date change. It requires, in order:

1. This ADR accepted, with its header changed in the same commit as the config to
   `**ADR Status:** Accepted` and `**Lifecycle mode:** \`exports\``. Config audit B3 fails any
   other combination.
2. The baseline `migrations` deploy has landed on the same script and been verified. The
   adoption deploy then changes nothing but the lifecycle shape.
3. OPS-02 evidence on file: which script holds the live `GameRoom` and `GlobalLobby`
   namespaces, and which script the Pages `GAME_WORKER` binding targets. If they are not both
   `dicee`, stop.
4. OPS-03 and OPS-06 receipts, as described under the recorded leaning below.
5. A `workflow_dispatch` deploy from `main` in a low-traffic window, with the operator briefed
   that silence is the success signal. Capture the reconciliation output as a receipt.

### Adoption decision — not yet made

The recorded leaning from the 2026-07-22 synthesis is **Option A with a hard precondition** — run
**OPS-01, OPS-02, OPS-03, OPS-04 and OPS-06** first. If the namespaces are exactly
`{GameRoom, GlobalLobby}` with `use_sqlite: true`, both on the **same** script, and that script is
the one the `GAME_WORKER` service binding targets, and the three required secrets are set on it,
then commit the working tree (config and `ci.yml` together) and deploy once. Fall back to Option B
if OPS-03 surfaces anything unexpected, and stop entirely if OPS-02 shows live namespaces on
`dicee-production` while the new config targets `dicee` — that is a cross-Worker discontinuity, not
a lifecycle transition.

**OPS-03 is the gate; OPS-04 is not a blocker.** The decision register lists OPS-04 among the
pre-flight items, and it is worth attempting — but the operator runbook reframes it as
non-determinative and records that there is **no confirmed read-only endpoint** that reports a
script's legacy migration tag. Cloudflare documents adoption over a `migrations`-provisioned Worker
as requiring no data migration, so what makes the transition safe is exactly what OPS-03 returns.
Treat an unanswered OPS-04 as an accepted gap, not as a reason to hold the deploy, and do not
substitute a write-capable call to close it.

That leaning is not an acceptance and carries no authority.

Until this ADR is accepted, treat the following as prohibited:
- adding `exports` to `wrangler.jsonc`, or changing this header's **Lifecycle mode:**;
- editing, reordering or removing an applied migration tag (`v1`, `v2`), or adding a new
  migration step;
- adding a `"state": "deleted"` tombstone;
- renaming the Worker service or either Durable Object class;
- any agent-run `wrangler deploy`.

The earlier prohibition on "reintroducing a `migrations` array" is withdrawn. The 2026-09-12
owner decision reintroduced one on purpose, before OWD-1 was crossed, and that is exactly what
risk-register HS-1 permits. The baseline `migrations` deploy is an operator action gated on
OPS-02, not on this ADR.

---

## Decision Record

| Date | Author | Decision |
|------|--------|----------|
| 2026-07-22 | Cloudflare workstream | ADR drafted as a stub. No decision. Operator evidence outstanding (OPS-01, OPS-02, OPS-03, OPS-04, OPS-06, OPS-15, plus two questions with no canonical `OPS-` id: Durable Object storage usage/billing, and the Supabase HS256-versus-asymmetric JWT question). |
| 2026-09-12 | Owner (recorded by the modernization workstream, package P1-09) | **Baseline decided:** the baseline `wrangler.jsonc` keeps `migrations` `v1` (`GameRoom`) and `v2` (`GlobalLobby`) as `new_sqlite_classes`, plus `preview_urls: false`. `exports` adoption is **deferred** to a standalone operator deploy after this ADR is accepted, with OPS-02 evidence. Adoption itself is still undecided, and this ADR stays Draft. Local evidence only: `wrangler types --check` up to date, and `wrangler deploy --dry-run` clean for `--env=""` and `--env=staging` (dry runs carry no lifecycle signal). No deploy was performed. |

**Status:** Draft — not accepted. Nothing in this document authorises a deploy, a migration, a
secret change, or any provider mutation.

---

## Questions for Review

1. Is one production deploy with a verified pre-flight (Option A) acceptable for a ten-user test
   application, or is Cloudflare's independent-deploy guidance worth the scaffolding cost of
   Option B?
2. Should the storage-cleanup work in C9 land *before* the lifecycle deploy, so the first
   `exports` deploy also stops unbounded storage growth, or after, to keep the lifecycle deploy
   minimal?
3. For a future Worker rename: is losing all Durable Object state an acceptable recorded decision,
   or must the four-deploy transfer be budgeted?
4. Should `env.development` and `env.staging` be deleted rather than carried forward unconsumed?
5. Who is briefed that a **silent** deploy is the success signal?
