/**
 * Batch Coordinator
 *
 * Orchestrates parallel game simulations across multiple workers.
 * Handles seed generation, work distribution, progress tracking, and result aggregation.
 *
 * @example
 * const coordinator = new BatchCoordinator({
 *   gameCount: 10000,
 *   workerCount: 12,
 *   baseSeed: 42,
 * });
 *
 * coordinator.onProgress((progress) => {
 *   console.log(`${progress.completedGames}/${progress.totalGames} games`);
 * });
 *
 * const result = await coordinator.run(simulationConfig);
 */

import { SeededRandom } from '../core/seeded-random.js';
import type { GameResult, SimulationConfig } from '../schemas/index.js';
import type {
	BatchResult,
	BatchRunConfig,
	ProgressCallback,
	ResolvedBatchRunConfig,
	WorkerStats,
} from './types.js';
import { getRecommendedWorkerCount, WorkerPool } from './worker-pool.js';

/**
 * Default batch configuration values
 */
const DEFAULT_CONFIG: Omit<ResolvedBatchRunConfig, 'gameCount'> = {
	workerCount: 0, // Will be set to recommended
	baseSeed: 0, // Will be randomized
	outputFormat: 'memory',
	outputPath: null,
	batchSize: 100,
	progressIntervalMs: 1000,
};

/**
 * Resolve batch configuration with defaults
 */
function resolveConfig(config: BatchRunConfig): ResolvedBatchRunConfig {
	return {
		gameCount: config.gameCount,
		workerCount: config.workerCount ?? getRecommendedWorkerCount(),
		baseSeed: config.baseSeed ?? Math.floor(Math.random() * 0xffffffff),
		outputFormat: config.outputFormat ?? DEFAULT_CONFIG.outputFormat,
		outputPath: config.outputPath ?? DEFAULT_CONFIG.outputPath,
		batchSize: config.batchSize ?? DEFAULT_CONFIG.batchSize,
		progressIntervalMs: config.progressIntervalMs ?? DEFAULT_CONFIG.progressIntervalMs,
	};
}

/**
 * Batch coordinator for parallel game simulation
 */
export class BatchCoordinator {
	private config: ResolvedBatchRunConfig;
	private pool: WorkerPool | null = null;
	private progressCallback: ProgressCallback | null = null;
	private startTime = 0;
	private completedGames = 0;
	private inProgressGames = 0;
	private workerProgress: Map<number, { completed: number; total: number }> = new Map();

	constructor(config: BatchRunConfig) {
		this.config = resolveConfig(config);
	}

	/**
	 * Set progress callback
	 */
	onProgress(callback: ProgressCallback): void {
		this.progressCallback = callback;
	}

	/**
	 * Run the batch simulation
	 */
	async run(simulationConfig: SimulationConfig): Promise<BatchResult> {
		this.startTime = performance.now();
		this.completedGames = 0;
		this.inProgressGames = 0;
		this.workerProgress.clear();

		// Generate all seeds upfront for determinism
		const seeds = this.generateSeeds();

		// Initialize worker pool
		this.pool = new WorkerPool(this.config.workerCount);
		await this.pool.initialize(simulationConfig);

		// Set up progress tracking
		this.pool.onProgress((workerId, completed, total) => {
			this.workerProgress.set(workerId, { completed, total });
			this.emitProgress();
		});

		// Split seeds into batches
		const batches = this.createBatches(seeds);
		const results: GameResult[] = [];

		// Process batches with worker pool
		const batchPromises: Promise<void>[] = [];
		let batchIndex = 0;

		// Initial batch distribution
		const initialBatches = Math.min(batches.length, this.config.workerCount);
		for (let i = 0; i < initialBatches; i++) {
			batchPromises.push(this.processBatch(batches[batchIndex++], results));
		}

		// Process remaining batches as workers become available
		while (batchIndex < batches.length) {
			// Wait for any batch to complete
			await Promise.race(batchPromises.filter((p) => p));

			// Start next batch if workers available
			while (batchIndex < batches.length && this.pool.hasIdleWorker()) {
				batchPromises.push(this.processBatch(batches[batchIndex++], results));
			}
		}

		// Wait for all batches to complete
		await Promise.all(batchPromises);

		const durationMs = performance.now() - this.startTime;

		// Shutdown workers
		await this.pool.shutdown();

		return {
			results: this.config.outputFormat === 'memory' ? results : [],
			totalGames: this.completedGames,
			durationMs,
			gamesPerSecond: (this.completedGames / durationMs) * 1000,
			baseSeed: this.config.baseSeed,
			workerCount: this.config.workerCount,
			outputPath: this.config.outputPath,
		};
	}

	/**
	 * Generate deterministic seeds for all games
	 */
	private generateSeeds(): number[] {
		const rng = new SeededRandom(this.config.baseSeed);
		return Array.from({ length: this.config.gameCount }, () => rng.randomInt(0, 0xffffffff));
	}

	/**
	 * Split seeds into batches
	 */
	private createBatches(seeds: number[]): number[][] {
		const batches: number[][] = [];
		for (let i = 0; i < seeds.length; i += this.config.batchSize) {
			batches.push(seeds.slice(i, i + this.config.batchSize));
		}
		return batches;
	}

	/**
	 * Process a single batch on an available worker
	 */
	private async processBatch(seeds: number[], results: GameResult[]): Promise<void> {
		if (!this.pool) return;

		this.inProgressGames += seeds.length;
		this.emitProgress();

		try {
			const batchResults = await this.pool.runBatch(seeds);
			results.push(...batchResults);
			this.completedGames += batchResults.length;
			this.inProgressGames -= seeds.length;
			this.emitProgress();
		} catch (error) {
			this.inProgressGames -= seeds.length;
			console.error('[BatchCoordinator] Batch failed:', error);
			throw error;
		}
	}

	/**
	 * Emit progress update
	 */
	private emitProgress(): void {
		if (!this.progressCallback) return;

		const elapsedMs = performance.now() - this.startTime;
		const gamesPerSecond = this.completedGames > 0 ? (this.completedGames / elapsedMs) * 1000 : 0;
		const remainingGames = this.config.gameCount - this.completedGames;
		const estimatedRemainingMs =
			gamesPerSecond > 0 ? (remainingGames / gamesPerSecond) * 1000 : Infinity;

		const workers: WorkerStats[] = this.pool?.getStats() ?? [];

		this.progressCallback({
			totalGames: this.config.gameCount,
			completedGames: this.completedGames,
			inProgressGames: this.inProgressGames,
			elapsedMs,
			estimatedRemainingMs,
			gamesPerSecond,
			workers,
		});
	}

	/**
	 * Get current configuration
	 */
	getConfig(): ResolvedBatchRunConfig {
		return { ...this.config };
	}
}

/**
 * Run a batch of simulations with simple API
 *
 * @example
 * const results = await runBatch({
 *   gameCount: 1000,
 *   simulationConfig: {
 *     players: [{ id: 'p1', profileId: 'professor' }]
 *   },
 *   seed: 42,
 *   onProgress: (p) => console.log(`${p.completedGames}/${p.totalGames}`)
 * });
 */
export async function runBatch(options: {
	gameCount: number;
	simulationConfig: SimulationConfig;
	seed?: number;
	workerCount?: number;
	batchSize?: number;
	onProgress?: ProgressCallback;
}): Promise<BatchResult> {
	const coordinator = new BatchCoordinator({
		gameCount: options.gameCount,
		baseSeed: options.seed,
		workerCount: options.workerCount,
		batchSize: options.batchSize,
	});

	if (options.onProgress) {
		coordinator.onProgress(options.onProgress);
	}

	return coordinator.run(options.simulationConfig);
}
