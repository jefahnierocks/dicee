<script lang="ts">
/**
 * ProfileForm - User profile editing form
 *
 * Allows users to update their display name and bio.
 * Includes Avatar preview and form validation.
 */

import { untrack } from 'svelte';
import Avatar from '$lib/components/ui/Avatar.svelte';
import { createSupabaseBrowserClient } from '$lib/supabase/client';
import { type Profile, updateProfile } from '$lib/supabase/profiles';

interface Props {
	/** Current user profile */
	profile: Profile;
	/** Callback after successful update */
	onUpdate?: (profile: Profile) => void;
	/** Additional CSS classes */
	class?: string;
}

let { profile, onUpdate, class: className = '' }: Props = $props();

// Form state
let displayName = $state(untrack(() => profile.display_name || ''));
let bio = $state(untrack(() => profile.bio || ''));
let loading = $state(false);
let error = $state<string | null>(null);
let success = $state(false);

// Validation
const displayNameValid = $derived(
	displayName.trim().length >= 2 && displayName.trim().length <= 50,
);
const bioValid = $derived(bio.length <= 500);
const formValid = $derived(displayNameValid && bioValid);
const hasChanges = $derived(
	displayName !== (profile.display_name || '') || bio !== (profile.bio || ''),
);

async function handleSubmit(e: Event) {
	e.preventDefault();
	error = null;
	success = false;

	if (!formValid) {
		error = 'Please fix validation errors';
		return;
	}

	if (!hasChanges) {
		error = 'No changes to save';
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
			success = true;
			onUpdate?.(data);
			// Reset success message after 3 seconds
			setTimeout(() => {
				success = false;
			}, 3000);
		}
	} catch (e) {
		error = e instanceof Error ? e.message : 'Failed to update profile';
		console.error('Profile update error:', e);
	} finally {
		loading = false;
	}
}

function handleReset() {
	displayName = profile.display_name || '';
	bio = profile.bio || '';
	error = null;
	success = false;
}
</script>

<form class="profile-form {className}" onsubmit={handleSubmit}>
	<!-- Avatar Preview -->
	<div class="avatar-section">
		<Avatar seed={profile.id} size="lg" alt={displayName || 'Your avatar'} />
		<p class="avatar-hint">Your avatar is generated from your user ID</p>
	</div>

	<!-- Display Name -->
	<div class="form-group">
		<label for="display-name" class="form-label">
			Display Name
			<span class="required" aria-label="required">*</span>
		</label>
		<input
			id="display-name"
			type="text"
			bind:value={displayName}
			placeholder="Enter your display name"
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

	<!-- Bio -->
	<div class="form-group">
		<label for="bio" class="form-label">Bio</label>
		<textarea
			id="bio"
			bind:value={bio}
			placeholder="Tell us about yourself (optional)"
			maxlength="500"
			rows="4"
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

	<!-- Status Messages -->
	{#if error}
		<div class="error-message" role="alert">
			<span class="error-icon">✕</span>
			<span>{error}</span>
		</div>
	{/if}

	{#if success}
		<div class="success-message" role="status">
			<span class="success-icon">✓</span>
			<span>Profile updated successfully!</span>
		</div>
	{/if}

	<!-- Actions -->
	<div class="form-actions">
		<button
			type="button"
			onclick={handleReset}
			disabled={loading || !hasChanges}
			class="button button--secondary"
		>
			Reset
		</button>
		<button
			type="submit"
			disabled={loading || !formValid || !hasChanges}
			class="button button--primary"
		>
			{#if loading}
				Saving...
			{:else}
				Save Changes
			{/if}
		</button>
	</div>
</form>

<style>
	.profile-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
		max-width: 600px;
	}

	/* Avatar Section */
	.avatar-section {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-3);
		border: var(--border-medium);
		background: var(--color-surface);
	}

	.avatar-hint {
		font-size: var(--text-small);
		color: var(--color-text-muted);
		text-align: center;
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
		margin-left: var(--space-1);
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
		min-height: 120px;
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
		justify-content: space-between;
		align-items: center;
		font-size: var(--text-small);
		min-height: 20px;
	}

	.char-count {
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}

	.error-text {
		color: var(--color-danger);
	}

	/* Status Messages */
	.error-message,
	.success-message {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2);
		border: var(--border-medium);
	}

	.error-message {
		background: var(--color-danger);
		color: var(--color-surface);
	}

	.success-message {
		background: var(--color-success);
		color: var(--color-surface);
	}

	.error-icon,
	.success-icon {
		font-size: var(--text-h3);
		font-weight: var(--weight-bold);
	}

	/* Form Actions */
	.form-actions {
		display: flex;
		gap: var(--space-2);
		justify-content: flex-end;
	}

	.button {
		min-height: var(--touch-target-min);
		padding: var(--space-1) var(--space-3);
		border: var(--border-medium);
		font-family: var(--font-sans);
		font-size: var(--text-body);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition: transform var(--transition-fast), box-shadow var(--transition-fast);
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
		background: var(--color-border);
		color: var(--color-surface);
	}

	.button--primary:hover:not(:disabled) {
		transform: translate(-2px, -2px);
		box-shadow: 3px 3px 0 var(--color-text-muted);
	}

	.button--primary:active:not(:disabled) {
		transform: translate(0, 0);
		box-shadow: none;
	}

	.button--secondary {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.button--secondary:hover:not(:disabled) {
		background: var(--color-background);
	}

	/* Mobile: Stack buttons */
	@media (max-width: 767px) {
		.form-actions {
			flex-direction: column-reverse;
		}

		.button {
			width: 100%;
		}
	}
</style>
