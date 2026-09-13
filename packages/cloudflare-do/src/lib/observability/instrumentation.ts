/**
 * Observability Instrumentation
 *
 * Type-safe instrumentation for Durable Objects.
 * All events are validated against Zod schemas before emission.
 *
 * @example
 * ```typescript
 * const instr = createInstrumentation('GameRoom', 'TEST-ROOM');
 * instr.hibernationWake(['game', 'seats'], 2);
 * instr.clientConnect('user-123', 'player', 'conn-456');
 * ```
 *
 * Pattern:
 * - All events validated with Zod before emission
 * - Returns validated event (for testing)
 * - Uses appropriate console method (debug -> log, info -> info, etc.)
 * - Request ID auto-incremented per instance
 * - Correlation ID can be set per request
 */

import { sanitizeLogValue } from '../logger.js';
import {
	BroadcastPrepareEventSchema,
	BroadcastSentEventSchema,
	type Component,
	ConnectionAuthFailureEventSchema,
	ConnectionAuthSuccessEventSchema,
	ConnectionRateLimitEventSchema,
	ConnectionTokenExpiredEventSchema,
	DiagnosticHealthCheckEventSchema,
	DiagnosticSnapshotEventSchema,
	ErrorBroadcastFailedEventSchema,
	ErrorHandlerFailedEventSchema,
	ErrorStateCorruptionEventSchema,
	ErrorStorageFailedEventSchema,
	type EventType,
	GameCompleteEventSchema,
	GameRollEventSchema,
	GameScoreEventSchema,
	GameStartEventSchema,
	GameTurnEndEventSchema,
	GameTurnStartEventSchema,
	LifecycleConnectEventSchema,
	LifecycleDisconnectEventSchema,
	LifecycleReconnectEventSchema,
	LifecycleWakeEventSchema,
	type LogEvent,
	type LogLevel,
	SeatAssignEventSchema,
	SeatReclaimAttemptEventSchema,
	SeatReclaimResultEventSchema,
	SeatReleaseEventSchema,
	SeatReserveEventSchema,
	StateTransitionEventSchema,
	StateTransitionRejectedEventSchema,
	StorageDeleteEventSchema,
	StorageListEventSchema,
	StorageReadEndEventSchema,
	StorageReadStartEventSchema,
	StorageWriteEndEventSchema,
	StorageWriteStartEventSchema,
} from './events.schema.js';

/**
 * Helper to categorize WebSocket close codes
 */
function categorizeCloseCode(code: number): string {
	switch (code) {
		case 1000:
			return 'normal';
		case 1001:
			return 'going_away';
		case 1006:
			return 'abnormal_no_close_frame';
		case 1008:
			return 'policy_violation';
		case 1011:
			return 'server_error';
		case 1012:
			return 'service_restart';
		case 1013:
			return 'try_again_later';
		case 1014:
			return 'bad_gateway';
		default:
			return `unknown_${code}`;
	}
}

/**
 * Create instrumentation instance for a component
 *
 * @param component - Component name ('GameRoom' or 'GlobalLobby')
 * @param roomCode - Optional room code for context
 * @returns Instrumentation instance
 */
export function createInstrumentation(component: Component, roomCode?: string) {
	const baseContext: {
		_component: Component;
		roomCode?: string;
		_correlationId?: string;
	} = {
		_component: component,
		roomCode,
	};

	let requestId = 0;

	/**
	 * Emit a log entry with validation
	 */
	function emit<T extends LogEvent>(
		level: LogLevel,
		eventType: EventType,
		data: Record<string, unknown>,
		schema: { parse: (data: unknown) => T },
	): T {
		const entry = {
			_ts: Date.now(),
			_level: level,
			_event: eventType,
			_reqId: ++requestId,
			...baseContext,
			...data,
		};

		// Validate against schema
		const validated = schema.parse(entry);

		// Output to console (structured JSON for Cloudflare Logs)
		const json = JSON.stringify(sanitizeLogValue(validated));
		switch (level) {
			case 'debug':
				console.log(json);
				break;
			case 'info':
				console.info(json);
				break;
			case 'warn':
				console.warn(json);
				break;
			case 'error':
				console.error(json);
				break;
		}

		return validated;
	}

	return {
		// === LIFECYCLE EVENTS ===

		hibernationWake(storageKeys: string[], connectedClients: number): LogEvent {
			return emit(
				'info',
				'lifecycle.wake',
				{
					storageKeys,
					connectedClients,
					hasGameState: storageKeys.includes('game'),
					hasSeats: storageKeys.includes('seats'),
					hasRoomState: storageKeys.includes('room'),
					keyCount: storageKeys.length,
				},
				LifecycleWakeEventSchema,
			);
		},

		clientConnect(
			userId: string,
			role: 'player' | 'spectator' | 'pending',
			connectionId: string,
		): LogEvent {
			return emit(
				'info',
				'lifecycle.connect',
				{
					userId,
					role,
					connectionId,
				},
				LifecycleConnectEventSchema,
			);
		},

		clientDisconnect(
			userId: string,
			code: number,
			reason: string,
			wasPlayer: boolean,
			connectionId: string,
		): LogEvent {
			return emit(
				'info',
				'lifecycle.disconnect',
				{
					userId,
					connectionId,
					closeCode: code,
					closeReason: reason,
					wasPlayer,
					codeCategory: categorizeCloseCode(code),
				},
				LifecycleDisconnectEventSchema,
			);
		},

		clientReconnect(
			userId: string,
			previousConnectionId: string,
			newConnectionId: string,
		): LogEvent {
			return emit(
				'info',
				'lifecycle.reconnect',
				{
					userId,
					previousConnectionId,
					newConnectionId,
				},
				LifecycleReconnectEventSchema,
			);
		},

		// === STORAGE EVENTS ===

		storageReadStart(key: string): LogEvent {
			return emit('debug', 'storage.read.start', { key }, StorageReadStartEventSchema);
		},

		storageReadEnd(
			key: string,
			found: boolean,
			valueType?: string,
			duration?: number,
			sizeBytes?: number,
		): LogEvent {
			return emit(
				'info',
				'storage.read.end',
				{
					key,
					found,
					valueType,
					durationMs: duration,
					sizeBytes,
				},
				StorageReadEndEventSchema,
			);
		},

		storageWriteStart(key: string, valueType?: string, sizeBytes?: number): LogEvent {
			return emit(
				'debug',
				'storage.write.start',
				{
					key,
					valueType,
					sizeBytes,
				},
				StorageWriteStartEventSchema,
			);
		},

		storageWriteEnd(key: string, success: boolean, duration?: number): LogEvent {
			return emit(
				'info',
				'storage.write.end',
				{
					key,
					success,
					durationMs: duration,
				},
				StorageWriteEndEventSchema,
			);
		},

		storageDelete(key: string, success: boolean): LogEvent {
			return emit('info', 'storage.delete', { key, success }, StorageDeleteEventSchema);
		},

		storageList(keyCount: number): LogEvent {
			return emit('debug', 'storage.list', { keyCount }, StorageListEventSchema);
		},

		// === STATE MACHINE EVENTS ===

		stateTransition(from: string, to: string, trigger: string): LogEvent {
			return emit(
				'info',
				'state.transition',
				{
					fromState: from,
					toState: to,
					trigger,
				},
				StateTransitionEventSchema,
			);
		},

		stateTransitionRejected(current: string, attempted: string, reason: string): LogEvent {
			return emit(
				'warn',
				'state.transition.rejected',
				{
					fromState: current,
					attemptedState: attempted,
					reason,
				},
				StateTransitionRejectedEventSchema,
			);
		},

		// === SEAT MANAGEMENT EVENTS ===

		seatAssign(userId: string, seatIndex: number, displayName: string): LogEvent {
			return emit(
				'info',
				'seat.assign',
				{
					userId,
					seatIndex,
					displayName,
				},
				SeatAssignEventSchema,
			);
		},

		seatReserve(userId: string, seatIndex: number, expiresAt: number): LogEvent {
			return emit(
				'info',
				'seat.reserve',
				{
					userId,
					seatIndex,
					expiresAt,
				},
				SeatReserveEventSchema,
			);
		},

		seatReclaimAttempt(
			userId: string,
			hasReservedSeat: boolean,
			hasActiveGame: boolean,
			withinWindow: boolean,
		): LogEvent {
			return emit(
				'info',
				'seat.reclaim.attempt',
				{
					userId,
					hasReservedSeat,
					hasActiveGame,
					withinWindow,
				},
				SeatReclaimAttemptEventSchema,
			);
		},

		seatReclaimResult(
			userId: string,
			result: 'reclaimed' | 'spectator',
			reason?: string,
		): LogEvent {
			return emit(
				'info',
				'seat.reclaim.result',
				{
					userId,
					result,
					reason,
				},
				SeatReclaimResultEventSchema,
			);
		},

		seatRelease(userId: string, seatIndex: number, reason: string): LogEvent {
			return emit(
				'info',
				'seat.release',
				{
					userId,
					seatIndex,
					reason,
				},
				SeatReleaseEventSchema,
			);
		},

		// === GAME EVENTS ===

		gameStart(playerCount: number, hostId: string): LogEvent {
			return emit(
				'info',
				'game.start',
				{
					playerCount,
					hostId,
				},
				GameStartEventSchema,
			);
		},

		gameTurnStart(playerId: string, turnNumber: number): LogEvent {
			return emit(
				'info',
				'game.turn.start',
				{
					playerId,
					turnNumber,
				},
				GameTurnStartEventSchema,
			);
		},

		gameTurnEnd(playerId: string, turnNumber: number): LogEvent {
			return emit(
				'info',
				'game.turn.end',
				{
					playerId,
					turnNumber,
				},
				GameTurnEndEventSchema,
			);
		},

		gameRoll(playerId: string, rollNumber: number, dice: number[]): LogEvent {
			return emit(
				'info',
				'game.roll',
				{
					playerId,
					rollNumber,
					dice,
				},
				GameRollEventSchema,
			);
		},

		gameScore(playerId: string, category: string, score: number): LogEvent {
			return emit(
				'info',
				'game.score',
				{
					playerId,
					category,
					score,
				},
				GameScoreEventSchema,
			);
		},

		gameComplete(winnerId: string | undefined, finalScores: Record<string, number>): LogEvent {
			return emit(
				'info',
				'game.complete',
				{
					winnerId,
					finalScores,
				},
				GameCompleteEventSchema,
			);
		},

		// === CONNECTION EVENTS ===

		connectionAuthSuccess(userId: string, method: string): LogEvent {
			return emit(
				'info',
				'connection.auth.success',
				{
					userId,
					method,
				},
				ConnectionAuthSuccessEventSchema,
			);
		},

		connectionAuthFailure(reason: string): LogEvent {
			return emit(
				'warn',
				'connection.auth.failure',
				{
					reason,
				},
				ConnectionAuthFailureEventSchema,
			);
		},

		connectionTokenExpired(userId?: string): LogEvent {
			return emit(
				'warn',
				'connection.token.expired',
				{
					userId,
				},
				ConnectionTokenExpiredEventSchema,
			);
		},

		connectionRateLimit(userId: string, limitType: string): LogEvent {
			return emit(
				'warn',
				'connection.rate_limit',
				{
					userId,
					limitType,
				},
				ConnectionRateLimitEventSchema,
			);
		},

		// === BROADCAST EVENTS ===

		broadcastPrepare(eventType: string, recipientCount: number): LogEvent {
			return emit(
				'debug',
				'broadcast.prepare',
				{
					eventType,
					recipientCount,
				},
				BroadcastPrepareEventSchema,
			);
		},

		broadcastSent(eventType: string, sentCount: number, totalSockets: number): LogEvent {
			return emit(
				'debug',
				'broadcast.sent',
				{
					eventType,
					sentCount,
					totalSockets,
				},
				BroadcastSentEventSchema,
			);
		},

		// === ERROR EVENTS ===

		errorHandlerFailed(handler: string, error: unknown): LogEvent {
			const errorObj = error instanceof Error ? error : new Error(String(error));
			return emit(
				'error',
				'error.handler.failed',
				{
					handler,
					errorMessage: errorObj.message,
					errorStack: errorObj.stack,
					errorName: errorObj.name,
				},
				ErrorHandlerFailedEventSchema,
			);
		},

		errorStorageFailed(operation: string, key: string, error: unknown): LogEvent {
			const errorObj = error instanceof Error ? error : new Error(String(error));
			return emit(
				'error',
				'error.storage.failed',
				{
					operation,
					key,
					errorMessage: errorObj.message,
				},
				ErrorStorageFailedEventSchema,
			);
		},

		errorBroadcastFailed(eventType: string, connectionId: string, error: unknown): LogEvent {
			const errorObj = error instanceof Error ? error : new Error(String(error));
			return emit(
				'error',
				'error.broadcast.failed',
				{
					eventType,
					connectionId,
					errorMessage: errorObj.message,
				},
				ErrorBroadcastFailedEventSchema,
			);
		},

		errorStateCorruption(corruptionType: string, details: string): LogEvent {
			return emit(
				'error',
				'error.state.corruption',
				{
					corruptionType,
					details,
				},
				ErrorStateCorruptionEventSchema,
			);
		},

		// === DIAGNOSTIC EVENTS ===

		diagnosticSnapshot(snapshot: Record<string, unknown>): LogEvent {
			return emit(
				'debug',
				'diagnostic.snapshot',
				{
					snapshot,
				},
				DiagnosticSnapshotEventSchema,
			);
		},

		diagnosticHealthCheck(healthy: boolean, checks: Record<string, boolean>): LogEvent {
			return emit(
				'debug',
				'diagnostic.health_check',
				{
					healthy,
					checks,
				},
				DiagnosticHealthCheckEventSchema,
			);
		},

		// === CORRELATION ===

		setCorrelationId(correlationId: string): void {
			baseContext._correlationId = correlationId;
		},

		clearCorrelationId(): void {
			delete baseContext._correlationId;
		},
	};
}

/**
 * Instrumentation interface
 */
export type Instrumentation = ReturnType<typeof createInstrumentation>;
