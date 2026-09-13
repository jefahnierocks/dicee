<script lang="ts">
/**
 * /games/dicee/room/[code] - Multiplayer Game Room
 *
 * Unified entry point for both players and spectators.
 * Use ?mode=spectator to join as spectator.
 *
 * Entry points:
 * 1. Direct join as player (default)
 * 2. ?mode=spectator - explicit spectator join
 * 3. Server downgrade - player → spectator if game started/full
 */

import { onDestroy } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { MultiplayerGameView } from '$lib/components/game';
import { SpectatorView } from '$lib/components/spectator';
import { roomService } from '$lib/services/roomService.svelte';
import { spectatorService } from '$lib/services/spectatorService.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { type ChatConnection, createChatStore, setChatStore } from '$lib/stores/chat.svelte';
import {
	createMultiplayerGameStore,
	setMultiplayerGameStore,
} from '$lib/stores/multiplayerGame.svelte';
import { createRoomStore, setRoomStore } from '$lib/stores/room.svelte';
import { createSpectatorStore, setSpectatorStore } from '$lib/stores/spectator.svelte';

// =============================================================================
// State
// =============================================================================

// Get room code and mode from URL
const roomCode = $derived($page.params.code?.toUpperCase() ?? '');
const requestedMode = $derived($page.url.searchParams.get('mode') ?? 'player');

// Actual role (may differ from requested if downgraded)
let actualRole = $state<'player' | 'spectator'>('player');

// Stores (created based on role)
let gameStore = $state<ReturnType<typeof createMultiplayerGameStore> | null>(null);
let spectatorStore = $state<ReturnType<typeof createSpectatorStore> | null>(null);
let chatStore = $state<ReturnType<typeof createChatStore> | null>(null);
let roomStore = $state<ReturnType<typeof createRoomStore> | null>(null);

// Connection state
let isConnecting = $state(true);
let connectionError = $state<string | null>(null);
let wasDowngraded = $state(false);

// Quick play state (from LobbyLanding)
let quickPlayAIProfiles = $state<string[]>([]);
let quickPlayAutoStart = $state(false);

// =============================================================================
// Connection Logic
// =============================================================================

$effect(() => {
	if (!auth.initialized) return;

	// Redirect if not authenticated
	if (!auth.isAuthenticated || !auth.userId) {
		goto('/lobby');
		return;
	}

	// Already connected or connecting
	if (gameStore || spectatorStore || connectionError) return;

	// Determine initial role
	actualRole = requestedMode === 'spectator' ? 'spectator' : 'player';

	// Get display name
	const user = auth.user;
	const displayName = auth.isAnonymous
		? 'Guest'
		: (user?.user_metadata?.display_name as string) || `Player-${auth.userId.slice(0, 6)}`;

	// Create chat store with appropriate connection based on role
	// Spectators use spectatorService, players use roomService
	const chatConnection: ChatConnection =
		actualRole === 'spectator' ? spectatorService : roomService;
	chatStore = createChatStore(auth.userId, displayName, chatConnection);
	setChatStore(chatStore);

	// Check for quick play mode (from LobbyLanding)
	const profilesJson = sessionStorage.getItem('quickplay_ai_profiles');
	if (profilesJson) {
		try {
			quickPlayAIProfiles = JSON.parse(profilesJson);
		} catch {
			quickPlayAIProfiles = ['carmen']; // Fallback to default
		}
	}
	quickPlayAutoStart = sessionStorage.getItem('quickplay_auto_start') === 'true';

	console.log('[Room] Quick play check:', { quickPlayAIProfiles, quickPlayAutoStart });

	// Clear the flags so they don't persist
	sessionStorage.removeItem('quickplay_ai_profiles');
	sessionStorage.removeItem('quickplay_auto_start');

	// Connect based on role
	connectToRoom(actualRole);
});

async function connectToRoom(role: 'player' | 'spectator'): Promise<void> {
	try {
		const session = auth.session;
		if (!session?.access_token) {
			connectionError = 'No valid session';
			isConnecting = false;
			return;
		}

		if (role === 'spectator') {
			// Connect as spectator
			spectatorStore = createSpectatorStore(auth.userId!);
			setSpectatorStore(spectatorStore);
			await spectatorService.connect(roomCode, session.access_token);
		} else {
			// Connect as player (may be downgraded to spectator)
			gameStore = createMultiplayerGameStore(auth.userId!);
			setMultiplayerGameStore(gameStore);

			// Create and set room store (needed by RoomLobby)
			roomStore = createRoomStore(auth.userId!);
			setRoomStore(roomStore);

			// Set up quick play handler BEFORE connecting
			if (quickPlayAIProfiles.length > 0 && quickPlayAutoStart) {
				setupQuickPlayHandler();
			}

			// Use store's joinRoom method to ensure roomCode is synced properly
			await roomStore.joinRoom(roomCode, session.access_token);
		}

		isConnecting = false;
	} catch (error) {
		connectionError = error instanceof Error ? error.message : 'Failed to connect';
		isConnecting = false;
	}
}

/**
 * Set up event handler for quick play mode.
 * Uses QUICK_PLAY_START command to skip waiting room entirely.
 * Human always goes first, game starts immediately in playing phase.
 */
function setupQuickPlayHandler(): void {
	let hasStarted = false;

	const handler = (event: { type: string }) => {
		const eventType = event.type as string;

		// When we get CONNECTED (room ready), immediately start quick play
		// Server sends CONNECTED, not room.state
		if ((eventType === 'CONNECTED' || eventType === 'room.state') && !hasStarted) {
			hasStarted = true;
			console.log('[QuickPlay] Room ready, starting quick play with AI:', quickPlayAIProfiles);
			// Send quick play start command - this creates AI and starts game in one step
			roomService.sendQuickPlayStart(quickPlayAIProfiles);
			// Clean up handler
			roomService.removeEventHandler(handler);
		}
	};

	roomService.addEventHandler(handler);
}

// =============================================================================
// Visibility Handler (Phone Wake Reconnection)
// =============================================================================

$effect(() => {
	// Handle visibility changes for immediate reconnection on phone wake
	const handleVisibilityChange = () => {
		if (document.visibilityState === 'visible') {
			console.log('[Room] Page visible - checking connection');
			if (actualRole === 'spectator') {
				spectatorService.triggerReconnect();
			} else {
				roomService.triggerReconnect();
			}
		}
	};

	document.addEventListener('visibilitychange', handleVisibilityChange);

	return () => {
		document.removeEventListener('visibilitychange', handleVisibilityChange);
	};
});

// =============================================================================
// Cleanup
// =============================================================================

onDestroy(() => {
	if (actualRole === 'spectator') {
		spectatorService.disconnect();
	} else {
		roomService.disconnect();
	}
	gameStore?.reset();
	chatStore?.destroy();
});

// =============================================================================
// Handlers
// =============================================================================

function handleLeave(): void {
	if (actualRole === 'spectator') {
		spectatorService.disconnect();
	} else {
		roomService.disconnect();
	}
	goto('/lobby');
}
</script>

<svelte:head>
	<title>{actualRole === 'spectator' ? 'Watching' : 'Game'} {roomCode} | Dicee</title>
</svelte:head>

{#if isConnecting}
	<div class="loading-state">
		<div class="loading-content">
			<p class="loading-text">
				{requestedMode === 'spectator' ? 'Connecting as spectator...' : 'Connecting to game...'}
			</p>
			<p class="room-code">{roomCode}</p>
		</div>
	</div>
{:else if connectionError}
	<div class="error-state">
		<div class="error-content">
			<h2 class="error-title">
				{actualRole === 'spectator' ? 'Cannot Watch' : 'Connection Failed'}
			</h2>
			<p class="error-message">{connectionError}</p>
			<button class="back-btn" onclick={() => goto('/lobby')}>
				Back to Lobby
			</button>
		</div>
	</div>
{:else if wasDowngraded}
	<!-- Show notice when player was downgraded to spectator -->
	<div class="downgrade-notice">
		<p>Game in progress - joined as spectator</p>
	</div>
	{#if spectatorStore}
		<SpectatorView store={spectatorStore} chatStore={chatStore ?? undefined} onLeave={handleLeave} />
	{/if}
{:else if actualRole === 'spectator' && spectatorStore}
	<SpectatorView store={spectatorStore} chatStore={chatStore ?? undefined} onLeave={handleLeave} />
{:else if actualRole === 'player' && gameStore}
	<MultiplayerGameView store={gameStore} chatStore={chatStore ?? undefined} onLeave={handleLeave} isQuickPlay={quickPlayAutoStart} />
{:else}
	<div class="error-state">
		<div class="error-content">
			<h2 class="error-title">Error</h2>
			<p class="error-message">Unable to initialize game</p>
			<button class="back-btn" onclick={() => goto('/lobby')}>
				Back to Lobby
			</button>
		</div>
	</div>
{/if}

<style>
	.loading-state,
	.error-state {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--space-3);
		background: var(--color-background);
	}

	.loading-content,
	.error-content {
		text-align: center;
		padding: var(--space-4);
		background: var(--color-surface);
		border: var(--border-thick);
		max-width: 400px;
		width: 100%;
	}

	.loading-text {
		font-size: var(--text-body);
		margin: 0 0 var(--space-2);
	}

	.room-code {
		font-family: var(--font-mono);
		font-size: var(--text-h2);
		font-weight: var(--weight-black);
		letter-spacing: var(--tracking-widest);
		margin: 0;
	}

	.error-title {
		font-size: var(--text-h2);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		margin: 0 0 var(--space-2);
	}

	.error-message {
		font-size: var(--text-body);
		color: var(--color-text-muted);
		margin: 0 0 var(--space-3);
	}

	.back-btn {
		padding: var(--space-2) var(--space-4);
		font-size: var(--text-body);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		background: var(--color-accent);
		border: var(--border-thick);
		cursor: pointer;
		transition:
			transform var(--transition-fast),
			background var(--transition-fast);
	}

	.back-btn:hover {
		background: var(--color-accent-dark);
		transform: translateY(-2px);
	}

	.back-btn:active {
		transform: translateY(0);
	}

	.downgrade-notice {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		padding: var(--space-2);
		background: var(--color-warning);
		color: var(--color-text);
		text-align: center;
		font-size: var(--text-small);
		font-weight: var(--weight-bold);
		z-index: 100;
	}
</style>
