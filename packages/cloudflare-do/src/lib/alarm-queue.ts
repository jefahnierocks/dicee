/**
 * AlarmQueue - Multiple Concurrent Alarm Management for Durable Objects
 *
 * Cloudflare Durable Objects only support a single native alarm at a time.
 * This class provides a queue-based system to manage multiple logical alarms
 * by storing them in DO storage and using the native alarm for the earliest one.
 *
 * Phase 1 Implementation:
 * - Solves the cascading disconnection issue where PAUSE_TIMEOUT overwrote SEAT_EXPIRATION
 * - Supports scheduling, cancellation, and processing of multiple alarm types
 * - Maintains alarm ordering by scheduledFor timestamp
 *
 * @module lib/alarm-queue
 */

import type { AlarmType, ScheduledAlarm } from '../types';
import { Loggers } from './logger';

const STORAGE_KEY = 'alarm_queue';

/**
 * AlarmQueue manages multiple concurrent alarms in a Durable Object.
 *
 * Usage:
 * ```typescript
 * // In GameRoom constructor or initialization
 * this.alarmQueue = new AlarmQueue(this.ctx);
 *
 * // Schedule an alarm
 * await this.alarmQueue.schedule({
 *   type: 'SEAT_EXPIRATION',
 *   targetId: odal,
 *   scheduledFor: Date.now() + RECONNECT_WINDOW_MS
 * });
 *
 * // In alarm() handler
 * const dueAlarms = await this.alarmQueue.processAlarms();
 * for (const alarm of dueAlarms) {
 *   switch (alarm.type) {
 *     case 'SEAT_EXPIRATION': await this.handleSeatExpiration(alarm.targetId!); break;
 *     // ... other handlers
 *   }
 * }
 * ```
 */
export class AlarmQueue {
	private logger = Loggers.AlarmQueue();

	constructor(private ctx: DurableObjectState) {}

	/**
	 * Schedule a new alarm.
	 *
	 * If an alarm with the same type+targetId already exists, it will be replaced.
	 * This prevents duplicate alarms for the same event.
	 *
	 * @param alarm - Alarm to schedule (without createdAt, which is set automatically)
	 */
	async schedule(alarm: Omit<ScheduledAlarm, 'createdAt'>): Promise<void> {
		const queue = await this.getQueue();

		// Remove any existing alarm of same type+target to prevent duplicates
		const filtered = queue.filter((a) => !(a.type === alarm.type && a.targetId === alarm.targetId));

		// Add new alarm with creation timestamp
		const newAlarm: ScheduledAlarm = {
			...alarm,
			createdAt: Date.now(),
		};
		filtered.push(newAlarm);

		// Sort by scheduledFor (earliest first)
		filtered.sort((a, b) => a.scheduledFor - b.scheduledFor);

		// Persist to storage
		await this.ctx.storage.put(STORAGE_KEY, filtered);

		// Set DO native alarm to earliest item
		if (filtered.length > 0) {
			await this.ctx.storage.setAlarm(filtered[0].scheduledFor);
		}

		this.logger.debug('Alarm scheduled', {
			type: alarm.type,
			targetId: alarm.targetId,
			scheduledFor: new Date(alarm.scheduledFor).toISOString(),
			queueSize: filtered.length,
		});
	}

	/**
	 * Cancel an alarm by type and optional targetId.
	 *
	 * @param type - Type of alarm to cancel
	 * @param targetId - Optional target ID (if null, cancels room-level alarm of that type)
	 */
	async cancel(type: AlarmType, targetId: string | null = null): Promise<boolean> {
		const queue = await this.getQueue();
		const initialLength = queue.length;

		// Filter out matching alarm(s)
		const filtered = queue.filter((a) => !(a.type === type && a.targetId === targetId));

		if (filtered.length === initialLength) {
			// No alarm was cancelled
			return false;
		}

		// Persist updated queue
		await this.ctx.storage.put(STORAGE_KEY, filtered);

		// Reschedule native alarm to next item (or delete if empty)
		await this.rescheduleNextAlarm(filtered);

		this.logger.debug('Alarm cancelled', {
			type,
			targetId,
			remainingQueueSize: filtered.length,
		});

		return true;
	}

	/**
	 * Cancel all alarms of a specific type.
	 *
	 * @param type - Type of alarms to cancel
	 * @returns Number of alarms cancelled
	 */
	async cancelAllOfType(type: AlarmType): Promise<number> {
		const queue = await this.getQueue();
		const initialLength = queue.length;

		const filtered = queue.filter((a) => a.type !== type);
		const cancelledCount = initialLength - filtered.length;

		if (cancelledCount > 0) {
			await this.ctx.storage.put(STORAGE_KEY, filtered);
			await this.rescheduleNextAlarm(filtered);

			this.logger.debug('All alarms of type cancelled', {
				type,
				cancelledCount,
				remainingQueueSize: filtered.length,
			});
		}

		return cancelledCount;
	}

	/**
	 * Process all due alarms and return them.
	 *
	 * This should be called from the DO's alarm() handler.
	 * Returns alarms where scheduledFor <= now, removes them from queue,
	 * and reschedules the native alarm for the next item.
	 *
	 * @returns Array of due alarms to process
	 */
	async processAlarms(): Promise<ScheduledAlarm[]> {
		const queue = await this.getQueue();
		const now = Date.now();

		// Split into due and remaining
		const due = queue.filter((a) => a.scheduledFor <= now);
		const remaining = queue.filter((a) => a.scheduledFor > now);

		// Persist remaining queue
		await this.ctx.storage.put(STORAGE_KEY, remaining);

		// Reschedule native alarm for next item
		await this.rescheduleNextAlarm(remaining);

		if (due.length > 0) {
			this.logger.debug('Processing due alarms', {
				dueCount: due.length,
				types: due.map((a) => a.type),
				remainingQueueSize: remaining.length,
			});
		}

		return due;
	}

	/**
	 * Get all currently scheduled alarms (for debugging/inspection).
	 */
	async getAll(): Promise<ScheduledAlarm[]> {
		return this.getQueue();
	}

	/**
	 * Check if an alarm exists for a specific type+targetId.
	 */
	async exists(type: AlarmType, targetId: string | null = null): Promise<boolean> {
		const queue = await this.getQueue();
		return queue.some((a) => a.type === type && a.targetId === targetId);
	}

	/**
	 * Get the scheduled time for a specific alarm (if it exists).
	 */
	async getScheduledTime(type: AlarmType, targetId: string | null = null): Promise<number | null> {
		const queue = await this.getQueue();
		const alarm = queue.find((a) => a.type === type && a.targetId === targetId);
		return alarm?.scheduledFor ?? null;
	}

	/**
	 * Clear all alarms (useful for room cleanup).
	 */
	async clearAll(): Promise<void> {
		await this.ctx.storage.put(STORAGE_KEY, []);
		await this.ctx.storage.deleteAlarm();

		this.logger.debug('All alarms cleared');
	}

	// =========================================================================
	// Private Helpers
	// =========================================================================

	private async getQueue(): Promise<ScheduledAlarm[]> {
		const queue = await this.ctx.storage.get<ScheduledAlarm[]>(STORAGE_KEY);
		return queue ?? [];
	}

	private async rescheduleNextAlarm(queue: ScheduledAlarm[]): Promise<void> {
		if (queue.length > 0) {
			// Set native alarm to earliest item
			await this.ctx.storage.setAlarm(queue[0].scheduledFor);
		} else {
			// No alarms remaining - delete native alarm
			await this.ctx.storage.deleteAlarm();
		}
	}
}

/**
 * Factory function to create an AlarmQueue instance.
 */
export function createAlarmQueue(ctx: DurableObjectState): AlarmQueue {
	return new AlarmQueue(ctx);
}
