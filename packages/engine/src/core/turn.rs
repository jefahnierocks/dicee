//! Turn state and analysis (Layer 2).
//!
//! This module represents the state within a single turn and provides
//! the analysis structures returned by the solver.

use serde::{Deserialize, Serialize};

use super::category::{Category, CategorySet};
use super::config::DiceConfig;
use super::keep::KeepPattern;

// =============================================================================
// TURN STATE
// =============================================================================

/// The state within a single turn.
///
/// Captures the current dice configuration and how many rolls remain.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct TurnState {
    /// Current dice configuration.
    pub config: DiceConfig,
    /// Rolls remaining (0, 1, or 2 after the initial roll).
    pub rolls_remaining: u8,
}

impl TurnState {
    /// Maximum rolls remaining after the initial roll.
    pub const MAX_ROLLS: u8 = 2;

    /// Creates a new turn state.
    ///
    /// # Panics
    ///
    /// Panics if `rolls_remaining > 2`.
    pub fn new(config: DiceConfig, rolls_remaining: u8) -> Self {
        assert!(
            rolls_remaining <= Self::MAX_ROLLS,
            "At most 2 rerolls allowed"
        );
        Self {
            config,
            rolls_remaining,
        }
    }

    /// Creates a turn state from ordered dice.
    pub fn from_dice(dice: &[u8; 5], rolls_remaining: u8) -> Self {
        Self::new(DiceConfig::from_dice(dice), rolls_remaining)
    }

    /// Returns true if rerolling is possible.
    #[inline]
    pub const fn can_reroll(&self) -> bool {
        self.rolls_remaining > 0
    }

    /// Returns true if this is the final roll (must score).
    #[inline]
    pub const fn must_score(&self) -> bool {
        self.rolls_remaining == 0
    }
}

// =============================================================================
// ACTION
// =============================================================================

/// An action the player can take.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Action {
    /// Score in a specific category.
    Score {
        /// The category to score in.
        category: Category,
    },
    /// Reroll with a specific keep pattern.
    Reroll {
        /// The dice to keep.
        keep: KeepPattern,
    },
}

impl Action {
    /// Creates a Score action.
    #[inline]
    pub const fn score(category: Category) -> Self {
        Self::Score { category }
    }

    /// Creates a Reroll action.
    #[inline]
    pub const fn reroll(keep: KeepPattern) -> Self {
        Self::Reroll { keep }
    }

    /// Returns true if this is a scoring action.
    #[inline]
    pub const fn is_score(&self) -> bool {
        matches!(self, Self::Score { .. })
    }

    /// Returns true if this is a reroll action.
    #[inline]
    pub const fn is_reroll(&self) -> bool {
        matches!(self, Self::Reroll { .. })
    }
}

// =============================================================================
// CATEGORY VALUE
// =============================================================================

/// Expected value analysis for a single category.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct CategoryValue {
    /// The category.
    pub category: Category,
    /// Immediate score if scored now.
    pub immediate_score: u8,
    /// Whether the category is valid (meets requirements).
    pub is_valid: bool,
    /// Expected value if we continue optimally and score here later.
    /// Only meaningful if rolls_remaining > 0.
    pub expected_value: f64,
}

// =============================================================================
// TURN ANALYSIS
// =============================================================================

/// Complete analysis of a turn state.
///
/// This is the main output of the solver, providing all information
/// needed to make an optimal decision.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TurnAnalysis {
    /// The analyzed state.
    pub state: TurnState,

    /// Available categories for scoring.
    pub available: CategorySet,

    /// Expected value for each available category.
    pub category_values: Vec<CategoryValue>,

    /// Best category to score immediately.
    pub best_immediate: Option<(Category, u8)>,

    /// Expected value if we reroll optimally and score the best available.
    pub continue_value: f64,

    /// The optimal keep pattern if continuing.
    pub optimal_keep: KeepPattern,

    /// The recommended action.
    pub recommendation: Action,

    /// Expected value of the recommended action.
    pub expected_value: f64,
}

impl TurnAnalysis {
    /// Returns the category values sorted by expected value (descending).
    pub fn sorted_by_ev(&self) -> Vec<&CategoryValue> {
        let mut sorted: Vec<_> = self.category_values.iter().collect();
        sorted.sort_by(|a, b| b.expected_value.total_cmp(&a.expected_value));
        sorted
    }

    /// Returns the category values sorted by immediate score (descending).
    pub fn sorted_by_immediate(&self) -> Vec<&CategoryValue> {
        let mut sorted: Vec<_> = self.category_values.iter().collect();
        sorted.sort_by_key(|value| std::cmp::Reverse(value.immediate_score));
        sorted
    }

    /// Returns true if the recommendation is to reroll.
    #[inline]
    pub fn should_reroll(&self) -> bool {
        self.recommendation.is_reroll()
    }

    /// Returns true if the recommendation is to score.
    #[inline]
    pub fn should_score(&self) -> bool {
        self.recommendation.is_score()
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_turn_state_creation() {
        let config = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        let state = TurnState::new(config, 2);

        assert!(state.can_reroll());
        assert!(!state.must_score());
    }

    #[test]
    fn test_must_score() {
        let config = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        let state = TurnState::new(config, 0);

        assert!(!state.can_reroll());
        assert!(state.must_score());
    }

    #[test]
    #[should_panic(expected = "At most 2 rerolls allowed")]
    fn test_invalid_rolls_remaining() {
        let config = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        TurnState::new(config, 3); // Panic: max is 2
    }

    #[test]
    fn test_action_variants() {
        let score_action = Action::score(Category::Dicee);
        assert!(score_action.is_score());
        assert!(!score_action.is_reroll());

        let keep = KeepPattern::KEEP_NONE;
        let reroll_action = Action::reroll(keep);
        assert!(reroll_action.is_reroll());
        assert!(!reroll_action.is_score());
    }
}
