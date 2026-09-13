/**
 * Single-Threaded Batch Runner
 *
 * Runs batch simulations in the main thread without workers.
 * Supports atomic output (NDJSON), resume capability, and progress tracking.
 *
 * Patterns from audio-workflow:
 * - Atomic sidecar pattern: each result file serves as checkpoint
 * - Batch sessions of 100-200 for manageable runs
 * - NDJSON streaming for large result sets
 *
 * @example
 * const results = await runBatchSingleThreaded({
 *   gameCount: 100,
 *   simulationConfig: { players: [{ id: 'p1', profileId: 'test' }] },
 *   seed: 42,
 *   outputDir: './results',
 * });
 */

import {
	createSimulationBrain,
	getSimulationProfile,
	initializeBrains,
} from '../core/cloudflare-brain-integration.js';
import { GameSimulator } from '../core/game-simulator.js';
import { SeededRandom } from '../core/seeded-random.js';
import type { GameResult, SimulationConfig } from '../schemas/index.js';
import { getProcessedGameCount, SimulationOutputWriter } from './ndjson-writer.js';
import type { BatchResult, BatchRunProgress, ProgressCallback } from './types.js';

/**
 * Options for single-threaded batch runner
 */
export interface SingleThreadedBatchOptions {
	/** Number of games to run */
	gameCount: number;
	/** Configuration for each game */
	simulationConfig: SimulationConfig;
	/** Base seed for deterministic runs */
	seed?: number;
	/** Progress callback */
	onProgress?: ProgressCallback;
	/** How often to call progress callback (in games) */
	progressEvery?: number;
	/** Output directory for NDJSON files (optional - if set, streams to disk) */
	outputDir?: string;
	/** Whether to resume from existing output (requires outputDir) */
	resume?: boolean;
}

/**
 * Run batch simulations in a single thread
 */
export async function runBatchSingleThreaded(
	options: SingleThreadedBatchOptions,
): Promise<BatchResult> {
	const {
		gameCount,
		simulationConfig,
		seed = Math.floor(Math.random() * 0xffffffff),
		onProgress,
		progressEvery = 10,
		outputDir,
		resume = false,
	} = options;

	const startTime = performance.now();
	const results: GameResult[] = [];
	const rng = new SeededRandom(seed);

	// Initialize the brain factory with real AI brains
	await initializeBrains();

	// Generate all seeds upfront for determinism
	const allSeeds = Array.from({ length: gameCount }, () => rng.randomInt(0, 0xffffffff));

	// Check for resume - count by number of games already processed
	let skipCount = 0;
	if (outputDir && resume) {
		skipCount = getProcessedGameCount(outputDir);
		if (skipCount > 0) {
			console.log(`[BatchRunner] Resuming: ${skipCount} games already processed`);
		}
	}

	// Set up NDJSON writer if outputDir specified
	let writer: SimulationOutputWriter | null = null;
	if (outputDir) {
		writer = new SimulationOutputWriter(outputDir, {
			writeTurns: simulationConfig.captureDecisions,
			writeDecisions: simulationConfig.captureDecisions,
		});
		await writer.open();
	}

	let completedGames = skipCount;

	try {
		for (let i = 0; i < gameCount; i++) {
			// Skip already-processed games (resume mode)
			if (i < skipCount) {
				continue;
			}

			const gameSeed = allSeeds[i];
			const simulator = new GameSimulator({
				seed: gameSeed,
				createBrain: createSimulationBrain,
				getProfile: getSimulationProfile,
			});
			const result = await simulator.runGame(simulationConfig);

			// Write to NDJSON or collect in memory
			if (writer) {
				await writer.writeGame(result);
			} else {
				results.push(result);
			}

			completedGames++;

			// Emit progress
			if (onProgress && (completedGames % progressEvery === 0 || completedGames === gameCount)) {
				const elapsedMs = performance.now() - startTime;
				const gamesPerSecond = ((completedGames - skipCount) / elapsedMs) * 1000;
				const remaining = gameCount - completedGames;
				const estimatedRemainingMs = gamesPerSecond > 0 ? (remaining / gamesPerSecond) * 1000 : 0;

				const progress: BatchRunProgress = {
					totalGames: gameCount,
					completedGames,
					inProgressGames: 1,
					elapsedMs,
					estimatedRemainingMs,
					gamesPerSecond,
					workers: [
						{
							workerId: 0,
							gamesCompleted: completedGames,
							batchesCompleted: Math.floor(completedGames / progressEvery),
							averageBatchMs: elapsedMs / Math.max(1, Math.floor(completedGames / progressEvery)),
							status: 'working',
						},
					],
				};

				onProgress(progress);
			}
		}
	} finally {
		// Always close writer
		if (writer) {
			await writer.close();
		}
	}

	const durationMs = performance.now() - startTime;
	const actualGamesRun = completedGames - skipCount;

	return {
		results,
		totalGames: completedGames,
		durationMs,
		gamesPerSecond: actualGamesRun > 0 ? (actualGamesRun / durationMs) * 1000 : 0,
		baseSeed: seed,
		workerCount: 1,
		outputPath: outputDir ?? null,
	};
}

/**
 * Run a benchmark to measure throughput
 */
export async function benchmark(options: {
	durationMs?: number;
	simulationConfig?: SimulationConfig;
	seed?: number;
	onProgress?: (gamesPerSecond: number, totalGames: number) => void;
}): Promise<{
	gamesCompleted: number;
	durationMs: number;
	gamesPerSecond: number;
	averageGameMs: number;
}> {
	const {
		durationMs = 5000,
		simulationConfig = {
			players: [{ id: 'p1', profileId: 'custom' as const }],
			captureDecisions: false,
			captureIntermediateStates: false,
		},
		seed = 42,
		onProgress,
	} = options;

	const startTime = performance.now();
	const rng = new SeededRandom(seed);
	let gamesCompleted = 0;
	let lastProgressTime = startTime;

	// Initialize brains for benchmark
	await initializeBrains();

	while (performance.now() - startTime < durationMs) {
		const gameSeed = rng.randomInt(0, 0xffffffff);
		const simulator = new GameSimulator({
			seed: gameSeed,
			createBrain: createSimulationBrain,
			getProfile: getSimulationProfile,
		});
		await simulator.runGame(simulationConfig);
		gamesCompleted++;

		// Progress callback every 100ms
		const now = performance.now();
		if (onProgress && now - lastProgressTime > 100) {
			const elapsed = now - startTime;
			onProgress((gamesCompleted / elapsed) * 1000, gamesCompleted);
			lastProgressTime = now;
		}
	}

	const actualDurationMs = performance.now() - startTime;

	return {
		gamesCompleted,
		durationMs: actualDurationMs,
		gamesPerSecond: (gamesCompleted / actualDurationMs) * 1000,
		averageGameMs: actualDurationMs / gamesCompleted,
	};
}
