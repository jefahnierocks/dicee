# Migration Guide: Unified Cloudflare Architecture

> **Target Date**: December 2025  
> **Estimated Effort**: 12-18 hours  
> **Risk Level**: Low (gradual migration with rollback capability)

## Overview

This guide migrates the Dicee application from a split architecture (Vercel frontend + Cloudflare Workers backend) to a unified Cloudflare stack where `gamelobby.legacy.example` serves as the single entry point for a multi-game lobby platform.

```
BEFORE                                    AFTER
┌─────────────────────────┐              ┌─────────────────────────────────────┐
│ dicee.legacy.example │              │   gamelobby.legacy.example       │
│ (Vercel - SvelteKit)    │              │                                     │
├─────────────────────────┤              │  ┌─────────────────────────────┐    │
│ Separate deployment     │              │  │ Cloudflare Pages (SvelteKit)│    │
│ CORS to worker domain   │      →       │  │ + Service Binding           │    │
└─────────────────────────┘              │  └──────────────┬──────────────┘    │
                                         │                 │ (zero-latency)    │
┌─────────────────────────┐              │  ┌──────────────▼──────────────┐    │
│ gamelobby.jefah...      │              │  │ Workers + Durable Objects   │    │
│ (Cloudflare Workers)    │              │  │ - GlobalLobby (singleton)   │    │
│ - GameRoom DO           │              │  │ - GameRoom (per-room)       │    │
└─────────────────────────┘              │  └─────────────────────────────┘    │
                                         └─────────────────────────────────────┘
```

---

## Phase 1: Dependency Audit & Preparation

**Time: 1-2 hours**

### 1.1 Audit Node.js Dependencies

The Cloudflare Workers runtime is V8-based, not Node.js. Scan for incompatible APIs:

```bash
# From project root
cd apps/dicee

# Check for Node.js-specific imports
grep -rn "require('fs')" src/
grep -rn "require('path')" src/
grep -rn "require('crypto')" src/
grep -rn "from 'fs'" src/
grep -rn "from 'path'" src/
grep -rn "from 'node:" src/

# Check for process.env usage (should use $env/* instead)
grep -rn "process\.env" src/

# Review server-side dependencies
cat package.json | jq '.dependencies, .devDependencies'
```

**Known safe dependencies:**
- `@supabase/supabase-js` - Works on Workers
- Vite/SvelteKit tooling - Build-time only
- WASM modules - Supported with `compatibility_flags`

**If you find Node.js APIs**, options are:
1. Use `nodejs_compat` compatibility flag (preferred)
2. Replace with Workers-compatible alternatives
3. Move logic to client-side

### 1.2 Test WASM Engine Locally

```bash
# Install wrangler globally if not present
pnpm add -g wrangler

# Build the project
pnpm build

# Test with wrangler
wrangler pages dev .svelte-kit/cloudflare --compatibility-flags=nodejs_compat
```

### 1.3 Verify Bundle Size

Workers have a 1MB compressed limit (3MB uncompressed for paid plans):

```bash
pnpm build
du -sh .svelte-kit/cloudflare/_worker.js
gzip -c .svelte-kit/cloudflare/_worker.js | wc -c
```

Your current build is ~43KB gzip - well within limits.

---

## Phase 2: Create GlobalLobby Durable Object

**Time: 2-3 hours**

### 2.1 Create GlobalLobby Class

Create `apps/gamelobby/src/GlobalLobby.ts`:

```typescript
import { DurableObject } from 'cloudflare:workers';

interface UserPresence {
  oderId: string;
  odername: string;
  connectedAt: number;
  lastSeen: number;
}

interface LobbyMessage {
  type: 'chat' | 'presence' | 'room_update' | 'system';
  payload: unknown;
  timestamp: number;
}

interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  content: string;
  timestamp: number;
}

interface RoomInfo {
  code: string;
  game: string;
  host: string;
  playerCount: number;
  maxPlayers: number;
  isPublic: boolean;
  createdAt: number;
}

export class GlobalLobby extends DurableObject<Env> {
  private sessions: Map<WebSocket, UserPresence> = new Map();
  private activeRooms: Map<string, RoomInfo> = new Map();
  
  // Use WebSocket Hibernation to avoid duration charges during idle
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }
    
    // REST endpoints for lobby state
    switch (url.pathname) {
      case '/lobby/rooms':
        return this.getPublicRooms();
      case '/lobby/online':
        return this.getOnlineCount();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with hibernation support
    this.ctx.acceptWebSocket(server);

    // Extract user info from request (set by SvelteKit auth)
    const userId = request.headers.get('X-User-Id') || crypto.randomUUID();
    const username = request.headers.get('X-Username') || `Guest-${userId.slice(0, 4)}`;

    // Store session info as WebSocket attachment for hibernation
    server.serializeAttachment({
      userId,
      username,
      connectedAt: Date.now(),
      lastSeen: Date.now()
    });

    // Broadcast join
    this.broadcast({
      type: 'presence',
      payload: {
        action: 'join',
        userId,
        username,
        onlineCount: this.ctx.getWebSockets().length
      },
      timestamp: Date.now()
    }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation API handlers
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as UserPresence;
    
    try {
      const data = JSON.parse(message as string);
      
      switch (data.type) {
        case 'chat':
          await this.handleChat(ws, attachment, data.content);
          break;
        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
        case 'room_created':
          this.activeRooms.set(data.room.code, data.room);
          this.broadcast({
            type: 'room_update',
            payload: { action: 'created', room: data.room },
            timestamp: Date.now()
          });
          break;
        case 'room_closed':
          this.activeRooms.delete(data.code);
          this.broadcast({
            type: 'room_update',
            payload: { action: 'closed', code: data.code },
            timestamp: Date.now()
          });
          break;
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as UserPresence;
    
    this.broadcast({
      type: 'presence',
      payload: {
        action: 'leave',
        userId: attachment.userId,
        username: attachment.username,
        onlineCount: this.ctx.getWebSockets().length - 1
      },
      timestamp: Date.now()
    }, ws);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('WebSocket error:', error);
    ws.close(1011, 'Internal error');
  }

  private async handleChat(ws: WebSocket, user: UserPresence, content: string): Promise<void> {
    if (!content || content.length > 500) return;

    const message: ChatMessage = {
      id: crypto.randomUUID(),
      userId: user.userId,
      username: user.username,
      content: content.trim(),
      timestamp: Date.now()
    };

    // Optionally persist to SQLite for history
    // await this.ctx.storage.sql.exec(
    //   'INSERT INTO chat_messages (id, user_id, username, content, timestamp) VALUES (?, ?, ?, ?, ?)',
    //   message.id, message.userId, message.username, message.content, message.timestamp
    // );

    this.broadcast({
      type: 'chat',
      payload: message,
      timestamp: Date.now()
    });
  }

  private broadcast(message: LobbyMessage, exclude?: WebSocket): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  private getPublicRooms(): Response {
    const rooms = Array.from(this.activeRooms.values())
      .filter(r => r.isPublic)
      .sort((a, b) => b.createdAt - a.createdAt);
    
    return Response.json({ rooms });
  }

  private getOnlineCount(): Response {
    return Response.json({ 
      count: this.ctx.getWebSockets().length 
    });
  }
}
```

### 2.2 Update Worker Entry Point

Update `apps/gamelobby/src/worker.ts`:

```typescript
import { GameRoom } from './GameRoom';
import { GlobalLobby } from './GlobalLobby';

export { GameRoom, GlobalLobby };

export interface Env {
  GAME_ROOM: DurableObjectNamespace<GameRoom>;
  GLOBAL_LOBBY: DurableObjectNamespace<GlobalLobby>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return Response.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString()
      });
    }

    // Global lobby (singleton) - all paths starting with /lobby
    if (url.pathname === '/lobby' || url.pathname.startsWith('/lobby/')) {
      const id = env.GLOBAL_LOBBY.idFromName('singleton');
      const stub = env.GLOBAL_LOBBY.get(id);
      return stub.fetch(request);
    }

    // Per-room game instances
    const roomMatch = url.pathname.match(/^\/room\/([A-Z0-9]{6})$/i);
    if (roomMatch) {
      const roomCode = roomMatch[1].toUpperCase();
      const id = env.GAME_ROOM.idFromName(roomCode);
      const stub = env.GAME_ROOM.get(id);
      return stub.fetch(request);
    }

    // API info
    if (url.pathname === '/') {
      return Response.json({
        name: 'Game Lobby API',
        version: '2.0.0',
        endpoints: {
          lobby: '/lobby (WebSocket)',
          rooms: '/lobby/rooms (GET)',
          online: '/lobby/online (GET)',
          game: '/room/:code (WebSocket)'
        }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};
```

### 2.3 Update Worker wrangler.toml

Update `apps/gamelobby/wrangler.toml`:

```toml
name = "gamelobby"
main = "src/worker.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

# Durable Objects
[[durable_objects.bindings]]
name = "GAME_ROOM"
class_name = "GameRoom"

[[durable_objects.bindings]]
name = "GLOBAL_LOBBY"
class_name = "GlobalLobby"

# Migrations - bump tag when adding new DO classes
[[migrations]]
tag = "v2"
new_sqlite_classes = ["GameRoom", "GlobalLobby"]

# Environment-specific config
[env.production]
routes = [
  { pattern = "gamelobby.legacy.example/room/*", zone_name = "legacy.example" },
  { pattern = "gamelobby.legacy.example/lobby/*", zone_name = "legacy.example" },
  { pattern = "gamelobby.legacy.example/health", zone_name = "legacy.example" }
]
```

### 2.4 Deploy Worker Update

```bash
cd apps/gamelobby
pnpm wrangler deploy
```

---

## Phase 3: Migrate SvelteKit to Cloudflare Pages

**Time: 2-3 hours**

### 3.1 Install Cloudflare Adapter

```bash
cd apps/dicee

# Remove Vercel adapter
pnpm remove @sveltejs/adapter-vercel

# Install Cloudflare adapter
pnpm add -D @sveltejs/adapter-cloudflare
```

### 3.2 Update svelte.config.js

Replace your existing config:

```javascript
import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),

  kit: {
    adapter: adapter({
      // Routes configuration
      routes: {
        include: ['/*'],
        exclude: ['<all>'] // Excludes static assets automatically
      },
      // Enable platform proxy for local dev
      platformProxy: {
        configPath: 'wrangler.toml',
        experimentalJsonConfig: false,
        persist: { path: '.wrangler/state' }
      }
    }),
    alias: {
      $components: 'src/lib/components',
      $stores: 'src/lib/stores',
      $utils: 'src/lib/utils'
    }
  }
};

export default config;
```

### 3.3 Create Pages wrangler.toml

Create `apps/dicee/wrangler.toml`:

```toml
name = "gamelobby-pages"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = ".svelte-kit/cloudflare"

# Service Binding to the Durable Objects Worker
[[services]]
binding = "GAME_WORKER"
service = "gamelobby"

# Environment variables (non-secret)
[vars]
PUBLIC_APP_NAME = "Game Lobby"
PUBLIC_APP_VERSION = "2.0.0"

# Production environment
[env.production]
# Secrets are set via dashboard or wrangler secret
# SUPABASE_SERVICE_KEY = (set via wrangler pages secret put)
```

### 3.4 Add TypeScript Types

Update `apps/dicee/src/app.d.ts`:

```typescript
/// <reference types="@sveltejs/adapter-cloudflare" />

declare global {
  namespace App {
    interface Error {
      message: string;
      code?: string;
    }

    interface Locals {
      user: import('$lib/types').User | null;
      session: import('@supabase/supabase-js').Session | null;
    }

    interface PageData {
      user: import('$lib/types').User | null;
    }

    interface Platform {
      env: {
        // Service binding to the game worker
        GAME_WORKER: Fetcher;
        
        // Environment variables
        PUBLIC_SUPABASE_URL: string;
        PUBLIC_SUPABASE_ANON_KEY: string;
        SUPABASE_SERVICE_KEY?: string;
      };
      context: {
        waitUntil(promise: Promise<unknown>): void;
      };
      caches: CacheStorage & { default: Cache };
    }

    // interface PageState {}
  }
}

export {};
```

### 3.5 Create WebSocket Proxy Endpoint

Create `apps/dicee/src/routes/ws/lobby/+server.ts`:

```typescript
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, platform, locals }) => {
  const gameWorker = platform?.env?.GAME_WORKER;

  if (!gameWorker) {
    console.error('GAME_WORKER service binding not available');
    return new Response('Service unavailable', { status: 503 });
  }

  // Clone request and add auth headers from session
  const headers = new Headers(request.headers);
  
  if (locals.user) {
    headers.set('X-User-Id', locals.user.id);
    headers.set('X-Username', locals.user.username || locals.user.email?.split('@')[0] || 'Guest');
  }

  // Proxy to the GlobalLobby DO via service binding
  const proxyRequest = new Request(
    new URL('/lobby', 'https://internal').toString(),
    {
      method: request.method,
      headers,
      body: request.body,
      // @ts-expect-error - duplex required for streaming
      duplex: 'half'
    }
  );

  return gameWorker.fetch(proxyRequest);
};
```

Create `apps/dicee/src/routes/ws/room/[code]/+server.ts`:

```typescript
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params, platform, locals }) => {
  const { code } = params;
  const gameWorker = platform?.env?.GAME_WORKER;

  if (!gameWorker) {
    console.error('GAME_WORKER service binding not available');
    return new Response('Service unavailable', { status: 503 });
  }

  if (!code || !/^[A-Z0-9]{6}$/i.test(code)) {
    return new Response('Invalid room code', { status: 400 });
  }

  // Clone request and add auth headers
  const headers = new Headers(request.headers);
  
  if (locals.user) {
    headers.set('X-User-Id', locals.user.id);
    headers.set('X-Username', locals.user.username || locals.user.email?.split('@')[0] || 'Guest');
  }

  // Proxy to the GameRoom DO via service binding
  const proxyRequest = new Request(
    new URL(`/room/${code.toUpperCase()}`, 'https://internal').toString(),
    {
      method: request.method,
      headers,
      body: request.body,
      // @ts-expect-error - duplex required for streaming
      duplex: 'half'
    }
  );

  return gameWorker.fetch(proxyRequest);
};
```

### 3.6 Update WebSocket Client Code

Update your WebSocket connection logic to use the new same-origin endpoints:

```typescript
// src/lib/stores/lobby.ts
import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

interface LobbyState {
  connected: boolean;
  onlineCount: number;
  messages: ChatMessage[];
  rooms: RoomInfo[];
}

function createLobbyStore() {
  const { subscribe, set, update } = writable<LobbyState>({
    connected: false,
    onlineCount: 0,
    messages: [],
    rooms: []
  });

  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    if (!browser || ws?.readyState === WebSocket.OPEN) return;

    // Same-origin WebSocket - no CORS!
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}/ws/lobby`);

    ws.onopen = () => {
      update(s => ({ ...s, connected: true }));
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'chat':
          update(s => ({
            ...s,
            messages: [...s.messages.slice(-99), data.payload]
          }));
          break;
        case 'presence':
          update(s => ({ ...s, onlineCount: data.payload.onlineCount }));
          break;
        case 'room_update':
          handleRoomUpdate(data.payload);
          break;
      }
    };

    ws.onclose = () => {
      update(s => ({ ...s, connected: false }));
      // Exponential backoff reconnect
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = (error) => {
      console.error('Lobby WebSocket error:', error);
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.close();
    ws = null;
  }

  function sendChat(content: string) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', content }));
    }
  }

  function handleRoomUpdate(payload: { action: string; room?: RoomInfo; code?: string }) {
    update(s => {
      if (payload.action === 'created' && payload.room) {
        return { ...s, rooms: [payload.room, ...s.rooms] };
      }
      if (payload.action === 'closed' && payload.code) {
        return { ...s, rooms: s.rooms.filter(r => r.code !== payload.code) };
      }
      return s;
    });
  }

  return {
    subscribe,
    connect,
    disconnect,
    sendChat
  };
}

export const lobby = createLobbyStore();
```

### 3.7 Remove Vercel Configuration

```bash
# Delete Vercel-specific files
rm -f apps/dicee/vercel.json
rm -rf apps/dicee/.vercel

# Update .gitignore
echo ".wrangler" >> apps/dicee/.gitignore
```

---

## Phase 4: Route Restructuring

**Time: 3-4 hours**

### 4.1 New Route Structure

```
src/routes/
├── +layout.svelte           # Root layout with lobby sidebar
├── +layout.server.ts        # Auth check
├── +page.svelte             # Landing → lobby home
├── +error.svelte            # Error page
│
├── games/
│   ├── +layout.svelte       # Games layout (hides lobby chat)
│   ├── dicee/
│   │   ├── +page.svelte     # Dicee game gateway (solo/multi)
│   │   ├── solo/
│   │   │   └── +page.svelte # Solo gameplay
│   │   └── room/
│   │       └── [code]/
│   │           ├── +page.svelte      # Room lobby/waiting
│   │           └── play/
│   │               └── +page.svelte  # Multiplayer gameplay
│   └── [future-game]/       # Template for new games
│
├── profile/
│   └── +page.svelte         # User profile
│
├── auth/
│   ├── callback/
│   │   └── +server.ts       # OAuth callback
│   └── +page.svelte         # Sign in page
│
└── ws/                      # WebSocket proxy endpoints
    ├── lobby/
    │   └── +server.ts       # → GlobalLobby DO
    └── room/
        └── [code]/
            └── +server.ts   # → GameRoom DO
```

### 4.2 Create Lobby-First Landing Page

Create `apps/dicee/src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { lobby } from '$lib/stores/lobby';
  import LobbyChat from '$components/lobby/LobbyChat.svelte';
  import OnlineUsers from '$components/lobby/OnlineUsers.svelte';
  import GamesList from '$components/lobby/GamesList.svelte';
  import RoomBrowser from '$components/lobby/RoomBrowser.svelte';

  onMount(() => {
    lobby.connect();
  });

  onDestroy(() => {
    lobby.disconnect();
  });
</script>

<svelte:head>
  <title>Game Lobby</title>
  <meta name="description" content="Play dice games with friends" />
</svelte:head>

<div class="lobby-container">
  <aside class="sidebar">
    <OnlineUsers count={$lobby.onlineCount} />
    <LobbyChat messages={$lobby.messages} on:send={(e) => lobby.sendChat(e.detail)} />
  </aside>

  <main class="content">
    <header class="hero">
      <h1>Game Lobby</h1>
      <p>Choose a game to play solo or with friends</p>
    </header>

    <section class="games">
      <h2>Games</h2>
      <GamesList />
    </section>

    <section class="rooms">
      <h2>Open Rooms</h2>
      <RoomBrowser rooms={$lobby.rooms} />
    </section>
  </main>
</div>

<style>
  .lobby-container {
    display: grid;
    grid-template-columns: 300px 1fr;
    gap: 1rem;
    height: 100vh;
    padding: 1rem;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    background: var(--surface);
    border-radius: 8px;
    padding: 1rem;
  }

  .content {
    overflow-y: auto;
  }

  .hero {
    text-align: center;
    padding: 2rem;
  }

  .games, .rooms {
    padding: 1rem;
  }

  @media (max-width: 768px) {
    .lobby-container {
      grid-template-columns: 1fr;
    }
    
    .sidebar {
      order: 2;
      max-height: 40vh;
    }
  }
</style>
```

### 4.3 Migration Mapping

| Old Route | New Route | Notes |
|-----------|-----------|-------|
| `/` | `/` | Now lobby-first landing |
| `/dicee` | `/games/dicee` | Game gateway |
| `/lobby` | `/games/dicee/room/[code]` | Create/join moved to game |
| `/lobby/[code]` | `/games/dicee/room/[code]` | Room waiting area |
| `/game/[code]` | `/games/dicee/room/[code]/play` | Multiplayer gameplay |
| `/profile` | `/profile` | Unchanged |

### 4.4 Add Redirects for Old URLs

Create `apps/dicee/src/hooks.server.ts` (or update existing):

```typescript
import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url;

  // Redirect old routes to new structure
  if (pathname === '/dicee') {
    throw redirect(301, '/games/dicee');
  }
  
  if (pathname === '/lobby') {
    throw redirect(301, '/games/dicee');
  }
  
  const lobbyMatch = pathname.match(/^\/lobby\/([A-Z0-9]{6})$/i);
  if (lobbyMatch) {
    throw redirect(301, `/games/dicee/room/${lobbyMatch[1]}`);
  }
  
  const gameMatch = pathname.match(/^\/game\/([A-Z0-9]{6})$/i);
  if (gameMatch) {
    throw redirect(301, `/games/dicee/room/${gameMatch[1]}/play`);
  }

  // Continue with auth handling, etc.
  // ... existing auth logic ...

  return resolve(event);
};
```

---

## Phase 5: Local Development Setup

**Time: 30 minutes**

### 5.1 Update package.json Scripts

```json
{
  "scripts": {
    "dev": "vite dev",
    "dev:cf": "wrangler pages dev .svelte-kit/cloudflare --compatibility-flags=nodejs_compat",
    "build": "vite build",
    "preview": "wrangler pages dev .svelte-kit/cloudflare",
    "deploy": "pnpm build && wrangler pages deploy .svelte-kit/cloudflare",
    "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "lint": "eslint ."
  }
}
```

### 5.2 Configure Local Bindings

For local development with service bindings, update `wrangler.toml`:

```toml
# Local development - point to locally running worker
[env.local]
[[env.local.services]]
binding = "GAME_WORKER"
service = "gamelobby"
environment = "local"
```

Run the worker locally in one terminal:
```bash
cd apps/gamelobby
pnpm wrangler dev --local
```

Run Pages in another:
```bash
cd apps/dicee
pnpm dev:cf
```

---

## Phase 6: Deployment

**Time: 1-2 hours**

### 6.1 Deploy Worker First

```bash
cd apps/gamelobby

# Deploy to production
pnpm wrangler deploy --env production

# Verify
curl https://gamelobby.legacy.example/health
```

### 6.2 Create Cloudflare Pages Project

```bash
cd apps/dicee

# Build
pnpm build

# Create Pages project (first time)
pnpm wrangler pages project create gamelobby-pages

# Deploy to preview
pnpm wrangler pages deploy .svelte-kit/cloudflare
```

### 6.3 Configure Custom Domain

In Cloudflare Dashboard:

1. Go to **Workers & Pages** → **gamelobby-pages**
2. Go to **Custom domains** → **Set up a custom domain**
3. Enter `gamelobby.legacy.example`
4. Cloudflare will update DNS automatically

### 6.4 Set Environment Variables

```bash
# Set secrets
wrangler pages secret put SUPABASE_SERVICE_KEY --project-name gamelobby-pages

# Verify in dashboard that PUBLIC_* vars are set
```

### 6.5 Configure Service Binding in Dashboard

1. Go to **Workers & Pages** → **gamelobby-pages** → **Settings**
2. Go to **Functions** → **Service bindings**
3. Add binding:
   - Variable name: `GAME_WORKER`
   - Service: `gamelobby`
   - Environment: Production

### 6.6 Set Up dicee.legacy.example Redirect

Option A: Cloudflare Redirect Rule (recommended)

1. Go to **Rules** → **Redirect Rules**
2. Create rule:
   - When: Hostname equals `dicee.legacy.example`
   - Then: Dynamic redirect to `https://gamelobby.legacy.example${http.request.uri.path}`
   - Status code: 301

Option B: Worker redirect

Create a simple redirect worker:

```typescript
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.hostname = 'gamelobby.legacy.example';
    return Response.redirect(url.toString(), 301);
  }
};
```

---

## Phase 7: Testing Checklist

### 7.1 Functional Tests

```bash
# Health check
curl https://gamelobby.legacy.example/health

# Lobby WebSocket
wscat -c wss://gamelobby.legacy.example/ws/lobby

# Room WebSocket
wscat -c wss://gamelobby.legacy.example/ws/room/TEST01

# Old URL redirects
curl -I https://dicee.legacy.example/lobby/ABC123
# Should return 301 → gamelobby.legacy.example/games/dicee/room/ABC123
```

### 7.2 Test Matrix

| Feature | Test |
|---------|------|
| Landing page loads | ✓ SSR renders |
| Lobby chat connects | ✓ WebSocket opens |
| Online count updates | ✓ Presence broadcasts |
| Create room | ✓ Room code generated |
| Join room | ✓ Can connect to existing room |
| Solo game | ✓ Works without WebSocket |
| Multiplayer sync | ✓ State syncs between players |
| Auth flow | ✓ Login/logout works |
| Profile page | ✓ Protected route works |
| WASM engine | ✓ Probability calculations work |

### 7.3 Performance Checks

```bash
# Cold start time
time curl -o /dev/null -s -w '%{time_total}\n' https://gamelobby.legacy.example

# WebSocket latency
# In browser devtools, measure time from send to receive
```

---

## Phase 8: Cleanup

**Time: 30 minutes**

### 8.1 Remove Vercel Project

1. Go to Vercel dashboard
2. Project settings → Delete project
3. Or keep for 1 week as rollback option

### 8.2 Update Documentation

```bash
# Update README
# Update any hardcoded URLs in docs
grep -rn "dicee.legacy.example" . --include="*.md"
```

### 8.3 Clean Up Repository

```bash
# Remove Vercel config
rm -rf apps/dicee/.vercel
rm -f apps/dicee/vercel.json

# Remove any PartyKit remnants
rm -rf packages/partykit

# Update workspace config if needed
```

---

## Rollback Plan

If issues arise after migration:

### Immediate (< 1 hour)

1. Point `gamelobby.legacy.example` back to Vercel (if kept)
2. Revert Cloudflare DNS changes
3. Remove redirect rules

### Short-term (< 1 day)

1. Re-deploy previous Vercel configuration
2. Update `PUBLIC_WORKER_HOST` back to separate domain
3. Test thoroughly before re-attempting migration

---

## Open Decisions

Document decisions made for future reference:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| WebSocket routing | Proxy via SvelteKit | Unified auth, single domain |
| Lobby architecture | Singleton DO | True global presence |
| Chat persistence | In-memory (Phase 1) | Can add SQLite later |
| Room discovery | Public rooms shown | User-controlled visibility |
| Migration strategy | Gradual | Safe rollback |

---

## Post-Migration Enhancements

Future improvements enabled by this architecture:

1. **Global Lobby SQLite** - Persist chat history, room stats
2. **Spectator Mode** - Watch ongoing games
3. **Tournaments** - Bracket system using DO coordination
4. **New Games** - Add games under `/games/[game-name]`
5. **Matchmaking** - Use GlobalLobby to pair players
6. **Leaderboards** - Aggregate stats from GameRoom DOs

---

## Summary

This migration consolidates your infrastructure onto Cloudflare's edge network, eliminating cross-origin complexity and reducing operational overhead. The singleton lobby pattern provides a foundation for community features, while the modular `/games/*` structure supports future expansion.

Total estimated time: **12-18 hours** (can be spread across multiple sessions)

Key benefits achieved:
- Single domain (no CORS)
- Zero-latency service bindings
- Unified deployment pipeline
- WebSocket Hibernation (cost savings)
- Foundation for multi-game platform
