# Multiplayer Persistence Architecture

> **Status**: Complete (Phases 1-4)
> **Last Updated**: 2025-12-11
> **Commits**: 9a7ffa4, 0e748e6, 14c9ac7

## Executive Summary

A resilient multiplayer system using Cloudflare Durable Objects with:
- **5-minute seat reservation** for disconnected players
- **Dual WebSocket pattern** (persistent lobby + ephemeral room connections)
- **Storage-first mutations** surviving DO hibernation
- **Real-time UI** showing connection states and reconnection countdowns

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE EDGE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────────┐       ┌─────────────────────────────┐    │
│   │    GlobalLobby      │       │        GameRoom             │    │
│   │    (Singleton)      │       │      (Per-Room DO)          │    │
│   │                     │       │                             │    │
│   │  • Online users     │       │  • Seat management          │    │
│   │  • Room directory   │       │  • Game state               │    │
│   │  • Chat history     │       │  • Chat history             │    │
│   │  • User presence    │       │  • Reconnection handling    │    │
│   └─────────┬───────────┘       └──────────────┬──────────────┘    │
│             │                                   │                   │
│             │ WebSocket (App Lifetime)          │ WebSocket (Room)  │
│             │                                   │                   │
└─────────────┼───────────────────────────────────┼───────────────────┘
              │                                   │
              ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SVELTEKIT CLIENT                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   ┌─────────────────────┐       ┌─────────────────────────────┐    │
│   │   lobby.svelte.ts   │       │  multiplayerGame.svelte.ts  │    │
│   │                     │       │                             │    │
│   │  • connectPromise   │       │  • disconnectedPlayers[]    │    │
│   │  • intentionalDC    │       │  • didReconnect flag        │    │
│   │  • onlineUsers[]    │       │  • reconnectionHandlers     │    │
│   └─────────────────────┘       └─────────────────────────────┘    │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │                    UI Components                             │  │
│   │  • ConnectionStatusBanner.svelte  (user's own status)       │  │
│   │  • DisconnectedPlayersBanner.svelte (opponents' countdowns) │  │
│   └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Core Data Structures

### PlayerSeat (Server)

```typescript
// packages/cloudflare-do/src/types.ts
export const RECONNECT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export interface PlayerSeat {
  userId: string;
  displayName: string;
  avatarSeed: string;
  joinedAt: number;          // Unix timestamp
  isConnected: boolean;      // Current connection state
  disconnectedAt: number | null;    // When they disconnected
  reconnectDeadline: number | null; // Unix timestamp for expiration
  isHost: boolean;           // First player is host
  turnOrder: number;         // Position in turn sequence
}
```

### DisconnectedPlayer (Client)

```typescript
// packages/web/src/lib/stores/multiplayerGame.svelte.ts
export interface DisconnectedPlayer {
  userId: string;
  displayName: string;
  reconnectDeadline: number; // Unix timestamp for countdown
}
```

### Connection Attachment (Server WebSocket)

```typescript
// packages/cloudflare-do/src/types.ts
export interface ConnectionAttachment {
  userId: string;
  displayName: string;
  avatarSeed: string;
  role: 'player' | 'spectator';
  joinedAt: number;
}
```

---

## Storage Schema

### GlobalLobby Storage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `lobby:chatHistory` | `ChatMessage[]` | Persisted chat (max 100) |

### GameRoom Storage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `seats` | `[string, PlayerSeat][]` | Serialized Map of player seats |
| `gameState` | `GameState` | Current game state |
| `chatHistory` | `ChatMessage[]` | Room chat history |
| `roomCode` | `string` | Room identifier |

---

## State Machines

### Player Seat Lifecycle

```
                    ┌──────────────┐
                    │   NO_SEAT    │
                    └──────┬───────┘
                           │ reserveSeat()
                           ▼
                    ┌──────────────────┐
            ┌──────►│ SEATED_CONNECTED │◄─────────┐
            │       └────────┬─────────┘          │
            │                │                    │
            │                │ webSocketClose()   │ handleReconnection()
            │                ▼                    │
            │       ┌────────────────────┐        │
            │       │ SEATED_DISCONNECTED │───────┘
            │       └────────┬───────────┘
            │                │
            │                │ alarm() [deadline passed]
            │                ▼
            │       ┌──────────────┐
            └───────│   EXPELLED   │ (seat deleted)
                    └──────────────┘
```

### Lobby Connection Lifecycle

```
     App Load              Navigation              Logout
         │                     │                     │
         ▼                     │                     ▼
    ┌─────────┐               │              ┌─────────────┐
    │ CONNECT │               │              │ DISCONNECT  │
    └────┬────┘               │              │(intentional)│
         │                     │              └─────────────┘
         ▼                     │
    ┌─────────┐               │
    │CONNECTED│◄──────────────┘
    └────┬────┘    (stays connected!)
         │
         │ connection lost
         ▼
    ┌────────────┐
    │RECONNECTING│───► (auto-reconnect unless intentionalDisconnect)
    └────────────┘
```

---

## Key Implementation Details

### 1. Idempotent Lobby Connection

```typescript
// packages/web/src/lib/stores/lobby.svelte.ts
class LobbyStore {
  private connectPromise: Promise<void> | null = null;
  private intentionalDisconnect = false;

  connect(): Promise<void> {
    this.intentionalDisconnect = false;

    // Return existing promise if already connecting
    if (this.connectPromise) return this.connectPromise;
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.connectPromise = this.connectToServer();
    return this.connectPromise;
  }

  disconnect(): void {
    this.intentionalDisconnect = true;  // Prevents auto-reconnect
    this.ws?.close(1000, 'User logout');
    this.connectPromise = null;
  }
}
```

### 2. Storage-First Pattern

All mutations follow: **Storage → Memory → Broadcast**

```typescript
// packages/cloudflare-do/src/GlobalLobby.ts
private async saveChatMessage(message: ChatMessage): Promise<void> {
  // 1. Load from storage (hibernation-safe)
  const history = await this.loadChatHistory();

  // 2. Update in memory
  history.push(message);
  if (history.length > MAX_CHAT_HISTORY) {
    this.chatHistory = history.slice(-MAX_CHAT_HISTORY);
  } else {
    this.chatHistory = history;
  }

  // 3. Persist to storage
  await this.ctx.storage.put(STORAGE_KEYS.CHAT_HISTORY, this.chatHistory);

  // 4. Broadcast to clients
  this.broadcast({ type: 'chat', payload: message });
}
```

### 3. Seat Reservation on Disconnect

```typescript
// packages/cloudflare-do/src/GameRoom.ts
async markSeatDisconnected(userId: string): Promise<void> {
  const seats = await this.getSeats();
  const seat = seats.get(userId);

  if (seat) {
    seat.isConnected = false;
    seat.disconnectedAt = Date.now();
    seat.reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;
    seats.set(userId, seat);
    await this.saveSeats(seats);

    // Schedule alarm for expiration
    const existingAlarm = await this.ctx.storage.getAlarm();
    if (!existingAlarm || existingAlarm > seat.reconnectDeadline) {
      await this.ctx.storage.setAlarm(seat.reconnectDeadline);
    }

    // Notify other players
    this.broadcast({
      type: 'PLAYER_DISCONNECTED',
      payload: {
        userId,
        displayName: seat.displayName,
        reconnectDeadline: seat.reconnectDeadline
      }
    });
  }
}
```

### 4. Reconnection Handling

```typescript
// packages/cloudflare-do/src/GameRoom.ts
async handleReconnection(userId: string): Promise<boolean> {
  const seats = await this.getSeats();
  const seat = seats.get(userId);

  if (!seat) return false;

  // Check if within reconnection window
  if (seat.reconnectDeadline && Date.now() > seat.reconnectDeadline) {
    return false; // Expired - join as spectator
  }

  // Reclaim seat
  seat.isConnected = true;
  seat.disconnectedAt = null;
  seat.reconnectDeadline = null;
  seats.set(userId, seat);
  await this.saveSeats(seats);

  // Notify others
  this.broadcast({
    type: 'PLAYER_RECONNECTED',
    payload: { userId, displayName: seat.displayName }
  });

  return true;
}
```

### 5. Alarm-Based Expiration

```typescript
// packages/cloudflare-do/src/GameRoom.ts
async alarm(): Promise<void> {
  const seats = await this.getSeats();
  const now = Date.now();
  let nextAlarm: number | null = null;

  for (const [userId, seat] of seats) {
    if (!seat.isConnected && seat.reconnectDeadline) {
      if (now >= seat.reconnectDeadline) {
        // Seat expired - remove player
        seats.delete(userId);
        this.broadcast({
          type: 'PLAYER_SEAT_EXPIRED',
          payload: { userId, displayName: seat.displayName }
        });
      } else if (!nextAlarm || seat.reconnectDeadline < nextAlarm) {
        nextAlarm = seat.reconnectDeadline;
      }
    }
  }

  await this.saveSeats(seats);

  if (nextAlarm) {
    await this.ctx.storage.setAlarm(nextAlarm);
  }
}
```

---

## Event Schemas

```typescript
// packages/web/src/lib/types/multiplayer.schema.ts
const PlayerDisconnectedEventSchema = z.object({
  type: z.literal('PLAYER_DISCONNECTED'),
  payload: z.object({
    userId: z.string(),
    displayName: z.string(),
    reconnectDeadline: z.number(),
  }),
});

const PlayerReconnectedEventSchema = z.object({
  type: z.literal('PLAYER_RECONNECTED'),
  payload: z.object({
    userId: z.string(),
    displayName: z.string(),
    avatarSeed: z.string().optional(),
  }),
});

const PlayerSeatExpiredEventSchema = z.object({
  type: z.literal('PLAYER_SEAT_EXPIRED'),
  payload: z.object({
    userId: z.string(),
    displayName: z.string(),
  }),
});
```

---

## UI Components

### ConnectionStatusBanner

Shows user's own connection status:
- **Reconnecting**: Spinner + "Reconnecting to game..."
- **Reconnected**: Success toast with dismiss button
- **Error**: Warning with retry indicator

```svelte
<!-- packages/web/src/lib/components/game/ConnectionStatusBanner.svelte -->
{#if isReconnecting}
  <div class="connection-banner reconnecting">
    <span class="spinner"></span>
    <span>Reconnecting to game...</span>
  </div>
{:else if didReconnect && isConnected}
  <div class="connection-banner reconnected">
    <span>✓</span>
    <span>Successfully reconnected!</span>
    <button onclick={handleDismiss}>×</button>
  </div>
{/if}
```

### DisconnectedPlayersBanner

Shows opponent disconnection status with countdown:
- Lists all disconnected players
- Real-time countdown (1s interval)
- Urgency styling: normal (>60s), warning (30-60s), critical (<30s)
- Pulsing animation on critical

```svelte
<!-- packages/web/src/lib/components/game/DisconnectedPlayersBanner.svelte -->
{#each disconnectedPlayers as player}
  {@const urgency = getUrgency(player.reconnectDeadline)}
  <div class="player-item" class:critical={urgency === 'critical'}>
    <span class="player-name">{player.displayName}</span>
    <span class="countdown" class:pulse={urgency === 'critical'}>
      {formatTimeRemaining(player.reconnectDeadline)}
    </span>
  </div>
{/each}
```

---

## File Reference

### Server (Durable Objects)

| File | Purpose |
|------|---------|
| `packages/cloudflare-do/src/types.ts` | Core types: PlayerSeat, ConnectionAttachment, RECONNECT_WINDOW_MS |
| `packages/cloudflare-do/src/GlobalLobby.ts` | Singleton DO: chat persistence, online users, room directory |
| `packages/cloudflare-do/src/GameRoom.ts` | Per-room DO: seat management, game state, reconnection |

### Client (SvelteKit)

| File | Purpose |
|------|---------|
| `packages/web/src/lib/stores/lobby.svelte.ts` | Lobby connection: idempotent connect, intentional disconnect |
| `packages/web/src/lib/stores/multiplayerGame.svelte.ts` | Game state: disconnectedPlayers, didReconnect |
| `packages/web/src/lib/services/roomService.svelte.ts` | Room WebSocket: ReconnectingWebSocket wrapper |
| `packages/web/src/lib/types/multiplayer.schema.ts` | Zod schemas for all multiplayer events |

### UI Components

| File | Purpose |
|------|---------|
| `ConnectionStatusBanner.svelte` | User's own connection status |
| `DisconnectedPlayersBanner.svelte` | Opponent disconnection countdowns |
| `MultiplayerGameView.svelte` | Main game view integrating banners |

---

## Testing Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Navigate lobby → room → lobby | Lobby WS stays connected |
| Phone sleeps during game | Seat reserved for 5 minutes |
| Reconnect within 5 minutes | Reclaim seat, continue playing |
| Reconnect after 5 minutes | Join as spectator |
| Player disconnects | Others see countdown banner |
| Player reconnects | Others see "reconnected" message |
| Close browser completely | Seat reserved until timeout |
| Chat messages after hibernation | History loaded from storage |

---

## Debugging Lessons & Critical Patterns

> **Updated**: 2025-12-15 (from production debugging session)

### 1. Room Settings Persistence

**Critical**: Room settings are **stored at creation time** and persist indefinitely.

```typescript
// When a room is created, settings are stored once:
roomState = createInitialRoomState(roomCode, connState.userId);
await this.ctx.storage.put('room', roomState);

// These settings NEVER update automatically after creation
```

**Implications**:
- Changing `DEFAULT_ROOM_SETTINGS` only affects **new** rooms
- Existing rooms keep their original settings (e.g., `maxPlayers: 2`)
- To fix old rooms: create new rooms or implement migration logic

**Pattern**: When fixing default values, consider:
1. The fix only applies to newly created resources
2. Existing resources may need explicit migration

### 2. Chat History Persistence

Chat messages are persisted server-side and loaded on every connection:

```typescript
// ChatManager.ts - Initialization on every connection
async initialize(): Promise<void> {
  if (this.initialized) return;  // Idempotent

  const [messages, rateLimits] = await Promise.all([
    this.ctx.storage.get<ChatMessage[]>(STORAGE_KEYS.MESSAGES),
    this.ctx.storage.get<Record<string, RateLimitState>>(STORAGE_KEYS.RATE_LIMITS),
  ]);

  this.messages = messages ?? [];
  this.initialized = true;
}

// GameRoom.ts - Every player connection receives history
private sendChatHistory(ws: WebSocket): void {
  const history = this.chatManager.getHistory();
  ws.send(JSON.stringify(createChatHistoryResponse(history)));
}
```

**Flow**: Player connects → DO wakes from hibernation → ChatManager loads from storage → History sent to player

### 3. Host Flag Tracking

The `isHost` flag is stored in the `PlayerSeat` and restored on reconnection:

```typescript
// Seat creation stores isHost
const seat = createPlayerSeat(userId, displayName, avatarSeed, isHost, turnOrder);

// Reconnection restores from seat
if (reconnectionResult.success && reconnectionResult.seat) {
  connState.isHost = reconnectedSeat.isHost;  // From seat
  ws.serializeAttachment(connState);
}

// Fallback: check against roomState.hostUserId
connState.isHost = connState.userId === roomState.hostUserId;
```

**Pattern**: Host identification has three layers:
1. `PlayerSeat.isHost` - persisted in storage
2. `ConnectionState.isHost` - attached to WebSocket
3. `RoomState.hostUserId` - authoritative source

### 4. Join Request Flow

```
┌──────────────┐    REQUEST_JOIN     ┌──────────────┐
│  GlobalLobby │ ──────────────────► │   GameRoom   │
│  (Router)    │    via RPC          │  (Handler)   │
└──────────────┘                     └──────┬───────┘
                                            │
                        ┌───────────────────┴───────────────────┐
                        │                                       │
                        ▼                                       ▼
              ┌─────────────────┐                    ┌─────────────────┐
              │ Capacity Check  │                    │ Host Notification│
              │ maxPlayers vs   │                    │ notifyHostOf... │
              │ connectedPlayers│                    │ finds host WS   │
              └─────────────────┘                    └─────────────────┘
```

**Capacity Check** (`handleJoinRequest`):
- Counts `getConnectedPlayerCount()` - number of WebSockets with `player:${roomCode}` tag
- Adds AI players: `connectedPlayers + (roomState.aiPlayers?.length ?? 0)`
- Compares against `roomState.settings.maxPlayers`

**Host Notification** (`notifyHostOfJoinRequest`):
- Gets all player WebSockets: `ctx.getWebSockets('player:${roomCode}')`
- Finds host via attachment: `ws.deserializeAttachment().isHost === true`
- Sends `JOIN_REQUEST_RECEIVED` event to host

### 5. WebSocket Close Code 1006

```
WebSocket closed: 1006 - WebSocket disconnected without sending Close frame.
```

**Causes**:
- Browser tab backgrounding (mobile/laptop sleep)
- Network interruption
- Cloudflare WebSocket timeout
- User closing browser abruptly

**Handling**: The reconnection system handles this via:
1. 5-minute seat reservation
2. Automatic reconnect via ReconnectingWebSocket
3. Seat reclamation on reconnect

### 6. Debug Logging Pattern

When debugging multiplayer issues, add comprehensive logging at key points:

```typescript
// Capacity check logging
console.log(`[GameRoom] JOIN REQUEST - Room capacity check:`, {
  maxPlayers: roomState.settings.maxPlayers,
  connectedPlayers,
  totalPlayerCount: playerCount,
  seatsSize: seats.size,
  roomStatus: roomState.status,
  hostUserId: roomState.hostUserId,
});

// Seat state logging
for (const [id, seat] of seats) {
  console.log(`[GameRoom] Seat ${id}:`, {
    displayName: seat.displayName,
    isConnected: seat.isConnected,
    isHost: seat.isHost,
    reconnectDeadline: seat.reconnectDeadline,
  });
}
```

**Operational note:** The former direct deploy-and-tail command is superseded.
Use [`docs/cloudflare/README.md`](../cloudflare/README.md); deployment and live
observability are operator-gated, and the GitHub workflow is the canonical
production path.

---

## Common Debugging Checklist

| Issue | Investigation Steps |
|-------|---------------------|
| "Room is full" error | 1. Check `maxPlayers` in room state (may be old default) |
|                      | 2. Count seats vs WebSocket connections |
|                      | 3. Check for stale seats with expired reconnect windows |
| Host not receiving events | 1. Verify `isHost` in seat storage |
|                           | 2. Check WebSocket attachment has `isHost: true` |
|                           | 3. Verify host WS found in `getWebSockets()` |
| Chat history lost | 1. Verify `ChatManager.initialize()` called |
|                   | 2. Check storage has `chat:messages` key |
|                   | 3. Confirm `sendChatHistory()` called on connect |
| Reconnection fails | 1. Check seat exists in storage |
|                    | 2. Verify `reconnectDeadline` not expired |
|                    | 3. Confirm `handleReconnection()` called |

---

## Related Documentation

- `/docs/multiplayer-state-machines.md` - Detailed state machine diagrams
- `/docs/multiplayer-resilience-spec.md` - Original implementation plan
- `/.claude/plans/functional-drifting-spindle.md` - Phase tracking
