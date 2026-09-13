/**
 * Hypothesis Testing
 *
 * Implements statistical tests for experiment hypotheses.
 * Supports one-sample t-test, two-sample t-test, Welch's t-test,
 * and chi-square tests.
 *
 * @example
 * const result = oneSampleTTest(scores, targetMean, 'greater_than', 0.05);
 * if (result.rejected) {
 *   console.log(`Null hypothesis rejected: ${result.conclusion}`);
 * }
 */

import type { Hypothesis, HypothesisDirection, HypothesisTestResult } from '../schemas/index.js';
import {
	approximatePValue,
	calculateDescriptiveStats,
	chiSquare2x2,
	chiSquarePValue1DF,
	cohensD,
	interpretEffectSize,
	pooledStandardDeviation,
	tStatisticOneSample,
	tStatisticTwoSample,
	tStatisticWelch,
} from './statistics.js';

// Note: welchDF is available in statistics.ts if exact t-distribution is needed

// =============================================================================
// One-Sample T-Test
// =============================================================================

/**
 * Perform a one-sample t-test
 *
 * @param values - Sample data
 * @param targetMean - Population mean under null hypothesis
 * @param direction - Test direction
 * @param alpha - Significance level
 * @returns Test result
 */
export function oneSampleTTest(
	values: number[],
	targetMean: number,
	direction: HypothesisDirection,
	alpha = 0.05,
): Omit<HypothesisTestResult, 'hypothesisId'> {
	const stats = calculateDescriptiveStats(values);
	const n = stats.n;

	if (n < 2) {
		return {
			rejected: false,
			pValue: 1,
			testStatistic: 0,
			effectSize: 0,
			effectInterpretation: 'negligible',
			sampleSize: n,
			conclusion: 'Insufficient sample size for statistical test',
		};
	}

	// Calculate t-statistic
	const tStat = tStatisticOneSample(stats.mean, targetMean, stats.stdDev, n);
	// Note: df = n - 1 would be used with exact t-distribution; using normal approximation

	// Calculate p-value
	let pValue: number;
	const twoTailed = direction === 'not_equal' || direction === 'within_range';

	if (twoTailed) {
		pValue = approximatePValue(tStat, true);
	} else {
		// One-tailed test
		pValue = approximatePValue(tStat, false);
		// Adjust for direction
		if (direction === 'greater_than' && tStat < 0) pValue = 1 - pValue;
		if (direction === 'less_than' && tStat > 0) pValue = 1 - pValue;
	}

	// Calculate effect size (Cohen's d)
	const d = stats.stdDev > 0 ? (stats.mean - targetMean) / stats.stdDev : 0;
	const effectInterpretation = interpretEffectSize(d);

	// Determine if null hypothesis is rejected
	const rejected = pValue < alpha;

	// Generate conclusion
	let conclusion: string;
	if (rejected) {
		if (direction === 'greater_than') {
			conclusion = `Mean (${stats.mean.toFixed(2)}) is significantly greater than ${targetMean} (p=${pValue.toFixed(4)})`;
		} else if (direction === 'less_than') {
			conclusion = `Mean (${stats.mean.toFixed(2)}) is significantly less than ${targetMean} (p=${pValue.toFixed(4)})`;
		} else {
			conclusion = `Mean (${stats.mean.toFixed(2)}) is significantly different from ${targetMean} (p=${pValue.toFixed(4)})`;
		}
	} else {
		conclusion = `No significant difference from target mean of ${targetMean} (p=${pValue.toFixed(4)})`;
	}

	return {
		rejected,
		pValue,
		testStatistic: tStat,
		effectSize: Math.abs(d),
		effectInterpretation,
		sampleSize: n,
		conclusion,
	};
}

// =============================================================================
// Two-Sample T-Test
// =============================================================================

/**
 * Perform a two-sample t-test (equal variance assumed)
 *
 * @param values1 - First sample data
 * @param values2 - Second sample data
 * @param direction - Test direction
 * @param alpha - Significance level
 * @returns Test result
 */
export function twoSampleTTest(
	values1: number[],
	values2: number[],
	direction: HypothesisDirection,
	alpha = 0.05,
): Omit<HypothesisTestResult, 'hypothesisId'> {
	const stats1 = calculateDescriptiveStats(values1);
	const stats2 = calculateDescriptiveStats(values2);
	const n1 = stats1.n;
	const n2 = stats2.n;

	if (n1 < 2 || n2 < 2) {
		return {
			rejected: false,
			pValue: 1,
			testStatistic: 0,
			effectSize: 0,
			effectInterpretation: 'negligible',
			sampleSize: n1 + n2,
			conclusion: 'Insufficient sample size for statistical test',
		};
	}

	// Calculate t-statistic
	const tStat = tStatisticTwoSample(stats1.mean, stats2.mean, stats1.stdDev, stats2.stdDev, n1, n2);
	// Note: df = n1 + n2 - 2 would be used with exact t-distribution

	// Calculate p-value
	const twoTailed = direction === 'not_equal' || direction === 'within_range';
	let pValue = approximatePValue(tStat, twoTailed);

	if (!twoTailed) {
		if (direction === 'greater_than' && tStat < 0) pValue = 1 - pValue;
		if (direction === 'less_than' && tStat > 0) pValue = 1 - pValue;
	}

	// Calculate effect size
	const pooledSd = pooledStandardDeviation(n1, stats1.stdDev, n2, stats2.stdDev);
	const d = cohensD(stats1.mean, stats2.mean, pooledSd);
	const effectInterpretation = interpretEffectSize(d);

	const rejected = pValue < alpha;

	let conclusion: string;
	if (rejected) {
		conclusion = `Groups differ significantly (d=${Math.abs(d).toFixed(2)}, p=${pValue.toFixed(4)})`;
	} else {
		conclusion = `No significant difference between groups (p=${pValue.toFixed(4)})`;
	}

	return {
		rejected,
		pValue,
		testStatistic: tStat,
		effectSize: Math.abs(d),
		effectInterpretation,
		sampleSize: n1 + n2,
		conclusion,
	};
}

// =============================================================================
// Welch's T-Test
// =============================================================================

/**
 * Perform Welch's t-test (unequal variance)
 *
 * @param values1 - First sample data
 * @param values2 - Second sample data
 * @param direction - Test direction
 * @param alpha - Significance level
 * @returns Test result
 */
export function welchTTest(
	values1: number[],
	values2: number[],
	direction: HypothesisDirection,
	alpha = 0.05,
): Omit<HypothesisTestResult, 'hypothesisId'> {
	const stats1 = calculateDescriptiveStats(values1);
	const stats2 = calculateDescriptiveStats(values2);
	const n1 = stats1.n;
	const n2 = stats2.n;

	if (n1 < 2 || n2 < 2) {
		return {
			rejected: false,
			pValue: 1,
			testStatistic: 0,
			effectSize: 0,
			effectInterpretation: 'negligible',
			sampleSize: n1 + n2,
			conclusion: 'Insufficient sample size for statistical test',
		};
	}

	// Calculate t-statistic using Welch's formula
	const tStat = tStatisticWelch(stats1.mean, stats2.mean, stats1.stdDev, stats2.stdDev, n1, n2);
	// Note: Welch-Satterthwaite df would be used with exact t-distribution

	// Calculate p-value
	const twoTailed = direction === 'not_equal' || direction === 'within_range';
	let pValue = approximatePValue(tStat, twoTailed);

	if (!twoTailed) {
		if (direction === 'greater_than' && tStat < 0) pValue = 1 - pValue;
		if (direction === 'less_than' && tStat > 0) pValue = 1 - pValue;
	}

	// Calculate effect size (using pooled SD for consistency)
	const pooledSd = pooledStandardDeviation(n1, stats1.stdDev, n2, stats2.stdDev);
	const d = cohensD(stats1.mean, stats2.mean, pooledSd);
	const effectInterpretation = interpretEffectSize(d);

	const rejected = pValue < alpha;

	let conclusion: string;
	if (rejected) {
		conclusion = `Groups differ significantly (Welch's t, d=${Math.abs(d).toFixed(2)}, p=${pValue.toFixed(4)})`;
	} else {
		conclusion = `No significant difference between groups (Welch's t, p=${pValue.toFixed(4)})`;
	}

	return {
		rejected,
		pValue,
		testStatistic: tStat,
		effectSize: Math.abs(d),
		effectInterpretation,
		sampleSize: n1 + n2,
		conclusion,
	};
}

// =============================================================================
// Chi-Square Test
// =============================================================================

/**
 * Perform a chi-square test for 2x2 contingency table
 *
 * @param wins1 - Wins for group 1
 * @param losses1 - Losses for group 1
 * @param wins2 - Wins for group 2
 * @param losses2 - Losses for group 2
 * @param alpha - Significance level
 * @returns Test result
 */
export function chiSquareTest(
	wins1: number,
	losses1: number,
	wins2: number,
	losses2: number,
	alpha = 0.05,
): Omit<HypothesisTestResult, 'hypothesisId'> {
	const n = wins1 + losses1 + wins2 + losses2;

	if (n < 10) {
		return {
			rejected: false,
			pValue: 1,
			testStatistic: 0,
			effectSize: 0,
			effectInterpretation: 'negligible',
			sampleSize: n,
			conclusion: 'Insufficient sample size for chi-square test',
		};
	}

	const observed: [[number, number], [number, number]] = [
		[wins1, losses1],
		[wins2, losses2],
	];

	const chiSq = chiSquare2x2(observed);
	const pValue = chiSquarePValue1DF(chiSq);

	// Calculate phi coefficient (effect size for 2x2)
	const phi = Math.sqrt(chiSq / n);
	const effectInterpretation = interpretEffectSize(phi);

	const rejected = pValue < alpha;

	// Win rates
	const rate1 = (wins1 / (wins1 + losses1)) * 100;
	const rate2 = (wins2 / (wins2 + losses2)) * 100;

	let conclusion: string;
	if (rejected) {
		conclusion = `Win rates differ significantly (${rate1.toFixed(1)}% vs ${rate2.toFixed(1)}%, χ²=${chiSq.toFixed(2)}, p=${pValue.toFixed(4)})`;
	} else {
		conclusion = `No significant difference in win rates (${rate1.toFixed(1)}% vs ${rate2.toFixed(1)}%, p=${pValue.toFixed(4)})`;
	}

	return {
		rejected,
		pValue,
		testStatistic: chiSq,
		effectSize: phi,
		effectInterpretation,
		sampleSize: n,
		conclusion,
	};
}

// =============================================================================
// Range Test
// =============================================================================

/**
 * Test if a sample mean falls within a target range
 *
 * @param values - Sample data
 * @param low - Lower bound of range
 * @param high - Upper bound of range
 * @param alpha - Significance level
 * @returns Test result
 */
export function rangeTest(
	values: number[],
	low: number,
	high: number,
	_alpha = 0.05, // Reserved for future use with exact CI calculation
): Omit<HypothesisTestResult, 'hypothesisId'> {
	const stats = calculateDescriptiveStats(values);
	const n = stats.n;

	if (n < 2) {
		return {
			rejected: false,
			pValue: 1,
			testStatistic: 0,
			effectSize: 0,
			effectInterpretation: 'negligible',
			sampleSize: n,
			conclusion: 'Insufficient sample size for statistical test',
		};
	}

	// Check if CI falls within range
	const ciWithinRange = stats.ci95Lower >= low && stats.ci95Upper <= high;
	const meanWithinRange = stats.mean >= low && stats.mean <= high;

	// For range test, we want to confirm the mean is IN range
	// So "rejected" means the null (mean outside range) is rejected
	const rejected = ciWithinRange;

	// Calculate how far from target midpoint
	const targetMid = (low + high) / 2;
	const d = stats.stdDev > 0 ? (stats.mean - targetMid) / stats.stdDev : 0;

	// P-value approximation: how likely to see this mean if truly at boundary
	const distFromCenter = Math.abs(stats.mean - targetMid);

	let conclusion: string;
	if (ciWithinRange) {
		conclusion = `Mean (${stats.mean.toFixed(2)}) with 95% CI [${stats.ci95Lower.toFixed(2)}, ${stats.ci95Upper.toFixed(2)}] falls within target range [${low}, ${high}]`;
	} else if (meanWithinRange) {
		conclusion = `Mean (${stats.mean.toFixed(2)}) is within range but CI [${stats.ci95Lower.toFixed(2)}, ${stats.ci95Upper.toFixed(2)}] extends outside [${low}, ${high}]`;
	} else {
		conclusion = `Mean (${stats.mean.toFixed(2)}) falls outside target range [${low}, ${high}]`;
	}

	return {
		rejected,
		pValue: ciWithinRange ? 0.01 : 0.5, // Simplified
		testStatistic: distFromCenter,
		effectSize: Math.abs(d),
		effectInterpretation: interpretEffectSize(d),
		sampleSize: n,
		conclusion,
	};
}

// =============================================================================
// Test Hypothesis
// =============================================================================

/**
 * Test a single hypothesis against collected data
 *
 * @param hypothesis - The hypothesis definition
 * @param values - Sample data for the metric
 * @param comparisonValues - Optional comparison data (for two-sample tests)
 * @returns Complete hypothesis test result
 */
export function testHypothesis(
	hypothesis: Hypothesis,
	values: number[],
	comparisonValues?: number[],
): HypothesisTestResult {
	let baseResult: Omit<HypothesisTestResult, 'hypothesisId'>;

	switch (hypothesis.test) {
		case 't_test_one_sample': {
			const target =
				typeof hypothesis.target === 'number'
					? hypothesis.target
					: (hypothesis.target.low + hypothesis.target.high) / 2;
			baseResult = oneSampleTTest(values, target, hypothesis.direction, hypothesis.alpha);
			break;
		}

		case 't_test_two_sample': {
			if (!comparisonValues) {
				throw new Error('Two-sample t-test requires comparison values');
			}
			baseResult = twoSampleTTest(values, comparisonValues, hypothesis.direction, hypothesis.alpha);
			break;
		}

		case 'welch_t_test': {
			if (!comparisonValues) {
				throw new Error("Welch's t-test requires comparison values");
			}
			baseResult = welchTTest(values, comparisonValues, hypothesis.direction, hypothesis.alpha);
			break;
		}

		case 'chi_square': {
			// For chi-square, values are expected to be [wins, losses] pairs
			// This is a simplified interface; real usage would need more structure
			if (!comparisonValues || values.length < 2 || comparisonValues.length < 2) {
				throw new Error('Chi-square test requires win/loss counts for both groups');
			}
			baseResult = chiSquareTest(
				values[0],
				values[1],
				comparisonValues[0],
				comparisonValues[1],
				hypothesis.alpha,
			);
			break;
		}

		case 'mann_whitney_u':
		case 'anova':
			// Not implemented yet - fall back to t-test
			console.warn(`${hypothesis.test} not implemented, falling back to t-test`);
			if (comparisonValues) {
				baseResult = welchTTest(values, comparisonValues, hypothesis.direction, hypothesis.alpha);
			} else {
				const target =
					typeof hypothesis.target === 'number'
						? hypothesis.target
						: (hypothesis.target.low + hypothesis.target.high) / 2;
				baseResult = oneSampleTTest(values, target, hypothesis.direction, hypothesis.alpha);
			}
			break;

		default:
			throw new Error(`Unknown test type: ${hypothesis.test}`);
	}

	// Handle range targets specially
	if (hypothesis.direction === 'within_range' && typeof hypothesis.target === 'object') {
		baseResult = rangeTest(values, hypothesis.target.low, hypothesis.target.high, hypothesis.alpha);
	}

	return {
		hypothesisId: hypothesis.id,
		...baseResult,
	};
}

// =============================================================================
// Bonferroni Correction
// =============================================================================

/**
 * Apply Bonferroni correction to multiple test results
 *
 * @param results - Array of test results
 * @returns Results with adjusted alpha and rejection status
 */
export function bonferroniCorrection(
	results: HypothesisTestResult[],
	originalAlpha = 0.05,
): HypothesisTestResult[] {
	const adjustedAlpha = originalAlpha / results.length;

	return results.map((result) => ({
		...result,
		rejected: result.pValue < adjustedAlpha,
		conclusion:
			result.pValue < adjustedAlpha
				? result.conclusion.replace(
						/p=[\d.]+/,
						`p=${result.pValue.toFixed(4)}, adjusted α=${adjustedAlpha.toFixed(4)}`,
					)
				: `${result.conclusion} (Bonferroni adjusted α=${adjustedAlpha.toFixed(4)})`,
	}));
}
