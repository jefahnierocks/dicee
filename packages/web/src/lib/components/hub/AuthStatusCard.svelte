<script lang="ts">
/**
 * AuthStatusCard - Hub auth status card
 *
 * Shows guest status or user profile summary.
 * Clicking opens bottom sheet for auth options.
 *
 * Note: Named AuthStatusCard to avoid conflict with AuthHeader
 * which is used in the game header.
 */
import { goto } from '$app/navigation';
import GoogleButton from '$lib/components/auth/GoogleButton.svelte';
import MagicLinkForm from '$lib/components/auth/MagicLinkForm.svelte';
import { BottomSheet } from '$lib/components/ui';
import { auth } from '$lib/stores/auth.svelte';

let sheetOpen = $state(false);

// Derived auth state
const isSignedIn = $derived(auth.isAuthenticated && !auth.isAnonymous);
const displayName = $derived(() => {
	if (!auth.user) return 'Guest';
	if (auth.isAnonymous) return 'Guest';
	return (
		(auth.user.user_metadata?.display_name as string | undefined) ||
		`Player-${auth.user.id.slice(0, 6)}`
	);
});

function handleClick() {
	if (isSignedIn) {
		// Navigate to profile
		goto('/profile');
	} else {
		// Open auth options
		sheetOpen = true;
	}
}
</script>

<button class="auth-card" onclick={handleClick}>
	{#if !isSignedIn}
		<!-- Guest State -->
		<div class="guest-avatar">
			<svg
				class="icon"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
				<circle cx="12" cy="7" r="4" />
			</svg>
		</div>
		<span class="guest-label">Guest</span>
		<span class="guest-hint">Tap to sign in</span>
	{:else}
		<!-- Authenticated State -->
		<div class="profile-header">
			<span class="profile-label">PROFILE</span>
			<div class="profile-avatar">
				<svg
					class="icon-sm"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
					<circle cx="12" cy="7" r="4" />
				</svg>
			</div>
		</div>

		<div class="profile-name">{displayName()}</div>

		<div class="profile-stats">
			<div class="stat-row">
				<span class="stat-label">Games</span>
				<span class="stat-value">—</span>
			</div>
			<div class="stat-row">
				<span class="stat-label">Best</span>
				<span class="stat-value">—</span>
			</div>
		</div>
	{/if}
</button>

<!-- Auth Options Bottom Sheet -->
<BottomSheet open={sheetOpen} onClose={() => (sheetOpen = false)} title="Sign In">
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

<style>
	.auth-card {
		width: 100%;
		height: 100%;
		border: var(--border-thick);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-brutal);
		padding: var(--space-3);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		cursor: pointer;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.auth-card:hover {
		box-shadow: var(--shadow-brutal-lg);
		transform: translate(-2px, -2px);
	}

	.auth-card:active {
		box-shadow: 2px 2px 0 0 var(--color-text);
		transform: translate(2px, 2px);
	}

	/* Guest State */
	.guest-avatar {
		width: 3rem;
		height: 3rem;
		border: var(--border-thick);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-background);
	}

	.icon {
		width: 1.5rem;
		height: 1.5rem;
		color: var(--color-text-muted);
	}

	.guest-label {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		color: var(--color-text-muted);
	}

	/* Authenticated State */
	.profile-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		margin-bottom: var(--space-1);
	}

	.profile-label {
		font-family: var(--font-mono);
		font-size: var(--text-tiny);
		color: var(--color-text-muted);
	}

	.profile-avatar {
		width: 2rem;
		height: 2rem;
		border: var(--border-thick);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-text);
	}

	.icon-sm {
		width: 1rem;
		height: 1rem;
		color: var(--color-surface);
	}

	.profile-stats {
		display: flex;
		flex-direction: column;
		gap: var(--space-0);
		width: 100%;
		text-align: left;
	}

	.stat-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.stat-label {
		font-size: var(--text-tiny);
		color: var(--color-text-muted);
	}

	.stat-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
	}

	.guest-hint {
		font-family: var(--font-mono);
		font-size: var(--text-tiny);
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.profile-name {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: var(--weight-medium);
		text-align: center;
		margin-bottom: var(--space-1);
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
