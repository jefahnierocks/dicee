<script lang="ts">
/**
 * Multiplayer Game Page
 *
 * Route: /game/[code]
 * Handles game session for a specific room code.
 */

import { onDestroy, onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import { MultiplayerGameView } from '$lib/components/game';
import { roomService } from '$lib/services/roomService.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { createChatStore, setChatStore } from '$lib/stores/chat.svelte';
import {
	createMultiplayerGameStore,
	setMultiplayerGameStore,
} from '$lib/stores/multiplayerGame.svelte';

// Get room code from URL params
const roomCode = $derived($page.params.code ?? '');

// Create game store when we have a user ID
let gameStore = $state<ReturnType<typeof createMultiplayerGameStore> | null>(null);
let chatStore = $state<ReturnType<typeof createChatStore> | null>(null);

// Connection state
let isConnecting = $state(true);
let connectionError = $state<string | null>(null);

onMount(async () => {
	// Redirect if not authenticated
	if (!auth.isAuthenticated || !auth.userId) {
		goto('/');
		return;
	}

	// Create game store
	gameStore = createMultiplayerGameStore(auth.userId);
	setMultiplayerGameStore(gameStore);

	// Create chat store with proper display name from user metadata
	const user = auth.user;
	const displayName = auth.isAnonymous
		? 'Guest'
		: (user?.user_metadata?.display_name as string) || `Player-${auth.userId.slice(0, 6)}`;
	chatStore = createChatStore(auth.userId, displayName, roomService);
	setChatStore(chatStore);

	// Connect to room
	try {
		const session = auth.session;
		if (!session?.access_token) {
			connectionError = 'No valid session';
			isConnecting = false;
			return;
		}

		await roomService.connect(roomCode as string, session.access_token);
		isConnecting = false;
	} catch (error) {
		connectionError = error instanceof Error ? error.message : 'Failed to connect';
		isConnecting = false;
	}
});

onDestroy(() => {
	// Disconnect from room when leaving
	roomService.disconnect();
	gameStore?.reset();
	chatStore?.destroy();
});

function handleLeave(): void {
	roomService.disconnect();
	goto('/lobby');
}

// Redirect if not authenticated
$effect(() => {
	if (auth.initialized && !auth.isAuthenticated) {
		goto('/');
	}
});
</script>

<svelte:head>
	<title>Game {roomCode} | Dicee</title>
</svelte:head>

{#if isConnecting}
	<div class="loading-state">
		<div class="loading-content">
			<p class="loading-text">Connecting to game...</p>
			<p class="room-code">{roomCode}</p>
		</div>
	</div>
{:else if connectionError}
	<div class="error-state">
		<div class="error-content">
			<h2 class="error-title">Connection Failed</h2>
			<p class="error-message">{connectionError}</p>
			<button class="back-btn" onclick={() => goto('/lobby')}>
				Back to Lobby
			</button>
		</div>
	</div>
{:else if gameStore}
	<MultiplayerGameView store={gameStore} onLeave={handleLeave} />
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
		/* Use svh for stable height (accounts for browser chrome) */
		min-height: 100vh;
		/* biome-ignore lint/suspicious/noDuplicateProperties: svh fallback */
		min-height: 100svh;
		padding: var(--space-3);
		background: var(--color-background);
		/* Prevent pinch-zoom that corrupts iOS viewport */
		touch-action: manipulation;
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
</style>
