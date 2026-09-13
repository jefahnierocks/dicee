# ADR-003: Solver Algorithm Selection

**Project:** Dicee — Statistical Engine Upgrade (M1-M4)
**ADR Status:** Accepted
**Version:** 1.0
**Date:** December 5, 2025
**Authors:** Engineering Team
**Reviewers:** Human review completed

---

## Document Status & Versioning

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0 | 2025-12-05 | Initial ADR | Current |

**Related Documents:**
- ADR-001: Canonical Configuration Model (prerequisite)
- ADR-002: Transition Probability Strategy (prerequisite)
- RFC-001: Statistical Engine Architecture
- Workflow: `.claude/workflows/dicee-m1-m4.yaml` (DICEE-008, DICEE-009, DICEE-010)

---

## Abstract

This ADR documents the decision to implement a memoized backward induction dynamic programming solver for computing optimal Dicee turn strategy. The solver uses the transition probability table from Layer 1 to evaluate expected values for all possible keep decisions.

---

## Context

### Problem Statement

Given a dice configuration, rolls remaining, and available scoring categories, the player must decide:
1. **Stop**: Score in one of the available categories now
2. **Continue**: Keep some dice and reroll the rest

The optimal strategy maximizes **expected score** over all possible future outcomes.

### State Space

**Turn State Components:**
- Current dice configuration: 252 possibilities (from ADR-001)
- Rolls remaining: 3 values (0, 1, 2)
- Available categories: 2^13 = 8,192 subsets of 13 categories

**Total State Space:**
```
252 × 3 × 8,192 = 6,193,152 potential states
```

However, in practice:
- Many category sets never occur (categories are crossed off sequentially)
- Terminal states (rolls = 0) have trivial solutions
- Solver only explores reachable states from current position

### Decision Points

At each non-terminal state (rolls > 0), player must choose:
1. Which category to score (if stopping)
2. Which dice to keep (if continuing)

**Keep decisions per configuration:**
- Variable based on dice composition
- Average: ~15-20 valid keep patterns per config
- Maximum: 32 (keep/reroll each of 5 dice independently)

---

## Decision

**We will implement a memoized backward induction dynamic programming solver.**

### Algorithm: Bellman Equation

The optimal expected value V(D, r, C) for dice configuration D, r rolls remaining, and category set C is:

```
V(D, r, C) = max(
    max_{c ∈ C} score(D, c),                    // Best immediate score
    max_{K} E[V(D', r-1, C) | D, K]             // Best expected continuation
)
```

Where:
- `max_{c ∈ C} score(D, c)` = best category score available now
- `max_{K}` = maximum over all valid keep patterns K
- `E[V(D', r-1, C) | D, K]` = expected value of next state given keep pattern K

### Core Types

```rust
/// Bitmask representing available scoring categories.
pub type CategorySet = u16;  // 13 bits used, 3 unused

/// Cache key for memoization.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct TurnState {
    config: ConfigIndex,      // 8 bits
    rolls_remaining: u8,      // 2 bits (0-2)
    available: CategorySet,   // 16 bits
}

/// Single-turn solver with memoization.
pub struct TurnSolver {
    /// Memoization cache: state → optimal expected value.
    cache: HashMap<TurnState, f64>,
}
```

### Expected Value Calculation

```rust
impl TurnSolver {
    /// Compute expected value of continuing with keep pattern K.
    fn expected_continuation(
        &mut self,
        partial: &PartialDice,
        rolls_remaining: u8,
        available: CategorySet,
    ) -> f64 {
        TRANSITION_TABLE.expected_value(partial, |target_config| {
            let next_state = TurnState {
                config: target_config.to_index(),
                rolls_remaining: rolls_remaining - 1,
                available,
            };
            self.evaluate(next_state)
        })
    }

    /// Evaluate optimal expected value for a state.
    pub fn evaluate(&mut self, state: TurnState) -> f64 {
        // Check cache first
        if let Some(&cached) = self.cache.get(&state) {
            return cached;
        }

        let config = DiceConfig::from_index(state.config);

        // Terminal case: no rolls remaining
        if state.rolls_remaining == 0 {
            let best_score = best_available_score(&config, state.available);
            self.cache.insert(state, best_score);
            return best_score;
        }

        // Option 1: Score now (best available category)
        let stop_value = best_available_score(&config, state.available);

        // Option 2: Continue (best keep pattern)
        let continue_value = KeepPattern::iter_valid_for(&config)
            .map(|keep| {
                let partial = PartialDice::new(config, keep).unwrap();
                self.expected_continuation(&partial, state.rolls_remaining, state.available)
            })
            .fold(f64::NEG_INFINITY, f64::max);

        let optimal = stop_value.max(continue_value);
        self.cache.insert(state, optimal);
        optimal
    }
}
```

### Key Properties

1. **Optimal by construction**: Bellman equation guarantees optimal expected value
2. **Memoization**: Each state computed at most once
3. **Sparse evaluation**: Only explores states reachable from current position
4. **Deterministic**: Same state always produces same result
5. **Cache reuse**: Subsequent queries leverage existing cache entries

---

## Consequences

### Positive

1. **Mathematically optimal**: Provably correct expected value calculations
2. **Performance**: O(1) cache hits, amortized O(|keep patterns|) for new states
3. **Memory bounded**: Cache size limited by reachable states (~500KB typical)
4. **Incremental**: Cache grows as game progresses, faster later turns
5. **Testable**: Known optimal plays can be validated against literature

### Negative

1. **First-call latency**: Cold cache means exploring many states initially
2. **Memory growth**: Cache accumulates throughout game session
3. **Complexity**: Recursive evaluation requires careful stack management
4. **Category coupling**: CategorySet representation affects API design

### Neutral

1. **Not full-game optimal**: Single-turn optimization, not multi-turn lookahead
2. **No learning**: Fixed strategy, doesn't adapt to opponent behavior
3. **Deterministic play**: Always chooses same action in same state

---

## Alternatives Considered

### Alternative 1: Monte Carlo Tree Search (MCTS)

**Approach:** Sample random rollouts to estimate expected value.

**Pros:**
- No explicit state enumeration
- Scales to larger state spaces
- Anytime algorithm (can return partial result)

**Cons:**
- Non-deterministic results
- Requires many samples for accuracy (~10,000+)
- No guarantee of optimality
- Slower convergence for small state spaces

**Why rejected:** Our state space (6M) is tractable for exact methods. MCTS appropriate for larger spaces (Go, Chess) but overkill here.

### Alternative 2: Greedy Heuristics

**Approach:** Use hand-crafted rules (e.g., "always keep pairs for Full House").

**Pros:**
- Instant computation
- Zero memory overhead
- Easy to understand/debug

**Cons:**
- Suboptimal by definition
- Complex rule maintenance
- Misses strategic opportunities
- Hard to validate correctness

**Why rejected:** User expectation is optimal recommendations. Heuristics may provide bad advice in edge cases.

### Alternative 3: Full Game Dynamic Programming

**Approach:** Solve from game end backward, considering all future turns.

**Pros:**
- True optimal strategy over entire game
- Accounts for upper section bonus
- Considers category scarcity

**Cons:**
- State space explodes: 252 × 3 × 13! ≈ 10^12 states
- Memory: Terabytes required
- Computation: Weeks on modern hardware

**Why rejected:** Infeasible for real-time use. Single-turn optimization is practical approximation.

### Alternative 4: Precomputed Strategy Table

**Approach:** Precompute optimal action for every state, store as lookup table.

**Pros:**
- O(1) query time
- Deterministic
- Optimal results

**Cons:**
- 6M states × (category + keep pattern) = ~100MB+ storage
- Prohibitive for WASM deployment
- No flexibility for variants

**Why rejected:** Memory footprint unacceptable. On-demand computation with caching achieves same optimality with lower memory.

---

## Performance Targets

### Latency Requirements

| Metric | Target | Rationale |
|--------|--------|-----------|
| P50 | <5ms | Feels instant to user |
| P95 | <20ms | Acceptable for real-time UI |
| P99 | <50ms | Edge case tolerance |
| Cold start (first turn) | <200ms | One-time acceptable delay |

### Memory Requirements

| Metric | Target | Rationale |
|--------|--------|-----------|
| Cache size (typical game) | <500KB | Fits in browser heap |
| Cache size (worst case) | <2MB | Upper bound for pathological play |
| Peak allocation | <5MB | Total solver memory including transition table |

### Optimization Strategies

1. **Early termination**: If stop_value ≥ theoretical max continuation, skip evaluation
2. **Keep pattern ordering**: Evaluate high-probability keeps first
3. **State canonicalization**: Ensure equivalent states share cache entry
4. **Batch evaluation**: Pre-warm cache during idle time

---

## Validation Requirements

### Known Position Tests

Reference positions from Dicee strategy literature:

```rust
#[test]
fn test_dicee_keep_all_fives() {
    // [5,5,5,5,5] with Dicee available: score immediately
    let state = TurnState {
        config: config_from_dice([5,5,5,5,5]).to_index(),
        rolls_remaining: 2,
        available: CategorySet::from_slice(&[Category::Dicee]),
    };

    let analysis = solver.analyze(state);
    assert_eq!(analysis.action, Action::Stop);
    assert_eq!(analysis.category, Some(Category::Dicee));
    assert_eq!(analysis.category_score, Some(50));
}

#[test]
fn test_four_of_a_kind_reroll_one() {
    // [3,3,3,3,1] with Dicee available: keep 3s, reroll the 1
    let state = TurnState {
        config: config_from_dice([3,3,3,3,1]).to_index(),
        rolls_remaining: 2,
        available: CategorySet::from_slice(&[Category::Dicee]),
    };

    let analysis = solver.analyze(state);
    assert_eq!(analysis.action, Action::Continue);
    assert_eq!(analysis.keep_recommendation.kept_counts, [0,0,4,0,0,0]);
}

#[test]
fn test_straight_draw() {
    // [1,2,3,4,6] with Large Straight available: keep 1-4, reroll 6
    let state = TurnState {
        config: config_from_dice([1,2,3,4,6]).to_index(),
        rolls_remaining: 1,
        available: CategorySet::from_slice(&[Category::LargeStraight]),
    };

    let analysis = solver.analyze(state);
    assert_eq!(analysis.action, Action::Continue);
    // Should keep 1,2,3,4 and hope for 5
}
```

### Property-Based Tests

```rust
#[test]
fn prop_ev_bounded(state: TurnState) {
    let ev = solver.evaluate(state);
    // EV must be in valid score range for available categories
    let min_possible = 0.0;  // Scoring zero in a category
    let max_possible = 50.0; // Dicee
    prop_assert!(ev >= min_possible && ev <= max_possible);
}

#[test]
fn prop_stop_ev_matches_best_score(state: TurnState) {
    // If we stop immediately, EV equals best available score
    let stop_ev = best_available_score(&config, state.available);
    let full_ev = solver.evaluate(state);
    // Full EV must be >= stop EV (continuation is always an option)
    prop_assert!(full_ev >= stop_ev - 1e-9);
}

#[test]
fn prop_deterministic(state: TurnState) {
    let ev1 = solver.evaluate(state);
    let ev2 = solver.evaluate(state);
    prop_assert_eq!(ev1, ev2);
}
```

### Performance Benchmarks

```rust
#[bench]
fn bench_cold_start(b: &mut Bencher) {
    b.iter(|| {
        let mut solver = TurnSolver::new();
        let state = TurnState::opening_roll();
        solver.evaluate(state)
    });
}
// Target: <200ms for cold start

#[bench]
fn bench_warm_lookup(b: &mut Bencher) {
    let mut solver = TurnSolver::new();
    // Warm up cache
    solver.evaluate(TurnState::opening_roll());

    let state = random_state();
    b.iter(|| {
        solver.evaluate(state)
    });
}
// Target: <1μs for cached lookup
```

---

## Implementation Notes

### WASM Considerations

1. **No threading**: WASM single-threaded, no parallel evaluation needed
2. **Memory growth**: Monitor cache size, implement eviction if needed
3. **Stack depth**: Iterative deepening if recursion depth becomes issue
4. **Serialization**: Cache can be persisted to IndexedDB for session resume

### API Design

```rust
/// Turn analysis result returned to frontend.
#[derive(Serialize)]
pub struct TurnAnalysis {
    /// Recommended action: stop (score) or continue (reroll).
    pub action: Action,

    /// If stopping: which category to score.
    pub recommended_category: Option<Category>,

    /// If stopping: the score that would be achieved.
    pub category_score: Option<u32>,

    /// If continuing: which dice to keep.
    pub keep_recommendation: Option<KeepRecommendation>,

    /// Expected value of the optimal strategy.
    pub expected_value: f64,

    /// All category scores and EVs for display.
    pub all_categories: Vec<CategoryAnalysis>,
}

#[derive(Serialize)]
pub struct KeepRecommendation {
    /// Bitmask of dice positions to keep.
    pub keep_mask: [bool; 5],

    /// Kept dice counts per face (canonical form).
    pub kept_counts: [u8; 6],

    /// Expected value after keeping these dice.
    pub expected_value: f64,

    /// Human-readable explanation.
    pub explanation: String,
}
```

---

## Migration Path

### Phase 4 Implementation (DICEE-009)

1. **Copy category.rs**: CategorySet, Category enum with scoring
2. **Copy turn.rs**: TurnState, TurnAnalysis structures
3. **Copy solver.rs**: TurnSolver with memoization
4. **Add tests**: Known position tests (DICEE-010)
5. **Add benchmarks**: Performance validation (Phase 6)

### Integration with WASM (Phase 5)

```rust
#[wasm_bindgen]
pub fn analyze_turn(
    dice: &[u8],
    rolls_remaining: u8,
    available_categories: u16,
) -> Result<JsValue, JsValue> {
    let config = DiceConfig::from_dice(&parse_dice(dice)?);
    let state = TurnState {
        config: config.to_index(),
        rolls_remaining,
        available: CategorySet::from_bits(available_categories),
    };

    let analysis = SOLVER.with(|s| s.borrow_mut().analyze(state));

    serde_wasm_bindgen::to_value(&analysis)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
```

---

## References

1. **Dicee Optimal Strategy**: Woodward, "The Mathematics of Dicee" (2009)
2. **Dynamic Programming**: Bellman, "Dynamic Programming" (1957)
3. **Memoization**: Michie, "Memo Functions and Machine Learning" (1968)
4. **Source Implementation**: `<legacy-source-root>/dicee-engine-extracted/dicee-engine/src/core/solver.rs`

---

## Decision Record

| Date | Author | Decision |
|------|--------|----------|
| 2025-12-05 | Engineering | ADR Proposed and Accepted |

**Status:** Accepted. Implementation planned for Phase 4 (DICEE-009).
