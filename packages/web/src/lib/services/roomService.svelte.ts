/**
 * Room Service
 *
 * Manages WebSocket connection to multiplayer server (Cloudflare Durable Objects).
 * Uses same-origin WebSocket proxy (/ws/room/[code]) for zero-CORS connections.
 * Handles room creation, joining, game commands, and chat.
 */

import ReconnectingWebSocket from 'reconnecting-websocket';
import { browser } from '$app/environment';
import type {
	ChatCommand_Union,
	Command,
	GameRoom,
	QuickChatKey,
	ReactionEmoji,
	RoomCode,
	ServerEvent,
} from '$lib/types/multiplayer';
import { createServiceLogger } from '$lib/utils/logger';

const log = createServiceLogger('RoomService');

// =============================================================================
// Types
// =============================================================================

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface RoomServiceState {
	/** Current connection status */
	status: ConnectionStatus;
	/** Current room data */
	room: GameRoom | null;
	/** Last error message */
	error: string | null;
	/** Room code we're connected to */
	roomCode: RoomCode | null;
}

export type ServerEventHandler = (event: ServerEvent) => void;

// =============================================================================
// Room Service Class
// =============================================================================

/**
 * Room Service - manages connection to Cloudflare Durable Objects multiplayer server
 */
class RoomService {
	/** WebSocket instance */
	private socket: ReconnectingWebSocket | null = null;

	/** Event handlers */
	private eventHandlers: Set<ServerEventHandler> = new Set();

	/** Connection status listeners */
	private statusListeners: Set<(status: ConnectionStatus) => void> = new Set();

	/** Current state - using $state for Svelte 5 reactivity */
	private _status = $state<ConnectionStatus>('disconnected');
	private _room = $state<GameRoom | null>(null);
	private _error = $state<string | null>(null);
	private _roomCode = $state<RoomCode | null>(null);

	// =========================================================================
	// Public Getters
	// =========================================================================

	get status(): ConnectionStatus {
		return this._status;
	}

	get room(): GameRoom | null {
		return this._room;
	}

	get error(): string | null {
		return this._error;
	}

	get roomCode(): RoomCode | null {
		return this._roomCode;
	}

	get state(): RoomServiceState {
		return {
			status: this._status,
			room: this._room,
			error: this._error,
			roomCode: this._roomCode,
		};
	}

	get isConnected(): boolean {
		return this._status === 'connected';
	}

	// =========================================================================
	// Connection Management
	// =========================================================================

	/**
	 * Connect to a room
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
	 * Connect to Durable Objects multiplayer server via same-origin WebSocket proxy
	 *
	 * Uses /ws/room/[code] endpoint which proxies to the GameRoom DO via Service Binding.
	 * Authentication is handled server-side from the same-origin session cookie.
	 */
	private connectToServer(roomCode: RoomCode): void {
		if (!browser) return;

		log.debug('Connecting to room', { roomCode });

		// Use same-origin WebSocket proxy for zero-CORS connection
		const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = `${protocol}//${location.host}/ws/room/${roomCode.toUpperCase()}`;

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
		this._room = null;
		this._roomCode = null;
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

	/**
	 * Create a new room and connect to it
	 *
	 * @param accessToken - Supabase access token
	 * @returns Promise that resolves with room code when created
	 */
	async createRoom(accessToken: string): Promise<RoomCode> {
		// Generate room code client-side
		const { generateRoomCode } = await import('$lib/types/multiplayer.schema');
		const roomCode = generateRoomCode();

		// Connect to the room (first player becomes host)
		await this.connect(roomCode, accessToken);

		// Wait for connection confirmation
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.disconnect();
				reject(new Error('Room creation timed out'));
			}, 10000);

			const handler = (event: ServerEvent) => {
				// Handle both PartyKit format (room.state) and DO format (CONNECTED)
				// Use string comparison to handle both event type systems
				const eventType = event.type as string;
				if (eventType === 'room.state' || eventType === 'CONNECTED') {
					clearTimeout(timeout);
					this.removeEventHandler(handler);
					resolve(roomCode);
				} else if (eventType === 'error' || eventType === 'ERROR') {
					clearTimeout(timeout);
					this.removeEventHandler(handler);
					const errorMsg =
						'message' in event ? (event as { message: string }).message : 'Unknown error';
					reject(new Error(errorMsg));
				}
			};

			this.addEventHandler(handler);
		});
	}

	// =========================================================================
	// Command Sending
	// =========================================================================

	/**
	 * Send a command to the server
	 */
	send(command: Command): void {
		if (!this.socket || this._status !== 'connected') {
			throw new Error('Not connected to room');
		}
		this.socket.send(JSON.stringify(command));
	}

	/**
	 * Send start game command (host only)
	 */
	sendStartGame(): void {
		this.send({ type: 'START_GAME' });
	}

	/**
	 * Send quick play start command - creates AI players and starts game immediately.
	 * Human always goes first, skips waiting room entirely.
	 */
	sendQuickPlayStart(aiProfiles: string[]): void {
		this.send({ type: 'QUICK_PLAY_START', payload: { aiProfiles } });
	}

	/**
	 * Send roll dice command
	 */
	sendRollDice(kept: [boolean, boolean, boolean, boolean, boolean]): void {
		this.send({ type: 'DICE_ROLL', payload: { kept } });
	}

	/**
	 * Send keep dice command
	 */
	sendKeepDice(indices: number[]): void {
		this.send({ type: 'DICE_KEEP', payload: { indices } });
	}

	/**
	 * Send score category command
	 */
	sendScoreCategory(category: string): void {
		this.send({ type: 'CATEGORY_SCORE', payload: { category } });
	}

	/**
	 * Send rematch command (host only)
	 */
	sendRematch(): void {
		this.send({ type: 'REMATCH' });
	}

	/**
	 * Send add AI player command (host only, during waiting)
	 */
	sendAddAIPlayer(profileId: string): void {
		this.send({ type: 'ADD_AI_PLAYER', payload: { profileId } });
	}

	/**
	 * Send remove AI player command (host only, during waiting)
	 */
	sendRemoveAIPlayer(playerId: string): void {
		this.send({ type: 'REMOVE_AI_PLAYER', payload: { playerId } });
	}

	// =========================================================================
	// Invite Commands
	// =========================================================================

	/**
	 * Send invite to online user (host only)
	 */
	sendInvite(targetUserId: string): void {
		this.send({ type: 'SEND_INVITE', payload: { targetUserId } });
	}

	/**
	 * Cancel a pending invite (host only)
	 */
	cancelInvite(targetUserId: string): void {
		this.send({ type: 'CANCEL_INVITE', payload: { targetUserId } });
	}

	// =========================================================================
	// Chat Commands
	// =========================================================================

	/**
	 * Send a chat command (type-safe internal helper)
	 */
	private sendChat(command: ChatCommand_Union): void {
		if (!this.socket || this._status !== 'connected') {
			throw new Error('Not connected to room');
		}
		this.socket.send(JSON.stringify(command));
	}

	/**
	 * Send a text chat message
	 */
	sendChatMessage(content: string): void {
		this.sendChat({ type: 'CHAT', payload: { content } });
	}

	/**
	 * Send a quick chat preset
	 */
	sendQuickChat(key: QuickChatKey): void {
		this.sendChat({ type: 'QUICK_CHAT', payload: { key } });
	}

	/**
	 * Send a reaction to a message
	 */
	sendReaction(messageId: string, emoji: ReactionEmoji, action: 'add' | 'remove'): void {
		this.sendChat({ type: 'REACTION', payload: { messageId, emoji, action } });
	}

	/**
	 * Send typing start indicator
	 */
	sendTypingStart(): void {
		this.sendChat({ type: 'TYPING_START' });
	}

	/**
	 * Send typing stop indicator
	 */
	sendTypingStop(): void {
		this.sendChat({ type: 'TYPING_STOP' });
	}

	/**
	 * Send a shout message (ephemeral broadcast with speech bubble)
	 */
	sendShout(content: string): void {
		this.sendChat({ type: 'SHOUT', payload: { content } });
	}

	// =========================================================================
	// Event Handling
	// =========================================================================

	/**
	 * Add a server event handler
	 */
	addEventHandler(handler: ServerEventHandler): void {
		this.eventHandlers.add(handler);
	}

	/**
	 * Remove a server event handler
	 */
	removeEventHandler(handler: ServerEventHandler): void {
		this.eventHandlers.delete(handler);
	}

	/**
	 * Add a connection status listener
	 */
	addStatusListener(listener: (status: ConnectionStatus) => void): void {
		this.statusListeners.add(listener);
	}

	/**
	 * Remove a connection status listener
	 */
	removeStatusListener(listener: (status: ConnectionStatus) => void): void {
		this.statusListeners.delete(listener);
	}

	// =========================================================================
	// Internal Event Handlers
	// =========================================================================

	private handleOpen(): void {
		this.setStatus('connected');
		this._error = null;
	}

	private handleMessage(event: MessageEvent): void {
		try {
			const raw = JSON.parse(event.data);

			// Handle both PartyKit and Durable Objects message formats
			const serverEvent = this.normalizeServerEvent(raw);

			if (!serverEvent) return;

			// Update local room state
			this.processEvent(serverEvent);

			// Notify handlers
			for (const handler of this.eventHandlers) {
				try {
					handler(serverEvent);
				} catch (error) {
					log.error('Event handler error', error as Error);
				}
			}
		} catch (error) {
			log.error('Failed to parse message', error as Error);
		}
	}

	/**
	 * Filter server events - only PONG is suppressed, everything else passes through.
	 * All events use UPPERCASE format with payload structure.
	 */
	private normalizeServerEvent(raw: Record<string, unknown>): ServerEvent | null {
		const type = raw.type as string;

		// Suppress heartbeat responses
		if (type === 'PONG') {
			return null;
		}

		// All events pass through - they all use UPPERCASE format now
		return raw as unknown as ServerEvent;
	}

	/**
	 * Convert Durable Objects CONNECTED payload to GameRoom format
	 */
	private convertDOPayloadToRoom(payload: Record<string, unknown>): GameRoom {
		const players = (payload.players as Array<Record<string, unknown>>) ?? [];
		const aiPlayers = (payload.aiPlayers as Array<Record<string, unknown>>) ?? [];

		// Map DO room status to our RoomState type
		const rawStatus = (payload.roomStatus as string) ?? 'waiting';
		const validStates = ['waiting', 'starting', 'playing', 'completed', 'abandoned'] as const;
		const state = validStates.includes(rawStatus as (typeof validStates)[number])
			? (rawStatus as (typeof validStates)[number])
			: 'waiting';

		// Extract config from payload (server sends settings object)
		const settings = payload.settings as Record<string, unknown> | undefined;

		return {
			code: ((payload.roomCode as string) ??
				this._roomCode ??
				'UNKNWN') as import('$lib/types/multiplayer').RoomCode,
			hostId: (players.find((p) => p.isHost)?.userId as string) ?? '',
			state,
			config: {
				isPublic: (settings?.isPublic as boolean) ?? false,
				allowSpectators: (settings?.allowSpectators as boolean) ?? false,
				turnTimeoutSeconds: (settings?.turnTimeoutSeconds as number) ?? 60,
				maxPlayers: ((settings?.maxPlayers as number) ?? 4) as 2 | 3 | 4,
			},
			players: players.map((p) => this.convertDOPlayer(p)),
			aiPlayers: aiPlayers.map((ai) => ({
				id: (ai.id as string) ?? '',
				profileId: (ai.profileId as string) ?? '',
				displayName: (ai.displayName as string) ?? 'AI Player',
				avatarSeed: (ai.avatarSeed as string) ?? '',
			})),
			createdAt: new Date().toISOString(),
			startedAt: state === 'playing' ? new Date().toISOString() : null,
		};
	}

	/**
	 * Convert Durable Objects player format to RoomPlayer format
	 */
	private convertDOPlayer(
		payload: Record<string, unknown>,
	): import('$lib/types/multiplayer').RoomPlayer {
		return {
			id: (payload.userId as string) ?? '',
			displayName: (payload.displayName as string) ?? 'Player',
			avatarSeed: (payload.avatarSeed as string) ?? (payload.userId as string) ?? '',
			isHost: (payload.isHost as boolean) ?? false,
			isConnected: (payload.isConnected as boolean) ?? true,
			joinedAt: (payload.connectedAt as string) ?? new Date().toISOString(),
		};
	}

	private handleClose(_event: CloseEvent): void {
		// ReconnectingWebSocket auto-reconnects
		if (this._status === 'connected') {
			this.setStatus('connecting'); // Reconnecting
		}
	}

	private handleError(): void {
		log.error('Connection error');
		this._error = 'Connection error';
		this.setStatus('error');
	}

	private setStatus(status: ConnectionStatus): void {
		this._status = status;
		for (const listener of this.statusListeners) {
			try {
				listener(status);
			} catch (error) {
				log.error('Status listener error', error as Error);
			}
		}
	}

	private processEvent(event: ServerEvent): void {
		// All events use UPPERCASE format with payload structure
		switch (event.type) {
			case 'CONNECTED': {
				// Convert CONNECTED payload to room structure
				const payload = (event as { payload: Record<string, unknown> }).payload;
				this._room = this.convertDOPayloadToRoom(payload);
				break;
			}

			case 'PLAYER_JOINED': {
				if (this._room) {
					const payload = (
						event as { payload: { userId: string; displayName: string; avatarSeed: string } }
					).payload;
					const existing = this._room.players.find((p) => p.id === payload.userId);
					if (!existing) {
						this._room = {
							...this._room,
							players: [
								...this._room.players,
								{
									id: payload.userId,
									displayName: payload.displayName,
									avatarSeed: payload.avatarSeed,
									isHost: false,
									isConnected: true,
									joinedAt: new Date().toISOString(),
								},
							],
						};
					}
				}
				break;
			}

			case 'PLAYER_LEFT': {
				if (this._room) {
					const payload = (event as { payload: { userId: string } }).payload;
					this._room = {
						...this._room,
						players: this._room.players.filter((p) => p.id !== payload.userId),
					};
				}
				break;
			}

			case 'AI_PLAYER_JOINED': {
				if (this._room) {
					const payload = (
						event as {
							payload: { id: string; profileId: string; displayName: string; avatarSeed: string };
						}
					).payload;
					const existingAI = this._room.aiPlayers?.find((p) => p.id === payload.id);
					if (!existingAI) {
						this._room = {
							...this._room,
							aiPlayers: [
								...(this._room.aiPlayers ?? []),
								{
									id: payload.id,
									profileId: payload.profileId,
									displayName: payload.displayName,
									avatarSeed: payload.avatarSeed,
								},
							],
						};
					}
				}
				break;
			}

			case 'AI_PLAYER_REMOVED': {
				if (this._room) {
					const payload = (event as { payload: { playerId: string } }).payload;
					this._room = {
						...this._room,
						aiPlayers: this._room.aiPlayers?.filter((p) => p.id !== payload.playerId) ?? [],
					};
				}
				break;
			}

			case 'GAME_STARTING':
				if (this._room) {
					this._room = { ...this._room, state: 'starting' };
				}
				break;

			case 'GAME_STARTED':
			case 'QUICK_PLAY_STARTED':
				if (this._room) {
					this._room = { ...this._room, state: 'playing' };
				}
				break;

			case 'REMATCH_STARTED':
				if (this._room) {
					this._room = { ...this._room, state: 'waiting' };
				}
				break;

			case 'GAME_OVER':
				if (this._room) {
					this._room = { ...this._room, state: 'completed' };
				}
				break;

			case 'ERROR': {
				const payload = (event as { payload: { message: string } }).payload;
				this._error = payload.message;
				break;
			}
		}
	}
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Singleton room service instance
 */
export const roomService = new RoomService();
