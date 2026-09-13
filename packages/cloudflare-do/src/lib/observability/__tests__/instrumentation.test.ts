/**
 * Instrumentation Tests
 *
 * Test-first implementation of the instrumentation class.
 * Ensures all events are validated and emitted correctly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ErrorHandlerFailedEventSchema,
	GameStartEventSchema,
	LifecycleConnectEventSchema,
	LifecycleDisconnectEventSchema,
	LifecycleWakeEventSchema,
	type LogEvent,
	SeatAssignEventSchema,
	StorageReadEndEventSchema,
	StorageWriteEndEventSchema,
	safeValidateLogEntry,
} from '../events.schema.js';
import { createInstrumentation } from '../instrumentation.js';

describe('Instrumentation', () => {
	let consoleLogSpy: ReturnType<typeof vi.spyOn>;
	let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
	let _consoleWarnSpy: ReturnType<typeof vi.spyOn>;
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
		_consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('createInstrumentation', () => {
		it('should create instrumentation instance', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			expect(instr).toBeDefined();
			expect(typeof instr.hibernationWake).toBe('function');
			expect(typeof instr.clientConnect).toBe('function');
		});

		it('should create instrumentation without roomCode', () => {
			const instr = createInstrumentation('GlobalLobby');
			expect(instr).toBeDefined();
		});
	});

	describe('Lifecycle Events', () => {
		it('should emit valid lifecycle.wake event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.hibernationWake(['game', 'seats'], 2);

			const result = LifecycleWakeEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('lifecycle.wake');
				expect(result.data.storageKeys).toEqual(['game', 'seats']);
				expect(result.data.connectedClients).toBe(2);
			}

			// Should log to console
			expect(consoleInfoSpy).toHaveBeenCalled();
			const logged = JSON.parse(consoleInfoSpy.mock.calls[0][0] as string);
			expect(logged._event).toBe('lifecycle.wake');
		});

		it('should emit valid lifecycle.connect event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.clientConnect('user-123', 'player', 'conn-456');

			const result = LifecycleConnectEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('lifecycle.connect');
				expect(result.data.userId).toBe('user-123');
				expect(result.data.role).toBe('player');
				expect(result.data.connectionId).toBe('conn-456');
			}
		});

		it('should emit valid lifecycle.disconnect event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.clientDisconnect('user-123', 1000, 'Normal closure', true, 'conn-456');

			const result = LifecycleDisconnectEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('lifecycle.disconnect');
				expect(result.data.closeCode).toBe(1000);
				expect(result.data.wasPlayer).toBe(true);
			}
		});

		it('should emit valid lifecycle.reconnect event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.clientReconnect('user-123', 'conn-456', 'conn-789');

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('lifecycle.reconnect');
			}
		});
	});

	describe('Storage Events', () => {
		it('should emit valid storage.read.start event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.storageReadStart('game');

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('storage.read.start');
				expect(result.data.key).toBe('game');
			}

			// Debug events should use console.log
			expect(consoleLogSpy).toHaveBeenCalled();
		});

		it('should emit valid storage.read.end event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.storageReadEnd('game', true, 'object', 10, 1024);

			const result = StorageReadEndEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('storage.read.end');
				expect(result.data.found).toBe(true);
				expect(result.data.durationMs).toBe(10);
				expect(result.data.sizeBytes).toBe(1024);
			}
		});

		it('should emit valid storage.write.start event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.storageWriteStart('game', 'object', 2048);

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('storage.write.start');
			}
		});

		it('should emit valid storage.write.end event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.storageWriteEnd('game', true, 15);

			const result = StorageWriteEndEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('storage.write.end');
				expect(result.data.success).toBe(true);
				expect(result.data.durationMs).toBe(15);
			}
		});

		it('should emit valid storage.delete event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.storageDelete('temp', true);

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('storage.delete');
			}
		});
	});

	describe('Seat Events', () => {
		it('should emit valid seat.assign event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.seatAssign('user-123', 0, 'Test Player');

			const result = SeatAssignEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('seat.assign');
				expect(result.data.seatIndex).toBe(0);
			}
		});

		it('should emit valid seat.reserve event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const expiresAt = Date.now() + 5 * 60 * 1000;
			const event = instr.seatReserve('user-123', 0, expiresAt);

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('seat.reserve');
			}
		});

		it('should emit valid seat.reclaim.attempt event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.seatReclaimAttempt('user-123', true, true, true);

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('seat.reclaim.attempt');
			}
		});

		it('should emit valid seat.reclaim.result event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.seatReclaimResult('user-123', 'reclaimed');

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('seat.reclaim.result');
			}
		});

		it('should emit valid seat.release event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.seatRelease('user-123', 0, 'timeout');

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('seat.release');
			}
		});
	});

	describe('Game Events', () => {
		it('should emit valid game.start event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.gameStart(2, 'user-123');

			const result = GameStartEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('game.start');
				expect(result.data.playerCount).toBe(2);
			}
		});

		it('should emit valid game.roll event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.gameRoll('user-123', 1, [1, 2, 3, 4, 5]);

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('game.roll');
			}
		});

		it('should emit valid game.score event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.gameScore('user-123', 'Ones', 5);

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('game.score');
			}
		});
	});

	describe('Error Events', () => {
		it('should emit valid error.handler.failed event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const error = new Error('Handler failed');
			const event = instr.errorHandlerFailed('handleDiceRoll', error);

			const result = ErrorHandlerFailedEventSchema.safeParse(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('error.handler.failed');
				expect(result.data._level).toBe('error');
				expect(result.data.handler).toBe('handleDiceRoll');
			}

			// Error events should use console.error
			expect(consoleErrorSpy).toHaveBeenCalled();
		});

		it('should emit valid error.storage.failed event', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const error = new Error('Storage failed');
			const event = instr.errorStorageFailed('get', 'game', error);

			const result = safeValidateLogEntry(event);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data._event).toBe('error.storage.failed');
			}
		});
	});

	describe('Request ID Generation', () => {
		it('should generate unique request IDs', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event1 = instr.hibernationWake([], 0);
			const event2 = instr.clientConnect('user-123', 'player', 'conn-456');

			expect(event1._reqId).toBeDefined();
			expect(event2._reqId).toBeDefined();
			expect(event2._reqId).toBeGreaterThan(event1._reqId!);
		});
	});

	describe('Component Context', () => {
		it('should include component in all events', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.hibernationWake([], 0);

			expect(event._component).toBe('GameRoom');
		});

		it('should include roomCode when provided', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
			const event = instr.hibernationWake([], 0);

			expect(event.roomCode).toBe('TEST-ROOM');
		});

		it('should not include roomCode when not provided', () => {
			const instr = createInstrumentation('GlobalLobby');
			const event = instr.hibernationWake([], 0);

			expect(event.roomCode).toBeUndefined();
		});
	});

	describe('Event Validation', () => {
		it('should validate all emitted events', () => {
			const instr = createInstrumentation('GameRoom', 'TEST-ROOM');

			// Test that all methods return valid events
			const events: LogEvent[] = [
				instr.hibernationWake(['game'], 1),
				instr.clientConnect('user-123', 'player', 'conn-456'),
				instr.storageReadEnd('game', true),
				instr.storageWriteEnd('game', true),
				instr.seatAssign('user-123', 0, 'Test'),
				instr.gameStart(2, 'user-123'),
			];

			for (const event of events) {
				const result = safeValidateLogEntry(event);
				expect(result.success).toBe(true);
			}
		});
	});
});
