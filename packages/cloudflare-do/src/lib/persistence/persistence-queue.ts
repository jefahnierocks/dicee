/**
 * Persistence Queue (AlarmQueue Pattern)
 *
 * Reliable async persistence with retry using DO SQLite and alarms.
 * Tasks are durably stored and processed with exponential backoff.
 *
 * Phase 4: Uses SupabaseRpcClient for atomic database operations.
 */

import type { DomainEvent, PersistenceResult } from './schemas';
import type { DomainEventInput, RpcResult, SupabaseRpcClient } from './supabase-rpc';

// ============================================================================
// Types
// ============================================================================

export const PERSISTENCE_TASK_TYPES = [
	'PERSIST_GAME_COMPLETION',
	'PERSIST_DOMAIN_EVENTS',
	'TRIGGER_AGGREGATION',
	'ABANDON_GAME',
] as const;

export type PersistenceTaskType = (typeof PERSISTENCE_TASK_TYPES)[number];

export interface PersistenceTask {
	type: PersistenceTaskType;
	gameId: string;
	payload: Record<string, unknown>;
	retryCount: number;
	createdAt: number;
	scheduledFor: number;
}

// ============================================================================
// Persistence Queue
// ============================================================================

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s for background tasks

export class PersistenceQueue {
	readonly #ctx: DurableObjectState;
	readonly #rpc: SupabaseRpcClient;
	readonly #onError: (task: PersistenceTask, error: string) => void;
	readonly #supabaseUrl: string;
	readonly #anonKey: string;

	constructor(
		ctx: DurableObjectState,
		rpcClient: SupabaseRpcClient,
		onError: (task: PersistenceTask, error: string) => void,
		config?: { supabaseUrl: string; anonKey: string },
	) {
		this.#ctx = ctx;
		this.#rpc = rpcClient;
		this.#onError = onError;
		// For edge function calls (aggregation)
		this.#supabaseUrl = config?.supabaseUrl ?? '';
		this.#anonKey = config?.anonKey ?? '';
	}

	/**
	 * Schedule a persistence task with optional delay.
	 */
	async schedule(
		task: Omit<PersistenceTask, 'retryCount' | 'createdAt' | 'scheduledFor'>,
		delayMs = 0,
	): Promise<void> {
		const fullTask: PersistenceTask = {
			...task,
			retryCount: 0,
			createdAt: Date.now(),
			scheduledFor: Date.now() + delayMs,
		};

		// Store in DO SQLite for durability
		this.#ctx.storage.sql.exec(
			`INSERT INTO persistence_queue (task_type, game_id, payload, retry_count, created_at, scheduled_for)
       VALUES (?, ?, ?, ?, ?, ?)`,
			fullTask.type,
			fullTask.gameId,
			JSON.stringify(fullTask.payload),
			fullTask.retryCount,
			fullTask.createdAt,
			fullTask.scheduledFor,
		);

		// Set alarm if not already set or if this task is earlier
		const currentAlarm = await this.#ctx.storage.getAlarm();
		if (!currentAlarm || currentAlarm > fullTask.scheduledFor) {
			await this.#ctx.storage.setAlarm(fullTask.scheduledFor);
		}
	}

	/**
	 * Process due tasks. Called from DO alarm handler.
	 */
	async processDueTasks(): Promise<void> {
		const now = Date.now();

		// Get all due tasks
		const cursor = this.#ctx.storage.sql.exec(
			`SELECT rowid, * FROM persistence_queue WHERE scheduled_for <= ? ORDER BY scheduled_for ASC`,
			now,
		);

		const rows = [...cursor];

		for (const row of rows) {
			const task: PersistenceTask & { rowid: number } = {
				rowid: row.rowid as number,
				type: row.task_type as PersistenceTaskType,
				gameId: row.game_id as string,
				payload: JSON.parse(row.payload as string),
				retryCount: row.retry_count as number,
				createdAt: row.created_at as number,
				scheduledFor: row.scheduled_for as number,
			};

			const result = await this.#executeTask(task);

			if (result.success) {
				// Remove completed task
				this.#ctx.storage.sql.exec(`DELETE FROM persistence_queue WHERE rowid = ?`, task.rowid);
			} else if (result.retriable && task.retryCount < MAX_RETRIES) {
				// Schedule retry with exponential backoff
				const nextDelay = BASE_DELAY_MS * 2 ** task.retryCount;
				this.#ctx.storage.sql.exec(
					`UPDATE persistence_queue
           SET retry_count = ?, scheduled_for = ?
           WHERE rowid = ?`,
					task.retryCount + 1,
					now + nextDelay,
					task.rowid,
				);
			} else {
				// Max retries reached or non-retriable error
				this.#onError(task, result.error);
				this.#ctx.storage.sql.exec(`DELETE FROM persistence_queue WHERE rowid = ?`, task.rowid);
			}
		}

		// Schedule next alarm for remaining tasks
		const nextTaskCursor = this.#ctx.storage.sql.exec(
			`SELECT MIN(scheduled_for) as next FROM persistence_queue`,
		);
		const nextTaskRows = [...nextTaskCursor];
		if (nextTaskRows[0]?.next) {
			await this.#ctx.storage.setAlarm(nextTaskRows[0].next as number);
		}
	}

	async #executeTask(task: PersistenceTask): Promise<PersistenceResult> {
		switch (task.type) {
			case 'PERSIST_GAME_COMPLETION': {
				const rankings = task.payload.rankings as Array<{
					playerId: string;
					rank: number;
					score: number;
					scorecard: Record<string, number>;
					isAi: boolean;
				}>;

				const result = await this.#rpc.completeGame({
					gameId: task.gameId,
					winnerId: task.payload.winnerId as string | null,
					rankings: rankings.map((r) => ({
						player_id: r.playerId,
						rank: r.rank,
						score: r.score,
						scorecard: r.scorecard,
						is_ai: r.isAi,
					})),
				});

				return this.#rpcToResult(result, task.gameId);
			}

			case 'PERSIST_DOMAIN_EVENTS': {
				const events = task.payload.events as DomainEvent[];
				const rpcEvents: DomainEventInput[] = events.map((e) => ({
					id: e.id,
					event_type: e.event_type,
					event_version: e.event_version,
					sequence_number: e.sequence_number,
					game_id: e.game_id,
					player_id: e.player_id,
					turn_number: e.turn_number ?? null,
					roll_number: e.roll_number ?? null,
					payload: e.payload as Record<string, unknown>,
				}));

				const result = await this.#rpc.persistDomainEvents(rpcEvents);
				return this.#rpcToResult(result, task.gameId);
			}

			case 'TRIGGER_AGGREGATION': {
				// Call aggregate_game_stats RPC first for core stats
				const rpcResult = await this.#rpc.aggregateStats(task.gameId);

				// If RPC failed, return the error
				if (!rpcResult.success) {
					return this.#rpcToResult(rpcResult, task.gameId);
				}

				// Optionally call edge function for Glicko-2 ratings and badges
				// (if configured and not skipped)
				const skipRatings = task.payload.skipRatings as boolean;
				const skipBadges = task.payload.skipBadges as boolean;

				if (!skipRatings || !skipBadges) {
					// Edge function handles advanced aggregation
					return this.#callAggregationEdgeFunction(task.gameId, {
						skipRatings,
						skipBadges,
					});
				}

				return { success: true, gameId: task.gameId };
			}

			case 'ABANDON_GAME': {
				const result = await this.#rpc.abandonGame({
					gameId: task.gameId,
					reason: task.payload.reason as string,
				});
				return this.#rpcToResult(result, task.gameId);
			}

			default:
				return {
					success: false,
					error: `Unknown task type: ${task.type}`,
					retriable: false,
				};
		}
	}

	/**
	 * Convert RpcResult to PersistenceResult format.
	 */
	#rpcToResult<T>(result: RpcResult<T>, gameId: string): PersistenceResult {
		if (result.success) {
			return { success: true, gameId };
		}
		return {
			success: false,
			error: result.error,
			retriable: result.retriable,
		};
	}

	/**
	 * Call the aggregate-game-stats edge function for Glicko-2 and badges.
	 */
	async #callAggregationEdgeFunction(
		gameId: string,
		options: { skipRatings: boolean; skipBadges: boolean },
	): Promise<PersistenceResult> {
		if (!this.#supabaseUrl || !this.#anonKey) {
			// Edge function not configured, RPC aggregation is sufficient
			return { success: true, gameId };
		}

		try {
			const response = await fetch(`${this.#supabaseUrl}/functions/v1/aggregate-game-stats`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${this.#anonKey}`,
				},
				body: JSON.stringify({
					gameId,
					skipRatings: options.skipRatings,
					skipBadges: options.skipBadges,
				}),
			});

			if (!response.ok) {
				const text = await response.text();
				return {
					success: false,
					error: `Edge function failed: ${response.status} ${text}`,
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
}
