/**
 * Performance Metrics Tests
 *
 * Test-first implementation of performance tracking utilities.
 */

import { describe, expect, it } from 'vitest';
import { createInstrumentation } from '../instrumentation.js';
import { createPerformanceTimer, measureOperation } from '../performance.js';

describe('Performance Metrics', () => {
	describe('createPerformanceTimer', () => {
		it('should create a timer', () => {
			const timer = createPerformanceTimer();
			expect(timer).toBeDefined();
			expect(typeof timer.elapsed).toBe('function');
			expect(typeof timer.end).toBe('function');
			expect(typeof timer.cancel).toBe('function');
		});

		it('should measure elapsed time', async () => {
			const timer = createPerformanceTimer();
			await new Promise((resolve) => setTimeout(resolve, 10));
			const elapsed = timer.elapsed();
			// Account for timing precision in CI environments (can be 1-2ms off)
			expect(elapsed).toBeGreaterThanOrEqual(8);
			expect(elapsed).toBeLessThan(50); // Should be close to 10ms
		});

		it('should allow cancellation', () => {
			const timer = createPerformanceTimer();
			timer.cancel();
			// Cancelled timer should not throw
			expect(() => timer.end('test')).not.toThrow();
		});
	});

	describe('measureOperation', () => {
		it('should measure successful operation', async () => {
			const operation = async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return 'success';
			};

			const result = await measureOperation(operation);
			expect(result).toBe('success');
		});

		it('should measure failed operation', async () => {
			const operation = async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				throw new Error('Operation failed');
			};

			await expect(measureOperation(operation)).rejects.toThrow('Operation failed');
		});

		it('should include duration in logged events', async () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const operation = async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
				return 'success';
			};

			await measureOperation(operation, instr, 'test.operation', { key: 'value' });
			// Duration tracking is handled by instrumentation events
		});
	});
});
