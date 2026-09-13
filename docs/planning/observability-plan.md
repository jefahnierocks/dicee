# Comprehensive Observability Plan for Dicee Game States & Connections

> **Historical MCP note (2026-09-12):** the narrow `cloudflare-observability`, `cloudflare-builds`, `cloudflare-bindings`, `cloudflare-logpush`, and `cloudflare-graphql` MCP servers named in this document were retired. Use the opt-in `cloudflare-api` server (per-client OAuth) or `cloudflare-docs`; see [`docs/MCP-SETUP.md`](../MCP-SETUP.md).

> **Version**: 1.0.0
> **Created**: 2025-01-XX
> **Status**: Planning
> **Prerequisites**: Cloudflare MCP servers configured, existing instrumentation.md reviewed
>
> **⚠️ CRITICAL: Implementation Workflow**
>
> **👉 START HERE**: **[Observability Workflow](observability-workflow.md)** - Complete step-by-step implementation guide
>
> **Then Read (In Order)**:
>
> 1. **[Observability Project Review](observability-project-review.md)** - Project-wide strategy
>    - Type-safe, test-first approach
>    - Technical debt elimination (29 console.logs identified)
>    - Unified structure and migration path
>    - Quality gates and success metrics
>
> 2. **[Observability Architectural Patterns](observability-architectural-patterns.md)** - Implementation patterns
>    - Zod 4 schemas for all event types
>    - Test-first approach with fixtures
>    - Const array → inferred type pattern
>    - AKG layer integration
>    - Validation strategy
>
> 3. **[MCP Orchestration Review](mcp-orchestration-review.md)** - MCP tool integration
>    - Memory entity schemas
>    - AKG validation workflow
>    - MCP tool usage patterns
>
> **The workflow document consolidates all planning documents into actionable steps.**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Observability Architecture](#3-observability-architecture)
4. [Implementation Phases](#4-implementation-phases)
5. [Cloudflare MCP Integration](#5-cloudflare-mcp-integration)
6. [Instrumentation Strategy](#6-instrumentation-strategy)
7. [Monitoring & Alerting](#7-monitoring--alerting)
8. [Debugging Workflows](#8-debugging-workflows)
9. [Success Metrics](#9-success-metrics)

---

## 1. Executive Summary

### 1.1 Problem Statement

The Dicee multiplayer system experiences fickle game state persistence and connection stability issues:

| Symptom | Impact | Frequency |
|---------|--------|-----------|
| Game resets on refresh | Player loses progress | High |
| Players become spectators | Seat reservation fails | Medium |
| Constant reconnecting | Poor UX, connection drops | Medium |
| State desynchronization | Game corruption | Low |

**Root Cause Hypothesis**: State synchronization failures between:
- Client ↔ WebSocket ↔ Durable Object ↔ Storage

### 1.2 Solution Overview

Implement comprehensive observability using:
- **Structured logging** with correlation IDs
- **Cloudflare MCP tools** for real-time querying and up-to-date documentation
- **Custom metrics** for game state health
- **Automated alerting** for anomalies
- **Debug dashboards** for rapid diagnosis

### 1.3 Key Objectives

1. **Visibility**: See every state transition and connection event
2. **Correlation**: Link client actions to server state changes
3. **Proactive Detection**: Alert before users report issues
4. **Rapid Debugging**: Identify root cause in < 5 minutes

### 1.4 Documentation Strategy

**CRITICAL**: This plan emphasizes using MCP servers for up-to-date documentation:

- **Context7 MCP** (`context7`): Use FIRST for any library/API documentation
  - Cloudflare Workers, Durable Objects, WebSocket APIs
  - TypeScript types and interfaces
  - Code examples and best practices
  
- **Cloudflare Docs MCP** (`cloudflare-docs`): Use FIRST for Cloudflare-specific questions
  - Official Cloudflare documentation search
  - Platform features and capabilities
  - Configuration options

**Why**: Cloudflare's platform evolves rapidly. Training data may be outdated. MCP servers provide current, version-specific documentation directly from source.

**Implementation Rule**: Before implementing any feature, query MCP servers for current best practices and API signatures.

---

## 2. Current State Analysis

### 2.1 Existing Infrastructure

**Durable Objects:**
- `GameRoom` - Per-room game state management
- `GlobalLobby` - Singleton for global presence/chat

**Storage:**
- SQLite-backed storage (via `ctx.storage`)
- Keys: `room`, `game`, `seats`, `chat`, `room_code`

**Logging:**
- Basic `console.log` statements
- `createLogger` utility exists but underutilized
- No structured event tracking

**MCP Tools Available:**
- `cloudflare-observability` - Workers logs, metrics, analytics
- `cloudflare-builds` - Build status and deployment logs
- `cloudflare-bindings` - KV, R2, D1 resource inspection
- `cloudflare-graphql` - Analytics API queries
- `cloudflare-docs` - Documentation search

### 2.2 Gaps Identified

| Gap | Impact | Priority |
|-----|--------|-----------|
| No structured event logging | Can't query specific events | **Critical** |
| No correlation IDs | Can't trace request flow | **Critical** |
| No metrics aggregation | Can't detect patterns | **High** |
| No alerting | Reactive, not proactive | **High** |
| Limited storage visibility | Can't verify persistence | **Medium** |
| No client-server correlation | Can't debug desyncs | **Medium** |

---

## 3. Observability Architecture

### 3.1 Three-Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                             │
│  • WebSocket connection state                               │
│  • Game state sync status                                  │
│  • Reconnection attempts                                   │
│  • User actions (roll, score, etc.)                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ WebSocket + HTTP
┌──────────────────────▼──────────────────────────────────────┐
│                  WORKER LAYER                               │
│  • Structured event logging (JSON)                          │
│  • Correlation IDs (request-scoped)                        │
│  • Storage operation tracking                              │
│  • WebSocket lifecycle events                              │
│  • State machine transitions                               │
└──────────────────────┬──────────────────────────────────────┘
                       │ Cloudflare Logs API
┌──────────────────────▼──────────────────────────────────────┐
│              OBSERVABILITY LAYER                            │
│  • Cloudflare Workers Logs (real-time)                     │
│  • Cloudflare Analytics (aggregated)                       │
│  • MCP Query Interface (AI-assisted)                      │
│  • Custom Dashboards (Grafana/Cloudflare)                  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Event Taxonomy

**Lifecycle Events:**
- `lifecycle.wake` - DO wakes from hibernation
- `lifecycle.connect` - WebSocket opens
- `lifecycle.disconnect` - WebSocket closes
- `lifecycle.reconnect` - Client reconnects

**Storage Events:**
- `storage.read.start` / `storage.read.end`
- `storage.write.start` / `storage.write.end`
- `storage.delete` / `storage.list`

**State Machine Events:**
- `state.transition` - Valid state change
- `state.transition.rejected` - Invalid transition attempt
- `state.snapshot` - Full state dump (debug mode)

**Seat Management Events:**
- `seat.assign` - Player assigned to seat
- `seat.reserve` - Seat reserved for reconnection
- `seat.reclaim.attempt` / `seat.reclaim.result`
- `seat.release` - Seat released (timeout/leave)

**Game Events:**
- `game.start` - Game begins
- `game.turn.start` / `game.turn.end`
- `game.roll` - Dice rolled
- `game.score` - Category scored
- `game.complete` - Game ends

**Connection Events:**
- `connection.auth.success` / `connection.auth.failure`
- `connection.token.expired`
- `connection.rate_limit`

**Error Events:**
- `error.handler.failed` - Handler exception
- `error.storage.failed` - Storage operation failed
- `error.broadcast.failed` - WebSocket send failed
- `error.state.corruption` - Invalid state detected

### 3.3 Correlation Strategy

**Request Correlation:**
- Each WebSocket message gets unique `requestId`
- All logs in same request share `requestId`
- Client sends `correlationId` in message header

**Session Correlation:**
- Each connection has `connectionId` (WebSocket tag)
- Each user has `userId` (from JWT)
- Each room has `roomCode` (from DO name)

**Trace Flow:**
```
Client Action → correlationId: abc123
    ↓
WebSocket Message → requestId: 1, correlationId: abc123
    ↓
Storage Read → requestId: 1, correlationId: abc123
    ↓
State Update → requestId: 1, correlationId: abc123
    ↓
Broadcast → requestId: 1, correlationId: abc123
```

---

## 4. Implementation Phases

> **Note**: For detailed day-by-day implementation checklist, see [Observability Project Review](observability-project-review.md#8-implementation-checklist-detailed)

### Phase 1: Core Instrumentation (Week 1)

**Goal**: Add structured logging to all critical paths

**Pre-Implementation Checklist:**
- [ ] Query `context7` MCP: "Cloudflare Workers structured logging best practices"
- [ ] Query `cloudflare-docs` MCP: "Workers Logs observability configuration"
- [ ] Query `context7` MCP: "Durable Objects WebSocket hibernation API handlers"
- [ ] Verify current `wrangler.toml` observability configuration syntax

**Tasks:**
1. Create `Instrumentation` class with typed events
   - Use MCP-provided examples for console.log JSON structure
   - Verify log format matches Cloudflare Workers Logs expectations
2. Integrate into `GameRoom.webSocketMessage()`
   - Verify handler signature via `context7` MCP
3. Integrate into `GameRoom.webSocketClose()`
   - Verify handler signature via `context7` MCP
4. Integrate into `GameRoom.webSocketError()`
   - Verify handler signature via `context7` MCP
5. Add storage operation wrappers
6. Add state transition tracking

**Deliverables:**
- `packages/cloudflare-do/src/lib/instrumentation.ts`
- Updated `GameRoom.ts` with instrumentation
- Updated `GlobalLobby.ts` with instrumentation
- Test coverage for instrumentation
- Documentation references to MCP-verified APIs

**Success Criteria:**
- All lifecycle events logged
- All storage operations tracked
- Correlation IDs present in all logs
- Logs queryable via `cloudflare-observability` MCP
- API usage matches current Cloudflare Workers patterns (verified via MCP)

### Phase 2: Cloudflare MCP Integration (Week 1-2)

**Goal**: Enable AI-assisted querying via MCP tools and documentation lookup

**Pre-Implementation Checklist:**
- [ ] Verify MCP servers are configured (see `.mcp.json`)
- [ ] Test `cloudflare-observability` MCP connection
- [ ] Test `cloudflare-docs` MCP connection
- [ ] Test `context7` MCP connection
- [ ] Verify authentication (OAuth for Cloudflare, API key for Context7)

**Tasks:**
1. Verify MCP server configuration
   - Check `.mcp.json` and `.cursor/mcp.json`
   - Test each MCP server connection
   - Document authentication requirements
2. Create query templates for common scenarios
   - Use `cloudflare-observability` for log queries
   - Use `cloudflare-docs` for documentation lookups
   - Use `context7` for library API documentation
3. Build helper functions for MCP queries
4. Document MCP query patterns with examples
5. Create debugging scripts using MCP
6. Create documentation lookup workflow
   - When to use which MCP server
   - How to query for current best practices

**Deliverables:**
- MCP query templates in `.claude/mcp-queries/`
- Helper scripts in `scripts/observability/`
- MCP usage guide in `docs/planning/observability-plan.md`
- Documentation lookup workflow

**Success Criteria:**
- Can query logs via MCP in < 5 seconds
- Can filter by event type, room, user
- Can correlate client-server events
- Can look up current Cloudflare documentation via MCP
- Can get up-to-date library examples via Context7

### Phase 3: Metrics & Aggregation (Week 2)

**Goal**: Track key metrics for health monitoring

**Tasks:**
1. Define key metrics (see Section 6.3)
2. Implement metric collection in instrumentation
3. Create Cloudflare Analytics custom events
4. Build metric aggregation queries
5. Create metric dashboards

**Deliverables:**
- Metric definitions document
- Metric collection code
- Cloudflare Analytics integration
- Dashboard queries

**Success Criteria:**
- Metrics collected for all key events
- Aggregations available via MCP
- Dashboards show real-time health

### Phase 4: Alerting & Detection (Week 3)

**Goal**: Proactive issue detection

**Tasks:**
1. Define alert conditions
2. Implement anomaly detection
3. Create alerting rules (Cloudflare Workers)
4. Set up notification channels
5. Create runbooks for common alerts

**Deliverables:**
- Alert definitions
- Alerting worker (or Cloudflare native)
- Notification integration (Slack/email)
- Runbook documentation

**Success Criteria:**
- Alerts fire for critical issues
- False positive rate < 5%
- Mean time to detection < 1 minute

### Phase 5: Client-Side Correlation (Week 3-4)

**Goal**: Link client actions to server events

**Tasks:**
1. Add correlation IDs to client WebSocket messages
2. Create client-side event logger
3. Build client-server correlation tool
4. Add debug panel enhancements
5. Create correlation dashboard

**Deliverables:**
- Client instrumentation
- Correlation tool
- Enhanced debug panel
- Correlation dashboard

**Success Criteria:**
- Can trace client action → server event
- Correlation tool works in < 10 seconds
- Debug panel shows correlation IDs

### Phase 6: Storage Visibility (Week 4)

**Goal**: Inspect Durable Object storage state

**Tasks:**
1. Create storage inspection endpoints
2. Build storage diff tool
3. Add storage health checks
4. Create storage visualization
5. Document storage debugging workflow

**Deliverables:**
- Storage inspection API
- Storage diff tool
- Health check endpoints
- Storage visualization
- Debugging guide

**Success Criteria:**
- Can inspect storage via API
- Can diff storage between states
- Health checks detect corruption

---

## 5. Cloudflare MCP Integration

### 5.1 Available MCP Tools

**cloudflare-observability:**
- `query_worker_observability` - Query logs, metrics, analytics
- Filters: time range, log level, search text
- Returns: structured log entries with metadata
- **Use FIRST** for any log queries or telemetry questions

**cloudflare-docs:**
- `search_cloudflare_documentation` - Search official Cloudflare docs
- **Use FIRST** for Cloudflare-specific questions
- Returns current, version-specific documentation
- **CRITICAL**: Always use this instead of training data for Cloudflare APIs

**cloudflare-builds:**
- `workers_builds_list_builds` - List recent deployments
- `workers_builds_get_build` - Get build details
- `workers_builds_get_build_logs` - Get build logs
- Useful for correlating issues with deployments

**cloudflare-bindings:**
- `kv_namespaces_list` - List KV namespaces
- `r2_buckets_list` - List R2 buckets
- `d1_databases_list` - List D1 databases
- Useful for verifying storage resources

**cloudflare-graphql:**
- `graphql_query` - Query Analytics API
- Custom queries for aggregated metrics
- Time-series data for dashboards

**context7:**
- `resolve-library-id` - Find library IDs (e.g., `/websites/developers_cloudflare_workers`)
- `get-library-docs` - Get up-to-date library documentation with code examples
- **Use FIRST** for any library/API documentation (Cloudflare Workers, Durable Objects, etc.)
- **CRITICAL**: Always use this instead of training data for library APIs

### 5.1.1 MCP Usage Workflow

**Before Implementing Any Feature:**

1. **For Cloudflare APIs**: Query `cloudflare-docs` MCP server
   ```
   Using cloudflare-docs MCP server, search for "Workers observability configuration"
   ```

2. **For Library Documentation**: Query `context7` MCP server
   ```
   Using context7 MCP server, get documentation for Cloudflare Workers Durable Objects
   with topic "websocket hibernation lifecycle"
   ```

3. **For Current Best Practices**: Query both servers
   ```
   Using context7 MCP server, get current best practices for structured logging in Cloudflare Workers
   ```

**During Implementation:**

- Reference MCP-provided documentation in code comments
- Use exact API signatures from MCP responses
- Follow current patterns from MCP code examples

**When Debugging:**

- Use `cloudflare-observability` MCP for log queries
- Use `cloudflare-docs` MCP to verify API usage
- Use `context7` MCP for troubleshooting library-specific issues

### 5.2 Query Patterns

**Pattern 1: Find All Seat Reclamation Attempts**
```
Using cloudflare-observability, query logs from dicee worker
where event contains "seat.reclaim.attempt"
in the last hour
show me the sequence of events for each user
```

**Pattern 2: Detect Storage Read Failures**
```
Using cloudflare-observability, query logs from dicee worker
where event is "storage.read.end" and found is false
in the last 24 hours
group by roomCode and show count
```

**Pattern 3: Find Connection Instability**
```
Using cloudflare-observability, query logs from dicee worker
where event is "lifecycle.disconnect" and closeCode is 1006
in the last hour
show me the frequency and which rooms are affected
```

**Pattern 4: Correlate Client-Server Events**
```
Using cloudflare-observability, query logs from dicee worker
where correlationId matches "abc123"
show me all events in chronological order
```

**Pattern 5: Detect State Corruption**
```
Using cloudflare-observability, query logs from dicee worker
where event is "error.state.corruption"
in the last 7 days
show me the roomCode and the state snapshot
```

### 5.3 MCP Query Helper Scripts

**Create:** `scripts/observability/query-seat-issues.sh`
```bash
#!/bin/bash
# Query seat reclamation failures using MCP

# This would be called via MCP, but for manual use:
wrangler tail dicee --format json | \
  jq 'select(.logs[].message[] | contains("seat.reclaim.result"))' | \
  jq 'select(.result == "spectator")'
```

**Create:** `scripts/observability/query-storage-failures.sh`
```bash
#!/bin/bash
# Query storage read/write failures

wrangler tail dicee --format json | \
  jq 'select(.logs[].message[] | 
    (contains("storage.read.end") or contains("storage.write.end")) and 
    (.success == false or .found == false)
  )'
```

### 5.4 MCP Query Templates

**Create:** `.claude/mcp-queries/seat-reclamation.md`
```markdown
# Seat Reclamation Query Template

## Query All Failed Reclamations
```
Using cloudflare-observability MCP server, query the dicee worker logs
where:
  - event contains "seat.reclaim.result"
  - result equals "spectator"
  - time range: last 24 hours
Show me:
  - userId
  - roomCode
  - reason
  - timestamp
Group by roomCode and show failure count
```

## Query Reclamation Timeline
```
Using cloudflare-observability MCP server, query the dicee worker logs
where:
  - correlationId equals "{correlationId}"
Show me all events in chronological order:
  - lifecycle.disconnect
  - seat.reserve
  - lifecycle.connect
  - seat.reclaim.attempt
  - seat.reclaim.result
```
```

**Create:** `.claude/mcp-queries/storage-operations.md`
```markdown
# Storage Operations Query Template

## Find Missing Game State
```
Using cloudflare-observability MCP server, query the dicee worker logs
where:
  - event is "storage.read.end"
  - key equals "game"
  - found equals false
  - time range: last 24 hours
Show me:
  - roomCode
  - requestId
  - timestamp
  - Previous storage.write.end for same roomCode
```

## Find Slow Storage Operations
```
Using cloudflare-observability MCP server, query the dicee worker logs
where:
  - event contains "storage.write.end"
  - durationMs greater than 1000
  - time range: last hour
Show me:
  - key
  - durationMs
  - roomCode
  - timestamp
Order by durationMs descending
```
```

---

## 6. Instrumentation Strategy

### 6.1 Instrumentation Class Design

**Create:** `packages/cloudflare-do/src/lib/instrumentation.ts`

> **IMPORTANT**: Before implementing, query MCP servers for current best practices:
> - `context7`: Get latest Cloudflare Workers logging patterns
> - `cloudflare-docs`: Verify Workers Logs API and structured logging recommendations
>
> **CRITICAL**: This implementation must follow patterns defined in `observability-architectural-patterns.md`:
> - Use Zod 4 schemas from `events.schema.ts`
> - Validate events before emission
> - Follow const array → inferred type pattern
> - Write tests FIRST (test-driven)

```typescript
/**
 * Comprehensive instrumentation for Dicee Durable Objects
 *
 * Features:
 * - Structured JSON logging for Cloudflare Logs
 * - Zod 4 schema validation for all events
 * - Correlation IDs for request tracing
 * - Event taxonomy for querying
 * - Performance metrics collection
 * - Error tracking with context
 *
 * Implementation Notes:
 * - Uses console.log/error for structured JSON output (Cloudflare Workers standard)
 * - Logs are automatically ingested when [observability] is enabled in wrangler.toml
 * - Structured JSON enables querying via Cloudflare Dashboard and MCP tools
 * - All events validated with Zod before emission (see events.schema.ts)
 *
 * References:
 * - Cloudflare Workers Logs: https://developers.cloudflare.com/workers/observability/logs/workers-logs
 * - Current API verified via cloudflare-docs MCP server
 * - Schema patterns: observability-architectural-patterns.md
 */

import { validateLogEntry, type EventType, type LogLevel, type Component } from './observability/events.schema.js';

// Note: BaseLogEntry is now defined in events.schema.ts as Zod schema
// Import from schema instead of defining here

export function createInstrumentation(
  component: 'GameRoom' | 'GlobalLobby',
  roomCode?: string
) {
  const baseContext = { _component: component, roomCode };
  let requestId = 0;

  function emit(level: LogLevel, event: string, data?: Record<string, unknown>) {
    const entry: BaseLogEntry & Record<string, unknown> = {
      _ts: Date.now(),
      _level: level,
      _event: event,
      _reqId: ++requestId,
      ...baseContext,
      ...data,
    };
    
    // Output as JSON for Cloudflare Logs parsing
    console[level === 'debug' ? 'log' : level](JSON.stringify(entry));
  }

  return {
    // === LIFECYCLE EVENTS ===
    
    hibernationWake(storageKeys: string[], connectedClients: number) {
      emit('info', 'lifecycle.wake', {
        storageKeys,
        connectedClients,
        hasGameState: storageKeys.includes('game'),
        hasSeats: storageKeys.includes('seats'),
        hasRoomState: storageKeys.includes('room'),
        keyCount: storageKeys.length,
      });
    },

    clientConnect(userId: string, role: 'player' | 'spectator' | 'pending', connectionId: string) {
      emit('info', 'lifecycle.connect', { 
        userId, 
        role,
        connectionId,
      });
    },

    clientDisconnect(
      userId: string, 
      code: number, 
      reason: string, 
      wasPlayer: boolean,
      connectionId: string
    ) {
      emit('info', 'lifecycle.disconnect', {
        userId,
        connectionId,
        closeCode: code,
        closeReason: reason,
        wasPlayer,
        codeCategory: categorizeCloseCode(code),
      });
    },

    clientReconnect(userId: string, previousConnectionId: string, newConnectionId: string) {
      emit('info', 'lifecycle.reconnect', {
        userId,
        previousConnectionId,
        newConnectionId,
      });
    },

    // === STORAGE EVENTS ===

    storageReadStart(key: string) {
      emit('debug', 'storage.read.start', { key });
    },

    storageReadEnd(
      key: string, 
      found: boolean, 
      valueType?: string, 
      duration?: number,
      sizeBytes?: number
    ) {
      emit('info', 'storage.read.end', {
        key,
        found,
        valueType,
        durationMs: duration,
        sizeBytes,
      });
    },

    storageWriteStart(key: string, valueType: string, sizeBytes?: number) {
      emit('debug', 'storage.write.start', { 
        key, 
        valueType,
        sizeBytes,
      });
    },

    storageWriteEnd(key: string, success: boolean, duration?: number) {
      emit('info', 'storage.write.end', {
        key,
        success,
        durationMs: duration,
      });
    },

    storageDelete(key: string, success: boolean) {
      emit('info', 'storage.delete', { key, success });
    },

    // === STATE MACHINE EVENTS ===

    stateTransition(from: string, to: string, trigger: string, context?: Record<string, unknown>) {
      emit('info', 'state.transition', { 
        from, 
        to, 
        trigger,
        ...context,
      });
    },

    stateTransitionRejected(
      current: string, 
      attempted: string, 
      trigger: string, 
      reason: string
    ) {
      emit('warn', 'state.transition.rejected', {
        currentState: current,
        attemptedState: attempted,
        trigger,
        reason,
      });
    },

    stateSnapshot(storage: DurableObjectStorage, reason: string) {
      // Async - call separately
      return this._stateSnapshot(storage, reason);
    },

    async _stateSnapshot(storage: DurableObjectStorage, reason: string) {
      const allData = await storage.list();
      const snapshot: Record<string, unknown> = {};
      
      for (const [key, value] of allData) {
        const serialized = JSON.stringify(value);
        snapshot[key] = serialized.length > 500 
          ? { 
              _truncated: true, 
              _length: serialized.length, 
              _preview: serialized.slice(0, 200) 
            }
          : value;
      }

      emit('info', 'diagnostic.snapshot', {
        reason,
        keyCount: allData.size,
        keys: [...allData.keys()],
        snapshot,
      });
    },

    // === SEAT MANAGEMENT EVENTS ===

    seatAssign(userId: string, turnOrder: number, totalSeats: number) {
      emit('info', 'seat.assign', { 
        userId, 
        turnOrder, 
        totalSeats 
      });
    },

    seatReserve(userId: string, deadlineMs: number) {
      emit('info', 'seat.reserve', {
        userId,
        deadlineMs,
        deadlineTime: new Date(deadlineMs).toISOString(),
        reservationWindowSec: Math.round((deadlineMs - Date.now()) / 1000),
      });
    },

    seatReclaimAttempt(
      userId: string, 
      hasSeat: boolean, 
      isConnected: boolean, 
      deadline: number | null
    ) {
      const now = Date.now();
      emit('info', 'seat.reclaim.attempt', {
        userId,
        hasSeat,
        seatCurrentlyConnected: isConnected,
        deadline,
        now,
        withinDeadline: deadline ? now < deadline : false,
        msUntilDeadline: deadline ? deadline - now : null,
      });
    },

    seatReclaimResult(userId: string, result: 'reclaimed' | 'spectator', reason?: string) {
      emit('info', 'seat.reclaim.result', { 
        userId, 
        result, 
        reason 
      });
    },

    seatRelease(userId: string, reason: 'timeout' | 'leave' | 'kick') {
      emit('info', 'seat.release', { userId, reason });
    },

    // === GAME EVENTS ===

    gameStart(roomCode: string, playerCount: number, playerIds: string[]) {
      emit('info', 'game.start', {
        roomCode,
        playerCount,
        playerIds,
      });
    },

    gameTurnStart(turnNumber: number, playerId: string, roundNumber: number) {
      emit('info', 'game.turn.start', {
        turnNumber,
        playerId,
        roundNumber,
      });
    },

    gameTurnEnd(turnNumber: number, playerId: string, score: number) {
      emit('info', 'game.turn.end', {
        turnNumber,
        playerId,
        score,
      });
    },

    gameRoll(turnNumber: number, playerId: string, rollNumber: number, dice: number[]) {
      emit('info', 'game.roll', {
        turnNumber,
        playerId,
        rollNumber,
        diceCount: dice.length,
        // Don't log full dice array in production (privacy)
        diceHash: hashDiceArray(dice),
      });
    },

    gameScore(
      turnNumber: number, 
      playerId: string, 
      category: string, 
      points: number,
      wasOptimal: boolean
    ) {
      emit('info', 'game.score', {
        turnNumber,
        playerId,
        category,
        points,
        wasOptimal,
      });
    },

    gameComplete(roomCode: string, finalScores: Record<string, number>) {
      emit('info', 'game.complete', {
        roomCode,
        playerCount: Object.keys(finalScores).length,
        winner: Object.entries(finalScores)
          .sort(([, a], [, b]) => b - a)[0]?.[0],
      });
    },

    // === CONNECTION EVENTS ===

    connectionAuthSuccess(userId: string, method: 'jwt' | 'query') {
      emit('info', 'connection.auth.success', { userId, method });
    },

    connectionAuthFailure(reason: string, method?: string) {
      emit('warn', 'connection.auth.failure', { reason, method });
    },

    connectionTokenExpired(userId: string, expiresAt: number) {
      emit('warn', 'connection.token.expired', {
        userId,
        expiresAt,
        expiredAt: new Date(expiresAt).toISOString(),
      });
    },

    connectionRateLimit(userId: string, limit: number, window: number) {
      emit('warn', 'connection.rate_limit', {
        userId,
        limit,
        window,
      });
    },

    // === BROADCAST EVENTS ===

    broadcastPrepare(eventType: string, recipientCount: number) {
      emit('debug', 'broadcast.prepare', { 
        eventType, 
        recipientCount 
      });
    },

    broadcastSent(eventType: string, recipientCount: number, successCount: number) {
      emit('debug', 'broadcast.sent', { 
        eventType, 
        recipientCount,
        successCount,
        failureCount: recipientCount - successCount,
      });
    },

    // === ERROR TRACKING ===

    error(event: string, error: unknown, context?: Record<string, unknown>) {
      emit('error', event, {
        ...context,
        errorMessage: error instanceof Error ? error.message : String(error),
        errorStack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    },

    // === CORRELATION ===

    setCorrelationId(correlationId: string) {
      // Store in closure for this request
      baseContext._correlationId = correlationId;
    },
  };
}

function categorizeCloseCode(code: number): string {
  switch (code) {
    case 1000: return 'normal';
    case 1001: return 'going_away';
    case 1006: return 'abnormal_no_close_frame';
    case 1008: return 'policy_violation';
    case 1011: return 'server_error';
    case 1012: return 'service_restart';
    case 1013: return 'try_again_later';
    case 1014: return 'bad_gateway';
    default: return `unknown_${code}`;
  }
}

function hashDiceArray(dice: number[]): string {
  // Simple hash for privacy (don't log actual dice values)
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(dice.join(',')))
    .then(buf => Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16));
}

export type Instrumentation = ReturnType<typeof createInstrumentation>;
```

### 6.2 Integration Points

> **IMPORTANT**: Before implementing, verify current Durable Objects WebSocket API:
> - Query `context7` MCP: "Cloudflare Durable Objects WebSocket hibernation lifecycle handlers"
> - Query `cloudflare-docs` MCP: "Durable Objects WebSocket message close error handlers"

**GameRoom Integration:**
```typescript
// In GameRoom class (extends DurableObject<Env>)
// Note: Using current API from cloudflare:workers package
// Verified via context7 MCP server

private instr: Instrumentation | null = null;

// In constructor or ensureInitialized()
// Note: Durable Objects can hibernate, so initialization may happen on wake
private async ensureInitialized(): Promise<void> {
  if (this.instr) return;
  
  this.instr = createInstrumentation('GameRoom', this.getRoomCode());
  
  // Log hibernation wake with storage state
  const allKeys = [...(await this.ctx.storage.list()).keys()];
  const connectedCount = this.ctx.getWebSockets().length;
  this.instr.hibernationWake(allKeys, connectedCount);
}

// In webSocketMessage handler (current API)
async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
  await this.ensureInitialized();
  
  const parsed = JSON.parse(message as string);
  const correlationId = parsed.correlationId;
  
  if (correlationId) {
    this.instr?.setCorrelationId(correlationId);
  }
  
  this.instr?.broadcastPrepare(parsed.type, 1);
  // ... handle message
}

// In webSocketClose handler (current API)
async webSocketClose(
  ws: WebSocket, 
  code: number, 
  reason: string, 
  wasClean: boolean
): Promise<void> {
  await this.ensureInitialized();
  
  const attachment = ws.deserializeAttachment() as ConnectionState | null;
  const userId = attachment?.userId ?? 'unknown';
  const wasPlayer = attachment?.role === 'player';
  
  this.instr?.clientDisconnect(userId, code, reason, wasPlayer, ws.url ?? '');
  // ... handle disconnect
}

// In storage operations
const start = Date.now();
this.instr?.storageReadStart('game');
const gameState = await this.ctx.storage.get<GameState>('game');
this.instr?.storageReadEnd('game', !!gameState, typeof gameState, Date.now() - start);
```

**API Notes** (from current Cloudflare docs via MCP):
- `webSocketMessage(ws, message)` - Called when message received (DO may have hibernated)
- `webSocketClose(ws, code, reason, wasClean)` - Called when connection closes
- `webSocketError(ws, error)` - Called on WebSocket errors
- `this.ctx.acceptWebSocket(server)` - Accepts hibernatable WebSocket (not `ws.accept()`)
- `this.ctx.getWebSockets(tag?)` - Gets all WebSockets (optionally filtered by tag)

### 6.3 Key Metrics

**Connection Health:**
- `connection.success_rate` - % successful connections
- `connection.reconnect_rate` - % connections that reconnect
- `connection.avg_duration` - Average connection duration
- `connection.close_code_distribution` - Histogram of close codes

**State Persistence:**
- `storage.read.success_rate` - % successful reads
- `storage.write.success_rate` - % successful writes
- `storage.avg_read_latency` - Average read time (ms)
- `storage.avg_write_latency` - Average write time (ms)
- `storage.missing_game_state` - Count of missing game state reads

**Seat Management:**
- `seat.reclaim.success_rate` - % successful reclamations
- `seat.reclaim.failure_reasons` - Distribution of failure reasons
- `seat.reservation.duration` - Average reservation duration
- `seat.expiration.count` - Count of expired seats

**Game State:**
- `game.state_transitions` - Count of state transitions
- `game.transition.rejections` - Count of rejected transitions
- `game.turn.avg_duration` - Average turn duration
- `game.completion_rate` - % games that complete

**Error Rates:**
- `error.rate` - Errors per minute
- `error.by_type` - Error distribution by type
- `error.by_component` - Error distribution by component

---

## 7. Monitoring & Alerting

### 7.1 Alert Conditions

**Critical Alerts (Page Immediately):**
- `error.rate > 10/min` - High error rate
- `storage.write.success_rate < 95%` - Storage failures
- `connection.success_rate < 90%` - Connection issues
- `error.state.corruption` - State corruption detected

**Warning Alerts (Notify, Investigate):**
- `seat.reclaim.success_rate < 80%` - Seat issues
- `storage.avg_write_latency > 1000ms` - Slow storage
- `connection.reconnect_rate > 50%` - High reconnection rate
- `game.completion_rate < 70%` - Games not completing

**Info Alerts (Log, Monitor):**
- `game.state_transitions` spike - Unusual activity
- `connection.close_code_distribution` change - Pattern shift
- `storage.missing_game_state > 0` - Missing state (investigate)

### 7.2 Alerting Implementation

**Option 1: Cloudflare Workers (Recommended)**
```typescript
// Create: packages/cloudflare-do/src/alerts.ts
// Scheduled worker that queries logs and sends alerts

export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // Query logs via Cloudflare API
    const logs = await queryLogs({
      worker: 'dicee',
      filter: { level: 'error' },
      timeRange: '1h',
    });
    
    if (logs.length > 100) {
      await sendAlert({
        severity: 'critical',
        message: `High error rate: ${logs.length} errors in last hour`,
        logs: logs.slice(0, 10), // Sample
      });
    }
  },
};
```

**Option 2: External Monitoring (Grafana + Prometheus)**
- Export metrics to Prometheus
- Create Grafana dashboards
- Set up alerting rules

**Option 3: Cloudflare Analytics (Native)**
- Use Cloudflare Analytics custom events
- Set up alerting in Cloudflare Dashboard
- Configure webhooks for notifications

### 7.3 Notification Channels

**Slack Integration:**
```typescript
async function sendSlackAlert(alert: Alert) {
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    body: JSON.stringify({
      text: `🚨 ${alert.severity.toUpperCase()}: ${alert.message}`,
      attachments: [{
        color: alert.severity === 'critical' ? 'danger' : 'warning',
        fields: alert.context,
      }],
    }),
  });
}
```

**Email Integration:**
- Use Cloudflare Workers Email API
- Or external service (SendGrid, etc.)

**PagerDuty Integration:**
- For critical alerts
- Escalation policies

---

## 8. Debugging Workflows

### 8.1 Scenario: Game Resets on Refresh

**Symptoms:**
- Player refreshes page
- Game state is lost
- Player becomes spectator

**Debugging Steps:**

1. **Query Recent Disconnects:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "lifecycle.disconnect"
  - userId equals "{userId}"
  - time range: last 5 minutes
Show me:
  - closeCode
  - wasPlayer
  - timestamp
```

2. **Check Seat Reservation:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event contains "seat.reserve"
  - userId equals "{userId}"
  - time range: last 5 minutes
Show me:
  - deadlineMs
  - reservationWindowSec
```

3. **Check Reconnection:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event contains "seat.reclaim"
  - userId equals "{userId}"
  - time range: last 5 minutes
Show me:
  - hasSeat
  - withinDeadline
  - result
  - reason
```

4. **Check Storage State:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "lifecycle.wake"
  - roomCode equals "{roomCode}"
  - time range: last 5 minutes
Show me:
  - hasGameState
  - hasSeats
  - storageKeys
```

5. **Correlate Full Flow:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - correlationId equals "{correlationId}"
  - OR userId equals "{userId}" AND roomCode equals "{roomCode}"
  - time range: last 10 minutes
Show me all events in chronological order
```

### 8.2 Scenario: Constant Reconnecting

**Symptoms:**
- WebSocket closes frequently
- Client keeps reconnecting
- Poor user experience

**Debugging Steps:**

1. **Analyze Close Codes:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "lifecycle.disconnect"
  - time range: last hour
Group by closeCode and show count
Order by count descending
```

2. **Check Token Expiration:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "connection.token.expired"
  - time range: last hour
Show me:
  - userId
  - expiresAt
  - timestamp
```

3. **Check Rate Limiting:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "connection.rate_limit"
  - time range: last hour
Show me:
  - userId
  - limit
  - window
```

4. **Check DO Hibernation:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "lifecycle.wake"
  - time range: last hour
Count occurrences per roomCode
Show rooms with > 10 wakes
```

### 8.3 Scenario: State Desynchronization

**Symptoms:**
- Client shows different state than server
- Game actions fail
- Players see inconsistent state

**Debugging Steps:**

1. **Check State Transitions:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event contains "state.transition"
  - roomCode equals "{roomCode}"
  - time range: last 10 minutes
Show me:
  - from
  - to
  - trigger
  - timestamp
```

2. **Check Rejected Transitions:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "state.transition.rejected"
  - roomCode equals "{roomCode}"
  - time range: last 10 minutes
Show me:
  - currentState
  - attemptedState
  - trigger
  - reason
```

3. **Get State Snapshot:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "diagnostic.snapshot"
  - roomCode equals "{roomCode}"
  - time range: last 10 minutes
Show me the latest snapshot
```

4. **Check Broadcast Failures:**
```
Using cloudflare-observability MCP server, query dicee worker logs
where:
  - event is "broadcast.sent"
  - failureCount > 0
  - roomCode equals "{roomCode}"
  - time range: last 10 minutes
Show me:
  - eventType
  - recipientCount
  - successCount
  - failureCount
```

### 8.4 Debugging Tools

**Create:** `scripts/observability/debug-room.sh`
```bash
#!/bin/bash
# Debug a specific room

ROOM_CODE=$1
if [ -z "$ROOM_CODE" ]; then
  echo "Usage: $0 <room-code>"
  exit 1
fi

echo "=== Room Debug: $ROOM_CODE ==="
echo ""

echo "1. Recent Events:"
wrangler tail dicee --format json | \
  jq -r --arg code "$ROOM_CODE" '
    select(.logs[].message[] | 
      select(type == "string") | 
      fromjson? | 
      select(.roomCode == $code)
    ) | .logs[].message[] | 
    select(type == "string") | 
    fromjson? | 
    select(.roomCode == $code) |
    "\(._ts) [\(._level)] \(._event) - \(.userId // "system")"
  ' | tail -20

echo ""
echo "2. Storage Operations:"
wrangler tail dicee --format json | \
  jq -r --arg code "$ROOM_CODE" '
    select(.logs[].message[] | 
      select(type == "string") | 
      fromjson? | 
      select(.roomCode == $code and (.event | startswith("storage.")))
    ) | .logs[].message[] | 
    select(type == "string") | 
    fromjson? | 
    select(.roomCode == $code and (.event | startswith("storage."))) |
    "\(._ts) \(._event) key=\(.key) found=\(.found // .success)"
  ' | tail -20

echo ""
echo "3. Errors:"
wrangler tail dicee --format json | \
  jq -r --arg code "$ROOM_CODE" '
    select(.logs[].message[] | 
      select(type == "string") | 
      fromjson? | 
      select(.roomCode == $code and ._level == "error")
    ) | .logs[].message[] | 
    select(type == "string") | 
    fromjson? | 
    select(.roomCode == $code and ._level == "error") |
    "\(._ts) ERROR: \(._event) - \(.errorMessage // "unknown")"
  ' | tail -10
```

**Create:** `scripts/observability/correlate-events.sh`
```bash
#!/bin/bash
# Correlate events by correlationId or userId

CORRELATION_ID=$1
USER_ID=$2
ROOM_CODE=$3

if [ -z "$CORRELATION_ID" ] && [ -z "$USER_ID" ]; then
  echo "Usage: $0 <correlation-id> [user-id] [room-code]"
  exit 1
fi

FILTER=""
if [ -n "$CORRELATION_ID" ]; then
  FILTER="select(.correlationId == \"$CORRELATION_ID\")"
elif [ -n "$USER_ID" ]; then
  FILTER="select(.userId == \"$USER_ID\")"
  if [ -n "$ROOM_CODE" ]; then
    FILTER="$FILTER | select(.roomCode == \"$ROOM_CODE\")"
  fi
fi

wrangler tail dicee --format json | \
  jq -r "
    .logs[].message[] | 
    select(type == \"string\") | 
    fromjson? | 
    $FILTER |
    \"\(._ts) [\(._level)] \(._event) - reqId=\(._reqId // \"-\") userId=\(.userId // \"-\") roomCode=\(.roomCode // \"-\")\"
  " | sort -n
```

---

## 9. Success Metrics

### 9.1 Observability Coverage

| Metric | Target | Measurement |
|--------|--------|-------------|
| Event Coverage | 100% of critical paths | Code review + tests |
| Correlation ID Usage | 100% of client messages | Log analysis |
| Storage Operation Tracking | 100% of reads/writes | Log analysis |
| State Transition Tracking | 100% of transitions | Log analysis |

### 9.2 Debugging Efficiency

| Metric | Target | Measurement |
|--------|--------|-------------|
| Mean Time to Identify Root Cause | < 5 minutes | Incident logs |
| Query Response Time (MCP) | < 5 seconds | Performance testing |
| False Positive Alert Rate | < 5% | Alert logs |
| Debug Tool Usage | > 80% of incidents | Usage analytics |

### 9.3 System Health

| Metric | Target | Measurement |
|--------|--------|-------------|
| Connection Success Rate | > 95% | Metrics dashboard |
| Storage Write Success Rate | > 99% | Metrics dashboard |
| Seat Reclaim Success Rate | > 90% | Metrics dashboard |
| Game Completion Rate | > 80% | Metrics dashboard |
| Error Rate | < 1/min | Metrics dashboard |

### 9.4 User Experience

| Metric | Target | Measurement |
|--------|--------|-------------|
| Reconnection Success Rate | > 90% | Client telemetry |
| State Loss Incidents | < 1% of games | Incident reports |
| Average Reconnection Time | < 2 seconds | Client telemetry |

---

## 10. Implementation Checklist

### Phase 1: Core Instrumentation
- [ ] Create `Instrumentation` class
- [ ] Integrate into `GameRoom`
- [ ] Integrate into `GlobalLobby`
- [ ] Add storage wrappers
- [ ] Add state transition tracking
- [ ] Write unit tests
- [ ] Deploy to staging
- [ ] Verify logs in Cloudflare Dashboard

### Phase 2: MCP Integration
- [ ] Configure `cloudflare-observability` MCP
- [ ] Create query templates
- [ ] Build helper scripts
- [ ] Document MCP patterns
- [ ] Test MCP queries
- [ ] Create debugging workflows

### Phase 3: Metrics & Aggregation
- [ ] Define key metrics
- [ ] Implement metric collection
- [ ] Create Cloudflare Analytics events
- [ ] Build aggregation queries
- [ ] Create dashboards
- [ ] Set up metric exports

### Phase 4: Alerting
- [ ] Define alert conditions
- [ ] Implement anomaly detection
- [ ] Create alerting worker
- [ ] Set up notifications
- [ ] Create runbooks
- [ ] Test alerting

### Phase 5: Client Correlation
- [ ] Add correlation IDs to client
- [ ] Create client event logger
- [ ] Build correlation tool
- [ ] Enhance debug panel
- [ ] Create correlation dashboard

### Phase 6: Storage Visibility
- [ ] Create storage inspection API
- [ ] Build storage diff tool
- [ ] Add health checks
- [ ] Create visualization
- [ ] Document debugging workflow

---

## 11. Documentation Lookup Workflow

### 11.1 When to Use Which MCP Server

| Question Type | MCP Server | Tool | Example Query |
|--------------|------------|------|---------------|
| Cloudflare platform features | `cloudflare-docs` | `search_cloudflare_documentation` | "Workers observability configuration" |
| Cloudflare API signatures | `context7` | `get-library-docs` | Library: `/websites/developers_cloudflare_workers`, Topic: "durable objects websocket" |
| Library best practices | `context7` | `get-library-docs` | Library: `/websites/developers_cloudflare_workers`, Topic: "structured logging" |
| Current code examples | `context7` | `get-library-docs` | Library: `/websites/developers_cloudflare_workers`, Mode: `code` |
| Log queries | `cloudflare-observability` | `query_worker_observability` | Filter by event, time range, worker name |
| Build status | `cloudflare-builds` | `workers_builds_list_builds` | List recent deployments |
| Storage resources | `cloudflare-bindings` | `kv_namespaces_list` | List KV/R2/D1 resources |

### 11.2 Implementation Workflow

**Before Writing Code:**
1. Query `context7` or `cloudflare-docs` for current API documentation
2. Verify API signatures match your implementation
3. Check for breaking changes or new best practices
4. Reference MCP-provided examples in code comments

**Example:**
```
Before implementing WebSocket handlers, query:
- context7: "Cloudflare Durable Objects WebSocket hibernation API"
- cloudflare-docs: "Durable Objects WebSocket lifecycle"

Then use the exact API signatures from MCP responses.
```

**During Debugging:**
1. Use `cloudflare-observability` to query logs
2. Use `cloudflare-docs` to verify API usage
3. Use `context7` for troubleshooting library-specific issues

### 11.3 MCP Query Examples

**Getting Current Documentation:**
```
Using context7 MCP server, get documentation for Cloudflare Workers
with library ID /websites/developers_cloudflare_workers
on topic "observability logging configuration"
in code mode
```

**Searching Cloudflare Docs:**
```
Using cloudflare-docs MCP server, search for
"Workers Logs structured logging JSON format"
```

**Querying Logs:**
```
Using cloudflare-observability MCP server, query logs from
worker "dicee" where event contains "seat.reclaim"
in the last hour
```

---

## 12. Next Steps

1. **Review & Approve Plan** - Get stakeholder sign-off
2. **Verify MCP Servers** - Test all MCP connections
3. **Query Current APIs** - Use MCP to verify current Cloudflare Workers APIs
4. **Start Phase 1** - Begin instrumentation implementation with MCP-verified APIs
5. **Create Tracking Issue** - GitHub issue for implementation
6. **Schedule Reviews** - Weekly check-ins during implementation

---

## 13. References

### Observability Documentation (Read in Order)
1. **[Observability Project Review](observability-project-review.md)** - Project-wide strategy, technical debt, migration path
2. **[Observability Architectural Patterns](observability-architectural-patterns.md)** - Type-safe patterns, AKG integration
3. **[Observability Plan](observability-plan.md)** - This document (high-level plan)
4. **[Existing Instrumentation](instrumentation.md)** - Original debugging strategy

### MCP Server Documentation
- Context7: `docs/references/context7-readme.md`
- Cloudflare MCP: `docs/MCP-SETUP.md`
- MCP Configuration: `.mcp.json`, `.cursor/mcp.json`

### Cloudflare Documentation (via MCP)
- Workers Observability: Query `cloudflare-docs` for "Workers observability"
- Workers Logs: Query `cloudflare-docs` for "Workers Logs"
- Durable Objects: Query `context7` for `/websites/developers_cloudflare_workers` with topic "durable objects"

### Project Documentation
- Architecture: `docs/architecture/MULTIPLAYER_PERSISTENCE_ARCHITECTURE.md`
- Game Room: `docs/architecture/GAME_ROOM_TECHNICAL_REPORT.md`
- Testing: `docs/testing/durable-objects-testing.md`
- Conventions: `.claude/CONVENTIONS.md`

---

**Document Status**: Planning  
**Last Updated**: 2025-01-XX  
**Owner**: Development Team  
**Reviewers**: TBD

**Note**: This plan emphasizes using MCP servers for up-to-date documentation. All API references should be verified via MCP before implementation.

