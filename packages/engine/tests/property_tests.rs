//! Property-based tests for the Dicee engine (ADR-005 implementation).
//!
//! These tests use proptest to validate mathematical correctness of the engine:
//! - Probability distributions sum to 1.0
//! - Expected values are bounded
//! - Configuration roundtrips are lossless
//!
//! Run with: `cargo test --test property_tests`

use dicee_engine::Dice;
use dicee_engine::core::category::CategorySet;
use dicee_engine::core::config::{ALL_CONFIGS, ConfigIndex, DiceConfig};
use dicee_engine::core::keep::KeepPattern;
use dicee_engine::core::solver::TurnSolver;
use dicee_engine::core::turn::TurnState;
use dicee_engine::transition::probability::{roll_outcome_probability, transition_probability};
use proptest::prelude::*;

// =============================================================================
// STRATEGY DEFINITIONS
// =============================================================================

/// Strategy for generating valid dice arrays (5 dice, values 1-6).
fn arbitrary_dice() -> impl Strategy<Value = Dice> {
    (1u8..=6, 1u8..=6, 1u8..=6, 1u8..=6, 1u8..=6)
        .prop_map(|(d1, d2, d3, d4, d5)| [d1, d2, d3, d4, d5])
}

/// Strategy for generating valid rolls remaining (0-2).
fn arbitrary_rolls() -> impl Strategy<Value = u8> {
    0u8..=2
}

/// Strategy for generating a non-empty category set.
fn arbitrary_category_set() -> impl Strategy<Value = CategorySet> {
    // Generate a bitmask with at least one bit set (1 to 8191 = 2^13 - 1)
    (1u16..=8191).prop_map(CategorySet::from_bits)
}

/// Strategy for generating valid config index.
fn arbitrary_config_index() -> impl Strategy<Value = u8> {
    0u8..252
}

/// Strategy for generating valid keep pattern bits (0-31 for 5 positions).
fn arbitrary_keep_bits() -> impl Strategy<Value = u8> {
    0u8..32
}

// =============================================================================
// CONFIGURATION PROPERTY TESTS
// =============================================================================

proptest! {
    /// Property: Config roundtrip is lossless.
    /// from_dice -> to_index -> from_index -> to_dice should produce equivalent config.
    #[test]
    fn prop_config_roundtrip(dice in arbitrary_dice()) {
        let config1 = DiceConfig::from_dice(&dice);
        let index = config1.to_index();
        let config2 = DiceConfig::from_index(index);

        // Configs should be identical
        prop_assert_eq!(config1, config2);

        // Canonical dice should match
        prop_assert_eq!(config1.to_dice(), config2.to_dice());
    }

    /// Property: Config index is in valid range.
    #[test]
    fn prop_config_index_valid(dice in arbitrary_dice()) {
        let config = DiceConfig::from_dice(&dice);
        let index = config.to_index();

        prop_assert!(index.get() < 252, "Index {} out of range", index.get());
    }

    /// Property: Config counts always sum to 5.
    #[test]
    fn prop_config_counts_sum(dice in arbitrary_dice()) {
        let config = DiceConfig::from_dice(&dice);
        let sum: u8 = config.counts().iter().sum();

        prop_assert_eq!(sum, 5, "Counts {:?} sum to {}, expected 5", config.counts(), sum);
    }

    /// Property: Config multiplicity is positive and bounded.
    #[test]
    fn prop_config_multiplicity_bounded(dice in arbitrary_dice()) {
        let config = DiceConfig::from_dice(&dice);
        let mult = config.multiplicity();

        // Multiplicity must be in [1, 120]
        // 1 = all same (e.g., [1,1,1,1,1])
        // 120 = all different (e.g., [1,2,3,4,5])
        prop_assert!(mult >= 1, "Multiplicity {} < 1", mult);
        prop_assert!(mult <= 120, "Multiplicity {} > 120", mult);
    }

    /// Property: Index roundtrip for arbitrary valid index.
    #[test]
    fn prop_index_roundtrip(index_val in arbitrary_config_index()) {
        let index = ConfigIndex::new(index_val).unwrap();
        let config = DiceConfig::from_index(index);
        let roundtrip_index = config.to_index();

        prop_assert_eq!(index, roundtrip_index);
    }
}

// =============================================================================
// PROBABILITY PROPERTY TESTS
// =============================================================================

proptest! {
    /// Property: Roll outcome probabilities sum to 1.0 for any number of dice.
    #[test]
    fn prop_roll_probabilities_sum_to_one(dice_to_roll in 1u8..=5) {
        let mut total = 0.0f64;

        // Enumerate all outcomes for rolling `dice_to_roll` dice
        for_each_roll_outcome(dice_to_roll, |counts| {
            total += roll_outcome_probability(counts, dice_to_roll).get();
        });

        prop_assert!(
            (total - 1.0).abs() < 1e-9,
            "Probabilities for {} dice sum to {}, expected 1.0",
            dice_to_roll,
            total
        );
    }

    /// Property: Transition probabilities sum to 1.0 for any keep pattern.
    #[test]
    fn prop_transition_sum_to_one(
        dice in arbitrary_dice(),
        keep_bits in arbitrary_keep_bits()
    ) {
        let config = DiceConfig::from_dice(&dice);
        let canonical_dice = config.to_dice();

        // Build keep counts from the keep bits
        let mut kept_counts = [0u8; 6];
        let mut dice_kept = 0u8;

        for (i, &face) in canonical_dice.iter().enumerate() {
            if keep_bits & (1 << i) != 0 {
                kept_counts[(face - 1) as usize] += 1;
                dice_kept += 1;
            }
        }

        let dice_to_roll = 5 - dice_kept;

        if dice_to_roll == 0 {
            // Keeping all dice: only one outcome (current config)
            return Ok(());
        }

        // Sum transition probabilities to all reachable configs
        let mut total = 0.0f64;

        for target in ALL_CONFIGS.iter() {
            if let Some(prob) = transition_probability(&kept_counts, target.counts(), dice_to_roll) {
                total += prob.get();
            }
        }

        prop_assert!(
            (total - 1.0).abs() < 1e-9,
            "Transition probabilities sum to {} (expected 1.0) for kept {:?}, rolling {}",
            total,
            kept_counts,
            dice_to_roll
        );
    }
}

// =============================================================================
// SOLVER PROPERTY TESTS
// =============================================================================

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))] // Limit cases for expensive solver tests

    /// Property: Expected value is bounded [0, 50].
    /// Maximum possible score is Dicee (50 points).
    #[test]
    fn prop_solver_ev_bounded(
        dice in arbitrary_dice(),
        rolls in arbitrary_rolls(),
        categories in arbitrary_category_set()
    ) {
        let solver = TurnSolver::new();
        let config = DiceConfig::from_dice(&dice);

        let ev = solver.expected_value(&config, rolls, &categories);

        prop_assert!(ev >= 0.0, "EV {} < 0", ev);
        prop_assert!(ev <= 50.0, "EV {} > 50 (max Dicee score)", ev);
    }

    /// Property: EV is monotonically non-decreasing with more rolls.
    /// V(D, 2, C) >= V(D, 1, C) >= V(D, 0, C)
    #[test]
    fn prop_solver_ev_monotonic(
        dice in arbitrary_dice(),
        categories in arbitrary_category_set()
    ) {
        let solver = TurnSolver::new();
        let config = DiceConfig::from_dice(&dice);

        let ev0 = solver.expected_value(&config, 0, &categories);
        let ev1 = solver.expected_value(&config, 1, &categories);
        let ev2 = solver.expected_value(&config, 2, &categories);

        // Allow small floating-point tolerance
        prop_assert!(
            ev1 >= ev0 - 1e-9,
            "EV with 1 roll ({:.4}) < EV with 0 rolls ({:.4})",
            ev1, ev0
        );
        prop_assert!(
            ev2 >= ev1 - 1e-9,
            "EV with 2 rolls ({:.4}) < EV with 1 roll ({:.4})",
            ev2, ev1
        );
    }

    /// Property: Analysis recommendation is consistent with EV.
    /// If recommending score, immediate score should >= continue value.
    /// If recommending reroll, continue value should > immediate best.
    #[test]
    fn prop_analysis_recommendation_consistent(
        dice in arbitrary_dice(),
        rolls in 1u8..=2, // Need rolls to have a choice
        categories in arbitrary_category_set()
    ) {
        let solver = TurnSolver::new();
        let config = DiceConfig::from_dice(&dice);
        let state = TurnState::new(config, rolls);

        let analysis = solver.analyze(&state, &categories);

        if analysis.recommendation.is_score() {
            // If scoring, immediate should be >= continue value
            let immediate = analysis.best_immediate
                .map(|(_, s)| s as f64)
                .unwrap_or(0.0);
            prop_assert!(
                immediate >= analysis.continue_value - 1e-9,
                "Recommends score but immediate ({:.2}) < continue ({:.2})",
                immediate, analysis.continue_value
            );
        } else {
            // If rerolling, continue should be > immediate
            let immediate = analysis.best_immediate
                .map(|(_, s)| s as f64)
                .unwrap_or(0.0);
            prop_assert!(
                analysis.continue_value > immediate - 1e-9,
                "Recommends reroll but continue ({:.2}) <= immediate ({:.2})",
                analysis.continue_value, immediate
            );
        }
    }

    /// Property: Empty category set yields zero EV.
    #[test]
    fn prop_empty_categories_zero_ev(
        dice in arbitrary_dice(),
        rolls in arbitrary_rolls()
    ) {
        let solver = TurnSolver::new();
        let config = DiceConfig::from_dice(&dice);
        let empty = CategorySet::EMPTY;

        let ev = solver.expected_value(&config, rolls, &empty);

        prop_assert_eq!(ev, 0.0, "Empty categories should have EV 0, got {}", ev);
    }
}

// =============================================================================
// KEEP PATTERN PROPERTY TESTS
// =============================================================================

proptest! {
    /// Property: Keep pattern from config captures correct dice.
    #[test]
    fn prop_keep_pattern_valid(dice in arbitrary_dice()) {
        let config = DiceConfig::from_dice(&dice);
        let keep_all = KeepPattern::keep_all(&config);
        let keep_none = KeepPattern::KEEP_NONE;

        // Keep all should have 5 dice kept
        prop_assert_eq!(
            keep_all.total_kept(),
            5,
            "Keep all should have 5 dice, has {}",
            keep_all.total_kept()
        );

        // Keep none should have 0 dice kept
        prop_assert_eq!(
            keep_none.total_kept(),
            0,
            "Keep none should have 0 dice, has {}",
            keep_none.total_kept()
        );
    }
}

// =============================================================================
// MULTIPLICITY PROPERTY TESTS
// =============================================================================

/// Property: Sum of all multiplicities equals 6^5 = 7776.
#[test]
fn prop_total_multiplicity() {
    let total: u32 = ALL_CONFIGS.iter().map(|c| c.multiplicity()).sum();

    assert_eq!(total, 7776, "Total multiplicity {} != 6^5 = 7776", total);
}

/// Property: Config count is exactly 252.
#[test]
fn prop_config_count() {
    assert_eq!(
        ALL_CONFIGS.len(),
        252,
        "Config count {} != 252",
        ALL_CONFIGS.len()
    );
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Iterates over all possible outcomes for rolling k dice.
fn for_each_roll_outcome<F>(dice_to_roll: u8, mut f: F)
where
    F: FnMut(&[u8; 6]),
{
    fn recurse<F: FnMut(&[u8; 6])>(counts: &mut [u8; 6], face: usize, remaining: u8, f: &mut F) {
        if face == 5 {
            counts[5] = remaining;
            f(counts);
            return;
        }

        for c in 0..=remaining {
            counts[face] = c;
            recurse(counts, face + 1, remaining - c, f);
        }
    }

    let mut counts = [0u8; 6];
    recurse(&mut counts, 0, dice_to_roll, &mut f);
}
