/**
 * Experiment Runner
 *
 * Orchestrates experiment execution with stopping rules, progress tracking,
 * and result aggregation. Supports calibration, head-to-head, and decision
 * quality experiments.
 *
 * @example
 * const runner = new ExperimentRunner(experimentDefinition);
 * runner.onProgress((progress) => console.log(progress));
 * const results = await runner.run(simulationConfig);
 */

import { runBatchSingleThreaded } from '../batch/single-threaded.js';
import type {
	DescriptiveStats,
	ExperimentDefinition,
	ExperimentResults,
	GameResult,
	Hypothesis,
	HypothesisTestResult,
	MetricId,
	ProfileId,
	SimulationConfig,
	StoppingRule,
} from '../schemas/index.js';
import { bonferroniCorrection, testHypothesis } from './hypothesis.js';
import { calculateDescriptiveStats } from './statistics.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Progress update during experiment execution
 */
export interface ExperimentProgress {
	experimentId: string;
	phase: 'running' | 'analyzing' | 'complete';
	gamesCompleted: number;
	gamesTarget: number;
	elapsedMs: number;
	estimatedRemainingMs: number;
	currentCIWidth?: number;
	targetCIWidth?: number;
	profileProgress: Record<string, { games: number; meanScore: number; ciWidth: number }>;
}

/**
 * Progress callback type
 */
export type ExperimentProgressCallback = (progress: ExperimentProgress) => void;

/**
 * Metrics extracted from a game result
 */
interface ExtractedMetrics {
	totalScore: number;
	upperSectionScore: number;
	lowerSectionScore: number;
	upperBonus: boolean;
	diceeCount: number;
	optimalDecisions?: number;
	totalDecisions?: number;
	evLoss?: number;
}

// =============================================================================
// Metric Extraction
// =============================================================================

/**
 * Extract metrics from a game result for a specific player
 */
function extractMetrics(game: GameResult, playerId: string): ExtractedMetrics | null {
	const player = game.players.find((p) => p.id === playerId);
	if (!player) return null;

	const sc = player.scorecard;

	// Calculate upper section score
	const upperSectionScore =
		(sc.ones ?? 0) +
		(sc.twos ?? 0) +
		(sc.threes ?? 0) +
		(sc.fours ?? 0) +
		(sc.fives ?? 0) +
		(sc.sixes ?? 0);

	// Calculate lower section score
	const lowerSectionScore =
		(sc.threeOfAKind ?? 0) +
		(sc.fourOfAKind ?? 0) +
		(sc.fullHouse ?? 0) +
		(sc.smallStraight ?? 0) +
		(sc.largeStraight ?? 0) +
		(sc.dicee ?? 0) +
		(sc.chance ?? 0);

	return {
		totalScore: player.finalScore,
		upperSectionScore,
		lowerSectionScore,
		upperBonus: player.upperBonus,
		diceeCount: player.diceeCount,
		optimalDecisions: player.optimalDecisions,
		totalDecisions: player.totalDecisions,
		evLoss: player.evLoss,
	};
}

/**
 * Get metric value from extracted metrics
 */
function getMetricValue(metrics: ExtractedMetrics, metricId: MetricId): number {
	switch (metricId) {
		case 'total_score':
			return metrics.totalScore;
		case 'upper_section_score':
			return metrics.upperSectionScore;
		case 'lower_section_score':
			return metrics.lowerSectionScore;
		case 'upper_bonus_rate':
			return metrics.upperBonus ? 1 : 0;
		case 'dicee_rate':
			return metrics.diceeCount > 0 ? 1 : 0;
		case 'dicee_bonus_rate':
			return metrics.diceeCount > 1 ? 1 : 0;
		case 'optimal_decision_rate':
			if (metrics.totalDecisions && metrics.optimalDecisions !== undefined) {
				return metrics.optimalDecisions / metrics.totalDecisions;
			}
			return 0;
		case 'ev_loss_per_decision':
			if (metrics.totalDecisions && metrics.evLoss !== undefined) {
				return metrics.evLoss / metrics.totalDecisions;
			}
			return 0;
		case 'win_rate':
			// Win rate requires game-level context, not individual metrics
			return 0;
		default:
			return 0;
	}
}

// =============================================================================
// Stopping Rule Evaluation
// =============================================================================

/**
 * Check if stopping rule is satisfied
 */
function shouldStop(
	rule: StoppingRule,
	gamesCompleted: number,
	stats: Map<string, Map<string, DescriptiveStats>>,
	_hypotheses: Hypothesis[], // Reserved for sequential stopping rule
): { stop: boolean; reason: string } {
	switch (rule.type) {
		case 'FIXED':
			if (gamesCompleted >= rule.gamesPerUnit) {
				return { stop: true, reason: `Fixed target of ${rule.gamesPerUnit} games reached` };
			}
			return { stop: false, reason: '' };

		case 'SEQUENTIAL': {
			if (gamesCompleted < rule.minGames) {
				return { stop: false, reason: '' };
			}
			if (gamesCompleted >= rule.maxGames) {
				return { stop: true, reason: `Maximum games (${rule.maxGames}) reached` };
			}
			// Check every N games
			if (gamesCompleted % rule.checkEveryN !== 0) {
				return { stop: false, reason: '' };
			}
			// TODO: Implement early stopping based on p-value
			return { stop: false, reason: '' };
		}

		case 'ADAPTIVE': {
			if (gamesCompleted < rule.minGames) {
				return { stop: false, reason: '' };
			}
			if (gamesCompleted >= rule.maxGames) {
				return { stop: true, reason: `Maximum games (${rule.maxGames}) reached` };
			}
			// Check if all CI widths are below target
			let allBelowTarget = true;
			let maxWidth = 0;
			for (const [_profileId, metricStats] of stats) {
				const totalScoreStats = metricStats.get('total_score');
				if (totalScoreStats) {
					const width = totalScoreStats.ci95Upper - totalScoreStats.ci95Lower;
					maxWidth = Math.max(maxWidth, width);
					if (width > rule.targetCIWidth) {
						allBelowTarget = false;
					}
				}
			}
			if (allBelowTarget && stats.size > 0) {
				return { stop: true, reason: `Target CI width (${rule.targetCIWidth}) achieved` };
			}
			return { stop: false, reason: '' };
		}

		default:
			return { stop: false, reason: '' };
	}
}

// =============================================================================
// Experiment Runner
// =============================================================================

/**
 * Experiment runner for scientific simulations
 */
export class ExperimentRunner {
	private definition: ExperimentDefinition;
	private progressCallback: ExperimentProgressCallback | null = null;
	private startTime = 0;

	constructor(definition: ExperimentDefinition) {
		this.definition = definition;
	}

	/**
	 * Set progress callback
	 */
	onProgress(callback: ExperimentProgressCallback): void {
		this.progressCallback = callback;
	}

	/**
	 * Run the experiment
	 */
	async run(): Promise<ExperimentResults> {
		this.startTime = performance.now();
		const startedAt = new Date().toISOString();

		// Collect results by profile
		const resultsByProfile = new Map<string, GameResult[]>();
		const metricsByProfile = new Map<string, Map<string, number[]>>();

		// Initialize storage
		for (const profileId of this.definition.profileIds) {
			resultsByProfile.set(profileId, []);
			const metricsMap = new Map<string, number[]>();
			for (const metric of this.definition.metrics) {
				metricsMap.set(metric, []);
			}
			metricsByProfile.set(profileId, metricsMap);
		}

		// Determine batch size based on stopping rule
		const batchSize = this.getBatchSize();
		let totalGamesCompleted = 0;

		// Run batches until stopping condition met
		while (true) {
			// Run games for each profile
			for (const profileId of this.definition.profileIds) {
				const simConfig: SimulationConfig = {
					players: [{ id: 'p1', profileId }],
					captureDecisions: this.definition.metrics.some(
						(m) => m === 'optimal_decision_rate' || m === 'ev_loss_per_decision',
					),
					captureIntermediateStates: false,
				};

				const batchResult = await runBatchSingleThreaded({
					gameCount: batchSize,
					simulationConfig: simConfig,
					seed: this.definition.masterSeed
						? this.definition.masterSeed + totalGamesCompleted
						: undefined,
					onProgress: (p) =>
						this.emitProgress(totalGamesCompleted, p.completedGames, metricsByProfile),
				});

				// Collect results
				const profileResults = resultsByProfile.get(profileId)!;
				const profileMetrics = metricsByProfile.get(profileId)!;

				for (const game of batchResult.results) {
					profileResults.push(game);
					const metrics = extractMetrics(game, 'p1');
					if (metrics) {
						for (const metricId of this.definition.metrics) {
							const value = getMetricValue(metrics, metricId);
							profileMetrics.get(metricId)!.push(value);
						}
					}
				}

				totalGamesCompleted += batchResult.results.length;
			}

			// Calculate current statistics
			const currentStats = this.calculateStats(metricsByProfile);

			// Check stopping condition
			const { stop, reason } = shouldStop(
				this.definition.stoppingRule,
				totalGamesCompleted / this.definition.profileIds.length,
				currentStats,
				this.definition.hypotheses,
			);

			if (stop) {
				console.log(`[ExperimentRunner] Stopping: ${reason}`);
				break;
			}

			// Safety check
			if (totalGamesCompleted > 1_000_000) {
				console.warn('[ExperimentRunner] Safety limit reached');
				break;
			}
		}

		// Final analysis
		const completedAt = new Date().toISOString();
		const durationMs = performance.now() - this.startTime;

		// Calculate final statistics
		const statsByProfile = this.calculateStatsForResults(metricsByProfile);

		// Test hypotheses
		const hypothesisResults = this.testHypotheses(metricsByProfile);

		// Apply Bonferroni correction if multiple hypotheses
		const correctedResults =
			hypothesisResults.length > 1
				? bonferroniCorrection(hypothesisResults, this.definition.hypotheses[0]?.alpha ?? 0.05)
				: hypothesisResults;

		const allHypothesesPassed = correctedResults.every((r) => r.rejected);

		// Generate summary
		const summary = this.generateSummary(correctedResults, statsByProfile);

		return {
			experimentId: this.definition.id,
			experimentVersion: this.definition.version,
			startedAt,
			completedAt,
			totalGames: totalGamesCompleted,
			durationMs: Math.round(durationMs),
			masterSeed: this.definition.masterSeed,
			statsByProfile,
			hypothesisResults: correctedResults,
			allHypothesesPassed,
			summary,
		};
	}

	/**
	 * Get batch size based on stopping rule
	 */
	private getBatchSize(): number {
		switch (this.definition.stoppingRule.type) {
			case 'FIXED':
				return Math.min(100, this.definition.stoppingRule.gamesPerUnit);
			case 'SEQUENTIAL':
				return this.definition.stoppingRule.checkEveryN;
			case 'ADAPTIVE':
				return 50;
			default:
				return 100;
		}
	}

	/**
	 * Emit progress update
	 */
	private emitProgress(
		baseGames: number,
		batchGames: number,
		metricsByProfile: Map<string, Map<string, number[]>>,
	): void {
		if (!this.progressCallback) return;

		const gamesCompleted = baseGames + batchGames;
		const elapsedMs = performance.now() - this.startTime;

		// Calculate target based on stopping rule
		let gamesTarget = 0;
		switch (this.definition.stoppingRule.type) {
			case 'FIXED':
				gamesTarget = this.definition.stoppingRule.gamesPerUnit * this.definition.profileIds.length;
				break;
			case 'SEQUENTIAL':
				gamesTarget = this.definition.stoppingRule.maxGames * this.definition.profileIds.length;
				break;
			case 'ADAPTIVE':
				gamesTarget = this.definition.stoppingRule.maxGames * this.definition.profileIds.length;
				break;
		}

		const gamesPerSecond = gamesCompleted > 0 ? (gamesCompleted / elapsedMs) * 1000 : 0;
		const remainingGames = gamesTarget - gamesCompleted;
		const estimatedRemainingMs = gamesPerSecond > 0 ? (remainingGames / gamesPerSecond) * 1000 : 0;

		// Profile progress
		const profileProgress: Record<string, { games: number; meanScore: number; ciWidth: number }> =
			{};
		for (const [profileId, metrics] of metricsByProfile) {
			const scores = metrics.get('total_score') ?? [];
			const stats = calculateDescriptiveStats(scores);
			profileProgress[profileId] = {
				games: scores.length,
				meanScore: stats.mean,
				ciWidth: stats.ci95Upper - stats.ci95Lower,
			};
		}

		this.progressCallback({
			experimentId: this.definition.id,
			phase: 'running',
			gamesCompleted,
			gamesTarget,
			elapsedMs,
			estimatedRemainingMs,
			profileProgress,
		});
	}

	/**
	 * Calculate statistics for stopping rule evaluation
	 */
	private calculateStats(
		metricsByProfile: Map<string, Map<string, number[]>>,
	): Map<string, Map<string, DescriptiveStats>> {
		const result = new Map<string, Map<string, DescriptiveStats>>();

		for (const [profileId, metrics] of metricsByProfile) {
			const statsMap = new Map<string, DescriptiveStats>();
			for (const [metricId, values] of metrics) {
				statsMap.set(metricId, calculateDescriptiveStats(values));
			}
			result.set(profileId, statsMap);
		}

		return result;
	}

	/**
	 * Calculate final statistics for results
	 */
	private calculateStatsForResults(
		metricsByProfile: Map<string, Map<string, number[]>>,
	): Record<string, Record<string, DescriptiveStats>> {
		const result: Record<string, Record<string, DescriptiveStats>> = {};

		for (const [profileId, metrics] of metricsByProfile) {
			result[profileId] = {};
			for (const [metricId, values] of metrics) {
				result[profileId][metricId] = calculateDescriptiveStats(values);
			}
		}

		return result;
	}

	/**
	 * Test all hypotheses
	 */
	private testHypotheses(
		metricsByProfile: Map<string, Map<string, number[]>>,
	): HypothesisTestResult[] {
		const results: HypothesisTestResult[] = [];

		for (const hypothesis of this.definition.hypotheses) {
			// Get the relevant data
			const profileId = hypothesis.profileId ?? this.definition.profileIds[0];
			const metrics = metricsByProfile.get(profileId);

			if (!metrics) {
				results.push({
					hypothesisId: hypothesis.id,
					rejected: false,
					pValue: 1,
					testStatistic: 0,
					effectSize: 0,
					effectInterpretation: 'negligible',
					sampleSize: 0,
					conclusion: `No data for profile ${profileId}`,
				});
				continue;
			}

			const values = metrics.get(hypothesis.metric) ?? [];

			if (values.length === 0) {
				results.push({
					hypothesisId: hypothesis.id,
					rejected: false,
					pValue: 1,
					testStatistic: 0,
					effectSize: 0,
					effectInterpretation: 'negligible',
					sampleSize: 0,
					conclusion: `No data for metric ${hypothesis.metric}`,
				});
				continue;
			}

			// For two-sample tests, need comparison data
			// For now, only supporting one-sample tests
			const result = testHypothesis(hypothesis, values);
			results.push(result);
		}

		return results;
	}

	/**
	 * Generate human-readable summary
	 */
	private generateSummary(
		hypothesisResults: HypothesisTestResult[],
		statsByProfile: Record<string, Record<string, DescriptiveStats>>,
	): string {
		const lines: string[] = [];

		lines.push(`Experiment: ${this.definition.title}`);
		lines.push(`Type: ${this.definition.type}`);
		lines.push('');

		// Profile summaries
		lines.push('Profile Results:');
		for (const [profileId, metrics] of Object.entries(statsByProfile)) {
			const totalScore = metrics['total_score'];
			if (totalScore) {
				lines.push(
					`  ${profileId}: mean=${totalScore.mean.toFixed(1)}, ` +
						`95% CI [${totalScore.ci95Lower.toFixed(1)}, ${totalScore.ci95Upper.toFixed(1)}], ` +
						`n=${totalScore.n}`,
				);
			}
		}
		lines.push('');

		// Hypothesis results
		lines.push('Hypothesis Results:');
		for (const result of hypothesisResults) {
			const status = result.rejected ? '✓ PASSED' : '✗ FAILED';
			lines.push(`  ${result.hypothesisId}: ${status}`);
			lines.push(`    ${result.conclusion}`);
		}

		return lines.join('\n');
	}
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Run a calibration experiment for a single profile
 */
export async function runCalibrationExperiment(
	profileId: ProfileId,
	targetScore: number,
	options: {
		gameCount?: number;
		tolerance?: number;
		seed?: number;
		onProgress?: ExperimentProgressCallback;
	} = {},
): Promise<ExperimentResults> {
	const { gameCount = 1000, tolerance = 10, seed, onProgress } = options;

	const definition: ExperimentDefinition = {
		id: `calibration_${profileId}`,
		version: '1.0.0',
		title: `Calibration for ${profileId}`,
		description: `Verify ${profileId} profile achieves target score of ${targetScore}`,
		type: 'CALIBRATION',
		createdAt: new Date().toISOString(),
		tags: ['calibration'],
		hypotheses: [
			{
				id: 'H1',
				nullHypothesis: `${profileId} mean score is not within ${tolerance} points of ${targetScore}`,
				alternativeHypothesis: `${profileId} mean score is within ${tolerance} points of ${targetScore}`,
				metric: 'total_score',
				profileId,
				direction: 'within_range',
				target: { low: targetScore - tolerance, high: targetScore + tolerance },
				test: 't_test_one_sample',
				alpha: 0.05,
				minEffectSize: 0.5,
				power: 0.8,
			},
		],
		profileIds: [profileId],
		stoppingRule: { type: 'FIXED', gamesPerUnit: gameCount },
		metrics: ['total_score', 'upper_section_score', 'lower_section_score'],
		masterSeed: seed,
		playersPerGame: 1,
	};

	const runner = new ExperimentRunner(definition);
	if (onProgress) runner.onProgress(onProgress);

	return runner.run();
}

/**
 * Run a quick benchmark experiment
 */
export async function runQuickExperiment(
	profileIds: ProfileId[],
	gameCount = 100,
	seed?: number,
): Promise<ExperimentResults> {
	const definition: ExperimentDefinition = {
		id: 'quick_benchmark',
		version: '1.0.0',
		title: 'Quick Benchmark',
		description: `Quick comparison of profiles: ${profileIds.join(', ')}`,
		type: 'CALIBRATION',
		createdAt: new Date().toISOString(),
		tags: ['benchmark'],
		hypotheses: profileIds.map((profileId, i) => ({
			id: `H${i + 1}`,
			nullHypothesis: `${profileId} has no measurable score`,
			alternativeHypothesis: `${profileId} achieves a positive score`,
			metric: 'total_score' as MetricId,
			profileId,
			direction: 'greater_than' as const,
			target: 0,
			test: 't_test_one_sample' as const,
			alpha: 0.05,
			minEffectSize: 0.5,
			power: 0.8,
		})),
		profileIds,
		stoppingRule: { type: 'FIXED', gamesPerUnit: gameCount },
		metrics: ['total_score'],
		masterSeed: seed,
		playersPerGame: 1,
	};

	const runner = new ExperimentRunner(definition);
	return runner.run();
}
