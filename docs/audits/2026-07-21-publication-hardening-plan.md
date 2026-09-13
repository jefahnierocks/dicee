---
title: Publication hardening — verification and closeout plan
category: audit
component: repository
status: in-progress
version: 1.1.0
last_updated: 2026-09-12
tags: [security, publication, supabase, cloudflare, rls, csp, ci]
priority: high
---

# Publication hardening — verification and closeout plan

Companion to `2026-07-21-security-publication-audit.md`. This document records an
independent, adversarial re-verification of that audit (80-agent workflow plus
first-hand review), the additional issues it surfaced, the fixes applied locally
in this pass, and the operator-only live steps that remain before the repository
can be described as remediated end to end.

**Verdict:** the audit's in-source hardening is high quality and largely accurate.
Adversarial re-verification confirmed the substantive claims and found a small
number of real gaps the audit missed. The highest-value code/config/publication
gaps are now fixed and locally validated. The repository is **not yet cleared end
to end**: reachable Git history and several live-platform controls still require
operator action (Section 5).

Method note: every finding below was independently reproduced against the current
**working tree** (untracked-but-non-ignored files are part of the publication
candidate). Severities are post-adversarial-review (many first-pass severities
were corrected down after a refutation attempt).

## Status ledger (2026-09-12)

This plan is a point-in-time record of the 2026-07-21 and 2026-07-22 working
tree. The 2026-09-12 modernization audit re-checked it; finding IDs (D-xx) refer
to that audit. Nothing in this ledger records a live action. Live state is
unverified unless [`docs/status.md`](../status.md), the current status of record,
records a readback.

**Contradicted or superseded claims in this document**

| Claim (section) | Status on 2026-09-12 |
|---|---|
| Public-safety scan passes (1) | Contradicted (D-18). The scan failed on documentation prose and missed hosted-database hostnames written without a URL scheme. This document itself re-disclosed identifiers in Section 1 item 7 and Section 4 and carried raw control bytes. The document and scan were corrected locally in the 2026-09 remediation. |
| RLS coverage confirmed strong (2); "airtight RLS" (4) | Contradicted (D-01). RLS being enabled on every table did not stop a signed-in account from changing its own privileged profile role. |
| `sharp` override is the patched release (2) | Contradicted (D-05). The pinned release was itself vulnerable, and the working-tree lockfile reported 33 advisories (12 high). |
| Toolchain and Action SHAs all current (2) | Point-in-time; stale by 2026-09-12 (D-24, D-26). |
| DO `exports` is correct; do not re-add `migrations` (2) | Superseded by owner decision. The baseline keeps the legacy `migrations` v1 and v2 with `new_sqlite_classes`; `exports` is a later standalone operator deploy after ADR-005 is accepted. |
| Deploys are manual and gated (2) | Incomplete (D-08). The deploy jobs accepted a dispatch from any branch; a `main`-only ref condition is part of the 2026-09 remediation. |
| `/_debug` not reachable externally (3.2) | Contradicted for the deployed revision (D-02). |

**Pending remediations**

| ID | Severity | Issue | Remediation | Status |
|---|---|---|---|---|
| D-01 | Critical | `profiles.role` self-escalation. The owner-row update policy on `profiles` does not protect privileged columns, and the admin permission check trusts `profiles.role`. That check gates `/_debug` and admin promotion. | A new forward migration restricts column-level update privileges, with database tests. The operator backs up and applies it live before the baseline is pushed, then reviews role counts. The July privacy migration ships separately, after it. | Local fix in progress; not applied live. |
| D-02 | High | Unauthenticated Durable Object `/_debug` routes. The `GlobalLobby` debug handlers perform no authorization of their own. The deployed revision predates `workers_dev: false`, and its Pages `/_debug` routes required only a session. | The operator confirms that workers.dev and Preview URLs are disabled on every Dicee Worker script. The baseline Worker configuration sets `workers_dev: false` and is to add `preview_urls: false`. The debug surface then moves behind RPC reachable only through the service binding after the RBAC check. | Live state unverified. |

**Section 3 items**

| Item | Status on 2026-09-12 |
|---|---|
| 3.1 Leaderboard visibility | Owner approved the privacy migration; it ships separately, after D-01. |
| 3.2 `/_debug` Durable Object authorization | Pending as D-02. The suggested production-environment gate is rejected because it would also break the RBAC admin proxy. |
| 3.3 `USING(true)` tables | `feature_flags` targeting data pending (D-55); `admin_permissions` read scope open. |
| 3.4 Gallery function `search_path` | Pending (D-55). |
| 3.5 Spectator status value | Pending (D-55). |
| 3.6 Private rooms only unlisted | Pending (D-16). |
| 3.7 WebSocket re-authentication and rate caps | Open. |
| 3.8 Session cookies not `HttpOnly` | Open. |
| 3.9 Generated-type drift | Pending. Types are regenerated only after the live migration, by the operator. |
| 3.10 Migration hygiene | In-place base migration edit pending revert (D-13). The privacy migration is renumbered to sort after the D-01 migration. |
| 3.11 Regression tests and JWKS algorithms | JWKS `algorithms` allowlist pending (D-15); redirect regression test open. |
| 3.12 Unstaged deletions | Handled by the baseline commit series. |

---

## 1. Fixes applied in this pass (local only; validated)

All changes are local edits to the already-dirty working tree. Nothing was
committed, pushed, deployed, or applied to a live database.

| # | File | Issue found | Sev | Fix |
|---|------|-------------|-----|-----|
| 1 | `packages/web/svelte.config.js` | New CSP `script-src 'self'` blocks WebAssembly buffer compilation on Chromium (V8) → the core WASM probability engine throws `EngineInitError` in Chrome/Edge. `dicee_engine.js` uses `WebAssembly.instantiate(bytes)` / `new WebAssembly.Module(bytes)`. | High (functional regression) | Added `'wasm-unsafe-eval'` to `script-src` (does **not** permit JS `eval`, unlike `unsafe-eval`). |
| 2 | `packages/web/src/routes/ws/lobby/+server.ts` | **Lobby identity spoofing.** The proxy copies all inbound headers and only sets `X-User-Id` when a session exists, with no 401 for anonymous requests. An unauthenticated caller sending `X-User-Id: <victim>` has it forwarded verbatim to `GlobalLobby` (`GlobalLobby.ts:311` trusts the header). | High | Strip `X-User-Id`/`X-Display-Name`/`X-Avatar-Seed`/`Authorization` before deriving identity; only set them server-side. Anonymous guest flow preserved (DO assigns a random UUID). |
| 3 | `packages/web/src/routes/ws/room/[code]/+server.ts` | Same header-injection pattern (not currently exploitable — route 401s and overwrites — but fragile). | Low (defense-in-depth) | Same delete-before-set hardening for consistency. |
| 4 | `packages/web/src/routes/auth/callback/+server.ts` | **Open-redirect bypass.** `safeRedirectTarget` rejected `//` and `\` but not control chars. `?next=/%09/evil.com` (embedded TAB) passes the check; browsers strip the TAB from the `Location` header, yielding a protocol-relative `//evil.com`. | Medium | Reject any `next` containing control chars (`\x00`–`\x1f` and `\x7f`) in addition to the existing checks. |
| 5 | `packages/web/wrangler.jsonc` | `observability` block is **Workers-only** and unsupported in a Pages wrangler config (confirmed against current Cloudflare docs — supported Pages keys do not include it), producing a deploy-time validation failure/warning for `wrangler pages deploy`. | High (deploy) | Removed the `observability` block from the Pages config (kept on the DO Worker config, where it is valid). |
| 6 | `scripts/public-safety-scan.sh` | **Fail-open gate.** Every detector runs `if rg … 2>/dev/null; then` and the email loop uses `\|\| true`; under `set -e` a missing `rg` or missing PCRE2 support makes the whole scan silently pass. | Medium | Added a fail-closed preflight (require `rg` + working `--pcre2`); added a Google OAuth client-ID pattern. |
| 7 | `docs/archive/milestone-1/m1/auth-implementation-plan.md`, `docs/planning/domain-migration-report.md` | **Residual operator infrastructure identifiers in the candidate** the audit's scan missed: a live Google OAuth client ID and GCP project number, a GCP project ID, and a Cloudflare zone ID (the sibling domain and account were redacted; these were not). | Medium (publication hygiene) | Redacted to `<google-oauth-client-id>` / `<gcp-project-id>` / `<cloudflare-zone-id>`. |

**Validation performed (local, proportional to the change):**

- `pnpm --filter @dicee/web check` → svelte-check **995 files, 0 errors, 0 warnings** (also re-ran `wrangler types` cleanly against the edited Pages config).
- `pnpm --filter @dicee/web test:agent` → **1574 passed, 3 skipped, 0 failures**.
- Biome clean on the edited TypeScript files.
- `./scripts/public-safety-scan.sh` → **pass** on 2026-07-22 (contradicted on 2026-09-12; see the status ledger); negative test with `rg` hidden → **fails closed** as intended.
- Confirmed all redacted tokens now appear in **0** candidate files.

> The full cross-stack `pnpm validate` (Rust/Python/build/worker) should be run by
> the operator in an unrestricted environment as the final gate — the local sandbox
> blocks `wrangler`/`miniflare` temp and log writes, which makes the full suite noisy
> here. The changes above are confined to web TypeScript, one Pages config, one shell
> script, and docs; the Rust/Python/engine lanes are untouched.

---

## 2. Confirmed strong (verified — do not "fix")

Independent reproduction confirmed these audit claims are real and well implemented:

- **JWT verification** (`cloudflare-do/src/auth.ts`): JWKS-asymmetric primary; the
  HS256 fallback is gated behind `JWKSNoMatchingKey` **and** a configured secret
  **and** explicit `algorithms:['HS256']` → algorithm-confusion is mitigated.
  `iss`/`aud`/`exp`/`iat` re-checked; avatar host locked to `api.dicebear.com`;
  display name never derived from email/`full_name`.
- **CSP** (`svelte.config.js`): genuinely strict — `script-src` has no
  `unsafe-inline`/`unsafe-eval` (auto-nonced), plus `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`,
  `upgrade-insecure-requests`. `csrf.trustedOrigins:[]` keeps origin-checking strict.
- **Telemetry** (`api/telemetry`): dual size caps (declared + measured bytes),
  batch cap 50, per-event Zod validation (fail-closed), client `user_id` discarded,
  URLs normalized same-origin, UA from request header, timestamps clamped.
- **Transcription** (`api/transcribe`): verified session required, MIME allowlist,
  request + decoded-audio size bounds, no SSRF, provider errors not leaked.
- **WS room path**: validated session required, token in `Authorization` header
  (never URL), display name from DB profile, client identity headers overwritten.
- **Logger** (`cloudflare-do/src/lib/logger.ts`): recursive key-based redaction +
  Bearer/email string scrubbing (note: it also redacts `roomCode`/`userId` — an
  observability trade-off, not a defect).
- **RLS coverage**: all 15 public tables have RLS enabled; the 6 persistence RPCs
  are correctly locked to `service_role`. (Contradicted on 2026-09-12: enabled
  RLS did not protect privileged profile columns; see D-01 in the status ledger.)
- **Supply chain**: `pnpm install --frozen-lockfile` is in sync; no git-URL/off-registry
  deps; lifecycle scripts limited to a 5-package allowlist; `sharp` override → real
  patched `0.35.3` (GHSA-f88m-g3jw-g9cj). (Contradicted on 2026-09-12: the pinned
  release was itself vulnerable; see D-05.)
- **CI/CD**: every Action pinned to a 40-hex SHA; deploys are manual `workflow_dispatch`
  gated on `inputs.deploy` + `environment: Production`; least-privilege `GITHUB_TOKEN`;
  frozen-lockfile install; drift check (`git diff --exit-code`). (Incomplete: the
  deploy jobs did not restrict the dispatched branch; see D-08.)
- **Operator metadata**: real values in gitignored `.dicee/operator-metadata.sh`
  (mode `0600`); in-repo loader exposes only variable names.
- **Toolchain & Actions currency (July 2026): all current.** node 24.18.0, pnpm
  11.15.1, rust 1.97.1, bun 1.3.14, uv 0.11.30, python 3.13.14, wrangler 4.113.0,
  svelte 5.56.7, kit 2.70.1, adapter 7.2.9. Action SHAs match their claimed tags
  (checkout v7 is real; no v8 exists). Point-in-time; stale by 2026-09-12.
- **Wrangler DO declaration is correct.** The `exports` block is the current,
  supported way to declare SQLite Durable Objects; `migrations`/`new_sqlite_classes`
  is the **legacy** method and is **mutually exclusive** with `exports` — do **not**
  re-add it (an earlier hypothesis to "restore the migration tag" would break the
  config). `observability` nested logs/traces and the top-level `secrets` key are
  valid wrangler 4.113 fields **for the Worker**. (Superseded by owner decision on
  2026-09-12: the baseline keeps legacy `migrations` v1 and v2, and `exports` is a
  later standalone deploy after ADR-005 is accepted.)
- **TypeScript 6 is intentional** (documented in `AGENTS.md`); TS 7.0 GA'd 2026-07-08
  but the Svelte embedded-language API isn't ready — not an "outdated" gap.

---

## 3. Remaining source/config items (not auto-fixed) — with rationale

These were left for a decision or because a safe local fix is not possible without
authorization or product input. Ordered by importance.

1. **Leaderboard visibility is a large, intended UX regression (product decision).**
   The migration sets `profiles.is_public` default `false` and flips existing rows
   to private, and narrows `player_stats`/`solo_leaderboard`/`gallery_stats`/
   `gallery_achievements` SELECT policies to owner-or-public. Result: public/gallery/
   solo leaderboards render empty until each user opts in, and other players'
   achievement counts show 0. This is secure-by-default and correct, but it changes
   product behavior — **confirm this is intended** and add an opt-in affordance + UI
   copy before/at publish. (Not a bug; no code "fix" applied.)

2. **`/_debug` has no authorization at the executing (Durable Object) layer.**
   `worker.ts` forwards any `/_debug/*` path to `GlobalLobby`, which performs
   destructive actions (delete room, clear-all, storage dump) with zero checks.
   Today this is protected only by network reachability (`workers_dev:false`, no
   route/custom domain) + the RBAC-gated Pages proxy (hardcoded internal paths).
   **Recommend** a shared-secret/signed-header check in the DO for `/_debug`
   (and gate it to `env.ENVIRONMENT !== 'production'`) so a single config regression
   can't expose it. Defense-in-depth; not currently reachable externally.
   (Contradicted on 2026-09-12 for the deployed revision, and the production
   environment gate would break the RBAC proxy; see D-02 in the status ledger.)

3. **Two `USING(true)` tables untouched by the hardening migration** (low):
   `admin_permissions` (readable by every authenticated user → exposes the full RBAC
   matrix incl. the `super_admin '*'` wildcard) and `feature_flags` (readable by
   `anon`, includes `user_ids text[]` targeting data, streamed via realtime).
   Consider tightening both in a follow-up migration.

4. **Four gallery `SECURITY DEFINER` functions still lack `SET search_path`**
   (`award_gallery_points`, `unlock_gallery_achievement`, `update_achievement_progress`,
   `aggregate_game_stats`) — flagged by Supabase's `function_search_path_mutable`
   linter. Low risk now (the migration restricts them to `service_role`), but not
   remediated. **Caveat before fixing:** verify each body is fully schema-qualified
   first — `aggregate_game_stats` has unqualified relation refs, so a naïve
   `SET search_path = ''` would break it. Add to a *new* migration, not by editing
   the original.

5. **Spectator RLS references a nonexistent game status.** `20241208000003_spectator_rls.sql`
   gates reads on `status IN ('playing','completed')`, but the `games` CHECK constraint
   only allows `waiting/starting/active/completed/abandoned`. Live-game DB spectating
   never matches. Latent correctness bug — fix the policy to use `'active'`.

6. **"Private" rooms are only unlisted, not access-controlled.** `isPublic:false`
   filters lobby listings only; the player connect path never consults it, so any
   authenticated user with the 6-char code can join. Decide whether room privacy
   should be an access control (approval/allowlist) or is intentionally "unlisted".

7. **WebSocket sessions are never re-authenticated after connect**, and there is no
   per-connection/global message rate limit in `GameRoom.webSocketMessage` (only
   per-feature caps). Consider periodic re-validation of `exp` on hibernation resume
   and a global message-rate cap. Common for WS apps; low priority.

8. **Supabase session cookies are not `HttpOnly`** (`@supabase/ssr` default), so an
   XSS would expose the access token. This is inherent to the SSR PKCE cookie flow;
   the strict CSP is the primary mitigation. Note and accept, or move to a
   server-only session model.

9. **Generated-type + duplicate drift.** `packages/web/src/lib/types/database.ts`
   still declares the four dropped `bug_reports` columns (runtime-safe only because
   `bugReport.ts` casts `as any`); `packages/web/src/lib/supabase/generated-types.ts`
   is a stale, **unused** duplicate (0 imports). Regenerate types after the migration
   is applied (an authenticated live op — see Section 5) and delete the dead duplicate.

10. **Migration hygiene** (low): the privacy migration (`*_public_security_hardening.sql`,
    renumbered in 2026-09 to sort after the D-01 migration) is forward-only and not re-runnable
    (its `CREATE POLICY` statements lack `IF NOT EXISTS`) — fine for Supabase's
    run-once model, worth a comment. Separately, the base migration `20241202000001_profiles.sql`
    was **edited in place** (`is_public` default `true`→`false`); editing an
    already-applied migration is a drift/checksum hazard and is redundant with the
    forward migration — prefer reverting the in-place edit and relying on the forward
    migration alone.

11. **Missing regression tests / defense-in-depth** (low): add a table-driven test for
    `safeRedirectTarget` (`//evil`, `/\evil`, `/%09/evil.com`, valid `/foo?x=1`) —
    requires exporting it; and add an explicit `algorithms` allowlist to the primary
    JWKS `jwtVerify` call in `auth.ts` (currently relies on jose key-type enforcement).

12. **Publication mechanics — unstaged deletions.** `.npmrc` and `consoleCapture.ts`
    are deleted on disk but not staged, so `git ls-files -c` (and anything that
    archives from HEAD/index) still lists them. Stage the deletions before publishing
    (a git operation — see Section 5) so the shipped tree matches the working tree.

---

## 4. History-reachable exposure (unchanged by working-tree edits)

Redacting the working tree does **not** remove anything already in Git history:

- The previous `ci.yml` hardcoded the **live Supabase project URL**
  (`<project-ref>.supabase.co`) and a **JWT-shaped anon key** — still reachable
  in history (the new `ci.yml` uses `127.0.0.1` + a placeholder).
- Three distinct author/committer email addresses.
- The infrastructure identifiers redacted in Section 1 item 7 remain in prior commits.

The anon key is public-by-design (browser key), so the real control is airtight RLS
(hardened by the migration). (Contradicted on 2026-09-12: see D-01 in the status
ledger.) Removing any of the above from history is a **destructive
rewrite** and cannot retract existing clones/forks/caches — an explicit operator
decision (Section 5).

---

## 5. Operator-only live steps (require explicit authorization) — runbook

None of these were performed. Each needs your go-ahead; several are irreversible.

1. **History-rewrite decision.** Decide whether to rewrite history to purge the old
   anon key, project URL, author emails, and infra IDs. If yes: coordinate fork/cache
   expectations, then **rotate the Supabase anon key** and any still-operational
   identifier regardless (rotation matters more than redaction). If no: rely on RLS +
   accept the public anon key.
2. **Apply the DB migrations.** First back up and apply the D-01 profiles privilege
   migration (see the status ledger). Then apply the July privacy migration
   (`supabase/migrations/*_public_security_hardening.sql`, renumbered in 2026-09 to
   sort after it) separately in a controlled lane: **back up first** (it makes all profiles private and drops
   four `bug_reports` columns), apply, verify function grants + RLS behavior, then
   **regenerate Supabase types** and commit them (resolves the drift in Section 3.9).
   Also decide on Section 3 items 3–5 as follow-up migrations.
3. **Branch protection / ruleset** on `main` with required CI + CodeQL checks — the
   live repo currently has neither.
4. **Protect the `Production` environment**: required reviewer(s) + allowed branches,
   and disable admin bypass. Today the deploy gate reduces to "a write-access user
   dispatches with `deploy=true`" — there is no enforced second-person approval.
5. **Enable Dependabot security updates** (the committed `dependabot.yml` configures
   *version* updates only; security updates are a separate repo setting).
6. **Run CodeQL on GitHub** for the first time and triage results (workflow added,
   never executed remotely). Note: Rust/worker config are outside CodeQL's JS/TS+Python
   coverage — rely on clippy/cargo-audit there.
7. **Stage the working-tree deletions** and review the full diff, then commit in
   focused chunks (Section 6).
8. **Manual deploy + production smoke tests** (after 1–7): authorization on `/_debug`,
   WebSocket auth (incl. the lobby `X-User-Id` fix), **CSP + WASM engine load in
   Chrome/Edge** (verify no `EngineInitError`), transcription, telemetry bounds, and
   RLS visibility. Confirm the DO SQLite namespaces reconcile on the first
   `exports`-based deploy (existing data preserved). (Superseded on 2026-09-12:
   `exports` is deferred to a standalone operator deploy after ADR-005 is accepted.)

---

## 6. Suggested commit sequencing (once authorized)

The working tree mixes a large tooling/config refresh with the security hardening.
Before publishing, split into reviewable commits, e.g.:

1. `chore(config)`: MCP/agent/tooling refresh, `.mise`, catalog, lockfile.
2. `feat(build)`: wrangler `.toml`→`.jsonc`, CI rewrite, CodeQL, dependabot.
3. `fix(security)`: source hardening (auth, WS, telemetry, transcribe, logger, headers,
   `/_debug`, CSP incl. `wasm-unsafe-eval`, lobby header stripping, redirect hardening).
4. `feat(db)`: hardening migration (+ the follow-ups from Section 3).
5. `docs`/`chore(publication)`: redactions, SECURITY.md, scan hardening, staged deletions.

Run `pnpm validate` + `pnpm security:public` on the final tree before any push.
