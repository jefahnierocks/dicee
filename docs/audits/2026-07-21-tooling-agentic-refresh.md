# July 21, 2026 tooling and agentic-development audit

Status: implemented locally; no live deployment or remote migration performed. Corrected 2026-09-12: statements the 2026-09-12 modernization audit found inaccurate are marked inline as corrections, and finding IDs (D-xx) refer to that audit. The current status of record is [`docs/status.md`](../status.md).

## Audit outcome

The repository had a strong product stack but its development contract was split across stale, contradictory agent files. The JavaScript gate covered only part of the workspace, Python tests could not collect, simulation tests included generated output and contained a random statistical assertion, Worker compatibility was 18 months old, CI used older runtime/action majors, and shared Claude hooks referenced a checkout that no longer exists.

This refresh establishes one reproducible, cross-language gate and one authoritative agent contract.

## Changes made

- Pinned the July 21 runtime baseline in mise, language manifests, lockfiles, and CI.
- Migrated to pnpm 11 catalogs, strict engine enforcement, reviewed lifecycle builds, dependency verification, a release-age policy, and Dependabot coverage.
- Removed the redundant repository Memory MCP server from application dependencies and repaired the transitive advisories audited on 2026-07-21. Correction (2026-09-12): three narrow overrides remained at that point (`@hono/node-server`, `cookie`, and `sharp`), not two, and the `sharp` override itself pinned a vulnerable release (D-05). As of the 2026-09-12 security refresh there are four overrides (`cookie`, `postcss`, `sharp`, `undici`); `pnpm-workspace.yaml` is the authority and [`docs/development/toolchain.md`](../development/toolchain.md) records each reason and removal condition.
- Adopted TypeScript 6, Vite 8, Vitest 4.1's concise `agent` reporter, Svelte 5.56, SvelteKit 2.70, Biome 2.5, Zod 4, and current compatible package lines.
- Upgraded Rust to 1.97.1 and edition 2024, refreshed the lockfile, and resolved new strict-Clippy findings.
- Added a uv-locked Python 3.13 development group; repaired the previously incomplete Pydantic mirrors and added Ruff/mypy/pytest to the root gate.
- Made simulation discovery deterministic and removed a random hypothesis-test failure.
- Migrated Cloudflare configuration to schema-backed JSONC, the current compatibility date, declarative SQLite Durable Object exports, explicit environment targets, generated environment bindings, logs, and traces. Correction (2026-09-12): by owner decision the baseline keeps the legacy Durable Object `migrations` v1 and v2 with `new_sqlite_classes`; declarative `exports` is deferred to a standalone operator deploy after ADR-005 is accepted.
- Added `AGENTS.md`, current Codex project/custom-agent configuration, portable Claude hooks, scoped Copilot/Cursor/Windsurf instructions, and a Gemini import.
- Regenerated a portable AKG from 224 TypeScript and 103 Svelte files (339 nodes, 614 unique edges), repaired colliding node/edge IDs and package classification, and added graph integrity, diagram freshness, and the 10-test MCP protocol suite to the gate.
- Replaced the live-state-mutating quality script with a deterministic wrapper around `pnpm validate`.
- Rebuilt CI around one complete validation job and current action majors. Correction (2026-09-12): this did not preserve the earlier deployment trigger. The previous workflow deployed automatically on every push to `main`; the refresh replaced that with a manually dispatched deployment gated by the `deploy` input and the `Production` environment, and as first written its deploy jobs accepted a dispatch from any branch (D-08). A `main`-only ref condition is part of the 2026-09 remediation.

## Intentional holds

- Node 24 LTS is used instead of Node 26 Current.
- TypeScript 7 is held until Svelte's embedded-language toolchain can use its stable API.
- Packages less than 24 hours old are held by the pnpm supply-chain policy. On audit day this held Biome 2.5.4 instead of the same-day patch. Correction (2026-09-12): Wrangler was not held at 4.112; the workspace pinned Wrangler 4.113.0 through an exact-version `minimumReleaseAgeExclude` security exception.
- `@types/node` remains on the Node 24 line, and DiceBear remains on version 9 because its collection package still peers with core 9.
- Live Cloudflare bindings/secrets, Supabase schema parity, production telemetry, and deployment health were not checked or changed; those require an authorized operator lane.

## Non-blocking debt

Biome reports 56 existing advisory warnings and 16 informational suggestions across the web, Worker, and simulation packages. They are primarily complexity thresholds, optional-chain suggestions, and test-only assertion/style findings. The refreshed gate fails on correctness, security, focused-test, type, and build errors while continuing to surface this refactoring queue.

## Verification record

This is a point-in-time record from 2026-07-21. Correction (2026-09-12): no full validation had covered the final working tree since that date (D-06), and `pnpm audit` then reported 33 advisories on the working-tree lockfile, 12 of them high (D-05). Record current results in [`docs/status.md`](../status.md), not here.

The local evidence recorded for this refresh on 2026-07-21 was:

- `pnpm install --frozen-lockfile`: passed with the pnpm supply-chain policies enforced.
- `pnpm validate`: passed on Rust 1.97.1, including 2,445 passing language/application tests, 10 passing MCP protocol tests, and 3 intentionally skipped web tests.
- `pnpm audit`: no known vulnerabilities on 2026-07-21 (contradicted on 2026-09-12; see above); peer dependency check: no issues.
- AKG: 8/8 invariants and 10/10 MCP protocol tests passed; Python: Ruff, mypy, and 26 tests passed; Svelte: 0 errors and 0 warnings.
- Cloudflare Durable Object dry run: passed with both SQLite Durable Objects, Workers AI, and production environment bindings; no deployment occurred.
- WASM and SvelteKit production builds: passed; `git diff --check`: passed.

The repeatable gate is:

```bash
pnpm install --frozen-lockfile
pnpm validate
pnpm audit
pnpm exec wrangler deploy --env="" --dry-run --outdir /tmp/dicee-do-dry-run
git diff --check
```

No successful local check is evidence that production was deployed or that remote secrets and schema are current.
