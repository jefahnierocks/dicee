# ADR-001: Canonical Configuration Model

**Project:** Dicee — Statistical Engine Upgrade (M1-M4)
**ADR Status:** Accepted
**Version:** 1.1
**Date:** December 5, 2025
**Authors:** Engineering Team
**Reviewers:** Human review completed

---

## Document Status & Versioning

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0 | 2025-12-05 | Initial ADR | Superseded |
| 1.1 | 2025-12-05 | Status → Accepted, implementation reference | Current |

**Related Documents:**
- RFC-001: Statistical Engine Architecture
- ADR-002: Transition Probability Strategy (planned)
- ADR-003: Solver Algorithm Selection (planned)
- Workflow: `.claude/workflows/dicee-m1-m4.yaml`

---

## Abstract

This ADR documents the decision to adopt a canonical configuration model using 252 unordered dice representations, replacing the ordered 7,776-outcome model. This is the foundational Layer 0 decision upon which all other architectural layers depend.

---

## Context

### Current State (MVP)

The existing Dicee engine uses ordered dice arrays `[u8; 5]` where each die position is tracked independently:
- Dice values: `[3, 2, 3, 5, 1]` vs `[1, 2, 3, 3, 5]` are treated as distinct
- Total outcome space: 6^5 = **7,776** possible dice states
- Probability calculations enumerate all 7,776 outcomes
- Memory usage scales with outcome count

### Problem

The ordered representation creates unnecessary computational burden:
1. **Redundant states**: `[1,1,2,3,4]` and `[4,3,2,1,1]` have identical scoring and strategic value
2. **Exponential complexity**: Multi-roll analysis requires 7,776^n transitions
3. **Memory pressure**: Full probability matrices would be 7,776 × 7,776 ≈ 60M entries
4. **Wasted computation**: Scoring functions already ignore order internally

### Mathematical Foundation

The number of **unordered** configurations of 5 dice with 6 faces is given by the "stars and bars" combinatorial formula:

```
C(n + k - 1, k) = C(6 + 5 - 1, 5) = C(10, 5) = 252
```

Each configuration represents an equivalence class of ordered outcomes. The size of each class (multiplicity) follows the multinomial coefficient:

```
multiplicity = 5! / (n₁! × n₂! × ... × n₆!)
```

Where `nᵢ` is the count of dice showing face `i`. The sum of all multiplicities equals 7,776.

---

## Decision

**We will adopt a canonical configuration model using 252 unordered dice representations.**

### Core Types

```rust
/// A validated index into the space of 252 configurations.
pub struct ConfigIndex(u8);  // Newtype wrapper, valid range 0-251

/// Canonical unordered representation of 5 dice.
pub struct DiceConfig {
    /// counts[i] = number of dice showing face (i+1)
    counts: [u8; 6],  // Invariant: sum = 5
}
```

### Key Properties

1. **Bijection**: ConfigIndex ↔ DiceConfig is a 1:1 mapping
2. **Normalization**: Any `[u8; 5]` dice array maps to exactly one DiceConfig
3. **Multiplicity tracking**: Each config knows how many ordered arrangements produce it
4. **Compile-time generation**: All 252 configs are computed at compile time

### Implementation

```rust
impl DiceConfig {
    /// Convert ordered dice to canonical form
    pub fn from_dice(dice: &[u8; 5]) -> Self;

    /// Convert to canonical index for table lookups
    pub fn to_index(&self) -> ConfigIndex;

    /// Reconstruct from index
    pub fn from_index(index: ConfigIndex) -> Self;

    /// Number of ordered outcomes that produce this config
    pub fn multiplicity(&self) -> u32;
}
```

---

## Consequences

### Positive

1. **30.86× state space reduction**: 7,776 → 252 configurations
2. **O(1) probability lookups**: Transition tables become practical (252 × 32 × 252)
3. **Memory efficiency**: Solver memoization cache: ~500KB vs ~50MB
4. **Correctness by construction**: Invalid states are unrepresentable
5. **Performance**: <100ns config operations, <1μs transition lookups

### Negative

1. **Migration complexity**: Existing code uses ordered arrays
2. **Type conversion overhead**: Must convert user input to canonical form
3. **Loss of die identity**: Cannot track "which physical die" (acceptable for Dicee)

### Neutral

1. **Learning curve**: Team must understand combinatorial indexing
2. **Testing requirements**: Bijection properties must be verified with property tests
3. **Documentation**: Mathematical foundation must be well-documented

---

## Alternatives Considered

### Alternative 1: Keep Ordered Representation

**Pros:**
- No migration cost
- Intuitive mapping to physical dice

**Cons:**
- 30.86× larger state space
- Impractical for multi-roll analysis
- Higher memory and compute costs

**Why rejected:** Performance and memory requirements for solver are infeasible.

### Alternative 2: Hash Table with Sorted Keys

**Approach:** Use `HashMap<[u8; 5], Value>` with sorted dice as keys.

**Pros:**
- Dynamic, no precomputation
- Familiar API

**Cons:**
- Hash overhead per lookup
- No compile-time validation
- Non-deterministic iteration order
- Memory fragmentation

**Why rejected:** Index-based lookup is faster and more cache-friendly.

### Alternative 3: Perfect Hash Function

**Approach:** Custom hash function mapping dice → [0, 251].

**Pros:**
- Direct array indexing
- No collision handling

**Cons:**
- Complex implementation
- Hash function must be perfect (non-trivial)
- Less intuitive than combinatorial ranking

**Why rejected:** Combinatorial ranking is well-understood and proven correct.

---

## Validation Requirements

### Property-Based Tests

```rust
#[test]
fn prop_config_roundtrip(dice: [u8; 5]) {
    let config = DiceConfig::from_dice(&dice);
    let index = config.to_index();
    let config2 = DiceConfig::from_index(index);
    assert_eq!(config, config2);
}

#[test]
fn prop_multiplicity_sum() {
    let sum: u32 = DiceConfig::iter_all()
        .map(|c| c.multiplicity())
        .sum();
    assert_eq!(sum, 7776);  // 6^5
}

#[test]
fn prop_index_unique() {
    let indices: HashSet<_> = DiceConfig::iter_all()
        .map(|c| c.to_index())
        .collect();
    assert_eq!(indices.len(), 252);
}
```

### Compile-Time Assertions

```rust
static ALL_CONFIGS: [DiceConfig; 252] = generate_all_configs();

const fn generate_all_configs() -> [DiceConfig; 252] {
    // Compile-time generation ensures correctness
}
```

---

## Migration Path

### Phase 1: Add New Types (Non-Breaking)
- Copy `config.rs`, `error.rs` to `packages/engine/src/core/`
- Add `mod core;` to `lib.rs`
- No changes to existing code

### Phase 2: Internal Adoption
- Refactor `scoring.rs` to use `DiceConfig` internally
- Maintain public API unchanged
- Add adapter functions

### Phase 3: API Update (Phase 5a-5d)
- New WASM exports accept ConfigIndex or dice arrays
- Old API deprecated, not removed
- Frontend feature-flagged migration

---

## References

1. **Stars and Bars**: [Combinatorics, Wikipedia](https://en.wikipedia.org/wiki/Stars_and_bars_(combinatorics))
2. **Multinomial Coefficients**: [Multinomial Theorem](https://en.wikipedia.org/wiki/Multinomial_theorem)
3. **Dicee Mathematics**: Woodward, "The Mathematics of Dicee" (2009)
4. **Source Implementation**: `<legacy-source-root>/dicee-engine-extracted/dicee-engine/src/core/config.rs`

---

## Decision Record

| Date | Author | Decision |
|------|--------|----------|
| 2025-12-05 | Engineering | ADR Proposed |
| 2025-12-05 | Engineering | ADR Accepted |

**Status:** Accepted. Implementation complete in DICEE-003/004.
- `packages/engine/src/core/config.rs` (500 lines)
- `packages/engine/src/core/error.rs` (50 lines)
- All 14 config tests passing
