/**
 * Worker Pool Manager
 *
 * Manages a pool of worker threads for parallel game simulation.
 * Handles worker lifecycle, message routing, and error recovery.
 *
 * @example
 * const pool = new WorkerPool(12);
 * await pool.initialize(simulationConfig);
 * const results = await pool.runBatch([seed1, seed2, ...]);
 * pool.shutdown();
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { GameResult, SimulationConfig } from '../schemas/index.js';
import type {
	BatchCompleteMessage,
	ErrorMessage,
	ProgressMessage,
	WorkerMessage,
	WorkerStats,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Managed worker with state tracking
 */
interface ManagedWorker {
	id: number;
	worker: Worker;
	status: 'idle' | 'working' | 'error';
	gamesCompleted: number;
	batchesCompleted: number;
	totalBatchMs: number;
	currentBatchId: number | null;
}

/**
 * Pending batch waiting for completion
 */
interface PendingBatch {
	batchId: number;
	resolve: (results: GameResult[]) => void;
	reject: (error: Error) => void;
	results: GameResult[];
}

/**
 * Worker pool for parallel game simulation
 */
export class WorkerPool {
	private workers: ManagedWorker[] = [];
	private pendingBatches: Map<number, PendingBatch> = new Map();
	private nextBatchId = 0;
	private isInitialized = false;
	private progressCallback: ((workerId: number, completed: number, total: number) => void) | null =
		null;

	constructor(private workerCount: number) {
		if (workerCount < 1) {
			throw new Error('Worker count must be at least 1');
		}
	}

	/**
	 * Initialize the worker pool with simulation configuration
	 */
	async initialize(config: SimulationConfig): Promise<void> {
		if (this.isInitialized) {
			throw new Error('Worker pool already initialized');
		}

		// Spawn workers
		const workerPath = join(__dirname, 'worker.js');

		const initPromises = Array.from({ length: this.workerCount }, (_, i) => {
			return new Promise<void>((resolve, _reject) => {
				const worker = new Worker(workerPath);
				const managedWorker: ManagedWorker = {
					id: i,
					worker,
					status: 'idle',
					gamesCompleted: 0,
					batchesCompleted: 0,
					totalBatchMs: 0,
					currentBatchId: null,
				};

				// Set up message handler
				worker.on('message', (message: WorkerMessage) => {
					this.handleWorkerMessage(managedWorker, message);
				});

				worker.on('error', (error) => {
					managedWorker.status = 'error';
					console.error(`[WorkerPool] Worker ${i} error:`, error);

					// Reject any pending batch
					if (managedWorker.currentBatchId !== null) {
						const pending = this.pendingBatches.get(managedWorker.currentBatchId);
						if (pending) {
							pending.reject(error);
							this.pendingBatches.delete(managedWorker.currentBatchId);
						}
					}
				});

				worker.on('exit', (code) => {
					if (code !== 0) {
						console.error(`[WorkerPool] Worker ${i} exited with code ${code}`);
					}
				});

				// Send init message
				worker.postMessage({
					type: 'INIT',
					workerId: i,
					config,
				});

				this.workers.push(managedWorker);

				// Give worker time to initialize
				setTimeout(resolve, 50);
			});
		});

		await Promise.all(initPromises);
		this.isInitialized = true;
	}

	/**
	 * Handle messages from workers
	 */
	private handleWorkerMessage(managedWorker: ManagedWorker, message: WorkerMessage): void {
		switch (message.type) {
			case 'BATCH_COMPLETE': {
				const complete = message as BatchCompleteMessage;
				const pending = this.pendingBatches.get(complete.batchId);

				if (pending) {
					managedWorker.status = 'idle';
					managedWorker.gamesCompleted += complete.results.length;
					managedWorker.batchesCompleted++;
					managedWorker.totalBatchMs += complete.durationMs;
					managedWorker.currentBatchId = null;

					pending.resolve(complete.results);
					this.pendingBatches.delete(complete.batchId);
				}
				break;
			}

			case 'PROGRESS': {
				const progress = message as ProgressMessage;
				if (this.progressCallback) {
					this.progressCallback(progress.workerId, progress.gamesCompleted, progress.gamesTotal);
				}
				break;
			}

			case 'ERROR': {
				const error = message as ErrorMessage;
				managedWorker.status = 'error';
				console.error(`[WorkerPool] Worker ${error.workerId} error:`, error.error);

				if (error.batchId !== undefined) {
					const pending = this.pendingBatches.get(error.batchId);
					if (pending) {
						pending.reject(new Error(error.error));
						this.pendingBatches.delete(error.batchId);
					}
				}
				break;
			}
		}
	}

	/**
	 * Run a batch of games on an available worker
	 */
	async runBatch(seeds: number[]): Promise<GameResult[]> {
		if (!this.isInitialized) {
			throw new Error('Worker pool not initialized');
		}

		// Find an idle worker
		const worker = this.workers.find((w) => w.status === 'idle');
		if (!worker) {
			throw new Error('No idle workers available');
		}

		const batchId = this.nextBatchId++;
		worker.status = 'working';
		worker.currentBatchId = batchId;

		return new Promise((resolve, reject) => {
			this.pendingBatches.set(batchId, {
				batchId,
				resolve,
				reject,
				results: [],
			});

			worker.worker.postMessage({
				type: 'RUN_BATCH',
				batchId,
				gameSeeds: seeds,
			});
		});
	}

	/**
	 * Get an idle worker or wait for one
	 */
	async getIdleWorker(): Promise<ManagedWorker> {
		// Check for immediately available worker
		const idle = this.workers.find((w) => w.status === 'idle');
		if (idle) return idle;

		// Wait for a worker to become available
		return new Promise((resolve) => {
			const checkInterval = setInterval(() => {
				const idle = this.workers.find((w) => w.status === 'idle');
				if (idle) {
					clearInterval(checkInterval);
					resolve(idle);
				}
			}, 10);
		});
	}

	/**
	 * Check if any workers are idle
	 */
	hasIdleWorker(): boolean {
		return this.workers.some((w) => w.status === 'idle');
	}

	/**
	 * Get count of idle workers
	 */
	getIdleWorkerCount(): number {
		return this.workers.filter((w) => w.status === 'idle').length;
	}

	/**
	 * Set progress callback
	 */
	onProgress(callback: (workerId: number, completed: number, total: number) => void): void {
		this.progressCallback = callback;
	}

	/**
	 * Get worker statistics
	 */
	getStats(): WorkerStats[] {
		return this.workers.map((w) => ({
			workerId: w.id,
			gamesCompleted: w.gamesCompleted,
			batchesCompleted: w.batchesCompleted,
			averageBatchMs: w.batchesCompleted > 0 ? w.totalBatchMs / w.batchesCompleted : 0,
			status: w.status,
		}));
	}

	/**
	 * Get total games completed across all workers
	 */
	getTotalGamesCompleted(): number {
		return this.workers.reduce((sum, w) => sum + w.gamesCompleted, 0);
	}

	/**
	 * Shutdown all workers
	 */
	async shutdown(): Promise<void> {
		const shutdownPromises = this.workers.map(
			(w) =>
				new Promise<void>((resolve) => {
					w.worker.on('exit', () => resolve());
					w.worker.postMessage({ type: 'SHUTDOWN' });

					// Force terminate after timeout
					setTimeout(() => {
						w.worker.terminate();
						resolve();
					}, 1000);
				}),
		);

		await Promise.all(shutdownPromises);
		this.workers = [];
		this.isInitialized = false;
	}

	/**
	 * Get the number of workers
	 */
	get size(): number {
		return this.workerCount;
	}
}

/**
 * Get recommended worker count based on CPU cores
 */
export function getRecommendedWorkerCount(): number {
	// Use all but one core, minimum 1
	const cpuCount = navigator?.hardwareConcurrency ?? 4;
	return Math.max(1, cpuCount - 1);
}
