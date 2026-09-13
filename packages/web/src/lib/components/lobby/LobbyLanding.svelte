<script lang="ts">
/**
 * LobbyLanding - Main lobby landing page component
 *
 * Three clear game mode entry points:
 * 1. SOLO - Practice mode, single player (no opponents)
 * 2. QUICK PLAY - 1-3 AI opponents, skips waiting room
 * 3. MULTIPLAYER - Create/join rooms with humans and/or AI
 *
 * Also shows:
 * - Open games browser
 * - Global chat
 * - Online presence
 */

import { onMount } from 'svelte';
import { goto } from '$app/navigation';
import { AdminPanel } from '$lib/components/admin';
import GoogleButton from '$lib/components/auth/GoogleButton.svelte';
import MagicLinkForm from '$lib/components/auth/MagicLinkForm.svelte';
import { SettingsButton, SettingsPanel } from '$lib/components/settings';
import { BottomSheet } from '$lib/components/ui';
import { audioStore } from '$lib/stores/audio.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { lobby } from '$lib/stores/lobby.svelte';
import { profileStore } from '$lib/stores/profile.svelte';
import AIOpponentSelector from './AIOpponentSelector.svelte';
import ConnectionOverlay from './ConnectionOverlay.svelte';

// Auth sheet state
let authSheetOpen = $state(false);

// Settings panel state
let settingsOpen = $state(false);

// Quick Play AI selector state
let showAISelector = $state(false);
let selectedAIProfiles = $state<string[]>(['carmen']);
let quickPlayLoading = $state(false);

// Derive display name from user object
const displayName = $derived(() => {
	const user = auth.user;
	if (!user) return 'Guest';
	return (user.user_metadata?.display_name as string) || `Player-${user.id.slice(0, 6)}`;
});

// Admin panel state - uses RBAC from profile store
let showAdminPanel = $state(false);

// Show admin controls if user has moderator or higher role
// Only show after profile is loaded to avoid flicker
const canAccessAdmin = $derived(profileStore.initialized && profileStore.isModerator);

import CartridgeStack from './CartridgeStack.svelte';
import ChatPanel from './ChatPanel.svelte';
import CreateRoomModal from './CreateRoomModal.svelte';
import InvitePopup from './InvitePopup.svelte';
import JoinRequestPending from './JoinRequestPending.svelte';
import JoinRoomModal from './JoinRoomModal.svelte';
import MobileTabToggle from './MobileTabToggle.svelte';
import Ticker from './Ticker.svelte';

// Friends modal state
let showCreateModal = $state(false);
let showJoinModal = $state(false);

// Check if on mobile for responsive layout
let isMobile = $state(false);

onMount(() => {
	const mediaQuery = window.matchMedia('(max-width: 768px)');
	isMobile = mediaQuery.matches;

	const handler = (e: MediaQueryListEvent) => {
		isMobile = e.matches;
	};
	mediaQuery.addEventListener('change', handler);

	return () => mediaQuery.removeEventListener('change', handler);
});

/**
 * QUICK PLAY - Start a game with 1-3 AI opponents immediately
 * Shows AI selector, then creates room, adds AI, and starts game
 */
async function handleQuickPlay() {
	if (!auth.isAuthenticated) {
		authSheetOpen = true;
		return;
	}
	// Show AI selector for quick customization
	showAISelector = true;
}

/**
 * Start quick play with selected AI
 */
async function startQuickPlayWithAI() {
	if (!auth.session?.access_token) {
		authSheetOpen = true;
		return;
	}

	quickPlayLoading = true;
	try {
		// Generate room code
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		let code = '';
		for (let i = 0; i < 6; i++) {
			code += chars[Math.floor(Math.random() * chars.length)];
		}

		console.log('[QuickPlay] Starting with AI:', selectedAIProfiles, 'Room:', code);

		// Store AI profiles to add after connecting (JSON array for multi-AI)
		sessionStorage.setItem('quickplay_ai_profiles', JSON.stringify(selectedAIProfiles));
		sessionStorage.setItem('quickplay_auto_start', 'true');

		// Navigate to room - the room page will handle adding AI and starting
		goto(`/games/dicee/room/${code}`);
	} finally {
		quickPlayLoading = false;
		showAISelector = false;
	}
}

/**
 * MULTIPLAYER - Show create/join room options
 */
function handlePlayWithFriends() {
	if (!auth.isAuthenticated) {
		authSheetOpen = true;
		return;
	}
	showCreateModal = true;
}

/**
 * Create a new room for friends
 */
function handleCreateRoom() {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	for (let i = 0; i < 6; i++) {
		code += chars[Math.floor(Math.random() * chars.length)];
	}
	showCreateModal = false;
	goto(`/games/dicee/room/${code}`);
}

/**
 * Join an existing room
 */
function handleJoinRoom(code: string) {
	showJoinModal = false;
	goto(`/games/dicee/room/${code.toUpperCase()}`);
}

/**
 * SOLO - Single player practice mode
 */
function handlePractice() {
	goto('/games/dicee?mode=solo');
}

/**
 * Handle AI profile selection in quick play (multi-select)
 */
function handleAISelect(profileIds: string[]) {
	selectedAIProfiles = profileIds;
}

/**
 * Handle accepting an invite - navigate to the room
 */
function handleAcceptInvite(inviteId: string, roomCode: string) {
	lobby.respondToInvite(inviteId, roomCode, 'accept');
	goto(`/games/dicee/room/${roomCode}`);
}

/**
 * Handle declining an invite
 */
function handleDeclineInvite(inviteId: string) {
	lobby.dismissInvite(inviteId);
}
</script>

<ConnectionOverlay />

<div class="lobby-landing">
	<!-- Header -->
	<header class="lobby-header">
		<div class="header-left">
			<h1 class="logo">DICEE</h1>
			<button
				class="online-indicator"
				class:connected={lobby.connectionState === 'connected'}
				onclick={() => lobby.toggleOnlineUsers()}
				aria-expanded={lobby.showOnlineUsers}
				aria-label="Show online users"
			>
				<span class="status-dot"></span>
				{lobby.onlineDisplay}
			</button>

			<!-- Online Users Panel -->
			{#if lobby.showOnlineUsers}
				<div class="online-users-dropdown">
					<div class="online-users-panel">
						<header class="panel-header">
							<h3>Online Users ({lobby.onlineUsers.length})</h3>
							<button class="close-btn" onclick={() => lobby.closeOnlineUsers()}>×</button>
						</header>
						<ul class="users-list">
							{#each lobby.onlineUsers as user (user.userId)}
								<li class="user-item">
									<span class="user-avatar">👤</span>
									<span class="user-name">{user.displayName}</span>
								</li>
							{:else}
								<li class="user-item empty">Loading...</li>
							{/each}
						</ul>
					</div>
				</div>
			{/if}
		</div>
		<div class="header-right">
			<SettingsButton onclick={() => (settingsOpen = !settingsOpen)} isOpen={settingsOpen} />
			{#if auth.isAuthenticated}
				<a href="/profile" class="user-link">{displayName()}</a>
			{:else}
				<button class="auth-link" onclick={() => (authSheetOpen = true)}>Sign In</button>
			{/if}
		</div>

		<!-- Settings Panel (positioned absolutely) -->
		{#if settingsOpen}
			<div class="settings-dropdown">
				<SettingsPanel
					masterVolume={Math.round(audioStore.masterVolume * 100)}
					muted={audioStore.isMuted}
					hapticsEnabled={audioStore.hapticsEnabled}
					onVolumeChange={(v) => audioStore.setMasterVolume(v / 100)}
					onMuteChange={(m) => audioStore.setMuted(m)}
					onHapticsChange={(e) => audioStore.setHapticsEnabled(e)}
					onReset={() => audioStore.resetToDefaults()}
					onClose={() => (settingsOpen = false)}
				/>
			</div>
		{/if}
	</header>

	<!-- Ticker -->
	<Ticker />

	<!-- Game Mode Cards -->
	<section class="mode-cards">
		<!-- Solo - Practice your skills -->
		<button class="mode-card mode-card--tertiary" onclick={handlePractice}>
			<span class="mode-icon">👤</span>
			<span class="mode-title">SOLO</span>
			<span class="mode-subtitle">Practice your skills</span>
		</button>

		<!-- Quick Play - AI opponents -->
		<button class="mode-card mode-card--primary" onclick={handleQuickPlay}>
			<span class="mode-icon">🤖</span>
			<span class="mode-title">QUICK PLAY</span>
			<span class="mode-subtitle">Play against AI</span>
		</button>

		<!-- Multiplayer - Compete with friends -->
		<button class="mode-card mode-card--secondary" onclick={handlePlayWithFriends}>
			<span class="mode-icon">👥</span>
			<span class="mode-title">MULTIPLAYER</span>
			<span class="mode-subtitle">Compete with friends</span>
		</button>
	</section>

	<!-- Main Content -->
	<main class="lobby-main">
		<!-- Mobile Tab Toggle -->
		{#if isMobile}
			<div class="mobile-tabs">
				<MobileTabToggle gamesCount={lobby.rooms.length} />
			</div>
		{/if}

		<div class="lobby-content" class:mobile={isMobile}>
			<!-- Games Panel -->
			<section
				class="games-panel"
				class:hidden={isMobile && lobby.activeTab !== 'games'}
				aria-label="Game Rooms"
			>
				<div class="panel-header">
					<h2>Games</h2>
					<div class="panel-actions">
						{#if lobby.rooms.length > 0}
							<span class="room-counts">
								{#if lobby.openRooms.length > 0}
									<span class="count open">{lobby.openRooms.length} open</span>
								{/if}
								{#if lobby.playingRooms.length > 0}
									<span class="count live">{lobby.playingRooms.length} live</span>
								{/if}
							</span>
						{/if}
						{#if canAccessAdmin}
							<button
								class="admin-btn"
								onclick={() => (showAdminPanel = true)}
								title="Open admin panel"
							>
								Admin
							</button>
						{/if}
					</div>
				</div>

				<div class="room-stack-container">
					<CartridgeStack
						rooms={lobby.rooms}
						emptyMessage="No games available. Create one!"
					/>
				</div>
			</section>

			<!-- Chat Panel -->
			<section
				class="chat-section"
				class:hidden={isMobile && lobby.activeTab !== 'chat'}
				aria-label="Lobby Chat"
			>
				<ChatPanel />
			</section>
		</div>
	</main>
</div>

<!-- Auth Options Bottom Sheet -->
<BottomSheet open={authSheetOpen} onClose={() => (authSheetOpen = false)} title="Sign In">
	{#snippet children()}
		<div class="auth-options">
			<p class="auth-description">
				Sign in to save your stats and appear on leaderboards.
			</p>

			<div class="auth-buttons">
				<GoogleButton />

				<div class="divider">
					<span>or</span>
				</div>

				<MagicLinkForm />
			</div>

			<p class="auth-note">
				Already playing as guest? Your progress will be saved.
			</p>
		</div>
	{/snippet}
</BottomSheet>

<!-- Quick Play AI Selector Modal -->
{#if showAISelector}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="modal-backdrop"
		role="dialog"
		aria-modal="true"
		aria-labelledby="quickplay-modal-title"
		tabindex="-1"
		onclick={(e) => e.target === e.currentTarget && (showAISelector = false)}
	>
		<div class="modal-content">
			<header class="modal-header">
				<h2 id="quickplay-modal-title" class="modal-title">Quick Play</h2>
				<button
					type="button"
					class="modal-close"
					onclick={() => (showAISelector = false)}
					aria-label="Close"
				>
					✕
				</button>
			</header>

			<div class="modal-body">
				<p class="modal-description">Choose 1-3 AI opponents:</p>
				<AIOpponentSelector
					selected={selectedAIProfiles}
					onSelect={handleAISelect}
					maxSelection={3}
				/>
			</div>

			<footer class="modal-footer">
				<button
					type="button"
					class="cancel-btn"
					onclick={() => (showAISelector = false)}
				>
					Cancel
				</button>
				<button
					type="button"
					class="start-btn"
					onclick={startQuickPlayWithAI}
					disabled={quickPlayLoading}
				>
					{quickPlayLoading ? 'Starting...' : 'Start Game'}
				</button>
			</footer>
		</div>
	</div>
{/if}

<!-- Create/Join Room Modals -->
<CreateRoomModal
	open={showCreateModal}
	onClose={() => (showCreateModal = false)}
	onCreate={handleCreateRoom}
	onSwitchToJoin={() => {
		showCreateModal = false;
		showJoinModal = true;
	}}
/>

<JoinRoomModal
	open={showJoinModal}
	onClose={() => (showJoinModal = false)}
	onJoin={handleJoinRoom}
	onSwitchToCreate={() => {
		showJoinModal = false;
		showCreateModal = true;
	}}
/>

<!-- Invite Popup - shown when receiving an invite from another user -->
{#if lobby.currentInvite}
	<InvitePopup
		invite={lobby.currentInvite}
		onAccept={handleAcceptInvite}
		onDecline={handleDeclineInvite}
	/>
{/if}

<!-- Join Request Pending - shown when user has an active join request -->
{#if lobby.activeJoinRequest}
	<JoinRequestPending request={lobby.activeJoinRequest} />
{/if}

<!-- Admin Panel - shown for users with moderator+ role -->
<AdminPanel open={showAdminPanel} onClose={() => (showAdminPanel = false)} />

<style>
	.lobby-landing {
		min-height: 100vh;
		/* biome-ignore lint/suspicious/noDuplicateProperties: svh fallback */
		min-height: 100svh;
		display: flex;
		flex-direction: column;
		background: var(--color-background);
		/* Prevent pinch-zoom that corrupts iOS viewport */
		touch-action: manipulation;
	}

	/* Header */
	.lobby-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2) var(--space-3);
		border-bottom: var(--border-thick);
		background: var(--color-surface);
		position: relative;
	}

	/* Settings Dropdown */
	.settings-dropdown {
		position: absolute;
		top: 100%;
		right: var(--space-3);
		z-index: 100;
		margin-top: var(--space-2);
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: var(--space-3);
	}

	.logo {
		font-size: var(--text-h2);
		font-weight: var(--weight-black);
		letter-spacing: var(--tracking-widest);
		margin: 0;
	}

	.online-indicator {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-family: var(--font-mono);
		font-size: var(--text-tiny);
		color: var(--color-signal-muted);
		padding: 0.25rem 0.625rem;
		border: var(--border-thin);
		border-radius: var(--radius-sm);
		background: var(--color-background);
		cursor: pointer;
		transition: all var(--transition-fast);
	}

	.online-indicator:hover {
		background: var(--color-surface);
	}

	.online-indicator.connected {
		color: var(--color-signal-live);
		border-color: var(--color-signal-live);
	}

	/* Online Users Dropdown */
	.online-users-dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 100;
		margin-top: var(--space-2);
	}

	.online-users-panel {
		background: var(--color-surface);
		border: var(--border-thin);
		border-radius: var(--radius-md);
		min-width: 200px;
		max-width: 280px;
		box-shadow: var(--shadow-lg);
	}

	.online-users-panel .panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: var(--border-thin);
	}

	.online-users-panel .panel-header h3 {
		font-size: var(--text-small);
		font-weight: var(--weight-semibold);
		margin: 0;
	}

	.online-users-panel .close-btn {
		padding: var(--space-1);
		background: none;
		border: none;
		font-size: var(--text-h4);
		color: var(--color-text-muted);
		cursor: pointer;
		line-height: 1;
	}

	.online-users-panel .close-btn:hover {
		color: var(--color-text);
	}

	.users-list {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
		max-height: 200px;
		overflow-y: auto;
	}

	.user-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		font-size: var(--text-small);
		border-radius: var(--radius-sm);
	}

	.user-item:hover:not(.empty) {
		background: var(--color-background);
	}

	.user-item.empty {
		color: var(--color-text-muted);
		font-style: italic;
	}

	.user-avatar {
		font-size: var(--text-base);
	}

	.user-name {
		font-weight: var(--weight-medium);
	}

	.status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
	}

	.online-indicator.connected .status-dot {
		animation: pulse-dot 2s ease-in-out infinite;
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.5;
			transform: scale(1.2);
		}
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.user-link {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: var(--weight-semibold);
		color: var(--color-text);
		text-decoration: none;
		padding: var(--space-1) var(--space-2);
		border: var(--border-thin);
		transition: background var(--transition-fast);
	}

	.user-link:hover {
		background: var(--color-accent);
	}

	.auth-link {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		color: var(--color-text);
		background: var(--color-surface);
		padding: var(--space-1) var(--space-2);
		border: var(--border-medium);
		cursor: pointer;
		transition: background var(--transition-fast);
	}

	.auth-link:hover {
		background: var(--color-accent);
	}

	/* Main Content */
	.lobby-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.mobile-tabs {
		padding: var(--space-2);
	}

	.lobby-content {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr;
		gap: var(--space-2);
		padding: var(--space-2);
		overflow: hidden;
	}

	.lobby-content:not(.mobile) {
		grid-template-columns: 2fr 1fr;
	}

	/* Games Panel */
	.games-panel {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.games-panel.hidden {
		display: none;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: var(--space-2);
	}

	.panel-header h2 {
		font-size: var(--text-h3);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		margin: 0;
	}

	.room-counts {
		display: flex;
		gap: var(--space-2);
	}

	.room-counts .count {
		font-family: var(--font-mono);
		font-size: var(--text-tiny);
		font-weight: var(--weight-semibold);
		padding: 0.125rem 0.5rem;
		border: var(--border-thin);
		text-transform: uppercase;
	}

	.room-counts .count.open {
		background: var(--color-signal-live);
		border-color: var(--color-signal-live);
	}

	.room-counts .count.live {
		background: var(--color-accent);
		border-color: var(--color-accent);
	}

	.panel-actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.admin-btn {
		font-family: var(--font-mono);
		font-size: var(--text-tiny);
		font-weight: var(--weight-semibold);
		padding: 0.25rem 0.5rem;
		background: var(--color-danger);
		color: white;
		border: var(--border-thin);
		border-color: var(--color-danger);
		cursor: pointer;
		transition: opacity var(--transition-fast);
	}

	.admin-btn:hover:not(:disabled) {
		opacity: 0.8;
	}

	.admin-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.room-stack-container {
		flex: 1;
		overflow-y: auto;
		padding-bottom: var(--space-4);
	}

	/* Chat Section */
	.chat-section {
		display: flex;
		flex-direction: column;
		min-height: 300px;
		max-height: 100%;
		overflow: hidden;
	}

	.chat-section.hidden {
		display: none;
	}

	/* Mode Cards */
	.mode-cards {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
	}

	.mode-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-2);
		border: var(--border-thick);
		cursor: pointer;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.mode-card:hover {
		transform: translate(-2px, -2px);
		box-shadow: 4px 4px 0 var(--color-border);
	}

	.mode-card:active {
		transform: translate(0, 0);
		box-shadow: none;
	}

	.mode-card--primary {
		background: var(--color-success);
	}

	.mode-card--secondary {
		background: var(--color-primary);
		color: var(--color-text-on-primary, var(--color-text));
	}

	.mode-card--tertiary {
		background: var(--color-surface);
	}

	.mode-icon {
		font-size: var(--text-h2);
	}

	.mode-title {
		font-family: var(--font-mono);
		font-size: var(--text-body);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
	}

	.mode-subtitle {
		font-size: var(--text-tiny);
		color: var(--color-text-muted);
		text-align: center;
	}

	.mode-card--secondary .mode-subtitle {
		color: inherit;
		opacity: 0.8;
	}

	/* Modal Styles */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: var(--z-modal);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
		background: rgba(0, 0, 0, 0.7);
	}

	.modal-content {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 600px;
		max-height: 90vh;
		overflow: hidden;
		background: var(--color-background);
		border: var(--border-thick);
		box-shadow: 8px 8px 0 var(--color-border);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-2) var(--space-3);
		border-bottom: var(--border-medium);
		background: var(--color-surface);
	}

	.modal-title {
		font-size: var(--text-h3);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		margin: 0;
	}

	.modal-close {
		appearance: none;
		background: none;
		border: var(--border-thin);
		padding: var(--space-1);
		font-size: var(--text-body);
		cursor: pointer;
		line-height: 1;
	}

	.modal-close:hover {
		background: var(--color-surface-alt);
	}

	.modal-body {
		flex: 1;
		overflow-y: auto;
		padding: var(--space-3);
	}

	.modal-description {
		font-size: var(--text-body);
		color: var(--color-text-muted);
		text-align: center;
		margin: 0 0 var(--space-2);
	}

	.modal-footer {
		flex-shrink: 0;
		position: sticky;
		bottom: 0;
		z-index: 1;
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
		padding: var(--space-2) var(--space-3);
		border-top: var(--border-medium);
		background: var(--color-surface);
	}

	.cancel-btn,
	.start-btn {
		padding: var(--space-1) var(--space-3);
		font-family: var(--font-sans);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
		cursor: pointer;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.cancel-btn {
		background: var(--color-surface);
		border: var(--border-medium);
	}

	.start-btn {
		background: var(--color-success);
		border: var(--border-medium);
	}

	.cancel-btn:hover,
	.start-btn:hover:not(:disabled) {
		transform: translate(-1px, -1px);
		box-shadow: 2px 2px 0 var(--color-border);
	}

	.start-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Mobile: Stack mode cards */
	@media (max-width: 640px) {
		.mode-cards {
			grid-template-columns: 1fr;
		}

		.mode-card {
			flex-direction: row;
			justify-content: flex-start;
			gap: var(--space-2);
			padding: var(--space-2);
		}

		.mode-icon {
			font-size: var(--text-h3);
		}

		.mode-card > :not(.mode-icon) {
			text-align: left;
		}

		.mode-subtitle {
			text-align: left;
		}
	}

	/* Desktop adjustments */
	@media (min-width: 768px) {
		.lobby-content {
			padding: var(--space-3);
			max-width: 1200px;
			margin: 0 auto;
			width: 100%;
		}

		.chat-section {
			min-height: 400px;
		}

		.mode-cards {
			max-width: 1200px;
			margin: 0 auto;
		}
	}

	/* Large desktop */
	@media (min-width: 1024px) {
		.lobby-content {
			grid-template-columns: 2fr 1fr;
		}
	}

	/* Auth Options in Bottom Sheet */
	.auth-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	.auth-description {
		font-size: var(--text-body);
		color: var(--color-text-muted);
		text-align: center;
		margin: 0;
	}

	.auth-buttons {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.divider {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
	}

	.divider::before,
	.divider::after {
		content: '';
		flex: 1;
		height: 1px;
		background: var(--color-border);
		opacity: 0.3;
	}

	.divider span {
		font-family: var(--font-mono);
		font-size: var(--text-tiny);
		text-transform: uppercase;
	}

	.auth-note {
		font-size: var(--text-small);
		color: var(--color-text-muted);
		text-align: center;
		margin: 0;
	}
</style>
