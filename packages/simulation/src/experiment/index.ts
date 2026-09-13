/**
 * Experiment Framework
 *
 * Scientific experiment execution, statistical analysis, and hypothesis testing.
 *
 * @example
 * import {
 *   ExperimentRunner,
 *   runCalibrationExperiment,
 *   calculateDescriptiveStats,
 *   oneSampleTTest,
 * } from '@dicee/simulation/experiment';
 */

// Hypothesis testing exports
export {
	bonferroniCorrection,
	chiSquareTest,
	oneSampleTTest,
	rangeTest,
	testHypothesis,
	twoSampleTTest,
	welchTTest,
} from './hypothesis.js';
// Runner exports
export {
	type ExperimentProgress,
	type ExperimentProgressCallback,
	ExperimentRunner,
	runCalibrationExperiment,
	runQuickExperiment,
} from './runner.js';
// Statistics exports
export {
	approximatePValue,
	calculateDescriptiveStats,
	chiSquare2x2,
	chiSquarePValue1DF,
	cohensD,
	confidenceInterval,
	confidenceIntervalWidth,
	getCriticalT,
	interpretEffectSize,
	mean,
	median,
	percentile,
	pooledStandardDeviation,
	sampleSizeForCIWidth,
	sampleSizeOneSampleTTest,
	sampleSizeProportionTest,
	sampleSizeTwoSampleTTest,
	standardDeviation,
	standardError,
	tStatisticOneSample,
	tStatisticTwoSample,
	tStatisticWelch,
	variance,
	welchDF,
} from './statistics.js';
