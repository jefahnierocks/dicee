# RFC-004: Frontend Platform, Worker Identity, and Ingress Ownership

**Project:** Dicee — Cloudflare Platform Workstream
**RFC Status:** Draft — not accepted
**Version:** 0.1
**Date:** July 22, 2026
**Last reviewed:** 2026-07-22
**Authors:** Cloudflare workstream (agent-drafted stub)
**Reviewers:** Operator decision required — not yet reviewed

---

## Document Status & Versioning

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1 | 2026-07-22 | Initial stub. Context captured from the 2026-07-22 evidence bundle. Identifiers normalized to the canonical `OPS-` and `CF-D` registers in the same day's review pass. No decision made. | Current |

**Related Documents:**
- Operator evidence runbook: [`../cloudflare/operator-evidence.md`](../cloudflare/operator-evidence.md) — sole authority for `OPS-` identifiers
- Decision register: [`../cloudflare/decision-register.md`](../cloudflare/decision-register.md) — will resolve **CF-D02**, **CF-D03**, **CF-D04**, **CF-D07** when accepted; hard-gated on **CF-D11**
- Cloudflare authority hub: [`../cloudflare/README.md`](../cloudflare/README.md)
- Target-state research: [`../planning/dicee-cloudflare-resource-guidance.md`](../planning/dicee-cloudflare-resource-guidance.md) §1, §5, §6, §10
- [ADR-005: Durable Object Lifecycle and Namespace Ownership](./adr-005-durable-object-lifecycle.md) — sets the rename procedure this RFC depends on
- [RFC-005: Durable Data Strategy — D1, R2, and Supabase](./rfc-005-durable-data-strategy.md)

---

## Abstract

Four proposals in the target-state research are conventionally treated as separate decisions:
migrate `packages/web` from Cloudflare Pages to Workers Static Assets; rename the backend Worker
from `dicee` to `dicee-game-{env}`; rename the service binding `GAME_WORKER` to `GAME_SERVICE`;
and move custom-domain ownership into Wrangler `routes`. The evidence shows they are **one
decision**: the name collision only becomes real under Workers, and `routes` is not an accepted
key in a Pages configuration, so the domain proposal is not incrementally adoptable.

This RFC will decide whether to migrate, and if so, in what order and with what data-preservation
path. **No decision has been made.**

---

## Context

### C1. Current topology, as the repository declares it

```
Browser  ──same-origin HTTPS + WSS──▶  Pages project "dicee"
                                        ├─ SvelteKit SSR _worker.js (adapter-cloudflare 7.2.9)
                                        ├─ static assets, _routes.json, _headers, _redirects
                                        └─ 10 +server.ts proxies → https://internal/...
                                                    │
                                        GAME_WORKER service binding
                                                    ▼
                                       Worker "dicee"  (workers_dev: false, no routes)
                                        ├─ GameRoom DO (sqlite)   — JWT verified
                                        ├─ GlobalLobby DO (sqlite) — singleton
                                        └─ AI binding
```

- `packages/web/wrangler.jsonc:4` — `"pages_build_output_dir": ".svelte-kit/cloudflare"`. The
  adapter selects its target from this key: `is_building_for_cloudflare_pages()` in
  `@sveltejs/adapter-cloudflare/utils.js` returns true when `CF_PAGES` is set or
  `pages_build_output_dir` is present, and false when `main` or `assets` is present.
- `packages/web/wrangler.jsonc:7` and `:14` — `{ "binding": "GAME_WORKER", "service": "dicee" }`,
  at top level and again for `env.preview`.
- `packages/cloudflare-do/wrangler.jsonc:3` — `"name": "dicee"`;
  `packages/web/wrangler.jsonc:3` — also `"name": "dicee"`.
- `packages/cloudflare-do/wrangler.jsonc:5` — `"workers_dev": false`, with no `routes`, `route`,
  `custom_domain` or `preview_urls` key anywhere in the file.

**Repository configuration is not evidence of live Cloudflare state.** No lane in this workstream
ran an authenticated Cloudflare operation. Whether `dicee` actually has a route, a custom domain,
or an enabled `workers.dev` subdomain is unverified.

### C2. The frontend already satisfies the least-privilege boundary

`packages/web` holds exactly one binding to the backend. The plan's E1 goal — the frontend should
hold only a service binding, no storage or compute bindings — is **already true, on Pages,
today**. It is not a driver for migrating.

The browser never contacts the Worker directly. All three WebSocket call sites build the URL from
the page origin (`roomService.svelte.ts:141-142`, `spectatorService.svelte.ts:693-694`,
`stores/lobby.svelte.ts:203-204`), and there are no `workers.dev` strings in `packages/web/src` or
`packages/cloudflare-do/src`. Every proxied request is rewritten to the synthetic origin
`https://internal/...`.

### C3. Pages is not deprecated, and the migration is not a cost saving

Both are common assumptions and both are wrong. Verified live 2026-07-22:

| Assumption | Finding |
|---|---|
| "Pages is deprecated / there is a deadline" | `developers.cloudflare.com/pages/` (updated 2026-04-21) has no deprecation, sunset, or maintenance banner and states "Available on all plans". The limits page was updated 2026-07-16. The strongest official wording is comparative: "Unlike Pages, Workers has a distinctly broader set of features available to it, (including Durable Objects, Cron Triggers, and more comprehensive Observability)." |
| "Migrating saves money" | Cloudflare says "you can expect a **similar cost structure**", not cost parity. Static-asset requests are free and unlimited on both; Pages Functions invocations bill at the Worker rate. But: free-tier `run_worker_first` patterns return **429** instead of falling back to asset serving; Workers Builds is a separate quota surface from Pages' 500 builds/month; and "Unlike Pages, Workers does not share the same set of runtime and build-time variables." State it as "similar cost structure per Cloudflare, exact parity unmodelled." |
| "Service bindings need Workers" | Supported on Pages — compatibility matrix ✅/✅, plus a dedicated section on `pages/functions/bindings/` (updated 2026-06-25), including multi-`-c` local dev. |
| "Smart Placement is a Workers-only driver" | The matrix reads ✅/✅ — but see C4. It is neither a clean driver nor a settled non-issue. |

The de-facto signal is that the **Pages product changelog stops at 2025-04-18** — roughly fifteen
months of feature stagnation. That is stagnation, not deprecation; Pages *documentation* is still
actively maintained.

### C4. Smart Placement on Pages is beta, and one caveat applies directly to Dicee

`pages/functions/smart-placement/` (updated 2026-04-21) titles the feature "Smart Placement
(beta)" on Pages, and documents two caveats absent on Workers:

1. With `functions/_middleware.js`, all assets are served from a location near the back-end
   infrastructure, "which may result in an unexpected increase in latency."
2. **"When using `env.ASSETS.fetch`, assets served via the ASSETS fetcher from your Pages Function
   are served from the same location as your Function. This could be the location closest to your
   back-end infrastructure and not the user."**

`packages/web/svelte.config.js:1` imports `@sveltejs/adapter-cloudflare`, which emits an
advanced-mode `_worker.js` serving assets through the ASSETS fetcher — so caveat 2 applies to
Dicee directly. Enabling Smart Placement on the current Pages frontend is an **open latency risk
still requiring evaluation**, not a refuted concern and not a migration driver.

### C5. The real, verified Workers-only deltas

From the compatibility matrix and the Pages configuration reference:

| Capability | Workers | Pages |
|---|---|---|
| `observability` as a config key | yes | **no** — absent from the Pages inheritable-key list |
| Workers Logs / Logpush / Tail Workers | yes | no |
| Gradual Deployments | yes | no |
| Cloudflare Vite plugin | yes | no |
| Remote development (`--remote`) | yes | no |
| Serving assets on a subpath / non-root routes | yes | no |
| Custom domains **outside** Cloudflare zones | **no** | yes |
| Early Hints | partial | yes |
| Custom Branch Aliases | coming soon | yes |

The inline comment at `packages/web/wrangler.jsonc:8-10` — "`observability` is a Workers-only
field and is not supported in a Pages wrangler config" — is **correct** and should be kept.
Repo-managed frontend observability is the single strongest honest argument for migrating.

There is one documentation inconsistency worth noting: the compatibility matrix marks Source Maps
unsupported on Pages, while the Pages configuration reference lists `upload_source_maps` as a
supported inheritable key and `pages/functions/source-maps/` exists. One of the two is wrong; do
not treat source maps as a settled driver either way.

### C6. Five concrete migration traps

1. **`not_found_handling: "single-page-application"` would silently break SSR.** Workers routing
   serves `/index.html` with 200 for non-matching requests, and — because
   `packages/web/wrangler.jsonc:5` sets `compatibility_date: "2026-07-21"`, far past the
   2025-04-01 threshold — "navigation requests will not invoke the Worker script." Adapter 7.2.9
   compounds this: on the Workers branch it calls `builder.generateFallback()` to write an SPA
   `index.html` into the assets directory when that value is set. **Omit the key entirely.**
2. **Asset-first routing inverts today's behaviour.** "Workers will default to serving static
   assets ahead of your Worker script, unless you have configured `assets.run_worker_first`."
   Pages ran the Function first. Any auth check, CSP header, or logging that depends on the SSR
   worker seeing every request must be re-established deliberately.
3. **`svelte.config.js` `routes` becomes dead code.** Lines 37–41 set
   `routes: { include: ['/*'], exclude: ['<all>'] }`, which the adapter consumes only on the Pages
   branch; the Workers branch writes `.assetsignore` instead. The option must be deleted, not
   carried over.
4. **`routes` cannot be added to a Pages config.** Verified in installed wrangler 4.113.0:
   `supportedPagesConfigFields` does not include `routes`, and the config errors with
   `Configuration file for Pages projects does not support "<field>"`. §10 of the research doc is
   therefore **hard-coupled** to this migration.
5. **The custom-domain cutover is detach-then-attach, and no source claims it is zero-downtime.**
   Detaching from Pages requires deleting the zone CNAME then removing the domain; attaching to a
   Worker generates a new Advanced Certificate. Cloudflare's Pages docs warn that re-pointing a
   custom domain produces visitor errors "until it becomes active again." Deployment history and
   rollback targets are not documented as migrating; assume they are lost when the Pages project
   is deleted.

Two things that survive unchanged: `_headers` and `_redirects` are natively supported on Workers
and the adapter already writes them into the directory that becomes `assets.directory`; and the
adapter package itself does not change — `@sveltejs/adapter-cloudflare` 7.2.9 (pinned at
`pnpm-workspace.yaml:27`) builds for both targets, selected by the wrangler config alone.

### C7. The name collision

Both configs declare `"name": "dicee"`. This is **not** a live collision today — Cloudflare's own
migration guide states the migrating Worker "can be the same as your existing Pages project name",
confirming the two namespaces are distinct. `packages/web`'s `name` is additionally near-decorative
on the current deploy path, since CI passes `--project-name=dicee` explicitly.

It becomes a **hard blocker** the moment `packages/web` is a Worker: both configs would claim the
same Worker script name in one account. The research doc's `dicee-web` / `dicee-game-{env}` naming
resolves it — which is precisely why CF-D03 cannot be evaluated independently of CF-D02.

### C8. What each rename actually costs

**`GAME_WORKER` → `GAME_SERVICE` (CF-D04):** 14 repository sites — 10 `+server.ts` handlers each
reading `platform?.env?.GAME_WORKER` with an adjacent error string, `packages/web/src/app.d.ts:57`,
`packages/web/wrangler.jsonc:7` and `:14`, plus a regenerated `worker-configuration.d.ts`. Atomic
within `packages/web`; no backend change.

There is a silent hole: `app.d.ts:54-58` hand-declares `Platform.env.GAME_WORKER` independently of
the generated `worker-configuration.d.ts`, and `packages/web/tsconfig.json` declares no `types`
array referencing the generated file. Update the config and the generated types but not
`app.d.ts`, and `svelte-check` still passes across all consuming routes. The two declarations also
already diverge — `app.d.ts` omits the `ENVIRONMENT` var that both the config and the generated
types declare.

**Worker service rename `dicee` → `dicee-game-{env}` (CF-D03):** see
[ADR-005](./adr-005-durable-object-lifecycle.md) §C8. Durable Object namespaces are keyed to the
Worker script name, so a rename yields empty namespaces unless the
four-deploy transfer is run. Exactly one repository reference breaks —
`packages/web/wrangler.jsonc:7` — after which every backend route 503s, with no CI job deploying
the Worker to catch it.

### C9. Ingress is the hard gate

The backend Worker delegates 100% of lobby identity and all `/_debug` authorization to the Pages
proxy.

Inside the Worker:
- `packages/cloudflare-do/src/GlobalLobby.ts:311-313` derives identity verbatim from
  `X-User-Id` / `X-Display-Name` / `X-Avatar-Seed` with a `crypto.randomUUID()` fallback. The file
  contains no reference to `verifySupabaseJWT`, `Authorization`, or any admin check.
- `packages/cloudflare-do/src/worker.ts:52-61` forwards every `/_debug/*` path to the lobby stub
  unauthenticated, and the DO's debug handlers (`GlobalLobby.ts:192-234`, `:243-268`) — including
  the `roomCode === 'ALL'` mass room-delete — apply no check.
- By contrast `GameRoom.ts:676-706` requires and verifies a Supabase Bearer token, and
  `api/transcribe.ts:33-47` authenticates too. So GameRoom is not the lone exception.

But authorization does exist, one layer out, and it is not a single route:
- All five web `_debug` proxies are gated at **line 12** by `requireAdminPermission`:
  `rooms/+server.ts` (`rooms:view`), `rooms/[code]/+server.ts` (`rooms:close`),
  `rooms/all/+server.ts` (`rooms:clear_all`), `connections/+server.ts` (`users:view`),
  `storage/+server.ts` (`audit:view`). `packages/web/src/lib/server/admin.ts:11-34` implements it:
  `safeGetSession()` → 401, then the database-backed `has_admin_permission` RPC → 503 on error,
  403 unless true. The RPC is defined in
  `supabase/migrations/20241215000001_admin_rbac.sql`.
- `packages/web/src/routes/ws/lobby/+server.ts:29-32` explicitly deletes client-supplied
  `X-User-Id`, `X-Display-Name`, `X-Avatar-Seed` and `Authorization` before setting them from a
  JWT-validated session (`hooks.server.ts` calls `auth.getUser()`). Same pattern at
  `ws/room/[code]/+server.ts:39-43`. The lobby headers are therefore **server-authoritative** on
  the intended path.

The accurate framing is **single-layer authorization at a trust boundary**, not an open hole. It
is safe exactly as long as the Worker is reachable only through the `GAME_WORKER` service binding.
Any second caller of that binding, or any public route on the Worker, would expose
`DELETE /_debug/rooms/all` with no in-Worker check.

Two facts reduce the adjacent preview-URL concern: `preview_urls` defaults to the value of
`workers_dev` (already `false`), and Preview URLs "are not generated for Workers that implement a
Durable Object" — `dicee` exports two. The residual unknown is the live `workers.dev` subdomain
state.

**Consequence for this RFC:** adding real in-Worker authorization for `GlobalLobby` and `/_debug`
(**CF-D11**) is a **precondition** of any ingress, custom-domain, or Worker-identity change, not a
follow-up. (CF-D09 is a different entry — commit and deploy sequencing for the untracked config —
and is not what gates ingress.)

### C10. Downstream coupling

Two items outside the frontend depend on decisions made here:

- **Staging.** `packages/web/wrangler.jsonc:14` binds Pages *preview* to `service: "dicee"` —
  production Durable Object state. Cloudflare requires `<worker-name>-<environment-name>` to target
  an environment-scoped Worker. Pages accepts only `preview` and `production` as environment names,
  so a Worker `staging` environment has no one-to-one Pages mirror. Under Workers Static Assets the
  environment model changes entirely.
- **CSP.** `packages/web/svelte.config.js` sets `'connect-src': ['self', 'https://*.supabase.co',
  'wss://*.supabase.co']` — the app's own origin gets no explicit `wss://` entry, relying on
  `'self'`. Any move of WebSockets to a distinct hostname is a two-place change (client URL builder
  **and** CSP), not a URL swap.

---

## Decision Drivers

1. **Nothing forces this.** No deprecation, no deadline, no cost delta. Any decision to migrate
   must be justified by a capability that is currently needed.
2. **Observability-as-code on the frontend** is the one genuine Workers-only capability Dicee has
   an articulable reason to want.
3. **Gradual Deployments** matter for a multiplayer game where a bad SSR deploy breaks live rooms —
   but only if someone will actually use percentage rollouts.
4. **Zone ownership may veto the whole thing.** Custom domains outside Cloudflare zones are
   supported on Pages and unsupported on Workers.
5. **Coupling.** Migrating forces the rename; the rename forces a Durable Object data decision; the
   domain move forces the migration. These cannot be sequenced independently.
6. **Security precondition.** Ingress changes are unsafe until CF-D11 lands.
7. **Rollback envelope.** A parallel run on a `workers.dev` subdomain makes everything reversible
   up to the DNS cutover — and irreversible after.

---

## Options Considered

### Option A — Stay on Pages

**Pros:** zero work; no name collision; no SSR-breaking traps; custom domain untouched; keeps the
one Pages-only capability (custom domains outside Cloudflare zones) available; least-privilege
boundary already satisfied.

**Cons:** frontend observability stays dashboard-configured and cannot be repo-managed; no
Gradual Deployments; no Vite plugin; Pages receives no new features; §10 custom-domain-in-Wrangler
is permanently unavailable.

### Option B — Migrate to Workers Static Assets, with the rename, in one coordinated change

Rename backend to `dicee-game-{env}` (with the ADR-005 data decision), rename the binding to
`GAME_SERVICE`, convert `packages/web` to `dicee-web` with `main` + `assets.{directory,binding}`,
then move the custom domain into `routes`.

**Pros:** resolves the collision, the binding name, and domain ownership together; unlocks
observability, Logpush, Tail Workers, Gradual Deployments, the Vite plugin; makes the whole
frontend platform repo-managed.

**Cons:** the largest change in the workstream; five documented traps (C6); a detach-then-attach
domain cutover with no zero-downtime guarantee; Pages deployment history and rollback targets
presumed lost; CI must move from `pages deploy` to Workers Builds or an equivalent, including
splitting build-time from runtime variables; blocked entirely if the zone check (OPS-11) is
negative.

### Option C — Migrate the frontend only; keep the backend named `dicee`

Convert `packages/web` to a Worker named `dicee-web`, leave the backend and the `GAME_WORKER`
binding alone.

**Pros:** avoids the Durable Object data question entirely; the name collision is resolved by
renaming only the frontend; strictly smaller than B.

**Cons:** leaves the backend Worker named `dicee` while the frontend is `dicee-web` — legible but
asymmetric; still incurs all five migration traps and the domain cutover; the `GAME_SERVICE`
rename is deferred as pure churn.

### Option D — Defer, with a written trigger

Stay on Pages until a stated need appears: repo-managed frontend observability, percentage-based
SSR rollout, or a Pages limit actually binding.

**Pros:** no work now; preserves every option; the trigger makes the deferral reviewable rather
than indefinite.

**Cons:** the collision and the traps still exist whenever the trigger fires; postponing does not
reduce the eventual cost.

### Sub-option: the `GAME_WORKER` → `GAME_SERVICE` rename in isolation

Cheap and atomic, but purely cosmetic on its own. Worth folding into B or C; not worth a standalone
change. The `app.d.ts` drift hole (C8) is worth closing regardless of any rename.

---

## Consequences and Reversibility

**Reversible:**
- Everything up to the DNS cutover. The Pages project survives migration and must be deleted
  manually; keeping it with automatic deployments disabled preserves a rollback path.
- The binding rename, trivially.
- Validating a `dicee-web` Worker on a `workers.dev` subdomain before touching the domain.

**Irreversible or effectively so:**
- The custom-domain cutover — new certificate, DNS transition, no documented zero-downtime path.
- Deleting the Pages project: deployment history and rollback targets are presumed lost
  (unverified; Cloudflare documents neither migration nor loss).
- Any Worker service rename that proceeds without a namespace transfer — the Durable Object data
  is gone. See ADR-005.

**Honestly stated residual risk:** if `dicee.games` is not a Cloudflare zone on this account,
Option B and Option C are not merely inconvenient — they are **blocked**, because Workers do not
support custom domains outside Cloudflare zones. Resolve OPS-11 before any further design work.

---

## Open Questions & Evidence Required

### Operator-only (read-only)

`OPS-` identifiers are canonical in
[`../cloudflare/operator-evidence.md`](../cloudflare/operator-evidence.md), and that file is the
sole authority for the numbering. Questions with no entry there are listed without an id and must
not be assigned one.

| Id | Question | Method | Blocks |
|---|---|---|---|
| **OPS-11** | Is `dicee.games` a Cloudflare zone **on this account**? How is it currently attached to the Pages project? Does `www` → apex exist? | Zone list; Pages custom-domain view. `packages/web/_redirects:6` only says the redirect is "in CF dashboard". | **Options B and C outright** |
| **OPS-08** | Does the live Pages project have the `GAME_WORKER` service binding attached? Do its compatibility date, flags, and env config match `packages/web/wrangler.jsonc`? | `wrangler pages download config dicee`, run from a scratch directory and never with `--force` | The hub's named reconciliation blocker. If the binding is missing, every backend route 503s today. |
| **OPS-12** | Does `dicee` actually have a route, custom domain, or an enabled `workers.dev` subdomain despite `workers_dev: false` in a config that may never have been deployed? | Worker Settings → Domains & Routes. Do **not** use `wrangler triggers`; it mutates. | C9 |
| **OPS-13** | Are `dicee.pages.dev` and per-deployment preview hostnames publicly reachable? | plain `GET /` — never `/_debug/*` on any host | Second-origin exposure of `/ws/lobby` and the `_debug` proxies |
| **OPS-02** | Does any Worker in the account already hold `dicee-web-*` or `dicee-game-*`? | Account Workers list — the same listing as the `dicee-production` / `-staging` / `-development` check; this RFC only widens the set of names read against it, it does not add a new check | Naming |

### Requires a build, not a lookup

- Does the SSR bundle actually need `nodejs_compat`, or would `nodejs_als` suffice?
  `packages/web/wrangler.jsonc:6` sets `nodejs_compat`. `svelte.dev/docs/kit/adapter-cloudflare`
  documents `nodejs_als` as the baseline and `nodejs_compat` as a troubleshooting opt-in — but
  **Cloudflare's own SvelteKit Workers guide generates `nodejs_compat`**. Two live primary sources
  disagree; resolve by building, not by picking a side. Note `packages/web/src` has no direct
  `node:` imports outside `src/tools/**`, but transitive needs from `@supabase/ssr` and others are
  unverified.
- Does Dicee rely on Pages Functions running ahead of static assets? If any auth check, CSP header,
  or log depends on the SSR worker seeing every request, `assets.run_worker_first` must be
  configured deliberately.

### Unresolved upstream

- Whether the Pages → Workers domain cutover can be zero-downtime. No official source says so.
- Whether Pages deployment history or rollback targets survive.
- The source-maps documentation contradiction in C5.

### Depends on other artifacts

- **CF-D11** (in-Worker authorization for `GlobalLobby` and `/_debug/*`) must land before any
  ingress change. Tracked in the decision register as a fix item, not an RFC.
- [**ADR-005**](./adr-005-durable-object-lifecycle.md) must set the Worker-rename data-preservation
  policy before CF-D03 can be executed.

---

## Decision

**Not yet made.**

The recorded leaning from the 2026-07-22 synthesis is **Option D — defer with a written trigger**,
on the grounds that nothing forces the migration, cost is a wash, and the one compelling driver
(repo-managed frontend observability) is not currently a stated need. That leaning is not an
acceptance and carries no authority.

Until this RFC is accepted, treat the following as prohibited: adding `route`, `routes`, or
`custom_domain` to `packages/cloudflare-do/wrangler.jsonc`; setting `workers_dev: true` or
`preview_urls: true`; converting `packages/web` off `pages_build_output_dir`; renaming the Worker
service or the `GAME_WORKER` binding; and — under all circumstances, including after acceptance —
setting `assets.not_found_handling` to `"single-page-application"` on a SvelteKit SSR Worker.

---

## Decision Record

| Date | Author | Decision |
|------|--------|----------|
| 2026-07-22 | Cloudflare workstream | RFC drafted as a stub. No decision. Operator evidence outstanding (OPS-02, OPS-08, OPS-11, OPS-12, OPS-13). |

**Status:** Draft — not accepted. Nothing in this document authorises a deploy, a DNS change, a
domain move, or any provider mutation.

---

## Questions for Review

1. Is repo-managed frontend observability a real requirement, or a nice-to-have? This is the
   decision's centre of gravity.
2. Will anyone actually use Gradual Deployments for the SSR frontend, or is it theoretical?
3. If OPS-11 shows `dicee.games` is externally managed, is bringing the zone onto this account in
   scope, or does that settle the RFC as Option A?
4. Under Option B or C, is a maintenance window for the domain cutover acceptable, or must the
   Pages project stay live indefinitely as a rollback path?
5. Should the `app.d.ts` / `worker-configuration.d.ts` drift (C8) be closed now, independently of
   this decision?
6. Should Smart Placement be evaluated on the current Pages deployment (C4), or ruled out until
   after any migration?
