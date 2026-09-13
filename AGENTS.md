# Dicee agent guide

This file is the repository-wide source of truth for coding agents. Tool-specific instruction files may add ergonomics, but must not contradict it.

## Product and repository map

Dicee is an educational multiplayer dice game:

- `packages/web`: SvelteKit 2 / Svelte 5 application deployed to Cloudflare Pages.
- `packages/cloudflare-do`: Cloudflare Worker with SQLite-backed `GameRoom` and `GlobalLobby` Durable Objects.
- `packages/shared`: shared TypeScript domain types and Zod schemas.
- `packages/simulation`: deterministic AI simulation and experiment framework.
- `packages/engine`: Rust 2024 probability engine compiled to WebAssembly.
- `packages/analysis`: Python 3.13 analysis, validation, and visualization package.
- `supabase`: schema migrations and database tests.
- `docs/architecture/akg`: generated architecture knowledge graph and invariants.

## Authority and safety

1. Read the nearest source, test, and current config before editing. Current code and generated types outrank old planning documents or archived agent state.
2. Keep local evidence, committed configuration, and live Cloudflare/Supabase state distinct. Never claim a deploy, migration, secret, or production check happened without direct evidence.
3. Do not expose or commit secrets. Use `scripts/with-dicee-cloudflare.sh` for authorized Cloudflare operations and the Supabase CLI for Supabase operations under explicit operator authority. Infisical is retired for Dicee; do not add new Infisical references (its removal is Phase 6).
4. Deployment, remote database writes, migrations, secret changes, destructive Git operations, and publication require explicit user authority. Dry runs and local validation are safe defaults.
5. Do not regenerate Supabase types as part of an ordinary local gate; that is an authenticated, live-schema operation.
6. Start Cloudflare work at `docs/cloudflare/README.md`. It maps current project authority, live platform truth, historical material, and the target-state consolidation plan. Proposed D1, R2, OpenTofu, Worker-split, or Durable Object migration work is not current architecture until approved and implemented.
7. Keep the legacy Durable Object `migrations` (v1 `GameRoom`, v2 `GlobalLobby`, both `new_sqlite_classes`) until ADR-005 (`docs/rfcs/adr-005-durable-object-lifecycle.md`) is accepted. Declarative `exports` cannot be rolled back and ships only as a standalone operator deploy.
8. Project MCP is native HTTP/OAuth and minimal: `akg` (stdio) and unauthenticated `cloudflare-docs` are enabled; `cloudflare-api` and read-only Supabase are opt-in OAuth servers. Never pass tokens through MCP config, command arguments, headers, credential-forwarding MCP bridges, or bearer-token wrappers.

## Status and live evidence

- `docs/status.md` is the tracked status of record: current phase, owner decisions, and open operator follow-ups. `.claude/state/` is private and archival only.
- `project.yaml` is the meta-inventory interop header (contract: meta-inventory `docs/decisions/0002-project-intelligence-spec.md` §D3). When project status changes, update `docs/status.md`, `status.local_phase`, and the quoted ISO-8601 `status.as_of` together.
- Verifying live state requires a first-hand readback: URL, HTTP status, and timestamp from a command run in the current session. Never cite hub records, prior audits, or status docs back as confirmation; that is circular evidence.
- Canonical public URL: `https://dicee.games`. `gamelobby.jefahnierocks.com` is an alias of the same deployment.

## Toolchain and dependencies

- Use the versions pinned in `.mise.toml`, `package.json`, `pnpm-workspace.yaml`, `packages/engine/rust-toolchain.toml`, and `packages/analysis/uv.lock`.
- Use only `pnpm` for JavaScript dependencies. Keep shared versions in the pnpm catalog and run `pnpm install --frozen-lockfile` in verification and CI.
- TypeScript 6 is intentional: TypeScript 7 does not yet provide the stable embedded-language API required by Svelte tooling.
- Keep Cloudflare configuration in `wrangler.jsonc`. After changing it, run the package's `pnpm types` and commit the generated `worker-configuration.d.ts`.
- Never hand-edit generated Worker, Supabase, SvelteKit, lock, or WASM output unless its generator explicitly requires it.

## Architecture and implementation conventions

- Svelte uses runes and lowercase DOM event properties (`onclick`); component callback props and handlers use `onVerb` and `handleVerb`.
- Preserve the AKG layer direction: routes -> components/stores/services/types; components -> components/types; stores -> services/types/supabase; services -> types/supabase/wasm.
- Run `pnpm akg:check` after import or boundary changes. Regenerate graph artifacts only when the task changes architecture.
- Durable Objects own strongly consistent room/lobby state. Keep constructors synchronous, use `ctx.blockConcurrencyWhile` for required async initialization, use alarms for delayed work, and preserve WebSocket hibernation behavior.
- Keep external data validated at boundaries with Zod or Pydantic. Keep simulations seeded and tests deterministic.
- Use existing structured logging and observability helpers in Worker code; do not add ad hoc production `console.log` calls.

## Agentic workflow

- For substantial audits, cross-stack changes, research, or reviews, use bounded parallel subagents when the active client supports them. Give each agent a non-overlapping read-only or file-scoped lane; the primary agent owns the plan, integration, final edits, and verification.
- Use the project `reviewer` and `researcher` agents (currently defined in `.codex/agents/`) for independent review and primary-source research where the client supports them. Do not delegate trivial work or allow agents to edit the same files concurrently.
- State assumptions early, keep a live plan for multi-step work, and report blockers with exact evidence. Do not silently bypass a failing guardrail.
- Prefer focused tests while iterating. Before completion, run the smallest full gate proportional to the change and review the complete diff.

## Commands

```bash
pnpm install --frozen-lockfile  # reproducible install
pnpm check                      # Rust, TypeScript, Python, Worker types
pnpm lint                       # Rust, Python, Biome, AKG invariants/diagrams/MCP
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
```

## Definition of done

- Requested behavior is implemented with focused tests.
- Relevant generated types and lockfiles are current.
- `pnpm validate:ci` (`pnpm validate`, `pnpm audit:dependencies`, `pnpm security:public`) passes, or every skipped/failing lane is named with evidence.
- `git diff --check` and a final diff review show no accidental, secret, generated-noise, or unrelated changes.
- The handoff separates completed local work from operator-only and live-environment follow-up, and `docs/status.md` reflects any status change.
