//! Scoring module for Dicee categories.
//!
//! This module provides scoring functions that work with both ordered dice arrays
//! and canonical [`DiceConfig`] representations.
//!
//! ## Migration Note
//!
//! The preferred API uses `DiceConfig` directly via [`score_config`]:
//!
//! ```rust
//! use dicee_engine::core::DiceConfig;
//! use dicee_engine::types::Category;
//! use dicee_engine::scoring::{score_config, score_all_config};
//!
//! let config = DiceConfig::from_dice(&[3, 3, 3, 5, 5]);
//! let result = score_config(&config, Category::FullHouse);
//! assert_eq!(result.score, 25);
//! ```
//!
//! For backward compatibility, the [`score`] function accepts ordered dice arrays:
//!
//! ```rust
//! use dicee_engine::types::Category;
//! use dicee_engine::scoring::score;
//!
//! let dice = [3, 3, 3, 5, 5];
//! let result = score(&dice, Category::FullHouse);
//! assert_eq!(result.score, 25);
//! ```

pub mod rules;

// Re-export backward-compatible API (uses types::Category)
// The solver imports directly from crate::scoring::rules::score
pub use rules::{ScoreResult, max_score, score_all_config, score_config, upper_target};

use crate::core::DiceConfig;
use crate::types::{Category, Dice, ScoringResult};

// =============================================================================
// BACKWARD COMPATIBILITY LAYER
// =============================================================================

/// Scores a dice array for a specific category.
///
/// This is a convenience wrapper around [`score_config`] that accepts ordered
/// dice arrays. For maximum efficiency, prefer using [`score_config`] directly
/// with a [`DiceConfig`].
///
/// # Arguments
///
/// * `dice` - An array of 5 dice values (1-6)
/// * `category` - The scoring category to evaluate
///
/// # Returns
///
/// A [`ScoringResult`] containing the category, score, and validity flag.
///
/// # Examples
///
/// ```rust
/// use dicee_engine::types::Category;
/// use dicee_engine::scoring::score;
///
/// let dice = [5, 5, 5, 5, 5];
/// let result = score(&dice, Category::Dicee);
/// assert!(result.valid);
/// assert_eq!(result.score, 50);
/// ```
#[inline]
pub fn score(dice: &Dice, category: Category) -> ScoringResult {
    let config = DiceConfig::from_dice(dice);
    score_config(&config, category)
}

/// Scores a dice array for all 13 categories.
///
/// This is a convenience wrapper around [`score_all_config`] that accepts
/// ordered dice arrays.
///
/// # Examples
///
/// ```rust
/// use dicee_engine::scoring::score_all;
/// use dicee_engine::types::Category;
///
/// let dice = [1, 2, 3, 4, 5];
/// let results = score_all(&dice);
/// assert_eq!(results.len(), 13);
///
/// // Large straight should be valid
/// let large = results.iter().find(|r| r.category == Category::LargeStraight).unwrap();
/// assert!(large.valid);
/// assert_eq!(large.score, 40);
/// ```
pub fn score_all(dice: &Dice) -> Vec<ScoringResult> {
    let config = DiceConfig::from_dice(dice);
    score_all_config(&config)
}

// =============================================================================
// TESTS - Backward Compatibility Verification
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// These tests verify that the new implementation produces identical results
    /// to the original MVP scoring.rs implementation.

    #[test]
    fn test_upper_section() {
        let dice: Dice = [1, 1, 2, 3, 4];
        assert_eq!(score(&dice, Category::Ones).score, 2);
        assert_eq!(score(&dice, Category::Twos).score, 2);
        assert_eq!(score(&dice, Category::Threes).score, 3);
        assert_eq!(score(&dice, Category::Fours).score, 4);
        assert_eq!(score(&dice, Category::Fives).score, 0);
        assert_eq!(score(&dice, Category::Sixes).score, 0);
    }

    #[test]
    fn test_three_of_a_kind() {
        let yes: Dice = [3, 3, 3, 2, 1];
        let no: Dice = [1, 2, 3, 4, 5];

        let result = score(&yes, Category::ThreeOfAKind);
        assert!(result.valid);
        assert_eq!(result.score, 12);

        let result = score(&no, Category::ThreeOfAKind);
        assert!(!result.valid);
        assert_eq!(result.score, 0);
    }

    #[test]
    fn test_four_of_a_kind() {
        let yes: Dice = [4, 4, 4, 4, 2];
        let no: Dice = [4, 4, 4, 2, 2];

        let result = score(&yes, Category::FourOfAKind);
        assert!(result.valid);
        assert_eq!(result.score, 18);

        let result = score(&no, Category::FourOfAKind);
        assert!(!result.valid);
    }

    #[test]
    fn test_full_house() {
        let yes: Dice = [3, 3, 3, 2, 2];
        let no: Dice = [3, 3, 3, 3, 2];

        let result = score(&yes, Category::FullHouse);
        assert!(result.valid);
        assert_eq!(result.score, 25);

        let result = score(&no, Category::FullHouse);
        assert!(!result.valid);
    }

    #[test]
    fn test_small_straight() {
        let yes1: Dice = [1, 2, 3, 4, 6];
        let yes2: Dice = [2, 3, 4, 5, 5];
        let yes3: Dice = [1, 3, 4, 5, 6];
        let no: Dice = [1, 2, 3, 5, 6];

        assert!(score(&yes1, Category::SmallStraight).valid);
        assert!(score(&yes2, Category::SmallStraight).valid);
        assert!(score(&yes3, Category::SmallStraight).valid);
        assert!(!score(&no, Category::SmallStraight).valid);
    }

    #[test]
    fn test_large_straight() {
        let yes1: Dice = [1, 2, 3, 4, 5];
        let yes2: Dice = [2, 3, 4, 5, 6];
        let no: Dice = [1, 2, 3, 4, 6];

        let result = score(&yes1, Category::LargeStraight);
        assert!(result.valid);
        assert_eq!(result.score, 40);

        assert!(score(&yes2, Category::LargeStraight).valid);
        assert!(!score(&no, Category::LargeStraight).valid);
    }

    #[test]
    fn test_dicee() {
        let yes: Dice = [5, 5, 5, 5, 5];
        let no: Dice = [5, 5, 5, 5, 4];

        let result = score(&yes, Category::Dicee);
        assert!(result.valid);
        assert_eq!(result.score, 50);

        assert!(!score(&no, Category::Dicee).valid);
    }

    #[test]
    fn test_chance() {
        let dice: Dice = [1, 2, 3, 4, 5];
        let result = score(&dice, Category::Chance);
        assert!(result.valid);
        assert_eq!(result.score, 15);
    }

    #[test]
    fn test_score_all() {
        let dice: Dice = [3, 3, 3, 5, 5];
        let results = score_all(&dice);

        assert_eq!(results.len(), 13);

        // Full house should be valid
        let fh = results
            .iter()
            .find(|r| r.category == Category::FullHouse)
            .unwrap();
        assert!(fh.valid);
        assert_eq!(fh.score, 25);

        // Three of a kind should score sum (19)
        let tok = results
            .iter()
            .find(|r| r.category == Category::ThreeOfAKind)
            .unwrap();
        assert!(tok.valid);
        assert_eq!(tok.score, 19);
    }
}
