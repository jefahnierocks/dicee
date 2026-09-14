/**
 * Lobby State Store - Svelte 5 Runes
 *
 * Manages global lobby state:
 * - WebSocket connection to GlobalLobby DO
 * - Online presence
 * - Room browser
 * - Global chat
 * - Ticker events
 *
 * Uses @dicee/shared validation schemas for protocol compliance.
 */

import {
	isValidLobbyChatContent,
	type LobbyServerEventInput,
	type PlayerPresenceState,
	type PlayerSummary,
	parseLobbyServerEvent,
	// Import lobby types from shared (single source of truth)
	type RoomInfo,
} from '@dicee/shared';
import { browser } from '$app/environment';
import {
	isUpgradeRequiredClose,
	protocolUpgrade,
	withProtocolVersion,
} from '$lib/services/protocolUpgrade.svelte';
import { createServiceLogger } from '$lib/utils/logger';

const log = createServiceLogger('Lobby');

// Re-export RoomInfo for components that import from this store
export type { PlayerPresenceState, PlayerSummary, RoomInfo };

// Types (local to lobby store)
export interface ChatMessage {
	id: string;
	userId: string;
	username: string;
	content: string;
	timestamp: number;
	type: 'user' | 'system';
}

export interface TickerEvent {
	id: string;
	type: 'join' | 'room_created' | 'game_won' | 'jackpot';
	message: string;
	timestamp: number;
}

export interface OnlineUser {
	userId: string;
	displayName: string;
	avatarSeed: string;
	/** Room code if user is currently in a room (null if just in lobby) */
	currentRoomCode: string | null;
}

/**
 * Pending invite received from another user.
 * Displayed in InvitePopup for accept/decline.
 */
export interface PendingInvite {
	inviteId: string;
	roomCode: string;
	hostUserId: string;
	hostDisplayName: string;
	hostAvatarSeed: string;
	game: 'dicee';
	playerCount: number;
	maxPlayers: number;
	expiresAt: number;
}

/**
 * Status of an active join request sent by this user.
 * Used to show pending/approved/declined UI in the lobby.
 */
export type JoinRequestStatus =
	| 'pending'
	| 'approved'
	| 'declined'
	| 'expired'
	| 'cancelled'
	| 'error';

/**
 * Active join request sent by this user.
 * Only one can be active at a time.
 */
export interface ActiveJoinRequest {
	requestId: string;
	roomCode: string;
	status: JoinRequestStatus;
	expiresAt: number;
	errorMessage?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// Reactive state with Svelte 5 runes
class LobbyState {
	// Connection
	connectionState = $state<ConnectionState>('disconnected');
	reconnectAttempts = $state(0);

	// Data
	onlineCount = $state(0);
	onlineUsers = $state<OnlineUser[]>([]);
	rooms = $state<RoomInfo[]>([]);
	messages = $state<ChatMessage[]>([]);
	ticker = $state<TickerEvent[]>([]);
	unreadCount = $state(0);

	// UI state
	activeTab = $state<'games' | 'chat'>('games');
	isCreateDrawerOpen = $state(false);
	showOnlineUsers = $state(false);

	// Invite system
	pendingInvites = $state<PendingInvite[]>([]);

	// Join request system (requester side)
	activeJoinRequest = $state<ActiveJoinRequest | null>(null);

	// Derived
	openRooms = $derived(this.rooms.filter((r) => r.status === 'waiting'));

	/** The current invite to display (first in queue, or null) */
	currentInvite = $derived(this.pendingInvites[0] ?? null);

	/** Whether there are any pending invites */
	hasInvites = $derived(this.pendingInvites.length > 0);
	playingRooms = $derived(this.rooms.filter((r) => r.status === 'playing'));

	/** Whether we have an active pending join request */
	hasActiveJoinRequest = $derived(
		this.activeJoinRequest !== null && this.activeJoinRequest.status === 'pending',
	);

	/** Seconds remaining until join request expires */
	joinRequestSecondsRemaining = $derived.by(() => {
		if (!this.activeJoinRequest || this.activeJoinRequest.status !== 'pending') return null;
		const remaining = Math.max(
			0,
			Math.ceil((this.activeJoinRequest.expiresAt - Date.now()) / 1000),
		);
		return remaining;
	});

	// Show online count with appropriate label
	onlineDisplay = $derived(
		this.onlineCount === 0
			? 'Connecting...'
			: this.onlineCount === 1
				? '1 online (you)'
				: `${this.onlineCount} online`,
	);

	private ws: WebSocket | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingInterval: ReturnType<typeof setInterval> | null = null;
	private connectPromise: Promise<void> | null = null;
	private intentionalDisconnect = false;
	private deadlineWatcherTimer: ReturnType<typeof setInterval> | null = null;
	private readonly MAX_MESSAGES = 100;
	private readonly MAX_TICKER = 10;
	private readonly RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
	private readonly PING_INTERVAL = 30000; // 30 seconds
	private readonly DEADLINE_CHECK_INTERVAL = 10000; // 10 seconds

	/**
	 * Connect to the lobby WebSocket.
	 * Idempotent - returns existing promise if already connecting/connected.
	 */
	connect(): Promise<void> {
		// Reset intentional flag on new connect attempt
		this.intentionalDisconnect = false;

		// Return existing promise if already connecting
		if (this.connectPromise) return this.connectPromise;

		// Already connected - return resolved promise
		if (this.ws?.readyState === WebSocket.OPEN) {
			return Promise.resolve();
		}

		// Create new connection
		this.connectPromise = this.connectToServer();
		return this.connectPromise;
	}

	/**
	 * Internal connection method.
	 */
	private connectToServer(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!browser) {
				this.connectPromise = null;
				reject(new Error('Not in browser'));
				return;
			}

			this.connectionState = 'connecting';

			const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
			this.ws = new WebSocket(withProtocolVersion(`${protocol}//${location.host}/ws/lobby`));

			this.ws.onopen = () => {
				this.connectionState = 'connected';
				this.reconnectAttempts = 0;
				this.clearReconnectTimer();
				this.startPingInterval();
				resolve();
			};

			this.ws.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);
					this.handleMessage(data);
				} catch (e) {
					log.error('Failed to parse message', e as Error);
				}
			};

			this.ws.onclose = (event) => {
				this.connectionState = 'disconnected';
				this.connectPromise = null;
				this.stopPingInterval();
				if (isUpgradeRequiredClose(event.code)) {
					// Outdated client: never reconnect; reload once or show the updating notice
					this.clearReconnectTimer();
					protocolUpgrade.handleUpgradeRequired();
					return;
				}
				if (!event.wasClean && !this.intentionalDisconnect) {
					this.scheduleReconnect();
				}
			};

			this.ws.onerror = (error) => {
				// Error will trigger close, which handles reconnect
				// Only reject if this is the initial connection attempt
				if (this.connectionState === 'connecting') {
					reject(error);
				}
			};
		});
	}

	/**
	 * Disconnect from the lobby WebSocket.
	 * Sets intentionalDisconnect to prevent auto-reconnect (e.g., on logout).
	 */
	disconnect() {
		this.intentionalDisconnect = true;
		this.clearReconnectTimer();
		this.stopPingInterval();
		this.stopDeadlineWatcher();
		this.ws?.close(1000, 'User disconnect');
		this.ws = null;
		this.connectionState = 'disconnected';
		this.connectPromise = null;
	}

	private handleMessage(data: { type: string; payload: unknown; timestamp?: string | number }) {
		log.debug('handleMessage', { type: data.type, data });

		// Validate with @dicee/shared schema for protocol compliance
		// Non-standard events (pong, legacy) are handled after validation attempt
		const parsed = parseLobbyServerEvent(data as LobbyServerEventInput);
		if (!parsed.success && data.type !== 'pong') {
			// Log validation warnings for debugging but continue processing
			// Server events may have fields not yet in schema
			console.debug('[lobby] Event validation note:', data.type, parsed.error?.issues);
		}

		switch (data.type) {
			// =============================================
			// UPPERCASE events (new protocol - Phase 3)
			// =============================================
			case 'PRESENCE_INIT': {
				const p = data.payload as { onlineCount: number };
				this.onlineCount = p.onlineCount;
				break;
			}

			case 'PRESENCE_JOIN': {
				const p = data.payload as {
					userId: string;
					displayName: string;
					avatarSeed: string;
					onlineCount: number;
				};
				this.onlineCount = p.onlineCount;
				this.addTickerEvent({
					type: 'join',
					message: `${p.displayName} joined`,
				});
				break;
			}

			case 'PRESENCE_LEAVE': {
				const p = data.payload as { userId: string; displayName: string; onlineCount: number };
				this.onlineCount = p.onlineCount;
				break;
			}

			case 'LOBBY_CHAT_MESSAGE': {
				const msg = data.payload as {
					id: string;
					userId: string;
					displayName: string;
					content: string;
					timestamp: number;
				};
				const chatMessage: ChatMessage = {
					id: msg.id,
					userId: msg.userId,
					username: msg.displayName,
					content: msg.content,
					timestamp: msg.timestamp,
					type: 'user',
				};
				this.messages = [...this.messages.slice(-(this.MAX_MESSAGES - 1)), chatMessage];
				if (this.activeTab !== 'chat') {
					this.unreadCount++;
				}
				break;
			}

			case 'LOBBY_CHAT_HISTORY': {
				const historyPayload = data.payload as {
					messages: Array<{
						id: string;
						userId: string;
						displayName: string;
						content: string;
						timestamp: number;
					}>;
				};
				const mapped = historyPayload.messages.map((m) => ({
					id: m.id,
					userId: m.userId,
					username: m.displayName,
					content: m.content,
					timestamp: m.timestamp,
					type: 'user' as const,
				}));
				this.messages = mapped.slice(-this.MAX_MESSAGES);
				break;
			}

			case 'LOBBY_ROOMS_LIST': {
				const roomsPayload = data.payload as { rooms: RoomInfo[] };
				this.rooms = roomsPayload.rooms;
				break;
			}

			case 'LOBBY_ROOM_UPDATE': {
				const update = data.payload as { action: string; room?: RoomInfo; code?: string };
				if (update.action === 'created' && update.room) {
					this.rooms = [update.room, ...this.rooms];
					this.addTickerEvent({
						type: 'room_created',
						message: `Room #${update.room.code} created`,
					});
				} else if (update.action === 'closed' && update.code) {
					this.rooms = this.rooms.filter((r) => r.code !== update.code);
				} else if (update.action === 'updated' && update.room) {
					const updatedRoom = update.room;
					const existingIndex = this.rooms.findIndex((r) => r.code === updatedRoom.code);
					if (existingIndex >= 0) {
						// Update existing room
						this.rooms = this.rooms.map((r) => (r.code === updatedRoom.code ? updatedRoom : r));
					} else {
						// Room not in list yet (new room via RPC) - add it
						this.rooms = [updatedRoom, ...this.rooms];
						this.addTickerEvent({
							type: 'room_created',
							message: `Room #${updatedRoom.code} created`,
						});
					}
				}
				break;
			}

			case 'LOBBY_ONLINE_USERS': {
				const usersPayload = data.payload as { users: OnlineUser[] };
				this.onlineUsers = usersPayload.users;
				log.debug('Set onlineUsers', { count: this.onlineUsers.length });
				break;
			}

			case 'LOBBY_HIGHLIGHT': {
				// Game highlight for ticker (Dicee, high score, etc.)
				const highlight = data.payload as {
					type: string;
					roomCode: string;
					playerName: string;
					details?: string;
				};
				this.addTickerEvent({
					type: 'jackpot',
					message: `${highlight.playerName} ${highlight.type} in room #${highlight.roomCode}`,
				});
				break;
			}

			case 'LOBBY_ERROR': {
				const errorPayload = data.payload as { message: string; code?: string };
				log.error('Server error', { code: errorPayload.code, message: errorPayload.message });
				break;
			}

			case 'INVITE_RECEIVED': {
				const invitePayload = data.payload as {
					inviteId: string;
					roomCode: string;
					hostUserId: string;
					hostDisplayName: string;
					hostAvatarSeed: string;
					game: 'dicee';
					playerCount: number;
					maxPlayers: number;
					expiresAt: number;
				};
				const invite: PendingInvite = {
					inviteId: invitePayload.inviteId,
					roomCode: invitePayload.roomCode,
					hostUserId: invitePayload.hostUserId,
					hostDisplayName: invitePayload.hostDisplayName,
					hostAvatarSeed: invitePayload.hostAvatarSeed,
					game: invitePayload.game,
					playerCount: invitePayload.playerCount,
					maxPlayers: invitePayload.maxPlayers,
					expiresAt: invitePayload.expiresAt,
				};
				this.pendingInvites = [invite, ...this.pendingInvites];
				this.addTickerEvent({
					type: 'join',
					message: `${invite.hostDisplayName} invited you to play`,
				});
				break;
			}

			case 'INVITE_CANCELLED': {
				const cancelPayload = data.payload as {
					inviteId: string;
					roomCode: string;
					reason: string;
				};
				this.pendingInvites = this.pendingInvites.filter(
					(inv) => inv.inviteId !== cancelPayload.inviteId,
				);
				break;
			}

			// UPPERCASE join request events
			case 'JOIN_REQUEST_SENT':
			case 'JOIN_REQUEST_ERROR':
			case 'JOIN_APPROVED':
			case 'JOIN_DECLINED':
			case 'JOIN_REQUEST_EXPIRED':
			case 'JOIN_REQUEST_CANCELLED':
				this.handleJoinRequestMessage(data.type, data.payload);
				break;

			// Heartbeat response (auto-handled by server, but client may receive it)
			case 'pong':
				break;

			default:
				log.warn('Unknown message type', { type: data.type });
		}
	}

	/**
	 * Handle join request-related messages.
	 * Extracted from handleMessage to reduce cognitive complexity.
	 * Supports both UPPERCASE (new) and lowercase (legacy) event types.
	 */
	private handleJoinRequestMessage(type: string, payload: unknown) {
		// Normalize type to handle both UPPERCASE and lowercase
		const normalizedType = type.toUpperCase();

		switch (normalizedType) {
			case 'JOIN_REQUEST_SENT': {
				const sentPayload = payload as {
					requestId: string;
					roomCode: string;
					expiresAt: number;
				};
				this.activeJoinRequest = {
					requestId: sentPayload.requestId,
					roomCode: sentPayload.roomCode,
					status: 'pending',
					expiresAt: sentPayload.expiresAt,
				};
				log.debug('Join request sent', { request: this.activeJoinRequest });
				break;
			}

			case 'JOIN_REQUEST_ERROR': {
				const errorPayload = payload as {
					code: string;
					message: string;
				};
				// If we have an active request, mark it as error
				if (this.activeJoinRequest) {
					this.activeJoinRequest = {
						...this.activeJoinRequest,
						status: 'error',
						errorMessage: errorPayload.message,
					};
				} else {
					// No active request, create a temporary error state
					this.activeJoinRequest = {
						requestId: '',
						roomCode: '',
						status: 'error',
						expiresAt: 0,
						errorMessage: errorPayload.message,
					};
				}
				// Auto-clear error after 3 seconds
				setTimeout(() => {
					if (this.activeJoinRequest?.status === 'error') {
						this.activeJoinRequest = null;
					}
				}, 3000);
				log.debug('Join request error', { error: errorPayload });
				break;
			}

			case 'JOIN_APPROVED': {
				const approvedPayload = payload as {
					requestId: string;
					roomCode: string;
				};
				if (this.activeJoinRequest?.requestId === approvedPayload.requestId) {
					this.activeJoinRequest = {
						...this.activeJoinRequest,
						status: 'approved',
					};
					log.debug('Join request approved', { roomCode: approvedPayload.roomCode });
					// Note: Navigation to room should be handled by the UI component
				}
				break;
			}

			case 'JOIN_DECLINED': {
				const declinedPayload = payload as {
					requestId: string;
					reason?: string;
				};
				if (this.activeJoinRequest?.requestId === declinedPayload.requestId) {
					this.activeJoinRequest = {
						...this.activeJoinRequest,
						status: 'declined',
						errorMessage: declinedPayload.reason ?? 'Host declined your request',
					};
					// Auto-clear after 3 seconds
					setTimeout(() => {
						if (this.activeJoinRequest?.status === 'declined') {
							this.activeJoinRequest = null;
						}
					}, 3000);
					log.debug('Join request declined', { payload: declinedPayload });
				}
				break;
			}

			case 'JOIN_REQUEST_EXPIRED': {
				const expiredPayload = payload as {
					requestId: string;
				};
				if (this.activeJoinRequest?.requestId === expiredPayload.requestId) {
					this.activeJoinRequest = {
						...this.activeJoinRequest,
						status: 'expired',
					};
					// Auto-clear after 3 seconds
					setTimeout(() => {
						if (this.activeJoinRequest?.status === 'expired') {
							this.activeJoinRequest = null;
						}
					}, 3000);
					log.debug('Join request expired');
				}
				break;
			}

			case 'JOIN_REQUEST_CANCELLED': {
				const cancelledPayload = payload as {
					requestId: string;
				};
				if (this.activeJoinRequest?.requestId === cancelledPayload.requestId) {
					this.activeJoinRequest = null;
					log.debug('Join request cancelled');
				}
				break;
			}
		}
	}

	private addTickerEvent(event: Omit<TickerEvent, 'id' | 'timestamp'>) {
		const full: TickerEvent = {
			...event,
			id: crypto.randomUUID(),
			timestamp: Date.now(),
		};
		this.ticker = [full, ...this.ticker.slice(0, this.MAX_TICKER - 1)];
	}

	private scheduleReconnect() {
		// Don't reconnect after intentional disconnect (logout)
		if (this.intentionalDisconnect) return;
		if (this.reconnectTimer) return;

		const delay =
			this.RECONNECT_DELAYS[Math.min(this.reconnectAttempts, this.RECONNECT_DELAYS.length - 1)];

		this.connectionState = 'reconnecting';
		this.reconnectAttempts++;

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.connect();
		}, delay);
	}

	private clearReconnectTimer() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}

	private startPingInterval() {
		this.stopPingInterval();
		this.pingInterval = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, this.PING_INTERVAL);
	}

	private stopPingInterval() {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	/**
	 * Start the deadline watcher that checks for expired reconnect deadlines.
	 * When a player's reconnect deadline passes, we optimistically update
	 * their presence state to 'abandoned' without waiting for a server push.
	 *
	 * This handles the race condition where:
	 * 1. User views lobby, sees "REJOIN" (seat expires in 30 seconds)
	 * 2. User waits 45 seconds
	 * 3. User clicks "REJOIN" -> Error (seat expired)
	 *
	 * With the watcher, the button switches from "REJOIN" to "JOIN" automatically.
	 */
	private startDeadlineWatcher(userId: string | null) {
		this.stopDeadlineWatcher();
		if (!userId) return;

		this.deadlineWatcherTimer = setInterval(() => {
			this.checkExpiredDeadlines(userId);
		}, this.DEADLINE_CHECK_INTERVAL);

		// Run immediately on start
		this.checkExpiredDeadlines(userId);
	}

	private stopDeadlineWatcher() {
		if (this.deadlineWatcherTimer) {
			clearInterval(this.deadlineWatcherTimer);
			this.deadlineWatcherTimer = null;
		}
	}

	/**
	 * Check if any rooms have players with expired reconnect deadlines.
	 * If the current user's deadline has passed, update their presence to 'abandoned'.
	 */
	private checkExpiredDeadlines(userId: string) {
		const now = Date.now();
		let updated = false;

		this.rooms = this.rooms.map((room) => {
			const updatedPlayers = room.players.map((player) => {
				// Only check if this is the current user and they have a deadline
				if (player.userId !== userId) return player;
				if (player.presenceState !== 'disconnected') return player;
				if (!player.reconnectDeadline) return player;

				// Check if deadline has passed
				if (player.reconnectDeadline < now) {
					updated = true;
					log.debug('Optimistically marking player as abandoned', {
						roomCode: room.code,
						userId,
						deadline: player.reconnectDeadline,
					});
					return {
						...player,
						presenceState: 'abandoned' as const,
						reconnectDeadline: null,
					};
				}

				return player;
			});

			if (updated) {
				return { ...room, players: updatedPlayers };
			}
			return room;
		});
	}

	/**
	 * Start watching deadlines for the given user.
	 * Should be called when user logs in or when room data is received.
	 */
	watchDeadlinesForUser(userId: string | null) {
		this.startDeadlineWatcher(userId);
	}

	// Actions
	sendChat(content: string) {
		const trimmed = content.trim();
		if (!trimmed || this.ws?.readyState !== WebSocket.OPEN) return;

		// Validate content using @dicee/shared schema
		if (!isValidLobbyChatContent(trimmed)) {
			log.warn('Invalid chat content length');
			return;
		}

		// Send to server - no optimistic update to avoid duplicate messages
		// Server will broadcast back to all users including sender
		// Using UPPERCASE command format (Phase 3)
		this.ws.send(
			JSON.stringify({
				type: 'LOBBY_CHAT',
				payload: { content: trimmed },
			}),
		);
	}

	markChatRead() {
		this.unreadCount = 0;
	}

	setActiveTab(tab: 'games' | 'chat') {
		this.activeTab = tab;
		if (tab === 'chat') {
			this.markChatRead();
		}
	}

	requestRooms() {
		if (this.ws?.readyState === WebSocket.OPEN) {
			// Using UPPERCASE command format (Phase 3)
			this.ws.send(JSON.stringify({ type: 'GET_ROOMS' }));
		}
	}

	/**
	 * Request list of online users from server.
	 * Called when user clicks on the online indicator.
	 */
	requestOnlineUsers() {
		log.debug('requestOnlineUsers called', { wsState: this.ws?.readyState });
		if (this.ws?.readyState === WebSocket.OPEN) {
			// Using UPPERCASE command format (Phase 3)
			log.debug('Sending GET_ONLINE_USERS');
			this.ws.send(JSON.stringify({ type: 'GET_ONLINE_USERS' }));
		} else {
			log.warn('Cannot request online users - WebSocket not open');
		}
	}

	/**
	 * Toggle the online users display panel.
	 * Requests fresh data when opening.
	 */
	toggleOnlineUsers() {
		this.showOnlineUsers = !this.showOnlineUsers;
		if (this.showOnlineUsers) {
			this.requestOnlineUsers();
		}
	}

	/**
	 * Close the online users display panel.
	 */
	closeOnlineUsers() {
		this.showOnlineUsers = false;
	}

	// =========================================================================
	// Invite Actions
	// =========================================================================

	/**
	 * Respond to an invite (accept or decline).
	 * If accepting, the user will navigate to the room after this.
	 */
	respondToInvite(inviteId: string, roomCode: string, action: 'accept' | 'decline') {
		// Remove from local state immediately
		this.pendingInvites = this.pendingInvites.filter((inv) => inv.inviteId !== inviteId);

		// Send response to server via WebSocket
		// Note: The invite response goes through GlobalLobby which forwards to GameRoom
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(
				JSON.stringify({
					type: 'invite_response',
					payload: {
						inviteId,
						roomCode,
						action,
					},
				}),
			);
		}
	}

	/**
	 * Dismiss an invite (convenience method that declines).
	 */
	dismissInvite(inviteId: string) {
		const invite = this.pendingInvites.find((inv) => inv.inviteId === inviteId);
		if (invite) {
			this.respondToInvite(inviteId, invite.roomCode, 'decline');
		}
	}

	/**
	 * Clear all pending invites (e.g., when navigating away).
	 */
	clearInvites() {
		// Decline all pending invites
		for (const invite of this.pendingInvites) {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.ws.send(
					JSON.stringify({
						type: 'invite_response',
						payload: {
							inviteId: invite.inviteId,
							roomCode: invite.roomCode,
							action: 'decline',
						},
					}),
				);
			}
		}
		this.pendingInvites = [];
	}

	// =========================================================================
	// Join Request Actions (Requester Side)
	// =========================================================================

	/**
	 * Send a join request to a room.
	 * Can only have one active request at a time.
	 *
	 * @param roomCode - The room code to request to join
	 */
	sendJoinRequest(roomCode: string) {
		// Can't send if already have an active pending request
		if (this.hasActiveJoinRequest) {
			log.warn('Already have an active join request');
			return;
		}

		if (this.ws?.readyState !== WebSocket.OPEN) {
			log.warn('Cannot send join request - WebSocket not open');
			return;
		}

		// Using UPPERCASE command format (Phase 3)
		log.debug('Sending REQUEST_JOIN', { roomCode });
		this.ws.send(
			JSON.stringify({
				type: 'REQUEST_JOIN',
				payload: { roomCode: roomCode.toUpperCase() },
			}),
		);
	}

	/**
	 * Cancel the active join request.
	 */
	cancelJoinRequest() {
		if (!this.activeJoinRequest || this.activeJoinRequest.status !== 'pending') {
			log.warn('No active pending join request to cancel');
			return;
		}

		if (this.ws?.readyState !== WebSocket.OPEN) {
			// Just clear locally if can't reach server
			this.activeJoinRequest = null;
			return;
		}

		// Using UPPERCASE command format (Phase 3)
		log.debug('Cancelling join request', { requestId: this.activeJoinRequest.requestId });
		this.ws.send(
			JSON.stringify({
				type: 'CANCEL_JOIN_REQUEST',
				payload: {
					requestId: this.activeJoinRequest.requestId,
					roomCode: this.activeJoinRequest.roomCode,
				},
			}),
		);

		// Clear optimistically (server will confirm)
		this.activeJoinRequest = { ...this.activeJoinRequest, status: 'cancelled' };
	}

	/**
	 * Clear the join request state (e.g., after navigation).
	 */
	clearJoinRequest() {
		// If pending, cancel it on the server
		if (this.activeJoinRequest?.status === 'pending') {
			this.cancelJoinRequest();
		} else {
			this.activeJoinRequest = null;
		}
	}

	/**
	 * Get the active join request for a specific room.
	 * Returns null if no request or request is for a different room.
	 */
	getJoinRequestForRoom(roomCode: string): ActiveJoinRequest | null {
		if (this.activeJoinRequest?.roomCode?.toUpperCase() === roomCode.toUpperCase()) {
			return this.activeJoinRequest;
		}
		return null;
	}
}

export const lobby = new LobbyState();
