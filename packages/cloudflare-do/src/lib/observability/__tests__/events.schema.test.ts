/**
 * Event Schema Tests
 *
 * Test-first implementation of observability event schemas.
 * Tests are written BEFORE implementation to ensure type safety and validation.
 */

import { describe, expect, it } from 'vitest';
import {
	ALL_EVENT_TYPES,
	isEventType,
	LIFECYCLE_EVENTS,
	type LifecycleEvent,
	type LifecycleWakeEvent,
	LifecycleWakeEventSchema,
	validateLogEntry,
} from '../events.schema.js';

describe('Event Schema Foundation', () => {
	describe('LIFECYCLE_EVENTS const array', () => {
		it('should exist and be a const array', () => {
			expect(LIFECYCLE_EVENTS).toBeDefined();
			expect(Array.isArray(LIFECYCLE_EVENTS)).toBe(true);
		});

		it('should contain expected lifecycle events', () => {
			expect(LIFECYCLE_EVENTS).toContain('lifecycle.wake');
			expect(LIFECYCLE_EVENTS).toContain('lifecycle.connect');
			expect(LIFECYCLE_EVENTS).toContain('lifecycle.disconnect');
			expect(LIFECYCLE_EVENTS).toContain('lifecycle.reconnect');
		});

		it('should have exactly 4 lifecycle events', () => {
			expect(LIFECYCLE_EVENTS.length).toBe(4);
		});
	});

	describe('LifecycleEvent type inference', () => {
		it('should infer correct type from const array', () => {
			const event: LifecycleEvent = 'lifecycle.wake';
			expect(event).toBe('lifecycle.wake');
		});

		it('should allow all lifecycle event types', () => {
			const events: LifecycleEvent[] = [
				'lifecycle.wake',
				'lifecycle.connect',
				'lifecycle.disconnect',
				'lifecycle.reconnect',
			];
			expect(events.length).toBe(4);
		});
	});

	describe('LifecycleWakeEventSchema validation', () => {
		it('should validate correct data', () => {
			const valid: LifecycleWakeEvent = {
				_ts: Date.now(),
				_level: 'info',
				_component: 'GameRoom',
				_event: 'lifecycle.wake',
				_reqId: 1,
				roomCode: 'TEST-ROOM',
				storageKeys: ['game', 'seats'],
				connectedClients: 2,
				hasGameState: true,
				hasSeats: true,
				hasRoomState: true,
				keyCount: 2,
			};

			const result = LifecycleWakeEventSchema.safeParse(valid);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('lifecycle.wake');
				expect(result.data.storageKeys).toEqual(['game', 'seats']);
			}
		});

		it('should reject invalid event type', () => {
			const invalid = {
				_ts: Date.now(),
				_level: 'info',
				_component: 'GameRoom',
				_event: 'invalid.event', // Wrong event type
				_reqId: 1,
				storageKeys: ['game'],
				connectedClients: 0,
				hasGameState: false,
				hasSeats: false,
				hasRoomState: false,
				keyCount: 0,
			};

			const result = LifecycleWakeEventSchema.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('should reject missing required fields', () => {
			const invalid = {
				_ts: Date.now(),
				_level: 'info',
				_component: 'GameRoom',
				_event: 'lifecycle.wake',
				// Missing storageKeys, connectedClients, etc.
			};

			const result = LifecycleWakeEventSchema.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('should reject invalid data types', () => {
			const invalid = {
				_ts: 'not-a-number', // Should be number
				_level: 'info',
				_component: 'GameRoom',
				_event: 'lifecycle.wake',
				_reqId: 1,
				storageKeys: ['game'],
				connectedClients: 0,
				hasGameState: false,
				hasSeats: false,
				hasRoomState: false,
				keyCount: 0,
			};

			const result = LifecycleWakeEventSchema.safeParse(invalid);
			expect(result.success).toBe(false);
		});

		it('should accept optional fields', () => {
			const valid: LifecycleWakeEvent = {
				_ts: Date.now(),
				_level: 'info',
				_component: 'GameRoom',
				_event: 'lifecycle.wake',
				// _reqId is optional
				// roomCode is optional
				storageKeys: [],
				connectedClients: 0,
				hasGameState: false,
				hasSeats: false,
				hasRoomState: false,
				keyCount: 0,
			};

			const result = LifecycleWakeEventSchema.safeParse(valid);
			expect(result.success).toBe(true);
		});
	});

	describe('ALL_EVENT_TYPES completeness', () => {
		it('should contain all lifecycle events', () => {
			for (const event of LIFECYCLE_EVENTS) {
				expect(ALL_EVENT_TYPES).toContain(event);
			}
		});

		it('should have unique event types', () => {
			const uniqueEvents = new Set(ALL_EVENT_TYPES);
			expect(uniqueEvents.size).toBe(ALL_EVENT_TYPES.length);
		});
	});

	describe('validateLogEntry function', () => {
		it('should validate a valid lifecycle.wake event', () => {
			const event: LifecycleWakeEvent = {
				_ts: Date.now(),
				_level: 'info',
				_component: 'GameRoom',
				_event: 'lifecycle.wake',
				_reqId: 1,
				roomCode: 'TEST-ROOM',
				storageKeys: ['game', 'seats'],
				connectedClients: 2,
				hasGameState: true,
				hasSeats: true,
				hasRoomState: true,
				keyCount: 2,
			};

			expect(() => validateLogEntry(event)).not.toThrow();
			const validated = validateLogEntry(event);
			expect(validated._event).toBe('lifecycle.wake');
		});

		it('should reject invalid log entry', () => {
			const invalid = {
				_ts: 'not-a-number',
				_level: 'invalid',
				_component: 'InvalidComponent',
				_event: 'invalid.event',
			};

			expect(() => validateLogEntry(invalid)).toThrow();
		});
	});

	describe('isEventType type guard', () => {
		it('should narrow type correctly', () => {
			const event: LifecycleWakeEvent = {
				_ts: Date.now(),
				_level: 'info',
				_component: 'GameRoom',
				_event: 'lifecycle.wake',
				storageKeys: [],
				connectedClients: 0,
				hasGameState: false,
				hasSeats: false,
				hasRoomState: false,
				keyCount: 0,
			};

			if (isEventType(event, 'lifecycle.wake')) {
				// Type should be narrowed to LifecycleWakeEvent
				expect(event.storageKeys).toBeDefined();
			}
		});
	});
});
