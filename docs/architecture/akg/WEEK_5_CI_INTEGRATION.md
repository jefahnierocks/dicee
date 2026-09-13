# AKG Week 5: CI Integration & Documentation

> **Version**: 1.0.0
> **Created**: 2025-12-06
> **Status**: Complete
> **Prerequisites**: Week 1-4 complete (Schema, Discovery, Query, Invariants, SARIF)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [GitHub Actions Integration](#2-github-actions-integration)
3. [Incremental Discovery](#3-incremental-discovery)
4. [Invariant Authoring Guide](#4-invariant-authoring-guide)
5. [Implementation Plan](#5-implementation-plan)
6. [Success Criteria](#6-success-criteria)

---

## 1. Executive Summary

### 1.1 Week 5 Scope

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| GitHub Actions Job | AKG checks in CI with SARIF upload | High |
| Code Scanning Integration | Violations appear in PR annotations | High |
| Incremental Discovery | Only discover changed files | Medium |
| Authoring Guide | Documentation for custom invariants | Medium |

### 1.2 Current State (Week 4 Complete)

- 138 nodes, 230 edges discovered
- 6 invariants defined (5 enabled)
- SARIF 2.1.0 output working
- Quality gate integration complete
- All 1,099 tests passing

---

## 2. GitHub Actions Integration

### 2.1 Architecture

```
CI Pipeline
├── rust (Rust tests)
├── wasm (WASM build) ← depends on rust
├── web (Web build & test) ← depends on wasm
└── akg (Architecture checks) ← depends on web
    ├── Discover graph
    ├── Run invariant checks
    ├── Generate SARIF
    └── Upload to Code Scanning
```

### 2.2 AKG Job Configuration

```yaml
akg:
  name: Architecture Checks
  runs-on: ubuntu-latest
  needs: web
  permissions:
    contents: read
    security-events: write  # Required for SARIF upload
  steps:
    - uses: actions/checkout@<full-commit-sha>

    - name: Setup pnpm
      uses: pnpm/action-setup@<full-commit-sha>
      with:
        version: 10

    - name: Setup Node
      uses: actions/setup-node@<full-commit-sha>
      with:
        node-version: 24
        cache: pnpm

    - name: Install dependencies
      run: pnpm install

    - name: Discover architecture graph
      run: pnpm akg:discover

    - name: Run architecture checks
      run: pnpm akg:check --sarif > akg-results.sarif
      continue-on-error: true

    - name: Upload SARIF to Code Scanning
      uses: github/codeql-action/upload-sarif@<full-commit-sha>
      with:
        sarif_file: akg-results.sarif
        category: architecture
```

### 2.3 SARIF Upload Requirements

GitHub Code Scanning requires:
- `security-events: write` permission
- Valid SARIF 2.1.0 format
- Results < 5000 per run
- File paths relative to repository root

### 2.4 PR Annotations

When violations are found:
1. SARIF uploaded to Code Scanning
2. Annotations appear on PR diff
3. Violations linked to exact lines
4. Severity shown (error/warning)

---

## 3. Incremental Discovery

### 3.1 Motivation

Full discovery takes ~2-3 seconds for 138 nodes. For PRs, we only need to:
1. Discover files changed in the PR
2. Update affected edges
3. Re-run invariants on changed subgraph

### 3.2 Implementation Strategy

```typescript
interface IncrementalDiscoveryOptions {
  /** Base graph to update */
  baseGraph: AKGGraph;
  /** Files that changed (added, modified, deleted) */
  changedFiles: string[];
  /** Only check invariants for affected nodes */
  scopeToChanged?: boolean;
}

async function discoverIncremental(
  config: AKGConfig,
  options: IncrementalDiscoveryOptions
): Promise<AKGGraph> {
  // 1. Load base graph
  // 2. Remove nodes for deleted files
  // 3. Re-discover changed files
  // 4. Update edges for affected imports
  // 5. Return updated graph
}
```

### 3.3 Git Diff Integration

```bash
# Get changed files in PR
git diff --name-only origin/main...HEAD -- 'packages/web/src/**/*.ts' 'packages/web/src/**/*.svelte'
```

### 3.4 CLI Flag

```bash
# Full discovery (default)
pnpm akg:discover

# Incremental from base branch
pnpm akg:discover --incremental --base origin/main
```

---

## 4. Invariant Authoring Guide

### 4.1 Structure

Location: `docs/architecture/akg/AUTHORING_INVARIANTS.md`

Contents:
1. Overview of invariant system
2. Anatomy of an invariant
3. Step-by-step guide
4. Testing invariants
5. Best practices
6. Examples

### 4.2 Invariant Anatomy

```typescript
import { defineInvariant } from '../registry.js';
import { createViolation } from '../../schema/invariant.schema.js';

defineInvariant(
  {
    // Metadata
    id: 'my_custom_invariant',
    name: 'My Custom Invariant',
    description: 'What this invariant enforces',
    category: 'structural' | 'naming' | 'dependency' | 'custom',
    severity: 'error' | 'warning' | 'info',
    businessRule: 'Why this rule exists',
    enabledByDefault: true,

    // Optional
    include: ['**/*.ts'],  // Glob patterns to include
    exclude: ['**/*.test.ts'],  // Glob patterns to exclude
    meta: { added: '1.0.0' },
  },
  (graph, engine) => {
    const violations = [];

    // Query the graph
    const nodes = engine.getNodes(n => /* filter */);

    // Check conditions
    for (const node of nodes) {
      if (/* violation condition */) {
        violations.push(createViolation(
          'my_custom_invariant',
          'My Custom Invariant',
          'Violation message',
          node.id,
          'error',
        ));
      }
    }

    return violations;
  }
);
```

### 4.3 Query Engine API

```typescript
interface AKGQueryEngine {
  // Node queries
  getNode(id: string): AKGNode | undefined;
  getNodes(filter: (n: AKGNode) => boolean): AKGNode[];
  getNodesByType(type: NodeType): AKGNode[];
  getNodesByLayer(layer: string): AKGNode[];

  // Edge queries
  getEdge(id: string): AKGEdge | undefined;
  getEdges(filter: (e: AKGEdge) => boolean): AKGEdge[];
  getOutgoing(nodeId: string): AKGEdge[];
  getIncoming(nodeId: string): AKGEdge[];

  // Traversal
  findPath(from: string, to: string): string[] | null;
  findCycles(): string[][];
  getReachable(nodeId: string): Set<string>;
}
```

---

## 5. Implementation Plan

### Day 1: GitHub Actions Integration

- [x] Create planning document
- [x] Add AKG job to `.github/workflows/ci.yml`
- [x] Configure SARIF upload to Code Scanning
- [x] Add error handling for violations

### Day 2: Incremental Discovery

- [x] Add `--incremental` flag to discover CLI
- [x] Add `--base` flag for base branch
- [x] Implement `getChangedFiles()` function
- [x] Implement `filterToChangedFiles()` function

### Day 3: Authoring Guide

- [x] Create `AUTHORING_INVARIANTS.md`
- [x] Document query engine API
- [x] Add example invariants (naming, dependency, cycle)
- [x] Include best practices section

### Day 4: Polish & Commit

- [x] All tests passing (1099)
- [x] TypeScript check clean
- [x] Update state files
- [x] Commit and push

### Bonus: Watch Mode (Day 5)

- [x] Add `--watch, -w` flag to discover CLI
- [x] Implement file watcher with 300ms debounce
- [x] Add `--check` flag for running invariants after discovery
- [x] Support SIGINT graceful shutdown

---

## 6. Watch Mode

### 6.1 Usage

```bash
# Basic watch mode
pnpm akg:discover --watch

# Watch with verbose output
pnpm akg:discover --watch --verbose

# Watch with invariant checks
pnpm akg:discover --watch --check

# Combined with other options
pnpm akg:discover --watch --check --verbose
```

### 6.2 Features

- **Debounced re-runs**: 300ms debounce to avoid rapid re-runs
- **Selective watching**: Only watches directories from config include patterns
- **File filtering**: Only triggers on `.ts` and `.svelte` files
- **Test exclusion**: Ignores `__tests__` directories and `node_modules`
- **Graceful shutdown**: Ctrl+C properly cleans up watchers
- **Optional checks**: `--check` flag runs invariants after each discovery

---

## 7. Success Criteria

### Week 5 Exit Criteria

| Criterion | Metric |
|-----------|--------|
| CI Integration | AKG job runs on every PR |
| SARIF Upload | Violations appear in Code Scanning |
| Incremental | PR discovery < 500ms for typical changes |
| Documentation | Authoring guide complete |
| Tests | All existing tests still pass |

### Verification Commands

```bash
# Local CI test
act -j akg

# Check SARIF validity
pnpm akg:check --sarif | jq .

# Incremental discovery (after implementation)
pnpm akg:discover --incremental --base origin/main

# Full test suite
pnpm test
```

---

**Document Status**: Complete

**Completed**: All Week 5 deliverables implemented
