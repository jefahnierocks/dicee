/**
 * GlobalLobby Durable Object
 *
 * Singleton DO that manages the global game lobby:
 * - Global chat (lobby-wide messages)
 * - Presence tracking (who's online)
 * - Room browser (list of available rooms)
 * - Real-time updates via WebSocket
 *
 * Uses WebSocket hibernation for cost efficiency - only charged when
 * actively processing messages, not for idle connections.
 *
 * HIBERNATION-SAFE ARCHITECTURE (2025 best practices):
 * - Tags on acceptWebSocket for user grouping (survives hibernation)
 * - Attachments for per-connection metadata (survives hibernation)
 * - Constructor rebuilds in-memory state from getWebSockets()
 * - Auto ping/pong via setWebSocketAutoResponse (no wake needed)
 * - No manual WebSocket collections that won't survive hibernation
 */

import { DurableObject } from 'cloudflare:workers';
import { generateRoomIdentity } from '@dicee/shared';
import { createInstrumentation, type Instrumentation } from './lib/observability/instrumentation';
import { createRoomDirectory, type RoomDirectory, type RoomInfo } from './lib/room-directory';
import type {
	Env,
	GameHighlight,
	GameRoomRpcStub,
	InviteCancellationRequest,
	InviteDeliveryRequest,
	JoinRequestResponseDelivery,
	RoomStatusUpdate,
} from './types';

// =============================================================================
// Types
// =============================================================================

/** User presence info stored in WebSocket attachment */
interface UserPresence {
	userId: string;
	displayName: string;
	avatarSeed: string;
	connectedAt: number;
	lastSeen: number;
	/** Room code the user is currently in (null if just in lobby) */
	currentRoomCode: string | null;
}

/**
 * Message sent/received through the lobby.
 * UPPERCASE_SNAKE_CASE format (Phase 3 protocol).
 */
interface LobbyMessage {
	type:
		| 'PRESENCE_INIT'
		| 'PRESENCE_JOIN'
		| 'PRESENCE_LEAVE'
		| 'LOBBY_ROOMS_LIST'
		| 'LOBBY_ROOM_UPDATE'
		| 'LOBBY_CHAT_MESSAGE'
		| 'LOBBY_CHAT_HISTORY'
		| 'LOBBY_ONLINE_USERS'
		| 'LOBBY_HIGHLIGHT'
		| 'LOBBY_ERROR'
		| 'INVITE_RECEIVED'
		| 'INVITE_CANCELLED'
		| 'JOIN_REQUEST_SENT'
		| 'JOIN_REQUEST_CANCELLED'
		| 'JOIN_REQUEST_ERROR'
		| 'JOIN_APPROVED'
		| 'JOIN_DECLINED'
		| 'JOIN_REQUEST_EXPIRED';
	payload: unknown;
	timestamp: string;
}

/** Chat message structure */
interface ChatMessage {
	id: string;
	userId: string;
	displayName: string;
	content: string;
	timestamp: number;
}

// RoomInfo is imported from './lib/room-directory'

/**
 * Client command structure.
 * UPPERCASE_SNAKE_CASE format (Phase 3 protocol).
 */
interface LobbyCommand {
	type:
		| 'LOBBY_CHAT'
		| 'GET_ROOMS'
		| 'GET_ONLINE_USERS'
		| 'REQUEST_JOIN'
		| 'CANCEL_JOIN_REQUEST'
		| 'SEND_INVITE'
		| 'CANCEL_INVITE';
	payload?: {
		content?: string;
		roomCode?: string;
		requestId?: string;
	};
}

// =============================================================================
// Constants
// =============================================================================

const MAX_CHAT_MESSAGE_LENGTH = 500;
const MAX_CHAT_HISTORY = 50;
const RATE_LIMIT_MESSAGES_PER_MINUTE = 30;
const MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024;
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** Storage keys for persistent data */
const STORAGE_KEYS = {
	CHAT_HISTORY: 'lobby:chatHistory',
} as const;

// =============================================================================
// GlobalLobby Class
// =============================================================================

export class GlobalLobby extends DurableObject<Env> {
	/** Observability instrumentation */
	private instr: Instrumentation | null = null;

	/** Storage-first room directory (survives hibernation) */
	private roomDirectory: RoomDirectory;

	/** Recent chat messages (in-memory cache, persisted to storage) */
	private chatHistory: ChatMessage[] = [];

	/** Whether chat history has been loaded from storage (for hibernation recovery) */
	private chatHistoryLoaded = false;

	/** Rate limiting: userId -> message timestamps (ephemeral, resets on hibernation) */
	private rateLimits: Map<string, number[]> = new Map();

	// =========================================================================
	// Constructor - Hibernation Recovery
	// =========================================================================

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		// Initialize storage-first room directory (survives hibernation)
		this.roomDirectory = createRoomDirectory(ctx.storage);

		// Set up auto ping/pong without waking the DO
		// This handles keepalive efficiently - no compute charge for pings
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));

		// Note: In-memory state (rateLimits) is lost on hibernation.
		// - roomDirectory: Persisted to storage, survives hibernation
		// - chatHistory: Persisted to storage, loaded lazily on first access
		// - rateLimits: Ephemeral by design - resets on wake (acceptable)
		//
		// User presence is derived from getWebSockets() + tags, which survive hibernation.
	}

	// =========================================================================
	// Main Entry Point
	// =========================================================================

	async fetch(request: Request): Promise<Response> {
		// Initialize instrumentation if not already initialized
		await this.ensureInstrumentation();

		const url = new URL(request.url);

		// WebSocket upgrade for real-time connection
		if (request.headers.get('Upgrade') === 'websocket') {
			return this.handleWebSocketUpgrade(request);
		}

		// REST endpoints
		switch (url.pathname) {
			case '/lobby':
			case '/lobby/':
				return await this.getLobbyInfo();
			case '/lobby/rooms':
				return await this.getPublicRooms();
			case '/lobby/online':
				return this.getOnlineCount();

			// Debug endpoints for observability
			case '/_debug/rooms': {
				const rooms = await this.roomDirectory.getAll();
				return Response.json({
					rooms,
					count: rooms.length,
					timestamp: new Date().toISOString(),
				});
			}
			case '/_debug/connections': {
				const sockets = this.ctx.getWebSockets();
				const connections = sockets.map((ws) => {
					const presence = ws.deserializeAttachment() as UserPresence | null;
					return {
						userId: presence?.userId,
						displayName: presence?.displayName,
						connectedAt: presence?.connectedAt,
						currentRoomCode: presence?.currentRoomCode,
						readyState: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][ws.readyState],
					};
				});
				return Response.json({
					connections,
					count: connections.length,
					timestamp: new Date().toISOString(),
				});
			}
			case '/_debug/storage': {
				await this.ensureInstrumentation();
				const activeRooms = await this.getStorage('lobby:activeRooms');
				const chatHistory = await this.getStorage<ChatMessage[]>('lobby:chatHistory');
				return Response.json({
					'lobby:activeRooms': activeRooms,
					'lobby:chatHistory': Array.isArray(chatHistory) ? chatHistory.length : 0,
					timestamp: new Date().toISOString(),
				});
			}

			default:
				// Handle parameterized debug routes
				if (url.pathname.startsWith('/_debug/rooms/')) {
					return this.handleDebugRoomAction(request, url);
				}
				return new Response('Not Found', { status: 404 });
		}
	}

	/**
	 * Handle admin actions on specific rooms.
	 * DELETE /_debug/rooms/:code - Remove a specific room
	 * DELETE /_debug/rooms/all - Clear all rooms (nuclear option)
	 */
	private async handleDebugRoomAction(request: Request, url: URL): Promise<Response> {
		const pathParts = url.pathname.split('/');
		const roomCode = pathParts[3]?.toUpperCase();

		if (request.method === 'DELETE') {
			if (roomCode === 'ALL') {
				// Nuclear option: clear all rooms
				const rooms = await this.roomDirectory.getAll();
				const count = rooms.length;

				for (const room of rooms) {
					await this.roomDirectory.remove(room.code);
					// Broadcast removal to connected clients
					this.broadcast({
						type: 'LOBBY_ROOM_UPDATE',
						payload: { action: 'closed', code: room.code },
						timestamp: new Date().toISOString(),
					});
				}

				return Response.json({
					success: true,
					message: `Cleared ${count} rooms`,
					timestamp: new Date().toISOString(),
				});
			}

			if (roomCode) {
				// Remove specific room
				const room = await this.roomDirectory.get(roomCode);
				if (!room) {
					return Response.json(
						{ success: false, error: `Room ${roomCode} not found` },
						{ status: 404 },
					);
				}

				await this.roomDirectory.remove(roomCode);

				// Broadcast removal to connected clients
				this.broadcast({
					type: 'LOBBY_ROOM_UPDATE',
					payload: { action: 'closed', code: roomCode },
					timestamp: new Date().toISOString(),
				});

				return Response.json({
					success: true,
					message: `Room ${roomCode} removed`,
					room,
					timestamp: new Date().toISOString(),
				});
			}
		}

		return new Response('Method not allowed', { status: 405 });
	}

	// =========================================================================
	// WebSocket Connection
	// =========================================================================

	private async handleWebSocketUpgrade(request: Request): Promise<Response> {
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// The Worker is service-binding-only in production. Identity comes only
		// from the authenticated web proxy, never from client-controlled URLs.
		const userId = request.headers.get('X-User-Id') || crypto.randomUUID();
		const displayName = request.headers.get('X-Display-Name') || `Guest-${userId.slice(0, 4)}`;
		const avatarSeed = request.headers.get('X-Avatar-Seed') || userId;

		// Accept with hibernation support and tags for efficient querying
		// Tags survive hibernation and allow: getWebSockets('user:xyz')
		this.ctx.acceptWebSocket(server, [`user:${userId}`]);

		// Store session info as WebSocket attachment (survives hibernation)
		const presence: UserPresence = {
			userId,
			displayName,
			avatarSeed,
			connectedAt: Date.now(),
			lastSeen: Date.now(),
			currentRoomCode: null, // Will be updated when user enters a room
		};
		server.serializeAttachment(presence);

		// Check if this is the user's first connection (for join broadcast)
		// Use tags to query existing connections for this user
		const existingConnections = this.ctx.getWebSockets(`user:${userId}`);
		// Note: The new connection is already accepted, so it's included in the count
		const isNewUser = existingConnections.length === 1;

		// Initialize instrumentation
		await this.ensureInstrumentation();

		// Log connection
		const connectionId = `conn-${userId}-${Date.now()}`;
		this.instr?.clientConnect(userId, 'pending', connectionId);

		// Send initial state to new connection (async for storage loading)
		await this.sendInitialState(server);

		// Only broadcast join if this is the user's first connection
		// (prevents "X joined" spam when same user opens multiple tabs)
		if (isNewUser) {
			this.broadcast(
				{
					type: 'PRESENCE_JOIN',
					payload: {
						userId,
						displayName,
						avatarSeed,
						onlineCount: this.getUniqueUserCount(),
					},
					timestamp: new Date().toISOString(),
				},
				server,
			);

			// Broadcast updated online users list to ALL clients
			// This enables features like the invite modal showing current online users
			this.broadcastOnlineUsers();
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	private async sendInitialState(ws: WebSocket): Promise<void> {
		// Send current online count (unique users, not connections)
		// Derived from WebSocket tags - hibernation safe
		ws.send(
			JSON.stringify({
				type: 'PRESENCE_INIT',
				payload: {
					onlineCount: this.getUniqueUserCount(),
				},
				timestamp: new Date().toISOString(),
			}),
		);

		// Send recent chat history (load from storage if needed for hibernation recovery)
		const chatHistory = await this.loadChatHistory();
		if (chatHistory.length > 0) {
			ws.send(
				JSON.stringify({
					type: 'LOBBY_CHAT_HISTORY',
					payload: {
						messages: chatHistory.slice(-20),
					},
					timestamp: new Date().toISOString(),
				}),
			);
		}

		// Send current rooms list (storage-first: survives hibernation)
		const publicRooms = await this.roomDirectory.getPublic();
		if (publicRooms.length > 0) {
			ws.send(
				JSON.stringify({
					type: 'LOBBY_ROOMS_LIST',
					payload: { rooms: publicRooms },
					timestamp: new Date().toISOString(),
				}),
			);
		}
	}

	// =========================================================================
	// Hibernation API Handlers
	// =========================================================================

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		await this.ensureInstrumentation();
		if (typeof message !== 'string') {
			ws.close(1003, 'Binary messages not supported');
			return;
		}
		if (new TextEncoder().encode(message).byteLength > MAX_WEBSOCKET_MESSAGE_BYTES) {
			ws.close(1009, 'Message too large');
			return;
		}

		const attachment = ws.deserializeAttachment() as UserPresence;

		// Update last seen
		attachment.lastSeen = Date.now();
		ws.serializeAttachment(attachment);

		try {
			const parsed = JSON.parse(message) as LobbyCommand & { correlationId?: unknown };
			if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
				throw new Error('Invalid lobby command');
			}
			const { correlationId, ...data } = parsed;

			// Set correlation ID for this request (propagates to all events in this request)
			if (typeof correlationId === 'string' && SAFE_CORRELATION_ID.test(correlationId)) {
				this.instr?.setCorrelationId(correlationId);
			}

			try {
				// Extract from payload (UPPERCASE protocol)
				const content = typeof data.payload?.content === 'string' ? data.payload.content : '';
				const roomCode =
					typeof data.payload?.roomCode === 'string' ? data.payload.roomCode : undefined;
				const requestId =
					typeof data.payload?.requestId === 'string' ? data.payload.requestId : undefined;

				switch (data.type) {
					case 'LOBBY_CHAT':
						await this.handleChat(ws, attachment, content);
						break;
					case 'GET_ROOMS':
						await this.sendRoomsList(ws);
						break;
					case 'GET_ONLINE_USERS':
						this.sendOnlineUsers(ws);
						break;
					case 'REQUEST_JOIN':
						if (roomCode) {
							await this.handleRequestJoin(ws, attachment, roomCode);
						} else {
							ws.send(
								JSON.stringify({
									type: 'JOIN_REQUEST_ERROR',
									payload: { message: 'roomCode is required for join requests' },
									timestamp: new Date().toISOString(),
								}),
							);
						}
						break;
					case 'CANCEL_JOIN_REQUEST':
						if (requestId && roomCode) {
							await this.handleCancelJoinRequest(ws, attachment, requestId, roomCode);
						} else {
							ws.send(
								JSON.stringify({
									type: 'LOBBY_ERROR',
									payload: { message: 'requestId and roomCode are required' },
									timestamp: new Date().toISOString(),
								}),
							);
						}
						break;

					default:
						this.instr?.errorHandlerFailed(
							`unknownCommand.${data.type}`,
							new Error(`Unknown command type: ${data.type}`),
						);
				}
			} catch (error) {
				// Log handler errors with correlation ID preserved
				this.instr?.errorHandlerFailed(`handleMessage.${data.type}`, error);
				throw error;
			} finally {
				// Clear correlation ID after request handling (ensures clean state for next request)
				if (typeof correlationId === 'string' && SAFE_CORRELATION_ID.test(correlationId)) {
					this.instr?.clearCorrelationId();
				}
			}
		} catch (e) {
			this.instr?.errorHandlerFailed('messageParse', e);
			ws.send(
				JSON.stringify({
					type: 'LOBBY_ERROR',
					payload: { message: 'Invalid message format', code: 'INVALID_FORMAT' },
					timestamp: new Date().toISOString(),
				}),
			);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
		await this.ensureInstrumentation();

		const attachment = ws.deserializeAttachment() as UserPresence | null;

		if (attachment) {
			const { userId, displayName } = attachment;

			// Check if user has other connections still open
			// Use tags for hibernation-safe querying
			// Note: The closing connection is still in the list until this handler completes
			const remainingConnections = this.ctx.getWebSockets(`user:${userId}`);
			const isLastConnection = remainingConnections.length <= 1;

			if (isLastConnection) {
				// User fully disconnected - clean up ephemeral state
				this.rateLimits.delete(userId);

				// Broadcast leave only when user's last connection closes
				this.broadcast(
					{
						type: 'PRESENCE_LEAVE',
						payload: {
							userId,
							displayName,
							// Subtract 1 because closing connection is still counted
							onlineCount: this.getUniqueUserCount() - 1,
						},
						timestamp: new Date().toISOString(),
					},
					ws,
				);

				// Broadcast updated online users list to ALL clients
				// This ensures features like invite modal stay current
				this.broadcastOnlineUsers();
			}
			// If user has other tabs open, no presence change - silent close
		}

		// Log disconnect
		if (attachment) {
			const connectionId = `conn-${attachment.userId}-${attachment.connectedAt}`;
			this.instr?.clientDisconnect(attachment.userId, code, reason, false, connectionId);
		}
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		await this.ensureInstrumentation();
		this.instr?.errorHandlerFailed('webSocketError', error);
		ws.close(1011, 'Internal error');
	}

	// =========================================================================
	// Chat Handling
	// =========================================================================

	/**
	 * Load chat history from storage (lazy loading for hibernation recovery).
	 * Uses storage-first pattern to ensure messages persist across hibernation.
	 */
	private async loadChatHistory(): Promise<ChatMessage[]> {
		if (!this.chatHistoryLoaded) {
			const stored = await this.getStorage<ChatMessage[]>(STORAGE_KEYS.CHAT_HISTORY);
			this.chatHistory = stored ?? [];
			this.chatHistoryLoaded = true;
		}
		return this.chatHistory;
	}

	/**
	 * Save chat message using storage-first pattern.
	 * Storage → Memory → Broadcast (ensures persistence before any client sees it)
	 */
	private async saveChatMessage(message: ChatMessage): Promise<void> {
		// Load existing history from storage (handles hibernation recovery)
		const history = await this.loadChatHistory();

		// Add new message
		history.push(message);

		// Trim to max history size
		if (history.length > MAX_CHAT_HISTORY) {
			this.chatHistory = history.slice(-MAX_CHAT_HISTORY);
		} else {
			this.chatHistory = history;
		}

		// Persist to storage FIRST (storage-first pattern)
		await this.putStorage(STORAGE_KEYS.CHAT_HISTORY, this.chatHistory);
	}

	private async handleChat(ws: WebSocket, user: UserPresence, content: string): Promise<void> {
		// Validate content
		if (!content || content.trim().length === 0) {
			return;
		}

		if (content.length > MAX_CHAT_MESSAGE_LENGTH) {
			ws.send(
				JSON.stringify({
					type: 'LOBBY_ERROR',
					payload: {
						message: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH} chars)`,
						code: 'MESSAGE_TOO_LONG',
					},
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		// Check rate limit
		if (!this.checkRateLimit(user.userId)) {
			ws.send(
				JSON.stringify({
					type: 'LOBBY_ERROR',
					payload: { message: 'Rate limit exceeded. Please slow down.', code: 'RATE_LIMITED' },
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		const chatMessage: ChatMessage = {
			id: crypto.randomUUID(),
			userId: user.userId,
			displayName: user.displayName,
			content: content.trim(),
			timestamp: Date.now(),
		};

		// Storage-first: Save to storage before broadcasting
		await this.saveChatMessage(chatMessage);

		// Broadcast to all
		this.broadcast({
			type: 'LOBBY_CHAT_MESSAGE',
			payload: chatMessage,
			timestamp: new Date().toISOString(),
		});
	}

	private checkRateLimit(userId: string): boolean {
		const now = Date.now();
		const windowMs = 60000; // 1 minute

		let timestamps = this.rateLimits.get(userId) || [];

		// Remove old timestamps
		timestamps = timestamps.filter((t) => now - t < windowMs);

		if (timestamps.length >= RATE_LIMIT_MESSAGES_PER_MINUTE) {
			return false;
		}

		timestamps.push(now);
		this.rateLimits.set(userId, timestamps);
		return true;
	}

	// =========================================================================
	// Room Management
	// =========================================================================

	private async sendRoomsList(ws: WebSocket): Promise<void> {
		// Get all public rooms (both waiting and playing) - storage-first
		const publicRooms = (await this.roomDirectory.getPublic()).sort((a, b) => {
			// Playing games first, then waiting, then by activity
			if (a.status !== b.status) {
				if (a.status === 'playing') return -1;
				if (b.status === 'playing') return 1;
			}
			// Then by spectator count (more popular first)
			if (a.spectatorCount !== b.spectatorCount) {
				return b.spectatorCount - a.spectatorCount;
			}
			// Then by most recent
			return b.updatedAt - a.updatedAt;
		});

		ws.send(
			JSON.stringify({
				type: 'LOBBY_ROOMS_LIST',
				payload: { rooms: publicRooms },
				timestamp: new Date().toISOString(),
			}),
		);
	}

	/**
	 * Send list of online users to requesting client.
	 * Returns deduplicated list with display info.
	 */
	private sendOnlineUsers(ws: WebSocket): void {
		const rawUsers = this.getOnlineUsers();
		const users = rawUsers.map((u) => ({
			userId: u.userId,
			displayName: u.displayName,
			avatarSeed: u.avatarSeed,
			currentRoomCode: u.currentRoomCode,
		}));

		ws.send(
			JSON.stringify({
				type: 'LOBBY_ONLINE_USERS',
				payload: { users },
				timestamp: new Date().toISOString(),
			}),
		);
	}

	/**
	 * Broadcast online users list to ALL connected clients.
	 * Called after presence changes (join/leave/room status) so all clients stay up-to-date.
	 * This enables features like the invite modal showing current online users.
	 */
	private broadcastOnlineUsers(): void {
		const rawUsers = this.getOnlineUsers();
		const users = rawUsers.map((u) => ({
			userId: u.userId,
			displayName: u.displayName,
			avatarSeed: u.avatarSeed,
			currentRoomCode: u.currentRoomCode,
		}));

		this.broadcast({
			type: 'LOBBY_ONLINE_USERS',
			payload: { users },
			timestamp: new Date().toISOString(),
		});

		// Broadcast is logged via broadcast method
	}

	// =========================================================================
	// REST Endpoints
	// =========================================================================

	private async getLobbyInfo(): Promise<Response> {
		const allRooms = await this.roomDirectory.getAll();
		const publicRooms = await this.roomDirectory.getPublic();
		return Response.json({
			service: 'Game Lobby',
			onlineCount: this.getUniqueUserCount(),
			connectionCount: this.ctx.getWebSockets().length,
			roomCount: allRooms.length,
			publicRoomCount: publicRooms.length,
		});
	}

	private async getPublicRooms(): Promise<Response> {
		const rooms = (await this.roomDirectory.getPublic()).sort((a, b) => b.createdAt - a.createdAt);

		return Response.json({ rooms });
	}

	private getOnlineCount(): Response {
		return Response.json({
			count: this.getUniqueUserCount(),
			connections: this.ctx.getWebSockets().length,
		});
	}

	// =========================================================================
	// User Presence Helpers (Hibernation-Safe)
	// =========================================================================

	/**
	 * Get count of unique online users (not connections).
	 * A user with 3 tabs open counts as 1 user.
	 *
	 * HIBERNATION-SAFE: Derives count from WebSocket attachments,
	 * not from in-memory Maps that would be lost on wake.
	 */
	private getUniqueUserCount(): number {
		const seenUsers = new Set<string>();
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = ws.deserializeAttachment() as UserPresence | null;
			if (attachment?.userId) {
				seenUsers.add(attachment.userId);
			}
		}
		return seenUsers.size;
	}

	/**
	 * Get list of unique online users with their presence info.
	 * Deduplicates across multiple tabs/connections per user.
	 */
	private getOnlineUsers(): UserPresence[] {
		const seenUsers = new Map<string, UserPresence>();
		for (const ws of this.ctx.getWebSockets()) {
			const attachment = ws.deserializeAttachment() as UserPresence | null;
			if (attachment?.userId && !seenUsers.has(attachment.userId)) {
				seenUsers.set(attachment.userId, attachment);
			}
		}
		return Array.from(seenUsers.values());
	}

	// =========================================================================
	// User Room Status (RPC for GameRoom)
	// =========================================================================

	/**
	 * Update user's room status.
	 * Updates the user's currentRoomCode in their WebSocket attachment and
	 * broadcasts updated online users list to all clients.
	 *
	 * Called by GameRoom when a user enters or leaves a room.
	 *
	 * @param userId - The user whose room status changed
	 * @param roomCode - The room code
	 * @param action - 'entered' when joining a room, 'left' when leaving
	 */
	updateUserRoomStatus(userId: string, roomCode: string, action: 'entered' | 'left'): void {
		// Find all WebSocket connections for this user
		const userConnections = this.ctx.getWebSockets(`user:${userId}`);

		if (userConnections.length === 0) {
			// User not connected - no action needed (not an error)
			return;
		}

		// Update the user's attachment with their current room code
		for (const ws of userConnections) {
			const attachment = ws.deserializeAttachment() as UserPresence | null;
			if (attachment) {
				ws.serializeAttachment({
					...attachment,
					currentRoomCode: action === 'entered' ? roomCode : null,
				});
			}
		}

		// Broadcast updated online users list to all clients
		this.broadcastOnlineUsers();

		// Room status update logged via broadcast method
	}

	// =========================================================================
	// RPC Methods (called by GameRoom DOs)
	// =========================================================================

	/**
	 * Update room status in the directory.
	 * Called by GameRoom on: player join/leave, spectator join/leave,
	 * game start, round change, game end.
	 */
	async updateRoomStatus(update: RoomStatusUpdate): Promise<void> {
		// Get existing room to preserve createdAt timestamp and identity
		const existingRoom = await this.roomDirectory.get(update.roomCode);

		// Lazy fallback: use provided identity, existing identity, or generate new
		const identity =
			update.identity ?? existingRoom?.identity ?? generateRoomIdentity(update.roomCode);

		const roomInfo: RoomInfo = {
			code: update.roomCode,
			game: update.game,
			hostName: update.hostName,
			hostId: update.hostId,
			playerCount: update.playerCount,
			spectatorCount: update.spectatorCount,
			maxPlayers: update.maxPlayers,
			isPublic: update.isPublic,
			allowSpectators: update.allowSpectators,
			status: update.status,
			roundNumber: update.roundNumber,
			totalRounds: update.totalRounds,
			players: update.players,
			createdAt: existingRoom?.createdAt ?? update.updatedAt,
			updatedAt: update.updatedAt,
			pausedAt: update.pausedAt,
			identity,
		};

		// Handle finished rooms
		if (update.status === 'finished') {
			// Keep finished games briefly for "recent results"
			this.scheduleRoomRemoval(update.roomCode, 60_000);
		}

		// Storage-first: persist BEFORE broadcast
		await this.roomDirectory.upsert(roomInfo);

		// Broadcast to lobby clients
		this.broadcast({
			type: 'LOBBY_ROOM_UPDATE',
			payload: { action: 'updated', room: roomInfo },
			timestamp: new Date().toISOString(),
		});

		// Room status update logged via broadcast method
	}

	/**
	 * Send a game highlight to lobby clients.
	 * Used for ticker events like Dicees, high scores, etc.
	 */
	sendHighlight(highlight: GameHighlight): void {
		this.broadcast({
			type: 'LOBBY_HIGHLIGHT',
			payload: highlight,
			timestamp: new Date().toISOString(),
		});

		// Highlight broadcast logged via broadcast method
	}

	/**
	 * Remove a room from the directory.
	 * Called when a room closes or is abandoned.
	 */
	async removeRoom(roomCode: string): Promise<void> {
		// Storage-first: persist BEFORE broadcast
		await this.roomDirectory.remove(roomCode);

		this.broadcast({
			type: 'LOBBY_ROOM_UPDATE',
			payload: { action: 'closed', code: roomCode },
			timestamp: new Date().toISOString(),
		});

		// Room removal logged via broadcast method
	}

	/**
	 * Schedule a room to be removed after a delay.
	 * Used for finished games that should stay visible briefly.
	 */
	private scheduleRoomRemoval(roomCode: string, delayMs: number): void {
		// Note: Using setTimeout for simplicity. Could use DO alarms for persistence.
		setTimeout(async () => {
			const room = await this.roomDirectory.get(roomCode);
			if (room?.status === 'finished') {
				await this.removeRoom(roomCode);
			}
		}, delayMs);
	}

	// =========================================================================
	// Invite System RPC Methods
	// =========================================================================

	/**
	 * Check if a user is currently online in the lobby.
	 * Called by GameRoom to validate invite targets.
	 */
	isUserOnline(userId: string): boolean {
		const connections = this.ctx.getWebSockets(`user:${userId}`);
		return connections.length > 0;
	}

	/**
	 * Get online user info for display.
	 * Returns null if user is not online.
	 */
	getOnlineUserInfo(userId: string): { displayName: string; avatarSeed: string } | null {
		const connections = this.ctx.getWebSockets(`user:${userId}`);
		if (connections.length === 0) {
			return null;
		}

		// Get info from first connection's attachment
		const attachment = connections[0].deserializeAttachment() as UserPresence | null;
		if (!attachment) {
			return null;
		}

		return {
			displayName: attachment.displayName,
			avatarSeed: attachment.avatarSeed,
		};
	}

	/**
	 * Deliver a game invite to a specific online user.
	 * Called by GameRoom when host sends an invite.
	 *
	 * @returns true if the invite was delivered, false if user is offline
	 */
	deliverInvite(request: InviteDeliveryRequest): boolean {
		const connections = this.ctx.getWebSockets(`user:${request.targetUserId}`);

		if (connections.length === 0) {
			// User offline - no action needed (not an error)
			return false;
		}

		// Build INVITE_RECEIVED event payload
		const inviteEvent = {
			type: 'INVITE_RECEIVED',
			payload: {
				inviteId: request.inviteId,
				roomCode: request.roomCode,
				hostUserId: request.hostUserId,
				hostDisplayName: request.hostDisplayName,
				hostAvatarSeed: request.hostAvatarSeed,
				game: request.game,
				playerCount: request.playerCount,
				maxPlayers: request.maxPlayers,
				expiresAt: request.expiresAt,
			},
			timestamp: new Date().toISOString(),
		};

		// Send to all of user's connections (they might have multiple tabs)
		const payload = JSON.stringify(inviteEvent);
		let delivered = false;

		for (const ws of connections) {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(payload);
					delivered = true;
				} catch (e) {
					this.instr?.errorBroadcastFailed('INVITE_RECEIVED', request.targetUserId, e);
				}
			}
		}

		if (delivered) {
			// Invite delivery logged via broadcast method
		}

		return delivered;
	}

	/**
	 * Cancel a pending invite for a user.
	 * Called by GameRoom when invite is cancelled, expired, or room becomes full.
	 */
	cancelInvite(request: InviteCancellationRequest): void {
		const connections = this.ctx.getWebSockets(`user:${request.targetUserId}`);

		if (connections.length === 0) {
			// User offline - no action needed (not an error)
			return;
		}

		// Build INVITE_CANCELLED event payload
		const cancelEvent = {
			type: 'INVITE_CANCELLED',
			payload: {
				inviteId: request.inviteId,
				roomCode: request.roomCode,
				reason: request.reason,
			},
			timestamp: new Date().toISOString(),
		};

		// Send to all of user's connections
		const payload = JSON.stringify(cancelEvent);

		for (const ws of connections) {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(payload);
				} catch (e) {
					this.instr?.errorBroadcastFailed('INVITE_CANCELLED', request.targetUserId, e);
				}
			}
		}

		// Invite cancellation logged via broadcast method
	}

	// =========================================================================
	// Join Request WebSocket Handlers
	// =========================================================================

	/**
	 * Handle a join request from a lobby user.
	 * Routes the request to the target GameRoom via RPC.
	 */
	private async handleRequestJoin(
		ws: WebSocket,
		user: UserPresence,
		roomCode: string,
	): Promise<void> {
		// Join request processing logged via RPC calls

		// Validate room exists in directory (storage-first)
		const room = await this.roomDirectory.get(roomCode);
		if (!room) {
			ws.send(
				JSON.stringify({
					type: 'JOIN_REQUEST_ERROR',
					payload: { code: 'ROOM_NOT_FOUND', message: 'Room not found' },
					timestamp: new Date().toISOString(),
				}),
			);
			return;
		}

		// Get the GameRoom stub (cast for typed RPC)
		const roomId = this.env.GAME_ROOM.idFromName(roomCode);
		const roomStub = this.env.GAME_ROOM.get(roomId) as unknown as GameRoomRpcStub;

		try {
			// Call GameRoom's handleJoinRequest RPC
			const result = await roomStub.handleJoinRequest({
				requesterId: user.userId,
				requesterDisplayName: user.displayName,
				requesterAvatarSeed: user.avatarSeed,
			});

			if (result.success && result.request) {
				// Send confirmation to requester
				ws.send(
					JSON.stringify({
						type: 'JOIN_REQUEST_SENT',
						payload: {
							requestId: result.request.id,
							roomCode,
							expiresAt: result.request.expiresAt,
						},
						timestamp: new Date().toISOString(),
					}),
				);
				// Join request routed successfully (logged via RPC)
			} else {
				// Send error to requester
				ws.send(
					JSON.stringify({
						type: 'JOIN_REQUEST_ERROR',
						payload: {
							code: result.errorCode ?? 'UNKNOWN_ERROR',
							message: result.errorMessage ?? 'Failed to create join request',
						},
						timestamp: new Date().toISOString(),
					}),
				);
				// Join request failed (logged via RPC)
			}
		} catch (error) {
			await this.ensureInstrumentation();
			this.instr?.errorHandlerFailed('handleRequestJoin', error);

			ws.send(
				JSON.stringify({
					type: 'JOIN_REQUEST_ERROR',
					payload: { code: 'RPC_ERROR', message: 'Failed to contact game room' },
					timestamp: new Date().toISOString(),
				}),
			);
		}
	}

	/**
	 * Handle a join request cancellation from the requester.
	 * Routes the cancellation to the target GameRoom via RPC.
	 */
	private async handleCancelJoinRequest(
		ws: WebSocket,
		user: UserPresence,
		requestId: string,
		roomCode: string,
	): Promise<void> {
		// Join request cancellation processing logged via RPC calls

		// Get the GameRoom stub (cast for typed RPC)
		const roomId = this.env.GAME_ROOM.idFromName(roomCode);
		const roomStub = this.env.GAME_ROOM.get(roomId) as unknown as GameRoomRpcStub;

		try {
			// Call GameRoom's cancelJoinRequest RPC
			const result = await roomStub.cancelJoinRequest(requestId, user.userId);

			if (result.success) {
				ws.send(
					JSON.stringify({
						type: 'JOIN_REQUEST_CANCELLED',
						payload: { requestId },
						timestamp: new Date().toISOString(),
					}),
				);
				// Join request cancelled successfully (logged via RPC)
			} else {
				ws.send(
					JSON.stringify({
						type: 'LOBBY_ERROR',
						payload: {
							code: result.errorCode ?? 'CANCEL_FAILED',
							message: result.errorMessage ?? 'Failed to cancel request',
						},
						timestamp: new Date().toISOString(),
					}),
				);
			}
		} catch (error) {
			await this.ensureInstrumentation();
			this.instr?.errorHandlerFailed('handleCancelJoinRequest', error);

			ws.send(
				JSON.stringify({
					type: 'LOBBY_ERROR',
					payload: { code: 'RPC_ERROR', message: 'Failed to contact game room' },
					timestamp: new Date().toISOString(),
				}),
			);
		}
	}

	// =========================================================================
	// Join Request System RPC Methods
	// =========================================================================

	/**
	 * Deliver a join request response to a specific user.
	 * Called by GameRoom when host approves/declines or request expires.
	 *
	 * @returns true if delivered successfully, false if user is offline
	 */
	deliverJoinRequestResponse(response: JoinRequestResponseDelivery): boolean {
		const connections = this.ctx.getWebSockets(`user:${response.requesterId}`);

		if (connections.length === 0) {
			// User offline - no action needed (not an error)
			return false;
		}

		// Determine event type based on status (UPPERCASE format)
		const eventType =
			response.status === 'approved'
				? 'JOIN_APPROVED'
				: response.status === 'declined'
					? 'JOIN_DECLINED'
					: 'JOIN_REQUEST_EXPIRED';

		// Build the event payload
		const joinResponseEvent = {
			type: eventType,
			payload: {
				requestId: response.requestId,
				roomCode: response.roomCode,
				...(response.reason && { reason: response.reason }),
			},
			timestamp: new Date().toISOString(),
		};

		// Send to all of user's connections
		const payload = JSON.stringify(joinResponseEvent);
		let delivered = false;

		for (const ws of connections) {
			if (ws.readyState === WebSocket.OPEN) {
				try {
					ws.send(payload);
					delivered = true;
				} catch (e) {
					this.instr?.errorBroadcastFailed(eventType, response.requesterId, e);
				}
			}
		}

		if (delivered) {
			// Join request response delivered (logged via broadcast method)
		}

		return delivered;
	}

	// =========================================================================
	// Instrumentation Helpers
	// =========================================================================

	/**
	 * Ensure instrumentation is initialized (lazy initialization)
	 * Called on first access after hibernation wake
	 */
	private async ensureInstrumentation(): Promise<void> {
		if (this.instr) return;

		// Initialize instrumentation (GlobalLobby is singleton, no room code)
		this.instr = createInstrumentation('GlobalLobby');

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

	// =========================================================================
	// Helpers
	// =========================================================================

	private broadcast(message: LobbyMessage, exclude?: WebSocket): void {
		const msgType = message.type;
		const allSockets = this.ctx.getWebSockets();
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
					const attachment = ws.deserializeAttachment() as UserPresence | null;
					this.instr?.errorBroadcastFailed(msgType, attachment?.userId ?? 'unknown', error);
				}
			}
		}

		// Log broadcast completion
		this.instr?.broadcastSent(msgType, sentCount, allSockets.length);
	}
}
