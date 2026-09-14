# Cloudflare

How Dicee runs on Cloudflare, what the committed configuration enforces, and how changes reach production.

## Scope and evidence

- This file describes committed configuration and the selected governance strategy. Repository config and future ownership choices are not proof of live state or completed organizational intake.
- A live claim needs a first-hand, read-only readback (method, UTC time, result) recorded in the readbacks table in [status.md](status.md). Never cite this file as live evidence.
- Recheck version-sensitive platform behavior (limits, billing, lifecycle, config schema) against current Cloudflare docs before acting on it.
- Decisions and operator actions live in [status.md](status.md); ordered work lives in [roadmap.md](roadmap.md).

## Topology

```text
browser
  └─ https://dicee.games               Pages custom domain, the only public origin
       └─ Pages project "dicee"        packages/web: SvelteKit, adapter-cloudflare
            ├─ Supabase                Auth, Postgres, Storage (browser and SSR, direct)
            └─ service binding GAME_WORKER
                 └─ Worker "dicee"     packages/cloudflare-do: no public ingress
                      ├─ GlobalLobby   SQLite Durable Object, one instance: /lobby, admin diagnostics
                      ├─ GameRoom      SQLite Durable Object, one per room code: /room/:CODE
                      ├─ AI binding    /api/transcribe (returns text, stores nothing)
                      └─ Supabase      JWKS token verification, service-role RPC writes
```

- The browser only talks to the Pages origin. Every WebSocket URL builder uses `location.host`.
- Ten SvelteKit server routes proxy through `GAME_WORKER`: the WebSocket upgrades, the lobby APIs, transcription and the admin diagnostics routes. Their response helpers are in `packages/web/src/lib/server/ws-proxy.ts`.
- The Worker is a plain fetch router in `packages/cloudflare-do/src/worker.ts`: `/health`, `/api/transcribe`, lobby and admin diagnostics paths to the `GlobalLobby` singleton, room paths to `GameRoom` by room code.
- The Worker is meant to be reached only through the Pages service binding and must never get its own ingress (see Hard stops).
- Postgres never reads Durable Object state. The Worker writes game lifecycle records and domain events to Postgres through Supabase RPC. Storage keys and the persistence bridge are in [architecture/README.md](architecture/README.md).

## Governance strategy

[Status decision 9](status.md#decisions) selects the Cloudflare direction for the intended Jefahnierocks move. The [organization alignment guide](development/organization-alignment.md) supplies the intake rationale and proposed naming; [roadmap section 7](roadmap.md#7-organization-move-with-governance-and-iac) owns implementation order. Organizational acceptance, live controls and infrastructure adoption still need their own evidence.

**Service ownership and account stewardship.** Plan for Jefahnierocks to own Dicee while the existing shared Cloudflare account remains its host under the current steward. GitHub transfer, infrastructure adoption and account relocation are separate changes. Account relocation is conditional on a demonstrated governance or isolation need and an accepted state/recovery plan; it is not the default way to join the organization.

**Infrastructure placement.** Dicee-specific resources belong in an explicitly designated Jefahnierocks infrastructure root, including resources whose API scope is the whole account. A global root holds resources actually shared across owners. The exact infrastructure repository, root, protected state/backend and operator remain intake decisions; the workspace shell coordinates that choice and is not the apply repository.

| Configuration surface | Intended writer after infrastructure adoption |
|---|---|
| Zone, DNS, redirects, Pages project identity and domain attachment | OpenTofu in the accepted infrastructure root, after discovery and review of the exact managed fields. Registrar ownership is a separate question. |
| Pages artifact, service bindings, vars and compatibility settings | Dicee's web Wrangler configuration and application release workflow. Assign any overlapping build settings explicitly. |
| Worker code, bindings, compatibility, observability, Workers AI use and Durable Object lifecycle | Dicee's Worker Wrangler configuration and application source; preserve applied v1/v2 migrations and verified namespace ownership. |
| Runtime secret values | Approved delivery to the named consumer/environment at execution time; keep values out of infrastructure state and Git. |

Pages' deployed Wrangler configuration is its source of truth, while the provider also exposes deployment configuration fields. Before OpenTofu manages the project, require an agreed field map and prove import/no-op behavior, an authorized ordinary Wrangler release, and a subsequent infrastructure plan without unintended resets. Leave overlapping fields or the project unmanaged by OpenTofu if the pinned provider cannot preserve this boundary. Do not use broad drift-ignore rules as proof of ownership. See [Pages configuration](https://developers.cloudflare.com/pages/functions/wrangler-configuration/) and the [provider schema](https://developers.cloudflare.com/api/terraform/resources/pages/subresources/projects/).

**Credentials and immediate recovery.** The exposed Cloudflare token was replaced through the existing 1Password wrapper and GitHub Production secret path, and the old token verified dead ([status readbacks](status.md#latest-live-readbacks)). Today one account-owned deploy token (Pages Write, Workers Scripts Write and Account Settings Read across the whole account) serves both CI and the local wrapper; MCP uses OAuth instead. The target design separates inventory/plan readers, infrastructure apply, application release and local operator consumers, with distinct environments where supported. Verify effective permissions and record residual account-wide reach: token names and directories do not enforce per-script isolation. The permissions for [Workers Scripts and Pages](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) are account-scoped; issuing separate tokens improves attribution and revocation without proving resource isolation. Token ownership/type and exact capabilities must be established before choosing each replacement.

**State and environments.** Keep `dicee.games`, Pages `dicee`, the current Worker names, class names and binding interfaces. `dicee-production` remains unclassified. Before any Worker release, verify both namespace owners and the deployed Pages target; account relocation cannot assume namespace/data continuity. Keep the default production deployment rather than introducing a named production environment. Pages preview currently shares the production Worker and is not an isolated test environment; staging waits for its roadmap trigger and a complete backend/data/credential boundary.

## Configuration

**Worker** (`packages/cloudflare-do/wrangler.jsonc`):

- Name `dicee`, entry `packages/cloudflare-do/src/worker.ts`, `compatibility_date` 2026-07-21, flag `nodejs_compat`.
- `workers_dev: false` and `preview_urls: false`, set at the top level and never overridden.
- Durable Object lifecycle: the legacy `migrations` array, v1 `GameRoom` and v2 `GlobalLobby`, both `new_sqlite_classes`. It is declared once at the top level and inherited (status decision 1).
- Bindings `GAME_ROOM`, `GLOBAL_LOBBY` and `AI`; var `ENVIRONMENT`, which nothing reads (see Open decisions).
- `secrets.required`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, identical in every block. The list drives generated types, makes a deploy fail when a listed secret is unset on the target Worker, and limits which keys load from local env files. It never removes a secret that is already set.
- Observability: logs at head sampling 1, traces at 0.1. This key is Workers-only; Pages has none.
- Environments: the default target is production (`--env=""`). The named `development` and `staging` environments repeat the non-inherited keys (`vars`, `secrets`, `durable_objects`, `ai`). The inheritable keys (`migrations`, `observability`, `workers_dev`, `preview_urls`, `compatibility_date`) stay top level only. Do not "fix" either by copying. `pnpm dev:do` runs `development`; no CI job uses the named environments.

**Pages** (`packages/web/wrangler.jsonc`):

- Name `dicee`, the SvelteKit Cloudflare adapter output directory, the same compatibility date and flag.
- Exactly one service binding, `GAME_WORKER` to `dicee`. The `preview` environment binds the same production Worker (see Open decisions).
- A Pages project name and a Worker script name are separate namespaces. Sharing `dicee` is for legibility only.
- The web build needs `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` at build time (`$env/static/public`). The CI Pages job reads them from the Production environment. `packages/web` holds no service-role material.

**Generated types.** Each package commits a generated `worker-configuration.d.ts`:

- `pnpm --filter @dicee/cloudflare-do types` (and the same for `@dicee/web`) runs `wrangler types --env-file=/dev/null`.
- `types:check` adds `--check`, and root `pnpm check:workers` (part of `pnpm check`) runs both checks.
- After any `wrangler.jsonc` change, regenerate and commit. Never hand-edit the file.

**Local HS256 limitation.** The HS256 fallback in `packages/cloudflare-do/src/auth.ts` reads `SUPABASE_JWT_SECRET`, but that name is not in `secrets.required`:

- `pnpm dev:do` therefore loads no HS256 secret.
- Authenticated local room sockets and transcription need a local Supabase stack with asymmetric signing keys (`signing_keys_path` is commented out in `supabase/config.toml`).
- Never add the name to `secrets.required`: deploys would fail wherever it is unset.
- The limitation ends with the HS256 removal on the roadmap.

## Invariants and hard stops

`pnpm cf:audit` runs `scripts/cloudflare-config-audit.mjs`: offline, Node built-ins only, run by `pnpm lint`. It fails on an error and warns on advisories; `pnpm cf:audit:strict` fails on warnings too. It reads config, not live state. It checks:

- **Worker:** `workers_dev` and `preview_urls` explicitly false everywhere.
  - Exactly one lifecycle mode, `migrations`, with v1/v2 unedited and lifecycle keys top level only. Every class is SQLite-backed, and a pending new step warns.
  - Every Durable Object binding resolves to a declared class. Every class is bound and exported from the Worker entry.
  - Non-inherited keys are repeated per environment and inheritable keys are not duplicated.
  - `secrets.required` is identical everywhere and each name appears in source. Supabase secrets read in source are declared (warning).
  - Every declared var is read (warning).
- **Pages:** no `durable_objects`, `d1_databases`, `r2_buckets`, `kv_namespaces`, `ai`, `exports` or `queues`.
  - Exactly one service binding per block, targeting a Worker name the backend declares.
  - No `route`, `routes` or `custom_domain`, and preview not bound to production (warning).
- **Both:** no account id or API token literal, and no legacy TOML config beside `wrangler.jsonc`.

Hard stops. These are owner decisions, never config tweaks:

- **No `exports` key.** Never edit, reorder or remove the applied v1/v2 tags. `exports` is one-way: no return to `migrations`, no rollback across the change, no gradual deploy. It is adopted only for a concrete need recorded in status, as a standalone operator deploy.
- **No Worker or Durable Object class rename.** Namespaces are keyed to the script name, so a renamed Worker starts with empty namespaces. A class rename needs its own lifecycle step.
- **No Worker ingress.** No `route`, `routes`, `custom_domain` or `workers_dev: true` on the Worker.
- **No backend bindings on Pages.** No storage, D1, R2, KV or AI bindings in the Pages config.
- **`secrets.required` changes deliberately.** Never remove a name casually. Never add a name that is unset on the target Worker.
- **No tokens in MCP config.** API tokens never go there; the Cloudflare API MCP server stays opt-in with per-client OAuth.
- **Durable Object SQLite holds live state only.** It keeps live room and lobby state, never durable cross-game data. Persist state transitions, never presence heartbeats.

Safe without deploy authority: `wrangler types`, `types:check`, `wrangler deploy --dry-run` and `pnpm cf:audit`.

## Deploy path

**CI** (`.github/workflows/ci.yml`): `workflow_dispatch` on `main` with `deploy=true`. Push and pull-request runs never deploy. The jobs run in this order:

1. `validate` ("Full repository validation").
2. `deploy-worker`: the Production environment, a `production-deploy` concurrency group that is never cancelled, builds `@dicee/shared`, then `wrangler deploy --env=""`.
3. `deploy-pages`: reuses the validated WASM artifact, builds shared and web, then runs `pages deploy` to project `dicee`.

`deploy-pages` needs `deploy-worker`, so CI cannot deploy Pages alone. Complete the credential and GitHub protection prerequisites in [roadmap section 1](roadmap.md#1-safety-now) first. Use CI only when live checks 1-2 show that `dicee` owns both SQLite classes at v2 without competing ownership and Pages targets that backend. Review the exact release configuration and migrations as well; ownership is a deployment prerequisite, not approval of every later artifact.

A Pages-only release uses the operator-local `pnpm pages:deploy` (status action 3). It is not automatically safe when Worker ownership is different or unknown: committed production and preview settings both target `dicee`, and this command does not preserve an arbitrary dashboard binding. Stop until the verified backend and release configuration agree. Use a clean checkout of the exact successful CI commit and read the local Pages build environment warning below.

**Operator escape hatches** skip the validation gate and need explicit authority:

- Root `pnpm do:deploy`, `pnpm pages:deploy`, `pnpm pages:deploy:preview`, `pnpm deploy` and `pnpm do:tail` wrap wrangler in `scripts/with-dicee-cloudflare.sh`.
- The package `deploy`, `deploy:staging`, `tail` and `pages:deploy` scripts run wrangler unwrapped.
- The wrapper is a convention, not a boundary: a stored Wrangler login authenticates without it.
- The wrapper exports `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` and `exec`s the command, so the token reaches only that process's environment, never an argument list; `pnpm test:scripts` covers this.
- **Local Pages build environment.** `pnpm pages:deploy` runs `pnpm build` before the wrapper, which adds only Cloudflare credentials. `vite build` inlines `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` (`$env/static/public`) from the shell. It falls back to the ignored `packages/web/.env*` files (`.env`, `.env.local`, `.env.production`, `.env.production.local`), which hold local development values. Before the build, export both production public values in the same shell. Exported values override the files, but if either name is unexported, the build uses the file value without warning. The post-deploy sign-in check must pass against production.

**Local proof:** `pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run --env=""`. It proves the bundle builds and the bindings resolve. It gives no lifecycle signal and does not check `secrets.required`.

**Known hazards:**

- **Two Worker versions per dispatch.** The Cloudflare wrangler-action step uploads its `secrets` input with `wrangler secret bulk` before it runs `deploy`, and a secret upload creates and deploys a version. For a short window new secrets run on old code. `wrangler deploy --secrets-file` is the single-operation form.
- **Empty namespaces on the wrong script.** A `migrations` deploy is a lifecycle no-op only when the target script already carries tag v2. Otherwise it provisions empty namespaces: if another script owns the namespaces, a deploy to `dicee` creates empty ones and live state stays on the old script, so stop. Deploy a Worker only after live check 1 shows `dicee` holds both namespaces at v2 (status action 5).
- **First deploy to a new Worker name.** With `secrets.required` set, it needs `--secrets-file`.
- **No rollback in CI.** Rollback is operator-run (`wrangler rollback`, Pages rollback in the dashboard) and cannot cross a Durable Object lifecycle change. Roll forward by default.
- **No staging path.** Production is the first environment a change reaches.

**Post-deploy smoke** (operator):

- sign-in, which reaches the production Supabase project (a locally built deploy can inline local values);
- lobby and room WebSocket upgrades;
- security headers and CSP, with the WASM engine loading in a Chromium browser;
- transcription;
- admin pages refuse a non-admin session.

## Live checks still needed

Use read-only methods only: the dashboard or a read-scoped API `GET`. Record each result in the [status.md](status.md) readbacks as names, counts and HTTP status. Never record account, zone or namespace ids, subdomains, project refs or secret values.

1. **Namespace owner.** Which Worker scripts hold the live `GameRoom` and `GlobalLobby` namespaces (class, script, SQLite), their migration tags where a read-only source shows them, and the deployed versions. Method: dashboard, or a read-scoped `GET` of the account's Durable Object namespace list. A Worker deploy proceeds only when `dicee` holds both SQLite namespaces at v2 without competing or ambiguous ownership, and check 2 establishes the expected Pages target.
2. **Pages binding.** What production and preview `GAME_WORKER` target, and whether live settings (compatibility date, flags, bindings) agree with `packages/web/wrangler.jsonc`. Method: dashboard, or `wrangler pages download config` into a private scratch directory outside the repository (never with `--force`). Inspect this before either deployment path; a different or unknown target requires reconciliation, not an unconditional Pages-only fallback.
3. **Subdomains.** Done for `dicee` and `dicee-production` (status action 6); repeat for any other Dicee Worker script that check 4 finds. Method: each script's domains and routes settings in the dashboard.
4. **Legacy scripts.** Routes, custom domains and last deployment on every Dicee Worker script other than the one check 1 identifies.
5. **Secret names.** Secret names on each script and on the Pages project; `wrangler secret list` and `wrangler pages secret list` return names only.
6. **Zone and redirect.** Whether `dicee.games` is a zone on this account, whether Registrar is used, and where the www-to-apex redirect lives (`packages/web/_redirects` says the dashboard). This feeds the organization move.

Method safety:

- `wrangler secret put`, `bulk` and `delete` create and deploy a version.
- `wrangler triggers deploy` changes routes.
- `pages download config` writes a file.

None of these is a readback. For reachability use the Worker's `/health`; do not probe admin diagnostics paths.

## Open decisions

Each open decision has a recommended default. The owner decides, and [status.md](status.md) records the decision.

- **Preview shares the production Worker** (audit warning F7). `env.preview` binds `dicee`, so preview traffic reaches production Durable Object state. Default: accept at family scale and revisit when the roadmap's staging trigger fires.
- **Room storage retention.** Nothing deletes Durable Object storage, so finished rooms keep theirs. Default: reclaim storage when a room is finished and empty, on the existing alarm path (roadmap, Worker correctness). Plan as though SQLite storage is billed; the account billing view is the evidence.
- **`secrets.required` after the Supabase key migration.** Default: one secret key replaces the legacy anon and service-role names, and the Worker sends it only as `apikey`. Change the list, the code and the CI secrets together, and set the new secret on the Worker before the deploy that requires it.
- **`SUPABASE_JWT_SECRET` read but undeclared** (audit warning B8). Default: resolve it by removing HS256, never by adding the name.
- **Unused `ENVIRONMENT` var** (audit warning B11). Default: delete it from both configs unless code starts reading it.
- **Named `development` and `staging` environments.** No CI job or binding uses them. Default: keep them until the staging trigger fires, then either wire one into CI or delete both.
- **Infrastructure adoption details** (status decision 9). The [governance strategy](#governance-strategy) selects OpenTofu/Wrangler responsibilities and four credential consumers. The exact repository/root, backend/state controls, pinned provider field map and effective token reach remain open. Acceptance and the Pages import/release/plan checks precede infrastructure writes; a dedicated account remains a separate conditional migration decision.

Settled: stay on Pages and the `dicee` Worker (status decision 8). If a move to Workers Static Assets is ever triggered, watch four things:

- never use single-page-application not-found handling with SSR;
- assets serve before the Worker unless `run_worker_first` is set;
- `routes` is not a Pages config key;
- a domain cutover is detach, then attach.

## Local commands

```sh
pnpm dev:do                                            # Worker locally (development env)
pnpm --filter @dicee/cloudflare-do types               # regenerate bindings (same for @dicee/web)
pnpm check:workers                                     # both packages: types --check
pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run --env=""
pnpm cf:audit                                          # config audit; cf:audit:strict fails on warnings
node scripts/cloudflare-config-audit.mjs --self-test   # audit self-test
```
