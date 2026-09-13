//! Transition probability calculations (Layer 1).
//!
//! This module computes the exact probability of transitioning from a
//! [`PartialDice`] state to a target [`DiceConfig`] by rolling the remaining dice.
//!
//! The core formula is the multinomial distribution:
//!
//! P(n₁, n₂, ..., n₆ | roll k dice) = k! / (n₁! × n₂! × ... × n₆!) × (1/6)^k
//!
//! where nᵢ is the count of face i in the rolled dice.

pub mod probability;
pub mod table;

pub use probability::Probability;
pub use table::{TRANSITION_TABLE, TransitionEntry, TransitionTable};
