import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersistenceQueue, type QueuedRanking } from '../persistence-queue';
import type { SupabaseRpcClient } from '../supabase-rpc';

interface QueueRow {
	rowid: number;
	task_type: string;
	game_id: string;
	payload: string;
	retry_count: number;
	created_at: number;
	scheduled_for: number;
}

const GAME_ID = '11111111-0000-4000-8000-000000000001';
const HUMAN_ID = '22222222-0000-4000-8000-000000000001';

/** In-memory stand-in for the persistence_queue SQLite table and the alarm. */
function createFakeCtx() {
	const rows: QueueRow[] = [];
	let nextRowid = 1;
	let alarm: number | null = null;

	const exec = (query: string, ...params: unknown[]): unknown[] => {
		const sql = query.replace(/\s+/g, ' ').trim();
		if (sql.startsWith('INSERT INTO persistence_queue')) {
			const [task_type, game_id, payload, retry_count, created_at, scheduled_for] = params as [
				string,
				string,
				string,
				number,
				number,
				number,
			];
			rows.push({
				rowid: nextRowid++,
				task_type,
				game_id,
				payload,
				retry_count,
				created_at,
				scheduled_for,
			});
			return [];
		}
		if (sql.startsWith('SELECT rowid, * FROM persistence_queue')) {
			const now = params[0] as number;
			return rows
				.filter((row) => row.scheduled_for <= now)
				.sort((a, b) => a.scheduled_for - b.scheduled_for)
				.map((row) => ({ ...row }));
		}
		if (sql.startsWith('UPDATE persistence_queue')) {
			const [retry_count, scheduled_for, rowid] = params as [number, number, number];
			const row = rows.find((candidate) => candidate.rowid === rowid);
			if (row) Object.assign(row, { retry_count, scheduled_for });
			return [];
		}
		if (sql.startsWith('DELETE FROM persistence_queue')) {
			const index = rows.findIndex((row) => row.rowid === params[0]);
			if (index >= 0) rows.splice(index, 1);
			return [];
		}
		if (sql.startsWith('SELECT MIN(scheduled_for)')) {
			return [{ next: rows.length > 0 ? Math.min(...rows.map((row) => row.scheduled_for)) : null }];
		}
		throw new Error(`Unexpected SQL: ${sql}`);
	};

	const ctx = {
		storage: {
			sql: { exec },
			getAlarm: async () => alarm,
			setAlarm: async (time: number) => {
				alarm = time;
			},
		},
	} as unknown as DurableObjectState;

	return { ctx, rows };
}

function createFakeRpc() {
	const operationOk = {
		success: true as const,
		data: { success: true, error_code: null, error_message: null, affected_rows: 1 },
	};
	const rpc = {
		createGame: vi.fn().mockResolvedValue(operationOk),
		completeGame: vi.fn().mockResolvedValue(operationOk),
		persistDomainEvents: vi.fn().mockResolvedValue(operationOk),
		abandonGame: vi.fn().mockResolvedValue(operationOk),
		aggregateStats: vi.fn().mockResolvedValue({ success: true, data: [] }),
	};
	return { rpc, client: rpc as unknown as SupabaseRpcClient };
}

describe('PersistenceQueue', () => {
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('refreshes stats through the aggregate_game_stats RPC only', async () => {
		const { ctx, rows } = createFakeCtx();
		const { rpc, client } = createFakeRpc();
		const onError = vi.fn();
		const queue = new PersistenceQueue(ctx, client, onError);

		await queue.schedule({ type: 'TRIGGER_AGGREGATION', gameId: GAME_ID, payload: {} });
		await queue.processDueTasks();

		expect(rpc.aggregateStats).toHaveBeenCalledOnce();
		expect(rpc.aggregateStats).toHaveBeenCalledWith(GAME_ID);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		expect(rows).toHaveLength(0);
	});

	it('retries a retriable aggregation failure with the same idempotent RPC, then gives up', async () => {
		const { ctx, rows } = createFakeCtx();
		const { rpc, client } = createFakeRpc();
		rpc.aggregateStats.mockResolvedValue({
			success: false,
			error: 'RPC aggregate_game_stats failed: 503',
			retriable: true,
		});
		const onError = vi.fn();
		const queue = new PersistenceQueue(ctx, client, onError);

		await queue.schedule({ type: 'TRIGGER_AGGREGATION', gameId: GAME_ID, payload: {} });
		await queue.processDueTasks();
		expect(rows[0]).toMatchObject({ retry_count: 1, scheduled_for: 1000 });

		for (let attempt = 0; attempt < 3; attempt++) {
			vi.setSystemTime(Date.now() + 10_000);
			await queue.processDueTasks();
		}

		expect(rpc.aggregateStats).toHaveBeenCalledTimes(4);
		expect(rpc.completeGame).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledOnce();
		expect(rows).toHaveLength(0);
	});

	it('sends AI rankings with a null player id and their seat number', async () => {
		const { ctx } = createFakeCtx();
		const { rpc, client } = createFakeRpc();
		const queue = new PersistenceQueue(ctx, client, vi.fn());
		const rankings: QueuedRanking[] = [
			{ playerId: null, seatNumber: 1, rank: 1, score: 250, scorecard: { ones: 4 }, isAi: true },
			{
				playerId: HUMAN_ID,
				seatNumber: 0,
				rank: 2,
				score: 200,
				scorecard: { ones: 3 },
				isAi: false,
			},
		];

		await queue.schedule({
			type: 'PERSIST_GAME_COMPLETION',
			gameId: GAME_ID,
			payload: { winnerId: null, rankings, durationMs: 1 },
		});
		await queue.processDueTasks();

		expect(rpc.completeGame).toHaveBeenCalledWith({
			gameId: GAME_ID,
			winnerId: null,
			rankings: [
				{
					player_id: null,
					seat_number: 1,
					rank: 1,
					score: 250,
					scorecard: { ones: 4 },
					is_ai: true,
				},
				{
					player_id: HUMAN_ID,
					seat_number: 0,
					rank: 2,
					score: 200,
					scorecard: { ones: 3 },
					is_ai: false,
				},
			],
		});
	});
});
