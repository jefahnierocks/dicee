/**
 * Cloudflare Durable Objects Type Definitions
 *
 * Environment bindings, connection state, and room configuration
 * for the GameRoom Durable Object.
 */

import type {
	LobbyRoomStatus,
	RoomIdentity,
	// Re-export shared lobby types for use in this package
	PlayerPresenceState as SharedPlayerPresenceState,
	PlayerSummary as SharedPlayerSummary,
	RoomInfo as SharedRoomInfo,
	RoomStatusUpdate as SharedRoomStatusUpdate,
} from '@dicee/shared';

// Re-export shared types for internal use
export type PlayerPresenceState = SharedPlayerPresenceState;
export type PlayerSummary = SharedPlayerSummary;
export type RoomStatusUpdate = SharedRoomStatusUpdate;
export type { LobbyRoomStatus, SharedRoomInfo as RoomInfoFromShared };

// =============================================================================
// Environment Bindings
// =============================================================================

/**
 * Cloudflare Worker environment bindings.
 * Non-secret bindings are generated from wrangler.jsonc into
 * worker-configuration.d.ts. Secret names remain explicit here because
 * Wrangler cannot infer bindings that are provisioned outside the config.
 */
interface SecretBindings {
	/** Supabase project URL */
	SUPABASE_URL: string;

	/** Supabase anonymous key */
	SUPABASE_ANON_KEY: string;

	/** Supabase service role key for bypassing RLS (server-to-server only) */
	SUPABASE_SERVICE_ROLE_KEY: string;

	/** Supabase JWT secret for legacy HS256 token verification (optional if using asymmetric keys) */
	SUPABASE_JWT_SECRET?: string;
}

export type Env = Cloudflare.Env & SecretBindings;

// =============================================================================
// Connection State (survives hibernation)
// =============================================================================

/**
 * Connection role type - players participate in games, spectators watch
 */
export type ConnectionRole = 'player' | 'spectator';

/**
 * State stored in each WebSocket connection via serializeAttachment.
 * This data survives hibernation - when the DO wakes up, it can
 * recover this state via ws.deserializeAttachment().
 *
 * Keep this under ~2KB to stay within Cloudflare's attachment limits.
 */
export interface ConnectionState {
	/** User ID from verified JWT (Supabase auth.users.id) */
	userId: string;

	/** User's display name from profile */
	displayName: string;

	/** Avatar seed for DiceBear generation */
	avatarSeed: string;

	/** Timestamp when connected (epoch ms) */
	connectedAt: number;

	/** Whether this connection is the room host */
	isHost: boolean;

	/** Connection role: player or spectator */
	role: ConnectionRole;
}

// =============================================================================
// Seat Reservation System (Phase 3 - Reconnection)
// =============================================================================

/**
 * Reconnection window duration (5 minutes).
 * Players who disconnect have this long to reclaim their seat.
 */
export const RECONNECT_WINDOW_MS = 5 * 60 * 1000;

/**
 * Player seat state - tracks player presence and reconnection.
 * Stored in DO storage, survives hibernation.
 */
export interface PlayerSeat {
	/** User ID (Supabase auth.users.id) */
	userId: string;

	/** Display name at time of joining */
	displayName: string;

	/** Avatar seed for DiceBear */
	avatarSeed: string;

	/** When player first joined (epoch ms) */
	joinedAt: number;

	/** Whether player is currently connected */
	isConnected: boolean;

	/** When player disconnected (null if connected) */
	disconnectedAt: number | null;

	/** Deadline to reconnect (null if connected or expired) */
	reconnectDeadline: number | null;

	/** Whether this player is the room host */
	isHost: boolean;

	/** Turn order position (0-indexed) */
	turnOrder: number;

	/**
	 * Unique seat identifier for alarm targeting (Phase 1).
	 * Used by AlarmQueue to target specific seat expiration alarms.
	 * Format: `seat-{userId}-{joinedAt}`
	 */
	odal: string;
}

/**
 * Reconnection state sent to clients.
 * Tells them whether they can reconnect and why/why not.
 */
export interface ReconnectionState {
	/** Whether reconnection is possible */
	canReconnect: boolean;

	/** When reconnection window expires (null if not applicable) */
	deadline: number | null;

	/** Reason for current state */
	reason: 'seat_available' | 'seat_expired' | 'game_over' | 'kicked' | 'room_closed';
}

/**
 * Create initial seat for a joining player
 */
export function createPlayerSeat(
	userId: string,
	displayName: string,
	avatarSeed: string,
	isHost: boolean,
	turnOrder: number,
): PlayerSeat {
	const joinedAt = Date.now();
	return {
		userId,
		displayName,
		avatarSeed,
		joinedAt,
		isConnected: true,
		disconnectedAt: null,
		reconnectDeadline: null,
		isHost,
		turnOrder,
		// Phase 1: Unique identifier for alarm targeting
		odal: `seat-${userId}-${joinedAt}`,
	};
}

// =============================================================================
// Room State (persisted to storage)
// =============================================================================

/**
 * Room status progression:
 * waiting → starting → playing → paused → completed
 *                  ↘ abandoned (if all players disconnect or timeout)
 *
 * PAUSED state added for when all players disconnect during a game.
 */
export type RoomStatus = 'waiting' | 'starting' | 'playing' | 'paused' | 'completed' | 'abandoned';

/**
 * Room configuration options
 */
export interface RoomSettings {
	/** Maximum players (2-4) */
	maxPlayers: 2 | 3 | 4;

	/** Turn timeout in seconds (0 = unlimited) */
	turnTimeoutSeconds: number;

	/** Whether room is listed in public lobby */
	isPublic: boolean;

	/** Allow spectators to watch */
	allowSpectators: boolean;
}

/**
 * Default room configuration
 */
export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
	maxPlayers: 4,
	turnTimeoutSeconds: 60,
	isPublic: true,
	allowSpectators: true,
};

/**
 * Room state persisted to Durable Object storage.
 * Retrieved via ctx.storage.get<RoomState>('room')
 */
/** AI player info stored in room state */
export interface AIPlayerInfo {
	id: string;
	profileId: string;
	displayName: string;
	avatarSeed: string;
}

export interface RoomState {
	/** Room code (6 uppercase alphanumeric) */
	roomCode: string;

	/** User ID of the room host */
	hostUserId: string;

	/** Creation timestamp (epoch ms) */
	createdAt: number;

	/** Room settings */
	settings: RoomSettings;

	/** Player user IDs in turn order (shuffled at game start) */
	playerOrder: string[];

	/** Current room status */
	status: RoomStatus;

	/** When game started (epoch ms, null if not started) */
	startedAt: number | null;

	/** When room entered PAUSED state (null if not paused) */
	pausedAt: number | null;

	/** AI players in the room (added during waiting phase) */
	aiPlayers?: AIPlayerInfo[];

	/** Visual identity for lobby display (color, pattern, hype name) */
	identity?: RoomIdentity;
}

/**
 * Create initial room state for a new room
 */
export function createInitialRoomState(
	roomCode: string,
	hostUserId: string,
	settings?: Partial<RoomSettings>,
): RoomState {
	return {
		roomCode,
		hostUserId,
		createdAt: Date.now(),
		settings: { ...DEFAULT_ROOM_SETTINGS, ...settings },
		playerOrder: [hostUserId],
		status: 'waiting',
		startedAt: null,
		pausedAt: null,
	};
}

// =============================================================================
// Player Info (for broadcast messages)
// =============================================================================

/**
 * Player information sent to clients
 */
export interface PlayerInfo {
	userId: string;
	displayName: string;
	avatarSeed: string;
	isHost: boolean;
	isConnected: boolean;
}

/**
 * Spectator information sent to clients
 */
export interface SpectatorInfo {
	userId: string;
	displayName: string;
	avatarSeed: string;
	watchingSince: number;
}

// =============================================================================
// Alarm Data (for scheduled events)
// =============================================================================

/**
 * Types of alarms that can be scheduled.
 *
 * Phase 3: Unified alarm types absorbing GameStateManager and PersistenceQueue.
 * All alarm scheduling now goes through AlarmQueue.
 */
export type AlarmType =
	// Game room alarms
	| 'TURN_TIMEOUT'
	| 'AFK_CHECK'
	| 'ROOM_CLEANUP'
	| 'SEAT_EXPIRATION'
	| 'JOIN_REQUEST_EXPIRATION'
	| 'AI_TURN_TIMEOUT'
	| 'PAUSE_TIMEOUT'
	// Absorbed from GameStateManager (Phase 3)
	| 'AFK_WARNING'
	| 'AFK_TIMEOUT'
	| 'GAME_START'
	// Persistence alarms (Phase 3)
	| 'PERSIST_GAME_COMPLETION'
	| 'PERSIST_DOMAIN_EVENTS'
	| 'TRIGGER_AGGREGATION'
	| 'ABANDON_GAME';

/**
 * Timeout duration for PAUSED state before room is abandoned (30 minutes)
 */
export const PAUSE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Data stored with scheduled alarms (legacy - used for single alarm)
 */
export interface AlarmData {
	type: AlarmType;
	userId?: string;
	metadata?: Record<string, unknown>;
	/** Player ID for AI turn recovery */
	playerId?: string;
	/** Retry count for AI turn timeout (max 3) */
	retryCount?: number;
}

/**
 * Scheduled alarm for the AlarmQueue system.
 *
 * Phase 1: Supports multiple concurrent alarms via a queue stored in DO storage.
 * Phase 3: Extended with payload for persistence tasks and retry support.
 * The DO's single native alarm is set to fire for the earliest item in the queue.
 */
export interface ScheduledAlarm {
	/** Type of alarm */
	type: AlarmType;
	/** Target identifier (e.g., odal for seat expiration, null for room-level alarms) */
	targetId: string | null;
	/** When the alarm should fire (epoch ms) */
	scheduledFor: number;
	/** When the alarm was created (epoch ms) */
	createdAt: number;
	/** Optional metadata for the alarm */
	metadata?: Record<string, unknown>;
	/** Phase 3: Payload for persistence alarms */
	payload?: Record<string, unknown>;
	/** Phase 3: Retry count for persistence alarms */
	retryCount?: number;
	/** Phase 3: Max retries (default 3 for persistence) */
	maxRetries?: number;
}

// =============================================================================
// GlobalLobby ↔ GameRoom Communication
// =============================================================================

// PlayerSummary, RoomStatusUpdate, and PlayerPresenceState are now imported from @dicee/shared
// and re-exported at the top of this file. This ensures a single source of truth for
// these types across all packages.

/**
 * Game highlight event for lobby ticker
 */
export interface GameHighlight {
	roomCode: string;
	type: 'dicee' | 'high_score' | 'close_finish' | 'game_complete';
	message: string;
	playerName?: string;
	score?: number;
	timestamp: number;
}

// =============================================================================
// Gallery Predictions (D4)
// =============================================================================

/**
 * Prediction type for gallery spectators
 */
export type PredictionType = 'dicee' | 'improves' | 'bricks' | 'exact';

/**
 * A prediction made by a spectator about a player's turn outcome
 */
export interface Prediction {
	/** Unique prediction ID */
	id: string;

	/** Spectator who made the prediction */
	spectatorId: string;

	/** Spectator's display name */
	spectatorName: string;

	/** Which player the prediction is about */
	playerId: string;

	/** Type of prediction */
	type: PredictionType;

	/** For 'exact' predictions, the predicted score */
	exactScore?: number;

	/** Timestamp when prediction was made */
	timestamp: number;

	/** Whether prediction has been evaluated */
	evaluated: boolean;

	/** Whether prediction was correct (null if not yet evaluated) */
	correct: boolean | null;

	/** Points awarded for correct prediction */
	pointsAwarded: number;
}

/**
 * Result of a prediction evaluation
 */
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

/**
 * Prediction summary for a turn
 */
export interface TurnPredictionSummary {
	turnNumber: number;
	playerId: string;
	totalPredictions: number;
	predictions: Prediction[];
	results: PredictionResult[];
}

/**
 * Spectator prediction stats (for gallery points system)
 */
export interface SpectatorPredictionStats {
	spectatorId: string;
	totalPredictions: number;
	correctPredictions: number;
	accuracy: number;
	totalPoints: number;
	streak: number;
	bestStreak: number;
}

// =============================================================================
// Gallery Rooting System (D5)
// =============================================================================

/**
 * A spectator's rooting choice for a player
 */
export interface RootingChoice {
	/** Spectator who is rooting */
	spectatorId: string;

	/** Spectator's display name */
	spectatorName: string;

	/** Player being rooted for */
	playerId: string;

	/** When rooting started */
	rootedAt: number;

	/** Number of times changed this game (for rate limiting) */
	changeCount: number;
}

/**
 * Rooting summary for a player
 */
export interface PlayerRootingInfo {
	/** Player ID */
	playerId: string;

	/** Number of spectators rooting for this player */
	rooterCount: number;

	/** List of rooter display names (for UI) */
	rooterNames: string[];
}

/**
 * Rooting update event payload
 */
export interface RootingUpdate {
	/** All players' rooting info */
	players: PlayerRootingInfo[];

	/** Total spectators who have chosen a player */
	totalRooters: number;
}

// =============================================================================
// Gallery Kibitz System (D6)
// =============================================================================

/**
 * Types of kibitz votes spectators can cast
 */
export type KibitzVoteType = 'category' | 'keep' | 'action';

/**
 * A kibitz vote from a spectator suggesting a play
 */
export interface KibitzVote {
	/** Unique vote ID */
	id: string;

	/** Spectator who cast the vote */
	spectatorId: string;

	/** Spectator's display name */
	spectatorName: string;

	/** Which player this advice is for */
	playerId: string;

	/** Type of advice */
	voteType: KibitzVoteType;

	/** For 'category': which category to score */
	category?: string;

	/** For 'keep': which dice to keep (bitmask 0-31) */
	keepPattern?: number;

	/** For 'action': roll or score */
	action?: 'roll' | 'score';

	/** When vote was cast */
	timestamp: number;
}

/**
 * A votable option with aggregated counts
 */
export interface KibitzOption {
	/** Option identifier (category name, keep pattern, or action) */
	optionId: string;

	/** Human-readable label */
	label: string;

	/** Number of spectators who voted for this */
	voteCount: number;

	/** Percentage of total votes */
	percentage: number;

	/** Names of voters (first 3) */
	voterPreview: string[];
}

/**
 * Current kibitz state for a turn
 */
export interface KibitzState {
	/** Player being advised */
	playerId: string;

	/** Turn number */
	turnNumber: number;

	/** Total votes cast */
	totalVotes: number;

	/** Active vote type (what spectators are voting on) */
	activeVoteType: KibitzVoteType;

	/** Category options with vote counts */
	categoryOptions: KibitzOption[];

	/** Keep pattern options with vote counts */
	keepOptions: KibitzOption[];

	/** Action options (roll vs score) with vote counts */
	actionOptions: KibitzOption[];

	/** Whether voting is open */
	votingOpen: boolean;
}

/**
 * Kibitz update event payload
 */
export interface KibitzUpdate {
	/** Turn number */
	turnNumber: number;

	/** Player being advised */
	playerId: string;

	/** Updated vote options */
	options: KibitzOption[];

	/** Vote type that was updated */
	voteType: KibitzVoteType;

	/** Total votes for this turn */
	totalVotes: number;
}

// =============================================================================
// Gallery Spectator Reactions (D7)
// =============================================================================

/**
 * Standard reaction emojis (available to all users)
 */
export const STANDARD_REACTIONS = ['👍', '🎲', '😱', '💀', '🎉'] as const;

/**
 * Spectator-exclusive reaction emojis
 */
export const SPECTATOR_REACTIONS = ['🍿', '📢', '🙈', '🪦', '🔥', '🤡'] as const;

/**
 * Rooting-specific reactions (only for your backed player)
 */
export const ROOTING_REACTIONS = ['📣', '💪'] as const;

/**
 * All possible spectator reaction types
 */
export type SpectatorReactionEmoji =
	| (typeof STANDARD_REACTIONS)[number]
	| (typeof SPECTATOR_REACTIONS)[number]
	| (typeof ROOTING_REACTIONS)[number];

/**
 * Metadata for each reaction type
 */
export interface ReactionMetadata {
	emoji: SpectatorReactionEmoji;
	label: string;
	sound?: string;
	/** Whether this requires rooting for the target player */
	requiresRooting?: boolean;
	/** Category of reaction */
	category: 'standard' | 'spectator' | 'rooting';
}

/**
 * Complete reaction definitions with labels and sounds
 */
export const REACTION_METADATA: Record<SpectatorReactionEmoji, ReactionMetadata> = {
	// Standard reactions (also available to players)
	'👍': { emoji: '👍', label: 'Nice!', category: 'standard' },
	'🎲': { emoji: '🎲', label: 'Good roll!', category: 'standard' },
	'😱': { emoji: '😱', label: 'Wow!', sound: 'gasp.mp3', category: 'standard' },
	'💀': { emoji: '💀', label: 'Oof', category: 'standard' },
	'🎉': { emoji: '🎉', label: 'Dicee!', sound: 'celebration.mp3', category: 'standard' },

	// Spectator-exclusive reactions
	'🍿': { emoji: '🍿', label: 'Drama!', sound: 'popcorn.mp3', category: 'spectator' },
	'📢': { emoji: '📢', label: 'Called it!', sound: 'airhorn.mp3', category: 'spectator' },
	'🙈': { emoji: '🙈', label: "Can't watch", sound: 'suspense.mp3', category: 'spectator' },
	'🪦': { emoji: '🪦', label: 'RIP', sound: 'sad-trombone.mp3', category: 'spectator' },
	'🔥': { emoji: '🔥', label: 'On fire!', sound: 'fire.mp3', category: 'spectator' },
	'🤡': { emoji: '🤡', label: 'Clown play', sound: 'honk.mp3', category: 'spectator' },

	// Rooting-specific (only for your picked player)
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

/**
 * A spectator reaction sent to the game
 */
export interface SpectatorReaction {
	/** Unique reaction ID */
	id: string;

	/** Spectator who sent the reaction */
	spectatorId: string;

	/** Spectator's display name */
	spectatorName: string;

	/** The emoji used */
	emoji: SpectatorReactionEmoji;

	/** Optional: specific player the reaction is directed at */
	targetPlayerId?: string;

	/** When the reaction was sent */
	timestamp: number;
}

/**
 * Aggregated reaction for display (combo effect)
 */
export interface ReactionCombo {
	emoji: SpectatorReactionEmoji;
	count: number;
	spectatorNames: string[];
	lastTimestamp: number;
}

/**
 * Reaction event broadcast to all spectators
 */
export interface SpectatorReactionEvent {
	/** The reaction that was sent */
	reaction: SpectatorReaction;

	/** Current combo count for this emoji (recent burst) */
	comboCount: number;

	/** Whether to play sound */
	playSound: boolean;
}

/**
 * Rate limit configuration for spectator reactions
 */
export interface ReactionRateLimit {
	/** Maximum reactions per window */
	maxReactions: number;

	/** Window duration in milliseconds */
	windowMs: number;

	/** Current count in window */
	currentCount: number;

	/** When window resets */
	resetAt: number;
}

/**
 * Default rate limit: 10 reactions per 30 seconds
 */
export const DEFAULT_REACTION_RATE_LIMIT: Omit<ReactionRateLimit, 'currentCount' | 'resetAt'> = {
	maxReactions: 10,
	windowMs: 30_000,
};

// =============================================================================
// Join Queue System (D8)
// =============================================================================

/**
 * A spectator waiting in the join queue for next game
 */
export interface JoinQueueEntry {
	/** User ID of the spectator */
	userId: string;

	/** Display name */
	displayName: string;

	/** Avatar seed for DiceBear */
	avatarSeed: string;

	/** Queue position (1-based) */
	position: number;

	/** When they joined the queue */
	queuedAt: number;
}

/**
 * Complete join queue state
 */
export interface JoinQueueState {
	/** Spectators in queue, ordered by position */
	queue: JoinQueueEntry[];

	/** Maximum players allowed in next game */
	maxPlayers: number;

	/** Current player count (for calculating available spots) */
	currentPlayerCount: number;

	/** Estimated time until next game (null if game not in progress) */
	estimatedWaitMs: number | null;

	/** Whether queue is accepting new entries */
	queueOpen: boolean;
}

/**
 * Queue update event payload
 */
export interface JoinQueueUpdate {
	/** Updated queue entries */
	queue: JoinQueueEntry[];

	/** Available spots in next game */
	availableSpots: number;

	/** Total in queue */
	totalQueued: number;
}

/**
 * Warm seat transition - when spectators become players
 */
export interface WarmSeatTransition {
	/** Spectators transitioning to players */
	transitioningUsers: Array<{
		userId: string;
		displayName: string;
		avatarSeed: string;
		fromPosition: number;
	}>;

	/** Players staying from previous game */
	stayingPlayers: Array<{
		userId: string;
		displayName: string;
		avatarSeed: string;
	}>;

	/** Countdown until game starts (seconds) */
	countdownSeconds: number;

	/** When transition started */
	startedAt: number;
}

/**
 * Default warm seat countdown (10 seconds)
 */
export const WARM_SEAT_COUNTDOWN_SECONDS = 10;

/**
 * Maximum queue size
 */
export const MAX_QUEUE_SIZE = 10;

// =============================================================================
// Gallery Points & Achievements (D9)
// =============================================================================

/**
 * Gallery points breakdown by category
 */
export interface GalleryPoints {
	/** Points from predictions */
	predictions: {
		/** Points from correct predictions */
		correct: number;
		/** Streak multiplier bonus */
		streakBonus: number;
		/** Points from exact score predictions */
		exactScore: number;
	};
	/** Points from social engagement */
	social: {
		/** Points from reactions given */
		reactionsGiven: number;
		/** Points from kibitz votes (when majority agrees) */
		kibitzVotes: number;
		/** Points from chat messages */
		chatMessages: number;
	};
	/** Points from backing players */
	backing: {
		/** Points for backing the winner */
		backedWinner: number;
		/** Bonus for backing underdog who wins */
		loyaltyBonus: number;
	};
}

/**
 * Achievement IDs for spectators
 */
export type GalleryAchievementId =
	| 'oracle' // 5 correct predictions in a row
	| 'drama_magnet' // Watched 10 games with a comeback
	| 'superfan' // Backed the same player 5 times
	| 'jinx' // Your pick lost 5 times in a row
	| 'analyst' // Predicted exact score 3 times
	| 'called_it' // Predicted a Dicee correctly
	| 'voyeur' // Watched 50 games total
	| 'regular'; // Spectated in 20 different rooms

/**
 * Achievement metadata
 */
export interface GalleryAchievement {
	id: GalleryAchievementId;
	name: string;
	description: string;
	emoji: string;
	/** Threshold to unlock */
	threshold: number;
	/** Current progress (for tracking) */
	progress?: number;
	/** Whether unlocked */
	unlocked: boolean;
	/** When unlocked */
	unlockedAt?: number;
}

/**
 * Complete achievement definitions
 */
export const GALLERY_ACHIEVEMENTS: Record<
	GalleryAchievementId,
	Omit<GalleryAchievement, 'progress' | 'unlocked' | 'unlockedAt'>
> = {
	oracle: {
		id: 'oracle',
		name: 'Oracle',
		description: 'Called 5 correct predictions in a row',
		emoji: '🎯',
		threshold: 5,
	},
	drama_magnet: {
		id: 'drama_magnet',
		name: 'Drama Magnet',
		description: 'Watched 10 games with a comeback',
		emoji: '🍿',
		threshold: 10,
	},
	superfan: {
		id: 'superfan',
		name: 'Superfan',
		description: 'Backed the same player 5 times',
		emoji: '📣',
		threshold: 5,
	},
	jinx: {
		id: 'jinx',
		name: 'Jinx',
		description: 'Your pick lost 5 times in a row',
		emoji: '🤡',
		threshold: 5,
	},
	analyst: {
		id: 'analyst',
		name: 'Analyst',
		description: 'Predicted exact score 3 times',
		emoji: '🧠',
		threshold: 3,
	},
	called_it: {
		id: 'called_it',
		name: 'Called It!',
		description: 'Predicted a Dicee correctly',
		emoji: '📢',
		threshold: 1,
	},
	voyeur: {
		id: 'voyeur',
		name: 'Voyeur',
		description: 'Watched 50 games total',
		emoji: '👁',
		threshold: 50,
	},
	regular: {
		id: 'regular',
		name: 'Regular',
		description: 'Spectated in 20 different rooms',
		emoji: '🏠',
		threshold: 20,
	},
};

/**
 * Gallery stats for a spectator
 */
export interface GalleryStats {
	/** User ID */
	spectatorId: string;
	/** Display name */
	displayName: string;
	/** Total gallery points */
	totalPoints: number;
	/** Points breakdown */
	pointsBreakdown: GalleryPoints;
	/** Prediction accuracy (0-1) */
	predictionAccuracy: number;
	/** Total predictions made */
	totalPredictions: number;
	/** Correct predictions */
	correctPredictions: number;
	/** Current prediction streak */
	currentStreak: number;
	/** Best prediction streak */
	bestStreak: number;
	/** Games watched */
	gamesWatched: number;
	/** Rooms visited */
	roomsVisited: number;
	/** Times backed winner */
	backedWinnerCount: number;
	/** Total times backed a player */
	totalBackings: number;
	/** Unlocked achievements */
	achievements: GalleryAchievement[];
	/** Last updated */
	updatedAt: number;
}

/**
 * Leaderboard entry
 */
export interface GalleryLeaderboardEntry {
	rank: number;
	spectatorId: string;
	displayName: string;
	avatarSeed: string;
	totalPoints: number;
	predictionAccuracy: number;
	winPickRatio: string; // "12/15" format
	achievementCount: number;
}

/**
 * Points awarded for different actions
 */
export const GALLERY_POINT_VALUES = {
	// Predictions
	PREDICTION_CORRECT_BASE: 10,
	PREDICTION_DICEE: 50,
	PREDICTION_EXACT_SCORE: 100,
	PREDICTION_STREAK_MULTIPLIER: 0.1, // 10% bonus per streak

	// Social
	REACTION_GIVEN: 1,
	KIBITZ_MAJORITY: 2,
	CHAT_MESSAGE: 1,

	// Backing
	BACKED_WINNER: 50,
	UNDERDOG_BONUS: 25,

	// Caps per game
	MAX_REACTION_POINTS_PER_GAME: 20,
	MAX_CHAT_POINTS_PER_GAME: 10,
} as const;

/**
 * End-of-game summary for spectators
 */
export interface GalleryGameSummary {
	/** Points earned this game */
	pointsEarned: GalleryPoints;
	/** Total points (cumulative) */
	totalPointsEarned: number;
	/** Achievements unlocked this game */
	newAchievements: GalleryAchievement[];
	/** Whether backed player won */
	backedPlayerWon: boolean | null;
	/** Predictions made and results */
	predictionSummary: {
		total: number;
		correct: number;
		streak: number;
	};
	/** Cumulative stats after this game */
	cumulativeStats: {
		totalPoints: number;
		gamesWatched: number;
		bestStreak: number;
	};
}

/**
 * Create empty gallery points
 */
export function createEmptyGalleryPoints(): GalleryPoints {
	return {
		predictions: { correct: 0, streakBonus: 0, exactScore: 0 },
		social: { reactionsGiven: 0, kibitzVotes: 0, chatMessages: 0 },
		backing: { backedWinner: 0, loyaltyBonus: 0 },
	};
}

/**
 * Calculate total points from breakdown
 */
export function calculateTotalPoints(points: GalleryPoints): number {
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
// Invite System Types
// =============================================================================

/**
 * Pending invite stored in GameRoom memory.
 * Invites expire after 5 minutes.
 */
export interface PendingInvite {
	/** Unique invite ID (UUID) */
	id: string;

	/** Room code (6-char) */
	roomCode: string;

	/** Target user ID (who's being invited) */
	targetUserId: string;

	/** Target's display name */
	targetDisplayName: string;

	/** Host user ID (who sent the invite) */
	hostUserId: string;

	/** Host's display name */
	hostDisplayName: string;

	/** Host's avatar seed */
	hostAvatarSeed: string;

	/** When invite was created (Unix ms) */
	createdAt: number;

	/** When invite expires (Unix ms) */
	expiresAt: number;
}

/**
 * Invite expiration time (5 minutes)
 */
export const INVITE_EXPIRATION_MS = 5 * 60 * 1000;

/**
 * RPC payload for delivering invite from GameRoom to GlobalLobby
 */
export interface InviteDeliveryRequest {
	/** Unique invite ID */
	inviteId: string;

	/** Room code */
	roomCode: string;

	/** Target user ID */
	targetUserId: string;

	/** Host user ID */
	hostUserId: string;

	/** Host display name */
	hostDisplayName: string;

	/** Host avatar seed */
	hostAvatarSeed: string;

	/** Game type */
	game: 'dicee';

	/** Current player count in room */
	playerCount: number;

	/** Maximum players allowed */
	maxPlayers: number;

	/** When invite expires (Unix ms) */
	expiresAt: number;
}

/**
 * RPC payload for invite response from GlobalLobby to GameRoom
 */
export interface InviteResponsePayload {
	/** Invite ID */
	inviteId: string;

	/** Room code */
	roomCode: string;

	/** Target user ID who responded */
	targetUserId: string;

	/** Target's display name */
	targetDisplayName: string;

	/** Response action */
	action: 'accept' | 'decline';
}

/**
 * RPC payload for cancelling invite
 */
export interface InviteCancellationRequest {
	/** Invite ID */
	inviteId: string;

	/** Target user ID */
	targetUserId: string;

	/** Room code */
	roomCode: string;

	/** Reason for cancellation */
	reason: 'cancelled' | 'host_left' | 'room_closed' | 'room_full' | 'expired';
}

// =============================================================================
// Join Request RPC Types
// =============================================================================

/**
 * RPC payload from GlobalLobby to GameRoom when user requests to join
 */
export interface JoinRequestRPCInput {
	/** User ID of the requester */
	requesterId: string;

	/** Requester's display name */
	requesterDisplayName: string;

	/** Requester's avatar seed */
	requesterAvatarSeed: string;
}

/**
 * Join request status values
 */
export type JoinRequestStatus = 'pending' | 'approved' | 'declined' | 'expired' | 'cancelled';

/**
 * Join request entity
 */
export interface JoinRequestEntity {
	/** Unique request ID */
	id: string;

	/** Room code being requested to join */
	roomCode: string;

	/** User ID of the requester */
	requesterId: string;

	/** Requester's display name at time of request */
	requesterDisplayName: string;

	/** Requester's avatar seed */
	requesterAvatarSeed: string;

	/** When the request was created (Unix ms) */
	createdAt: number;

	/** When the request expires (Unix ms) */
	expiresAt: number;

	/** Current status of the request */
	status: JoinRequestStatus;
}

/**
 * RPC response from GameRoom to GlobalLobby after creating a join request
 */
export interface JoinRequestRPCResponse {
	/** Whether the request was created successfully */
	success: boolean;

	/** The created request (if successful) */
	request?: JoinRequestEntity;

	/** Error code (if failed) */
	errorCode?: string;

	/** Error message (if failed) */
	errorMessage?: string;
}

/**
 * RPC payload from GameRoom to GlobalLobby when delivering join request response to requester
 */
export interface JoinRequestResponseDelivery {
	/** Request ID */
	requestId: string;

	/** Requester's user ID */
	requesterId: string;

	/** Room code */
	roomCode: string;

	/** Response status */
	status: 'approved' | 'declined' | 'expired';

	/** Optional reason (for decline/expire) */
	reason?: string;
}

// =============================================================================
// DO Stub Interfaces (for cross-DO RPC without circular imports)
// =============================================================================

/**
 * GameRoom RPC interface for GlobalLobby to call.
 * This allows GlobalLobby to have typed access to GameRoom methods
 * without importing the GameRoom class directly.
 */
export interface GameRoomRpcStub {
	/** Handle a join request from a lobby user */
	handleJoinRequest(input: JoinRequestRPCInput): Promise<JoinRequestRPCResponse>;

	/** Cancel a join request (called by requester via GlobalLobby) */
	cancelJoinRequest(requestId: string, userId: string): Promise<JoinRequestRPCResponse>;

	/** Fetch handler for HTTP/WebSocket requests */
	fetch(request: Request): Promise<Response>;
}

// =============================================================================
// Re-export game types (will be populated in do-4)
// =============================================================================

// Game types will be added in Phase 4 (do-4.1)
// export * from './game/types';
