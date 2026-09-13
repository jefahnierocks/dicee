//! Dicee scoring rules implementation using DiceConfig.
//!
//! All scoring functions work directly with [`DiceConfig`] for efficiency,
//! avoiding the need to pass around ordered dice arrays.
//!
//! ## API Notes
//!
//! This module provides two scoring APIs:
//!
//! - [`score`]: Uses `core::category::Category` and returns [`ScoreResult`] (u8 score).
//!   This is the primary API used by the solver.
//!
//! - [`score_config`]: Uses `types::Category` and returns `ScoringResult` (u16 score).
//!   This maintains backward compatibility with the WASM API.

use serde::{Deserialize, Serialize};

use crate::core::category::Category as CoreCategory;
use crate::core::config::DiceConfig;
use crate::types::{Category as TypesCategory, ScoringResult};

// =============================================================================
// SCORE RESULT (for solver)
// =============================================================================

/// Result of scoring a category: score and whether the category is "valid".
///
/// A category is "valid" if the dice meet its requirements (e.g., Full House
/// requires 3+2 pattern). Invalid categories score 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScoreResult {
    /// The score for this category (0 if invalid).
    pub score: u8,
    /// Whether the dice meet the category requirements.
    pub valid: bool,
}

impl ScoreResult {
    /// A zero score (invalid category).
    pub const ZERO: Self = Self {
        score: 0,
        valid: false,
    };

    /// Creates a valid score result.
    #[inline]
    pub const fn valid(score: u8) -> Self {
        Self { score, valid: true }
    }

    /// Creates an invalid (zero) score result.
    #[inline]
    pub const fn invalid() -> Self {
        Self::ZERO
    }
}

// =============================================================================
// MAIN SCORING FUNCTION (for solver - uses core::category::Category)
// =============================================================================

/// Computes the score for a configuration in a specific category.
///
/// This is the primary scoring function used by the solver.
/// Returns a [`ScoreResult`] with u8 score.
///
/// # Examples
///
/// ```rust
/// use dicee_engine::core::{DiceConfig, Category};
/// use dicee_engine::scoring::rules::score;
///
/// let config = DiceConfig::from_dice(&[3, 3, 3, 5, 5]);
///
/// // Full House: 25 points
/// assert_eq!(score(&config, Category::FullHouse).score, 25);
///
/// // Three of a Kind: sum = 19
/// assert_eq!(score(&config, Category::ThreeOfAKind).score, 19);
/// ```
pub fn score(config: &DiceConfig, category: CoreCategory) -> ScoreResult {
    match category {
        // Upper section: sum of matching dice
        CoreCategory::Ones => score_upper_u8(config, 1),
        CoreCategory::Twos => score_upper_u8(config, 2),
        CoreCategory::Threes => score_upper_u8(config, 3),
        CoreCategory::Fours => score_upper_u8(config, 4),
        CoreCategory::Fives => score_upper_u8(config, 5),
        CoreCategory::Sixes => score_upper_u8(config, 6),

        // Lower section
        CoreCategory::ThreeOfAKind => score_n_of_kind_u8(config, 3),
        CoreCategory::FourOfAKind => score_n_of_kind_u8(config, 4),
        CoreCategory::FullHouse => {
            if config.is_full_house() {
                ScoreResult::valid(25)
            } else {
                ScoreResult::invalid()
            }
        }
        CoreCategory::SmallStraight => {
            if has_small_straight(config) {
                ScoreResult::valid(30)
            } else {
                ScoreResult::invalid()
            }
        }
        CoreCategory::LargeStraight => {
            if has_large_straight(config) {
                ScoreResult::valid(40)
            } else {
                ScoreResult::invalid()
            }
        }
        CoreCategory::Dicee => {
            if config.is_dicee() {
                ScoreResult::valid(50)
            } else {
                ScoreResult::invalid()
            }
        }
        CoreCategory::Chance => ScoreResult::valid(config.sum()),
    }
}

/// Scores all 13 categories and returns an array of results.
pub fn score_all(config: &DiceConfig) -> [(CoreCategory, ScoreResult); 13] {
    CoreCategory::ALL.map(|cat| (cat, score(config, cat)))
}

// =============================================================================
// Helper functions for u8 scoring (used by solver API)
// =============================================================================

#[inline]
fn score_upper_u8(config: &DiceConfig, face: u8) -> ScoreResult {
    let count = config.count(face);
    let s = face * count;
    if count > 0 {
        ScoreResult::valid(s)
    } else {
        ScoreResult {
            score: 0,
            valid: true,
        } // Upper section is always "valid" but may score 0
    }
}

#[inline]
fn score_n_of_kind_u8(config: &DiceConfig, n: u8) -> ScoreResult {
    if config.max_count() >= n {
        ScoreResult::valid(config.sum())
    } else {
        ScoreResult::invalid()
    }
}

#[inline]
fn has_small_straight(config: &DiceConfig) -> bool {
    let has = |face: u8| config.count(face) > 0;
    (has(1) && has(2) && has(3) && has(4))
        || (has(2) && has(3) && has(4) && has(5))
        || (has(3) && has(4) && has(5) && has(6))
}

#[inline]
fn has_large_straight(config: &DiceConfig) -> bool {
    let has = |face: u8| config.count(face) > 0;
    (has(1) && has(2) && has(3) && has(4) && has(5))
        || (has(2) && has(3) && has(4) && has(5) && has(6))
}

// =============================================================================
// BACKWARD COMPATIBLE SCORING FUNCTION (for WASM API)
// =============================================================================

/// Computes the score for a configuration in a specific category.
///
/// This function maintains backward compatibility with the WASM API.
/// Uses `types::Category` and returns `ScoringResult` with u16 score.
///
/// For the solver, use [`score`] instead.
///
/// # Examples
///
/// ```rust
/// use dicee_engine::core::DiceConfig;
/// use dicee_engine::types::Category;
/// use dicee_engine::scoring::score_config;
///
/// let config = DiceConfig::from_dice(&[3, 3, 3, 5, 5]);
///
/// // Full House: 25 points
/// let result = score_config(&config, Category::FullHouse);
/// assert_eq!(result.score, 25);
/// assert!(result.valid);
///
/// // Three of a Kind: sum = 19
/// let result = score_config(&config, Category::ThreeOfAKind);
/// assert_eq!(result.score, 19);
/// ```
pub fn score_config(config: &DiceConfig, category: TypesCategory) -> ScoringResult {
    let (score, valid) = match category {
        // Upper section: sum of matching dice
        TypesCategory::Ones => score_upper(config, 1),
        TypesCategory::Twos => score_upper(config, 2),
        TypesCategory::Threes => score_upper(config, 3),
        TypesCategory::Fours => score_upper(config, 4),
        TypesCategory::Fives => score_upper(config, 5),
        TypesCategory::Sixes => score_upper(config, 6),

        // Lower section
        TypesCategory::ThreeOfAKind => score_n_of_kind(config, 3),
        TypesCategory::FourOfAKind => score_n_of_kind(config, 4),
        TypesCategory::FullHouse => score_full_house(config),
        TypesCategory::SmallStraight => score_small_straight(config),
        TypesCategory::LargeStraight => score_large_straight(config),
        TypesCategory::Dicee => score_dicee(config),
        TypesCategory::Chance => score_chance(config),
    };

    ScoringResult {
        category,
        score,
        valid,
    }
}

/// Scores all 13 categories for a configuration.
///
/// Returns a vector of scoring results for each category.
/// Uses `types::Category` for WASM API compatibility.
pub fn score_all_config(config: &DiceConfig) -> Vec<ScoringResult> {
    TypesCategory::all()
        .iter()
        .map(|&cat| score_config(config, cat))
        .collect()
}

// =============================================================================
// SCORING HELPERS
// =============================================================================

/// Scores an upper section category (sum of dice matching the face).
#[inline]
fn score_upper(config: &DiceConfig, face: u8) -> (u16, bool) {
    let count = config.count(face);
    let score = u16::from(face) * u16::from(count);
    (score, count > 0)
}

/// Scores Three of a Kind or Four of a Kind.
///
/// If at least n dice match, score is the sum of all dice.
fn score_n_of_kind(config: &DiceConfig, n: u8) -> (u16, bool) {
    if config.max_count() >= n {
        (u16::from(config.sum()), true)
    } else {
        (0, false)
    }
}

/// Scores Full House (3 of one kind + 2 of another).
///
/// Returns 25 points if valid.
fn score_full_house(config: &DiceConfig) -> (u16, bool) {
    if config.is_full_house() {
        (25, true)
    } else {
        (0, false)
    }
}

/// Scores Small Straight (4 consecutive values).
///
/// Returns 30 points if valid.
fn score_small_straight(config: &DiceConfig) -> (u16, bool) {
    // Check for 1-2-3-4, 2-3-4-5, or 3-4-5-6
    let has = |face: u8| config.count(face) > 0;

    let has_small = (has(1) && has(2) && has(3) && has(4))
        || (has(2) && has(3) && has(4) && has(5))
        || (has(3) && has(4) && has(5) && has(6));

    if has_small { (30, true) } else { (0, false) }
}

/// Scores Large Straight (5 consecutive values).
///
/// Returns 40 points if valid.
fn score_large_straight(config: &DiceConfig) -> (u16, bool) {
    // Check for 1-2-3-4-5 or 2-3-4-5-6
    let has = |face: u8| config.count(face) > 0;

    let has_large = (has(1) && has(2) && has(3) && has(4) && has(5))
        || (has(2) && has(3) && has(4) && has(5) && has(6));

    if has_large { (40, true) } else { (0, false) }
}

/// Scores Dicee (all 5 dice the same).
///
/// Returns 50 points if valid.
fn score_dicee(config: &DiceConfig) -> (u16, bool) {
    if config.is_dicee() {
        (50, true)
    } else {
        (0, false)
    }
}

/// Scores Chance (sum of all dice, always valid).
#[inline]
fn score_chance(config: &DiceConfig) -> (u16, bool) {
    (u16::from(config.sum()), true)
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/// Returns the maximum possible score for a category.
pub const fn max_score(category: TypesCategory) -> u16 {
    match category {
        TypesCategory::Ones => 5,          // 5 × 1
        TypesCategory::Twos => 10,         // 5 × 2
        TypesCategory::Threes => 15,       // 5 × 3
        TypesCategory::Fours => 20,        // 5 × 4
        TypesCategory::Fives => 25,        // 5 × 5
        TypesCategory::Sixes => 30,        // 5 × 6
        TypesCategory::ThreeOfAKind => 30, // All 6s
        TypesCategory::FourOfAKind => 30,  // All 6s
        TypesCategory::FullHouse => 25,
        TypesCategory::SmallStraight => 30,
        TypesCategory::LargeStraight => 40,
        TypesCategory::Dicee => 50,
        TypesCategory::Chance => 30, // All 6s
    }
}

/// Returns the "target" score for a category that helps achieve the upper bonus.
///
/// For upper section categories, this is 3 × face value.
/// For lower section, returns 0.
pub const fn upper_target(category: TypesCategory) -> u16 {
    match category {
        TypesCategory::Ones => 3,
        TypesCategory::Twos => 6,
        TypesCategory::Threes => 9,
        TypesCategory::Fours => 12,
        TypesCategory::Fives => 15,
        TypesCategory::Sixes => 18,
        _ => 0,
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Tests for backward-compatible API (score_config with TypesCategory)
    #[test]
    fn test_upper_section() {
        let config = DiceConfig::from_dice(&[1, 1, 2, 3, 4]);

        assert_eq!(score_config(&config, TypesCategory::Ones).score, 2);
        assert_eq!(score_config(&config, TypesCategory::Twos).score, 2);
        assert_eq!(score_config(&config, TypesCategory::Threes).score, 3);
        assert_eq!(score_config(&config, TypesCategory::Fours).score, 4);
        assert_eq!(score_config(&config, TypesCategory::Fives).score, 0);
        assert_eq!(score_config(&config, TypesCategory::Sixes).score, 0);
    }

    #[test]
    fn test_three_of_kind() {
        let valid = DiceConfig::from_dice(&[3, 3, 3, 4, 5]);
        assert!(score_config(&valid, TypesCategory::ThreeOfAKind).valid);
        assert_eq!(score_config(&valid, TypesCategory::ThreeOfAKind).score, 18);

        let invalid = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        assert!(!score_config(&invalid, TypesCategory::ThreeOfAKind).valid);
    }

    #[test]
    fn test_four_of_kind() {
        let valid = DiceConfig::from_dice(&[4, 4, 4, 4, 2]);
        assert!(score_config(&valid, TypesCategory::FourOfAKind).valid);
        assert_eq!(score_config(&valid, TypesCategory::FourOfAKind).score, 18);

        let invalid = DiceConfig::from_dice(&[4, 4, 4, 2, 2]);
        assert!(!score_config(&invalid, TypesCategory::FourOfAKind).valid);
    }

    #[test]
    fn test_full_house() {
        let valid = DiceConfig::from_dice(&[2, 2, 5, 5, 5]);
        assert!(score_config(&valid, TypesCategory::FullHouse).valid);
        assert_eq!(score_config(&valid, TypesCategory::FullHouse).score, 25);

        let invalid = DiceConfig::from_dice(&[2, 2, 5, 5, 6]);
        assert!(!score_config(&invalid, TypesCategory::FullHouse).valid);
    }

    #[test]
    fn test_small_straight() {
        // 1-2-3-4
        let valid1 = DiceConfig::from_dice(&[1, 2, 3, 4, 4]);
        assert!(score_config(&valid1, TypesCategory::SmallStraight).valid);
        assert_eq!(
            score_config(&valid1, TypesCategory::SmallStraight).score,
            30
        );

        // 2-3-4-5
        let valid2 = DiceConfig::from_dice(&[2, 3, 4, 5, 5]);
        assert!(score_config(&valid2, TypesCategory::SmallStraight).valid);

        // 3-4-5-6
        let valid3 = DiceConfig::from_dice(&[3, 3, 4, 5, 6]);
        assert!(score_config(&valid3, TypesCategory::SmallStraight).valid);

        // Not a straight
        let invalid = DiceConfig::from_dice(&[1, 2, 3, 5, 6]);
        assert!(!score_config(&invalid, TypesCategory::SmallStraight).valid);
    }

    #[test]
    fn test_large_straight() {
        let valid1 = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        assert!(score_config(&valid1, TypesCategory::LargeStraight).valid);
        assert_eq!(
            score_config(&valid1, TypesCategory::LargeStraight).score,
            40
        );

        let valid2 = DiceConfig::from_dice(&[2, 3, 4, 5, 6]);
        assert!(score_config(&valid2, TypesCategory::LargeStraight).valid);

        let invalid = DiceConfig::from_dice(&[1, 2, 3, 4, 6]);
        assert!(!score_config(&invalid, TypesCategory::LargeStraight).valid);
    }

    #[test]
    fn test_dicee() {
        let valid = DiceConfig::from_dice(&[4, 4, 4, 4, 4]);
        assert!(score_config(&valid, TypesCategory::Dicee).valid);
        assert_eq!(score_config(&valid, TypesCategory::Dicee).score, 50);

        let invalid = DiceConfig::from_dice(&[4, 4, 4, 4, 5]);
        assert!(!score_config(&invalid, TypesCategory::Dicee).valid);
    }

    #[test]
    fn test_chance() {
        let config = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        assert!(score_config(&config, TypesCategory::Chance).valid);
        assert_eq!(score_config(&config, TypesCategory::Chance).score, 15);
    }

    #[test]
    fn test_score_all() {
        let config = DiceConfig::from_dice(&[3, 3, 3, 5, 5]);
        let scores = score_all_config(&config);

        // Should have 13 entries
        assert_eq!(scores.len(), 13);

        // Full house should score 25
        let fh = scores
            .iter()
            .find(|r| r.category == TypesCategory::FullHouse)
            .unwrap();
        assert_eq!(fh.score, 25);

        // Three of a kind should score sum (19)
        let tok = scores
            .iter()
            .find(|r| r.category == TypesCategory::ThreeOfAKind)
            .unwrap();
        assert_eq!(tok.score, 19);
    }

    #[test]
    fn test_max_scores() {
        assert_eq!(max_score(TypesCategory::Dicee), 50);
        assert_eq!(max_score(TypesCategory::LargeStraight), 40);
        assert_eq!(max_score(TypesCategory::FullHouse), 25);
        assert_eq!(max_score(TypesCategory::Sixes), 30);
    }

    #[test]
    fn test_upper_targets() {
        assert_eq!(upper_target(TypesCategory::Ones), 3);
        assert_eq!(upper_target(TypesCategory::Sixes), 18);
        assert_eq!(upper_target(TypesCategory::Dicee), 0);
    }

    // Tests for solver API (score with CoreCategory)
    #[test]
    fn test_solver_api_score() {
        let config = DiceConfig::from_dice(&[3, 3, 3, 5, 5]);

        // Full House: 25 points
        assert_eq!(score(&config, CoreCategory::FullHouse).score, 25);
        assert!(score(&config, CoreCategory::FullHouse).valid);

        // Three of a Kind: sum = 19
        assert_eq!(score(&config, CoreCategory::ThreeOfAKind).score, 19);
        assert!(score(&config, CoreCategory::ThreeOfAKind).valid);

        // Dicee: invalid
        assert!(!score(&config, CoreCategory::Dicee).valid);
        assert_eq!(score(&config, CoreCategory::Dicee).score, 0);
    }

    #[test]
    fn test_solver_api_score_all() {
        let config = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        let results = score_all(&config);

        assert_eq!(results.len(), 13);

        // Large straight should be valid
        let ls = results
            .iter()
            .find(|(c, _)| *c == CoreCategory::LargeStraight)
            .unwrap();
        assert!(ls.1.valid);
        assert_eq!(ls.1.score, 40);
    }
}
