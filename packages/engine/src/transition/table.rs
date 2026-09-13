//! Precomputed transition probability table.
//!
//! This module provides a lazily-computed table of transition probabilities
//! from each possible partial dice state to each target configuration.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

use super::probability::{Probability, roll_outcome_probability};
use crate::core::config::{ALL_CONFIGS, ConfigIndex, DiceConfig};
use crate::core::keep::PartialDice;

// =============================================================================
// TRANSITION ENTRY
// =============================================================================

/// A single entry in the transition table: target config and probability.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct TransitionEntry {
    /// Index of the target configuration.
    pub target: ConfigIndex,
    /// Probability of reaching this target.
    pub probability: Probability,
}

impl TransitionEntry {
    /// Creates a new transition entry.
    #[inline]
    pub const fn new(target: ConfigIndex, probability: Probability) -> Self {
        Self {
            target,
            probability,
        }
    }
}

// =============================================================================
// PARTIAL DICE KEY
// =============================================================================

/// A hashable key for partial dice states.
///
/// We key by (kept counts, dice to roll) since that fully determines
/// the transition distribution.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
struct PartialKey {
    kept: [u8; 6],
    to_roll: u8,
}

impl From<&PartialDice> for PartialKey {
    fn from(partial: &PartialDice) -> Self {
        Self {
            kept: *partial.kept_counts(),
            to_roll: partial.dice_to_roll(),
        }
    }
}

// =============================================================================
// TRANSITION TABLE
// =============================================================================

/// Precomputed transition probabilities from partial dice states to configurations.
///
/// For each valid (kept pattern, dice to roll) pair, stores the distribution
/// over reachable target configurations.
#[derive(Debug)]
pub struct TransitionTable {
    /// Map from partial state to list of (target, probability) pairs.
    /// Only stores non-zero probabilities.
    transitions: HashMap<PartialKey, Vec<TransitionEntry>>,
}

impl TransitionTable {
    /// Builds the complete transition table.
    ///
    /// This is an expensive operation that enumerates all possible transitions.
    pub fn build() -> Self {
        let mut transitions: HashMap<PartialKey, Vec<TransitionEntry>> = HashMap::new();

        // For each number of dice to roll (0..=5)
        for to_roll in 0u8..=5 {
            // Enumerate all possible keep patterns that result in rolling `to_roll` dice
            for_each_keep_pattern(5 - to_roll, |kept| {
                let key = PartialKey { kept, to_roll };

                let mut entries = Vec::new();

                // For each possible target configuration
                for (idx, target) in ALL_CONFIGS.iter().enumerate() {
                    // Compute probability of reaching this target from kept state
                    if let Some(prob) = compute_transition_prob(&kept, target, to_roll)
                        && !prob.is_zero()
                    {
                        entries.push(TransitionEntry {
                            // Safety: idx is always < 252
                            target: unsafe { ConfigIndex::new_unchecked(idx as u8) },
                            probability: prob,
                        });
                    }
                }

                if !entries.is_empty() {
                    transitions.insert(key, entries);
                }
            });
        }

        Self { transitions }
    }

    /// Returns the transition distribution for a partial dice state.
    ///
    /// Returns a slice of (target, probability) pairs for all reachable configurations.
    pub fn get(&self, partial: &PartialDice) -> &[TransitionEntry] {
        let key = PartialKey::from(partial);
        self.transitions.get(&key).map(Vec::as_slice).unwrap_or(&[])
    }

    /// Computes expected value of a function over reachable configurations.
    ///
    /// E[f(config)] = Σ P(config | partial) × f(config)
    pub fn expected_value<F>(&self, partial: &PartialDice, mut scorer: F) -> f64
    where
        F: FnMut(&DiceConfig) -> f64,
    {
        let mut total = 0.0;

        for entry in self.get(partial) {
            let config = DiceConfig::from_index(entry.target);
            let value = scorer(&config);
            total += entry.probability.get() * value;
        }

        total
    }

    /// Returns the number of entries in the table.
    pub fn entry_count(&self) -> usize {
        self.transitions.values().map(Vec::len).sum()
    }

    /// Returns the number of distinct partial states tracked.
    pub fn state_count(&self) -> usize {
        self.transitions.len()
    }
}

/// Computes the probability of transitioning from kept state to target.
fn compute_transition_prob(
    kept: &[u8; 6],
    target: &DiceConfig,
    to_roll: u8,
) -> Option<Probability> {
    // Compute what we need to roll to reach target
    let target_counts = target.counts();
    let mut needed = [0u8; 6];

    for i in 0..6 {
        if target_counts[i] < kept[i] {
            // Target has fewer of this face than we're keeping: impossible
            return None;
        }
        needed[i] = target_counts[i] - kept[i];
    }

    // Verify the needed dice sum to what we're rolling
    let needed_sum: u8 = needed.iter().sum();
    if needed_sum != to_roll {
        return None;
    }

    Some(roll_outcome_probability(&needed, to_roll))
}

/// Enumerates all keep patterns that use exactly `total_kept` dice.
fn for_each_keep_pattern<F>(total_kept: u8, mut f: F)
where
    F: FnMut([u8; 6]),
{
    fn recurse<F: FnMut([u8; 6])>(
        kept: &mut [u8; 6],
        face: usize,
        remaining: u8,
        max_per_face: u8,
        f: &mut F,
    ) {
        if face == 5 {
            if remaining <= max_per_face {
                kept[5] = remaining;
                f(*kept);
            }
            return;
        }

        for c in 0..=remaining.min(max_per_face) {
            kept[face] = c;
            recurse(kept, face + 1, remaining - c, max_per_face, f);
        }
    }

    let mut kept = [0u8; 6];
    // Max dice per face when keeping
    let max_per_face = 5u8;
    recurse(&mut kept, 0, total_kept, max_per_face, &mut f);
}

// =============================================================================
// GLOBAL TABLE
// =============================================================================

/// The global precomputed transition table.
///
/// Lazily initialized on first access.
pub static TRANSITION_TABLE: LazyLock<TransitionTable> = LazyLock::new(TransitionTable::build);

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::keep::KeepPattern;

    #[test]
    fn test_table_builds() {
        let table = TransitionTable::build();
        assert!(table.state_count() > 0);
        assert!(table.entry_count() > 0);
    }

    #[test]
    fn test_keep_all_transitions_to_self() {
        let table = &*TRANSITION_TABLE;

        // Keeping all 5 dice should have exactly one transition: to the same config
        let config = DiceConfig::from_dice(&[1, 2, 3, 4, 5]);
        let keep = KeepPattern::keep_all(&config);
        let partial = PartialDice::new(config, keep).unwrap();

        let entries = table.get(&partial);
        assert_eq!(entries.len(), 1);
        assert!((entries[0].probability.get() - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_keep_none_gives_252_targets() {
        let table = &*TRANSITION_TABLE;

        // Keeping nothing: all 252 configs are reachable
        let partial = PartialDice::keep_none();

        let entries = table.get(&partial);
        assert_eq!(entries.len(), 252);

        // Probabilities should sum to 1
        let total: f64 = entries.iter().map(|e| e.probability.get()).sum();
        assert!((total - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_expected_value_matches_direct() {
        let table = &*TRANSITION_TABLE;

        // Compare table-based EV with direct calculation
        let config = DiceConfig::from_dice(&[3, 3, 4, 5, 6]);
        let keep = KeepPattern::from_counts([0, 0, 2, 0, 0, 0]).unwrap(); // Keep 3s
        let partial = PartialDice::new(config, keep).unwrap();

        // EV of dice sum
        let ev = table.expected_value(&partial, |c| c.sum() as f64);

        // Kept: 6 (two 3s). Rolling 3 dice, each has E[value] = 3.5
        // E[total] = 6 + 3 × 3.5 = 16.5
        assert!((ev - 16.5).abs() < 0.01);
    }
}
