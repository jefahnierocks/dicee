/**
 * Telemetry Types
 *
 * Event types for UX metrics and learning analytics.
 * Follows RFC-003 three-stream architecture (telemetry stream, 30-day retention; docs/architecture/README.md#data-contracts).
 *
 * Types are derived from Zod schemas for runtime validation.
 *
 * @module types/telemetry
 * @see telemetry.schema.ts - Zod schemas for runtime validation
 */

// =============================================================================
// Re-export all types from schema
// =============================================================================

export type {
	CategoryHoverPayload,
	CategoryScorePayload,
	DecisionQualityPayload,
	ErrorPayload,
	GameCompletePayload,
	GameStartPayload,
	HintRequestedPayload,
	PageViewPayload,
	PredictionPayload,
	RollPayload,
	SessionEndPayload,
	// Payload types
	SessionStartPayload,
	// Config
	TelemetryConfig,
	// Event type
	TelemetryEvent,
	TelemetryEventType,
} from './telemetry.schema.js';

// Re-export type guards and validation helpers
export { isTelemetryEvent, isTelemetryEventType, parseTelemetryEvent } from './telemetry.schema.js';

// =============================================================================
// Event Type Constants
// =============================================================================

/**
 * Telemetry event types as const object for convenient access
 * Use: TelemetryEventType.SESSION_START
 */
export const TELEMETRY_EVENT_TYPES = {
	// Session events
	SESSION_START: 'session_start',
	SESSION_END: 'session_end',
	PAGE_VIEW: 'page_view',

	// Game lifecycle
	GAME_START: 'game_start',
	GAME_COMPLETE: 'game_complete',

	// Turn events (lightweight telemetry, not full domain events)
	ROLL: 'roll',
	CATEGORY_HOVER: 'category_hover',
	CATEGORY_SCORE: 'category_score',

	// Learning events
	HINT_REQUESTED: 'hint_requested',
	DECISION_QUALITY: 'decision_quality',
	PREDICTION: 'prediction',

	// Errors and diagnostics
	ERROR: 'error',
} as const;

// =============================================================================
// Payload Type Map
// =============================================================================

import type {
	CategoryHoverPayload,
	CategoryScorePayload,
	DecisionQualityPayload,
	ErrorPayload,
	GameCompletePayload,
	GameStartPayload,
	HintRequestedPayload,
	PageViewPayload,
	PredictionPayload,
	RollPayload,
	SessionEndPayload,
	SessionStartPayload,
	TelemetryConfig,
	TelemetryEventType,
} from './telemetry.schema.js';

/**
 * Payload type map for type-safe event creation
 */
export interface TelemetryPayloadMap {
	session_start: SessionStartPayload;
	session_end: SessionEndPayload;
	page_view: PageViewPayload;
	game_start: GameStartPayload;
	game_complete: GameCompletePayload;
	roll: RollPayload;
	category_hover: CategoryHoverPayload;
	category_score: CategoryScorePayload;
	hint_requested: HintRequestedPayload;
	decision_quality: DecisionQualityPayload;
	prediction: PredictionPayload;
	error: ErrorPayload;
}

/**
 * Generic event input type for creating events with type safety
 *
 * Use TelemetryEventInput<T> when creating events to get payload type inference.
 * Use TelemetryEvent (discriminated union from schema) for runtime validation.
 */
export interface TelemetryEventInput<T extends TelemetryEventType = TelemetryEventType> {
	id?: string;
	session_id: string;
	user_id?: string | null;
	event_type: T;
	payload: T extends keyof TelemetryPayloadMap ? TelemetryPayloadMap[T] : Record<string, unknown>;
	page_url?: string | null;
	referrer?: string | null;
	user_agent?: string | null;
	timestamp: string;
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default telemetry configuration
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
	enabled: true,
	batchSize: 10,
	flushIntervalMs: 5000,
	debug: false,
};
