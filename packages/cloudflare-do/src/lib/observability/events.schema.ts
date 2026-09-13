/**
 * Observability Event Schemas
 *
 * Type-safe event schemas for structured logging.
 * Uses const arrays as single source of truth, derives Zod schemas from them.
 *
 * Pattern: Const Array → Type Inference → Zod Schema → Validation
 *
 * @example
 * ```typescript
 * import { LifecycleWakeEventSchema, type LifecycleWakeEvent } from './events.schema.js';
 *
 * const event: LifecycleWakeEvent = {
 *   _ts: Date.now(),
 *   _level: 'info',
 *   _component: 'GameRoom',
 *   _event: 'lifecycle.wake',
 *   storageKeys: ['game', 'seats'],
 *   connectedClients: 2,
 *   // ... other fields
 * };
 *
 * const validated = LifecycleWakeEventSchema.parse(event);
 * ```
 */

import { z } from 'zod';

// =============================================================================
// Event Categories (Const Arrays → Inferred Types)
// =============================================================================

/**
 * Lifecycle event types
 */
export const LIFECYCLE_EVENTS = [
	'lifecycle.wake',
	'lifecycle.connect',
	'lifecycle.disconnect',
	'lifecycle.reconnect',
] as const;

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/**
 * Storage event types
 */
export const STORAGE_EVENTS = [
	'storage.read.start',
	'storage.read.end',
	'storage.write.start',
	'storage.write.end',
	'storage.delete',
	'storage.list',
] as const;

export type StorageEvent = (typeof STORAGE_EVENTS)[number];

/**
 * State machine event types
 */
export const STATE_EVENTS = [
	'state.transition',
	'state.transition.rejected',
	'state.snapshot',
] as const;

export type StateEvent = (typeof STATE_EVENTS)[number];

/**
 * Seat management event types
 */
export const SEAT_EVENTS = [
	'seat.assign',
	'seat.reserve',
	'seat.reclaim.attempt',
	'seat.reclaim.result',
	'seat.release',
] as const;

export type SeatEvent = (typeof SEAT_EVENTS)[number];

/**
 * Game event types
 */
export const GAME_EVENTS = [
	'game.start',
	'game.turn.start',
	'game.turn.end',
	'game.roll',
	'game.score',
	'game.complete',
] as const;

export type GameEvent = (typeof GAME_EVENTS)[number];

/**
 * Connection event types
 */
export const CONNECTION_EVENTS = [
	'connection.auth.success',
	'connection.auth.failure',
	'connection.token.expired',
	'connection.rate_limit',
] as const;

export type ConnectionEvent = (typeof CONNECTION_EVENTS)[number];

/**
 * Broadcast event types
 */
export const BROADCAST_EVENTS = ['broadcast.prepare', 'broadcast.sent'] as const;

export type BroadcastEvent = (typeof BROADCAST_EVENTS)[number];

/**
 * Error event types
 */
export const ERROR_EVENTS = [
	'error.handler.failed',
	'error.storage.failed',
	'error.broadcast.failed',
	'error.state.corruption',
] as const;

export type ErrorEvent = (typeof ERROR_EVENTS)[number];

/**
 * Diagnostic event types
 */
export const DIAGNOSTIC_EVENTS = ['diagnostic.snapshot', 'diagnostic.health_check'] as const;

export type DiagnosticEvent = (typeof DIAGNOSTIC_EVENTS)[number];

/**
 * All event types (union)
 */
export const ALL_EVENT_TYPES = [
	...LIFECYCLE_EVENTS,
	...STORAGE_EVENTS,
	...STATE_EVENTS,
	...SEAT_EVENTS,
	...GAME_EVENTS,
	...CONNECTION_EVENTS,
	...BROADCAST_EVENTS,
	...ERROR_EVENTS,
	...DIAGNOSTIC_EVENTS,
] as const;

export type EventType = (typeof ALL_EVENT_TYPES)[number];

// =============================================================================
// Base Schemas
// =============================================================================

/**
 * Log level enum (Zod-validated)
 */
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

/**
 * Component identifier
 */
export const ComponentSchema = z.enum(['GameRoom', 'GlobalLobby']);
export type Component = z.infer<typeof ComponentSchema>;

/**
 * Event type schema (derived from const array)
 */
export const EventTypeSchema = z.enum(ALL_EVENT_TYPES);

/**
 * Base log entry (all events share this structure)
 */
export const BaseLogEntrySchema = z.object({
	_ts: z.number().int().nonnegative(),
	_level: LogLevelSchema,
	_component: ComponentSchema,
	_event: EventTypeSchema,
	_reqId: z.number().int().positive().optional(),
	_correlationId: z.string().min(1).optional(),
	roomCode: z.string().optional(),
	userId: z.string().optional(),
	connectionId: z.string().optional(),
});

export type BaseLogEntry = z.infer<typeof BaseLogEntrySchema>;

// =============================================================================
// Event-Specific Schemas
// =============================================================================

/**
 * Lifecycle wake event
 */
export const LifecycleWakeEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('lifecycle.wake'),
	storageKeys: z.array(z.string()),
	connectedClients: z.number().int().nonnegative(),
	hasGameState: z.boolean(),
	hasSeats: z.boolean(),
	hasRoomState: z.boolean(),
	keyCount: z.number().int().nonnegative(),
});

export type LifecycleWakeEvent = z.infer<typeof LifecycleWakeEventSchema>;

/**
 * Client connect event
 */
export const LifecycleConnectEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('lifecycle.connect'),
	userId: z.string().min(1),
	role: z.enum(['player', 'spectator', 'pending']),
	connectionId: z.string().min(1),
});

export type LifecycleConnectEvent = z.infer<typeof LifecycleConnectEventSchema>;

/**
 * Client disconnect event
 */
export const LifecycleDisconnectEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('lifecycle.disconnect'),
	userId: z.string().min(1),
	connectionId: z.string().min(1),
	closeCode: z.number().int(),
	closeReason: z.string(),
	wasPlayer: z.boolean(),
	codeCategory: z.string(),
});

export type LifecycleDisconnectEvent = z.infer<typeof LifecycleDisconnectEventSchema>;

/**
 * Client reconnect event
 */
export const LifecycleReconnectEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('lifecycle.reconnect'),
	userId: z.string().min(1),
	previousConnectionId: z.string().min(1),
	newConnectionId: z.string().min(1),
});

export type LifecycleReconnectEvent = z.infer<typeof LifecycleReconnectEventSchema>;

/**
 * Storage read start event
 */
export const StorageReadStartEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('storage.read.start'),
	key: z.string().min(1),
});

export type StorageReadStartEvent = z.infer<typeof StorageReadStartEventSchema>;

/**
 * Storage read end event
 */
export const StorageReadEndEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('storage.read.end'),
	key: z.string().min(1),
	found: z.boolean(),
	valueType: z.string().optional(),
	durationMs: z.number().nonnegative().optional(),
	sizeBytes: z.number().int().nonnegative().optional(),
});

export type StorageReadEndEvent = z.infer<typeof StorageReadEndEventSchema>;

/**
 * Storage write start event
 */
export const StorageWriteStartEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('storage.write.start'),
	key: z.string().min(1),
});

export type StorageWriteStartEvent = z.infer<typeof StorageWriteStartEventSchema>;

/**
 * Storage write end event
 */
export const StorageWriteEndEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('storage.write.end'),
	key: z.string().min(1),
	success: z.boolean(),
	durationMs: z.number().nonnegative().optional(),
});

export type StorageWriteEndEvent = z.infer<typeof StorageWriteEndEventSchema>;

/**
 * Seat assign event
 */
export const SeatAssignEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('seat.assign'),
	userId: z.string().min(1),
	seatIndex: z.number().int().nonnegative(),
	displayName: z.string(),
});

export type SeatAssignEvent = z.infer<typeof SeatAssignEventSchema>;

/**
 * Seat reserve event
 */
export const SeatReserveEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('seat.reserve'),
	userId: z.string().min(1),
	seatIndex: z.number().int().nonnegative(),
	expiresAt: z.number().int().positive(),
});

export type SeatReserveEvent = z.infer<typeof SeatReserveEventSchema>;

/**
 * Seat reclaim attempt event
 */
export const SeatReclaimAttemptEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('seat.reclaim.attempt'),
	userId: z.string().min(1),
	hasReservedSeat: z.boolean(),
	hasActiveGame: z.boolean(),
	withinWindow: z.boolean(),
});

export type SeatReclaimAttemptEvent = z.infer<typeof SeatReclaimAttemptEventSchema>;

/**
 * Seat reclaim result event
 */
export const SeatReclaimResultEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('seat.reclaim.result'),
	userId: z.string().min(1),
	result: z.enum(['reclaimed', 'spectator']),
	reason: z.string().optional(),
});

export type SeatReclaimResultEvent = z.infer<typeof SeatReclaimResultEventSchema>;

/**
 * Seat release event
 */
export const SeatReleaseEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('seat.release'),
	userId: z.string().min(1),
	seatIndex: z.number().int().nonnegative(),
	reason: z.string(),
});

export type SeatReleaseEvent = z.infer<typeof SeatReleaseEventSchema>;

/**
 * Game start event
 */
export const GameStartEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('game.start'),
	playerCount: z.number().int().positive(),
	hostId: z.string().min(1),
});

export type GameStartEvent = z.infer<typeof GameStartEventSchema>;

/**
 * Game roll event
 */
export const GameRollEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('game.roll'),
	playerId: z.string().min(1),
	rollNumber: z.number().int().positive().max(3),
	dice: z.array(z.number().int().min(1).max(6)).length(5),
});

export type GameRollEvent = z.infer<typeof GameRollEventSchema>;

/**
 * Game score event
 */
export const GameScoreEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('game.score'),
	playerId: z.string().min(1),
	category: z.string(),
	score: z.number().int().nonnegative(),
});

export type GameScoreEvent = z.infer<typeof GameScoreEventSchema>;

/**
 * Broadcast prepare event
 */
export const BroadcastPrepareEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('broadcast.prepare'),
	eventType: z.string(),
	recipientCount: z.number().int().nonnegative(),
});

export type BroadcastPrepareEvent = z.infer<typeof BroadcastPrepareEventSchema>;

/**
 * Broadcast sent event
 */
export const BroadcastSentEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('broadcast.sent'),
	eventType: z.string(),
	sentCount: z.number().int().nonnegative(),
	totalSockets: z.number().int().nonnegative(),
});

export type BroadcastSentEvent = z.infer<typeof BroadcastSentEventSchema>;

/**
 * Error handler failed event
 */
export const ErrorHandlerFailedEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('error.handler.failed'),
	_level: z.literal('error'),
	errorMessage: z.string(),
	errorStack: z.string().optional(),
	errorName: z.string(),
	handler: z.string(),
});

export type ErrorHandlerFailedEvent = z.infer<typeof ErrorHandlerFailedEventSchema>;

/**
 * Error storage failed event
 */
export const ErrorStorageFailedEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('error.storage.failed'),
	_level: z.literal('error'),
	operation: z.string(),
	key: z.string(),
	errorMessage: z.string(),
});

export type ErrorStorageFailedEvent = z.infer<typeof ErrorStorageFailedEventSchema>;

/**
 * Error broadcast failed event
 */
export const ErrorBroadcastFailedEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('error.broadcast.failed'),
	_level: z.literal('error'),
	eventType: z.string(),
	connectionId: z.string(),
	errorMessage: z.string(),
});

export type ErrorBroadcastFailedEvent = z.infer<typeof ErrorBroadcastFailedEventSchema>;

/**
 * Error state corruption event
 */
export const ErrorStateCorruptionEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('error.state.corruption'),
	_level: z.literal('error'),
	corruptionType: z.string(),
	details: z.string(),
});

export type ErrorStateCorruptionEvent = z.infer<typeof ErrorStateCorruptionEventSchema>;

/**
 * Storage delete event
 */
export const StorageDeleteEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('storage.delete'),
	key: z.string().min(1),
	success: z.boolean(),
});

export type StorageDeleteEvent = z.infer<typeof StorageDeleteEventSchema>;

/**
 * Storage list event
 */
export const StorageListEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('storage.list'),
	keyCount: z.number().int().nonnegative(),
});

export type StorageListEvent = z.infer<typeof StorageListEventSchema>;

/**
 * State transition event
 */
export const StateTransitionEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('state.transition'),
	fromState: z.string(),
	toState: z.string(),
	trigger: z.string(),
});

export type StateTransitionEvent = z.infer<typeof StateTransitionEventSchema>;

/**
 * State transition rejected event
 */
export const StateTransitionRejectedEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('state.transition.rejected'),
	fromState: z.string(),
	attemptedState: z.string(),
	reason: z.string(),
});

export type StateTransitionRejectedEvent = z.infer<typeof StateTransitionRejectedEventSchema>;

/**
 * Game turn start event
 */
export const GameTurnStartEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('game.turn.start'),
	playerId: z.string().min(1),
	turnNumber: z.number().int().positive(),
});

export type GameTurnStartEvent = z.infer<typeof GameTurnStartEventSchema>;

/**
 * Game turn end event
 */
export const GameTurnEndEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('game.turn.end'),
	playerId: z.string().min(1),
	turnNumber: z.number().int().positive(),
});

export type GameTurnEndEvent = z.infer<typeof GameTurnEndEventSchema>;

/**
 * Game complete event
 */
export const GameCompleteEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('game.complete'),
	winnerId: z.string().min(1).optional(),
	finalScores: z.record(z.string(), z.number().int()),
});

export type GameCompleteEvent = z.infer<typeof GameCompleteEventSchema>;

/**
 * Connection auth success event
 */
export const ConnectionAuthSuccessEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('connection.auth.success'),
	userId: z.string().min(1),
	method: z.string(),
});

export type ConnectionAuthSuccessEvent = z.infer<typeof ConnectionAuthSuccessEventSchema>;

/**
 * Connection auth failure event
 */
export const ConnectionAuthFailureEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('connection.auth.failure'),
	_level: z.literal('warn'),
	reason: z.string(),
});

export type ConnectionAuthFailureEvent = z.infer<typeof ConnectionAuthFailureEventSchema>;

/**
 * Connection token expired event
 */
export const ConnectionTokenExpiredEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('connection.token.expired'),
	_level: z.literal('warn'),
	userId: z.string().min(1).optional(),
});

export type ConnectionTokenExpiredEvent = z.infer<typeof ConnectionTokenExpiredEventSchema>;

/**
 * Connection rate limit event
 */
export const ConnectionRateLimitEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('connection.rate_limit'),
	_level: z.literal('warn'),
	userId: z.string().min(1),
	limitType: z.string(),
});

export type ConnectionRateLimitEvent = z.infer<typeof ConnectionRateLimitEventSchema>;

/**
 * Diagnostic snapshot event
 */
export const DiagnosticSnapshotEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('diagnostic.snapshot'),
	_level: z.literal('debug'),
	snapshot: z.record(z.string(), z.unknown()),
});

export type DiagnosticSnapshotEvent = z.infer<typeof DiagnosticSnapshotEventSchema>;

/**
 * Diagnostic health check event
 */
export const DiagnosticHealthCheckEventSchema = BaseLogEntrySchema.extend({
	_event: z.literal('diagnostic.health_check'),
	_level: z.literal('debug'),
	healthy: z.boolean(),
	checks: z.record(z.string(), z.boolean()),
});

export type DiagnosticHealthCheckEvent = z.infer<typeof DiagnosticHealthCheckEventSchema>;

// =============================================================================
// Discriminated Union (All Events)
// =============================================================================

/**
 * Discriminated union of all log events
 * Used for type-safe event validation and narrowing
 */
export const LogEventSchema = z.discriminatedUnion('_event', [
	// Lifecycle events
	LifecycleWakeEventSchema,
	LifecycleConnectEventSchema,
	LifecycleDisconnectEventSchema,
	LifecycleReconnectEventSchema,
	// Storage events
	StorageReadStartEventSchema,
	StorageReadEndEventSchema,
	StorageWriteStartEventSchema,
	StorageWriteEndEventSchema,
	StorageDeleteEventSchema,
	StorageListEventSchema,
	// State events
	StateTransitionEventSchema,
	StateTransitionRejectedEventSchema,
	// Seat events
	SeatAssignEventSchema,
	SeatReserveEventSchema,
	SeatReclaimAttemptEventSchema,
	SeatReclaimResultEventSchema,
	SeatReleaseEventSchema,
	// Game events
	GameStartEventSchema,
	GameTurnStartEventSchema,
	GameTurnEndEventSchema,
	GameRollEventSchema,
	GameScoreEventSchema,
	GameCompleteEventSchema,
	// Connection events
	ConnectionAuthSuccessEventSchema,
	ConnectionAuthFailureEventSchema,
	ConnectionTokenExpiredEventSchema,
	ConnectionRateLimitEventSchema,
	// Broadcast events
	BroadcastPrepareEventSchema,
	BroadcastSentEventSchema,
	// Error events
	ErrorHandlerFailedEventSchema,
	ErrorStorageFailedEventSchema,
	ErrorBroadcastFailedEventSchema,
	ErrorStateCorruptionEventSchema,
	// Diagnostic events
	DiagnosticSnapshotEventSchema,
	DiagnosticHealthCheckEventSchema,
]);

export type LogEvent = z.infer<typeof LogEventSchema>;

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate a log entry against its event-specific schema
 *
 * @param entry - Log entry to validate
 * @returns Validated entry
 * @throws ZodError if validation fails
 */
export function validateLogEntry(entry: unknown): LogEvent {
	return LogEventSchema.parse(entry);
}

/**
 * Safe parse a log entry (returns success/error result)
 *
 * @param entry - Log entry to validate
 * @returns Safe parse result
 */
export function safeValidateLogEntry(entry: unknown): ReturnType<typeof LogEventSchema.safeParse> {
	return LogEventSchema.safeParse(entry);
}

/**
 * Type guard to check if an event is a specific type
 *
 * @param event - Event to check
 * @param eventType - Event type to match
 * @returns True if event matches the type (with type narrowing)
 */
export function isEventType<T extends EventType>(
	event: LogEvent,
	type: T,
): event is Extract<LogEvent, { _event: T }> {
	return event._event === type;
}

/**
 * Get event category from event type
 *
 * @param eventType - Event type string
 * @returns Category name
 */
export function getEventCategory(eventType: EventType): string {
	if (LIFECYCLE_EVENTS.includes(eventType as LifecycleEvent)) return 'lifecycle';
	if (STORAGE_EVENTS.includes(eventType as StorageEvent)) return 'storage';
	if (STATE_EVENTS.includes(eventType as StateEvent)) return 'state';
	if (SEAT_EVENTS.includes(eventType as SeatEvent)) return 'seat';
	if (GAME_EVENTS.includes(eventType as GameEvent)) return 'game';
	if (CONNECTION_EVENTS.includes(eventType as ConnectionEvent)) return 'connection';
	if (BROADCAST_EVENTS.includes(eventType as BroadcastEvent)) return 'broadcast';
	if (ERROR_EVENTS.includes(eventType as ErrorEvent)) return 'error';
	if (DIAGNOSTIC_EVENTS.includes(eventType as DiagnosticEvent)) return 'diagnostic';
	return 'unknown';
}
