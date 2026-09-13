/**
 * Simulation Configuration Schemas
 *
 * Core configuration schemas for running AI game simulations.
 * Uses Zod 4 for runtime validation with strict typing.
 *
 * @example
 * import { SimulationConfigSchema, BatchConfigSchema } from '@dicee/simulation/schemas';
 *
 * const result = SimulationConfigSchema.safeParse(config);
 * if (result.success) {
 *   // result.data is typed as SimulationConfig
 * }
 */

import { z } from 'zod';

// =============================================================================
// AI Profile & Brain Schemas
// =============================================================================

/**
 * AI profile identifiers - matches profiles defined in cloudflare-do
 * Custom allows for ad-hoc profile configuration
 * Phase-shifting profiles use adaptive strategies based on game phase
 */
export const ProfileIdSchema = z.enum([
	'riley',
	'carmen',
	'liam',
	'sage',
	'professor',
	'charlie',
	'custom',
	// Phase-shifting strategy variants
	'phase-greedy', // Greedy early, strategic mid/late
	'phase-conservative', // Safe early, aggressive if behind
	'phase-upper', // Upper section priority
	'phase-lower', // Lower section priority
]);

/**
 * Brain type determines decision-making algorithm
 * - optimal: Pure EV maximization using WASM solver
 * - probabilistic: Weighted random based on EV rankings
 * - personality: EV + trait-based adjustments (aggression, chaos, etc.)
 * - random: Uniform random decisions (baseline)
 * - llm: LLM-powered decisions (future enhancement)
 */
export const BrainTypeSchema = z.enum([
	'optimal',
	'probabilistic',
	'personality',
	'adaptive',
	'random',
	'llm',
]);

/**
 * Metrics tracked during simulations
 */
export const MetricIdSchema = z.enum([
	'total_score',
	'upper_section_score',
	'lower_section_score',
	'upper_bonus_rate',
	'dicee_rate',
	'dicee_bonus_rate',
	'optimal_decision_rate',
	'ev_loss_per_decision',
	'win_rate',
]);

// =============================================================================
// Configuration Schemas
// =============================================================================

/**
 * AI trait overrides for personality-based brains
 * Values 0-1 representing trait strength
 */
export const TraitOverridesSchema = z.record(z.string(), z.number().min(0).max(1));

/**
 * Configuration for a single player in a simulation
 */
export const PlayerConfigSchema = z.object({
	/** Unique identifier for this player in the simulation */
	id: z.string().min(1),

	/** Base profile ID to use for traits and brain selection */
	profileId: ProfileIdSchema,

	/** Override the default brain type for this profile */
	brainOverride: BrainTypeSchema.optional(),

	/** Override the skill level (0-1, affects decision quality) */
	skillOverride: z.number().min(0).max(1).optional(),

	/** Override specific traits for personality brain */
	traitsOverride: TraitOverridesSchema.optional(),
});

/**
 * Configuration for a single game simulation
 */
export const SimulationConfigSchema = z.object({
	/** Players participating in this game (1-4) */
	players: z.array(PlayerConfigSchema).min(1).max(4),

	/** Seed for deterministic RNG (optional - random if not provided) */
	seed: z.number().int().optional(),

	/** Whether to capture detailed decision data for analysis */
	captureDecisions: z.boolean().default(false),

	/** Whether to capture intermediate game states */
	captureIntermediateStates: z.boolean().default(false),
});

/**
 * Output format for batch results
 */
export const OutputFormatSchema = z.enum(['ndjson', 'memory']);

/**
 * Configuration for batch simulation runs
 */
export const BatchConfigSchema = z.object({
	/** Total number of games to simulate */
	gameCount: z.number().int().min(1).max(1_000_000),

	/** Number of parallel workers (default: 12 for M3 Max) */
	workerCount: z.number().int().min(1).max(32).default(12),

	/** Base seed for deterministic batch (each game gets baseSeed + gameIndex) */
	baseSeed: z.number().int().optional(),

	/** Output format: ndjson for streaming to file, memory for in-process */
	outputFormat: OutputFormatSchema.default('ndjson'),

	/** Output path for ndjson format */
	outputPath: z.string().optional(),

	/** Number of games per batch (flush interval for ndjson) */
	batchSize: z.number().int().min(100).max(100_000).default(10_000),

	/** Progress reporting interval in milliseconds */
	progressIntervalMs: z.number().int().min(100).default(1000),
});

// =============================================================================
// Derived Types
// =============================================================================

/** AI profile identifier */
export type ProfileId = z.infer<typeof ProfileIdSchema>;

/** Brain type for decision-making */
export type BrainType = z.infer<typeof BrainTypeSchema>;

/** Metric identifier for tracking */
export type MetricId = z.infer<typeof MetricIdSchema>;

/** Trait overrides map */
export type TraitOverrides = z.infer<typeof TraitOverridesSchema>;

/** Single player configuration */
export type PlayerConfig = z.infer<typeof PlayerConfigSchema>;

/** Single game simulation configuration */
export type SimulationConfig = z.infer<typeof SimulationConfigSchema>;

/** Output format type */
export type OutputFormat = z.infer<typeof OutputFormatSchema>;

/** Batch simulation configuration */
export type BatchConfig = z.infer<typeof BatchConfigSchema>;
