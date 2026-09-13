# Dicee status

**As of:** 2026-09-13

**Current phase:** 2026-09 docs streamline; operator safety rollout open (no deployment)

Next work: [roadmap.md](roadmap.md). Cloudflare: [cloudflare.md](cloudflare.md).

## Current state

- `main` carries the reviewed baseline, the database privacy work and current dependency updates (Vitest 5, jsdom 30).
- Migrations `20260913000001` and `20260913000002` and their pgTAP tests exist only as files; neither has run against the hosted project.
- No deployment or hosted migration is recorded. CI deploys only on a manual `workflow_dispatch` from `main` with `deploy=true`.
- Legacy client layers are retired and the docs are consolidated into this file, the roadmap, `docs/cloudflare.md`, `docs/architecture/` and `docs/development/`. Git history is the archive.

## Decisions

1. **Durable Objects.** Keep the legacy `migrations` v1 (`GameRoom`) and v2 (`GlobalLobby`) with `new_sqlite_classes`. Adopt declarative `exports` only for a concrete need, as a standalone operator deploy. The first Worker deploy waits for the namespace-ownership check (action 5): if another script owns the namespaces, a deploy to `dicee` creates empty namespaces and live state stays on the old script, so stop.
2. **MCP.** `akg` (stdio) and unauthenticated `cloudflare-docs` are enabled. `cloudflare-api` and read-only Supabase are opt-in OAuth servers. No bearer-token wrappers or credential bridges.
3. **Secrets.** Infisical is retired. CI reads GitHub Environment secrets; local operator commands resolve 1Password secrets per command.
4. **Database.** `20260913000001` applies alone first; `20260913000002` applies only after a Pages deploy that includes the profile visibility opt-in control (actions 2-4).
5. **Wrangler.** Stay on the miniflare 4 line: wrangler 4.113.0 with `compatibility_date` 2026-07-21. Dependabot cites this decision number.
6. **Homes.** This file is the status of record; [roadmap.md](roadmap.md) is the only sequence of work; git history is the archive.
7. **Data platform.** Stay on Supabase (Auth and Postgres), hardened and minimized.
8. **Cloudflare platform.** Pages plus the `dicee` Worker with SQLite Durable Objects. No D1, R2, Worker split or Workers Static Assets without a concrete need.
9. **Organization move.** The GitHub organization move with Cloudflare governance and infrastructure as code is a near-term roadmap item. Nothing moves before the credential work it depends on.
10. **Agent surface.** `AGENTS.md` plus package `AGENTS.md` files; portable skills in .agents/skills (symlinked for Claude); Codex policy in `.codex/rules`. Windsurf and Cascade, CODEX.md, GEMINI.md, Cursor rule files and the Copilot MCP files are retired.

## Open operator actions

These need operator authority and live access, in this order. Mark one done only with a first-hand readback in [Latest live readbacks](#latest-live-readbacks).

1. [ ] **Backup.** Read back the Supabase plan tier, then take an off-site `supabase db dump` and a Storage export. Free projects have no platform backups, and the dump is the only record of prior profile visibility.
2. [ ] **Apply only `20260913000001`.** `supabase db push` applies every pending file, so push from a tree that does not contain `20260913000002`, or run `000001` in the SQL editor and record it with `supabase migration repair --status applied 20260913000001`. Record admin role counts only and revoke any unexpected elevation.
3. [ ] **Deploy Pages from `main`.** CI `deploy-pages` needs `deploy-worker`. Use CI only if action 5's readback shows the `dicee` script holds both the `GameRoom` and `GlobalLobby` namespaces at migration tag v2; otherwise use the operator-local `pnpm pages:deploy` and deploy no Worker. `pnpm pages:deploy` inlines the Supabase public values from the local build environment; read the warning in [cloudflare.md](cloudflare.md#deploy-path) first. Then run the post-deploy smoke checks there.
4. [ ] **Apply `20260913000002`** only after a Pages deploy that includes the profile visibility opt-in control. It makes every existing profile private, so players disappear from leaderboards and stats until they opt in; the web app has no opt-in control yet. It also drops the `bug_reports` columns `user_email`, `user_display_name`, `user_context` and `console_capture`, which the previous web build still writes; applied earlier, bug-report submission fails.
5. [ ] **Worker namespace check.** Before any Worker deploy, read back which Worker script holds the live `GameRoom` and `GlobalLobby` namespaces, their migration tag where a read-only source exists, and what the Pages `GAME_WORKER` binding targets ([method](cloudflare.md#live-checks-still-needed)).
6. [ ] Confirm Worker ingress settings on every Dicee script.
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

| Subject | UTC | Request | Result |
|---|---|---|---|
| GitHub governance | 2026-09-13T04:32Z | REST: repository rulesets, `main` branch protection, environments | 0 rulesets; `main` unprotected (404); `Production` has no required reviewers or branch policy |
| Cloudflare Pages and Workers | 2026-09-13T04:35Z | API: Pages project `dicee`, Worker scripts list, Workers Builds triggers | Pages has no Git source, production branch `main`; 2 scripts, one of them `dicee`; trigger reads returned 403, so triggers are unverified |
| GitHub Apps | 2026-09-13T04:49Z | Repository installed GitHub Apps page | No Cloudflare Workers and Pages app; with no Pages Git source, the native Git build integration is not in use |
