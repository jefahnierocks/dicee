/**
 * Persistence Schemas for DO→Supabase Bridge
 *
 * Zod schemas for game, player, and domain event records.
 * Used for validation before persisting to Supabase.
 */

import { z } from 'zod';

// ============================================================================
// Game Record Schema
// ============================================================================

export const GAME_STATUSES = ['waiting', 'active', 'completed', 'abandoned'] as const;
export const GAME_MODES = ['solo', 'multiplayer', 'tutorial'] as const;

export type GameStatus = (typeof GAME_STATUSES)[number];
export type GameMode = (typeof GAME_MODES)[number];

export const GameRecordSchema = z.object({
	id: z.uuid(),
	room_code: z
		.string()
		.length(6)
		.regex(/^[A-HJ-NP-Z2-9]+$/),
	host_id: z.uuid(),
	status: z.enum(GAME_STATUSES),
	game_mode: z.enum(GAME_MODES),
	settings: z.record(z.string(), z.unknown()).optional(),
	created_at: z.iso.datetime().optional(),
	started_at: z.iso.datetime().optional(),
	completed_at: z.iso.datetime().optional(),
	winner_id: z.uuid().nullable().optional(),
});

export type GameRecord = z.infer<typeof GameRecordSchema>;

// ============================================================================
// Game Player Record Schema
// Matches Supabase game_players table structure
// ============================================================================

export const GamePlayerRecordSchema = z.object({
	game_id: z.uuid(),
	user_id: z.uuid(),
	seat_number: z.int().nonnegative().optional(),
	turn_order: z.int().nonnegative().optional(),
	final_score: z.int().nonnegative().nullable().optional(),
	final_rank: z.int().positive().nullable().optional(),
	scorecard: z.record(z.string(), z.int()).nullable().optional(),
	is_connected: z.boolean().default(true),
	joined_at: z.iso.datetime().optional(),
	left_at: z.iso.datetime().nullable().optional(),
});

export type GamePlayerRecord = z.infer<typeof GamePlayerRecordSchema>;

// ============================================================================
// Domain Event Schema
// ============================================================================

export const DOMAIN_EVENT_TYPES = [
	'GameStarted',
	'TurnStarted',
	'TurnEnded',
	'DiceRolled',
	'DiceKept',
	'TurnScored',
	'GameCompleted',
	'PlayerDisconnected',
	'PlayerReconnected',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const DomainEventSchema = z.object({
	id: z.uuid(),
	game_id: z.uuid(),
	player_id: z.uuid(),
	event_type: z.enum(DOMAIN_EVENT_TYPES),
	event_version: z.string().default('1.0'),
	sequence_number: z.int().nonnegative(),
	turn_number: z.int().nonnegative().nullable().optional(),
	roll_number: z.int().min(1).max(3).nullable().optional(),
	payload: z.looseObject({}),
	timestamp: z.iso.datetime().optional(),
});

export type DomainEvent = z.infer<typeof DomainEventSchema>;

// ============================================================================
// Persistence Result (Discriminated Union)
// ============================================================================

export const PersistenceSuccessSchema = z.object({
	success: z.literal(true),
	gameId: z.uuid(),
});

export const PersistenceFailureSchema = z.object({
	success: z.literal(false),
	error: z.string(),
	retriable: z.boolean(),
	statusCode: z.int().optional(),
});

export const PersistenceResultSchema = z.discriminatedUnion('success', [
	PersistenceSuccessSchema,
	PersistenceFailureSchema,
]);

export type PersistenceResult = z.infer<typeof PersistenceResultSchema>;
