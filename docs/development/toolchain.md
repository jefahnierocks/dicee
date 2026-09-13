# Toolchain and dependency policy

Last reviewed: 2026-09-12

## Pinned runtimes

| Tool | Version | Source of truth |
|---|---:|---|
| Node.js | 24.18.0 LTS | `.mise.toml`, root engines, CI |
| pnpm | 11.15.1 | `packageManager`, `.mise.toml`, CI |
| Rust | 1.97.1 | `.mise.toml`, `packages/engine/rust-toolchain.toml`, CI; `rust-version = "1.97"` in `packages/engine/Cargo.toml` |
| Python | 3.13.14 | `.mise.toml`, CI; package supports 3.13-3.14 |
| uv | 0.11.30 | `.mise.toml`, CI |
| Bun | 1.3.14 | `.mise.toml`, CI |
| wasm-pack | 0.15.0 | pnpm catalog, CI |
| Supabase CLI | 2.117.0 | `.mise.toml` (`aqua:supabase/cli`) |

Production development stays on Node's LTS line. Node 26 is the current line, but Node 24 remains the supported LTS baseline for reproducible application and Worker builds.

Rust commands run from `packages/engine` with `RUSTUP_TOOLCHAIN` unset so rustup honours `packages/engine/rust-toolchain.toml` instead of the machine default. Root scripts (`check:rust`, `lint:rust`, `test:rust`, `build:engine`) and the mise `engine:test` task all follow that pattern.

The Supabase CLI is pinned through mise so `pnpm db:*` and the local migration workflow do not float with a Homebrew install. Only stable GitHub releases are pinned; `v2.x.0-beta.*` tags are skipped.

## JavaScript dependency strategy

`pnpm-workspace.yaml` is the shared dependency-policy surface:

- Exact catalog versions keep every workspace on one reviewed version.
- `catalogMode: strict` prevents packages from bypassing the catalog.
- Node and pnpm versions are enforced rather than advisory.
- A 24-hour minimum release age reduces exposure to just-published package compromises.
- Release-age exceptions are exact security-release versions, not permanent package-wide bypasses, and are pruned once the release is older than the policy window. None are currently required.
- Only reviewed lifecycle scripts are allowed; all others stay blocked.
- The lockfile is required in CI and final verification.
- The global virtual store is disabled so local and CI module layouts match.
- Package-level `.npmrc` files are not used; pnpm 11 reads project settings from `pnpm-workspace.yaml`.

TypeScript 6.0.3 is intentional. TypeScript 7's native compiler is attractive, but its July 2026 release guidance says embedded-language workflows such as Svelte should remain on TypeScript 6 until the API is stable. `@sveltejs/kit` 2.70.3 and `svelte-check` 4.7.x peer ranges still stop at TypeScript `^6`. Vite 8, Vitest 4.1, Svelte 5, SvelteKit 2, Biome 2.5, Zod 4, and Wrangler 4 are current within that compatibility boundary.

When a newest package is less than 24 hours old, keep the newest version that satisfies the release-age policy and let Dependabot propose the next update after the cooling period.

### Security overrides

`pnpm audit --audit-level high` must pass. Prefer a catalog bump or a targeted `pnpm update <pkg> -r`. If an upstream semver range or exact pin excludes the patched line, use the narrowest vulnerable-range override, run the full gate, and document it here. Current overrides:

| Override | Reason | Remove when |
|---|---|---|
| `cookie@<0.7.0` -> `^0.7.0` | `@sveltejs/kit` depends on `cookie ^0.6.0` | Kit widens its `cookie` range |
| `postcss@<8.5.23` -> `8.5.28` | vite 8.1.5 had resolved postcss 8.5.20, which pins `nanoid` 3.3.16 (GHSA-2v37-7h3g-55p8); `pnpm update` does not move this transitive entry | A vite bump resolves postcss 8.5.23 or later on its own |
| `sharp@<0.35.4` -> `0.35.4` | miniflare 4.x pins `sharp` 0.34.5 (GHSA-rgj7-g3m4-5g8c) | The pinned miniflare depends on sharp 0.35.4 or later |
| `undici@<7.29.0` -> `7.29.1` | miniflare 4.x pins `undici` 7.28.0 (GHSA-4cwx-7wf7-3272) | The pinned miniflare depends on undici 7.29.0 or later |

The former `@hono/node-server` override was dropped: `@modelcontextprotocol/sdk` 1.30.0 accepts `^2.0.5`.

### Wrangler and miniflare hold

Wrangler stays on the miniflare 4 line at 4.113.0, which depends on exactly `miniflare` 4.20260721.0 and `workerd` 1.20260721.1. Wrangler 4.117.0 and later depend on a miniflare 5 alpha line, so moving past 4.116.0 is not a minor bump. Every miniflare 4 release still pins vulnerable `sharp` and `undici`, which is why the overrides above are required whichever 4.x wrangler is chosen.

`miniflare` is a catalog devDependency of `@dicee/web` so workerd runtime tests can import it directly. Its catalog version must equal the exact version the pinned wrangler depends on; bump both together (`npm view wrangler@<version> dependencies`). Revisit the hold when miniflare 5 is no longer alpha, together with any compatibility date on or after 2026-08-04 (which needs wrangler 4.122 or later with `nodejs_compat`).

## Native dependency strategy

- Rust uses edition 2024, commits `packages/engine/Cargo.lock`, and runs formatting, all-target/all-feature Clippy with warnings denied, unit/property/doc tests, and the WASM build.
- Python uses PEP 735 dependency groups and a committed uv lockfile. Ruff, mypy, and pytest are part of the root gate; `test:analysis` passes `packages/analysis` explicitly so pytest uses the package's `pyproject.toml` configuration.
- Cross-language result schemas are validated by the TypeScript Zod and Python Pydantic suites.

## Quality gates

| Command | Scope |
|---|---|
| `pnpm validate` | `check` (Rust, TypeScript with `@dicee/shared` built first, Python, Worker types), `lint` (Rust, Python, Biome, AKG, `test:scripts`), `test:agent`, `build` |
| `pnpm validate:ci` | `validate`, then `audit:dependencies` (`pnpm audit --audit-level high`) and `security:public` |

The lefthook pre-push hook and CI run `pnpm validate:ci`. `test:scripts` runs every `scripts/tests/*.test.sh` and fails if none exist.

## Cloudflare strategy

`docs/cloudflare/README.md` is the authority map for Cloudflare work. Current
source, generated types, and configuration remain executable truth; proposed
D1/R2/OpenTofu and Worker-topology changes live in the linked consolidation plan
until approved and implemented.

- Worker configuration uses schema-backed `wrangler.jsonc` with compatibility date `2026-07-21`.
- Durable Object namespaces keep the legacy SQLite migrations (`v1` GameRoom, `v2` GlobalLobby). Declarative `exports` is deferred to a standalone operator deploy after ADR-005 is accepted, because that lifecycle change cannot be rolled back.
- Non-inherited bindings are repeated for each named environment.
- The default Worker target is production; development and staging are explicit named environments.
- `wrangler types --env-file=/dev/null` generates deterministic committed bindings without leaking local `.env` names into generated files.
- Logs and traces are enabled with full log sampling and 10% trace sampling.
- Deploy scripts target the intended environment explicitly. Local completion uses a dry run; live deployment remains operator-gated.

## Agent development framework

`AGENTS.md` is the short, cross-client repository contract. Claude, Codex, Gemini, GitHub Copilot, Cursor, and Windsurf files point to it and add only client-specific behavior.

The in-repository AKG remains the project-specific local MCP server. The generic Memory MCP server was removed from the shipped dependency graph after its server stack introduced audited vulnerabilities and duplicated native client/session memory; durable project decisions belong in source, tests, Git history, and explicit handoff artifacts. Remote MCP servers use native HTTP transport with client OAuth, so no stdio-to-remote bridge package is a dependency.

Codex project configuration enables the stable multi-agent and shell-snapshot features and defines two read-only specialists:

- `researcher` for primary-source version and framework research.
- `reviewer` for independent correctness, security, regression, and test review.

The primary agent owns the plan, integration, edits, and final verification. Parallel work must be bounded and non-overlapping.

## References

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [pnpm 11 release notes](https://pnpm.io/blog/releases/11.0)
- [pnpm settings](https://pnpm.io/settings)
- [TypeScript 7 announcement and ecosystem caveat](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Vite 8 migration guide](https://vite.dev/guide/migration.html)
- [Vitest 4.1 agent reporter](https://vitest.dev/blog/vitest-4-1.html)
- [Cloudflare Workers changelog](https://developers.cloudflare.com/changelog/product/workers/)
- [Cloudflare compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
- [Cloudflare Durable Object migrations and declarative exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Supabase CLI releases](https://github.com/supabase/cli/releases)
- [mise aqua backend](https://mise.jdx.dev/dev-tools/backends/aqua.html)
- [Claude Code memory and project instructions](https://code.claude.com/docs/en/memory)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)
- [Gemini CLI context files](https://geminicli.com/docs/cli/gemini-md/)
- [Cursor rules](https://docs.cursor.com/context/rules)
- [Codex AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
