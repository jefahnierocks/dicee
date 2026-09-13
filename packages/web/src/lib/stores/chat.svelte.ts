/**
 * Chat Store
 *
 * Svelte 5 reactive store for lobby chat with comprehensive UX features.
 * Manages messages, typing indicators, reactions, and rate limiting.
 *
 * Features:
 * - Optimistic message sending with pending states
 * - Debounced typing indicators
 * - Unread message tracking
 * - Rate limit awareness
 * - Message grouping helpers
 * - Sound notification preferences
 * - Auto-scroll behavior hints
 *
 * @see docs/game-lobby-chat.md for full specification
 */

import { getContext, setContext } from 'svelte';
import type { SpectatorServerEvent } from '$lib/services/spectatorService.svelte';
import {
	CHAT_RATE_LIMITS,
	type ChatErrorCode,
	type ChatMessage,
	type ChatServerEvent,
	createEmptyReactions,
	isChatEvent,
	isShoutEvent,
	type MessageReactions,
	QUICK_CHAT_MESSAGES,
	type QuickChatKey,
	REACTION_EMOJIS,
	type ReactionEmoji,
	type ServerEvent,
	SHOUT_COOLDOWN_MS,
	SHOUT_DISPLAY_DURATION_MS,
	SHOUT_MAX_LENGTH,
	type ShoutCooldownEvent,
	type ShoutMessage,
	type ShoutReceivedEvent,
	type TypingState,
} from '$lib/types/multiplayer';
import { createServiceLogger } from '$lib/utils/logger';

const log = createServiceLogger('ChatStore');

// =============================================================================
// Store Types
// =============================================================================

/** Message with client-side metadata */
export interface ChatMessageWithMeta extends ChatMessage {
	/** Whether this message is pending (optimistic update) */
	isPending?: boolean;
	/** Whether this message failed to send */
	isFailed?: boolean;
	/** Error message if failed */
	errorMessage?: string;
}

/** Message group for UI rendering (messages from same user within timeframe) */
export interface MessageGroup {
	/** User ID who sent these messages */
	userId: string;
	/** Display name */
	displayName: string;
	/** Whether this is a system message group */
	isSystem: boolean;
	/** Messages in this group (chronological) */
	messages: ChatMessageWithMeta[];
	/** Timestamp of first message in group */
	timestamp: number;
}

/**
 * Chat connection interface - abstracts roomService vs spectatorService
 * Both services implement these methods for chat functionality.
 *
 * Uses the union of ServerEvent | SpectatorServerEvent as the event type,
 * which is the superset that allows both roomService and spectatorService
 * to satisfy this interface.
 */
export type ChatConnectionEventHandler = (event: ServerEvent | SpectatorServerEvent) => void;

export interface ChatConnection {
	readonly isConnected: boolean;
	sendChatMessage(content: string): void;
	sendQuickChat(key: QuickChatKey): void;
	sendReaction(messageId: string, emoji: ReactionEmoji, action: 'add' | 'remove'): void;
	sendTypingStart(): void;
	sendTypingStop(): void;
	sendShout?(content: string): void; // Optional - only roomService has this
	addEventHandler(handler: ChatConnectionEventHandler): void;
	removeEventHandler(handler: ChatConnectionEventHandler): void;
}

/** Chat store preferences (persisted to localStorage) */
export interface ChatPreferences {
	/** Play sound on new message */
	soundEnabled: boolean;
	/** Show desktop notifications */
	notificationsEnabled: boolean;
	/** Collapsed by default on mobile */
	defaultCollapsed: boolean;
}

/** Chat store interface */
export interface ChatStore {
	// -------------------------------------------------------------------------
	// State (reactive getters)
	// -------------------------------------------------------------------------

	/** All chat messages (including pending) */
	readonly messages: ChatMessageWithMeta[];
	/** Users currently typing (excludes current user) */
	readonly typingUsers: TypingState[];
	/** Number of unread messages */
	readonly unreadCount: number;
	/** Last chat error */
	readonly error: { code: ChatErrorCode; message: string } | null;
	/** Whether chat panel is open */
	readonly isOpen: boolean;
	/** Current user's preferences */
	readonly preferences: ChatPreferences;
	/** Active shout bubbles by user ID */
	readonly activeShouts: Map<string, ShoutMessage>;
	/** Shout cooldown remaining (milliseconds) */
	readonly shoutCooldownMs: number;

	// -------------------------------------------------------------------------
	// Derived State
	// -------------------------------------------------------------------------

	/** Whether user can send a message (rate limit check) */
	readonly canSendMessage: boolean;
	/** Seconds until can send next message (0 if can send now) */
	readonly sendCooldown: number;
	/** Whether there are unread messages */
	readonly hasUnread: boolean;
	/** Formatted typing indicator text (e.g., "Alice is typing...") */
	readonly typingText: string | null;
	/** Messages grouped by user/time for efficient rendering */
	readonly messageGroups: MessageGroup[];
	/** Character limit for messages */
	readonly maxMessageLength: number;
	/** Whether currently typing (own state) */
	readonly isTyping: boolean;
	/** Whether user can send a shout (cooldown check) */
	readonly canShout: boolean;
	/** Shout cooldown remaining (seconds) */
	readonly shoutCooldownSeconds: number;
	/** Maximum shout length */
	readonly maxShoutLength: number;

	// -------------------------------------------------------------------------
	// Actions
	// -------------------------------------------------------------------------

	/** Send a text message */
	sendMessage: (content: string) => void;
	/** Send a quick chat preset */
	sendQuickChat: (key: QuickChatKey) => void;
	/** Toggle a reaction on a message */
	toggleReaction: (messageId: string, emoji: ReactionEmoji) => void;
	/** Set typing state (with automatic debouncing) */
	setTyping: (isTyping: boolean) => void;
	/** Mark all messages as read */
	markAsRead: () => void;
	/** Toggle chat panel open/closed */
	toggleOpen: () => void;
	/** Set chat panel open state */
	setOpen: (open: boolean) => void;
	/** Update preferences */
	updatePreferences: (prefs: Partial<ChatPreferences>) => void;
	/** Clear all messages (for room reset) */
	clear: () => void;
	/** Retry sending a failed message */
	retryMessage: (messageId: string) => void;
	/** Remove a failed message */
	removeFailedMessage: (messageId: string) => void;
	/** Send a shout (ephemeral speech bubble) */
	sendShout: (content: string) => void;
	/** Get active shout for a user */
	getShoutForUser: (userId: string) => ShoutMessage | undefined;
	/** Cleanup (call on unmount) */
	destroy: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const CHAT_CONTEXT_KEY = Symbol('chat-store');
const PREFERENCES_STORAGE_KEY = 'dicee-chat-preferences';

/** Time window for grouping messages from same user (ms) */
const MESSAGE_GROUP_WINDOW_MS = 60_000; // 1 minute

/** Typing indicator debounce delay (ms) */
const TYPING_DEBOUNCE_MS = 500;

/** Default preferences */
const DEFAULT_PREFERENCES: ChatPreferences = {
	soundEnabled: true,
	notificationsEnabled: false,
	defaultCollapsed: true,
};

// =============================================================================
// Store Implementation
// =============================================================================

/**
 * Create a reactive chat store
 *
 * @param userId - Current user's ID
 * @param displayName - Current user's display name
 * @param connection - Chat connection service (roomService or spectatorService)
 */
export function createChatStore(
	userId: string,
	displayName: string,
	connection: ChatConnection,
): ChatStore {
	// -------------------------------------------------------------------------
	// Core State
	// -------------------------------------------------------------------------

	let messages = $state<ChatMessageWithMeta[]>([]);
	let typingUsers = $state<TypingState[]>([]);
	let unreadCount = $state(0);
	let error = $state<{ code: ChatErrorCode; message: string } | null>(null);
	let isOpen = $state(false);
	let isTyping = $state(false);
	let _lastMessageTime = $state(0);
	let preferences = $state<ChatPreferences>(loadPreferences());

	// Shout state
	let activeShouts = $state<Map<string, ShoutMessage>>(new Map());
	let shoutCooldownMs = $state(0);

	// Internal state
	let typingTimeout: ReturnType<typeof setTimeout> | null = null;
	let typingDebounce: ReturnType<typeof setTimeout> | null = null;
	let cooldownInterval: ReturnType<typeof setInterval> | null = null;
	let shoutCooldownInterval: ReturnType<typeof setInterval> | null = null;
	const shoutDismissTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
	let sendCooldownValue = $state(0);
	let pendingMessageId = 0;

	// -------------------------------------------------------------------------
	// Derived State
	// -------------------------------------------------------------------------

	const canSendMessage = $derived(sendCooldownValue <= 0 && connection.isConnected);

	const sendCooldown = $derived(sendCooldownValue);

	const hasUnread = $derived(unreadCount > 0);

	const typingText = $derived.by(() => {
		// Filter out current user from typing users
		const others = typingUsers.filter((t) => t.userId !== userId);
		if (others.length === 0) return null;
		if (others.length === 1) return `${others[0].displayName} is typing...`;
		if (others.length === 2) {
			return `${others[0].displayName} and ${others[1].displayName} are typing...`;
		}
		return `${others[0].displayName} and ${others.length - 1} others are typing...`;
	});

	const messageGroups = $derived.by(() => {
		return groupMessages(messages);
	});

	const maxMessageLength = CHAT_RATE_LIMITS.MAX_MESSAGE_LENGTH;

	// Shout derived state (only available if connection supports shouts)
	const canShout = $derived(
		shoutCooldownMs <= 0 && connection.isConnected && !!connection.sendShout,
	);
	const shoutCooldownSeconds = $derived(Math.ceil(shoutCooldownMs / 1000));
	const maxShoutLength = SHOUT_MAX_LENGTH;

	// -------------------------------------------------------------------------
	// Event Handler
	// -------------------------------------------------------------------------

	const handleServerEvent: ChatConnectionEventHandler = (event) => {
		// Handle shout events first
		if (isShoutEvent(event)) {
			const shoutEvent = event as ShoutReceivedEvent | ShoutCooldownEvent;

			switch (shoutEvent.type) {
				case 'SHOUT_RECEIVED':
					handleShoutReceived(shoutEvent.payload);
					break;

				case 'SHOUT_COOLDOWN':
					handleShoutCooldown(shoutEvent.payload.remainingMs);
					break;
			}
			return;
		}

		// Only handle chat events
		if (!isChatEvent(event)) return;

		const chatEvent = event as ChatServerEvent;

		switch (chatEvent.type) {
			case 'CHAT_MESSAGE':
				handleNewMessage(chatEvent.payload);
				break;

			case 'CHAT_HISTORY':
				handleHistory(chatEvent.payload);
				break;

			case 'REACTION_UPDATE':
				handleReactionUpdate(chatEvent.payload.messageId, chatEvent.payload.reactions);
				break;

			case 'TYPING_UPDATE':
				handleTypingUpdate(chatEvent.payload.typing);
				break;

			case 'CHAT_ERROR':
				handleError(chatEvent.payload.code, chatEvent.payload.message);
				break;
		}
	};

	// Register event handler
	connection.addEventHandler(handleServerEvent);

	// -------------------------------------------------------------------------
	// Event Handlers
	// -------------------------------------------------------------------------

	function handleNewMessage(message: ChatMessage): void {
		// Check if this is confirming a pending message from us
		const pendingIndex = messages.findIndex(
			(m) => m.isPending && m.userId === message.userId && m.content === message.content,
		);

		if (pendingIndex !== -1) {
			// Replace pending with confirmed
			messages = [
				...messages.slice(0, pendingIndex),
				{ ...message, isPending: false },
				...messages.slice(pendingIndex + 1),
			];
		} else {
			// Add new message
			messages = [...messages, message];

			// Increment unread if chat is closed and not our message
			if (!isOpen && message.userId !== userId) {
				unreadCount++;
				playNotificationSound();
			}
		}
	}

	function handleHistory(history: ChatMessage[]): void {
		// Replace messages with history (clear any pending)
		messages = history;
		unreadCount = 0;
	}

	function handleReactionUpdate(messageId: string, reactions: MessageReactions): void {
		messages = messages.map((m) => (m.id === messageId ? { ...m, reactions } : m));
	}

	function handleTypingUpdate(typing: TypingState[]): void {
		typingUsers = typing;
	}

	function handleError(code: ChatErrorCode, message: string): void {
		error = { code, message };

		// Mark pending message as failed if rate limited
		if (code === 'RATE_LIMITED') {
			const pendingMsg = messages.find((m) => m.isPending);
			if (pendingMsg) {
				messages = messages.map((m) =>
					m.id === pendingMsg.id
						? { ...m, isPending: false, isFailed: true, errorMessage: message }
						: m,
				);
			}
		}

		// Auto-clear error after 5 seconds
		setTimeout(() => {
			if (error?.code === code) {
				error = null;
			}
		}, 5000);
	}

	// -------------------------------------------------------------------------
	// Shout Event Handlers
	// -------------------------------------------------------------------------

	function handleShoutReceived(shout: ShoutMessage): void {
		// Clear any existing timeout for this user
		const existingTimeout = shoutDismissTimeouts.get(shout.userId);
		if (existingTimeout) {
			clearTimeout(existingTimeout);
		}

		// Add the shout to active shouts
		const newShouts = new Map(activeShouts);
		newShouts.set(shout.userId, shout);
		activeShouts = newShouts;

		// Schedule auto-dismiss based on expiration time
		const dismissIn = Math.max(0, shout.expiresAt - Date.now());
		const timeout = setTimeout(() => {
			dismissShout(shout.userId, shout.id);
		}, dismissIn);
		shoutDismissTimeouts.set(shout.userId, timeout);
	}

	function handleShoutCooldown(remainingMs: number): void {
		// Set cooldown from server response
		startShoutCooldown(remainingMs);
	}

	function dismissShout(userId: string, shoutId: string): void {
		// Only dismiss if the shout ID matches (hasn't been replaced)
		const current = activeShouts.get(userId);
		if (current?.id === shoutId) {
			const newShouts = new Map(activeShouts);
			newShouts.delete(userId);
			activeShouts = newShouts;
		}
		shoutDismissTimeouts.delete(userId);
	}

	function startShoutCooldown(initialMs: number = SHOUT_COOLDOWN_MS): void {
		shoutCooldownMs = initialMs;

		if (shoutCooldownInterval) {
			clearInterval(shoutCooldownInterval);
		}

		shoutCooldownInterval = setInterval(() => {
			shoutCooldownMs = Math.max(0, shoutCooldownMs - 1000);
			if (shoutCooldownMs <= 0 && shoutCooldownInterval) {
				clearInterval(shoutCooldownInterval);
				shoutCooldownInterval = null;
			}
		}, 1000);
	}

	// -------------------------------------------------------------------------
	// Actions
	// -------------------------------------------------------------------------

	function sendMessage(content: string): void {
		const trimmed = content.trim();
		if (!trimmed || !canSendMessage) return;
		if (trimmed.length > maxMessageLength) return;

		// Create optimistic message
		const optimisticId = `pending-${++pendingMessageId}`;
		const optimisticMessage: ChatMessageWithMeta = {
			id: optimisticId,
			type: 'text',
			userId,
			displayName,
			content: trimmed,
			timestamp: Date.now(),
			reactions: createEmptyReactions(),
			isPending: true,
		};

		// Add to messages immediately (optimistic)
		messages = [...messages, optimisticMessage];

		// Send to server
		try {
			connection.sendChatMessage(trimmed);
			_lastMessageTime = Date.now();
			startCooldown();
		} catch (_e) {
			// Mark as failed
			messages = messages.map((m) =>
				m.id === optimisticId
					? { ...m, isPending: false, isFailed: true, errorMessage: 'Failed to send' }
					: m,
			);
		}

		// Stop typing indicator
		setTyping(false);
	}

	function sendQuickChat(key: QuickChatKey): void {
		if (!canSendMessage) return;

		const preset = QUICK_CHAT_MESSAGES[key];
		if (!preset) return;

		// Create optimistic message
		const optimisticId = `pending-${++pendingMessageId}`;
		const optimisticMessage: ChatMessageWithMeta = {
			id: optimisticId,
			type: 'quick',
			userId,
			displayName,
			content: `${preset.emoji} ${preset.text}`,
			timestamp: Date.now(),
			reactions: createEmptyReactions(),
			isPending: true,
		};

		messages = [...messages, optimisticMessage];

		try {
			connection.sendQuickChat(key);
			_lastMessageTime = Date.now();
			startCooldown();
		} catch (_e) {
			messages = messages.map((m) =>
				m.id === optimisticId
					? { ...m, isPending: false, isFailed: true, errorMessage: 'Failed to send' }
					: m,
			);
		}
	}

	function toggleReaction(messageId: string, emoji: ReactionEmoji): void {
		const message = messages.find((m) => m.id === messageId);
		if (!message || message.isPending) return;

		// Determine action based on current state
		const hasReacted = message.reactions[emoji].includes(userId);
		const action = hasReacted ? 'remove' : 'add';

		// Optimistic update
		messages = messages.map((m) => {
			if (m.id !== messageId) return m;
			const newReactions = { ...m.reactions };
			if (action === 'add') {
				newReactions[emoji] = [...newReactions[emoji], userId];
			} else {
				newReactions[emoji] = newReactions[emoji].filter((id) => id !== userId);
			}
			return { ...m, reactions: newReactions };
		});

		// Send to server
		try {
			connection.sendReaction(messageId, emoji, action);
		} catch (e) {
			// Revert on error (will be corrected by server event anyway)
			log.error('Failed to send reaction', e as Error);
		}
	}

	/** Starts typing indicator with auto-timeout */
	function startTypingIndicator(): void {
		connection.sendTypingStart();
		if (typingTimeout) clearTimeout(typingTimeout);
		typingTimeout = setTimeout(() => {
			isTyping = false;
			connection.sendTypingStop();
		}, CHAT_RATE_LIMITS.TYPING_TIMEOUT_MS);
	}

	/** Stops typing indicator and clears timeout */
	function stopTypingIndicator(): void {
		if (typingTimeout) {
			clearTimeout(typingTimeout);
			typingTimeout = null;
		}
		connection.sendTypingStop();
	}

	function setTyping(typing: boolean): void {
		// Debounce rapid typing state changes
		if (typingDebounce) {
			clearTimeout(typingDebounce);
		}

		typingDebounce = setTimeout(() => {
			if (typing === isTyping) return;
			isTyping = typing;

			try {
				if (typing) {
					startTypingIndicator();
				} else {
					stopTypingIndicator();
				}
			} catch (_e) {
				// Ignore typing errors
			}
		}, TYPING_DEBOUNCE_MS);
	}

	function markAsRead(): void {
		unreadCount = 0;
	}

	function toggleOpen(): void {
		isOpen = !isOpen;
		if (isOpen) {
			markAsRead();
		}
	}

	function setOpen(open: boolean): void {
		isOpen = open;
		if (open) {
			markAsRead();
		}
	}

	function updatePreferences(prefs: Partial<ChatPreferences>): void {
		preferences = { ...preferences, ...prefs };
		savePreferences(preferences);
	}

	function clear(): void {
		messages = [];
		typingUsers = [];
		unreadCount = 0;
		error = null;
		// Clear shout state
		activeShouts = new Map();
		shoutCooldownMs = 0;
		for (const timeout of shoutDismissTimeouts.values()) {
			clearTimeout(timeout);
		}
		shoutDismissTimeouts.clear();
	}

	function retryMessage(messageId: string): void {
		const failedMsg = messages.find((m) => m.id === messageId && m.isFailed);
		if (!failedMsg) return;

		// Remove the failed message
		messages = messages.filter((m) => m.id !== messageId);

		// Resend
		if (failedMsg.type === 'quick') {
			// Extract quick chat key from content (hacky but works)
			const key = Object.keys(QUICK_CHAT_MESSAGES).find((k) => {
				const preset = QUICK_CHAT_MESSAGES[k as QuickChatKey];
				return failedMsg.content === `${preset.emoji} ${preset.text}`;
			}) as QuickChatKey | undefined;

			if (key) {
				sendQuickChat(key);
			}
		} else {
			sendMessage(failedMsg.content);
		}
	}

	function removeFailedMessage(messageId: string): void {
		messages = messages.filter((m) => m.id !== messageId);
	}

	function sendShout(content: string): void {
		const trimmed = content.trim();
		if (!trimmed || !canShout) return;
		if (trimmed.length > maxShoutLength) return;

		// sendShout is optional (only available for players, not spectators)
		if (!connection.sendShout) {
			log.warn('Shout not available for this connection type');
			return;
		}

		try {
			connection.sendShout(trimmed);
			// Start cooldown optimistically
			startShoutCooldown();
		} catch (_e) {
			log.error('Failed to send shout');
		}
	}

	function getShoutForUser(userId: string): ShoutMessage | undefined {
		return activeShouts.get(userId);
	}

	function destroy(): void {
		connection.removeEventHandler(handleServerEvent);
		if (typingTimeout) clearTimeout(typingTimeout);
		if (typingDebounce) clearTimeout(typingDebounce);
		if (cooldownInterval) clearInterval(cooldownInterval);
		if (shoutCooldownInterval) clearInterval(shoutCooldownInterval);
		// Clear all shout dismiss timeouts
		for (const timeout of shoutDismissTimeouts.values()) {
			clearTimeout(timeout);
		}
		shoutDismissTimeouts.clear();
	}

	// -------------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------------

	function startCooldown(): void {
		sendCooldownValue = Math.ceil(CHAT_RATE_LIMITS.MESSAGE_INTERVAL_MS / 1000);

		if (cooldownInterval) clearInterval(cooldownInterval);

		cooldownInterval = setInterval(() => {
			sendCooldownValue--;
			if (sendCooldownValue <= 0) {
				if (cooldownInterval) {
					clearInterval(cooldownInterval);
					cooldownInterval = null;
				}
			}
		}, 1000);
	}

	function playNotificationSound(): void {
		if (!preferences.soundEnabled) return;

		// Create a simple notification sound using Web Audio API
		try {
			const audioContext = new (
				window.AudioContext ||
				(window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
			)();
			const oscillator = audioContext.createOscillator();
			const gainNode = audioContext.createGain();

			oscillator.connect(gainNode);
			gainNode.connect(audioContext.destination);

			oscillator.frequency.value = 800;
			oscillator.type = 'sine';

			gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
			gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

			oscillator.start(audioContext.currentTime);
			oscillator.stop(audioContext.currentTime + 0.1);
		} catch (_e) {
			// Audio not available
		}
	}

	// -------------------------------------------------------------------------
	// Return Store Interface
	// -------------------------------------------------------------------------

	return {
		// State
		get messages() {
			return messages;
		},
		get typingUsers() {
			return typingUsers;
		},
		get unreadCount() {
			return unreadCount;
		},
		get error() {
			return error;
		},
		get isOpen() {
			return isOpen;
		},
		get preferences() {
			return preferences;
		},
		get activeShouts() {
			return activeShouts;
		},
		get shoutCooldownMs() {
			return shoutCooldownMs;
		},

		// Derived
		get canSendMessage() {
			return canSendMessage;
		},
		get sendCooldown() {
			return sendCooldown;
		},
		get hasUnread() {
			return hasUnread;
		},
		get typingText() {
			return typingText;
		},
		get messageGroups() {
			return messageGroups;
		},
		get maxMessageLength() {
			return maxMessageLength;
		},
		get isTyping() {
			return isTyping;
		},
		get canShout() {
			return canShout;
		},
		get shoutCooldownSeconds() {
			return shoutCooldownSeconds;
		},
		get maxShoutLength() {
			return maxShoutLength;
		},

		// Actions
		sendMessage,
		sendQuickChat,
		toggleReaction,
		setTyping,
		markAsRead,
		toggleOpen,
		setOpen,
		updatePreferences,
		clear,
		retryMessage,
		removeFailedMessage,
		sendShout,
		getShoutForUser,
		destroy,
	};
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Group messages by user and time for efficient rendering
 */
function groupMessages(messages: ChatMessageWithMeta[]): MessageGroup[] {
	const groups: MessageGroup[] = [];
	let currentGroup: MessageGroup | null = null;

	for (const message of messages) {
		const isSystem = message.type === 'system';
		const shouldStartNewGroup =
			!currentGroup ||
			currentGroup.userId !== message.userId ||
			currentGroup.isSystem !== isSystem ||
			message.timestamp - currentGroup.timestamp > MESSAGE_GROUP_WINDOW_MS;

		if (shouldStartNewGroup) {
			currentGroup = {
				userId: message.userId,
				displayName: message.displayName,
				isSystem,
				messages: [message],
				timestamp: message.timestamp,
			};
			groups.push(currentGroup);
		} else if (currentGroup) {
			currentGroup.messages.push(message);
		}
	}

	return groups;
}

/**
 * Load preferences from localStorage
 */
function loadPreferences(): ChatPreferences {
	if (typeof window === 'undefined') return DEFAULT_PREFERENCES;

	try {
		const stored = localStorage.getItem(PREFERENCES_STORAGE_KEY);
		if (stored) {
			return { ...DEFAULT_PREFERENCES, ...JSON.parse(stored) };
		}
	} catch (_e) {
		// Ignore localStorage errors
	}

	return DEFAULT_PREFERENCES;
}

/**
 * Save preferences to localStorage
 */
function savePreferences(prefs: ChatPreferences): void {
	if (typeof window === 'undefined') return;

	try {
		localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(prefs));
	} catch (_e) {
		// Ignore localStorage errors
	}
}

// =============================================================================
// Context Helpers
// =============================================================================

/**
 * Set chat store in component context
 */
export function setChatStore(store: ChatStore): void {
	setContext(CHAT_CONTEXT_KEY, store);
}

/**
 * Get chat store from component context
 */
export function getChatStore(): ChatStore {
	const store = getContext<ChatStore>(CHAT_CONTEXT_KEY);
	if (!store) {
		throw new Error('Chat store not found in context. Did you forget to call setChatStore?');
	}
	return store;
}

/**
 * Get chat store from context if available
 */
export function getChatStoreOptional(): ChatStore | undefined {
	return getContext<ChatStore>(CHAT_CONTEXT_KEY);
}

// =============================================================================
// Utility Exports
// =============================================================================

export type { ChatMessage, QuickChatKey, ReactionEmoji, ShoutMessage, TypingState };
export {
	CHAT_RATE_LIMITS,
	QUICK_CHAT_MESSAGES,
	REACTION_EMOJIS,
	SHOUT_COOLDOWN_MS,
	SHOUT_DISPLAY_DURATION_MS,
	SHOUT_MAX_LENGTH,
};
