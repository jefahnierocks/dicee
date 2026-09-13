/**
 * Adaptive Personality Brain Implementation
 *
 * Phase-aware decision-making that adapts strategy based on:
 * - Game phase (early/mid/late)
 * - Score differential (ahead/behind)
 * - Upper bonus viability
 * - Category scarcity
 *
 * Key insight from simulations: Don't lock into strategies.
 * Evaluate each decision independently, but bias based on situation.
 */

import type { Category, KeptMask } from '../../game';
import { calculateAllPotentialScores, getRemainingCategories } from '../../game';
import { createLogger, type Logger } from '../../lib/logger';
import type { AIProfile, AITraits, GameContext, TurnDecision } from '../types';
import { OptimalBrain } from './optimal';
import type { AIBrain } from './types';

/**
 * Game phase based on round number
 */
type GamePhase = 'early' | 'mid' | 'late';

/**
 * Competitive position based on score differential
 */
type CompetitivePosition = 'leading' | 'tied' | 'behind' | 'far_behind';

/**
 * Adaptive personality brain - situation-aware decisions.
 *
 * Unlike fixed phase-shifting (which underperforms), this brain
 * evaluates each decision with awareness of game state, modifying
 * trait influence rather than committing to strategies.
 */
export class AdaptivePersonalityBrain implements AIBrain {
	readonly type = 'adaptive';
	private profile: AIProfile | null = null;
	private baseTraits: AITraits | null = null;
	private optimalBrain: OptimalBrain;
	private logger: Logger;

	constructor() {
		this.optimalBrain = new OptimalBrain(false);
		this.logger = createLogger({ component: 'AdaptiveBrain' });
	}

	async initialize(profile: AIProfile): Promise<void> {
		this.profile = profile;
		this.baseTraits = { ...profile.traits }; // Copy base traits
		await this.optimalBrain.initialize(profile);
	}

	async decide(context: GameContext): Promise<TurnDecision> {
		if (!this.profile || !this.baseTraits) {
			throw new Error('Brain not initialized');
		}

		// CRITICAL: If no dice exist yet, must roll first
		// Dice are null/undefined at turn start before first roll
		// This must be checked BEFORE any dice-dependent calculations
		const hasValidDice =
			context.dice && context.dice.length === 5 && context.dice.some((d) => d >= 1 && d <= 6);

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

		// Calculate situational modifiers
		const phase = this.getGamePhase(context);
		const position = this.getCompetitivePosition(context);
		const upperBonusViable = this.isUpperBonusViable(context);

		// Get adaptive traits based on situation
		const adaptiveTraits = this.calculateAdaptiveTraits(
			this.baseTraits,
			phase,
			position,
			upperBonusViable,
			context,
		);

		// Get optimal decision as baseline
		const optimalDecision = await this.optimalBrain.decide(context);

		// Apply adaptive trait modifications
		const modifiedDecision = this.applyAdaptiveTraits(
			context,
			optimalDecision,
			adaptiveTraits,
			phase,
			position,
		);

		// Apply skill-based noise
		return this.applySkillNoise(modifiedDecision);
	}

	estimateThinkingTime(context: GameContext, profile: AIProfile): number {
		const baseTime = this.optimalBrain.estimateThinkingTime(context, profile);

		// Late game = more thinking, behind = more deliberation
		const phase = this.getGamePhase(context);
		const position = this.getCompetitivePosition(context);

		let multiplier = 0.5 + profile.traits.thinkingTime;

		if (phase === 'late') multiplier *= 1.2;
		if (position === 'far_behind') multiplier *= 1.3;

		return baseTime * multiplier;
	}

	dispose(): void {
		this.profile = null;
		this.baseTraits = null;
		this.optimalBrain.dispose();
	}

	// ========================================================================
	// Phase and Position Detection
	// ========================================================================

	private getGamePhase(context: GameContext): GamePhase {
		if (context.round <= 4) return 'early';
		if (context.round <= 9) return 'mid';
		return 'late';
	}

	private getCompetitivePosition(context: GameContext): CompetitivePosition {
		const diff = context.scoreDifferential;

		if (diff > 20) return 'leading';
		if (diff >= -10) return 'tied';
		if (diff >= -30) return 'behind';
		return 'far_behind';
	}

	private isUpperBonusViable(context: GameContext): boolean {
		const upperCats = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;
		let upperSum = 0;
		let upperRemaining = 0;

		for (const cat of upperCats) {
			const val = context.scorecard[cat];
			if (val !== null && val !== undefined) {
				upperSum += val as number;
			} else {
				upperRemaining++;
			}
		}

		// Need 63 for bonus. Check if achievable with average performance.
		// Average per upper category is faceValue × 3 (e.g., 12 for fours)
		const avgPerRemaining =
			upperRemaining > 0
				? (3 + 6 + 9 + 12 + 15 + 18) / 6 // Average of all targets
				: 0;

		const projectedTotal = upperSum + upperRemaining * avgPerRemaining * 0.7;
		return projectedTotal >= 63;
	}

	// ========================================================================
	// Adaptive Trait Calculation
	// ========================================================================

	/**
	 * Calculate situation-aware trait values.
	 *
	 * Key learnings from simulations:
	 * - Don't over-commit to Dicee chase (Liam paradox)
	 * - Balance upper/lower (specialization fails)
	 * - Increase risk only when behind (conservative-to-aggressive pattern)
	 * - Protect Chance for endgame
	 */
	private calculateAdaptiveTraits(
		baseTraits: AITraits,
		phase: GamePhase,
		position: CompetitivePosition,
		upperBonusViable: boolean,
		context: GameContext,
	): AITraits {
		const traits: AITraits = { ...baseTraits };

		// ======== Phase-based modifications ========

		if (phase === 'early') {
			// Early game: slightly more willing to roll, explore options
			traits.usesAllRolls = Math.min(1, baseTraits.usesAllRolls + 0.1);

			// Don't chase Dicee too hard early (learned from Liam paradox)
			traits.diceeChaser = Math.max(0.2, baseTraits.diceeChaser - 0.2);
		}

		if (phase === 'mid') {
			// Mid game: focus on upper bonus if viable
			if (upperBonusViable) {
				traits.upperSectionFocus = Math.min(1, baseTraits.upperSectionFocus + 0.2);
			} else {
				// Upper bonus not viable - shift to lower section strategy
				traits.upperSectionFocus = Math.max(0, baseTraits.upperSectionFocus - 0.3);
				traits.diceeChaser = Math.min(1, baseTraits.diceeChaser + 0.1);
			}
		}

		if (phase === 'late') {
			// Late game: play more conservatively by default
			traits.riskTolerance = Math.max(0, baseTraits.riskTolerance - 0.15);
			traits.usesAllRolls = Math.max(0, baseTraits.usesAllRolls - 0.2);

			// Only chase Dicee if we have 4+ of a kind
			const counts = this.countDice(context.dice);
			const maxCount = Math.max(...counts.slice(1));
			if (maxCount < 4) {
				traits.diceeChaser = Math.max(0.1, traits.diceeChaser - 0.3);
			}
		}

		// ======== Position-based modifications ========

		if (position === 'leading') {
			// Ahead: play safe, don't take unnecessary risks
			traits.riskTolerance = Math.max(0.2, traits.riskTolerance - 0.2);
			traits.diceeChaser = Math.max(0.2, traits.diceeChaser - 0.15);
		}

		if (position === 'behind') {
			// Slightly behind: small increase in risk tolerance
			traits.riskTolerance = Math.min(0.8, traits.riskTolerance + 0.1);
		}

		if (position === 'far_behind') {
			// Far behind: need to take calculated risks
			traits.riskTolerance = Math.min(0.9, traits.riskTolerance + 0.25);
			traits.diceeChaser = Math.min(0.9, traits.diceeChaser + 0.2);

			// But still don't abandon upper section entirely
			if (upperBonusViable) {
				traits.upperSectionFocus = Math.min(0.8, traits.upperSectionFocus + 0.1);
			}
		}

		return traits;
	}

	// ========================================================================
	// Adaptive Trait Application
	// ========================================================================

	private applyAdaptiveTraits(
		context: GameContext,
		decision: TurnDecision,
		traits: AITraits,
		phase: GamePhase,
		position: CompetitivePosition,
	): TurnDecision {
		// Check for Dicee chasing (with phase-aware threshold)
		if (this.shouldChaseDicee(context, decision, traits, phase)) {
			return this.chaseDicee(context);
		}

		// Check for risk-influenced decisions
		if (this.shouldTakeRisk(context, decision, traits, position)) {
			return this.takeRiskyAction(context, decision);
		}

		// Check for upper section focus
		if (this.shouldFocusUpper(context, decision, traits)) {
			return this.focusUpperSection(context, decision);
		}

		// Protect Chance for endgame (learned principle)
		if (this.shouldProtectChance(context, decision, phase)) {
			return this.findAlternativeToChance(context, decision);
		}

		// Check for "use all rolls" tendency
		if (this.shouldKeepRolling(context, decision, traits)) {
			return {
				action: 'roll',
				reasoning: 'Still exploring options...',
				confidence: 0.6,
			};
		}

		return decision;
	}

	private shouldChaseDicee(
		context: GameContext,
		_decision: TurnDecision,
		traits: AITraits,
		phase: GamePhase,
	): boolean {
		// Already scored Dicee
		if (context.scorecard.dicee !== null) {
			return false;
		}

		const counts = this.countDice(context.dice);
		const maxCount = Math.max(...counts.slice(1));

		// Phase-aware threshold (learned from Liam paradox)
		// Early: need 4+ to chase (don't waste early rounds)
		// Mid: 3+ if high trait, 4+ otherwise
		// Late: only 4+ (too risky otherwise)
		let threshold: number;
		if (phase === 'early') {
			threshold = 4;
		} else if (phase === 'late') {
			threshold = 4;
		} else {
			threshold = traits.diceeChaser > 0.6 ? 3 : 4;
		}

		if (maxCount >= threshold && context.rollsRemaining > 0) {
			return Math.random() < traits.diceeChaser;
		}

		return false;
	}

	private chaseDicee(context: GameContext): TurnDecision {
		const counts = this.countDice(context.dice);

		let bestValue = 1;
		let bestCount = 0;
		for (let v = 1; v <= 6; v++) {
			if (counts[v] > bestCount) {
				bestCount = counts[v];
				bestValue = v;
			}
		}

		const keepMask: KeptMask = [false, false, false, false, false];
		for (let i = 0; i < 5; i++) {
			if (context.dice[i] === bestValue) {
				keepMask[i] = true;
			}
		}

		if (bestCount === 5) {
			const remaining = getRemainingCategories(context.scorecard);
			if (remaining.includes('dicee')) {
				return {
					action: 'score',
					category: 'dicee' as Category,
					reasoning: 'DICEE! Perfect roll!',
					confidence: 1.0,
				};
			}
		}

		return {
			action: 'keep',
			keepMask,
			reasoning: `Chasing Dicee - need ${5 - bestCount} more`,
			confidence: 0.7,
		};
	}

	private shouldTakeRisk(
		context: GameContext,
		decision: TurnDecision,
		traits: AITraits,
		position: CompetitivePosition,
	): boolean {
		if (decision.action === 'score' && context.rollsRemaining > 0) {
			const scores = calculateAllPotentialScores(
				context.dice as [number, number, number, number, number],
			);
			const score = scores[decision.category as keyof typeof scores] || 0;

			// Position-aware risk threshold
			// Leading: only risk on low scores
			// Behind: risk on medium scores too
			let scoreThreshold = 25;
			if (position === 'behind') scoreThreshold = 20;
			if (position === 'far_behind') scoreThreshold = 15;

			if (score < scoreThreshold) {
				const riskProbability = traits.riskTolerance * (position === 'far_behind' ? 1.2 : 0.8);
				return Math.random() < riskProbability - 0.5;
			}
		}

		return false;
	}

	private takeRiskyAction(_context: GameContext, _decision: TurnDecision): TurnDecision {
		return {
			action: 'roll',
			reasoning: 'Taking a calculated risk!',
			confidence: 0.5,
		};
	}

	private shouldFocusUpper(
		context: GameContext,
		_decision: TurnDecision,
		traits: AITraits,
	): boolean {
		const upperCats = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];
		let upperSum = 0;
		let upperRemaining = 0;

		for (const cat of upperCats) {
			const val = context.scorecard[cat as keyof typeof context.scorecard];
			if (val !== null && val !== undefined) {
				upperSum += val as number;
			} else {
				upperRemaining++;
			}
		}

		const needForBonus = 63 - upperSum;
		if (needForBonus > 0 && upperRemaining > 0 && traits.upperSectionFocus > 0.5) {
			// Check if current dice would give good upper score
			const scores = calculateAllPotentialScores(
				context.dice as [number, number, number, number, number],
			);

			const avgNeeded = needForBonus / upperRemaining;
			for (const cat of upperCats) {
				const remaining = getRemainingCategories(context.scorecard);
				if (remaining.includes(cat as Category)) {
					const score = scores[cat as keyof typeof scores] || 0;
					if (score >= avgNeeded) {
						return Math.random() < traits.upperSectionFocus;
					}
				}
			}
		}

		return false;
	}

	private focusUpperSection(context: GameContext, decision: TurnDecision): TurnDecision {
		const remaining = getRemainingCategories(context.scorecard);
		const scores = calculateAllPotentialScores(
			context.dice as [number, number, number, number, number],
		);
		const upperCats: Category[] = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'];

		let bestCat: Category | null = null;
		let bestScore = 0;

		for (const cat of upperCats) {
			if (remaining.includes(cat)) {
				const score = scores[cat as keyof typeof scores] || 0;
				// Only consider if at least face value × 2 (decent score)
				const faceValue = upperCats.indexOf(cat) + 1;
				if (score >= faceValue * 2 && score > bestScore) {
					bestScore = score;
					bestCat = cat;
				}
			}
		}

		if (bestCat !== null) {
			return {
				action: 'score',
				category: bestCat,
				reasoning: 'Building upper section bonus',
				confidence: 0.75,
			};
		}

		return decision;
	}

	/**
	 * Protect Chance for endgame (key strategic principle)
	 * Don't use Chance before round 8 unless forced or high-scoring
	 */
	private shouldProtectChance(
		context: GameContext,
		decision: TurnDecision,
		phase: GamePhase,
	): boolean {
		if (decision.action !== 'score') return false;
		if (decision.category !== 'chance') return false;
		if (context.scorecard.chance !== null) return false; // Already used

		// In late game, Chance is fair game
		if (phase === 'late') return false;

		// Calculate dice total
		const total = context.dice.reduce((a, b) => a + b, 0);

		// Allow Chance if very high scoring (25+)
		if (total >= 25) return false;

		// Otherwise, try to find an alternative
		return true;
	}

	private findAlternativeToChance(context: GameContext, decision: TurnDecision): TurnDecision {
		const remaining = getRemainingCategories(context.scorecard);
		const scores = calculateAllPotentialScores(
			context.dice as [number, number, number, number, number],
		);

		// Find best non-Chance option
		let bestCat: Category | null = null;
		let bestScore = -1;

		for (const cat of remaining) {
			if (cat === 'chance') continue;
			const score = scores[cat as keyof typeof scores] || 0;
			if (score > bestScore) {
				bestScore = score;
				bestCat = cat;
			}
		}

		// If we have any non-zero alternative, use it
		if (bestCat !== null && bestScore > 0) {
			return {
				action: 'score',
				category: bestCat,
				reasoning: 'Saving Chance for later',
				confidence: 0.65,
			};
		}

		// If we have rolls left, try rolling again
		if (context.rollsRemaining > 0) {
			return {
				action: 'roll',
				reasoning: 'Looking for a better option',
				confidence: 0.5,
			};
		}

		// Forced to use Chance or zero something
		return decision;
	}

	private shouldKeepRolling(
		context: GameContext,
		decision: TurnDecision,
		traits: AITraits,
	): boolean {
		if (decision.action === 'score' && context.rollsRemaining > 0) {
			// Reduced tendency compared to base personality brain
			return Math.random() < traits.usesAllRolls * 0.3;
		}

		return false;
	}

	// ========================================================================
	// Skill Noise
	// ========================================================================

	private applySkillNoise(decision: TurnDecision): TurnDecision {
		const skillLevel = this.profile?.skillLevel ?? 1.0;

		if (Math.random() > skillLevel) {
			if (decision.action === 'keep' && decision.keepMask) {
				const newKeep: KeptMask = [...decision.keepMask];
				const flipIndex = Math.floor(Math.random() * 5);

				if (Math.random() < 0.25) {
					newKeep[flipIndex] = !newKeep[flipIndex];
					return {
						...decision,
						keepMask: newKeep,
						confidence: (decision.confidence || 0.5) * 0.8,
					};
				}
			}
		}

		return decision;
	}

	// ========================================================================
	// Utility
	// ========================================================================

	private countDice(dice: readonly number[]): number[] {
		const counts = [0, 0, 0, 0, 0, 0, 0];
		for (const d of dice) {
			counts[d]++;
		}
		return counts;
	}
}
