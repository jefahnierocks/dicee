//! Error types for the Dicee engine.

use thiserror::Error;

/// All errors that can occur in the Dicee engine.
#[derive(Error, Debug, Clone, PartialEq)]
pub enum DiceeError {
    /// A die value was outside the valid range [1, 6].
    #[error("Invalid die value {value} at position {position}: must be 1-6")]
    InvalidDieValue {
        /// The invalid value.
        value: u8,
        /// The position in the dice array (0-4).
        position: usize,
    },

    /// A configuration index was outside the valid range [0, 252).
    #[error("Invalid configuration index {0}: must be 0-251")]
    InvalidConfigIndex(u8),

    /// A keep pattern was incompatible with the current configuration.
    #[error(
        "Invalid keep pattern: cannot keep {requested} dice of face {face} when only {available} present"
    )]
    InvalidKeepPattern {
        /// The face value (1-6).
        face: u8,
        /// How many dice of this face were requested to keep.
        requested: u8,
        /// How many dice of this face are actually present.
        available: u8,
    },

    /// Attempted to reroll when no rolls remain.
    #[error("No rolls remaining in current turn")]
    NoRollsRemaining,

    /// Attempted to score in an already-claimed category.
    /// Note: Uses u8 index instead of Category enum to avoid circular dependency.
    /// Category enum will be added in Phase 4.
    #[error("Category index {0} has already been claimed")]
    CategoryAlreadyClaimed(u8),

    /// No valid categories available for scoring.
    #[error("No categories available for scoring")]
    NoCategoriesAvailable,

    /// A probability value was outside [0, 1].
    #[error("Invalid probability {0}: must be in [0.0, 1.0]")]
    InvalidProbability(f64),
}
