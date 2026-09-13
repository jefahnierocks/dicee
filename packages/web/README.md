# @dicee/web

The Dicee SvelteKit 2 / Svelte 5 app, deployed to Cloudflare Pages. Read [AGENTS.md](AGENTS.md) before editing this package.

## Setup

From the repository root, run `pnpm install --frozen-lockfile`. Then copy `packages/web/.env.example` to a .env file beside it and set the public Supabase URL and anon key for your local stack. The .env file is ignored.

## Commands

Run these from the repository root as `pnpm --filter @dicee/web <script>`.

| Script | Purpose |
|---|---|
| `dev` | Vite dev server on port 5173 (`pnpm dev` at the root; `pnpm dev:full` adds the Worker) |
| `dev:network`, `dev:mobile` | Dev server reachable from other devices on the LAN |
| `build`, `preview` | Production build and local preview |
| `check` | `svelte-kit sync` and `svelte-check` |
| `test:agent`, `test`, `test:watch` | Vitest unit and component tests |
| `test:e2e`, `test:mobile` | Playwright tests |
| `biome:check`, `format` | Lint and format |
| `types`, `types:check` | Generate or check `worker-configuration.d.ts` from `wrangler.jsonc` |
| `pages:dev` | Serve the built Pages output locally with Wrangler |

The deploy scripts are operator-only; see [docs/cloudflare.md](../../docs/cloudflare.md). Testing details are in [docs/development/testing.md](../../docs/development/testing.md).
