# Dicee Spectator System — Lobby & Game Room Integration

## 1. Spectator Entry Points

There are **three ways** someone becomes a spectator:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SPECTATOR ENTRY POINTS                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. LOBBY BROWSER                                                           │
│     User in /lobby sees "🔴 LIVE" game → clicks "Watch" → joins as spec     │
│                                                                             │
│  2. ROOM OVERFLOW                                                           │
│     User joins full room (4/4) → offered spectator seat                     │
│                                                                             │
│  3. LATE JOIN                                                               │
│     User has room link, game already started → joins as spectator           │
│                                                                             │
│  4. PLAYER ELIMINATION (future)                                             │
│     In tournament mode, eliminated player becomes spectator                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. System Architecture

### 2.1 Two-DO Coordination

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              GLOBAL LOBBY DO                                │
│                                                                             │
│  Responsibilities:                                                          │
│  • Room directory (browse all rooms)                                        │
│  • Lobby chat & presence                                                    │
│  • Aggregate stats (online count, active games)                             │
│                                                                             │
│  Receives from GameRooms:                                                   │
│  • Room status updates (waiting → playing → finished)                       │
│  • Spectator counts                                                         │
│  • Live game highlights (Dicees, close finishes)                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ROOM DIRECTORY                                                      │   │
│  │                                                                      │   │
│  │  ABC123: { status: 'playing', round: 7, players: 4, spectators: 3 } │   │
│  │  XYZ789: { status: 'waiting', players: 2, spectators: 0 }           │   │
│  │  DEF456: { status: 'playing', round: 12, players: 3, spectators: 8 }│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    │ Room status updates (periodic + events)
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
        ▼                           ▼                           ▼
┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
│  GAME ROOM DO     │   │  GAME ROOM DO     │   │  GAME ROOM DO     │
│  (ABC123)         │   │  (XYZ789)         │   │  (DEF456)         │
│                   │   │                   │   │                   │
│  Players: [ws]x4  │   │  Players: [ws]x2  │   │  Players: [ws]x3  │
│  Spectators:[ws]x3│   │  Spectators: []   │   │  Spectators:[ws]x8│
│                   │   │                   │   │                   │
│  Status: playing  │   │  Status: waiting  │   │  Status: playing  │
│  Round: 7/13      │   │  Round: 0         │   │  Round: 12/13     │
└───────────────────┘   └───────────────────┘   └───────────────────┘
```

### 2.2 Connection Types in GameRoom

```typescript
// GameRoom DO manages two types of WebSocket connections

type ConnectionRole = 'player' | 'spectator';

interface RoomConnection {
  odl: 'player' | 'spectator';
  userId: string;
  displayName: string;
  joinedAt: number;
  
  // Player-only
  seat?: number;           // 0-3 for players
  
  // Spectator-only
  rootingFor?: string;     // Player ID they're backing
  inQueue?: boolean;       // Queued for next game
  queuePosition?: number;
}

// WebSocket tags for efficient querying
this.ctx.acceptWebSocket(server, [
  `role:${role}`,                    // 'role:player' or 'role:spectator'
  `user:${userId}`,                  // All connections for this user
  role === 'spectator' && rootingFor ? `rooting:${rootingFor}` : null,
].filter(Boolean));

// Query examples:
this.ctx.getWebSockets('role:player');      // All player connections
this.ctx.getWebSockets('role:spectator');   // All spectator connections
this.ctx.getWebSockets('rooting:player_1'); // Spectators rooting for player 1
```

---

## 3. Lobby → Spectator Flow

### 3.1 Room Card in Lobby Browser

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ACTIVE GAMES                                                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  🔴 LIVE   Room ABC123                              Round 7/13     │ │
│  │  ──────────────────────────────────────────────────────────────── │ │
│  │                                                                    │ │
│  │  Players:                                                          │ │
│  │  @jane (142) • @mike (138) • @sarah (156) • @tom (129)            │ │
│  │                                                                    │ │
│  │  👁 3 watching                                                     │ │
│  │                                                                    │ │
│  │  [Watch Game 👁]                                                   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  ⏳ WAITING   Room XYZ789                           2/4 players    │ │
│  │  ──────────────────────────────────────────────────────────────── │ │
│  │                                                                    │ │
│  │  Players: @alice • @bob • [empty] • [empty]                       │ │
│  │                                                                    │ │
│  │  [Join Game 🎮]                                                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Room Card States:**
- `waiting` → Show "Join Game" button
- `playing` → Show "Watch Game" button
- `full + waiting` → Show "Join Queue" or "Watch" 
- `finished` → Remove from active, show in recent results

### 3.2 Join Flow: Lobby → GameRoom

```typescript
// Client-side: User clicks "Watch Game" in lobby

async function watchGame(roomCode: string) {
  // 1. Navigate to game room route
  goto(`/games/dicee/room/${roomCode}?mode=spectator`);
}

// Client-side: Room page initialization

async function initializeRoomConnection(roomCode: string, mode: 'player' | 'spectator') {
  // 2. Connect to GameRoom DO via WebSocket
  const wsUrl = `wss://${WORKER_HOST}/ws/room/${roomCode}`;
  const ws = new WebSocket(wsUrl);
  
  // 3. Send join message with role
  ws.onopen = () => {
    ws.send(JSON.stringify({
      type: 'room.join',
      role: mode,  // 'player' or 'spectator'
      userId: currentUser.id,
      displayName: currentUser.name,
    }));
  };
  
  // 4. Receive room state
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    
    if (msg.type === 'room.state') {
      // Full room state for initialization
      roomStore.initialize(msg.state);
    }
    
    if (msg.type === 'room.join_result') {
      if (msg.success) {
        // Connected as spectator
        roomStore.setRole('spectator');
      } else {
        // Handle error (room doesn't exist, banned, etc.)
        handleJoinError(msg.error);
      }
    }
  };
}
```

### 3.3 GameRoom DO: Handling Spectator Join

```typescript
// In GameRoom Durable Object

async webSocketMessage(ws: WebSocket, message: string) {
  const msg = JSON.parse(message);
  
  if (msg.type === 'room.join') {
    await this.handleJoin(ws, msg);
  }
  // ... other message handlers
}

private async handleJoin(ws: WebSocket, msg: JoinMessage) {
  const { role, userId, displayName } = msg;
  
  // ═══════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════
  
  // Check if user is banned from room
  if (this.bannedUsers.has(userId)) {
    ws.send(JSON.stringify({ type: 'room.join_result', success: false, error: 'BANNED' }));
    return;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ROLE DETERMINATION
  // ═══════════════════════════════════════════════════════════════
  
  let actualRole = role;
  
  if (role === 'player') {
    if (this.gameState.phase !== 'waiting') {
      // Game already started - force spectator
      actualRole = 'spectator';
    } else if (this.getPlayerCount() >= this.maxPlayers) {
      // Room full - force spectator
      actualRole = 'spectator';
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ACCEPT CONNECTION WITH APPROPRIATE TAGS
  // ═══════════════════════════════════════════════════════════════
  
  const tags = [
    `role:${actualRole}`,
    `user:${userId}`,
  ];
  
  // Re-accept with tags (replaces initial accept)
  this.ctx.acceptWebSocket(ws, tags);
  
  // Store connection metadata
  ws.serializeAttachment({
    role: actualRole,
    userId,
    displayName,
    joinedAt: Date.now(),
  });
  
  // ═══════════════════════════════════════════════════════════════
  // ADD TO APPROPRIATE COLLECTION
  // ═══════════════════════════════════════════════════════════════
  
  if (actualRole === 'player') {
    await this.addPlayer(userId, displayName, ws);
  } else {
    await this.addSpectator(userId, displayName, ws);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SEND RESPONSES
  // ═══════════════════════════════════════════════════════════════
  
  // Send join result to joiner
  ws.send(JSON.stringify({
    type: 'room.join_result',
    success: true,
    role: actualRole,
    wasDowngraded: role === 'player' && actualRole === 'spectator',
  }));
  
  // Send full room state to joiner
  ws.send(JSON.stringify({
    type: 'room.state',
    state: this.getStateForRole(actualRole),
  }));
  
  // Broadcast join to others
  this.broadcast({
    type: actualRole === 'player' ? 'player.joined' : 'spectator.joined',
    userId,
    displayName,
  }, ws);  // Exclude joiner
  
  // Update GlobalLobby with new counts
  await this.notifyLobbyOfUpdate();
}
```

---

## 4. GlobalLobby ↔ GameRoom Communication

### 4.1 Room Registration & Updates

```typescript
// When a GameRoom's state changes, it notifies GlobalLobby

class GameRoom extends DurableObject {
  private lobbyStub: DurableObjectStub;
  
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    
    // Get stub for GlobalLobby (singleton)
    const lobbyId = env.GLOBAL_LOBBY.idFromName('global');
    this.lobbyStub = env.GLOBAL_LOBBY.get(lobbyId);
  }
  
  private async notifyLobbyOfUpdate() {
    const update: RoomStatusUpdate = {
      roomCode: this.roomCode,
      status: this.gameState.phase === 'waiting' ? 'waiting' 
            : this.gameState.phase === 'game_over' ? 'finished' 
            : 'playing',
      playerCount: this.getPlayerCount(),
      spectatorCount: this.getSpectatorCount(),
      maxPlayers: this.maxPlayers,
      roundNumber: this.gameState.roundNumber,
      isPublic: this.isPublic,
      players: this.getPlayerSummaries(),  // Names and scores
      hostId: this.hostId,
    };
    
    // RPC call to GlobalLobby
    await this.lobbyStub.updateRoomStatus(update);
  }
  
  // Call this on:
  // - Player join/leave
  // - Spectator join/leave
  // - Game start
  // - Round change
  // - Game end
}
```

### 4.2 GlobalLobby Room Directory

```typescript
// GlobalLobby DO maintains directory of all rooms

class GlobalLobby extends DurableObject {
  private rooms: Map<string, RoomStatus> = new Map();
  
  // RPC method called by GameRooms
  async updateRoomStatus(update: RoomStatusUpdate) {
    if (update.status === 'finished') {
      // Keep finished games briefly for "recent results"
      this.scheduleRoomRemoval(update.roomCode, 60_000);  // 1 min
    }
    
    this.rooms.set(update.roomCode, {
      ...update,
      updatedAt: Date.now(),
    });
    
    // Broadcast to lobby clients
    this.broadcastToLobby({
      type: 'room.updated',
      room: update,
    });
  }
  
  // RPC method for clients to get room list
  async getRooms(filter?: RoomFilter): Promise<RoomStatus[]> {
    let rooms = Array.from(this.rooms.values());
    
    if (filter?.status) {
      rooms = rooms.filter(r => r.status === filter.status);
    }
    
    if (filter?.hasSpots) {
      rooms = rooms.filter(r => r.status === 'waiting' && r.playerCount < r.maxPlayers);
    }
    
    if (filter?.isPublic !== undefined) {
      rooms = rooms.filter(r => r.isPublic === filter.isPublic);
    }
    
    // Sort by activity
    rooms.sort((a, b) => {
      // Playing games first, then waiting, then by spectator count
      if (a.status !== b.status) {
        return a.status === 'playing' ? -1 : 1;
      }
      return b.spectatorCount - a.spectatorCount;
    });
    
    return rooms;
  }
}
```

### 4.3 Real-Time Room Updates in Lobby

```typescript
// Lobby client receives live updates

// In LobbyStore (client-side)
class LobbyStore {
  rooms = $state<RoomStatus[]>([]);
  
  handleMessage(msg: LobbyMessage) {
    switch (msg.type) {
      case 'room.updated':
        this.updateRoom(msg.room);
        break;
        
      case 'room.removed':
        this.removeRoom(msg.roomCode);
        break;
        
      case 'room.highlight':
        // Someone got a Dicee, close finish, etc.
        this.showHighlight(msg.roomCode, msg.highlight);
        break;
    }
  }
  
  private updateRoom(room: RoomStatus) {
    const idx = this.rooms.findIndex(r => r.roomCode === room.roomCode);
    if (idx >= 0) {
      this.rooms[idx] = room;
    } else {
      this.rooms.push(room);
    }
    this.sortRooms();
  }
}
```

---

## 5. URL Structure & Deep Links

### 5.1 Routes

```typescript
// SvelteKit routes

/lobby                           // Global lobby, room browser
/games/dicee                     // Solo game
/games/dicee/room/[code]         // Game room (player or spectator)
/games/dicee/room/[code]?mode=spectator  // Explicit spectator join
```

### 5.2 Deep Link Handling

```typescript
// /games/dicee/room/[code]/+page.ts

export async function load({ params, url }) {
  const roomCode = params.code;
  const explicitMode = url.searchParams.get('mode');  // 'spectator' or null
  
  return {
    roomCode,
    requestedMode: explicitMode || 'player',  // Default to player
  };
}

// /games/dicee/room/[code]/+page.svelte

<script>
  let { data } = $props();
  
  onMount(async () => {
    // Connect to room with requested mode
    // Server will downgrade to spectator if needed
    await roomStore.connect(data.roomCode, data.requestedMode);
  });
</script>

{#if roomStore.role === 'spectator'}
  <SpectatorView />
{:else}
  <PlayerView />
{/if}
```

### 5.3 Shareable Watch Links

```typescript
// Generate shareable spectator link

function getWatchLink(roomCode: string): string {
  return `${window.location.origin}/games/dicee/room/${roomCode}?mode=spectator`;
}

// UI: "Share Watch Link" button in game
// Copies: https://gamelobby.legacy.example/games/dicee/room/ABC123?mode=spectator
```

---

## 6. Spectator Permissions Matrix

| Action | Player | Spectator | Notes |
|--------|--------|-----------|-------|
| View dice rolls | ✅ | ✅ | |
| View all scorecards | Own only | ✅ All | Spectators see more! |
| View EV/probabilities | ✅ | ❌ | No strategy spoilers |
| Send chat | ✅ Player chat | ✅ Spectator chat | Separate channels |
| Send reactions | ✅ | ✅ | Same reactions |
| Use predictions | ❌ | ✅ | Spectator-only feature |
| Root for player | ❌ | ✅ | Spectator-only feature |
| Join next game queue | ❌ | ✅ | Warm seat system |
| Receive turn notifications | ✅ Own turn | ❌ | |
| Kick players (host) | ✅ | ❌ | |

---

## 7. State Filtering by Role

```typescript
// GameRoom sends different state based on role

private getStateForRole(role: 'player' | 'spectator'): RoomState {
  const baseState = {
    roomCode: this.roomCode,
    phase: this.gameState.phase,
    roundNumber: this.gameState.roundNumber,
    currentPlayerId: this.gameState.currentPlayerId,
    players: this.getPlayerStates(),
    spectatorCount: this.getSpectatorCount(),
    chatHistory: this.recentChat,
  };
  
  if (role === 'spectator') {
    return {
      ...baseState,
      
      // Spectators see ALL scorecards fully
      players: this.players.map(p => ({
        ...p,
        scorecard: p.scorecard,  // Full scorecard
      })),
      
      // Spectator-specific data
      spectatorChat: this.spectatorChat,
      predictions: this.activePredictions,
      gallery: this.getGalleryState(),
      
      // NO strategy data
      // evAnalysis: undefined
      // optimalHolds: undefined
    };
  }
  
  // Player state
  return {
    ...baseState,
    
    // Players see own scorecard fully, opponents partially
    players: this.players.map(p => ({
      ...p,
      scorecard: p.id === currentUserId 
        ? p.scorecard  // Full own scorecard
        : this.getVisibleScorecard(p),  // Only scored categories
    })),
    
    // Strategy assistance (if enabled)
    evAnalysis: this.settings.showEV ? this.getEVAnalysis() : undefined,
  };
}
```

---

## 8. Spectator Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SPECTATOR LIFECYCLE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐                                                            │
│  │   LOBBY     │                                                            │
│  │  (browsing) │                                                            │
│  └──────┬──────┘                                                            │
│         │ Click "Watch Game"                                                │
│         ▼                                                                   │
│  ┌─────────────┐                                                            │
│  │  CONNECTING │                                                            │
│  │             │                                                            │
│  └──────┬──────┘                                                            │
│         │ WebSocket established                                             │
│         ▼                                                                   │
│  ┌─────────────┐     ┌─────────────┐                                       │
│  │  WATCHING   │────▶│  IN QUEUE   │  (clicked "Join Next Game")           │
│  │             │◀────│             │  (left queue)                          │
│  └──────┬──────┘     └──────┬──────┘                                       │
│         │                   │                                               │
│         │ Game ends         │ Game ends + queue position reached            │
│         ▼                   ▼                                               │
│  ┌─────────────┐     ┌─────────────┐                                       │
│  │ GAME OVER   │     │  PROMOTED   │                                       │
│  │ (still spec)│     │ (now player)│                                       │
│  └──────┬──────┘     └─────────────┘                                       │
│         │                                                                   │
│         │ Rematch starts                                                    │
│         ▼                                                                   │
│  ┌─────────────┐                                                            │
│  │  WATCHING   │  (continues spectating new game)                          │
│  │  (new game) │                                                            │
│  └─────────────┘                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Implementation Checklist

### Phase 1: Basic Spectating
- [ ] `role:spectator` tag in GameRoom WebSocket handling
- [ ] State filtering by role
- [ ] "Watch Game" button in lobby room cards
- [ ] Spectator count in room status updates
- [ ] Basic spectator view component
- [ ] Separate spectator chat channel

### Phase 2: Lobby Integration  
- [ ] GlobalLobby ↔ GameRoom RPC for room status
- [ ] Real-time room updates in lobby browser
- [ ] Live game indicators (🔴 LIVE badge)
- [ ] Player scores visible in room cards
- [ ] "X watching" display

### Phase 3: Engagement Features
- [ ] Predictions system
- [ ] Rooting system
- [ ] Enhanced spectator reactions
- [ ] Gallery points
- [ ] Kibitz voting

### Phase 4: Queue System
- [ ] "Join Next Game" queue
- [ ] Queue position display
- [ ] Warm seat promotion on game end
- [ ] Queue management (leave, position updates)

---

## 10. Summary

**Q: "Is spectator mode only for in-game, or can anyone in lobby join?"**

**A: Both.** 

1. **From Lobby**: Users browse active games, see live status, click "Watch" → WebSocket to GameRoom as spectator
2. **From Room Link**: Direct URL with `?mode=spectator` → joins as spectator
3. **Overflow**: Try to join full/started game → automatically become spectator

The **GlobalLobby DO** maintains the room directory and broadcasts updates. Each **GameRoom DO** manages its own players + spectators and pushes status changes to GlobalLobby. Spectators connect directly to GameRoom (not proxied through GlobalLobby).

```
User in Lobby ──▶ Sees room ABC123 (🔴 LIVE, 3 watching)
                          │
                          │ Click "Watch"
                          ▼
              WebSocket to GameRoom DO (ABC123)
                          │
                          │ role: 'spectator'
                          ▼
              Full spectator experience (Gallery features)
```
