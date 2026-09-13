/**
 * Headless Game Simulator
 *
 * Runs complete Dicee games without UI or timing delays.
 * Uses seeded RNG for deterministic, reproducible simulations.
 *
 * @example
 * const simulator = new GameSimulator({ seed: 42 });
 * const result = await simulator.runGame({
 *   players: [
 *     { id: 'p1', profileId: 'professor' },
 *     { id: 'p2', profileId: 'carmen' }
 *   ]
 * });
 */

import type {
	DecisionResult,
	GameResult,
	PlayerResult,
	SimulationConfig,
	TurnResult,
} from '../schemas/index.js';
import type {
	SimulationBrain,
	SimulationContext,
	SimulationDecision,
	SimulationProfile,
} from './brain-adapter.js';
import { BrainRngAdapter } from './brain-adapter.js';
import { KEEP_NONE, rerollDice, rollDice } from './seeded-dice.js';
import type { RandomSource } from './seeded-random.js';
import { SeededRandom } from './seeded-random.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Category type (matches @dicee/shared)
 */
export type Category =
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

const ALL_CATEGORIES: Category[] = [
	'ones',
	'twos',
	'threes',
	'fours',
	'fives',
	'sixes',
	'threeOfAKind',
	'fourOfAKind',
	'fullHouse',
	'smallStraight',
	'largeStraight',
	'dicee',
	'chance',
];

/**
 * Scorecard type (matches @dicee/shared)
 */
export interface Scorecard {
	ones: number | null;
	twos: number | null;
	threes: number | null;
	fours: number | null;
	fives: number | null;
	sixes: number | null;
	threeOfAKind: number | null;
	fourOfAKind: number | null;
	fullHouse: number | null;
	smallStraight: number | null;
	largeStraight: number | null;
	dicee: number | null;
	chance: number | null;
	diceeBonus: number;
	upperBonus: number;
}

/**
 * Dice array type
 */
export type DiceArray = [number, number, number, number, number];
export type KeptMask = [boolean, boolean, boolean, boolean, boolean];

/**
 * Player state during simulation
 */
interface PlayerState {
	id: string;
	profileId: string;
	profile: SimulationProfile;
	brain: SimulationBrain;
	scorecard: Scorecard;
	totalScore: number;
	diceeCount: number;
	optimalDecisions: number;
	totalDecisions: number;
	evLoss: number;
}

/**
 * Configuration for the game simulator
 */
export interface GameSimulatorConfig {
	/** Master seed for RNG (optional - random if not provided) */
	seed?: number;
	/** Whether to capture detailed turn/decision data */
	captureDecisions?: boolean;
	/** Brain factory function (can be async) */
	createBrain?: (profileId: string) => SimulationBrain | Promise<SimulationBrain>;
	/** Profile lookup function */
	getProfile?: (profileId: string) => SimulationProfile | undefined;
}

// =============================================================================
// Scoring Utilities
// =============================================================================

function createEmptyScorecard(): Scorecard {
	return {
		ones: null,
		twos: null,
		threes: null,
		fours: null,
		fives: null,
		sixes: null,
		threeOfAKind: null,
		fourOfAKind: null,
		fullHouse: null,
		smallStraight: null,
		largeStraight: null,
		dicee: null,
		chance: null,
		diceeBonus: 0,
		upperBonus: 0,
	};
}

function countValues(dice: DiceArray): Map<number, number> {
	const counts = new Map<number, number>();
	for (const value of dice) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	return counts;
}

function sumAll(dice: DiceArray): number {
	return dice.reduce((sum, v) => sum + v, 0);
}

function sumMatching(dice: DiceArray, value: number): number {
	return dice.filter((v) => v === value).reduce((sum, v) => sum + v, 0);
}

function hasOfAKind(dice: DiceArray, n: number): boolean {
	const counts = countValues(dice);
	for (const count of counts.values()) {
		if (count >= n) return true;
	}
	return false;
}

function isFullHouse(dice: DiceArray): boolean {
	const counts = countValues(dice);
	const values = Array.from(counts.values()).sort((a, b) => a - b);
	return values.length === 2 && values[0] === 2 && values[1] === 3;
}

function isSmallStraight(dice: DiceArray): boolean {
	const unique = new Set(dice);
	const patterns = [
		[1, 2, 3, 4],
		[2, 3, 4, 5],
		[3, 4, 5, 6],
	];
	return patterns.some((pattern) => pattern.every((v) => unique.has(v)));
}

function isLargeStraight(dice: DiceArray): boolean {
	const sorted = [...dice].sort((a, b) => a - b);
	return (
		(sorted[0] === 1 && sorted[1] === 2 && sorted[2] === 3 && sorted[3] === 4 && sorted[4] === 5) ||
		(sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 6)
	);
}

function isDicee(dice: DiceArray): boolean {
	return new Set(dice).size === 1;
}

function calculateCategoryScore(dice: DiceArray, category: Category): number {
	switch (category) {
		case 'ones':
			return sumMatching(dice, 1);
		case 'twos':
			return sumMatching(dice, 2);
		case 'threes':
			return sumMatching(dice, 3);
		case 'fours':
			return sumMatching(dice, 4);
		case 'fives':
			return sumMatching(dice, 5);
		case 'sixes':
			return sumMatching(dice, 6);
		case 'threeOfAKind':
			return hasOfAKind(dice, 3) ? sumAll(dice) : 0;
		case 'fourOfAKind':
			return hasOfAKind(dice, 4) ? sumAll(dice) : 0;
		case 'fullHouse':
			return isFullHouse(dice) ? 25 : 0;
		case 'smallStraight':
			return isSmallStraight(dice) ? 30 : 0;
		case 'largeStraight':
			return isLargeStraight(dice) ? 40 : 0;
		case 'dicee':
			return isDicee(dice) ? 50 : 0;
		case 'chance':
			return sumAll(dice);
	}
}

function getRemainingCategories(scorecard: Scorecard): Category[] {
	return ALL_CATEGORIES.filter((cat) => scorecard[cat] === null);
}

function calculateTotal(scorecard: Scorecard): number {
	let total = 0;
	for (const cat of ALL_CATEGORIES) {
		total += scorecard[cat] ?? 0;
	}
	total += scorecard.upperBonus;
	total += scorecard.diceeBonus;
	return total;
}

const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_VALUE = 35;
const DICEE_BONUS_VALUE = 100;

function applyScore(
	scorecard: Scorecard,
	category: Category,
	dice: DiceArray,
): { scorecard: Scorecard; score: number; isDiceeBonus: boolean } {
	const score = calculateCategoryScore(dice, category);
	let isDiceeBonus = false;

	const newScorecard: Scorecard = { ...scorecard };

	// Dicee bonus
	if (isDicee(dice) && scorecard.dicee !== null && scorecard.dicee > 0) {
		newScorecard.diceeBonus = scorecard.diceeBonus + DICEE_BONUS_VALUE;
		isDiceeBonus = true;
	}

	newScorecard[category] = score;

	// Upper bonus
	const upperSum =
		(newScorecard.ones ?? 0) +
		(newScorecard.twos ?? 0) +
		(newScorecard.threes ?? 0) +
		(newScorecard.fours ?? 0) +
		(newScorecard.fives ?? 0) +
		(newScorecard.sixes ?? 0);

	if (upperSum >= UPPER_BONUS_THRESHOLD && newScorecard.upperBonus === 0) {
		newScorecard.upperBonus = UPPER_BONUS_VALUE;
	}

	return { scorecard: newScorecard, score, isDiceeBonus };
}

// =============================================================================
// Default Brain (Random Valid Moves)
// =============================================================================

/**
 * Simple brain that makes random valid moves
 * Used as fallback when no brain factory is provided
 */
class RandomBrain implements SimulationBrain {
	readonly type = 'random';
	private rng: RandomSource;

	constructor(rng: RandomSource) {
		this.rng = rng;
	}

	async initialize(_profile: SimulationProfile): Promise<void> {
		// Random brain doesn't use profile
	}

	async decide(context: SimulationContext): Promise<SimulationDecision> {
		const remaining = ALL_CATEGORIES.filter(
			(cat) => context.scorecard[cat as keyof typeof context.scorecard] === null,
		);

		// If no rolls remaining, must score
		if (context.rollsRemaining === 0) {
			const category = this.rng.randomChoice(remaining);
			return { action: 'score', category, confidence: 0.5 };
		}

		// 40% chance to score early, 60% to keep rolling
		if (this.rng.randomChance(0.4)) {
			const category = this.rng.randomChoice(remaining);
			return { action: 'score', category, confidence: 0.5 };
		}

		// Random keep decision
		const keepMask: KeptMask = [
			this.rng.randomChance(0.5),
			this.rng.randomChance(0.5),
			this.rng.randomChance(0.5),
			this.rng.randomChance(0.5),
			this.rng.randomChance(0.5),
		];

		return { action: 'keep', keepMask, confidence: 0.5 };
	}

	dispose(): void {
		// Nothing to clean up
	}
}

// =============================================================================
// Default Profile
// =============================================================================

function createDefaultProfile(profileId: string): SimulationProfile {
	return {
		id: profileId,
		name: profileId,
		avatarSeed: profileId,
		tagline: 'Simulation profile',
		brain: 'random',
		skillLevel: 0.5,
		traits: {
			riskTolerance: 0.5,
			diceeChaser: 0.5,
			upperSectionFocus: 0.5,
			usesAllRolls: 0.5,
			thinkingTime: 0.5,
			chattiness: 0.5,
		},
		timing: {
			rollDecisionMs: 0,
			keepDecisionMs: 0,
			scoreDecisionMs: 0,
			varianceMs: 0,
			thinkingMultiplier: 1,
		},
	};
}

// =============================================================================
// Game Simulator
// =============================================================================

/**
 * Headless game simulator for running Dicee games without UI
 */
export class GameSimulator {
	private masterRng: SeededRandom;
	private config: GameSimulatorConfig;
	private gameCount = 0;

	constructor(config: GameSimulatorConfig = {}) {
		const seed = config.seed ?? Math.floor(Math.random() * 0xffffffff);
		this.masterRng = new SeededRandom(seed);
		this.config = config;
	}

	/**
	 * Run a single game simulation
	 */
	async runGame(simConfig: SimulationConfig): Promise<GameResult> {
		const gameId = crypto.randomUUID();
		const gameSeed = this.masterRng.randomInt(0, 0xffffffff);
		const gameRng = new SeededRandom(gameSeed);
		this.gameCount++;

		const startedAt = new Date().toISOString();

		// Initialize players
		const players: PlayerState[] = await Promise.all(
			simConfig.players.map(async (playerConfig) => {
				const profile =
					this.config.getProfile?.(playerConfig.profileId) ??
					createDefaultProfile(playerConfig.profileId);

				// Apply overrides
				const finalProfile: SimulationProfile = {
					...profile,
					skillLevel: playerConfig.skillOverride ?? profile.skillLevel,
				};

				// Create brain with forked RNG
				const brainRng = gameRng.fork(`brain-${playerConfig.id}`);
				const brainType = playerConfig.brainOverride ?? profile.brain;
				let brain: SimulationBrain;

				if (this.config.createBrain) {
					const brainResult = this.config.createBrain(brainType);
					// Handle both sync and async brain creation
					brain = brainResult instanceof Promise ? await brainResult : brainResult;
				} else {
					brain = new RandomBrain(brainRng);
				}

				// Wrap with RNG adapter
				brain = new BrainRngAdapter(brain, brainRng);

				await brain.initialize(finalProfile);

				return {
					id: playerConfig.id,
					profileId: playerConfig.profileId,
					profile: finalProfile,
					brain,
					scorecard: createEmptyScorecard(),
					totalScore: 0,
					diceeCount: 0,
					optimalDecisions: 0,
					totalDecisions: 0,
					evLoss: 0,
				};
			}),
		);

		// Randomize player order
		const playerOrder = gameRng.shuffle([...players]);

		// Play 13 rounds
		const turnResults: TurnResult[] = [];
		const decisionResults: DecisionResult[] = [];

		for (let round = 1; round <= 13; round++) {
			for (const player of playerOrder) {
				const turnResult = await this.playTurn(
					gameRng.fork(`turn-${round}-${player.id}`),
					player,
					players,
					round,
					gameId,
					simConfig.captureDecisions ?? false,
					decisionResults,
				);

				if (simConfig.captureDecisions) {
					turnResults.push(turnResult);
				}
			}
		}

		const completedAt = new Date().toISOString();
		const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

		// Calculate final results
		const playerResults: PlayerResult[] = players.map((p) => ({
			id: p.id,
			profileId: p.profileId,
			finalScore: p.totalScore,
			scorecard: p.scorecard,
			upperBonus: p.scorecard.upperBonus > 0,
			diceeCount: p.diceeCount,
			optimalDecisions: simConfig.captureDecisions ? p.optimalDecisions : undefined,
			totalDecisions: simConfig.captureDecisions ? p.totalDecisions : undefined,
			evLoss: simConfig.captureDecisions ? p.evLoss : undefined,
		}));

		// Determine winner
		const sortedPlayers = [...playerResults].sort((a, b) => b.finalScore - a.finalScore);
		const winner = sortedPlayers[0];

		// Cleanup
		for (const player of players) {
			player.brain.dispose();
		}

		return {
			gameId,
			seed: gameSeed,
			experimentId: undefined,
			startedAt,
			completedAt,
			durationMs,
			players: playerResults,
			winnerId: winner.id,
			winnerProfileId: winner.profileId,
		};
	}

	/**
	 * Play a single turn for a player
	 */
	private async playTurn(
		turnRng: RandomSource,
		player: PlayerState,
		allPlayers: PlayerState[],
		round: number,
		gameId: string,
		captureDecisions: boolean,
		decisionResults: DecisionResult[],
	): Promise<TurnResult> {
		const turnId = `${gameId}-${player.id}-${round}`;
		let dice = rollDice(turnRng);
		let keptDice: KeptMask = KEEP_NONE;
		let rollCount = 1;

		// Build context
		const buildContext = (): SimulationContext => ({
			dice,
			keptDice,
			rollsRemaining: 3 - rollCount,
			scorecard: player.scorecard as unknown as Record<string, number | null>,
			round,
			opponentScores: allPlayers
				.filter((p) => p.id !== player.id)
				.map((p) => ({
					playerId: p.id,
					scorecard: p.scorecard as unknown as Record<string, number | null>,
					totalScore: p.totalScore,
				})),
			isFinalRound: round === 13,
			scoreDifferential:
				player.totalScore -
				Math.max(...allPlayers.filter((p) => p.id !== player.id).map((p) => p.totalScore), 0),
		});

		let scoredCategory: Category | undefined;
		let scoredPoints = 0;

		// Decision loop (max 3 rolls)
		while (rollCount <= 3) {
			const context = buildContext();
			const decision = await player.brain.decide(context);
			player.totalDecisions++;

			if (decision.action === 'score' && decision.category) {
				scoredCategory = decision.category as Category;
				break;
			}

			if (decision.action === 'keep' && decision.keepMask) {
				keptDice = decision.keepMask;
			}

			// Roll again if not scoring and rolls remain
			if (rollCount < 3) {
				if (captureDecisions) {
					const diceBefore = [...dice] as DiceArray;
					dice = rerollDice(dice, keptDice, turnRng);
					decisionResults.push({
						decisionId: `${turnId}-${rollCount}`,
						turnId,
						gameId,
						playerId: player.id,
						rollNumber: rollCount as 1 | 2,
						diceBefore,
						diceAfter: dice,
						keptMask: keptDice,
						wasOptimalHold: undefined,
						evLoss: undefined,
					});
				} else {
					dice = rerollDice(dice, keptDice, turnRng);
				}
				rollCount++;
				keptDice = KEEP_NONE;
			} else {
				// Must score after 3 rolls
				const remaining = getRemainingCategories(player.scorecard);
				scoredCategory = remaining[0]; // Fallback to first available
				break;
			}
		}

		// Apply score
		if (!scoredCategory) {
			const remaining = getRemainingCategories(player.scorecard);
			scoredCategory = remaining[0];
		}

		const { scorecard, score, isDiceeBonus } = applyScore(player.scorecard, scoredCategory, dice);
		player.scorecard = scorecard;
		player.totalScore = calculateTotal(scorecard);
		scoredPoints = score;

		if (isDiceeBonus || (scoredCategory === 'dicee' && score > 0)) {
			player.diceeCount++;
		}

		return {
			turnId,
			gameId,
			playerId: player.id,
			profileId: player.profileId,
			turnNumber: round,
			rollCount,
			finalDice: dice,
			scoredCategory,
			scoredPoints,
			optimalCategory: undefined,
			optimalPoints: undefined,
			evDifference: undefined,
			wasOptimal: undefined,
		};
	}

	/**
	 * Get the seed used by this simulator
	 */
	getSeed(): number {
		return this.masterRng.getSeed();
	}
}

/**
 * Run a single game with default configuration
 */
export async function runSingleGame(config: SimulationConfig, seed?: number): Promise<GameResult> {
	const simulator = new GameSimulator({ seed });
	return simulator.runGame(config);
}
