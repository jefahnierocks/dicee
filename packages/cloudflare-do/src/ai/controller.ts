/**
 * AI Controller
 *
 * Manages AI player turns in a game room.
 * Coordinates between brain decisions and game state.
 *
 * Key responsibilities:
 * - Execute AI turn steps with natural timing
 * - Translate brain decisions to game commands
 * - Handle turn timeouts and errors
 * - Emit events for UI updates
 */

import type { Category, KeptMask, MultiplayerGameState, Scorecard } from '../game';
import { createLogger, type Logger } from '../lib/logger';
import { TimeoutError, withTimeout } from '../lib/timeout';
import type { AIBrain } from './brain';
import { createBrain, initializeBrainFactory } from './brain';
import { getProfile } from './profiles';
import type {
	AIEvent,
	AIPlayerState,
	AIProfile,
	AISpeedMode,
	GameContext,
	TurnDecision,
} from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Commands that the controller can issue to the game room.
 */
export type AICommand =
	| { type: 'roll' }
	| { type: 'keep'; keepMask: KeptMask }
	| { type: 'score'; category: Category };

/**
 * Callback for executing AI commands on game state.
 */
export type CommandExecutor = (command: AICommand) => Promise<void>;

/**
 * Callback for emitting AI events.
 */
export type EventEmitter = (event: AIEvent) => void;

/**
 * Controller configuration.
 */
export interface AIControllerConfig {
	/** Minimum delay between actions (ms) */
	minDelayMs: number;

	/** Maximum delay for any single action (ms) */
	maxDelayMs: number;

	/** Whether to emit chat messages */
	enableChat: boolean;

	/** Whether to emit thinking events */
	emitThinkingEvents: boolean;

	/** Speed mode for timing adjustments */
	speedMode?: AISpeedMode;
}

const DEFAULT_CONFIG: AIControllerConfig = {
	minDelayMs: 300, // was 500
	maxDelayMs: 8000, // was 10000
	enableChat: true,
	emitThinkingEvents: true,
	speedMode: 'normal',
};

/** Timeout for brain.decide() - if exceeded, use fallback decision */
const BRAIN_DECIDE_TIMEOUT_MS = 8000;

// Speed multipliers (local fallback for safety)
const SPEED_MULTIPLIERS_LOCAL: Record<AISpeedMode, number> = {
	normal: 1.0,
	fast: 0.6,
};

// ============================================================================
// AI Controller
// ============================================================================

/**
 * AI Controller - manages AI player turns.
 *
 * Usage:
 * ```typescript
 * const controller = new AIController();
 * await controller.initialize();
 *
 * // Add AI player to a game
 * controller.addPlayer('ai-1', 'carmen');
 *
 * // Execute their turn
 * await controller.executeTurn('ai-1', gameState, executeCommand, emitEvent);
 * ```
 */
export class AIController {
	private config: AIControllerConfig;
	private players: Map<string, AIPlayerState> = new Map();
	private brains: Map<string, AIBrain> = new Map();
	private initialized = false;
	private logger: Logger;

	constructor(config: Partial<AIControllerConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.logger = createLogger({ component: 'AIController' });
	}

	/**
	 * Get the speed multiplier based on config.
	 */
	private getSpeedMultiplier(): number {
		return SPEED_MULTIPLIERS_LOCAL[this.config.speedMode ?? 'normal'];
	}

	/**
	 * Initialize the controller.
	 * Must be called before adding players or executing turns.
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		await initializeBrainFactory(true); // Use TypeScript fallback for now
		this.initialized = true;
	}

	/**
	 * Add an AI player to the controller.
	 *
	 * @param playerId - Unique player ID
	 * @param profileId - Profile ID or AIProfile object
	 */
	async addPlayer(playerId: string, profileId: string | AIProfile): Promise<void> {
		if (!this.initialized) {
			await this.initialize();
		}

		const profile = typeof profileId === 'string' ? getProfile(profileId) : profileId;

		if (!profile) {
			throw new Error(`Unknown AI profile: ${profileId}`);
		}

		// Create brain for this player
		const brain = await createBrain(profile);

		this.players.set(playerId, {
			playerId,
			profile,
			turnStep: 0,
			isThinking: false,
			lastActionAt: 0,
			accumulatedThinkTime: 0,
		});

		this.brains.set(playerId, brain);
	}

	/**
	 * Remove an AI player.
	 */
	removePlayer(playerId: string): void {
		const brain = this.brains.get(playerId);
		if (brain) {
			brain.dispose();
		}

		this.players.delete(playerId);
		this.brains.delete(playerId);
	}

	/**
	 * Check if a player is managed by this controller.
	 */
	hasPlayer(playerId: string): boolean {
		return this.players.has(playerId);
	}

	/**
	 * Get player state.
	 */
	getPlayerState(playerId: string): AIPlayerState | undefined {
		return this.players.get(playerId);
	}

	/**
	 * Execute a complete AI turn.
	 *
	 * This method handles the entire turn from first roll to scoring,
	 * with appropriate delays between actions.
	 *
	 * @param playerId - AI player ID
	 * @param getGameState - Function to get current game state (called each step for fresh state)
	 * @param execute - Callback to execute commands
	 * @param emit - Callback to emit events
	 */
	async executeTurn(
		playerId: string,
		getGameState: () => Promise<MultiplayerGameState | null>,
		execute: CommandExecutor,
		emit: EventEmitter,
	): Promise<void> {
		const playerState = this.players.get(playerId);
		const brain = this.brains.get(playerId);

		if (!playerState || !brain) {
			throw new Error(`AI player not found: ${playerId}`);
		}

		// Reset turn state
		playerState.turnStep = 0;
		playerState.accumulatedThinkTime = 0;

		// Execute turn steps until we score
		let turnComplete = false;
		let maxSteps = 10; // Safety limit

		while (!turnComplete && maxSteps > 0) {
			// Get fresh game state for each step
			const gameState = await getGameState();
			if (!gameState) {
				return;
			}

			const currentPlayer = gameState.playerOrder[gameState.currentPlayerIndex];

			// Verify it's still this player's turn
			if (currentPlayer !== playerId) {
				return;
			}

			const decision = await this.executeTurnStep(playerId, gameState, execute, emit);

			if (decision.action === 'score') {
				turnComplete = true;
			}

			maxSteps--;
		}

		if (!turnComplete) {
			this.logger.warn('Turn did not complete (maxSteps reached)', {
				operation: 'ai_turn_incomplete',
				playerId,
			});
		}
	}

	/**
	 * Execute a single step of an AI turn.
	 *
	 * Returns the decision made. Call repeatedly until action is 'score'.
	 */
	async executeTurnStep(
		playerId: string,
		gameState: MultiplayerGameState,
		execute: CommandExecutor,
		emit: EventEmitter,
	): Promise<TurnDecision> {
		const playerState = this.players.get(playerId);
		const brain = this.brains.get(playerId);

		if (!playerState || !brain) {
			throw new Error(`AI player not found: ${playerId}`);
		}

		// Mark as thinking
		playerState.isThinking = true;

		// Build game context
		const context = this.buildGameContext(playerId, gameState);

		// CONTROLLER-LEVEL CHECK: If no valid dice, immediately roll
		// This protects against any brain implementation that might not handle null dice
		// Dice are null/undefined at turn start before first roll
		const hasValidDice =
			context.dice && context.dice.length === 5 && context.dice.some((d) => d >= 1 && d <= 6);

		if (!hasValidDice) {
			this.logger.debug('No valid dice - issuing roll without brain consultation', {
				operation: 'ai_turn_step',
				playerId,
			});
			const rollDecision: TurnDecision = {
				action: 'roll',
				reasoning: 'Turn start - must roll first',
				confidence: 1.0,
			};

			// Minimal think time for initial roll with speed multiplier
			const speedMultiplier = this.getSpeedMultiplier();
			const minThinkTime = Math.max(this.config.minDelayMs, 200) * speedMultiplier;
			if (this.config.emitThinkingEvents) {
				emit({
					type: 'ai_thinking',
					playerId,
					estimatedMs: minThinkTime,
				});
			}
			await this.delay(minThinkTime);

			// Execute the roll
			await this.executeDecision(playerId, rollDecision, execute, emit);

			// Update state
			playerState.isThinking = false;
			playerState.lastActionAt = Date.now();
			playerState.turnStep++;
			playerState.accumulatedThinkTime += minThinkTime;

			return rollDecision;
		}

		// Get thinking time estimate with speed multiplier
		const baseThinkTime = brain.estimateThinkingTime(context, playerState.profile);
		const speedMultiplier = this.getSpeedMultiplier();
		const clampedThinkTime = Math.max(
			this.config.minDelayMs,
			Math.min(this.config.maxDelayMs, baseThinkTime * speedMultiplier),
		);

		// Emit thinking event
		if (this.config.emitThinkingEvents) {
			emit({
				type: 'ai_thinking',
				playerId,
				estimatedMs: clampedThinkTime,
			});
		}

		// Wait for "thinking" time
		await this.delay(clampedThinkTime);

		// Get brain decision with timeout protection
		let decision: TurnDecision;
		try {
			decision = await withTimeout(brain.decide(context), BRAIN_DECIDE_TIMEOUT_MS, 'brain.decide');
		} catch (error) {
			if (error instanceof TimeoutError) {
				this.logger.warn('Brain decision timed out, using fallback', {
					playerId,
					timeoutMs: BRAIN_DECIDE_TIMEOUT_MS,
				});
				decision = this.createFallbackDecision(context);
			} else {
				throw error;
			}
		}

		// =====================================================================
		// DEFENSIVE GUARDS: Validate decision before execution
		// =====================================================================
		if (decision.action === 'score' && !decision.category) {
			this.logger.warn('Brain returned score without category, using fallback', {
				playerId,
			});
			decision = this.createFallbackDecision(context);
		}

		if (decision.action === 'keep' && !decision.keepMask) {
			this.logger.warn('Brain returned keep without mask, converting to roll', {
				playerId,
			});
			decision = { action: 'roll', reasoning: 'Keep mask missing, rolling instead' };
		}

		// Execute the decision
		await this.executeDecision(playerId, decision, execute, emit);

		// Update state
		playerState.isThinking = false;
		playerState.lastActionAt = Date.now();
		playerState.turnStep++;
		playerState.accumulatedThinkTime += clampedThinkTime;

		return decision;
	}

	/**
	 * Schedule an AI turn to execute after a delay.
	 *
	 * Returns a function to cancel the scheduled turn.
	 */
	scheduleTurn(
		playerId: string,
		getGameState: () => Promise<MultiplayerGameState | null>,
		execute: CommandExecutor,
		emit: EventEmitter,
		delayMs: number,
	): () => void {
		let cancelled = false;

		setTimeout(async () => {
			if (!cancelled) {
				await this.executeTurn(playerId, getGameState, execute, emit);
			}
		}, delayMs);

		return () => {
			cancelled = true;
		};
	}

	/**
	 * Clean up all resources.
	 */
	dispose(): void {
		for (const brain of this.brains.values()) {
			brain.dispose();
		}

		this.players.clear();
		this.brains.clear();
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	private buildGameContext(playerId: string, gameState: MultiplayerGameState): GameContext {
		const player = gameState.players[playerId];

		if (!player) {
			throw new Error(`Player not in game: ${playerId}`);
		}

		// Build opponent scores
		const opponentScores = Object.values(gameState.players)
			.filter((p) => p.id !== playerId)
			.map((p) => ({
				playerId: p.id,
				scorecard: p.scorecard,
				totalScore: this.calculateTotal(p.scorecard),
			}));

		// Calculate score differential
		const myTotal = this.calculateTotal(player.scorecard);
		const leaderTotal = Math.max(
			myTotal,
			...opponentScores.map(
				(o: { playerId: string; scorecard: Scorecard; totalScore: number }) => o.totalScore,
			),
		);
		const scoreDifferential = myTotal - leaderTotal;

		// Note: dice may be null/undefined at turn start - brain must handle this
		return {
			dice: player.currentDice as [number, number, number, number, number],
			keptDice: player.keptDice ?? [false, false, false, false, false],
			rollsRemaining: player.rollsRemaining,
			scorecard: player.scorecard,
			round: gameState.roundNumber,
			opponentScores,
			isFinalRound: gameState.roundNumber === 13,
			scoreDifferential,
		};
	}

	private async executeDecision(
		playerId: string,
		decision: TurnDecision,
		execute: CommandExecutor,
		emit: EventEmitter,
	): Promise<void> {
		try {
			switch (decision.action) {
				case 'roll':
					emit({ type: 'ai_roll', playerId });
					await execute({ type: 'roll' });
					break;

				case 'keep':
					if (decision.keepMask) {
						emit({ type: 'ai_keep', playerId, keptDice: decision.keepMask });
						try {
							await execute({ type: 'keep', keepMask: decision.keepMask });
						} catch (keepError) {
							// If keep fails, don't proceed to roll - abort the turn step
							this.logger.error('Keep failed, aborting roll', {
								playerId,
								error: keepError instanceof Error ? keepError.message : String(keepError),
							});
							throw keepError;
						}
					}
					// After keeping, roll the dice
					emit({ type: 'ai_roll', playerId });
					await execute({ type: 'roll' });
					break;

				case 'score':
					if (decision.category) {
						emit({
							type: 'ai_score',
							playerId,
							category: decision.category,
							score: 0, // Will be filled in by game room
						});
						await execute({ type: 'score', category: decision.category });
					}
					break;
			}
		} catch (error) {
			this.logger.error('Failed to execute AI decision', {
				playerId,
				action: decision.action,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}

	private calculateTotal(scorecard: Scorecard): number {
		let total = 0;
		let upperSum = 0;

		const upperCats = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'] as const;

		for (const cat of upperCats) {
			const val = scorecard[cat];
			if (val !== null && val !== undefined) {
				total += val;
				upperSum += val;
			}
		}

		// Upper bonus
		if (upperSum >= 63) {
			total += 35;
		}

		const lowerCats = [
			'threeOfAKind',
			'fourOfAKind',
			'fullHouse',
			'smallStraight',
			'largeStraight',
			'dicee',
			'chance',
		] as const;

		for (const cat of lowerCats) {
			const val = scorecard[cat];
			if (val !== null && val !== undefined) {
				total += val;
			}
		}

		// Dicee bonus
		if (scorecard.diceeBonus !== null && scorecard.diceeBonus !== undefined) {
			total += scorecard.diceeBonus;
		}

		return total;
	}

	/**
	 * Create a fallback decision when brain times out or fails.
	 *
	 * Scores the first available category to ensure turn completes.
	 */
	private createFallbackDecision(context: GameContext): TurnDecision {
		const remainingCategories = Object.entries(context.scorecard)
			.filter(([key, score]) => score === null && key !== 'diceeBonus')
			.map(([cat]) => cat as Category);

		if (remainingCategories.length === 0) {
			this.logger.error('No remaining categories for fallback decision');
			// This shouldn't happen, but return a safe default
			return {
				action: 'score',
				category: 'chance',
				reasoning: 'Fallback - no categories remaining',
				confidence: 0.1,
			};
		}

		return {
			action: 'score',
			category: remainingCategories[0],
			reasoning: 'Fallback - brain timeout',
			confidence: 0.1,
		};
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// ============================================================================
// Factory
// ============================================================================

let controllerInstance: AIController | null = null;

/**
 * Get the shared AI controller instance.
 */
export function getAIController(config?: Partial<AIControllerConfig>): AIController {
	if (!controllerInstance) {
		controllerInstance = new AIController(config);
	}
	return controllerInstance;
}

/**
 * Reset the controller (for testing).
 */
export function resetAIController(): void {
	if (controllerInstance) {
		controllerInstance.dispose();
		controllerInstance = null;
	}
}
