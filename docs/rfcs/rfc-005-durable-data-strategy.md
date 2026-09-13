# RFC-005: Durable Data Strategy — D1, R2, and Supabase

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
- Decision register: [`../cloudflare/decision-register.md`](../cloudflare/decision-register.md) — will resolve **CF-D06** and **CF-D01** when accepted
- Cloudflare authority hub: [`../cloudflare/README.md`](../cloudflare/README.md)
- Target-state research: [`../planning/dicee-cloudflare-resource-guidance.md`](../planning/dicee-cloudflare-resource-guidance.md) §3, §4, §12
- [RFC-003: Data Contracts & Event Schema](./rfc-003-data-contracts.md) — the existing data-contract authority
- [ADR-005: Durable Object Lifecycle and Namespace Ownership](./adr-005-durable-object-lifecycle.md)
- [RFC-004: Frontend Platform, Worker Identity, and Ingress Ownership](./rfc-004-frontend-platform-and-ingress.md)

---

## Abstract

The target-state research proposes introducing a Cloudflare D1 database (`dicee-app-{env}`) and an
R2 bucket (`dicee-audio-{env}`) with a lifecycle expiry rule, managed by OpenTofu, with Supabase
in a coexistence period. This RFC will decide whether to adopt either, and who owns them.

Two findings shape the decision before any design work begins. First, **cost is not a driver in
either direction** — and the intuition that D1 is cheaper storage than Durable Object SQLite is
backwards. Second, **the R2 proposal as written targets a feature that does not exist**, while the
one real binary-blob workload in the system is already served elsewhere and is not covered by the
proposal.

**No decision has been made.**

---

## Context

### C1. There is no D1 and no R2 today, and no infrastructure-as-code

`packages/cloudflare-do/wrangler.jsonc` declares two SQLite Durable Object namespaces
(lines 8–17), an `ai` binding (line 24), three required secrets (line 26), and nothing else. There
are no `d1_databases` and no `r2_buckets` keys in either config. `D1Database` and `R2Bucket`
appear only in the generated ambient `worker-configuration.d.ts`.

`find . -name "*.tf"` returns nothing and there is no `infra/` directory. `.gitignore` contains no
`*.tfstate`, `*.tfvars`, or `.terraform/` entries — which the research doc's own acceptance
checklist (line 499) requires before OpenTofu adoption. The repository's public-safety scan would
not catch a leaked `tfstate`; its filename denylist covers `.env*`, `.pem`, `.key`, `.p12`, `.pfx`,
and `.infisical.json` only.

### C2. The current data boundary is clean and one-directional

| Data | Owner | Shape |
|---|---|---|
| Live room state | `GameRoom` DO | KV keys `room`, `room_code`, `game_state`, `alarm_data`, `alarm_queue`, `chat:*`, plus three SQLite tables (`pending_domain_events`, `persistence_queue`, `game_metadata`) used purely as a write-behind outbox — not a query surface |
| Lobby, presence, chat, room directory | `GlobalLobby` DO | **Two KV keys only** — `lobby:activeRooms` (`src/lib/room-directory.ts:28`, persisted as a whole-array blob) and `lobby:chatHistory`. Declared `storage: "sqlite"` but uses zero SQL. |
| Identity | Supabase `auth.users` | See C4 |
| History and statistics | Supabase Postgres | 15 tables declared; **9 actually touched by code** |
| User-uploaded blobs | Supabase Storage `bug-audio` | Private bucket, 25 MB limit, per-user-folder RLS (`supabase/migrations/20250104000001_bug_reports.sql:78+`) |
| Generated sound effects | Pages static assets | 8 committed `.ogg` files, 628 KB total |

Persistence flows strictly one way: Durable Object → Postgres over `/rest/v1/rpc/` with the
service-role key. Postgres never reads Durable Object state. The single cross-cutting coupling is
that web SSR reads `profiles` on the WebSocket connect path to stamp server-authoritative identity
headers before proxying.

Six declared tables have no reader or writer anywhere in application source: `rooms`,
`analysis_events`, `gallery_stats`, `gallery_achievements`, `gallery_leaderboard_weekly`,
`admin_audit_log`. The real migratable surface is smaller than the schema suggests.

### C3. Cost is not a driver, and the storage intuition is inverted

Verified live 2026-07-22 against `developers.cloudflare.com/d1/platform/pricing/` and
`/durable-objects/platform/pricing/`:

| | D1 (Workers Paid) | Durable Object SQLite |
|---|---|---|
| Rows read | first 25 billion/month included | first 25 billion/month included |
| Rows written | first 50 million/month included | first 50 million/month included |
| **Stored data** | first 5 GB, then **$0.75/GB-month** | 5 GB-month, then **$0.20/GB-month** (see the enablement caveat below) |

D1 storage is **3.75× more expensive per GB-month** than Durable Object SQLite. Any argument of
the form "move state into D1 to reduce storage cost" is backwards. D1's case, if there is one, is
queryability — which requires naming a query.

Write volume gives no bottleneck either: one `games` row plus N `game_players` rows at game start,
then three batched RPCs at completion, all queued and retried from Durable Object SQLite. The
research doc itself scopes this as a "~10-user test app". Adding D1 today costs $0 and serves no
consumer.

For completeness, the constraint that *does* bind at scale is on the Durable Object side, not the
relational one: 50 million rows written per month is only about **19.3 rows/second sustained**
(1,157 is the per-*minute* figure), and ten testers generating one persisted heartbeat per second
for a month is roughly 25.9 million rows — 52% of the allowance from ten people. That validates the
"do not persist presence heartbeats" rule and is an argument for storage hygiene, not for D1.

The stored-data row above carries one caveat. Cloudflare's Durable Objects pricing page, retrieved
live on 2026-07-22, is **still worded in future tense** about SQLite storage billing: it carries a
callout reading that billing "will be enabled in January 2026, with a target date of January 7, 2026
(no earlier)", and that "only SQLite storage usage on and after the billing target date will incur
charges." That target date is now roughly six months past, and the page has not been rewritten out
of the future tense — so the documentation **alone** neither confirms nor refutes that billing was
switched on. Whether this account is actually being charged is answerable only from its own billing
and usage view, which is why it appears below as an operator lookup rather than a documentation
claim. The D1-versus-Durable-Object comparison is unaffected either way: it is a comparison of
published rates, and it holds whenever both are billed.

### C4. The identity coupling is the real cost, and it does not go away

Every foreign key in the schema roots at `profiles(id)`, and `profiles.id` is itself a foreign key
to `auth.users(id)` populated by a trigger:

```sql
-- supabase/migrations/20241202000001_profiles.sql:6
id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

-- :57-59
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
```

The Worker verifies Supabase JWTs itself, JWKS-first, against
`${SUPABASE_URL}/auth/v1/.well-known/jwks.json` (`packages/cloudflare-do/src/auth.ts:183`), with an
HS256 shared-secret path reachable only on `JWKSNoMatchingKey`, and fails closed when the URL is
absent (`auth.ts:241-247`).

So:

- **If Supabase stays the identity provider**, D1 requires a permanent user/profile mirror
  (`id`, `display_name`, `avatar_seed`, role at minimum) kept in sync from `auth.users`, because
  every atomic RPC references player rows and the leaderboard and stats functions join `profiles`
  for display name and avatar seed. The sync mechanism is a required design item, not an
  afterthought.
- **If identity moves to D1**, the replacement surface is the entire auth stack: the auth store
  (anonymous sign-in, Google OAuth, magic-link OTP, identity linking), the server callback route,
  the `@supabase/ssr` cookie layer, the Worker's JWKS verifier, and every RLS policy.

### C5. RLS is the largest hidden line item

Row-level security is the *entire* browser-side authorization model, and D1 has no analogue.
`supabase/migrations/20241202000006_rls.sql` plus `20241208000003_spectator_rls.sql` and
`20260721000001_public_security_hardening.sql` define `auth.uid()`-based policies across
`profiles`, `player_stats`, `solo_leaderboard`, `gallery_*`, `telemetry_events`, `bug_reports`,
and `feature_flags`, with the newest migration making visibility depend on `profiles.is_public`.

Under D1, every one of those becomes hand-written authorization in Worker code. This is the single
largest cost in any D1 proposal and is not visible in a table-count estimate.

### C6. Roughly 700 lines of Postgres-specific logic would be reimplemented

Five `SECURITY DEFINER` atomic RPCs — `supabase/migrations/20260105000002_rpc_create_game.sql`
through `20260105000006_rpc_aggregate_stats.sql` — use composite-type array parameters,
`SELECT … FOR UPDATE` row locks, `ON CONFLICT` idempotency, and a `jsonb` category-stats merge.
D1 has no stored procedures and no composite types. Add three leaderboard set-returning functions
and the RBAC permission functions that gate the `_debug` routes.

### C7. Capabilities with no D1 or R2 equivalent in the proposal

- **Realtime.** `feature_flags` is added to the `supabase_realtime` publication and subscribed by
  the flags store. There is no D1 equivalent.
- **Storage.** The private `bug-audio` bucket with per-user-folder RLS.
- **Edge function.** `aggregate-game-stats`, invoked from the Durable Object persistence queue for
  Glicko-2 and badges.
- **Scheduled retention.** Two `pg_cron` jobs (30-day telemetry, 90-day analysis). Under D1 these
  become Worker cron triggers.

### C8. The R2 proposal targets a feature that does not exist

`docs/planning/dicee-cloudflare-resource-guidance.md:255-257` specifies a lifecycle rule with
`id = "expire-transcribed-command-audio"` and `conditions = { prefix = "commands/" }` — voice-command
audio.

There is no voice-command feature in this repository. What actually exists:

- **Generated sound effects:** 8 `.ogg` files, 628 KB total, in `packages/web/static/audio`,
  committed and served as Pages static assets. Generation is an operator-only CLI flow that writes
  into the repo.
- **Transcription:** the browser records webm/opus, POSTs base64 to `/api/transcribe`, which
  proxies over the service binding to the Worker, which calls
  `env.AI.run('@cf/openai/whisper-tiny-en', …)` (`packages/cloudflare-do/src/api/transcribe.ts:70`)
  and returns text only. **Nothing is stored.**
- **The one real blob workload:** bug-report voice notes, already in the Supabase `bug-audio`
  bucket.

So R2 as proposed solves a hypothetical and does not cover the workload that exists. If a blob
store is ever wanted, the honest scope is migrating `bug-audio`, which the plan does not propose.

Two design notes for whenever that happens: `PutObject` and `LifecycleStorageTierTransition` are
Class A operations while `DeleteObject` is free, so a short expiry rule is the cheap design; and
short-lived objects must **not** go in Infrequent Access, whose 30-day minimum storage duration
would bill 7-day objects for 30 days at 2× Standard Class A rates.

### C9. Two live defects in the proposed OpenTofu module

Verified against `cloudflare/cloudflare` provider v5.22.0 (still the latest release, published
2026-07-10; the two breaking changes in that version touch only `ai_search_instance` and
`zero_trust_access_ai_controls_mcp_portal` — nothing in the proposed module).

| Defect | Location | Verified against | Consequence |
|---|---|---|---|
| `outputs.tf` uses `v.database_id` | research doc line 278 | v5.22.0 `d1_database/schema.go` — the computed id attributes are `id` and `uuid`; there is no `database_id` | **Fails at `plan` time.** This output feeds `${D1_ID}` in the §9 CI pipeline (line 360), so it blocks the whole chain. |
| `primary_location_hint` commented "changeable without recreation on provider >= 5.8.0" | research doc line 235 | v5.22.0 schema attaches `stringplanmodifier.RequiresReplace()`; the resource documentation states "When a D1 Database is replaced all the data is lost" | **Silent destroy/create** of `dicee-app-production` on a later edit |

A third item is a constraint-semantics error rather than a defect: `~> 5.22` means
`>= 5.22, < 6.0` — the same ceiling as `~> 5`, only a higher floor. Writing `~> 5.22.0` is required
to pin the patch series. And `required_version = ">= 1.9.0"` is too low if R2 remote state is
wanted: native S3-style locking (`use_lockfile`) shipped in OpenTofu 1.10.0, and DynamoDB locking
is categorically impossible against R2. (Current OpenTofu stable is 1.12.0.)

Two further R2-as-state-backend constraints: R2 implements neither `PutBucketVersioning` nor object
tagging, so OpenTofu's recommended state-recovery mechanism is unavailable and the `state_tags` /
`lock_tags` backend arguments are unusable. Locking itself is *mechanically plausible* — OpenTofu
locks via conditional `If-None-Match` PutObject, which R2's S3 compatibility table lists as
implemented — but Cloudflare's own R2 backend page never mentions locking, and this was not tested
end to end.

### C10. Data-quality issues that muddy any sizing estimate

Two findings would make current row counts misleading as evidence:

1. **AI-player games likely persist nothing.** AI player ids are formatted
   `ai:profileId:timestamp` (`packages/shared/src/types/player.ts:110`) and are passed unfiltered
   as `game_player_input.user_id`, which is a `UUID` column with a foreign key to `profiles(id)`
   (`supabase/migrations/20241202000002_games.sql:46`). Any game containing an AI player should
   fail `create_game_atomic`. `aggregate_game_stats` compounds this with a
   `user_id::text NOT LIKE 'ai:%'` predicate on a UUID column, which can never match. **Not
   runtime-verified.**
2. **Generated types drift in both directions.** They still declare `bug_reports` columns that
   `20260721000001_public_security_hardening.sql` drops, and omit `gallery_stats`,
   `gallery_achievements`, and all five `20260105` atomic RPCs. Two divergent generated type files
   exist, only one of which is imported. This suggests the types were generated against a live
   project whose schema differs from the migration history.

Do not size a D1 migration from current row counts until both are resolved.

---

## Decision Drivers

1. **No consumer.** Nothing in the repository reads or writes D1 or R2. Provisioning either today
   creates net-new surface with nothing behind it.
2. **No cost pressure, in either direction.** Both are free at this scale, and the storage-price
   comparison actively disfavours D1.
3. **The authorization rewrite is the real cost.** RLS has no D1 analogue; ~700 lines of plpgsql
   has no D1 analogue.
4. **The identity trigger chain is load-bearing.** Either mirror it or replace the entire auth
   stack.
5. **R2's stated target does not exist**, and the workload that does exist is out of the
   proposal's scope.
6. **IaC needs something to manage.** An OpenTofu module governing zero resources is overhead.
7. **Correctness of the module matters more than its existence.** Two of its snippets would fail
   or destroy data as written.

---

## Options Considered

### Option A — Status quo

Supabase keeps identity, relational history, realtime, storage, and retention. Durable Objects keep
live state. No D1, no R2, no OpenTofu.

**Pros:** zero work; zero new failure modes; the boundary is already clean and one-directional; no
authorization rewrite; no identity mirror.

**Cons:** leaves the target-state research unresolved indefinitely; Supabase remains a second
platform with its own operational surface; the two OpenTofu defects stay latent in a planning
document someone may later copy from.

### Option B — D1 for Durable-Object-written history only; Supabase stays identity provider

Move `games`, `game_players`, `domain_events`, `player_stats` — all written exclusively by the
Worker with the service-role key and never browser-read under RLS.

**Pros:** the migratable set is genuinely clean; no RLS replacement needed for *these* tables,
because nothing browser-side reads them; keeps Realtime, Storage, edge functions, and auth intact.

**Cons:** requires a permanent user/profile mirror in D1 plus a sync mechanism, because every atomic
RPC references player rows and the leaderboard functions join `profiles`; the five `SECURITY
DEFINER` RPCs must be reimplemented in TypeScript without composite types, row locks, or `ON
CONFLICT`; the system now has two sources of truth for game history during and after coexistence;
D1 storage costs 3.75× Durable Object SQLite; still no consumer demanding it.

### Option C — Full migration off Supabase

Identity, relational data, and blobs all move to Cloudflare.

**Pros:** one platform, one credential model, one billing surface; everything becomes
repo-manageable.

**Cons:** replaces the entire auth stack (anonymous sign-in, Google OAuth, magic-link OTP, identity
linking, `@supabase/ssr` cookies, the Worker JWKS verifier); replaces RLS with hand-written Worker
authorization for every browser read; loses Realtime with no equivalent; requires re-homing
`bug-audio`; requires rebuilding `pg_cron` retention as Worker crons; reimplements ~700 lines of
plpgsql. This is a multi-month project for a ten-user test application.

### Option D — Defer with a written trigger, and fix the module defects now

Stay on Supabase. Correct the two OpenTofu defects and the version-constraint error in the planning
document so nobody copies broken snippets. Add `*.tfstate`, `*.tfvars`, `.terraform/` to
`.gitignore` as a prerequisite. Record an explicit adoption trigger.

**Pros:** removes the live hazards at doc-editing cost; preserves every option; makes the deferral
reviewable rather than indefinite; the `.gitignore` change is a prerequisite regardless of outcome.

**Cons:** none identified beyond the work not being done.

### R2 sub-options

| Sub-option | Assessment |
|---|---|
| Adopt as proposed (`commands/` prefix, 7-day expiry) | **Reject.** Targets a feature that does not exist. |
| Retarget at `bug-audio` migration | Plausible but unproposed and unscoped. Would need its own decision, including RLS-equivalent access control for a bucket that currently has per-user-folder policies. |
| Do not create R2 | Default. |

### OpenTofu ownership sub-options (CF-D01)

| Sub-option | Assessment |
|---|---|
| Stand up `infra/` now | Manages zero resources. Rejected unless B or C is accepted. |
| Defer until there is a resource to manage | Default. Fix the defects first so the scaffold is correct when needed. |
| Never — Wrangler owns everything | Viable if D1/R2 are never adopted, since Wrangler already owns bindings, secrets, and (potentially) routes. |

---

## Consequences and Reversibility

**Reversible:**
- Adopting OpenTofu, right up to the first `apply`.
- Creating an empty D1 database or R2 bucket.
- Every documentation correction in Option D.

**Irreversible or effectively so:**
- **Data migration itself.** Once game history is written to D1 and Supabase rows are retired, the
  authorization model, the sync mechanism, and the identity mirror are all load-bearing.
- **Any edit to `primary_location_hint`** on a live D1 database under the current module, per C9 —
  "all the data is lost."
- **Replacing the auth stack** under Option C. Anonymous sessions in particular have no obvious
  migration path.

**Honestly stated:** the ongoing cost of Option B is not the migration — it is maintaining an
identity mirror and a hand-written authorization layer in perpetuity, for a system that currently
gets both for free. That cost should be weighed against a *named* capability D1 provides, and no
such capability has been named.

---

## Open Questions & Evidence Required

### Operator-only (read-only)

`OPS-` identifiers are canonical in
[`../cloudflare/operator-evidence.md`](../cloudflare/operator-evidence.md), and that file is the
sole authority for the numbering. That register is Cloudflare-scoped: it contains **no** entry for
any Supabase question, no D1 or R2 inventory check, and no Durable Object usage reading. Those are
listed here without an id, and no id should be invented for them. Whether the canonical register
should grow to cover them is a question for the register's owner, not for this RFC.

| Id | Question | Method | Blocks |
|---|---|---|---|
| *(no canonical `OPS-` id)* | Row counts per table. Do `games` and `domain_events` hold anything at all? Do AI-containing games persist? | read-only `SELECT count(*)`; check for `persistence.gameStart.failed` / `INVALID_REFERENCE` in Worker logs | Any sizing estimate; confirms or refutes C10.1 |
| *(no canonical `OPS-` id)* | Does the Supabase project issue asymmetric (ES256/RS256) or legacy HS256 JWTs? | Supabase JWT signing keys, or `GET /auth/v1/.well-known/jwks.json` | Whether `SUPABASE_JWT_SECRET` is load-bearing or dead weight. Also open in [ADR-005](./adr-005-durable-object-lifecycle.md) §C7, where it decides the `secrets.required` contents (CF-D12). |
| *(no canonical `OPS-` id)* | Are the `bug-audio` bucket, the `supabase_realtime` publication entry for `feature_flags`, the two `pg_cron` jobs, and the `aggregate-game-stats` edge function actually provisioned? Are anonymous sign-in and Google OAuth enabled live? | Supabase dashboard | C7. Note `persistence-queue.ts:261` silently returns `{success: true}` when the URL or anon key is empty, so a misconfiguration here is **invisible in logs**. |
| *(no canonical `OPS-` id)* | Do any D1 databases or R2 buckets already exist on the account? | Account resource lists | Baseline |
| *(no canonical `OPS-` id)* | Actual Durable Object SQL stored data and rows written per month, and whether SQLite storage billing is actually being charged on this account | The account's own Durable Objects usage and billing view | Storage hygiene, and the enablement caveat in C3. Not answerable from documentation — see C3. |
| **OPS-15** | Which Workers plan and usage model is the account on? | Dashboard, account-level settings | Nothing here directly; the runbook records it as the prerequisite for any later billing question, including the one above |

### Requires a decision, not a lookup

- **Name a query.** What does Dicee need to ask of its data that Supabase cannot answer? Without
  one, Option B has no justification beyond consolidation.
- **Does the migration set include anything browser-read?** If yes, the RLS replacement scope grows
  from "none" to "everything", and Option B converges on Option C.
- **Is `pg_cron` available on the project's current Supabase plan?** The migration itself notes it
  is a Pro-tier feature.

### Prerequisites regardless of outcome

- Add `*.tfstate`, `*.tfvars`, `.terraform/` to `.gitignore` (research doc checklist line 499).
- Correct the two module defects and the `~> 5.22` constraint semantics in the planning document.
- Resolve the generated-type drift in C10.2 before trusting any schema-derived estimate.

---

## Decision

**Not yet made.**

The recorded leaning from the 2026-07-22 synthesis is:

- **Reject R2 as proposed** — it targets a feature that does not exist and does not cover the one
  real blob workload.
- **Defer D1** (Option D) with an explicit trigger: a stated query workload Supabase cannot serve,
  or a decision to retire Supabase for reasons other than cost.
- **Defer OpenTofu** until there is a resource to manage, while fixing the module defects now.

That leaning is not an acceptance and carries no authority.

Until this RFC is accepted, treat the following as prohibited: creating a D1 database or an R2
bucket; adding `d1_databases` or `r2_buckets` bindings to either wrangler config; running `tofu` or
`terraform` `plan` or `apply` against the research document's snippets; and granting the CI token
`D1 Edit` or `Workers R2 Storage Edit` scopes.

---

## Decision Record

| Date | Author | Decision |
|------|--------|----------|
| 2026-07-22 | Cloudflare workstream | RFC drafted as a stub. No decision. Operator evidence outstanding: OPS-15, plus five questions with no canonical `OPS-` id (Supabase row counts, Supabase JWT algorithm, Supabase provisioning, D1/R2 account inventory, Durable Object storage usage and billing). |

**Status:** Draft — not accepted. Nothing in this document authorises a resource creation, a
migration, a remote database write, or any provider mutation.

---

## Questions for Review

1. What specific query or capability would justify D1? If none can be named, is Option D the
   answer by default?
2. Is consolidating onto one platform a goal in its own right, independent of any technical need?
3. If a blob store is wanted, should the scope be migrating `bug-audio` rather than the proposed
   `commands/` prefix — and does the per-user-folder RLS on that bucket have an acceptable R2
   equivalent?
4. Should the two OpenTofu defects be corrected in the planning document now, even though no
   module exists, so a future author does not copy them?
5. Does the AI-player UUID defect in C10.1 need fixing before any data-volume claim is made?
6. Is anyone prepared to own a hand-written authorization layer replacing RLS, in perpetuity?
