<script lang="ts">
/**
 * MultiplayerScorecard Component
 *
 * Enhanced scorecard for multiplayer games with WASM analysis integration.
 * Shows scores, potential values, and statistical indicators (EV, optimal).
 */
import { untrack } from 'svelte';
import CategoryRow from '$lib/components/scorecard/CategoryRow.svelte';
import ScorecardLegend from '$lib/components/scorecard/ScorecardLegend.svelte';
import type { StatsProfile, TurnAnalysis } from '$lib/types';
import { toWireCategory } from '$lib/types/category-convert';
import type { Category, DiceArray, Scorecard } from '$lib/types/multiplayer';

interface Props {
	/** Player's scorecard */
	scorecard: Scorecard | null;
	/** Current dice (for calculating potential scores) */
	currentDice: DiceArray | null;
	/** Whether the player can score (their turn, dice rolled) */
	canScore: boolean;
	/** Callback when a category is selected */
	onScore: (category: Category) => void;
	/** WASM analysis data for statistical display */
	analysis?: TurnAnalysis | null;
	/** Whether to show statistical information */
	statsEnabled?: boolean;
	/** Stats profile level (beginner, intermediate, expert) */
	statsProfile?: StatsProfile;
}

let {
	scorecard,
	currentDice,
	canScore,
	onScore,
	analysis = null,
	statsEnabled: initialStatsEnabled = true,
	statsProfile = 'intermediate',
}: Props = $props();

// Local state for stats toggle (user can show/hide stats)
let statsEnabled = $state(untrack(() => initialStatsEnabled));

function toggleStats() {
	statsEnabled = !statsEnabled;
}

// Category definitions
const UPPER_CATEGORIES: { key: Category; label: string; value: number }[] = [
	{ key: 'ones', label: 'Ones', value: 1 },
	{ key: 'twos', label: 'Twos', value: 2 },
	{ key: 'threes', label: 'Threes', value: 3 },
	{ key: 'fours', label: 'Fours', value: 4 },
	{ key: 'fives', label: 'Fives', value: 5 },
	{ key: 'sixes', label: 'Sixes', value: 6 },
];

const LOWER_CATEGORIES: { key: Category; label: string; description: string }[] = [
	{ key: 'threeOfAKind', label: '3 of a Kind', description: 'Sum all dice' },
	{ key: 'fourOfAKind', label: '4 of a Kind', description: 'Sum all dice' },
	{ key: 'fullHouse', label: 'Full House', description: '25 pts' },
	{ key: 'smallStraight', label: 'Sm Straight', description: '30 pts' },
	{ key: 'largeStraight', label: 'Lg Straight', description: '40 pts' },
	{ key: 'dicee', label: 'Dicee', description: '50 pts' },
	{ key: 'chance', label: 'Chance', description: 'Sum all dice' },
];

// Calculate potential score for a category
function calculatePotential(category: Category): number {
	if (!currentDice) return 0;

	const counts = [0, 0, 0, 0, 0, 0];
	let sum = 0;
	for (const die of currentDice) {
		counts[die - 1]++;
		sum += die;
	}

	const maxCount = Math.max(...counts);
	const sortedDice = [...currentDice].sort((a, b) => a - b);

	switch (category) {
		case 'ones':
			return counts[0] * 1;
		case 'twos':
			return counts[1] * 2;
		case 'threes':
			return counts[2] * 3;
		case 'fours':
			return counts[3] * 4;
		case 'fives':
			return counts[4] * 5;
		case 'sixes':
			return counts[5] * 6;
		case 'threeOfAKind':
			return maxCount >= 3 ? sum : 0;
		case 'fourOfAKind':
			return maxCount >= 4 ? sum : 0;
		case 'fullHouse': {
			const hasThree = counts.includes(3);
			const hasTwo = counts.includes(2);
			return hasThree && hasTwo ? 25 : 0;
		}
		case 'smallStraight': {
			const str = sortedDice.join('');
			return str.includes('1234') || str.includes('2345') || str.includes('3456') ? 30 : 0;
		}
		case 'largeStraight': {
			const str = sortedDice.join('');
			return str === '12345' || str === '23456' ? 40 : 0;
		}
		case 'dicee':
			return maxCount === 5 ? 50 : 0;
		case 'chance':
			return sum;
		default:
			return 0;
	}
}

// Check if a category is available
function isAvailable(category: Category): boolean {
	if (!scorecard) return false;
	return scorecard[category] === null;
}

// Get the score for a category
function getScore(category: Category): number | null {
	if (!scorecard) return null;
	return scorecard[category];
}

// Get analysis data for a specific category
function getCategoryAnalysis(category: Category) {
	if (!analysis?.categories) return null;
	// Convert wire category to core format for comparison
	return analysis.categories.find((c) => toWireCategory(c.category) === category) ?? null;
}

// Check if this category is the recommended optimal choice
function isOptimalCategory(category: Category): boolean {
	if (!analysis?.recommendedCategory) return false;
	return toWireCategory(analysis.recommendedCategory) === category;
}

// Calculate upper section sum
const upperSum = $derived(() => {
	if (!scorecard) return 0;
	return (
		(scorecard.ones ?? 0) +
		(scorecard.twos ?? 0) +
		(scorecard.threes ?? 0) +
		(scorecard.fours ?? 0) +
		(scorecard.fives ?? 0) +
		(scorecard.sixes ?? 0)
	);
});

const upperBonus = $derived(scorecard?.upperBonus ?? 0);
const diceeBonus = $derived(scorecard?.diceeBonus ?? 0);

// Calculate total
const totalScore = $derived(() => {
	if (!scorecard) return 0;
	let total = 0;
	for (const cat of UPPER_CATEGORIES) {
		total += scorecard[cat.key] ?? 0;
	}
	for (const cat of LOWER_CATEGORIES) {
		total += scorecard[cat.key] ?? 0;
	}
	total += scorecard.upperBonus;
	total += scorecard.diceeBonus;
	return total;
});
</script>

<div class="multiplayer-scorecard">
	<header class="scorecard-header">
		<h3 class="header-title">Scorecard</h3>
		<div class="header-controls">
			<button class="stats-toggle" onclick={toggleStats} aria-pressed={statsEnabled}>
				{statsEnabled ? 'Hide Stats' : 'Show Stats'}
			</button>
			<ScorecardLegend />
		</div>
	</header>

	<!-- Upper Section -->
	<section class="section upper">
		<div class="section-header">
			<span class="section-label">Upper Section</span>
			<span class="section-hint">Sum of matching dice</span>
		</div>
		<div class="categories">
			{#each UPPER_CATEGORIES as cat (cat.key)}
				{@const score = getScore(cat.key)}
				{@const available = isAvailable(cat.key)}
				{@const catAnalysis = getCategoryAnalysis(cat.key)}
				{@const potential = catAnalysis?.immediateScore ?? (available && currentDice ? calculatePotential(cat.key) : 0)}
				<CategoryRow
					category={cat.key}
					{score}
					potentialScore={potential}
					expectedValue={catAnalysis?.expectedValue ?? 0}
					probability={0}
					isOptimal={isOptimalCategory(cat.key)}
					{available}
					{statsEnabled}
					{statsProfile}
					compact
					onclick={() => available && canScore && onScore(cat.key)}
				/>
			{/each}
		</div>

		<!-- Upper Bonus Progress -->
		<div class="bonus-row">
			<span class="bonus-label">Bonus (63+)</span>
			<div class="bonus-progress">
				<div class="bonus-fill" style="width: {Math.min((upperSum() / 63) * 100, 100)}%"></div>
			</div>
			<span class="bonus-value" class:achieved={upperBonus > 0}>
				{upperBonus > 0 ? '+35' : `${upperSum()}/63`}
			</span>
		</div>
	</section>

	<!-- Lower Section -->
	<section class="section lower">
		<div class="section-header">
			<span class="section-label">Lower Section</span>
			<span class="section-hint">Special combinations</span>
		</div>
		<div class="categories">
			{#each LOWER_CATEGORIES as cat (cat.key)}
				{@const score = getScore(cat.key)}
				{@const available = isAvailable(cat.key)}
				{@const catAnalysis = getCategoryAnalysis(cat.key)}
				{@const potential = catAnalysis?.immediateScore ?? (available && currentDice ? calculatePotential(cat.key) : 0)}
				<CategoryRow
					category={cat.key}
					{score}
					potentialScore={potential}
					expectedValue={catAnalysis?.expectedValue ?? 0}
					probability={0}
					isOptimal={isOptimalCategory(cat.key)}
					{available}
					{statsEnabled}
					{statsProfile}
					compact
					onclick={() => available && canScore && onScore(cat.key)}
				/>
			{/each}
		</div>

		<!-- Dicee Bonus -->
		{#if diceeBonus > 0}
			<div class="bonus-row dicee-bonus">
				<span class="bonus-label">Dicee Bonus</span>
				<span class="bonus-value achieved">+{diceeBonus}</span>
			</div>
		{/if}
	</section>

	<!-- Total -->
	<div class="total-row">
		<span class="total-label">Total</span>
		<span class="total-value">{totalScore()}</span>
	</div>
</div>

<style>
	.multiplayer-scorecard {
		background: var(--color-surface);
		border: var(--border-thick);
		display: flex;
		flex-direction: column;
	}

	.scorecard-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--space-1) var(--space-2);
		border-bottom: var(--border-medium);
		background: var(--color-background);
	}

	.header-title {
		margin: 0;
		font-size: var(--text-small);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.header-controls {
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}

	.stats-toggle {
		padding: var(--space-1) var(--space-2);
		background: var(--color-surface);
		border: var(--border-thin);
		cursor: pointer;
		font-family: inherit;
		font-size: var(--text-tiny);
		font-weight: var(--weight-medium);
		transition:
			background var(--transition-fast),
			border-color var(--transition-fast);
	}

	.stats-toggle:hover {
		background: var(--color-background);
		border-color: var(--color-accent);
	}

	.stats-toggle[aria-pressed='true'] {
		background: var(--color-accent-light);
		border-color: var(--color-accent);
	}

	.section {
		border-bottom: var(--border-medium);
		position: relative;
	}

	.section:last-of-type {
		border-bottom: none;
	}

	/* Section Header with accent bar */
	.section-header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--color-background);
		border-bottom: var(--border-medium);
		position: relative;
	}

	.section-header::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--color-accent);
	}

	.section.upper .section-header::before {
		background: var(--color-accent);
	}

	.section.lower .section-header::before {
		background: var(--color-success);
	}

	.section-label {
		font-size: var(--text-small);
		font-weight: var(--weight-bold);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.section-hint {
		font-size: var(--text-tiny);
		color: var(--color-text-muted);
	}

	.categories {
		display: flex;
		flex-direction: column;
	}

	.bonus-row {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
		background: var(--color-background);
		border-top: var(--border-thin);
	}

	.bonus-label {
		font-size: var(--text-tiny);
		font-weight: var(--weight-semibold);
		text-transform: uppercase;
		white-space: nowrap;
	}

	.bonus-progress {
		flex: 1;
		height: 12px;
		background: var(--color-surface);
		border: var(--border-thin);
		position: relative;
		max-width: 80px;
	}

	.bonus-fill {
		height: 100%;
		background: var(--color-accent);
		transition: width var(--transition-medium);
	}

	.bonus-value {
		font-family: var(--font-mono);
		font-size: var(--text-small);
		font-weight: var(--weight-bold);
		min-width: 40px;
		text-align: right;
	}

	.bonus-value.achieved {
		color: var(--color-success);
	}

	.dicee-bonus {
		background: var(--color-success);
		color: white;
	}

	.dicee-bonus .bonus-value {
		color: white;
	}

	.total-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: var(--space-2);
		background: var(--color-accent);
		border-top: var(--border-thick);
	}

	.total-label {
		font-size: var(--text-body);
		font-weight: var(--weight-black);
		text-transform: uppercase;
		letter-spacing: var(--tracking-wider);
	}

	.total-value {
		font-family: var(--font-mono);
		font-size: var(--text-h3);
		font-weight: var(--weight-black);
		font-variant-numeric: tabular-nums;
	}
</style>
