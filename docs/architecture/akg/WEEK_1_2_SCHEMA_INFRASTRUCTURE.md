# AKG Week 1-2: Schema & Infrastructure Planning

> **Version**: 1.0.0
> **Created**: 2025-12-05
> **Status**: Planning Complete
> **Scope**: Week 1-2 Implementation for Architectural Knowledge Graph
> **Prerequisite**: PRE_AKG_PLANNING.md approved

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Tooling Decisions](#2-tooling-decisions)
3. [Schema Design](#3-schema-design)
4. [Directory Structure](#4-directory-structure)
5. [Storage Strategy](#5-storage-strategy)
6. [Implementation Plan](#6-implementation-plan)
7. [Test Strategy](#7-test-strategy)
8. [Success Criteria](#8-success-criteria)

---

## 1. Executive Summary

### 1.1 Scope

Week 1-2 establishes the foundational infrastructure for the Architectural Knowledge Graph:

| Deliverable | Description |
|-------------|-------------|
| `graph.schema.ts` | Zod schemas for nodes, edges, and graph structure |
| `invariant.schema.ts` | Zod schemas for invariant definitions and violations |
| `config.schema.ts` | Zod schemas for AKG configuration |
| Directory structure | `src/tools/akg/` hierarchy |
| Package scripts | `akg:discover`, `akg:check` commands |
| Unit tests | Schema validation test suite |

### 1.2 Codebase Analysis Summary

| Layer | File Count | Estimated Nodes |
|-------|------------|-----------------|
| Routes | 7 | 14 (pages + layouts) |
| Components | 35 | 70 (files + exports) |
| Stores | 7 | 21 (files + exports × 3) |
| Services | 4 | 12 |
| Types | 6 | 30 (type exports) |
| Supabase | 5 | 10 |
| PartyKit | 11 | 22 |
| **Total** | **~75** | **~180-200** |

**Conclusion**: Well within JSON storage threshold (< 500 nodes).

---

## 2. Tooling Decisions

### 2.1 Primary Stack

| Tool | Purpose | Justification |
|------|---------|---------------|
| **ts-morph** | TypeScript AST analysis | Full Type Checker access, ergonomic API, semantic analysis |
| **svelte/compiler** | Svelte 5 parsing | Native `parse()` with `modern: true` for modern AST |
| **Zod** | Schema validation | Already in dependencies, runtime + compile-time safety |
| **Bun** | Script runtime | Fast startup, native TypeScript, already in mise config |

### 2.2 Why ts-morph Over Alternatives

| Criterion | ts-morph | TypeScript Compiler API | Oxc |
|-----------|----------|------------------------|-----|
| Semantic analysis | Full TypeChecker | Full TypeChecker | Partial (WIP) |
| Ease of use | High (wrapper API) | Low (verbose) | Medium |
| Performance | Adequate (~5-10s full scan) | Adequate | Extreme (overkill) |
| Zod type validation | Can verify types | Can verify types | Cannot |
| Use case fit | Perfect | Over-complex | Speed over semantics |

**Decision**: ts-morph provides the semantic analysis needed for invariant checking (e.g., verifying a variable is a Zod schema type) with an ergonomic API.

### 2.3 Svelte 5 Script Extraction Pattern

```typescript
import { parse } from 'svelte/compiler';
import { Project } from 'ts-morph';

export function extractSvelteScripts(code: string, filePath: string) {
  const ast = parse(code, { modern: true });

  return {
    instance: ast.instance?.content,   // <script>
    module: ast.module?.content,       // <script module>
    fragment: ast.fragment,            // Template (for component usage)
  };
}

// Feed to ts-morph as virtual source file
function addSvelteToProject(project: Project, svelteCode: string, path: string) {
  const { instance, module } = extractSvelteScripts(svelteCode, path);

  // Create virtual .ts files for type checking
  if (instance) {
    project.createSourceFile(
      `${path}.__instance__.ts`,
      instance,
      { overwrite: true }
    );
  }
  if (module) {
    project.createSourceFile(
      `${path}.__module__.ts`,
      module,
      { overwrite: true }
    );
  }
}
```

---

## 3. Schema Design

### 3.1 Graph Schema (`graph.schema.ts`)

```typescript
import { z } from 'zod';

// =============================================================================
// Node Types
// =============================================================================

/**
 * Node type taxonomy aligned with Dicee architecture
 */
export const NodeTypeSchema = z.enum([
  // File-level
  'Module',           // Generic .ts file
  'Component',        // .svelte file
  'SmartContainer',   // Component importing stores/services
  'Store',            // .svelte.ts store file
  'Service',          // Business logic module
  'Type',             // Type definition file
  'Route',            // SvelteKit route
  'Layout',           // SvelteKit layout

  // Package-level
  'WASMBridge',       // engine.ts
  'WASMModule',       // Generated WASM bindings
  'SupabaseModule',   // Supabase client/helpers
  'PartyKitServer',   // PartyKit server entry

  // Meta-level
  'Layer',            // Architectural layer (virtual node)
  'Package',          // Package boundary (web, partykit, engine)
]);

export type NodeType = z.infer<typeof NodeTypeSchema>;

/**
 * Confidence level for discovered information
 */
export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

/**
 * Metadata attached to all graph entities
 */
export const MetadataSchema = z.object({
  discoveredAt: z.string().datetime(),
  confidence: ConfidenceSchema,
  lastVerified: z.string().datetime().optional(),
  discoveryMethod: z.enum(['static_analysis', 'inference', 'manual']).optional(),
});

/**
 * Component classification for layer enforcement
 */
export const ComponentClassificationSchema = z.enum(['smart', 'dumb', 'unknown']);

/**
 * Node attributes (varies by node type)
 */
export const NodeAttributesSchema = z.object({
  // Common
  layer: z.string().optional(),          // Layer this node belongs to
  package: z.string().optional(),        // Package name

  // Component-specific
  classification: ComponentClassificationSchema.optional(),
  propsInterface: z.string().optional(), // Name of Props interface
  hasSlots: z.boolean().optional(),
  usesRunes: z.boolean().optional(),

  // Store-specific
  isExported: z.boolean().optional(),
  stateVariables: z.array(z.string()).optional(),
  derivedVariables: z.array(z.string()).optional(),

  // Export tracking
  exports: z.array(z.object({
    name: z.string(),
    kind: z.enum(['function', 'class', 'const', 'type', 'interface', 'default']),
    line: z.number(),
  })).optional(),

  // Source location
  startLine: z.number().optional(),
  endLine: z.number().optional(),

  // Content hash for incremental discovery
  contentHash: z.string().optional(),
}).passthrough(); // Allow additional attributes

/**
 * Graph node representing a code entity
 */
export const AKGNodeSchema = z.object({
  /** Unique identifier: {type}::{name}::{filepath_hash} */
  id: z.string(),

  /** Node type from taxonomy */
  type: NodeTypeSchema,

  /** Human-readable name */
  name: z.string(),

  /** Relative file path from project root */
  filePath: z.string().optional(),

  /** Node-specific attributes */
  attributes: NodeAttributesSchema,

  /** Discovery metadata */
  metadata: MetadataSchema,
});

export type AKGNode = z.infer<typeof AKGNodeSchema>;

// =============================================================================
// Edge Types
// =============================================================================

/**
 * Edge type taxonomy
 */
export const EdgeTypeSchema = z.enum([
  // Import relationships
  'imports',            // ES module import
  'imports_type',       // Type-only import
  'dynamic_imports',    // Dynamic import()

  // Component relationships
  'uses_component',     // <Component> in template
  'slots_into',         // Slot content relationship

  // Store relationships
  'subscribes_to',      // Store subscription
  'derives_from',       // $derived dependency

  // Service relationships
  'calls_service',      // Service method call
  'calls_wasm',         // WASM function call

  // Type relationships
  'implements',         // Interface implementation
  'extends',            // Class/interface extension
  'type_references',    // Type usage

  // Layer relationships
  'belongs_to',         // Node → Layer membership
  'allowed_import',     // Layer → Layer allowed dependency
  'forbidden_import',   // Layer → Layer forbidden dependency

  // Violation tracking
  'violates',           // Node → Invariant violation
]);

export type EdgeType = z.infer<typeof EdgeTypeSchema>;

/**
 * Evidence for an edge (how it was discovered)
 */
export const EdgeEvidenceSchema = z.object({
  filePath: z.string(),
  line: z.number(),
  column: z.number().optional(),
  snippet: z.string().optional(),
  importSpecifier: z.string().optional(),
});

/**
 * Edge attributes
 */
export const EdgeAttributesSchema = z.object({
  // Import-specific
  isTypeOnly: z.boolean().optional(),
  isDynamic: z.boolean().optional(),
  importedNames: z.array(z.string()).optional(),

  // Component usage
  componentProps: z.array(z.string()).optional(),

  // Violation-specific
  violationSeverity: z.enum(['error', 'warning', 'info']).optional(),
  violationMessage: z.string().optional(),
}).passthrough();

/**
 * Graph edge representing a relationship
 */
export const AKGEdgeSchema = z.object({
  /** Unique identifier */
  id: z.string(),

  /** Edge type from taxonomy */
  type: EdgeTypeSchema,

  /** Source node ID */
  sourceNodeId: z.string(),

  /** Target node ID */
  targetNodeId: z.string(),

  /** Edge-specific attributes */
  attributes: EdgeAttributesSchema,

  /** Evidence for this edge */
  evidence: z.array(EdgeEvidenceSchema),

  /** Discovery metadata */
  metadata: MetadataSchema,
});

export type AKGEdge = z.infer<typeof AKGEdgeSchema>;

// =============================================================================
// Graph Container
// =============================================================================

/**
 * Graph metadata
 */
export const GraphMetadataSchema = z.object({
  /** Total files analyzed */
  totalFiles: z.number(),

  /** Discovery duration in milliseconds */
  discoveryDurationMs: z.number(),

  /** Packages included */
  packages: z.array(z.string()).optional(),

  /** Git commit hash at discovery time */
  gitCommit: z.string().optional(),

  /** Branch name */
  gitBranch: z.string().optional(),

  /** Whether this was incremental discovery */
  incremental: z.boolean().optional(),

  /** Files changed (for incremental) */
  changedFiles: z.array(z.string()).optional(),
});

/**
 * Complete graph structure
 */
export const AKGGraphSchema = z.object({
  /** Schema version for migration */
  version: z.string(),

  /** When the graph was generated */
  generatedAt: z.string().datetime(),

  /** Project root path (absolute) */
  projectRoot: z.string(),

  /** All nodes in the graph */
  nodes: z.array(AKGNodeSchema),

  /** All edges in the graph */
  edges: z.array(AKGEdgeSchema),

  /** Graph-level metadata */
  metadata: GraphMetadataSchema,
});

export type AKGGraph = z.infer<typeof AKGGraphSchema>;

// =============================================================================
// Helper Types
// =============================================================================

/**
 * Node lookup map for O(1) access
 */
export type NodeMap = Map<string, AKGNode>;

/**
 * Adjacency list for graph traversal
 */
export type AdjacencyList = Map<string, { outgoing: AKGEdge[]; incoming: AKGEdge[] }>;

/**
 * Create empty graph
 */
export function createEmptyGraph(projectRoot: string): AKGGraph {
  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    projectRoot,
    nodes: [],
    edges: [],
    metadata: {
      totalFiles: 0,
      discoveryDurationMs: 0,
    },
  };
}

/**
 * Generate node ID
 */
export function generateNodeId(type: NodeType, name: string, filePath?: string): string {
  const pathPart = filePath ? `:${hashPath(filePath)}` : '';
  return `${type.toLowerCase()}::${name}${pathPart}`;
}

/**
 * Simple path hash for ID generation
 */
function hashPath(path: string): string {
  // Simple hash - replace with proper hash in implementation
  return path.replace(/[^a-zA-Z0-9]/g, '_').slice(-20);
}
```

### 3.2 Invariant Schema (`invariant.schema.ts`)

```typescript
import { z } from 'zod';

// =============================================================================
// Invariant Definition
// =============================================================================

/**
 * Severity levels matching Biome conventions
 */
export const SeveritySchema = z.enum(['error', 'warning', 'info']);

/**
 * Invariant category
 */
export const InvariantCategorySchema = z.enum([
  'structural',    // Code organization and dependencies
  'naming',        // Convention enforcement
  'domain',        // Business rule enforcement
  'security',      // Security constraints
  'performance',   // Performance constraints
]);

/**
 * Invariant definition
 */
export const InvariantDefinitionSchema = z.object({
  /** Unique invariant identifier (snake_case) */
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),

  /** Human-readable name */
  name: z.string(),

  /** Detailed description */
  description: z.string(),

  /** Invariant category */
  category: InvariantCategorySchema,

  /** Default severity (can be overridden in config) */
  severity: SeveritySchema,

  /** Business rule this enforces */
  businessRule: z.string(),

  /** Reference to documentation */
  docsUrl: z.string().url().optional(),

  /** Whether this invariant is enabled by default */
  enabledByDefault: z.boolean().default(true),

  /** File patterns to include */
  include: z.array(z.string()).optional(),

  /** File patterns to exclude */
  exclude: z.array(z.string()).optional(),

  /** Whether violations are auto-fixable */
  fixable: z.boolean().default(false),

  /** Metadata */
  meta: z.object({
    added: z.string(),          // Version added
    deprecated: z.string().optional(),
    replacedBy: z.string().optional(),
  }).optional(),
});

export type InvariantDefinition = z.infer<typeof InvariantDefinitionSchema>;

// =============================================================================
// Violation Schema
// =============================================================================

/**
 * Evidence for a violation
 */
export const ViolationEvidenceSchema = z.object({
  filePath: z.string(),
  line: z.number(),
  column: z.number().optional(),
  endLine: z.number().optional(),
  endColumn: z.number().optional(),
  snippet: z.string().optional(),
});

/**
 * Violation instance
 */
export const InvariantViolationSchema = z.object({
  /** Invariant that was violated */
  invariantId: z.string(),

  /** Invariant name for display */
  invariantName: z.string(),

  /** Severity of this violation */
  severity: SeveritySchema,

  /** Human-readable message */
  message: z.string(),

  /** Suggestion for fixing */
  suggestion: z.string().optional(),

  /** Source node that caused violation */
  sourceNode: z.string(),

  /** Target node involved (if applicable) */
  targetNode: z.string().optional(),

  /** Evidence locations */
  evidence: z.array(ViolationEvidenceSchema),

  /** Business rule violated */
  businessRule: z.string().optional(),

  /** Additional context */
  context: z.record(z.unknown()).optional(),
});

export type InvariantViolation = z.infer<typeof InvariantViolationSchema>;

// =============================================================================
// Check Result Schema
// =============================================================================

/**
 * Result of running invariant checks
 */
export const InvariantCheckResultSchema = z.object({
  /** Invariant that was checked */
  invariantId: z.string(),

  /** Whether the invariant passed */
  passed: z.boolean(),

  /** Violations found (empty if passed) */
  violations: z.array(InvariantViolationSchema),

  /** Time taken to check in ms */
  durationMs: z.number(),

  /** Nodes checked */
  nodesChecked: z.number(),

  /** Edges checked */
  edgesChecked: z.number(),
});

export type InvariantCheckResult = z.infer<typeof InvariantCheckResultSchema>;

/**
 * Summary of all invariant checks
 */
export const CheckSummarySchema = z.object({
  /** When the check was run */
  timestamp: z.string().datetime(),

  /** Total time in ms */
  totalDurationMs: z.number(),

  /** Graph version used */
  graphVersion: z.string(),

  /** Results per invariant */
  results: z.array(InvariantCheckResultSchema),

  /** Aggregated counts */
  summary: z.object({
    totalInvariants: z.number(),
    passed: z.number(),
    failed: z.number(),
    errors: z.number(),
    warnings: z.number(),
    infos: z.number(),
  }),

  /** Exit code recommendation */
  exitCode: z.enum(['success', 'warnings', 'errors']),
});

export type CheckSummary = z.infer<typeof CheckSummarySchema>;

// =============================================================================
// Invariant Check Function Type
// =============================================================================

import type { AKGGraph, AKGNode, AKGEdge } from './graph.schema';

/**
 * Query engine interface (simplified)
 */
export interface AKGQueryEngine {
  getNode(id: string): AKGNode | undefined;
  getNodes(filter?: (n: AKGNode) => boolean): AKGNode[];
  getEdges(filter?: (e: AKGEdge) => boolean): AKGEdge[];
  getOutgoing(nodeId: string): AKGEdge[];
  getIncoming(nodeId: string): AKGEdge[];
  findCycles(): string[][];
  findPath(from: string, to: string): string[] | null;
}

/**
 * Invariant check function signature
 */
export type InvariantCheckFn = (
  graph: AKGGraph,
  engine: AKGQueryEngine,
) => InvariantViolation[];
```

### 3.3 Config Schema (`config.schema.ts`)

```typescript
import { z } from 'zod';
import { SeveritySchema } from './invariant.schema';

/**
 * Layer definition for architecture enforcement
 */
export const LayerDefinitionSchema = z.object({
  /** Layer name */
  name: z.string(),

  /** Glob patterns for files in this layer */
  paths: z.array(z.string()),

  /** Description */
  description: z.string().optional(),

  /** Layers this layer may import from */
  mayImport: z.array(z.string()).optional(),

  /** Layers this layer must not import from */
  mayNotImport: z.array(z.string()).optional(),

  /** Special handling notes */
  notes: z.string().optional(),
});

/**
 * Invariant override in config
 */
export const InvariantOverrideSchema = z.object({
  /** Invariant ID to override */
  id: z.string(),

  /** Override severity */
  severity: SeveritySchema.optional(),

  /** Disable entirely */
  enabled: z.boolean().optional(),

  /** Additional exclude patterns */
  exclude: z.array(z.string()).optional(),
});

/**
 * AKG configuration file schema
 */
export const AKGConfigSchema = z.object({
  /** Config version */
  version: z.string().default('1.0.0'),

  /** Project name */
  project: z.string(),

  // Discovery settings
  discovery: z.object({
    /** File patterns to include */
    include: z.array(z.string()).default([
      'packages/web/src/**/*.ts',
      'packages/web/src/**/*.svelte',
      'packages/partykit/src/**/*.ts',
    ]),

    /** File patterns to exclude */
    exclude: z.array(z.string()).default([
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/__mocks__/**',
      '**/node_modules/**',
    ]),

    /** TypeScript config path */
    tsconfig: z.string().default('packages/web/tsconfig.json'),
  }).optional(),

  // Layer definitions
  layers: z.array(LayerDefinitionSchema).optional(),

  // Invariant configuration
  invariants: z.object({
    /** Invariants to enable (if not enabledByDefault) */
    enable: z.array(z.string()).optional(),

    /** Invariants to disable */
    disable: z.array(z.string()).optional(),

    /** Per-invariant overrides */
    overrides: z.array(InvariantOverrideSchema).optional(),
  }).optional(),

  // Output settings
  output: z.object({
    /** Graph output path */
    graphPath: z.string().default('docs/architecture/akg/graph/current.json'),

    /** Enable history snapshots */
    history: z.boolean().default(true),

    /** History directory */
    historyPath: z.string().default('docs/architecture/akg/graph/history'),
  }).optional(),

  // CI settings
  ci: z.object({
    /** Fail on error-severity violations */
    failOnError: z.boolean().default(true),

    /** Fail on warning-severity violations */
    failOnWarning: z.boolean().default(false),

    /** Generate SARIF output for GitHub */
    sarif: z.boolean().default(false),
  }).optional(),
});

export type AKGConfig = z.infer<typeof AKGConfigSchema>;

/**
 * Default configuration
 */
export const defaultConfig: AKGConfig = {
  version: '1.0.0',
  project: 'dicee',
  discovery: {
    include: [
      'packages/web/src/**/*.ts',
      'packages/web/src/**/*.svelte',
      'packages/partykit/src/**/*.ts',
    ],
    exclude: [
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/__tests__/**',
      '**/__mocks__/**',
      '**/node_modules/**',
    ],
    tsconfig: 'packages/web/tsconfig.json',
  },
  layers: [
    {
      name: 'routes',
      paths: ['packages/web/src/routes/**'],
      mayImport: ['components', 'stores', 'services', 'types', 'lib'],
    },
    {
      name: 'components',
      paths: ['packages/web/src/lib/components/**'],
      mayImport: ['components', 'types', 'utils'],
      mayNotImport: ['stores', 'services'],
      notes: 'Smart containers may import stores',
    },
    {
      name: 'stores',
      paths: ['packages/web/src/lib/stores/**'],
      mayImport: ['services', 'types', 'supabase'],
      mayNotImport: ['components', 'routes'],
    },
    {
      name: 'services',
      paths: ['packages/web/src/lib/services/**'],
      mayImport: ['types', 'supabase', 'wasm'],
      mayNotImport: ['components', 'routes', 'stores'],
    },
    {
      name: 'types',
      paths: ['packages/web/src/lib/types/**', 'packages/web/src/lib/types.ts'],
      mayImport: ['types'],
    },
    {
      name: 'wasm',
      paths: ['packages/web/src/lib/wasm/**', 'packages/web/src/lib/engine.ts'],
      mayImport: ['types'],
      notes: 'Only engine.ts should be imported by other modules',
    },
  ],
  output: {
    graphPath: 'docs/architecture/akg/graph/current.json',
    history: true,
    historyPath: 'docs/architecture/akg/graph/history',
  },
  ci: {
    failOnError: true,
    failOnWarning: false,
    sarif: false,
  },
};
```

---

## 4. Directory Structure

### 4.1 Implementation Structure

```
packages/web/
└── src/
    └── tools/
        └── akg/
            ├── index.ts                    # Public API exports
            ├── schema/
            │   ├── index.ts                # Schema exports
            │   ├── graph.schema.ts         # Graph node/edge schemas
            │   ├── invariant.schema.ts     # Invariant definition schemas
            │   └── config.schema.ts        # Configuration schema
            ├── discovery/
            │   ├── index.ts                # Discovery engine exports
            │   ├── project.ts              # ts-morph project setup
            │   ├── svelte-parser.ts        # Svelte 5 script extraction
            │   ├── node-factory.ts         # Node creation utilities
            │   ├── edge-factory.ts         # Edge creation utilities
            │   ├── import-analyzer.ts      # Import relationship extraction
            │   ├── component-analyzer.ts   # Component template analysis
            │   ├── layer-classifier.ts     # Layer classification
            │   └── incremental.ts          # Incremental discovery logic
            ├── query/
            │   ├── index.ts                # Query engine exports
            │   ├── engine.ts               # AKGQueryEngine implementation
            │   ├── traversal.ts            # Graph traversal utilities
            │   └── cycles.ts               # Cycle detection (Tarjan's)
            ├── invariants/
            │   ├── index.ts                # Invariant registry
            │   ├── registry.ts             # Invariant registration
            │   ├── runner.ts               # Invariant execution
            │   └── definitions/
            │       ├── wasm-single-entry.ts
            │       ├── store-no-circular-deps.ts
            │       ├── service-layer-boundaries.ts
            │       ├── layer-component-isolation.ts
            │       └── category-type-consistency.ts
            └── cli/
                ├── discover.ts             # akg:discover command
                ├── check.ts                # akg:check command
                ├── report.ts               # Report generation
                └── utils.ts                # CLI utilities

docs/architecture/akg/
├── PRE_AKG_PLANNING.md                     # Phase -1 (complete)
├── WEEK_1_2_SCHEMA_INFRASTRUCTURE.md       # This document
├── graph/
│   ├── current.json                        # Latest discovery
│   ├── history/                            # Rolling snapshots
│   │   └── .gitkeep
│   └── milestones/                         # Phase snapshots
│       └── .gitkeep
├── invariants/
│   └── definitions.yaml                    # Machine-readable catalog
└── simulations/
    └── (5 simulation documents)
```

### 4.2 Package Dependencies (to add)

```json
{
  "devDependencies": {
    "ts-morph": "^24.0.0",
    "glob": "^11.0.0"
  }
}
```

**Note**: `svelte/compiler` is already available via the `svelte` dependency.

---

## 5. Storage Strategy

### 5.1 File-Based Storage (Phase 1)

Based on Decision 3 from PRE_AKG_PLANNING.md:

| Aspect | Implementation |
|--------|----------------|
| Format | JSON (human-readable, git-trackable) |
| Location | `docs/architecture/akg/graph/current.json` |
| Size limit | ~500 nodes before migration |
| Query time | < 200ms before migration |

### 5.2 JSON Structure

```json
{
  "version": "1.0.0",
  "generatedAt": "2025-12-05T12:00:00.000Z",
  "projectRoot": "/workspace/dicee",
  "nodes": [
    {
      "id": "component::Die::components_dice_Die_svelte",
      "type": "Component",
      "name": "Die",
      "filePath": "packages/web/src/lib/components/dice/Die.svelte",
      "attributes": {
        "layer": "components",
        "classification": "dumb",
        "usesRunes": true
      },
      "metadata": {
        "discoveredAt": "2025-12-05T12:00:00.000Z",
        "confidence": "high"
      }
    }
  ],
  "edges": [
    {
      "id": "imports::DiceTray::Die",
      "type": "imports",
      "sourceNodeId": "component::DiceTray::...",
      "targetNodeId": "component::Die::...",
      "attributes": {
        "importedNames": ["Die"]
      },
      "evidence": [
        {
          "filePath": "packages/web/src/lib/components/dice/DiceTray.svelte",
          "line": 5,
          "snippet": "import Die from './Die.svelte';"
        }
      ],
      "metadata": {
        "discoveredAt": "2025-12-05T12:00:00.000Z",
        "confidence": "high"
      }
    }
  ],
  "metadata": {
    "totalFiles": 75,
    "discoveryDurationMs": 4523,
    "packages": ["@dicee/web", "@dicee/partykit"]
  }
}
```

### 5.3 Incremental Discovery Cache

```
.claude/state/
└── akg-cache.json    # File content hashes for incremental
```

```json
{
  "lastFullDiscovery": "2025-12-05T12:00:00.000Z",
  "fileHashes": {
    "packages/web/src/lib/components/dice/Die.svelte": "sha256:abc123...",
    "packages/web/src/lib/stores/game.svelte.ts": "sha256:def456..."
  }
}
```

---

## 6. Implementation Plan

### Week 1: Schema & Infrastructure (Days 1-5)

#### Day 1: Project Setup
- [ ] Create `src/tools/akg/` directory structure
- [ ] Add `ts-morph` to devDependencies
- [ ] Create `index.ts` with placeholder exports
- [ ] Add `akg:discover` and `akg:check` to package.json (no-op stubs)

#### Day 2: Graph Schema
- [ ] Implement `graph.schema.ts` with Zod schemas
- [ ] Write unit tests for schema validation
- [ ] Create `createEmptyGraph()` and `generateNodeId()` utilities
- [ ] Test schema with sample data

#### Day 3: Invariant Schema
- [ ] Implement `invariant.schema.ts`
- [ ] Write unit tests for violation schemas
- [ ] Create type exports
- [ ] Document invariant check function signature

#### Day 4: Config Schema
- [ ] Implement `config.schema.ts`
- [ ] Create `akg.config.ts` at project root
- [ ] Write config loading utility
- [ ] Test config validation

#### Day 5: Integration & Documentation
- [ ] Create graph output directory structure
- [ ] Implement basic JSON serialization/deserialization
- [ ] Write schema documentation (JSDoc)
- [ ] Integration test: load config, create empty graph, serialize

### Week 2: Discovery Foundation (Days 6-10)

#### Day 6: ts-morph Project Setup
- [ ] Implement `discovery/project.ts`
- [ ] Load tsconfig.json
- [ ] Add TypeScript files to project
- [ ] Test: can analyze a simple .ts file

#### Day 7: Svelte Parser
- [ ] Implement `discovery/svelte-parser.ts`
- [ ] Extract `<script>` and `<script module>` blocks
- [ ] Create virtual source files for ts-morph
- [ ] Test: parse Die.svelte, extract imports

#### Day 8: Node Factory
- [ ] Implement `discovery/node-factory.ts`
- [ ] Create nodes for: Module, Component, Store, Service
- [ ] Implement layer classification logic
- [ ] Test: create nodes for sample files

#### Day 9: Edge Factory
- [ ] Implement `discovery/edge-factory.ts`
- [ ] Implement `discovery/import-analyzer.ts`
- [ ] Extract import relationships
- [ ] Test: detect imports from game.svelte.ts

#### Day 10: First Discovery Run
- [ ] Implement `cli/discover.ts` with full discovery
- [ ] Run discovery on entire codebase
- [ ] Output to `graph/current.json`
- [ ] Validate output against schema
- [ ] Document any issues found

---

## 7. Test Strategy

### 7.1 Test Structure

```
packages/web/src/tools/akg/
├── __tests__/
│   ├── schema/
│   │   ├── graph.schema.test.ts
│   │   ├── invariant.schema.test.ts
│   │   └── config.schema.test.ts
│   ├── discovery/
│   │   ├── svelte-parser.test.ts
│   │   ├── import-analyzer.test.ts
│   │   └── node-factory.test.ts
│   └── fixtures/
│       ├── simple-component.svelte
│       ├── smart-container.svelte
│       ├── store-with-imports.ts
│       └── expected-graph.json
```

### 7.2 Test Categories

| Category | Count | Purpose |
|----------|-------|---------|
| Schema validation | 15+ | Verify Zod schemas accept valid, reject invalid |
| Node creation | 10+ | Test node factory for each type |
| Edge detection | 10+ | Test import extraction accuracy |
| Svelte parsing | 5+ | Test script extraction from .svelte |
| Integration | 5+ | End-to-end discovery tests |

### 7.3 Sample Test Cases

```typescript
// graph.schema.test.ts
describe('AKGNodeSchema', () => {
  it('accepts valid component node', () => {
    const node = {
      id: 'component::Die::abc123',
      type: 'Component',
      name: 'Die',
      filePath: 'packages/web/src/lib/components/dice/Die.svelte',
      attributes: { layer: 'components', classification: 'dumb' },
      metadata: { discoveredAt: new Date().toISOString(), confidence: 'high' },
    };

    expect(() => AKGNodeSchema.parse(node)).not.toThrow();
  });

  it('rejects node with invalid type', () => {
    const node = { ...validNode, type: 'InvalidType' };
    expect(() => AKGNodeSchema.parse(node)).toThrow();
  });

  it('rejects node without required fields', () => {
    const node = { id: 'test' };
    expect(() => AKGNodeSchema.parse(node)).toThrow();
  });
});

// svelte-parser.test.ts
describe('extractSvelteScripts', () => {
  it('extracts instance script from Svelte 5 component', () => {
    const code = `
      <script lang="ts">
        let count = $state(0);
      </script>
      <button onclick={() => count++}>{count}</button>
    `;

    const { instance, module } = extractSvelteScripts(code, 'test.svelte');

    expect(instance).toContain('$state(0)');
    expect(module).toBeUndefined();
  });

  it('extracts both scripts when present', () => {
    const code = `
      <script module>
        export const metadata = {};
      </script>
      <script lang="ts">
        let x = 1;
      </script>
    `;

    const { instance, module } = extractSvelteScripts(code, 'test.svelte');

    expect(module).toContain('export const metadata');
    expect(instance).toContain('let x = 1');
  });
});
```

---

## 8. Success Criteria

### Week 1 Exit Criteria

| Criterion | Metric |
|-----------|--------|
| Schema tests passing | 100% of schema tests pass |
| Schema coverage | All node types, edge types, attributes defined |
| Config loading | Can load and validate akg.config.ts |
| Documentation | JSDoc on all public exports |
| Integration | Empty graph can be created and serialized |

### Week 2 Exit Criteria

| Criterion | Metric |
|-----------|--------|
| Discovery runs | `pnpm akg:discover` completes without error |
| Node coverage | All 75+ files represented as nodes |
| Edge coverage | Import relationships detected |
| Output valid | `current.json` passes schema validation |
| Performance | Full discovery < 10 seconds |

### Quality Gates

Before proceeding to Week 3-4 (Query Engine & Invariants):

```bash
# All must pass
pnpm test -- --filter=akg          # Schema tests
pnpm akg:discover                   # Discovery runs
cat docs/architecture/akg/graph/current.json | jq '.nodes | length'  # > 50 nodes
cat docs/architecture/akg/graph/current.json | jq '.edges | length'  # > 100 edges
```

---

## Appendix A: Sample Config File

```typescript
// akg.config.ts (project root)
import type { AKGConfig } from './packages/web/src/tools/akg/schema/config.schema';

const config: AKGConfig = {
  version: '1.0.0',
  project: 'dicee',

  discovery: {
    include: [
      'packages/web/src/**/*.ts',
      'packages/web/src/**/*.svelte',
      'packages/partykit/src/**/*.ts',
    ],
    exclude: [
      '**/*.test.ts',
      '**/__tests__/**',
      '**/__mocks__/**',
    ],
    tsconfig: 'packages/web/tsconfig.json',
  },

  layers: [
    { name: 'routes', paths: ['packages/web/src/routes/**'], mayImport: ['components', 'stores', 'services', 'types'] },
    { name: 'components', paths: ['packages/web/src/lib/components/**'], mayImport: ['components', 'types'], mayNotImport: ['stores', 'services'] },
    { name: 'stores', paths: ['packages/web/src/lib/stores/**'], mayImport: ['services', 'types'], mayNotImport: ['components', 'routes'] },
    { name: 'services', paths: ['packages/web/src/lib/services/**'], mayImport: ['types', 'wasm'], mayNotImport: ['components', 'stores', 'routes'] },
    { name: 'types', paths: ['packages/web/src/lib/types/**'], mayImport: ['types'] },
    { name: 'wasm', paths: ['packages/web/src/lib/wasm/**', 'packages/web/src/lib/engine.ts'], mayImport: ['types'] },
  ],

  invariants: {
    disable: ['boolean_prop_naming'], // Too noisy initially
    overrides: [
      { id: 'layer_component_isolation', severity: 'warning' }, // Start as warning
    ],
  },

  output: {
    graphPath: 'docs/architecture/akg/graph/current.json',
    history: true,
    historyPath: 'docs/architecture/akg/graph/history',
  },

  ci: {
    failOnError: true,
    failOnWarning: false,
  },
};

export default config;
```

---

## Appendix B: Package.json Script Additions

```json
{
  "scripts": {
    "akg:discover": "bun run packages/web/src/tools/akg/cli/discover.ts",
    "akg:check": "bun run packages/web/src/tools/akg/cli/check.ts",
    "akg:report": "bun run packages/web/src/tools/akg/cli/report.ts"
  }
}
```

---

## Appendix C: Research Sources

### TypeScript AST Tooling
- [ts-morph Documentation](https://ts-morph.com/)
- [ts-morph GitHub](https://github.com/dsherret/ts-morph)
- [ts-morph Performance Guide](https://ts-morph.com/manipulation/performance)

### Svelte 5 Compiler
- [svelte/compiler Docs](https://svelte.dev/docs/svelte/svelte-compiler)
- [Svelte ESLint Parser](https://www.npmjs.com/package/svelte-eslint-parser)

### Graph Schema References
- [dependency-cruiser Output Format](https://github.com/sverweij/dependency-cruiser/blob/main/doc/output-format.md)
- [Nx Project Graph](https://nx.dev/extending-nx/recipes/project-graph-plugins)

### Performance Benchmarks
- [Oxc Parser Benchmarks](https://github.com/oxc-project/bench-javascript-parser-written-in-rust)
- [TypeScript Parser Comparison](https://medium.com/@hchan_nvim/benchmark-typescript-parsers-demystify-rust-tooling-performance-025ebfd391a3)

---

**Document Status**: Planning Complete

**Next Action**: Human approval to begin Week 1 implementation.
