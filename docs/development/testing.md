# Testing

The commands are listed in [AGENTS.md](../../AGENTS.md#commands). This page says what each lane covers and how to run the checks that no gate runs.

## Lanes

| Command | Covers | In `pnpm validate` |
|---|---|---|
| `pnpm test:agent` | Rust engine, web, Worker unit, simulation and analysis tests with concise reporters | yes |
| `pnpm test` | the same lanes with default reporters | no |
| `pnpm test:rust` | engine unit, property and doc tests (`packages/engine`) | yes |
| `pnpm --filter @dicee/web test:agent` | web unit and component tests | yes |
| `pnpm --filter @dicee/cloudflare-do test:agent` | Worker tests matching `src/**/*.test.ts`, integration files included | yes |
| `pnpm --filter @dicee/simulation test:agent` | simulation framework | yes |
| `pnpm test:analysis` | analysis package (pytest through uv) | yes |
| `pnpm test:scripts` | shell tests in `scripts/tests/` | yes, in `lint` |
| `pnpm cf:audit` | Cloudflare config invariants | yes, in `lint` |
| `pnpm --filter @dicee/cloudflare-do test:integration` | Worker `*.integration.test.ts` files only, in a single fork | yes, through `test:agent` |
| `pnpm --filter @dicee/web test:e2e` | Playwright end-to-end tests | no |
| `supabase db reset --local && supabase test db` | migrations and pgTAP on the local stack | no |

Add focused tests with every behavior change, and run the narrowest lane while iterating.

## Web unit and component tests

`packages/web/vitest.config.ts` runs Vitest in jsdom with `packages/web/vitest.setup.ts`. Component tests use Testing Library and assert user-visible behavior and accessible roles. Files named `*.runtime.test.ts`, such as `packages/web/src/lib/server/ws-proxy.runtime.test.ts`, import `miniflare` to run code inside workerd.

Focused run: `pnpm --filter @dicee/web exec vitest run src/lib/server/ws-proxy.runtime.test.ts`.

## Worker unit and integration

- **Unit.** `packages/cloudflare-do/vitest.config.ts` covers the game rules and state machine, chat, auth, spectators, AI, `lib` and observability tests. Mocked Durable Object storage patterns live in `packages/cloudflare-do/src/game/__tests__/state.test.ts`.
- **Focused run.** Vitest filters by test name with `-t`: `pnpm --filter @dicee/cloudflare-do exec vitest run src/game/__tests__/machine.test.ts -t canStartGame`.
- **Integration.** `pnpm --filter @dicee/cloudflare-do test:integration` uses `packages/cloudflare-do/vitest.integration.config.ts`, which runs only `*.integration.test.ts` files, one at a time in a single fork. The default config's `src/**/*.test.ts` include also matches those files, so `test:agent`, `pnpm test:agent` and `pnpm validate` already run `src/__tests__/worker.integration.test.ts`, and `test:all` runs it twice. The roadmap's Worker test split separates the lanes.
- **Limit.** The integration test starts the Worker with Wrangler `unstable_dev`, whose fetch cannot send a WebSocket `Upgrade`. Socket behavior is checked by the manual test below until the test harness is replaced ([roadmap.md](../roadmap.md)).

## WebSocket manual test

**Request path.** The browser opens the same-origin `/ws/room/<CODE>` from `packages/web/src/lib/services/roomService.svelte.ts`. The route `packages/web/src/routes/ws/room/[code]/+server.ts` requires a validated session, strips any inbound `Authorization` header, and forwards `Bearer <session token>` over the `GAME_WORKER` service binding to the Worker's `/room/:code` route (`packages/cloudflare-do/src/worker.ts`). Without the binding the route answers 503.

**Setup.**

1. Start the local Supabase stack (`pnpm db:start`). The local Worker has no HS256 fallback, so room sockets need a stack that signs sessions with asymmetric keys (`signing_keys_path` under `[auth]` in `supabase/config.toml`). [cloudflare.md](../cloudflare.md) explains the limitation.
2. Put the Worker's `secrets.required` names for the local stack in the ignored `.dev.vars` file inside `packages/cloudflare-do`.
3. Run `pnpm dev:full` (web on port 5173 plus `wrangler dev --env development`). In Vite dev, `@sveltejs/adapter-cloudflare` builds `platform.env` with Wrangler's `getPlatformProxy`, which reads `packages/web/wrangler.jsonc`.
4. Sign in as two local test identities in two browser profiles, create a room in one, and join it with the code in the other.

**Unconfirmed.** It has not been confirmed that the dev `GAME_WORKER` binding, which names the Worker `dicee`, reaches a Worker started with `--env development`. A 503 from `/ws/room/<CODE>` means the binding did not resolve. Record the working steps here once confirmed.

**Scenarios.**

- Two-player turn cycle: the host starts, then each player rolls, keeps and scores.
- Disconnect and reclaim: close one tab and rejoin inside the reconnect window (`RECONNECT_WINDOW_MS`, 5 minutes, in `packages/cloudflare-do/src/types.ts`).
- AFK: an idle turn warns at 45 s and is skipped at 60 s (`AFK_WARNING_SECONDS`, `AFK_TIMEOUT_SECONDS` in `packages/shared/src/types/game.ts`).

Message types are UPPERCASE (`START_GAME`, `DICE_ROLL`, `DICE_KEEP`, `CATEGORY_SCORE`, `CHAT`), defined in `packages/shared/src/validation/schemas.ts`. Never copy a live session token into a command-line WebSocket client.

## E2E

`pnpm --filter @dicee/web test:e2e` runs Playwright with `packages/web/playwright.config.ts`. The config starts `pnpm dev` on port 5173. The specs are `packages/web/tests/auth.spec.ts` and `packages/web/tests/chat.spec.ts`. `test:e2e:ui` opens the Playwright UI and `test:mobile` runs the mobile browser projects. Before the first run, install the browsers with `pnpm --filter @dicee/web exec playwright install`.

## Local Supabase

- `pnpm db:start`, `pnpm db:status` and `pnpm db:stop` drive the pinned CLI.
- `supabase db reset --local && supabase test db` rebuilds the local database from `supabase/migrations/` and runs the pgTAP files in `supabase/tests/` (profile privileges, public security hardening, RPC functions).
- Add a pgTAP assertion with every migration that changes grants, policies or functions.
- Everything here is local. Linked or remote database commands and type regeneration need explicit authority and are not part of any gate.

## Simulation and analysis

- Simulations are seeded: `pnpm sim:run --profiles professor,carmen --games 500 --seed 42 --output ./results`. The same seed reproduces the same games, and tests keep their seeds fixed.
- The analysis package reads the NDJSON results; see [packages/analysis/README.md](../../packages/analysis/README.md). `pnpm test:analysis` runs its tests.

## Android

- **Same network.** `pnpm --filter @dicee/web dev:mobile` runs `packages/web/scripts/mobile-test.sh`, which prints the LAN URL. `dev:network` runs `vite dev --host`, and `pnpm --filter @dicee/web qr` prints a QR code for the URL.
- **USB.** `scripts/dicee-adb.sh` runs from zsh or bash. Its subcommands are `status`, `logs`, `capture`, `stop`, `ports`, `clear`, `bugreport`, `inspect`, `screenshot`, `shell` and `restart`. `ports` sets up `adb reverse` for 3000, 5173, 8787, 54321 and 54323, so the device reaches the local web app, Worker and Supabase.
- **Remote debugging.** Enable USB debugging, then open `chrome://inspect` on the desktop. To stream the device console into the terminal, forward DevTools with `adb forward tcp:9222 localabstract:chrome_devtools_remote`, then run `pnpm cdp:list`, `pnpm cdp:local`, or `pnpm cdp:monitor --url <pattern>`.
- **Log schemas.** Device test logs use the Zod schemas in `packages/web/src/lib/types/device-testing.schema.ts`.
- **References.** [Android Debug Bridge](https://developer.android.com/tools/adb) and [Chrome remote debugging for Android](https://developer.chrome.com/docs/devtools/remote-debugging).
