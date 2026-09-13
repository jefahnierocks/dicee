/**
 * @dicee/simulation/schemas
 *
 * Schema exports for AI simulation framework.
 * All schemas use Zod 4 for runtime validation.
 *
 * @example
 * // Import schemas
 * import { SimulationConfigSchema, GameResultSchema } from '@dicee/simulation/schemas';
 *
 * // Import types
 * import type { SimulationConfig, GameResult } from '@dicee/simulation/schemas';
 *
 * // Import validators
 * import { parseSimulationConfig, isGameResult } from '@dicee/simulation/schemas';
 */

// =============================================================================
// Simulation Configuration
// =============================================================================

export {
	type BatchConfig,
	BatchConfigSchema,
	type BrainType,
	BrainTypeSchema,
	type MetricId,
	MetricIdSchema,
	type OutputFormat,
	OutputFormatSchema,
	type PlayerConfig,
	PlayerConfigSchema,
	// Types
	type ProfileId,
	// Schemas
	ProfileIdSchema,
	type SimulationConfig,
	SimulationConfigSchema,
	type TraitOverrides,
	TraitOverridesSchema,
} from './simulation.schema.js';

// =============================================================================
// Results
// =============================================================================

export {
	type BatchProgress,
	BatchProgressSchema,
	type DecisionResult,
	DecisionResultSchema,
	type GameResult,
	GameResultSchema,
	// Types
	type PlayerResult,
	// Schemas
	PlayerResultSchema,
	type TurnResult,
	TurnResultSchema,
} from './results.schema.js';

// =============================================================================
// Experiments (Original)
// =============================================================================

export {
	type AdaptiveStoppingRule,
	AdaptiveStoppingRuleSchema,
	type DescriptiveStats,
	DescriptiveStatsSchema,
	type EffectInterpretation,
	EffectInterpretationSchema,
	type ExperimentDefinition,
	ExperimentDefinitionSchema,
	type ExperimentResults,
	ExperimentResultsSchema,
	type ExperimentType,
	ExperimentTypeSchema,
	type FixedStoppingRule,
	FixedStoppingRuleSchema,
	type Hypothesis,
	// Types
	type HypothesisDirection,
	// Schemas
	HypothesisDirectionSchema,
	HypothesisSchema,
	type HypothesisTarget,
	HypothesisTargetSchema,
	type HypothesisTestResult,
	HypothesisTestResultSchema,
	type SequentialStoppingRule,
	SequentialStoppingRuleSchema,
	type StatisticalTest,
	StatisticalTestSchema,
	type StoppingRule,
	StoppingRuleSchema,
} from './experiment.schema.js';

// =============================================================================
// Experiment Design (Multifactor Analysis Framework)
// =============================================================================

export {
	// Helpers
	calculateRequiredSampleSize,
	type ExperimentCondition,
	ExperimentConditionSchema,
	type ExperimentDefinition as DesignExperimentDefinition,
	ExperimentDefinitionSchema as DesignExperimentDefinitionSchema,
	type ExperimentLineage,
	ExperimentLineageSchema,
	type ExperimentPlayer,
	// Player and condition schemas
	ExperimentPlayerSchema,
	type ExperimentRegistry,
	ExperimentRegistrySchema,
	type ExperimentResultSummary,
	// Registry schemas
	ExperimentResultSummarySchema,
	type ExperimentStatus,
	ExperimentStatusSchema,
	type ExperimentType as DesignExperimentType,
	// Experiment definition (extended)
	ExperimentTypeSchema as DesignExperimentTypeSchema,
	type GamePhase,
	GamePhaseSchema,
	type Granularity,
	GranularitySchema,
	generateFactorialConditions,
	type Hypothesis as DesignHypothesis,
	type HypothesisDirection as DesignHypothesisDirection,
	HypothesisDirectionSchema as DesignHypothesisDirectionSchema,
	HypothesisSchema as DesignHypothesisSchema,
	isValidExperiment,
	type MatchupType,
	MatchupTypeSchema,
	type PersonalityProfile,
	PersonalityProfileSchema,
	// Validators
	parseExperimentDefinition as parseDesignExperimentDefinition,
	parseExperimentRegistry,
	type StatisticalTest as DesignStatisticalTest,
	// Hypothesis schemas (extended)
	StatisticalTestSchema as DesignStatisticalTestSchema,
	type StrategyType,
	// Factor schemas
	StrategyTypeSchema,
} from './experiment-design.schema.js';

// =============================================================================
// Validators
// =============================================================================

export {
	isBatchConfig,
	isDecisionResult,
	isExperimentDefinition,
	isExperimentResults,
	isGameResult,
	isHypothesis,
	isHypothesisTestResult,
	isPlayerConfig,
	isPlayerResult,
	// Type guards
	isSimulationConfig,
	isStoppingRule,
	isTurnResult,
	isValidBrainType,
	// Enum validators
	isValidProfileId,
	parseBatchConfig,
	parseDecisionResult,
	// Experiment validators
	parseExperimentDefinition,
	parseExperimentResults,
	// Result validators
	parseGameResult,
	parseHypothesis,
	parseHypothesisTestResult,
	parsePlayerConfig,
	parsePlayerResult,
	// Configuration validators
	parseSimulationConfig,
	parseStoppingRule,
	parseTurnResult,
} from './validators.js';

// =============================================================================
// Re-export shared types for convenience
// =============================================================================

export type {
	Category,
	DiceArray,
	GameState,
	KeptMask,
	PlayerGameState,
	Scorecard,
} from '@dicee/shared';

export { CategorySchema, DiceArraySchema, KeptMaskSchema, ScorecardSchema } from '@dicee/shared';
