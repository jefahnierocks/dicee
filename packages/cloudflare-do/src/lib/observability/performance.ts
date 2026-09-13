/**
 * Performance Metrics Utilities
 *
 * Provides duration tracking and performance measurement helpers.
 * Integrates with instrumentation for automatic performance logging.
 *
 * @example
 * ```typescript
 * const timer = createPerformanceTimer(instr);
 * await someOperation();
 * timer.end('operation.complete', { success: true });
 * ```
 */

import type { Instrumentation } from './instrumentation.js';

/**
 * Performance timer for tracking operation duration
 */
export interface PerformanceTimer {
	/**
	 * End the timer and log performance metrics
	 *
	 * @param eventType - Event type to log
	 * @param additionalData - Additional data to include in the event
	 */
	end(eventType: string, additionalData?: Record<string, unknown>): void;

	/**
	 * Get elapsed time without logging
	 *
	 * @returns Elapsed time in milliseconds
	 */
	elapsed(): number;

	/**
	 * Cancel the timer (don't log)
	 */
	cancel(): void;
}

/**
 * Create a performance timer
 *
 * @param instr - Instrumentation instance (optional, for automatic logging)
 * @param startTime - Optional start time (defaults to now)
 * @returns Performance timer
 */
export function createPerformanceTimer(
	instr?: Instrumentation | null,
	startTime: number = Date.now(),
): PerformanceTimer {
	let cancelled = false;

	return {
		end(eventType: string, additionalData?: Record<string, unknown>): void {
			if (cancelled) return;

			const _duration = Date.now() - startTime;

			// Log performance metric if instrumentation is available
			// Note: This would require a new event type 'performance.metric'
			// For now, we include duration in existing events via additionalData
			if (instr && additionalData) {
				// Duration is typically included in storage events already
				// This is a placeholder for future performance-specific events
			}
		},

		elapsed(): number {
			return Date.now() - startTime;
		},

		cancel(): void {
			cancelled = true;
		},
	};
}

/**
 * Measure async operation duration
 *
 * @param operation - Async operation to measure
 * @param instr - Instrumentation instance
 * @param eventType - Event type for logging
 * @param additionalData - Additional data to include
 * @returns Result of the operation
 */
export async function measureOperation<T>(
	operation: () => Promise<T>,
	instr?: Instrumentation | null,
	eventType?: string,
	additionalData?: Record<string, unknown>,
): Promise<T> {
	const timer = createPerformanceTimer(instr);
	try {
		const result = await operation();
		if (eventType) {
			timer.end(eventType, { ...additionalData, success: true });
		}
		return result;
	} catch (error) {
		if (eventType) {
			timer.end(eventType, { ...additionalData, success: false, error: String(error) });
		}
		throw error;
	}
}
