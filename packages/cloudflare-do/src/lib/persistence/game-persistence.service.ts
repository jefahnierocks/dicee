/**
 * Game Persistence Service
 *
 * Service class for persisting game data to Supabase.
 * Uses service role key to bypass RLS for server-to-server writes.
 */

import { z } from 'zod';
import {
	type DomainEvent,
	DomainEventSchema,
	type GamePlayerRecord,
	GamePlayerRecordSchema,
	type GameRecord,
	GameRecordSchema,
	type PersistenceResult,
} from './schemas';

// ============================================================================
// Configuration
// ============================================================================

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;

// ============================================================================
// Service Class
// ============================================================================

export class GamePersistenceService {
	readonly #supabaseUrl: string;
	readonly #serviceRoleKey: string;
	readonly #anonKey: string;

	constructor(env: {
		SUPABASE_URL: string;
		SUPABASE_SERVICE_ROLE_KEY: string;
		SUPABASE_ANON_KEY: string;
	}) {
		this.#supabaseUrl = env.SUPABASE_URL;
		this.#serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
		this.#anonKey = env.SUPABASE_ANON_KEY;
	}

	// ==========================================================================
	// Game Lifecycle
	// ==========================================================================

	/**
	 * Create a new game record when game starts.
	 */
	async createGame(game: GameRecord): Promise<PersistenceResult> {
		const validated = GameRecordSchema.safeParse(game);
		if (!validated.success) {
			return {
				success: false,
				error: `Validation failed: ${z.prettifyError(validated.error)}`,
				retriable: false,
			};
		}

		return this.#postWithRetry('games', validated.data, validated.data.id);
	}

	/**
	 * Add player records when game starts.
	 */
	async addGamePlayers(players: GamePlayerRecord[]): Promise<PersistenceResult> {
		if (players.length === 0) {
			return { success: false, error: 'No players provided', retriable: false };
		}

		const validated = z.array(GamePlayerRecordSchema).safeParse(players);
		if (!validated.success) {
			return {
				success: false,
				error: `Validation failed: ${z.prettifyError(validated.error)}`,
				retriable: false,
			};
		}

		return this.#postWithRetry('game_players', validated.data, players[0].game_id);
	}

	/**
	 * Complete a game: update records, persist events, trigger aggregation.
	 */
	async completeGame(
		gameId: string,
		winnerId: string | null,
		rankings: Array<{
			playerId: string;
			rank: number;
			score: number;
			scorecard: Record<string, number>;
			isAi: boolean;
		}>,
		durationMs: number,
	): Promise<PersistenceResult> {
		const errors: string[] = [];

		// 1. Update game record (matching games table schema)
		// Note: duration_ms and final_rankings columns don't exist in current schema
		const gameUpdate = await this.#patchWithRetry(
			`games?id=eq.${gameId}`,
			{
				status: 'completed',
				winner_id: winnerId,
				completed_at: new Date().toISOString(),
			},
			gameId,
		);

		if (!gameUpdate.success) {
			errors.push(`Game update: ${gameUpdate.error}`);
		}

		// 2. Update each player's record (matching game_players table schema)
		for (const ranking of rankings) {
			const playerUpdate = await this.#patchWithRetry(
				`game_players?game_id=eq.${gameId}&user_id=eq.${ranking.playerId}`,
				{
					final_score: ranking.score,
					final_rank: ranking.rank,
					scorecard: ranking.scorecard,
					// Note: is_connected remains true - player completed the game successfully
				},
				gameId,
			);

			if (!playerUpdate.success) {
				errors.push(`Player ${ranking.playerId}: ${playerUpdate.error}`);
				// Continue with others - partial success is better than total failure
			}
		}

		// 3. Return result (aggregation triggered separately via queue)
		if (errors.length > 0) {
			return {
				success: false,
				error: errors.join('; '),
				retriable: true,
			};
		}

		return { success: true, gameId };
	}

	/**
	 * Persist domain events in batch.
	 */
	async persistDomainEvents(events: DomainEvent[]): Promise<PersistenceResult> {
		if (events.length === 0) {
			return { success: true, gameId: '' };
		}

		const validated = z.array(DomainEventSchema).safeParse(events);
		if (!validated.success) {
			return {
				success: false,
				error: `Validation failed: ${z.prettifyError(validated.error)}`,
				retriable: false,
			};
		}

		return this.#postWithRetry('domain_events', validated.data, events[0].game_id);
	}

	/**
	 * Trigger aggregate-game-stats edge function.
	 */
	async triggerAggregation(
		gameId: string,
		options: { skipRatings?: boolean; skipBadges?: boolean } = {},
	): Promise<PersistenceResult> {
		const payload = {
			gameId,
			skipRatings: options.skipRatings ?? false,
			skipBadges: options.skipBadges ?? false,
		};

		try {
			const response = await fetch(`${this.#supabaseUrl}/functions/v1/aggregate-game-stats`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.#anonKey}`,
				},
				body: JSON.stringify(payload),
			});

			if (!response.ok) {
				const text = await response.text();
				return {
					success: false,
					error: `Aggregation failed: ${response.status} ${text}`,
					retriable: response.status >= 500,
					statusCode: response.status,
				};
			}

			return { success: true, gameId };
		} catch (err) {
			return {
				success: false,
				error: `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
				retriable: true,
			};
		}
	}

	/**
	 * Mark game as abandoned (player left, timeout, etc.)
	 */
	async abandonGame(gameId: string, reason: string): Promise<PersistenceResult> {
		return this.#patchWithRetry(
			`games?id=eq.${gameId}`,
			{
				status: 'abandoned',
				completed_at: new Date().toISOString(),
				abandonment_reason: reason,
			},
			gameId,
		);
	}

	// ==========================================================================
	// Private Helpers
	// ==========================================================================

	#headers(): HeadersInit {
		return {
			'Content-Type': 'application/json',
			apikey: this.#serviceRoleKey,
			Authorization: `Bearer ${this.#serviceRoleKey}`,
			Prefer: 'return=minimal',
		};
	}

	async #postWithRetry(table: string, data: unknown, gameId: string): Promise<PersistenceResult> {
		return this.#withRetry(async () => {
			const response = await fetch(`${this.#supabaseUrl}/rest/v1/${table}`, {
				method: 'POST',
				headers: this.#headers(),
				body: JSON.stringify(data),
			});

			if (!response.ok) {
				const text = await response.text();
				return {
					success: false as const,
					error: `POST ${table} failed: ${response.status} ${text}`,
					retriable: response.status >= 500 || response.status === 429,
					statusCode: response.status,
				};
			}

			return { success: true as const, gameId };
		});
	}

	async #patchWithRetry(
		endpoint: string,
		data: unknown,
		gameId: string,
	): Promise<PersistenceResult> {
		return this.#withRetry(async () => {
			const response = await fetch(`${this.#supabaseUrl}/rest/v1/${endpoint}`, {
				method: 'PATCH',
				headers: this.#headers(),
				body: JSON.stringify(data),
			});

			if (!response.ok) {
				const text = await response.text();
				return {
					success: false as const,
					error: `PATCH ${endpoint} failed: ${response.status} ${text}`,
					retriable: response.status >= 500 || response.status === 429,
					statusCode: response.status,
				};
			}

			return { success: true as const, gameId };
		});
	}

	async #withRetry(operation: () => Promise<PersistenceResult>): Promise<PersistenceResult> {
		let lastResult: PersistenceResult = {
			success: false,
			error: 'No attempts made',
			retriable: false,
		};

		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				lastResult = await operation();

				if (lastResult.success || !lastResult.retriable) {
					return lastResult;
				}

				// Exponential backoff: 100ms, 200ms, 400ms
				const delay = BASE_DELAY_MS * 2 ** attempt;
				await new Promise((resolve) => setTimeout(resolve, delay));
			} catch (err) {
				lastResult = {
					success: false,
					error: `Network error: ${err instanceof Error ? err.message : 'Unknown'}`,
					retriable: true,
				};
			}
		}

		return lastResult;
	}
}
