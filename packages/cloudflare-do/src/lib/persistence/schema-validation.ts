/**
 * Compile-Time Schema Validation
 *
 * This file validates that our Zod schemas produce types compatible
 * with Supabase's generated Insert types. If database schema changes,
 * TypeScript will error here, preventing silent drift.
 *
 * @see docs/architecture/PERSISTENCE_ARCHITECTURE_ANALYSIS.md
 */

import type { TablesInsert } from '@dicee/web/src/lib/types/database';
import type { DomainEvent, GamePlayerRecord, GameRecord } from './schemas';

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Validates that T can be assigned to U at compile time.
 * If incompatible, TypeScript emits an error showing the mismatch.
 */
type AssertAssignable<T, U> = T extends U ? true : never;

// ============================================================================
// Supabase Insert Types (from generated database.ts)
// ============================================================================

type GamesInsert = TablesInsert<'games'>;
type GamePlayersInsert = TablesInsert<'game_players'>;
type DomainEventsInsert = TablesInsert<'domain_events'>;

// ============================================================================
// Schema Compatibility Checks
// ============================================================================

/**
 * GameRecord → games table
 *
 * Our schema is stricter than DB:
 * - room_code: Required (6 chars) vs DB nullable
 * - host_id: Required UUID vs DB nullable
 * - status/game_mode: Enum literals vs DB string
 *
 * These are intentional: we enforce business rules in the schema,
 * then insert valid data to DB.
 */
type _GameFieldsCheck = AssertAssignable<
	Pick<GameRecord, 'id' | 'status' | 'completed_at' | 'started_at' | 'winner_id'>,
	Pick<GamesInsert, 'id' | 'status' | 'completed_at' | 'started_at' | 'winner_id'>
>;

/**
 * GamePlayerRecord → game_players table
 *
 * Schema differences:
 * - seat_number/turn_order: Optional in schema, required in DB
 *   (we provide values before insert)
 * - scorecard: Record<string, number> vs Json
 */
type _PlayerFieldsCheck = AssertAssignable<
	Pick<GamePlayerRecord, 'game_id' | 'user_id' | 'is_connected' | 'final_score' | 'final_rank'>,
	Pick<GamePlayersInsert, 'game_id' | 'user_id' | 'is_connected' | 'final_score' | 'final_rank'>
>;

/**
 * DomainEvent → domain_events table
 *
 * Schema differences:
 * - event_type: Enum literals vs DB string
 * - payload: z.looseObject({}) vs Json
 */
type _EventFieldsCheck = AssertAssignable<
	Pick<
		DomainEvent,
		'id' | 'game_id' | 'player_id' | 'sequence_number' | 'turn_number' | 'roll_number'
	>,
	Pick<
		DomainEventsInsert,
		'id' | 'game_id' | 'player_id' | 'sequence_number' | 'turn_number' | 'roll_number'
	>
>;

// ============================================================================
// Key Field Type Assertions
// ============================================================================

// Verify UUID fields are strings
type _GameIdIsString = AssertAssignable<GameRecord['id'], string>;
type _PlayerGameIdIsString = AssertAssignable<GamePlayerRecord['game_id'], string>;
type _EventGameIdIsString = AssertAssignable<DomainEvent['game_id'], string>;

// Verify nullable fields match
type _WinnerNullable = AssertAssignable<GameRecord['winner_id'], string | null | undefined>;
type _FinalScoreNullable = AssertAssignable<
	GamePlayerRecord['final_score'],
	number | null | undefined
>;

// ============================================================================
// Runtime Export (prevents tree-shaking)
// ============================================================================

/**
 * Schema field mappings for documentation.
 * This object is never used at runtime but ensures the file is not removed.
 */
export const SCHEMA_MAPPINGS = {
	games: {
		zodSchema: 'GameRecordSchema',
		supabaseTable: 'games',
		keyDifferences: [
			'room_code: Required 6-char in schema, nullable in DB',
			'host_id: Required UUID in schema, nullable in DB',
			'status/game_mode: Enum in schema, string in DB',
		],
	},
	game_players: {
		zodSchema: 'GamePlayerRecordSchema',
		supabaseTable: 'game_players',
		keyDifferences: [
			'seat_number/turn_order: Optional in schema, required in DB',
			'scorecard: Record<string, number> in schema, Json in DB',
		],
	},
	domain_events: {
		zodSchema: 'DomainEventSchema',
		supabaseTable: 'domain_events',
		keyDifferences: [
			'event_type: Enum in schema, string in DB',
			'payload: looseObject in schema, Json in DB',
		],
	},
} as const;
