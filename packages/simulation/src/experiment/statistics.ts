/**
 * Statistical Functions
 *
 * Core statistical calculations for experiment analysis.
 * Includes descriptive statistics, confidence intervals, effect sizes,
 * and sample size calculations.
 *
 * @example
 * const stats = calculateDescriptiveStats(scores);
 * const ci = confidenceInterval(stats.mean, stats.stdDev, stats.n);
 * const d = cohensD(groupA.mean, groupB.mean, pooledStdDev);
 */

import type { DescriptiveStats, EffectInterpretation } from '../schemas/index.js';

// =============================================================================
// Constants
// =============================================================================

/** Critical z-values for common confidence levels */
const Z_VALUES = {
	0.9: 1.645,
	0.95: 1.96,
	0.99: 2.576,
} as const;

/** T-distribution critical values (two-tailed) for df -> t */
// Selected values for common sample sizes
const T_TABLE: Record<number, Record<number, number>> = {
	// df: { alpha: t-value }
	10: { 0.1: 1.812, 0.05: 2.228, 0.01: 3.169 },
	20: { 0.1: 1.725, 0.05: 2.086, 0.01: 2.845 },
	30: { 0.1: 1.697, 0.05: 2.042, 0.01: 2.75 },
	40: { 0.1: 1.684, 0.05: 2.021, 0.01: 2.704 },
	50: { 0.1: 1.676, 0.05: 2.009, 0.01: 2.678 },
	60: { 0.1: 1.671, 0.05: 2.0, 0.01: 2.66 },
	80: { 0.1: 1.664, 0.05: 1.99, 0.01: 2.639 },
	100: { 0.1: 1.66, 0.05: 1.984, 0.01: 2.626 },
	120: { 0.1: 1.658, 0.05: 1.98, 0.01: 2.617 },
	1000: { 0.1: 1.646, 0.05: 1.962, 0.01: 2.581 },
};

// =============================================================================
// Basic Statistics
// =============================================================================

/**
 * Calculate the mean of an array of numbers
 */
export function mean(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Calculate the median of an array of numbers
 */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculate variance (sample variance by default)
 */
export function variance(values: number[], population = false): number {
	if (values.length === 0) return 0;
	const m = mean(values);
	const sumSquares = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
	return sumSquares / (population ? values.length : values.length - 1);
}

/**
 * Calculate standard deviation (sample by default)
 */
export function standardDeviation(values: number[], population = false): number {
	return Math.sqrt(variance(values, population));
}

/**
 * Calculate standard error of the mean
 */
export function standardError(stdDev: number, n: number): number {
	if (n <= 0) return 0;
	return stdDev / Math.sqrt(n);
}

/**
 * Calculate a percentile value
 */
export function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const index = (p / 100) * (sorted.length - 1);
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	if (lower === upper) return sorted[lower];
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

// =============================================================================
// Confidence Intervals
// =============================================================================

/**
 * Calculate confidence interval for the mean
 *
 * @param sampleMean - Sample mean
 * @param sampleStdDev - Sample standard deviation
 * @param n - Sample size
 * @param confidence - Confidence level (0.9, 0.95, or 0.99)
 * @returns [lower, upper] bounds
 */
export function confidenceInterval(
	sampleMean: number,
	sampleStdDev: number,
	n: number,
	confidence: 0.9 | 0.95 | 0.99 = 0.95,
): [number, number] {
	if (n <= 1) return [sampleMean, sampleMean];

	const z = Z_VALUES[confidence];
	const se = standardError(sampleStdDev, n);
	const margin = z * se;

	return [sampleMean - margin, sampleMean + margin];
}

/**
 * Calculate width of a confidence interval
 */
export function confidenceIntervalWidth(
	stdDev: number,
	n: number,
	confidence: 0.9 | 0.95 | 0.99 = 0.95,
): number {
	const z = Z_VALUES[confidence];
	const se = standardError(stdDev, n);
	return 2 * z * se;
}

// =============================================================================
// Descriptive Statistics Bundle
// =============================================================================

/**
 * Calculate comprehensive descriptive statistics
 */
export function calculateDescriptiveStats(values: number[]): DescriptiveStats {
	if (values.length === 0) {
		return {
			n: 0,
			mean: 0,
			median: 0,
			stdDev: 0,
			min: 0,
			max: 0,
			q1: 0,
			q3: 0,
			ci95Lower: 0,
			ci95Upper: 0,
		};
	}

	const sorted = [...values].sort((a, b) => a - b);
	const m = mean(values);
	const sd = standardDeviation(values);
	const [ciLower, ciUpper] = confidenceInterval(m, sd, values.length);

	return {
		n: values.length,
		mean: m,
		median: median(values),
		stdDev: sd,
		min: sorted[0],
		max: sorted[sorted.length - 1],
		q1: percentile(values, 25),
		q3: percentile(values, 75),
		ci95Lower: ciLower,
		ci95Upper: ciUpper,
	};
}

// =============================================================================
// Effect Size
// =============================================================================

/**
 * Calculate Cohen's d effect size
 *
 * @param mean1 - Mean of first group
 * @param mean2 - Mean of second group (or target value for one-sample)
 * @param pooledStdDev - Pooled standard deviation
 * @returns Cohen's d value
 */
export function cohensD(mean1: number, mean2: number, pooledStdDev: number): number {
	if (pooledStdDev === 0) return 0;
	return (mean1 - mean2) / pooledStdDev;
}

/**
 * Calculate pooled standard deviation for two groups
 */
export function pooledStandardDeviation(n1: number, sd1: number, n2: number, sd2: number): number {
	if (n1 + n2 <= 2) return 0;
	const pooledVariance = ((n1 - 1) * sd1 ** 2 + (n2 - 1) * sd2 ** 2) / (n1 + n2 - 2);
	return Math.sqrt(pooledVariance);
}

/**
 * Interpret Cohen's d effect size
 */
export function interpretEffectSize(d: number): EffectInterpretation {
	const absD = Math.abs(d);
	if (absD < 0.2) return 'negligible';
	if (absD < 0.5) return 'small';
	if (absD < 0.8) return 'medium';
	if (absD < 1.2) return 'large';
	return 'very_large';
}

// =============================================================================
// Sample Size Calculations
// =============================================================================

/**
 * Calculate required sample size for one-sample t-test
 *
 * @param effectSize - Expected Cohen's d effect size
 * @param alpha - Significance level (default 0.05)
 * @param power - Statistical power (default 0.80)
 * @returns Required sample size
 */
export function sampleSizeOneSampleTTest(effectSize: number, alpha = 0.05, power = 0.8): number {
	// Using simplified formula: n = (z_alpha + z_beta)^2 / d^2
	// Where z_alpha is two-tailed and z_beta is one-tailed

	const zAlpha = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.645;
	const zBeta = power === 0.8 ? 0.84 : power === 0.9 ? 1.28 : power === 0.95 ? 1.645 : 0.84;

	if (effectSize === 0) return Infinity;

	const n = (zAlpha + zBeta) ** 2 / effectSize ** 2;
	return Math.ceil(n);
}

/**
 * Calculate required sample size for two-sample t-test
 *
 * @param effectSize - Expected Cohen's d effect size
 * @param alpha - Significance level (default 0.05)
 * @param power - Statistical power (default 0.80)
 * @returns Required sample size per group
 */
export function sampleSizeTwoSampleTTest(effectSize: number, alpha = 0.05, power = 0.8): number {
	// n per group = 2 * (z_alpha + z_beta)^2 / d^2
	return Math.ceil(2 * sampleSizeOneSampleTTest(effectSize, alpha, power));
}

/**
 * Calculate required sample size for a proportion test
 *
 * @param p1 - Expected proportion in group 1
 * @param p2 - Expected proportion in group 2
 * @param alpha - Significance level (default 0.05)
 * @param power - Statistical power (default 0.80)
 * @returns Required sample size per group
 */
export function sampleSizeProportionTest(
	p1: number,
	p2: number,
	alpha = 0.05,
	power = 0.8,
): number {
	const zAlpha = alpha === 0.05 ? 1.96 : alpha === 0.01 ? 2.576 : 1.645;
	const zBeta = power === 0.8 ? 0.84 : power === 0.9 ? 1.28 : 0.84;

	const pBar = (p1 + p2) / 2;
	const effect = Math.abs(p1 - p2);

	if (effect === 0) return Infinity;

	const n =
		(zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) +
			zBeta * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) **
			2 /
		effect ** 2;

	return Math.ceil(n);
}

/**
 * Calculate required sample size to achieve target CI width
 *
 * @param expectedStdDev - Expected standard deviation
 * @param targetWidth - Target CI width
 * @param confidence - Confidence level
 * @returns Required sample size
 */
export function sampleSizeForCIWidth(
	expectedStdDev: number,
	targetWidth: number,
	confidence: 0.9 | 0.95 | 0.99 = 0.95,
): number {
	const z = Z_VALUES[confidence];
	// CI width = 2 * z * (stdDev / sqrt(n))
	// Solving for n: n = (2 * z * stdDev / targetWidth)^2
	const n = ((2 * z * expectedStdDev) / targetWidth) ** 2;
	return Math.ceil(n);
}

// =============================================================================
// T-Test Utilities
// =============================================================================

/**
 * Get critical t-value for a given degrees of freedom and alpha
 */
export function getCriticalT(df: number, alpha: number): number {
	// Find closest df in table
	const dfs = Object.keys(T_TABLE)
		.map(Number)
		.sort((a, b) => a - b);
	let closestDf = dfs[0];
	for (const tableDf of dfs) {
		if (tableDf <= df) closestDf = tableDf;
		else break;
	}

	// Find closest alpha
	const alphaKey = alpha <= 0.01 ? 0.01 : alpha <= 0.05 ? 0.05 : 0.1;
	return T_TABLE[closestDf][alphaKey];
}

/**
 * Calculate t-statistic for one-sample test
 */
export function tStatisticOneSample(
	sampleMean: number,
	populationMean: number,
	sampleStdDev: number,
	n: number,
): number {
	if (n <= 1 || sampleStdDev === 0) return 0;
	return (sampleMean - populationMean) / (sampleStdDev / Math.sqrt(n));
}

/**
 * Calculate t-statistic for two-sample test (equal variance assumed)
 */
export function tStatisticTwoSample(
	mean1: number,
	mean2: number,
	sd1: number,
	sd2: number,
	n1: number,
	n2: number,
): number {
	const pooledSd = pooledStandardDeviation(n1, sd1, n2, sd2);
	if (pooledSd === 0) return 0;
	const se = pooledSd * Math.sqrt(1 / n1 + 1 / n2);
	return (mean1 - mean2) / se;
}

/**
 * Calculate t-statistic for Welch's t-test (unequal variance)
 */
export function tStatisticWelch(
	mean1: number,
	mean2: number,
	sd1: number,
	sd2: number,
	n1: number,
	n2: number,
): number {
	const se = Math.sqrt(sd1 ** 2 / n1 + sd2 ** 2 / n2);
	if (se === 0) return 0;
	return (mean1 - mean2) / se;
}

/**
 * Calculate Welch-Satterthwaite degrees of freedom
 */
export function welchDF(sd1: number, sd2: number, n1: number, n2: number): number {
	const v1 = sd1 ** 2 / n1;
	const v2 = sd2 ** 2 / n2;
	const numerator = (v1 + v2) ** 2;
	const denominator = v1 ** 2 / (n1 - 1) + v2 ** 2 / (n2 - 1);
	return denominator === 0 ? 1 : numerator / denominator;
}

// =============================================================================
// P-Value Approximation
// =============================================================================

/**
 * Approximate p-value from t-statistic using normal approximation
 * (Valid for large samples, df > 30)
 */
export function approximatePValue(tStat: number, twoTailed = true): number {
	// Using normal approximation for simplicity
	// For more accuracy, would need full t-distribution CDF
	const z = Math.abs(tStat);

	// Standard normal CDF approximation (Abramowitz and Stegun)
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	const t = 1.0 / (1.0 + p * z);
	const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
	const cdf = 1 - pdf * t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));

	const pOneTail = 1 - cdf;
	return twoTailed ? 2 * pOneTail : pOneTail;
}

// =============================================================================
// Chi-Square Utilities
// =============================================================================

/**
 * Calculate chi-square statistic for a 2x2 contingency table
 *
 * @param observed - 2x2 matrix of observed counts [[a, b], [c, d]]
 * @returns Chi-square statistic
 */
export function chiSquare2x2(observed: [[number, number], [number, number]]): number {
	const [[a, b], [c, d]] = observed;
	const n = a + b + c + d;

	if (n === 0) return 0;

	// Expected values
	const rowTotals = [a + b, c + d];
	const colTotals = [a + c, b + d];

	const expected: [[number, number], [number, number]] = [
		[(rowTotals[0] * colTotals[0]) / n, (rowTotals[0] * colTotals[1]) / n],
		[(rowTotals[1] * colTotals[0]) / n, (rowTotals[1] * colTotals[1]) / n],
	];

	// Chi-square calculation
	let chiSq = 0;
	for (let i = 0; i < 2; i++) {
		for (let j = 0; j < 2; j++) {
			const e = expected[i][j];
			if (e > 0) {
				chiSq += (observed[i][j] - e) ** 2 / e;
			}
		}
	}

	return chiSq;
}

/**
 * Approximate p-value for chi-square with 1 degree of freedom
 */
export function chiSquarePValue1DF(chiSq: number): number {
	// Using Wilson-Hilferty approximation
	if (chiSq <= 0) return 1;

	// For 1 df: p = 2 * (1 - Phi(sqrt(chi-sq)))
	const z = Math.sqrt(chiSq);
	return approximatePValue(z, false) * 2;
}
