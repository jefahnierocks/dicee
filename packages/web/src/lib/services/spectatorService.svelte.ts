/**
 * Spectator Service
 *
 * Manages WebSocket connection to watch games as a spectator.
 * Uses same-origin WebSocket proxy (/ws/room/[code]?role=spectator).
 * Spectators can watch games, chat, and react, but cannot play.
 */

import ReconnectingWebSocket from 'reconnecting-websocket';
import { browser } from '$app/environment';
import type {
	PlayerGameState,
	QuickChatKey,
	ReactionEmoji,
	RoomCode,
	RoomPlayer,
	ServerEvent,
} from '$lib/types/multiplayer';
import { createServiceLogger } from '$lib/utils/logger';
import {
	isUpgradeRequiredClose,
	protocolUpgrade,
	withProtocolVersion,
} from './protocolUpgrade.svelte';

const log = createServiceLogger('SpectatorService');

// =============================================================================
// Prediction Types (D4)
// =============================================================================

export type PredictionType = 'dicee' | 'improves' | 'bricks' | 'exact';

export interface Prediction {
	id: string;
	spectatorId: string;
	spectatorName: string;
	playerId: string;
	type: PredictionType;
	exactScore?: number;
	timestamp: number;
	evaluated: boolean;
	correct: boolean | null;
	pointsAwarded: number;
}

export interface PredictionResult {
	predictionId: string;
	correct: boolean;
	pointsAwarded: number;
	actualOutcome: {
		wasDicee: boolean;
		improved: boolean;
		bricked: boolean;
		finalScore: number;
	};
}

export interface PredictionStats {
	spectatorId: string;
	totalPredictions: number;
	correctPredictions: number;
	accuracy: number;
	totalPoints: number;
	streak: number;
	bestStreak: number;
}

// =============================================================================
// Rooting Types (D5)
// =============================================================================

export interface RootingChoice {
	playerId: string;
	changeCount: number;
	remainingChanges: number;
}

export interface PlayerRootingInfo {
	playerId: string;
	rooterCount: number;
	rooterNames: string[];
}

export interface RootingState {
	players: PlayerRootingInfo[];
	totalRooters: number;
	myChoice: RootingChoice | null;
}

// =============================================================================
// Kibitz Types (D6)
// =============================================================================

export type KibitzVoteType = 'category' | 'keep' | 'action';

export interface KibitzOption {
	optionId: string;
	label: string;
	voteCount: number;
	percentage: number;
	voterPreview: string[];
}

export interface KibitzState {
	playerId: string;
	turnNumber: number;
	totalVotes: number;
	activeVoteType: KibitzVoteType;
	categoryOptions: KibitzOption[];
	keepOptions: KibitzOption[];
	actionOptions: KibitzOption[];
	votingOpen: boolean;
}

export interface MyKibitzVote {
	voteType: KibitzVoteType;
	category?: string;
	keepPattern?: number;
	action?: 'roll' | 'score';
}

// =============================================================================
// Spectator Reaction Types (D7)
// =============================================================================

/** Standard reaction emojis (available to all users) */
export const STANDARD_REACTIONS = ['👍', '🎲', '😱', '💀', '🎉'] as const;

/** Spectator-exclusive reaction emojis */
export const SPECTATOR_REACTIONS = ['🍿', '📢', '🙈', '🪦', '🔥', '🤡'] as const;

/** Rooting-specific reactions (only for your backed player) */
export const ROOTING_REACTIONS = ['📣', '💪'] as const;

/** All spectator reaction emoji types */
export type SpectatorReactionEmoji =
	| (typeof STANDARD_REACTIONS)[number]
	| (typeof SPECTATOR_REACTIONS)[number]
	| (typeof ROOTING_REACTIONS)[number];

/** Metadata for each reaction */
export interface ReactionMetadata {
	emoji: SpectatorReactionEmoji;
	label: string;
	sound?: string;
	requiresRooting?: boolean;
	category: 'standard' | 'spectator' | 'rooting';
}

/** Complete reaction metadata lookup */
export const REACTION_METADATA: Record<SpectatorReactionEmoji, ReactionMetadata> = {
	// Standard reactions
	'👍': { emoji: '👍', label: 'Nice!', category: 'standard' },
	'🎲': { emoji: '🎲', label: 'Good roll!', category: 'standard' },
	'😱': { emoji: '😱', label: 'Wow!', sound: 'gasp.mp3', category: 'standard' },
	'💀': { emoji: '💀', label: 'Oof', category: 'standard' },
	'🎉': { emoji: '🎉', label: 'Dicee!', sound: 'celebration.mp3', category: 'standard' },

	// Spectator-exclusive
	'🍿': { emoji: '🍿', label: 'Drama!', sound: 'popcorn.mp3', category: 'spectator' },
	'📢': { emoji: '📢', label: 'Called it!', sound: 'airhorn.mp3', category: 'spectator' },
	'🙈': { emoji: '🙈', label: "Can't watch", sound: 'suspense.mp3', category: 'spectator' },
	'🪦': { emoji: '🪦', label: 'RIP', sound: 'sad-trombone.mp3', category: 'spectator' },
	'🔥': { emoji: '🔥', label: 'On fire!', sound: 'fire.mp3', category: 'spectator' },
	'🤡': { emoji: '🤡', label: 'Clown play', sound: 'honk.mp3', category: 'spectator' },

	// Rooting-specific
	'📣': {
		emoji: '📣',
		label: "Let's GO!",
		sound: 'cheer.mp3',
		requiresRooting: true,
		category: 'rooting',
	},
	'💪': {
		emoji: '💪',
		label: 'You got this',
		sound: 'pump-up.mp3',
		requiresRooting: true,
		category: 'rooting',
	},
};

/** A spectator reaction received from the server */
export interface SpectatorReaction {
	id: string;
	spectatorId: string;
	spectatorName: string;
	emoji: SpectatorReactionEmoji;
	targetPlayerId?: string;
	timestamp: number;
}

/** Reaction event from server with combo info */
export interface SpectatorReactionEvent {
	reaction: SpectatorReaction;
	comboCount: number;
	playSound: boolean;
}

/** Rate limit state */
export interface ReactionRateLimit {
	remaining: number;
	resetAt: number;
}

// =============================================================================
// Join Queue Types (D8)
// =============================================================================

/** Queue entry for a spectator waiting to join next game */
export interface JoinQueueEntry {
	userId: string;
	displayName: string;
	avatarSeed: string;
	position: number;
	queuedAt: number;
}

/** Complete queue state */
export interface JoinQueueState {
	queue: JoinQueueEntry[];
	maxPlayers: number;
	currentPlayerCount: number;
	estimatedWaitMs: number | null;
	queueOpen: boolean;
	myPosition: number | null;
	willGetSpot: boolean;
}

/** Warm seat transition info */
export interface WarmSeatTransition {
	transitioningUsers: Array<{
		userId: string;
		displayName: string;
		avatarSeed: string;
		fromPosition: number;
	}>;
	stayingPlayers: Array<{
		userId: string;
		displayName: string;
		avatarSeed: string;
	}>;
	countdownSeconds: number;
	startedAt: number;
}

// =============================================================================
// Gallery Points Types (D9)
// =============================================================================

/** Gallery points breakdown by category */
export interface GalleryPoints {
	/** Points from predictions */
	predictions: {
		correct: number;
		streakBonus: number;
		exactScore: number;
	};
	/** Points from social engagement */
	social: {
		reactionsGiven: number;
		kibitzVotes: number;
		chatMessages: number;
	};
	/** Points from backing players */
	backing: {
		backedWinner: number;
		loyaltyBonus: number;
	};
}

/** Achievement IDs for spectators */
export type GalleryAchievementId =
	| 'oracle'
	| 'drama_magnet'
	| 'superfan'
	| 'jinx'
	| 'analyst'
	| 'called_it'
	| 'voyeur'
	| 'regular';

/** Achievement metadata */
export interface GalleryAchievement {
	id: GalleryAchievementId;
	name: string;
	description: string;
	emoji: string;
	threshold: number;
	progress?: number;
	unlocked: boolean;
	unlockedAt?: number;
}

/** End-of-game summary for spectators */
export interface GalleryGameSummary {
	pointsEarned: GalleryPoints;
	totalPointsEarned: number;
	newAchievements: GalleryAchievement[];
	backedPlayerWon: boolean | null;
	predictionSummary: {
		total: number;
		correct: number;
		streak: number;
	};
	cumulativeStats: {
		totalPoints: number;
		gamesWatched: number;
		bestStreak: number;
	};
}

/** Calculate total points from breakdown */
function calculateTotalPoints(points: GalleryPoints): number {
	return (
		points.predictions.correct +
		points.predictions.streakBonus +
		points.predictions.exactScore +
		points.social.reactionsGiven +
		points.social.kibitzVotes +
		points.social.chatMessages +
		points.backing.backedWinner +
		points.backing.loyaltyBonus
	);
}

// =============================================================================
// Types
// =============================================================================

export type SpectatorConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SpectatorInfo {
	userId: string;
	displayName: string;
	avatarSeed: string;
	watchingSince: number;
}

export interface SpectatorState {
	/** Current connection status */
	status: SpectatorConnectionStatus;
	/** Room code being watched */
	roomCode: RoomCode | null;
	/** Room status (waiting, playing, completed) */
	roomStatus: string | null;
	/** Players in the game */
	players: RoomPlayer[];
	/** Other spectators */
	spectators: SpectatorInfo[];
	/** Spectator count */
	spectatorCount: number;
	/** Last error message */
	error: string | null;
	/** Full game state (includes scorecards, dice, etc.) - populated via GAME_STATE_SYNC */
	gameState: SpectatorGameState | null;
}

/** Game state for spectator view - contains all player game data */
export interface SpectatorGameState {
	playerOrder: string[];
	currentPlayerId: string;
	turnNumber: number;
	roundNumber: number;
	phase: string;
	players: Record<string, PlayerGameState>;
}

export type SpectatorEventHandler = (event: ServerEvent | SpectatorServerEvent) => void;

/** Spectator-specific events from server */
export interface SpectatorServerEvent {
	type:
		| 'SPECTATOR_CONNECTED'
		| 'SPECTATOR_JOINED'
		| 'SPECTATOR_LEFT'
		| 'GAME_STATE_UPDATE'
		| 'PLAYER_TURN'
		| 'DICE_ROLLED'
		| 'SCORE_UPDATE';
	payload: Record<string, unknown>;
}

// =============================================================================
// Spectator Service Class
// =============================================================================

/**
 * Spectator Service - manages spectator connection to game rooms
 */
class SpectatorService {
	/** WebSocket instance */
	private socket: ReconnectingWebSocket | null = null;

	/** Event handlers */
	private eventHandlers: Set<SpectatorEventHandler> = new Set();

	/** Connection status listeners */
	private statusListeners: Set<(status: SpectatorConnectionStatus) => void> = new Set();

	/** Current state */
	private _status: SpectatorConnectionStatus = 'disconnected';
	private _roomCode: RoomCode | null = null;
	private _roomStatus: string | null = null;
	private _players: RoomPlayer[] = [];
	private _spectators: SpectatorInfo[] = [];
	private _spectatorCount = 0;
	private _error: string | null = null;
	private _gameState: SpectatorGameState | null = null;

	/** Prediction state (D4) */
	private _predictions: Prediction[] = [];
	private _predictionStats: PredictionStats | null = null;
	private _currentTurn: { turnNumber: number; playerId: string } | null = null;
	private _lastPredictionResults: PredictionResult[] = [];

	/** Rooting state (D5) */
	private _rootingState: RootingState | null = null;
	private _myRootingChoice: RootingChoice | null = null;

	/** Kibitz state (D6) */
	private _kibitzState: KibitzState | null = null;
	private _myKibitzVote: MyKibitzVote | null = null;

	/** Spectator reaction state (D7) */
	private _recentReactions: SpectatorReactionEvent[] = [];
	private _reactionRateLimit: ReactionRateLimit | null = null;
	private _reactionListeners: Set<(event: SpectatorReactionEvent) => void> = new Set();

	/** Join queue state (D8) */
	private _queueState: JoinQueueState | null = null;
	private _warmSeatTransition: WarmSeatTransition | null = null;
	private _isTransitioning = false;

	/** Gallery points state (D9) */
	private _galleryPoints: GalleryPoints | null = null;
	private _unlockedAchievements: GalleryAchievement[] = [];
	private _gameSummary: GalleryGameSummary | null = null;
	private _achievementListeners: Set<(achievement: GalleryAchievement) => void> = new Set();

	// =========================================================================
	// Public Getters
	// =========================================================================

	get status(): SpectatorConnectionStatus {
		return this._status;
	}

	get roomCode(): RoomCode | null {
		return this._roomCode;
	}

	get roomStatus(): string | null {
		return this._roomStatus;
	}

	get players(): RoomPlayer[] {
		return this._players;
	}

	get spectators(): SpectatorInfo[] {
		return this._spectators;
	}

	get spectatorCount(): number {
		return this._spectatorCount;
	}

	get error(): string | null {
		return this._error;
	}

	get gameState(): SpectatorGameState | null {
		return this._gameState;
	}

	get state(): SpectatorState {
		return {
			status: this._status,
			roomCode: this._roomCode,
			roomStatus: this._roomStatus,
			players: this._players,
			spectators: this._spectators,
			spectatorCount: this._spectatorCount,
			error: this._error,
			gameState: this._gameState,
		};
	}

	get isConnected(): boolean {
		return this._status === 'connected';
	}

	// Prediction getters (D4)
	get predictions(): Prediction[] {
		return this._predictions;
	}

	get predictionStats(): PredictionStats | null {
		return this._predictionStats;
	}

	get currentTurn(): { turnNumber: number; playerId: string } | null {
		return this._currentTurn;
	}

	get lastPredictionResults(): PredictionResult[] {
		return this._lastPredictionResults;
	}

	get canMakePrediction(): boolean {
		return (
			this._status === 'connected' && this._currentTurn !== null && this._predictions.length < 3
		);
	}

	// Rooting getters (D5)
	get rootingState(): RootingState | null {
		return this._rootingState;
	}

	get myRootingChoice(): RootingChoice | null {
		return this._myRootingChoice;
	}

	get canChangeRooting(): boolean {
		return (
			this._status === 'connected' &&
			(this._myRootingChoice === null || this._myRootingChoice.remainingChanges > 0)
		);
	}

	// Kibitz getters (D6)
	get kibitzState(): KibitzState | null {
		return this._kibitzState;
	}

	get myKibitzVote(): MyKibitzVote | null {
		return this._myKibitzVote;
	}

	get canKibitz(): boolean {
		return this._status === 'connected' && this._currentTurn !== null;
	}

	get hasVoted(): boolean {
		return this._myKibitzVote !== null;
	}

	// Reaction getters (D7)
	get recentReactions(): SpectatorReactionEvent[] {
		return this._recentReactions;
	}

	get reactionRateLimit(): ReactionRateLimit | null {
		return this._reactionRateLimit;
	}

	get canSendReaction(): boolean {
		if (this._status !== 'connected') return false;
		if (!this._reactionRateLimit) return true;
		return this._reactionRateLimit.remaining > 0 || Date.now() >= this._reactionRateLimit.resetAt;
	}

	/**
	 * Get available reactions based on rooting status
	 */
	get availableReactions(): SpectatorReactionEmoji[] {
		const reactions: SpectatorReactionEmoji[] = [...STANDARD_REACTIONS, ...SPECTATOR_REACTIONS];

		// Add rooting reactions if backing a player
		if (this._myRootingChoice) {
			reactions.push(...ROOTING_REACTIONS);
		}

		return reactions;
	}

	// Queue getters (D8)
	get queueState(): JoinQueueState | null {
		return this._queueState;
	}

	get warmSeatTransition(): WarmSeatTransition | null {
		return this._warmSeatTransition;
	}

	get isInQueue(): boolean {
		return this._queueState?.myPosition !== null && this._queueState?.myPosition !== undefined;
	}

	get myQueuePosition(): number | null {
		return this._queueState?.myPosition ?? null;
	}

	get willGetSpot(): boolean {
		return this._queueState?.willGetSpot ?? false;
	}

	get isTransitioning(): boolean {
		return this._isTransitioning;
	}

	get queuedSpectators(): JoinQueueEntry[] {
		return this._queueState?.queue ?? [];
	}

	get availableSpots(): number {
		if (!this._queueState) return 0;
		return Math.max(0, this._queueState.maxPlayers - this._queueState.currentPlayerCount);
	}

	get estimatedWaitTime(): number | null {
		return this._queueState?.estimatedWaitMs ?? null;
	}

	get canJoinQueue(): boolean {
		return this._status === 'connected' && !this.isInQueue && (this._queueState?.queueOpen ?? true);
	}

	// Gallery points getters (D9)
	get galleryPoints(): GalleryPoints | null {
		return this._galleryPoints;
	}

	get totalGalleryPoints(): number {
		if (!this._galleryPoints) return 0;
		return calculateTotalPoints(this._galleryPoints);
	}

	get unlockedAchievements(): GalleryAchievement[] {
		return this._unlockedAchievements;
	}

	get gameSummary(): GalleryGameSummary | null {
		return this._gameSummary;
	}

	get predictionPointsThisGame(): number {
		if (!this._galleryPoints) return 0;
		const p = this._galleryPoints.predictions;
		return p.correct + p.streakBonus + p.exactScore;
	}

	get socialPointsThisGame(): number {
		if (!this._galleryPoints) return 0;
		const s = this._galleryPoints.social;
		return s.reactionsGiven + s.kibitzVotes + s.chatMessages;
	}

	get backingPointsThisGame(): number {
		if (!this._galleryPoints) return 0;
		const b = this._galleryPoints.backing;
		return b.backedWinner + b.loyaltyBonus;
	}

	// =========================================================================
	// Connection Management
	// =========================================================================

	/**
	 * Connect to watch a room as spectator
	 *
	 * @param roomCode - 6-character room code
	 * @param _accessToken - Deprecated compatibility argument. Authentication
	 * is resolved from the same-origin HttpOnly session cookie.
	 */
	async connect(roomCode: RoomCode, _accessToken: string): Promise<void> {
		// Disconnect existing connection
		if (this.socket) {
			this.disconnect();
		}

		this._roomCode = roomCode;
		this.setStatus('connecting');
		this._error = null;

		try {
			this.connectToServer(roomCode);
		} catch (error) {
			this._error = error instanceof Error ? error.message : 'Connection failed';
			this.setStatus('error');
			throw error;
		}
	}

	/**
	 * Connect to server as spectator
	 */
	private connectToServer(roomCode: RoomCode): void {
		if (!browser) return;

		log.debug('Connecting as spectator', { roomCode });

		// Use same-origin WebSocket proxy with role=spectator
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = withProtocolVersion(
			`${protocol}//${location.host}/ws/room/${roomCode.toUpperCase()}?role=spectator`,
		);

		const socket = new ReconnectingWebSocket(wsUrl, [], {
			maxRetries: 10,
			reconnectionDelayGrowFactor: 1.5,
			maxReconnectionDelay: 30000,
			minReconnectionDelay: 1000,
		});

		this.socket = socket;
		this.setupEventHandlers(socket);
	}

	/**
	 * Set up event handlers for WebSocket
	 */
	private setupEventHandlers(socket: ReconnectingWebSocket): void {
		socket.addEventListener('open', () => this.handleOpen());
		socket.addEventListener('message', (e) => this.handleMessage(e as MessageEvent));
		socket.addEventListener('close', (e) => this.handleClose(e as CloseEvent));
		socket.addEventListener('error', () => this.handleError());
	}

	/**
	 * Disconnect from current room
	 */
	disconnect(): void {
		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}
		this._roomCode = null;
		this._roomStatus = null;
		this._players = [];
		this._spectators = [];
		this._spectatorCount = 0;
		this._gameState = null;
		// Clear prediction state
		this._predictions = [];
		this._predictionStats = null;
		this._currentTurn = null;
		this._lastPredictionResults = [];
		// Clear rooting state
		this._rootingState = null;
		this._myRootingChoice = null;
		// Clear kibitz state
		this._kibitzState = null;
		this._myKibitzVote = null;
		// Clear reaction state
		this._recentReactions = [];
		this._reactionRateLimit = null;
		// Clear queue state (D8)
		this._queueState = null;
		this._warmSeatTransition = null;
		this._isTransitioning = false;
		// Clear gallery points state (D9)
		this._galleryPoints = null;
		this._unlockedAchievements = [];
		this._gameSummary = null;
		this.setStatus('disconnected');
	}

	/**
	 * Trigger reconnection if socket exists.
	 * Used for visibility change handling (phone wake).
	 */
	triggerReconnect(): void {
		if (this.socket && this._status !== 'connected' && this._status !== 'connecting') {
			log.debug('Triggering reconnect due to visibility change');
			this.socket.reconnect();
		}
	}

	// =========================================================================
	// Chat Commands (Spectators can chat and react)
	// =========================================================================

	/**
	 * Send a chat message
	 */
	sendChatMessage(content: string): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'CHAT', payload: { content } }));
	}

	/**
	 * Send a quick chat preset
	 */
	sendQuickChat(key: QuickChatKey): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'QUICK_CHAT', payload: { key } }));
	}

	/**
	 * Send a reaction to a message
	 */
	sendReaction(messageId: string, emoji: ReactionEmoji, action: 'add' | 'remove'): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'REACTION', payload: { messageId, emoji, action } }));
	}

	/**
	 * Send typing start indicator
	 */
	sendTypingStart(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'TYPING_START' }));
	}

	/**
	 * Send typing stop indicator
	 */
	sendTypingStop(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'TYPING_STOP' }));
	}

	// =========================================================================
	// Prediction Commands (D4)
	// =========================================================================

	/**
	 * Make a prediction about a player's turn outcome
	 */
	makePrediction(playerId: string, type: PredictionType, exactScore?: number): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(
			JSON.stringify({
				type: 'PREDICTION',
				payload: { playerId, type, exactScore },
			}),
		);
	}

	/**
	 * Cancel an existing prediction
	 */
	cancelPrediction(predictionId: string): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(
			JSON.stringify({
				type: 'CANCEL_PREDICTION',
				payload: { predictionId },
			}),
		);
	}

	/**
	 * Request current predictions
	 */
	getPredictions(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'GET_PREDICTIONS' }));
	}

	/**
	 * Request prediction stats
	 */
	getPredictionStats(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'GET_PREDICTION_STATS' }));
	}

	// =========================================================================
	// Rooting Commands (D5)
	// =========================================================================

	/**
	 * Root for a player
	 */
	rootForPlayer(playerId: string): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(
			JSON.stringify({
				type: 'ROOT_FOR_PLAYER',
				payload: { playerId },
			}),
		);
	}

	/**
	 * Clear rooting choice
	 */
	clearRooting(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'CLEAR_ROOTING' }));
	}

	/**
	 * Request current rooting state
	 */
	getRooting(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'GET_ROOTING' }));
	}

	// =========================================================================
	// Kibitz Commands (D6)
	// =========================================================================

	/**
	 * Cast a kibitz vote suggesting a category to score
	 */
	kibitzCategory(playerId: string, category: string): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(
			JSON.stringify({
				type: 'KIBITZ',
				payload: { playerId, voteType: 'category', category },
			}),
		);
	}

	/**
	 * Cast a kibitz vote suggesting which dice to keep
	 */
	kibitzKeep(playerId: string, keepPattern: number): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(
			JSON.stringify({
				type: 'KIBITZ',
				payload: { playerId, voteType: 'keep', keepPattern },
			}),
		);
	}

	/**
	 * Cast a kibitz vote suggesting roll or score action
	 */
	kibitzAction(playerId: string, action: 'roll' | 'score'): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(
			JSON.stringify({
				type: 'KIBITZ',
				payload: { playerId, voteType: 'action', action },
			}),
		);
	}

	/**
	 * Clear current kibitz vote
	 */
	clearKibitz(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'CLEAR_KIBITZ' }));
	}

	/**
	 * Request current kibitz state
	 */
	getKibitz(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'GET_KIBITZ' }));
	}

	// =========================================================================
	// Spectator Reaction Commands (D7)
	// =========================================================================

	/**
	 * Send a spectator reaction (floating emoji)
	 */
	sendSpectatorReaction(emoji: SpectatorReactionEmoji, targetPlayerId?: string): void {
		if (!this.socket || this._status !== 'connected') return;

		// Check if emoji requires rooting
		const metadata = REACTION_METADATA[emoji];
		if (metadata.requiresRooting && !this._myRootingChoice) {
			log.warn('Cannot use rooting reaction without backing a player');
			return;
		}

		this.socket.send(
			JSON.stringify({
				type: 'SPECTATOR_REACTION',
				payload: { emoji, targetPlayerId },
			}),
		);
	}

	/**
	 * Add a reaction event listener
	 */
	addReactionListener(listener: (event: SpectatorReactionEvent) => void): void {
		this._reactionListeners.add(listener);
	}

	/**
	 * Remove a reaction event listener
	 */
	removeReactionListener(listener: (event: SpectatorReactionEvent) => void): void {
		this._reactionListeners.delete(listener);
	}

	/**
	 * Clear all recent reactions (for UI purposes)
	 */
	clearRecentReactions(): void {
		this._recentReactions = [];
	}

	// =========================================================================
	// Join Queue Commands (D8)
	// =========================================================================

	/**
	 * Join the queue to play in the next game
	 */
	joinQueue(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'JOIN_QUEUE' }));
	}

	/**
	 * Leave the join queue
	 */
	leaveQueue(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'LEAVE_QUEUE' }));
	}

	/**
	 * Request current queue state
	 */
	getQueue(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'GET_QUEUE' }));
	}

	// =========================================================================
	// Gallery Points Commands (D9)
	// =========================================================================

	/**
	 * Request current gallery points for this game
	 */
	getGalleryPoints(): void {
		if (!this.socket || this._status !== 'connected') return;
		this.socket.send(JSON.stringify({ type: 'GET_GALLERY_POINTS' }));
	}

	/**
	 * Add an achievement unlock listener
	 */
	addAchievementListener(listener: (achievement: GalleryAchievement) => void): void {
		this._achievementListeners.add(listener);
	}

	/**
	 * Remove an achievement unlock listener
	 */
	removeAchievementListener(listener: (achievement: GalleryAchievement) => void): void {
		this._achievementListeners.delete(listener);
	}

	/**
	 * Clear game summary (for UI dismissal)
	 */
	clearGameSummary(): void {
		this._gameSummary = null;
	}

	/**
	 * Reset gallery points for new game
	 */
	resetGalleryPoints(): void {
		this._galleryPoints = null;
		this._gameSummary = null;
	}

	// =========================================================================
	// Event Handling
	// =========================================================================

	/**
	 * Add an event handler
	 */
	addEventHandler(handler: SpectatorEventHandler): void {
		this.eventHandlers.add(handler);
	}

	/**
	 * Remove an event handler
	 */
	removeEventHandler(handler: SpectatorEventHandler): void {
		this.eventHandlers.delete(handler);
	}

	/**
	 * Add a connection status listener
	 */
	addStatusListener(listener: (status: SpectatorConnectionStatus) => void): void {
		this.statusListeners.add(listener);
	}

	/**
	 * Remove a connection status listener
	 */
	removeStatusListener(listener: (status: SpectatorConnectionStatus) => void): void {
		this.statusListeners.delete(listener);
	}

	// =========================================================================
	// Internal Event Handlers
	// =========================================================================

	private handleOpen(): void {
		log.debug('Connected as spectator', { roomCode: this._roomCode });
		this.setStatus('connected');
		this._error = null;
	}

	private handleMessage(event: MessageEvent): void {
		try {
			const raw = JSON.parse(event.data) as { type: string; payload?: unknown };

			// Process the event
			this.processEvent(raw);

			// Notify handlers
			for (const handler of this.eventHandlers) {
				try {
					handler(raw as unknown as ServerEvent | SpectatorServerEvent);
				} catch (error) {
					log.error('Event handler error', error as Error);
				}
			}
		} catch (error) {
			log.error('Failed to parse message', error as Error);
		}
	}

	private handleClose(event: CloseEvent): void {
		log.debug('Disconnected', { code: event.code, reason: event.reason });

		// Outdated client: stop reconnecting-websocket, then reload once or show the updating notice
		if (isUpgradeRequiredClose(event.code)) {
			const socket = this.socket;
			this.socket = null;
			this.setStatus('disconnected');
			socket?.close();
			protocolUpgrade.handleUpgradeRequired();
			return;
		}

		// Handle specific close codes
		if (event.code === 4004) {
			this._error = 'Room not found';
			this.setStatus('error');
		} else if (event.code === 403) {
			this._error = 'Spectators not allowed in this room';
			this.setStatus('error');
		} else if (this._status === 'connected') {
			this.setStatus('connecting'); // Reconnecting
		}
	}

	private handleError(): void {
		log.error('Connection error');
		this._error = 'Connection error';
		this.setStatus('error');
	}

	private setStatus(status: SpectatorConnectionStatus): void {
		this._status = status;
		for (const listener of this.statusListeners) {
			try {
				listener(status);
			} catch (error) {
				log.error('Status listener error', error as Error);
			}
		}
	}

	private processEvent(event: { type: string; payload?: unknown }): void {
		const payload = event.payload as Record<string, unknown>;

		// Route to specialized handlers by event category
		if (event.type.startsWith('SPECTATOR_') || event.type.startsWith('PLAYER_')) {
			this.handleConnectionEvent(event.type, payload);
		} else if (event.type === 'GAME_STATE_SYNC') {
			this.handleGameStateSync(payload);
		} else if (event.type.startsWith('GAME_')) {
			this.handleGameEvent(event.type, payload);
		} else if (
			event.type === 'DICE_ROLLED' ||
			event.type === 'DICE_KEPT' ||
			event.type === 'CATEGORY_SCORED' ||
			event.type === 'TURN_STARTED' ||
			event.type === 'TURN_CHANGED'
		) {
			this.handleIncrementalGameEvent(event.type, payload);
		} else if (event.type.startsWith('PREDICTION') || event.type === 'TURN_STARTED') {
			this.handlePredictionEvent(event.type, payload);
		} else if (event.type.startsWith('ROOTING')) {
			this.handleRootingEvent(event.type, payload);
		} else if (event.type.startsWith('KIBITZ')) {
			this.handleKibitzEvent(event.type, payload);
		} else if (event.type === 'SPECTATOR_REACTION' || event.type === 'REACTION_SENT') {
			this.handleReactionEvent(event.type, payload);
		} else if (
			event.type.startsWith('QUEUE_') ||
			event.type === 'WARM_SEAT_TRANSITION' ||
			event.type === 'YOU_ARE_TRANSITIONING' ||
			event.type === 'TRANSITION_COMPLETE' ||
			event.type === 'WARM_SEAT_COMPLETE'
		) {
			this.handleQueueEvent(event.type, payload);
		} else if (event.type.startsWith('GALLERY_') || event.type === 'ACHIEVEMENTS_UNLOCKED') {
			this.handleGalleryEvent(event.type, payload);
		} else if (event.type === 'ERROR') {
			this._error = (payload?.message as string) ?? 'Unknown error';
		}
	}

	/** Handle connection-related events (spectators, players) */
	private handleConnectionEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'SPECTATOR_CONNECTED':
				this._roomStatus = (payload?.roomStatus as string) ?? null;
				this._players = this.convertPlayers((payload?.players as Record<string, unknown>[]) ?? []);
				this._spectators = (payload?.spectators as SpectatorInfo[]) ?? [];
				this._spectatorCount = (payload?.spectatorCount as number) ?? 0;
				break;

			case 'SPECTATOR_JOINED':
				this._spectatorCount = (payload?.spectatorCount as number) ?? this._spectatorCount + 1;
				if (payload?.userId && payload?.displayName) {
					const exists = this._spectators.some((s) => s.userId === payload.userId);
					if (!exists) {
						this._spectators = [
							...this._spectators,
							{
								userId: payload.userId as string,
								displayName: payload.displayName as string,
								avatarSeed: (payload.avatarSeed as string) ?? (payload.userId as string),
								watchingSince: Date.now(),
							},
						];
					}
				}
				break;

			case 'SPECTATOR_LEFT':
				this._spectatorCount =
					(payload?.spectatorCount as number) ?? Math.max(0, this._spectatorCount - 1);
				if (payload?.userId) {
					this._spectators = this._spectators.filter((s) => s.userId !== payload.userId);
				}
				break;

			case 'PLAYER_JOINED':
				if (payload) {
					const newPlayer = this.convertPlayer(payload);
					const exists = this._players.some((p) => p.id === newPlayer.id);
					if (!exists) {
						this._players = [...this._players, newPlayer];
					}
				}
				break;

			case 'PLAYER_LEFT':
				if (payload?.userId) {
					this._players = this._players.filter((p) => p.id !== payload.userId);
				}
				break;
		}
	}

	/** Handle game state events */
	private handleGameEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'GAME_STARTING':
				this._roomStatus = 'starting';
				break;
			case 'GAME_STARTED':
				this._roomStatus = 'playing';
				// Initialize game state from GAME_STARTED payload
				if (payload) {
					this._gameState = {
						playerOrder: (payload.playerOrder as string[]) ?? [],
						currentPlayerId: (payload.currentPlayerId as string) ?? '',
						turnNumber: (payload.turnNumber as number) ?? 1,
						roundNumber: (payload.roundNumber as number) ?? 1,
						phase: (payload.phase as string) ?? 'turn_roll',
						players: (payload.players as Record<string, PlayerGameState>) ?? {},
					};
				}
				break;
			case 'GAME_OVER':
				this._roomStatus = 'completed';
				if (this._gameState) {
					this._gameState = { ...this._gameState, phase: 'game_over' };
				}
				break;
		}
	}

	/**
	 * Handle full game state synchronization (sent on spectator mid-game join).
	 * This ensures spectators joining mid-game see complete state.
	 */
	private handleGameStateSync(payload: Record<string, unknown>): void {
		if (!payload) return;

		this._gameState = {
			playerOrder: (payload.playerOrder as string[]) ?? [],
			currentPlayerId: (payload.currentPlayerId as string) ?? '',
			turnNumber: (payload.turnNumber as number) ?? 1,
			roundNumber: (payload.roundNumber as number) ?? 1,
			phase: (payload.phase as string) ?? 'turn_roll',
			players: (payload.players as Record<string, PlayerGameState>) ?? {},
		};

		// Also update room status based on phase
		const phase = payload.phase as string;
		if (phase === 'game_over') {
			this._roomStatus = 'completed';
		} else if (phase && phase !== 'waiting') {
			this._roomStatus = 'playing';
		}
	}

	/**
	 * Handle incremental game events to keep game state up-to-date.
	 * These are events like DICE_ROLLED, DICE_KEPT, CATEGORY_SCORED that update
	 * individual parts of the game state.
	 */
	private handleIncrementalGameEvent(type: string, payload: Record<string, unknown>): void {
		if (!this._gameState || !payload) return;

		const playerId = payload.playerId as string;
		if (!playerId) return;

		const player = this._gameState.players[playerId];
		if (!player) return;

		switch (type) {
			case 'DICE_ROLLED': {
				const dice = payload.dice as number[] | undefined;
				const rollsRemaining = payload.rollsRemaining as number | undefined;
				this._gameState = {
					...this._gameState,
					phase: 'turn_decide',
					players: {
						...this._gameState.players,
						[playerId]: {
							...player,
							currentDice: dice
								? (dice as [number, number, number, number, number])
								: player.currentDice,
							rollsRemaining: rollsRemaining ?? player.rollsRemaining,
						},
					},
				};
				break;
			}

			case 'DICE_KEPT': {
				const kept = payload.kept as boolean[] | undefined;
				this._gameState = {
					...this._gameState,
					players: {
						...this._gameState.players,
						[playerId]: {
							...player,
							keptDice: kept
								? (kept as [boolean, boolean, boolean, boolean, boolean])
								: player.keptDice,
						},
					},
				};
				break;
			}

			case 'CATEGORY_SCORED': {
				const category = payload.category as string;
				const score = payload.score as number;
				const totalScore = payload.totalScore as number;
				const isDiceeBonus = payload.isDiceeBonus as boolean | undefined;

				const newScorecard = { ...player.scorecard, [category]: score };
				if (isDiceeBonus) {
					newScorecard.diceeBonus = (player.scorecard.diceeBonus ?? 0) + 100;
				}

				this._gameState = {
					...this._gameState,
					players: {
						...this._gameState.players,
						[playerId]: {
							...player,
							scorecard: newScorecard,
							totalScore: totalScore ?? player.totalScore,
							currentDice: null,
							keptDice: null,
						},
					},
				};
				break;
			}

			case 'TURN_STARTED':
			case 'TURN_CHANGED': {
				const newPlayerId = (payload.playerId ?? payload.currentPlayerId) as string;
				const turnNumber = payload.turnNumber as number | undefined;
				const roundNumber = payload.roundNumber as number | undefined;

				// Reset turn state for the new current player
				const newPlayers = { ...this._gameState.players };
				if (newPlayerId && newPlayers[newPlayerId]) {
					newPlayers[newPlayerId] = {
						...newPlayers[newPlayerId],
						currentDice: null,
						keptDice: null,
						rollsRemaining: 3,
					};
				}

				this._gameState = {
					...this._gameState,
					currentPlayerId: newPlayerId ?? this._gameState.currentPlayerId,
					turnNumber: turnNumber ?? this._gameState.turnNumber,
					roundNumber: roundNumber ?? this._gameState.roundNumber,
					phase: 'turn_roll',
					players: newPlayers,
				};
				break;
			}
		}
	}

	/** Handle prediction events (D4) */
	private handlePredictionEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'TURN_STARTED':
				this._currentTurn = {
					turnNumber: (payload?.turnNumber as number) ?? 0,
					playerId: (payload?.playerId as string) ?? '',
				};
				this._predictions = [];
				this._lastPredictionResults = [];
				// Clear kibitz for new turn
				this._myKibitzVote = null;
				this._kibitzState = null;
				break;

			case 'PREDICTION_CONFIRMED':
				if (payload) {
					this._predictions = [...this._predictions, payload as unknown as Prediction];
				}
				break;

			case 'PREDICTION_CANCELLED':
				if (payload?.predictionId) {
					this._predictions = this._predictions.filter((p) => p.id !== payload.predictionId);
				}
				break;

			case 'PREDICTIONS':
				if (payload?.predictions) {
					this._predictions = payload.predictions as Prediction[];
				}
				if (payload?.currentPlayer && payload?.turnNumber) {
					this._currentTurn = {
						turnNumber: payload.turnNumber as number,
						playerId: payload.currentPlayer as string,
					};
				}
				break;

			case 'PREDICTION_RESULTS':
				if (payload?.results) {
					this._lastPredictionResults = payload.results as PredictionResult[];
				}
				this._currentTurn = null;
				break;

			case 'PREDICTION_STATS':
			case 'PREDICTION_STATS_UPDATE':
				if (payload) {
					this._predictionStats = payload as unknown as PredictionStats;
				}
				break;
		}
	}

	/** Handle rooting events (D5) */
	private handleRootingEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'ROOTING_CONFIRMED':
				if (payload) {
					this._myRootingChoice = {
						playerId: payload.playerId as string,
						changeCount: payload.changeCount as number,
						remainingChanges: payload.remainingChanges as number,
					};
				}
				break;

			case 'ROOTING_CLEARED':
				this._myRootingChoice = null;
				break;

			case 'ROOTING_STATE':
				if (payload) {
					this._rootingState = {
						players: (payload.players as PlayerRootingInfo[]) ?? [],
						totalRooters: (payload.totalRooters as number) ?? 0,
						myChoice: payload.myChoice as RootingChoice | null,
					};
					if (payload.myChoice) {
						this._myRootingChoice = payload.myChoice as RootingChoice;
					}
				}
				break;

			case 'ROOTING_UPDATE':
				if (payload) {
					this._rootingState = {
						players: (payload.players as PlayerRootingInfo[]) ?? [],
						totalRooters: (payload.totalRooters as number) ?? 0,
						myChoice: this._myRootingChoice,
					};
				}
				break;

			case 'ROOTING_BONUS':
				if (payload && this._predictionStats) {
					this._predictionStats = {
						...this._predictionStats,
						totalPoints: payload.totalPoints as number,
					};
				}
				break;
		}
	}

	/** Handle kibitz events (D6) */
	private handleKibitzEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'KIBITZ_CONFIRMED':
				if (payload) {
					this._myKibitzVote = {
						voteType: payload.voteType as KibitzVoteType,
						category: payload.category as string | undefined,
						keepPattern: payload.keepPattern as number | undefined,
						action: payload.action as 'roll' | 'score' | undefined,
					};
				}
				break;

			case 'KIBITZ_CLEARED':
				this._myKibitzVote = null;
				break;

			case 'KIBITZ_STATE':
				if (payload) {
					this._kibitzState = payload as unknown as KibitzState;
				} else {
					this._kibitzState = null;
				}
				break;

			case 'KIBITZ_UPDATE':
				if (payload && this._kibitzState) {
					const voteType = payload.voteType as KibitzVoteType;
					const options = payload.options as KibitzOption[];

					// Update the relevant options array
					switch (voteType) {
						case 'category':
							this._kibitzState = {
								...this._kibitzState,
								categoryOptions: options,
								totalVotes: payload.totalVotes as number,
							};
							break;
						case 'keep':
							this._kibitzState = {
								...this._kibitzState,
								keepOptions: options,
								totalVotes: payload.totalVotes as number,
							};
							break;
						case 'action':
							this._kibitzState = {
								...this._kibitzState,
								actionOptions: options,
								totalVotes: payload.totalVotes as number,
							};
							break;
					}
				}
				break;
		}
	}

	/** Handle spectator reaction events (D7) */
	private handleReactionEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'SPECTATOR_REACTION':
				if (payload) {
					const event: SpectatorReactionEvent = {
						reaction: {
							id:
								((payload.reaction as Record<string, unknown>)?.id as string) ??
								crypto.randomUUID(),
							spectatorId:
								((payload.reaction as Record<string, unknown>)?.spectatorId as string) ?? '',
							spectatorName:
								((payload.reaction as Record<string, unknown>)?.spectatorName as string) ?? '',
							emoji:
								((payload.reaction as Record<string, unknown>)?.emoji as SpectatorReactionEmoji) ??
								'👍',
							targetPlayerId: (payload.reaction as Record<string, unknown>)?.targetPlayerId as
								| string
								| undefined,
							timestamp:
								((payload.reaction as Record<string, unknown>)?.timestamp as number) ?? Date.now(),
						},
						comboCount: (payload.comboCount as number) ?? 1,
						playSound: (payload.playSound as boolean) ?? false,
					};

					// Add to recent reactions (keep last 20)
					this._recentReactions = [...this._recentReactions.slice(-19), event];

					// Notify listeners
					for (const listener of this._reactionListeners) {
						try {
							listener(event);
						} catch (error) {
							log.error('Reaction listener error', error as Error);
						}
					}
				}
				break;

			case 'REACTION_SENT':
				// Update rate limit based on server response
				if (payload?.reactionId) {
					// Reaction was accepted, update local count
					if (this._reactionRateLimit) {
						this._reactionRateLimit = {
							...this._reactionRateLimit,
							remaining: Math.max(0, this._reactionRateLimit.remaining - 1),
						};
					}
				}
				break;
		}
	}

	/** Handle queue events (D8) */
	private handleQueueEvent(type: string, payload: Record<string, unknown>): void {
		// Route to specific handlers to reduce complexity
		if (type.startsWith('QUEUE_')) {
			this.handleQueueStateEvent(type, payload);
		} else {
			this.handleTransitionEvent(type, payload);
		}
	}

	/** Handle queue state events */
	private handleQueueStateEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'QUEUE_JOINED':
				if (payload) {
					this._queueState = {
						...this._queueState,
						queue: this._queueState?.queue ?? [],
						maxPlayers: this._queueState?.maxPlayers ?? 4,
						currentPlayerCount: this._queueState?.currentPlayerCount ?? 0,
						estimatedWaitMs: this._queueState?.estimatedWaitMs ?? null,
						queueOpen: true,
						myPosition: (payload.position as number) ?? null,
						willGetSpot: (payload.willGetSpot as boolean) ?? false,
					};
				}
				break;

			case 'QUEUE_LEFT':
				if (this._queueState) {
					this._queueState = { ...this._queueState, myPosition: null, willGetSpot: false };
				}
				break;

			case 'QUEUE_STATE':
				this._queueState = payload ? this.parseQueueState(payload) : null;
				break;

			case 'QUEUE_UPDATE':
				if (payload) {
					this.applyQueueUpdate(payload);
				}
				break;
		}
	}

	/** Handle transition events */
	private handleTransitionEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'WARM_SEAT_TRANSITION':
				if (payload) {
					this._warmSeatTransition = payload as unknown as WarmSeatTransition;
				}
				break;

			case 'YOU_ARE_TRANSITIONING':
				this._isTransitioning = true;
				break;

			case 'TRANSITION_COMPLETE':
				this._isTransitioning = false;
				this._queueState = null;
				this._warmSeatTransition = null;
				log.debug('Transition complete - now a player');
				break;

			case 'WARM_SEAT_COMPLETE':
				this._warmSeatTransition = null;
				break;
		}
	}

	/** Parse queue state from payload */
	private parseQueueState(payload: Record<string, unknown>): JoinQueueState {
		return {
			queue: (payload.queue as JoinQueueEntry[]) ?? [],
			maxPlayers: (payload.maxPlayers as number) ?? 4,
			currentPlayerCount: (payload.currentPlayerCount as number) ?? 0,
			estimatedWaitMs: (payload.estimatedWaitMs as number) ?? null,
			queueOpen: (payload.queueOpen as boolean) ?? true,
			myPosition: (payload.myPosition as number) ?? null,
			willGetSpot: (payload.willGetSpot as boolean) ?? false,
		};
	}

	/** Apply queue update */
	private applyQueueUpdate(payload: Record<string, unknown>): void {
		const queue = (payload.queue as JoinQueueEntry[]) ?? [];
		const availableSpots = (payload.availableSpots as number) ?? 0;
		const myEntry = queue.find(
			(e) => this._queueState?.myPosition && e.position === this._queueState.myPosition,
		);

		this._queueState = {
			...this._queueState,
			queue,
			maxPlayers: this._queueState?.maxPlayers ?? 4,
			currentPlayerCount: this._queueState?.currentPlayerCount ?? 0,
			estimatedWaitMs: this._queueState?.estimatedWaitMs ?? null,
			queueOpen: this._queueState?.queueOpen ?? true,
			myPosition: myEntry?.position ?? this._queueState?.myPosition ?? null,
			willGetSpot: myEntry ? myEntry.position <= availableSpots : false,
		};
	}

	/** Handle gallery points events (D9) */
	private handleGalleryEvent(type: string, payload: Record<string, unknown>): void {
		switch (type) {
			case 'GALLERY_POINTS':
				if (payload?.points) {
					this._galleryPoints = payload.points as GalleryPoints;
				}
				break;

			case 'GALLERY_POINTS_UPDATE':
				if (payload?.points) {
					this._galleryPoints = payload.points as GalleryPoints;
				}
				break;

			case 'ACHIEVEMENTS_UNLOCKED':
				if (payload?.achievements && Array.isArray(payload.achievements)) {
					const newAchievements = payload.achievements as GalleryAchievement[];

					// Add to unlocked list
					this._unlockedAchievements = [...this._unlockedAchievements, ...newAchievements];

					// Notify listeners
					for (const achievement of newAchievements) {
						for (const listener of this._achievementListeners) {
							try {
								listener(achievement);
							} catch (error) {
								log.error('Achievement listener error', error as Error);
							}
						}
					}
				}
				break;

			case 'GALLERY_GAME_SUMMARY':
				if (payload) {
					this._gameSummary = payload as unknown as GalleryGameSummary;
				}
				break;
		}
	}

	private convertPlayers(raw: Record<string, unknown>[]): RoomPlayer[] {
		return raw.map((p) => this.convertPlayer(p));
	}

	private convertPlayer(p: Record<string, unknown>): RoomPlayer {
		return {
			id: (p.userId as string) ?? '',
			displayName: (p.displayName as string) ?? 'Player',
			avatarSeed: (p.avatarSeed as string) ?? (p.userId as string) ?? '',
			isHost: (p.isHost as boolean) ?? false,
			isConnected: (p.isConnected as boolean) ?? true,
			joinedAt: (p.connectedAt as string) ?? new Date().toISOString(),
		};
	}
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton spectator service instance
 */
export const spectatorService = new SpectatorService();
