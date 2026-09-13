<script lang="ts">
import { untrack } from 'svelte';

/**
 * ScorecardLegend Component
 *
 * Collapsible tooltip explaining the statistical indicators on the scorecard.
 * Helps users understand what EV, optimal markers, and heat bars mean.
 */

interface Props {
	/** Whether to show expanded by default */
	defaultExpanded?: boolean;
}

let { defaultExpanded = false }: Props = $props();

let expanded = $state(untrack(() => defaultExpanded));

function toggle() {
	expanded = !expanded;
}
</script>

<div class="legend" class:expanded>
	<button class="toggle" onclick={toggle} aria-expanded={expanded} aria-label="Stats guide">
		<span class="icon">?</span>
		{#if !expanded}
			<span class="label">Stats guide</span>
		{/if}
	</button>

	{#if expanded}
		<div class="content">
			<button class="close" onclick={toggle} aria-label="Close">×</button>

			<div class="item">
				<span class="sample potential">24</span>
				<span class="description">Points if you select this now</span>
			</div>

			<div class="item">
				<span class="sample heat-bar-sample">
					<span class="heat-bar-fill"></span>
				</span>
				<span class="description">Expected value (longer = better)</span>
			</div>

			<div class="item">
				<span class="sample optimal">★</span>
				<span class="description">Best choice based on math</span>
			</div>

			<div class="item">
				<span class="sample ev">EV: 18.5</span>
				<span class="description">Average score with optimal play</span>
			</div>

			<div class="item">
				<span class="sample delta positive">▲+5.2</span>
				<span class="description">Above expected (good!)</span>
			</div>

			<div class="item">
				<span class="sample delta negative">▼-3.1</span>
				<span class="description">Below expected (not ideal)</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.legend {
		position: relative;
	}

	.toggle {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		background: var(--color-surface);
		border: var(--border-thin);
		cursor: pointer;
		font-family: inherit;
		font-size: var(--text-small);
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast);
	}

	.toggle:hover {
		background: var(--color-background);
		border-color: var(--color-accent);
	}

	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: var(--color-accent);
		color: var(--color-surface);
		border-radius: 50%;
		font-size: var(--text-tiny);
		font-weight: var(--weight-bold);
	}

	.label {
		color: var(--color-text-muted);
	}

	.content {
		position: absolute;
		top: 100%;
		right: 0;
		z-index: 100;
		width: 260px;
		margin-top: var(--space-1);
		padding: var(--space-2);
		background: var(--color-surface);
		border: var(--border-thick);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.close {
		position: absolute;
		top: var(--space-1);
		right: var(--space-1);
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		cursor: pointer;
		font-size: var(--text-h3);
		color: var(--color-text-muted);
	}

	.close:hover {
		color: var(--color-text);
	}

	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--color-background);
	}

	.item:last-child {
		border-bottom: none;
	}

	.sample {
		flex-shrink: 0;
		min-width: 50px;
		text-align: center;
		font-family: var(--font-mono);
		font-size: var(--text-small);
	}

	.description {
		font-size: var(--text-tiny);
		color: var(--color-text-muted);
	}

	.potential {
		color: var(--color-text-muted);
		font-style: italic;
		font-weight: var(--weight-medium);
		animation: potential-glow 2s ease-in-out infinite;
	}

	@keyframes potential-glow {
		0%,
		100% {
			text-shadow: none;
			opacity: 0.8;
		}
		50% {
			text-shadow: 0 0 6px var(--color-accent);
			opacity: 1;
		}
	}

	.heat-bar-sample {
		display: block;
		width: 50px;
		height: 12px;
		background: var(--color-background);
		position: relative;
	}

	.heat-bar-fill {
		position: absolute;
		left: 0;
		top: 0;
		height: 100%;
		width: 70%;
		background: var(--color-accent);
		opacity: 0.3;
	}

	.optimal {
		color: var(--color-accent);
		font-weight: var(--weight-bold);
	}

	.ev {
		color: var(--color-text-muted);
		font-size: var(--text-tiny);
	}

	.delta {
		font-size: var(--text-tiny);
		font-weight: var(--weight-semibold);
		padding: 1px 4px;
		border-radius: 2px;
	}

	.delta.positive {
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 15%, transparent);
	}

	.delta.negative {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 15%, transparent);
	}

	/* Reduced motion */
	@media (prefers-reduced-motion: reduce) {
		.potential {
			animation: none;
			opacity: 1;
		}
	}
</style>
