/**
 * Batch Processing Module
 *
 * Provides scalable game simulation with progress tracking and resume support.
 *
 * Primary API:
 * - runBatchSingleThreaded: Simple, reliable single-thread runner
 * - benchmark: Measure throughput
 *
 * For large-scale simulations:
 * - Use NDJSON output for atomic checkpoints
 * - Enable resume for interrupted runs
 * - Batch sessions of 100-200 games for manageable runs
 *
 * @example
 * // Simple in-memory batch
 * const result = await runBatchSingleThreaded({
 *   gameCount: 100,
 *   simulationConfig: { players: [{ id: 'p1', profileId: 'test' }] },
 *   seed: 42,
 * });
 *
 * @example
 * // Streaming to disk with resume
 * const result = await runBatchSingleThreaded({
 *   gameCount: 10000,
 *   simulationConfig: { players: [{ id: 'p1', profileId: 'professor' }] },
 *   seed: 42,
 *   outputDir: './results',
 *   resume: true,
 *   onProgress: (p) => console.log(`${p.completedGames}/${p.totalGames}`),
 * });
 */

// Batch coordinator (experimental)
export { BatchCoordinator, runBatch } from './coordinator.js';
// NDJSON streaming I/O
export {
	getProcessedGameCount,
	getProcessedSeeds,
	NdjsonReader,
	NdjsonWriter,
	SimulationOutputWriter,
} from './ndjson-writer.js';
// Single-threaded runner (recommended for most use cases)
export {
	benchmark,
	runBatchSingleThreaded,
	type SingleThreadedBatchOptions,
} from './single-threaded.js';
// Types
export type {
	BatchCompleteMessage,
	BatchResult,
	BatchRunConfig,
	BatchRunProgress,
	ErrorMessage,
	InitMessage,
	ProgressCallback,
	ProgressMessage,
	ResolvedBatchRunConfig,
	RunBatchMessage,
	ShutdownMessage,
	WorkerMessage,
	WorkerStats,
} from './types.js';
// Worker pool (experimental - for multi-core scaling)
export { getRecommendedWorkerCount, WorkerPool } from './worker-pool.js';
