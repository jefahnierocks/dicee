/**
 * Telemetry Zod Schemas
 *
 * Zod 4 schemas for runtime validation of telemetry events.
 * All event types use snake_case for consistency with the database schema.
 *
 * @module types/telemetry.schema
 */

import { z } from 'zod';

// =============================================================================
// Event Type Schema
// =============================================================================

/**
 * All possible telemetry event types
 */
export const TelemetryEventTypeSchema = z.enum([
	'session_start',
	'session_end',
	'page_view',
	'game_start',
	'game_complete',
	'roll',
	'category_hover',
	'category_score',
	'hint_requested',
	'decision_quality',
	'prediction',
	'error',
]);

/** Telemetry event type */
export type TelemetryEventType = z.infer<typeof TelemetryEventTypeSchema>;

// =============================================================================
// Payload Schemas
// =============================================================================

/** Session start payload */
export const SessionStartPayloadSchema = z.object({
	entry_page: z.string().max(512),
	referrer: z.string().max(512).nullable(),
});

/** Session end payload */
export const SessionEndPayloadSchema = z.object({
	duration_ms: z.number().int().min(0),
	page_count: z.number().int().min(0),
});

/** Page view payload */
export const PageViewPayloadSchema = z.object({
	page: z.string().max(512),
	previous_page: z.string().max(512).nullable(),
});

/** Game start payload */
export const GameStartPayloadSchema = z.object({
	mode: z.enum(['solo', 'multiplayer']),
	player_count: z.number().int().min(1),
});

/** Game complete payload */
export const GameCompletePayloadSchema = z.object({
	final_score: z.number().int().min(0),
	duration_ms: z.number().int().min(0),
	turns_played: z.number().int().min(1).max(13),
});

/** Roll event payload */
export const RollPayloadSchema = z.object({
	turn: z.number().int().min(1).max(13),
	roll_number: z.number().int().min(1).max(3),
	time_since_last_ms: z.number().int().min(0).nullable(),
});

/** Category hover payload */
export const CategoryHoverPayloadSchema = z.object({
	category: z.string().max(64),
	duration_ms: z.number().int().min(0),
});

/** Category score payload */
export const CategoryScorePayloadSchema = z.object({
	category: z.string(),
	points: z.number().int().min(0),
	was_optimal: z.boolean(),
	turn: z.number().int().min(1).max(13),
});

/** Hint requested payload */
export const HintRequestedPayloadSchema = z.object({
	context: z.enum(['scoring', 'reroll', 'general']),
	turn: z.number().int().min(1).max(13),
	roll_number: z.number().int().min(1).max(3),
});

/** Decision quality payload */
export const DecisionQualityPayloadSchema = z.object({
	quality: z.enum(['optimal', 'excellent', 'good', 'acceptable', 'suboptimal', 'poor']),
	ev_difference: z.number().finite(),
	category: z.string().max(64),
});

/** Prediction payload */
export const PredictionPayloadSchema = z.object({
	predicted: z.string().max(64),
	actual: z.string().max(64),
	accuracy: z.number().min(0).max(1),
});

/** Error payload */
export const ErrorPayloadSchema = z.object({
	error_code: z.string().max(64),
	error_message: z.string().max(512),
	context: z.string().max(256).nullable(),
});

// =============================================================================
// Payload Type Exports
// =============================================================================

export type SessionStartPayload = z.infer<typeof SessionStartPayloadSchema>;
export type SessionEndPayload = z.infer<typeof SessionEndPayloadSchema>;
export type PageViewPayload = z.infer<typeof PageViewPayloadSchema>;
export type GameStartPayload = z.infer<typeof GameStartPayloadSchema>;
export type GameCompletePayload = z.infer<typeof GameCompletePayloadSchema>;
export type RollPayload = z.infer<typeof RollPayloadSchema>;
export type CategoryHoverPayload = z.infer<typeof CategoryHoverPayloadSchema>;
export type CategoryScorePayload = z.infer<typeof CategoryScorePayloadSchema>;
export type HintRequestedPayload = z.infer<typeof HintRequestedPayloadSchema>;
export type DecisionQualityPayload = z.infer<typeof DecisionQualityPayloadSchema>;
export type PredictionPayload = z.infer<typeof PredictionPayloadSchema>;
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

// =============================================================================
// Main Event Schema (Discriminated Union)
// =============================================================================

/** Base event fields shared by all telemetry events */
const BaseTelemetryFields = z.object({
	id: z.string().uuid().optional(),
	session_id: z.string().uuid(),
	user_id: z.string().uuid().nullable().optional(),
	page_url: z.string().max(512).nullable().optional(),
	referrer: z.string().max(512).nullable().optional(),
	user_agent: z.string().max(512).nullable().optional(),
	timestamp: z.string().datetime({ offset: true }),
});

/** Session start event */
export const SessionStartEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('session_start'),
	payload: SessionStartPayloadSchema,
});

/** Session end event */
export const SessionEndEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('session_end'),
	payload: SessionEndPayloadSchema,
});

/** Page view event */
export const PageViewEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('page_view'),
	payload: PageViewPayloadSchema,
});

/** Game start event */
export const GameStartEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('game_start'),
	payload: GameStartPayloadSchema,
});

/** Game complete event */
export const GameCompleteEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('game_complete'),
	payload: GameCompletePayloadSchema,
});

/** Roll event */
export const RollEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('roll'),
	payload: RollPayloadSchema,
});

/** Category hover event */
export const CategoryHoverEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('category_hover'),
	payload: CategoryHoverPayloadSchema,
});

/** Category score event */
export const CategoryScoreEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('category_score'),
	payload: CategoryScorePayloadSchema,
});

/** Hint requested event */
export const HintRequestedEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('hint_requested'),
	payload: HintRequestedPayloadSchema,
});

/** Decision quality event */
export const DecisionQualityEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('decision_quality'),
	payload: DecisionQualityPayloadSchema,
});

/** Prediction event */
export const PredictionEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('prediction'),
	payload: PredictionPayloadSchema,
});

/** Error event */
export const TelemetryErrorEventSchema = BaseTelemetryFields.extend({
	event_type: z.literal('error'),
	payload: ErrorPayloadSchema,
});

/**
 * All telemetry events - discriminated union
 */
export const TelemetryEventSchema = z.discriminatedUnion('event_type', [
	SessionStartEventSchema,
	SessionEndEventSchema,
	PageViewEventSchema,
	GameStartEventSchema,
	GameCompleteEventSchema,
	RollEventSchema,
	CategoryHoverEventSchema,
	CategoryScoreEventSchema,
	HintRequestedEventSchema,
	DecisionQualityEventSchema,
	PredictionEventSchema,
	TelemetryErrorEventSchema,
]);

/** Telemetry event type */
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;

// =============================================================================
// Configuration Schema
// =============================================================================

/** Telemetry service configuration */
export const TelemetryConfigSchema = z.object({
	enabled: z.boolean().default(true),
	batchSize: z.number().int().min(1).max(100).default(10),
	flushIntervalMs: z.number().int().min(1000).max(60000).default(5000),
	debug: z.boolean().default(false),
});

export type TelemetryConfig = z.infer<typeof TelemetryConfigSchema>;

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Parse and validate a telemetry event
 */
export function parseTelemetryEvent(input: unknown) {
	return TelemetryEventSchema.safeParse(input);
}

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Type guard: Check if input is a valid TelemetryEvent
 */
export function isTelemetryEvent(input: unknown): input is TelemetryEvent {
	return TelemetryEventSchema.safeParse(input).success;
}

/**
 * Type guard: Check if input is a valid TelemetryEventType
 */
export function isTelemetryEventType(input: unknown): input is TelemetryEventType {
	return TelemetryEventTypeSchema.safeParse(input).success;
}
