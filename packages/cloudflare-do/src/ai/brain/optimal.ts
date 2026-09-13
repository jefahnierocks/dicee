/**
 * Optimal Brain Implementation
 *
 * Uses expected value (EV) calculations for decision-making.
 * Can use WASM engine for precise EV or TypeScript heuristics as fallback.
 */

import type { Category, KeptMask, Scorecard } from '../../game';
import { calculateAllPotentialScores, getRemainingCategories } from '../../game';
import { createLogger, type Logger } from '../../lib/logger';
import type { AIProfile, GameContext, TurnDecision } from '../types';
import type { AIBrain, CategoryEV, KeepAnalysis } from './types';

// Upper section bonus threshold
const UPPER_BONUS_THRESHOLD = 63;
const _UPPER_BONUS_VALUE = 35;

// Category to dice value mapping for upper section
const UPPER_CATEGORY_VALUES: Record<string, number> = {
	ones: 1,
	twos: 2,
	threes: 3,
	fours: 4,
	fives: 5,
	sixes: 6,
};

/**
 * Optimal brain - maximizes expected value.
 *
 * Uses WASM engine for precise calculations when available,
 * falls back to TypeScript heuristics otherwise.
 */
export class OptimalBrain implements AIBrain {
	readonly type = 'optimal';
	private useWasm: boolean;
	private logger: Logger;

	constructor(useWasm = false) {
		this.useWasm = useWasm;
		this.logger = createLogger({ component: 'OptimalBrain' });
	}

	async initialize(_profile: AIProfile): Promise<void> {
		if (this.useWasm) {
			// TODO: Initialize WASM engine (ai-3 spike)
			// For now, fall back to TypeScript
			this.useWasm = false;
		}
	}

	async decide(context: GameContext): Promise<TurnDecision> {
		// CRITICAL: If no dice exist yet, must roll first
		// Dice are null/undefined at turn start before first roll
		const hasValidDice =
			context.dice && context.dice.length === 5 && context.dice.some((d) => d >= 1 && d <= 6);
		this.logger.debug('Decision request', {
			operation: 'brain_decide',
			hasValidDice,
			rollsRemaining: context.rollsRemaining,
		});

		if (!hasValidDice) {
			this.logger.debug('No valid dice - returning roll action', {
				operation: 'brain_decide_no_dice',
			});
			return {
				action: 'roll',
				reasoning: 'No dice yet - must roll first',
				confidence: 1.0,
			};
		}

		// If no rolls remaining, must score
		if (context.rollsRemaining === 0) {
			const scoreAnalysis = this.analyzeScore(context);
			return {
				action: 'score',
				category: scoreAnalysis.category as Category,
				reasoning: `Must score - choosing ${scoreAnalysis.category} for ${scoreAnalysis.immediateEV} points`,
				confidence: 0.95,
			};
		}

		// Calculate best action based on EV
		const keepAnalysis = this.analyzeKeep(context);
		const scoreAnalysis = this.analyzeScore(context);

		// Compare keeping dice vs scoring now
		const bestKeepEV = keepAnalysis.expectedValue;
		const bestScoreEV = scoreAnalysis.immediateEV;

		// If keeping and rolling is better, do that
		if (bestKeepEV > bestScoreEV && context.rollsRemaining > 0) {
			// If the best keep is keeping nothing, just roll
			const allFalse = keepAnalysis.keepMask.every((k) => !k);
			if (allFalse) {
				return {
					action: 'roll',
					reasoning: `Rolling for better EV (${bestKeepEV.toFixed(1)} vs ${bestScoreEV.toFixed(1)})`,
					confidence: 0.8,
				};
			}

			return {
				action: 'keep',
				keepMask: keepAnalysis.keepMask,
				reasoning: `Keeping for EV ${bestKeepEV.toFixed(1)} targeting ${keepAnalysis.targetCategory || 'best option'}`,
				confidence: 0.85,
			};
		}

		// Score now
		return {
			action: 'score',
			category: scoreAnalysis.category as Category,
			reasoning: `Scoring ${scoreAnalysis.category} for ${scoreAnalysis.immediateEV} points`,
			confidence: 0.9,
		};
	}

	estimateThinkingTime(context: GameContext, profile: AIProfile): number {
		const { timing } = profile;
		const remaining = getRemainingCategories(context.scorecard).length;

		// Base time depends on action type
		let base = context.rollsRemaining === 0 ? timing.scoreDecisionMs : timing.keepDecisionMs;

		// Longer thinking for more complex decisions (many categories remaining)
		if (remaining > 8) {
			base *= timing.thinkingMultiplier;
		}

		// Add some variance
		const variance = Math.random() * timing.varianceMs * 2 - timing.varianceMs;

		return Math.max(200, base + variance);
	}

	dispose(): void {
		// No resources to clean up
	}

	// ========================================================================
	// Keep Analysis
	// ========================================================================

	private analyzeKeep(context: GameContext): KeepAnalysis {
		const dice = context.dice;
		const remaining = getRemainingCategories(context.scorecard);

		// Best keep pattern found
		let bestKeep: KeptMask = [false, false, false, false, false];
		let bestEV = 0;
		let bestTarget: string | undefined;

		// Analyze keeping patterns for each remaining category
		for (const category of remaining) {
			const analysis = this.analyzeKeepForCategory(dice, category, context);
			if (analysis.expectedValue > bestEV) {
				bestEV = analysis.expectedValue;
				bestKeep = analysis.keepMask;
				bestTarget = category;
			}
		}

		return {
			keepMask: bestKeep,
			expectedValue: bestEV,
			targetCategory: bestTarget,
		};
	}

	private analyzeKeepForCategory(
		dice: readonly number[],
		category: string,
		context: GameContext,
	): KeepAnalysis {
		// Count dice values
		const counts = this.countDice(dice);

		// Different strategies based on category
		if (category in UPPER_CATEGORY_VALUES) {
			return this.analyzeUpperKeep(dice, counts, category, context);
		}

		switch (category) {
			case 'three_of_a_kind':
			case 'four_of_a_kind':
			case 'dicee':
				return this.analyzeOfAKindKeep(dice, counts, category);
			case 'full_house':
				return this.analyzeFullHouseKeep(dice, counts);
			case 'small_straight':
			case 'large_straight':
				return this.analyzeStraightKeep(dice, category);
			case 'chance':
				return this.analyzeChanceKeep(dice, counts);
			default:
				return { keepMask: [false, false, false, false, false], expectedValue: 0 };
		}
	}

	private analyzeUpperKeep(
		dice: readonly number[],
		counts: number[],
		category: string,
		context: GameContext,
	): KeepAnalysis {
		const targetValue = UPPER_CATEGORY_VALUES[category];
		const count = counts[targetValue];

		// Keep all dice matching the target value
		const keepMask: KeptMask = [false, false, false, false, false];
		for (let i = 0; i < 5; i++) {
			if (dice[i] === targetValue) {
				keepMask[i] = true;
			}
		}

		// EV is current score + expected additional dice
		const currentScore = count * targetValue;
		const rollsLeft = context.rollsRemaining;
		const diceToRoll = 5 - count;

		// Each re-rolled die has 1/6 chance of being the target
		const expectedAdditional = diceToRoll * (1 / 6) * targetValue * rollsLeft;

		return {
			keepMask,
			expectedValue: currentScore + expectedAdditional,
			targetCategory: category,
		};
	}

	private analyzeOfAKindKeep(
		dice: readonly number[],
		counts: number[],
		category: string,
	): KeepAnalysis {
		// Find the value with most occurrences
		let bestValue = 1;
		let bestCount = 0;

		for (let v = 1; v <= 6; v++) {
			// For X-of-a-kind, prefer higher values when counts are equal
			if (counts[v] > bestCount || (counts[v] === bestCount && v > bestValue)) {
				bestCount = counts[v];
				bestValue = v;
			}
		}

		// Keep all dice of the best value
		const keepMask: KeptMask = [false, false, false, false, false];
		for (let i = 0; i < 5; i++) {
			if (dice[i] === bestValue) {
				keepMask[i] = true;
			}
		}

		// Calculate EV based on category requirements
		const target = category === 'dicee' ? 5 : category === 'four_of_a_kind' ? 4 : 3;
		let ev = 0;

		if (bestCount >= target) {
			// Already have it
			ev = category === 'dicee' ? 50 : dice.reduce((a, b) => a + b, 0);
		} else {
			// Probability of achieving target
			const needed = target - bestCount;
			const prob = (1 / 6) ** needed;
			ev = prob * (category === 'dicee' ? 50 : bestValue * 5);
		}

		return { keepMask, expectedValue: ev, targetCategory: category };
	}

	private analyzeFullHouseKeep(dice: readonly number[], counts: number[]): KeepAnalysis {
		// Look for pairs and triples
		let tripleValue = 0;
		let pairValue = 0;

		for (let v = 6; v >= 1; v--) {
			if (counts[v] >= 3 && !tripleValue) tripleValue = v;
			else if (counts[v] >= 2 && !pairValue) pairValue = v;
		}

		const keepMask: KeptMask = [false, false, false, false, false];

		if (tripleValue && pairValue) {
			// Have a full house
			for (let i = 0; i < 5; i++) {
				keepMask[i] = true;
			}
			return { keepMask, expectedValue: 25, targetCategory: 'full_house' };
		}

		if (tripleValue) {
			// Keep the triple, hope for pair
			for (let i = 0; i < 5; i++) {
				if (dice[i] === tripleValue) keepMask[i] = true;
			}
			return { keepMask, expectedValue: 8, targetCategory: 'full_house' };
		}

		// Keep best pair
		let bestPair = 0;
		for (let v = 6; v >= 1; v--) {
			if (counts[v] >= 2) {
				bestPair = v;
				break;
			}
		}

		if (bestPair) {
			let kept = 0;
			for (let i = 0; i < 5 && kept < 2; i++) {
				if (dice[i] === bestPair) {
					keepMask[i] = true;
					kept++;
				}
			}
		}

		return { keepMask, expectedValue: 4, targetCategory: 'full_house' };
	}

	private analyzeStraightKeep(dice: readonly number[], category: string): KeepAnalysis {
		const unique = new Set(dice);
		const sorted = [...unique].sort((a, b) => a - b);

		const keepMask: KeptMask = [false, false, false, false, false];
		const isLarge = category === 'large_straight';

		// Find longest run
		let runStart = sorted[0];
		let runLength = 1;
		let bestRunStart = runStart;
		let bestRunLength = 1;

		for (let i = 1; i < sorted.length; i++) {
			if (sorted[i] === sorted[i - 1] + 1) {
				runLength++;
				if (runLength > bestRunLength) {
					bestRunLength = runLength;
					bestRunStart = runStart;
				}
			} else {
				runStart = sorted[i];
				runLength = 1;
			}
		}

		// Keep dice in the best run
		const runValues = new Set<number>();
		for (let v = bestRunStart; v < bestRunStart + bestRunLength; v++) {
			runValues.add(v);
		}

		for (let i = 0; i < 5; i++) {
			if (runValues.has(dice[i])) {
				keepMask[i] = true;
			}
		}

		// Calculate EV
		const target = isLarge ? 5 : 4;
		let ev = 0;

		if (bestRunLength >= target) {
			ev = isLarge ? 40 : 30;
		} else {
			// Rough probability estimate
			const needed = target - bestRunLength;
			ev = (isLarge ? 40 : 30) * 0.3 ** needed;
		}

		return { keepMask, expectedValue: ev, targetCategory: category };
	}

	private analyzeChanceKeep(dice: readonly number[], _counts: number[]): KeepAnalysis {
		// For chance, keep high dice (5s and 6s)
		const keepMask: KeptMask = [false, false, false, false, false];

		for (let i = 0; i < 5; i++) {
			if (dice[i] >= 5) {
				keepMask[i] = true;
			}
		}

		// EV is sum of kept dice + expected value of rerolls (3.5 avg)
		let keptSum = 0;
		let keptCount = 0;
		for (let i = 0; i < 5; i++) {
			if (keepMask[i]) {
				keptSum += dice[i];
				keptCount++;
			}
		}

		const expectedRolls = (5 - keptCount) * 3.5;

		return {
			keepMask,
			expectedValue: keptSum + expectedRolls,
			targetCategory: 'chance',
		};
	}

	// ========================================================================
	// Score Analysis
	// ========================================================================

	private analyzeScore(context: GameContext): CategoryEV {
		const scores = calculateAllPotentialScores(
			context.dice as [number, number, number, number, number],
		);
		const remaining = getRemainingCategories(context.scorecard);

		let bestCategory = remaining[0];
		let bestScore = 0;

		// Find highest scoring category
		for (const category of remaining) {
			const score = scores[category as keyof typeof scores] ?? 0;

			// Factor in upper bonus progress
			let adjustedScore = score;
			if (category in UPPER_CATEGORY_VALUES) {
				adjustedScore = this.adjustForUpperBonus(score, category, context.scorecard);
			}

			if (adjustedScore > bestScore) {
				bestScore = adjustedScore;
				bestCategory = category;
			}
		}

		return {
			category: bestCategory,
			immediateEV: bestScore,
			rollEV: 0, // Not calculated in score-only mode
			recommendation: 'score',
			confidence: 0.9,
		};
	}

	private adjustForUpperBonus(score: number, category: string, scorecard: Scorecard): number {
		// If we're close to upper bonus, value upper section scores more
		const upperCats = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;
		let upperSum = 0;

		for (const cat of upperCats) {
			const val = scorecard[cat as keyof Scorecard];
			if (typeof val === 'number') {
				upperSum += val;
			}
		}

		const remaining = UPPER_BONUS_THRESHOLD - upperSum;

		// If this category would help reach bonus, boost its value
		const isUpperCategory = (upperCats as readonly string[]).includes(category);
		if (remaining > 0 && isUpperCategory) {
			const targetValue = UPPER_CATEGORY_VALUES[category];
			const idealScore = targetValue * 3; // 3x is break-even for bonus

			if (score >= idealScore) {
				return score + 5; // Bonus for meeting upper section target
			}
		}

		return score;
	}

	// ========================================================================
	// Utility
	// ========================================================================

	private countDice(dice: readonly number[]): number[] {
		const counts = [0, 0, 0, 0, 0, 0, 0]; // Index 0 unused
		for (const d of dice) {
			counts[d]++;
		}
		return counts;
	}
}
