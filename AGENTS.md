# Dicee agent guide

This is the repository contract for every coding agent. Package `AGENTS.md` files add package rules; client files such as `CLAUDE.md` add only client-specific deltas.

Workstation integration follows the [system-config project contract](https://github.com/jefahnierocks/system-config/blob/main/docs/project-conventions.md). Dicee owns its runtime pins, editor configuration, project MCP and command-scoped credential launchers. Its explicit client permission deltas are recorded in [agent-clients.md](docs/development/agent-clients.md).

## Product and repository map

Dicee is an educational multiplayer dice game for a few family players:

- `packages/web`: SvelteKit 2 / Svelte 5 application deployed to Cloudflare Pages.
- `packages/cloudflare-do`: Cloudflare Worker with SQLite-backed `GameRoom` and `GlobalLobby` Durable Objects.
- `packages/shared`: shared TypeScript domain types and Zod schemas.
- `packages/simulation`: deterministic AI simulation and experiment framework.
- `packages/engine`: Rust 2024 probability engine compiled to WebAssembly.
- `packages/analysis`: Python 3.13 analysis, validation, and visualization package.
- `supabase`: schema migrations and pgTAP database tests.

Before editing `packages/web` or `packages/cloudflare-do`, read that package's `AGENTS.md`.

## Where things live

| Concern | Home |
|---|---|
| Status, decisions, operator actions, live readbacks | [docs/status.md](docs/status.md), mirrored by `project.yaml` `status.*` |
| Ordered next work | [docs/roadmap.md](docs/roadmap.md) |
| Cloudflare topology, configuration, deploy path, live checks | [docs/cloudflare.md](docs/cloudflare.md) |
| Future Jefahnierocks ownership and infrastructure boundaries | [docs/development/organization-alignment.md](docs/development/organization-alignment.md) (intake proposal) |
| Architecture, engine, data contracts, multiplayer | [docs/architecture/README.md](docs/architecture/README.md) |
| Layer rules and invariants | `akg.config.ts`, [docs/architecture/akg/README.md](docs/architecture/akg/README.md), `pnpm akg:check` |
| Toolchain and dependency policy | [docs/development/toolchain.md](docs/development/toolchain.md) |
| Tests | [docs/development/testing.md](docs/development/testing.md) |
| Debugging | [docs/development/debugging.md](docs/development/debugging.md) |
| Agent clients, MCP, skills, Codex rules | [docs/development/agent-clients.md](docs/development/agent-clients.md) |
| Portable skills | [dicee-verify](.agents/skills/dicee-verify/SKILL.md), [akg-boundaries](.agents/skills/akg-boundaries/SKILL.md) |
| Schema and pgTAP tests | `supabase/migrations/`, `supabase/tests/` |
| Removed documents | git history; [docs/history.md](docs/history.md) has the commands |

## Authority and safety

1. Read the nearest source, test, and current config before editing. Code and generated types outrank docs; fix a doc that disagrees.
2. Keep local evidence, committed configuration, and live Cloudflare/Supabase state distinct. Never claim a deploy, migration, secret change, or production check happened without direct evidence. A live claim needs a first-hand readback from the current session (request, result, UTC time); citing status docs, prior audits, or hub records as confirmation is circular.
3. Never expose or commit secrets, account identifiers, or project refs. Authorized Cloudflare operations run through `./scripts/with-dicee-cloudflare.sh -- <command>`; Supabase operations use the Supabase CLI under explicit operator authority. Run `./scripts/check-1password-setup.sh` only for an explicitly authorized task that needs operator credentials. Infisical is retired: add no new Infisical usage; the remaining scripts are removed per `docs/roadmap.md` section 4.
4. Deployment, remote database writes, migrations, secret changes, destructive Git operations, and publication require explicit user authority. Dry runs and local validation are safe defaults.
5. Do not regenerate Supabase types as part of an ordinary local gate; that is an authenticated, live-schema operation.
6. Cloudflare work starts at `docs/cloudflare.md`. Current architecture is Cloudflare Pages plus the `dicee` Worker with SQLite Durable Objects plus Supabase. D1, R2, a Worker split, Workers Static Assets, and OpenTofu are not current architecture; organization governance and infrastructure as code arrive only through `docs/roadmap.md`.
7. Keep the legacy Durable Object `migrations` (v1 `GameRoom`, v2 `GlobalLobby`, both `new_sqlite_classes`); never edit or reorder an applied tag. Adopting declarative `exports` is a one-way door: only for a concrete need recorded in `docs/status.md`, as a standalone operator deploy. `pnpm cf:audit` enforces migrations mode.
8. Project MCP is minimal: `akg` (stdio) and unauthenticated `cloudflare-docs` are enabled; `cloudflare-api` and read-only `supabase` are opt-in OAuth servers. Never pass tokens through MCP config, command arguments, headers, credential-forwarding bridges, or bearer-token wrappers. An MCP session is not authority.
9. Canonical public URL: `https://dicee.games`.

## Status and docs

- `docs/status.md` is the only status home. When status changes, update `project.yaml` `status.local_phase` and `status.as_of` in the same change; `pnpm lint:docs` checks that they match.
- `docs/roadmap.md` is the only sequence of work.
- Verification logs belong in PR descriptions and CI output, never in tracked docs.
- Keep one current document per concern; update the map when a home moves. Delete superseded documents; git history is the archive.

## Toolchain and dependencies

- Use the versions pinned in `.mise.toml`, `package.json`, `pnpm-workspace.yaml`, `packages/engine/rust-toolchain.toml`, and `packages/analysis/uv.lock`.
- Use only `pnpm` for JavaScript dependencies. Keep shared versions in the pnpm catalog and run `pnpm install --frozen-lockfile` in verification and CI.
- TypeScript 6 is intentional: TypeScript 7 does not yet provide the stable embedded-language API required by Svelte tooling.
- Keep Cloudflare configuration in `wrangler.jsonc`. After changing it, run the package's `pnpm types` and commit the generated `worker-configuration.d.ts`.
- Never hand-edit generated Worker, Supabase, SvelteKit, lock, WASM, or AKG graph output unless its generator explicitly requires it.

## Architecture and conventions

- Svelte uses runes and lowercase DOM event properties (`onclick`); component callback props and handlers use `onVerb` and `handleVerb`.
- Preserve the layer direction in `akg.config.ts`: routes -> components/stores/services/types/wasm; components -> components/types; stores -> services/types/supabase; services -> types/supabase/wasm; types, supabase, and wasm -> types. Every web layer may import `shared`; `cloudflare-do` imports only `shared`. After import changes run `pnpm akg:discover && pnpm akg:check`; if the architecture change was not intended, `git restore docs/architecture/akg/graph docs/architecture/akg/diagrams` before committing.
- Durable Objects own strongly consistent room/lobby state. Keep constructors synchronous, use `ctx.blockConcurrencyWhile` for required async initialization, use alarms for delayed work, and preserve WebSocket hibernation.
- Validate external data at boundaries with Zod or Pydantic. Keep simulations seeded and tests deterministic.
- In Worker code use the structured logger (`packages/cloudflare-do/src/lib/logger.ts`) and the observability helpers; do not add ad hoc production `console.log` calls.
- Auth invariants:
  - Server code trusts a session only after `getUser()` validates the JWT (`safeGetSession` in `packages/web/src/hooks.server.ts`); never trust `getSession()` alone.
  - The auth callback redirects only to same-origin relative paths and reports provider errors as fixed `auth_error` codes (`packages/web/src/routes/auth/callback/+server.ts`).
  - No tokens in URLs: WebSockets open same-origin `/ws/room/<CODE>` and `/ws/lobby`, whose server routes replace any inbound `Authorization` header with the validated session's bearer.
  - Never derive a public display name from an email address or provider identity, and accept avatar URLs only from the DiceBear API host.

## Agentic workflow

- For substantial audits, cross-stack changes, research, or reviews, use bounded parallel subagents when the client supports them. Give each agent a non-overlapping read-only or file-scoped lane; the primary agent owns the plan, integration, final edits, and verification.
- Use read-only subagents for independent review and primary-source research: Codex defines `reviewer` and `researcher` in `.codex/agents/`; other clients use built-in read-only subagents. Do not delegate trivial work or let agents edit the same files concurrently.
- State assumptions early, keep a live plan for multi-step work, and report blockers with exact evidence. Do not silently bypass a failing guardrail.
- Prefer focused tests while iterating. Before completion, run the smallest full gate proportional to the change and review the complete diff.

## Commands

```bash
pnpm install --frozen-lockfile  # reproducible install
pnpm check                      # Rust, TypeScript, Python, Worker types
pnpm lint                       # Rust, Python, Biome, AKG, Cloudflare config audit, script tests, docs gate
pnpm lint:docs                  # docs and agent-surface gate
pnpm cf:audit                   # offline Cloudflare config audit
pnpm test:agent                 # complete concise test suite
pnpm build                      # WASM and production packages
pnpm validate                   # check, lint, test:agent, build
pnpm validate:ci                # validate + audit:dependencies + security:public (completion gate)
./scripts/quality-gate.sh       # wrapper around validate:ci (--fix formats first)
```

Targeted iteration:

```bash
pnpm --filter @dicee/web test:agent
pnpm --filter @dicee/cloudflare-do test:agent
pnpm --filter @dicee/simulation test:agent
cd packages/engine && env -u RUSTUP_TOOLCHAIN cargo test --all-features  # uses the engine toolchain pin
uv run --project packages/analysis --group dev pytest -q packages/analysis
supabase db reset --local && supabase test db  # local stack only: migrations plus pgTAP
```

## Definition of done

- Requested behavior is implemented with focused tests.
- Relevant generated types and lockfiles are current.
- `pnpm validate:ci` passes (its `pnpm lint` includes `lint:docs` and `cf:audit`), or every skipped or failing lane is named with evidence.
- `git diff --check` and a final diff review show no accidental, secret, generated-noise, or unrelated changes.
- The handoff separates completed local work from operator-only and live-environment follow-up, and `docs/status.md` reflects any status change.
