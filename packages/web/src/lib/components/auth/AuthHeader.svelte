<script lang="ts">
/**
 * AuthHeader - Header auth status display
 *
 * Shows user info and sign out button for authenticated users.
 * Used in the game header for auth state display.
 * Note: Renamed from AuthStatus to avoid conflict with Hub's AuthStatusCard.
 */
import { auth } from '$lib/stores/auth.svelte';

interface Props {
	class?: string;
}

let { class: className = '' }: Props = $props();
let signingOut = $state(false);

async function handleSignOut() {
	signingOut = true;
	try {
		await auth.signOut();
	} catch {
		console.error('Sign out failed');
	} finally {
		signingOut = false;
	}
}

const displayName = $derived(() => {
	if (!auth.user) return null;
	if (auth.isAnonymous) return 'Guest';
	return (
		(auth.user.user_metadata?.display_name as string | undefined) ||
		`Player-${auth.user.id.slice(0, 6)}`
	);
});
</script>

{#if auth.isAuthenticated}
	<div class="auth-status {className}">
		<span class="user-info">
			{#if auth.isAnonymous}
				<span class="guest-badge">Guest</span>
			{:else}
				<span class="user-name">{displayName()}</span>
			{/if}
		</span>

		<button
			type="button"
			class="sign-out-button"
			onclick={handleSignOut}
			disabled={signingOut}
			aria-busy={signingOut}
		>
			{signingOut ? '...' : 'Sign Out'}
		</button>
	</div>
{/if}

<style>
	.auth-status {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.user-info {
		font-family: var(--font-sans);
		font-size: var(--text-small);
		color: var(--color-text);
	}

	.guest-badge {
		padding: 2px var(--space-1);
		background: var(--color-accent-light);
		border: 1px solid var(--color-border);
		font-size: var(--text-tiny);
		font-weight: var(--weight-medium);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wide);
	}

	.user-name {
		font-weight: var(--weight-medium);
	}

	.sign-out-button {
		padding: var(--space-1) var(--space-1);
		min-height: 32px;

		background: transparent;
		color: var(--color-text-muted);
		border: var(--border-thin);

		font-family: var(--font-sans);
		font-size: var(--text-tiny);
		font-weight: var(--weight-medium);

		cursor: pointer;
		transition: color var(--transition-fast), border-color var(--transition-fast);
	}

	.sign-out-button:hover:not(:disabled) {
		color: var(--color-text);
		border-color: var(--color-text);
	}

	.sign-out-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.sign-out-button:focus-visible {
		outline: 2px solid var(--color-border);
		outline-offset: 2px;
	}
</style>
