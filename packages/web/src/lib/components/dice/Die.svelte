<script lang="ts">
import { untrack } from 'svelte';
import { audioStore } from '$lib/stores/audio.svelte';
import type { DieValue } from '$lib/types.js';
import { getDiceLandStyles, getDiceRollStyles, prefersReducedMotion } from '$lib/utils/dicePhysics';
import { haptic } from '$lib/utils/haptics';

interface Props {
	value: DieValue;
	kept?: boolean;
	disabled?: boolean;
	rolling?: boolean;
	/** Whether the die just landed (triggers land animation) */
	landing?: boolean;
	/** Whether this die is suggested to keep (coach mode highlight) */
	suggested?: boolean;
	/** Index of this die in the dice array (for staggered animations) */
	index?: number;
	/** Total number of dice (for animation spread) */
	totalDice?: number;
	onclick?: () => void;
}

let {
	value,
	kept = false,
	disabled = false,
	rolling = false,
	landing = false,
	suggested = false,
	index = 0,
	totalDice = 5,
	onclick,
}: Props = $props();

// Physics animation styles
const rollStyles = $derived(getDiceRollStyles(index, totalDice));
const landStyles = $derived(getDiceLandStyles(index));
const reducedMotion = $derived(prefersReducedMotion());

// Convert styles object to CSS variable string
function stylesToString(styles: Record<string, string>): string {
	return Object.entries(styles)
		.map(([key, value]) => `${key}: ${value}`)
		.join('; ');
}

// Track previous value for animation
let previousValue = $state(untrack(() => value));
let showValueChange = $state(false);

$effect(() => {
	if (value !== previousValue && !rolling) {
		showValueChange = true;
		previousValue = value;
		// Reset after animation
		const timeout = setTimeout(() => {
			showValueChange = false;
		}, 300);
		return () => clearTimeout(timeout);
	}
});

function handleClick() {
	if (!disabled && onclick) {
		haptic('light');
		// Play sound for the new state (opposite of current)
		audioStore.playDieToggle(!kept);
		onclick();
	}
}
</script>

<button
	class="die"
	class:kept
	class:rolling
	class:landing
	class:suggested
	class:value-changed={showValueChange}
	class:reduced-motion={reducedMotion}
	{disabled}
	onclick={handleClick}
	aria-label="Die showing {value}, {kept ? 'held' : 'not held'}{suggested ? ', suggested to keep' : ''}"
	aria-pressed={kept}
	style={rolling ? stylesToString(rollStyles) : landing ? stylesToString(landStyles) : ''}
>
	<div class="face" data-value={value}>
		{#if value === 1}
			<span class="pip center"></span>
		{:else if value === 2}
			<span class="pip top-right"></span>
			<span class="pip bottom-left"></span>
		{:else if value === 3}
			<span class="pip top-right"></span>
			<span class="pip center"></span>
			<span class="pip bottom-left"></span>
		{:else if value === 4}
			<span class="pip top-left"></span>
			<span class="pip top-right"></span>
			<span class="pip bottom-left"></span>
			<span class="pip bottom-right"></span>
		{:else if value === 5}
			<span class="pip top-left"></span>
			<span class="pip top-right"></span>
			<span class="pip center"></span>
			<span class="pip bottom-left"></span>
			<span class="pip bottom-right"></span>
		{:else if value === 6}
			<span class="pip top-left"></span>
			<span class="pip top-right"></span>
			<span class="pip middle-left"></span>
			<span class="pip middle-right"></span>
			<span class="pip bottom-left"></span>
			<span class="pip bottom-right"></span>
		{/if}
	</div>

	{#if kept}
		<span class="keep-badge">HELD</span>
	{/if}
</button>

<style>
	.die {
		position: relative;
		width: var(--die-size, 60px);
		height: var(--die-size, 60px);
		background: var(--color-surface);
		border: var(--border-thick);
		cursor: pointer;
		transition:
			transform var(--transition-fast),
			background var(--transition-fast),
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
		/* Promote to own compositing layer for smooth animations */
		will-change: transform;
		transform: translateZ(0);
	}

	.die:hover:not(:disabled) {
		transform: translateY(-4px);
		border-width: 3px;
	}

	.die:active:not(:disabled) {
		transform: translateY(-2px);
	}

	.die:disabled {
		cursor: default;
		opacity: 0.7;
	}

	.die.kept {
		background: var(--color-accent);
		border-color: var(--color-accent-dark);
		transform: translateY(-8px);
		box-shadow: 0 8px 0 var(--color-border);
	}

	.die.kept:hover:not(:disabled) {
		transform: translateY(-8px);
	}

	/* Suggested state (coach mode) */
	.die.suggested:not(.kept) {
		border-color: var(--color-success);
		box-shadow:
			0 0 0 2px var(--color-success),
			0 0 8px color-mix(in srgb, var(--color-success) 50%, transparent);
		animation: suggestion-pulse 1.5s ease-in-out infinite;
	}

	@keyframes suggestion-pulse {
		0%,
		100% {
			box-shadow:
				0 0 0 2px var(--color-success),
				0 0 8px color-mix(in srgb, var(--color-success) 50%, transparent);
		}
		50% {
			box-shadow:
				0 0 0 3px var(--color-success),
				0 0 16px color-mix(in srgb, var(--color-success) 70%, transparent);
		}
	}

	/* Rolling Animation - Enhanced Multi-Phase Physics */
	.die.rolling {
		animation:
			dice-roll-launch 0.1s var(--roll-delay, 0ms) cubic-bezier(0.2, 0.8, 0.2, 1) forwards,
			dice-roll-tumble 0.3s calc(var(--roll-delay, 0ms) + 0.1s) linear infinite;
		filter: blur(0.5px);
	}

	/* Launch Phase - Lift and initial spin */
	@keyframes dice-roll-launch {
		0% {
			transform: translateY(0) rotate(0deg) scale(1);
		}
		100% {
			transform:
				translateY(calc(var(--bounce-height, 12px) * -1))
				rotate(calc(var(--rotation-variance, 15deg) * 0.5))
				scale(1.05);
		}
	}

	/* Tumble Phase - Continuous spin during roll */
	@keyframes dice-roll-tumble {
		0% {
			transform:
				translateY(calc(var(--bounce-height, 12px) * -1))
				rotate(0deg)
				scale(1.05);
		}
		25% {
			transform:
				translateY(calc(var(--bounce-height, 12px) * -0.6))
				rotate(calc(90deg * var(--spin-rotations, 2)))
				scale(1.02);
		}
		50% {
			transform:
				translateY(calc(var(--bounce-height, 12px) * -1))
				rotate(calc(180deg * var(--spin-rotations, 2)))
				scale(1.05);
		}
		75% {
			transform:
				translateY(calc(var(--bounce-height, 12px) * -0.6))
				rotate(calc(270deg * var(--spin-rotations, 2)))
				scale(1.02);
		}
		100% {
			transform:
				translateY(calc(var(--bounce-height, 12px) * -1))
				rotate(calc(360deg * var(--spin-rotations, 2)))
				scale(1.05);
		}
	}

	/* Landing Animation - Settle with bounce */
	.die.landing {
		animation: dice-land 0.4s var(--land-delay, 0ms) cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}

	@keyframes dice-land {
		0% {
			transform:
				translateY(calc(var(--bounce-height, 12px) * -1))
				rotate(calc(var(--rotation-variance, 0deg) * 2))
				scale(1.1);
			opacity: 1;
		}
		30% {
			transform:
				translateY(2px)
				rotate(calc(var(--settle-rotation, 0deg) * -0.5))
				scale(var(--bounce-scale, 0.95));
		}
		50% {
			transform:
				translateY(-4px)
				rotate(calc(var(--settle-rotation, 0deg) * 0.3))
				scale(1.02);
		}
		70% {
			transform:
				translateY(1px)
				rotate(calc(var(--settle-rotation, 0deg) * -0.1))
				scale(0.98);
		}
		100% {
			transform: translateY(0) rotate(0deg) scale(1);
		}
	}

	/* Value Change Animation - Pop reveal */
	.die.value-changed .face {
		animation: dice-value-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	@keyframes dice-value-pop {
		0% {
			transform: scale(0.7) rotate(-5deg);
			opacity: 0.5;
		}
		50% {
			transform: scale(1.15) rotate(2deg);
			opacity: 1;
		}
		100% {
			transform: scale(1) rotate(0deg);
			opacity: 1;
		}
	}

	/* Reduced Motion - Simplified animations */
	.die.reduced-motion.rolling {
		animation: dice-roll-simple 0.15s ease-in-out infinite;
		filter: none;
	}

	.die.reduced-motion.landing {
		animation: dice-land-simple 0.15s ease-out forwards;
	}

	@keyframes dice-roll-simple {
		0%, 100% {
			transform: scale(0.98);
			opacity: 0.8;
		}
		50% {
			transform: scale(1.02);
			opacity: 1;
		}
	}

	@keyframes dice-land-simple {
		0% {
			transform: scale(1.05);
		}
		100% {
			transform: scale(1);
		}
	}

	/* Die Face with Pips */
	.face {
		position: relative;
		width: 100%;
		height: 100%;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(3, 1fr);
		padding: 6px;
	}

	/* Pips */
	.pip {
		width: 10px;
		height: 10px;
		background: var(--color-border);
		border-radius: 50%;
		position: absolute;
	}

	/* Pip positions using grid areas */
	.pip.top-left {
		top: 8px;
		left: 8px;
	}
	.pip.top-right {
		top: 8px;
		right: 8px;
	}
	.pip.middle-left {
		top: 50%;
		left: 8px;
		transform: translateY(-50%);
	}
	.pip.middle-right {
		top: 50%;
		right: 8px;
		transform: translateY(-50%);
	}
	.pip.bottom-left {
		bottom: 8px;
		left: 8px;
	}
	.pip.bottom-right {
		bottom: 8px;
		right: 8px;
	}
	.pip.center {
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
	}

	/* Keep Badge */
	.keep-badge {
		position: absolute;
		bottom: -22px;
		left: 50%;
		transform: translateX(-50%);
		font-size: var(--text-micro);
		font-weight: var(--weight-bold);
		background: var(--color-text);
		color: var(--color-surface);
		padding: 2px 6px;
		white-space: nowrap;
		letter-spacing: var(--tracking-wide);
	}

	/* Responsive */
	@media (max-width: 480px) {
		.die {
			width: var(--die-size-mobile, 50px);
			height: var(--die-size-mobile, 50px);
		}

		.pip {
			width: 8px;
			height: 8px;
		}

		.pip.top-left {
			top: 6px;
			left: 6px;
		}
		.pip.top-right {
			top: 6px;
			right: 6px;
		}
		.pip.middle-left {
			left: 6px;
		}
		.pip.middle-right {
			right: 6px;
		}
		.pip.bottom-left {
			bottom: 6px;
			left: 6px;
		}
		.pip.bottom-right {
			bottom: 6px;
			right: 6px;
		}

		.keep-badge {
			font-size: 8px;
			bottom: -18px;
		}
	}
</style>
