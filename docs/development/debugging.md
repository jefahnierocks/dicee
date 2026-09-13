# Debugging

- Reproduce the bug locally before changing code.
- Trace first: find where the chain breaks before reading more code.
- Diagnostics go through the structured loggers and are removed before commit. Never commit debug logs or ad hoc `console.log` calls.
- Production observation (dashboards, live logs, readbacks) is read-only and done by the operator. Never ship a build only to add logging.

## Reproduce locally

- `pnpm dev` runs the web app, `pnpm dev:do` runs the Worker (`wrangler dev --env development`), and `pnpm dev:full` runs both.
- Local Durable Object storage lives in the ignored Wrangler state directory inside `packages/cloudflare-do`. Delete it to start from empty rooms.
- Turn the bug into a failing focused test when you can, for example `pnpm --filter @dicee/cloudflare-do exec vitest run src/game/__tests__/machine.test.ts -t canRollDice`. The test stays after the fix.
- Local stack setup and the two-browser room test are in [testing.md](testing.md#websocket-manual-test).

## Trace first

1. Write down the event chain from the user action to the visible result. For example: click, handler, store, WebSocket send, `GameRoom` handler, validator, state write, broadcast, client schema, store, render.
2. Add one log at the boundary between the last step known to work and the first unknown step.
3. Reproduce, then read the result.
4. Bisect: move the probe to the middle of the unknown part. A 13-step chain needs at most 4 probes.
5. Fix the break, add a test for it, and remove the probes.

## Structured logging

- **Worker.** `createLogger` and `Loggers` in `packages/cloudflare-do/src/lib/logger.ts` write one JSON object per entry with a dotted event name. `sanitizeLogValue` redacts credential and personal-identifier keys, bearer tokens and email addresses, and truncates long values. Pass context as fields; never build messages from raw user data.
- **Web.** `logger` and `createServiceLogger` are in `packages/web/src/lib/utils/logger.ts`.
- **Where output appears.** Worker logs print in the `pnpm dev:do` terminal, SvelteKit server logs in the `pnpm dev` terminal, and client logs in the browser console.

## WebSocket break points

| Symptom | Check |
|---|---|
| Client never sends | Handler wiring, disabled buttons and socket state in `packages/web/src/lib/services/roomService.svelte.ts` |
| Server rejects the envelope | `GameRoom` answers `INVALID_MESSAGE` when a message fails to parse or validate (`packages/cloudflare-do/src/GameRoom.ts`) |
| A game rule refuses the action | `canStartGame`, `canRollDice`, `canKeepDice`, `canScoreCategory` and `canRematch` in `packages/cloudflare-do/src/game/machine.ts` |
| Broadcast never arrives | Hibernation tags `player:<code>` and `spectator:<code>` choose the recipients |
| Client drops the event | The server emits UPPERCASE types (`packages/shared/src/validation/schemas.ts`) and the client parses them with `ServerEventSchema` (`packages/web/src/lib/types/multiplayer.schema.ts`), so a renamed type fails validation |

Close code 1006 means the peer disappeared without a close frame (device sleep, a backgrounded tab, or a network change). The client reconnects through `reconnecting-websocket` with `maxRetries` 10, and the seat stays reserved for the 5-minute reconnect window.

## Multiplayer checklist

- **"Room is full" (`ROOM_FULL`).** Compare `settings.maxPlayers`, stored when the room was created, with the occupied seats. A disconnected seat whose `reconnectDeadline` has not passed still counts as occupied.
- **Host-only events missing.** Check the seat's `isHost`, the socket attachment's `isHost`, and `RoomState.hostUserId` (`packages/cloudflare-do/src/types.ts`).
- **Room chat lost.** Check the `chat:messages` storage key in `packages/cloudflare-do/src/chat/ChatManager.ts`.
- **Reconnect fails.** The seat must still exist and its `reconnectDeadline` must still be in the future.

## When only production shows it

Write down the trace so far, the local evidence, and the exact read-only observation you need, such as a dashboard view, a log query or a readback. The operator runs it. The result goes in the PR description, or in the readbacks section of [status.md](../status.md) when it records live state.
