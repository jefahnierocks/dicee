# Pre-AKG Planning Document

> **Version**: 1.0.0
> **Created**: 2025-12-05
> **Status**: Planning
> **Project**: Dicee
> **Scope**: Phase -1 (Pre-Implementation) for Architectural Knowledge Graph

---

## Table of Contents

1. [Governance Readiness Assessment](#1-governance-readiness-assessment)
2. [Integration Specification](#2-integration-specification)
3. [Decision Log](#3-decision-log)
4. [Design Validation Simulations](#4-design-validation-simulations)
5. [Implementation Roadmap](#5-implementation-roadmap)
6. [Success Criteria](#6-success-criteria)

---

## 1. Governance Readiness Assessment

### 1.1 Project Maturity Evaluation

| Question | Answer | Evidence |
|----------|--------|----------|
| Does the project have established architectural patterns? | ✅ Yes | Svelte 5 runes, smart/dumb components, Result pattern, store patterns documented in `.claude/CONVENTIONS.md` |
| Are there existing ADRs or design documents? | ✅ Yes | 5 ADRs in `docs/rfcs/` (ADR-001 through ADR-005), auth-strategy.yaml, environment-strategy.yaml |
| Is there a clear module/layer structure? | ✅ Yes | `packages/web/src/lib/` with components/, stores/, services/, types/, supabase/ |
| Does CI/CD exist? | ⚠️ Partial | pnpm scripts exist, but no GitHub Actions for governance |

**Threshold**: 3 of 4 = ✅ **PASSED**

### 1.2 Team Readiness Evaluation

| Question | Answer | Evidence |
|----------|--------|----------|
| Is there capacity for governance maintenance (~2-4 hrs/week)? | ✅ Yes | Agentic workflow with Opus 4.5 can handle maintenance |
| Is there a human reviewer for governance changes? | ✅ Yes | Human orchestrator defined in workflow-orchestration.md |
| Are agents/automation part of the development workflow? | ✅ Yes | MCP servers, slash commands, guardrails, multi-agent orchestration |

**Threshold**: 2 of 3 = ✅ **PASSED**

### 1.3 Value Proposition Evaluation

| Question | Answer | Evidence |
|----------|--------|----------|
| Have architectural violations caused production issues? | ⚠️ Not yet | Project is pre-production, but preventive governance valuable |
| Do new contributors frequently violate conventions? | ✅ Yes | Naming convention issues (onRoll vs onroll) caught multiple times |
| Is there technical debt from inconsistent patterns? | ⚠️ Minor | Some legacy code patterns from Svelte 4 → 5 migration |
| Would agents benefit from structural awareness? | ✅ Yes | Agents currently lack layer/boundary awareness, rely on reading CONVENTIONS.md |

**Threshold**: 2 of 4 = ✅ **PASSED**

### 1.4 Assessment Recommendation

**ALL THRESHOLDS MET** → Proceed with AKG implementation

**Priority Justification**:
- Agentic workflow will benefit significantly from machine-readable architecture
- Early implementation prevents debt accumulation
- Multiplayer complexity (Phase 4-5) increases violation risk

---

## 2. Integration Specification

```yaml
# Dicee AKG Integration Specification
# Aligned with .claude/workflow-orchestration.md

version: "1.0.0"
created: "2025-12-05"
status: "draft"

# ═══════════════════════════════════════════════════════════════
# SECTION 1: SYSTEM OVERVIEW
# ═══════════════════════════════════════════════════════════════

systems:
  akg:
    purpose: "Static architectural analysis for Dicee codebase"
    scope:
      - "SvelteKit route and component structure"
      - "Store dependencies and derivation chains"
      - "Service layer boundaries"
      - "Type system integrity"
      - "WASM/TypeScript boundary contracts"

    technology:
      parser: "ts-morph for TypeScript, custom for Svelte"
      storage: "JSON files initially (sub-1000 nodes)"
      runtime: "Bun for discovery scripts"

  integration_with_existing:
    mcp_memory:
      purpose: "Sync graph summaries for agent context"
      action: "Publish key metrics to knowledge graph"

    biome:
      purpose: "Complement with structural rules Biome can't check"
      action: "AKG checks layer boundaries, Biome checks syntax"

    quality_gate:
      purpose: "Integrate with existing ./scripts/quality-gate.sh"
      action: "Add akg:check to pre-phase-transition checks"

# ═══════════════════════════════════════════════════════════════
# SECTION 2: INVARIANT TAXONOMY (DICEE-SPECIFIC)
# ═══════════════════════════════════════════════════════════════

invariant_types:
  structural:
    description: "Code organization and dependency rules"
    source: "Static analysis via ts-morph"
    dicee_examples:
      - id: "layer_component_isolation"
        rule: "Components in components/ cannot import from stores/ directly"
        reason: "Smart/dumb component pattern - props only for dumb components"
        severity: "warning"

      - id: "store_no_circular_deps"
        rule: "Stores cannot have circular dependencies"
        reason: "Svelte runes reactivity breaks with cycles"
        severity: "error"

      - id: "service_layer_boundaries"
        rule: "Services must not import components or routes"
        reason: "Services are business logic, not UI"
        severity: "error"

      - id: "wasm_single_entry"
        rule: "Only engine.ts may import from wasm/"
        reason: "Centralized WASM bridge for type safety and caching"
        severity: "error"

  naming:
    description: "Convention enforcement beyond Biome capability"
    source: "AST analysis of identifiers"
    dicee_examples:
      - id: "callback_prop_naming"
        rule: "Component callback props must use onVerb pattern (camelCase)"
        reason: "Documented in CONVENTIONS.md §1"
        severity: "warning"

      - id: "store_file_naming"
        rule: "Store files must end in .svelte.ts"
        reason: "Svelte 5 runes require .svelte.ts extension"
        severity: "error"

      - id: "boolean_prop_naming"
        rule: "Boolean props must use is/has/can prefix"
        reason: "Documented in CONVENTIONS.md §1"
        severity: "info"

  domain:
    description: "Dicee game domain rules"
    source: "Semantic analysis of type relationships"
    dicee_examples:
      - id: "category_type_consistency"
        rule: "All Category references must derive from CATEGORIES const array"
        reason: "ADR-001 canonical configuration model"
        severity: "error"

      - id: "score_calculation_isolation"
        rule: "Score calculations must only exist in engine package or engine.ts bridge"
        reason: "WASM engine is source of truth for scoring"
        severity: "error"

      - id: "game_state_immutability"
        rule: "GameState mutations must go through store methods"
        reason: "Centralized state management pattern"
        severity: "warning"

# ═══════════════════════════════════════════════════════════════
# SECTION 3: DATA FLOWS
# ═══════════════════════════════════════════════════════════════

data_flows:
  discovery_trigger:
    on_pr:
      scope: "Incremental (changed files + dependents)"
      paths:
        - "packages/web/src/**/*.ts"
        - "packages/web/src/**/*.svelte"
        - "packages/partykit/src/**/*.ts"

    on_demand:
      scope: "Full discovery"
      command: "pnpm akg:discover"

    weekly:
      scope: "Full discovery with historical snapshot"
      day: "Sunday"

  akg_to_ci:
    trigger: "PR to main"
    action: "Run discovery on changed files, check invariants"
    output: "Pass/fail with violation report"
    blocking: "error-severity violations only"

  akg_to_agents:
    trigger: "Agent queries via MCP tool"
    available_queries:
      - "query_components" - Find components by name/type
      - "find_dependencies" - What does X import?
      - "find_dependents" - What imports X?
      - "check_layer" - What layer is this file in?
      - "analyze_impact" - Risk assessment for modifying X

  akg_to_mcp_memory:
    trigger: "After successful discovery"
    action: "Update DiceeAKG entity with metrics"
    data:
      - "nodeCount"
      - "edgeCount"
      - "violationCount"
      - "lastDiscoveryTime"

# ═══════════════════════════════════════════════════════════════
# SECTION 4: GOVERNANCE TRIAGE
# ═══════════════════════════════════════════════════════════════

governance_triage:
  description: "Priority ordering for governance signals"

  priority_order:
    1:
      signal: "Error-severity invariant violation"
      examples:
        - "store_no_circular_deps"
        - "wasm_single_entry"
        - "service_layer_boundaries"
      action: "HALT - Must resolve before proceeding"
      agent_behavior: "Stop current task, report violation, await human guidance"

    2:
      signal: "Warning-severity invariant"
      examples:
        - "layer_component_isolation"
        - "callback_prop_naming"
      action: "NOTE - Address if directly relevant to current task"
      agent_behavior: "Fix if in scope of current work, otherwise log for later"

    3:
      signal: "Info-severity invariant"
      examples:
        - "boolean_prop_naming"
      action: "AWARE - Improve opportunistically"
      agent_behavior: "Note but don't block progress"

# ═══════════════════════════════════════════════════════════════
# SECTION 5: MAINTENANCE MODEL
# ═══════════════════════════════════════════════════════════════

maintenance:
  discovery:
    frequency: "on_pr + weekly_full"
    incremental_scope: "Changed files + 2 levels of dependents"
    output_location: "docs/architecture/akg/graph/"

  invariant_review:
    frequency: "Biweekly"
    owner: "Human + Opus agent"
    tasks:
      - "Review false positive rate"
      - "Adjust severity levels"
      - "Add new invariants from patterns"
      - "Deprecate outdated invariants"

  effectiveness_tracking:
    metrics:
      - "violations_per_pr" - Target: <3 average
      - "false_positive_rate" - Target: <10%
      - "fix_rate" - Target: >80% of warnings fixed within 1 week

  time_budget:
    weekly: "1-2 hours (mostly automated)"
    quarterly_review: "4 hours"

# ═══════════════════════════════════════════════════════════════
# SECTION 6: DICEE-SPECIFIC LAYER DEFINITIONS
# ═══════════════════════════════════════════════════════════════

layers:
  definition:
    routes:
      paths: ["packages/web/src/routes/"]
      description: "SvelteKit page routes and layouts"
      may_import: ["components", "stores", "services", "types", "lib"]

    components:
      paths: ["packages/web/src/lib/components/"]
      description: "Svelte components (smart and dumb)"
      may_import: ["components", "types", "utils"]
      may_not_import: ["stores", "services"]
      exception: "Smart containers may import stores"

    stores:
      paths: ["packages/web/src/lib/stores/"]
      description: "Svelte 5 rune stores"
      may_import: ["services", "types", "supabase"]
      may_not_import: ["components", "routes"]

    services:
      paths: ["packages/web/src/lib/services/"]
      description: "Business logic and external API wrappers"
      may_import: ["types", "supabase", "wasm"]
      may_not_import: ["components", "routes", "stores"]

    types:
      paths: ["packages/web/src/lib/types/"]
      description: "TypeScript type definitions"
      may_import: ["types"] # Can import other type files
      may_not_import: ["*"] # Types should be pure

    supabase:
      paths: ["packages/web/src/lib/supabase/"]
      description: "Supabase client and helpers"
      may_import: ["types"]
      may_not_import: ["components", "routes", "stores", "services"]

    wasm:
      paths: ["packages/web/src/lib/wasm/", "packages/web/src/lib/engine.ts"]
      description: "WASM bridge (generated + wrapper)"
      may_import: ["types"]
      special: "Only engine.ts should be imported by other modules"

  smart_component_detection:
    criteria:
      - "File is in components/ directory"
      - "Imports from stores/ or services/"
    classification: "SmartComponent"
    note: "Smart components are allowed to break component isolation"

# ═══════════════════════════════════════════════════════════════
# SECTION 7: ESCAPE HATCHES
# ═══════════════════════════════════════════════════════════════

escape_hatches:
  level_1_reduce_noise:
    trigger: "False positive rate > 20%"
    actions:
      - "Raise warning → info for noisy invariants"
      - "Add explicit exemption comments: // akg-ignore: reason"

  level_2_pause_automation:
    trigger: "Maintenance burden > 3 hours/week OR blocking development"
    actions:
      - "Disable auto-discovery on PR"
      - "Run discovery manually before phase transitions only"
      - "Keep error-severity checks, pause warnings"

  level_3_archive:
    trigger: "AKG provides negative value for 2+ weeks"
    actions:
      - "Archive graph data (don't delete)"
      - "Keep only wasm_single_entry invariant (critical)"
      - "Document lessons learned"
      - "Re-evaluate in 1 month"

  principle: "Always preserve data. Only reduce automation."
```

---

## 3. Decision Log

### Decision 1: Invariant Severity Levels

**Question**: What severity levels exist and what do they mean?

**Decision**: Three levels with specific CI behaviors

| Level | Meaning | CI Behavior | Override Mechanism |
|-------|---------|-------------|-------------------|
| `error` | Must fix before merge | Block PR | Requires `// akg-override: <justification>` comment AND human approval |
| `warning` | Should fix, not blocking | Report in PR comment | Automatic if not addressed |
| `info` | Best practice suggestion | Log only | N/A |

**Rationale**: Matches existing Biome severity model. Error level reserved for true architectural invariants.

**Date**: 2025-12-05

---

### Decision 2: Invariant Promotion Path

**Question**: How do new invariants move from warning to error?

**Decision**: Time + effectiveness + human approval

```
New Invariant Created
        ↓
    [warning] for 2 weeks
        ↓
If false_positive_rate < 15%
    AND violation_fix_rate > 70%
        ↓
    Human review + approval
        ↓
    [error] status
```

**Demotion Path**:
- If false_positive_rate > 30% → auto-demote to info
- If manually overridden > 5 times → flag for review

**Rationale**: Prevents blocking development with untested rules. Matches AGENT-GUARDRAILS "fail fast, ask human" philosophy.

**Date**: 2025-12-05

---

### Decision 3: Graph Storage Strategy

**Question**: Where is the AKG stored?

**Decision**: Phased approach based on scale

| Phase | Storage | Trigger for Next |
|-------|---------|------------------|
| Initial | JSON in `docs/architecture/akg/graph/` | nodes > 500 OR query_time > 200ms |
| Scale | SQLite in `.claude/state/akg.db` | team_size > 2 OR need visualization |

**Current Estimate**: ~150-200 nodes (components, stores, services, types)

**Rationale**: JSON is human-readable, git-trackable, and sufficient for current scale. SQLite provides indexing when needed.

**Date**: 2025-12-05

---

### Decision 4: Discovery Scope & Triggers

**Question**: What triggers re-discovery and at what scope?

**Decision**:

| Trigger | Scope | Implementation |
|---------|-------|----------------|
| PR with `.ts`/`.svelte` changes in `packages/web/src/` | Incremental | Changed files + direct dependents |
| PR with `packages/partykit/` changes | Incremental | PartyKit package only |
| Manual `pnpm akg:discover` | Full | All packages |
| Weekly scheduled (Sunday) | Full + snapshot | Archive to `graph/history/` |
| Schema/config change (biome.json, tsconfig) | Full | Triggered by file pattern |

**Incremental Algorithm**:
1. Identify changed files from git diff
2. Find all files that import changed files (1 level)
3. Find all files that import those files (2 levels)
4. Re-analyze this subset only
5. Merge with cached graph

**Rationale**: Full discovery estimated at ~5-10 seconds. Incremental keeps PR feedback under 3 seconds.

**Date**: 2025-12-05

---

### Decision 5: Agent Authority Levels

**Question**: What can agents do with governance?

**Decision**: Tiered authority matching AGENT-GUARDRAILS

| Action | Agent Authority | Logging |
|--------|-----------------|---------|
| Query graph (any query) | ✅ Full | Standard tool logging |
| Fix info-severity violations | ✅ Full | Log to session handoff |
| Fix warning-severity violations | ✅ Full | Log to session handoff |
| Fix error-severity violations | ⚠️ Requires confirmation | Log + update blockers.json |
| Propose new invariants | 📝 Suggest only | Create in decisions.json as "proposed" |
| Modify invariant definitions | ❌ Never | Human only |
| Override governance | ❌ Never | Human only |

**Three Strikes Integration**:
- If agent fails to fix violation 3 times → STOP, ask human
- Violation fix attempts count toward strike counter

**Rationale**: Matches existing AGENT-GUARDRAILS philosophy. Autonomy for low-risk, gates for high-risk.

**Date**: 2025-12-05

---

### Decision 6: Svelte Component Parsing Strategy

**Question**: How do we parse `.svelte` files for the graph?

**Decision**: Hybrid approach

1. **Script Block**: Parse with ts-morph after extraction
2. **Template Block**: Simple regex for component usage (`<ComponentName`)
3. **Style Block**: Ignore (not structural)

**Implementation**:
```typescript
// Pseudo-code
function parseSvelteFile(content: string) {
  const scriptMatch = content.match(/<script[^>]*>([\s\S]*?)<\/script>/);
  const templateMatch = content.match(/<\/script>([\s\S]*?)(<style|$)/);

  // Parse script with ts-morph
  const scriptNodes = parseTypeScript(scriptMatch?.[1] ?? '');

  // Extract component usage from template
  const componentUsage = [...templateMatch[1].matchAll(/<([A-Z][a-zA-Z]+)/g)]
    .map(m => m[1]);

  return { scriptNodes, componentUsage };
}
```

**Confidence Levels**:
- Script imports: `high`
- Component usage in template: `medium` (might miss dynamic components)

**Rationale**: Full Svelte compiler integration is complex. Hybrid approach covers 95% of cases.

**Date**: 2025-12-05

---

### Decision 7: Smart vs Dumb Component Classification

**Question**: How do we classify smart containers vs dumb components?

**Decision**: Import-based classification

| Classification | Criteria | Layer Rules |
|----------------|----------|-------------|
| **Dumb Component** | Does NOT import from stores/ or services/ | Must receive all data via props |
| **Smart Container** | Imports from stores/ or services/ | May orchestrate state, pass to children |

**Detection**:
```typescript
function classifyComponent(imports: string[]): 'smart' | 'dumb' {
  const storePattern = /stores\//;
  const servicePattern = /services\//;

  return imports.some(i => storePattern.test(i) || servicePattern.test(i))
    ? 'smart'
    : 'dumb';
}
```

**Node Attribute**:
```json
{
  "type": "Component",
  "attributes": {
    "classification": "smart" | "dumb"
  }
}
```

**Rationale**: Matches documented pattern in CONVENTIONS.md. Enables layer isolation enforcement.

**Date**: 2025-12-05

---

### Decision 8: WASM Boundary Enforcement

**Question**: How strictly do we enforce the WASM single-entry pattern?

**Decision**: Strict enforcement with explicit exception mechanism

**Rule**: Only `packages/web/src/lib/engine.ts` may import from `packages/web/src/lib/wasm/`

**Severity**: `error` (blocking)

**Exception**: Test files (`*.test.ts`) may import WASM directly for testing

**Detection**:
```typescript
function checkWasmBoundary(edge: AKGEdge): InvariantViolation | null {
  if (!edge.targetNodeId.includes('wasm/')) return null;
  if (edge.sourceNodeId.includes('engine.ts')) return null;
  if (edge.sourceNodeId.includes('.test.ts')) return null;

  return {
    invariantId: 'wasm_single_entry',
    severity: 'error',
    message: `Direct WASM import not allowed. Use engine.ts bridge.`,
    suggestion: `Import from '$lib/engine' instead of '$lib/wasm/'`
  };
}
```

**Rationale**: Centralized WASM bridge ensures consistent error handling, caching, and type safety.

**Date**: 2025-12-05

---

### Decision 9: Integration with Existing Quality Gate

**Question**: How does AKG integrate with `./scripts/quality-gate.sh`?

**Decision**: Add as step 2 (after TypeScript, before Biome)

**Updated quality-gate.sh sequence**:
```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Dicee Quality Gate ==="

# 1. TypeScript
echo "→ Running TypeScript check..."
pnpm check

# 2. AKG (NEW)
echo "→ Running AKG invariant check..."
pnpm akg:check || {
  echo "⚠️  AKG violations found. Checking severity..."
  # Only fail on error-severity
  pnpm akg:check --severity=error || exit 1
}

# 3. Lint
echo "→ Running Biome lint..."
pnpm lint

# 4. Tests
echo "→ Running tests..."
pnpm test

# 5. Secrets scan
echo "→ Scanning for secrets..."
infisical scan --domain=https://infisical.example.com || true

# 6. Build check
echo "→ Running build..."
pnpm build

echo "=== Quality Gate PASSED ==="
```

**Rationale**: AKG checks structural issues that TypeScript and Biome cannot detect. Position after TypeScript ensures valid syntax before graph analysis.

**Date**: 2025-12-05

---

### Decision 10: Historical Graph Retention

**Question**: How long do we keep historical graph snapshots?

**Decision**: Rolling retention with milestones

| Type | Retention | Storage |
|------|-----------|---------|
| Current graph | Always | `graph/current.json` |
| Daily snapshots | 7 days | `graph/history/YYYY-MM-DD.json` |
| Weekly snapshots | 4 weeks | `graph/history/weekly/YYYY-Www.json` |
| Phase completion | Forever | `graph/milestones/phase-N.json` |

**Cleanup Script**:
```bash
# Run weekly
find docs/architecture/akg/graph/history -name "*.json" -mtime +7 -delete
```

**Git Strategy**:
- `graph/current.json` → tracked
- `graph/history/` → .gitignore (ephemeral)
- `graph/milestones/` → tracked (permanent)

**Rationale**: Balance between debugging capability and storage. Phase milestones enable architectural drift detection.

**Date**: 2025-12-05

---

## 4. Design Validation Simulations

### Simulation 1: Component Imports Store Directly

#### Context
A developer (or agent) creates a new "dumb" component that needs to display game state.

#### Scenario
Agent creates `PlayerScore.svelte` that imports `game.svelte.ts` directly to get the current score.

#### Step 1: Detection (Simulated)
```json
{
  "detection_type": "invariant_violation",
  "signal": {
    "invariantId": "layer_component_isolation",
    "sourceNode": "component::PlayerScore",
    "targetNode": "store::game",
    "edge": "imports"
  },
  "severity": "warning",
  "action_required": "NOTE"
}
```

#### Step 2: Response (Simulated)
AKG check produces:
```
⚠️  layer_component_isolation (1 violation)
   - PlayerScore.svelte imports from stores/game.svelte.ts
   - Components should receive data via props unless they are smart containers
   💡 Option A: Convert to smart container (rename to PlayerScoreContainer.svelte)
   💡 Option B: Receive score as prop from parent
```

#### Step 3: Resolution
Agent evaluates options:
- Component is simple display → should be dumb
- Refactors to receive `score: number` as prop
- Parent smart component handles store subscription

#### Design Implications
```yaml
gap_identified: "Need clear naming convention for smart vs dumb"
proposed_fix: "Smart containers should have 'Container' suffix or be in containers/ subdirectory"
invariant_suggested: null
pattern_suggested: "SmartContainerNaming"
```

#### Lessons
1. Severity as `warning` is appropriate - allows agent to proceed with fix
2. Suggestion of both options is helpful
3. Consider enforcing naming convention for smart containers

---

### Simulation 2: Circular Store Dependency

#### Context
Two stores need to reference each other for game state coordination.

#### Scenario
`game.svelte.ts` imports `multiplayer.svelte.ts` to get connection status.
`multiplayer.svelte.ts` imports `game.svelte.ts` to get current game state.

#### Step 1: Detection (Simulated)
```json
{
  "detection_type": "invariant_violation",
  "signal": {
    "invariantId": "store_no_circular_deps",
    "cycle": ["store::game", "store::multiplayer", "store::game"],
    "edge_types": ["imports", "imports"]
  },
  "severity": "error",
  "action_required": "HALT"
}
```

#### Step 2: Response (Simulated)
```
❌ store_no_circular_deps (1 violation)
   - Circular dependency: game → multiplayer → game
   - Svelte 5 runes may fail to initialize properly with circular deps

   🚫 BLOCKING: Must resolve before commit

   💡 Suggestion: Extract shared state to a new store (e.g., gameSession.svelte.ts)
   💡 Suggestion: Use events/callbacks instead of direct imports
   💡 Suggestion: Create a mediator store that both can import
```

#### Step 3: Resolution
Agent applies Three Strikes Rule:
1. Attempt 1: Extract `GameSession` type to shared types
2. Attempt 2: Create `session.svelte.ts` as mediator
3. Attempt 3: Still circular → STOP, ask human

Human decides: Create `gameContext.svelte.ts` as a thin coordination layer.

#### Design Implications
```yaml
gap_identified: "Store architecture can become tangled as features grow"
proposed_fix: "Document recommended store hierarchy in ADR"
invariant_suggested: "store_dependency_depth" - max 2 levels of store imports
pattern_suggested: "MediatorStore"
```

#### Lessons
1. Error severity forces resolution before merge
2. Three strikes rule integrates well with blocking violations
3. Need ADR documenting store architecture patterns

---

### Simulation 3: Direct WASM Import in Component

#### Context
Developer wants to optimize by calling WASM directly from a component.

#### Scenario
`ScorePreview.svelte` imports `analyze_turn` directly from WASM module, bypassing `engine.ts` bridge.

#### Step 1: Detection (Simulated)
```json
{
  "detection_type": "invariant_violation",
  "signal": {
    "invariantId": "wasm_single_entry",
    "sourceNode": "component::ScorePreview",
    "targetNode": "wasm::dicee_engine",
    "evidence": {
      "filePath": "packages/web/src/lib/components/scorecard/ScorePreview.svelte",
      "line": 3,
      "snippet": "import { analyze_turn } from '$lib/wasm/dicee_engine';"
    }
  },
  "severity": "error",
  "action_required": "HALT"
}
```

#### Step 2: Response (Simulated)
```
❌ wasm_single_entry (1 violation)
   - ScorePreview.svelte imports directly from wasm/
   - Only engine.ts may import WASM modules (ADR-004)

   🚫 BLOCKING: Must use engine.ts bridge

   Reason: Centralized bridge provides:
   - Type coercion (Rust ↔ TypeScript)
   - Error handling wrapper
   - Future caching layer
   - Single point for version updates

   💡 Replace: import { analyze_turn } from '$lib/wasm/dicee_engine';
      With:    import { analyzeTurn } from '$lib/engine';
```

#### Step 3: Resolution
Agent immediately fixes:
1. Update import statement
2. Adjust function call (camelCase)
3. No other changes needed (types are compatible)

#### Design Implications
```yaml
gap_identified: null
proposed_fix: null
invariant_suggested: null
pattern_suggested: null
```

#### Lessons
1. Clear error message with reason prevents repetition
2. Specific fix suggestion enables autonomous resolution
3. This invariant works as designed

---

### Simulation 4: Service Imports Component

#### Context
Agent needs to render something from a service (anti-pattern).

#### Scenario
`roomService.svelte.ts` imports `Toast.svelte` to show notifications.

#### Step 1: Detection (Simulated)
```json
{
  "detection_type": "invariant_violation",
  "signal": {
    "invariantId": "service_layer_boundaries",
    "sourceNode": "service::roomService",
    "targetNode": "component::Toast",
    "layer_violation": {
      "from": "services",
      "to": "components",
      "allowed": false
    }
  },
  "severity": "error",
  "action_required": "HALT"
}
```

#### Step 2: Response (Simulated)
```
❌ service_layer_boundaries (1 violation)
   - services/roomService.svelte.ts imports from components/
   - Services must not have UI dependencies

   🚫 BLOCKING

   💡 Pattern: Services should emit events/callbacks
      - Add onError?: (message: string) => void to service config
      - Let the consuming component/store handle Toast display

   💡 Alternative: Use a toast store
      - import { toasts } from '$lib/stores/toasts.svelte';
      - toasts.add({ message, type: 'error' });
      - Toast component subscribes to store
```

#### Step 3: Resolution
Agent evaluates:
- Toast store pattern is idiomatic Svelte
- Checks if `toasts.svelte.ts` exists → No
- Creates `toasts.svelte.ts` with add/remove methods
- Updates roomService to use toast store
- Updates layout to include Toast component

#### Design Implications
```yaml
gap_identified: "No global notification system exists"
proposed_fix: "Create toasts.svelte.ts as part of UI infrastructure"
invariant_suggested: null
pattern_suggested: "GlobalToastStore"
```

#### Lessons
1. Layer violation exposed missing infrastructure
2. Suggestion led to better architecture
3. Document toast pattern in CONVENTIONS.md

---

### Simulation 5: Category Type Not Using Canonical Source

#### Context
Developer adds new scoring category without updating the canonical array.

#### Scenario
New type `type SpecialCategory = 'Dicee' | 'Chance' | 'Bonus';` created alongside existing `CATEGORIES` const array.

#### Step 1: Detection (Simulated)
```json
{
  "detection_type": "invariant_violation",
  "signal": {
    "invariantId": "category_type_consistency",
    "parallel_definitions": [
      {
        "name": "CATEGORIES",
        "type": "const_array",
        "location": "packages/web/src/lib/types.ts:15"
      },
      {
        "name": "SpecialCategory",
        "type": "type_alias",
        "location": "packages/web/src/lib/components/scorecard/utils.ts:8"
      }
    ],
    "issue": "Parallel category definition may diverge from canonical source"
  },
  "severity": "error",
  "action_required": "HALT"
}
```

#### Step 2: Response (Simulated)
```
❌ category_type_consistency (1 violation)
   - SpecialCategory type defined outside canonical CATEGORIES array
   - ADR-001 requires all Category types derive from CATEGORIES

   🚫 BLOCKING

   💡 If these are a subset of existing categories:
      type SpecialCategory = Extract<Category, 'Dicee' | 'Chance'>;

   💡 If 'Bonus' is new, add to CATEGORIES first:
      1. Update CATEGORIES array in types.ts
      2. Derive type: type SpecialCategory = Extract<Category, ...>;
```

#### Step 3: Resolution
Agent analyzes:
- 'Bonus' is not a real category (it's calculated)
- 'Dicee' and 'Chance' exist in CATEGORIES
- Refactors to use Extract<Category, ...>

#### Design Implications
```yaml
gap_identified: "Need documentation on derived types vs parallel types"
proposed_fix: "Add section to CONVENTIONS.md on type derivation patterns"
invariant_suggested: null
pattern_suggested: "DerivedTypes"
```

#### Lessons
1. Domain invariant caught subtle type system violation
2. Multiple suggestions handle different root causes
3. ADR reference provides authoritative backing

---

## 5. Implementation Roadmap

### Week 0 (Current): Pre-Implementation ✓
- [x] Complete governance readiness assessment
- [x] Create integration specification
- [x] Create decision log with 10 pre-decisions
- [x] Write 5 design validation simulations
- [ ] Human review and approval of planning document

### Week 1: Schema & Infrastructure
- [ ] Create directory structure `src/tools/akg/`
- [ ] Implement `graph.schema.ts` with Zod
- [ ] Implement `invariant.schema.ts`
- [ ] Write schema validation tests
- [ ] Add `akg:discover` and `akg:check` to package.json

### Week 2: Discovery Engine
- [ ] Implement basic TypeScript file discovery
- [ ] Implement Svelte file parsing (script + template)
- [ ] Implement import edge extraction
- [ ] Implement layer classification
- [ ] First full discovery run

### Week 3: Query Engine & Invariants
- [ ] Implement `AKGQueryEngine` class
- [ ] Implement basic invariants:
  - `wasm_single_entry`
  - `service_layer_boundaries`
  - `store_no_circular_deps`
- [ ] Write invariant tests with fixtures

### Week 4: CLI & Integration
- [ ] Create `discover.ts` script
- [ ] Create `check.ts` script
- [ ] Integrate with quality-gate.sh
- [ ] Create GitHub Actions workflow (optional)
- [ ] Test end-to-end flow

### Week 5: Agent Integration
- [ ] Create MCP server `project-akg`
- [ ] Implement query tools
- [ ] Add to `.mcp.json`
- [ ] Write agent instructions
- [ ] Test with Opus agent

### Week 6: Documentation & Validation
- [ ] Create AKG_SPEC.yaml
- [ ] Create OVERVIEW.md
- [ ] Write ADR for AKG system
- [ ] Full project validation
- [ ] Adjust thresholds based on results

---

## 6. Success Criteria

### Week 4 (MVP)
- [ ] Discovery completes in <10 seconds
- [ ] At least 3 invariants active
- [ ] Zero false positives in test run
- [ ] Integrated with quality gate

### Week 6 (Full)
- [ ] All 8 planned invariants active
- [ ] MCP server operational
- [ ] Agent can query graph successfully
- [ ] False positive rate <10%
- [ ] Documentation complete

### Month 3 (Validation)
- [ ] At least 5 violations caught before merge
- [ ] No architectural violations in production
- [ ] Maintenance burden <2 hours/week
- [ ] At least 1 invariant promoted from warning to error

### Failure Indicators (Trigger Escape Hatch)
- False positive rate >30%
- More than 3 manual overrides per week
- Maintenance burden >4 hours/week
- Agent repeatedly ignoring AKG guidance

---

## Appendix A: Node Type Catalog (Dicee-Specific)

| Node Type | Description | Dicee Examples |
|-----------|-------------|----------------|
| `Module` | TypeScript/Svelte file | `game.svelte.ts`, `DiceTray.svelte` |
| `Component` | Svelte component | `Die.svelte`, `GameGateway.svelte` |
| `SmartContainer` | Component that imports stores | `MultiplayerGameView.svelte` |
| `Store` | Svelte 5 rune store | `game.svelte.ts`, `auth.svelte.ts` |
| `Service` | Business logic module | `engine.ts`, `roomService.svelte.ts` |
| `Type` | Type definition file | `types.ts`, `multiplayer.ts` |
| `Route` | SvelteKit route | `+page.svelte`, `+layout.svelte` |
| `WASMBridge` | WASM wrapper | `engine.ts` |
| `WASMModule` | Generated WASM bindings | `dicee_engine.js` |
| `Layer` | Architectural layer | `components`, `stores`, `services` |

---

## Appendix B: Edge Type Catalog (Dicee-Specific)

| Edge Type | Description | Example |
|-----------|-------------|---------|
| `imports` | ES module import | `DiceTray → Die` |
| `uses_component` | Component usage in template | `GameView <DiceTray>` |
| `subscribes_to` | Store subscription | `GameView → game store` |
| `calls_service` | Service method call | `game store → engine service` |
| `extends` | Class/interface extension | (rare in Dicee) |
| `belongs_to` | Layer membership | `DiceTray → components layer` |
| `violates` | Invariant violation edge | `X violates wasm_single_entry` |

---

## Appendix C: File Locations Summary

```
docs/architecture/akg/
├── PRE_AKG_PLANNING.md       # This document
├── OVERVIEW.md               # (Week 6)
├── AKG_SPEC.yaml             # (Week 6)
├── AGENT_INSTRUCTIONS.md     # (Week 5)
├── graph/
│   ├── current.json          # Latest discovery
│   ├── history/              # Rolling daily snapshots
│   └── milestones/           # Phase completion snapshots
└── invariants/
    └── definitions.yaml      # Machine-readable invariant catalog

src/tools/akg/                # (Week 1-4)
├── index.ts
├── schema/
├── discovery/
├── query/
├── invariants/
└── cli/

scripts/akg/                  # (Week 4)
├── discover.ts
├── check.ts
└── report.ts
```

---

**Document Status**: Ready for human review and approval.

**Next Action**: Human approval to proceed with Week 1 implementation.
