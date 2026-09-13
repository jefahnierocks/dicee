# Dicee status

**As of:** 2026-09-13T22:18:29Z

**Current phase:** 2026-09 operator safety rollout; Phases 9-10 complete (no deployment)

Next work: [roadmap.md](roadmap.md). Cloudflare: [cloudflare.md](cloudflare.md).

## Current state

- `main` carries the reviewed baseline, the database privacy work and current dependency updates (Vitest 5, jsdom 30).
- Migration `20260913000001` is applied to the hosted project and recorded in migration history. Authenticated clients cannot update `profiles.role`; their editable profile fields remain granted. Migration `20260913000002` remains local-only.
- Phase 8 is complete: 7 profiles comprise 5 users and 2 super admins, with no moderators or admins. The operator confirmed both elevated assignments as intentional after private record review; no role changes were needed. Audit-log absence cannot establish that the old privilege was never exploited.
- The database backup is encrypted and verified on off-machine storage; Storage contained 0 objects. The plaintext exports were removed after verification.
- `workers.dev` and Preview URLs are disabled on `dicee` and `dicee-production`. Changes were limited to these two scripts; namespace ownership and other ingress remain unverified.
- No application deployment has run during this operator rollout. CI deploys only on a manual `workflow_dispatch` from `main` with `deploy=true`.
- Legacy client layers are retired and the docs are consolidated into this file, the roadmap, `docs/cloudflare.md`, `docs/architecture/` and `docs/development/`. Git history is the archive.

## Decisions

1. **Durable Objects.** Keep the legacy `migrations` v1 (`GameRoom`) and v2 (`GlobalLobby`) with `new_sqlite_classes`. Adopt declarative `exports` only for a concrete need, as a standalone operator deploy. The first Worker deploy waits for the namespace-ownership check (action 5): if another script owns the namespaces, a deploy to `dicee` creates empty namespaces and live state stays on the old script, so stop.
2. **MCP.** `akg` (stdio) and unauthenticated `cloudflare-docs` are enabled. `cloudflare-api` and read-only Supabase are opt-in OAuth servers. No bearer-token wrappers or credential bridges.
3. **Secrets.** Infisical is retired. CI reads GitHub Environment secrets; local operator commands resolve 1Password secrets per command.
4. **Database.** `20260913000001` was applied alone. `20260913000002` applies only after a Pages deploy that includes the profile visibility opt-in control (actions 3-4).
5. **Wrangler.** Stay on the miniflare 4 line: wrangler 4.113.0 with `compatibility_date` 2026-07-21. Dependabot cites this decision number.
6. **Homes.** This file is the status of record; [roadmap.md](roadmap.md) is the only sequence of work; git history is the archive.
7. **Data platform.** Stay on Supabase (Auth and Postgres), hardened and minimized.
8. **Cloudflare platform.** Pages plus the `dicee` Worker with SQLite Durable Objects. No D1, R2, Worker split or Workers Static Assets without a concrete need.
9. **Organization move.** The GitHub organization move with Cloudflare governance and infrastructure as code is a near-term roadmap item. Nothing moves before the credential work it depends on.
10. **Agent surface.** `AGENTS.md` plus package `AGENTS.md` files; portable skills in .agents/skills (symlinked for Claude); Codex policy in `.codex/rules`. Windsurf and Cascade, CODEX.md, GEMINI.md, Cursor rule files and the Copilot MCP files are retired.

## Open operator actions

These need operator authority and live access, in this order. Mark one done only with a first-hand readback in [Latest live readbacks](#latest-live-readbacks).

1. [x] **Backup.** The operator confirmed the Free plan. Five SQL dumps and the Storage inventory were verified in an AES-256 image on off-machine storage; Storage contained 0 objects. Plaintext exports were removed only after the copied image passed verification.
2. [x] **Profile-role audit.** Migration `20260913000001` is applied and recorded; do not reapply it. Role counts and both elevated records were retrieved privately. The operator confirmed both super-admin assignments as intentional; 0 unresolved accounts and 0 corrections.
3. [ ] **Deploy Pages from `main`.** CI `deploy-pages` needs `deploy-worker`. Use CI only if action 5's readback shows the `dicee` script holds both the `GameRoom` and `GlobalLobby` namespaces at migration tag v2; otherwise use the operator-local `pnpm pages:deploy` and deploy no Worker. `pnpm pages:deploy` inlines the Supabase public values from the local build environment; read the warning in [cloudflare.md](cloudflare.md#deploy-path) first. Then run the post-deploy smoke checks there.
4. [ ] **Apply `20260913000002`** only after a Pages deploy that includes the profile visibility opt-in control. It makes every existing profile private, so players disappear from leaderboards and stats until they opt in; the web app has no opt-in control yet. It also drops the `bug_reports` columns `user_email`, `user_display_name`, `user_context` and `console_capture`, which the previous web build still writes; applied earlier, bug-report submission fails.
5. [ ] **Worker namespace check.** Before any Worker deploy, read back which Worker script holds the live `GameRoom` and `GlobalLobby` namespaces, their migration tag where a read-only source exists, and what the Pages `GAME_WORKER` binding targets ([method](cloudflare.md#live-checks-still-needed)).
6. [x] **Worker subdomain URLs.** `workers.dev` and Preview URLs are disabled on `dicee` and `dicee-production`, verified by API. Namespace ownership and other ingress remain for the later reviews in actions 5 and 8.
7. [ ] Undeploy the `aggregate-game-stats` Edge Function. The Worker treats the resulting 404 as non-retriable, so no retry loop follows.
8. [ ] Review legacy Worker scripts.
9. [ ] Rotate or revoke the Cloudflare API token and the Supabase personal access token that the retired bearer MCP wrappers used.
10. [ ] **GitHub governance.** A `main` ruleset requiring the check **Full repository validation** (the job display name, not `validate`); a `Production` environment with required reviewers and a main-only deployment branch policy; Dependabot alerts and security updates.
11. [ ] **Supabase default grants change on 2026-10-30** for newly created tables; existing tables keep their grants. Apply the explicit-grants migration from the roadmap first ([change notice](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)).
12. [ ] Migrate off the legacy `anon` and `service_role` API keys before the announced end-of-2026 deprecation. Verify the final schedule before cutover ([migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)).
13. [ ] Revoke unused Infisical machine identities and any leftover Vercel or PartyKit credentials.
14. [ ] Update the meta-inventory registry so `status_of_record` is `docs/status.md`.

## Latest live readbacks

One row per subject, replaced when superseded. Counts and names only; never secret values or account identifiers.

### Step 1 result

These are the recorded Step 1 results; Phase 9 does not rerun the database checks. The operator confirmed that the verified NAS copy satisfies the off-site requirement.

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
| Worker inventory | 2026-09-13T22:10:20Z | API: account Worker scripts | 11 scripts; the operator scoped Phase 10 to `dicee` and `dicee-production`, both at migration tag v2 |
| Worker subdomain URLs | 2026-09-13T22:18:29Z | API: per-script subdomain settings after scoped POST updates | `dicee` and `dicee-production`: success true, enabled false, previews_enabled false; no deployment or deletion |
| GitHub governance | 2026-09-13T04:32Z | REST: repository rulesets, `main` branch protection, environments | 0 rulesets; `main` unprotected (404); `Production` has no required reviewers or branch policy |
| Cloudflare Pages and build triggers | 2026-09-13T04:35Z | API: Pages project `dicee`, Workers Builds triggers | Pages has no Git source, production branch `main`; trigger reads returned 403, so triggers are unverified |
| GitHub Apps | 2026-09-13T04:49Z | Repository installed GitHub Apps page | No Cloudflare Workers and Pages app; with no Pages Git source, the native Git build integration is not in use |
