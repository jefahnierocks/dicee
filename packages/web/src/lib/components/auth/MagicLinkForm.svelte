<script lang="ts">
/**
 * MagicLinkForm - Passwordless email sign-in
 *
 * Sends a magic link to the user's email for authentication.
 * Can be used for both sign-in and linking to anonymous accounts.
 */
import { auth } from '$lib/stores/auth.svelte';

interface Props {
	mode?: 'signin' | 'link';
	redirectTo?: string;
	class?: string;
}

let { mode = 'signin', redirectTo, class: className = '' }: Props = $props();
let email = $state('');
let error = $state<string | null>(null);
let success = $state(false);

const buttonText = $derived(mode === 'link' ? 'Link Email' : 'Send Magic Link');
const placeholderText = $derived(mode === 'link' ? 'user@example.com' : 'Enter your email');

async function handleSubmit(e: Event) {
	e.preventDefault();
	error = null;
	success = false;

	if (!email.trim()) {
		error = 'Please enter your email';
		return;
	}

	try {
		if (mode === 'link') {
			await auth.linkEmail(email);
		} else {
			await auth.signInWithEmail(email, redirectTo);
		}
		success = true;
	} catch (e) {
		error = e instanceof Error ? e.message : 'Failed to send email';
		console.error('Magic link error:', e);
	}
}
</script>

<form class="magic-link-form {className}" onsubmit={handleSubmit}>
	{#if success}
		<div class="success-message" role="status">
			<span class="success-icon">✓</span>
			<span class="success-text">Check your email for a sign-in link!</span>
		</div>
	{:else}
		<div class="input-group">
			<label for="magic-link-email" class="visually-hidden">Email address</label>
			<input
				id="magic-link-email"
				type="email"
				bind:value={email}
				placeholder={placeholderText}
				required
				disabled={auth.loading}
				autocomplete="email"
				class="email-input"
			/>
			<button type="submit" disabled={auth.loading} class="submit-button">
				{#if auth.loading}
					Sending...
				{:else}
					{buttonText}
				{/if}
			</button>
		</div>

		{#if error}
			<p class="error-message" role="alert">{error}</p>
		{/if}
	{/if}
</form>

<style>
	.magic-link-form {
		width: 100%;
	}

	.input-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.email-input {
		/* Size */
		width: 100%;
		min-height: var(--touch-target-min);
		padding: var(--space-1) var(--space-2);

		/* Neo-Brutalist: Black border, no radius */
		background: var(--color-surface);
		color: var(--color-text);
		border: var(--border-medium);

		/* Typography */
		font-family: var(--font-sans);
		font-size: var(--text-body);
	}

	.email-input::placeholder {
		color: var(--color-text-muted);
	}

	.email-input:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-light);
	}

	.email-input:disabled {
		background: var(--color-background);
		cursor: not-allowed;
	}

	.submit-button {
		/* Size: Full width, comfortable touch target */
		width: 100%;
		min-height: var(--touch-target-min);
		padding: var(--space-1) var(--space-2);

		/* Neo-Brutalist: Black background, white text */
		background: var(--color-border);
		color: var(--color-surface);
		border: var(--border-medium);

		/* Typography */
		font-family: var(--font-sans);
		font-size: var(--text-body);
		font-weight: var(--weight-medium);

		/* Interaction */
		cursor: pointer;
		transition: transform var(--transition-fast), box-shadow var(--transition-fast);
	}

	.submit-button:hover:not(:disabled) {
		transform: translate(-2px, -2px);
		box-shadow: 3px 3px 0 var(--color-text-muted);
	}

	.submit-button:active:not(:disabled) {
		transform: translate(0, 0);
		box-shadow: none;
	}

	.submit-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.submit-button:focus-visible {
		outline: 3px solid var(--color-accent);
		outline-offset: 2px;
	}

	.success-message {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2);
		background: var(--color-success);
		color: var(--color-surface);
		border: var(--border-medium);
	}

	.success-icon {
		font-size: var(--text-h3);
		font-weight: var(--weight-bold);
	}

	.success-text {
		font-size: var(--text-body);
	}

	.error-message {
		margin-top: var(--space-1);
		padding: var(--space-1);
		font-size: var(--text-small);
		color: var(--color-danger);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* Desktop: Horizontal layout */
	@media (min-width: 768px) {
		.magic-link-form {
			max-width: 400px;
		}

		.input-group {
			flex-direction: row;
		}

		.email-input {
			flex: 1;
		}

		.submit-button {
			width: auto;
			white-space: nowrap;
		}
	}
</style>
