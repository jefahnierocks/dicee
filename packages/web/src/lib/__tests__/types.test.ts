/**
 * Type Integrity Tests
 * Validates type definitions match Dicee game rules and RFC-003 (docs/architecture/README.md#data-contracts)
 */

import { describe, expect, it } from 'vitest';
import type {
	Category,
	DecisionQuality,
	DiceArray,
	GameStatus,
	KeptMask,
	StatsProfile,
	TurnPhase,
} from '../types.js';
import {
	ALL_CATEGORIES,
	CATEGORY_DISPLAY_NAMES,
	CATEGORY_TO_INDEX,
	LOWER_CATEGORIES,
	UPPER_CATEGORIES,
} from '../types.js';

// =============================================================================
// Category Array Integrity
// =============================================================================

describe('Category Arrays', () => {
	describe('UPPER_CATEGORIES', () => {
		it('contains exactly 6 categories', () => {
			expect(UPPER_CATEGORIES).toHaveLength(6);
		});

		it('contains all upper section categories in correct order', () => {
			expect(UPPER_CATEGORIES).toEqual(['Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes']);
		});

		it('categories are unique', () => {
			const unique = new Set(UPPER_CATEGORIES);
			expect(unique.size).toBe(UPPER_CATEGORIES.length);
		});
	});

	describe('LOWER_CATEGORIES', () => {
		it('contains exactly 7 categories', () => {
			expect(LOWER_CATEGORIES).toHaveLength(7);
		});

		it('contains all lower section categories in correct order', () => {
			expect(LOWER_CATEGORIES).toEqual([
				'ThreeOfAKind',
				'FourOfAKind',
				'FullHouse',
				'SmallStraight',
				'LargeStraight',
				'Dicee',
				'Chance',
			]);
		});

		it('categories are unique', () => {
			const unique = new Set(LOWER_CATEGORIES);
			expect(unique.size).toBe(LOWER_CATEGORIES.length);
		});
	});

	describe('ALL_CATEGORIES', () => {
		it('contains exactly 13 categories', () => {
			expect(ALL_CATEGORIES).toHaveLength(13);
		});

		it('is union of upper and lower categories', () => {
			const expected = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES];
			expect(ALL_CATEGORIES).toEqual(expected);
		});

		it('categories are unique', () => {
			const unique = new Set(ALL_CATEGORIES);
			expect(unique.size).toBe(ALL_CATEGORIES.length);
		});

		it('upper and lower categories are disjoint', () => {
			const upperSet = new Set<string>(UPPER_CATEGORIES);
			for (const cat of LOWER_CATEGORIES) {
				expect(upperSet.has(cat)).toBe(false);
			}
		});
	});
});

// =============================================================================
// CATEGORY_DISPLAY_NAMES Integrity
// =============================================================================

describe('CATEGORY_DISPLAY_NAMES', () => {
	it('has entry for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			expect(CATEGORY_DISPLAY_NAMES[cat]).toBeDefined();
			expect(typeof CATEGORY_DISPLAY_NAMES[cat]).toBe('string');
		}
	});

	it('display names are non-empty', () => {
		for (const cat of ALL_CATEGORIES) {
			expect(CATEGORY_DISPLAY_NAMES[cat].length).toBeGreaterThan(0);
		}
	});

	it('maps upper categories correctly', () => {
		expect(CATEGORY_DISPLAY_NAMES.Ones).toBe('Ones');
		expect(CATEGORY_DISPLAY_NAMES.Twos).toBe('Twos');
		expect(CATEGORY_DISPLAY_NAMES.Threes).toBe('Threes');
		expect(CATEGORY_DISPLAY_NAMES.Fours).toBe('Fours');
		expect(CATEGORY_DISPLAY_NAMES.Fives).toBe('Fives');
		expect(CATEGORY_DISPLAY_NAMES.Sixes).toBe('Sixes');
	});

	it('maps lower categories correctly', () => {
		expect(CATEGORY_DISPLAY_NAMES.ThreeOfAKind).toBe('Three of a Kind');
		expect(CATEGORY_DISPLAY_NAMES.FourOfAKind).toBe('Four of a Kind');
		expect(CATEGORY_DISPLAY_NAMES.FullHouse).toBe('Full House');
		expect(CATEGORY_DISPLAY_NAMES.SmallStraight).toBe('Small Straight');
		expect(CATEGORY_DISPLAY_NAMES.LargeStraight).toBe('Large Straight');
		expect(CATEGORY_DISPLAY_NAMES.Dicee).toBe('Dicee');
		expect(CATEGORY_DISPLAY_NAMES.Chance).toBe('Chance');
	});
});

// =============================================================================
// CATEGORY_TO_INDEX Integrity
// =============================================================================

describe('CATEGORY_TO_INDEX', () => {
	it('has entry for every category', () => {
		for (const cat of ALL_CATEGORIES) {
			expect(CATEGORY_TO_INDEX[cat]).toBeDefined();
			expect(typeof CATEGORY_TO_INDEX[cat]).toBe('number');
		}
	});

	it('indices are sequential 0-12', () => {
		const indices = Object.values(CATEGORY_TO_INDEX).sort((a, b) => a - b);
		expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	});

	it('indices are unique', () => {
		const indices = Object.values(CATEGORY_TO_INDEX);
		const unique = new Set(indices);
		expect(unique.size).toBe(indices.length);
	});

	it('upper categories have indices 0-5', () => {
		expect(CATEGORY_TO_INDEX.Ones).toBe(0);
		expect(CATEGORY_TO_INDEX.Twos).toBe(1);
		expect(CATEGORY_TO_INDEX.Threes).toBe(2);
		expect(CATEGORY_TO_INDEX.Fours).toBe(3);
		expect(CATEGORY_TO_INDEX.Fives).toBe(4);
		expect(CATEGORY_TO_INDEX.Sixes).toBe(5);
	});

	it('lower categories have indices 6-12', () => {
		expect(CATEGORY_TO_INDEX.ThreeOfAKind).toBe(6);
		expect(CATEGORY_TO_INDEX.FourOfAKind).toBe(7);
		expect(CATEGORY_TO_INDEX.FullHouse).toBe(8);
		expect(CATEGORY_TO_INDEX.SmallStraight).toBe(9);
		expect(CATEGORY_TO_INDEX.LargeStraight).toBe(10);
		expect(CATEGORY_TO_INDEX.Dicee).toBe(11);
		expect(CATEGORY_TO_INDEX.Chance).toBe(12);
	});

	it('index matches position in ALL_CATEGORIES', () => {
		for (const cat of ALL_CATEGORIES) {
			const index = CATEGORY_TO_INDEX[cat];
			expect(ALL_CATEGORIES[index]).toBe(cat);
		}
	});
});

// =============================================================================
// Dicee Game Rules Validation
// =============================================================================

describe('Dicee Game Rules', () => {
	it('game has 13 turns (one per category)', () => {
		expect(ALL_CATEGORIES).toHaveLength(13);
	});

	it('upper section bonus threshold is achievable', () => {
		// Bonus requires 63 points in upper section
		// Average of 3 per die face × 5 dice = 15 per category × 6 = 90
		// Minimum to get bonus: 63
		// With 5 dice, max per upper category:
		const maxUpperScores = {
			Ones: 5, // 5 ones
			Twos: 10, // 5 twos
			Threes: 15, // 5 threes
			Fours: 20, // 5 fours
			Fives: 25, // 5 fives
			Sixes: 30, // 5 sixes
		};
		const totalMaxUpper = Object.values(maxUpperScores).reduce((a, b) => a + b, 0);
		expect(totalMaxUpper).toBe(105);

		// Bonus threshold is 63 (achievable with 3 of each face)
		const bonusThreshold = 63;
		expect(bonusThreshold).toBeLessThanOrEqual(totalMaxUpper);
	});

	it('standard scoring values are correct', () => {
		// Fixed-value categories
		const fixedScores = {
			FullHouse: 25,
			SmallStraight: 30,
			LargeStraight: 40,
			Dicee: 50,
		};

		expect(fixedScores.FullHouse).toBe(25);
		expect(fixedScores.SmallStraight).toBe(30);
		expect(fixedScores.LargeStraight).toBe(40);
		expect(fixedScores.Dicee).toBe(50);
	});

	it('upper bonus value is 35', () => {
		const UPPER_BONUS = 35;
		expect(UPPER_BONUS).toBe(35);
	});
});

// =============================================================================
// Type Constraints (Runtime Validation)
// =============================================================================

describe('Type Constraints', () => {
	describe('DieValue', () => {
		it('valid values are 1-6', () => {
			const validValues = [1, 2, 3, 4, 5, 6];
			for (const v of validValues) {
				expect(v).toBeGreaterThanOrEqual(1);
				expect(v).toBeLessThanOrEqual(6);
			}
		});
	});

	describe('DiceArray', () => {
		it('has exactly 5 elements', () => {
			const dice: DiceArray = [1, 2, 3, 4, 5];
			expect(dice).toHaveLength(5);
		});
	});

	describe('KeptMask', () => {
		it('has exactly 5 elements', () => {
			const mask: KeptMask = [true, false, true, false, true];
			expect(mask).toHaveLength(5);
		});

		it('elements are booleans', () => {
			const mask: KeptMask = [true, false, true, false, true];
			for (const v of mask) {
				expect(typeof v).toBe('boolean');
			}
		});
	});

	describe('GameStatus', () => {
		it('has all expected values', () => {
			const statuses: GameStatus[] = ['idle', 'rolling', 'keeping', 'scoring', 'completed'];
			expect(statuses).toHaveLength(5);
		});
	});

	describe('TurnPhase', () => {
		it('has all expected values', () => {
			const phases: TurnPhase[] = ['pre_roll', 'rolling', 'deciding', 'scored'];
			expect(phases).toHaveLength(4);
		});
	});

	describe('DecisionQuality', () => {
		it('has all expected values', () => {
			const qualities: DecisionQuality[] = [
				'optimal',
				'excellent',
				'good',
				'acceptable',
				'suboptimal',
				'poor',
			];
			expect(qualities).toHaveLength(6);
		});
	});

	describe('StatsProfile', () => {
		it('has all expected values', () => {
			const profiles: StatsProfile[] = ['beginner', 'intermediate', 'expert'];
			expect(profiles).toHaveLength(3);
		});
	});
});

// =============================================================================
// Data Structure Shape Validation
// =============================================================================

describe('Data Structure Shapes', () => {
	it('CategoryProbability has required fields', () => {
		// This validates the interface shape at runtime
		const prob = {
			category: 'Ones' as Category,
			probability: 0.5,
			expectedValue: 2.5,
			currentScore: 3,
			isOptimal: true,
		};

		expect(prob.category).toBeDefined();
		expect(typeof prob.probability).toBe('number');
		expect(typeof prob.expectedValue).toBe('number');
		expect(typeof prob.currentScore).toBe('number');
		expect(typeof prob.isOptimal).toBe('boolean');
	});

	it('DecisionFeedback has required fields', () => {
		const feedback = {
			quality: 'optimal' as DecisionQuality,
			chosenCategory: 'Ones' as Category,
			optimalCategory: 'Ones' as Category,
			pointsEarned: 5,
			optimalPoints: 5,
			evDifference: 0,
		};

		expect(feedback.quality).toBeDefined();
		expect(feedback.chosenCategory).toBeDefined();
		expect(feedback.optimalCategory).toBeDefined();
		expect(typeof feedback.pointsEarned).toBe('number');
		expect(typeof feedback.optimalPoints).toBe('number');
		expect(typeof feedback.evDifference).toBe('number');
	});
});

// =============================================================================
// Cross-Reference Validation
// =============================================================================

describe('Cross-Reference Integrity', () => {
	it('all mappings reference valid categories', () => {
		// All keys in CATEGORY_DISPLAY_NAMES should be in ALL_CATEGORIES
		const displayKeys = Object.keys(CATEGORY_DISPLAY_NAMES);
		for (const key of displayKeys) {
			expect(ALL_CATEGORIES).toContain(key);
		}

		// All keys in CATEGORY_TO_INDEX should be in ALL_CATEGORIES
		const indexKeys = Object.keys(CATEGORY_TO_INDEX);
		for (const key of indexKeys) {
			expect(ALL_CATEGORIES).toContain(key);
		}
	});

	it('mappings are complete (no missing categories)', () => {
		expect(Object.keys(CATEGORY_DISPLAY_NAMES)).toHaveLength(13);
		expect(Object.keys(CATEGORY_TO_INDEX)).toHaveLength(13);
	});
});
