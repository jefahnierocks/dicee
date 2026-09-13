# AKG Week 4: Visualization & Reporting

> **Version**: 1.0.0
> **Created**: 2025-12-06
> **Status**: Implementation
> **Prerequisites**: Week 1-3 complete (Schema, Discovery, Query Engine, Invariants)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [SARIF Output](#2-sarif-output)
3. [Quality Gate Integration](#3-quality-gate-integration)
4. [Config Fixes](#4-config-fixes)
5. [Additional Invariants](#5-additional-invariants)
6. [Implementation Plan](#6-implementation-plan)
7. [Success Criteria](#7-success-criteria)

---

## 1. Executive Summary

### 1.1 Week 4 Scope

| Deliverable | Description | Priority |
|-------------|-------------|----------|
| SARIF Output | GitHub code scanning integration | High |
| Quality Gate Integration | `akg:check` in pre-commit workflow | High |
| Config Fix | Remove unused `lib`/`utils` layer references | Medium |
| `callback_prop_naming` | Invariant for onVerb pattern | Medium |
| `store_file_naming` | Invariant for .svelte.ts extension | Medium |

### 1.2 Current State (Week 3 Complete)

- 136 nodes, 227 edges discovered
- 4 invariants passing:
  - `wasm_single_entry`
  - `store_no_circular_deps`
  - `layer_component_isolation`
  - `service_layer_boundaries`
- CLI: `pnpm akg:check` with `--json`, `--verbose`, `--only`, `--skip`

---

## 2. SARIF Output

### 2.1 SARIF Overview

SARIF (Static Analysis Results Interchange Format) is the standard for static analysis tools used by GitHub Code Scanning, VS Code, and other tools.

**SARIF Version**: 2.1.0 (latest stable)

### 2.2 SARIF Schema Mapping

| AKG Concept | SARIF Concept |
|-------------|---------------|
| Invariant Definition | `tool.driver.rules[]` |
| Violation | `runs[].results[]` |
| Severity (error) | `level: "error"` |
| Severity (warning) | `level: "warning"` |
| Severity (info) | `level: "note"` |
| Evidence | `locations[]` |
| File Path | `artifactLocation.uri` |
| Line/Column | `region.startLine/startColumn` |

### 2.3 SARIF Output Structure

```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [{
    "tool": {
      "driver": {
        "name": "AKG",
        "version": "1.0.0",
        "informationUri": "https://github.com/dicee/docs/architecture/akg",
        "rules": [
          {
            "id": "wasm_single_entry",
            "name": "WASM Single Entry Point",
            "shortDescription": { "text": "Only engine.ts may import WASM" },
            "fullDescription": { "text": "..." },
            "defaultConfiguration": { "level": "error" },
            "helpUri": "docs/architecture/akg/invariants/wasm_single_entry.md"
          }
        ]
      }
    },
    "results": [
      {
        "ruleId": "wasm_single_entry",
        "level": "error",
        "message": { "text": "Direct WASM import not allowed" },
        "locations": [{
          "physicalLocation": {
            "artifactLocation": {
              "uri": "packages/web/src/lib/components/ScorePreview.svelte"
            },
            "region": {
              "startLine": 5,
              "startColumn": 1
            }
          }
        }]
      }
    ]
  }]
}
```

### 2.4 Implementation

**New file**: `packages/web/src/tools/akg/output/sarif.ts`

```typescript
export interface SarifOptions {
  toolVersion?: string;
  informationUri?: string;
}

export function toSarif(summary: CheckSummary, options?: SarifOptions): SarifLog {
  // Convert CheckSummary to SARIF format
}
```

**CLI update**: `check.ts` gains `--sarif` flag

```bash
pnpm akg:check --sarif > akg-results.sarif
```

---

## 3. Quality Gate Integration

### 3.1 Current Quality Gate

Location: `scripts/quality-gate.sh`

Current sequence:
1. TypeScript check (`pnpm check`)
2. Biome lint (`pnpm lint`)
3. Tests (`pnpm test`)
4. Secrets scan (`infisical scan`)
5. Build (`pnpm build`)

### 3.2 Updated Sequence

Add AKG after TypeScript (step 2):

```bash
# 2. AKG Check
echo "→ Running AKG invariant check..."
if ! pnpm akg:check; then
  echo "⚠️  AKG found violations"
  # Check if any are errors (blocking)
  pnpm akg:check --json 2>/dev/null | jq -e '.exitCode == "errors"' > /dev/null && {
    echo "❌ AKG check failed with errors"
    exit 1
  }
  echo "⚠️  Continuing with warnings only"
fi
```

### 3.3 CI Integration (Optional)

For GitHub Actions (future):

```yaml
- name: AKG Check
  run: |
    pnpm akg:discover
    pnpm akg:check --sarif > akg.sarif

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@<full-commit-sha>
  with:
    sarif_file: akg.sarif
```

---

## 4. Config Fixes

### 4.1 Issue: Layer Mismatch

Current `akg.config.ts` references layers that don't match discovery:
- `lib` - not used in discovery
- `utils` - not used in discovery

### 4.2 Fix

Update layer definitions to match actual code structure:

```typescript
// akg.config.ts
layers: [
  // ... keep existing layers

  // Remove references to 'lib' and 'utils' in mayImport
  {
    name: 'routes',
    paths: ['packages/web/src/routes/**'],
    mayImport: ['components', 'stores', 'services', 'types'], // Remove 'lib'
  },
  {
    name: 'components',
    paths: ['packages/web/src/lib/components/**'],
    mayImport: ['components', 'types'], // Remove 'utils'
    mayNotImport: ['stores', 'services'],
  },
]
```

---

## 5. Additional Invariants

### 5.1 `callback_prop_naming`

**Rule**: Component callback props must use `onVerb` pattern (camelCase)

**Category**: `naming`

**Severity**: `warning`

**Detection**:
- Find Svelte components
- Extract props interface
- Check callback-looking props (`Function`, `() => void`)
- Verify naming matches `on[A-Z]` pattern

**Examples**:
```typescript
// ✅ Good
onRoll: () => void
onScore: (category: string) => void

// ❌ Bad
roll: () => void
handleRoll: () => void
rollHandler: () => void
```

### 5.2 `store_file_naming`

**Rule**: Store files must use `.svelte.ts` extension

**Category**: `naming`

**Severity**: `error`

**Detection**:
- Find files in `stores/` directory
- Check file extension
- `.svelte.ts` = valid, `.ts` = violation

**Examples**:
```
// ✅ Good
stores/game.svelte.ts
stores/auth.svelte.ts

// ❌ Bad
stores/game.ts
stores/auth.store.ts
```

---

## 6. Implementation Plan

### Day 1: SARIF Output

- [ ] Create `output/sarif.ts` with SARIF type definitions
- [ ] Implement `toSarif(summary)` conversion function
- [ ] Add `--sarif` flag to `check.ts`
- [ ] Write tests for SARIF output

### Day 2: Quality Gate Integration

- [ ] Update `scripts/quality-gate.sh` to include AKG
- [ ] Test quality gate locally
- [ ] Document usage in CLAUDE.md

### Day 3: Config Fixes + Invariants

- [ ] Fix layer mismatch in `akg.config.ts`
- [ ] Implement `callback_prop_naming` invariant
- [ ] Implement `store_file_naming` invariant
- [ ] Write tests for new invariants

### Day 4: Integration Testing

- [ ] Run full discovery + check cycle
- [ ] Verify SARIF output validates
- [ ] Test quality gate end-to-end
- [ ] Update state files and handoff notes

---

## 7. Success Criteria

### Week 4 Exit Criteria

| Criterion | Metric |
|-----------|--------|
| SARIF output | `--sarif` produces valid SARIF 2.1.0 |
| Quality gate | `./scripts/quality-gate.sh` includes AKG |
| Config fix | No layer mismatch warnings |
| New invariants | 2 new invariants registered and passing |
| Tests | All new code has test coverage |

### Quality Gates

```bash
# All must pass before commit
pnpm akg:check                    # All invariants pass
pnpm akg:check --sarif | jq .     # Valid JSON output
./scripts/quality-gate.sh         # Full gate passes
pnpm web:vitest -- run src/tools/akg  # AKG tests pass
```

---

**Document Status**: Ready for implementation

**Next Action**: Begin Day 1 - SARIF Output implementation
