/**
 * Experiment Design Schema
 *
 * Rigorous experimental framework for multifactor analysis of Yahtzee strategies.
 * Designed to meet statistical assumptions and produce analysis-ready data.
 *
 * Key Principles:
 * 1. Schema-first: All experiments validated before execution
 * 2. Factorial design: Clear factor structure for ANOVA/regression
 * 3. Reproducibility: Seeds, versions, and lineage tracked
 * 4. Tidy output: One observation per row, ready for R/Python
 *
 * @module experiment-design
 */

import { z } from 'zod';

// =============================================================================
// Factor Definitions
// =============================================================================

/**
 * Strategy Factor - The decision-making approach used by a player
 *
 * Categories:
 * - optimal: Pure EV maximization
 * - probabilistic: Weighted random based on EV
 * - personality: Profile-based (riley, carmen, etc.)
 * - random: Uniform random (baseline/control)
 * - heuristic-*: Specific strategy implementations
 */
export const StrategyTypeSchema = z.enum([
	// Core brains
	'optimal',
	'probabilistic',
	'personality',
	'random',

	// Heuristic strategies (to be implemented)
	'heuristic-upper-priority', // Prioritize upper section for bonus
	'heuristic-yahtzee-chaser', // Aggressively chase Yahtzee on 3-of-kind
	'heuristic-straight-keeper', // Always keep partial straights
	'heuristic-chance-saver', // Save Chance category until end
	'heuristic-low-dump', // Use 1s/2s for garbage rolls
	'heuristic-two-roll', // Max 2 rolls for upper section
	'heuristic-backwards', // Lower section first strategy
]);

/**
 * Personality profiles for personality-type brains
 */
export const PersonalityProfileSchema = z.enum([
	'professor', // Analytical, optimal-leaning
	'carmen', // Risk-taking, aggressive
	'riley', // Balanced, adaptive
	'liam', // Conservative, safe plays
	'charlie', // Chaotic, unpredictable
]);

/**
 * Matchup Type - The competitive structure of the game
 */
export const MatchupTypeSchema = z.enum([
	'solo', // Single player (baseline performance)
	'mirror', // Same strategy vs itself
	'head-to-head', // Two different strategies
	'four-player', // Full table competition
	'tournament', // Round-robin bracket
]);

/**
 * Game Phase - For turn-level analysis
 */
export const GamePhaseSchema = z.enum([
	'early', // Rounds 1-4: Category selection matters most
	'mid', // Rounds 5-9: Adapting to scorecard state
	'late', // Rounds 10-13: Forced choices, endgame pressure
]);

/**
 * Analysis Granularity - What level of data to capture
 */
export const GranularitySchema = z.enum([
	'game', // Only final scores (fastest, smallest output)
	'turn', // Per-turn decisions and scores
	'decision', // Every keep/reroll decision (largest output)
]);

// =============================================================================
// Player Configuration
// =============================================================================

/**
 * Player configuration within an experiment condition
 */
export const ExperimentPlayerSchema = z.object({
	/** Unique player ID within the condition */
	playerId: z.string().min(1),

	/** Strategy type (the primary factor) */
	strategy: StrategyTypeSchema,

	/** Personality profile (if strategy is 'personality') */
	profile: PersonalityProfileSchema.optional(),

	/** Strategy-specific parameters (for heuristic tuning) */
	params: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).optional(),

	/** Label for analysis output (e.g., "optimal-p1", "carmen-aggressive") */
	label: z.string().min(1),
});

// =============================================================================
// Condition Definition
// =============================================================================

/**
 * Experimental Condition - A specific factor combination to test
 *
 * In factorial design terms, this is one "cell" of the design matrix.
 * Each condition should have sufficient observations (games) for statistical power.
 */
export const ExperimentConditionSchema = z.object({
	/** Unique condition ID (e.g., "C01", "optimal-vs-carmen") */
	conditionId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),

	/** Human-readable condition name */
	name: z.string().min(3),

	/** Detailed description of what this condition tests */
	description: z.string().min(10),

	/** Players in this condition */
	players: z.array(ExperimentPlayerSchema).min(1).max(4),

	/** Matchup type */
	matchupType: MatchupTypeSchema,

	/** Number of games to run (for power analysis) */
	gameCount: z.number().int().min(30).max(1_000_000),

	/** Base seed for this condition (derived from experiment seed if not set) */
	seed: z.number().int().optional(),

	/** Factor labels for analysis (key-value pairs) */
	factorLabels: z.record(z.string(), z.string()),

	/** Whether this is a control condition */
	isControl: z.boolean().default(false),
});

// =============================================================================
// Hypothesis Definition
// =============================================================================

/**
 * Statistical test types supported
 */
export const StatisticalTestSchema = z.enum([
	// Parametric tests
	't-test-independent', // Compare two independent groups
	't-test-paired', // Compare paired observations
	'anova-oneway', // Compare 3+ groups on one factor
	'anova-factorial', // Multifactor ANOVA
	'regression-linear', // Continuous predictor(s)

	// Non-parametric alternatives
	'mann-whitney', // Non-parametric independent samples
	'wilcoxon', // Non-parametric paired samples
	'kruskal-wallis', // Non-parametric one-way
	'chi-square', // Categorical outcomes (win rates)

	// Effect size measures
	'cohens-d', // Standardized mean difference
	'eta-squared', // Variance explained (ANOVA)
	'odds-ratio', // For binary outcomes
]);

/**
 * Hypothesis direction
 */
export const HypothesisDirectionSchema = z.enum([
	'greater', // Group A > Group B
	'less', // Group A < Group B
	'not-equal', // Group A ≠ Group B (two-tailed)
	'within-range', // Value within specified bounds
]);

/**
 * Formal hypothesis for statistical testing
 */
export const HypothesisSchema = z.object({
	/** Hypothesis ID (e.g., "H1", "H2a") */
	id: z.string().regex(/^H\d+[a-z]?$/),

	/** Null hypothesis statement */
	null: z.string().min(10),

	/** Alternative hypothesis statement */
	alternative: z.string().min(10),

	/** Dependent variable being measured */
	metric: z.enum([
		'total_score',
		'upper_section_score',
		'lower_section_score',
		'upper_bonus_rate',
		'yahtzee_rate',
		'win_rate',
		'score_variance',
		'decision_optimality',
		'ev_loss_per_game',
	]),

	/** Conditions being compared (references conditionId) */
	compareConditions: z.array(z.string()).min(1),

	/** Direction of expected effect */
	direction: HypothesisDirectionSchema,

	/** Expected effect size (Cohen's d or similar) */
	expectedEffectSize: z.number().min(0.1).max(3.0).optional(),

	/** Statistical test to use */
	test: StatisticalTestSchema,

	/** Alpha level (Type I error rate) */
	alpha: z.number().min(0.001).max(0.1).default(0.05),

	/** Desired statistical power (1 - Type II error rate) */
	power: z.number().min(0.7).max(0.99).default(0.8),

	/** Rationale for this hypothesis */
	rationale: z.string().min(20),
});

// =============================================================================
// Experiment Definition
// =============================================================================

/**
 * Experiment Type - The overall research question category
 */
export const ExperimentTypeSchema = z.enum([
	'CALIBRATION', // Validate brain produces expected score distribution
	'STRATEGY_COMPARISON', // Compare two or more strategies
	'HEURISTIC_VALIDATION', // Test if a heuristic improves over baseline
	'MATCHUP_ANALYSIS', // Head-to-head competitive analysis
	'FACTOR_INTERACTION', // Test interaction effects between factors
	'SENSITIVITY_ANALYSIS', // How parameters affect outcomes
	'ABLATION', // Remove components to measure contribution
]);

/**
 * Experiment Status
 */
export const ExperimentStatusSchema = z.enum([
	'DRAFT', // Being designed
	'REVIEW', // Awaiting review before execution
	'APPROVED', // Approved for execution
	'RUNNING', // Currently executing
	'COMPLETED', // Finished successfully
	'FAILED', // Execution failed
	'ARCHIVED', // Historical, superseded by newer experiment
]);

/**
 * Prior experiment reference for lineage tracking
 */
export const ExperimentLineageSchema = z.object({
	/** ID of the prior experiment */
	experimentId: z.string(),

	/** Version of the prior experiment */
	version: z.string(),

	/** How this experiment relates to the prior */
	relationship: z.enum([
		'extends', // Builds on findings
		'replicates', // Attempts to reproduce
		'refutes', // Tests contrary hypothesis
		'refines', // More precise version
	]),

	/** What was learned from the prior experiment */
	findings: z.string().min(10),
});

/**
 * Complete Experiment Definition
 *
 * This is the top-level schema that defines a complete experiment.
 * All experiments should be defined in this format before execution.
 */
export const ExperimentDefinitionSchema = z.object({
	// =========================================================================
	// Identification
	// =========================================================================

	/** Unique experiment ID (e.g., "EXP-2024-001") */
	id: z
		.string()
		.regex(/^EXP-\d{4}-\d{3}[a-z]?$/)
		.or(z.string().regex(/^[a-z][a-z0-9_-]+$/)), // Also allow slug format

	/** Semantic version */
	version: z.string().regex(/^\d+\.\d+\.\d+$/),

	/** Experiment status */
	status: ExperimentStatusSchema.default('DRAFT'),

	// =========================================================================
	// Metadata
	// =========================================================================

	/** Descriptive title */
	title: z.string().min(10).max(200),

	/** Detailed description of research question */
	description: z.string().min(50),

	/** Experiment type */
	type: ExperimentTypeSchema,

	/** Author/creator */
	author: z.string().optional(),

	/** Creation timestamp */
	createdAt: z.string().datetime(),

	/** Last modified timestamp */
	updatedAt: z.string().datetime().optional(),

	/** Tags for categorization */
	tags: z.array(z.string()).default([]),

	// =========================================================================
	// Lineage & Context
	// =========================================================================

	/** Prior experiments this builds on */
	lineage: z.array(ExperimentLineageSchema).default([]),

	/** Key assumptions being made */
	assumptions: z.array(z.string()).min(1),

	/** Known limitations */
	limitations: z.array(z.string()).default([]),

	// =========================================================================
	// Design
	// =========================================================================

	/** Formal hypotheses */
	hypotheses: z.array(HypothesisSchema).min(1),

	/** Experimental conditions (the design matrix) */
	conditions: z.array(ExperimentConditionSchema).min(1),

	/** Data granularity to capture */
	granularity: GranularitySchema.default('game'),

	/** Master seed for reproducibility */
	masterSeed: z.number().int(),

	// =========================================================================
	// Statistical Design
	// =========================================================================

	/** Minimum games per condition for statistical validity */
	minGamesPerCondition: z.number().int().min(30).default(100),

	/** Whether to use balanced design (equal n per condition) */
	balancedDesign: z.boolean().default(true),

	/** Multiple comparison correction method */
	multipleComparisonCorrection: z
		.enum([
			'none',
			'bonferroni', // Conservative, controls FWER
			'holm', // Step-down, less conservative
			'fdr-bh', // Benjamini-Hochberg, controls FDR
		])
		.default('holm'),

	// =========================================================================
	// Output Configuration
	// =========================================================================

	/** Output directory (relative to experiments/) */
	outputDir: z.string().optional(),

	/** Whether to capture detailed decision logs */
	captureDecisions: z.boolean().default(false),

	/** Progress reporting interval (games) */
	progressInterval: z.number().int().min(10).default(100),
});

// =============================================================================
// Experiment Registry
// =============================================================================

/**
 * Summary of completed experiment results
 */
export const ExperimentResultSummarySchema = z.object({
	/** Reference to experiment */
	experimentId: z.string(),
	experimentVersion: z.string(),

	/** Execution metadata */
	executedAt: z.string().datetime(),
	durationMs: z.number().int(),
	totalGames: z.number().int(),

	/** Hypothesis outcomes */
	hypothesisResults: z.array(
		z.object({
			hypothesisId: z.string(),
			rejected: z.boolean(),
			pValue: z.number(),
			effectSize: z.number(),
			confidenceInterval: z.tuple([z.number(), z.number()]),
			conclusion: z.string(),
		}),
	),

	/** Key findings summary */
	findings: z.array(z.string()),

	/** Output file paths */
	outputPaths: z.object({
		games: z.string().optional(),
		turns: z.string().optional(),
		decisions: z.string().optional(),
		analysis: z.string().optional(),
	}),
});

/**
 * Experiment Registry - Tracks all experiments and their relationships
 *
 * This is the "lab notebook" that maintains experimental history.
 */
export const ExperimentRegistrySchema = z.object({
	/** Registry version */
	version: z.string().regex(/^\d+\.\d+\.\d+$/),

	/** Last updated */
	updatedAt: z.string().datetime(),

	/** All registered experiments */
	experiments: z.array(
		z.object({
			id: z.string(),
			version: z.string(),
			status: ExperimentStatusSchema,
			title: z.string(),
			type: ExperimentTypeSchema,
			createdAt: z.string().datetime(),
			completedAt: z.string().datetime().optional(),
			resultsSummary: ExperimentResultSummarySchema.optional(),
		}),
	),

	/** Cumulative findings (knowledge base) */
	cumulativeFindings: z.array(
		z.object({
			id: z.string(),
			finding: z.string(),
			confidence: z.enum(['high', 'medium', 'low']),
			supportingExperiments: z.array(z.string()),
			establishedAt: z.string().datetime(),
		}),
	),
});

// =============================================================================
// Type Exports
// =============================================================================

export type StrategyType = z.infer<typeof StrategyTypeSchema>;
export type PersonalityProfile = z.infer<typeof PersonalityProfileSchema>;
export type MatchupType = z.infer<typeof MatchupTypeSchema>;
export type GamePhase = z.infer<typeof GamePhaseSchema>;
export type Granularity = z.infer<typeof GranularitySchema>;
export type ExperimentPlayer = z.infer<typeof ExperimentPlayerSchema>;
export type ExperimentCondition = z.infer<typeof ExperimentConditionSchema>;
export type StatisticalTest = z.infer<typeof StatisticalTestSchema>;
export type HypothesisDirection = z.infer<typeof HypothesisDirectionSchema>;
export type Hypothesis = z.infer<typeof HypothesisSchema>;
export type ExperimentType = z.infer<typeof ExperimentTypeSchema>;
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type ExperimentLineage = z.infer<typeof ExperimentLineageSchema>;
export type ExperimentDefinition = z.infer<typeof ExperimentDefinitionSchema>;
export type ExperimentResultSummary = z.infer<typeof ExperimentResultSummarySchema>;
export type ExperimentRegistry = z.infer<typeof ExperimentRegistrySchema>;

// =============================================================================
// Validators
// =============================================================================

export function parseExperimentDefinition(input: unknown) {
	return ExperimentDefinitionSchema.safeParse(input);
}

export function parseExperimentRegistry(input: unknown) {
	return ExperimentRegistrySchema.safeParse(input);
}

export function isValidExperiment(input: unknown): input is ExperimentDefinition {
	return ExperimentDefinitionSchema.safeParse(input).success;
}

// =============================================================================
// Design Helpers
// =============================================================================

/**
 * Calculate required sample size for desired power
 *
 * Uses approximation: n ≈ 2 * ((z_α + z_β) / d)²
 * where d is Cohen's d effect size
 */
export function calculateRequiredSampleSize(options: {
	effectSize: number; // Cohen's d
	alpha?: number; // Type I error rate (default 0.05)
	power?: number; // Desired power (default 0.80)
}): number {
	const { effectSize, alpha = 0.05, power = 0.8 } = options;

	// Z-scores for common values (approximations)
	const zAlpha = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.645;
	const zBeta = power === 0.8 ? 0.842 : power === 0.9 ? 1.282 : power === 0.95 ? 1.645 : 0.842;

	const n = 2 * ((zAlpha + zBeta) / effectSize) ** 2;
	return Math.ceil(n);
}

/**
 * Generate condition IDs for factorial design
 */
export function generateFactorialConditions(factors: Record<string, string[]>): string[][] {
	const keys = Object.keys(factors);
	if (keys.length === 0) return [[]];

	const [firstKey, ...restKeys] = keys;
	const firstValues = factors[firstKey];
	const restFactors = Object.fromEntries(restKeys.map((k) => [k, factors[k]]));
	const restCombinations = generateFactorialConditions(restFactors);

	return firstValues.flatMap((value) => restCombinations.map((rest) => [value, ...rest]));
}
