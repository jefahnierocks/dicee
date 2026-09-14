// @vitest-environment node

/**
 * WebSocket proxy routes forward the non-secret protocol version to the Worker
 * and nothing else from the browser query string.
 */

import { GAME_PROTOCOL_QUERY_PARAM, GAME_PROTOCOL_VERSION } from '@dicee/shared';
import { describe, expect, it, vi } from 'vitest';
import { GET as getLobby } from './lobby/+server';
import { GET as getRoom } from './room/[code]/+server';

const PROTOCOL = String(GAME_PROTOCOL_VERSION);

function createEvent(path: string, params: Record<string, string> = {}) {
	const url = new URL(`https://dicee.test${path}`);
	const request = new Request(url, { headers: { Authorization: 'Bearer client-supplied' } });
	const fetch = vi.fn(async (_request: Request) => new Response('upstream'));
	const single = vi.fn(async () => ({ data: { display_name: 'Tester', avatar_seed: 'seed' } }));
	const eq = vi.fn(() => ({ single }));
	const select = vi.fn(() => ({ eq }));
	const from = vi.fn(() => ({ select }));
	const locals = {
		safeGetSession: vi.fn(async () => ({
			session: { access_token: 'session-token' },
			user: { id: 'user-123456' },
		})),
		supabase: { from },
	};
	const event = { request, url, params, platform: { env: { GAME_WORKER: { fetch } } }, locals };
	return { event, fetch };
}

function forwardedRequest(fetch: ReturnType<typeof createEvent>['fetch']): Request {
	expect(fetch).toHaveBeenCalledTimes(1);
	return fetch.mock.calls[0][0];
}

describe('/ws/lobby proxy', () => {
	it('forwards only the protocol version and the session bearer', async () => {
		const { event, fetch } = createEvent(
			`/ws/lobby?${GAME_PROTOCOL_QUERY_PARAM}=${PROTOCOL}&unexpected=1`,
		);

		await getLobby(event as unknown as Parameters<typeof getLobby>[0]);

		const request = forwardedRequest(fetch);
		const url = new URL(request.url);
		expect(url.pathname).toBe('/lobby');
		expect([...url.searchParams.keys()]).toEqual([GAME_PROTOCOL_QUERY_PARAM]);
		expect(url.searchParams.get(GAME_PROTOCOL_QUERY_PARAM)).toBe(PROTOCOL);
		expect(request.headers.get('Authorization')).toBe('Bearer session-token');
	});

	it('leaves a missing version missing so the Durable Object refuses it', async () => {
		const { event, fetch } = createEvent('/ws/lobby');

		await getLobby(event as unknown as Parameters<typeof getLobby>[0]);

		expect(new URL(forwardedRequest(fetch).url).search).toBe('');
	});
});

describe('/ws/room/[code] proxy', () => {
	it('forwards role and protocol version but no other query parameters', async () => {
		const { event, fetch } = createEvent(
			`/ws/room/abc123?role=spectator&${GAME_PROTOCOL_QUERY_PARAM}=${PROTOCOL}&unexpected=1`,
			{ code: 'abc123' },
		);

		await getRoom(event as unknown as Parameters<typeof getRoom>[0]);

		const request = forwardedRequest(fetch);
		const url = new URL(request.url);
		expect(url.pathname).toBe('/room/ABC123');
		expect(url.searchParams.get('role')).toBe('spectator');
		expect(url.searchParams.get(GAME_PROTOCOL_QUERY_PARAM)).toBe(PROTOCOL);
		expect(url.searchParams.has('unexpected')).toBe(false);
		expect(request.headers.get('Authorization')).toBe('Bearer session-token');
	});
});
