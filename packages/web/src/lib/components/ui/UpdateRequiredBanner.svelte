<script lang="ts">
/**
 * UpdateRequiredBanner Component
 *
 * Shown when the game backend closed a socket with 4426 upgrade_required:
 * - reloading: the page is reloading to fetch the current app
 * - updating: a reload happened moments ago and the new app is still rolling out
 */

interface Props {
	status: 'reloading' | 'updating';
	/** Reload the page again after the rollout settles */
	onRetry: () => void;
}

let { status, onRetry }: Props = $props();

function handleRetry(): void {
	onRetry();
}
</script>

<div class="update-banner" role="alert" aria-live="assertive">
	{#if status === 'reloading'}
		<span class="spinner" aria-hidden="true"></span>
		<span class="banner-text">Dicee was updated. Reloading…</span>
	{:else}
		<span class="banner-text">Dicee is updating. Try again in a minute.</span>
		<button type="button" class="retry-btn" onclick={handleRetry}>Try again</button>
	{/if}
</div>

<style>
	.update-banner {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 10000;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		font-size: var(--text-small);
		font-weight: var(--weight-semibold);
		background: var(--color-warning-light, #fff3cd);
		color: var(--color-warning-dark, #856404);
		border-bottom: 2px solid var(--color-warning, #ffc107);
	}

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.retry-btn {
		padding: var(--space-1) var(--space-2);
		font: inherit;
		color: inherit;
		background: transparent;
		border: 2px solid currentColor;
		cursor: pointer;
	}
</style>
