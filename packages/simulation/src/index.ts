/**
 * @dicee/simulation
 *
 * AI simulation framework for Dicee - headless game simulations,
 * statistical analysis, and performance calibration.
 *
 * @example
 * import { SeededRandom, GameSimulator, runSingleGame } from '@dicee/simulation';
 *
 * const result = await runSingleGame({
 *   players: [{ id: 'p1', profileId: 'professor' }],
 *   seed: 42,
 * });
 */

// Re-export batch processing
export * from './batch/index.js';

// Re-export core simulation engine
export * from './core/index.js';
// Re-export experiment framework
export * from './experiment/index.js';
// Re-export all schemas for convenience
export * from './schemas/index.js';
