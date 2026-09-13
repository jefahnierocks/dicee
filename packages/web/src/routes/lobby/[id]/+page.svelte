<script lang="ts">
/**
 * /lobby/[id] - Parameterized Lobby Route
 *
 * Joins a specific room by code from URL.
 * Shows loading state while connecting, then RoomLobby when connected.
 * Redirects to game page when game starts.
 */

import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { page } from '$app/stores';
import RoomLobby from '$lib/components/lobby/RoomLobby.svelte';
import { roomService } from '$lib/services/roomService.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { createChatStore, setChatStore } from '$lib/stores/chat.svelte';
import { createRoomStore, setRoomStore } from '$lib/stores/room.svelte';
import { isValidRoomCode } from '$lib/types/multiplayer.schema';

// Get room code from URL
const roomCode = $derived($page.params.id?.toUpperCase() ?? '');

// Validate room code format
const isValidCode = $derived(roomCode.length === 6 && isValidRoomCode(roomCode));

// Create room store when we have a valid user
const roomStore = $derived(auth.userId ? createRoomStore(auth.userId) : null);

// Track connection state
let connecting = $state(false);
let error = $state<string | null>(null);
let hasAttemptedJoin = $state(false);

// Derive display name from user metadata (same logic as LobbyLanding)
const displayName = $derived.by(() => {
	const user = auth.user;
	if (!user) return 'Guest';
	if (auth.isAnonymous) return 'Guest';
	return (user.user_metadata?.display_name as string) || `Player-${user.id.slice(0, 6)}`;
});

// Create chat store when we have a valid user
// Lobby uses roomService for chat
const chatStore = $derived.by(() => {
	if (!auth.userId) return null;
	return createChatStore(auth.userId, displayName, roomService);
});

// Set chat store in context when available
$effect(() => {
	if (chatStore) {
		setChatStore(chatStore);
	}
});

// Set room store in context when available
$effect(() => {
	if (roomStore) {
		setRoomStore(roomStore);
	}
});

// Auto-join room on mount
onMount(() => {
	if (!auth.initialized) return;

	// Wait for auth to initialize, then join
	const unsubscribe = $effect.root(() => {
		$effect(() => {
			if (auth.initialized && !hasAttemptedJoin) {
				attemptJoin();
			}
		});
	});

	return unsubscribe;
});

async function attemptJoin() {
	if (hasAttemptedJoin) return;
	hasAttemptedJoin = true;

	// Check auth
	if (!auth.isAuthenticated || !auth.session?.access_token) {
		error = 'Please sign in to join a room';
		return;
	}

	// Check room code
	if (!isValidCode) {
		error = 'Invalid room code format';
		return;
	}

	// Check room store
	if (!roomStore) {
		error = 'Unable to initialize room connection';
		return;
	}

	// Already connected to this room?
	if (roomStore.isConnected && roomStore.roomCode === roomCode) {
		return;
	}

	connecting = true;
	error = null;

	try {
		await roomStore.joinRoom(roomCode, auth.session.access_token);
	} catch (e) {
		error = e instanceof Error ? e.message : 'Failed to join room';
		console.error('Join room error:', e);
	} finally {
		connecting = false;
	}
}

function handleGameStart() {
	// Navigate to multiplayer game page
	goto(`/game/${roomCode.toLowerCase()}`);
}

function handleLeave() {
	// Navigate back to lobby selection
	goto('/lobby');
}

function handleRetry() {
	hasAttemptedJoin = false;
	error = null;
	attemptJoin();
}

function handleSignIn() {
	// Store return URL and redirect to sign in
	goto(`/?returnTo=/lobby/${roomCode.toLowerCase()}`);
}

// Derived states for UI
const isConnected = $derived(roomStore?.isConnected ?? false);
const isConnecting = $derived(connecting || (roomStore?.isConnecting ?? false));
const showLobby = $derived(isConnected && roomStore?.roomCode === roomCode);
</script>

<svelte:head>
	<title>Room {roomCode} | Dicee</title>
</svelte:head>

<main class="lobby-page">
	{#if !auth.initialized}
		<!-- Loading auth -->
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Loading...</p>
		</div>
	{:else if !auth.isAuthenticated}
		<!-- Not signed in -->
		<div class="auth-required">
			<h1 class="page-title">JOIN ROOM</h1>
			<p class="room-code-display">{roomCode}</p>
			<p class="message">Sign in to join this room</p>
			<button type="button" class="action-button" onclick={handleSignIn}>
				SIGN IN
			</button>
			<a href="/" class="back-link">← Back to Home</a>
		</div>
	{:else if !isValidCode}
		<!-- Invalid room code -->
		<div class="error-state">
			<h1 class="page-title">INVALID CODE</h1>
			<p class="message">"{roomCode}" is not a valid room code</p>
			<p class="hint">Room codes are 6 characters (letters and numbers)</p>
			<a href="/lobby" class="action-button">GO TO LOBBY</a>
		</div>
	{:else if isConnecting}
		<!-- Connecting -->
		<div class="loading-state">
			<div class="spinner"></div>
			<p class="connecting-text">Joining room...</p>
			<p class="room-code-display">{roomCode}</p>
		</div>
	{:else if error}
		<!-- Error state -->
		<div class="error-state">
			<h1 class="page-title">COULDN'T JOIN</h1>
			<p class="room-code-display">{roomCode}</p>
			<p class="error-message" role="alert">{error}</p>
			<div class="error-actions">
				<button type="button" class="action-button" onclick={handleRetry}>
					TRY AGAIN
				</button>
				<a href="/lobby" class="secondary-link">Back to Lobby</a>
			</div>
		</div>
	{:else if showLobby && roomStore}
		<!-- Connected - show room lobby -->
		<RoomLobby onleave={handleLeave} ongamestart={handleGameStart} />
	{:else}
		<!-- Fallback loading -->
		<div class="loading-state">
			<div class="spinner"></div>
			<p>Connecting...</p>
		</div>
	{/if}
</main>

<style>
	.lobby-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: var(--space-3);
	}

	/* Loading State */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		text-align: center;
	}

	.spinner {
		width: 3rem;
		height: 3rem;
		border: 4px solid var(--color-border);
		border-top-color: var(--color-accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.connecting-text {
		font-size: var(--text-body);
		color: var(--color-text-muted);
	}

	/* Common Elements */
	.page-title {
		font-size: var(--text-h1);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		margin-bottom: var(--space-2);
	}

	.room-code-display {
		font-family: var(--font-mono);
		font-size: var(--text-h2);
		font-weight: var(--weight-bold);
		letter-spacing: 0.15em;
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface);
		border: var(--border-thick);
	}

	.message {
		font-size: var(--text-body);
		color: var(--color-text-muted);
		margin: var(--space-2) 0;
	}

	.hint {
		font-size: var(--text-small);
		color: var(--color-text-muted);
		margin-bottom: var(--space-3);
	}

	/* Auth Required State */
	.auth-required {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		text-align: center;
	}

	/* Error State */
	.error-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		text-align: center;
	}

	.error-message {
		font-size: var(--text-body);
		color: var(--color-danger);
		padding: var(--space-2);
		background: rgba(239, 68, 68, 0.1);
		border: var(--border-thin);
		border-color: var(--color-danger);
		max-width: 300px;
	}

	.error-actions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	/* Buttons */
	.action-button {
		min-width: 200px;
		min-height: var(--touch-target-comfortable);
		padding: var(--space-2) var(--space-3);
		background: var(--color-accent);
		border: var(--border-thick);
		font-size: var(--text-body);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		text-decoration: none;
		text-align: center;
		cursor: pointer;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.action-button:hover {
		transform: translate(-2px, -2px);
		box-shadow: 4px 4px 0 var(--color-border);
	}

	.action-button:active {
		transform: translate(0, 0);
		box-shadow: none;
	}

	.back-link,
	.secondary-link {
		font-size: var(--text-body);
		color: var(--color-text-muted);
		text-decoration: none;
		margin-top: var(--space-2);
		transition: color var(--transition-fast);
	}

	.back-link:hover,
	.secondary-link:hover {
		color: var(--color-text);
	}
</style>
