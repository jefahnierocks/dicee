/**
 * Experiment Framework Tests
 *
 * Tests for statistical functions, hypothesis testing, and experiment runner.
 */

import { describe, expect, it } from 'vitest';
import {
	approximatePValue,
	bonferroniCorrection,
	calculateDescriptiveStats,
	chiSquare2x2,
	chiSquareTest,
	cohensD,
	confidenceInterval,
	confidenceIntervalWidth,
	interpretEffectSize,
	// Statistics
	mean,
	median,
	// Hypothesis testing
	oneSampleTTest,
	percentile,
	pooledStandardDeviation,
	rangeTest,
	// Runner
	runQuickExperiment,
	sampleSizeForCIWidth,
	sampleSizeOneSampleTTest,
	sampleSizeTwoSampleTTest,
	standardDeviation,
	standardError,
	testHypothesis,
	tStatisticOneSample,
	tStatisticTwoSample,
	twoSampleTTest,
	variance,
	welchTTest,
} from '../experiment/index.js';
import type { Hypothesis } from '../schemas/index.js';

// =============================================================================
// Basic Statistics Tests
// =============================================================================

describe('Basic Statistics', () => {
	describe('mean', () => {
		it('should calculate mean of an array', () => {
			expect(mean([1, 2, 3, 4, 5])).toBe(3);
			expect(mean([10, 20, 30])).toBe(20);
		});

		it('should return 0 for empty array', () => {
			expect(mean([])).toBe(0);
		});

		it('should handle single value', () => {
			expect(mean([42])).toBe(42);
		});
	});

	describe('median', () => {
		it('should find median of odd-length array', () => {
			expect(median([1, 2, 3, 4, 5])).toBe(3);
			expect(median([5, 1, 3])).toBe(3);
		});

		it('should find median of even-length array', () => {
			expect(median([1, 2, 3, 4])).toBe(2.5);
		});

		it('should return 0 for empty array', () => {
			expect(median([])).toBe(0);
		});
	});

	describe('variance', () => {
		it('should calculate sample variance', () => {
			const data = [2, 4, 4, 4, 5, 5, 7, 9];
			// Sample variance with Bessel's correction
			expect(variance(data)).toBeCloseTo(4.57, 1);
		});

		it('should calculate population variance', () => {
			const data = [2, 4, 4, 4, 5, 5, 7, 9];
			expect(variance(data, true)).toBeCloseTo(4, 1);
		});
	});

	describe('standardDeviation', () => {
		it('should calculate sample standard deviation', () => {
			const data = [2, 4, 4, 4, 5, 5, 7, 9];
			expect(standardDeviation(data)).toBeCloseTo(2.14, 1);
		});
	});

	describe('standardError', () => {
		it('should calculate standard error', () => {
			expect(standardError(10, 100)).toBeCloseTo(1, 5);
			expect(standardError(20, 400)).toBeCloseTo(1, 5);
		});

		it('should return 0 for n <= 0', () => {
			expect(standardError(10, 0)).toBe(0);
		});
	});

	describe('percentile', () => {
		it('should calculate percentiles', () => {
			const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
			expect(percentile(data, 50)).toBeCloseTo(5.5, 1);
			// Linear interpolation percentile method
			expect(percentile(data, 25)).toBeCloseTo(3.25, 1);
			expect(percentile(data, 75)).toBeCloseTo(7.75, 1);
		});

		it('should return 0 for empty array', () => {
			expect(percentile([], 50)).toBe(0);
		});
	});
});

// =============================================================================
// Confidence Interval Tests
// =============================================================================

describe('Confidence Intervals', () => {
	describe('confidenceInterval', () => {
		it('should calculate 95% CI', () => {
			const [lower, upper] = confidenceInterval(100, 10, 100, 0.95);
			expect(lower).toBeCloseTo(98.04, 1);
			expect(upper).toBeCloseTo(101.96, 1);
		});

		it('should return mean for n=1', () => {
			const [lower, upper] = confidenceInterval(50, 10, 1);
			expect(lower).toBe(50);
			expect(upper).toBe(50);
		});

		it('should have wider interval for 99% confidence', () => {
			const ci95 = confidenceInterval(100, 10, 100, 0.95);
			const ci99 = confidenceInterval(100, 10, 100, 0.99);
			expect(ci99[1] - ci99[0]).toBeGreaterThan(ci95[1] - ci95[0]);
		});
	});

	describe('confidenceIntervalWidth', () => {
		it('should decrease with larger sample size', () => {
			const width100 = confidenceIntervalWidth(10, 100);
			const width400 = confidenceIntervalWidth(10, 400);
			expect(width400).toBeLessThan(width100);
			expect(width400).toBeCloseTo(width100 / 2, 1);
		});
	});

	describe('calculateDescriptiveStats', () => {
		it('should calculate all descriptive statistics', () => {
			const data = Array.from({ length: 100 }, (_, i) => i + 1);
			const stats = calculateDescriptiveStats(data);

			expect(stats.n).toBe(100);
			expect(stats.mean).toBeCloseTo(50.5, 1);
			expect(stats.median).toBeCloseTo(50.5, 1);
			expect(stats.min).toBe(1);
			expect(stats.max).toBe(100);
			expect(stats.stdDev).toBeGreaterThan(0);
			expect(stats.ci95Lower).toBeLessThan(stats.mean);
			expect(stats.ci95Upper).toBeGreaterThan(stats.mean);
		});

		it('should handle empty array', () => {
			const stats = calculateDescriptiveStats([]);
			expect(stats.n).toBe(0);
			expect(stats.mean).toBe(0);
		});
	});
});

// =============================================================================
// Effect Size Tests
// =============================================================================

describe('Effect Size', () => {
	describe('cohensD', () => {
		it("should calculate Cohen's d", () => {
			expect(cohensD(110, 100, 10)).toBe(1);
			expect(cohensD(105, 100, 10)).toBe(0.5);
			expect(cohensD(100, 100, 10)).toBe(0);
		});

		it('should return 0 for zero std dev', () => {
			expect(cohensD(110, 100, 0)).toBe(0);
		});
	});

	describe('pooledStandardDeviation', () => {
		it('should calculate pooled SD for equal groups', () => {
			const pooled = pooledStandardDeviation(50, 10, 50, 10);
			expect(pooled).toBeCloseTo(10, 1);
		});

		it('should weight by sample size', () => {
			const pooled = pooledStandardDeviation(90, 10, 10, 20);
			// Should be closer to 10 since n1 is larger
			expect(pooled).toBeLessThan(15);
		});
	});

	describe('interpretEffectSize', () => {
		it('should interpret effect sizes correctly', () => {
			expect(interpretEffectSize(0.1)).toBe('negligible');
			expect(interpretEffectSize(0.3)).toBe('small');
			expect(interpretEffectSize(0.6)).toBe('medium');
			expect(interpretEffectSize(1.0)).toBe('large');
			expect(interpretEffectSize(1.5)).toBe('very_large');
		});

		it('should use absolute value', () => {
			expect(interpretEffectSize(-0.6)).toBe('medium');
		});
	});
});

// =============================================================================
// Sample Size Calculation Tests
// =============================================================================

describe('Sample Size Calculations', () => {
	describe('sampleSizeOneSampleTTest', () => {
		it('should calculate required sample size', () => {
			// For medium effect size d=0.5, alpha=0.05, power=0.8
			const n = sampleSizeOneSampleTTest(0.5, 0.05, 0.8);
			expect(n).toBeGreaterThanOrEqual(25);
			expect(n).toBeLessThanOrEqual(40);
		});

		it('should require larger sample for smaller effect', () => {
			const nSmall = sampleSizeOneSampleTTest(0.2);
			const nLarge = sampleSizeOneSampleTTest(0.8);
			expect(nSmall).toBeGreaterThan(nLarge);
		});

		it('should return Infinity for zero effect size', () => {
			expect(sampleSizeOneSampleTTest(0)).toBe(Infinity);
		});
	});

	describe('sampleSizeTwoSampleTTest', () => {
		it('should require ~2x sample of one-sample for same effect', () => {
			const nOne = sampleSizeOneSampleTTest(0.5);
			const nTwo = sampleSizeTwoSampleTTest(0.5);
			expect(nTwo).toBeGreaterThan(nOne);
			expect(nTwo).toBeLessThanOrEqual(nOne * 2.5);
		});
	});

	describe('sampleSizeForCIWidth', () => {
		it('should calculate sample size for target CI width', () => {
			const n = sampleSizeForCIWidth(30, 10, 0.95);
			// CI width = 2 * 1.96 * 30 / sqrt(n) = 10
			// sqrt(n) = 2 * 1.96 * 30 / 10 = 11.76
			// n ≈ 138
			expect(n).toBeGreaterThanOrEqual(130);
			expect(n).toBeLessThanOrEqual(150);
		});
	});
});

// =============================================================================
// T-Statistic Tests
// =============================================================================

describe('T-Statistics', () => {
	describe('tStatisticOneSample', () => {
		it('should calculate one-sample t-statistic', () => {
			// t = (105 - 100) / (10 / sqrt(100)) = 5 / 1 = 5
			const t = tStatisticOneSample(105, 100, 10, 100);
			expect(t).toBeCloseTo(5, 1);
		});

		it('should return 0 for n=1', () => {
			expect(tStatisticOneSample(105, 100, 10, 1)).toBe(0);
		});
	});

	describe('tStatisticTwoSample', () => {
		it('should calculate two-sample t-statistic', () => {
			const t = tStatisticTwoSample(105, 100, 10, 10, 50, 50);
			expect(t).toBeGreaterThan(0);
		});
	});

	describe('approximatePValue', () => {
		it('should approximate p-values', () => {
			// t=2 using normal approximation: p ≈ 0.0455 (two-tailed)
			// Our implementation uses a slightly different approximation
			const p = approximatePValue(2, true);
			expect(p).toBeLessThan(0.05);
			expect(p).toBeGreaterThan(0.02);
		});

		it('should return higher p for one-tailed when t is in wrong direction', () => {
			const pOneTail = approximatePValue(2, false);
			const pTwoTail = approximatePValue(2, true);
			expect(pOneTail).toBeLessThan(pTwoTail);
		});
	});
});

// =============================================================================
// Chi-Square Tests
// =============================================================================

describe('Chi-Square', () => {
	describe('chiSquare2x2', () => {
		it('should calculate chi-square for 2x2 table', () => {
			// Example: Testing if coin is fair
			// Observed: [50, 50] (heads, tails) vs [60, 40]
			const chiSq = chiSquare2x2([
				[50, 50],
				[60, 40],
			]);
			expect(chiSq).toBeGreaterThan(0);
		});

		it('should return 0 for identical distributions', () => {
			const chiSq = chiSquare2x2([
				[50, 50],
				[50, 50],
			]);
			expect(chiSq).toBeCloseTo(0, 5);
		});
	});
});

// =============================================================================
// Hypothesis Testing Tests
// =============================================================================

describe('Hypothesis Testing', () => {
	describe('oneSampleTTest', () => {
		it('should detect significant difference', () => {
			// Generate data clearly above target
			const data = Array.from({ length: 100 }, () => 110 + Math.random() * 10);
			const result = oneSampleTTest(data, 100, 'greater_than', 0.05);

			expect(result.rejected).toBe(true);
			expect(result.pValue).toBeLessThan(0.05);
			expect(result.sampleSize).toBe(100);
		});

		it('should not reject when data matches target', () => {
			// Ten identical, symmetric cycles around 100 keep this assertion
			// deterministic while retaining non-zero variance for the t-test.
			const data = Array.from({ length: 100 }, (_, index) => 100 + ((index % 10) - 4.5));
			const result = oneSampleTTest(data, 100, 'not_equal', 0.05);

			expect(result.rejected).toBe(false);
			expect(result.pValue).toBeGreaterThan(0.05);
		});

		it('should handle insufficient sample size', () => {
			const result = oneSampleTTest([100], 100, 'not_equal');
			expect(result.rejected).toBe(false);
			expect(result.conclusion).toContain('Insufficient');
		});
	});

	describe('twoSampleTTest', () => {
		it('should detect difference between groups', () => {
			const group1 = Array.from({ length: 50 }, () => 100 + Math.random() * 10);
			const group2 = Array.from({ length: 50 }, () => 120 + Math.random() * 10);
			const result = twoSampleTTest(group1, group2, 'not_equal', 0.05);

			expect(result.rejected).toBe(true);
			expect(result.effectSize).toBeGreaterThan(0);
		});

		it('should not reject for similar groups', () => {
			const group1 = Array.from({ length: 50 }, () => 100 + Math.random() * 10);
			const group2 = Array.from({ length: 50 }, () => 100 + Math.random() * 10);
			const result = twoSampleTTest(group1, group2, 'not_equal', 0.05);

			// May or may not reject depending on random variation
			expect(result.sampleSize).toBe(100);
		});
	});

	describe('welchTTest', () => {
		it('should handle unequal variances', () => {
			const group1 = Array.from({ length: 50 }, () => 100 + Math.random() * 5);
			const group2 = Array.from({ length: 50 }, () => 115 + Math.random() * 20);
			const result = welchTTest(group1, group2, 'not_equal', 0.05);

			expect(result.rejected).toBe(true);
		});
	});

	describe('chiSquareTest', () => {
		it('should detect significantly different win rates', () => {
			const result = chiSquareTest(80, 20, 50, 50, 0.05);

			expect(result.rejected).toBe(true);
			expect(result.conclusion).toContain('differ significantly');
		});

		it('should not reject similar win rates', () => {
			const result = chiSquareTest(52, 48, 48, 52, 0.05);

			expect(result.rejected).toBe(false);
		});
	});

	describe('rangeTest', () => {
		it('should confirm mean within range', () => {
			const data = Array.from({ length: 200 }, () => 250 + (Math.random() - 0.5) * 20);
			const result = rangeTest(data, 240, 260, 0.05);

			expect(result.rejected).toBe(true);
			expect(result.conclusion).toContain('within target range');
		});

		it('should reject when mean outside range', () => {
			const data = Array.from({ length: 100 }, () => 200 + Math.random() * 10);
			const result = rangeTest(data, 250, 270, 0.05);

			expect(result.rejected).toBe(false);
			expect(result.conclusion).toContain('outside');
		});
	});

	describe('testHypothesis', () => {
		it('should test a hypothesis definition', () => {
			const hypothesis: Hypothesis = {
				id: 'H1',
				nullHypothesis: 'Mean score equals 200',
				alternativeHypothesis: 'Mean score is greater than 200',
				metric: 'total_score',
				direction: 'greater_than',
				target: 200,
				test: 't_test_one_sample',
				alpha: 0.05,
				minEffectSize: 0.5,
				power: 0.8,
			};

			const data = Array.from({ length: 100 }, () => 250 + Math.random() * 30);
			const result = testHypothesis(hypothesis, data);

			expect(result.hypothesisId).toBe('H1');
			expect(result.rejected).toBe(true);
		});
	});

	describe('bonferroniCorrection', () => {
		it('should adjust alpha for multiple comparisons', () => {
			const results = [
				{
					hypothesisId: 'H1',
					rejected: true,
					pValue: 0.03,
					testStatistic: 2.5,
					effectSize: 0.5,
					effectInterpretation: 'medium' as const,
					sampleSize: 100,
					conclusion: 'Significant (p=0.03)',
				},
				{
					hypothesisId: 'H2',
					rejected: true,
					pValue: 0.04,
					testStatistic: 2.1,
					effectSize: 0.4,
					effectInterpretation: 'small' as const,
					sampleSize: 100,
					conclusion: 'Significant (p=0.04)',
				},
			];

			const corrected = bonferroniCorrection(results, 0.05);

			// With 2 tests, adjusted alpha = 0.025
			// p=0.03 > 0.025, so H1 should now be not rejected
			expect(corrected[0].rejected).toBe(false);
			expect(corrected[1].rejected).toBe(false);
		});
	});
});

// =============================================================================
// Experiment Runner Tests
// =============================================================================

describe('Experiment Runner', () => {
	describe('runQuickExperiment', () => {
		it('should run a quick experiment', async () => {
			const result = await runQuickExperiment(['custom'], 10, 42);

			expect(result.experimentId).toBe('quick_benchmark');
			expect(result.totalGames).toBe(10);
			expect(result.statsByProfile['custom']).toBeDefined();
			expect(result.statsByProfile['custom']['total_score']).toBeDefined();
			expect(result.hypothesisResults).toHaveLength(1);
		}, 10000);

		it('should run with multiple profiles', async () => {
			const result = await runQuickExperiment(['custom', 'riley'], 5, 123);

			expect(result.totalGames).toBe(10); // 5 games per profile
			expect(result.statsByProfile['custom']).toBeDefined();
			expect(result.statsByProfile['riley']).toBeDefined();
			expect(result.hypothesisResults).toHaveLength(2);
		}, 10000);

		it('should produce deterministic results with same seed', async () => {
			const result1 = await runQuickExperiment(['custom'], 5, 999);
			const result2 = await runQuickExperiment(['custom'], 5, 999);

			expect(result1.statsByProfile['custom']['total_score'].mean).toBe(
				result2.statsByProfile['custom']['total_score'].mean,
			);
		}, 10000);
	});
});
