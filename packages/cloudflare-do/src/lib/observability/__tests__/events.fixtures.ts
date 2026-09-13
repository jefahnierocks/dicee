/**
 * Test Fixtures for Observability Events
 *
 * Provides type-safe, validated fixtures for all event types.
 * Use in tests to ensure consistency and catch schema changes.
 *
 * @example
 * ```typescript
 * import { createLifecycleWakeFixture } from './events.fixtures.js';
 *
 * const event = createLifecycleWakeFixture({ roomCode: 'CUSTOM' });
 * expect(event.roomCode).toBe('CUSTOM');
 * ```
 */

import type {
	BroadcastPrepareEvent,
	BroadcastSentEvent,
	ErrorHandlerFailedEvent,
	ErrorStorageFailedEvent,
	GameRollEvent,
	GameScoreEvent,
	GameStartEvent,
	LifecycleConnectEvent,
	LifecycleDisconnectEvent,
	LifecycleReconnectEvent,
	LifecycleWakeEvent,
	SeatAssignEvent,
	SeatReclaimAttemptEvent,
	SeatReclaimResultEvent,
	SeatReleaseEvent,
	SeatReserveEvent,
	StorageDeleteEvent,
	StorageListEvent,
	StorageReadEndEvent,
	StorageReadStartEvent,
	StorageWriteEndEvent,
	StorageWriteStartEvent,
} from '../events.schema.js';

// =============================================================================
// Lifecycle Event Fixtures
// =============================================================================

/**
 * Create a valid lifecycle.wake event fixture
 */
export function createLifecycleWakeFixture(
	overrides?: Partial<LifecycleWakeEvent>,
): LifecycleWakeEvent {
	return {
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
		...overrides,
	};
}

/**
 * Create a valid lifecycle.connect event fixture
 */
export function createLifecycleConnectFixture(
	overrides?: Partial<LifecycleConnectEvent>,
): LifecycleConnectEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'lifecycle.connect',
		_reqId: 2,
		userId: 'user-123',
		role: 'player',
		connectionId: 'conn-456',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid lifecycle.disconnect event fixture
 */
export function createLifecycleDisconnectFixture(
	overrides?: Partial<LifecycleDisconnectEvent>,
): LifecycleDisconnectEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'lifecycle.disconnect',
		_reqId: 3,
		userId: 'user-123',
		connectionId: 'conn-456',
		closeCode: 1000,
		closeReason: 'Normal closure',
		wasPlayer: true,
		codeCategory: 'normal',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid lifecycle.reconnect event fixture
 */
export function createLifecycleReconnectFixture(
	overrides?: Partial<LifecycleReconnectEvent>,
): LifecycleReconnectEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'lifecycle.reconnect',
		_reqId: 4,
		userId: 'user-123',
		previousConnectionId: 'conn-456',
		newConnectionId: 'conn-789',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

// =============================================================================
// Storage Event Fixtures
// =============================================================================

/**
 * Create a valid storage.read.start event fixture
 */
export function createStorageReadStartFixture(
	overrides?: Partial<StorageReadStartEvent>,
): StorageReadStartEvent {
	return {
		_ts: Date.now(),
		_level: 'debug',
		_component: 'GameRoom',
		_event: 'storage.read.start',
		_reqId: 5,
		key: 'game',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid storage.read.end event fixture
 */
export function createStorageReadEndFixture(
	overrides?: Partial<StorageReadEndEvent>,
): StorageReadEndEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'storage.read.end',
		_reqId: 6,
		key: 'game',
		found: true,
		valueType: 'object',
		durationMs: 10,
		sizeBytes: 1024,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid storage.write.start event fixture
 */
export function createStorageWriteStartFixture(
	overrides?: Partial<StorageWriteStartEvent>,
): StorageWriteStartEvent {
	return {
		_ts: Date.now(),
		_level: 'debug',
		_component: 'GameRoom',
		_event: 'storage.write.start',
		_reqId: 7,
		key: 'game',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid storage.write.end event fixture
 */
export function createStorageWriteEndFixture(
	overrides?: Partial<StorageWriteEndEvent>,
): StorageWriteEndEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'storage.write.end',
		_reqId: 8,
		key: 'game',
		success: true,
		durationMs: 15,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid storage.delete event fixture
 */
export function createStorageDeleteFixture(
	overrides?: Partial<StorageDeleteEvent>,
): StorageDeleteEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'storage.delete',
		_reqId: 9,
		key: 'temp',
		success: true,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid storage.list event fixture
 */
export function createStorageListFixture(overrides?: Partial<StorageListEvent>): StorageListEvent {
	return {
		_ts: Date.now(),
		_level: 'debug',
		_component: 'GameRoom',
		_event: 'storage.list',
		_reqId: 10,
		keyCount: 3,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

// =============================================================================
// Seat Event Fixtures
// =============================================================================

/**
 * Create a valid seat.assign event fixture
 */
export function createSeatAssignFixture(overrides?: Partial<SeatAssignEvent>): SeatAssignEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'seat.assign',
		_reqId: 11,
		userId: 'user-123',
		seatIndex: 0,
		displayName: 'Test Player',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid seat.reserve event fixture
 */
export function createSeatReserveFixture(overrides?: Partial<SeatReserveEvent>): SeatReserveEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'seat.reserve',
		_reqId: 12,
		userId: 'user-123',
		seatIndex: 0,
		expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid seat.reclaim.attempt event fixture
 */
export function createSeatReclaimAttemptFixture(
	overrides?: Partial<SeatReclaimAttemptEvent>,
): SeatReclaimAttemptEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'seat.reclaim.attempt',
		_reqId: 13,
		userId: 'user-123',
		hasReservedSeat: true,
		hasActiveGame: true,
		withinWindow: true,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid seat.reclaim.result event fixture
 */
export function createSeatReclaimResultFixture(
	overrides?: Partial<SeatReclaimResultEvent>,
): SeatReclaimResultEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'seat.reclaim.result',
		_reqId: 14,
		userId: 'user-123',
		result: 'reclaimed',
		reason: undefined,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid seat.release event fixture
 */
export function createSeatReleaseFixture(overrides?: Partial<SeatReleaseEvent>): SeatReleaseEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'seat.release',
		_reqId: 15,
		userId: 'user-123',
		seatIndex: 0,
		reason: 'timeout',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

// =============================================================================
// Game Event Fixtures
// =============================================================================

/**
 * Create a valid game.start event fixture
 */
export function createGameStartFixture(overrides?: Partial<GameStartEvent>): GameStartEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'game.start',
		_reqId: 16,
		playerCount: 2,
		hostId: 'user-123',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid game.roll event fixture
 */
export function createGameRollFixture(overrides?: Partial<GameRollEvent>): GameRollEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'game.roll',
		_reqId: 17,
		playerId: 'user-123',
		rollNumber: 1,
		dice: [1, 2, 3, 4, 5],
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid game.score event fixture
 */
export function createGameScoreFixture(overrides?: Partial<GameScoreEvent>): GameScoreEvent {
	return {
		_ts: Date.now(),
		_level: 'info',
		_component: 'GameRoom',
		_event: 'game.score',
		_reqId: 18,
		playerId: 'user-123',
		category: 'Ones',
		score: 5,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

// =============================================================================
// Broadcast Event Fixtures
// =============================================================================

/**
 * Create a valid broadcast.prepare event fixture
 */
export function createBroadcastPrepareFixture(
	overrides?: Partial<BroadcastPrepareEvent>,
): BroadcastPrepareEvent {
	return {
		_ts: Date.now(),
		_level: 'debug',
		_component: 'GameRoom',
		_event: 'broadcast.prepare',
		_reqId: 19,
		eventType: 'DICE_ROLLED',
		recipientCount: 2,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid broadcast.sent event fixture
 */
export function createBroadcastSentFixture(
	overrides?: Partial<BroadcastSentEvent>,
): BroadcastSentEvent {
	return {
		_ts: Date.now(),
		_level: 'debug',
		_component: 'GameRoom',
		_event: 'broadcast.sent',
		_reqId: 20,
		eventType: 'DICE_ROLLED',
		sentCount: 2,
		totalSockets: 2,
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

// =============================================================================
// Error Event Fixtures
// =============================================================================

/**
 * Create a valid error.handler.failed event fixture
 */
export function createErrorHandlerFailedFixture(
	overrides?: Partial<ErrorHandlerFailedEvent>,
): ErrorHandlerFailedEvent {
	return {
		_ts: Date.now(),
		_level: 'error',
		_component: 'GameRoom',
		_event: 'error.handler.failed',
		_reqId: 21,
		errorMessage: 'Handler failed',
		errorName: 'Error',
		handler: 'handleDiceRoll',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

/**
 * Create a valid error.storage.failed event fixture
 */
export function createErrorStorageFailedFixture(
	overrides?: Partial<ErrorStorageFailedEvent>,
): ErrorStorageFailedEvent {
	return {
		_ts: Date.now(),
		_level: 'error',
		_component: 'GameRoom',
		_event: 'error.storage.failed',
		_reqId: 22,
		operation: 'get',
		key: 'game',
		errorMessage: 'Storage operation failed',
		roomCode: 'TEST-ROOM',
		...overrides,
	};
}

// =============================================================================
// Helper: Create fixture for any event type
// =============================================================================

/**
 * Create a fixture for any event type (type-safe)
 * This is a convenience function that routes to the appropriate fixture creator
 */
export function createEventFixture<T extends string>(
	eventType: T,
	overrides?: Partial<Record<string, unknown>>,
): unknown {
	switch (eventType) {
		case 'lifecycle.wake':
			return createLifecycleWakeFixture(overrides as Partial<LifecycleWakeEvent>);
		case 'lifecycle.connect':
			return createLifecycleConnectFixture(overrides as Partial<LifecycleConnectEvent>);
		case 'lifecycle.disconnect':
			return createLifecycleDisconnectFixture(overrides as Partial<LifecycleDisconnectEvent>);
		case 'lifecycle.reconnect':
			return createLifecycleReconnectFixture(overrides as Partial<LifecycleReconnectEvent>);
		case 'storage.read.start':
			return createStorageReadStartFixture(overrides as Partial<StorageReadStartEvent>);
		case 'storage.read.end':
			return createStorageReadEndFixture(overrides as Partial<StorageReadEndEvent>);
		case 'storage.write.start':
			return createStorageWriteStartFixture(overrides as Partial<StorageWriteStartEvent>);
		case 'storage.write.end':
			return createStorageWriteEndFixture(overrides as Partial<StorageWriteEndEvent>);
		case 'seat.assign':
			return createSeatAssignFixture(overrides as Partial<SeatAssignEvent>);
		case 'seat.reserve':
			return createSeatReserveFixture(overrides as Partial<SeatReserveEvent>);
		case 'seat.reclaim.attempt':
			return createSeatReclaimAttemptFixture(overrides as Partial<SeatReclaimAttemptEvent>);
		case 'seat.reclaim.result':
			return createSeatReclaimResultFixture(overrides as Partial<SeatReclaimResultEvent>);
		case 'game.start':
			return createGameStartFixture(overrides as Partial<GameStartEvent>);
		case 'game.roll':
			return createGameRollFixture(overrides as Partial<GameRollEvent>);
		case 'game.score':
			return createGameScoreFixture(overrides as Partial<GameScoreEvent>);
		case 'broadcast.prepare':
			return createBroadcastPrepareFixture(overrides as Partial<BroadcastPrepareEvent>);
		case 'broadcast.sent':
			return createBroadcastSentFixture(overrides as Partial<BroadcastSentEvent>);
		case 'error.handler.failed':
			return createErrorHandlerFailedFixture(overrides as Partial<ErrorHandlerFailedEvent>);
		case 'error.storage.failed':
			return createErrorStorageFailedFixture(overrides as Partial<ErrorStorageFailedEvent>);
		default:
			throw new Error(`No fixture creator for event type: ${eventType}`);
	}
}
