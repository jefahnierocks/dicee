# Dicee status of record

- **Status:** tracked status of record for agents, operators, and the meta-inventory manifest (`project.yaml`)
- **As of:** 2026-09-12
- **Current phase:** 2026-09 modernization, Phase 1 baseline

This file replaces the private `.claude/state/current-phase.json` as the status
of record. `.claude/state/` is private and archival only. Update this file,
`project.yaml` `status.local_phase`, and `status.as_of` together.

## Current phase

Phase 1 fixes the blockers in the July 2026 toolchain and agent-framework
refresh and lands it as a validated baseline commit series on
`work/2026-09-modernization`.

- This work is local. Nothing in this phase has been pushed, deployed, or
  migrated against a live environment.
- Push the baseline only after the operator has applied the urgent profiles
  privilege migration live and has confirmed that workers.dev and Preview URLs
  are disabled.
- Completion gate: `pnpm validate:ci`. Both the pre-commit working tree and the
  committed tip, in a clean worktree, passed it locally (see
  [Local verification](#local-verification)). Pull-request CI still has to pass
  after push.

Cloudflare work starts at [`docs/cloudflare/README.md`](cloudflare/README.md).

## Decisions

Owner decisions recorded 2026-09-12:

1. **Durable Objects.** The baseline keeps the legacy `migrations` v1
   (`GameRoom`) and v2 (`GlobalLobby`) with `new_sqlite_classes`. Declarative
   `exports` is deferred to a standalone operator deploy after
   [ADR-005](rfcs/adr-005-durable-object-lifecycle.md) is accepted. The first
   baseline deploy is gated on OPS-02: if the live namespaces belong to a
   different Worker script than `dicee`, a deploy would create empty namespaces
   instead of being a no-op.
2. **MCP.** Native HTTP/OAuth and minimal. `akg` (stdio) and unauthenticated
   `cloudflare-docs` are enabled. `cloudflare-api`
   (`https://mcp.cloudflare.com/mcp`) and read-only Supabase
   (`https://mcp.supabase.com/mcp`, `read_only=true`) are opt-in OAuth servers.
   All bearer-token MCP wrappers and credential-forwarding bridges are deleted.
3. **Secrets.** Infisical is retired for Dicee. The detailed retirement is
   Phase 6; Phase 1 adds no new Infisical references.
4. **Database.** The July privacy migration (`public_security_hardening`) is
   approved but ships separately, after the urgent profiles privilege fix. It
   is renumbered to sort after that migration.
5. **Wrangler.** Stay on the miniflare 4 line: wrangler 4.113.0 with
   `compatibility_date` 2026-07-21.
6. **Status of record.** This tracked file.

Under evaluation (owner intent, not yet decided): whether Cloudflare-native
storage should replace Supabase, and moving the repository and its Cloudflare
resources into an organization governed with policy and infrastructure as code.
Until an RFC is accepted, none of this changes current architecture.

## Open operator follow-ups

These require operator authority and live access. Agents must not mark them done
without a first-hand readback recorded below.

- [ ] Database migrations, in this order. Both migrations and both pgTAP files
      pass on a local stack (see [Local verification](#local-verification)); none
      has run against the hosted project.
      1. Back up the Supabase database.
      2. Apply only `20260913000001_profiles_column_privileges.sql` live.
         `supabase db push` applies every pending file, so either push from a
         tree that does not yet contain `20260913000002`, or run `000001` in the
         SQL editor and record it with
         `supabase migration repair --status applied 20260913000001`. Check for
         unexpected admin accounts (role counts only) and revoke any unexpected
         elevation.
      3. Deploy Pages from the new baseline.
      4. Only then apply `20260913000002_public_security_hardening.sql`. It
         drops the `bug_reports` columns `user_email`, `user_display_name`,
         `user_context`, and `console_capture`, which the web app built from the
         previous HEAD still writes. Applied before step 3, bug-report
         submission fails.
- [ ] OPS-02, before any baseline deploy of `packages/cloudflare-do`: record
      which Worker script holds the live `GameRoom` and `GlobalLobby` namespaces
      (OPS-03), their legacy migration tag if a confirmed read-only source exists
      (OPS-04), and what the Pages `GAME_WORKER` binding targets (OPS-08).
      See [`docs/cloudflare/operator-evidence.md`](cloudflare/operator-evidence.md).
- [ ] Apply the explicit Supabase Data API grants (P6-01) before 2026-10-30,
      when Supabase starts enforcing them on existing projects.
- [ ] Disable workers.dev and Preview URLs on every Dicee Worker script.
- [ ] Opt-in MCP servers: sign in with `claude mcp login cloudflare-api` and
      `claude mcp login supabase` (or `/mcp`) only when a task needs them, and
      use the equivalent Cursor OAuth flow. See [`MCP-SETUP.md`](MCP-SETUP.md).
- [ ] Rotate or revoke the Cloudflare API token and the Supabase personal access
      token used by the retired bearer MCP wrappers.
- [ ] GitHub governance: a `main` ruleset that requires the CI `validate` check,
      a `Production` environment with required reviewers and a main-only
      deployment branch policy, and Dependabot alerts plus security updates.
- [ ] Revoke the Infisical machine identities whose identifiers were published
      in repository history.
- [ ] Update the meta-inventory registry so `status_of_record` is
      `docs/status.md`.

## Known local limitations

- **Authenticated Worker WebSockets in local development.**
  `packages/cloudflare-do/wrangler.jsonc` declares `secrets.required` without
  `SUPABASE_JWT_SECRET`. Once `secrets` is declared, Wrangler loads only the
  listed keys from `.dev.vars` and `.env`. `pnpm dev:do`
  (`wrangler dev --env development`) therefore has no HS256 fallback, and
  authenticated room WebSockets and transcription fail against a local Supabase
  stack that still signs HS256 tokens. That is the case while
  `[auth] signing_keys_path` in `supabase/config.toml` is unset. Interim step:
  for authenticated local Worker testing, use a Supabase stack configured with
  asymmetric JWT signing keys, so verification uses JWKS. Do not add
  `SUPABASE_JWT_SECRET` to `secrets.required`, because deploy validation would
  then fail wherever it is unset. Phase 6 (P6-03) removes the HS256 fallback.
- **Supabase CLI configuration.** Supabase CLI 2.117.0 reports that the
  `[inbucket]` section in `supabase/config.toml` is deprecated in favor of
  `[local_smtp]`. Rename it in the Phase 3 toolchain refresh.
- **Clean clones need public Supabase settings.** `packages/web` imports
  `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` from
  `$env/static/public`, so `svelte-check` fails in a fresh clone without them.
  Copy `packages/web/.env.example` to `packages/web/.env` for local work, or set
  the same non-secret placeholders CI uses (`.github/workflows/ci.yml`). The
  Phase 5 clean-clone work should remove this manual step.
- **Preview traffic reaches production Durable Objects.** In
  `packages/web/wrangler.jsonc`, `env.preview` binds `GAME_WORKER` to the
  production Worker `dicee` (`cloudflare-config-audit` F7). Give preview a
  separate backend in the Cloudflare current-state phase.
- **Config audit advisories.** `node scripts/cloudflare-config-audit.mjs --strict`
  reports 29 passes and 3 advisory warnings: F7 (above), B8 (the legacy
  `SUPABASE_JWT_SECRET`, removed by P6-03), and B11 (the `ENVIRONMENT` variable
  is declared but never read). The strict audit is not part of `validate:ci`.
- **Agent sandbox.** Sandboxed agent sessions cannot write the pnpm store,
  `~/.cargo`, or `~/.wrangler`, and cannot read `**/.npmrc`. Full gate runs,
  `pnpm install`, and local Supabase need an unsandboxed or approved command.

## Local verification

Local evidence from the Phase 1 working tree before the commit series. This is
not live-environment evidence.

- 2026-09-13T03:51Z–03:54Z UTC: `pnpm akg:discover && pnpm akg:mermaid` then
  `pnpm validate:ci` passed (exit 0). Rust fmt, Clippy with warnings denied, and
  120 tests; Python Ruff, mypy, and 26 tests; Biome with no errors; AKG 8/8
  invariants and 10/10 MCP protocol tests; script tests; web 1,588 tests passed
  and 3 skipped; Worker 522; simulation 204; WASM and production builds;
  `pnpm audit` with no known vulnerabilities; public-safety scan passed.
- 2026-09-13T03:51Z UTC: `pnpm --filter @dicee/web exec vitest run
  src/lib/server/ws-proxy` passed 13 tests in 2 files, including the workerd
  runtime test for the immutable-header WebSocket re-wrap (P1-02).
- 2026-09-13T03:51Z UTC: `wrangler deploy --dry-run` for `packages/cloudflare-do`
  passed for the default (production) and `staging` targets on wrangler 4.113.0,
  with the `GAME_ROOM`, `GLOBAL_LOBBY`, `AI`, and `ENVIRONMENT` bindings.
- 2026-09-13T03:55Z UTC: `supabase db reset --local` applied all 23 migrations,
  including `20260913000001` and `20260913000002`, and `supabase test db` passed
  2 files and 47 tests.
- 2026-09-13T04:04Z–04:07Z UTC: the committed tip `9ec6d7b` passed
  `pnpm install --frozen-lockfile` and `pnpm validate:ci` in a clean worktree
  with no `packages/web/.env`, using CI's placeholder public Supabase values.
  Test counts matched the working-tree run, `svelte-check` reported 0 errors,
  and the gate left no tracked or untracked changes, so the committed WASM and
  AKG artifacts are reproducible.
- `.claude/settings.json` sets `enabledMcpjsonServers` to `akg` and
  `cloudflare-docs` and adds ask rules for deploy, secret, tail, migration,
  1Password, and push commands plus deny rules for destructive Git commands.

## Live readbacks

A readback is URL or query, result (counts only for data), and timestamp from a
command run by the operator or agent that records it. Never record secret values
or account identifiers here.

None recorded for this phase.
