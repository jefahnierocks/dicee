# Dicee Cloudflare authority and resource consolidation plan

- **Status:** accepted planning input; not current implementation or deployment authority
- **Imported:** 2026-07-21 from an operator-supplied research document
- **Research basis:** official Cloudflare, provider, OpenTofu, and SvelteKit documentation reviewed by the document author on 2026-07-21
- **Independent check:** critical platform claims rechecked against primary sources on 2026-07-21; corrections incorporated below
- **Audience:** agents, developers, reviewers, and operators planning Dicee's Cloudflare architecture
- **Current authority map:** [`docs/cloudflare/README.md`](../cloudflare/README.md)

This document is the researched basis and execution plan for consolidating
Dicee's scattered Cloudflare guidance. It reconciles a proposed platform
architecture, an earlier IaC scaffold, and a corrected scaffold. It does not
assert that the proposed D1, R2, OpenTofu, Worker split, class rename, or
Supabase migration has been approved or implemented in this repository.

Every version-sensitive claim must be rechecked against live official sources
when its implementation phase begins. No command or checklist in this document
authorizes a deployment, provider mutation, secret change, migration, or live
environment operation.

## 0. Planning contract

### Current baseline

Current source and configuration use:

| Concern | Current repository implementation |
|---|---|
| Frontend | SvelteKit on Cloudflare Pages in `packages/web` |
| Internal compute | Worker named `dicee` in `packages/cloudflare-do` |
| Web-to-Worker boundary | `GAME_WORKER` Service Binding |
| Strongly consistent state | SQLite-backed `GameRoom` and `GlobalLobby` Durable Objects |
| AI | Workers AI binding on the Durable Object Worker |
| Authentication and relational persistence | Supabase |
| Infrastructure as code | No Dicee OpenTofu/Terraform module exists |
| D1 and R2 | Not implemented in current source |
| Deployment | Manual-dispatch GitHub Actions flow in the current working tree |

Repository configuration is not evidence that the same state is live. Live
bindings, routes, secrets, deployments, and organization policy require separate
authorized verification.

### Candidate decisions

The research below proposes a target architecture. Each proposal remains a
decision gate rather than an instruction:

| Decision | Proposed direction | Status |
|---|---|---|
| Cloudflare resource ownership | OpenTofu for D1/R2; Wrangler for Workers and bindings | Pending architecture and organization-policy review |
| Frontend platform | Move from the present Pages configuration to a dedicated `dicee-web` Worker/Static Assets topology | Pending; current Pages deployment remains authoritative |
| Backend identity | Replace Worker `dicee` with `dicee-game-{environment}` | Pending migration and rollback design |
| Service Binding | Rename `GAME_WORKER` to `GAME_SERVICE` | Pending coordinated code/config migration |
| Lobby topology | Rename or replace `GlobalLobby` with `LobbyShard` | Pending product need, state-transfer decision, and tests |
| Durable data | Introduce D1 and R2, with Supabase coexistence or retirement | Pending data model, privacy, retention, and migration RFC |
| Custom domains | Manage Worker custom domains through Wrangler routes | Pending organization DNS/domain policy review |
| Cloudflare Access | Optionally manage tester access through OpenTofu | Pending identity and organization Access policy review |

### Consolidation workstreams

1. **Establish authority:** maintain `docs/cloudflare/README.md` as the single
   navigation and governance entry point; make all agent entry files defer to it.
2. **Quarantine conflicts:** label or archive direct-deploy, obsolete
   `wrangler.toml`, stale CLI, unsafe token-testing, and pre-redaction logging
   guidance.
3. **Decide architecture:** create durable RFCs for resource ownership, Pages
   versus Workers Static Assets, D1/R2 adoption, Worker identity, Durable Object
   lifecycle, and Supabase coexistence.
4. **Map organization policy:** identify the controlling Cloudflare repository
   or policy set and produce a requirement-to-control matrix. No conformance is
   claimed until this is complete.
5. **Implement approved decisions:** change source/configuration in small,
   reversible phases with generated types, tests, dry runs, data migration and
   rollback plans.
6. **Publish operational guidance:** replace the legacy deployment, testing,
   debugging, and observability documents with current runbooks that link back
   to the authority hub.

### Plan acceptance criteria

- A clean clone contains the authority hub, this plan, and every referenced
  active source.
- Current-state documentation never describes a proposal as deployed.
- Every adopted target-state choice has an RFC, organization-policy result,
  implementation evidence, and rollback path.
- No active guide contains unscoped `npx wrangler`, direct production deploy,
  raw-token extraction, or obsolete `wrangler.toml` instructions.
- Cached external documentation is discovery material only; live official docs,
  installed schemas/types, and verified configuration provide platform truth.

## Research guidance for the candidate target state

The remainder of this document preserves the supplied research. Its error table
is authoritative only for the scaffold variants it evaluated; adoption in Dicee
depends on the decision gates above.

Candidate target-state guardrails:
- The account ID is a variable with **no default** — inject it from the secrets manager, never commit it.
- Provider source is `cloudflare/cloudflare`. Terraform and OpenTofu resolve
  that short source address through their respective default public registries
  or configured mirrors; do not assume a run queries both registries.
- "Terraform" below means **OpenTofu** in this project (`tofu`), which is API-compatible.

---

## 1. Candidate ownership decision

**Proposal:** OpenTofu owns durable data-plane resources, Wrangler owns Workers,
and GitHub Actions sequences them.

| Layer | Owner | Resources |
|---|---|---|
| Data plane | **OpenTofu** | D1 databases, R2 buckets + **lifecycle rules** |
| Workers | **Wrangler** | Worker scripts, all bindings, Durable Object `exports`, custom domains (via `routes`), secrets, observability |
| Schema | **Wrangler** | D1 SQL migrations |
| Identity/auth | **OpenTofu** *(optional)* | Cloudflare Access apps, the CI API token |
| Orchestration | **GitHub Actions** | apply → deploy backend → deploy frontend → migrate |

**Candidate rationale:** keep Workers out of OpenTofu. The GA
`cloudflare_workers_script` models code and bindings together and can create
large sensitive state/diff surfaces; the granular `cloudflare_worker`,
`cloudflare_worker_version`, and `cloudflare_workers_deployment` resources are
beta. Keeping Workers in Wrangler avoids a beta dependency and dual ownership.
This is a Dicee architecture choice, not a Cloudflare platform requirement.

If you later want Worker *identity* expressed as code (governance), the only field worth pulling into OpenTofu is `subdomain = { enabled = false, previews_enabled = false }` on the private worker via the beta `cloudflare_worker` — accept the beta caveat and pin the provider. Not required now.

---

## 2. Verified errors — do NOT reintroduce

Every row is a mistake that appeared in one or both scaffolds, with the correct form. This table is the single most important part of this document for an executing agent.

| # | Anti-pattern seen in a scaffold | Correct form | Why it matters |
|---|---|---|---|
| E1 | Frontend `wrangler.jsonc` carries `durable_objects`, `d1_databases`, `r2_buckets`, `ai`, `exports` | Frontend holds **only** `services: [{ binding: "GAME_SERVICE", service: "dicee-game-…" }]` | Least-privilege boundary. The public surface must not hold direct handles to storage/DO. |
| E2 | `assets.directory: "./build/client"` | `assets.directory: ".svelte-kit/cloudflare"` | That is exactly what `@sveltejs/adapter-cloudflare` emits (see the adapter's basic config). |
| E3 | `assets.not_found_handling: "single-page-application"` on the SSR frontend | **Omit `not_found_handling`** (use the default) | In SPA mode the adapter serves `index.html` for non-matching requests **instead of running SSR** — it breaks server rendering of any non-prerendered route. SPA mode is only for `adapter-static` pure-SPA builds. |
| E4 | Frontend `compatibility_flags: ["nodejs_compat"]` when the SSR code doesn't use Node built-ins | `["nodejs_als"]` is the documented minimum; add `"nodejs_compat"` only if SSR imports Node APIs | The adapter needs AsyncLocalStorage; `nodejs_compat` is a heavier superset you may not need on the edge worker. |
| E5 | R2 lifecycle via `null_resource` + `aws s3api put-bucket-lifecycle-configuration` | Use the first-class `cloudflare_r2_bucket_lifecycle` resource | The resource exists; the shell-out workaround is obsolete and needs AWS creds in CI. |
| E6 | `cloudflare_r2_bucket_lifecycle` written with S3-style keys: `bucket`, `status = "enabled"`, `filter = { prefix }`, `expiration = { max_age }`, `abort_incomplete_multipart_upload` | The real schema: `bucket_name`, `rules[].enabled` (bool), `rules[].conditions = { prefix }`, `rules[].delete_objects_transition = { condition = { max_age, type = "Age" } }`, `rules[].abort_multipart_uploads_transition = { condition = { max_age, type = "Age" } }` | The corrected scaffold invented an S3 schema that will fail `plan`/`apply`. `max_age` is **seconds**. |
| E7 | `data "cloudflare_zone" { account_id = …, name = … }` referenced as `.id` | v5 form: `data "cloudflare_zone" { filter = { name = … } }` referenced as `.zone_id` | That's v4 syntax on a v5 provider — it errors immediately. (Also: if custom domains move to Wrangler and no other DNS records are in TF, drop the zone data source entirely — it becomes vestigial.) |
| E8 | `cloudflare_workers_custom_domain` with `environment = each.key` | Prefer Wrangler `routes: [{ pattern, custom_domain: true }]`. If you must use the TF resource, drop `environment` (it's deprecated and caused 404/500 provider bugs) | Wrangler routes also remove the ordering problem (Worker must exist before the domain attaches). |
| E9 | Private backend Worker with no `workers_dev` setting | Set `"workers_dev": false` (and optionally `"preview_urls": false`) on `dicee-game` | Without it the "private" backend is reachable at `dicee-game-….workers.dev`. No route ≠ no ingress. |
| E10 | Provider `version = "~> 5.20"` described as latest | Use a deliberate constraint such as `~> 5.22` and commit `.terraform.lock.hcl`; 5.22.0 was current when researched | `~> 5.22` admits the 5.22 minor series, while `~> 5` admits any 5.x release; neither is an exact pin. |
| E11 | Account ID hardcoded as a variable `default` and in `terraform.tfvars.example` | Variable with **no default**; inject via `TF_VAR_cloudflare_account_id` from the secrets manager | Don't bake account identifiers into VCS. |
| E12 | `secrets.required: ["TURN_SECRET"]` | List only secrets the worker actually reads at runtime | Dicee's design has no WebRTC/TURN — voice is uploaded audio → Workers AI, not peer connections. `TURN_SECRET` is spurious; remove unless WebRTC is actually planned. |
| E13 | Assuming `@cf/openai/whisper-tiny-en` is the only/appropriate model | Keep the model in config; `@cf/openai/whisper-large-v3-turbo` is **GA** (multilingual, more accurate) | `whisper-tiny-en` is beta/English-only — fine as a cheap default, but not the only option. |

**Not an error (keep it):** the `secrets` configuration property with `required: [...]` is real, current Wrangler config. When set, `wrangler deploy` / `wrangler versions upload` fail if a listed secret isn't configured on the Worker, and in local dev only those keys are loaded from `.dev.vars`/`.env`. It's a good guardrail — just populate it with real secret names (see §8), not `TURN_SECRET`.

E2-E4 describe a **Workers Static Assets** target, not the current Cloudflare
Pages configuration. Pages already supports Service Bindings, so the
least-privilege one-binding boundary does not require a Pages-to-Workers
migration. E1, the single-binding topology, naming, and ownership split remain
Dicee design decisions.

---

## 3. Candidate resource inventory and binding-ownership rule

| Concern | Resource | Binding | Owner |
|---|---|---|---|
| Public app (SSR + assets) | Worker `dicee-web` + Static Assets | — | Wrangler |
| Private game/persistence | Worker `dicee-game` (no public ingress) | `GAME_SERVICE` (from web) | Wrangler |
| Active room state | SQLite DO `GameRoom` | `GAME_ROOM` | Wrangler (`exports`) |
| Lobby/presence | SQLite DO `LobbyShard` | `LOBBY_SHARD` | Wrangler (`exports`) |
| Relational data | D1 `dicee-app-{env}` | `APP_DB` | OpenTofu (resource) / Wrangler (binding + migrations) |
| Audio objects | R2 `dicee-audio-{env}` | `AUDIO_BUCKET` | OpenTofu (resource + lifecycle) / Wrangler (binding) |
| Transcription | Workers AI | `AI` | Wrangler |
| Auth (testers) | Cloudflare Access | — | OpenTofu (optional) |

**Binding-ownership rule (the E1 fix):** `GAME_ROOM`, `LOBBY_SHARD`, `APP_DB`, `AUDIO_BUCKET`, and `AI` live on **`dicee-game` only**. `dicee-web` gets exactly one binding — the Service Binding `GAME_SERVICE` — and reaches all data by calling `dicee-game` (including any D1 user lookup during auth/SSR). Naming convention: `dicee-{web,game,app,audio}-{staging,production}`.

---

## 4. Candidate OpenTofu module (`infra/`)

### `versions.tf`
```hcl
terraform {
  required_version = ">= 1.9.0"   # applies to OpenTofu too; validate the chosen floor
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.22"          # minor-series constraint; commit .terraform.lock.hcl
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
```

### `variables.tf`
```hcl
variable "cloudflare_account_id" {
  type        = string
  description = "Injected via TF_VAR_cloudflare_account_id from the secrets manager. No default."
}

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "environments" {
  type    = set(string)
  default = ["staging", "production"]
}

variable "primary_location_hint" {
  type    = string
  default = "wnam"    # choose per user geography
}

variable "r2_location" {
  type    = string
  default = "wnam"
}

variable "audio_retention_seconds" {
  type    = number
  default = 604800    # 7 days
}
```

### `d1.tf`
```hcl
resource "cloudflare_d1_database" "app" {
  for_each              = var.environments
  account_id            = var.cloudflare_account_id
  name                  = "dicee-app-${each.key}"
  primary_location_hint = var.primary_location_hint   # changeable without recreation on provider >= 5.8.0
}
```

### `r2.tf` — note the corrected lifecycle schema (E5/E6)
```hcl
resource "cloudflare_r2_bucket" "audio" {
  for_each   = var.environments
  account_id = var.cloudflare_account_id
  name       = "dicee-audio-${each.key}"
  location   = var.r2_location
}

resource "cloudflare_r2_bucket_lifecycle" "audio" {
  for_each    = cloudflare_r2_bucket.audio
  account_id  = var.cloudflare_account_id
  bucket_name = each.value.name          # NOT "bucket"

  rules = [
    {
      id         = "expire-transcribed-command-audio"
      enabled    = true                  # boolean, NOT status = "enabled"
      conditions = { prefix = "commands/" }
      delete_objects_transition = {
        condition = { max_age = var.audio_retention_seconds, type = "Age" }  # seconds
      }
    },
    {
      id         = "abort-stale-multipart-uploads"
      enabled    = true
      conditions = { prefix = "" }
      abort_multipart_uploads_transition = {
        condition = { max_age = 86400, type = "Age" }
      }
    }
  ]
}
```
Companion resources if needed later: `cloudflare_r2_bucket_cors` (**required** if you issue presigned URLs for direct browser uploads), `cloudflare_r2_bucket_lock`, `cloudflare_r2_bucket_event_notification`.

### `outputs.tf`
```hcl
output "d1_database_ids" {
  value = { for k, v in cloudflare_d1_database.app : k => v.database_id }
}
output "r2_bucket_names" {
  value = { for k, v in cloudflare_r2_bucket.audio : k => v.name }
}
```

**No `custom_domains.tf`, no `workers.tf`, no `dns.tf`.** Custom domains and Workers are Wrangler's job. If you later add non-Worker DNS records (MX/TXT), add a `dns.tf` with the **v5** zone data source:
```hcl
data "cloudflare_zone" "dicee" {
  filter = { name = "dicee.games" }   # reference as data.cloudflare_zone.dicee.zone_id
}
```

---

## 5. Candidate Wrangler frontend `dicee-web` (public)

Corrected for E1–E4 and E12. Stripped to assets + one service binding; adapter-correct asset wiring; no SPA `not_found_handling`; `nodejs_als`; custom domain via `routes`.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "dicee-web-production",
  "main": ".svelte-kit/cloudflare/_worker.js",
  "compatibility_date": "2026-07-21",
  "compatibility_flags": ["nodejs_als"],   // add "nodejs_compat" only if SSR imports Node built-ins

  "assets": {
    "binding": "ASSETS",
    "directory": ".svelte-kit/cloudflare"
    // no "not_found_handling" -> default lets the SSR worker render non-prerendered routes
  },

  "routes": [
    { "pattern": "dicee.games", "custom_domain": true }
  ],

  "services": [
    { "binding": "GAME_SERVICE", "service": "dicee-game-production" }
  ],

  "observability": { "enabled": true, "head_sampling_rate": 1 }

  // "secrets": { "required": [...] }  // only if THIS worker reads secrets at runtime (e.g. a session key)
}
```
- Adapter: `@sveltejs/adapter-cloudflare` (SvelteKit → Workers Static Assets). `adapter-cloudflare-workers` (Workers Sites) is deprecated.
- Bindings reach SvelteKit via `platform.env` in hooks/`+server` endpoints, so SSR calls the backend as `platform.env.GAME_SERVICE`.
- Local build test: `wrangler dev .svelte-kit/cloudflare/_worker.js` (Wrangler v4).
- Staging config is identical with `-staging` names and `"pattern": "staging.dicee.games"`.

---

## 6. Candidate Wrangler backend `dicee-game` (private)

Owns DO classes, D1, R2, AI. Corrected for E9 (`workers_dev: false`) and E12 (real secrets).

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "dicee-game-production",
  "main": "src/worker.ts",
  "compatibility_date": "2026-07-21",
  "compatibility_flags": ["nodejs_compat"],
  "workers_dev": false,
  "preview_urls": false,

  "durable_objects": {
    "bindings": [
      { "name": "GAME_ROOM",   "class_name": "GameRoom" },
      { "name": "LOBBY_SHARD", "class_name": "LobbyShard" }
    ]
  },

  "exports": {
    "GameRoom":   { "type": "durable-object", "storage": "sqlite" },
    "LobbyShard": { "type": "durable-object", "storage": "sqlite" }
  },

  "d1_databases": [
    { "binding": "APP_DB", "database_name": "dicee-app-production",
      "database_id": "${D1_ID}", "migrations_dir": "migrations" }
  ],

  "r2_buckets": [
    { "binding": "AUDIO_BUCKET", "bucket_name": "${R2_NAME}" }
  ],

  "ai": { "binding": "AI" },

  "observability": { "enabled": true, "head_sampling_rate": 1 },

  // During Supabase coexistence the backend reads these; prune post-migration (see §8).
  "secrets": { "required": ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET"] }
}
```
- Expose typed RPC via `WorkerEntrypoint` for commands/queries; keep WebSocket upgrades on the Service Binding's `fetch()`.
- `${D1_ID}` / `${R2_NAME}` are substituted from OpenTofu outputs in CI (§9).
- Set `main` to the real entry file for your repo layout (architecture doc uses `src/worker.ts`).

---

## 7. Candidate Durable Objects lifecycle (`exports`)

Declarative `exports`, announced in Cloudflare's 2026-06-30 changelog entry,
replaces the imperative `migrations` array; the two are **mutually exclusive**.
Cloudflare diffs the `exports` map against deployed state to create, rename, or
delete namespaces.

Per-entry schema: `type: "durable-object"`; `storage: "sqlite"` (required for new namespaces — new KV-backed namespaces are no longer creatable unless the account already has one, as of 2026-07-09); `state`: `"created"` (default) / `"renamed"` / `"deleted"` / `"transferred"` / `"expecting-transfer"`; `renamed_to` required when `state = "renamed"` and the target must appear as a live entry.

**`GlobalLobby → LobbyShard` rename** (same worker, preserves the namespace and its data):
```jsonc
"exports": {
  "GameRoom":    { "type": "durable-object", "storage": "sqlite" },
  "LobbyShard":  { "type": "durable-object", "storage": "sqlite" },
  "GlobalLobby": { "type": "durable-object", "state": "renamed", "renamed_to": "LobbyShard" }
}
```

The snippet demonstrates schema, not a zero-downtime rollout. Where brief
runtime errors are unacceptable, follow Cloudflare's current three-deploy
alias/rename/remove-alias procedure. Lifecycle changes are control-plane atomic,
cannot use gradual deployment, and cannot be rolled back across the lifecycle
change; capture and test the exact sequence in the migration RFC.

Two cutover facts the vendor docs gloss over:
1. Renaming the **Worker service** (`dicee` → `dicee-game`) is not in-place — the name is the identity; you deploy the new-named Worker and retire the old.
2. Moving a DO class to a **differently-named Worker** is a **transfer** (`"transferred"` on source, `"expecting-transfer"` on destination), not a rename. For a ~10-user test app, in-flight room continuity isn't worth preserving — deploy `dicee-game` with **fresh** `GameRoom`/`LobbyShard` namespaces and skip transfer.

DO migrations are atomic (deploy immediately, no gradual rollout) — plan class additions/renames as discrete, tested deploys.

---

## 8. Candidate secrets and CI credentials

**Mechanism — `secrets.required` (keep it).** Declaring `secrets: { required: [...] }` makes `wrangler deploy` fail if any listed secret is missing on the Worker, and scopes which `.dev.vars`/`.env` keys load in dev. Use it as a deploy-time guardrail. List only what each Worker actually reads.

**Values — align to your root-of-trust, don't echo plaintext.** Prefer sourcing
secret values from the approved secrets backend at job start instead of writing
them into a persistent environment file. Current Wrangler supports bulk secret
upload and deploy-time secret files. Treat `wrangler secret put` carefully: it
creates and deploys a new Worker version immediately, so it is not a harmless
preflight command.

**Cloudflare API token caveat.** GitHub OIDC gives short-lived *cloud* creds for your KMS/secrets backend, but Cloudflare's API is not an OIDC federation target — the Cloudflare API token is the credential. Broker it through the secrets manager rather than a bare repo secret.

**Migration cleanup.** Remove `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `PUBLIC_SUPABASE_*` (and drop them from `secrets.required`) only after no code path depends on them.

**Do not** carry `TURN_SECRET` unless WebRTC voice chat is actually added — it isn't in the current design (E12).

---

## 9. Candidate deployment pipeline (GitHub Actions)

Ordering is dependency-driven: data resources exist before Workers bind to them; the backend exists before the frontend's service binding resolves; migrations run after the Worker deploy so code and schema move together.

```
1. tofu apply (D1, R2 + lifecycle; optionally Access)         -> capture outputs
2. substitute ${D1_ID} / ${R2_NAME} into wrangler.jsonc        (envsubst)
3. wrangler deploy  dicee-game   (owns DO classes, D1, R2, AI)
4. wrangler deploy  dicee-web    (GAME_SERVICE now resolves; attaches custom domain)
5. wrangler d1 migrations apply dicee-app-<env> --remote
```

Notes for the agent:
- Use `opentofu/setup-opentofu` + `tofu` (this project is OpenTofu), not `hashicorp/setup-terraform`, unless you deliberately standardize on Terraform.
- No AWS credentials are needed in CI anymore — the R2 lifecycle is managed by OpenTofu (E5), not `aws s3api`.
- Custom-domain SSL can lag a few minutes on first apply; add a short retry if the first frontend deploy races cert issuance.

---

## 10. Candidate custom-domain ownership

Managed in Wrangler via `routes` with `custom_domain: true` (valid, current, widely used):
```jsonc
"routes": [ { "pattern": "dicee.games", "custom_domain": true } ]     // staging: "staging.dicee.games"
```
This provisions the DNS record + TLS cert and avoids the deprecated `cloudflare_workers_custom_domain` `environment` field and the resource-ordering problem (E8). Known gotcha: `custom_domain: true` influences what host the Worker believes it is during `wrangler dev` (local-dev only) — harmless in production, but don't be surprised by redirects to the prod host locally.

---

## 11. Candidate Workers AI choices

- Keep the model identifier in config (the architecture doc already mandates this).
- `@cf/openai/whisper-tiny-en`: cheap, low-latency, **English-only, beta** — acceptable default for short dice commands.
- `@cf/openai/whisper-large-v3-turbo`: **GA**, multilingual, more accurate — the drop-in upgrade if recognition quality matters. `@cf/deepgram/flux` is a newer ASR model aimed at voice agents, worth evaluating if voice interaction expands.
- One `AI` binding per Worker; it lives on `dicee-game` (E1). Enforce hard caps on audio duration/size before invoking the model.

---

## 12. Candidate efficiency and Durable Object storage rules

Carried from the architecture doc, with billing folded in:
1. Static/prerendered content via Static Assets; auth, size/rate checks, schema validation **before** DOs or Workers AI.
2. **WebSocket Hibernation** for room sockets so idle connections don't keep a DO billably active.
3. **Do not persist presence heartbeats or transport events.** This is now a *cost* rule: SQLite Durable Object **storage is billed** (since 2026-01-07 — rows read/written at D1-equivalent rates, plus stored data beyond an included allowance; see the pricing page for current figures). Persist meaningful state transitions only, and delete room state on close (`setAlarm()` for scheduled cleanup; clear storage when a room ends so the object is reclaimed).
4. Active state in the DO; only queryable summaries + lifecycle records to D1 (index the recurring predicates; batch with `D1Database.batch()`).
5. Binary audio in R2, never in D1/DO SQL; auto-expire via the lifecycle rule.
6. Service Bindings add **no request charge and no added latency** on Workers Standard pricing (A→B bills as one request + combined CPU). On the deprecated Bundled/Unbound plans the downstream call *is* charged — confirm you're on Standard.
7. 100% log sampling during testing; reduce as traffic grows. Keep enough trace sampling to see Service Binding / DO / D1 / R2 / AI latency.
8. Partitionable lobby key (`lobby:{mode}:{shard}` / `lobby:{region}:{shard}`) even with one shard.
9. No KV/Queues/Workflows/Analytics Engine until a concrete access pattern demands it.

---

## 13. Candidate target-state validation checklist

After the corresponding decisions and implementation are approved, assert the
following during a local plan/dry-run gate. Passing this list does not authorize
a deploy:
- [ ] `dicee-web` `wrangler.jsonc` contains **no** `durable_objects` / `d1_databases` / `r2_buckets` / `ai` / `exports` keys — only `assets`, `routes`, `services`, `observability`. (E1)
- [ ] `dicee-web` `assets.directory` == `.svelte-kit/cloudflare` and **no** `not_found_handling: "single-page-application"`. (E2/E3)
- [ ] `dicee-game` has `"workers_dev": false` (and `"preview_urls": false`). (E9)
- [ ] `exports` is present and `migrations` is absent in `dicee-game` (mutually exclusive); every DO entry has `storage: "sqlite"`. (§7)
- [ ] R2 lifecycle uses `bucket_name` + `rules[].{enabled, conditions, delete_objects_transition.condition{max_age,type="Age"}}` — no `status`/`filter`/`expiration` keys. (E6)
- [ ] Any `cloudflare_zone` data source uses `filter = { name }` and is referenced via `.zone_id`; drop it if unused. (E7)
- [ ] No `cloudflare_worker*` resources in OpenTofu; no `null_resource`/`aws s3api` for R2 lifecycle. (E5, §1)
- [ ] Provider constraint is deliberate, `.terraform.lock.hcl` is committed, and the account ID has no variable default. (E10/E11)
- [ ] `secrets.required` lists only secrets the worker reads; no `TURN_SECRET` unless WebRTC exists. (E12)
- [ ] `terraform.tfstate` and `terraform.tfvars` are gitignored.

---

## 14. Research sources reviewed by the supplied document

These citations record the research basis as imported on 2026-07-21. Retrieve
the live official page, current provider schema, installed Wrangler schema, and
relevant changelog again before relying on a version, resource schema, billing
rule, limit, or lifecycle behavior.

- Provider 5.22.0 release (2026-07-09) — <https://github.com/cloudflare/terraform-provider-cloudflare/releases/tag/v5.22.0>
- Provider source and resource schemas — <https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs>
- `cloudflare_r2_bucket_lifecycle` and related generated v5.22 docs — <https://github.com/cloudflare/terraform-provider-cloudflare/tree/v5.22.0/docs>
- R2 object lifecycles — <https://developers.cloudflare.com/r2/buckets/object-lifecycles/>
- `cloudflare_zone` v5 uses `filter`, exposes `zone_id` — provider issues #4958, #5245, #5350
- SvelteKit adapter and Cloudflare configuration — <https://svelte.dev/docs/kit/adapter-cloudflare>
- Cloudflare Pages SvelteKit guide — <https://developers.cloudflare.com/pages/framework-guides/deploy-a-svelte-kit-site/>
- Pages Service Bindings — <https://developers.cloudflare.com/pages/functions/bindings/#service-bindings>
- Pages-to-Workers migration — <https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/>
- Wrangler configuration — <https://developers.cloudflare.com/workers/wrangler/configuration/>
- Wrangler secrets — <https://developers.cloudflare.com/workers/configuration/secrets/>
- Durable Object migrations and declarative exports — <https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/>
- Declarative exports announcement — <https://developers.cloudflare.com/changelog/post/2026-06-30-declarative-do-class-exports/>
- Service Bindings — <https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/>
- Service Binding and Worker pricing — <https://developers.cloudflare.com/workers/platform/pricing/#service-bindings>
- Workers AI Whisper (`whisper-large-v3-turbo` GA; `deepgram/flux`) — Workers AI model pages + changelog
