# Dicee status

**As of:** 2026-09-14T04:41:28Z

**Current phase:** 2026-09 operator safety rollout; credential containment (action 9) pending, Jefahnierocks governance strategy selected (no deployment)

Next work: [roadmap.md](roadmap.md). Cloudflare: [cloudflare.md](cloudflare.md).
## Current state

- `main` carries the reviewed baseline, the database privacy work and current dependency updates (Vitest 5, jsdom 30).
- Migration `20260913000001` is applied to the hosted project and recorded in migration history. Authenticated clients cannot update `profiles.role`; their editable profile fields remain granted. Migration `20260913000002` remains local-only.
- The profile-role audit (action 2) is complete: 7 profiles comprise 5 users and 2 super admins, with no moderators or admins. The operator confirmed both elevated assignments as intentional after private record review; no role changes were needed. Audit-log absence cannot establish that the old privilege was never exploited.
- The database backup is encrypted and verified on off-machine storage; Storage contained 0 objects. The plaintext exports were removed after verification.
- `workers.dev` and Preview URLs are disabled on `dicee` and `dicee-production`. Changes were limited to these two scripts; namespace ownership and other ingress remain unverified.
- The selected Cloudflare strategy targets Jefahnierocks service governance while retaining the existing shared account; organizational intake, infrastructure adoption and account relocation are not complete.
- Credential containment (action 9) is incomplete: the Cloudflare token is replaced and the old one verified dead (see readbacks), but Supabase personal access token replacement and old-token revocation remain open. A successful Supabase CLI login does not establish revocation of the exposed Supabase token.
- No application deployment has run during this operator rollout. CI deploys only on a manual `workflow_dispatch` from `main` with `deploy=true`.
- Legacy client layers are retired and the docs are consolidated into this file, the roadmap, `docs/cloudflare.md`, `docs/architecture/` and `docs/development/`. Git history is the archive.

## Decisions

1. **Durable Objects.** Keep the legacy `migrations` v1 (`GameRoom`) and v2 (`GlobalLobby`) with `new_sqlite_classes`. Adopt declarative `exports` only for a concrete need, as a standalone operator deploy. Worker deploys wait for the namespace-ownership check (action 5): both classes must belong to `dicee`, use SQLite, and have the expected v2 lifecycle state without competing ownership. Pages must target the verified backend. A new script can create empty namespaces while live state stays elsewhere; neither a migration tag nor a dry run alone establishes safe deployment.
2. **MCP.** `akg` (stdio) and unauthenticated `cloudflare-docs` are enabled. `cloudflare-api` and read-only Supabase are opt-in OAuth servers. No bearer-token wrappers or credential bridges.
3. **Secrets.** Infisical is retired. CI reads GitHub Environment secrets; local operator commands resolve 1Password secrets per command.
4. **Database.** `20260913000001` was applied alone. `20260913000002` applies only after a Pages deploy that includes the profile visibility opt-in control (actions 3-4).
5. **Wrangler.** Stay on the miniflare 4 line: wrangler 4.113.0 with `compatibility_date` 2026-07-21. Dependabot cites this decision number.
6. **Homes.** This file is the status of record; [roadmap.md](roadmap.md) is the only sequence of work; git history is the archive.
7. **Data platform.** Stay on Supabase (Auth and Postgres), hardened and minimized.
8. **Cloudflare platform.** Pages plus the `dicee` Worker with SQLite Durable Objects. No D1, R2, Worker split or Workers Static Assets without a concrete need.
9. **Jefahnierocks Cloudflare strategy.** Select Jefahnierocks as the intended Dicee service owner, with the existing shared account and steward retained during alignment. OpenTofu will manage explicitly assigned infrastructure fields in an accepted Jefahnierocks root; Wrangler keeps application releases, bindings and Durable Object lifecycle. Separate inventory/plan, infrastructure-apply, application-release and local-operator credentials, with effective reach verified. Preserve names/state; Pages field overlap must pass import/release/plan checks. Intake, exact infrastructure placement and any later account relocation still need acceptance/evidence. Ownership changes follow the credential prerequisites in [roadmap section 7](roadmap.md#7-organization-move-with-governance-and-iac); [Cloudflare strategy](cloudflare.md#governance-strategy) owns the design details.
10. **Agent surface.** `AGENTS.md` plus package `AGENTS.md` files; portable skills in .agents/skills (symlinked for Claude); Codex policy in `.codex/rules`. Windsurf and Cascade, CODEX.md, GEMINI.md, Cursor rule files and the Copilot MCP files are retired.

## Open operator actions

These are stable action identifiers, not execution order. [Roadmap section 1](roadmap.md#1-safety-now) owns the sequence; credential containment (action 9) is the next unfinished operator step. Mark an action done only with a first-hand readback in [Latest live readbacks](#latest-live-readbacks). Existing authorization remains scoped to the requested operation and its stop points.

1. [x] **Backup.** The operator confirmed the Free plan. Five SQL dumps and the Storage inventory were verified in an AES-256 image on off-machine storage; Storage contained 0 objects. Plaintext exports were removed only after the copied image passed verification.
2. [x] **Profile-role audit.** Migration `20260913000001` is applied and recorded; do not reapply it. Role counts and both elevated records were retrieved privately. The operator confirmed both super-admin assignments as intentional; 0 unresolved accounts and 0 corrections.
3. [ ] **Deploy Pages from `main`.** Complete credential containment, namespace/binding discovery and GitHub protections first. CI `deploy-pages` needs `deploy-worker`, so use CI only when action 5 establishes the Worker prerequisites. A Pages-only release through `pnpm pages:deploy` also requires the committed `GAME_WORKER` target to agree with the verified live backend; it is not an automatic fallback for an unknown or different target. Use a clean checkout of the exact validated commit and the intended public Supabase build values, then run the [post-deploy smoke checks](cloudflare.md#deploy-path).
4. [ ] **Apply `20260913000002`** only after the missing profile visibility opt-in control is implemented, tested, merged and verified in a Pages deployment. Current source omits the four bug-report fields this migration drops, but deployed compatibility is unverified. Take a fresh complete encrypted backup, recheck the production link and migration history, and apply only this migration. It resets all profiles to private; verify the schema and two-account privacy behavior before inviting opt-ins. Do not improvise a reverse migration or roll Pages back before the compatible opt-in build.
5. [ ] **Worker namespace and Pages binding check.** Before choosing a deployment path, read back which scripts hold `GameRoom` and `GlobalLobby`, whether both use SQLite, migration tags, and the production/preview `GAME_WORKER` targets. Resolve competing or ambiguous ownership; reconcile the release configuration with the verified backend before deploying either package ([method](cloudflare.md#live-checks-still-needed)).
6. [x] **Worker subdomain URLs.** `workers.dev` and Preview URLs are disabled on `dicee` and `dicee-production`, verified by API. Namespace ownership and other ingress remain for the later reviews in actions 5 and 8.
7. [ ] **Retire `aggregate-game-stats` deliberately.** Review the caller and the loss of advanced rating/badge processing before undeploying the Edge Function. A 404 is non-retriable, but the current Worker still schedules new calls and records permanent task failures; deletion alone does not retire the caller.
8. [ ] Review legacy Worker scripts.
9. [ ] **Credential containment.** Cloudflare containment is complete: the replacement is active and canonical in 1Password and GitHub Production, the repository duplicate is removed, and the old token is revoked and verified dead. Replace and revoke the exposed Supabase personal access token, verify CLI authentication after revocation, and remove stale plaintext/local copies. A renewed CLI login is insufficient. An execution-policy rejection is a stop, never a reason to disguise the command or change access policy during the operation.
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
| Worker inventory | 2026-09-13T22:10:20Z | API: account Worker scripts | 11 scripts; the operator scoped the URL change (action 6) to `dicee` and `dicee-production`, both at migration tag v2 |
| Worker subdomain URLs | 2026-09-13T22:18:29Z | API: per-script subdomain settings after scoped POST updates | `dicee` and `dicee-production`: success true, enabled false, previews_enabled false; no deployment or deletion |
| GitHub governance | 2026-09-13T23:48:31Z | REST: rulesets, effective `main` rules, Production environment, automated fixes | 0 rulesets and effective rules; Production has no protection rules or branch policy; automated fixes disabled, not paused |
| Cloudflare credential containment | 2026-09-14T04:41:28Z | Private token verification, wrapper auth, GitHub secret-name readback and old-token verification | Replacement active and canonical in 1Password; Production `CLOUDFLARE_API_TOKEN` present; repository duplicate absent; old token revoked and verify returned HTTP 401; wrapper auth passed; no deployment |
| Cloudflare Pages and build triggers | 2026-09-13T04:35Z | API: Pages project `dicee`, Workers Builds triggers | Pages has no Git source, production branch `main`; trigger reads returned 403, so triggers are unverified |
| GitHub Apps | 2026-09-13T04:49Z | Repository installed GitHub Apps page | No Cloudflare Workers and Pages app; with no Pages Git source, the native Git build integration is not in use |
