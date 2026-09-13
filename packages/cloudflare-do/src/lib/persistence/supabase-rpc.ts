/**
 * Supabase RPC Client
 *
 * Type-safe client for calling PostgreSQL RPC functions.
 *
 * @see docs/architecture/README.md#persistence-bridge
 */

import { z } from 'zod';

// ============================================================================
// RPC Response Schemas
// ============================================================================

/**
 * Standard result type from PostgreSQL RPC functions.
 * Maps to the `operation_result` composite type in SQL.
 */
export const OperationResultSchema = z.object({
	success: z.boolean(),
	error_code: z.string().nullable(),
	error_message: z.string().nullable(),
	affected_rows: z.number().int(),
});

export type OperationResult = z.infer<typeof OperationResultSchema>;

/**
 * Stats update result from aggregate_game_stats function.
 * Maps to the `stats_update_result` composite type in SQL.
 */
export const StatsUpdateResultSchema = z.object({
	user_id: z.string().uuid(),
	games_played: z.number().int(),
	games_won: z.number().int(),
	new_badges: z.array(z.string()),
});

export type StatsUpdateResult = z.infer<typeof StatsUpdateResultSchema>;

// ============================================================================
// RPC Input Types
// ============================================================================

/**
 * Player ranking for game completion.
 * Maps to the `player_ranking` composite type in SQL.
 */
export interface PlayerRanking {
	player_id: string;
	rank: number;
	score: number;
	scorecard: Record<string, number>;
	is_ai: boolean;
}

/**
 * Player input for game creation.
 * Maps to the `game_player_input` composite type in SQL.
 */
export interface GamePlayerInput {
	user_id: string;
	seat_number: number;
	turn_order: number;
	is_ai: boolean;
}

/**
 * Domain event input for bulk persistence.
 * Maps to the `domain_event_input` composite type in SQL.
 */
export interface DomainEventInput {
	id: string;
	event_type: string;
	event_version: string;
	sequence_number: number;
	game_id: string;
	player_id: string;
	turn_number: number | null;
	roll_number: number | null;
	payload: Record<string, unknown>;
}

// ============================================================================
// RPC Result Types
// ============================================================================

/**
 * Discriminated union for RPC call results.
 * Provides type-safe success/failure handling.
 */
export type RpcResult<T> =
	| { success: true; data: T }
	| { success: false; error: string; retriable: boolean };

// ============================================================================
// Supabase RPC Client
// ============================================================================

/**
 * Type-safe client for calling Supabase PostgreSQL RPC functions.
 *
 * All operations are atomic - they either fully succeed or fully rollback.
 * All operations are idempotent - safe to retry on failure.
 *
 * @example
 * ```typescript
 * const rpc = new SupabaseRpcClient({
 *   supabaseUrl: env.SUPABASE_URL,
 *   serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
 * });
 *
 * const result = await rpc.createGame({
 *   gameId: crypto.randomUUID(),
 *   roomCode: 'ABC123',
 *   hostId: 'host-uuid',
 *   gameMode: 'multiplayer',
 *   settings: {},
 *   players: [
 *     { user_id: 'host-uuid', seat_number: 0, turn_order: 0, is_ai: false },
 *   ],
 * });
 *
 * if (result.success) {
 *   console.log('Game created:', result.data.affected_rows);
 * } else {
 *   console.error('Failed:', result.error, 'Retriable:', result.retriable);
 * }
 * ```
 */
export class SupabaseRpcClient {
	readonly #supabaseUrl: string;
	readonly #serviceRoleKey: string;

	constructor(config: { supabaseUrl: string; serviceRoleKey: string }) {
		this.#supabaseUrl = config.supabaseUrl;
		this.#serviceRoleKey = config.serviceRoleKey;
	}

	// ==========================================================================
	// Game Lifecycle
	// ==========================================================================

	/**
	 * Atomically create a game and all player records.
	 *
	 * - Creates game record
	 * - Creates all player records
	 * - Fully atomic: all succeed or all rollback
	 * - Idempotent: safe to retry (duplicate game_id returns success)
	 */
	async createGame(params: {
		gameId: string;
		roomCode: string;
		hostId: string;
		gameMode: 'solo' | 'multiplayer' | 'tutorial';
		settings: Record<string, unknown>;
		players: GamePlayerInput[];
	}): Promise<RpcResult<OperationResult>> {
		// Format players as PostgreSQL array of composite type
		const playersArray = params.players.map(
			(p) => `(${this.#escapeUuid(p.user_id)},${p.seat_number},${p.turn_order},${p.is_ai})`,
		);

		return this.#callRpc<OperationResult>('create_game_atomic', {
			p_game_id: params.gameId,
			p_room_code: params.roomCode,
			p_host_id: params.hostId,
			p_game_mode: params.gameMode,
			p_settings: params.settings,
			p_players: `{${playersArray.join(',')}}`,
		});
	}

	/**
	 * Atomically complete a game and update all player records.
	 *
	 * - Updates game status to 'completed'
	 * - Updates all player final_score, final_rank, scorecard
	 * - Fully atomic: all succeed or all rollback
	 * - Idempotent: safe to retry (already completed returns success)
	 */
	async completeGame(params: {
		gameId: string;
		winnerId: string | null;
		rankings: PlayerRanking[];
	}): Promise<RpcResult<OperationResult>> {
		// Format rankings as PostgreSQL array of composite type
		const rankingsArray = params.rankings.map(
			(r) =>
				`(${this.#escapeUuid(r.player_id)},${r.rank},${r.score},'${this.#escapeJson(r.scorecard)}',${r.is_ai})`,
		);

		return this.#callRpc<OperationResult>('complete_game_atomic', {
			p_game_id: params.gameId,
			p_winner_id: params.winnerId,
			p_rankings: `{${rankingsArray.join(',')}}`,
		});
	}

	/**
	 * Persist domain events in bulk.
	 *
	 * - Inserts all events in a single transaction
	 * - Idempotent: duplicate event IDs are skipped (ON CONFLICT DO NOTHING)
	 * - All events must belong to the same game
	 */
	async persistDomainEvents(events: DomainEventInput[]): Promise<RpcResult<OperationResult>> {
		if (events.length === 0) {
			return {
				success: true,
				data: {
					success: true,
					error_code: null,
					error_message: null,
					affected_rows: 0,
				},
			};
		}

		// Format events as PostgreSQL array of composite type
		const eventsArray = events.map(
			(e) =>
				`(${this.#escapeUuid(e.id)},'${e.event_type}','${e.event_version}',${e.sequence_number},${this.#escapeUuid(e.game_id)},${this.#escapeUuid(e.player_id)},${e.turn_number ?? 'NULL'},${e.roll_number ?? 'NULL'},'${this.#escapeJson(e.payload)}')`,
		);

		return this.#callRpc<OperationResult>('persist_domain_events', {
			p_events: `{${eventsArray.join(',')}}`,
		});
	}

	/**
	 * Mark a game as abandoned.
	 *
	 * - Updates game status to 'abandoned'
	 * - Records abandonment reason in settings
	 * - Marks all connected players as disconnected
	 * - Idempotent: safe to retry (already ended returns success)
	 */
	async abandonGame(params: {
		gameId: string;
		reason: string;
	}): Promise<RpcResult<OperationResult>> {
		return this.#callRpc<OperationResult>('abandon_game_atomic', {
			p_game_id: params.gameId,
			p_reason: params.reason,
		});
	}

	/**
	 * Aggregate stats for a completed game.
	 *
	 * - Updates player_stats for all human players
	 * - Calculates games_played, games_won, total_score, best_score, avg_score
	 * - Updates category_stats if scorecard data available
	 */
	async aggregateStats(gameId: string): Promise<RpcResult<StatsUpdateResult[]>> {
		return this.#callRpc<StatsUpdateResult[]>('aggregate_game_stats', {
			p_game_id: gameId,
		});
	}

	// ==========================================================================
	// Private Helpers
	// ==========================================================================

	/**
	 * Call a Supabase RPC function.
	 */
	async #callRpc<T>(functionName: string, params: Record<string, unknown>): Promise<RpcResult<T>> {
		try {
			const response = await fetch(`${this.#supabaseUrl}/rest/v1/rpc/${functionName}`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					apikey: this.#serviceRoleKey,
					Authorization: `Bearer ${this.#serviceRoleKey}`,
					Prefer: 'return=representation',
				},
				body: JSON.stringify(params),
			});

			if (!response.ok) {
				const text = await response.text();
				return {
					success: false,
					error: `RPC ${functionName} failed: ${response.status} ${text}`,
					retriable: response.status >= 500 || response.status === 429,
				};
			}

			const data = (await response.json()) as unknown;

			// Handle operation_result type
			if (this.#isOperationResult(data)) {
				if (!data.success) {
					return {
						success: false,
						error: `${data.error_code}: ${data.error_message}`,
						retriable: this.#isRetriableError(data.error_code),
					};
				}
			}

			return { success: true, data: data as T };
		} catch (err) {
			return {
				success: false,
				error: `Network error calling ${functionName}: ${err instanceof Error ? err.message : 'Unknown'}`,
				retriable: true,
			};
		}
	}

	/**
	 * Type guard for operation_result.
	 */
	#isOperationResult(data: unknown): data is OperationResult {
		return (
			typeof data === 'object' &&
			data !== null &&
			'success' in data &&
			typeof (data as OperationResult).success === 'boolean'
		);
	}

	/**
	 * Determine if an error code is retriable.
	 */
	#isRetriableError(errorCode: string | null): boolean {
		if (!errorCode) return true;

		const nonRetriable = ['INVALID_INPUT', 'INVALID_REFERENCE', 'NOT_FOUND', 'INVALID_STATE'];

		return !nonRetriable.includes(errorCode);
	}

	/**
	 * Escape a UUID for PostgreSQL composite type syntax.
	 */
	#escapeUuid(uuid: string): string {
		// UUIDs need no escaping, just ensure proper format
		return uuid;
	}

	/**
	 * Escape a JSON object for PostgreSQL JSONB.
	 */
	#escapeJson(obj: Record<string, unknown>): string {
		// Escape single quotes by doubling them
		return JSON.stringify(obj).replace(/'/g, "''");
	}
}
