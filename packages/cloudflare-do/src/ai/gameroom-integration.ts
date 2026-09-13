/**
 * GameRoom AI Integration
 *
 * Handles AI player turns within a game room.
 * This module bridges the AIController with GameRoom operations.
 *
 * Usage in GameRoom:
 * ```typescript
 * import { AIRoomManager } from './ai/gameroom-integration';
 *
 * // In constructor or initialization
 * private aiManager = new AIRoomManager();
 *
 * // After TURN_CHANGED, check for AI turn
 * if (this.aiManager.isAIPlayer(nextPlayerId)) {
 *   await this.aiManager.executeAITurn(nextPlayerId, gameState, this.executeCommand.bind(this));
 * }
 * ```
 */

import type { MultiplayerGameState, PlayerGameState } from '../game';
import { createLogger, type Logger } from '../lib/logger';
import { type AICommand, AIController } from './controller';
import { getProfile } from './profiles';
import type { AIEvent, AISpeedMode } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Callback to execute game commands (roll, keep, score).
 */
export type GameCommandExecutor = (playerId: string, command: AICommand) => Promise<void>;

/**
 * Callback to broadcast events to clients.
 */
export type EventBroadcaster = (event: { type: string; payload: Record<string, unknown> }) => void;

// ============================================================================
// AI Room Manager
// ============================================================================

/**
 * Manages AI players within a single game room.
 */
export class AIRoomManager {
	private controller: AIController;
	private aiPlayers: Set<string> = new Set();
	private turnInProgress = false;
	private turnStartedAt: number | null = null;
	private logger: Logger;
	/** Stale turn threshold - REDUCED from 30s to 20s */
	private static readonly TURN_TIMEOUT_MS = 20000;

	/** Max wait for previous turn - INCREASED from 2s to 3s */
	private static readonly MAX_WAIT_MS = 3000;

	/** Initial backoff interval */
	private static readonly INITIAL_WAIT_MS = 50;

	constructor(speedMode: AISpeedMode = 'normal') {
		this.controller = new AIController({
			minDelayMs: speedMode === 'fast' ? 200 : 300,
			maxDelayMs: speedMode === 'fast' ? 5000 : 8000,
			enableChat: true,
			emitThinkingEvents: true,
			speedMode,
		});
		this.logger = createLogger({ component: 'AIRoomManager' });
	}

	/**
	 * Initialize the manager.
	 */
	async initialize(): Promise<void> {
		await this.controller.initialize();
	}

	/**
	 * Add an AI player to the room.
	 *
	 * @param playerId - The player ID
	 * @param profileId - The AI profile ID
	 */
	async addAIPlayer(playerId: string, profileId: string): Promise<void> {
		const profile = getProfile(profileId);
		if (!profile) {
			throw new Error(`Unknown AI profile: ${profileId}`);
		}

		await this.controller.addPlayer(playerId, profile);
		this.aiPlayers.add(playerId);
	}

	/**
	 * Remove an AI player from the room.
	 */
	removeAIPlayer(playerId: string): void {
		this.controller.removePlayer(playerId);
		this.aiPlayers.delete(playerId);
	}

	/**
	 * Check if a player is an AI.
	 */
	isAIPlayer(playerId: string): boolean {
		return this.aiPlayers.has(playerId);
	}

	/**
	 * Get all AI player IDs.
	 */
	getAIPlayerIds(): string[] {
		return Array.from(this.aiPlayers);
	}

	/**
	 * Check if there are any AI players.
	 */
	hasAIPlayers(): boolean {
		return this.aiPlayers.size > 0;
	}

	/**
	 * Check if the turnInProgress flag is stale and should be force-reset.
	 */
	private isTurnStale(): boolean {
		if (!this.turnInProgress || !this.turnStartedAt) {
			return false;
		}
		const elapsed = Date.now() - this.turnStartedAt;
		return elapsed > AIRoomManager.TURN_TIMEOUT_MS;
	}

	/**
	 * Execute an AI player's complete turn.
	 *
	 * @param playerId - The AI player ID
	 * @param getGameState - Function to get fresh game state (called each step)
	 * @param executeCommand - Callback to execute game commands
	 * @param broadcast - Callback to broadcast events
	 */
	async executeAITurn(
		playerId: string,
		getGameState: () => Promise<MultiplayerGameState | null>,
		executeCommand: GameCommandExecutor,
		broadcast: EventBroadcaster,
	): Promise<void> {
		if (!this.isAIPlayer(playerId)) {
			throw new Error(`Player ${playerId} is not an AI`);
		}

		// Check for stale turn and force reset if needed
		if (this.isTurnStale()) {
			this.logger.warn('Stale turn detected, force resetting', {
				operation: 'ai_turn_stale_reset',
				playerId,
			});
			this.turnInProgress = false;
			this.turnStartedAt = null;
		}

		// =====================================================================
		// CRITICAL FIX: Exponential backoff with force-reset on timeout
		// =====================================================================
		let waitMs = AIRoomManager.INITIAL_WAIT_MS;
		let totalWaited = 0;

		while (this.turnInProgress && totalWaited < AIRoomManager.MAX_WAIT_MS) {
			await new Promise((resolve) => setTimeout(resolve, waitMs));
			totalWaited += waitMs;

			// Re-check staleness during wait
			if (this.isTurnStale()) {
				this.logger.warn('Turn became stale during wait, force resetting', {
					operation: 'ai_turn_stale_wait',
					playerId,
					totalWaited,
				});
				this.turnInProgress = false;
				this.turnStartedAt = null;
				break;
			}

			// Exponential backoff: 50 → 100 → 200 → 400 → 500 (cap)
			waitMs = Math.min(waitMs * 2, 500);
		}

		// =====================================================================
		// CRITICAL FIX: Force reset instead of return
		// Previous: `return;` here caused game to hang forever
		// =====================================================================
		if (this.turnInProgress) {
			this.logger.warn('Max wait exceeded, force resetting turn lock', {
				operation: 'ai_turn_force_reset',
				playerId,
				totalWaited,
				previousTurnStartedAt: this.turnStartedAt,
			});
			this.turnInProgress = false;
			this.turnStartedAt = null;
			// CONTINUE - do NOT return!
		}

		this.turnInProgress = true;
		this.turnStartedAt = Date.now();

		try {
			// Create command executor wrapper
			const executor = async (command: AICommand) => {
				await executeCommand(playerId, command);
			};

			// Create event emitter wrapper
			const emitter = (event: AIEvent) => {
				this.handleAIEvent(event, broadcast);
			};

			// Execute the turn with state getter
			await this.controller.executeTurn(playerId, getGameState, executor, emitter);

			// Telemetry
			const turnDuration = Date.now() - (this.turnStartedAt ?? Date.now());
			this.logger.info('AI turn completed', {
				operation: 'ai_turn_complete',
				playerId,
				durationMs: turnDuration,
				profileId: this.controller.getPlayerState(playerId)?.profile.id,
			});
		} catch (error) {
			this.logger.error('Turn execution failed', {
				operation: 'ai_turn_error',
				playerId,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		} finally {
			this.turnInProgress = false;
			this.turnStartedAt = null;
		}
	}

	/**
	 * Check if an AI turn is currently in progress.
	 */
	isTurnInProgress(): boolean {
		return this.turnInProgress;
	}

	/**
	 * Clean up all resources.
	 */
	dispose(): void {
		this.controller.dispose();
		this.aiPlayers.clear();
		this.turnInProgress = false;
		this.turnStartedAt = null;
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	private handleAIEvent(event: AIEvent, broadcast: EventBroadcaster): void {
		switch (event.type) {
			case 'ai_thinking':
				broadcast({
					type: 'AI_THINKING',
					payload: {
						playerId: event.playerId,
						estimatedMs: event.estimatedMs,
					},
				});
				break;

			case 'ai_roll':
				// Roll is handled by executeCommand, but we can emit thinking feedback
				broadcast({
					type: 'AI_ROLLING',
					payload: {
						playerId: event.playerId,
					},
				});
				break;

			case 'ai_keep':
				broadcast({
					type: 'AI_KEEPING',
					payload: {
						playerId: event.playerId,
						keptDice: event.keptDice,
					},
				});
				break;

			case 'ai_score':
				broadcast({
					type: 'AI_SCORING',
					payload: {
						playerId: event.playerId,
						category: event.category,
					},
				});
				break;

			case 'ai_chat':
				broadcast({
					type: 'CHAT_MESSAGE',
					payload: {
						id: crypto.randomUUID(),
						userId: event.playerId,
						content: event.message,
						timestamp: Date.now(),
						isAI: true,
					},
				});
				break;

			case 'ai_reaction':
				broadcast({
					type: 'CHAT_REACTION',
					payload: {
						userId: event.playerId,
						reaction: event.reaction,
						isAI: true,
					},
				});
				break;
		}
	}
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a PlayerGameState for an AI player.
 */
export function createAIPlayerState(playerId: string, profileId: string): Partial<PlayerGameState> {
	const profile = getProfile(profileId);

	if (!profile) {
		throw new Error(`Unknown AI profile: ${profileId}`);
	}

	return {
		id: playerId,
		displayName: profile.name,
		avatarSeed: profile.avatarSeed,
		type: 'ai',
		aiProfileId: profileId,
		isConnected: true, // AI is always "connected"
		connectionId: null, // AI has no WebSocket connection
		connectionStatus: 'online', // AI is always "online"
		isHost: false, // AI can't be host
	};
}

/**
 * Check if a player state represents an AI player.
 */
export function isAIPlayerState(player: PlayerGameState): boolean {
	return player.type === 'ai';
}

/**
 * Get the AI profile for a player.
 */
export function getAIProfileForPlayer(player: PlayerGameState) {
	if (player.type !== 'ai' || !player.aiProfileId) {
		return null;
	}

	return getProfile(player.aiProfileId);
}
