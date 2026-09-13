<script lang="ts">
/**
 * SetupModal - First-time profile setup modal
 *
 * Displays as an overlay modal for new users to set up their profile.
 * Includes ProfileForm and skip option for anonymous users.
 *
 * Design: Neo-Brutalist modal with hard borders, overlay backdrop
 */

import { untrack } from 'svelte';
import Avatar from '$lib/components/ui/Avatar.svelte';
import { createSupabaseBrowserClient } from '$lib/supabase/client';
import { type Profile, updateProfile } from '$lib/supabase/profiles';

interface Props {
	/** User profile to set up */
	profile: Profile;
	/** Whether the modal is open */
	open?: boolean;
	/** Whether to show skip option (for anonymous users) */
	allowSkip?: boolean;
	/** Callback when setup is complete */
	onComplete?: (profile: Profile) => void;
	/** Callback when user skips setup */
	onSkip?: () => void;
	/** Callback when modal is closed */
	onClose?: () => void;
}

let { profile, open = true, allowSkip = true, onComplete, onSkip, onClose }: Props = $props();

// Form state
let displayName = $state(untrack(() => profile.display_name || ''));
let bio = $state(untrack(() => profile.bio || ''));
let loading = $state(false);
let error = $state<string | null>(null);

// Validation
const displayNameValid = $derived(
	displayName.trim().length >= 2 && displayName.trim().length <= 50,
);
const bioValid = $derived(bio.length <= 500);
const formValid = $derived(displayNameValid && bioValid);

// Check if this is truly a new profile (no display name set)
const isNewProfile = $derived(!profile.display_name);

async function handleSubmit(e: Event) {
	e.preventDefault();
	error = null;

	if (!formValid) {
		error = 'Please fix validation errors';
		return;
	}

	loading = true;

	try {
		const supabase = createSupabaseBrowserClient();
		const { data, error: updateError } = await updateProfile(supabase, profile.id, {
			display_name: displayName.trim(),
			bio: bio.trim() || null,
		});

		if (updateError) {
			throw updateError;
		}

		if (data) {
			onComplete?.(data);
		}
	} catch (e) {
		error = e instanceof Error ? e.message : 'Failed to save profile';
		console.error('Profile setup error:', e);
	} finally {
		loading = false;
	}
}

function handleSkip() {
	onSkip?.();
}

function handleBackdropClick(e: MouseEvent) {
	// Only close if clicking the backdrop, not the modal content
	if (e.target === e.currentTarget) {
		onClose?.();
	}
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === 'Escape' && allowSkip) {
		onClose?.();
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
	<!-- Modal Backdrop - click to close is intentional UX pattern -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="modal-backdrop" role="presentation" onclick={handleBackdropClick}>
		<!-- Modal Content -->
		<div
			class="modal"
			role="dialog"
			aria-modal="true"
			aria-labelledby="setup-title"
		>
			<!-- Header -->
			<header class="modal-header">
				<h2 id="setup-title" class="modal-title">
					{isNewProfile ? 'Welcome to Dicee!' : 'Update Your Profile'}
				</h2>
				<p class="modal-subtitle">
					{isNewProfile
						? 'Set up your profile to get started'
						: 'Keep your profile up to date'}
				</p>
			</header>

			<!-- Avatar Preview -->
			<div class="avatar-section">
				<Avatar seed={profile.id} size="xl" alt={displayName || 'Your avatar'} />
				<p class="avatar-hint">Your unique avatar</p>
			</div>

			<!-- Form -->
			<form class="setup-form" onsubmit={handleSubmit}>
				<!-- Display Name -->
				<div class="form-group">
					<label for="setup-display-name" class="form-label">
						Display Name
						<span class="required" aria-label="required">*</span>
					</label>
					<input
						id="setup-display-name"
						type="text"
						bind:value={displayName}
						placeholder="What should we call you?"
						required
						minlength="2"
						maxlength="50"
						disabled={loading}
						class="form-input"
						class:invalid={displayName.length > 0 && !displayNameValid}
					/>
					<div class="form-hint">
						{#if displayName.length > 0 && !displayNameValid}
							<span class="error-text">Must be 2-50 characters</span>
						{:else}
							<span class="char-count">{displayName.length}/50</span>
						{/if}
					</div>
				</div>

				<!-- Bio (Optional) -->
				<div class="form-group">
					<label for="setup-bio" class="form-label">Bio (optional)</label>
					<textarea
						id="setup-bio"
						bind:value={bio}
						placeholder="Tell us a bit about yourself..."
						maxlength="500"
						rows="3"
						disabled={loading}
						class="form-textarea"
						class:invalid={!bioValid}
					></textarea>
					<div class="form-hint">
						{#if !bioValid}
							<span class="error-text">Maximum 500 characters</span>
						{:else}
							<span class="char-count">{bio.length}/500</span>
						{/if}
					</div>
				</div>

				<!-- Error Message -->
				{#if error}
					<div class="error-message" role="alert">
						<span class="error-icon">✕</span>
						<span>{error}</span>
					</div>
				{/if}

				<!-- Actions -->
				<div class="form-actions">
					{#if allowSkip}
						<button
							type="button"
							onclick={handleSkip}
							disabled={loading}
							class="button button--secondary"
						>
							Skip for now
						</button>
					{/if}
					<button
						type="submit"
						disabled={loading || !formValid}
						class="button button--primary"
					>
						{#if loading}
							Saving...
						{:else}
							{isNewProfile ? "Let's Go!" : 'Save'}
						{/if}
					</button>
				</div>
			</form>

			<!-- Privacy Note -->
			<p class="privacy-note">
				Your display name will be visible to other players.
			</p>
		</div>
	</div>
{/if}

<style>
	/* Modal Backdrop */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 500;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-2);
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(2px);
	}

	/* Modal Container */
	.modal {
		width: 100%;
		max-width: 480px;
		max-height: 90vh;
		overflow-y: auto;
		background: var(--color-surface);
		border: var(--border-thick);
		box-shadow: 8px 8px 0 var(--color-border);
	}

	/* Header */
	.modal-header {
		padding: var(--space-3);
		border-bottom: var(--border-medium);
		text-align: center;
	}

	.modal-title {
		font-size: var(--text-h2);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--color-text);
		margin: 0;
	}

	.modal-subtitle {
		font-size: var(--text-body);
		color: var(--color-text-muted);
		margin: var(--space-1) 0 0 0;
	}

	/* Avatar Section */
	.avatar-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-3);
		background: var(--color-background);
	}

	.avatar-hint {
		font-size: var(--text-small);
		color: var(--color-text-muted);
		margin: 0;
	}

	/* Form */
	.setup-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding: var(--space-3);
	}

	/* Form Groups */
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.form-label {
		font-size: var(--text-body);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.required {
		color: var(--color-danger);
		margin-left: 4px;
	}

	/* Form Inputs */
	.form-input,
	.form-textarea {
		width: 100%;
		padding: var(--space-1) var(--space-2);
		background: var(--color-surface);
		color: var(--color-text);
		border: var(--border-medium);
		font-family: var(--font-sans);
		font-size: var(--text-body);
		transition: border-color var(--transition-fast);
	}

	.form-input {
		min-height: var(--touch-target-min);
	}

	.form-textarea {
		resize: vertical;
		min-height: 80px;
	}

	.form-input::placeholder,
	.form-textarea::placeholder {
		color: var(--color-text-muted);
	}

	.form-input:focus,
	.form-textarea:focus {
		outline: none;
		border-color: var(--color-accent);
		box-shadow: 0 0 0 3px var(--color-accent-light);
	}

	.form-input:disabled,
	.form-textarea:disabled {
		background: var(--color-background);
		cursor: not-allowed;
		opacity: 0.6;
	}

	.form-input.invalid,
	.form-textarea.invalid {
		border-color: var(--color-danger);
	}

	/* Form Hints */
	.form-hint {
		display: flex;
		justify-content: flex-end;
		font-size: var(--text-small);
		min-height: 18px;
	}

	.char-count {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.error-text {
		color: var(--color-danger);
	}

	/* Error Message */
	.error-message {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2);
		background: var(--color-danger);
		color: var(--color-surface);
		border: var(--border-medium);
		border-color: var(--color-danger);
	}

	.error-icon {
		font-size: var(--text-h3);
		font-weight: var(--weight-bold);
	}

	/* Form Actions */
	.form-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
		margin-top: var(--space-1);
	}

	.button {
		min-height: var(--touch-target-min);
		padding: var(--space-1) var(--space-3);
		border: var(--border-medium);
		font-family: var(--font-sans);
		font-size: var(--text-body);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition:
			transform var(--transition-fast),
			box-shadow var(--transition-fast);
	}

	.button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.button:focus-visible {
		outline: 3px solid var(--color-accent);
		outline-offset: 2px;
	}

	.button--primary {
		background: var(--color-accent);
		color: var(--color-text);
		border-color: var(--color-border);
	}

	.button--primary:hover:not(:disabled) {
		transform: translate(-2px, -2px);
		box-shadow: 3px 3px 0 var(--color-border);
	}

	.button--primary:active:not(:disabled) {
		transform: translate(0, 0);
		box-shadow: none;
	}

	.button--secondary {
		background: var(--color-surface);
		color: var(--color-text-muted);
	}

	.button--secondary:hover:not(:disabled) {
		background: var(--color-background);
		color: var(--color-text);
	}

	/* Privacy Note */
	.privacy-note {
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-small);
		color: var(--color-text-muted);
		text-align: center;
		border-top: var(--border-thin);
		margin: 0;
	}

	/* Mobile: Stack buttons */
	@media (max-width: 480px) {
		.form-actions {
			flex-direction: column-reverse;
		}

		.button {
			width: 100%;
		}
	}
</style>
