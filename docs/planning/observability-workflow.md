# Comprehensive Observability Implementation Workflow

> **Historical MCP note (2026-09-12):** the narrow `cloudflare-observability`, `cloudflare-builds`, `cloudflare-bindings`, `cloudflare-logpush`, and `cloudflare-graphql` MCP servers named in this document were retired. Use the opt-in `cloudflare-api` server (per-client OAuth) or `cloudflare-docs`; see [`docs/MCP-SETUP.md`](../MCP-SETUP.md).

> **Version**: 1.0.0  
> **Created**: 2025-01-XX  
> **Status**: Ready for Implementation  
> **Purpose**: Complete step-by-step workflow for implementing type-safe, test-first observability

---

## Executive Summary

This document provides a **complete, actionable workflow** for implementing observability across the Dicee project. It consolidates all planning documents into a single, step-by-step guide that:

- ✅ Follows established patterns (type-safe, test-first, unified structure)
- ✅ Integrates MCP tools at every step
- ✅ Eliminates technical debt (29 console.logs)
- ✅ Ensures 100% test coverage
- ✅ Maintains architectural compliance (AKG-validated)

**This is your master workflow document. Follow it step-by-step.**

---

## Table of Contents

1. [Prerequisites & Setup](#1-prerequisites--setup)
2. [Workflow Overview](#2-workflow-overview)
3. [Phase 1: Foundation (Week 1)](#3-phase-1-foundation-week-1)
4. [Phase 2: Migration (Week 2)](#4-phase-2-migration-week-2)
5. [Phase 3: Enhancement (Week 3)](#5-phase-3-enhancement-week-3)
6. [Phase 4: Cleanup (Week 4)](#6-phase-4-cleanup-week-4)
7. [MCP Tool Integration](#7-mcp-tool-integration)
8. [Quality Gates](#8-quality-gates)
9. [Troubleshooting](#9-troubleshooting)
10. [References](#10-references)

---

## 1. Prerequisites & Setup

### 1.1 Read Planning Documents (In Order)

**Before starting, read these documents in order:**

1. ✅ **[Observability Project Review](observability-project-review.md)**
   - Project-wide strategy
   - Technical debt inventory (29 console.logs)
   - Type-safe architecture
   - Test-first approach
   - Migration path

2. ✅ **[Observability Architectural Patterns](observability-architectural-patterns.md)**
   - Zod 4 schema patterns
   - Const array → type inference pattern
   - AKG layer integration
   - Test fixtures pattern

3. ✅ **[MCP Orchestration Review](mcp-orchestration-review.md)**
   - Memory entity schemas
   - AKG validation workflow
   - MCP tool integration patterns

4. ✅ **[Observability Plan](observability-plan.md)**
   - High-level architecture
   - Event taxonomy
   - Cloudflare MCP integration

### 1.2 Verify MCP Servers

**Check all MCP servers are configured and working:**

```bash
# Verify Memory MCP
# (Should return entities from knowledge graph)
# Use: mcp_memory_read_graph()

# Verify AKG MCP
pnpm akg:test
# Use: mcp_akg_akg_cache_status()

# Verify Context7 MCP
# Use: mcp_Context7_resolve-library-id({ libraryName: "cloudflare workers" })

# Verify Cloudflare MCP servers
# Use: mcp_cloudflare-observability_observability_keys()
```

### 1.3 Setup Memory Entities

**Create initial Memory entities for observability work:**

```typescript
// Store in Memory: Observability implementation started
mcp_memory_create_entities({
  entities: [{
    name: 'observability:implementation-start',
    entityType: 'ObservabilityImplementation',
    observations: [
      'Status: Starting observability implementation',
      'Date: [CURRENT_DATE]',
      'Phase: Foundation (Week 1)',
      'Approach: Test-first, type-safe, unified structure'
    ]
  }]
});
```

### 1.4 Verify Project State

**Check current state before starting:**

```bash
# Count console.log statements (should be 29)
grep -r "console\.log\|console\.error\|console\.warn" packages/cloudflare-do/src --exclude-dir=__tests__ | wc -l

# Check test coverage (baseline)
pnpm --filter @dicee/cloudflare-do test --coverage

# Check AKG status
pnpm akg:check

# Verify no existing observability code
ls packages/cloudflare-do/src/lib/observability/ 2>/dev/null || echo "No observability code yet"
```

---

## 2. Workflow Overview

### 2.1 Four-Phase Approach

```
Week 1: Foundation (Test-First)
├── Day 1-2: Schema Foundation (Zod schemas, test-first)
├── Day 3: Test Fixtures
└── Day 4-5: Instrumentation Class (test-first)

Week 2: Migration (Replace Technical Debt)
├── Day 1: Lifecycle Events (replace console.logs)
├── Day 2: Storage Events (wrap storage operations)
├── Day 3: Seat Management Events
├── Day 4: Game Events
└── Day 5: Error Events

Week 3: Enhancement
├── Day 1-2: Correlation IDs
├── Day 3-4: Performance Metrics
└── Day 5: MCP Query Helpers

Week 4: Cleanup
├── Day 1-2: Remove Technical Debt
├── Day 3: Documentation
└── Day 4-5: Final Verification
```

### 2.2 Core Principles

**Every step follows these principles:**

1. **Test-First**: Write tests before implementation
2. **Type-Safe**: Use Zod validation for all events
3. **AKG-Validated**: Check layer rules before creating files
4. **Memory-Tracked**: Store decisions and progress in Memory
5. **MCP-Integrated**: Use MCP tools for all queries and validation

---

## 3. Phase 1: Foundation (Week 1)

### 3.1 Day 1-2: Schema Foundation

**Goal**: Create type-safe event schemas with 100% test coverage

#### Step 1: Query MCP Tools for Patterns

```typescript
// 1. Get Cloudflare Workers logging patterns
mcp_Context7_get-library-docs({
  context7CompatibleLibraryID: '/websites/developers_cloudflare_workers',
  topic: 'durable objects logging structured logging',
  mode: 'code'
});

// 2. Check existing Zod patterns in codebase
// Review: packages/shared/src/validation/schemas.ts

// 3. Query Memory for any existing observability decisions
mcp_memory_search_nodes({ query: 'observability schema pattern' });
```

#### Step 2: Validate Layer Placement

```typescript
// Check where to place observability schemas
mcp_akg_akg_layer_rules({ layer: 'services' }); // For reference

// Validate: cloudflare-do can import from lib/
mcp_akg_akg_check_import({
  fromPath: 'packages/cloudflare-do/src/GameRoom.ts',
  toPath: 'packages/cloudflare-do/src/lib/observability/events.schema.ts'
});
// Expected: allowed
```

#### Step 3: Create Schema File Structure

```bash
# Create directory structure
mkdir -p packages/cloudflare-do/src/lib/observability/__tests__
touch packages/cloudflare-do/src/lib/observability/events.schema.ts
touch packages/cloudflare-do/src/lib/observability/__tests__/events.schema.test.ts
```

#### Step 4: Write Tests FIRST (TDD)

**File**: `packages/cloudflare-do/src/lib/observability/__tests__/events.schema.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { LIFECYCLE_EVENTS, LifecycleEvent, LifecycleWakeEventSchema } from '../events.schema.js';

describe('Event Schema Foundation', () => {
  describe('LIFECYCLE_EVENTS const array', () => {
    it('should exist and be a const array', () => {
      expect(LIFECYCLE_EVENTS).toBeDefined();
      expect(Array.isArray(LIFECYCLE_EVENTS)).toBe(true);
    });

    it('should contain expected lifecycle events', () => {
      expect(LIFECYCLE_EVENTS).toContain('lifecycle.wake');
      expect(LIFECYCLE_EVENTS).toContain('lifecycle.connect');
      expect(LIFECYCLE_EVENTS).toContain('lifecycle.disconnect');
      expect(LIFECYCLE_EVENTS).toContain('lifecycle.reconnect');
    });
  });

  describe('LifecycleEvent type inference', () => {
    it('should infer correct type from const array', () => {
      const event: LifecycleEvent = 'lifecycle.wake';
      expect(event).toBe('lifecycle.wake');
    });
  });

  describe('LifecycleWakeEventSchema validation', () => {
    it('should validate correct data', () => {
      const valid = {
        _ts: Date.now(),
        _level: 'info',
        _component: 'GameRoom',
        _event: 'lifecycle.wake',
        _reqId: 1,
        roomCode: 'TEST-ROOM',
        storageKeys: ['game', 'seats'],
        connectedClients: 2,
      };
      const result = LifecycleWakeEventSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it('should reject invalid data', () => {
      const invalid = {
        _ts: 'not-a-number',
        _level: 'invalid',
        // ... missing required fields
      };
      const result = LifecycleWakeEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });
});
```

#### Step 5: Implement Schemas to Pass Tests

**File**: `packages/cloudflare-do/src/lib/observability/events.schema.ts`

```typescript
import { z } from 'zod';

// =============================================================================
// Event Categories (Const Arrays → Inferred Types)
// =============================================================================

export const LIFECYCLE_EVENTS = [
  'lifecycle.wake',
  'lifecycle.connect',
  'lifecycle.disconnect',
  'lifecycle.reconnect',
] as const;

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

// =============================================================================
// Base Schema
// =============================================================================

export const BaseLogEntrySchema = z.object({
  _ts: z.number().int().nonnegative(),
  _level: z.enum(['debug', 'info', 'warn', 'error']),
  _component: z.enum(['GameRoom', 'GlobalLobby']),
  _event: z.string(),
  _reqId: z.number().int().positive(),
  roomCode: z.string().optional(),
  userId: z.string().optional(),
});

// =============================================================================
// Event-Specific Schemas
// =============================================================================

export const LifecycleWakeEventSchema = BaseLogEntrySchema.extend({
  _event: z.literal('lifecycle.wake'),
  storageKeys: z.array(z.string()),
  connectedClients: z.number().int().nonnegative(),
});

export type LifecycleWakeEvent = z.infer<typeof LifecycleWakeEventSchema>;

// ... repeat for all event types
```

#### Step 6: Run Tests and Verify

```bash
# Run tests
pnpm --filter @dicee/cloudflare-do test events.schema.test.ts

# Verify coverage
pnpm --filter @dicee/cloudflare-do test --coverage

# Check TypeScript
pnpm --filter @dicee/cloudflare-do check

# Verify AKG compliance
pnpm akg:check
```

#### Step 7: Store Progress in Memory

```typescript
mcp_memory_add_observations({
  observations: [{
    entityName: 'observability:implementation-start',
    contents: [
      'Day 1-2 Complete: Schema foundation',
      'Test Coverage: 100% for schemas',
      'All tests passing',
      'AKG checks passing'
    ]
  }]
});
```

**Repeat for all event categories**: STORAGE, STATE, SEAT, GAME, CONNECTION, ERROR, DIAGNOSTIC

### 3.2 Day 3: Test Fixtures

**Goal**: Create type-safe fixtures for all event types

#### Step 1: Create Fixtures File

```bash
touch packages/cloudflare-do/src/lib/observability/__tests__/events.fixtures.ts
```

#### Step 2: Write Fixture Functions

**File**: `packages/cloudflare-do/src/lib/observability/__tests__/events.fixtures.ts`

```typescript
import type { LifecycleWakeEvent } from '../events.schema.js';

export function createLifecycleWakeFixture(
  overrides?: Partial<LifecycleWakeEvent>
): LifecycleWakeEvent {
  return {
    _ts: Date.now(),
    _level: 'info',
    _component: 'GameRoom',
    _event: 'lifecycle.wake',
    _reqId: 1,
    roomCode: 'TEST-ROOM',
    storageKeys: ['game', 'seats'],
    connectedClients: 2,
    ...overrides,
  };
}

// ... create fixtures for all event types
```

#### Step 3: Test Fixtures

```typescript
describe('Event Fixtures', () => {
  it('should create valid lifecycle.wake event', () => {
    const fixture = createLifecycleWakeFixture();
    const result = LifecycleWakeEventSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('should allow overrides', () => {
    const fixture = createLifecycleWakeFixture({ roomCode: 'CUSTOM' });
    expect(fixture.roomCode).toBe('CUSTOM');
  });
});
```

### 3.3 Day 4-5: Instrumentation Class

**Goal**: Create type-safe instrumentation class with 100% test coverage

#### Step 1: Validate Layer Placement

```typescript
mcp_akg_akg_check_import({
  fromPath: 'packages/cloudflare-do/src/GameRoom.ts',
  toPath: 'packages/cloudflare-do/src/lib/instrumentation.ts'
});
```

#### Step 2: Write Tests FIRST

**File**: `packages/cloudflare-do/src/lib/__tests__/instrumentation.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { createInstrumentation } from '../instrumentation.js';
import { LifecycleWakeEventSchema } from '../observability/events.schema.js';

describe('Instrumentation', () => {
  describe('createInstrumentation', () => {
    it('should create instrumentation instance', () => {
      const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
      expect(instr).toBeDefined();
    });
  });

  describe('hibernationWake', () => {
    it('should emit valid lifecycle.wake event', () => {
      const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
      const event = instr.hibernationWake(['game', 'seats'], 2);
      
      const result = LifecycleWakeEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });
});
```

#### Step 3: Implement Instrumentation

**File**: `packages/cloudflare-do/src/lib/instrumentation.ts`

```typescript
import { validateLogEntry, type LogEvent } from './observability/events.schema.js';

export function createInstrumentation(
  component: 'GameRoom' | 'GlobalLobby',
  roomCode?: string
): Instrumentation {
  let requestId = 0;

  return {
    hibernationWake(storageKeys: string[], connectedClients: number): LifecycleWakeEvent {
      const event = {
        _ts: Date.now(),
        _level: 'info',
        _component: component,
        _event: 'lifecycle.wake',
        _reqId: ++requestId,
        roomCode,
        storageKeys,
        connectedClients,
      };

      const validated = validateLogEntry(event);
      console.info(JSON.stringify(validated));
      return validated as LifecycleWakeEvent;
    },
    // ... implement all methods
  };
}
```

#### Step 4: Verify Tests and Coverage

```bash
pnpm --filter @dicee/cloudflare-do test instrumentation.test.ts --coverage
# Verify 100% coverage
```

---

## 4. Phase 2: Migration (Week 2)

### 4.1 Day 1: Lifecycle Events

**Goal**: Replace all lifecycle-related console.logs

#### Step 1: Identify Console.logs

```bash
# Find lifecycle-related console.logs
grep -n "console\.log\|console\.error" packages/cloudflare-do/src/GameRoom.ts | grep -i "lifecycle\|wake\|connect\|disconnect"
```

#### Step 2: Query Memory for Context

```typescript
mcp_memory_search_nodes({ query: 'lifecycle event migration' });
```

#### Step 3: Write Tests FIRST

```typescript
describe('GameRoom Lifecycle Events', () => {
  it('should emit lifecycle.wake on initialization', async () => {
    // Test implementation
  });

  it('should emit lifecycle.connect on WebSocket open', async () => {
    // Test implementation
  });
});
```

#### Step 4: Replace Console.logs

**Before**:
```typescript
console.log('[GameRoom] Player reconnected');
```

**After**:
```typescript
this.instr?.clientConnect(userId, 'player', connectionId);
```

#### Step 5: Verify Logs in Cloudflare

```typescript
// Query via MCP
mcp_cloudflare-observability_query_worker_observability({
  query: {
    queryId: 'lifecycle-events',
    view: 'events',
    parameters: {
      filters: [{
        key: '$metadata.message',
        operation: 'includes',
        type: 'string',
        value: 'lifecycle.wake'
      }]
    },
    timeframe: {
      reference: new Date().toISOString(),
      offset: '-1h'
    },
    limit: 10
  }
});
```

**Repeat for each lifecycle event category**

### 4.2 Day 2-5: Storage, Seat, Game, Error Events

**Follow same pattern as Day 1 for each category**

---

## 5. Phase 3: Enhancement (Week 3)

### 5.1 Day 1-2: Correlation IDs

**Goal**: Add correlation ID support end-to-end

#### Step 1: Query Context7 for Patterns

```typescript
mcp_Context7_get-library-docs({
  context7CompatibleLibraryID: '/websites/developers_cloudflare_workers',
  topic: 'correlation id request tracing',
  mode: 'code'
});
```

#### Step 2: Implement Correlation ID Support

- Add correlationId to client messages
- Propagate through instrumentation
- Store in Memory for tracking

### 5.2 Day 3-4: Performance Metrics

**Goal**: Add duration tracking for operations

### 5.3 Day 5: MCP Query Helpers

**Goal**: Create reusable query patterns

---

## 6. Phase 4: Cleanup (Week 4)

### 6.1 Day 1-2: Remove Technical Debt

```bash
# Remove old logger.ts
rm packages/cloudflare-do/src/lib/logger.ts

# Verify no console.logs remain
grep -r "console\.log\|console\.error\|console\.warn" packages/cloudflare-do/src --exclude-dir=__tests__
# Should return 0 results
```

### 6.2 Day 3: Documentation

- Update all planning documents
- Document query patterns
- Update Memory with completion status

### 6.3 Day 4-5: Final Verification

**Run complete quality gate** (see Section 8)

---

## 7. MCP Tool Integration

### 7.1 MCP Tool Usage Matrix

| Phase | MCP Tool | Purpose | When to Use |
|-------|----------|---------|-------------|
| **All Phases** | Context7 | Get library docs | Before implementing any feature |
| **All Phases** | AKG | Validate architecture | Before creating files, after changes |
| **All Phases** | Memory | Store decisions | After each milestone |
| **Foundation** | Context7 | Cloudflare logging patterns | Day 1-2 |
| **Foundation** | AKG | Layer validation | Day 1-2, 4-5 |
| **Migration** | cloudflare-observability | Verify logs | After each migration day |
| **Enhancement** | cloudflare-observability | Query patterns | Day 5 |
| **Cleanup** | All | Final verification | Day 4-5 |

### 7.2 MCP Workflow Pattern

**For Every Feature**:

```
1. Context7 → Get current patterns
2. AKG → Validate layer placement
3. Memory → Check existing decisions
4. Implement (test-first)
5. Memory → Store progress
6. AKG → Verify no violations
7. cloudflare-observability → Verify in production (if applicable)
```

---

## 8. Quality Gates

### 8.1 Pre-Implementation Gate

**Before starting any work:**

- [ ] All planning documents read
- [ ] MCP servers verified
- [ ] Memory entities created
- [ ] Project state baseline recorded

### 8.2 Per-Feature Gate

**After each feature:**

```bash
# Run tests
pnpm --filter @dicee/cloudflare-do test

# Check coverage
pnpm --filter @dicee/cloudflare-do test --coverage

# TypeScript
pnpm --filter @dicee/cloudflare-do check

# Biome
pnpm --filter @dicee/cloudflare-do biome:check

# AKG
pnpm akg:check
```

### 8.3 Per-Day Gate

**At end of each day:**

- [ ] All tests passing
- [ ] 100% coverage for new code
- [ ] AKG checks passing
- [ ] Memory updated with progress
- [ ] No console.log statements added

### 8.4 Per-Phase Gate

**At end of each phase:**

```bash
# Run full quality gate
./scripts/quality-gate.sh

# Verify no console.logs
grep -r "console\.log\|console\.error\|console\.warn" packages/cloudflare-do/src --exclude-dir=__tests__

# Verify coverage
pnpm --filter @dicee/cloudflare-do test --coverage

# Update Memory
mcp_memory_add_observations({
  observations: [{
    entityName: 'observability:implementation-start',
    contents: ['Phase [N] Complete: [Description]']
  }]
});
```

### 8.5 Final Quality Gate

**Before marking complete:**

```bash
# Full quality gate
./scripts/quality-gate.sh

# Zero console.logs
grep -r "console\.log\|console\.error\|console\.warn" packages/cloudflare-do/src --exclude-dir=__tests__
# Expected: 0 results

# 100% test coverage
pnpm --filter @dicee/cloudflare-do test --coverage
# Expected: 100% for observability code

# All AKG checks
pnpm akg:check
# Expected: All passing

# Verify logs queryable
mcp_cloudflare-observability_query_worker_observability({
  query: {
    queryId: 'verify-observability',
    view: 'events',
    parameters: {
      filters: [{
        key: '$metadata.component',
        operation: 'eq',
        type: 'string',
        value: 'GameRoom'
      }]
    },
    timeframe: {
      reference: new Date().toISOString(),
      offset: '-1h'
    },
    limit: 5
  }
});
```

---

## 9. Troubleshooting

### 9.1 Common Issues

**Issue**: Tests failing after schema changes
- **Solution**: Update fixtures to match new schema

**Issue**: AKG check failing
- **Solution**: Run `pnpm akg:discover` to update graph

**Issue**: Memory queries returning no results
- **Solution**: Verify Memory MCP is connected, check `.claude/state/memory.jsonl`

**Issue**: Cloudflare observability queries failing
- **Solution**: Verify OAuth authentication, check account access

### 9.2 Getting Help

1. Check planning documents for patterns
2. Query Memory for similar decisions
3. Query Context7 for library-specific help
4. Check AKG for architectural guidance
5. Review workflow-orchestration.md for general patterns

---

## 10. References

### Planning Documents (Read First)
1. **[Observability Project Review](observability-project-review.md)** - Strategy & technical debt
2. **[Observability Architectural Patterns](observability-architectural-patterns.md)** - Implementation patterns
3. **[MCP Orchestration Review](mcp-orchestration-review.md)** - MCP integration
4. **[Observability Plan](observability-plan.md)** - High-level architecture

### Project Documentation
- **Workflow Orchestration**: `.claude/workflow-orchestration.md`
- **Conventions**: `.claude/CONVENTIONS.md`
- **Testing Guide**: `docs/testing/durable-objects-testing.md`

### MCP Documentation
- **MCP Setup**: `docs/MCP-SETUP.md`
- **Context7**: `docs/references/context7-readme.md`
- **AKG**: `docs/architecture/akg/`

---

**Document Status**: Ready for Implementation  
**Last Updated**: 2025-01-XX  
**Owner**: Development Team

**Next Steps**:
1. Review this workflow document
2. Complete Prerequisites & Setup (Section 1)
3. Begin Phase 1: Foundation (Section 3)
4. Follow workflow step-by-step
5. Update Memory with progress at each milestone

