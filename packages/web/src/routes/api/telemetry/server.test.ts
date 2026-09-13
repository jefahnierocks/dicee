// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { Database } from '$lib/types/database';
import { POST } from './+server';

type TelemetryInsert = Database['public']['Tables']['telemetry_events']['Insert'];

const ORIGIN = 'https://dicee.test';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_USER_ID = '22222222-2222-4222-8222-222222222222';
const AUTHENTICATED_USER_ID = '33333333-3333-4333-8333-333333333333';

function baseEvent() {
	return {
		session_id: SESSION_ID,
		user_id: CLIENT_USER_ID,
		timestamp: new Date().toISOString(),
	};
}

async function postEvents(events: unknown[], authenticatedUserId: string | null = null) {
	const insert = vi.fn<(rows: TelemetryInsert[]) => Promise<{ error: null }>>();
	insert.mockResolvedValue({ error: null });
	const from = vi.fn().mockReturnValue({ insert });
	const safeGetSession = vi.fn().mockResolvedValue({
		session: null,
		user: authenticatedUserId ? { id: authenticatedUserId } : null,
	});
	const request = new Request(`${ORIGIN}/api/telemetry`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': 'request-browser' },
		body: JSON.stringify({ events }),
	});
	const response = await POST({
		request,
		url: new URL(request.url),
		locals: { supabase: { from }, safeGetSession },
	} as unknown as Parameters<typeof POST>[0]);

	return { response, insert, from };
}

describe('POST /api/telemetry privacy', () => {
	it('stores only paths from top-level and session-start URLs with the authenticated user', async () => {
		const event = {
			...baseEvent(),
			event_type: 'session_start',
			payload: {
				entry_page: `${ORIGIN}/auth/callback?code=private-code#access_token=private-token`,
				referrer: `${ORIGIN}/profile?email=private@example.com#fragment`,
			},
			page_url: '/lobby?invite=private-invite#private-fragment',
			referrer: `${ORIGIN}/game?code=private-code#fragment`,
			user_agent: 'untrusted-client-browser',
		};

		const { response, insert, from } = await postEvents([event], AUTHENTICATED_USER_ID);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, count: 1 });
		expect(from).toHaveBeenCalledExactlyOnceWith('telemetry_events');
		expect(insert).toHaveBeenCalledExactlyOnceWith([
			{
				session_id: SESSION_ID,
				user_id: AUTHENTICATED_USER_ID,
				event_type: 'session_start',
				payload: { entry_page: '/auth/callback', referrer: '/profile' },
				page_url: '/lobby',
				referrer: '/game',
				user_agent: 'request-browser',
				timestamp: event.timestamp,
			},
		]);
	});

	it.each([
		['relative path', '/lobby?code=private#fragment', '/lobby'],
		['same-origin URL', `${ORIGIN}/lobby?code=private#fragment`, '/lobby'],
		['external URL', 'https://external.test/lobby?code=private#fragment', null],
		['protocol-relative external URL', '//external.test/lobby?code=private', null],
		['different protocol', 'http://dicee.test/lobby?code=private', null],
		['different port', 'https://dicee.test:8443/lobby?code=private', null],
		['blob URL', `blob:${ORIGIN}/private-id?code=private`, null],
		['malformed URL', 'https://[', null],
		['empty URL', '', null],
	])('normalizes every URL field: %s', async (_label, value, expected) => {
		const events = [
			{
				...baseEvent(),
				event_type: 'session_start',
				payload: { entry_page: value, referrer: value },
				page_url: value,
				referrer: value,
			},
			{
				...baseEvent(),
				event_type: 'page_view',
				payload: { page: value, previous_page: value },
				page_url: value,
				referrer: value,
			},
		];

		const { response, insert } = await postEvents(events);

		expect(response.status).toBe(200);
		expect(insert).toHaveBeenCalledOnce();
		const [rows] = insert.mock.calls[0];
		expect(rows[0].payload).toEqual({ entry_page: expected, referrer: expected });
		expect(rows[1].payload).toEqual({ page: expected, previous_page: expected });
		for (const row of rows) {
			expect(row.page_url).toBe(expected);
			expect(row.referrer).toBe(expected);
			// A client ID cannot associate an anonymous request with another user's account.
			expect(row.user_id).toBeNull();
		}
	});

	it('preserves non-URL payload fields and nullable navigation fields', async () => {
		const events = [
			{ ...baseEvent(), event_type: 'game_start', payload: { mode: 'solo', player_count: 1 } },
			{
				...baseEvent(),
				event_type: 'error',
				payload: {
					error_code: 'DICE_COUNT',
					error_message: 'Unexpected # of dice? Retry.',
					context: 'roll/scoring',
				},
			},
			{
				...baseEvent(),
				event_type: 'page_view',
				payload: { page: '/lobby', previous_page: null },
			},
		];

		const { response, insert } = await postEvents(events);

		expect(response.status).toBe(200);
		expect(insert).toHaveBeenCalledOnce();
		const [rows] = insert.mock.calls[0];
		expect(rows.map((row) => row.payload)).toEqual(events.map((event) => event.payload));
		for (const row of rows) {
			expect(row.page_url).toBeNull();
			expect(row.referrer).toBeNull();
		}
	});

	it('rejects invalid URL field types before inserting any events', async () => {
		const { response, insert } = await postEvents([
			{ ...baseEvent(), event_type: 'session_start', payload: { entry_page: 123, referrer: null } },
		]);

		expect(response.status).toBe(400);
		expect(insert).not.toHaveBeenCalled();
	});
});
