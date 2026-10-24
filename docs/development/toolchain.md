# Toolchain and dependency policy

## Project activation

Dicee uses native mise; the deprecated direnv bridge is retired. With mise activated in zsh (`eval "$(mise activate zsh)"` for the current session), entering or leaving the project applies or restores its tools and non-secret environment. Host startup hooks remain owned by system-config; project setup needs no direnv approval. See [mise's migration guidance](https://mise.jdx.dev/direnv.html).

`.mise.toml` selects the pinned tools, sets `UV_PYTHON`, and preserves inherited `DICEE_ENV` values `dev`, `staging`, or `prod`; unset, empty, or unsupported values become `dev`. Optional local non-secret overrides belong under `[env]` in ignored `.mise.local.toml`, loaded after the shared config. Migrate any former `.envrc.local.nonsecret` exports to that TOML file; shell statements are not TOML and are no longer sourced. Local overrides take precedence over shared defaults, so use only supported `DICEE_ENV` values there.

Agents and CI use `MISE_EXEC_AUTO_INSTALL=0 mise exec -- pnpm <command>` from the repository root, for example `pnpm lint:docs` or `pnpm validate:ci`. For existing mise tasks use `MISE_TASK_RUN_AUTO_INSTALL=0 mise run <task>`; neither invocation depends on interactive activation. Install declared tools explicitly with `mise install` during setup. Never put secrets, credential lookups, or secret hooks in mise configuration; retain the command-scoped launchers in `scripts/`.

Disabling auto-install does not guarantee missing-tool refusal: mise can warn and fall back to a host executable. Check selected versions with `mise exec -- pnpm toolchain:versions` before running project commands on a new machine.

## Pinned runtimes

| Tool | Version | Source of truth |
|---|---:|---|
| Node.js | 24.18.0 LTS | `.mise.toml`, root engines, CI |
| pnpm | 11.15.1 | `packageManager`, `.mise.toml`, CI |
| Rust | 1.97.1 | `.mise.toml`, `packages/engine/rust-toolchain.toml`, CI; `rust-version = "1.97"` in `packages/engine/Cargo.toml` |
| Python | 3.13.14 | `.mise.toml`, CI; `packages/analysis/pyproject.toml` still allows 3.14, which CI does not test ([roadmap.md](../roadmap.md)) |
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

TypeScript 6.0.3 is intentional. TypeScript 7's native compiler is attractive, but its July 2026 release guidance says embedded-language workflows such as Svelte should remain on TypeScript 6 until the API is stable. `@sveltejs/kit` 2.70.3 and `svelte-check` 4.7.x peer ranges still stop at TypeScript `^6`. Vite 8, Vitest 5, Svelte 5, SvelteKit 2, Biome 2.5, Zod 4, and Wrangler 4 are current within that compatibility boundary.

When a newest package is less than 24 hours old, keep the newest version that satisfies the release-age policy and let Dependabot propose the next update after the cooling period.

### Security overrides

`pnpm audit --audit-level high` must pass. Prefer a catalog bump or a targeted `pnpm update <pkg> -r`. If an upstream range excludes the patched line or targeted pnpm updates retain a vulnerable transitive lock entry, use the narrowest patched floor, run the full gate, and document the removal condition here. Current overrides:

| Override | Reason | Remove when |
|---|---|---|
| `cookie@<0.7.0` -> `^0.7.0` | `@sveltejs/kit` depends on `cookie ^0.6.0` | Kit widens its `cookie` range |
| `postcss@<8.5.23` -> `8.5.28` | vite 8.1.5 had resolved postcss 8.5.20, which pins `nanoid` 3.3.16 (GHSA-2v37-7h3g-55p8); `pnpm update` does not move this transitive entry | A vite bump resolves postcss 8.5.23 or later on its own |
| `sharp@<0.35.5` -> `0.35.5` | miniflare 4.x pins `sharp` 0.34.5; 0.35.5 also fixes GHSA-wq5f-xc86-pv6w in librsvg | The pinned miniflare depends on sharp 0.35.5 or later |
| `source-map-js@<1.2.2` -> `1.2.2` | Named pnpm 11.15.1 updates, including an explicit 1.2.2 selector, retained vulnerable 1.2.1 despite parent ranges allowing the GHSA-68fv-2mgg-jv7q fix | The parent resolution supplies source-map-js 1.2.2 or later without this override |
| `undici@>=7.0.0 <7.30.1` -> `7.30.1` | miniflare 4.x pins `undici` 7.28.0; GHSA-xjj6-f33q-929c needs 7.30.1 | The pinned miniflare depends on undici 7.30.1 or later |
| `undici@>=8.0.0 <8.12.2` -> `8.12.2` | A targeted pnpm update retained jsdom's 8.10.2 despite its compatible range; GHSA-xjj6-f33q-929c needs 8.12.2 | jsdom resolves undici 8.12.2 or later without this override |

### Wrangler and miniflare hold

The hold is [docs/status.md](../status.md) decision 5. Wrangler stays on the miniflare 4 line at 4.113.0, which depends on exactly `miniflare` 4.20260721.0 and `workerd` 1.20260721.1. Wrangler 4.117.0 and later depend on a miniflare 5 alpha line, so moving past 4.116.0 is not a minor bump. Every miniflare 4 release still pins vulnerable `sharp` and `undici`, which is why the overrides above are required whichever 4.x wrangler is chosen.

`miniflare` is a catalog devDependency of `@dicee/web` so workerd runtime tests can import it directly. Its catalog version must equal the exact version the pinned wrangler depends on; bump both together (`npm view wrangler@<version> dependencies`). Revisit the hold when miniflare 5 is no longer alpha, together with any compatibility date on or after 2026-08-04 (which needs wrangler 4.122 or later with `nodejs_compat`).

## Native dependency strategy

- Rust uses edition 2024, commits `packages/engine/Cargo.lock`, and runs formatting, all-target/all-feature Clippy with warnings denied, unit/property/doc tests, and the WASM build.
- Python uses PEP 735 dependency groups and a committed uv lockfile. Ruff, mypy, and pytest are part of the root gate; `test:analysis` passes `packages/analysis` explicitly so pytest uses the package's `pyproject.toml` configuration.
- Cross-language result schemas are validated by the TypeScript Zod and Python Pydantic suites.

## Quality gates

| Command | Scope |
|---|---|
| `pnpm validate` | `check` (Rust, TypeScript with `@dicee/shared` built first, Python, Worker types), `lint` (Rust, Python, Biome, AKG, Cloudflare config audit, `test:scripts`, docs gate), `test:agent`, `build` |
| `pnpm validate:ci` | `validate`, then `audit:dependencies` (`pnpm audit --audit-level high`) and `security:public` |

The [public manifest release](../../vendor/project-manifest/README.md) is byte-pinned and checked offline through `lint:docs`; CI uses its exact checkout revision and a dedicated Git 2.56 prefix. The declared mise setup/format-check tasks reuse native commands; `format_check` also runs Biome lint. The manifest preserves the dated phase and uses `maintained` as a source-maintenance declaration, not a fresh live readback.

The lefthook pre-push hook and CI run `pnpm validate:ci`. `test:scripts` runs every shell test in `scripts/tests/` and fails if none exist. What each test lane covers is in [testing.md](testing.md).

## Cloudflare

Configuration for both Workers (`dicee-web` and `dicee`), the deploy path, and live checks live in [docs/cloudflare.md](../cloudflare.md). The toolchain rule is the Wrangler hold above.

## Agent clients

Client configuration, MCP servers, skills, and Codex rules live in [agent-clients.md](agent-clients.md).

## Local limitations

- Clean clones need `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`, because the web app imports them from `$env/static/public`. Copy `packages/web/.env.example` to an ignored .env file beside it and fill in local values, or use the non-secret placeholders CI sets in `.github/workflows/ci.yml`.
- Supabase CLI 2.117.0 warns that the `[inbucket]` section of `supabase/config.toml` is deprecated in favour of `[local_smtp]`. The warning is harmless; rename the section together with the next CLI bump.

## References

- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)
- [pnpm 11 release notes](https://pnpm.io/blog/releases/11.0)
- [pnpm settings](https://pnpm.io/settings)
- [TypeScript 7 announcement and ecosystem caveat](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Vite 8 migration guide](https://vite.dev/guide/migration.html)
- [Vitest agent reporter (added in 4.1)](https://vitest.dev/blog/vitest-4-1.html) and [Vitest 5 migration guide](https://vitest.dev/guide/migration.html)
- [Cloudflare Workers changelog](https://developers.cloudflare.com/changelog/product/workers/)
- [Cloudflare compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)
- [Supabase CLI releases](https://github.com/supabase/cli/releases)
- [mise aqua backend](https://mise.jdx.dev/dev-tools/backends/aqua.html)
