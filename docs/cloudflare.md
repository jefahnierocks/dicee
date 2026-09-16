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
  ├─ www.dicee.games, dicee.jefahnierocks.com, gamelobby.jefahnierocks.com
  │    └─ zone Single Redirect         301 to https://dicee.games, same path, query preserved
  └─ https://dicee.games               custom domain on the web Worker, the only public origin
       └─ Worker "dicee-web"           packages/web: SvelteKit, adapter-cloudflare, Workers Static Assets
            ├─ Supabase                Auth, Postgres, Storage (browser and SSR, direct)
            └─ service binding GAME_WORKER
                 └─ Worker "dicee"     packages/cloudflare-do: no public ingress
                      ├─ GlobalLobby   SQLite Durable Object, one instance: /lobby, admin diagnostics
                      ├─ GameRoom      SQLite Durable Object, one per room code: /room/:CODE
                      ├─ AI binding    /api/transcribe (returns text, stores nothing)
                      └─ Supabase      JWKS token verification, service-role RPC writes
```

- Two Workers on purpose: a deploy that changes Durable Object code disconnects every WebSocket and restarts the objects, so a UI-only release deploys `dicee-web` alone.
- `dicee-web` is the only web origin. The Pages project that used to serve `dicee.games` is deleted, so there is no Pages fallback and every web release targets `dicee-web` directly.
- A public hostname attaches to exactly one target at a time, so moving one is detach, then attach. A Worker custom domain needs an active zone on the account and cannot be created on a hostname that already carries a CNAME record.
- Three hostnames redirect at the zone rather than through a Worker: `www.dicee.games` inside the `dicee.games` zone, and `dicee.jefahnierocks.com` and `gamelobby.jefahnierocks.com` from the separate `jefahnierocks.com` zone, so the public surface spans two zones. Each is a proxied `A` record to an RFC 5737 documentation address, which is how a hostname gets proxied with no real origin behind it, and a Single Redirect rule sends it to `https://dicee.games` with the same path and the query preserved, status 301. They belong to neither Worker: never attach one as a `dicee-web` custom domain, and never restore the retired rule that prepended a `/games/dicee` prefix.
- The browser only talks to the web origin. Every WebSocket URL builder uses `location.host`.
- Requests that match a built asset are served by Workers Static Assets without running the Worker; every other request reaches SvelteKit.
- Ten SvelteKit server routes proxy through `GAME_WORKER`: the WebSocket upgrades, the lobby APIs, transcription and the admin diagnostics routes. Their response helpers are in `packages/web/src/lib/server/ws-proxy.ts`.
- The `dicee` Worker is a plain fetch router in `packages/cloudflare-do/src/worker.ts`: `/health`, `/api/transcribe`, lobby and admin diagnostics paths to the `GlobalLobby` singleton, room paths to `GameRoom` by room code.
- `dicee` is meant to be reached only through the service binding and must never get its own ingress (see Hard stops).
- Postgres never reads Durable Object state. The Worker writes game lifecycle records and domain events to Postgres through Supabase RPC. Storage keys and the persistence bridge are in [architecture/README.md](architecture/README.md).

## Governance strategy

[Status decision 9](status.md#decisions) selects the Cloudflare direction for the intended Jefahnierocks move. The [organization alignment guide](development/organization-alignment.md) supplies the intake rationale and proposed naming; [roadmap section 7](roadmap.md#7-organization-move-with-governance-and-iac) owns implementation order. Organizational acceptance, live controls and infrastructure adoption still need their own evidence.

**Service ownership and account stewardship.** Plan for Jefahnierocks to own Dicee while the existing shared Cloudflare account remains its host under the current steward. GitHub transfer, infrastructure adoption and account relocation are separate changes. Account relocation is conditional on a demonstrated governance or isolation need and an accepted state/recovery plan; it is not the default way to join the organization.

**Infrastructure placement.** Dicee-specific resources belong in an explicitly designated Jefahnierocks infrastructure root, including resources whose API scope is the whole account. A global root holds resources actually shared across owners. The exact infrastructure repository, root, protected state/backend and operator remain intake decisions; the workspace shell coordinates that choice and is not the apply repository.

| Configuration surface | Intended writer after infrastructure adoption |
|---|---|
| Zone, DNS, redirect rules and the web Worker's custom domain | OpenTofu in the accepted infrastructure root, after discovery and review of the exact managed fields. Registrar ownership is a separate question. |
| Web Worker artifact, service binding, compatibility and observability | Dicee's web Wrangler configuration and application release workflow. |
| Game Worker code, bindings, compatibility, observability, Workers AI use and Durable Object lifecycle | Dicee's Worker Wrangler configuration and application source; preserve applied v1/v2 migrations and verified namespace ownership. |
| Runtime secret values | Approved delivery to the named consumer/environment at execution time; keep values out of infrastructure state and Git. |

Wrangler configuration is the source of truth for both Workers' script settings. Before OpenTofu manages a resource that touches them (a custom domain, a Worker setting), require an agreed field map and prove import/no-op behavior, an authorized ordinary Wrangler release, and a subsequent infrastructure plan without unintended resets. Leave overlapping fields unmanaged by OpenTofu if the pinned provider cannot preserve this boundary. Do not use broad drift-ignore rules as proof of ownership.

**Credentials and immediate recovery.** The exposed Cloudflare token was replaced through the existing 1Password wrapper and GitHub Production secret path, and the old token verified dead ([status readbacks](status.md#latest-live-readbacks)). Today one account-owned deploy token (Pages Write, Workers Scripts Write and Account Settings Read across the whole account) serves both CI and the local wrapper; MCP uses OAuth instead. Both Workers release with Workers Scripts Write. With the Pages project deleted, Pages Write has no consumer left, so until [status action 16](status.md#open-operator-actions) removes it the token's reach is wider than anything this repository uses. The target design separates inventory/plan readers, infrastructure apply, application release and local operator consumers, with distinct environments where supported. Verify effective permissions and record residual account-wide reach: token names and directories do not enforce per-script isolation. The permissions for [Workers Scripts](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) are account-scoped; issuing separate tokens improves attribution and revocation without proving resource isolation. Token ownership/type and exact capabilities must be established before choosing each replacement.

**State and environments.** Keep `dicee.games`, the `dicee` Worker name, class names and binding interfaces; the web release target is `dicee-web`. `dicee` and `dicee-web` are the only Workers this repository deploys; `dicee-production`, `gamelobby` and `gamelobby-production` are classified legacy scripts awaiting deletion (see Hard stops). Before any `dicee` release, verify both namespace owners; account relocation cannot assume namespace/data continuity. Keep the default production deployment rather than introducing a named production environment. There is no hosted preview; staging waits for its roadmap trigger and a complete backend/data/credential boundary.

## Configuration

**Game Worker** (`packages/cloudflare-do/wrangler.jsonc`):

- Name `dicee`, entry `packages/cloudflare-do/src/worker.ts`, `compatibility_date` 2026-07-21, flag `nodejs_compat`. A bump is a deliberate change under status decision 5.
- `workers_dev: false` and `preview_urls: false`, set at the top level and never overridden.
- Durable Object lifecycle: the legacy `migrations` array, v1 `GameRoom` and v2 `GlobalLobby`, both `new_sqlite_classes`. It is declared once at the top level and inherited (status decision 1).
- Bindings `GAME_ROOM`, `GLOBAL_LOBBY` and `AI`; var `ENVIRONMENT`, which nothing reads (see Open decisions).
- `secrets.required`: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, identical in every block. The list drives generated types, makes a deploy fail when a listed secret is unset on the target Worker, and limits which keys load from local env files. It never removes a secret that is already set.
- Observability: logs at head sampling 1, traces at 0.1.
- Environments: the default target is production (`--env=""`). The named `development` and `staging` environments repeat the non-inherited keys (`vars`, `secrets`, `durable_objects`, `ai`). The inheritable keys (`migrations`, `observability`, `workers_dev`, `preview_urls`, `compatibility_date`) stay top level only. Do not "fix" either by copying. `pnpm dev:do` runs `development`; no CI job uses the named environments.

**Web Worker** (`packages/web/wrangler.jsonc`):

- Name `dicee-web`, the same compatibility date and flag. `main` is the worker script the SvelteKit adapter generates inside its output directory `.svelte-kit/cloudflare`, which is also the `assets` directory, with binding `ASSETS`. Because `main` and `assets` are set, `@sveltejs/adapter-cloudflare` builds for Workers: it writes that script and an `.assetsignore` that keeps the script, `_headers` and `_redirects` out of the uploaded assets, and no Pages routes file.
- `workers_dev: false` and `preview_urls: false`; no named environment, `routes` or `custom_domain`.
- Exactly one service binding, `GAME_WORKER` to `dicee`. No vars, secrets, storage, AI or Durable Object bindings.
- Observability: logs at head sampling 1.
- No `run_worker_first`: assets serve first. The adapter's generated `_headers` gives `/_app/immutable/*` long-lived caching. `_headers` and `_redirects` rules never apply to Worker-generated responses, so security headers come from `packages/web/src/hooks.server.ts` and CSP from `kit.csp` in `packages/web/svelte.config.js`.
- The web build needs `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` at build time (`$env/static/public`). The CI `deploy-web` job reads the first from a Production environment variable and the second from a repository secret, then fails the job if either is empty. They come from different stores, so a change to one does not move the other. `packages/web` holds no service-role material.

**Generated types.** Each package commits a generated `worker-configuration.d.ts`:

- `pnpm --filter @dicee/cloudflare-do types` (and the same for `@dicee/web`) runs `wrangler types --env-file=/dev/null`.
- `types:check` adds `--check`, and root `pnpm check:workers` (part of `pnpm check`) runs both checks.
- After any `wrangler.jsonc` change, regenerate and commit. Never hand-edit the file.
- The web entry exists only after a build, and `wrangler types` adds a build-dependent `mainModule` type when it does. The web `types` scripts therefore run `packages/web/scripts/wrangler-types.mjs`, which generates from a copy of the config without `main`, so output is the same before and after a build.

**Local HS256 limitation.** The HS256 fallback in `packages/cloudflare-do/src/auth.ts` reads `SUPABASE_JWT_SECRET`, but that name is not in `secrets.required`:

- `pnpm dev:do` therefore loads no HS256 secret.
- Authenticated local room sockets and transcription need a local Supabase stack with asymmetric signing keys (`signing_keys_path` is commented out in `supabase/config.toml`).
- Never add the name to `secrets.required`: deploys would fail wherever it is unset.
- The limitation ends with the HS256 removal on the roadmap.

## Invariants and hard stops

`pnpm cf:audit` runs `scripts/cloudflare-config-audit.mjs`: offline, Node built-ins only, run by `pnpm lint`. It fails on an error and warns on advisories; `pnpm cf:audit:strict` fails on warnings too. It reads config, not live state. It checks:

- **Game Worker:** `workers_dev` and `preview_urls` explicitly false everywhere.
  - Exactly one lifecycle mode, `migrations`, with v1/v2 unedited and lifecycle keys top level only. Every class is SQLite-backed, and a pending new step warns.
  - Every Durable Object binding resolves to a declared class. Every class is bound and exported from the Worker entry.
  - Non-inherited keys are repeated per environment and inheritable keys are not duplicated.
  - `secrets.required` is identical everywhere and each name appears in source. Supabase secrets read in source are declared (warning).
  - Every declared var is read (warning).
- **Web Worker:** no `durable_objects`, `d1_databases`, `r2_buckets`, `kv_namespaces`, `ai`, `exports`, `queues` or `migrations`.
  - Exactly one service binding per block, targeting a Worker name the backend declares, and a `name` that is none of the backend's Worker names.
  - `workers_dev` and `preview_urls` explicitly false; no `route`, `routes` or `custom_domain`.
  - Workers Static Assets shape: `main`, `assets.directory` and `assets.binding` set, no `pages_build_output_dir`, no single-page-application not-found handling (it would serve the shell in place of SSR). A named environment bound to the production backend warns.
- **Both:** no account id or API token literal, and no legacy TOML config beside `wrangler.jsonc`.

Hard stops. These are owner decisions, never config tweaks:

- **No `exports` key.** Never edit, reorder or remove the applied v1/v2 tags. `exports` is one-way: no return to `migrations`, no rollback across the change, no gradual deploy. It is adopted only for a concrete need recorded in status, as a standalone operator deploy.
- **No Worker or Durable Object class rename.** Namespaces are keyed to the script name, so a renamed Worker starts with empty namespaces. A class rename needs its own lifecycle step.
- **Deleting a Worker deletes its Durable Object namespaces.** The classified legacy scripts ([status action 8](status.md#open-operator-actions)) are `gamelobby`, which owns none and is the lowest-risk deletion, and `dicee-production` and `gamelobby-production`, which each own a SQLite `GameRoom`/`GlobalLobby` pair; `gamelobby-production` also still exposes `workers.dev` and Preview URLs. Delete one at a time, after the dashboard route read under [Live checks](#live-checks), verify the public app after each, and never force-delete a namespace-owning script without an explicit decision to destroy that state.
- **No ingress on `dicee`.** No `route`, `routes`, `custom_domain` or `workers_dev: true` on the game Worker.
- **The web Worker never uses a game Worker name.** Deploying the web config as `dicee` would replace the game Worker's code and bindings.
- **No backend bindings on the web Worker.** No Durable Object, storage, D1, R2, KV, AI or queue bindings in `packages/web/wrangler.jsonc`.
- **`secrets.required` changes deliberately.** Never remove a name casually. Never add a name that is unset on the target Worker.
- **No tokens in MCP config.** API tokens never go there; the Cloudflare API MCP server stays opt-in with per-client OAuth.
- **Durable Object SQLite holds live state only.** It keeps live room and lobby state, never durable cross-game data. Persist state transitions, never presence heartbeats.

Safe without deploy authority: `wrangler types`, `types:check`, `wrangler deploy --dry-run` and `pnpm cf:audit`.

## Deploy path

**CI** (`.github/workflows/ci.yml`): `workflow_dispatch` on `main` with `deploy=true`. Push and pull-request runs never deploy. The jobs run in this order:

1. `validate` ("Full repository validation").
2. `deploy-worker`: the Production environment, a `production-deploy` concurrency group that is never cancelled, builds `@dicee/shared`, then `wrangler deploy --env=""`.
3. `deploy-web` ("Deploy web Worker"): reuses the validated WASM artifact, builds shared and web, then runs `wrangler deploy` for `dicee-web`.

`deploy-web` needs `deploy-worker`, so a CI dispatch always redeploys `dicee` as well, which restarts its Durable Objects and drops every live socket; dispatch at a quiet time, or take the web-only path below when nothing under `packages/cloudflare-do` changed. The Production reviewer approves the artifact in front of them, not every later one: review the release commit, the Wrangler configuration and any pending database migration before approving.

A web-only release uses the operator-local `pnpm web:deploy`, leaves `dicee` untouched and is the default for a UI-only change: `GAME_WORKER` resolves the live `dicee` Worker by name and that binding does not change. Use a clean checkout of the exact commit that passed CI and read the local web build environment warning below.

**Operator escape hatches** skip the validation gate and need explicit authority:

- Root `pnpm do:deploy`, `pnpm web:deploy` and `pnpm do:tail` wrap wrangler in `scripts/with-dicee-cloudflare.sh`.
- The package `deploy` scripts (both packages) and the game Worker's `deploy:staging` and `tail` run wrangler unwrapped.
- The wrapper is a convention, not a boundary: a stored Wrangler login authenticates without it.
- The wrapper exports `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` and `exec`s the command, so the token reaches only that process's environment, never an argument list; `pnpm test:scripts` covers this.
- **Local web build environment.** `pnpm web:deploy` runs `pnpm build` before the wrapper, which adds only Cloudflare credentials. `vite build` inlines `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` (`$env/static/public`) from the shell. It falls back to the ignored `packages/web/.env*` files (`.env`, `.env.local`, `.env.production`, `.env.production.local`), which hold local development values. Before the build, export both production public values in the same shell. Exported values override the files, but if either name is unexported, the build uses the file value without warning. The post-deploy sign-in check must pass against production.

**Local proof:** `pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run --env=""` proves the game bundle builds and the bindings resolve; it gives no lifecycle signal and does not check `secrets.required`. After a web build, `pnpm --filter @dicee/web exec wrangler deploy --dry-run` shows the web bundle, the `ASSETS` and `GAME_WORKER` bindings and the asset set.

**Known hazards:**

- **Two Worker versions per dispatch.** The Cloudflare wrangler-action step uploads its `secrets` input with `wrangler secret bulk` before it runs `deploy`, and a secret upload creates and deploys a version. For a short window new secrets run on old code. `wrangler deploy --secrets-file` is the single-operation form.
- **Empty namespaces on the wrong script.** A `migrations` deploy is a lifecycle no-op only when the target script already carries tag v2. `dicee` does; any other script name provisions empty namespaces and leaves live state behind, so never deploy this config under a different Worker name.
- **First deploy to a new game Worker name.** With `secrets.required` set, it needs `--secrets-file`. `dicee-web` declares no secrets.
- **No rollback in CI, and no Pages fallback.** Rollback is operator-run, `wrangler rollback` per Worker, and cannot cross a Durable Object lifecycle change; it replaces the Worker's code, never the custom domain, which stays on `dicee-web` either way. The Pages project that once served the domain is deleted, so recovery is a Worker version rollback or, by default, rolling forward.
- **No staging path.** Production is the first environment a change reaches.

**Post-deploy smoke** (operator):

- sign-in, which reaches the production Supabase project (a locally built deploy can inline local values);
- lobby and room WebSocket upgrades;
- the unauthenticated lobby APIs `/api/lobby/rooms` and `/api/lobby/online` return JSON, which proves `dicee-web` -> `GAME_WORKER` -> `dicee` -> `GlobalLobby`;
- security headers and CSP, with the WASM engine loading in a Chromium browser;
- `/_app/immutable/` assets load, and an unknown path returns the SvelteKit 404 page;
- transcription;
- admin pages refuse a non-admin session.

## Live checks

Use read-only methods only: the dashboard or a read-scoped API `GET`. Record each result in the [status.md](status.md) readbacks as names, counts and HTTP status. Public product hostnames may be named; account, zone and namespace ids, the account `workers.dev` subdomain, project refs and secret values never may be.

- **Zone-level Worker routes** are the one surface the scoped Cloudflare credential cannot read: those reads return HTTP 403. Read them in the dashboard, under each script's Domains & Routes, before deleting any legacy script; do not broaden the credential to close the gap.
- **Immediately before a deletion or a release**, re-read the target's routes, custom domains, direct Worker URLs and secret names. `wrangler secret list` returns names only. An inventory older than the change is not evidence for it.

Method safety: `wrangler secret put`, `bulk` and `delete` each create and deploy a version, and `wrangler triggers deploy` changes routes. None of these is a readback. For reachability use the public site and the lobby APIs; `dicee` has no public ingress, and admin diagnostics paths are never a probe.

## Open decisions

Each open decision has a recommended default. The owner decides, and [status.md](status.md) records the decision.

- **Preview shares the production Worker** (audit warning F7). Decided: no hosted preview backed by production (status decision 8). The web Worker has no named environment, `workers.dev` subdomain or Preview URLs; local `pnpm dev:full` is the test path, and hosted multiplayer testing waits for an isolated backend (roadmap section 8).
- **Room storage retention.** Nothing deletes Durable Object storage, so finished rooms keep theirs. Default: reclaim storage when a room is finished and empty, on the existing alarm path (roadmap, Worker correctness). Plan as though SQLite storage is billed; the account billing view is the evidence.
- **`secrets.required` after the Supabase key migration.** Default: one secret key replaces the legacy anon and service-role names, and the Worker sends it only as `apikey`. Change the list, the code and the CI secrets together, and set the new secret on the Worker before the deploy that requires it. Until then the Worker secrets and the web build's `PUBLIC_SUPABASE_ANON_KEY` stay on the legacy anon key: never swap a stored secret to the newer publishable format on its own.
- **`SUPABASE_JWT_SECRET` read but undeclared** (audit warning B8). Default: resolve it by removing HS256, never by adding the name.
- **Unused `ENVIRONMENT` var** (audit warning B11). Removed from the web config. Default: delete it from the game Worker config unless code starts reading it.
- **Named `development` and `staging` environments.** No CI job or binding uses them. Default: keep them until the staging trigger fires, then either wire one into CI or delete both.
- **Infrastructure adoption details** (status decision 9). The [governance strategy](#governance-strategy) selects OpenTofu/Wrangler responsibilities and four credential consumers. The exact repository/root, backend/state controls, pinned provider field map and effective token reach remain open. Acceptance and the import/release/plan checks precede infrastructure writes; a dedicated account remains a separate conditional migration decision.

## Local commands

```sh
pnpm dev:do                                            # game Worker locally (development env)
pnpm --filter @dicee/web dev:worker                    # built web Worker and assets locally (build first)
pnpm --filter @dicee/cloudflare-do types               # regenerate bindings (same for @dicee/web)
pnpm check:workers                                     # both packages: types --check
pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run --env=""
pnpm --filter @dicee/web exec wrangler deploy --dry-run  # after a web build
pnpm cf:audit                                          # config audit; cf:audit:strict fails on warnings
node scripts/cloudflare-config-audit.mjs --self-test   # audit self-test
```
