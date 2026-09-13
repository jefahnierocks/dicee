/**
 * Phase-Shifting Strategy Brain
 *
 * A brain that adapts its strategy based on game phase:
 * - Early (rounds 1-4): Greedy scoring, opportunistic
 * - Mid (rounds 5-9): Evaluate position, shift to appropriate strategy
 * - Late (rounds 10-13): Endgame optimization
 *
 * This tests the hypothesis that adaptive strategies outperform
 * static approaches.
 */

import type {
	SimulationBrain,
	SimulationContext,
	SimulationDecision,
	SimulationProfile,
} from './brain-adapter.js';
import type { DiceArray, KeptMask } from './game-simulator.js';
import { countDice, hasLargeStraight, hasNOfAKind, hasSmallStraight } from './seeded-dice.js';
import type { SeededRandom } from './seeded-random.js';

// Categories and their scoring functions
type Category =
	| 'ones'
	| 'twos'
	| 'threes'
	| 'fours'
	| 'fives'
	| 'sixes'
	| 'threeOfAKind'
	| 'fourOfAKind'
	| 'fullHouse'
	| 'smallStraight'
	| 'largeStraight'
	| 'dicee'
	| 'chance';

const UPPER_CATEGORIES: Category[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
const LOWER_CATEGORIES: Category[] = [
	'threeOfAKind',
	'fourOfAKind',
	'fullHouse',
	'smallStraight',
	'largeStraight',
	'dicee',
	'chance',
];

interface ScoringOption {
	category: Category;
	score: number;
}

/**
 * Calculate score for a category given dice
 */
function calculateScore(dice: DiceArray, category: Category): number {
	const counts = countDice(dice);
	const sum = dice.reduce((a: number, b: number) => a + b, 0);

	switch (category) {
		case 'ones':
			return dice.filter((d: number) => d === 1).length * 1;
		case 'twos':
			return dice.filter((d: number) => d === 2).length * 2;
		case 'threes':
			return dice.filter((d: number) => d === 3).length * 3;
		case 'fours':
			return dice.filter((d: number) => d === 4).length * 4;
		case 'fives':
			return dice.filter((d: number) => d === 5).length * 5;
		case 'sixes':
			return dice.filter((d: number) => d === 6).length * 6;
		case 'threeOfAKind':
			return hasNOfAKind(dice, 3) ? sum : 0;
		case 'fourOfAKind':
			return hasNOfAKind(dice, 4) ? sum : 0;
		case 'fullHouse': {
			const values = Array.from(counts.values());
			return values.includes(3) && values.includes(2) ? 25 : 0;
		}
		case 'smallStraight':
			return hasSmallStraight(dice) ? 30 : 0;
		case 'largeStraight':
			return hasLargeStraight(dice) ? 40 : 0;
		case 'dicee':
			return hasNOfAKind(dice, 5) ? 50 : 0;
		case 'chance':
			return sum;
	}
}

/**
 * Get all available scoring options for current dice
 */
function getAvailableScoringOptions(
	dice: DiceArray,
	scorecard: Record<string, number | null>,
): ScoringOption[] {
	const options: ScoringOption[] = [];
	const allCategories = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES];

	for (const category of allCategories) {
		if (scorecard[category] === undefined || scorecard[category] === null) {
			options.push({
				category,
				score: calculateScore(dice, category),
			});
		}
	}

	return options;
}

/**
 * Calculate upper section total from scorecard
 */
function getUpperSectionTotal(scorecard: Record<string, number | null>): number {
	return UPPER_CATEGORIES.reduce((sum, cat) => {
		const score = scorecard[cat];
		return sum + (score ?? 0);
	}, 0);
}

/**
 * Count remaining upper section categories
 */
function getRemainingUpperCategories(scorecard: Record<string, number | null>): number {
	return UPPER_CATEGORIES.filter((cat) => scorecard[cat] === undefined || scorecard[cat] === null)
		.length;
}

/**
 * Determine best dice to keep for a target
 */
function getBestKeepMask(
	dice: DiceArray,
	target: 'upper' | 'straight' | 'dicee' | 'fullhouse',
): KeptMask {
	const mask: KeptMask = [false, false, false, false, false];

	switch (target) {
		case 'upper': {
			// Keep highest value dice for upper section
			const maxVal = Math.max(...dice);
			for (let i = 0; i < 5; i++) {
				if (dice[i] === maxVal) mask[i] = true;
			}
			break;
		}
		case 'straight': {
			// Keep sequential dice
			const sorted = [...dice].sort((a, b) => a - b);
			const unique = [...new Set(sorted)];
			// Find longest sequence
			for (let i = 0; i < 5; i++) {
				if (unique.includes(dice[i])) {
					mask[i] = true;
				}
			}
			break;
		}
		case 'dicee': {
			// Keep most frequent value
			const counts = countDice(dice);
			let maxCount = 0;
			let targetVal = 0;
			counts.forEach((count, val) => {
				if (count > maxCount || (count === maxCount && val > targetVal)) {
					maxCount = count;
					targetVal = val;
				}
			});
			for (let i = 0; i < 5; i++) {
				if (dice[i] === targetVal) mask[i] = true;
			}
			break;
		}
		case 'fullhouse': {
			// Keep pairs/triples
			const counts = countDice(dice);
			const targetVals = Array.from(counts.entries())
				.filter(([_, count]) => count >= 2)
				.map(([val, _]) => val);
			for (let i = 0; i < 5; i++) {
				if (targetVals.includes(dice[i])) mask[i] = true;
			}
			break;
		}
	}

	return mask;
}

export type PhaseShiftingVariant =
	| 'greedy-to-strategic' // Start greedy, shift based on position
	| 'conservative-to-aggressive' // Start safe, get risky if behind
	| 'upper-first' // Prioritize upper section early
	| 'lower-first'; // Prioritize lower section early

export interface PhaseShiftingConfig {
	variant: PhaseShiftingVariant;
	shiftRound?: number; // When to evaluate and potentially shift (default: 5)
}

/**
 * Phase-Shifting Strategy Brain
 */
export class PhaseShiftingBrain implements SimulationBrain {
	readonly type = 'phase-shifting';
	private config: PhaseShiftingConfig;
	private rng: SeededRandom;

	constructor(rng: SeededRandom, config: PhaseShiftingConfig = { variant: 'greedy-to-strategic' }) {
		this.rng = rng;
		this.config = config;
	}

	async initialize(_profile: SimulationProfile): Promise<void> {
		// No initialization needed
	}

	async decide(context: SimulationContext): Promise<SimulationDecision> {
		const { dice, rollsRemaining, scorecard, round } = context;
		const _shiftRound = this.config.shiftRound ?? 5;

		// Determine current phase
		const phase = round <= 4 ? 'early' : round <= 9 ? 'mid' : 'late';

		// Get available options
		const options = getAvailableScoringOptions(dice, scorecard);
		if (options.length === 0) {
			// Shouldn't happen, but fallback
			return { action: 'score', category: 'chance', confidence: 0 };
		}

		// If no rolls remaining, must score
		if (rollsRemaining === 0) {
			return this.selectBestScore(options, scorecard, phase);
		}

		// Decide based on variant and phase
		switch (this.config.variant) {
			case 'greedy-to-strategic':
				return this.greedyToStrategicDecision(context, options, phase);

			case 'conservative-to-aggressive':
				return this.conservativeToAggressiveDecision(context, options, phase);

			case 'upper-first':
				return this.upperFirstDecision(context, options, phase);

			case 'lower-first':
				return this.lowerFirstDecision(context, options, phase);

			default:
				return this.greedyToStrategicDecision(context, options, phase);
		}
	}

	/**
	 * Greedy early, then strategic based on position
	 */
	private greedyToStrategicDecision(
		context: SimulationContext,
		options: ScoringOption[],
		phase: 'early' | 'mid' | 'late',
	): SimulationDecision {
		const { dice, rollsRemaining, scorecard } = context;

		if (phase === 'early') {
			// Greedy: take any score >= 20, else reroll
			const bestOption = options.reduce((best, opt) => (opt.score > best.score ? opt : best));

			if (bestOption.score >= 20) {
				return { action: 'score', category: bestOption.category, confidence: 0.8 };
			}

			// Reroll: keep best dice for current position
			const mask = this.getGreedyKeepMask(dice, options);
			return { action: 'keep', keepMask: mask, confidence: 0.6 };
		}

		if (phase === 'mid') {
			// Evaluate: can we still get upper bonus?
			const upperTotal = getUpperSectionTotal(scorecard);
			const remainingUpper = getRemainingUpperCategories(scorecard);
			const upperBonusViable = upperTotal + remainingUpper * 15 >= 63;

			if (upperBonusViable && remainingUpper > 0) {
				// Prioritize upper section
				const upperOptions = options.filter((o) => UPPER_CATEGORIES.includes(o.category));
				const bestUpper = upperOptions.reduce(
					(best, opt) => (opt.score > best.score ? opt : best),
					{ category: 'chance' as Category, score: -1 },
				);

				if (bestUpper.score >= 10) {
					return { action: 'score', category: bestUpper.category, confidence: 0.7 };
				}
			}

			// Otherwise take best available or reroll
			const bestOption = options.reduce((best, opt) => (opt.score > best.score ? opt : best));

			if (bestOption.score >= 15 || rollsRemaining === 0) {
				return { action: 'score', category: bestOption.category, confidence: 0.7 };
			}

			const mask = this.getStrategicKeepMask(dice, scorecard, options);
			return { action: 'keep', keepMask: mask, confidence: 0.6 };
		}

		// Late game: optimize remaining categories
		return this.lateGameDecision(context, options);
	}

	/**
	 * Conservative early, aggressive if behind
	 */
	private conservativeToAggressiveDecision(
		context: SimulationContext,
		options: ScoringOption[],
		phase: 'early' | 'mid' | 'late',
	): SimulationDecision {
		const { dice, rollsRemaining, scoreDifferential } = context;

		// Conservative: take safe scores early
		if (phase === 'early' || phase === 'mid') {
			const safeOptions = options.filter((o) => o.score >= 15);
			if (safeOptions.length > 0) {
				const best = safeOptions.reduce((b, o) => (o.score > b.score ? o : b));
				return { action: 'score', category: best.category, confidence: 0.8 };
			}

			if (rollsRemaining > 0) {
				const mask = getBestKeepMask(dice, 'upper');
				return { action: 'keep', keepMask: mask, confidence: 0.6 };
			}
		}

		// If behind in late game, get aggressive
		if (phase === 'late' && scoreDifferential < -20) {
			// Chase Dicee or large straight
			const diceeOpt = options.find((o) => o.category === 'dicee');
			const lsOpt = options.find((o) => o.category === 'largeStraight');

			if (diceeOpt && hasNOfAKind(dice, 4)) {
				if (rollsRemaining > 0) {
					return { action: 'keep', keepMask: getBestKeepMask(dice, 'dicee'), confidence: 0.7 };
				}
			}

			if (lsOpt && rollsRemaining > 0) {
				return { action: 'keep', keepMask: getBestKeepMask(dice, 'straight'), confidence: 0.6 };
			}
		}

		return this.lateGameDecision(context, options);
	}

	/**
	 * Upper section first strategy
	 */
	private upperFirstDecision(
		context: SimulationContext,
		options: ScoringOption[],
		phase: 'early' | 'mid' | 'late',
	): SimulationDecision {
		const { dice, rollsRemaining } = context;

		// Always prioritize upper section if available
		const upperOptions = options.filter((o) => UPPER_CATEGORIES.includes(o.category));

		if (upperOptions.length > 0) {
			const bestUpper = upperOptions.reduce((b, o) => (o.score > b.score ? o : b));

			// Take if >= face value * 2 (e.g., 8 for fours)
			const faceValue = UPPER_CATEGORIES.indexOf(bestUpper.category) + 1;
			if (bestUpper.score >= faceValue * 2) {
				return { action: 'score', category: bestUpper.category, confidence: 0.8 };
			}

			// Reroll to improve upper section if possible
			if (rollsRemaining > 0) {
				const mask = getBestKeepMask(dice, 'upper');
				return { action: 'keep', keepMask: mask, confidence: 0.6 };
			}
		}

		// Fall back to best available
		const bestOption = options.reduce((b, o) => (o.score > b.score ? o : b));
		return { action: 'score', category: bestOption.category, confidence: 0.5 };
	}

	/**
	 * Lower section first strategy
	 */
	private lowerFirstDecision(
		context: SimulationContext,
		options: ScoringOption[],
		phase: 'early' | 'mid' | 'late',
	): SimulationDecision {
		const { dice, rollsRemaining } = context;

		// Prioritize lower section
		const lowerOptions = options.filter((o) => LOWER_CATEGORIES.includes(o.category));

		if (lowerOptions.length > 0) {
			// Check for valuable lower section opportunities
			const diceeOpt = lowerOptions.find((o) => o.category === 'dicee' && o.score > 0);
			const lsOpt = lowerOptions.find((o) => o.category === 'largeStraight' && o.score > 0);
			const ssOpt = lowerOptions.find((o) => o.category === 'smallStraight' && o.score > 0);
			const fhOpt = lowerOptions.find((o) => o.category === 'fullHouse' && o.score > 0);

			// Take high-value lower section scores
			if (diceeOpt) return { action: 'score', category: 'dicee', confidence: 0.95 };
			if (lsOpt) return { action: 'score', category: 'largeStraight', confidence: 0.9 };
			if (fhOpt) return { action: 'score', category: 'fullHouse', confidence: 0.85 };
			if (ssOpt) return { action: 'score', category: 'smallStraight', confidence: 0.8 };

			// Chase straights if possible
			if (rollsRemaining > 0 && lowerOptions.find((o) => o.category === 'largeStraight')) {
				return { action: 'keep', keepMask: getBestKeepMask(dice, 'straight'), confidence: 0.6 };
			}
		}

		// Fall back
		const bestOption = options.reduce((b, o) => (o.score > b.score ? o : b));
		if (rollsRemaining > 0 && bestOption.score < 15) {
			return { action: 'keep', keepMask: getBestKeepMask(dice, 'dicee'), confidence: 0.5 };
		}
		return { action: 'score', category: bestOption.category, confidence: 0.5 };
	}

	/**
	 * Late game optimization
	 */
	private lateGameDecision(
		context: SimulationContext,
		options: ScoringOption[],
	): SimulationDecision {
		const { dice, rollsRemaining, scorecard } = context;

		// Sort by score descending
		const sorted = [...options].sort((a, b) => b.score - a.score);

		// If Chance is available and we have high dice total, consider saving it
		const _chanceOpt = options.find((o) => o.category === 'chance');
		const diceTotal = dice.reduce((a: number, b: number) => a + b, 0);

		// Take best score if good enough
		if (sorted[0].score >= 15 || rollsRemaining === 0) {
			// But avoid using Chance unless necessary or high scoring
			if (sorted[0].category === 'chance' && sorted.length > 1 && diceTotal < 22) {
				// Take second best if Chance would be wasted
				if (sorted[1].score > 0) {
					return { action: 'score', category: sorted[1].category, confidence: 0.7 };
				}
			}
			return { action: 'score', category: sorted[0].category, confidence: 0.8 };
		}

		// Reroll strategically
		const mask = this.getStrategicKeepMask(dice, scorecard, options);
		return { action: 'keep', keepMask: mask, confidence: 0.5 };
	}

	/**
	 * Select best score from options
	 */
	private selectBestScore(
		options: ScoringOption[],
		scorecard: Record<string, number | null>,
		phase: 'early' | 'mid' | 'late',
	): SimulationDecision {
		const sorted = [...options].sort((a, b) => b.score - a.score);
		return { action: 'score', category: sorted[0].category, confidence: 0.9 };
	}

	/**
	 * Greedy keep mask - keep dice that maximize current best option
	 */
	private getGreedyKeepMask(dice: DiceArray, options: ScoringOption[]): KeptMask {
		// Find category with highest potential
		const bestOpt = options.reduce((b, o) => (o.score > b.score ? o : b));

		if (UPPER_CATEGORIES.includes(bestOpt.category)) {
			const faceValue = UPPER_CATEGORIES.indexOf(bestOpt.category) + 1;
			const mask: KeptMask = [false, false, false, false, false];
			for (let i = 0; i < 5; i++) {
				if (dice[i] === faceValue) mask[i] = true;
			}
			return mask;
		}

		// Default: keep highest matching
		return getBestKeepMask(dice, 'dicee');
	}

	/**
	 * Strategic keep mask based on game state
	 */
	private getStrategicKeepMask(
		dice: DiceArray,
		scorecard: Record<string, number | null>,
		options: ScoringOption[],
	): KeptMask {
		// Check for partial straights
		if (options.find((o) => o.category === 'largeStraight' || o.category === 'smallStraight')) {
			const sorted = [...dice].sort((a, b) => a - b);
			const unique = new Set(sorted);
			if (unique.size >= 4) {
				return getBestKeepMask(dice, 'straight');
			}
		}

		// Check for n-of-a-kind
		const counts = countDice(dice);
		const maxCount = Math.max(...counts.values());
		if (maxCount >= 3) {
			return getBestKeepMask(dice, 'dicee');
		}

		// Check for pairs (full house potential)
		if (maxCount === 2) {
			const pairs = Array.from(counts.entries()).filter(([_, c]) => c >= 2);
			if (pairs.length >= 2) {
				return getBestKeepMask(dice, 'fullhouse');
			}
		}

		// Default: keep highest dice
		return getBestKeepMask(dice, 'upper');
	}

	dispose(): void {
		// No cleanup needed
	}
}

/**
 * Create a phase-shifting brain
 */
export function createPhaseShiftingBrain(
	rng: SeededRandom,
	variant: PhaseShiftingVariant = 'greedy-to-strategic',
): PhaseShiftingBrain {
	return new PhaseShiftingBrain(rng, { variant });
}
