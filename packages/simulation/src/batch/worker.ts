/**
 * Batch Worker Entry Point
 *
 * Runs in a separate thread/process to execute game simulations.
 * Communicates with the main thread via postMessage.
 *
 * @example
 * // Spawned by WorkerPool
 * const worker = new Worker('./worker.ts');
 * worker.postMessage({ type: 'INIT', workerId: 0, config });
 */

import { GameSimulator } from '../core/game-simulator.js';
import type { GameResult, SimulationConfig } from '../schemas/index.js';
import type {
	BatchCompleteMessage,
	ErrorMessage,
	InitMessage,
	ProgressMessage,
	RunBatchMessage,
	WorkerMessage,
} from './types.js';

// Worker state
let workerId = -1;
let simulationConfig: SimulationConfig | null = null;
let isInitialized = false;

/**
 * Send message to main thread
 */
function sendMessage(message: WorkerMessage): void {
	postMessage(message);
}

/**
 * Handle initialization
 */
function handleInit(message: InitMessage): void {
	workerId = message.workerId;
	simulationConfig = message.config;
	isInitialized = true;
}

/**
 * Run a batch of games with provided seeds
 */
async function handleRunBatch(message: RunBatchMessage): Promise<void> {
	if (!isInitialized || !simulationConfig) {
		sendMessage({
			type: 'ERROR',
			workerId,
			error: 'Worker not initialized',
			batchId: message.batchId,
		} satisfies ErrorMessage);
		return;
	}

	const startTime = performance.now();
	const results: GameResult[] = [];
	const totalGames = message.gameSeeds.length;

	try {
		for (let i = 0; i < message.gameSeeds.length; i++) {
			const seed = message.gameSeeds[i];
			const simulator = new GameSimulator({ seed });
			const result = await simulator.runGame(simulationConfig);
			results.push(result);

			// Send progress every 10 games or at the end
			if ((i + 1) % 10 === 0 || i === totalGames - 1) {
				sendMessage({
					type: 'PROGRESS',
					workerId,
					gamesCompleted: i + 1,
					gamesTotal: totalGames,
				} satisfies ProgressMessage);
			}
		}

		const durationMs = performance.now() - startTime;

		sendMessage({
			type: 'BATCH_COMPLETE',
			workerId,
			batchId: message.batchId,
			results,
			durationMs,
		} satisfies BatchCompleteMessage);
	} catch (error) {
		sendMessage({
			type: 'ERROR',
			workerId,
			error: error instanceof Error ? error.message : String(error),
			batchId: message.batchId,
		} satisfies ErrorMessage);
	}
}

/**
 * Handle incoming messages
 */
function handleMessage(message: WorkerMessage): void {
	switch (message.type) {
		case 'INIT':
			handleInit(message);
			break;

		case 'RUN_BATCH':
			handleRunBatch(message);
			break;

		case 'SHUTDOWN':
			// Clean exit
			process.exit(0);
			break;

		default:
			sendMessage({
				type: 'ERROR',
				workerId,
				error: `Unknown message type: ${(message as WorkerMessage).type}`,
			} satisfies ErrorMessage);
	}
}

// Set up message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
	handleMessage(event.data);
};

// Signal ready
console.log(`[Worker] Ready`);
