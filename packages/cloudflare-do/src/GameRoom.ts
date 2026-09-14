/**
 * GameRoom Durable Object
 *
 * Handles multiplayer game room logic with hibernatable WebSockets.
 * This is the core game server - manages connections, game state, and broadcasts.
 */

import { DurableObject } from 'cloudflare:workers';
import { generateRoomIdentity } from '@dicee/shared';
import { type AICommand, AIRoomManager, createAIPlayerState, getProfile } from './ai';
import { extractAvatarUrl, extractDisplayName, verifySupabaseJWT } from './auth';
import {
	ChatManager,
	createChatErrorResponse,
	createChatHistoryResponse,
	createChatMessageResponse,
	createReactionUpdateResponse,
	createShoutCooldownResponse,
	createShoutReceivedResponse,
	createTypingUpdateResponse,
	isChatMessageType,
	type QuickChatKey,
	type ReactionEmoji,
	validateChatMessage,
} from './chat';
import type { GlobalLobby } from './GlobalLobby';
import {
	AFK_TIMEOUT_SECONDS,
	AFK_WARNING_SECONDS,
	type Category,
	canKeepDice,
	canRematch,
	canRollDice,
	canScoreCategory,
	GameStateManager,
	type KeptMask,
	type MultiplayerGameState,
} from './game';
import { type AlarmQueue, createAlarmQueue } from './lib/alarm-queue';
import { createJoinRequestManager, type JoinRequestManager } from './lib/join-request';
import { Loggers } from './lib/logger';
import { createInstrumentation, type Instrumentation } from './lib/observability/instrumentation';
import {
	clearGameMetadata,
	clearPendingEvents,
	type DomainEvent,
	type DomainEventType,
	getEventSequence,
	getPendingEvents,
	getSupabaseGameId,
	initPersistenceTables,
	PersistenceQueue,
	type QueuedRanking,
	SupabaseRpcClient,
	setEventSequence,
	setSupabaseGameId,
} from './lib/persistence';
import { hasCurrentProtocol, rejectOutdatedProtocol } from './lib/protocol-gate';
import type {
	AlarmData,
	ConnectionRole,
	ConnectionState,
	Env,
	GalleryAchievementId,
	GalleryPoints,
	GameHighlight,
	InviteCancellationRequest,
	InviteDeliveryRequest,
	InviteResponsePayload,
	JoinQueueEntry,
	JoinQueueState,
	JoinQueueUpdate,
	JoinRequestEntity,
	JoinRequestResponseDelivery,
	JoinRequestRPCInput,
	JoinRequestRPCResponse,
	KibitzOption,
	KibitzState,
	KibitzUpdate,
	KibitzVote,
	KibitzVoteType,
	LobbyRoomStatus,
	PendingInvite,
	PlayerInfo,
	PlayerPresenceState,
	PlayerRootingInfo,
	PlayerSeat,
	PlayerSummary,
	Prediction,
	PredictionResult,
	PredictionType,
	ReactionCombo,
	ReactionRateLimit,
	RoomState,
	RoomStatusUpdate,
	RootingChoice,
	RootingUpdate,
	ScheduledAlarm,
	SpectatorInfo,
	SpectatorPredictionStats,
	SpectatorReaction,
	SpectatorReactionEmoji,
	SpectatorReactionEvent,
	WarmSeatTransition,
} from './types';
import {
	calculateTotalPoints,
	createEmptyGalleryPoints,
	createInitialRoomState,
	createPlayerSeat,
	DEFAULT_REACTION_RATE_LIMIT,
	GALLERY_ACHIEVEMENTS,
	GALLERY_POINT_VALUES,
	INVITE_EXPIRATION_MS,
	MAX_QUEUE_SIZE,
	PAUSE_TIMEOUT_MS,
	REACTION_METADATA,
	RECONNECT_WINDOW_MS,
	ROOTING_REACTIONS,
	SPECTATOR_REACTIONS,
	STANDARD_REACTIONS,
	WARM_SEAT_COUNTDOWN_SECONDS,
} from './types';

/**
 * GameRoom Durable Object - manages a single multiplayer game room
 *
 * Key features:
 * - Hibernatable WebSockets (pay only when processing, not connection duration)
 * - SQLite storage for game state persistence
 * - Tag-based connection filtering for targeted broadcasts
 * - Alarm-based turn timeouts and cleanup
 */
export class GameRoom extends DurableObject<Env> {
	/** Observability instrumentation */
	private instr: Instrumentation | null = null;

	/** Chat manager for lobby chat system */
	private chatManager: ChatManager;

	/** Game state manager for core game loop */
	private gameStateManager: GameStateManager;

	/** Stub for GlobalLobby DO for RPC calls */
	private lobbyStub: DurableObjectStub<GlobalLobby>;

	/** Gallery predictions for current turn (key: `${turnNumber}:${playerId}`) */
	private predictions: Map<string, Prediction[]> = new Map();

	/** Spectator prediction stats (key: spectatorId) */
	private spectatorStats: Map<string, SpectatorPredictionStats> = new Map();

	/** Current turn tracking for predictions */
	private currentTurn: { turnNumber: number; playerId: string } | null = null;

	/** Rooting choices (key: spectatorId, value: RootingChoice) */
	private rootingChoices: Map<string, RootingChoice> = new Map();

	/** Kibitz votes for current turn (key: spectatorId, value: KibitzVote) */
	private kibitzVotes: Map<string, KibitzVote> = new Map();

	/** Spectator reaction rate limits (key: spectatorId, value: ReactionRateLimit) */
	private reactionRateLimits: Map<string, ReactionRateLimit> = new Map();

	/** Recent reactions for combo tracking (key: emoji, value: timestamps and spectators) */
	private recentReactions: Map<
		SpectatorReactionEmoji,
		{ timestamp: number; spectatorId: string }[]
	> = new Map();

	/** Combo window in milliseconds */
	private static readonly REACTION_COMBO_WINDOW_MS = 3000;

	/** Join queue for next game (D8) */
	private joinQueue: JoinQueueEntry[] = [];

	/** Warm seat transition state (D8) */
	private warmSeatTransition: WarmSeatTransition | null = null;

	/** Gallery points per spectator for current game (D9) */
	private gameGalleryPoints: Map<string, GalleryPoints> = new Map();

	/** Per-game point caps tracking (D9) */
	private gamePointCaps: Map<string, { reactions: number; chat: number }> = new Map();

	/** AI Room Manager for handling AI player turns */
	private aiManager: AIRoomManager;

	/** Logger for structured logging (Phase 1) */
	private logger = Loggers.GameRoom();

	/** Pending invites (key: targetUserId, value: PendingInvite) */
	private pendingInvites: Map<string, PendingInvite> = new Map();

	/** Join request manager for pending join requests */
	private joinRequestManager: JoinRequestManager;

	/** Cached room code (extracted from URL on first fetch) */
	private _roomCode: string | null = null;

	/** Maximum predictions per spectator per turn */
	private static readonly MAX_PREDICTIONS_PER_TURN = 3;

	/** Maximum rooting changes per game (rate limiting) */
	private static readonly MAX_ROOTING_CHANGES = 5;

	/** Prediction points by type */
	private static readonly PREDICTION_POINTS = {
		dicee: 50, // Highest risk/reward
		exact: 25, // Exact score match
		improves: 10, // Player improves their position
		bricks: 10, // Player gets nothing/minimal
	} as const;

	/**
	 * Phase 0 Hotfix: Pause check debounce
	 *
	 * Prevents cascading disconnections when multiple players refresh simultaneously.
	 * The 2-second delay allows reconnection before checking if room should pause.
	 */
	private pauseCheckPending = false;
	private static readonly PAUSE_CHECK_DELAY_MS = 2000;

	/**
	 * Phase 1: Alarm Queue for multiple concurrent alarms
	 *
	 * Manages SEAT_EXPIRATION, PAUSE_TIMEOUT, AI_TURN_TIMEOUT, etc. concurrently
	 * without the DO's single-alarm constraint causing overwrites.
	 */
	private alarmQueue: AlarmQueue;

	// ─────────────────────────────────────────────────────────────────────────────
	// Persistence (Phase 4: RPC-Based Persistence)
	// ─────────────────────────────────────────────────────────────────────────────

	/** RPC client for atomic Supabase writes */
	private rpcClient: SupabaseRpcClient | null = null;

	/** Persistence queue for reliable async persistence with retry */
	private persistenceQueue: PersistenceQueue | null = null;

	/** Supabase game ID (persisted in DO SQLite for hibernation recovery) */
	private supabaseGameId: string | null = null;

	/** Game start time for duration tracking */
	private gameStartTime: number | null = null;

	/** Domain event sequence number for ordering */
	private eventSequence = 0;

	/** Flag to track if persistence tables have been initialized */
	private persistenceInitialized = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		// Initialize chat manager
		this.chatManager = new ChatManager(ctx);

		// Initialize game state manager (room code will be set from ctx.id.name)
		const roomCode = ctx.id.name ?? 'UNKNOWN';
		this.gameStateManager = new GameStateManager(ctx, roomCode);

		// Get stub for GlobalLobby (singleton)
		const lobbyId = env.GLOBAL_LOBBY.idFromName('singleton');
		this.lobbyStub = env.GLOBAL_LOBBY.get(lobbyId) as DurableObjectStub<GlobalLobby>;

		// Set up auto-response for ping/pong without waking the DO
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));

		// Initialize AI room manager
		this.aiManager = new AIRoomManager();

		// Initialize join request manager
		this.joinRequestManager = createJoinRequestManager();

		// Phase 1: Initialize alarm queue for multiple concurrent alarms
		this.alarmQueue = createAlarmQueue(ctx);

		// Validate required secrets are configured (logs warning if missing)
		this.validateSecrets();

		// Phase 1: Initialize persistence (DO→Supabase bridge)
		// Uses blockConcurrencyWhile to ensure tables are ready before any requests
		ctx.blockConcurrencyWhile(async () => {
			await this.initializePersistence();
		});
	}

	/**
	 * Validates that required secrets are configured.
	 * Logs a warning if any are missing - helps catch deployment issues early.
	 * See: wrangler secret put SUPABASE_URL, SUPABASE_ANON_KEY
	 */
	private validateSecrets(): void {
		const missing: string[] = [];
		if (!this.env.SUPABASE_URL) missing.push('SUPABASE_URL');
		if (!this.env.SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');

		if (missing.length > 0) {
			console.error(
				`[GameRoom] CRITICAL: Missing required secrets: ${missing.join(', ')}. ` +
					`WebSocket connections will fail. Run: wrangler secret put <SECRET_NAME>`,
			);
		}
	}

	/**
	 * Initialize persistence layer (Phase 1: DO→Supabase Bridge)
	 *
	 * Called via blockConcurrencyWhile to ensure:
	 * - DO SQLite tables are created
	 * - Service and queue are ready
	 * - Supabase game ID is recovered after hibernation
	 */
	private async initializePersistence(): Promise<void> {
		if (this.persistenceInitialized) return;

		const roomCode = this.ctx.id.name ?? 'UNKNOWN';

		try {
			// 1. Initialize DO SQLite tables for pending events and queue
			initPersistenceTables(this.ctx);

			// 2. Initialize RPC client (requires service role key)
			if (this.env.SUPABASE_SERVICE_ROLE_KEY) {
				this.logger.info('persistence.init.start', { roomCode, hasServiceKey: true });

				this.rpcClient = new SupabaseRpcClient({
					supabaseUrl: this.env.SUPABASE_URL,
					serviceRoleKey: this.env.SUPABASE_SERVICE_ROLE_KEY,
				});

				// 3. Initialize persistence queue with RPC client
				this.persistenceQueue = new PersistenceQueue(this.ctx, this.rpcClient, (task, error) => {
					this.logger.error('Persistence task failed permanently', {
						operation: 'persistence_task_failed',
						type: task.type,
						retryCount: task.retryCount,
					});
					// Log as handler failure for observability
					this.instr?.errorHandlerFailed(`persistence_${task.type}`, error);
				});

				// 4. Recover Supabase game ID after hibernation
				this.supabaseGameId = getSupabaseGameId(this.ctx);
				if (this.supabaseGameId) {
					this.logger.info('persistence.init.recovered', {
						roomCode,
						supabaseGameId: this.supabaseGameId,
					});
				}

				// 5. Recover event sequence number after hibernation (P0 fix)
				const recoveredSequence = getEventSequence(this.ctx);
				if (recoveredSequence > 0) {
					this.eventSequence = recoveredSequence;
					this.logger.info('persistence.init.sequence_recovered', {
						roomCode,
						eventSequence: this.eventSequence,
					});
				}

				this.logger.info('persistence.init.complete', { roomCode, enabled: true });
			} else {
				this.logger.warn('persistence.init.disabled', {
					roomCode,
					reason: 'SUPABASE_SERVICE_ROLE_KEY not configured',
				});
			}

			this.persistenceInitialized = true;
		} catch (err) {
			this.logger.error('persistence.init.failed', {
				roomCode,
				error: err instanceof Error ? err.message : String(err),
			});
			// Don't throw - game should still work, just without persistence
		}
	}

	/**
	 * Record a domain event for later persistence.
	 * Events are stored in DO SQLite and batched at game end.
	 */
	private recordDomainEvent(
		eventType: DomainEventType,
		playerId: string,
		payload: Record<string, unknown> = {},
		turnNumber?: number,
		rollNumber?: number,
	): void {
		if (!this.supabaseGameId) return;

		// Increment and persist sequence number (P0 fix: survives hibernation)
		const sequenceNumber = this.eventSequence++;
		setEventSequence(this.ctx, this.eventSequence);

		const event: DomainEvent = {
			id: crypto.randomUUID(),
			game_id: this.supabaseGameId,
			player_id: playerId,
			event_type: eventType,
			event_version: '1.0',
			sequence_number: sequenceNumber,
			turn_number: turnNumber ?? null,
			roll_number: rollNumber ?? null,
			payload,
		};

		// Store in DO SQLite (pending_domain_events table)
		this.ctx.storage.sql.exec(
			`INSERT INTO pending_domain_events (id, game_id, player_id, event_type, event_version, sequence_number, turn_number, roll_number, payload, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			event.id,
			event.game_id,
			event.player_id,
			event.event_type,
			'1.0', // event_version
			event.sequence_number,
			event.turn_number,
			event.roll_number,
			JSON.stringify(event.payload),
			Date.now(), // timestamp in milliseconds
		);
	}

	/**
	 * Persist game and player records to Supabase at game start.
	 * Returns the Supabase game ID on success.
	 */
	private async persistGameStart(
		roomCode: string,
		hostId: string,
		players: Array<{
			id: string;
			displayName: string;
			type?: 'human' | 'ai';
			aiProfileId?: string;
			isHost: boolean;
		}>,
	): Promise<string | null> {
		if (!this.rpcClient) {
			this.logger.debug('persistence.gameStart.skipped', { roomCode, reason: 'no rpc client' });
			return null;
		}

		// Generate Supabase game ID
		const gameId = crypto.randomUUID();

		// Determine game mode
		const humanCount = players.filter((p) => p.type !== 'ai').length;
		const gameMode = humanCount <= 1 ? 'solo' : 'multiplayer';

		this.logger.info('persistence.gameStart.begin', {
			roomCode,
			gameId,
			gameMode,
			playerCount: players.length,
			humanCount,
		});

		// Create game and seat records atomically via RPC. Seat numbers follow the
		// order of `players`, which is also the key order of gameState.players;
		// schedulePersistenceTasks relies on that to address AI seats.
		const result = await this.rpcClient.createGame({
			gameId,
			roomCode,
			hostId,
			gameMode,
			settings: {},
			players: players.map((player, index) => {
				const isAi = player.type === 'ai';
				return {
					user_id: isAi ? null : player.id,
					seat_number: index,
					turn_order: index,
					is_ai: isAi,
					ai_profile: isAi ? (player.aiProfileId ?? null) : null,
				};
			}),
		});

		if (!result.success) {
			this.logger.error('persistence.gameStart.failed', {
				roomCode,
				gameId,
				error: result.error,
				retriable: result.retriable,
			});
			return null;
		}

		this.logger.debug('persistence.gameStart.atomicCreate', {
			roomCode,
			gameId,
			affectedRows: result.data.affected_rows,
		});

		// Store game ID for hibernation recovery
		setSupabaseGameId(this.ctx, gameId);
		this.supabaseGameId = gameId;
		this.gameStartTime = Date.now();
		this.eventSequence = 0;

		this.logger.info('persistence.gameStart.complete', { roomCode, gameId, gameMode });

		return gameId;
	}

	/**
	 * Schedule persistence tasks at game completion.
	 * Uses the persistence queue for reliable async processing.
	 */
	private async schedulePersistenceTasks(
		rankings: Array<{
			playerId: string;
			displayName: string;
			rank: number;
			score: number;
			diceeCount: number;
		}>,
	): Promise<void> {
		const roomCode = this._roomCode ?? 'UNKNOWN';

		if (!this.persistenceQueue || !this.supabaseGameId) {
			this.logger.debug('persistence.schedule.skipped', {
				roomCode,
				reason: !this.persistenceQueue ? 'no queue' : 'no gameId',
			});
			return;
		}

		const gameId = this.supabaseGameId;
		const durationMs = this.gameStartTime ? Date.now() - this.gameStartTime : 0;

		this.logger.info('persistence.schedule.begin', {
			roomCode,
			gameId,
			durationMs,
			winnerId: rankings[0]?.playerId,
			playerCount: rankings.length,
		});

		// Get pending events from DO SQLite
		const pendingEvents = getPendingEvents(this.ctx, gameId);

		// Get game state for player scorecard and type data
		const gameState = await this.gameStateManager.getState();
		const players = gameState?.players ?? {};
		// Seat numbers match persistGameStart: the key order of gameState.players.
		const seatNumbers = new Map(Object.keys(players).map((id, seat) => [id, seat]));
		const isHuman = (playerId: string) => players[playerId]?.type === 'human';

		// 1. Schedule game completion persistence
		const queuedRankings: QueuedRanking[] = rankings.map((r) => {
			const player = players[r.playerId];
			const isAi = player?.type === 'ai';
			// Convert Scorecard to Record<string, number> (null values become 0)
			const scorecardRecord: Record<string, number> = {};
			if (player?.scorecard) {
				for (const [key, value] of Object.entries(player.scorecard)) {
					scorecardRecord[key] = value ?? 0;
				}
			}
			return {
				playerId: isAi ? null : r.playerId,
				seatNumber: seatNumbers.get(r.playerId) ?? -1,
				rank: r.rank,
				score: r.score,
				scorecard: scorecardRecord,
				isAi,
			};
		});
		const winner = rankings[0];

		await this.persistenceQueue.schedule({
			type: 'PERSIST_GAME_COMPLETION',
			gameId,
			payload: {
				// games.winner_id references a profile, so an AI winner is stored as null.
				winnerId: winner && isHuman(winner.playerId) ? winner.playerId : null,
				rankings: queuedRankings,
				durationMs,
			},
		});

		// 2. Schedule domain events persistence. domain_events.player_id references a
		// profile, so only events of human seats are persisted.
		const humanEvents = pendingEvents.filter((e) => isHuman(e.player_id));
		if (humanEvents.length > 0) {
			const eventsForPersistence: DomainEvent[] = humanEvents.map((e) => ({
				id: e.id,
				game_id: e.game_id,
				player_id: e.player_id,
				event_type: e.event_type as DomainEventType,
				event_version: e.event_version,
				sequence_number: e.sequence_number,
				turn_number: e.turn_number,
				roll_number: e.roll_number,
				payload: e.payload,
				timestamp: new Date(e.timestamp).toISOString(), // Convert ms to ISO datetime
			}));

			await this.persistenceQueue.schedule({
				type: 'PERSIST_DOMAIN_EVENTS',
				gameId,
				payload: { events: eventsForPersistence },
			});
		}

		// 3. Refresh the player_stats projection after completion and events are
		// persisted. The RPC recomputes absolute values, so retries are safe.
		await this.persistenceQueue.schedule(
			{ type: 'TRIGGER_AGGREGATION', gameId, payload: {} },
			500, // 500ms delay so completion and events are persisted first
		);

		// 4. Clear pending events after scheduling
		clearPendingEvents(this.ctx, gameId);
		clearGameMetadata(this.ctx);

		// Reset persistence state for next game
		this.supabaseGameId = null;
		this.gameStartTime = null;
		this.eventSequence = 0;

		this.logger.info('persistence.schedule.complete', {
			roomCode,
			gameId,
			tasksScheduled: 3,
			eventsQueued: pendingEvents.length,
		});
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// HTTP/WebSocket Entry Point
	// ─────────────────────────────────────────────────────────────────────────────

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		const upgradeHeader = request.headers.get('Upgrade');

		// Close outdated clients with 4426 before any room, seat or presence work
		if (upgradeHeader === 'websocket' && !hasCurrentProtocol(url)) {
			return rejectOutdatedProtocol(url, 'GameRoom');
		}

		// Extract room code from URL path on first fetch (e.g., /room/FFDVNG or just /FFDVNG)
		if (!this._roomCode) {
			const pathMatch = url.pathname.match(/\/room\/([A-Z0-9]{6})|\/([A-Z0-9]{6})/i);
			if (pathMatch) {
				this._roomCode = (pathMatch[1] || pathMatch[2]).toUpperCase();
				// Store in storage for persistence across hibernation
				await this.ctx.storage.put('room_code', this._roomCode);
			} else {
				// Try to load from storage (hibernation recovery)
				this._roomCode = (await this.ctx.storage.get<string>('room_code')) ?? 'UNKNOWN';
			}
		}

		// Initialize instrumentation if not already initialized
		await this.ensureInstrumentation();

		// WebSocket upgrade request
		if (upgradeHeader === 'websocket') {
			return this.handleWebSocketUpgrade(request, url);
		}

		// HTTP endpoints
		if (request.method === 'GET' && url.pathname.endsWith('/info')) {
			return this.handleRoomInfo();
		}

		return new Response('Method Not Allowed', { status: 405 });
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// WebSocket Upgrade with Authentication
	// ─────────────────────────────────────────────────────────────────────────────

	private async handleWebSocketUpgrade(request: Request, url: URL): Promise<Response> {
		const authorization = request.headers.get('Authorization');
		const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
		if (!token) {
			return new Response('Missing token', { status: 401 });
		}

		// Extract role from query params (default to player)
		const roleParam = url.searchParams.get('role');
		const role: ConnectionRole = roleParam === 'spectator' ? 'spectator' : 'player';

		// Check if room allows spectators (if spectator role requested)
		if (role === 'spectator') {
			const roomState = await this.ctx.storage.get<RoomState>('room');
			if (roomState && !roomState.settings.allowSpectators) {
				return new Response('Spectators not allowed in this room', { status: 403 });
			}
		}

		// Verify JWT - tries JWKS first (ES256), falls back to HS256 if secret provided
		const authResult = await verifySupabaseJWT(
			token,
			this.env.SUPABASE_URL,
			this.env.SUPABASE_JWT_SECRET,
		);
		if (!authResult.success) {
			// Return appropriate error based on failure reason
			const statusCode =
				authResult.code === 'EXPIRED' ? 401 : authResult.code === 'JWKS_ERROR' ? 503 : 401;
			return new Response(authResult.error, { status: statusCode });
		}

		// Extract user info from verified claims
		const userId = authResult.claims.sub;
		const displayName = extractDisplayName(authResult.claims);
		const avatarUrl = extractAvatarUrl(authResult.claims);

		// Create WebSocket pair
		const { 0: clientSocket, 1: serverSocket } = new WebSocketPair();

		// Accept with hibernation enabled
		// Tags allow filtering connections: getWebSockets('user:abc123'), getWebSockets('spectator:room')
		const roomCode = this.getRoomCode();
		const tags = [`user:${userId}`, `room:${roomCode}`, `role:${role}`];
		if (role === 'spectator') {
			tags.push(`spectator:${roomCode}`);
		} else {
			tags.push(`player:${roomCode}`);
		}
		this.ctx.acceptWebSocket(serverSocket, tags);

		// Attach state that survives hibernation
		const connectionState: ConnectionState = {
			userId,
			displayName,
			avatarSeed: avatarUrl ?? userId,
			connectedAt: Date.now(),
			isHost: false,
			role,
		};
		serverSocket.serializeAttachment(connectionState);

		// Handle connection setup in background
		this.ctx.waitUntil(this.onConnect(serverSocket, connectionState));

		// Return 101 Switching Protocols
		return new Response(null, { status: 101, webSocket: clientSocket });
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Hibernatable WebSocket Handlers
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Called when WebSocket receives a message.
	 * If DO was hibernated, it wakes up, deserializes state, handles message.
	 */
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		// Load room code from storage if not cached (hibernation recovery)
		if (!this._roomCode) {
			this._roomCode = (await this.ctx.storage.get<string>('room_code')) ?? 'UNKNOWN';
		}

		if (typeof message !== 'string') {
			ws.close(1003, 'Binary messages not supported');
			return;
		}
		if (new TextEncoder().encode(message).byteLength > 64 * 1024) {
			ws.close(1009, 'Message too large');
			return;
		}

		// Recover connection state after potential hibernation
		const connState = ws.deserializeAttachment() as ConnectionState;

		try {
			const parsed = JSON.parse(message) as {
				type: string;
				payload?: unknown;
				correlationId?: string;
			};
			if (
				!parsed ||
				typeof parsed !== 'object' ||
				typeof parsed.type !== 'string' ||
				(parsed.correlationId !== undefined &&
					(typeof parsed.correlationId !== 'string' ||
						!/^[A-Za-z0-9._:-]{1,64}$/.test(parsed.correlationId)))
			) {
				throw new Error('Invalid message envelope');
			}
			await this.handleMessage(ws, connState, parsed);
		} catch {
			this.sendError(ws, 'INVALID_MESSAGE', 'Failed to parse message');
		}
	}

	/**
	 * Called when WebSocket closes (client disconnect or error).
	 */
	async webSocketClose(
		ws: WebSocket,
		code: number,
		reason: string,
		_wasClean: boolean,
	): Promise<void> {
		// Load room code from storage if not cached (hibernation recovery)
		if (!this._roomCode) {
			this._roomCode = (await this.ctx.storage.get<string>('room_code')) ?? 'UNKNOWN';
		}

		await this.ensureInstrumentation();

		const connState = ws.deserializeAttachment() as ConnectionState;
		const connectionId = `conn-${connState.userId}`;
		const wasPlayer = connState.role === 'player';

		// Log disconnection
		this.instr?.clientDisconnect(connState.userId, code, reason, wasPlayer, connectionId);

		await this.onDisconnect(connState, code, reason);
	}

	/**
	 * Called on WebSocket error.
	 */
	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		// Load room code from storage if not cached (hibernation recovery)
		if (!this._roomCode) {
			this._roomCode = (await this.ctx.storage.get<string>('room_code')) ?? 'UNKNOWN';
		}

		await this.ensureInstrumentation();

		const connState = ws.deserializeAttachment() as ConnectionState;
		this.instr?.errorHandlerFailed('webSocketError', error);
		await this.onDisconnect(connState, 1011, 'Internal error');
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Alarm Handler
	// ─────────────────────────────────────────────────────────────────────────────

	async alarm(): Promise<void> {
		// Load room code from storage if not cached (hibernation recovery)
		if (!this._roomCode) {
			this._roomCode = (await this.ctx.storage.get<string>('room_code')) ?? 'UNKNOWN';
		}

		// Phase 1: Process all due alarms from the queue
		const dueAlarms = await this.alarmQueue.processAlarms();

		// Phase 1: Also process persistence queue tasks
		// Both queues share the DO's single alarm, so we process both when it fires
		if (this.persistenceQueue) {
			try {
				await this.persistenceQueue.processDueTasks();
			} catch (err) {
				this.logger.error('Persistence queue processing failed', {
					operation: 'persistence_queue_failed',
				});
				this.instr?.errorHandlerFailed('persistence_queue_failed', err);
			}
		}

		// If no alarms from queue, check legacy alarm_data for backwards compatibility
		if (dueAlarms.length === 0) {
			const alarmData = await this.ctx.storage.get<AlarmData>('alarm_data');
			if (alarmData) {
				await this.handleLegacyAlarm(alarmData);
				return;
			}
			return;
		}

		// Process each due alarm
		for (const alarm of dueAlarms) {
			await this.handleScheduledAlarm(alarm);
		}
	}

	/**
	 * Handle a scheduled alarm from the AlarmQueue.
	 * Phase 1 implementation for concurrent alarm support.
	 */
	private async handleScheduledAlarm(alarm: ScheduledAlarm): Promise<void> {
		switch (alarm.type) {
			case 'TURN_TIMEOUT':
				await this.handleTurnTimeout(alarm.targetId ?? undefined);
				break;
			case 'AFK_CHECK':
				await this.handleAfkCheck(alarm.targetId ?? undefined);
				break;
			case 'AFK_WARNING':
				await this.handleAfkWarning(alarm.targetId ?? undefined);
				break;
			case 'AFK_TIMEOUT':
				await this.handleAfkTimeout(alarm.targetId ?? undefined);
				break;
			case 'ROOM_CLEANUP':
				// Check for warm seat completion (metadata.warmSeat)
				if (alarm.metadata?.warmSeat) {
					await this.completeWarmSeatTransition();
				} else {
					await this.handleRoomCleanup();
				}
				break;
			case 'SEAT_EXPIRATION':
				// targetId is the odal of the seat to expire
				if (alarm.targetId) {
					await this.handleSingleSeatExpiration(alarm.targetId);
				} else {
					// Fallback for alarms scheduled without targetId
					await this.handleSeatExpiration();
				}
				break;
			case 'JOIN_REQUEST_EXPIRATION':
				await this.handleJoinRequestExpiration(alarm.metadata?.requestId as string);
				break;
			case 'AI_TURN_TIMEOUT':
				// AI turn timeout needs special handling for retries
				await this.handleAITurnTimeoutFromQueue(alarm);
				break;
			case 'PAUSE_TIMEOUT':
				await this.handlePauseTimeout();
				break;
		}
	}

	/**
	 * Handle legacy alarm_data format for backwards compatibility.
	 * This handles alarms scheduled before Phase 1 deployment.
	 */
	private async handleLegacyAlarm(alarmData: AlarmData): Promise<void> {
		switch (alarmData.type) {
			case 'TURN_TIMEOUT':
				await this.handleTurnTimeout(alarmData.userId);
				break;
			case 'AFK_CHECK':
				await this.handleAfkCheck(alarmData.userId);
				break;
			case 'AFK_WARNING':
				// Phase 3: Support AFK warning alarms
				await this.handleAfkWarning(alarmData.userId ?? alarmData.playerId);
				break;
			case 'AFK_TIMEOUT':
				// Phase 3: Support AFK timeout alarms
				await this.handleAfkTimeout(alarmData.userId ?? alarmData.playerId);
				break;
			case 'ROOM_CLEANUP':
				// Legacy warmSeat handling
				if (alarmData.metadata?.warmSeat) {
					await this.completeWarmSeatTransition();
				} else {
					await this.handleRoomCleanup();
				}
				break;
			case 'SEAT_EXPIRATION':
				await this.handleSeatExpiration();
				break;
			case 'JOIN_REQUEST_EXPIRATION':
				await this.handleJoinRequestExpiration(alarmData.metadata?.requestId as string);
				break;
			case 'AI_TURN_TIMEOUT':
				await this.handleAITurnTimeout(alarmData);
				// Don't delete alarm_data here - handler manages it for retries
				return;
			case 'PAUSE_TIMEOUT':
				await this.handlePauseTimeout();
				break;
		}

		await this.ctx.storage.delete('alarm_data');
	}

	/**
	 * Handle turn timeout - auto-score the lowest available category
	 */
	private async handleTurnTimeout(userId: string | undefined): Promise<void> {
		if (!userId) return;

		const gameState = await this.gameStateManager.getState();
		if (!gameState) return;

		// Verify this player is still the current player
		const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];
		if (currentPlayerId !== userId) return;

		// Skip the turn with auto-scoring
		const result = await this.gameStateManager.skipTurn(userId, 'timeout');

		// Broadcast the auto-score
		this.broadcast({
			type: 'TURN_SKIPPED',
			payload: {
				playerId: userId,
				reason: 'timeout',
				category: result.categoryScored,
				score: result.score,
			},
		});

		// Also send to spectators
		this.broadcastToSpectators({
			type: 'TURN_SKIPPED',
			payload: {
				playerId: userId,
				reason: 'timeout',
				category: result.categoryScored,
				score: result.score,
			},
		});

		// Handle game completion or turn advancement
		if (result.gameCompleted) {
			this.handleGameOver(result.rankings);
		} else if (result.nextPlayerId) {
			// Broadcast turn change
			this.broadcast({
				type: 'TURN_CHANGED',
				payload: {
					currentPlayerId: result.nextPlayerId,
					phase: result.nextPhase,
				},
			});

			this.broadcastToSpectators({
				type: 'TURN_CHANGED',
				payload: {
					currentPlayerId: result.nextPlayerId,
					phase: result.nextPhase,
				},
			});

			// Schedule timeout for next player (Phase 3: unified alarms)
			const roomState = await this.ctx.storage.get<RoomState>('room');
			if (roomState?.settings.turnTimeoutSeconds && roomState.settings.turnTimeoutSeconds > 0) {
				await this.alarmQueue.schedule({
					type: 'AFK_WARNING',
					targetId: result.nextPlayerId,
					scheduledFor: Date.now() + AFK_WARNING_SECONDS * 1000,
				});
			}
		}

		await this.notifyLobbyOfUpdate();
	}

	/**
	 * Handle AFK check - mark player as disconnected and potentially skip turn
	 */
	private async handleAfkCheck(userId: string | undefined): Promise<void> {
		if (!userId) return;

		// Check if user has reconnected
		const userConnections = this.ctx.getWebSockets(`user:${userId}`);
		if (userConnections.length > 0) {
			// User reconnected, cancel AFK
			return;
		}

		// Update player connection status
		await this.gameStateManager.updatePlayerConnection(userId, false);

		// Broadcast player status change
		this.broadcast({
			type: 'PLAYER_AFK',
			payload: {
				userId,
				status: 'disconnected',
			},
		});

		// Check if this player's turn - if so, skip it
		const gameState = await this.gameStateManager.getState();
		if (gameState) {
			const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];
			if (currentPlayerId === userId) {
				// Skip their turn
				await this.handleTurnTimeout(userId);
			}
		}
	}

	/**
	 * Handle AFK warning - notify player they're about to timeout (Phase 3: unified alarms)
	 */
	private async handleAfkWarning(userId: string | undefined): Promise<void> {
		if (!userId) return;

		const gameState = await this.gameStateManager.getState();
		if (!gameState) return;

		// Verify this player is still the current player
		const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];
		if (currentPlayerId !== userId) return;

		// Check if user is connected - if so, cancel the warning
		const userConnections = this.ctx.getWebSockets(`user:${userId}`);
		if (userConnections.length === 0) {
			// User is disconnected, skip straight to timeout
			await this.handleAfkTimeout(userId);
			return;
		}

		// Broadcast AFK warning to the player
		this.broadcast({
			type: 'AFK_WARNING',
			payload: {
				userId,
				secondsUntilTimeout: AFK_TIMEOUT_SECONDS,
			},
		});

		// Schedule the timeout alarm
		await this.alarmQueue.schedule({
			type: 'AFK_TIMEOUT',
			targetId: userId,
			scheduledFor: Date.now() + AFK_TIMEOUT_SECONDS * 1000,
		});
	}

	/**
	 * Handle AFK timeout - auto-skip player's turn (Phase 3: unified alarms)
	 */
	private async handleAfkTimeout(userId: string | undefined): Promise<void> {
		if (!userId) return;

		const gameState = await this.gameStateManager.getState();
		if (!gameState) return;

		// Verify this player is still the current player
		const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];
		if (currentPlayerId !== userId) return;

		// Use existing turn timeout logic
		await this.handleTurnTimeout(userId);
	}

	/**
	 * Handle room cleanup - close room if abandoned
	 */
	private async handleRoomCleanup(): Promise<void> {
		const connectedPlayers = this.getConnectedUserIds();

		if (connectedPlayers.length === 0) {
			// No players left, clean up room
			const roomState = await this.ctx.storage.get<RoomState>('room');
			if (roomState) {
				roomState.status = 'abandoned';
				await this.ctx.storage.put('room', roomState);
			}

			// Notify lobby that room is gone
			await this.notifyLobbyOfUpdate();

			// Close all spectator connections
			const roomCode = this.getRoomCode();
			for (const ws of this.ctx.getWebSockets(`spectator:${roomCode}`)) {
				ws.close(1000, 'Room abandoned');
			}
		}
	}

	/**
	 * Handle pause timeout - transition PAUSED room to ABANDONED.
	 * Called when the 30-minute pause timeout expires without any players reconnecting.
	 */
	private async handlePauseTimeout(): Promise<void> {
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) return;

		// Only abandon if still paused
		if (roomState.status !== 'paused') {
			return;
		}

		// Transition to ABANDONED
		roomState.status = 'abandoned';
		roomState.pausedAt = null;
		await this.ctx.storage.put('room', roomState);

		// Notify lobby
		await this.notifyLobbyOfUpdate();

		// Broadcast to any connected spectators
		this.broadcastToSpectators({
			type: 'ROOM_STATUS',
			payload: {
				status: 'abandoned',
				reason: 'pause_timeout',
			},
		});

		// Close all spectator connections
		const roomCode = this.getRoomCode();
		for (const ws of this.ctx.getWebSockets(`spectator:${roomCode}`)) {
			ws.close(1000, 'Game abandoned - all players disconnected');
		}
	}

	/**
	 * Schedule a delayed pause check to allow reconnection during page refresh.
	 *
	 * This prevents cascading disconnections when multiple players refresh
	 * simultaneously - the 2-second window allows them to reconnect before
	 * the room considers transitioning to PAUSED state.
	 *
	 * Uses waitUntil + setTimeout instead of DO alarm to avoid overwriting
	 * existing seat expiration alarms (single-alarm constraint).
	 */
	private scheduleDelayedPauseCheck(): void {
		if (this.pauseCheckPending) {
			// Already scheduled, don't duplicate
			return;
		}

		this.pauseCheckPending = true;

		// Use waitUntil to ensure the DO stays alive during the delay
		this.ctx.waitUntil(
			new Promise<void>((resolve) => {
				setTimeout(async () => {
					this.pauseCheckPending = false;

					// Re-check if we should pause (players may have reconnected)
					await this.checkIfRoomShouldPause();

					resolve();
				}, GameRoom.PAUSE_CHECK_DELAY_MS);
			}),
		);
	}

	/**
	 * Check if the room should transition to PAUSED state.
	 * Called after the debounce delay (not directly on disconnect).
	 *
	 * Room enters PAUSED when:
	 * - Game is in 'playing' state
	 * - All players are disconnected (no active WebSocket connections)
	 */
	private async checkIfRoomShouldPause(): Promise<void> {
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) return;

		// Only pause during active gameplay
		if (roomState.status !== 'playing') {
			return;
		}

		// Check if ANY players are still connected
		const roomCode = this.getRoomCode();
		const connectedPlayers = this.ctx.getWebSockets(`player:${roomCode}`);

		if (connectedPlayers.length === 0) {
			// All players disconnected - pause the game
			roomState.status = 'paused';
			roomState.pausedAt = Date.now();
			await this.ctx.storage.put('room', roomState);

			// Schedule pause timeout alarm (30 minutes)
			await this.schedulePauseTimeoutAlarm();

			// Notify lobby of status change
			await this.notifyLobbyOfUpdate();

			// Notify spectators
			this.broadcastToSpectators({
				type: 'ROOM_STATUS',
				payload: {
					status: 'paused',
					pausedAt: roomState.pausedAt,
					reason: 'all_players_disconnected',
				},
			});
		}
	}

	/**
	 * Schedule the pause timeout alarm (30 minutes).
	 * Phase 1: Uses AlarmQueue for concurrent alarm support.
	 */
	private async schedulePauseTimeoutAlarm(): Promise<void> {
		await this.alarmQueue.schedule({
			type: 'PAUSE_TIMEOUT',
			targetId: null, // Room-level alarm
			scheduledFor: Date.now() + PAUSE_TIMEOUT_MS,
		});
	}

	/**
	 * Resume the room from PAUSED state when a player reconnects.
	 * Called during handleReconnection().
	 */
	private async resumeFromPause(): Promise<void> {
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState || roomState.status !== 'paused') return;

		// Transition back to playing
		roomState.status = 'playing';
		roomState.pausedAt = null;
		await this.ctx.storage.put('room', roomState);

		// Phase 1: Cancel pause timeout via alarm queue
		await this.alarmQueue.cancel('PAUSE_TIMEOUT', null);

		// Also clean up legacy alarm_data if present
		const alarmData = await this.ctx.storage.get<AlarmData>('alarm_data');
		if (alarmData?.type === 'PAUSE_TIMEOUT') {
			await this.ctx.storage.delete('alarm_data');
		}

		// Notify lobby of status change
		await this.notifyLobbyOfUpdate();

		// Broadcast game resumed to all connected clients
		this.broadcast({
			type: 'ROOM_STATUS',
			payload: {
				status: 'playing',
				reason: 'player_reconnected',
			},
		});

		this.broadcastToSpectators({
			type: 'ROOM_STATUS',
			payload: {
				status: 'playing',
				reason: 'player_reconnected',
			},
		});
	}

	/**
	 * Handle AI turn timeout alarm - recover stuck AI turns after hibernation.
	 * HIBERNATION-SAFE: Reloads all state from storage before acting.
	 */
	private async handleAITurnTimeout(alarmData: AlarmData): Promise<void> {
		await this.ensureInstrumentation();
		const playerId = alarmData.playerId;
		if (!playerId) {
			this.instr?.errorHandlerFailed(
				'aiTurnTimeout',
				new Error('AI turn timeout alarm with no playerId'),
			);
			await this.ctx.storage.delete('alarm_data');
			return;
		}

		// Check if AI turn already completed (ai_turn_state was deleted on success)
		const aiTurnState = await this.ctx.storage.get<{
			playerId: string;
			scheduledAt: number;
			status: string;
		}>('ai_turn_state');
		if (!aiTurnState) {
			// Turn already completed - alarm is stale (not an error)
			await this.ctx.storage.delete('alarm_data');
			return;
		}

		// CRITICAL: Reload game state from storage (hibernation-safe)
		const gameState = await this.gameStateManager.getState();
		if (!gameState) {
			this.instr?.errorHandlerFailed(
				'aiTurnTimeout',
				new Error('AI turn timeout - no game state found'),
			);
			await this.ctx.storage.delete('alarm_data');
			await this.ctx.storage.delete('ai_turn_state');
			return;
		}

		// Verify it's still this player's turn
		const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];
		if (currentPlayerId !== playerId) {
			// Player changed - clearing stale state (not an error)
			await this.ctx.storage.delete('alarm_data');
			await this.ctx.storage.delete('ai_turn_state');
			return;
		}

		const retryCount = alarmData.retryCount ?? 0;
		// Recovery attempt logged via error handler if it fails

		if (retryCount < 3) {
			// Phase 1: Schedule retry via AlarmQueue
			await this.alarmQueue.schedule({
				type: 'AI_TURN_TIMEOUT',
				targetId: playerId,
				scheduledFor: Date.now() + 5000,
				metadata: { retryCount: retryCount + 1 },
			});

			// Clean up legacy alarm_data
			await this.ctx.storage.delete('alarm_data');

			// Try executing turn again
			this.ctx.waitUntil(this.executeAITurnWithRecovery(playerId));
		} else {
			// Give up - force a valid action
			this.instr?.errorHandlerFailed(
				'aiTurnTimeout',
				new Error(`AI turn retries exhausted - forcing action for ${playerId}`),
			);
			await this.forceAIAction(playerId);
			await this.ctx.storage.delete('alarm_data');
			await this.ctx.storage.delete('ai_turn_state');
		}
	}

	/**
	 * Force AI to take a valid action when all retries exhausted.
	 * Picks the first available category and scores 0 to unstick the game.
	 */
	private async forceAIAction(playerId: string): Promise<void> {
		const gameState = await this.gameStateManager.getState();
		if (!gameState) return;

		const player = gameState.players[playerId];
		if (!player) return;

		// Find first available category
		const availableCategories = Object.entries(player.scorecard)
			.filter(([_, score]) => score === null)
			.map(([cat]) => cat);

		if (availableCategories.length > 0) {
			const category = availableCategories[0];
			// Force action logged via error handler

			// Execute the scoring through normal game flow
			try {
				await this.executeAICommand(playerId, {
					type: 'score',
					category: category as Category,
				});
			} catch (error) {
				this.instr?.errorHandlerFailed('forceAIAction', error);
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Helper Methods
	// ─────────────────────────────────────────────────────────────────────────────

	private getRoomCode(): string {
		// Return cached room code (set in fetch() from URL or storage)
		return this._roomCode ?? 'UNKNOWN';
	}

	/**
	 * Broadcast message to all connected WebSockets.
	 */
	private broadcast(message: object, exclude?: WebSocket): void {
		const allSockets = this.ctx.getWebSockets();
		const msgType = (message as { type?: string }).type ?? 'unknown';
		let sentCount = 0;

		// Log broadcast preparation
		this.instr?.broadcastPrepare(msgType, allSockets.length - (exclude ? 1 : 0));

		const payload = JSON.stringify(message);
		for (const ws of allSockets) {
			if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(payload);
					sentCount++;
				} catch (error) {
					const connState = ws.deserializeAttachment() as ConnectionState | null;
					this.instr?.errorBroadcastFailed(msgType, connState?.userId ?? 'unknown', error);
				}
			}
		}

		// Log broadcast completion
		this.instr?.broadcastSent(msgType, sentCount, allSockets.length);
	}

	/**
	 * Broadcast message to players only (exclude spectators).
	 */
	private broadcastToPlayers(message: object, exclude?: WebSocket): void {
		const payload = JSON.stringify(message);
		const roomCode = this.getRoomCode();
		for (const ws of this.ctx.getWebSockets(`player:${roomCode}`)) {
			if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
				ws.send(payload);
			}
		}
	}

	/**
	 * Broadcast message to spectators only.
	 */
	private broadcastToSpectators(message: object): void {
		const payload = JSON.stringify(message);
		const roomCode = this.getRoomCode();
		for (const ws of this.ctx.getWebSockets(`spectator:${roomCode}`)) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(payload);
			}
		}
	}

	/**
	 * Send full game state sync to a specific connection.
	 * Used for reconnection and spectator mid-game joins.
	 *
	 * This ensures the client has the COMPLETE, AUTHORITATIVE game state,
	 * not just incremental updates. Critical for session continuity.
	 */
	private async sendGameStateSync(
		ws: WebSocket,
		gameState: MultiplayerGameState,
		isReconnection: boolean,
	): Promise<void> {
		// Derive currentPlayerId from playerOrder and currentPlayerIndex
		const currentPlayerId =
			gameState.playerOrder[gameState.currentPlayerIndex] ?? gameState.playerOrder[0] ?? '';

		ws.send(
			JSON.stringify({
				type: 'GAME_STATE_SYNC',
				payload: {
					playerOrder: gameState.playerOrder,
					currentPlayerId,
					turnNumber: gameState.turnNumber,
					roundNumber: gameState.roundNumber,
					phase: gameState.phase,
					players: gameState.players,
					isReconnection,
					timestamp: Date.now(),
				},
			}),
		);
	}

	/**
	 * Send to specific user by ID.
	 */
	private sendToUser(userId: string, message: object): void {
		const payload = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets(`user:${userId}`)) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(payload);
			}
		}
	}

	/**
	 * Send error response.
	 */
	private sendError(ws: WebSocket, code: string, message: string): void {
		ws.send(JSON.stringify({ type: 'ERROR', payload: { code, message } }));
	}

	/**
	 * Get all connected player user IDs (excludes spectators).
	 */
	private getConnectedUserIds(): string[] {
		const userIds = new Set<string>();
		const roomCode = this.getRoomCode();
		for (const ws of this.ctx.getWebSockets(`player:${roomCode}`)) {
			const state = ws.deserializeAttachment() as ConnectionState;
			userIds.add(state.userId);
		}
		return Array.from(userIds);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Seat Reservation System (Phase 3 - Reconnection)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Get all player seats from storage.
	 * Seats persist through hibernation and track reconnection windows.
	 */
	private async getSeats(): Promise<Map<string, PlayerSeat>> {
		const stored = await this.getStorage<[string, PlayerSeat][]>('seats');
		return new Map(stored ?? []);
	}

	/**
	 * Save seats to storage.
	 */
	private async saveSeats(seats: Map<string, PlayerSeat>): Promise<void> {
		await this.putStorage('seats', [...seats.entries()]);
	}

	/**
	 * Reserve a seat for a new player.
	 * Returns true if seat was reserved, false if room is full.
	 */
	private async reserveSeat(
		userId: string,
		displayName: string,
		avatarSeed: string,
		isHost: boolean,
	): Promise<boolean> {
		const seats = await this.getSeats();
		const roomState = await this.ctx.storage.get<RoomState>('room');
		const maxPlayers = roomState?.settings.maxPlayers ?? 4;

		// Check if room is full (only count active seats - connected or within reconnect window)
		const now = Date.now();
		const activeSeats = [...seats.values()].filter(
			(seat) =>
				seat.isConnected || (seat.reconnectDeadline !== null && seat.reconnectDeadline > now),
		);

		if (activeSeats.length >= maxPlayers) {
			return false; // Room full
		}

		// Create new seat
		const turnOrder = seats.size; // Position based on total seats (including expired)
		const seat = createPlayerSeat(userId, displayName, avatarSeed, isHost, turnOrder);
		seats.set(userId, seat);
		await this.saveSeats(seats);

		this.instr?.seatAssign(userId, turnOrder, displayName);
		return true;
	}

	/**
	 * Mark a player as disconnected and start reconnect window.
	 * Returns the seat if successfully marked, null if player has no seat.
	 */
	private async markSeatDisconnected(userId: string): Promise<PlayerSeat | null> {
		const seats = await this.getSeats();
		const seat = seats.get(userId);

		if (!seat) {
			return null;
		}

		// Update seat with disconnect info
		seat.isConnected = false;
		seat.disconnectedAt = Date.now();
		seat.reconnectDeadline = Date.now() + RECONNECT_WINDOW_MS;

		seats.set(userId, seat);
		await this.saveSeats(seats);

		// Schedule alarm for seat expiration (Phase 1: with odal for targeted expiration)
		await this.scheduleSeatExpirationAlarm(seat.reconnectDeadline, seat.odal);

		// Reserve seat for reconnection
		this.instr?.seatReserve(userId, seat.turnOrder, seat.reconnectDeadline);
		return seat;
	}

	/**
	 * Handle player reconnection - reclaim their seat.
	 * Returns true if reconnection succeeded, false if seat expired.
	 *
	 * IMPORTANT: If seat has expired, this function CLEANS UP the expired seat
	 * and removes the player from playerOrder to avoid inconsistent state.
	 */
	private async handleReconnection(
		userId: string,
	): Promise<{ success: boolean; seat: PlayerSeat | null }> {
		const seats = await this.getSeats();
		const seat = seats.get(userId);

		if (!seat) {
			return { success: false, seat: null };
		}

		const now = Date.now();

		// Check if reconnect window is still valid
		if (!seat.isConnected && seat.reconnectDeadline !== null && seat.reconnectDeadline < now) {
			// Seat expired - CLEAN UP the expired seat to avoid inconsistent state
			const turnOrder = seat.turnOrder;
			seats.delete(userId);
			await this.saveSeats(seats);

			// Also remove from playerOrder in room state
			const roomState = await this.ctx.storage.get<RoomState>('room');
			if (roomState && roomState.playerOrder.includes(userId)) {
				roomState.playerOrder = roomState.playerOrder.filter((id) => id !== userId);
				await this.ctx.storage.put('room', roomState);
			}

			// Log the cleanup - seatRelease captures the expiration,
			// seatReclaimAttempt with withinWindow=false indicates failed reclaim
			this.instr?.seatRelease(userId, turnOrder, 'expired_on_reconnect');
			this.instr?.seatReclaimAttempt(userId, true, false, false);

			return { success: false, seat: null };
		}

		// Log pre-reclaim state for debugging (capture before we modify)
		const hadReservedSeat = seat.reconnectDeadline !== null;
		const gameState = await this.gameStateManager.getState();
		const hasActiveGame = gameState !== null && gameState.phase !== 'waiting';
		const withinWindow = seat.reconnectDeadline !== null && seat.reconnectDeadline >= now;

		// Reclaim seat
		seat.isConnected = true;
		seat.disconnectedAt = null;
		seat.reconnectDeadline = null;

		seats.set(userId, seat);
		await this.saveSeats(seats);

		// Phase 1: Cancel the seat expiration alarm for this player
		await this.alarmQueue.cancel('SEAT_EXPIRATION', seat.odal);

		// If room was paused because all players disconnected, resume
		await this.resumeFromPause();

		// Log seat reclaim attempt and result
		this.instr?.seatReclaimAttempt(userId, hadReservedSeat, hasActiveGame, withinWindow);
		this.instr?.seatReclaimResult(userId, 'reclaimed');
		return { success: true, seat };
	}

	/**
	 * Schedule seat expiration alarm.
	 * Phase 1: Uses AlarmQueue for concurrent seat expirations.
	 */
	private async scheduleSeatExpirationAlarm(deadline: number, odal: string): Promise<void> {
		await this.alarmQueue.schedule({
			type: 'SEAT_EXPIRATION',
			targetId: odal,
			scheduledFor: deadline,
		});
	}

	/**
	 * Handle seat expiration alarm - remove expired seats (legacy bulk handler).
	 * Used for backwards compatibility with alarms scheduled before Phase 1.
	 */
	private async handleSeatExpiration(): Promise<void> {
		const seats = await this.getSeats();
		const now = Date.now();
		const expiredSeats: PlayerSeat[] = [];

		for (const [userId, seat] of seats) {
			if (!seat.isConnected && seat.reconnectDeadline !== null) {
				if (now >= seat.reconnectDeadline) {
					// Seat expired - remove
					expiredSeats.push(seat);
					seats.delete(userId);
				} else {
					// Not yet expired - schedule via queue (Phase 1)
					await this.alarmQueue.schedule({
						type: 'SEAT_EXPIRATION',
						targetId: seat.odal,
						scheduledFor: seat.reconnectDeadline,
					});
				}
			}
		}

		// Save updated seats and broadcast
		if (expiredSeats.length > 0) {
			await this.saveSeats(seats);
			await this.broadcastSeatExpirations(expiredSeats);
		}
	}

	/**
	 * Handle single seat expiration by odal (Phase 1).
	 * Called by AlarmQueue for targeted seat expiration.
	 */
	private async handleSingleSeatExpiration(odal: string): Promise<void> {
		const seats = await this.getSeats();
		const now = Date.now();
		let expiredSeat: PlayerSeat | null = null;
		let seatUserId: string | null = null;

		// Find and remove the specific seat
		for (const [userId, seat] of seats) {
			if (seat.odal === odal) {
				// Check if actually expired (might have reconnected)
				if (!seat.isConnected && seat.reconnectDeadline !== null && now >= seat.reconnectDeadline) {
					expiredSeat = seat;
					seatUserId = userId;
					seats.delete(userId);
				}
				break;
			}
		}

		// Process expiration if seat was actually expired
		if (expiredSeat && seatUserId) {
			await this.saveSeats(seats);
			await this.broadcastSeatExpirations([expiredSeat]);
		}
	}

	/**
	 * Broadcast seat expiration events and update room state.
	 */
	private async broadcastSeatExpirations(expiredSeats: PlayerSeat[]): Promise<void> {
		if (expiredSeats.length === 0) return;

		// Broadcast each expiration
		for (const seat of expiredSeats) {
			this.instr?.seatRelease(seat.userId, seat.turnOrder, 'timeout');

			this.broadcast({
				type: 'PLAYER_SEAT_EXPIRED',
				payload: {
					userId: seat.userId,
					displayName: seat.displayName,
				},
			});

			// Also notify spectators
			this.broadcastToSpectators({
				type: 'PLAYER_SEAT_EXPIRED',
				payload: {
					userId: seat.userId,
					displayName: seat.displayName,
				},
			});
		}

		// Update room playerOrder to remove expired players
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (roomState) {
			const expiredUserIds = new Set(expiredSeats.map((s) => s.userId));
			roomState.playerOrder = roomState.playerOrder.filter((id) => !expiredUserIds.has(id));
			await this.ctx.storage.put('room', roomState);
		}

		// Notify lobby of player count change
		await this.notifyLobbyOfUpdate();
	}

	/**
	 * Handle AI turn timeout from AlarmQueue (Phase 1).
	 * Supports retries via rescheduling in the queue.
	 */
	private async handleAITurnTimeoutFromQueue(alarm: ScheduledAlarm): Promise<void> {
		const playerId = alarm.targetId;
		if (!playerId) return;

		const retryCount = (alarm.metadata?.retryCount as number) ?? 0;

		// Check if AI is still current player
		const gameState = await this.gameStateManager.getState();
		if (!gameState) return;

		const currentPlayerId = gameState.playerOrder[gameState.currentPlayerIndex];
		if (currentPlayerId !== playerId) {
			// Not current player anymore - no action needed
			return;
		}

		// If max retries exceeded, force end turn
		if (retryCount >= 3) {
			this.logger.warn('AI turn timeout max retries exceeded, forcing turn skip', {
				playerId,
				retryCount,
			});
			// Force a turn skip similar to player timeout
			await this.handleTurnTimeout(playerId);
			return;
		}

		// Schedule retry
		await this.alarmQueue.schedule({
			type: 'AI_TURN_TIMEOUT',
			targetId: playerId,
			scheduledFor: Date.now() + 5000,
			metadata: { retryCount: retryCount + 1 },
		});

		// Execute AI turn
		this.ctx.waitUntil(this.executeAITurnWithRecovery(playerId));
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// GlobalLobby Notifications
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Notify GlobalLobby of room status changes.
	 * Call on: player join/leave, spectator join/leave, game start, round change, game end.
	 *
	 * IMPORTANT: Uses persistent seat data (not just connected WebSockets) to include
	 * disconnected players with their presence state for reconnection UX.
	 */
	private async notifyLobbyOfUpdate(): Promise<void> {
		try {
			const roomState = await this.ctx.storage.get<RoomState>('room');
			if (!roomState) return;

			// Get host info from connected socket OR seat data (fallback)
			const hostConnection = this.ctx.getWebSockets(`user:${roomState.hostUserId}`)[0];
			const hostState = hostConnection?.deserializeAttachment() as ConnectionState | undefined;

			// Build player summaries from SEATS (not just connected WebSockets)
			// This ensures disconnected players are included with their presence state
			const seats = await this.getSeats();
			const gameState = await this.gameStateManager.getState();
			const now = Date.now();

			const players: PlayerSummary[] = [];

			for (const [userId, seat] of seats) {
				// Determine presence state from seat data
				let presenceState: PlayerPresenceState = 'connected';
				if (!seat.isConnected) {
					if (seat.reconnectDeadline && seat.reconnectDeadline > now) {
						presenceState = 'disconnected';
					} else {
						presenceState = 'abandoned';
					}
				}

				// Get score from game state if available
				const playerScore = gameState?.players[userId]?.totalScore ?? 0;

				players.push({
					userId: seat.userId,
					displayName: seat.displayName,
					avatarSeed: seat.avatarSeed,
					score: playerScore,
					isHost: seat.isHost,
					presenceState,
					reconnectDeadline: seat.reconnectDeadline,
					lastSeenAt: seat.disconnectedAt,
				});
			}

			// Map room status to lobby status (including PAUSED)
			let lobbyStatus: LobbyRoomStatus;
			switch (roomState.status) {
				case 'completed':
				case 'abandoned':
					lobbyStatus = 'finished';
					break;
				case 'paused':
					lobbyStatus = 'paused';
					break;
				case 'waiting':
					lobbyStatus = 'waiting';
					break;
				default:
					lobbyStatus = 'playing';
			}

			// Count active players (connected + disconnected within grace period)
			const activePlayerCount = players.filter((p) => p.presenceState !== 'abandoned').length;

			const update: RoomStatusUpdate = {
				roomCode: roomState.roomCode,
				status: lobbyStatus,
				playerCount: activePlayerCount,
				spectatorCount: this.getSpectatorCount(),
				maxPlayers: roomState.settings.maxPlayers,
				roundNumber: gameState?.roundNumber ?? 0,
				totalRounds: 13,
				isPublic: roomState.settings.isPublic,
				allowSpectators: roomState.settings.allowSpectators,
				players,
				hostId: roomState.hostUserId,
				hostName:
					hostState?.displayName ?? seats.get(roomState.hostUserId)?.displayName ?? 'Unknown',
				game: 'dicee',
				updatedAt: Date.now(),
				pausedAt: roomState.pausedAt,
				identity: roomState.identity,
			};

			// Call GlobalLobby RPC
			this.lobbyStub.updateRoomStatus(update);
			// Room status update logged via broadcast events
		} catch (error) {
			await this.ensureInstrumentation();
			this.instr?.errorHandlerFailed('notifyLobby', error);
		}
	}

	/**
	 * Send a highlight event to the lobby ticker.
	 */
	private sendLobbyHighlight(
		type: GameHighlight['type'],
		message: string,
		playerName?: string,
		score?: number,
	): void {
		try {
			const highlight: GameHighlight = {
				roomCode: this.getRoomCode(),
				type,
				message,
				playerName,
				score,
				timestamp: Date.now(),
			};
			this.lobbyStub.sendHighlight(highlight);
		} catch (error) {
			this.instr?.errorHandlerFailed('sendHighlight', error);
		}
	}

	/**
	 * Notify GlobalLobby that a user has entered or left this room.
	 * This updates the user's currentRoomCode in their lobby presence,
	 * enabling features like the invite modal to show which users are in rooms.
	 *
	 * Includes retry logic for resilience against transient failures.
	 *
	 * @param userId - The user who entered/left
	 * @param action - 'entered' when joining, 'left' when leaving
	 */
	private notifyLobbyUserRoomStatus(userId: string, action: 'entered' | 'left'): void {
		const roomCode = this.getRoomCode();
		const maxRetries = 3;

		const attemptNotify = (attempt: number): void => {
			try {
				this.lobbyStub.updateUserRoomStatus(userId, roomCode, action);
				// Lobby notification success (no event needed - internal operation)
			} catch (error) {
				if (attempt < maxRetries) {
					// Exponential backoff: 100ms, 200ms, 400ms
					const delay = 100 * 2 ** attempt;
					// Retry logged via connection events
					setTimeout(() => attemptNotify(attempt + 1), delay);
				} else {
					this.instr?.errorHandlerFailed('notifyLobbyUserRoomStatus', error);
				}
			}
		};

		attemptNotify(0);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Instrumentation Helpers
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Ensure instrumentation is initialized (lazy initialization)
	 * Called on first access after hibernation wake
	 */
	private async ensureInstrumentation(): Promise<void> {
		if (this.instr) return;

		// Load room code if not cached
		if (!this._roomCode) {
			this._roomCode = (await this.ctx.storage.get<string>('room_code')) ?? 'UNKNOWN';
		}

		// Initialize instrumentation
		this.instr = createInstrumentation('GameRoom', this._roomCode);

		// Log hibernation wake with storage audit
		const allKeys = Array.from((await this.ctx.storage.list()).keys());
		const connectedClients = this.ctx.getWebSockets().length;
		this.instr.hibernationWake(allKeys, connectedClients);
	}

	/**
	 * Instrumented storage.get wrapper
	 * Logs read operations with timing and size information
	 */
	private async getStorage<T>(key: string): Promise<T | undefined> {
		await this.ensureInstrumentation();
		this.instr?.storageReadStart(key);

		const startTime = Date.now();
		try {
			const value = await this.ctx.storage.get<T>(key);
			const duration = Date.now() - startTime;
			const found = value !== undefined;
			const valueType = found ? typeof value : undefined;
			const sizeBytes = found ? JSON.stringify(value).length : undefined;

			this.instr?.storageReadEnd(key, found, valueType, duration, sizeBytes);
			return value;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.instr?.errorStorageFailed('get', key, error);
			this.instr?.storageReadEnd(key, false, undefined, duration);
			throw error;
		}
	}

	/**
	 * Instrumented storage.put wrapper
	 * Logs write operations with timing and size information
	 */
	private async putStorage<T>(key: string, value: T): Promise<void> {
		await this.ensureInstrumentation();
		const valueType = typeof value;
		const sizeBytes = JSON.stringify(value).length;
		this.instr?.storageWriteStart(key, valueType, sizeBytes);

		const startTime = Date.now();
		try {
			await this.ctx.storage.put(key, value);
			const duration = Date.now() - startTime;
			this.instr?.storageWriteEnd(key, true, duration);
		} catch (error) {
			const duration = Date.now() - startTime;
			this.instr?.errorStorageFailed('put', key, error);
			this.instr?.storageWriteEnd(key, false, duration);
			throw error;
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Connection Lifecycle
	// ─────────────────────────────────────────────────────────────────────────────

	private async onConnect(ws: WebSocket, connState: ConnectionState): Promise<void> {
		await this.ensureInstrumentation();
		// Initialize chat manager (loads state from storage)
		await this.chatManager.initialize();

		// Load or initialize room state
		let roomState = await this.ctx.storage.get<RoomState>('room');

		if (connState.role === 'spectator') {
			// Spectator connection - room must already exist
			if (!roomState) {
				ws.close(4004, 'Room not found');
				return;
			}

			// Send initial state to spectator
			ws.send(
				JSON.stringify({
					type: 'SPECTATOR_CONNECTED',
					payload: {
						roomCode: roomState.roomCode,
						players: await this.getPlayerList(),
						spectators: this.getSpectatorList(),
						roomStatus: roomState.status,
						spectatorCount: this.getSpectatorCount(),
					},
				}),
			);

			// Send chat history to spectator
			this.sendChatHistory(ws);

			// CRITICAL: Send full game state sync if game is active
			// This ensures spectators joining mid-game see complete state
			const currentGameState = await this.gameStateManager.getState();
			if (currentGameState && (roomState.status === 'playing' || roomState.status === 'starting')) {
				await this.sendGameStateSync(ws, currentGameState, false);
			}

			// Notify everyone about new spectator
			const spectatorMsg = await this.chatManager.createSystemMessage(
				`${connState.displayName} is now watching`,
			);
			this.broadcast(createChatMessageResponse(spectatorMsg));

			// Broadcast spectator join to everyone
			this.broadcast(
				{
					type: 'SPECTATOR_JOINED',
					payload: {
						userId: connState.userId,
						displayName: connState.displayName,
						avatarSeed: connState.avatarSeed,
						spectatorCount: this.getSpectatorCount(),
					},
				},
				ws,
			);

			// Notify GlobalLobby of spectator count change
			await this.notifyLobbyOfUpdate();

			// Notify GlobalLobby that user is now in this room
			this.notifyLobbyUserRoomStatus(connState.userId, 'entered');
			return;
		}

		// Player connection - check for reconnection or new join
		let isReconnection = false;
		let isInitialCreation = false;
		let reconnectedSeat: PlayerSeat | null = null;

		if (!roomState) {
			// First connection creates the room
			isInitialCreation = true;
			const roomCode = this.getRoomCode();
			roomState = createInitialRoomState(roomCode, connState.userId);
			// Generate visual identity for lobby display
			roomState.identity = generateRoomIdentity(roomCode);
			await this.ctx.storage.put('room', roomState);

			// Update connection state to mark as host
			connState.isHost = true;
			ws.serializeAttachment(connState);

			// Reserve seat for host
			await this.reserveSeat(connState.userId, connState.displayName, connState.avatarSeed, true);
		} else {
			// Check for reconnection - player might have a reserved seat
			const reconnectionResult = await this.handleReconnection(connState.userId);

			if (reconnectionResult.success && reconnectionResult.seat) {
				// Successful reconnection
				isReconnection = true;
				reconnectedSeat = reconnectionResult.seat;
				connState.isHost = reconnectedSeat.isHost;
				ws.serializeAttachment(connState);

				// Get connection ID from WebSocket tags or generate one
				const connectionId = `conn-${connState.userId}-${Date.now()}`;
				this.instr?.clientReconnect(
					connState.userId,
					'unknown', // Previous connection ID not tracked
					connectionId,
				);
			} else {
				// New player or seat expired
				connState.isHost = connState.userId === roomState.hostUserId;
				ws.serializeAttachment(connState);

				// Try to reserve a new seat
				const seatReserved = await this.reserveSeat(
					connState.userId,
					connState.displayName,
					connState.avatarSeed,
					connState.isHost,
				);

				if (!seatReserved) {
					// Room is full - close connection
					ws.close(4003, 'Room is full');
					return;
				}

				// Add to player order if new
				if (!roomState.playerOrder.includes(connState.userId)) {
					roomState.playerOrder.push(connState.userId);
					await this.ctx.storage.put('room', roomState);
				}
			}
		}

		// Send initial state to connection
		// Pass ws to ensure the just-connected player is included in the player list
		const playerList = await this.getPlayerList(ws);
		ws.send(
			JSON.stringify({
				type: 'CONNECTED',
				payload: {
					roomCode: roomState.roomCode,
					isHost: connState.isHost,
					players: playerList,
					aiPlayers: roomState.aiPlayers ?? [],
					spectators: this.getSpectatorList(),
					roomStatus: roomState.status,
					spectatorCount: this.getSpectatorCount(),
					reconnected: isReconnection,
				},
			}),
		);

		// Send chat history to connection
		this.sendChatHistory(ws);

		// Send current typing users
		const typingUsers = this.chatManager.getTypingUsers();
		if (typingUsers.length > 0) {
			ws.send(JSON.stringify(createTypingUpdateResponse(typingUsers)));
		}

		if (isReconnection) {
			// Reconnection - broadcast reconnection event
			const systemMsg = await this.chatManager.createSystemMessage(
				`${connState.displayName} reconnected`,
			);
			this.broadcast(createChatMessageResponse(systemMsg));

			this.broadcast(
				{
					type: 'PLAYER_RECONNECTED',
					payload: {
						userId: connState.userId,
						displayName: connState.displayName,
						avatarSeed: connState.avatarSeed,
					},
				},
				ws,
			);

			// Also notify spectators
			this.broadcastToSpectators({
				type: 'PLAYER_RECONNECTED',
				payload: {
					userId: connState.userId,
					displayName: connState.displayName,
					avatarSeed: connState.avatarSeed,
				},
			});

			// Phase 5: Record PlayerReconnected domain event
			this.recordDomainEvent('PlayerReconnected', connState.userId, {
				displayName: connState.displayName,
			});

			// CRITICAL: Send full game state sync if game is active
			// This ensures reconnecting players have complete, authoritative state
			const currentGameState = await this.gameStateManager.getState();
			if (currentGameState && (roomState.status === 'playing' || roomState.status === 'starting')) {
				await this.sendGameStateSync(ws, currentGameState, true);

				// HIBERNATION RECOVERY: Check if it's AI's turn but no AI turn is in progress
				// This can happen if DO hibernated after a human scored but before AI turn triggered
				const currentPlayerId = currentGameState.playerOrder[currentGameState.currentPlayerIndex];
				const currentPlayer = currentGameState.players[currentPlayerId];
				if (currentPlayer?.type === 'ai') {
					const aiTurnState = await this.ctx.storage.get('ai_turn_state');
					if (!aiTurnState) {
						this.logger.info('Detected stuck AI turn on reconnection, triggering recovery', {
							operation: 'ai_stuck_recovery',
							playerId: currentPlayerId,
							aiProfileId: currentPlayer.aiProfileId,
						});
						// Use waitUntil to avoid blocking the reconnection flow
						this.ctx.waitUntil(this.triggerAITurnIfNeeded(currentPlayerId));
					}
				}
			}
		} else if (isInitialCreation) {
			// Host created the room - welcome is shown on the waiting room UI
			// No chat message needed since the user is alone
		} else {
			// New player joining - broadcast join event with friendly message
			const joinMsg = await this.chatManager.createSystemMessage(
				`${connState.displayName} joined! Welcome to the game.`,
			);
			this.broadcast(createChatMessageResponse(joinMsg));

			this.broadcast(
				{
					type: 'PLAYER_JOINED',
					payload: {
						userId: connState.userId,
						displayName: connState.displayName,
						avatarSeed: connState.avatarSeed,
					},
				},
				ws,
			);
		}

		// Check if room is now full and cancel pending invites
		const playerCount = this.getConnectedPlayerCount() + (roomState.aiPlayers?.length ?? 0);
		if (playerCount >= roomState.settings.maxPlayers && this.pendingInvites.size > 0) {
			await this.cancelAllInvites('room_full');
		}

		// Notify GlobalLobby of player count change
		await this.notifyLobbyOfUpdate();

		// Notify GlobalLobby that user is now in this room
		this.notifyLobbyUserRoomStatus(connState.userId, 'entered');
	}

	private async handleMessage(
		ws: WebSocket,
		connState: ConnectionState,
		message: { type: string; payload?: unknown; correlationId?: string },
	): Promise<void> {
		await this.ensureInstrumentation();

		const { type, payload, correlationId } = message;

		// Set correlation ID for this request (propagates to all events in this request)
		if (correlationId) {
			this.instr?.setCorrelationId(correlationId);
		}

		try {
			// Message receipt is logged via broadcast.prepare when broadcasting responses

			// Route chat-related messages through ChatManager
			if (isChatMessageType(type)) {
				await this.handleChatMessage(ws, connState, message);
				return;
			}

			switch (type) {
				case 'START_GAME':
					await this.handleStartGame(ws, connState);
					break;

				case 'QUICK_PLAY_START':
					await this.handleQuickPlayStart(ws, connState, payload as { aiProfiles: string[] });
					break;

				case 'ADD_AI_PLAYER':
					await this.handleAddAIPlayer(ws, connState, payload as { profileId: string });
					break;

				case 'REMOVE_AI_PLAYER':
					await this.handleRemoveAIPlayer(ws, connState, payload as { playerId: string });
					break;

				// ─────────────────────────────────────────────────────────────────────────
				// Core Game Loop Commands (DO-4)
				// ─────────────────────────────────────────────────────────────────────────

				case 'DICE_ROLL':
					await this.handleDiceRoll(ws, connState, payload as { kept?: boolean[] });
					break;

				case 'DICE_KEEP':
					await this.handleDiceKeep(ws, connState, payload as { indices: number[] });
					break;

				case 'CATEGORY_SCORE':
					await this.handleCategoryScore(ws, connState, payload as { category: Category });
					break;

				case 'PREDICTION':
					await this.handlePrediction(
						ws,
						connState,
						payload as {
							playerId: string;
							type: PredictionType;
							exactScore?: number;
						},
					);
					break;

				case 'CANCEL_PREDICTION':
					this.handleCancelPrediction(ws, connState, payload as { predictionId: string });
					break;

				case 'GET_PREDICTIONS':
					this.handleGetPredictions(ws);
					break;

				case 'GET_PREDICTION_STATS':
					this.handleGetPredictionStats(ws, connState);
					break;

				case 'ROOT_FOR_PLAYER':
					this.handleRootForPlayer(ws, connState, payload as { playerId: string });
					break;

				case 'CLEAR_ROOTING':
					this.handleClearRooting(ws, connState);
					break;

				case 'GET_ROOTING':
					this.handleGetRooting(ws);
					break;

				case 'KIBITZ':
					this.handleKibitz(
						ws,
						connState,
						payload as {
							playerId: string;
							voteType: KibitzVoteType;
							category?: string;
							keepPattern?: number;
							action?: 'roll' | 'score';
						},
					);
					break;

				case 'CLEAR_KIBITZ':
					this.handleClearKibitz(ws, connState);
					break;

				case 'GET_KIBITZ':
					this.handleGetKibitz(ws);
					break;

				// ─────────────────────────────────────────────────────────────────────────
				// Spectator Reaction Messages (D7)
				// ─────────────────────────────────────────────────────────────────────────

				case 'SPECTATOR_REACTION':
					this.handleSpectatorReaction(
						ws,
						connState,
						payload as {
							emoji: SpectatorReactionEmoji;
							targetPlayerId?: string;
						},
					);
					break;

				// ─────────────────────────────────────────────────────────────────────────
				// Join Queue Messages (D8)
				// ─────────────────────────────────────────────────────────────────────────

				case 'JOIN_QUEUE':
					this.handleJoinQueue(ws, connState);
					break;

				case 'LEAVE_QUEUE':
					this.handleLeaveQueue(ws, connState);
					break;

				case 'GET_QUEUE':
					this.handleGetQueue(ws);
					break;

				// ─────────────────────────────────────────────────────────────────────────
				// Gallery Points Messages (D9)
				// ─────────────────────────────────────────────────────────────────────────

				case 'GET_GALLERY_POINTS':
					this.handleGetGalleryPoints(ws, connState);
					break;

				// ─────────────────────────────────────────────────────────────────────────
				// Invite System Messages
				// ─────────────────────────────────────────────────────────────────────────

				case 'SEND_INVITE':
					await this.handleSendInvite(ws, connState, payload as { targetUserId: string });
					break;

				case 'CANCEL_INVITE':
					await this.handleCancelInvite(ws, connState, payload as { targetUserId: string });
					break;

				// ─────────────────────────────────────────────────────────────────────────
				// Join Request Messages (host response to join requests)
				// ─────────────────────────────────────────────────────────────────────────

				case 'JOIN_REQUEST_RESPONSE':
					await this.handleJoinRequestResponse(
						ws,
						connState,
						payload as { requestId: string; approved: boolean },
					);
					break;

				case 'PING':
					ws.send(JSON.stringify({ type: 'PONG', payload: Date.now() }));
					break;

				case 'REMATCH':
					await this.handleRematch(ws, connState);
					break;

				default:
					this.sendError(ws, 'UNKNOWN_COMMAND', `Unknown message type: ${type}`);
			}
		} catch (error) {
			// Log handler errors with correlation ID preserved
			this.instr?.errorHandlerFailed(`handleMessage.${type}`, error);
			throw error;
		} finally {
			// Clear correlation ID after request handling (ensures clean state for next request)
			if (correlationId) {
				this.instr?.clearCorrelationId();
			}
		}
	}

	private async onDisconnect(
		connState: ConnectionState,
		code: number,
		_reason: string,
	): Promise<void> {
		// Clear typing indicator for disconnected user
		const wasTyping = this.chatManager.clearTyping(connState.userId);
		if (wasTyping) {
			this.broadcastTypingUpdate();
		}

		const reason = code === 1000 ? 'left' : 'disconnected';

		if (connState.role === 'spectator') {
			// Spectator disconnect - no AFK check needed
			const systemMsg = await this.chatManager.createSystemMessage(
				`${connState.displayName} stopped watching`,
			);
			this.broadcast(createChatMessageResponse(systemMsg));

			// Remove from join queue if they were queued (D8)
			this.removeFromQueueOnDisconnect(connState.userId);

			// Notify about spectator leaving
			this.broadcast({
				type: 'SPECTATOR_LEFT',
				payload: {
					userId: connState.userId,
					displayName: connState.displayName,
					spectatorCount: this.getSpectatorCount(),
				},
			});

			// Notify GlobalLobby of spectator count change
			await this.notifyLobbyOfUpdate();

			// Notify GlobalLobby that user left this room
			this.notifyLobbyUserRoomStatus(connState.userId, 'left');
			return;
		}

		// Player disconnect - reserve their seat with reconnection window
		const seat = await this.markSeatDisconnected(connState.userId);

		if (seat) {
			// Create system message for temporary disconnect
			const systemMsg = await this.chatManager.createSystemMessage(
				`${connState.displayName} ${reason === 'left' ? 'left' : 'disconnected'} (${Math.round(RECONNECT_WINDOW_MS / 60000)} min to reconnect)`,
			);
			this.broadcast(createChatMessageResponse(systemMsg));

			// Notify other players with reconnection deadline
			this.broadcast({
				type: 'PLAYER_DISCONNECTED',
				payload: {
					userId: connState.userId,
					displayName: connState.displayName,
					reconnectDeadline: seat.reconnectDeadline,
				},
			});

			// Also notify spectators
			this.broadcastToSpectators({
				type: 'PLAYER_DISCONNECTED',
				payload: {
					userId: connState.userId,
					displayName: connState.displayName,
					reconnectDeadline: seat.reconnectDeadline,
				},
			});
		} else {
			// No seat found (shouldn't happen normally) - fallback to old behavior
			const systemMsg = await this.chatManager.createSystemMessage(
				`${connState.displayName} ${reason === 'left' ? 'left the lobby' : 'disconnected'}`,
			);
			this.broadcast(createChatMessageResponse(systemMsg));

			this.broadcast({
				type: 'PLAYER_LEFT',
				payload: {
					userId: connState.userId,
					displayName: connState.displayName,
					reason,
				},
			});
		}

		// Phase 5: Record PlayerDisconnected domain event
		if (connState.role === 'player') {
			this.recordDomainEvent('PlayerDisconnected', connState.userId, {
				reason,
				reconnectDeadline: seat?.reconnectDeadline ?? null,
			});
		}

		// If host left, cancel all pending invites
		if (connState.isHost && this.pendingInvites.size > 0) {
			await this.cancelAllInvites('host_left');
		}

		// Notify GlobalLobby of player count change
		await this.notifyLobbyOfUpdate();

		// Schedule delayed pause check (Phase 0 Hotfix)
		// The 2-second delay prevents cascading disconnections during page refresh
		// by allowing players to reconnect before checking if room should pause
		this.scheduleDelayedPauseCheck();

		// Only notify GlobalLobby that user "left" if they don't have a reserved seat
		// If they have a seat, the lobby already knows they're "disconnected" via notifyLobbyOfUpdate()
		// Sending 'left' would incorrectly signal they've permanently departed
		if (!seat) {
			this.notifyLobbyUserRoomStatus(connState.userId, 'left');
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Invite System Handlers
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle host sending an invite to an online user.
	 */
	private async handleSendInvite(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { targetUserId: string },
	): Promise<void> {
		// Only host can send invites
		if (!connState.isHost) {
			this.sendError(ws, 'NOT_HOST', 'Only the host can send invites');
			return;
		}

		const { targetUserId } = payload;

		// Cannot invite yourself
		if (targetUserId === connState.userId) {
			this.sendError(ws, 'CANNOT_INVITE_SELF', 'Cannot invite yourself');
			return;
		}

		// Check if room is in waiting status
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState || roomState.status !== 'waiting') {
			this.sendError(ws, 'ROOM_NOT_WAITING', 'Room is not accepting new players');
			return;
		}

		// Check if room is full
		const playerCount = this.getConnectedPlayerCount() + (roomState.aiPlayers?.length ?? 0);
		if (playerCount >= roomState.settings.maxPlayers) {
			this.sendError(ws, 'ROOM_FULL', 'Room is full');
			return;
		}

		// Check if already invited this user
		if (this.pendingInvites.has(targetUserId)) {
			this.sendError(ws, 'ALREADY_INVITED', 'User already has a pending invite');
			return;
		}

		// Check if user is already in the room
		const roomCode = this.getRoomCode();
		const existingPlayerConnections = this.ctx.getWebSockets(`user:${targetUserId}`);
		for (const pws of existingPlayerConnections) {
			const state = pws.deserializeAttachment() as ConnectionState | null;
			if (state?.role === 'player') {
				this.sendError(ws, 'USER_IN_ROOM', 'User is already in this room');
				return;
			}
		}

		// Check if target user is online via GlobalLobby
		const isOnline = await this.lobbyStub.isUserOnline(targetUserId);
		if (!isOnline) {
			this.sendError(ws, 'USER_OFFLINE', 'User is not online');
			return;
		}

		// Get target user info from GlobalLobby
		const targetInfo = await this.lobbyStub.getOnlineUserInfo(targetUserId);
		if (!targetInfo) {
			this.sendError(ws, 'USER_NOT_FOUND', 'Could not find user info');
			return;
		}

		// Create the invite
		const inviteId = crypto.randomUUID();
		const now = Date.now();
		const expiresAt = now + INVITE_EXPIRATION_MS;

		const invite: PendingInvite = {
			id: inviteId,
			roomCode,
			targetUserId,
			targetDisplayName: targetInfo.displayName,
			hostUserId: connState.userId,
			hostDisplayName: connState.displayName,
			hostAvatarSeed: connState.avatarSeed,
			createdAt: now,
			expiresAt,
		};

		// Store the invite
		this.pendingInvites.set(targetUserId, invite);

		// Deliver via GlobalLobby
		const deliveryRequest: InviteDeliveryRequest = {
			inviteId,
			roomCode,
			targetUserId,
			hostUserId: connState.userId,
			hostDisplayName: connState.displayName,
			hostAvatarSeed: connState.avatarSeed,
			game: 'dicee',
			playerCount,
			maxPlayers: roomState.settings.maxPlayers,
			expiresAt,
		};

		const delivered = await this.lobbyStub.deliverInvite(deliveryRequest);

		if (!delivered) {
			// User went offline between checks
			this.pendingInvites.delete(targetUserId);
			this.sendError(ws, 'DELIVERY_FAILED', 'User is no longer online');
			return;
		}

		// Send confirmation to host
		ws.send(
			JSON.stringify({
				type: 'INVITE_SENT',
				payload: {
					inviteId,
					targetUserId,
					targetDisplayName: targetInfo.displayName,
					expiresAt,
				},
				timestamp: now,
			}),
		);

		// Schedule expiration
		this.scheduleInviteExpiration(inviteId, targetUserId, INVITE_EXPIRATION_MS);

		// Invite sent (internal operation - no event needed)
	}

	/**
	 * Handle host cancelling a pending invite.
	 */
	private async handleCancelInvite(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { targetUserId: string },
	): Promise<void> {
		// Only host can cancel invites
		if (!connState.isHost) {
			this.sendError(ws, 'NOT_HOST', 'Only the host can cancel invites');
			return;
		}

		const { targetUserId } = payload;
		const invite = this.pendingInvites.get(targetUserId);

		if (!invite) {
			this.sendError(ws, 'INVITE_NOT_FOUND', 'No pending invite for this user');
			return;
		}

		// Remove the invite
		this.pendingInvites.delete(targetUserId);

		// Notify target via GlobalLobby
		const cancellationRequest: InviteCancellationRequest = {
			inviteId: invite.id,
			targetUserId,
			roomCode: invite.roomCode,
			reason: 'cancelled',
		};
		await this.lobbyStub.cancelInvite(cancellationRequest);

		// Invite cancelled (internal operation - no event needed)
	}

	/**
	 * Handle invite response from GlobalLobby (RPC).
	 * This is called via RPC from GlobalLobby when a user responds to an invite.
	 */
	async handleInviteResponse(response: InviteResponsePayload): Promise<void> {
		const invite = this.pendingInvites.get(response.targetUserId);

		if (!invite || invite.id !== response.inviteId) {
			// Unknown invite response (invalid state - no event needed)
			return;
		}

		// Remove the invite
		this.pendingInvites.delete(response.targetUserId);

		// Find host's WebSocket to notify
		const roomCode = this.getRoomCode();
		const hostWs = this.ctx.getWebSockets(`player:${roomCode}`).find((ws) => {
			const state = ws.deserializeAttachment() as ConnectionState | null;
			return state?.isHost === true;
		});

		if (!hostWs) {
			// Host not found (invalid state - no event needed)
			return;
		}

		// Notify host of response
		const eventType = response.action === 'accept' ? 'INVITE_ACCEPTED' : 'INVITE_DECLINED';
		hostWs.send(
			JSON.stringify({
				type: eventType,
				payload: {
					inviteId: response.inviteId,
					targetUserId: response.targetUserId,
					targetDisplayName: response.targetDisplayName,
				},
				timestamp: Date.now(),
			}),
		);

		// Invite response processed (internal operation - no event needed)
	}

	/**
	 * Cancel all pending invites (called when host disconnects, room fills, or game starts).
	 */
	private async cancelAllInvites(reason: InviteCancellationRequest['reason']): Promise<void> {
		if (this.pendingInvites.size === 0) return;

		const roomCode = this.getRoomCode();

		for (const [targetUserId, invite] of this.pendingInvites) {
			const cancellationRequest: InviteCancellationRequest = {
				inviteId: invite.id,
				targetUserId,
				roomCode,
				reason,
			};
			await this.lobbyStub.cancelInvite(cancellationRequest);
		}

		// Invites cancelled (internal operation - no event needed)
		this.pendingInvites.clear();
	}

	/**
	 * Schedule invite expiration.
	 */
	private scheduleInviteExpiration(inviteId: string, targetUserId: string, delayMs: number): void {
		setTimeout(async () => {
			const invite = this.pendingInvites.get(targetUserId);
			if (invite && invite.id === inviteId) {
				// Invite expired
				this.pendingInvites.delete(targetUserId);

				// Notify target
				const cancellationRequest: InviteCancellationRequest = {
					inviteId,
					targetUserId,
					roomCode: invite.roomCode,
					reason: 'expired',
				};
				await this.lobbyStub.cancelInvite(cancellationRequest);

				// Notify host
				const roomCode = this.getRoomCode();
				const hostWs = this.ctx.getWebSockets(`player:${roomCode}`).find((ws) => {
					const state = ws.deserializeAttachment() as ConnectionState | null;
					return state?.isHost === true;
				});

				if (hostWs) {
					hostWs.send(
						JSON.stringify({
							type: 'INVITE_EXPIRED',
							payload: {
								inviteId,
								targetUserId,
							},
							timestamp: Date.now(),
						}),
					);
				}

				// Invite expired (internal operation - no event needed)
			}
		}, delayMs);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Join Request Handlers (Phase D)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle a join request from GlobalLobby (RPC).
	 * Called when a user requests to join this room from the lobby.
	 *
	 * @param input - The join request input from GlobalLobby
	 * @returns Response with created request or error
	 */
	async handleJoinRequest(input: JoinRequestRPCInput): Promise<JoinRequestRPCResponse> {
		const roomCode = this.getRoomCode();
		const connectedPlayers = this.getConnectedPlayerCount();

		// Check room state
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState || roomState.status !== 'waiting') {
			return {
				success: false,
				errorCode: 'ROOM_NOT_ACCEPTING',
				errorMessage: 'Room is not accepting new players',
			};
		}

		// Check capacity - include AI players in count
		const playerCount = connectedPlayers + (roomState.aiPlayers?.length ?? 0);
		if (playerCount >= roomState.settings.maxPlayers) {
			return {
				success: false,
				errorCode: 'ROOM_FULL',
				errorMessage: 'Room is full',
			};
		}

		// Create the join request
		const result = this.joinRequestManager.addRequest({
			roomCode,
			requesterId: input.requesterId,
			requesterDisplayName: input.requesterDisplayName,
			requesterAvatarSeed: input.requesterAvatarSeed,
		});

		if (!result.success) {
			return {
				success: false,
				errorCode: result.error.code,
				errorMessage: result.error.message,
			};
		}

		const request = result.value;

		// Schedule expiration alarm
		await this.scheduleJoinRequestExpiration(request.id, request.expiresAt);

		// Notify host via WebSocket
		this.notifyHostOfJoinRequest(request);

		// Return entity format expected by types
		const entity: JoinRequestEntity = {
			id: request.id,
			roomCode: request.roomCode,
			requesterId: request.requesterId,
			requesterDisplayName: request.requesterDisplayName,
			requesterAvatarSeed: request.requesterAvatarSeed,
			createdAt: request.createdAt,
			expiresAt: request.expiresAt,
			status: request.status,
		};

		return {
			success: true,
			request: entity,
		};
	}

	/**
	 * Cancel a join request (RPC from GlobalLobby).
	 * Only the requester can cancel their own pending request.
	 */
	async cancelJoinRequest(requestId: string, userId: string): Promise<JoinRequestRPCResponse> {
		// Get the request
		const request = this.joinRequestManager.getRequest(requestId);
		if (!request) {
			return {
				success: false,
				errorCode: 'REQUEST_NOT_FOUND',
				errorMessage: 'Join request not found',
			};
		}

		// Verify the canceller is the requester
		if (request.requesterId !== userId) {
			return {
				success: false,
				errorCode: 'NOT_REQUESTER',
				errorMessage: 'Only the requester can cancel their request',
			};
		}

		// Cancel the request
		const result = this.joinRequestManager.cancel(requestId, userId);
		if (!result.success) {
			return {
				success: false,
				errorCode: result.error.code,
				errorMessage: result.error.message,
			};
		}

		// Notify host that request was cancelled
		this.notifyHostOfJoinRequestCancellation(requestId, request.requesterDisplayName);

		// Clean up
		this.joinRequestManager.remove(requestId);

		return { success: true };
	}

	/**
	 * Handle host's response to a join request (WebSocket message).
	 */
	private async handleJoinRequestResponse(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { requestId: string; approved: boolean },
	): Promise<void> {
		// Only host can respond to join requests
		if (!connState.isHost) {
			this.sendError(ws, 'NOT_HOST', 'Only the host can respond to join requests');
			return;
		}

		const { requestId, approved } = payload;
		const roomCode = this.getRoomCode();

		// Get the request
		const request = this.joinRequestManager.getRequest(requestId);
		if (!request) {
			this.sendError(ws, 'REQUEST_NOT_FOUND', 'Join request not found');
			return;
		}

		// Process the response
		const result = approved
			? this.joinRequestManager.approve(requestId)
			: this.joinRequestManager.decline(requestId);

		if (!result.success) {
			this.sendError(ws, result.error.code, result.error.message);
			return;
		}

		// Deliver response to requester via GlobalLobby
		const delivery: JoinRequestResponseDelivery = {
			requestId,
			requesterId: request.requesterId,
			roomCode,
			status: approved ? 'approved' : 'declined',
			reason: approved ? undefined : 'Host declined your request',
		};

		await this.lobbyStub.deliverJoinRequestResponse(delivery);

		// Clean up the request
		this.joinRequestManager.remove(requestId);
	}

	/**
	 * Handle join request expiration (alarm handler).
	 */
	private async handleJoinRequestExpiration(requestId: string | undefined): Promise<void> {
		if (!requestId) return;

		const request = this.joinRequestManager.getRequest(requestId);
		if (!request || request.status !== 'pending') {
			return; // Already processed
		}

		const roomCode = this.getRoomCode();

		// Mark as expired
		const result = this.joinRequestManager.expire(requestId);
		if (!result.success) {
			return;
		}

		// Notify requester via GlobalLobby
		const delivery: JoinRequestResponseDelivery = {
			requestId,
			requesterId: request.requesterId,
			roomCode,
			status: 'expired',
			reason: 'Request timed out',
		};

		await this.lobbyStub.deliverJoinRequestResponse(delivery);

		// Notify host
		this.notifyHostOfJoinRequestExpiration(requestId);

		// Clean up
		this.joinRequestManager.remove(requestId);
	}

	/**
	 * Schedule an alarm for join request expiration.
	 */
	private async scheduleJoinRequestExpiration(requestId: string, expiresAt: number): Promise<void> {
		// Note: DO alarms can only have one active alarm at a time.
		// For multiple concurrent requests, we'll use setTimeout as a fallback.
		// The alarm system handles the critical path, setTimeout handles additional requests.

		// Check if there's already a pending alarm
		const existingAlarm = await this.ctx.storage.getAlarm();
		if (existingAlarm) {
			// Use setTimeout for this request
			const delay = Math.max(0, expiresAt - Date.now());
			setTimeout(() => {
				this.handleJoinRequestExpiration(requestId);
			}, delay);
			return;
		}

		// Phase 1: Schedule via AlarmQueue
		await this.alarmQueue.schedule({
			type: 'JOIN_REQUEST_EXPIRATION',
			targetId: requestId,
			scheduledFor: expiresAt,
			metadata: { requestId },
		});
	}

	/**
	 * Notify host of a new join request via WebSocket.
	 */
	private notifyHostOfJoinRequest(request: JoinRequestEntity): void {
		const roomCode = this.getRoomCode();
		const allPlayerWs = this.ctx.getWebSockets(`player:${roomCode}`);

		const hostWs = allPlayerWs.find((ws) => {
			const state = ws.deserializeAttachment() as ConnectionState | null;
			return state?.isHost === true;
		});

		if (hostWs) {
			hostWs.send(
				JSON.stringify({
					type: 'JOIN_REQUEST_RECEIVED',
					payload: { request },
					timestamp: Date.now(),
				}),
			);
		} else {
			// Host not connected, join request will be delivered when host reconnects
		}
	}

	/**
	 * Notify host that a join request expired.
	 */
	private notifyHostOfJoinRequestExpiration(requestId: string): void {
		const roomCode = this.getRoomCode();
		const hostWs = this.ctx.getWebSockets(`player:${roomCode}`).find((ws) => {
			const state = ws.deserializeAttachment() as ConnectionState | null;
			return state?.isHost === true;
		});

		if (hostWs) {
			hostWs.send(
				JSON.stringify({
					type: 'JOIN_REQUEST_EXPIRED',
					payload: { requestId },
					timestamp: Date.now(),
				}),
			);
		}
	}

	/**
	 * Notify host that a join request was cancelled by the requester.
	 */
	private notifyHostOfJoinRequestCancellation(
		requestId: string,
		requesterDisplayName: string,
	): void {
		const roomCode = this.getRoomCode();
		const hostWs = this.ctx.getWebSockets(`player:${roomCode}`).find((ws) => {
			const state = ws.deserializeAttachment() as ConnectionState | null;
			return state?.isHost === true;
		});

		if (hostWs) {
			hostWs.send(
				JSON.stringify({
					type: 'JOIN_REQUEST_CANCELLED',
					payload: { requestId, requesterDisplayName },
					timestamp: Date.now(),
				}),
			);
		}
	}

	/**
	 * Get count of connected human players.
	 */
	private getConnectedPlayerCount(): number {
		const roomCode = this.getRoomCode();
		return this.ctx.getWebSockets(`player:${roomCode}`).length;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Game Logic Handlers (DO-4 Core Game Loop)
	// ─────────────────────────────────────────────────────────────────────────────

	private async handleStartGame(ws: WebSocket, connState: ConnectionState): Promise<void> {
		if (!connState.isHost) {
			this.sendError(ws, 'NOT_HOST', 'Only the host can start the game');
			return;
		}

		const roomCode = this.getRoomCode();
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) {
			this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found');
			return;
		}

		// Gather connected human players
		const players: Array<{
			id: string;
			displayName: string;
			avatarSeed: string;
			isHost: boolean;
			connectionId: string;
			type?: 'human' | 'ai';
			aiProfileId?: string;
		}> = [];

		for (const playerWs of this.ctx.getWebSockets(`player:${roomCode}`)) {
			const state = playerWs.deserializeAttachment() as ConnectionState;
			players.push({
				id: state.userId,
				displayName: state.displayName,
				avatarSeed: state.avatarSeed,
				isHost: state.isHost,
				connectionId: state.userId, // Use userId as connectionId
				type: 'human',
			});
		}

		// Add AI players from room state
		if (roomState.aiPlayers && roomState.aiPlayers.length > 0) {
			for (const aiPlayer of roomState.aiPlayers) {
				players.push({
					id: aiPlayer.id,
					displayName: aiPlayer.displayName,
					avatarSeed: aiPlayer.avatarSeed,
					isHost: false,
					connectionId: aiPlayer.id, // AI uses its own ID as connectionId
					type: 'ai',
					aiProfileId: aiPlayer.profileId,
				});
			}
		}

		if (players.length < 2) {
			this.sendError(ws, 'NOT_ENOUGH_PLAYERS', 'Need at least 2 players');
			return;
		}

		// Initialize game state
		const config: MultiplayerGameState['config'] = {
			maxPlayers: roomState.settings.maxPlayers,
			turnTimeoutSeconds: roomState.settings.turnTimeoutSeconds,
			isPublic: roomState.settings.isPublic,
		};

		await this.gameStateManager.initializeFromRoom(players, config);

		// Initialize AI manager and register AI players
		await this.aiManager.initialize();
		for (const player of players) {
			if (player.type === 'ai' && player.aiProfileId) {
				await this.aiManager.addAIPlayer(player.id, player.aiProfileId);
			}
		}

		// Cancel all pending invites since game is starting
		await this.cancelAllInvites('room_closed');

		// Update room status
		roomState.status = 'starting';
		roomState.startedAt = Date.now();
		await this.ctx.storage.put('room', roomState);

		// Broadcast starting
		this.broadcast({ type: 'GAME_STARTING', payload: { playerCount: players.length } });

		// Start the game immediately (could add countdown later)
		const startResult = await this.gameStateManager.startGame();

		// Log game start
		await this.ensureInstrumentation();
		this.instr?.gameStart(players.length, connState.userId);
		this.instr?.gameTurnStart(startResult.currentPlayerId, startResult.turnNumber);

		// Phase 1: Persist game start to Supabase (async, non-blocking)
		const gameId = await this.persistGameStart(roomCode, connState.userId, players);
		if (gameId) {
			// Record GameStarted domain event
			this.recordDomainEvent('GameStarted', connState.userId, {
				playerCount: players.length,
				playerIds: players.map((p) => p.id),
				gameMode: players.filter((p) => p.type !== 'ai').length > 1 ? 'multiplayer' : 'solo',
				roomCode,
			});
			// Record first TurnStarted event
			this.recordDomainEvent(
				'TurnStarted',
				startResult.currentPlayerId,
				{ turnNumber: startResult.turnNumber },
				startResult.turnNumber,
			);
		}

		// Update room status to playing
		roomState.status = 'playing';
		await this.ctx.storage.put('room', roomState);

		// Get full game state for broadcast
		const gameState = await this.gameStateManager.getState();

		// Broadcast game started
		this.broadcast({
			type: 'GAME_STARTED',
			payload: {
				playerOrder: startResult.playerOrder,
				currentPlayerId: startResult.currentPlayerId,
				turnNumber: startResult.turnNumber,
				roundNumber: 1,
				phase: gameState?.phase ?? 'turn_roll',
				players: gameState?.players ?? {},
			},
		});

		// Schedule turn timeout if configured (only for human players, Phase 3: unified alarms)
		// HIBERNATION-SAFE: Check game state, not in-memory AIRoomManager
		const isFirstPlayerAI = gameState?.players[startResult.currentPlayerId]?.type === 'ai';
		if (roomState.settings.turnTimeoutSeconds > 0 && !isFirstPlayerAI) {
			await this.alarmQueue.schedule({
				type: 'AFK_WARNING',
				targetId: startResult.currentPlayerId,
				scheduledFor: Date.now() + AFK_WARNING_SECONDS * 1000,
			});
		}

		// Notify lobby
		await this.notifyLobbyOfUpdate();

		// Note: No lobby highlight for game start (only for notable game events)

		// Log game start
		await this.ensureInstrumentation();
		this.instr?.gameStart(players.length, connState.userId);

		// Trigger AI turn if first player is AI
		await this.triggerAITurnIfNeeded(startResult.currentPlayerId);
	}

	/**
	 * Handle rematch request from host after game over.
	 * Resets game state and starts a new game with the same players.
	 */
	private async handleRematch(ws: WebSocket, connState: ConnectionState): Promise<void> {
		// Validate using game machine
		const gameState = await this.gameStateManager.getState();
		if (!gameState) {
			this.sendError(ws, 'NO_GAME', 'No game in progress');
			return;
		}

		const validation = canRematch(gameState, connState.userId);
		if (!validation.success) {
			this.sendError(
				ws,
				validation.error ?? 'REMATCH_ERROR',
				validation.message ?? 'Cannot rematch',
			);
			return;
		}

		// Reset game state for rematch
		await this.gameStateManager.resetForRematch();

		// Update room state back to waiting
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (roomState) {
			roomState.status = 'waiting';
			roomState.startedAt = null;
			await this.ctx.storage.put('room', roomState);
		}

		// Broadcast rematch started - clients should show waiting room
		this.broadcast({
			type: 'REMATCH_STARTED',
			payload: {
				roomCode: this.getRoomCode(),
				players: await this.getPlayerList(),
			},
		});

		// Notify lobby
		await this.notifyLobbyOfUpdate();
	}

	/**
	 * Handle Quick Play start - creates room directly in playing state with human first.
	 * This skips the waiting room entirely for solo vs AI games.
	 */
	private async handleQuickPlayStart(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { aiProfiles: string[] },
	): Promise<void> {
		// Only host can start quick play
		if (!connState.isHost) {
			this.sendError(ws, 'NOT_HOST', 'Only the host can start quick play');
			return;
		}

		const _roomCode = this.getRoomCode();
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) {
			this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found');
			return;
		}

		// Must be in waiting phase
		if (roomState.status !== 'waiting') {
			this.sendError(ws, 'GAME_IN_PROGRESS', 'Game already in progress');
			return;
		}

		// Validate AI profiles and create AI players
		const aiProfiles = payload.aiProfiles || [];
		if (aiProfiles.length === 0) {
			this.sendError(ws, 'NO_AI_PROFILES', 'Quick play requires at least one AI opponent');
			return;
		}

		// Create AI players
		const aiPlayers: Array<{
			id: string;
			profileId: string;
			displayName: string;
			avatarSeed: string;
		}> = [];

		for (const profileId of aiProfiles) {
			const profile = getProfile(profileId);
			if (!profile) {
				this.sendError(ws, 'INVALID_PROFILE', `Unknown AI profile: ${profileId}`);
				return;
			}

			const aiPlayerId = `ai:${profileId}:${Date.now()}`;
			const aiPlayer = createAIPlayerState(aiPlayerId, profileId);
			aiPlayers.push({
				id: aiPlayerId,
				profileId,
				displayName: aiPlayer.displayName ?? profile.name,
				avatarSeed: aiPlayer.avatarSeed ?? profile.avatarSeed,
			});
		}

		// Store AI players in room state
		roomState.aiPlayers = aiPlayers;
		await this.ctx.storage.put('room', roomState);

		// Build player list: Human first (always), then AI players
		const players: Array<{
			id: string;
			displayName: string;
			avatarSeed: string;
			isHost: boolean;
			connectionId: string;
			type: 'human' | 'ai';
			aiProfileId?: string;
		}> = [];

		// Add human player first (guaranteed first turn)
		players.push({
			id: connState.userId,
			displayName: connState.displayName,
			avatarSeed: connState.avatarSeed,
			isHost: true,
			connectionId: connState.userId,
			type: 'human',
		});

		// Add AI players
		for (const aiPlayer of aiPlayers) {
			players.push({
				id: aiPlayer.id,
				displayName: aiPlayer.displayName,
				avatarSeed: aiPlayer.avatarSeed,
				isHost: false,
				connectionId: aiPlayer.id,
				type: 'ai',
				aiProfileId: aiPlayer.profileId,
			});
		}

		// Initialize game state with human first in turn order
		const config: MultiplayerGameState['config'] = {
			maxPlayers: roomState.settings.maxPlayers,
			turnTimeoutSeconds: roomState.settings.turnTimeoutSeconds,
			isPublic: roomState.settings.isPublic,
		};

		await this.gameStateManager.initializeFromRoom(players, config);

		// Initialize AI manager and register AI players
		await this.aiManager.initialize();
		for (const player of players) {
			if (player.type === 'ai' && player.aiProfileId) {
				await this.aiManager.addAIPlayer(player.id, player.aiProfileId);
			}
		}

		// Start game with human as first player (no randomization for quick play)
		const startResult = await this.gameStateManager.startGameWithOrder(
			players.map((p) => p.id), // Human first, then AI
		);

		// Update room status directly to playing (skip 'starting' phase)
		roomState.status = 'playing';
		roomState.startedAt = Date.now();
		await this.ctx.storage.put('room', roomState);

		// Get full game state for broadcast
		const gameState = await this.gameStateManager.getState();

		// Broadcast game started (skip GAME_STARTING for quick play)
		// Send full player state (same format as GAME_STARTED)
		this.broadcast({
			type: 'QUICK_PLAY_STARTED',
			payload: {
				playerOrder: startResult.playerOrder,
				currentPlayerId: startResult.currentPlayerId,
				turnNumber: startResult.turnNumber,
				roundNumber: 1,
				phase: gameState?.phase ?? 'turn_roll',
				players: gameState?.players ?? {},
				config: gameState?.config,
			},
		});

		// Notify lobby
		await this.notifyLobbyOfUpdate();

		// Log quick play start
		await this.ensureInstrumentation();
		this.instr?.gameStart(1 + aiPlayers.length, connState.userId);

		// Human always goes first in quick play, so no AI turn trigger needed here
		// AI will play after human scores
	}

	/**
	 * Handle add AI player command (host only, during waiting)
	 */
	private async handleAddAIPlayer(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { profileId: string },
	): Promise<void> {
		// Only host can add AI players
		if (!connState.isHost) {
			this.sendError(ws, 'NOT_HOST', 'Only the host can add AI players');
			return;
		}

		const roomCode = this.getRoomCode();
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) {
			this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found');
			return;
		}

		// Can only add AI during waiting phase
		if (roomState.status !== 'waiting') {
			this.sendError(ws, 'GAME_IN_PROGRESS', 'Cannot add AI players after game has started');
			return;
		}

		// Check if room is full
		const currentPlayerCount =
			this.ctx.getWebSockets(`player:${roomCode}`).length + (roomState.aiPlayers?.length ?? 0);
		if (currentPlayerCount >= roomState.settings.maxPlayers) {
			this.sendError(ws, 'ROOM_FULL', 'Room is full');
			return;
		}

		// Validate AI profile
		const profile = getProfile(payload.profileId);
		if (!profile) {
			this.sendError(ws, 'INVALID_PROFILE', `Unknown AI profile: ${payload.profileId}`);
			return;
		}

		// Create AI player ID
		const aiPlayerId = `ai:${payload.profileId}:${Date.now()}`;

		// Create AI player state
		const aiPlayer = createAIPlayerState(aiPlayerId, payload.profileId);

		// Store AI player in room state
		if (!roomState.aiPlayers) {
			roomState.aiPlayers = [];
		}
		roomState.aiPlayers.push({
			id: aiPlayerId,
			profileId: payload.profileId,
			displayName: aiPlayer.displayName ?? profile.name,
			avatarSeed: aiPlayer.avatarSeed ?? profile.avatarSeed,
		});
		await this.ctx.storage.put('room', roomState);

		// Broadcast AI player joined
		this.broadcast({
			type: 'AI_PLAYER_JOINED',
			payload: {
				playerId: aiPlayerId,
				profileId: payload.profileId,
				displayName: aiPlayer.displayName ?? profile.name,
				avatarSeed: aiPlayer.avatarSeed ?? profile.avatarSeed,
				isAI: true,
			},
		});

		// Notify lobby
		await this.notifyLobbyOfUpdate();
	}

	/**
	 * Handle remove AI player command (host only, waiting phase only)
	 */
	private async handleRemoveAIPlayer(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { playerId: string },
	): Promise<void> {
		// Only host can remove AI players
		if (!connState.isHost) {
			this.sendError(ws, 'NOT_HOST', 'Only the host can remove AI players');
			return;
		}

		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) {
			this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found');
			return;
		}

		// Can only remove AI during waiting phase
		if (roomState.status !== 'waiting') {
			this.sendError(ws, 'GAME_IN_PROGRESS', 'Cannot remove AI players after game has started');
			return;
		}

		// Find and remove the AI player
		const aiPlayers = roomState.aiPlayers ?? [];
		const aiIndex = aiPlayers.findIndex((p) => p.id === payload.playerId);
		if (aiIndex === -1) {
			this.sendError(ws, 'PLAYER_NOT_FOUND', 'AI player not found');
			return;
		}

		const removedPlayer = aiPlayers[aiIndex];
		aiPlayers.splice(aiIndex, 1);
		roomState.aiPlayers = aiPlayers;
		await this.ctx.storage.put('room', roomState);

		// Broadcast AI player removed
		this.broadcast({
			type: 'AI_PLAYER_REMOVED',
			payload: {
				playerId: payload.playerId,
				displayName: removedPlayer.displayName,
			},
		});

		// Notify lobby of updated player count
		await this.notifyLobbyOfUpdate();

		// AI player removal logged via state transition events
	}

	/**
	 * Handle dice roll command
	 */
	private async handleDiceRoll(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { kept?: boolean[] },
	): Promise<void> {
		const gameState = await this.gameStateManager.getState();
		if (!gameState) {
			this.sendError(ws, 'NO_GAME', 'No game in progress');
			return;
		}

		// Validate the roll
		const validation = canRollDice(gameState, connState.userId);
		if (!validation.success) {
			this.sendError(ws, validation.error, validation.message);
			return;
		}

		// Parse kept mask (default: keep nothing)
		const keptMask: KeptMask = [false, false, false, false, false];
		if (payload.kept && Array.isArray(payload.kept)) {
			for (let i = 0; i < 5 && i < payload.kept.length; i++) {
				keptMask[i] = Boolean(payload.kept[i]);
			}
		}

		// Execute the roll
		const result = await this.gameStateManager.rollDice(connState.userId, keptMask);

		// Log game roll event
		await this.ensureInstrumentation();
		this.instr?.gameRoll(connState.userId, result.rollNumber, result.dice);

		// Broadcast dice rolled to all players
		this.broadcast({
			type: 'DICE_ROLLED',
			payload: {
				playerId: connState.userId,
				dice: result.dice,
				rollNumber: result.rollNumber,
				rollsRemaining: result.rollsRemaining,
				phase: result.newPhase,
			},
		});

		// Also send to spectators
		this.broadcastToSpectators({
			type: 'DICE_ROLLED',
			payload: {
				playerId: connState.userId,
				dice: result.dice,
				rollNumber: result.rollNumber,
				rollsRemaining: result.rollsRemaining,
				phase: result.newPhase,
			},
		});

		// Update turn tracking for predictions
		this.currentTurn = {
			turnNumber: gameState.turnNumber,
			playerId: connState.userId,
		};

		// Reset kibitz votes on new roll
		this.kibitzVotes.clear();

		// Phase 5: Record DiceRolled domain event
		this.recordDomainEvent(
			'DiceRolled',
			connState.userId,
			{
				dice: result.dice,
				kept: keptMask,
				rollsRemaining: result.rollsRemaining,
			},
			gameState.turnNumber,
			result.rollNumber,
		);
	}

	/**
	 * Handle keep dice command
	 */
	private async handleDiceKeep(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { indices: number[] },
	): Promise<void> {
		const gameState = await this.gameStateManager.getState();
		if (!gameState) {
			this.sendError(ws, 'NO_GAME', 'No game in progress');
			return;
		}

		// Validate the keep
		const validation = canKeepDice(gameState, connState.userId);
		if (!validation.success) {
			this.sendError(ws, validation.error, validation.message);
			return;
		}

		// Validate indices
		const indices = payload.indices ?? [];
		if (!Array.isArray(indices) || indices.some((i) => typeof i !== 'number' || i < 0 || i > 4)) {
			this.sendError(ws, 'INVALID_INDICES', 'Invalid dice indices');
			return;
		}

		// Execute keep
		const newKept = await this.gameStateManager.keepDice(connState.userId, indices);

		// Broadcast dice kept
		this.broadcast({
			type: 'DICE_KEPT',
			payload: {
				playerId: connState.userId,
				kept: newKept,
			},
		});

		// Also send to spectators
		this.broadcastToSpectators({
			type: 'DICE_KEPT',
			payload: {
				playerId: connState.userId,
				kept: newKept,
			},
		});

		// Phase 5: Record DiceKept domain event
		this.recordDomainEvent(
			'DiceKept',
			connState.userId,
			{
				kept: newKept,
				indices,
			},
			gameState.turnNumber,
		);
	}

	/**
	 * Handle category score command
	 */
	private async handleCategoryScore(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { category: Category },
	): Promise<void> {
		const gameState = await this.gameStateManager.getState();
		if (!gameState) {
			this.sendError(ws, 'NO_GAME', 'No game in progress');
			return;
		}

		const category = payload.category;
		if (!category) {
			this.sendError(ws, 'INVALID_CATEGORY', 'Category is required');
			return;
		}

		// Validate the score
		const validation = canScoreCategory(gameState, connState.userId, category);
		if (!validation.success) {
			this.sendError(ws, validation.error, validation.message);
			return;
		}

		// Execute scoring
		const result = await this.gameStateManager.scoreCategory(connState.userId, category);

		// Log game score event
		await this.ensureInstrumentation();
		this.instr?.gameScore(connState.userId, category, result.score);

		// Evaluate predictions for this turn
		// wasDicee: scored a dicee (50) or got bonus
		// improved: scored > 0 (simplified - could track position changes)
		// bricked: scored 0
		this.evaluatePredictions({
			playerId: connState.userId,
			wasDicee: result.isDiceeBonus || (category === 'dicee' && result.score === 50),
			improved: result.score > 0,
			bricked: result.score === 0,
			finalScore: result.score,
		});

		// Phase 5: Record TurnScored domain event
		this.recordDomainEvent(
			'TurnScored',
			connState.userId,
			{
				category,
				score: result.score,
				totalScore: result.totalScore,
				isDiceeBonus: result.isDiceeBonus,
			},
			gameState.turnNumber,
		);

		// Broadcast category scored
		this.broadcast({
			type: 'CATEGORY_SCORED',
			payload: {
				playerId: connState.userId,
				category,
				score: result.score,
				totalScore: result.totalScore,
				isDiceeBonus: result.isDiceeBonus,
			},
		});

		// Also send to spectators
		this.broadcastToSpectators({
			type: 'CATEGORY_SCORED',
			payload: {
				playerId: connState.userId,
				category,
				score: result.score,
				totalScore: result.totalScore,
				isDiceeBonus: result.isDiceeBonus,
			},
		});

		// Check for Dicee highlight
		if (result.isDiceeBonus || (category === 'dicee' && result.score === 50)) {
			const player = gameState.players[connState.userId];
			this.sendLobbyHighlight(
				'dicee',
				`${player?.displayName ?? 'Player'} rolled a Dicee!`,
				player?.displayName,
				result.score,
			);
		}

		// Handle game completion or turn advancement
		if (result.gameCompleted) {
			// Game over
			this.handleGameOver(result.rankings);
		} else if (result.nextPlayerId) {
			// Log turn end for current player and turn start for next player
			await this.ensureInstrumentation();
			if (gameState.currentPlayerIndex > 0) {
				this.instr?.gameTurnEnd(connState.userId, gameState.turnNumber);
			}
			this.instr?.gameTurnStart(result.nextPlayerId, result.nextTurnNumber);

			// Phase 5: Record TurnEnded domain event for current player
			this.recordDomainEvent(
				'TurnEnded',
				connState.userId,
				{
					category,
					score: result.score,
					totalScore: result.totalScore,
				},
				gameState.turnNumber,
			);

			// Phase 5: Record TurnStarted domain event for next player
			this.recordDomainEvent(
				'TurnStarted',
				result.nextPlayerId,
				{
					roundNumber: result.nextRoundNumber,
				},
				result.nextTurnNumber,
			);

			// Next player's turn
			this.broadcast({
				type: 'TURN_CHANGED',
				payload: {
					currentPlayerId: result.nextPlayerId,
					turnNumber: result.nextTurnNumber,
					roundNumber: result.nextRoundNumber,
					phase: result.nextPhase,
				},
			});

			// Also send to spectators
			this.broadcastToSpectators({
				type: 'TURN_CHANGED',
				payload: {
					currentPlayerId: result.nextPlayerId,
					turnNumber: result.nextTurnNumber,
					roundNumber: result.nextRoundNumber,
					phase: result.nextPhase,
				},
			});

			// Update turn tracking
			this.currentTurn = {
				turnNumber: result.nextTurnNumber,
				playerId: result.nextPlayerId,
			};

			// Clear kibitz votes for new turn
			this.kibitzVotes.clear();

			// Schedule turn timeout for next player (only for human players, Phase 3: unified alarms)
			// HIBERNATION-SAFE: Check game state, not in-memory AIRoomManager
			const roomState = await this.ctx.storage.get<RoomState>('room');
			const isNextPlayerAI = await this.isPlayerAIFromGameState(result.nextPlayerId);
			if (roomState?.settings.turnTimeoutSeconds && roomState.settings.turnTimeoutSeconds > 0) {
				if (!isNextPlayerAI) {
					await this.alarmQueue.schedule({
						type: 'AFK_WARNING',
						targetId: result.nextPlayerId,
						scheduledFor: Date.now() + AFK_WARNING_SECONDS * 1000,
					});
				}
			}

			// Trigger AI turn if next player is AI
			await this.triggerAITurnIfNeeded(result.nextPlayerId);
		}

		// Notify lobby of update
		await this.notifyLobbyOfUpdate();
	}

	/**
	 * Handle game over - broadcast rankings and send highlights
	 */
	private handleGameOver(
		rankings: Array<{
			playerId: string;
			displayName: string;
			rank: number;
			score: number;
			diceeCount: number;
		}> | null,
	): void {
		if (!rankings) return;

		// Log game completion
		const winnerId = rankings[0]?.playerId;
		const finalScores: Record<string, number> = {};
		for (const ranking of rankings) {
			finalScores[ranking.playerId] = ranking.score;
		}
		this.instr?.gameComplete(winnerId, finalScores);

		// Broadcast game over
		this.broadcast({
			type: 'GAME_OVER',
			payload: {
				rankings,
				winnerId: rankings[0]?.playerId,
				winnerName: rankings[0]?.displayName,
				winnerScore: rankings[0]?.score,
			},
		});

		// Also send to spectators
		this.broadcastToSpectators({
			type: 'GAME_OVER',
			payload: {
				rankings,
				winnerId: rankings[0]?.playerId,
				winnerName: rankings[0]?.displayName,
				winnerScore: rankings[0]?.score,
			},
		});

		// Send lobby highlights
		const winner = rankings[0];
		if (winner) {
			this.sendLobbyHighlight(
				'game_complete',
				`${winner.displayName} wins with ${winner.score} points!`,
				winner.displayName,
				winner.score,
			);

			// Check for close finish
			if (rankings.length >= 2 && rankings[0].score - rankings[1].score <= 10) {
				this.sendLobbyHighlight(
					'close_finish',
					`Close game! ${rankings[0].displayName} beat ${rankings[1].displayName} by ${rankings[0].score - rankings[1].score} points!`,
				);
			}

			// High score highlight (300+ is notable)
			if (winner.score >= 300) {
				this.sendLobbyHighlight(
					'high_score',
					`${winner.displayName} scored ${winner.score}!`,
					winner.displayName,
					winner.score,
				);
			}
		}

		// Evaluate spectator backings
		this.evaluateSpectatorBackings(rankings);

		// Update room status
		this.ctx.storage.get<RoomState>('room').then((roomState) => {
			if (roomState) {
				roomState.status = 'completed';
				this.ctx.storage.put('room', roomState);
			}
		});

		// Notify lobby
		this.notifyLobbyOfUpdate();

		// Phase 1: Record GameCompleted event and schedule persistence
		if (this.supabaseGameId) {
			const winnerId = rankings[0]?.playerId;
			this.recordDomainEvent('GameCompleted', winnerId ?? 'system', {
				winnerId,
				rankings: rankings.map((r) => ({
					playerId: r.playerId,
					rank: r.rank,
					score: r.score,
					diceeCount: r.diceeCount,
				})),
			});

			// Schedule persistence tasks via queue (async, non-blocking)
			this.schedulePersistenceTasks(rankings).catch((err) => {
				this.logger.error('Persistence scheduling failed', {
					operation: 'persistence_schedule_failed',
				});
				this.instr?.errorHandlerFailed('persistence_schedule_failed', err);
			});
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// AI Turn Execution
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Execute an AI command on behalf of an AI player.
	 * This is called by AIRoomManager during AI turn execution.
	 */
	private async executeAICommand(playerId: string, command: AICommand): Promise<void> {
		await this.ensureInstrumentation();

		const gameState = await this.gameStateManager.getState();
		if (!gameState) {
			this.instr?.errorHandlerFailed('executeAICommand', new Error('No game state for AI command'));
			return;
		}

		// AI command execution logged via game events (roll, score, etc.)

		switch (command.type) {
			case 'roll': {
				// Execute the roll
				const keptMask = gameState.players[playerId]?.keptDice ?? [
					false,
					false,
					false,
					false,
					false,
				];
				const result = await this.gameStateManager.rollDice(playerId, keptMask);

				// Broadcast dice rolled
				this.broadcast({
					type: 'DICE_ROLLED',
					payload: {
						playerId,
						dice: result.dice,
						rollNumber: result.rollNumber,
						rollsRemaining: result.rollsRemaining,
						phase: result.newPhase,
					},
				});

				this.broadcastToSpectators({
					type: 'DICE_ROLLED',
					payload: {
						playerId,
						dice: result.dice,
						rollNumber: result.rollNumber,
						rollsRemaining: result.rollsRemaining,
						phase: result.newPhase,
					},
				});
				break;
			}

			case 'keep': {
				// Convert keepMask to indices
				const indices: number[] = [];
				for (let i = 0; i < 5; i++) {
					if (command.keepMask[i]) {
						indices.push(i);
					}
				}

				// Execute keep
				const newKept = await this.gameStateManager.keepDice(playerId, indices);

				// Broadcast dice kept
				this.broadcast({
					type: 'DICE_KEPT',
					payload: {
						playerId,
						kept: newKept,
					},
				});

				this.broadcastToSpectators({
					type: 'DICE_KEPT',
					payload: {
						playerId,
						kept: newKept,
					},
				});
				break;
			}

			case 'score': {
				// Execute scoring
				const result = await this.gameStateManager.scoreCategory(playerId, command.category);

				// Broadcast category scored
				this.broadcast({
					type: 'CATEGORY_SCORED',
					payload: {
						playerId,
						category: command.category,
						score: result.score,
						totalScore: result.totalScore,
						isDiceeBonus: result.isDiceeBonus,
					},
				});

				this.broadcastToSpectators({
					type: 'CATEGORY_SCORED',
					payload: {
						playerId,
						category: command.category,
						score: result.score,
						totalScore: result.totalScore,
						isDiceeBonus: result.isDiceeBonus,
					},
				});

				// Check for Dicee highlight
				if (result.isDiceeBonus || (command.category === 'dicee' && result.score === 50)) {
					const player = gameState.players[playerId];
					this.sendLobbyHighlight(
						'dicee',
						`${player?.displayName ?? 'AI'} rolled a Dicee!`,
						player?.displayName,
						result.score,
					);
				}

				// Handle game completion or turn advancement
				if (result.gameCompleted) {
					this.handleGameOver(result.rankings);
				} else if (result.nextPlayerId) {
					// Broadcast turn change
					this.broadcast({
						type: 'TURN_CHANGED',
						payload: {
							currentPlayerId: result.nextPlayerId,
							turnNumber: result.nextTurnNumber,
							roundNumber: result.nextRoundNumber,
							phase: result.nextPhase,
						},
					});

					this.broadcastToSpectators({
						type: 'TURN_CHANGED',
						payload: {
							currentPlayerId: result.nextPlayerId,
							turnNumber: result.nextTurnNumber,
							roundNumber: result.nextRoundNumber,
							phase: result.nextPhase,
						},
					});

					// Schedule turn timeout for next player (if human, Phase 3: unified alarms)
					const roomState = await this.ctx.storage.get<RoomState>('room');
					if (roomState?.settings.turnTimeoutSeconds && roomState.settings.turnTimeoutSeconds > 0) {
						// Only schedule timeout for human players (HIBERNATION-SAFE: check game state)
						const isNextAI = await this.isPlayerAIFromGameState(result.nextPlayerId);
						if (!isNextAI) {
							await this.alarmQueue.schedule({
								type: 'AFK_WARNING',
								targetId: result.nextPlayerId,
								scheduledFor: Date.now() + AFK_WARNING_SECONDS * 1000,
							});
						}
					}

					// Trigger AI turn if next player is AI
					await this.triggerAITurnIfNeeded(result.nextPlayerId);
				}

				// Notify lobby
				await this.notifyLobbyOfUpdate();
				break;
			}
		}
	}

	/**
	 * Trigger AI turn execution if the given player is an AI.
	 * HIBERNATION-SAFE: Persists AI turn state and schedules alarm for recovery.
	 *
	 * CRITICAL FIX: After hibernation, the AIRoomManager's in-memory Set is empty.
	 * We must check the persisted game state and re-register AI players on-demand.
	 */
	private async triggerAITurnIfNeeded(playerId: string): Promise<void> {
		// HIBERNATION FIX: Check game state for AI players, not just in-memory Set
		const gameState = await this.gameStateManager.getState();
		if (!gameState) {
			return;
		}

		const player = gameState.players[playerId];
		if (!player || player.type !== 'ai') {
			return;
		}

		// Re-register AI player if not already registered (survives hibernation)
		if (!this.aiManager.isAIPlayer(playerId)) {
			this.logger.info('Re-registering AI player after hibernation', {
				operation: 'ai_rehydration',
				playerId,
				aiProfileId: player.aiProfileId,
			});

			if (player.aiProfileId) {
				await this.aiManager.initialize();
				await this.aiManager.addAIPlayer(playerId, player.aiProfileId);
			} else {
				this.logger.error('AI player missing profileId', {
					operation: 'ai_rehydration_failed',
					playerId,
				});
				return;
			}
		}

		// AI turn scheduled (logged via state transition)

		// STEP 1: Persist AI turn state to storage FIRST (hibernation-safe)
		const aiTurnState = {
			playerId,
			scheduledAt: Date.now(),
			status: 'scheduled' as const,
		};
		await this.ctx.storage.put('ai_turn_state', aiTurnState);

		// STEP 2: Phase 1 - Schedule safety-net alarm via AlarmQueue (15 seconds)
		// This will fire if the waitUntil callback is killed by hibernation
		// Reduced from 35s to 15s for better UX on failure
		await this.alarmQueue.schedule({
			type: 'AI_TURN_TIMEOUT',
			targetId: playerId,
			scheduledFor: Date.now() + 20000,
			metadata: { retryCount: 0 },
		});

		// STEP 3: Execute AI turn in background (still use waitUntil for non-blocking)
		this.ctx.waitUntil(this.executeAITurnWithRecovery(playerId));
	}

	/**
	 * Execute AI turn with recovery tracking.
	 * Clears AI turn state on success so alarm handler knows turn completed.
	 */
	private async executeAITurnWithRecovery(playerId: string): Promise<void> {
		try {
			// Small delay to ensure previous turn's finally block completes
			// This is critical for AI-to-AI transitions
			await new Promise((resolve) => setTimeout(resolve, 150));

			await this.aiManager.executeAITurn(
				playerId,
				// Pass a getter function so AI gets fresh state each step
				async () => this.gameStateManager.getState(),
				async (pid, cmd) => {
					await this.executeAICommand(pid, cmd);
				},
				(event) => {
					// Broadcast AI events to all clients
					this.broadcast(event);
					this.broadcastToSpectators(event);
				},
			);

			// SUCCESS: Clear the AI turn state and cancel the alarm
			await this.ctx.storage.delete('ai_turn_state');
			// Phase 1: Cancel the alarm via queue instead of just deleting alarm_data
			await this.alarmQueue.cancel('AI_TURN_TIMEOUT', playerId);

			// AI turn complete (logged via state transition)
		} catch (error) {
			this.instr?.errorHandlerFailed('executeAITurnWithRecovery', error);
			// Let the alarm handler retry if needed
		}
	}

	/**
	 * Check if a player is an AI from persisted game state.
	 * HIBERNATION-SAFE: Checks game state, not in-memory AIRoomManager.
	 */
	private async isPlayerAIFromGameState(playerId: string): Promise<boolean> {
		const gameState = await this.gameStateManager.getState();
		if (!gameState) return false;
		const player = gameState.players[playerId];
		return player?.type === 'ai';
	}

	/**
	 * Evaluate spectator backings after game ends
	 */
	private evaluateSpectatorBackings(
		rankings: Array<{ playerId: string; displayName: string; rank: number; score: number }> | null,
	): void {
		if (!rankings || rankings.length === 0) return;

		const winnerId = rankings[0].playerId;

		for (const [spectatorId, rooting] of this.rootingChoices) {
			const points = this.gameGalleryPoints.get(spectatorId) ?? createEmptyGalleryPoints();

			if (rooting.playerId === winnerId) {
				// Backed the winner
				points.backing.backedWinner = GALLERY_POINT_VALUES.BACKED_WINNER;

				// Check for underdog bonus (winner had lowest score going into final round)
				// For now, just award base points - more complex logic would require tracking mid-game scores
			}

			this.gameGalleryPoints.set(spectatorId, points);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Chat System Handlers
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle all chat-related messages through ChatManager
	 */
	private async handleChatMessage(
		ws: WebSocket,
		connState: ConnectionState,
		message: { type: string; payload?: unknown },
	): Promise<void> {
		// Validate message schema
		const validation = validateChatMessage(message);
		if (!validation.success) {
			ws.send(JSON.stringify(createChatErrorResponse('INVALID_MESSAGE', validation.error.message)));
			return;
		}

		const validated = validation.data;

		switch (validated.type) {
			case 'CHAT':
				await this.handleTextChat(ws, connState, validated.payload.content);
				break;

			case 'QUICK_CHAT':
				await this.handleQuickChat(ws, connState, validated.payload.key as QuickChatKey);
				break;

			case 'REACTION':
				await this.handleReaction(
					ws,
					connState,
					validated.payload.messageId,
					validated.payload.emoji as ReactionEmoji,
					validated.payload.action,
				);
				break;

			case 'TYPING_START':
				this.handleTypingStart(connState);
				break;

			case 'TYPING_STOP':
				this.handleTypingStop(connState);
				break;

			case 'SHOUT':
				this.handleShout(ws, connState, validated.payload.content);
				break;
		}
	}

	/**
	 * Handle text chat message
	 */
	private async handleTextChat(
		ws: WebSocket,
		connState: ConnectionState,
		content: string,
	): Promise<void> {
		// Chat message received (logged via broadcast events)

		const result = await this.chatManager.handleTextMessage(
			connState.userId,
			connState.displayName,
			content,
		);

		if (!result.success) {
			this.instr?.errorHandlerFailed('handleTextChat', new Error(result.errorMessage));
			ws.send(JSON.stringify(createChatErrorResponse(result.error, result.errorMessage)));
			return;
		}

		// Broadcast the message to all connected clients
		this.broadcast(createChatMessageResponse(result.message));

		// Chat message broadcast (logged via broadcastSent)

		// Broadcast updated typing status (user stopped typing)
		this.broadcastTypingUpdate();
	}

	/**
	 * Handle quick chat message
	 */
	private async handleQuickChat(
		ws: WebSocket,
		connState: ConnectionState,
		key: QuickChatKey,
	): Promise<void> {
		const result = await this.chatManager.handleQuickChat(
			connState.userId,
			connState.displayName,
			key,
		);

		if (!result.success) {
			ws.send(JSON.stringify(createChatErrorResponse(result.error, result.errorMessage)));
			return;
		}

		// Broadcast the quick chat message
		this.broadcast(createChatMessageResponse(result.message));
	}

	/**
	 * Handle reaction add/remove
	 */
	private async handleReaction(
		ws: WebSocket,
		connState: ConnectionState,
		messageId: string,
		emoji: ReactionEmoji,
		action: 'add' | 'remove',
	): Promise<void> {
		const result = await this.chatManager.handleReaction(
			connState.userId,
			messageId,
			emoji,
			action,
		);

		if (!result.success) {
			ws.send(JSON.stringify(createChatErrorResponse(result.error, result.errorMessage)));
			return;
		}

		// Broadcast the reaction update
		this.broadcast(createReactionUpdateResponse(result.messageId, result.reactions));
	}

	/**
	 * Handle typing start indicator
	 */
	private handleTypingStart(connState: ConnectionState): void {
		const shouldBroadcast = this.chatManager.handleTypingStart(
			connState.userId,
			connState.displayName,
		);

		if (shouldBroadcast) {
			this.broadcastTypingUpdate();
		}
	}

	/**
	 * Handle typing stop indicator
	 */
	private handleTypingStop(connState: ConnectionState): void {
		const shouldBroadcast = this.chatManager.handleTypingStop(connState.userId);

		if (shouldBroadcast) {
			this.broadcastTypingUpdate();
		}
	}

	/**
	 * Handle shout message (ephemeral broadcast with cooldown)
	 *
	 * Shouts appear as speech bubbles above player avatars.
	 * They are not persisted and auto-dismiss after 5 seconds.
	 * Users have a 30-second cooldown between shouts.
	 */
	private handleShout(ws: WebSocket, connState: ConnectionState, content: string): void {
		const result = this.chatManager.handleShout(
			connState.userId,
			connState.displayName,
			connState.avatarSeed,
			content,
		);

		if (!result.success) {
			const error = result.error;

			if (error.code === 'RATE_LIMITED') {
				// Send cooldown response
				const remainingMs =
					typeof error.context?.remainingMs === 'number' ? error.context.remainingMs : 0;
				ws.send(JSON.stringify(createShoutCooldownResponse(remainingMs)));
			} else {
				// Map ShoutErrorCode to ChatErrorCode for consistent client handling
				const chatErrorCode =
					error.code === 'CONTENT_TOO_LONG' ? 'MESSAGE_TOO_LONG' : 'INVALID_MESSAGE';
				ws.send(JSON.stringify(createChatErrorResponse(chatErrorCode, error.message)));
			}
			return;
		}

		const shout = result.value;

		// Broadcast to ALL clients (including sender - they see their own bubble)
		this.broadcast(createShoutReceivedResponse(shout));
	}

	/**
	 * Broadcast current typing users to all clients
	 */
	private broadcastTypingUpdate(): void {
		const typingUsers = this.chatManager.getTypingUsers();
		this.broadcast(createTypingUpdateResponse(typingUsers));
	}

	/**
	 * Send chat history to a newly connected user
	 */
	private sendChatHistory(ws: WebSocket): void {
		const history = this.chatManager.getHistory();
		// Chat history sent via broadcast events
		ws.send(JSON.stringify(createChatHistoryResponse(history)));
	}

	/**
	 * Get list of connected players with host flag.
	 * @param currentWs - Optional WebSocket to include if not yet in getWebSockets() list.
	 *                    This handles the race condition where a just-accepted WebSocket
	 *                    may not be immediately available via getWebSockets().
	 */
	private async getPlayerList(currentWs?: WebSocket): Promise<PlayerInfo[]> {
		const roomState = await this.ctx.storage.get<RoomState>('room');
		const players: PlayerInfo[] = [];
		const roomCode = this.getRoomCode();

		// Only get players, not spectators
		const webSockets = this.ctx.getWebSockets(`player:${roomCode}`);

		// Include currentWs if provided and not already in the list
		// This ensures the just-connected player is included in their own CONNECTED event
		const wsSet = new Set(webSockets);
		if (currentWs && !wsSet.has(currentWs)) {
			webSockets.push(currentWs);
		}

		for (const ws of webSockets) {
			const state = ws.deserializeAttachment() as ConnectionState;
			const isHost = state.userId === roomState?.hostUserId;
			players.push({
				userId: state.userId,
				displayName: state.displayName,
				avatarSeed: state.avatarSeed,
				isHost,
				isConnected: true,
			});
		}

		return players;
	}

	/**
	 * Get list of connected spectators.
	 */
	private getSpectatorList(): SpectatorInfo[] {
		const spectators: SpectatorInfo[] = [];
		const roomCode = this.getRoomCode();

		for (const ws of this.ctx.getWebSockets(`spectator:${roomCode}`)) {
			const state = ws.deserializeAttachment() as ConnectionState;
			spectators.push({
				userId: state.userId,
				displayName: state.displayName,
				avatarSeed: state.avatarSeed,
				watchingSince: state.connectedAt,
			});
		}

		return spectators;
	}

	/**
	 * Get count of connected spectators.
	 */
	private getSpectatorCount(): number {
		const roomCode = this.getRoomCode();
		return this.ctx.getWebSockets(`spectator:${roomCode}`).length;
	}

	private async handleRoomInfo(): Promise<Response> {
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) {
			return new Response('Room not found', { status: 404 });
		}

		return Response.json({
			roomCode: roomState.roomCode,
			playerCount: this.getConnectedUserIds().length,
			spectatorCount: this.getSpectatorCount(),
			maxPlayers: roomState.settings.maxPlayers,
			allowSpectators: roomState.settings.allowSpectators,
			status: roomState.status,
			createdAt: roomState.createdAt,
		});
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Gallery Predictions (D4)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle a prediction from a spectator
	 */
	private async handlePrediction(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { playerId: string; type: PredictionType; exactScore?: number },
	): Promise<void> {
		// Only spectators can make predictions
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can make predictions');
			return;
		}

		// Check if game is in progress
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState || roomState.status !== 'playing') {
			this.sendError(ws, 'GAME_NOT_PLAYING', 'Game must be in progress to make predictions');
			return;
		}

		// Validate player exists
		const playerIds = this.getConnectedUserIds();
		if (!playerIds.includes(payload.playerId)) {
			this.sendError(ws, 'INVALID_PLAYER', 'Invalid player ID');
			return;
		}

		// Validate exact score if provided
		if (
			payload.type === 'exact' &&
			(payload.exactScore === undefined || payload.exactScore < 0 || payload.exactScore > 50)
		) {
			this.sendError(ws, 'INVALID_EXACT_SCORE', 'Exact score must be between 0 and 50');
			return;
		}

		// Get current turn key
		const turnKey = this.currentTurn
			? `${this.currentTurn.turnNumber}:${this.currentTurn.playerId}`
			: `0:${payload.playerId}`;

		// Get existing predictions for this turn
		const turnPredictions = this.predictions.get(turnKey) ?? [];

		// Check prediction limit per spectator
		const spectatorPredictions = turnPredictions.filter((p) => p.spectatorId === connState.userId);
		if (spectatorPredictions.length >= GameRoom.MAX_PREDICTIONS_PER_TURN) {
			this.sendError(
				ws,
				'PREDICTION_LIMIT',
				`Maximum ${GameRoom.MAX_PREDICTIONS_PER_TURN} predictions per turn`,
			);
			return;
		}

		// Check for duplicate prediction type
		if (spectatorPredictions.some((p) => p.type === payload.type)) {
			this.sendError(
				ws,
				'DUPLICATE_PREDICTION',
				`Already made a ${payload.type} prediction this turn`,
			);
			return;
		}

		// Create prediction
		const prediction: Prediction = {
			id: crypto.randomUUID(),
			spectatorId: connState.userId,
			spectatorName: connState.displayName,
			playerId: payload.playerId,
			type: payload.type,
			exactScore: payload.type === 'exact' ? payload.exactScore : undefined,
			timestamp: Date.now(),
			evaluated: false,
			correct: null,
			pointsAwarded: 0,
		};

		// Store prediction
		turnPredictions.push(prediction);
		this.predictions.set(turnKey, turnPredictions);

		// Send confirmation to spectator
		ws.send(
			JSON.stringify({
				type: 'PREDICTION_CONFIRMED',
				payload: prediction,
			}),
		);

		// Broadcast to all spectators that a prediction was made (without revealing details)
		this.broadcastToSpectators({
			type: 'PREDICTION_MADE',
			payload: {
				spectatorName: connState.displayName,
				playerId: payload.playerId,
				predictionType: payload.type,
				totalPredictions: turnPredictions.length,
			},
		});

		// Prediction made (logged via broadcast events)
	}

	/**
	 * Handle cancellation of a prediction
	 */
	private handleCancelPrediction(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { predictionId: string },
	): void {
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can cancel predictions');
			return;
		}

		// Find and remove the prediction
		for (const [key, predictions] of this.predictions) {
			const index = predictions.findIndex(
				(p) => p.id === payload.predictionId && p.spectatorId === connState.userId && !p.evaluated,
			);
			if (index !== -1) {
				predictions.splice(index, 1);
				this.predictions.set(key, predictions);

				ws.send(
					JSON.stringify({
						type: 'PREDICTION_CANCELLED',
						payload: { predictionId: payload.predictionId },
					}),
				);
				return;
			}
		}

		this.sendError(ws, 'PREDICTION_NOT_FOUND', 'Prediction not found or already evaluated');
	}

	/**
	 * Get current predictions for the turn (spectator's own)
	 */
	private handleGetPredictions(ws: WebSocket): void {
		const connState = ws.deserializeAttachment() as ConnectionState;
		const turnKey = this.currentTurn
			? `${this.currentTurn.turnNumber}:${this.currentTurn.playerId}`
			: null;

		if (!turnKey) {
			ws.send(
				JSON.stringify({
					type: 'PREDICTIONS',
					payload: { predictions: [], turnActive: false },
				}),
			);
			return;
		}

		const turnPredictions = this.predictions.get(turnKey) ?? [];
		const myPredictions =
			connState.role === 'spectator'
				? turnPredictions.filter((p) => p.spectatorId === connState.userId)
				: [];

		ws.send(
			JSON.stringify({
				type: 'PREDICTIONS',
				payload: {
					predictions: myPredictions,
					turnActive: true,
					currentPlayer: this.currentTurn?.playerId,
					turnNumber: this.currentTurn?.turnNumber,
				},
			}),
		);
	}

	/**
	 * Get spectator's prediction stats
	 */
	private handleGetPredictionStats(ws: WebSocket, connState: ConnectionState): void {
		if (connState.role !== 'spectator') {
			ws.send(
				JSON.stringify({
					type: 'PREDICTION_STATS',
					payload: null,
				}),
			);
			return;
		}

		const stats =
			this.spectatorStats.get(connState.userId) ?? this.createInitialStats(connState.userId);

		ws.send(
			JSON.stringify({
				type: 'PREDICTION_STATS',
				payload: stats,
			}),
		);
	}

	/**
	 * Create initial stats for a spectator
	 */
	private createInitialStats(spectatorId: string): SpectatorPredictionStats {
		return {
			spectatorId,
			totalPredictions: 0,
			correctPredictions: 0,
			accuracy: 0,
			totalPoints: 0,
			streak: 0,
			bestStreak: 0,
		};
	}

	/**
	 * Set the current turn for prediction purposes
	 * Called when a player's turn starts
	 */
	public setCurrentTurn(turnNumber: number, playerId: string): void {
		this.currentTurn = { turnNumber, playerId };

		// Broadcast to spectators that a new turn started
		this.broadcastToSpectators({
			type: 'TURN_STARTED',
			payload: {
				turnNumber,
				playerId,
				predictionsOpen: true,
			},
		});
	}

	/**
	 * Evaluate predictions at end of turn
	 * Called when a player scores (ends their turn)
	 */
	public evaluatePredictions(outcome: {
		playerId: string;
		wasDicee: boolean;
		improved: boolean;
		bricked: boolean;
		finalScore: number;
	}): PredictionResult[] {
		if (!this.currentTurn) return [];

		const turnKey = `${this.currentTurn.turnNumber}:${this.currentTurn.playerId}`;
		const turnPredictions = this.predictions.get(turnKey) ?? [];
		const results: PredictionResult[] = [];

		for (const prediction of turnPredictions) {
			if (prediction.evaluated) continue;

			let correct = false;

			switch (prediction.type) {
				case 'dicee':
					correct = outcome.wasDicee;
					break;
				case 'improves':
					correct = outcome.improved;
					break;
				case 'bricks':
					correct = outcome.bricked;
					break;
				case 'exact':
					correct = prediction.exactScore === outcome.finalScore;
					break;
			}

			const pointsAwarded = correct ? GameRoom.PREDICTION_POINTS[prediction.type] : 0;

			// Update prediction
			prediction.evaluated = true;
			prediction.correct = correct;
			prediction.pointsAwarded = pointsAwarded;

			// Update spectator stats
			this.updateSpectatorStats(prediction.spectatorId, correct, pointsAwarded);

			results.push({
				predictionId: prediction.id,
				correct,
				pointsAwarded,
				actualOutcome: outcome,
			});
		}

		// Broadcast results to spectators
		if (results.length > 0) {
			this.broadcastToSpectators({
				type: 'PREDICTION_RESULTS',
				payload: {
					turnNumber: this.currentTurn.turnNumber,
					playerId: outcome.playerId,
					results,
					outcome,
				},
			});
		}

		// Clear current turn
		this.currentTurn = null;

		return results;
	}

	/**
	 * Update spectator's prediction stats
	 */
	private updateSpectatorStats(spectatorId: string, correct: boolean, points: number): void {
		let stats = this.spectatorStats.get(spectatorId);
		if (!stats) {
			stats = this.createInitialStats(spectatorId);
		}

		stats.totalPredictions++;
		if (correct) {
			stats.correctPredictions++;
			stats.streak++;
			stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
		} else {
			stats.streak = 0;
		}
		stats.totalPoints += points;
		stats.accuracy =
			stats.totalPredictions > 0 ? stats.correctPredictions / stats.totalPredictions : 0;

		this.spectatorStats.set(spectatorId, stats);

		// Send updated stats to this spectator
		this.sendToUser(spectatorId, {
			type: 'PREDICTION_STATS_UPDATE',
			payload: stats,
		});
	}

	/**
	 * Get all spectator stats (for leaderboard)
	 */
	public getSpectatorLeaderboard(): SpectatorPredictionStats[] {
		return Array.from(this.spectatorStats.values()).sort((a, b) => b.totalPoints - a.totalPoints);
	}

	/**
	 * Clear predictions for a new game
	 */
	public clearPredictions(): void {
		this.predictions.clear();
		this.spectatorStats.clear();
		this.currentTurn = null;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Gallery Rooting System (D5)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle a spectator rooting for a player
	 */
	private handleRootForPlayer(
		ws: WebSocket,
		connState: ConnectionState,
		payload: { playerId: string },
	): void {
		// Only spectators can root
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can root for players');
			return;
		}

		// Validate player exists
		const playerIds = this.getConnectedUserIds();
		if (!playerIds.includes(payload.playerId)) {
			this.sendError(ws, 'INVALID_PLAYER', 'Invalid player ID');
			return;
		}

		// Check existing rooting choice
		const existing = this.rootingChoices.get(connState.userId);

		// Check rate limit
		if (existing && existing.changeCount >= GameRoom.MAX_ROOTING_CHANGES) {
			this.sendError(
				ws,
				'ROOTING_LIMIT',
				`Maximum ${GameRoom.MAX_ROOTING_CHANGES} rooting changes per game`,
			);
			return;
		}

		// Check if already rooting for this player
		if (existing && existing.playerId === payload.playerId) {
			this.sendError(ws, 'ALREADY_ROOTING', 'Already rooting for this player');
			return;
		}

		// Create or update rooting choice
		const choice: RootingChoice = {
			spectatorId: connState.userId,
			spectatorName: connState.displayName,
			playerId: payload.playerId,
			rootedAt: Date.now(),
			changeCount: existing ? existing.changeCount + 1 : 0,
		};

		this.rootingChoices.set(connState.userId, choice);

		// Send confirmation to spectator
		ws.send(
			JSON.stringify({
				type: 'ROOTING_CONFIRMED',
				payload: {
					playerId: payload.playerId,
					changeCount: choice.changeCount,
					remainingChanges: GameRoom.MAX_ROOTING_CHANGES - choice.changeCount,
				},
			}),
		);

		// Broadcast rooting update to everyone
		this.broadcastRootingUpdate();

		// Rooting choice made (logged via broadcast events)
	}

	/**
	 * Handle clearing rooting choice
	 */
	private handleClearRooting(ws: WebSocket, connState: ConnectionState): void {
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can clear rooting');
			return;
		}

		const existing = this.rootingChoices.get(connState.userId);
		if (!existing) {
			this.sendError(ws, 'NOT_ROOTING', 'Not currently rooting for anyone');
			return;
		}

		// Check rate limit (clearing counts as a change)
		if (existing.changeCount >= GameRoom.MAX_ROOTING_CHANGES) {
			this.sendError(
				ws,
				'ROOTING_LIMIT',
				`Maximum ${GameRoom.MAX_ROOTING_CHANGES} rooting changes per game`,
			);
			return;
		}

		// Update change count but remove the choice
		this.rootingChoices.delete(connState.userId);

		ws.send(
			JSON.stringify({
				type: 'ROOTING_CLEARED',
				payload: {
					previousPlayerId: existing.playerId,
				},
			}),
		);

		// Broadcast rooting update
		this.broadcastRootingUpdate();

		// Rooting choice cleared (logged via broadcast events)
	}

	/**
	 * Handle get rooting request
	 */
	private handleGetRooting(ws: WebSocket): void {
		const connState = ws.deserializeAttachment() as ConnectionState;
		const update = this.buildRootingUpdate();

		// Include spectator's own choice if they have one
		const myChoice =
			connState.role === 'spectator' ? this.rootingChoices.get(connState.userId) : null;

		ws.send(
			JSON.stringify({
				type: 'ROOTING_STATE',
				payload: {
					...update,
					myChoice: myChoice
						? {
								playerId: myChoice.playerId,
								changeCount: myChoice.changeCount,
								remainingChanges: GameRoom.MAX_ROOTING_CHANGES - myChoice.changeCount,
							}
						: null,
				},
			}),
		);
	}

	/**
	 * Build rooting update for broadcast
	 */
	private buildRootingUpdate(): RootingUpdate {
		// Group rooters by player
		const playerRooters = new Map<string, { count: number; names: string[] }>();

		// Initialize for all connected players
		for (const playerId of this.getConnectedUserIds()) {
			playerRooters.set(playerId, { count: 0, names: [] });
		}

		// Count rooters per player
		for (const choice of this.rootingChoices.values()) {
			const existing = playerRooters.get(choice.playerId);
			if (existing) {
				existing.count++;
				existing.names.push(choice.spectatorName);
			}
		}

		// Build player info array
		const players: PlayerRootingInfo[] = [];
		for (const [playerId, data] of playerRooters) {
			players.push({
				playerId,
				rooterCount: data.count,
				rooterNames: data.names,
			});
		}

		return {
			players,
			totalRooters: this.rootingChoices.size,
		};
	}

	/**
	 * Broadcast rooting update to all connections
	 */
	private broadcastRootingUpdate(): void {
		const update = this.buildRootingUpdate();
		this.broadcast({
			type: 'ROOTING_UPDATE',
			payload: update,
		});
	}

	/**
	 * Get rooting info for a specific player
	 */
	public getPlayerRootingInfo(playerId: string): PlayerRootingInfo {
		const rooters: string[] = [];
		for (const choice of this.rootingChoices.values()) {
			if (choice.playerId === playerId) {
				rooters.push(choice.spectatorName);
			}
		}
		return {
			playerId,
			rooterCount: rooters.length,
			rooterNames: rooters,
		};
	}

	/**
	 * Clear rooting for a new game
	 */
	public clearRooting(): void {
		this.rootingChoices.clear();
	}

	/**
	 * Award bonus points to spectators who rooted for the winner
	 * Called at game end
	 */
	public awardRootingBonus(winnerId: string, bonusPoints: number = 25): void {
		for (const choice of this.rootingChoices.values()) {
			if (choice.playerId === winnerId) {
				// Update spectator stats with bonus
				let stats = this.spectatorStats.get(choice.spectatorId);
				if (!stats) {
					stats = this.createInitialStats(choice.spectatorId);
				}
				stats.totalPoints += bonusPoints;
				this.spectatorStats.set(choice.spectatorId, stats);

				// Notify the spectator
				this.sendToUser(choice.spectatorId, {
					type: 'ROOTING_BONUS',
					payload: {
						winnerId,
						bonusPoints,
						totalPoints: stats.totalPoints,
					},
				});
			}
		}
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Gallery Kibitz System (D6)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle a kibitz vote from a spectator
	 */
	private handleKibitz(
		ws: WebSocket,
		connState: ConnectionState,
		payload: {
			playerId: string;
			voteType: KibitzVoteType;
			category?: string;
			keepPattern?: number;
			action?: 'roll' | 'score';
		},
	): void {
		// Only spectators can kibitz
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can kibitz');
			return;
		}

		// Must have an active turn
		if (!this.currentTurn) {
			this.sendError(ws, 'NO_ACTIVE_TURN', 'No active turn to kibitz on');
			return;
		}

		// Validate player matches current turn
		if (payload.playerId !== this.currentTurn.playerId) {
			this.sendError(ws, 'WRONG_PLAYER', 'Can only kibitz on the current player');
			return;
		}

		// Validate vote content based on type
		if (payload.voteType === 'category' && !payload.category) {
			this.sendError(ws, 'MISSING_CATEGORY', 'Category vote requires a category');
			return;
		}
		if (payload.voteType === 'keep' && payload.keepPattern === undefined) {
			this.sendError(ws, 'MISSING_KEEP_PATTERN', 'Keep vote requires a keep pattern');
			return;
		}
		if (payload.voteType === 'action' && !payload.action) {
			this.sendError(ws, 'MISSING_ACTION', 'Action vote requires an action');
			return;
		}

		// Create or update vote (one vote per spectator per turn)
		const vote: KibitzVote = {
			id: crypto.randomUUID(),
			spectatorId: connState.userId,
			spectatorName: connState.displayName,
			playerId: payload.playerId,
			voteType: payload.voteType,
			category: payload.category,
			keepPattern: payload.keepPattern,
			action: payload.action,
			timestamp: Date.now(),
		};

		this.kibitzVotes.set(connState.userId, vote);

		// Send confirmation
		ws.send(
			JSON.stringify({
				type: 'KIBITZ_CONFIRMED',
				payload: {
					voteType: payload.voteType,
					category: payload.category,
					keepPattern: payload.keepPattern,
					action: payload.action,
				},
			}),
		);

		// Broadcast updated kibitz state
		this.broadcastKibitzUpdate(payload.voteType);

		// Kibitz vote made (logged via broadcast events)
	}

	/**
	 * Handle clearing a kibitz vote
	 */
	private handleClearKibitz(ws: WebSocket, connState: ConnectionState): void {
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can clear kibitz');
			return;
		}

		const existing = this.kibitzVotes.get(connState.userId);
		if (!existing) {
			this.sendError(ws, 'NO_VOTE', 'No kibitz vote to clear');
			return;
		}

		const voteType = existing.voteType;
		this.kibitzVotes.delete(connState.userId);

		ws.send(
			JSON.stringify({
				type: 'KIBITZ_CLEARED',
				payload: { voteType },
			}),
		);

		// Broadcast updated state
		this.broadcastKibitzUpdate(voteType);
	}

	/**
	 * Handle get kibitz state request
	 */
	private handleGetKibitz(ws: WebSocket): void {
		const state = this.buildKibitzState();

		ws.send(
			JSON.stringify({
				type: 'KIBITZ_STATE',
				payload: state,
			}),
		);
	}

	/**
	 * Build aggregated kibitz state for broadcast
	 */
	private buildKibitzState(): KibitzState | null {
		if (!this.currentTurn) {
			return null;
		}

		// Group votes by type
		const categoryVotes = new Map<string, { count: number; voters: string[] }>();
		const keepVotes = new Map<number, { count: number; voters: string[] }>();
		const actionVotes = new Map<string, { count: number; voters: string[] }>();

		for (const vote of this.kibitzVotes.values()) {
			switch (vote.voteType) {
				case 'category':
					if (vote.category) {
						const existing = categoryVotes.get(vote.category) ?? { count: 0, voters: [] };
						existing.count++;
						existing.voters.push(vote.spectatorName);
						categoryVotes.set(vote.category, existing);
					}
					break;
				case 'keep':
					if (vote.keepPattern !== undefined) {
						const existing = keepVotes.get(vote.keepPattern) ?? { count: 0, voters: [] };
						existing.count++;
						existing.voters.push(vote.spectatorName);
						keepVotes.set(vote.keepPattern, existing);
					}
					break;
				case 'action':
					if (vote.action) {
						const existing = actionVotes.get(vote.action) ?? { count: 0, voters: [] };
						existing.count++;
						existing.voters.push(vote.spectatorName);
						actionVotes.set(vote.action, existing);
					}
					break;
			}
		}

		const totalVotes = this.kibitzVotes.size;

		// Build options arrays
		const categoryOptions = this.buildKibitzOptions(categoryVotes, totalVotes);
		const keepOptions = this.buildKeepPatternOptions(keepVotes, totalVotes);
		const actionOptions = this.buildKibitzOptions(actionVotes, totalVotes);

		// Determine active vote type (most votes)
		let activeVoteType: KibitzVoteType = 'category';
		let maxVotes = categoryOptions.reduce((sum, o) => sum + o.voteCount, 0);
		const keepVotesCount = keepOptions.reduce((sum, o) => sum + o.voteCount, 0);
		const actionVotesCount = actionOptions.reduce((sum, o) => sum + o.voteCount, 0);

		if (keepVotesCount > maxVotes) {
			activeVoteType = 'keep';
			maxVotes = keepVotesCount;
		}
		if (actionVotesCount > maxVotes) {
			activeVoteType = 'action';
		}

		return {
			playerId: this.currentTurn.playerId,
			turnNumber: this.currentTurn.turnNumber,
			totalVotes,
			activeVoteType,
			categoryOptions,
			keepOptions,
			actionOptions,
			votingOpen: true,
		};
	}

	/**
	 * Build options from vote map
	 */
	private buildKibitzOptions(
		votes: Map<string, { count: number; voters: string[] }>,
		totalVotes: number,
	): KibitzOption[] {
		const options: KibitzOption[] = [];

		for (const [optionId, data] of votes) {
			options.push({
				optionId,
				label: this.formatOptionLabel(optionId),
				voteCount: data.count,
				percentage: totalVotes > 0 ? Math.round((data.count / totalVotes) * 100) : 0,
				voterPreview: data.voters.slice(0, 3),
			});
		}

		// Sort by vote count descending
		return options.sort((a, b) => b.voteCount - a.voteCount);
	}

	/**
	 * Build keep pattern options with formatted labels
	 */
	private buildKeepPatternOptions(
		votes: Map<number, { count: number; voters: string[] }>,
		totalVotes: number,
	): KibitzOption[] {
		const options: KibitzOption[] = [];

		for (const [pattern, data] of votes) {
			options.push({
				optionId: pattern.toString(),
				label: this.formatKeepPattern(pattern),
				voteCount: data.count,
				percentage: totalVotes > 0 ? Math.round((data.count / totalVotes) * 100) : 0,
				voterPreview: data.voters.slice(0, 3),
			});
		}

		return options.sort((a, b) => b.voteCount - a.voteCount);
	}

	/**
	 * Format option label for display
	 */
	private formatOptionLabel(optionId: string): string {
		// Capitalize first letter of each word
		return optionId
			.split('_')
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
			.join(' ');
	}

	/**
	 * Format keep pattern bitmask to human-readable string
	 */
	private formatKeepPattern(pattern: number): string {
		if (pattern === 0) return 'Keep none';
		if (pattern === 31) return 'Keep all';

		const kept: number[] = [];
		for (let i = 0; i < 5; i++) {
			if (pattern & (1 << i)) {
				kept.push(i + 1);
			}
		}

		return `Keep dice ${kept.join(', ')}`;
	}

	/**
	 * Broadcast kibitz update to all connections
	 */
	private broadcastKibitzUpdate(voteType: KibitzVoteType): void {
		const state = this.buildKibitzState();
		if (!state) return;

		let options: KibitzOption[];
		switch (voteType) {
			case 'category':
				options = state.categoryOptions;
				break;
			case 'keep':
				options = state.keepOptions;
				break;
			case 'action':
				options = state.actionOptions;
				break;
		}

		const update: KibitzUpdate = {
			turnNumber: state.turnNumber,
			playerId: state.playerId,
			options,
			voteType,
			totalVotes: state.totalVotes,
		};

		this.broadcast({
			type: 'KIBITZ_UPDATE',
			payload: update,
		});
	}

	/**
	 * Clear kibitz votes for a new turn
	 * Called when turn changes
	 */
	public clearKibitz(): void {
		this.kibitzVotes.clear();
	}

	/**
	 * Get the leading kibitz suggestion for a vote type
	 */
	public getKibitzSuggestion(voteType: KibitzVoteType): KibitzOption | null {
		const state = this.buildKibitzState();
		if (!state) return null;

		let options: KibitzOption[];
		switch (voteType) {
			case 'category':
				options = state.categoryOptions;
				break;
			case 'keep':
				options = state.keepOptions;
				break;
			case 'action':
				options = state.actionOptions;
				break;
		}

		return options.length > 0 ? options[0] : null;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Spectator Reaction Handlers (D7)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle a spectator reaction
	 */
	private handleSpectatorReaction(
		ws: WebSocket,
		connState: ConnectionState,
		payload: {
			emoji: SpectatorReactionEmoji;
			targetPlayerId?: string;
		},
	): void {
		// Only spectators can use spectator reactions
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can send spectator reactions');
			return;
		}

		const { emoji, targetPlayerId } = payload;

		// Validate emoji is a valid reaction
		if (!this.isValidSpectatorReaction(emoji)) {
			this.sendError(ws, 'INVALID_EMOJI', 'Invalid reaction emoji');
			return;
		}

		// Check rate limit
		if (!this.checkReactionRateLimit(connState.userId)) {
			this.sendError(ws, 'RATE_LIMITED', 'Slow down! Too many reactions');
			return;
		}

		// Get reaction metadata
		const metadata = REACTION_METADATA[emoji];

		// Check if rooting-specific reaction
		if (metadata.requiresRooting) {
			const rootingChoice = this.rootingChoices.get(connState.userId);
			if (!rootingChoice) {
				this.sendError(ws, 'NOT_ROOTING', 'You must be rooting for a player to use this reaction');
				return;
			}
			// For rooting reactions, target must be the rooted player
			if (targetPlayerId && targetPlayerId !== rootingChoice.playerId) {
				this.sendError(
					ws,
					'WRONG_PLAYER',
					'You can only use rooting reactions for your backed player',
				);
				return;
			}
		}

		// Create reaction
		const reaction: SpectatorReaction = {
			id: crypto.randomUUID(),
			spectatorId: connState.userId,
			spectatorName: connState.displayName,
			emoji,
			targetPlayerId,
			timestamp: Date.now(),
		};

		// Track for combo
		const comboCount = this.trackReactionCombo(emoji, connState.userId);

		// Determine if sound should play (first in combo or every 5th)
		const playSound = comboCount === 1 || comboCount % 5 === 0;

		// Build reaction event
		const reactionEvent: SpectatorReactionEvent = {
			reaction,
			comboCount,
			playSound,
		};

		// Broadcast to all spectators (and optionally players if room settings allow)
		this.broadcastSpectatorReaction(reactionEvent);

		// Send confirmation
		ws.send(
			JSON.stringify({
				type: 'REACTION_SENT',
				payload: {
					reactionId: reaction.id,
					emoji,
					comboCount,
				},
			}),
		);
	}

	/**
	 * Check if an emoji is a valid spectator reaction
	 */
	private isValidSpectatorReaction(emoji: string): emoji is SpectatorReactionEmoji {
		return (
			(STANDARD_REACTIONS as readonly string[]).includes(emoji) ||
			(SPECTATOR_REACTIONS as readonly string[]).includes(emoji) ||
			(ROOTING_REACTIONS as readonly string[]).includes(emoji)
		);
	}

	/**
	 * Check and update reaction rate limit for a spectator
	 */
	private checkReactionRateLimit(spectatorId: string): boolean {
		const now = Date.now();
		let limit = this.reactionRateLimits.get(spectatorId);

		// Initialize if no limit exists
		if (!limit) {
			limit = {
				maxReactions: DEFAULT_REACTION_RATE_LIMIT.maxReactions,
				windowMs: DEFAULT_REACTION_RATE_LIMIT.windowMs,
				currentCount: 0,
				resetAt: now + DEFAULT_REACTION_RATE_LIMIT.windowMs,
			};
			this.reactionRateLimits.set(spectatorId, limit);
		}

		// Reset if window expired
		if (now >= limit.resetAt) {
			limit.currentCount = 0;
			limit.resetAt = now + limit.windowMs;
		}

		// Check if at limit
		if (limit.currentCount >= limit.maxReactions) {
			return false;
		}

		// Increment and allow
		limit.currentCount++;
		return true;
	}

	/**
	 * Track reaction for combo effect
	 * Returns current combo count for this emoji
	 */
	private trackReactionCombo(emoji: SpectatorReactionEmoji, spectatorId: string): number {
		const now = Date.now();
		const cutoff = now - GameRoom.REACTION_COMBO_WINDOW_MS;

		// Get existing reactions for this emoji
		let reactions = this.recentReactions.get(emoji) ?? [];

		// Filter out old reactions
		reactions = reactions.filter((r) => r.timestamp > cutoff);

		// Add this reaction
		reactions.push({ timestamp: now, spectatorId });

		// Update map
		this.recentReactions.set(emoji, reactions);

		// Return combo count (unique spectators in window)
		const uniqueSpectators = new Set(reactions.map((r) => r.spectatorId));
		return uniqueSpectators.size;
	}

	/**
	 * Broadcast spectator reaction to all clients
	 */
	private broadcastSpectatorReaction(event: SpectatorReactionEvent): void {
		// Broadcast to spectators with tag
		this.broadcastToSpectators({
			type: 'SPECTATOR_REACTION',
			payload: event,
		});

		// Also broadcast to players (they can see reactions)
		this.broadcastToPlayers({
			type: 'SPECTATOR_REACTION',
			payload: event,
		});
	}

	/**
	 * Get current reaction rate limit status for a spectator
	 */
	public getReactionRateLimit(spectatorId: string): ReactionRateLimit | null {
		return this.reactionRateLimits.get(spectatorId) ?? null;
	}

	/**
	 * Get current combo count for an emoji
	 */
	public getReactionCombo(emoji: SpectatorReactionEmoji): ReactionCombo | null {
		const now = Date.now();
		const cutoff = now - GameRoom.REACTION_COMBO_WINDOW_MS;
		const reactions = this.recentReactions.get(emoji);

		if (!reactions || reactions.length === 0) return null;

		// Filter to recent
		const recent = reactions.filter((r) => r.timestamp > cutoff);
		if (recent.length === 0) return null;

		// Get unique spectator names (would need to look up, using IDs for now)
		const uniqueSpectators = [...new Set(recent.map((r) => r.spectatorId))];

		return {
			emoji,
			count: recent.length,
			spectatorNames: uniqueSpectators.slice(0, 3), // First 3 spectator IDs
			lastTimestamp: Math.max(...recent.map((r) => r.timestamp)),
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Join Queue System (D8)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle a spectator joining the queue for next game
	 */
	private async handleJoinQueue(ws: WebSocket, connState: ConnectionState): Promise<void> {
		// Only spectators can join the queue
		if (connState.role !== 'spectator') {
			this.sendError(ws, 'NOT_SPECTATOR', 'Only spectators can join the queue');
			return;
		}

		// Check if already in queue
		if (this.joinQueue.some((e) => e.userId === connState.userId)) {
			this.sendError(ws, 'ALREADY_IN_QUEUE', 'Already in the join queue');
			return;
		}

		// Check queue size limit
		if (this.joinQueue.length >= MAX_QUEUE_SIZE) {
			this.sendError(ws, 'QUEUE_FULL', 'Join queue is full');
			return;
		}

		// Check if queue is open
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) {
			this.sendError(ws, 'NO_ROOM', 'Room not found');
			return;
		}

		// Create queue entry
		const entry: JoinQueueEntry = {
			userId: connState.userId,
			displayName: connState.displayName,
			avatarSeed: connState.avatarSeed,
			position: this.joinQueue.length + 1,
			queuedAt: Date.now(),
		};

		this.joinQueue.push(entry);

		// Calculate if they'll get a spot
		const availableSpots = roomState.settings.maxPlayers - this.getConnectedUserIds().length;
		const willGetSpot = entry.position <= availableSpots;

		// Send confirmation
		ws.send(
			JSON.stringify({
				type: 'QUEUE_JOINED',
				payload: {
					position: entry.position,
					willGetSpot,
					totalQueued: this.joinQueue.length,
					availableSpots: Math.max(0, availableSpots),
				},
			}),
		);

		// Broadcast queue update
		this.broadcastQueueUpdate(roomState);

		// Queue join (logged via broadcast events)
	}

	/**
	 * Handle a spectator leaving the queue
	 */
	private handleLeaveQueue(ws: WebSocket, connState: ConnectionState): void {
		const index = this.joinQueue.findIndex((e) => e.userId === connState.userId);
		if (index === -1) {
			this.sendError(ws, 'NOT_IN_QUEUE', 'Not in the join queue');
			return;
		}

		// Remove from queue
		this.joinQueue.splice(index, 1);

		// Reorder remaining entries
		this.reorderQueue();

		// Send confirmation
		ws.send(
			JSON.stringify({
				type: 'QUEUE_LEFT',
				payload: { previousPosition: index + 1 },
			}),
		);

		// Broadcast queue update
		this.ctx.storage.get<RoomState>('room').then((roomState) => {
			if (roomState) {
				this.broadcastQueueUpdate(roomState);
			}
		});

		// Queue leave (logged via broadcast events)
	}

	/**
	 * Handle get queue state request
	 */
	private async handleGetQueue(ws: WebSocket): Promise<void> {
		const connState = ws.deserializeAttachment() as ConnectionState;
		const roomState = await this.ctx.storage.get<RoomState>('room');

		if (!roomState) {
			ws.send(
				JSON.stringify({
					type: 'QUEUE_STATE',
					payload: null,
				}),
			);
			return;
		}

		const currentPlayerCount = this.getConnectedUserIds().length;
		const availableSpots = roomState.settings.maxPlayers - currentPlayerCount;

		// Find user's position in queue
		const myEntry = this.joinQueue.find((e) => e.userId === connState.userId);

		const state: JoinQueueState = {
			queue: this.joinQueue,
			maxPlayers: roomState.settings.maxPlayers,
			currentPlayerCount,
			estimatedWaitMs: this.estimateWaitTime(roomState),
			queueOpen: roomState.status !== 'completed' && roomState.status !== 'abandoned',
		};

		ws.send(
			JSON.stringify({
				type: 'QUEUE_STATE',
				payload: {
					...state,
					myPosition: myEntry?.position ?? null,
					willGetSpot: myEntry ? myEntry.position <= availableSpots : false,
				},
			}),
		);
	}

	/**
	 * Reorder queue positions after removal
	 */
	private reorderQueue(): void {
		this.joinQueue.forEach((entry, index) => {
			entry.position = index + 1;
		});
	}

	/**
	 * Broadcast queue update to all spectators
	 */
	private broadcastQueueUpdate(roomState: RoomState): void {
		const currentPlayerCount = this.getConnectedUserIds().length;
		const availableSpots = Math.max(0, roomState.settings.maxPlayers - currentPlayerCount);

		const update: JoinQueueUpdate = {
			queue: this.joinQueue,
			availableSpots,
			totalQueued: this.joinQueue.length,
		};

		this.broadcast({
			type: 'QUEUE_UPDATE',
			payload: update,
		});
	}

	/**
	 * Estimate wait time based on game progress
	 */
	private estimateWaitTime(roomState: RoomState): number | null {
		if (roomState.status !== 'playing' || !roomState.startedAt) {
			return null;
		}

		// Rough estimate: 13 rounds × ~30 seconds per round = 6.5 minutes
		// Adjust based on elapsed time
		const elapsed = Date.now() - roomState.startedAt;
		const avgGameTime = 13 * 30 * 1000; // 6.5 minutes

		const estimated = Math.max(0, avgGameTime - elapsed);
		return estimated;
	}

	/**
	 * Process warm seat transition when game ends
	 * Called when a game finishes to transition queued spectators to players
	 */
	public async processWarmSeat(): Promise<WarmSeatTransition | null> {
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (!roomState) return null;

		// Get current players who want to stay
		const stayingPlayers: WarmSeatTransition['stayingPlayers'] = [];
		const roomCode = this.getRoomCode();

		for (const ws of this.ctx.getWebSockets(`player:${roomCode}`)) {
			const state = ws.deserializeAttachment() as ConnectionState;
			stayingPlayers.push({
				userId: state.userId,
				displayName: state.displayName,
				avatarSeed: state.avatarSeed,
			});
		}

		// Calculate available spots
		const availableSpots = roomState.settings.maxPlayers - stayingPlayers.length;

		if (availableSpots <= 0 || this.joinQueue.length === 0) {
			// No spots or no one in queue
			this.warmSeatTransition = null;
			return null;
		}

		// Get spectators from queue who will transition
		const transitioningCount = Math.min(availableSpots, this.joinQueue.length);
		const transitioning = this.joinQueue.splice(0, transitioningCount);

		// Reorder remaining queue
		this.reorderQueue();

		// Build transition data
		const transitioningUsers: WarmSeatTransition['transitioningUsers'] = transitioning.map(
			(entry) => ({
				userId: entry.userId,
				displayName: entry.displayName,
				avatarSeed: entry.avatarSeed,
				fromPosition: entry.position,
			}),
		);

		this.warmSeatTransition = {
			transitioningUsers,
			stayingPlayers,
			countdownSeconds: WARM_SEAT_COUNTDOWN_SECONDS,
			startedAt: Date.now(),
		};

		// Broadcast warm seat transition
		this.broadcast({
			type: 'WARM_SEAT_TRANSITION',
			payload: this.warmSeatTransition,
		});

		// Notify specific users they're transitioning
		for (const user of transitioningUsers) {
			this.sendToUser(user.userId, {
				type: 'YOU_ARE_TRANSITIONING',
				payload: {
					fromPosition: user.fromPosition,
					countdownSeconds: WARM_SEAT_COUNTDOWN_SECONDS,
				},
			});
		}

		// Phase 1: Schedule alarm for countdown completion via AlarmQueue
		await this.alarmQueue.schedule({
			type: 'ROOM_CLEANUP',
			targetId: null, // Room-level alarm
			scheduledFor: Date.now() + WARM_SEAT_COUNTDOWN_SECONDS * 1000,
			metadata: { warmSeat: true },
		});

		// Warm seat transition started (logged via state transition events)

		return this.warmSeatTransition;
	}

	/**
	 * Complete the warm seat transition - actually convert spectators to players
	 * Called when countdown finishes
	 */
	public async completeWarmSeatTransition(): Promise<void> {
		if (!this.warmSeatTransition) return;

		const transition = this.warmSeatTransition;
		this.warmSeatTransition = null;

		// Convert each transitioning spectator to a player
		for (const user of transition.transitioningUsers) {
			const sockets = this.ctx.getWebSockets(`user:${user.userId}`);
			for (const ws of sockets) {
				const state = ws.deserializeAttachment() as ConnectionState;

				// Update role to player
				state.role = 'player';
				ws.serializeAttachment(state);

				// Notify the user
				ws.send(
					JSON.stringify({
						type: 'TRANSITION_COMPLETE',
						payload: {
							newRole: 'player',
							message: 'You are now a player!',
						},
					}),
				);
			}
		}

		// Update room state
		const roomState = await this.ctx.storage.get<RoomState>('room');
		if (roomState) {
			// Add transitioning users to player order
			for (const user of transition.transitioningUsers) {
				if (!roomState.playerOrder.includes(user.userId)) {
					roomState.playerOrder.push(user.userId);
				}
			}

			// Reset room for new game
			roomState.status = 'waiting';
			roomState.startedAt = null;

			await this.ctx.storage.put('room', roomState);
		}

		// Broadcast the completion
		this.broadcast({
			type: 'WARM_SEAT_COMPLETE',
			payload: {
				newPlayers: transition.transitioningUsers.map((u) => ({
					userId: u.userId,
					displayName: u.displayName,
					avatarSeed: u.avatarSeed,
				})),
				totalPlayers: this.getConnectedUserIds().length + transition.transitioningUsers.length,
			},
		});

		// Notify lobby of player count change
		await this.notifyLobbyOfUpdate();

		// Warm seat transition complete (logged via state transition events)
	}

	/**
	 * Remove a user from queue when they disconnect
	 */
	private removeFromQueueOnDisconnect(userId: string): void {
		const index = this.joinQueue.findIndex((e) => e.userId === userId);
		if (index !== -1) {
			this.joinQueue.splice(index, 1);
			this.reorderQueue();

			// Broadcast update
			this.ctx.storage.get<RoomState>('room').then((roomState) => {
				if (roomState) {
					this.broadcastQueueUpdate(roomState);
				}
			});
		}
	}

	/**
	 * Get current queue state (for external queries)
	 */
	public getJoinQueueState(): JoinQueueEntry[] {
		return [...this.joinQueue];
	}

	/**
	 * Clear the join queue (for new room or cleanup)
	 */
	public clearJoinQueue(): void {
		this.joinQueue = [];
		this.warmSeatTransition = null;
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Gallery Points System (D9)
	// ─────────────────────────────────────────────────────────────────────────────

	/**
	 * Handle request for gallery points
	 */
	private handleGetGalleryPoints(ws: WebSocket, connState: ConnectionState): void {
		const points = this.getSpectatorGalleryPoints(connState.userId);
		const total = calculateTotalPoints(points);

		ws.send(
			JSON.stringify({
				type: 'GALLERY_POINTS',
				payload: {
					points,
					totalPoints: total,
					spectatorId: connState.userId,
				},
			}),
		);
	}

	/**
	 * Get or create gallery points for a spectator
	 */
	private getSpectatorGalleryPoints(spectatorId: string): GalleryPoints {
		let points = this.gameGalleryPoints.get(spectatorId);
		if (!points) {
			points = createEmptyGalleryPoints();
			this.gameGalleryPoints.set(spectatorId, points);
		}
		return points;
	}

	/**
	 * Get or create point caps for a spectator
	 */
	private getPointCaps(spectatorId: string): { reactions: number; chat: number } {
		let caps = this.gamePointCaps.get(spectatorId);
		if (!caps) {
			caps = { reactions: 0, chat: 0 };
			this.gamePointCaps.set(spectatorId, caps);
		}
		return caps;
	}

	/**
	 * Award prediction points to a spectator
	 */
	public awardPredictionPoints(
		spectatorId: string,
		predictionType: PredictionType,
		isCorrect: boolean,
		streakBonus: number = 0,
	): number {
		if (!isCorrect) return 0;

		const points = this.getSpectatorGalleryPoints(spectatorId);
		let awarded = 0;

		// Base points by type
		if (predictionType === 'dicee') {
			awarded = GALLERY_POINT_VALUES.PREDICTION_DICEE;
		} else if (predictionType === 'exact') {
			awarded = GALLERY_POINT_VALUES.PREDICTION_EXACT_SCORE;
			points.predictions.exactScore += awarded;
		} else {
			awarded = GALLERY_POINT_VALUES.PREDICTION_CORRECT_BASE;
		}

		points.predictions.correct += awarded;

		// Streak bonus
		if (streakBonus > 0) {
			const bonus = Math.floor(
				awarded * GALLERY_POINT_VALUES.PREDICTION_STREAK_MULTIPLIER * streakBonus,
			);
			points.predictions.streakBonus += bonus;
			awarded += bonus;
		}

		this.gameGalleryPoints.set(spectatorId, points);
		this.notifyPointsUpdate(spectatorId, points);

		return awarded;
	}

	/**
	 * Award reaction points to a spectator
	 */
	public awardReactionPoints(spectatorId: string): number {
		const caps = this.getPointCaps(spectatorId);

		// Check cap
		if (caps.reactions >= GALLERY_POINT_VALUES.MAX_REACTION_POINTS_PER_GAME) {
			return 0;
		}

		const points = this.getSpectatorGalleryPoints(spectatorId);
		points.social.reactionsGiven += GALLERY_POINT_VALUES.REACTION_GIVEN;
		caps.reactions += GALLERY_POINT_VALUES.REACTION_GIVEN;

		this.gameGalleryPoints.set(spectatorId, points);
		this.gamePointCaps.set(spectatorId, caps);

		return GALLERY_POINT_VALUES.REACTION_GIVEN;
	}

	/**
	 * Award kibitz points when in majority
	 */
	public awardKibitzPoints(spectatorId: string): number {
		const points = this.getSpectatorGalleryPoints(spectatorId);
		points.social.kibitzVotes += GALLERY_POINT_VALUES.KIBITZ_MAJORITY;
		this.gameGalleryPoints.set(spectatorId, points);
		this.notifyPointsUpdate(spectatorId, points);

		return GALLERY_POINT_VALUES.KIBITZ_MAJORITY;
	}

	/**
	 * Award chat message points
	 */
	public awardChatPoints(spectatorId: string): number {
		const caps = this.getPointCaps(spectatorId);

		// Check cap
		if (caps.chat >= GALLERY_POINT_VALUES.MAX_CHAT_POINTS_PER_GAME) {
			return 0;
		}

		const points = this.getSpectatorGalleryPoints(spectatorId);
		points.social.chatMessages += GALLERY_POINT_VALUES.CHAT_MESSAGE;
		caps.chat += GALLERY_POINT_VALUES.CHAT_MESSAGE;

		this.gameGalleryPoints.set(spectatorId, points);
		this.gamePointCaps.set(spectatorId, caps);

		return GALLERY_POINT_VALUES.CHAT_MESSAGE;
	}

	/**
	 * Award backing winner points at game end
	 */
	public awardBackingWinnerPoints(spectatorId: string, wasUnderdog: boolean = false): number {
		const points = this.getSpectatorGalleryPoints(spectatorId);
		let awarded = GALLERY_POINT_VALUES.BACKED_WINNER;
		points.backing.backedWinner += awarded;

		if (wasUnderdog) {
			points.backing.loyaltyBonus += GALLERY_POINT_VALUES.UNDERDOG_BONUS;
			awarded += GALLERY_POINT_VALUES.UNDERDOG_BONUS;
		}

		this.gameGalleryPoints.set(spectatorId, points);
		this.notifyPointsUpdate(spectatorId, points);

		return awarded;
	}

	/**
	 * Notify spectator of points update
	 */
	private notifyPointsUpdate(spectatorId: string, points: GalleryPoints): void {
		this.sendToUser(spectatorId, {
			type: 'GALLERY_POINTS_UPDATE',
			payload: {
				points,
				totalPoints: calculateTotalPoints(points),
			},
		});
	}

	/**
	 * Check and unlock achievements for a spectator
	 */
	public checkAchievements(
		spectatorId: string,
		stats: {
			predictionStreak?: number;
			gamesWithComeback?: number;
			samePlayerBackings?: number;
			lostPickStreak?: number;
			exactPredictions?: number;
			predictedDicee?: boolean;
			gamesWatched?: number;
			roomsVisited?: number;
		},
	): GalleryAchievementId[] {
		const unlocked: GalleryAchievementId[] = [];

		// Oracle: 5 correct predictions in a row
		if (stats.predictionStreak && stats.predictionStreak >= GALLERY_ACHIEVEMENTS.oracle.threshold) {
			unlocked.push('oracle');
		}

		// Drama Magnet: 10 games with comeback
		if (
			stats.gamesWithComeback &&
			stats.gamesWithComeback >= GALLERY_ACHIEVEMENTS.drama_magnet.threshold
		) {
			unlocked.push('drama_magnet');
		}

		// Superfan: Backed same player 5 times
		if (
			stats.samePlayerBackings &&
			stats.samePlayerBackings >= GALLERY_ACHIEVEMENTS.superfan.threshold
		) {
			unlocked.push('superfan');
		}

		// Jinx: Pick lost 5 times in a row
		if (stats.lostPickStreak && stats.lostPickStreak >= GALLERY_ACHIEVEMENTS.jinx.threshold) {
			unlocked.push('jinx');
		}

		// Analyst: Predicted exact score 3 times
		if (
			stats.exactPredictions &&
			stats.exactPredictions >= GALLERY_ACHIEVEMENTS.analyst.threshold
		) {
			unlocked.push('analyst');
		}

		// Called It: Predicted a Dicee correctly
		if (stats.predictedDicee) {
			unlocked.push('called_it');
		}

		// Voyeur: Watched 50 games
		if (stats.gamesWatched && stats.gamesWatched >= GALLERY_ACHIEVEMENTS.voyeur.threshold) {
			unlocked.push('voyeur');
		}

		// Regular: Spectated in 20 rooms
		if (stats.roomsVisited && stats.roomsVisited >= GALLERY_ACHIEVEMENTS.regular.threshold) {
			unlocked.push('regular');
		}

		// Notify of unlocked achievements
		if (unlocked.length > 0) {
			this.sendToUser(spectatorId, {
				type: 'ACHIEVEMENTS_UNLOCKED',
				payload: {
					achievements: unlocked.map((id) => ({
						...GALLERY_ACHIEVEMENTS[id],
						unlocked: true,
						unlockedAt: Date.now(),
					})),
				},
			});
		}

		return unlocked;
	}

	/**
	 * Get all gallery points for the current game
	 */
	public getAllGameGalleryPoints(): Map<string, GalleryPoints> {
		return new Map(this.gameGalleryPoints);
	}

	/**
	 * Clear gallery points for a new game
	 */
	public clearGameGalleryPoints(): void {
		this.gameGalleryPoints.clear();
		this.gamePointCaps.clear();
	}

	/**
	 * Finalize gallery points at game end and prepare for persistence
	 */
	public async finalizeGalleryPoints(
		winnerId: string,
	): Promise<Map<string, { points: GalleryPoints; total: number }>> {
		const results = new Map<string, { points: GalleryPoints; total: number }>();

		// Award backing winner points
		for (const [spectatorId, choice] of this.rootingChoices) {
			if (choice.playerId === winnerId) {
				// Check if underdog (was behind at some point)
				const wasUnderdog = false; // Would need game state to determine
				this.awardBackingWinnerPoints(spectatorId, wasUnderdog);
			}
		}

		// Compile final results
		for (const [spectatorId, points] of this.gameGalleryPoints) {
			results.set(spectatorId, {
				points,
				total: calculateTotalPoints(points),
			});
		}

		// Broadcast final standings
		this.broadcastToSpectators({
			type: 'GALLERY_GAME_SUMMARY',
			payload: {
				results: Array.from(results.entries())
					.map(([id, data]) => ({
						spectatorId: id,
						...data,
					}))
					.sort((a, b) => b.total - a.total),
			},
		});

		return results;
	}
}
