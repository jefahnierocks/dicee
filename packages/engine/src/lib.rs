//! # Dicee Engine
//!
//! A mathematically rigorous Dicee probability engine with optimal decision support.
//!
//! ## Architecture
//!
//! The engine is organized in layers of increasing capability:
//!
//! - **Layer 0** (`core::config`): Canonical dice configuration representation
//! - **Layer 1** (`core::keep`, `transition`): Keep patterns and transition probabilities (Phase 2)
//! - **Layer 2** (`core::turn`, `core::solver`): Single-turn dynamic programming (Phase 4)
//! - **Layer 3** (`wasm`): WebAssembly bindings (Phase 5)
//!
//! ## Mathematical Foundation
//!
//! The engine works with 252 canonical dice configurations (unordered multisets),
//! computing exact transition probabilities via multinomial distributions and
//! solving for optimal keep strategies using backward induction.

#![warn(missing_docs)]
#![warn(clippy::all)]
#![warn(clippy::pedantic)]
// Pedantic lint allows - these are style preferences, not correctness issues
#![allow(clippy::module_name_repetitions)]
#![allow(clippy::must_use_candidate)]
#![allow(clippy::unreadable_literal)]
#![allow(clippy::cast_possible_truncation)]
#![allow(clippy::cast_sign_loss)]
#![allow(clippy::cast_precision_loss)]
#![allow(clippy::cast_lossless)]
#![allow(clippy::implied_bounds_in_impls)]
#![allow(clippy::return_self_not_must_use)]
#![allow(clippy::explicit_iter_loop)]
#![allow(clippy::unsafe_derive_deserialize)]
#![allow(clippy::missing_fields_in_debug)]
#![allow(clippy::items_after_statements)]
#![allow(clippy::map_unwrap_or)]
#![allow(clippy::trivially_copy_pass_by_ref)]
#![allow(clippy::similar_names)]
#![allow(clippy::too_many_lines)]
#![allow(clippy::missing_errors_doc)]
#![allow(clippy::missing_panics_doc)]
#![allow(clippy::redundant_closure)]
#![allow(clippy::redundant_closure_for_method_calls)]
#![allow(clippy::explicit_counter_loop)]
#![allow(clippy::uninlined_format_args)]
#![allow(clippy::doc_markdown)]
#![allow(clippy::struct_excessive_bools)]
#![allow(clippy::fn_params_excessive_bools)]
#![allow(clippy::only_used_in_recursion)]
#![allow(clippy::match_same_arms)]

// =============================================================================
// MODULES
// =============================================================================

pub mod core; // Layer 0+ (config, error, keep, solver)
pub mod scoring; // Scoring rules (uses DiceConfig)
pub mod transition; // Layer 1 (probability, transition table)
pub mod types; // Public types (Category, ScoringResult)

// =============================================================================
// CRATE-LEVEL TYPES
// =============================================================================

use core::error::DiceeError;
use types::{Category, CategoryInfo, parse_dice};
use wasm_bindgen::prelude::*;

// Solver types for new WASM API
use core::category::CategorySet;
use core::solver::TurnSolver;
use core::turn::TurnState;
use serde::Serialize;

/// Result type alias for this crate (internal use).
pub type Result<T> = std::result::Result<T, DiceeError>;

/// The canonical dice type: 5 dice with values 1-6.
pub type Dice = [u8; 5];

/// Validates that a dice array contains only valid values (1-6).
#[inline]
pub fn validate_dice(dice: &Dice) -> Result<()> {
    for (i, &d) in dice.iter().enumerate() {
        if !(1..=6).contains(&d) {
            return Err(DiceeError::InvalidDieValue {
                value: d,
                position: i,
            });
        }
    }
    Ok(())
}

// Re-export core types at crate root for convenience
pub use core::config::{ConfigIndex, DiceConfig};
pub use core::error::DiceeError as Error;

// =============================================================================
// WASM EXPORTS
// =============================================================================

/// Get metadata for all categories (names, sections)
#[wasm_bindgen]
pub fn get_categories() -> std::result::Result<JsValue, JsValue> {
    let categories: Vec<CategoryInfo> = Category::all().iter().map(|c| c.info()).collect();

    serde_wasm_bindgen::to_value(&categories).map_err(|e| JsValue::from_str(&e.to_string()))
}

// =============================================================================
// NEW WASM EXPORTS (Phase 5a - Solver API)
// =============================================================================

/// JS-friendly category analysis for WASM output.
#[derive(Serialize)]
struct CategoryAnalysisJs {
    /// Category index (0-12).
    category: u8,
    /// Immediate score if scored now.
    immediate_score: u8,
    /// Whether the category is valid (meets requirements).
    is_valid: bool,
    /// Expected value if we continue optimally.
    expected_value: f64,
}

/// JS-friendly turn analysis for WASM output.
#[derive(Serialize)]
struct TurnAnalysisJs {
    /// Recommended action: "score" or "reroll".
    action: &'static str,
    /// Category index to score (if action === "score").
    #[serde(skip_serializing_if = "Option::is_none")]
    recommended_category: Option<u8>,
    /// Score value (if action === "score").
    #[serde(skip_serializing_if = "Option::is_none")]
    category_score: Option<u8>,
    /// Keep pattern as [count_1s, count_2s, ..., count_6s] (if action === "reroll").
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_pattern: Option<[u8; 6]>,
    /// Human-readable explanation (if action === "reroll").
    #[serde(skip_serializing_if = "Option::is_none")]
    keep_explanation: Option<String>,
    /// Expected value of optimal play.
    expected_value: f64,
    /// Analysis for all available categories.
    categories: Vec<CategoryAnalysisJs>,
}

/// Analyze the current turn and return optimal strategy.
///
/// This is the primary solver interface providing:
/// - Optimal action recommendation (score vs reroll)
/// - Keep pattern for rerolling (which dice to keep)
/// - Expected values for all available categories
///
/// # Arguments
///
/// * `dice` - Array of 5 dice values (1-6)
/// * `rolls_remaining` - Number of rerolls left (0, 1, or 2)
/// * `available_categories` - Bitmask of available categories (0x1FFF = all 13)
///
/// # Bitmask Convention
///
/// ```text
/// Bit 0:  Ones           (0x0001)
/// Bit 1:  Twos           (0x0002)
/// Bit 2:  Threes         (0x0004)
/// Bit 3:  Fours          (0x0008)
/// Bit 4:  Fives          (0x0010)
/// Bit 5:  Sixes          (0x0020)
/// Bit 6:  ThreeOfAKind   (0x0040)
/// Bit 7:  FourOfAKind    (0x0080)
/// Bit 8:  FullHouse      (0x0100)
/// Bit 9:  SmallStraight  (0x0200)
/// Bit 10: LargeStraight  (0x0400)
/// Bit 11: Dicee          (0x0800)
/// Bit 12: Chance         (0x1000)
/// ```
///
/// # Returns
///
/// JSON-serialized TurnAnalysisJs with recommendation and expected values.
///
/// # Errors
///
/// Returns an error if:
/// - Dice array is not exactly 5 values
/// - Dice values are not in range 1-6
/// - `rolls_remaining` is greater than 2
#[wasm_bindgen]
pub fn analyze_turn(
    dice: &[u8],
    rolls_remaining: u8,
    available_categories: u16,
) -> std::result::Result<JsValue, JsValue> {
    // Validate and parse dice
    let dice = parse_dice(dice).map_err(JsValue::from_str)?;

    // Validate rolls_remaining
    if rolls_remaining > 2 {
        return Err(JsValue::from_str("rolls_remaining must be 0, 1, or 2"));
    }

    // Create solver inputs
    let config = DiceConfig::from_dice(&dice);
    let state = TurnState::new(config, rolls_remaining);
    let available = CategorySet::from_bits(available_categories);

    // Handle edge case: no categories available
    if available.is_empty() {
        let result = TurnAnalysisJs {
            action: "score",
            recommended_category: None,
            category_score: None,
            keep_pattern: None,
            keep_explanation: None,
            expected_value: 0.0,
            categories: Vec::new(),
        };
        return serde_wasm_bindgen::to_value(&result)
            .map_err(|e| JsValue::from_str(&e.to_string()));
    }

    // Run solver
    let solver = TurnSolver::new();
    let analysis = solver.analyze(&state, &available);

    // Convert to JS-friendly format
    let categories: Vec<CategoryAnalysisJs> = analysis
        .category_values
        .iter()
        .map(|cv| CategoryAnalysisJs {
            category: cv.category.index() as u8,
            immediate_score: cv.immediate_score,
            is_valid: cv.is_valid,
            expected_value: cv.expected_value,
        })
        .collect();

    let result = match analysis.recommendation {
        core::turn::Action::Score { category } => {
            // Find the immediate score for this category
            let score = analysis
                .category_values
                .iter()
                .find(|cv| cv.category == category)
                .map(|cv| cv.immediate_score)
                .unwrap_or(0);

            TurnAnalysisJs {
                action: "score",
                recommended_category: Some(category.index() as u8),
                category_score: Some(score),
                keep_pattern: None,
                keep_explanation: None,
                expected_value: analysis.expected_value,
                categories,
            }
        }
        core::turn::Action::Reroll { keep } => {
            let keep_counts = *keep.counts();
            let explanation = generate_keep_explanation(&keep_counts);

            TurnAnalysisJs {
                action: "reroll",
                recommended_category: None,
                category_score: None,
                keep_pattern: Some(keep_counts),
                keep_explanation: Some(explanation),
                expected_value: analysis.expected_value,
                categories,
            }
        }
    };

    serde_wasm_bindgen::to_value(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Generate a human-readable explanation for a keep pattern.
fn generate_keep_explanation(counts: &[u8; 6]) -> String {
    let mut parts = Vec::new();

    for (face, &count) in counts.iter().enumerate() {
        if count > 0 {
            let face_value = face + 1;
            if count == 1 {
                parts.push(format!("one {face_value}"));
            } else {
                parts.push(format!("{count} {face_value}s"));
            }
        }
    }

    if parts.is_empty() {
        "Reroll all dice".to_string()
    } else {
        format!("Keep {}", parts.join(", "))
    }
}

// =============================================================================
// TESTS FOR NEW WASM EXPORTS
// =============================================================================

#[cfg(test)]
mod wasm_tests {
    use super::*;

    #[test]
    fn test_keep_explanation_all_same() {
        let counts = [0, 0, 5, 0, 0, 0]; // Five 3s
        let explanation = generate_keep_explanation(&counts);
        assert_eq!(explanation, "Keep 5 3s");
    }

    #[test]
    fn test_keep_explanation_mixed() {
        let counts = [2, 0, 3, 0, 0, 0]; // Two 1s and three 3s
        let explanation = generate_keep_explanation(&counts);
        assert_eq!(explanation, "Keep 2 1s, 3 3s");
    }

    #[test]
    fn test_keep_explanation_single() {
        let counts = [1, 0, 0, 0, 0, 0]; // One 1
        let explanation = generate_keep_explanation(&counts);
        assert_eq!(explanation, "Keep one 1");
    }

    #[test]
    fn test_keep_explanation_empty() {
        let counts = [0, 0, 0, 0, 0, 0]; // Reroll all
        let explanation = generate_keep_explanation(&counts);
        assert_eq!(explanation, "Reroll all dice");
    }

    /// Test that `analyze_turn` internal logic works for Dicee position.
    #[test]
    fn test_analyze_turn_logic_dicee() {
        // Dicee with all categories available
        let dice = [5, 5, 5, 5, 5];
        let config = DiceConfig::from_dice(&dice);
        let state = TurnState::new(config, 2);
        let available = CategorySet::from_bits(0x1FFF); // All 13 categories

        let solver = TurnSolver::new();
        let analysis = solver.analyze(&state, &available);

        // Should recommend scoring Dicee (index 11)
        assert!(analysis.recommendation.is_score());
        if let core::turn::Action::Score { category } = analysis.recommendation {
            assert_eq!(category.index(), 11); // Dicee
        }
        // Expected value should be 50 for Dicee
        assert!((analysis.expected_value - 50.0).abs() < 0.01);
    }

    /// Test that `analyze_turn` handles partial category sets.
    #[test]
    fn test_analyze_turn_logic_partial_categories() {
        // [3,3,3,3,1] with only Dicee available
        let dice = [3, 3, 3, 3, 1];
        let config = DiceConfig::from_dice(&dice);
        let state = TurnState::new(config, 2);
        let available = CategorySet::from_bits(0x0800); // Only Dicee (bit 11)

        let solver = TurnSolver::new();
        let analysis = solver.analyze(&state, &available);

        // With 2 rolls remaining and only Dicee available, should reroll
        assert!(
            analysis.recommendation.is_reroll(),
            "Should reroll when chasing Dicee with 4-of-a-kind"
        );
    }

    /// Test that `analyze_turn` handles empty category set.
    #[test]
    fn test_analyze_turn_logic_empty_categories() {
        let dice = [1, 2, 3, 4, 5];
        let config = DiceConfig::from_dice(&dice);
        let state = TurnState::new(config, 2);
        let available = CategorySet::from_bits(0x0000); // No categories

        let solver = TurnSolver::new();
        let analysis = solver.analyze(&state, &available);

        // Should have zero expected value
        assert!(analysis.expected_value.abs() <= f64::EPSILON);
        assert!(analysis.category_values.is_empty());
    }

    /// Test bitmask conversion for all categories.
    #[test]
    fn test_category_bitmask_full() {
        let available = CategorySet::from_bits(0x1FFF);
        assert_eq!(available.len(), 13);

        // Verify all categories are present
        for cat in core::category::Category::ALL {
            assert!(available.contains(cat));
        }
    }

    /// Test bitmask conversion for specific categories.
    #[test]
    fn test_category_bitmask_specific() {
        // Ones (bit 0) and Dicee (bit 11)
        let available = CategorySet::from_bits(0x0801);
        assert_eq!(available.len(), 2);
        assert!(available.contains(core::category::Category::Ones));
        assert!(available.contains(core::category::Category::Dicee));
        assert!(!available.contains(core::category::Category::Twos));
    }
}
