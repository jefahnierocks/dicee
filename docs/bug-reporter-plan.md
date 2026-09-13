# Dicee Bug Reporter: Evidence-Based Implementation Plan

> **Historical planning scope:** Cloudflare topology, `wrangler.toml`, binding,
> AI, secret, and deployment examples in this January 2026 plan are not current
> project authority. Use [`docs/cloudflare/README.md`](cloudflare/README.md) and
> current source/configuration before implementing related work.

**Document Type:** Implementation Design Document
**Version:** 1.1
**Date:** January 4, 2026
**Status:** Planning Phase (Investigations Complete)
**ADR Reference:** ADR-XXX (to be created)
**Last Validated:** January 4, 2026

---

## Executive Summary

This document provides a **phased, evidence-based implementation plan** for the Dicee family bug reporting system ("Help Dad Fix It"). Each phase includes required investigations to validate assumptions against actual codebase state before implementation proceeds.

**Design Philosophy:** "State > Pixels" — Capture serializable application state rather than screenshots for maximum debugging utility.

**Core Decisions (from planning session):**
- Reporter identity: Authenticated users via existing Supabase auth
- Severity levels: Three options (blocking, annoying, noticed)
- Audio retention: Delete after resolution
- Dashboard access: Family-only (authenticated)

> **⚠️ VALIDATION NOTE (Jan 4, 2026):**
> All 8 investigations have been completed. Key corrections have been applied to this document.
> See "Part 2A: Investigation Results" for the complete validation report.

---

## Part 1: Current Architecture Evidence Summary

### 1.1 Evidence from Past Conversations

The following architecture details were gathered from conversation history. **Each must be validated via investigation before implementation.**

| Component | Evidence Source | Validation Required |
|-----------|-----------------|---------------------|
| Monorepo structure | Migration docs (Dec 2025) | List actual packages/ contents |
| Svelte 5 runes stores | lobby.svelte.ts, room.svelte.ts examples | Verify store patterns & exports |
| Cloudflare DO bindings | wrangler.toml snippets | Verify GAME_ROOM, GLOBAL_LOBBY bindings |
| Supabase auth | Auth store references | Verify auth.svelte.ts implementation |
| Telemetry service | RFC-003 report | Verify TelemetryService exists & API |
| Component architecture | UI/UX report | Verify component organization |

### 1.2 Architecture Diagram (VALIDATED Jan 4, 2026)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        packages/web (SvelteKit)                      │
├─────────────────────────────────────────────────────────────────────┤
│  src/lib/                                                            │
│  ├── stores/                    ├── services/                       │
│  │   ├── auth.svelte.ts    ✅  │   ├── telemetry.ts   ✅ INTEGRATE │
│  │   ├── lobby.svelte.ts   ✅  │   ├── roomService.svelte.ts  ✅   │
│  │   ├── room.svelte.ts    ✅  │   └── spectatorService.svelte.ts  │
│  │   ├── game.svelte.ts    ✅  │                                    │
│  │   ├── dice.svelte.ts    ✅  ├── supabase/           ✅ EXISTS   │
│  │   └── chat.svelte.ts    ✅  │   ├── client.ts                   │
│  │                              │   └── server.ts                   │
│  │                              │                                    │
│  └── [NEW] services/            ├── components/                      │
│      ├── stateSnapshot.ts       │   ├── auth/          ✅           │
│      ├── breadcrumbs.ts         │   ├── chat/          ✅           │
│      ├── consoleCapture.ts      │   ├── dice/          ✅           │
│      ├── voiceRecorder.ts       │   ├── game/          ✅           │
│      └── bugReport.ts           │   ├── gallery/       ✅           │
│                                 │   ├── hud/           ✅           │
│                                 │   └── [NEW] bug-report/            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ WebSocket (existing) + HTTP (new endpoint)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   packages/cloudflare-do (Workers)                   │
├─────────────────────────────────────────────────────────────────────┤
│  src/                                                                │
│  ├── worker.ts                  (entry point - add /api route)      │
│  ├── GameRoom.ts                (DO: per-room game state)    ✅     │
│  ├── GlobalLobby.ts             (DO: singleton lobby)        ✅     │
│  ├── ai/                        (AI player system)           ✅     │
│  ├── lib/                                                            │
│  │   ├── logger.ts              (structured JSON logging)    ✅     │
│  │   └── observability/         (instrumentation system)     ✅     │
│  └── [NEW] api/                 ❌ DOES NOT EXIST YET                │
│      └── transcribe.ts          (HTTP endpoint for Whisper)         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Supabase Client (CONFIRMED)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Supabase Database                            │
├─────────────────────────────────────────────────────────────────────┤
│  profiles            ✅ (user profiles)                              │
│  telemetry_events    ✅ (30 day retention)                          │
│  feature_flags       ✅ (feature flag system)                       │
│  games, rooms        ✅ (game data)                                  │
│  [NEW] bug_reports   (indefinite retention)                         │
│  [NEW] storage bucket: bug-audio/                                   │
└─────────────────────────────────────────────────────────────────────┘

wrangler.toml Changes Required:
┌─────────────────────────────────────────────────────────────────────┐
│  [ai]                                                                │
│  binding = "AI"        ❌ NOT PRESENT - MUST ADD                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Part 2A: Investigation Results (VALIDATED Jan 4, 2026)

All 8 investigations have been completed. Below are the validated findings and required corrections.

### ✅ Investigation 1: Project Structure - VALIDATED

**Actual Structure (Confirmed):**
```
packages/web/src/lib/
├── stores/                          # ✅ CONFIRMED
│   ├── auth.svelte.ts               # ✅ Class-based, Supabase auth
│   ├── lobby.svelte.ts              # ✅ EXISTS
│   ├── room.svelte.ts               # ✅ Factory function pattern
│   ├── chat.svelte.ts               # ✅ EXISTS
│   ├── game.svelte.ts               # ✅ Class-based, orchestrates dice/scorecard
│   ├── dice.svelte.ts               # ✅ Class-based, HAS toJSON() already!
│   ├── scorecard.svelte.ts          # ✅ EXISTS
│   ├── coach.svelte.ts              # ✅ EXISTS (coach mode)
│   ├── spectator.svelte.ts          # ✅ EXISTS (gallery)
│   └── flags.svelte.ts              # ✅ Feature flags
├── services/
│   ├── telemetry.ts                 # ✅ CONFIRMED - matches expected API
│   ├── roomService.svelte.ts        # ✅ EXISTS
│   ├── spectatorService.svelte.ts   # ✅ EXISTS
│   ├── engine.ts                    # ✅ WASM engine wrapper
│   └── audio.ts                     # ✅ Audio service
├── supabase/                        # ✅ EXISTS - Supabase client utilities
│   ├── client.ts                    # createSupabaseBrowserClient()
│   ├── server.ts                    # Server-side client
│   ├── profiles.ts                  # Profile operations
│   ├── stats.ts                     # Stats operations
│   ├── flags.ts                     # Feature flag operations
│   └── leaderboard.ts               # Leaderboard operations
└── components/
    ├── auth/                        # ✅ EXISTS
    ├── chat/                        # ✅ EXISTS
    ├── dice/                        # ✅ EXISTS
    ├── game/                        # ✅ EXISTS (14 files)
    ├── gallery/                     # ✅ EXISTS (spectator UI)
    ├── hud/                         # ✅ EXISTS (game HUD components)
    ├── lobby/                       # ✅ EXISTS (26 files)
    ├── ui/                          # ✅ EXISTS (shared UI components)
    ├── profile/                     # ✅ EXISTS (user profile)
    └── admin/                       # ✅ EXISTS (admin panel)
    # ❌ bug-report/                 # DOES NOT EXIST - to be created

packages/cloudflare-do/src/
├── worker.ts                        # ✅ Entry point
├── GameRoom.ts                      # ✅ Per-room DO
├── GlobalLobby.ts                   # ✅ Singleton DO
├── lib/
│   ├── logger.ts                    # ✅ EXISTS - structured JSON logging
│   └── observability/               # ✅ EXISTS - instrumentation system
│       ├── events.schema.ts
│       ├── instrumentation.ts
│       └── mcp-helpers.ts
└── ai/                              # ✅ AI player implementation
# ❌ api/                            # DOES NOT EXIST - to be created for transcribe endpoint
```

**Supabase Migrations (14 files confirmed):**
```
supabase/migrations/
├── 20241202000001_profiles.sql
├── 20241202000002_games.sql
├── 20241202000003_events.sql
├── 20241202000004_rooms.sql
├── 20241202000005_telemetry.sql     # ← Existing telemetry table
├── 20241202000006_rls.sql
├── 20241202000007_telemetry_cron.sql
├── 20241208000001_feature_flags.sql
├── 20241208000002_solo_leaderboard.sql
├── 20241208000003_spectator_rls.sql
├── 20241208000004_rename_yahtzee_to_dicee.sql
├── 20241208000005_gallery_stats.sql
├── 20241210000001_user_preferences.sql
└── 20241215000001_admin_rbac.sql
```

### ✅ Investigation 2: Store Patterns - VALIDATED

**Pattern Summary:**

| Store | Pattern | Export | Serialization |
|-------|---------|--------|---------------|
| `auth.svelte.ts` | Class-based (`AuthState`) | Singleton (`export const auth`) | No built-in |
| `room.svelte.ts` | Factory function | `createRoomStore(userId)` + context API | No built-in |
| `game.svelte.ts` | Class-based (`GameState`) | Singleton (`export const game`) | No built-in |
| `dice.svelte.ts` | Class-based (`DiceState`) | Singleton (`export const dice`) | **HAS `toJSON()`!** |

**Key Findings:**
- ✅ Svelte 5 runes used consistently: `$state`, `$derived`
- ✅ Auth user access: `auth.user`, `auth.userId`, `auth.email`, `auth.isAuthenticated`
- ✅ Display name: `user.user_metadata?.full_name || user.email?.split('@')[0]`
- ✅ **Dice store already has serialization**: `dice.toJSON()` returns `{ values, kept }`

### ✅ Investigation 3: Telemetry Service - VALIDATED

**Location:** `packages/web/src/lib/services/telemetry.ts`

**API Matches Expected:**
```typescript
// Track function signature
track<T extends TelemetryEventType>(eventType: T, payload: TelemetryPayloadMap[T]): void

// Consent management
hasConsent(): boolean
setConsent(granted: boolean): void

// Session ID access - CORRECTION NEEDED
const SESSION_ID_KEY = 'dicee_session_id';  // ← NOT 'telemetry_session_id'
sessionStorage.getItem(SESSION_ID_KEY)
```

**Correction Required:** Update bug report service to use `'dicee_session_id'` key.

### ✅ Investigation 4: Cloudflare Worker Routing - VALIDATED

**Current Routes in `worker.ts`:**
```typescript
// Root - API info
if (url.pathname === '/' || url.pathname === '') { ... }

// Health check
if (url.pathname === '/health') { ... }

// Global Lobby (singleton)
if (url.pathname === '/lobby' || url.pathname.startsWith('/lobby/') || 
    url.pathname.startsWith('/_debug/')) { ... }

// Room routing: /room/:roomCode
const roomMatch = url.pathname.match(/^\/room\/([A-Z0-9]{6})$/i);
```

**Finding:** NO existing `/api/*` routes. New route pattern needed for transcribe endpoint.

### ✅ Investigation 5: Supabase Usage - CRITICAL CORRECTION

> **⚠️ IMPORTANT:** The `.cursorrules` file states "This project does NOT use Supabase" - 
> **THIS IS OUTDATED/INCORRECT**. Supabase IS used extensively.

**Evidence:**
- 14 migration files in `supabase/migrations/`
- Client at `packages/web/src/lib/supabase/client.ts`
- Auth store imports `@supabase/supabase-js`
- wrangler.toml references SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_JWT_SECRET

**Supabase Client Usage:**
```typescript
// Correct import pattern
import { createSupabaseBrowserClient } from '$lib/supabase/client';
const supabase = createSupabaseBrowserClient();
```

### ✅ Investigation 6: Design System Tokens - VALIDATED

**Token File:** `packages/web/src/lib/styles/tokens.css`

**Key Tokens (Corrections Applied):**
```css
/* Colors */
--color-background: #fafafa;
--color-surface: #ffffff;
--color-border: #000000;
--color-text: #0a0a0a;
--color-text-muted: #666666;
--color-accent: #ffd700;        /* Electric Gold */
--color-success: #10b981;
--color-warning: #f59e0b;
--color-danger: #ef4444;

/* Typography - CORRECTION: weight tokens not font */
--weight-bold: 700;             /* NOT --font-bold */
--weight-black: 900;            /* NOT --font-black */
--font-sans: "Inter Variable", ...;
--font-mono: "JetBrains Mono", ...;

/* Spacing */
--space-1: 0.5rem;  /* 8px */
--space-2: 1rem;    /* 16px */
--space-3: 1.5rem;  /* 24px */
--space-4: 2rem;    /* 32px */

/* Text Scale */
--text-h1: 2.375rem;
--text-h2: 1.875rem;
--text-body: 1rem;
--text-small: 0.875rem;

/* Touch Targets */
--touch-target-min: 44px;

/* Z-Index */
--z-modal: 500;
--z-bottomsheet: 600;
--z-alert: 1000;

/* Shadows (Neo-Brutalist) */
--shadow-brutal: 4px 4px 0 0 var(--color-border);
```

### ✅ Investigation 7: Workers AI Binding - REQUIRES ACTION

**Current `wrangler.toml`:** NO AI binding present.

**Required Addition:**
```toml
[ai]
binding = "AI"
```

### ✅ Investigation 8: Worker Environment Types

**Env interface location:** `packages/cloudflare-do/src/types.ts`

Need to add AI binding to the Env type.

---

## Part 2B: Required Corrections Summary

| Area | Issue | Correction |
|------|-------|------------|
| Supabase Import | Plan shows `import { supabase } from '$lib/supabase'` | Use `createSupabaseBrowserClient()` from `'$lib/supabase/client'` |
| Session ID Key | Plan uses `'telemetry_session_id'` | Use `'dicee_session_id'` |
| Font Weight Tokens | Plan uses `--font-bold` | Use `--weight-bold` |
| Dice Serialization | Plan creates new serialization | **REUSE** existing `dice.toJSON()` |
| Worker API Directory | Plan assumes `/api/` exists | Create `packages/cloudflare-do/src/api/` |
| AI Binding | Plan assumes AI binding | Add `[ai]` section to wrangler.toml |
| Worker URL | Plan uses `PUBLIC_WORKER_URL` | Verify env var exists or use relative path |

---

## Part 2: Required Investigations (COMPLETED)

~~Before implementation begins, the following investigations **MUST** be completed to validate assumptions and discover integration points.~~

> **STATUS:** All investigations completed. See Part 2A above.

### Investigation 1: Project Structure Validation

**Purpose:** Confirm monorepo layout and identify exact file paths

**Commands:**
```bash
# From project root
tree -L 3 -I 'node_modules|.git|dist|.svelte-kit' packages/

# Verify package.json workspaces
cat package.json | jq '.workspaces'

# List stores
ls -la packages/web/src/lib/stores/

# List services
ls -la packages/web/src/lib/services/

# List components
ls -la packages/web/src/lib/components/
```

**Expected Output:**
```
packages/
├── web/
│   ├── src/
│   │   ├── lib/
│   │   │   ├── stores/
│   │   │   │   ├── auth.svelte.ts
│   │   │   │   ├── lobby.svelte.ts
│   │   │   │   ├── room.svelte.ts
│   │   │   │   └── chat.svelte.ts
│   │   │   ├── services/
│   │   │   │   └── telemetry.ts (or similar)
│   │   │   └── components/
│   │   │       ├── auth/
│   │   │       ├── chat/
│   │   │       ├── dice/
│   │   │       ├── game/
│   │   │       ├── gallery/
│   │   │       └── ui/
│   └── wrangler.toml
├── cloudflare-do/
│   ├── src/
│   │   ├── worker.ts
│   │   ├── GameRoom.ts
│   │   ├── GlobalLobby.ts
│   │   └── lib/
│   │       ├── logger.ts
│   │       └── observability/
│   └── wrangler.toml
└── shared-schemas/ (if exists)
```

**Investigation Output Format:**
```yaml
# investigation-1-results.yaml
validated: true|false
actual_structure:
  packages:
    - name: web
      path: packages/web
      stores_path: src/lib/stores
      services_path: src/lib/services
      components_path: src/lib/components
    - name: cloudflare-do
      path: packages/cloudflare-do
      entry_point: src/worker.ts
deviations:
  - description: "Actual path differs from expected"
    expected: "packages/web/src/lib/services/telemetry.ts"
    actual: "packages/web/src/lib/telemetry/index.ts"
```

---

### Investigation 2: Svelte 5 Store Patterns

**Purpose:** Understand exact store implementation patterns for consistent integration

**Commands:**
```bash
# Examine auth store structure
head -100 packages/web/src/lib/stores/auth.svelte.ts

# Examine room store for state structure
head -150 packages/web/src/lib/stores/room.svelte.ts

# Check for existing state snapshot patterns
grep -r "serialize\|snapshot\|getState" packages/web/src/lib/

# Check export patterns
grep -n "export" packages/web/src/lib/stores/*.ts | head -30
```

**Questions to Answer:**
1. Are stores class-based (like `class LobbyState`) or function-based?
2. What's the export pattern? (singleton instance vs. factory function)
3. Is there an existing state serialization method?
4. What derived values exist that need inclusion in snapshots?

**Expected Patterns (to validate):**
```typescript
// Class-based store pattern (from evidence)
class RoomStore {
  // Reactive state
  roomCode = $state<string | null>(null);
  players = $state<PlayerSeat[]>([]);
  gameState = $state<GameState | null>(null);

  // Derived
  isHost = $derived(/* ... */);

  // Methods
  connect(code: string): void;
  disconnect(): void;
}

export const room = new RoomStore();
```

---

### Investigation 3: Telemetry Service API

**Purpose:** Understand existing telemetry for integration and avoid duplication

**Commands:**
```bash
# Find telemetry service
find packages/web/src -name "*telemetry*" -type f

# Examine telemetry service API
cat packages/web/src/lib/services/telemetry.ts  # adjust path based on Investigation 1

# Check existing event types
grep -n "event_type\|EventType\|TelemetryEvent" packages/web/src/lib/services/telemetry.ts

# Check Supabase telemetry table reference
grep -rn "telemetry_events" packages/
```

**Questions to Answer:**
1. What's the `track(eventType, payload)` signature?
2. Is there consent management? How is it checked?
3. What's the batching/flush mechanism?
4. Is there session ID tracking we can reuse?

**Evidence Comparison:**
From RFC-003 report, expected interface:
```typescript
interface TelemetryEvent {
  id?: string;
  session_id: string;
  user_id?: string | null;
  event_type: TelemetryEventType;
  payload: Record<string, unknown>;
  page_url?: string | null;
  referrer?: string | null;
  user_agent?: string | null;
  timestamp: string;
}
```

---

### Investigation 4: Authentication System

**Purpose:** Understand how to get current user context for bug reports

**Commands:**
```bash
# Examine auth store
cat packages/web/src/lib/stores/auth.svelte.ts

# Check Supabase client setup
grep -rn "createClient\|supabase" packages/web/src/lib/ | head -20

# Look for user type definitions
grep -rn "interface User\|type User" packages/web/src/lib/

# Check how auth is used in components
grep -rn "auth\.\|$user\|user\." packages/web/src/lib/components/ | head -30
```

**Questions to Answer:**
1. How is current user accessed? (`auth.user`, `$user`, etc.)
2. What user properties are available? (id, email, display_name, avatar_url)
3. Is there a family member "name" field or just email?
4. How is auth state checked? (authenticated vs. guest)

---

### Investigation 5: Cloudflare Worker Routing

**Purpose:** Understand how to add HTTP endpoints for bug report submission

**Commands:**
```bash
# Examine worker entry point
cat packages/cloudflare-do/src/worker.ts

# Check existing routing patterns
grep -n "pathname\|url.pathname\|match" packages/cloudflare-do/src/worker.ts

# Examine wrangler.toml for routes
cat packages/cloudflare-do/wrangler.toml

# Check environment bindings
grep -n "Env\|env\." packages/cloudflare-do/src/worker.ts | head -20
```

**Questions to Answer:**
1. What's the existing routing pattern? (regex matching, path parsing)
2. Are there existing HTTP (non-WebSocket) endpoints?
3. What env bindings are available? (SUPABASE_URL, etc.)
4. How is authentication handled for HTTP requests?

---

### Investigation 6: Supabase Schema Patterns

**Purpose:** Understand database schema conventions for bug_reports table

**Commands:**
```bash
# Find any Supabase schema definitions
find packages -name "*.sql" -o -name "*schema*" -o -name "*migration*" 2>/dev/null

# Check for schema documentation
cat docs/architecture/supabase-schema.md 2>/dev/null || echo "Not found"

# Look for RLS policy patterns
grep -rn "CREATE POLICY\|RLS\|Row Level" packages/ docs/ 2>/dev/null

# Check telemetry table for pattern reference
grep -rn "telemetry_events\|CREATE TABLE" packages/ docs/
```

**Questions to Answer:**
1. Where are schema migrations stored?
2. What naming conventions are used? (snake_case, camelCase)
3. Are there existing RLS policies to follow as patterns?
4. Is there a Supabase client utility for server-side calls?

---

### Investigation 7: Design System Tokens

**Purpose:** Ensure bug reporter UI matches Neo-Brutalist design system

**Commands:**
```bash
# Find design tokens
find packages/web -name "*token*" -o -name "*theme*" -o -name "global.css" 2>/dev/null

# Examine tokens
cat packages/web/src/styles/tokens.css 2>/dev/null || cat packages/web/src/app.css

# Check button patterns
grep -rn "btn\|button" packages/web/src/lib/components/ui/ | head -20

# Find bottom sheet component
find packages/web -name "*BottomSheet*" -o -name "*Sheet*" -o -name "*Modal*"
```

**Questions to Answer:**
1. Where are CSS custom properties defined?
2. What's the button class pattern? (.btn, .btn-primary, etc.)
3. Is there an existing BottomSheet component to reuse?
4. What's the mobile breakpoint value?

---

### Investigation 8: Cloudflare Workers AI Availability

**Purpose:** Validate Whisper transcription capability

**Commands:**
```bash
# Check wrangler.toml for AI binding
grep -n "ai\|AI\|\[ai\]" packages/cloudflare-do/wrangler.toml

# Search for existing AI usage
grep -rn "@cf/\|env.AI\|Workers AI" packages/cloudflare-do/src/
```

**If AI binding not present, add to wrangler.toml:**
```toml
[ai]
binding = "AI"
```

**Verify with Cloudflare dashboard:**
- Workers & Pages → Settings → Bindings → AI

---

## Part 3: Phased Implementation Plan

### Phase 0: Investigation & Validation (Day 1) ✅ COMPLETE

**Goal:** Execute all 8 investigations and document findings

**Status:** ✅ **COMPLETED January 4, 2026**

**Tasks:**
| ID | Task | Status |
|----|------|--------|
| INV-001 | Execute Investigation 1-8 | ✅ Complete (see Part 2A) |
| INV-002 | Document deviations from expected architecture | ✅ Complete (see Part 2B) |
| INV-003 | Update this plan with actual paths/patterns | ✅ Complete (this document) |

**Exit Criteria:**
- [x] All 8 investigations completed
- [x] Results documented in this plan document
- [x] Implementation phases updated with actual paths

---

### Pre-Implementation Checklist (Before Phase 1)

Before starting implementation, complete these one-time setup tasks:

**Cloudflare Worker Setup:**
- [ ] Add AI binding to `packages/cloudflare-do/wrangler.toml`:
  ```toml
  [ai]
  binding = "AI"
  ```
- [ ] Update `packages/cloudflare-do/src/types.ts` to add `AI: Ai` to Env interface
- [ ] Create directory: `mkdir -p packages/cloudflare-do/src/api`

**Supabase Schema:**
- [ ] Create migration file (see Phase 3 for schema)
- [ ] Verify storage bucket creation permissions

**Verification Commands:**
```bash
# Verify AI binding works
cd packages/cloudflare-do && pnpm wrangler dev

# Verify Supabase access
cd packages/web && pnpm dev
```

---

### Phase 1: State Capture Infrastructure (Day 2)

**Goal:** Build the "Black Box" state serialization service

**Prerequisites:** Investigations 1-4 complete

#### 1.1 State Snapshot Service

**File:** `packages/web/src/lib/services/stateSnapshot.ts`

```typescript
/**
 * State Snapshot Service
 * 
 * Captures serializable application state for bug reports.
 * UPDATED based on Investigation 2 findings (Jan 4, 2026):
 * - Uses existing dice.toJSON() method
 * - Uses correct store access patterns
 * - Uses validated property names
 */

import { browser } from '$app/environment';
import { auth } from '$lib/stores/auth.svelte';
import { game } from '$lib/stores/game.svelte';
import { getRoomStoreOptional } from '$lib/stores/room.svelte';

export interface GameStateSnapshot {
  // From game store (class-based singleton)
  status: 'idle' | 'rolling' | 'keeping' | 'scoring' | 'completed';
  turnNumber: number;
  rollNumber: number;
  phase: 'pre_roll' | 'deciding' | 'scored';
  rollsRemaining: number;
  isGameActive: boolean;
  isGameOver: boolean;
  canRoll: boolean;
  canScore: boolean;
  
  // From dice store - REUSE existing toJSON()!
  dice: {
    values: [number, number, number, number, number];
    kept: [boolean, boolean, boolean, boolean, boolean];
  };
  
  // From scorecard (via game.scorecard)
  scorecardComplete: boolean;
  grandTotal: number;
  categoriesRemaining: string[];
}

export interface ConnectionStateSnapshot {
  // Room store is context-based, may not be available
  roomConnected: boolean;
  roomCode: string | null;
  isHost: boolean;
  playerCount: number;
}

export interface UIStateSnapshot {
  activeRoute: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  // Keyboard detection (mobile)
  keyboardVisible: boolean;
}

export interface UserContextSnapshot {
  isAuthenticated: boolean;
  isAnonymous: boolean;
  userId: string | null;
}

export interface FullStateSnapshot {
  game: GameStateSnapshot;
  connection: ConnectionStateSnapshot;
  ui: UIStateSnapshot;
  user: UserContextSnapshot;
  timestamp: string;
}

export function captureStateSnapshot(): FullStateSnapshot {
  // Get room store from context if available
  const roomStore = getRoomStoreOptional();
  
  return {
    game: {
      status: game.status,
      turnNumber: game.turnNumber,
      rollNumber: game.rollNumber,
      phase: game.phase,
      rollsRemaining: game.rollsRemaining,
      isGameActive: game.isGameActive,
      isGameOver: game.isGameOver,
      canRoll: game.canRoll,
      canScore: game.canScore,
      // REUSE existing serialization!
      dice: game.dice.toJSON(),
      scorecardComplete: game.scorecard.isComplete,
      grandTotal: game.scorecard.grandTotal,
      categoriesRemaining: game.scorecard.categoriesRemaining,
    },
    connection: {
      roomConnected: roomStore?.isConnected ?? false,
      roomCode: roomStore?.roomCode ?? null,
      isHost: roomStore?.isHost ?? false,
      playerCount: roomStore?.playerCount ?? 0,
    },
    ui: {
      activeRoute: browser ? window.location.pathname : '',
      viewportWidth: browser ? window.innerWidth : 0,
      viewportHeight: browser ? window.innerHeight : 0,
      devicePixelRatio: browser ? window.devicePixelRatio : 1,
      // Heuristic: if viewport height < 50% of screen, keyboard likely visible
      keyboardVisible: browser 
        ? window.innerHeight < window.screen.height * 0.5 
        : false,
    },
    user: {
      isAuthenticated: auth.isAuthenticated,
      isAnonymous: auth.isAnonymous,
      userId: auth.userId,
    },
    timestamp: new Date().toISOString(),
  };
}
```

**Verification:**
```bash
# Type check
pnpm -F @dicee/web typecheck

# Unit test
pnpm -F @dicee/web test -- --grep "stateSnapshot"
```

#### 1.2 Action Breadcrumb Buffer

**File:** `packages/web/src/lib/services/breadcrumbs.ts`

```typescript
interface ActionBreadcrumb {
  action: string;           // 'click:roll_button', 'toggle:keep_die_3'
  target: string;           // Component name or CSS selector
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const BUFFER_SIZE = 20;
let buffer: ActionBreadcrumb[] = [];

export function recordAction(
  action: string,
  target: string,
  metadata?: Record<string, unknown>
): void {
  buffer.push({
    action,
    target,
    timestamp: Date.now(),
    metadata
  });

  if (buffer.length > BUFFER_SIZE) {
    buffer.shift();
  }
}

export function getBreadcrumbs(): ActionBreadcrumb[] {
  return [...buffer];
}

export function clearBreadcrumbs(): void {
  buffer = [];
}
```

**Integration Points:** (UPDATE after Investigation 2)
- DiceTray.svelte: `recordAction('roll', 'DiceTray')`
- Die.svelte: `recordAction('keep_toggle', `Die:${index}`)`
- Scorecard.svelte: `recordAction('score_category', category)`
- ChatInput.svelte: `recordAction('chat_send', 'ChatInput')`

#### 1.3 Console/Error Capture

**File:** `packages/web/src/lib/services/consoleCapture.ts`

```typescript
const BUFFER_SIZE = 30;
let consoleBuffer: string[] = [];
let initialized = false;

export function initConsoleCapture(): void {
  if (initialized || typeof window === 'undefined') return;

  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args) => {
    addToBuffer(`[ERROR] ${args.map(String).join(' ')}`);
    originalError.apply(console, args);
  };

  console.warn = (...args) => {
    addToBuffer(`[WARN] ${args.map(String).join(' ')}`);
    originalWarn.apply(console, args);
  };

  window.addEventListener('unhandledrejection', (e) => {
    addToBuffer(`[UNHANDLED] ${e.reason}`);
  });

  window.addEventListener('error', (e) => {
    addToBuffer(`[EXCEPTION] ${e.message} at ${e.filename}:${e.lineno}`);
  });

  initialized = true;
}

function addToBuffer(entry: string): void {
  // Scrub sensitive data
  const sanitized = entry
    .replace(/token=[^&\s]+/gi, 'token=REDACTED')
    .replace(/Bearer [^\s]+/gi, 'Bearer REDACTED')
    .replace(/password[=:][^\s&]+/gi, 'password=REDACTED');

  consoleBuffer.push(sanitized);
  if (consoleBuffer.length > BUFFER_SIZE) {
    consoleBuffer.shift();
  }
}

export function getConsoleLogs(): string[] {
  return [...consoleBuffer];
}
```

**Tasks:**
| ID | Task | Estimate |
|----|------|----------|
| P1-001 | Create stateSnapshot.ts based on Investigation 2 | 2 hrs |
| P1-002 | Create breadcrumbs.ts | 1 hr |
| P1-003 | Create consoleCapture.ts | 1 hr |
| P1-004 | Integrate breadcrumb recording into 5 key components | 2 hrs |
| P1-005 | Add consoleCapture init to root layout | 30 min |
| P1-006 | Unit tests for all services | 2 hrs |

**Exit Criteria:**
- [ ] `captureStateSnapshot()` returns valid JSON
- [ ] Breadcrumbs capture last 20 actions
- [ ] Console errors captured without breaking app
- [ ] All unit tests pass

---

### Phase 2: Voice Capture Pipeline (Day 3)

**Goal:** Browser audio recording → Cloudflare Worker → Whisper transcription

**Prerequisites:** Phase 1 complete, Investigation 5 & 8 complete

#### 2.1 Browser Voice Recording Service

**File:** `packages/web/src/lib/services/voiceRecorder.ts`

```typescript
export interface VoiceRecordingResult {
  blob: Blob;
  duration: number;
  mimeType: string;
}

export interface VoiceRecorderState {
  isRecording: boolean;
  countdown: number;
  error: string | null;
}

const MAX_DURATION_MS = 15000; // 15 seconds
const COUNTDOWN_INTERVAL_MS = 1000;

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startTime: number = 0;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  // Reactive state for UI binding
  state = $state<VoiceRecorderState>({
    isRecording: false,
    countdown: MAX_DURATION_MS / 1000,
    error: null
  });

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000 // Whisper optimal
        }
      });

      // Prefer WebM/Opus for size, fall back to WebM/VP8
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 16000
      });

      this.chunks = [];
      this.startTime = Date.now();

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.chunks.push(e.data);
        }
      };

      this.mediaRecorder.start(1000); // Collect in 1s chunks
      this.state.isRecording = true;
      this.state.error = null;

      // Start countdown
      this.state.countdown = MAX_DURATION_MS / 1000;
      this.countdownTimer = setInterval(() => {
        this.state.countdown -= 1;
        if (this.state.countdown <= 0) {
          this.stop();
        }
      }, COUNTDOWN_INTERVAL_MS);

    } catch (err) {
      this.state.error = err instanceof Error
        ? err.message
        : 'Microphone access denied';
      throw err;
    }
  }

  async stop(): Promise<VoiceRecordingResult> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        reject(new Error('No active recording'));
        return;
      }

      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, {
          type: this.mediaRecorder!.mimeType
        });
        const duration = Date.now() - this.startTime;

        // Clean up stream
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.state.isRecording = false;

        resolve({
          blob,
          duration,
          mimeType: this.mediaRecorder!.mimeType
        });
      };

      this.mediaRecorder.stop();
    });
  }

  cancel(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
    }
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach(track => track.stop());
    this.state.isRecording = false;
    this.chunks = [];
  }
}

export const voiceRecorder = new VoiceRecorder();
```

#### 2.2 Cloudflare Worker Whisper Endpoint

**File:** `packages/cloudflare-do/src/api/transcribe.ts`

```typescript
// UPDATE: Verify Env interface based on Investigation 5
import type { Env } from '../types';

interface TranscribeRequest {
  audio: ArrayBuffer;
}

interface TranscribeResponse {
  transcript: string;
  confidence?: number;
  error?: string;
}

export async function handleTranscribe(
  request: Request,
  env: Env
): Promise<Response> {
  // CORS headers for browser requests
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*', // Tighten in production
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }

  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    if (!audioFile || !(audioFile instanceof Blob)) {
      return Response.json(
        { error: 'No audio file provided' },
        { status: 400, headers: corsHeaders }
      );
    }

    // Size limit: 10MB
    if (audioFile.size > 10 * 1024 * 1024) {
      return Response.json(
        { error: 'Audio file too large (max 10MB)' },
        { status: 400, headers: corsHeaders }
      );
    }

    const audioBytes = await audioFile.arrayBuffer();

    // Call Cloudflare Workers AI Whisper
    // VALIDATE: AI binding name from Investigation 8
    const result = await env.AI.run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audioBytes)]
    });

    return Response.json({
      transcript: result.text || '',
      confidence: result.confidence
    } as TranscribeResponse, { headers: corsHeaders });

  } catch (err) {
    console.error('[Transcribe] Error:', err);
    return Response.json(
      { error: 'Transcription failed' },
      { status: 500, headers: corsHeaders }
    );
  }
}
```

**Worker Routing Update:** (VALIDATED: Add before 404 fallback in worker.ts)
```typescript
// In worker.ts - add route BEFORE the final 404 response
// Current routes end with room matching, then 404
// Add this after room matching, before 404:

import { handleTranscribe } from './api/transcribe';

// ... existing routes ...

// NEW: Transcribe API endpoint
if (url.pathname === '/api/transcribe') {
  return handleTranscribe(request, env);
}

return new Response('Not Found', { status: 404 });
```

**Required: Create api/ directory:**
```bash
mkdir -p packages/cloudflare-do/src/api
```

**Required: Add AI binding to wrangler.toml:**
```toml
# Add at the end of wrangler.toml
[ai]
binding = "AI"
```

**Required: Update Env type in types.ts:**
```typescript
export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  GLOBAL_LOBBY: DurableObjectNamespace;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_SECRET: string;
  // ADD THIS:
  AI: Ai;  // Workers AI binding
}
```

**Tasks:**
| ID | Task | Estimate |
|----|------|----------|
| P2-001 | Create voiceRecorder.ts | 2 hrs |
| P2-002 | Create transcribe.ts worker endpoint | 1.5 hrs |
| P2-003 | Update worker.ts routing | 30 min |
| P2-004 | Add AI binding to wrangler.toml | 15 min |
| P2-005 | Test end-to-end on mobile device | 1 hr |

**Exit Criteria:**
- [ ] Voice recording works on iOS Safari and Android Chrome
- [ ] Transcription returns text within 3 seconds
- [ ] Graceful fallback when microphone denied

---

### Phase 3: Bug Report Submission (Day 4)

**Goal:** Complete bug report service with Supabase storage

**Prerequisites:** Phase 1 & 2 complete, Investigation 6 complete

#### 3.1 Supabase Schema Migration

**File:** `supabase/migrations/YYYYMMDD_create_bug_reports.sql`

```sql
-- Bug Reports Table
CREATE TABLE bug_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reporter context (from auth)
  reporter_id UUID REFERENCES auth.users(id) NOT NULL,
  reporter_name TEXT,  -- Family-friendly display name
  session_id TEXT NOT NULL,

  -- The report
  voice_transcript TEXT,
  voice_audio_url TEXT,  -- Storage bucket path
  text_description TEXT, -- Fallback if no voice
  severity TEXT NOT NULL CHECK (severity IN ('blocking', 'annoying', 'noticed')),

  -- The "Black Box"
  app_state JSONB NOT NULL,
  breadcrumbs JSONB NOT NULL,
  console_logs TEXT[],

  -- Environment
  device_context JSONB NOT NULL,
  page_url TEXT NOT NULL,

  -- Workflow
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'seen', 'fixing', 'fixed', 'wont_fix')),
  resolution_note TEXT,
  celebrated BOOLEAN DEFAULT FALSE,  -- Has user seen "fixed" celebration?

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_bug_reports_reporter ON bug_reports(reporter_id);
CREATE INDEX idx_bug_reports_status ON bug_reports(status);
CREATE INDEX idx_bug_reports_created ON bug_reports(created_at DESC);

-- Row Level Security
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

-- Users can view their own reports
CREATE POLICY "Users can view own reports"
  ON bug_reports FOR SELECT
  USING (reporter_id = auth.uid());

-- Users can create reports
CREATE POLICY "Users can create reports"
  ON bug_reports FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

-- Users can update celebrated status on their own reports
CREATE POLICY "Users can mark as celebrated"
  ON bug_reports FOR UPDATE
  USING (reporter_id = auth.uid())
  WITH CHECK (reporter_id = auth.uid());

-- Storage bucket for audio files
INSERT INTO storage.buckets (id, name, public)
VALUES ('bug-audio', 'bug-audio', false);

-- Storage policies
CREATE POLICY "Authenticated users can upload audio"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'bug-audio'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "Users can access own audio"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'bug-audio'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Cleanup function for resolved reports
CREATE OR REPLACE FUNCTION cleanup_resolved_bug_audio()
RETURNS void AS $$
BEGIN
  -- Delete audio files for resolved reports older than 30 days
  DELETE FROM storage.objects
  WHERE bucket_id = 'bug-audio'
    AND created_at < NOW() - INTERVAL '30 days'
    AND name IN (
      SELECT REPLACE(voice_audio_url, 'bug-audio/', '')
      FROM bug_reports
      WHERE status IN ('fixed', 'wont_fix')
        AND resolved_at < NOW() - INTERVAL '30 days'
    );
END;
$$ LANGUAGE plpgsql;
```

#### 3.2 Bug Report Service

**File:** `packages/web/src/lib/services/bugReport.ts`

```typescript
/**
 * Bug Report Service
 * 
 * UPDATED based on Investigation findings (Jan 4, 2026):
 * - Uses createSupabaseBrowserClient() from '$lib/supabase/client'
 * - Uses correct session ID key: 'dicee_session_id'
 * - Uses validated auth store access patterns
 */

import { createSupabaseBrowserClient } from '$lib/supabase/client';
import { auth } from '$lib/stores/auth.svelte';
import { captureStateSnapshot } from './stateSnapshot';
import { getBreadcrumbs } from './breadcrumbs';
import { getConsoleLogs } from './consoleCapture';
import type { VoiceRecordingResult } from './voiceRecorder';

export type BugSeverity = 'blocking' | 'annoying' | 'noticed';

export interface BugReportPayload {
  severity: BugSeverity;
  voiceRecording?: VoiceRecordingResult;
  textDescription?: string;
}

export interface DeviceContext {
  userAgent: string;
  platform: string;
  language: string;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  connection?: string;
  battery?: number;
  memory?: number;
}

async function captureDeviceContext(): Promise<DeviceContext> {
  const context: DeviceContext = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    screenWidth: screen.width,
    screenHeight: screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio
  };

  // Network info (if available)
  const nav = navigator as Navigator & { connection?: { effectiveType: string } };
  if (nav.connection) {
    context.connection = nav.connection.effectiveType;
  }

  // Battery info (if available)
  try {
    const battery = await (navigator as any).getBattery?.();
    if (battery) {
      context.battery = Math.round(battery.level * 100);
    }
  } catch { /* ignore */ }

  // Memory info (Chrome only)
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  if (perf.memory) {
    context.memory = Math.round(perf.memory.usedJSHeapSize / 1024 / 1024);
  }

  return context;
}

export async function submitBugReport(payload: BugReportPayload): Promise<{ success: boolean; reportId?: string; error?: string }> {
  try {
    // Get current user (validated access pattern)
    const user = auth.user;
    if (!user) {
      return { success: false, error: 'Must be logged in to report bugs' };
    }

    // Capture state immediately
    const appState = captureStateSnapshot();
    const breadcrumbs = getBreadcrumbs();
    const consoleLogs = getConsoleLogs();
    const deviceContext = await captureDeviceContext();

    // Get session ID - CORRECTED: use 'dicee_session_id' key
    const sessionId = sessionStorage.getItem('dicee_session_id') || crypto.randomUUID();
    
    // Create Supabase client - CORRECTED import pattern
    const supabase = createSupabaseBrowserClient();

    let voiceAudioUrl: string | null = null;
    let voiceTranscript: string | null = null;

    // Handle voice recording
    if (payload.voiceRecording) {
      // Upload audio to storage
      const audioPath = `${user.id}/${crypto.randomUUID()}.webm`;
      const { error: uploadError } = await supabase.storage
        .from('bug-audio')
        .upload(audioPath, payload.voiceRecording.blob, {
          contentType: payload.voiceRecording.mimeType
        });

      if (uploadError) {
        console.error('[BugReport] Audio upload failed:', uploadError);
        // Continue without audio - not a fatal error
      } else {
        voiceAudioUrl = audioPath;

        // Transcribe audio
        try {
          const formData = new FormData();
          formData.append('audio', payload.voiceRecording.blob);

          // UPDATE: Actual worker URL from Investigation 5
          const transcribeUrl = import.meta.env.PUBLIC_WORKER_URL + '/api/transcribe';
          const response = await fetch(transcribeUrl, {
            method: 'POST',
            body: formData
          });

          if (response.ok) {
            const result = await response.json();
            voiceTranscript = result.transcript;
          }
        } catch (err) {
          console.error('[BugReport] Transcription failed:', err);
          // Continue without transcript
        }
      }
    }

    // Insert bug report
    const { data, error } = await supabase
      .from('bug_reports')
      .insert({
        reporter_id: user.id,
        // VALIDATED: correct access pattern for display name
        reporter_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Anonymous',
        session_id: sessionId,
        voice_transcript: voiceTranscript,
        voice_audio_url: voiceAudioUrl,
        text_description: payload.textDescription,
        severity: payload.severity,
        app_state: appState,
        breadcrumbs: breadcrumbs,
        console_logs: consoleLogs,
        device_context: deviceContext,
        page_url: window.location.href,
        status: 'new'
      })
      .select('id')
      .single();

    if (error) {
      console.error('[BugReport] Insert failed:', error);
      return { success: false, error: error.message };
    }

    return { success: true, reportId: data.id };

  } catch (err) {
    console.error('[BugReport] Unexpected error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error'
    };
  }
}

// Check for newly resolved reports (for celebration)
export async function checkResolvedReports(): Promise<string[]> {
  const user = auth.user;
  if (!user) return [];

  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('bug_reports')
    .select('id')
    .eq('reporter_id', user.id)
    .eq('status', 'fixed')
    .eq('celebrated', false);

  if (error || !data) return [];

  return data.map(r => r.id);
}

export async function markReportsCelebrated(reportIds: string[]): Promise<void> {
  if (reportIds.length === 0) return;

  const supabase = createSupabaseBrowserClient();
  await supabase
    .from('bug_reports')
    .update({ celebrated: true })
    .in('id', reportIds);
}
```

**Tasks:**
| ID | Task | Estimate |
|----|------|----------|
| P3-001 | Create Supabase migration | 1 hr |
| P3-002 | Run migration and verify schema | 30 min |
| P3-003 | Create bugReport.ts service | 3 hrs |
| P3-004 | Integration test: full submission flow | 1.5 hrs |

**Exit Criteria:**
- [ ] Bug reports persist to Supabase
- [ ] Audio files upload to storage bucket
- [ ] Transcription completes and saves
- [ ] RLS policies prevent cross-user access

---

### Phase 4: Reporter UI Component (Day 5-6)

**Goal:** Neo-Brutalist "HELP" button and reporting flow

**Prerequisites:** Phase 1-3 complete, Investigation 7 complete

#### 4.1 Design Token Integration

Based on **validated tokens.css** (Investigation 6):

```css
/* Bug Reporter specific tokens - ADD to tokens.css */
:root {
  /* Using EXISTING design system tokens (validated) */
  --bug-button-bg: var(--color-accent);      /* #ffd700 Electric Gold ✅ */
  --bug-button-border: var(--color-border);  /* #000000 ✅ */
  --bug-button-text: var(--color-text);      /* #0a0a0a ✅ */
  --bug-overlay-bg: rgba(0, 0, 0, 0.8);
  --bug-recording-pulse: var(--color-danger); /* #ef4444 ✅ */
}

/* Note: Use --weight-bold NOT --font-bold (see Investigation 6) */
```

#### 4.2 Bug Reporter Components

**File Structure:**
```
packages/web/src/lib/components/bug-report/
├── BugReportButton.svelte    # Floating "HELP" button
├── BugReportModal.svelte     # Full-screen reporting flow
├── VoiceRecorder.svelte      # Microphone UI with countdown
├── SeverityPicker.svelte     # Three-option selector
└── index.ts                  # Barrel export
```

**BugReportButton.svelte:**
```svelte
<script lang="ts">
  import { browser } from '$app/environment';

  let showModal = $state(false);

  function handleClick() {
    // Capture state IMMEDIATELY on click (before modal renders)
    // This ensures we get the "moment of bug" state
    if (browser) {
      sessionStorage.setItem('bug_report_trigger_time', Date.now().toString());
    }
    showModal = true;
  }
</script>

{#if showModal}
  <BugReportModal onclose={() => showModal = false} />
{/if}

<!-- Neo-Brutalist "HELP" Button -->
<button
  class="bug-report-trigger"
  onclick={handleClick}
  aria-label="Report a problem"
>
  <span class="bug-icon">🐛</span>
  <span class="bug-text">HELP</span>
</button>

<style>
  .bug-report-trigger {
    position: fixed;
    bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    right: var(--space-3);
    z-index: 1000;

    /* Neo-Brutalist styling */
    background: var(--bug-button-bg);
    border: 4px solid var(--bug-button-border);
    padding: var(--space-2) var(--space-3);

    /* Typography - CORRECTED token names */
    font-family: var(--font-sans);
    font-size: var(--text-small);  /* --text-sm doesn't exist, use --text-small */
    font-weight: var(--weight-bold);  /* CORRECTED: --weight-bold not --font-bold */
    text-transform: uppercase;
    color: var(--bug-button-text);

    /* Touch target */
    min-height: 48px;
    min-width: 48px;

    display: flex;
    align-items: center;
    gap: var(--space-1);

    cursor: pointer;
    transition: transform 0.1s ease;
  }

  .bug-report-trigger:hover {
    transform: translate(-2px, -2px);
    box-shadow: 4px 4px 0 var(--bug-button-border);
  }

  .bug-report-trigger:active {
    transform: translate(0, 0);
    box-shadow: none;
  }

  .bug-icon {
    font-size: 1.25em;
  }

  /* Hide text on very small screens */
  @media (max-width: 360px) {
    .bug-text {
      display: none;
    }
  }
</style>
```

**BugReportModal.svelte:** (Abbreviated - full implementation in code)
```svelte
<script lang="ts">
  import { voiceRecorder } from '$lib/services/voiceRecorder';
  import { submitBugReport, type BugSeverity } from '$lib/services/bugReport';
  import VoiceRecorder from './VoiceRecorder.svelte';
  import SeverityPicker from './SeverityPicker.svelte';

  type { Snippet } from 'svelte';

  let { onclose }: { onclose: () => void } = $props();

  type ReportStep = 'severity' | 'voice' | 'text' | 'submitting' | 'success' | 'error';

  let step = $state<ReportStep>('severity');
  let severity = $state<BugSeverity | null>(null);
  let voiceResult = $state<VoiceRecordingResult | null>(null);
  let textDescription = $state('');
  let errorMessage = $state('');

  async function handleSeveritySelect(selected: BugSeverity) {
    severity = selected;
    step = 'voice';
  }

  async function handleVoiceComplete(result: VoiceRecordingResult) {
    voiceResult = result;
    await submit();
  }

  function handleSkipVoice() {
    step = 'text';
  }

  async function handleTextSubmit() {
    if (!textDescription.trim()) return;
    await submit();
  }

  async function submit() {
    step = 'submitting';

    const result = await submitBugReport({
      severity: severity!,
      voiceRecording: voiceResult ?? undefined,
      textDescription: textDescription || undefined
    });

    if (result.success) {
      step = 'success';
      setTimeout(onclose, 2000);
    } else {
      errorMessage = result.error || 'Something went wrong';
      step = 'error';
    }
  }
</script>

<div class="bug-modal-backdrop" onclick={onclose}>
  <div class="bug-modal" onclick={(e) => e.stopPropagation()}>
    {#if step === 'severity'}
      <h2 class="modal-title">What happened?</h2>
      <SeverityPicker onselect={handleSeveritySelect} />
    {:else if step === 'voice'}
      <h2 class="modal-title">Tell me about it</h2>
      <p class="modal-subtitle">Tap to record (or skip to type)</p>
      <VoiceRecorder
        oncomplete={handleVoiceComplete}
        onskip={handleSkipVoice}
      />
    {:else if step === 'text'}
      <h2 class="modal-title">What happened?</h2>
      <textarea
        class="text-input"
        bind:value={textDescription}
        placeholder="Describe what went wrong..."
        rows="4"
      ></textarea>
      <button class="btn-primary" onclick={handleTextSubmit}>
        Send Report
      </button>
    {:else if step === 'submitting'}
      <div class="submitting">
        <div class="dice-spinner">🎲</div>
        <p>Sending to Jeff...</p>
      </div>
    {:else if step === 'success'}
      <div class="success">
        <span class="success-icon">✅</span>
        <p>Got it! Jeff will look at this.</p>
      </div>
    {:else if step === 'error'}
      <div class="error">
        <span class="error-icon">❌</span>
        <p>{errorMessage}</p>
        <button class="btn-secondary" onclick={() => step = 'severity'}>
          Try Again
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .bug-modal-backdrop {
    position: fixed;
    inset: 0;
    background: var(--bug-overlay-bg);
    z-index: 1001;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }

  .bug-modal {
    background: var(--color-surface);
    border: 4px solid var(--color-border);
    padding: var(--space-4);
    max-width: 400px;
    width: 100%;
    text-align: center;
  }

  .modal-title {
    font-size: var(--text-h2);
    font-weight: var(--weight-bold);  /* CORRECTED */
    margin-bottom: var(--space-2);
  }

  .modal-subtitle {
    color: var(--color-text-muted);
    margin-bottom: var(--space-4);
  }

  .dice-spinner {
    font-size: 3rem;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .text-input {
    width: 100%;
    border: 2px solid var(--color-border);
    padding: var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--text-body);
    resize: vertical;
    margin-bottom: var(--space-3);
  }
</style>
```

**Tasks:**
| ID | Task | Estimate |
|----|------|----------|
| P4-001 | Create BugReportButton.svelte | 1.5 hrs |
| P4-002 | Create BugReportModal.svelte | 3 hrs |
| P4-003 | Create VoiceRecorder.svelte | 2 hrs |
| P4-004 | Create SeverityPicker.svelte | 1 hr |
| P4-005 | Add to root layout | 30 min |
| P4-006 | Mobile testing (iOS Safari, Android Chrome) | 2 hrs |

**Exit Criteria:**
- [ ] Button visible on all pages
- [ ] Modal flow completes on mobile
- [ ] Voice recording works with countdown
- [ ] Graceful text fallback

---

### Phase 5: Family Dashboard (Day 7)

**Goal:** `/family/status` page showing bug report status

**Prerequisites:** Phase 4 complete

#### 5.1 Dashboard Route

**File:** `packages/web/src/routes/family/status/+page.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { auth } from '$lib/stores/auth.svelte';

  interface BugReport {
    id: string;
    severity: string;
    voice_transcript: string | null;
    text_description: string | null;
    status: 'new' | 'seen' | 'fixing' | 'fixed' | 'wont_fix';
    created_at: string;
    resolution_note: string | null;
  }

  let reports = $state<BugReport[]>([]);
  let loading = $state(true);

  const statusDisplay: Record<string, { label: string; icon: string }> = {
    new: { label: "Jeff hasn't seen this yet", icon: '📬' },
    seen: { label: 'Jeff saw it!', icon: '👀' },
    fixing: { label: 'Working on it...', icon: '🔧' },
    fixed: { label: 'Fixed! Try it again', icon: '✅' },
    wont_fix: { label: "This is how it's supposed to work", icon: '💡' }
  };

  onMount(async () => {
    if (!auth.user) return;

    const { data, error } = await supabase
      .from('bug_reports')
      .select('id, severity, voice_transcript, text_description, status, created_at, resolution_note')
      .eq('reporter_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) {
      reports = data;
    }
    loading = false;
  });

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function getDescription(report: BugReport): string {
    if (report.voice_transcript) {
      return report.voice_transcript.slice(0, 100) + (report.voice_transcript.length > 100 ? '...' : '');
    }
    if (report.text_description) {
      return report.text_description.slice(0, 100) + (report.text_description.length > 100 ? '...' : '');
    }
    return 'No description';
  }
</script>

<svelte:head>
  <title>Bug Reports | Dicee</title>
</svelte:head>

<div class="dashboard">
  <header class="dashboard-header">
    <h1>🐛 Bug Reports</h1>
    <p class="subtitle">Thanks for helping make Dicee better!</p>
  </header>

  {#if loading}
    <div class="loading">Loading your reports...</div>
  {:else if reports.length === 0}
    <div class="empty">
      <span class="empty-icon">🎲</span>
      <p>No bug reports yet!</p>
      <p class="empty-hint">When you find something weird, tap the HELP button.</p>
    </div>
  {:else}
    <ul class="report-list">
      {#each reports as report (report.id)}
        <li class="report-card" class:fixed={report.status === 'fixed'}>
          <div class="report-header">
            <span class="status-icon">{statusDisplay[report.status].icon}</span>
            <span class="status-label">{statusDisplay[report.status].label}</span>
          </div>
          <p class="report-description">{getDescription(report)}</p>
          {#if report.resolution_note}
            <p class="resolution-note">💬 {report.resolution_note}</p>
          {/if}
          <div class="report-footer">
            <span class="severity severity-{report.severity}">{report.severity}</span>
            <span class="date">{formatDate(report.created_at)}</span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .dashboard {
    max-width: 600px;
    margin: 0 auto;
    padding: var(--space-4);
  }

  .dashboard-header {
    text-align: center;
    margin-bottom: var(--space-5);
  }

  .dashboard-header h1 {
    font-size: var(--text-h1);
    font-weight: var(--weight-black);  /* CORRECTED */
    margin-bottom: var(--space-1);
  }

  .subtitle {
    color: var(--color-text-muted);
  }

  .report-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .report-card {
    background: var(--color-surface);
    border: 3px solid var(--color-border);
    padding: var(--space-3);
  }

  .report-card.fixed {
    border-color: var(--color-success);
    background: linear-gradient(135deg, var(--color-surface), #ecfdf5);
  }

  .report-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }

  .status-icon {
    font-size: 1.5rem;
  }

  .status-label {
    font-weight: var(--weight-semibold);  /* CORRECTED */
  }

  .report-description {
    color: var(--color-text-muted);
    margin-bottom: var(--space-2);
  }

  .resolution-note {
    background: var(--color-background);
    padding: var(--space-2);
    margin-bottom: var(--space-2);
    font-style: italic;
  }

  .report-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--text-small);  /* CORRECTED: --text-sm → --text-small */
  }

  .severity {
    padding: 2px 8px;
    border: 2px solid;
    font-weight: var(--weight-bold);  /* CORRECTED */
    text-transform: uppercase;
  }

  .severity-blocking {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }
  .severity-annoying {
    border-color: var(--color-warning);
    color: var(--color-warning);
  }
  .severity-noticed {
    border-color: var(--color-text-muted);
    color: var(--color-text-muted);
  }

  .date {
    color: var(--color-text-muted);
  }

  .empty {
    text-align: center;
    padding: var(--space-6);
  }

  .empty-icon {
    font-size: 4rem;
    display: block;
    margin-bottom: var(--space-3);
  }

  .empty-hint {
    color: var(--color-text-muted);
    font-size: var(--text-small);  /* CORRECTED: --text-sm → --text-small */
  }
</style>
```

#### 5.2 Celebration System

**File:** `packages/web/src/lib/components/BugHunterCelebration.svelte`

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { checkResolvedReports, markReportsCelebrated } from '$lib/services/bugReport';

  let showCelebration = $state(false);
  let fixedCount = $state(0);

  onMount(async () => {
    const resolvedIds = await checkResolvedReports();
    if (resolvedIds.length > 0) {
      fixedCount = resolvedIds.length;
      showCelebration = true;
      await markReportsCelebrated(resolvedIds);

      // Auto-dismiss after 5 seconds
      setTimeout(() => {
        showCelebration = false;
      }, 5000);
    }
  });
</script>

{#if showCelebration}
  <div class="celebration-overlay" onclick={() => showCelebration = false}>
    <div class="celebration-content">
      <div class="confetti">🎉</div>
      <h2>Bug Hunter!</h2>
      <p>
        You found {fixedCount} bug{fixedCount > 1 ? 's' : ''}!<br>
        Thanks for helping!
      </p>
    </div>
  </div>
{/if}

<style>
  .celebration-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.9);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.3s ease;
  }

  .celebration-content {
    text-align: center;
    color: white;
    animation: bounceIn 0.5s ease;
  }

  .confetti {
    font-size: 5rem;
    animation: bounce 0.5s ease infinite alternate;
  }

  h2 {
    font-size: 2.5rem;
    font-weight: 900;
    margin: 1rem 0;
    background: linear-gradient(90deg, #ffd700, #ffaa00);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  p {
    font-size: 1.25rem;
    opacity: 0.9;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes bounceIn {
    0% { transform: scale(0.5); opacity: 0; }
    50% { transform: scale(1.1); }
    100% { transform: scale(1); opacity: 1; }
  }

  @keyframes bounce {
    from { transform: translateY(0); }
    to { transform: translateY(-10px); }
  }
</style>
```

**Tasks:**
| ID | Task | Estimate |
|----|------|----------|
| P5-001 | Create /family/status route | 2.5 hrs |
| P5-002 | Create BugHunterCelebration.svelte | 1.5 hrs |
| P5-003 | Add celebration to root layout | 30 min |
| P5-004 | Add navigation link to dashboard | 30 min |

**Exit Criteria:**
- [ ] Dashboard shows all user's bug reports
- [ ] Status labels are human-friendly
- [ ] Celebration triggers on first load after fix
- [ ] Celebration doesn't repeat

---

## Part 4: Testing & Verification Protocol

### Integration Test Checklist

| Test Case | Steps | Expected Result |
|-----------|-------|-----------------|
| Full report with voice | 1. Click HELP 2. Select severity 3. Record voice 4. Verify submission | Report in Supabase with transcript |
| Report with text fallback | 1. Click HELP 2. Select severity 3. Skip voice 4. Type description | Report in Supabase with text |
| Microphone denied | 1. Click HELP 2. Select severity 3. Deny mic permission | Text input shown, report succeeds |
| State capture accuracy | 1. Roll dice 2. Keep some 3. Click HELP 4. Check app_state | Dice values and kept state match |
| Breadcrumb capture | 1. Perform 5 actions 2. Click HELP 4. Check breadcrumbs | Last 5 actions recorded |
| Console capture | 1. Trigger console.error 2. Click HELP 3. Check console_logs | Error captured in logs |
| Dashboard display | 1. Submit report 2. Navigate to /family/status | Report visible with status |
| Celebration trigger | 1. Mark report as fixed (in DB) 2. Reload app | Celebration modal appears |
| Audio deletion | 1. Mark report as fixed 2. Wait 30 days (simulated) 3. Check storage | Audio file deleted |

### Device Testing Matrix

| Device | Browser | Must Test |
|--------|---------|-----------|
| iPhone 14+ | Safari | Voice recording, keyboard handling |
| Pixel 7+ | Chrome | Voice recording, viewport |
| iPad | Safari | Layout, touch targets |
| Desktop | Chrome | Full flow, keyboard shortcuts |
| Desktop | Firefox | Compatibility |

---

## Part 5: ADR & Documentation

### ADR-XXX: Bug Reporting System Architecture

**Status:** Proposed

**Context:**
Family members (non-technical) need to report bugs without describing technical details. Traditional bug reports require context that users don't know how to provide.

**Decision:**
Implement a "Black Box" state capture system that:
1. Serializes full application state on report trigger
2. Captures action breadcrumbs (last 20 actions)
3. Captures console errors (last 30 entries)
4. Supports voice memos with automatic transcription
5. Persists to Supabase with RLS for family-only access

**Consequences:**
- Positive: Developers get complete debugging context
- Positive: Users only need to describe "what happened"
- Negative: State snapshots may contain sensitive data (mitigated by RLS)
- Negative: Voice transcription adds latency (~2-3s)

---

## Part 6: Implementation Timeline

| Day | Phase | Deliverables |
|-----|-------|--------------|
| 1 | Investigation | 8 investigation reports, updated plan |
| 2 | Phase 1 | State capture services, breadcrumbs, console capture |
| 3 | Phase 2 | Voice recording, Whisper endpoint |
| 4 | Phase 3 | Supabase schema, bug report service |
| 5-6 | Phase 4 | Reporter UI components, mobile testing |
| 7 | Phase 5 | Family dashboard, celebration system |
| 8 | Testing | Full integration testing, device matrix |

**Total Estimated Effort:** 28-32 hours

---

## Appendix A: Machine-Readable Task Specification

```yaml
# .claude/workflows/dicee-bug-reporter.yaml
name: Dicee Bug Reporter Implementation
version: "1.0"

governance:
  adr_required: true
  adr_template: madr-3.0

phases:
  - id: investigation
    name: "Phase 0: Investigation"
    tasks:
      - id: INV-001
        name: "Execute all 8 investigations"
        verification: "investigations/results.yaml exists and is valid"
      - id: INV-002
        name: "Document deviations"
        verification: "investigations/deviations.md exists"

  - id: state-capture
    name: "Phase 1: State Capture"
    depends_on: [investigation]
    tasks:
      - id: P1-001
        name: "Create stateSnapshot.ts"
        file: "packages/web/src/lib/services/stateSnapshot.ts"
        verification: "pnpm -F @dicee/web typecheck"
      # ... additional tasks

  # ... additional phases

dependencies:
  - from: P2-003
    to: P2-002
    reason: "Worker routing depends on transcribe endpoint"
  - from: P3-003
    to: P3-001
    reason: "Bug report service depends on schema"
```

---

## Appendix B: Quick Reference

### File Paths (UPDATE after Investigation 1)

```
packages/web/src/lib/
├── services/
│   ├── stateSnapshot.ts      [NEW]
│   ├── breadcrumbs.ts        [NEW]
│   ├── consoleCapture.ts     [NEW]
│   ├── voiceRecorder.ts      [NEW]
│   └── bugReport.ts          [NEW]
├── stores/
│   └── (existing stores)
└── components/
    └── bug-report/
        ├── BugReportButton.svelte    [NEW]
        ├── BugReportModal.svelte     [NEW]
        ├── VoiceRecorder.svelte      [NEW]
        ├── SeverityPicker.svelte     [NEW]
        └── index.ts                  [NEW]

packages/cloudflare-do/src/
├── api/
│   └── transcribe.ts         [NEW]
└── worker.ts                 [MODIFY - add route]

supabase/migrations/
└── YYYYMMDD_create_bug_reports.sql  [NEW]
```

### Environment Variables Required

```bash
# packages/web/.env (likely already configured)
PUBLIC_SUPABASE_URL=https://xxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJ...

# For transcribe endpoint, use relative URL via Pages proxy
# No PUBLIC_WORKER_URL needed - Pages routes /ws/* to the Worker
# The transcribe endpoint will be at: /api/transcribe (via Worker)

# packages/cloudflare-do wrangler.toml - ADD THIS:
[ai]
binding = "AI"
```

### Session ID Key (Validated)

```typescript
// CORRECT: Use this key for session ID
const SESSION_ID_KEY = 'dicee_session_id';
sessionStorage.getItem(SESSION_ID_KEY);

// INCORRECT: Do not use this
// 'telemetry_session_id' - wrong key!
```
