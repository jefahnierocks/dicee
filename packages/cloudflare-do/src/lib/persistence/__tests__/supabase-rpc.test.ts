import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseRpcClient } from '../supabase-rpc';

const GAME_ID = '11111111-0000-4000-8000-000000000001';
const HUMAN_ID = '22222222-0000-4000-8000-000000000001';

function operationResponse(status = 200) {
	return new Response(
		JSON.stringify({ success: true, error_code: null, error_message: null, affected_rows: 1 }),
		{ status },
	);
}

describe('SupabaseRpcClient', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	const client = new SupabaseRpcClient({
		supabaseUrl: 'https://supabase.test',
		serviceRoleKey: 'test-service-role',
	});

	const lastCall = () => {
		const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
		return { url, body: JSON.parse(init.body as string) as Record<string, unknown> };
	};

	beforeEach(() => {
		fetchMock = vi.fn(async () => operationResponse());
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('sends seats as a JSON array, with AI seats carrying no user id', async () => {
		const result = await client.createGame({
			gameId: GAME_ID,
			roomCode: 'ABCDEF',
			hostId: HUMAN_ID,
			gameMode: 'solo',
			settings: {},
			players: [
				{ user_id: HUMAN_ID, seat_number: 0, turn_order: 0, is_ai: false, ai_profile: null },
				{ user_id: null, seat_number: 1, turn_order: 1, is_ai: true, ai_profile: 'carmen' },
			],
		});

		expect(result.success).toBe(true);
		const { url, body } = lastCall();
		expect(url).toBe('https://supabase.test/rest/v1/rpc/create_game_atomic');
		expect(body.p_players).toEqual([
			{ user_id: HUMAN_ID, seat_number: 0, turn_order: 0, is_ai: false, ai_profile: null },
			{ user_id: null, seat_number: 1, turn_order: 1, is_ai: true, ai_profile: 'carmen' },
		]);
	});

	it('sends rankings and domain events as JSON arrays without hand-built literals', async () => {
		const scorecard = { ones: 3, chance: 22 };
		await client.completeGame({
			gameId: GAME_ID,
			winnerId: null,
			rankings: [{ player_id: null, seat_number: 1, rank: 1, score: 250, scorecard, is_ai: true }],
		});
		expect(lastCall().body.p_rankings).toEqual([
			{ player_id: null, seat_number: 1, rank: 1, score: 250, scorecard, is_ai: true },
		]);

		const payload = { note: `it's "quoted", (with) {braces}` };
		await client.persistDomainEvents([
			{
				id: '33333333-0000-4000-8000-000000000001',
				event_type: 'GameStarted',
				event_version: '1.0',
				sequence_number: 0,
				game_id: GAME_ID,
				player_id: HUMAN_ID,
				turn_number: null,
				roll_number: null,
				payload,
			},
		]);
		expect(lastCall().body.p_events).toEqual([
			expect.objectContaining({ turn_number: null, payload }),
		]);
	});

	it('marks server errors retriable and client errors permanent', async () => {
		fetchMock.mockImplementationOnce(async () => new Response('unavailable', { status: 503 }));
		expect(await client.aggregateStats(GAME_ID)).toMatchObject({ success: false, retriable: true });

		fetchMock.mockImplementationOnce(async () => new Response('bad request', { status: 400 }));
		expect(await client.aggregateStats(GAME_ID)).toMatchObject({
			success: false,
			retriable: false,
		});
	});
});
