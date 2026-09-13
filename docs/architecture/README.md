# Dicee architecture

How the running system is built. Code, schemas and generated types are the authority: when this page disagrees with them, fix this page in the same change.

Current state and decisions: [status](../status.md). Ordered next work: [roadmap](../roadmap.md). Cloudflare platform: [cloudflare.md](../cloudflare.md). Import boundaries: [AKG guide](akg/README.md).

## System overview

Dicee is a small multiplayer dice game that teaches probability while you play.

| Package | Role |
|---|---|
| `packages/web` | SvelteKit 2 / Svelte 5 app on Cloudflare Pages: UI, auth, telemetry API, WebSocket proxy routes |
| `packages/cloudflare-do` | Worker `dicee` with the `GameRoom` and `GlobalLobby` SQLite Durable Objects |
| `packages/shared` | domain types, game constants and Zod schemas used by the web app and the Worker |
| `packages/engine` | Rust probability engine, compiled to WebAssembly and run in the browser |
| `packages/simulation` | seeded AI players and experiments |
| `packages/analysis` | Python analysis and validation |
| `supabase` | Postgres migrations and pgTAP tests (auth profiles, games, stats, telemetry) |

Request path:

```text
browser ── HTTPS ─────────────────────────────> SvelteKit on Pages
browser ── WebSocket /ws/lobby, /ws/room/CODE ─> SvelteKit route (adds the session bearer)
          └── GAME_WORKER service binding ────> Worker "dicee"
                ├── /lobby, /lobby/*  ────────> GlobalLobby (one instance, named "singleton")
                └── /room/CODE  ──────────────> GameRoom (one instance per room code)
```

The proxy routes are `packages/web/src/routes/ws/lobby/+server.ts` and `packages/web/src/routes/ws/room/[code]/+server.ts`; the Worker router is `packages/cloudflare-do/src/worker.ts`.

Product principles that shape the code:

- **Exact, not sampled.** The engine enumerates every roll outcome. There is no Monte Carlo path.
- **Statistics are opt-in.** Players choose how much to see: a stats profile (beginner, intermediate, expert) in `packages/web/src/lib/types.ts` and a coach level (off, hints, coach, training) in `packages/web/src/lib/stores/coach.svelte.ts`.
- **The server decides.** In multiplayer, the Durable Object rolls the dice and validates every move. The browser engine only advises.

## Engine

`packages/engine` (Rust 2024) computes the best single-turn decision. wasm-pack builds it into `packages/web/src/lib/wasm`, which is generated output: never hand-edit it.

**Configurations.** Five dice reduce to a `DiceConfig`: face counts `[u8; 6]` that sum to 5 (`packages/engine/src/core/config.rs`).

- There are 252 configurations, indexed by `ConfigIndex(u8)`. `from_dice`, `to_index` and `from_index` convert between them. `ALL_CONFIGS` and `CONFIG_MULTIPLICITIES` are compile-time statics.
- `multiplicity()` is the multinomial coefficient 5!/(n1!...n6!) over the 6^5 = 7,776 ordered outcomes.
- `KeepPattern` holds kept counts per face. `PartialDice` pairs a keep with the dice still to roll (`packages/engine/src/core/keep.rs`).

**Transitions.** `TRANSITION_TABLE` (`packages/engine/src/transition/table.rs`) is a `LazyLock` over a `HashMap` from partial state to `Vec<TransitionEntry>`. It stores only non-zero probabilities and is built on first use; it is not a dense matrix.

- The probability of a target when rolling k dice is its multinomial count times (1/6)^k (`packages/engine/src/transition/probability.rs`).
- Expected value sums P(target) times f(target) over one table row.

**Solver.** `TurnSolver` (`packages/engine/src/core/solver.rs`) evaluates one turn over the categories still open.

- With no rolls left, the value is the best immediate score. Otherwise it is the larger of the best immediate score and the best keep's expected value.
- The analysis (`packages/engine/src/core/turn.rs`) returns per-category values, the best immediate score, the continue value, the optimal keep, a recommendation (`Action::Score` or `Action::Reroll`) and the expected value.
- Scope is one turn. There is no upper-bonus or cross-turn lookahead.
- The memoization cache is inert. `TurnSolver` owns a cache keyed by configuration, rolls and category set, but `analyze` and `expected_value` take `&self` and never insert into it. The WASM export also builds a new `TurnSolver` for every call.
- The open categories are a `u16` bitmask: bit 0 is Ones, bit 12 is Chance, and `0x1FFF` means all (`packages/engine/src/core/category.rs`).

**Scoring constants.** Full house 25, small straight 30, large straight 40, Dicee 50; upper bonus 35 at 63 or more; Dicee bonus 100 for each extra Dicee (`packages/shared/src/types/category.ts`). The engine applies the fixed scores in `packages/engine/src/scoring/rules.rs`. The multiplayer game applies the bonuses in `packages/cloudflare-do/src/game/scoring.ts`.

**WASM boundary.** Only two functions are exported: `analyze_turn(dice, rolls_remaining, available_categories)` and `get_categories()` (`packages/engine/src/lib.rs`, typed in `packages/web/src/lib/wasm/dicee_engine.d.ts`).

- Invalid dice, or `rolls_remaining` above 2, return a string error.
- The result carries `action` (score or reroll), `recommended_category`, `category_score`, `keep_pattern` (six face counts), `keep_explanation`, `expected_value`, and `categories[]` entries with `category`, `immediate_score`, `is_valid` and `expected_value`.
- `packages/web/src/lib/engine.ts` is the only module that imports the WASM glue (AKG invariant `wasm_single_entry`). It validates the dice, the rolls and a non-empty category list, then builds the bitmask from `CATEGORY_TO_INDEX`.
- `packages/web/src/lib/services/engine.ts` lazy-loads that bridge with a dynamic import and tracks ready, initializing and failed states.
- There is no API version check. The bridge and the WASM build ship together in one web build.

**Tests.**

- `packages/engine/tests/known_positions.rs` covers known positions: Dicee scoring, both large straights, rerolling four of a kind for Dicee, full house, straight draws, forced scoring with no rolls left, expected value rising with rolls remaining, and empty or single-category sets.
- `packages/engine/tests/property_tests.rs` (proptest) checks the configuration round trip, index validity, count sums and multiplicity bounds.

## Data contracts

RFC-003 Data Contracts: Accepted (implemented); the Zod schemas in `packages/shared` and `packages/web/src/lib/types` are the contract. TypeScript types are derived from the schemas with `z.infer`, so change the schema first.

**Wire protocol.**

- Room traffic uses `CommandSchema` (client to room) and `ServerEventSchema` (room to client) in `packages/shared/src/validation/schemas.ts`. Both are Zod discriminated unions on `type`, with UPPERCASE names such as `START_GAME`, `DICE_ROLL`, `DICE_KEEP`, `CATEGORY_SCORE`, `CHAT`, `DICE_ROLLED` and `TURN_CHANGED`.
- Lobby traffic uses `LobbyCommandSchema` and `LobbyServerEventSchema` in `packages/shared/src/validation/lobby-schemas.ts`. Lobby room cards use `RoomInfoSchema` from the same file.
- The client validates inbound traffic. Room events pass `ServerEventSchema.safeParse` (`packages/web/src/lib/types/multiplayer.schema.ts`), and lobby events pass `parseLobbyServerEvent` in `packages/web/src/lib/stores/lobby.svelte.ts`.
- The Worker checks only the envelope. `GameRoom` and `GlobalLobby` require `type` to be a string and `correlationId` to match a safe pattern before dispatch. Only chat payloads have a schema (`packages/cloudflare-do/src/chat/schemas.ts`). Full inbound validation in the Durable Objects is roadmap work (App modernization).

**Game rules and types.**

- `packages/shared/src/types/game.ts` sets 13 turns, 2-4 players, a 3 s start countdown, an AFK warning at 45 s and an AFK timeout at 60 s. The game phases are waiting, starting, turn_roll, turn_decide, turn_score and game_over.
- The Durable Object state machine (`packages/cloudflare-do/src/game/machine.ts`) enforces game integrity: `canStartGame`, `canRollDice`, `canKeepDice`, `canScoreCategory`, `canRematch` and `validateTransition`. Rolls reset to `MAX_ROLLS_PER_TURN` each turn.
- The web dice types are the `DieValue`, `DiceArray` and `KeptMask` tuples in `packages/web/src/lib/types.ts`. Categories are PascalCase inside the web app and camelCase on the wire; `packages/web/src/lib/types/category-convert.ts` converts at the boundary.
- AKG guards the contract. `type_schema_consistency` requires each public type file to have a matching schema file with `z.infer` exports. `shared_isolation`, `globallobby_uses_shared` and `websocket_uses_shared_validation` keep the protocol in `packages/shared`.

**Event streams.** The schema defines three streams; two have writers.

| Stream | Writer | Store |
|---|---|---|
| Telemetry | `packages/web/src/lib/services/telemetry.ts` batches events with a session id and a consent flag. It flushes by `fetch`, or by `sendBeacon` on unload, to same-origin `/api/telemetry`. | Supabase `telemetry_events`, inserted by `packages/web/src/routes/api/telemetry/+server.ts`. A cron job deletes rows older than 30 days. |
| Domain | `GameRoom` records events in the Durable Object SQLite table `pending_domain_events` and sends them through the `persist_domain_events` RPC. | Supabase `domain_events`; `event_version` defaults to `1.0.0`. |
| Analysis | nothing writes it | Supabase `analysis_events`, with a 90-day cleanup function |

Telemetry event types are session_start, session_end, page_view, game_start, game_complete, roll, category_hover, category_score, hint_requested, decision_quality, prediction and error (`packages/web/src/lib/types/telemetry.ts`). Their payload schemas are in `packages/web/src/lib/types/telemetry.schema.ts`.

## Multiplayer

Durable Objects own all live room and lobby state, with strong consistency. Supabase keeps accounts and the record of finished games.

| Object | Instances | Owns |
|---|---|---|
| `GlobalLobby` | one, named `singleton` | presence, the room directory, lobby chat, and join-request routing (it calls the `GameRoom` `handleJoinRequest` RPC) |
| `GameRoom` | one per room code | seats, game state, room chat, AI players, spectators, alarms and the persistence queue |

Room codes are 6 characters drawn from `ROOM_CODE_CHARS` (`packages/shared/src/types/room.ts`).

### Storage

| Object | Key or table | Holds |
|---|---|---|
| `GlobalLobby` | `lobby:chatHistory` | lobby chat, capped at 50 messages |
| `GlobalLobby` | `lobby:activeRooms` | the room directory (`packages/cloudflare-do/src/lib/room-directory.ts`) |
| `GameRoom` | `room` | room state (`RoomState` in `packages/cloudflare-do/src/types.ts`) |
| `GameRoom` | `seats` | `PlayerSeat` entries keyed by user id |
| `GameRoom` | `room_code` | the room code, reloaded after hibernation |
| `GameRoom` | `alarm_queue` | multiplexed alarms (`packages/cloudflare-do/src/lib/alarm-queue.ts`); `alarm_data` is read only for older rooms |
| `GameRoom` | `ai_turn_state` | the scheduled AI turn |
| `GameRoom` | `chat:messages`, `chat:rateLimits` | room chat and its rate limits (`packages/cloudflare-do/src/chat/ChatManager.ts`) |
| `GameRoom` SQLite | `pending_domain_events`, `persistence_queue`, `game_metadata` | persistence bridge tables (`packages/cloudflare-do/src/lib/persistence/migrations.ts`) |

### Room lifecycle

- Shared room states are waiting, starting, playing, completed and abandoned (`packages/shared/src/types/room.ts`). The Durable Object adds `paused` (`RoomStatus` in `packages/cloudflare-do/src/types.ts`).
- A new room copies `DEFAULT_ROOM_SETTINGS`, so changed defaults apply only to rooms created afterwards.
- Seat admission counts active seats against `settings.maxPlayers`. Invite and join checks count AI players together with connected players.
- Join requests expire after 2 minutes (`JOIN_REQUEST_TTL_MS`) and invites after 5 minutes (`INVITE_EXPIRATION_MS`). Empty rooms are cleaned up after 5 minutes (`ROOM_CLEANUP_MS`).
- Host identity has three layers: `PlayerSeat.isHost`, `ConnectionState.isHost` on the socket attachment, and `RoomState.hostUserId`. Only `hostUserId` is authoritative.

### Seats, reconnection and pause

- Seats are keyed by the Supabase user id, not by the socket. `PlayerSeat` holds userId, displayName, avatarSeed, joinedAt, isConnected, disconnectedAt, reconnectDeadline, isHost, turnOrder and a per-seat alarm id.
- A disconnect keeps the seat for `RECONNECT_WINDOW_MS` (5 minutes). The room sets the deadline and schedules a `SEAT_EXPIRATION` alarm.
- A reclaim inside the window clears the deadline, cancels the alarm and resumes a paused room. When the window expires, the seat is deleted and the expiration is broadcast.
- A playing room with no player sockets becomes `paused`, with `pausedAt` set and a `PAUSE_TIMEOUT` alarm 30 minutes out (`PAUSE_TIMEOUT_MS`). A seat reclaim resumes it. On timeout the room becomes `abandoned` and its sockets close.

### Alarms

A Durable Object has one native alarm. `AlarmQueue` multiplexes it under the `alarm_queue` key; scheduling an alarm replaces any existing alarm of the same type and target.

- Alarm types: `TURN_TIMEOUT`, `AFK_CHECK`, `AFK_WARNING`, `AFK_TIMEOUT`, `ROOM_CLEANUP`, `SEAT_EXPIRATION`, `JOIN_REQUEST_EXPIRATION`, `AI_TURN_TIMEOUT` and `PAUSE_TIMEOUT`. The `AlarmType` union in `packages/cloudflare-do/src/types.ts` also declares `GAME_START`, which nothing schedules.
- `GameRoom.alarm()` handles due `AlarmQueue` entries first, then due persistence tasks.
- `GameRoom` still uses `setTimeout` for a few short in-process delays. New delayed work that must survive hibernation goes through the queue.

### Hibernation

- Constructors stay synchronous. They register a ping/pong auto-response, so heartbeats do not wake the object.
- `GameRoom` creates its SQLite tables inside `ctx.blockConcurrencyWhile`.
- Sockets are accepted with tags: `user:ID`, `room:CODE`, `role:ROLE`, and either `player:CODE` or `spectator:CODE`. Address a group with `ctx.getWebSockets(tag)`.
- Per-socket `ConnectionState` is stored with `serializeAttachment` and read back in `webSocketMessage`. The room code is reloaded from storage after a wake.
- Anything that must survive hibernation lives in storage or in the socket attachment.

### Storage first, server authority

- Write storage, then broadcast. `RoomDirectory` finishes its storage write before `upsert` or `remove` returns.
- Dice come from `crypto.getRandomValues` inside the Durable Object (`packages/cloudflare-do/src/game/scoring.ts`). Rolls, keeps and scores all pass the state-machine validators.

### Clients

- The lobby store (`packages/web/src/lib/stores/lobby.svelte.ts`) keeps one idempotent native WebSocket to `/ws/lobby`, guarded by `connectPromise` and `intentionalDisconnect`.
- Rooms connect through `reconnecting-websocket` with up to 10 retries (`packages/web/src/lib/services/roomService.svelte.ts`).
- Spectators connect to the room socket with `role=spectator` (`packages/web/src/lib/services/spectatorService.svelte.ts`).
- `packages/web/src/lib/stores/multiplayerGame.svelte.ts` tracks disconnected players and reconnection. `ConnectionStatusBanner` shows the local reconnecting state. `DisconnectedPlayersBanner` shows countdowns for opponents who dropped out.

## Persistence bridge

`GameRoom` writes game records to Supabase through RPCs. Game start awaits `create_game_atomic`; everything after that goes through a queue.

- The bridge runs only when the Worker has the Supabase service-role secret. Without it, persistence is skipped and the reason is logged.
- `SupabaseRpcClient` (`packages/cloudflare-do/src/lib/persistence/supabase-rpc.ts`) posts to the PostgREST RPC endpoint for `create_game_atomic`, `complete_game_atomic`, `persist_domain_events`, `abandon_game_atomic` and `aggregate_game_stats`. Each result carries a retriable flag.
- The functions are SECURITY DEFINER plpgsql. They are defined from `supabase/migrations/20260105000002_rpc_create_game.sql` through `supabase/migrations/20260105000006_rpc_aggregate_stats.sql`, and `supabase/tests/rpc_functions.sql` tests them.
- `PersistenceQueue` (`packages/cloudflare-do/src/lib/persistence/persistence-queue.ts`) stores tasks in the SQLite table `persistence_queue`. Task types are `PERSIST_GAME_COMPLETION`, `PERSIST_DOMAIN_EVENTS`, `TRIGGER_AGGREGATION` and `ABANDON_GAME`.
- At game end, `GameRoom` queues the completion, the domain events and, 500 ms later, the stats aggregation.
- The queue shares the native alarm. It moves the alarm only when its own task is due earlier.
- The domain-event sequence number survives hibernation as `event_sequence` in `game_metadata`. Completion rankings carry scorecards and AI flags.
- `packages/cloudflare-do/src/lib/persistence/schema-validation.ts` checks at compile time that persistence records are assignable to the generated Supabase insert types. Regenerating those types is an authenticated operator step, not part of the local gate.

Open defects: array RPC parameters, AI seats, abandonment scheduling and unchecked SQLite reads. They are listed under Supabase obligations in the [roadmap](../roadmap.md). Whether to repair the pipeline or freeze it is the owner's decision.

## Connection UX principles

1. **Life happens.** A dropped phone or a doorbell must not end the game for everyone.
2. **Identity, session and room are separate.** Seats belong to the user id, not the socket, so seat membership decides who may rejoin.
3. **Three presence states.** Players see connected, disconnected (inside the reconnect window) and abandoned. `GameRoom` derives them from seats for the lobby. There is no separate "removed" state.
4. **Everyone away pauses; it does not end.** Any seat reclaim resumes the game. After 30 minutes paused, the room is abandoned.
5. **Rejoin is one tap.** A seated, non-abandoned player in a waiting, playing or paused room skips the join request and goes straight to the room (`packages/web/src/lib/components/lobby/RoomCartridge.svelte`).
6. **Copy says what is happening, briefly.** The game banner shows "Reconnecting to game..." (`ConnectionStatusBanner`), and a player row shows "Reconnecting..." (`PlayerListItem`). The room button reads RECONNECT inside the window and REJOIN after it; otherwise it reads JOIN, WATCH or FULL.

Implemented timings: a 5-minute reconnect window, a 30-minute pause, 5-minute empty-room cleanup, and the 45 s AFK warning and 60 s AFK timeout. When a timing changes, update the code constant and this list together.

## UI principles

- **Neo-brutalist tokens.** `packages/web/src/lib/styles/tokens.css` defines the design language that the file attributes to RFC-002: hard edges, high contrast and visible structure. Borders are 1, 2, 3 or 4 px. Radius tokens are 0, 2 and 4 px, so square corners are the default, not a rule. The accent is electric gold, and numbers use the mono font stack.
- **One layer stack.** Use the z-index tokens: background 0, game 100, HUD 300, tooltip 400, modal 500, bottom sheet 600, alert 1000. Do not invent z-index values.
- **Statistics are optional layers.** They are category heat and an optimal-choice marker on each scorecard row (`CategoryRow`); a ribbon of the most likely non-zero outcomes, at most four (`ProbabilityRibbon`); a manual stats profile (`StatsToggle`); and coach levels (`CoachModeSelector`), where training asks for confirmation before a weak play.
- **Keyboard.** R or Space rolls, 1-5 toggle a die, A keeps all, and Z releases all (`packages/web/src/lib/hooks/useKeyboardNavigation.svelte.ts`, listed by `KeyboardHelp`). Escape closes chat.
- **Accessibility.** A global `:focus-visible` outline is set in `packages/web/src/lib/styles/global.css`. Reduced motion zeroes the transition tokens. Touch targets are at least 44 px, with 56 px as the comfortable size. Status and error banners use `role="alert"`.
- **Haptics.** Haptic feedback is a Svelte action (`packages/web/src/lib/actions/haptic.ts`), gated by `HapticsPreferencesSchema` in `packages/shared/src/validation/preferences.ts`.
- **Components document themselves.** `packages/web/src/lib/components` is grouped by feature (dice, scorecard, hud, game, lobby, chat, spectator, and more). Read the component before you add a new one.

## Layer rules

`akg.config.ts` is the single source for which layer may import which. `pnpm akg:check` enforces it, and `pnpm lint` runs that check through `pnpm akg:verify`.

- `packages/shared` is the foundation and imports no other layer. `packages/cloudflare-do` may import only shared.
- In `packages/web`: routes, then components, stores and services, then types, supabase and wasm. Every layer may import shared.
- Only `packages/web/src/lib/engine.ts` imports the WASM build.

Before adding an import, check it with the `akg_check_import` MCP tool; after the edit, run `pnpm akg:discover && pnpm akg:check`. The full matrix, the invariants and how to author a new one are in the [AKG guide](akg/README.md).
