# ADR-002: Transition Probability Strategy

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
- ADR-001: Canonical Configuration Model (prerequisite)
- ADR-003: Solver Algorithm Selection (dependent)
- RFC-001: Statistical Engine Architecture
- Workflow: `.claude/workflows/dicee-m1-m4.yaml` (DICEE-005, DICEE-006)

---

## Abstract

This ADR documents the decision to precompute the full transition probability matrix using lazy initialization. The matrix maps (current_config, keep_pattern) pairs to probability distributions over resulting configurations, enabling O(1) lookups for the dynamic programming solver.

---

## Context

### Layer 0 Foundation

With ADR-001, we established 252 canonical dice configurations. The transition probability system (Layer 1) must answer:

> Given dice configuration C and keep pattern K, what is P(C' | C, K) for all possible resulting configurations C'?

### Problem Space

**Keep Patterns**: A keep pattern specifies how many of each face value to keep. For 5 dice with 6 faces:
- Maximum keep patterns per configuration: variable, depends on dice composition
- Conservative upper bound: 2^5 = 32 patterns (treating as binary per-die keep)
- More efficient: Keep patterns are unordered (like configs), further reducing space

**Transition Matrix Size**:
- Naive: 252 configs × 32 keep patterns × 252 target configs = ~2M entries
- Each entry: f64 (8 bytes) → ~16MB uncompressed
- With sparse storage (many zeros): ~4-8MB actual

### Computation Requirements

**Single Transition**: Computing P(C' | C, K) requires:
1. Determine kept dice counts from K
2. Calculate dice to reroll: 5 - sum(kept)
3. Enumerate all roll outcomes for rerolled dice
4. Apply multinomial distribution to each outcome
5. Normalize and sum matching target configs

**Time complexity**: O(6^(5-k)) where k = kept dice count
- Keep 4 dice: O(6) = 6 outcomes
- Keep 2 dice: O(216) = 216 outcomes
- Keep 0 dice: O(7776) = 7776 outcomes

---

## Decision

**We will precompute the full transition probability matrix with lazy initialization.**

### Data Structures

```rust
/// Transition table for probability lookups.
pub struct TransitionTable {
    /// P(target | partial) for all valid (partial, target) pairs.
    /// Indexed by [partial_index][target_config_index].
    probabilities: Vec<Vec<f64>>,
}

/// Partial dice state (after keeping some dice).
pub struct PartialDice {
    /// Counts of kept dice per face.
    kept: KeepPattern,
    /// Number of dice to roll (5 - sum(kept)).
    to_roll: u8,
}

/// Keep pattern: counts of each face value to keep.
pub type KeepPattern = [u8; 6];
```

### Lazy Initialization

```rust
use std::sync::LazyLock;

/// Global transition table, lazily initialized on first access.
pub static TRANSITION_TABLE: LazyLock<TransitionTable> = LazyLock::new(|| {
    TransitionTable::compute()
});
```

### Key Properties

1. **One-time computation**: ~10 seconds in release mode
2. **O(1) lookup**: Direct array indexing after initialization
3. **Memory bounded**: ~16MB maximum, fits in L3 cache
4. **Thread-safe**: LazyLock ensures safe concurrent initialization

---

## Consequences

### Positive

1. **O(1) probability lookup**: Critical for solver performance (<20ms target)
2. **Guaranteed correctness**: Precomputation allows exhaustive validation
3. **Memory predictable**: Fixed ~16MB footprint, no runtime allocation
4. **Cache-friendly**: Dense array access patterns

### Negative

1. **Cold start latency**: ~10s to initialize table on first use
2. **Memory footprint**: 16MB resident memory in all modes
3. **WASM binary size**: Table contributes ~1MB to compressed WASM

### Neutral

1. **Development complexity**: Matrix generation code must be correct
2. **Testing overhead**: Property tests must cover edge cases

---

## Alternatives Considered

### Alternative 1: On-Demand Computation

**Approach:** Compute each transition probability when requested.

**Pros:**
- Zero startup cost
- Minimal memory usage
- Simpler implementation

**Cons:**
- O(6^k) per lookup, infeasible for k > 2
- Solver would require millions of computations
- P95 latency would exceed 100ms

**Why rejected:** Performance requirements mandate O(1) lookups.

### Alternative 2: LRU Cache

**Approach:** Cache computed probabilities with LRU eviction.

**Pros:**
- Adaptive memory usage
- Fast for repeated queries
- Low cold-start cost

**Cons:**
- Cache misses degrade performance unpredictably
- Complex cache invalidation logic
- Memory fragmentation over time
- Still O(6^k) on miss

**Why rejected:** Unpredictable latency unacceptable for real-time UI.

### Alternative 3: Sparse Matrix Storage

**Approach:** Store only non-zero transition probabilities.

**Pros:**
- Reduced memory (~4-8MB vs 16MB)
- Faster iteration over non-zero entries

**Cons:**
- More complex indexing (hash map or CSR format)
- Higher lookup overhead
- Implementation complexity

**Why rejected:** Memory savings insufficient to justify complexity. 16MB is acceptable.

### Alternative 4: External Precomputation (Build-Time)

**Approach:** Generate table at build time, embed in binary.

**Pros:**
- Zero runtime initialization cost
- Smaller WASM (if table stored separately)

**Cons:**
- Build time increases significantly
- Binary size increases dramatically (~16MB)
- Harder to debug/modify
- Platform-specific build requirements

**Why rejected:** Binary size impact unacceptable for web deployment.

---

## Mathematical Foundation

### Multinomial Distribution

For k dice rolled, the probability of outcome O = [n₁, n₂, ..., n₆] where nᵢ = count of face i:

```
P(O) = k! / (n₁! × n₂! × ... × n₆!) × (1/6)^k
```

### Transition Probability

Given kept dice K and target config T:

```
P(T | K) = Σ P(O) for all O where K + O = T
```

Where "+" denotes combining kept dice with rolled outcome.

### Validation Properties

1. **Row sums**: For any (config, keep_pattern), Σ P(target) = 1.0
2. **Symmetry**: Keep all → P(same_config) = 1.0
3. **Uniform reroll**: Keep none → P(config) = multiplicity(config) / 7776

---

## Implementation Notes

### Table Generation Algorithm

```rust
impl TransitionTable {
    pub fn compute() -> Self {
        let mut table = Self::new();

        for partial in PartialDice::iter_all() {
            let probabilities = compute_transition_row(&partial);
            table.set_row(partial.to_index(), probabilities);
        }

        table
    }
}

fn compute_transition_row(partial: &PartialDice) -> Vec<f64> {
    let mut probs = vec![0.0; 252];

    for_each_roll_outcome(partial.to_roll, |outcome| {
        let target = partial.kept.combine(outcome);
        let target_idx = target.to_index().as_usize();
        probs[target_idx] += roll_probability(outcome, partial.to_roll);
    });

    probs
}
```

### Expected Value Computation

```rust
impl TransitionTable {
    /// Compute E[f(target) | partial] for a scoring function f.
    pub fn expected_value<F>(&self, partial: &PartialDice, f: F) -> f64
    where
        F: Fn(&DiceConfig) -> f64,
    {
        let row = self.get_row(partial.to_index());
        row.iter()
            .zip(DiceConfig::iter_all())
            .map(|(&p, config)| p * f(&config))
            .sum()
    }
}
```

---

## Validation Requirements

### Property-Based Tests

```rust
#[test]
fn prop_row_sums_to_one(partial: PartialDice) {
    let sum: f64 = TRANSITION_TABLE
        .get_row(partial.to_index())
        .iter()
        .sum();
    assert!((sum - 1.0).abs() < 1e-9);
}

#[test]
fn prop_keep_all_deterministic(config: DiceConfig) {
    let partial = PartialDice::keep_all(&config);
    let prob = TRANSITION_TABLE.get(partial.to_index(), config.to_index());
    assert!((prob - 1.0).abs() < 1e-9);
}

#[test]
fn prop_reroll_all_matches_multiplicity(config: DiceConfig) {
    let partial = PartialDice::reroll_all();
    let prob = TRANSITION_TABLE.get(partial.to_index(), config.to_index());
    let expected = config.multiplicity() as f64 / 7776.0;
    assert!((prob - expected).abs() < 1e-9);
}
```

### Performance Benchmarks

```rust
#[bench]
fn bench_lookup_single(b: &mut Bencher) {
    let partial = PartialDice::from_kept(&[2, 0, 0, 0, 0, 0]); // Keep two 1s
    let target = ConfigIndex::new(100).unwrap();

    b.iter(|| {
        TRANSITION_TABLE.get(partial.to_index(), target)
    });
}
// Target: < 10ns per lookup
```

---

## Migration Path

### Phase 2 Implementation

1. **Copy keep.rs**: KeepPattern, PartialDice types
2. **Copy transition/probability.rs**: Multinomial calculations
3. **Copy transition/table.rs**: TransitionTable with lazy init
4. **Add module**: `pub mod transition;` in lib.rs
5. **Verify**: All property tests pass

### Integration with Solver (Phase 4)

```rust
// Solver uses transition table for expected value calculation
let ev_continue = TRANSITION_TABLE.expected_value(&partial, |config| {
    solver.evaluate(&TurnState::new(config, rolls - 1), available)
});
```

---

## References

1. **Multinomial Distribution**: [Wikipedia](https://en.wikipedia.org/wiki/Multinomial_distribution)
2. **Lazy Static Pattern**: Rust `std::sync::LazyLock` documentation
3. **Source Implementation**: `<legacy-source-root>/dicee-engine-extracted/dicee-engine/src/transition/`

---

## Decision Record

| Date | Author | Decision |
|------|--------|----------|
| 2025-12-05 | Engineering | ADR Proposed |
| 2025-12-05 | Engineering | ADR Accepted |

**Status:** Accepted. Implementation complete in DICEE-006.
- `packages/engine/src/transition/probability.rs` (350 lines)
- `packages/engine/src/transition/table.rs` (280 lines)
- All 20 transition tests passing
