# MCP Orchestration Review: Memory & AKG Integration

> **Historical MCP note (2026-09-12):** the narrow `cloudflare-observability`, `cloudflare-builds`, `cloudflare-bindings`, `cloudflare-logpush`, and `cloudflare-graphql` MCP servers named in this document were retired. Use the opt-in `cloudflare-api` server (per-client OAuth) or `cloudflare-docs`; see [`docs/MCP-SETUP.md`](../MCP-SETUP.md).

> **Version**: 1.0.0  
> **Created**: 2025-01-XX  
> **Status**: Review & Enhancement  
> **Purpose**: Ensure Memory and AKG MCP servers work in concert with observability patterns and agentic orchestration

---

## Executive Summary

This document reviews the **Memory** and **AKG** MCP servers in the context of:
- All configured MCP tools (Context7, Cloudflare suite)
- Agentic orchestration patterns
- Observability implementation (type-safe, test-first)
- Project-wide development workflow

**Key Findings**:
- ✅ Memory and AKG are well-configured and documented
- ⚠️ Memory usage patterns need alignment with observability patterns
- ⚠️ AKG integration missing from observability implementation workflow
- ⚠️ No structured guidance for Memory entities in observability context
- ✅ AKG tools align with architectural validation needs

**Recommendations**:
1. Define Memory entity schema for observability decisions
2. Integrate AKG checks into observability implementation workflow
3. Create Memory patterns for storing architectural decisions
4. Enhance orchestration docs with Memory/AKG observability integration

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [MCP Server Inventory](#2-mcp-server-inventory)
3. [Memory MCP Integration](#3-memory-mcp-integration)
4. [AKG MCP Integration](#4-akg-mcp-integration)
5. [Observability Pattern Alignment](#5-observability-pattern-alignment)
6. [Orchestration Workflow Integration](#6-orchestration-workflow-integration)
7. [Agentic Instructions Enhancement](#7-agentic-instructions-enhancement)
8. [Implementation Recommendations](#8-implementation-recommendations)

---

## 1. Current State Analysis

### 1.1 Memory MCP Server

**Configuration**: ✅ Properly configured
- **Location**: `.claude/state/memory.jsonl`
- **Type**: Local stdio server
- **Installation**: Project dependency (not npx)
- **Tools Available**: 8 tools
  - `create_entities` - Create knowledge graph entities
  - `create_relations` - Create relationships between entities
  - `add_observations` - Add observations to entities
  - `delete_entities` - Delete entities
  - `delete_observations` - Delete observations
  - `delete_relations` - Delete relationships
  - `read_graph` - Read entire knowledge graph
  - `search_nodes` - Search for entities
  - `open_nodes` - Open specific entities by name

**Current Usage**:
- ✅ Referenced in workflow-orchestration.md
- ✅ Used for project state persistence
- ⚠️ No structured schema for observability entities
- ⚠️ No patterns for storing architectural decisions
- ⚠️ Not integrated into observability implementation workflow

### 1.2 AKG MCP Server

**Configuration**: ✅ Properly configured
- **Location**: `packages/web/src/tools/akg/mcp/server.ts`
- **Type**: Local stdio server (Bun)
- **Tools Available**: 7 tools
  - `akg_layer_rules` - Get import rules for layers
  - `akg_node_info` - Get node information
  - `akg_check_import` - Validate imports
  - `akg_invariant_status` - Check architectural invariants
  - `akg_diagram` - Generate Mermaid diagrams
  - `akg_path_find` - Find dependency paths
  - `akg_cache_status` - Cache management

**Current Usage**:
- ✅ Well-documented in workflow-orchestration.md
- ✅ Integrated into agentic instructions
- ✅ Used for architectural validation
- ⚠️ Not explicitly called in observability implementation workflow
- ⚠️ No guidance for observability code layer placement

### 1.3 MCP Tool Ecosystem

**All Configured Servers**:
1. **Memory** - Knowledge graph persistence
2. **AKG** - Architectural validation (Dicee-specific)
3. **Context7** - Library documentation
4. **Cloudflare Docs** - Cloudflare documentation search
5. **Cloudflare Observability** - Workers logs/metrics
6. **Cloudflare Builds** - Build status
7. **Cloudflare Bindings** - KV/R2/D1 management
8. **Cloudflare Logpush** - Logpush job management
9. **Cloudflare GraphQL** - Analytics queries

**Tool Priority** (from workflow-orchestration.md):
1. Context7 (library docs) - **FIRST**
2. Cloudflare MCP servers (CF-specific) - **FIRST**
3. AKG (architecture validation) - **ALWAYS before imports**
4. Memory (persistent state) - For context storage

---

## 2. MCP Server Inventory

### 2.1 Complete MCP Tool Matrix

| Server | Purpose | Primary Use Case | Observability Integration | Status |
|--------|---------|-----------------|--------------------------|--------|
| **Memory** | Knowledge graph | Store decisions, context | ⚠️ Needs schema for observability entities | ✅ Configured |
| **AKG** | Architecture validation | Import validation, layer checks | ⚠️ Not in observability workflow | ✅ Configured |
| **Context7** | Library docs | Up-to-date API docs | ✅ Used for Cloudflare/Workers docs | ✅ Configured |
| **cloudflare-docs** | CF documentation | Search CF docs | ✅ Used for observability patterns | ✅ Configured |
| **cloudflare-observability** | Workers telemetry | Query logs/metrics | ✅ Primary observability tool | ✅ Configured |
| **cloudflare-builds** | Build status | Check builds | ⚠️ Not in observability workflow | ✅ Configured |
| **cloudflare-bindings** | Resources | KV/R2/D1 management | ⚠️ Not in observability workflow | ✅ Configured |
| **cloudflare-logpush** | Logpush jobs | Monitor log jobs | ⚠️ Not in observability workflow | ✅ Configured |
| **cloudflare-graphql** | Analytics | GraphQL queries | ⚠️ Not in observability workflow | ✅ Configured |

### 2.2 Tool Interaction Patterns

**Current Pattern** (from workflow-orchestration.md):
```
1. Context7 → Get library docs
2. Cloudflare MCP → Get CF-specific info
3. AKG → Validate architecture
4. Memory → Store decisions
```

**Missing Pattern** (for observability):
```
1. Context7 → Get Cloudflare Workers logging patterns
2. cloudflare-observability → Query existing logs
3. AKG → Validate observability code layer placement
4. Memory → Store observability decisions
```

---

## 3. Memory MCP Integration

### 3.1 Current Memory Usage Patterns

**From workflow-orchestration.md**:
- Project phases and completion status
- Architectural decisions with rationale
- Blockers and research findings
- Task dependencies and priorities

**Entity Types Currently Used**:
- `ProjectPhase` - Current phase status
- `ArchitecturalDecision` - Decisions with rationale
- `Blocker` - Active blockers
- `Task` - Task dependencies

### 3.2 Observability Entity Schema (Proposed)

**New Entity Types for Observability**:

```typescript
// Observability Decision Entity
{
  entityType: 'ObservabilityDecision',
  name: 'observability:event-schema-pattern',
  observations: [
    'Decision: Use const arrays → type inference → Zod schema pattern',
    'Rationale: Type-safe, testable, single source of truth',
    'Implementation: events.schema.ts with LIFECYCLE_EVENTS const array',
    'Date: 2025-01-XX',
    'Status: implemented'
  ]
}

// Observability Implementation Entity
{
  entityType: 'ObservabilityImplementation',
  name: 'observability:instrumentation-class',
  observations: [
    'Component: GameRoom instrumentation',
    'Location: packages/cloudflare-do/src/lib/instrumentation.ts',
    'Pattern: createInstrumentation() factory with Zod validation',
    'Test Coverage: 100%',
    'Status: complete'
  ]
}

// Observability Technical Debt Entity
{
  entityType: 'ObservabilityTechnicalDebt',
  name: 'observability:console-logs-game-room',
  observations: [
    'Issue: 29 ad-hoc console.log statements in GameRoom.ts',
    'Impact: Cannot query logs, no correlation IDs',
    'Priority: High',
    'Status: identified',
    'Migration Plan: Week 2, Day 1-5 (one category per day)'
  ]
}
```

### 3.3 Memory Integration Workflow

**For Observability Implementation**:

1. **Before Implementation**:
   ```typescript
   // Store decision in Memory
   mcp_memory_create_entities({
     entities: [{
       name: 'observability:test-first-approach',
       entityType: 'ObservabilityDecision',
       observations: [
         'Decision: Test-first approach for all observability code',
         'Rationale: Ensures type safety and prevents regressions',
         'Implementation: Write tests before schemas, schemas before instrumentation'
       ]
     }]
   });
   ```

2. **During Implementation**:
   ```typescript
   // Add observations as work progresses
   mcp_memory_add_observations({
     observations: [{
       entityName: 'observability:test-first-approach',
       contents: [
         'Phase 1 Complete: Schema tests written and passing',
         'Phase 2 In Progress: Instrumentation tests being written'
       ]
     }]
   });
   ```

3. **After Implementation**:
   ```typescript
   // Update with completion status
   mcp_memory_add_observations({
     observations: [{
       entityName: 'observability:test-first-approach',
       contents: [
         'Status: Complete',
         'Test Coverage: 100%',
         'All quality gates passing'
       ]
     }]
   });
   ```

### 3.4 Memory Search Patterns

**For Observability Context**:

```typescript
// Search for observability decisions
mcp_memory_search_nodes({
  query: 'observability decision schema pattern'
});

// Search for technical debt
mcp_memory_search_nodes({
  query: 'observability technical debt console.log'
});

// Read full graph for context
mcp_memory_read_graph();
```

---

## 4. AKG MCP Integration

### 4.1 Current AKG Usage

**From workflow-orchestration.md**:
- Import validation before writing code
- Layer rule checking
- Architectural invariant checks
- Dependency path analysis

**Tools Used**:
- `akg_check_import` - **ALWAYS before imports**
- `akg_layer_rules` - Check layer boundaries
- `akg_invariant_status` - Quality gate checks

### 4.2 Observability Code Layer Placement

**Observability Code Locations** (from observability-architectural-patterns.md):
- ✅ Server-side: `packages/cloudflare-do/src/lib/instrumentation.ts`
- ✅ Schemas: `packages/cloudflare-do/src/lib/observability/events.schema.ts`
- ✅ Client-side (optional): `packages/web/src/lib/services/telemetry/`

**AKG Validation Required**:

```typescript
// Before creating instrumentation.ts
mcp_akg_akg_check_import({
  fromPath: 'packages/cloudflare-do/src/GameRoom.ts',
  toPath: 'packages/cloudflare-do/src/lib/instrumentation.ts'
});
// Expected: allowed (GameRoom can import from lib/)

// Before creating events.schema.ts
mcp_akg_akg_check_import({
  fromPath: 'packages/cloudflare-do/src/lib/instrumentation.ts',
  toPath: 'packages/cloudflare-do/src/lib/observability/events.schema.ts'
});
// Expected: allowed (instrumentation can import schemas)

// Check layer rules for observability code
mcp_akg_akg_layer_rules({
  layer: 'services' // For client-side telemetry
});
// Expected: services can import types, wasm, shared (NOT components, routes, stores)
```

### 4.3 AKG Integration Workflow

**For Observability Implementation**:

1. **Before Creating Files**:
   ```typescript
   // Validate layer placement
   mcp_akg_akg_layer_rules({ layer: 'services' });
   mcp_akg_akg_check_import({
     fromPath: 'packages/cloudflare-do/src/GameRoom.ts',
     toPath: 'packages/cloudflare-do/src/lib/instrumentation.ts'
   });
   ```

2. **During Implementation**:
   ```typescript
   // Check invariants after changes
   mcp_akg_akg_invariant_status();
   // Verify no layer violations introduced
   ```

3. **After Implementation**:
   ```typescript
   // Final invariant check
   mcp_akg_akg_invariant_status();
   // Verify all architectural rules still pass
   ```

### 4.4 AKG Diagram Generation

**For Observability Architecture**:

```typescript
// Generate layer overview with observability
mcp_akg_akg_diagram({ name: 'layer-overview' });
// Should show observability code in correct layers

// Generate component dependencies
mcp_akg_akg_diagram({ name: 'component-dependencies' });
// Should show GameRoom → instrumentation → events.schema
```

---

## 5. Observability Pattern Alignment

### 5.1 Type-Safe Patterns

**Observability Pattern** (from observability-project-review.md):
- Const arrays → Type inference → Zod schemas
- Test-first approach
- 100% test coverage requirement

**Memory Integration**:
- Store schema decisions as entities
- Track test coverage progress
- Document type-safe patterns

**AKG Integration**:
- Validate observability code follows layer rules
- Ensure no architectural violations
- Verify type imports are correct

### 5.2 Test-First Patterns

**Observability Pattern**:
- Write tests before implementation
- Use fixtures for all event types
- Achieve 100% coverage

**Memory Integration**:
- Store test-first decisions
- Track test coverage milestones
- Document fixture patterns

**AKG Integration**:
- Validate test file placement
- Ensure test imports follow layer rules
- Check test code doesn't violate architecture

### 5.3 Unified Structure Patterns

**Observability Pattern**:
- Single responsibility per file
- Co-located tests
- Consistent naming conventions

**Memory Integration**:
- Store structural decisions
- Track file organization patterns
- Document naming conventions

**AKG Integration**:
- Validate file organization
- Check import structure
- Verify layer boundaries

---

## 6. Orchestration Workflow Integration

### 6.1 Current Orchestration Pattern

**From workflow-orchestration.md**:
```
Session Start:
1. Read state files (.claude/state/current-phase.json)
2. Sync with MCP Memory (query Knowledge Graph)
3. Announce session

During Work:
1. Use MCP tools (Context7, Cloudflare, AKG, Memory)
2. Update state files
3. Store decisions in Memory

Session End:
1. Update state files
2. Write handoff notes
3. Commit work
```

### 6.2 Enhanced Orchestration for Observability

**Observability-Specific Workflow**:

```
Session Start (Observability):
1. Read observability-project-review.md
2. Read observability-architectural-patterns.md
3. Query Memory for observability decisions
4. Query AKG for layer rules
5. Query cloudflare-observability for existing logs

During Observability Work:
1. Context7 → Get Cloudflare Workers logging patterns
2. AKG → Validate layer placement before creating files
3. Write tests FIRST (test-first approach)
4. Implement with Zod validation
5. Memory → Store decisions and progress
6. AKG → Verify no architectural violations
7. cloudflare-observability → Verify logs in production

Session End (Observability):
1. Update Memory with completion status
2. Update observability-project-review.md checklist
3. Write handoff notes
4. Commit work
```

### 6.3 Quality Gate Integration

**Current Quality Gate** (from workflow-orchestration.md):
```bash
pnpm test
pnpm lint
pnpm typecheck
infisical scan
```

**Enhanced Quality Gate for Observability**:
```bash
# Standard checks
pnpm test
pnpm lint
pnpm typecheck

# Observability-specific
pnpm --filter @dicee/cloudflare-do test --coverage  # Verify 100% coverage
pnpm akg:check  # Verify no architectural violations
grep -r "console\.log\|console\.error" packages/cloudflare-do/src --exclude-dir=__tests__  # Verify no ad-hoc logging

# MCP validation
# Query Memory for observability decisions
# Query AKG for layer compliance
# Query cloudflare-observability for log verification
```

---

## 7. Agentic Instructions Enhancement

### 7.1 Current Agentic Instructions

**From WINDSURF.md and workflow-orchestration.md**:
- MCP tools are PRIMARY tools
- Use Context7 FIRST for library docs
- Use Cloudflare MCP FIRST for CF queries
- Use AKG ALWAYS before imports
- Use Memory for persistent context

### 7.2 Enhanced Instructions for Observability

**Add to Agentic Instructions**:

```markdown
## Observability Implementation Protocol

### Before Starting Observability Work

1. **Read Planning Documents** (in order):
   - `docs/planning/observability-project-review.md` - Project-wide strategy
   - `docs/planning/observability-architectural-patterns.md` - Implementation patterns
   - `docs/planning/observability-plan.md` - High-level plan

2. **Query Memory for Context**:
   ```typescript
   mcp_memory_search_nodes({ query: 'observability decision' });
   mcp_memory_search_nodes({ query: 'observability technical debt' });
   ```

3. **Query AKG for Layer Rules**:
   ```typescript
   mcp_akg_akg_layer_rules({ layer: 'services' }); // For client-side telemetry
   mcp_akg_akg_check_import({
     fromPath: 'packages/cloudflare-do/src/GameRoom.ts',
     toPath: 'packages/cloudflare-do/src/lib/instrumentation.ts'
   });
   ```

4. **Query Context7 for Patterns**:
   ```typescript
   mcp_Context7_get-library-docs({
     context7CompatibleLibraryID: '/websites/developers_cloudflare_workers',
     topic: 'durable objects logging',
     mode: 'code'
   });
   ```

### During Observability Implementation

1. **Test-First Approach**:
   - Write test for schema FIRST
   - Write test for instrumentation method FIRST
   - Implement to pass tests
   - Achieve 100% coverage

2. **AKG Validation**:
   - Check layer rules before creating files
   - Validate imports before writing code
   - Run invariant checks after changes

3. **Memory Updates**:
   - Store decisions as entities
   - Add observations as work progresses
   - Track test coverage milestones

4. **Cloudflare Observability**:
   - Query existing logs to understand patterns
   - Verify new logs appear correctly
   - Test log queries via MCP

### After Observability Implementation

1. **Quality Gate**:
   - Run full quality gate script
   - Verify 100% test coverage
   - Verify AKG checks pass
   - Verify no console.log statements

2. **Memory Updates**:
   - Update entities with completion status
   - Document lessons learned
   - Store query patterns for future reference

3. **Documentation**:
   - Update observability-project-review.md checklist
   - Document any deviations from plan
   - Update architectural patterns if needed
```

### 7.3 MCP Tool Priority for Observability

**Updated Priority Order**:

1. **Context7** - Get Cloudflare Workers logging patterns
2. **cloudflare-observability** - Query existing logs, verify new logs
3. **AKG** - Validate layer placement, check imports
4. **Memory** - Store decisions, track progress
5. **cloudflare-docs** - Search CF documentation (if Context7 insufficient)
6. **cloudflare-builds** - Check build status (if needed)
7. **cloudflare-bindings** - Manage resources (if needed)

---

## 8. Implementation Recommendations

### 8.1 Immediate Actions

1. **Enhance Memory Entity Schema**:
   - Define `ObservabilityDecision` entity type
   - Define `ObservabilityImplementation` entity type
   - Define `ObservabilityTechnicalDebt` entity type
   - Create example entities for current observability work

2. **Integrate AKG into Observability Workflow**:
   - Add AKG checks to observability-project-review.md
   - Add layer validation steps to implementation checklist
   - Document AKG usage in architectural patterns

3. **Update Agentic Instructions**:
   - Add observability-specific MCP usage patterns
   - Document Memory entity schemas
   - Create observability implementation protocol

### 8.2 Short-Term Enhancements

1. **Create Memory Templates**:
   - Template for observability decisions
   - Template for technical debt tracking
   - Template for implementation progress

2. **Enhance AKG Documentation**:
   - Document observability code layer placement
   - Create AKG validation checklist for observability
   - Add observability examples to AKG docs

3. **Create MCP Integration Tests**:
   - Test Memory entity creation for observability
   - Test AKG validation for observability code
   - Test end-to-end MCP workflow

### 8.3 Long-Term Improvements

1. **Automated MCP Integration**:
   - Auto-create Memory entities during implementation
   - Auto-validate AKG rules in CI/CD
   - Auto-update Memory with progress

2. **MCP Query Patterns Library**:
   - Document common Memory queries
   - Document common AKG validations
   - Create reusable query templates

3. **Observability Dashboard**:
   - Visualize Memory entities
   - Show AKG layer compliance
   - Display observability implementation progress

---

## 9. Success Metrics

### 9.1 Memory Integration Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Observability entities created | All decisions tracked | Query Memory graph |
| Entity completeness | 100% with required fields | Review entity observations |
| Search success rate | >90% | Test Memory searches |

### 9.2 AKG Integration Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Layer validation before code | 100% | Review implementation workflow |
| Architectural violations | 0 | Run `akg:check` |
| Import validation | 100% | Check all imports validated |

### 9.3 Orchestration Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| MCP tool usage | All tools used appropriately | Review agentic instructions |
| Workflow compliance | 100% | Review session handoffs |
| Quality gate integration | All checks passing | Run quality gate script |

---

## 10. References

### Planning Documents
- **Observability Project Review**: `docs/planning/observability-project-review.md`
- **Observability Architectural Patterns**: `docs/planning/observability-architectural-patterns.md`
- **Observability Plan**: `docs/planning/observability-plan.md`

### Orchestration Documents
- **Workflow Orchestration**: `.claude/workflow-orchestration.md`
- **Agent Guardrails**: `.claude/AGENT-GUARDRAILS.md`
- **Conventions**: `.claude/CONVENTIONS.md`

### MCP Documentation
- **MCP Setup**: `docs/MCP-SETUP.md`
- **Context7 Reference**: `docs/references/context7-readme.md`
- **AKG Documentation**: `docs/architecture/akg/`

### Code References
- **AKG MCP Server**: `packages/web/src/tools/akg/mcp/server.ts`
- **Memory Configuration**: `.mcp.json`, `.cursor/mcp.json`
- **State Files**: `.claude/state/`

---

**Document Status**: Review & Enhancement  
**Last Updated**: 2025-01-XX  
**Owner**: Development Team  
**Reviewers**: TBD

**Next Steps**:
1. Review and approve Memory entity schemas
2. Integrate AKG checks into observability workflow
3. Update agentic instructions with observability protocol
4. Create Memory entity templates
5. Test MCP integration end-to-end

