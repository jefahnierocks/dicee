# Dicee status

**As of:** 2026-09-14T18:58:21Z

**Current phase:** 2026-09 operator safety rollout; GitHub transfer complete, action 10 governance next, then the first release that ships stats correctness and the dicee-web cutover (no deployment yet)

Next work: [roadmap.md](roadmap.md). Cloudflare: [cloudflare.md](cloudflare.md).
## Current state

- `main` carries the reviewed baseline, the database privacy work, current dependency updates (Vitest 5, jsdom 30), the `dicee-web` Worker, the protocol handshake and the stats fix (action 7); none of it is deployed.
- Migration `20260913000001` is applied to the hosted project and recorded in migration history. Authenticated clients cannot update `profiles.role`; their editable profile fields remain granted. Migration `20260913000002` remains local-only.
- The profile-role audit (action 2) is complete: 7 profiles comprise 5 users and 2 super admins, with no moderators or admins. The operator confirmed both elevated assignments as intentional after private record review; no role changes were needed. Audit-log absence cannot establish that the old privilege was never exploited.
- The database backup is encrypted and verified on off-machine storage; Storage contained 0 objects. The plaintext exports were removed after verification.
- `workers.dev` and Preview URLs are disabled on `dicee` and `dicee-production`; `gamelobby-production` still exposes both. Namespace and binding discovery is complete; zone-level DNS and Worker-route reads remain unavailable to the scoped Cloudflare token and must be rechecked before deletion.
- The GitHub repository is now `jefahnierocks/dicee` and the checkout is `~/Organizations/jefahnierocks/dicee`; the existing shared Cloudflare account and steward remain unchanged. Infrastructure adoption and any provider-account relocation remain separate future work.
- Credential containment (action 9) is complete: both exposed tokens (Cloudflare and Supabase) return HTTP 401 and their replacements authenticate (see readbacks). The Supabase CLI credential is a project-scoped token with only Database read-write access that expires 7 days after its 2026-09-14 creation; renew it before later operator steps need it.
- No application deployment has run during this operator rollout. CI deploys only on a manual `workflow_dispatch` from `main` with `deploy=true`.
- Legacy client layers are retired and the docs are consolidated into this file, the roadmap, `docs/cloudflare.md`, `docs/architecture/` and `docs/development/`. Git history is the archive.

## Decisions

1. **Durable Objects.** Keep the legacy `migrations` v1 (`GameRoom`) and v2 (`GlobalLobby`) with `new_sqlite_classes`. Adopt declarative `exports` only for a concrete need, as a standalone operator deploy. `dicee` is the one game backend. Live readback confirms Pages production binds `GAME_WORKER` to `dicee`, whose SQLite `GameRoom` and `GlobalLobby` namespaces are at migration tag v2, matching source; no no-op lifecycle deploy or cutover is required. Legacy namespace pairs on other scripts are cleanup candidates, not the production owner.
2. **MCP.** `akg` (stdio) and unauthenticated `cloudflare-docs` are enabled. `cloudflare-api` and read-only Supabase are opt-in OAuth servers. No bearer-token wrappers or credential bridges.
3. **Secrets.** Infisical is retired. CI reads GitHub Environment secrets; local operator commands resolve 1Password secrets per command.
4. **Database.** `20260913000001` was applied alone. `20260913000002` applies only after a production deploy that includes the profile visibility opt-in control (actions 3-4).
5. **Wrangler.** Stay on the miniflare 4 line: wrangler 4.113.0 with `compatibility_date` 2026-07-21. Dependabot cites this decision number.
6. **Homes.** This file is the status of record; [roadmap.md](roadmap.md) is the only sequence of work; git history is the archive.
7. **Data platform.** Stay on Supabase (Auth and Postgres), hardened and minimized.
8. **Cloudflare platform.** A `dicee-web` Worker on Workers Static Assets plus the `dicee` game Worker with SQLite Durable Objects, over one service binding. Pages still serves `dicee.games` until the first release moves it, then the Pages project is deleted. No hosted preview backed by production. No D1, R2 or combined web-and-game Worker without a concrete need.
9. **Jefahnierocks Cloudflare strategy.** Jefahnierocks now owns the GitHub repository; the existing shared Cloudflare account and steward remain retained during infrastructure alignment. OpenTofu will manage explicitly assigned infrastructure fields in an accepted Jefahnierocks root; Wrangler keeps application releases, bindings and Durable Object lifecycle. Separate inventory/plan, infrastructure-apply, application-release and local-operator credentials, with effective reach verified. Preserve names/state; Pages field overlap must pass import/release/plan checks. Intake, exact infrastructure placement and any later account relocation still need acceptance/evidence. Ownership changes follow the credential prerequisites in [roadmap section 7](roadmap.md#7-organization-move-with-governance-and-iac); [Cloudflare strategy](cloudflare.md#governance-strategy) owns the design details.
10. **Agent surface.** `AGENTS.md` plus package `AGENTS.md` files; portable skills in .agents/skills (symlinked for Claude); Codex policy in `.codex/rules`. Windsurf and Cascade, CODEX.md, GEMINI.md, Cursor rule files and the Copilot MCP files are retired.

## Open operator actions

These are stable action identifiers, not execution order. [Roadmap section 1](roadmap.md#1-safety-now) owns the sequence; action 10 (GitHub governance) is the next unfinished operator step. Mark an action done only with a first-hand readback in [Latest live readbacks](#latest-live-readbacks). Existing authorization remains scoped to the requested operation and its stop points.

1. [x] **Backup.** The operator confirmed the Free plan. Five SQL dumps and the Storage inventory were verified in an AES-256 image on off-machine storage; Storage contained 0 objects. Plaintext exports were removed only after the copied image passed verification.
2. [x] **Profile-role audit.** Migration `20260913000001` is applied and recorded; do not reapply it. Role counts and both elevated records were retrieved privately. The operator confirmed both super-admin assignments as intentional; 0 unresolved accounts and 0 corrections.
3. [ ] **First production release.** After actions 5 and 10, release the exact validated commit from a clean checkout at a quiet time: read back completed game and `player_stats` counts (the stats rebuild resets stats no completed game backs), apply `20260914000001` and `20260914000002` (game read policies) alone, deploy `dicee-web`, move `dicee.games` off Pages, deploy `dicee` (its protocol gate closes the old Pages client's sockets), run the [post-deploy smoke checks](cloudflare.md#deploy-path), then delete the deployed Edge Function and rebuild all stats once.
4. [ ] **Apply `20260913000002`** only after the missing profile visibility opt-in control is implemented, tested, merged and verified in production. Current source omits the four bug-report fields this migration drops, but deployed compatibility is unverified. Take a fresh complete encrypted backup, recheck the production link and migration history, and apply only this migration. It resets all profiles to private; verify the schema and two-account privacy behavior before inviting opt-ins. Do not improvise a reverse migration; fix forward with the compatible opt-in build.
5. [x] **Worker namespace and binding check.** Live readback found SQLite `GameRoom` and `GlobalLobby` namespace pairs on `dicee`, `dicee-production` and `gamelobby-production`; the namespace-owning scripts are at migration tag v2. Pages production binds `GAME_WORKER` to `dicee` and preview has no service binding. Source `dicee` declares the same v1/v2 lifecycle, so no no-op lifecycle deploy or cutover is required.
6. [x] **Worker subdomain URLs.** `workers.dev` and Preview URLs are disabled on `dicee` and `dicee-production`, verified by API. Namespace ownership and other ingress remain for the later reviews in actions 5 and 8.
7. [ ] **Stats aggregation.** Fixed in source: `20260914000001` makes `player_stats` a rebuildable projection and stores AI seats, and the Worker now sends JSON arrays (its old array literals were rejected, so the deployed Worker has likely never persisted a game). Complete with action 3: delete the deployed `aggregate-game-stats` Edge Function, then rebuild all stats once.
8. [ ] **Delete obsolete surfaces.** `dicee-production`, `gamelobby` and `gamelobby-production` are legacy cleanup candidates; no deployed Worker service binding consumes them. `gamelobby-production` still exposes `workers.dev` and Preview URLs, and zone-level Worker routes/DNS remain unverified because the scoped token receives HTTP 403. Recheck those surfaces immediately before deletion. Delete Pages `dicee` only after the `dicee-web` cutover; live Durable Object state on legacy scripts is not preserved.
9. [x] **Credential containment.** Both exposed tokens are replaced, revoked and verified dead by direct HTTP 401 readbacks. Cloudflare: the replacement is canonical in 1Password and GitHub Production, and the repository duplicate is removed. Supabase: a project-scoped token with only Database read-write access is the sole CLI credential; temporary copies, the environment override, the fallback token file and plaintext copies are absent.
10. [ ] **GitHub governance.** A `main` ruleset requiring the check **Full repository validation** (the job display name, not `validate`); a `Production` environment with required reviewers and a main-only deployment branch policy; Dependabot alerts and security updates.
11. [ ] **Supabase default grants change on 2026-10-30** for newly created tables; existing tables keep their grants. Apply the explicit-grants migration from the roadmap first ([change notice](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)).
12. [ ] Migrate off the legacy `anon` and `service_role` API keys before the announced end-of-2026 deprecation. Verify the final schedule before cutover ([migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)).
13. [ ] Revoke unused Infisical machine identities and any leftover Vercel or PartyKit credentials.
14. [ ] Update the meta-inventory registry so `status_of_record` is `docs/status.md`.

## Latest live readbacks

One row per subject, replaced when superseded. Counts and names only; never secret values or account identifiers.

### Database hardening (actions 1-2)

Recorded results; do not rerun the database checks. The operator confirmed that the verified NAS copy satisfies the off-site requirement.

| Subject | UTC | Request | Result |
|---|---|---|---|
| Supabase plan tier | 2026-09-13 | Operator plan-tier confirmation | Free |
| Backup moved off-site | 2026-09-13T20:32:35Z | Mounted-image and checksum verification | Yes; verified encrypted NAS copy |
| Storage object count | 2026-09-13T20:32:35Z | Storage inventory | 0 |
| 000001 applied | 2026-09-13T20:46:01Z | CLI: migration history after successful SQL and repair | Yes; `20260913000001` applied |
| 000002 applied | 2026-09-13T20:46:01Z | CLI: migration history | No; `20260913000002` not applied |
| Privilege check results | 2026-09-13T21:03:57Z | CLI: privilege and migration-object queries | Table / role / display_name UPDATE: anon false / false / false; authenticated false / false / true; service_role true / true / true, unchanged; 2 required noninternal triggers; 1 owner insert policy |
| Role counts | 2026-09-13T21:39:34Z | CLI: grouped profile-role counts | user 5; moderator 0; admin 0; super_admin 2 |
| Unexpected elevated roles revoked | 2026-09-13T21:41:56Z | Operator review of both captured elevated records | 0 |

### Other readbacks

| Subject | UTC | Request | Result |
|---|---|---|---|
| Worker inventory | 2026-09-14T18:58:21Z | API: scripts, Durable Object namespaces, Worker metadata and Pages bindings | 11 scripts; Pages production binds `GAME_WORKER` to `dicee`; `dicee`, `dicee-production` and `gamelobby-production` hold SQLite `GameRoom`/`GlobalLobby` namespace pairs at v2; source `dicee` matches v1/v2, so no lifecycle deploy or cutover is required |
| Worker subdomain URLs | 2026-09-14T18:58:21Z | API: subdomains, custom domains, cron and service-binding consumers | `dicee`, `dicee-production` and `gamelobby` have direct Worker URLs disabled; `gamelobby-production` has workers.dev and Preview URLs enabled; no custom domains, cron or Worker service-binding consumers were found; zone DNS/routes remain unresolved under the scoped token |
| GitHub governance | 2026-09-14T18:58:21Z | Transfer plus REST readback after move | Repository is `jefahnierocks/dicee`; local origin/home updated; Actions secrets and Production environment survived; 0 repository/organization/effective-main rules, Production still unprotected; action 10 remains next |
| Credential containment | 2026-09-14T06:25:02Z | Cloudflare (04:41:28Z): private token verification, wrapper auth, GitHub secret-name readback. Supabase: dashboard last-used match, Management API call with the preserved old token, CLI `SELECT 1` with the replacement, local-copy inventory | Cloudflare: replacement canonical in 1Password; Production `CLOUDFLARE_API_TOKEN` present; repository duplicate absent; old token HTTP 401. Supabase: old token HTTP 401, other account tokens unchanged; project-scoped Database read-write replacement authenticates; environment override, fallback file, temporary Keychain copies and plaintext copies absent. No deployment or database mutation |
| Cloudflare Pages and build triggers | 2026-09-13T04:35Z | API: Pages project `dicee`, Workers Builds triggers | Pages has no Git source, production branch `main`; trigger reads returned 403, so triggers are unverified |
| GitHub Apps | 2026-09-13T04:49Z | Repository installed GitHub Apps page | No Cloudflare Workers and Pages app; with no Pages Git source, the native Git build integration is not in use |
