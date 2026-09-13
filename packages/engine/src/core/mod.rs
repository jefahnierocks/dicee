//! Core types and algorithms for the Dicee engine.
//!
//! This module contains the fundamental types and computations:
//!
//! - `config`: Canonical dice configuration representation (Layer 0)
//! - `error`: Error types for the crate
//! - `keep`: Keep patterns and partial dice states (Layer 1)
//! - `category`: Scoring categories and category sets (Layer 2)
//! - `turn`: Turn state and analysis (Layer 2)
//! - `solver`: Dynamic programming solver (Layer 2)

pub mod category;
pub mod config;
pub mod error;
pub mod keep;
pub mod solver;
pub mod turn;

// Re-exports for convenience
pub use category::{Category, CategorySet, CategorySetIter};
pub use config::{ALL_CONFIGS, CONFIG_MULTIPLICITIES, ConfigIndex, DiceConfig};
pub use error::DiceeError;
pub use keep::{KeepPattern, PartialDice};
pub use solver::{TurnSolver, analyze_turn, quick_ev};
pub use turn::{Action, CategoryValue, TurnAnalysis, TurnState};
