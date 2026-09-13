//! Core probability calculations.
//!
//! This module provides exact probability calculations for dice outcomes
//! using the multinomial distribution.

use std::fmt;

use serde::{Deserialize, Serialize};

use crate::Result;
use crate::core::error::DiceeError;

// =============================================================================
// PROBABILITY TYPE
// =============================================================================

/// A probability value in [0, 1].
///
/// This is a newtype wrapper around `f64` that enforces the probability invariant.
#[derive(Clone, Copy, PartialEq, PartialOrd, Default, Serialize, Deserialize)]
#[repr(transparent)]
pub struct Probability(f64);

impl Probability {
    /// Probability of zero (impossible event).
    pub const ZERO: Self = Self(0.0);

    /// Probability of one (certain event).
    pub const ONE: Self = Self(1.0);

    /// Creates a new probability, returning an error if out of range.
    pub fn new(value: f64) -> Result<Self> {
        if (0.0..=1.0).contains(&value) {
            Ok(Self(value))
        } else {
            Err(DiceeError::InvalidProbability(value))
        }
    }

    /// Creates a probability without validation.
    ///
    /// # Safety
    ///
    /// The caller must ensure `0.0 <= value <= 1.0`.
    #[inline]
    pub const unsafe fn new_unchecked(value: f64) -> Self {
        Self(value)
    }

    /// Returns the probability value.
    #[inline]
    pub const fn get(self) -> f64 {
        self.0
    }

    /// Returns true if this probability is effectively zero.
    #[inline]
    pub fn is_zero(self) -> bool {
        self.0 < f64::EPSILON
    }

    /// Returns true if this probability is effectively one.
    #[inline]
    pub fn is_one(self) -> bool {
        (self.0 - 1.0).abs() < f64::EPSILON
    }
}

impl fmt::Debug for Probability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "P({:.6})", self.0)
    }
}

impl fmt::Display for Probability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:.4}", self.0)
    }
}

impl std::ops::Mul for Probability {
    type Output = Self;

    fn mul(self, rhs: Self) -> Self::Output {
        // Product of probabilities is a probability
        Self(self.0 * rhs.0)
    }
}

impl std::ops::Add for Probability {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        // Sum might exceed 1.0 for mutually exclusive events, but we allow it
        // during intermediate calculations
        Self(self.0 + rhs.0)
    }
}

impl std::iter::Sum for Probability {
    fn sum<I: Iterator<Item = Self>>(iter: I) -> Self {
        Self(iter.map(|p| p.0).sum())
    }
}

// =============================================================================
// FACTORIAL AND COMBINATORICS
// =============================================================================

/// Factorial lookup table for n! where n ∈ [0, 10].
const FACTORIALS: [u64; 11] = [
    1,       // 0!
    1,       // 1!
    2,       // 2!
    6,       // 3!
    24,      // 4!
    120,     // 5!
    720,     // 6!
    5040,    // 7!
    40320,   // 8!
    362880,  // 9!
    3628800, // 10!
];

/// Returns n! for n ∈ [0, 10].
///
/// # Panics
///
/// Panics if n > 10.
#[inline]
pub const fn factorial(n: u8) -> u64 {
    FACTORIALS[n as usize]
}

/// Computes the multinomial coefficient: n! / (k₁! × k₂! × ... × kₘ!).
///
/// For dice: 5! / (c₁! × c₂! × ... × c₆!)
pub fn multinomial_coefficient(counts: &[u8; 6]) -> u32 {
    let n: u8 = counts.iter().sum();
    let numerator = factorial(n);
    let denominator: u64 = counts.iter().map(|&c| factorial(c)).product();
    (numerator / denominator) as u32
}

/// Powers of 6 lookup table for (1/6)^k.
const POWERS_OF_SIX_INV: [f64; 6] = [
    1.0,          // 6^0
    1.0 / 6.0,    // 6^(-1)
    1.0 / 36.0,   // 6^(-2)
    1.0 / 216.0,  // 6^(-3)
    1.0 / 1296.0, // 6^(-4)
    1.0 / 7776.0, // 6^(-5)
];

/// Returns (1/6)^k for k ∈ [0, 5].
#[inline]
pub const fn inv_power_of_six(k: u8) -> f64 {
    POWERS_OF_SIX_INV[k as usize]
}

// =============================================================================
// TRANSITION PROBABILITY
// =============================================================================

/// Computes the probability of rolling a specific outcome.
///
/// P(outcome | roll k dice) = multinomial_coefficient(outcome) × (1/6)^k
///
/// # Arguments
///
/// - `rolled_counts`: The counts of each face value in the outcome [n₁, n₂, ..., n₆]
/// - `dice_rolled`: The number of dice rolled (k)
///
/// # Example
///
/// ```rust
/// use dicee_engine::transition::probability::roll_outcome_probability;
///
/// // Probability of rolling exactly one of each face when rolling 5 dice
/// // is 0 because 5 dice can't show 6 different values
///
/// // Probability of rolling [1, 1, 1, 1, 1] (five 1s) when rolling 5 dice
/// // = 5!/(5!×1×1×1×1×1) × (1/6)^5 = 1 × (1/7776) ≈ 0.000129
/// let p = roll_outcome_probability(&[5, 0, 0, 0, 0, 0], 5);
/// assert!((p.get() - 1.0/7776.0).abs() < 1e-10);
/// ```
pub fn roll_outcome_probability(rolled_counts: &[u8; 6], dice_rolled: u8) -> Probability {
    // Validate that counts sum to dice_rolled
    debug_assert_eq!(
        rolled_counts.iter().sum::<u8>(),
        dice_rolled,
        "Rolled counts must sum to dice rolled"
    );

    if dice_rolled == 0 {
        // Rolling 0 dice: only the "empty" outcome is possible
        return if rolled_counts.iter().all(|&c| c == 0) {
            Probability::ONE
        } else {
            Probability::ZERO
        };
    }

    let coefficient = multinomial_coefficient(rolled_counts);
    let base_prob = inv_power_of_six(dice_rolled);
    let prob = (coefficient as f64) * base_prob;

    // Safety: result is mathematically guaranteed to be in [0, 1]
    unsafe { Probability::new_unchecked(prob) }
}

/// Computes the probability of transitioning from a partial state to a target config.
///
/// Given kept dice counts and the number of dice to roll, compute the probability
/// of reaching a specific final configuration.
///
/// # Arguments
///
/// - `kept`: Counts of kept dice per face
/// - `target`: Target configuration counts per face
/// - `dice_to_roll`: Number of dice being rolled
///
/// # Returns
///
/// `Some(probability)` if the transition is possible, `None` if impossible
/// (target requires fewer dice of some face than we're keeping).
pub fn transition_probability(
    kept: &[u8; 6],
    target: &[u8; 6],
    dice_to_roll: u8,
) -> Option<Probability> {
    // Compute what we need to roll to reach target
    let mut needed = [0u8; 6];
    for i in 0..6 {
        if target[i] < kept[i] {
            // Target has fewer of this face than we're keeping: impossible
            return None;
        }
        needed[i] = target[i] - kept[i];
    }

    // Verify the needed dice sum to what we're rolling
    let needed_sum: u8 = needed.iter().sum();
    if needed_sum != dice_to_roll {
        return None;
    }

    Some(roll_outcome_probability(&needed, dice_to_roll))
}

// =============================================================================
// EXPECTED VALUE COMPUTATION
// =============================================================================

/// Computes expected value over all roll outcomes.
///
/// E[f(outcome)] = Σ P(outcome) × f(outcome)
///
/// # Arguments
///
/// - `dice_to_roll`: Number of dice being rolled
/// - `scorer`: Function that computes the value for each outcome
///
/// # Example
///
/// ```rust
/// use dicee_engine::transition::probability::expected_value_over_rolls;
///
/// // Expected sum when rolling 2 dice
/// let ev = expected_value_over_rolls(2, |counts| {
///     let mut sum = 0.0;
///     for (face_idx, &count) in counts.iter().enumerate() {
///         sum += ((face_idx + 1) as f64) * (count as f64);
///     }
///     sum
/// });
///
/// // E[sum of 2 dice] = 2 × 3.5 = 7.0
/// assert!((ev - 7.0).abs() < 0.01);
/// ```
pub fn expected_value_over_rolls<F>(dice_to_roll: u8, mut scorer: F) -> f64
where
    F: FnMut(&[u8; 6]) -> f64,
{
    if dice_to_roll == 0 {
        return scorer(&[0; 6]);
    }

    let mut total = 0.0;

    // Enumerate all possible outcomes for dice_to_roll dice
    for_each_roll_outcome(dice_to_roll, |counts| {
        let prob = roll_outcome_probability(counts, dice_to_roll);
        let value = scorer(counts);
        total += prob.get() * value;
    });

    total
}

/// Iterates over all possible outcomes for rolling k dice.
///
/// This is stars-and-bars enumeration: distribute k dice across 6 faces.
fn for_each_roll_outcome<F>(dice_to_roll: u8, mut f: F)
where
    F: FnMut(&[u8; 6]),
{
    // Generate all ways to distribute k items into 6 bins
    fn recurse<F: FnMut(&[u8; 6])>(counts: &mut [u8; 6], face: usize, remaining: u8, f: &mut F) {
        if face == 5 {
            // Last face gets all remaining dice
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

/// Returns the number of distinct outcomes when rolling k dice.
///
/// This is C(k + 5, 5) = C(k + 5, k).
pub fn outcome_count(dice_to_roll: u8) -> usize {
    // C(k+5, 5) for k = 0..5
    const COUNTS: [usize; 6] = [
        1,   // k=0: C(5,5) = 1
        6,   // k=1: C(6,5) = 6
        21,  // k=2: C(7,5) = 21
        56,  // k=3: C(8,5) = 56
        126, // k=4: C(9,5) = 126
        252, // k=5: C(10,5) = 252
    ];
    COUNTS[dice_to_roll as usize]
}

// =============================================================================
// EXACT RATIONAL ARITHMETIC (FEATURE-GATED)
// =============================================================================

#[cfg(feature = "exact-rational")]
pub mod exact {
    //! Exact rational probability calculations.
    //!
    //! Uses `num_rational::Ratio<i64>` for exact arithmetic, avoiding
    //! floating-point rounding errors.

    use num_rational::Ratio;

    /// An exact probability as a rational number.
    pub type ExactProbability = Ratio<i64>;

    /// Computes exact multinomial probability.
    pub fn exact_roll_probability(counts: &[u8; 6], dice_rolled: u8) -> ExactProbability {
        use super::factorial;

        let n = dice_rolled;
        let numerator = i64::try_from(factorial(n)).expect("5-die factorial fits in i64");
        let denominator: i64 = counts
            .iter()
            .map(|&count| i64::try_from(factorial(count)).expect("5-die factorial fits in i64"))
            .product();
        let coeff = Ratio::new(numerator, denominator);

        // Multiply by (1/6)^n
        let base = Ratio::new(1, 6i64.pow(n as u32));

        coeff * base
    }
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_factorial() {
        assert_eq!(factorial(0), 1);
        assert_eq!(factorial(1), 1);
        assert_eq!(factorial(5), 120);
    }

    #[test]
    fn test_multinomial_coefficient() {
        // 5!/(5!) = 1 (all same)
        assert_eq!(multinomial_coefficient(&[5, 0, 0, 0, 0, 0]), 1);

        // 5!/(1!×1!×1!×1!×1!) = 120 (all different)
        assert_eq!(multinomial_coefficient(&[1, 1, 1, 1, 1, 0]), 120);

        // 5!/(2!×3!) = 10 (pair + three)
        assert_eq!(multinomial_coefficient(&[2, 3, 0, 0, 0, 0]), 10);
    }

    #[test]
    fn test_roll_probability_sum_to_one() {
        for dice_to_roll in 0..=5 {
            let mut total = Probability::ZERO;

            for_each_roll_outcome(dice_to_roll, |counts| {
                total = total + roll_outcome_probability(counts, dice_to_roll);
            });

            assert!(
                (total.get() - 1.0).abs() < 1e-10,
                "Probabilities for {} dice sum to {}, expected 1.0",
                dice_to_roll,
                total.get()
            );
        }
    }

    #[test]
    fn test_specific_probabilities() {
        // All 5 dice same face: 1/7776 ≈ 0.000129
        let p = roll_outcome_probability(&[5, 0, 0, 0, 0, 0], 5);
        assert!((p.get() - 1.0 / 7776.0).abs() < 1e-10);

        // Single die showing 1: 1/6
        let p = roll_outcome_probability(&[1, 0, 0, 0, 0, 0], 1);
        assert!((p.get() - 1.0 / 6.0).abs() < 1e-10);
    }

    #[test]
    fn test_transition_probability() {
        // Keeping two 3s, rolling 3 dice, want three 3s and two 5s
        let kept = [0, 0, 2, 0, 0, 0]; // two 3s
        let target = [0, 0, 3, 0, 2, 0]; // three 3s, two 5s

        let prob = transition_probability(&kept, &target, 3);
        assert!(prob.is_some());

        // Need to roll [0, 0, 1, 0, 2, 0] (one 3, two 5s)
        // Prob = 3!/(1!×2!) × (1/6)^3 = 3 × (1/216) = 1/72
        let expected = 3.0 / 216.0;
        assert!((prob.unwrap().get() - expected).abs() < 1e-10);
    }

    #[test]
    fn test_impossible_transition() {
        // Keeping three 3s, but target only has two 3s: impossible
        let kept = [0, 0, 3, 0, 0, 0];
        let target = [0, 0, 2, 0, 0, 3];

        assert!(transition_probability(&kept, &target, 2).is_none());
    }

    #[test]
    fn test_expected_value() {
        // Expected sum when rolling 1 die = 3.5
        let ev = expected_value_over_rolls(1, |counts| {
            let mut sum = 0.0;
            for (face_idx, &count) in counts.iter().enumerate() {
                sum += ((face_idx + 1) as f64) * (count as f64);
            }
            sum
        });
        assert!((ev - 3.5).abs() < 0.01);
    }

    #[test]
    fn test_outcome_count() {
        assert_eq!(outcome_count(0), 1);
        assert_eq!(outcome_count(1), 6);
        assert_eq!(outcome_count(5), 252);
    }
}
