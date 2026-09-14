/**
 * WebSocket Proxy: /ws/room/[code] → GameRoom Durable Object
 *
 * Proxies WebSocket connections from the Pages frontend to the
 * GameRoom DO via Service Binding. This enables same-origin
 * WebSocket connections without CORS.
 *
 * The Service Binding (GAME_WORKER) provides zero-latency RPC
 * to the dicee Worker.
 *
 * Auth: the same-origin session cookie is validated server-side. Access tokens
 * never appear in the browser URL, proxy URL, or request logs.
 */

import { GAME_PROTOCOL_QUERY_PARAM } from '@dicee/shared';
import { proxyServiceResponse } from '$lib/server/ws-proxy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, params, platform, url, locals }) => {
	const { code } = params;
	const gameWorker = platform?.env?.GAME_WORKER;

	if (!gameWorker) {
		console.error('[ws/room] GAME_WORKER service binding not available');
		return new Response('Service unavailable - GAME_WORKER binding missing', { status: 503 });
	}

	// Validate room code format (6 uppercase alphanumeric)
	if (!code || !/^[A-Z0-9]{6}$/i.test(code)) {
		return new Response('Invalid room code format', { status: 400 });
	}

	const { session, user } = await locals.safeGetSession();
	if (!session?.access_token || !user) {
		return new Response('Authentication required', { status: 401 });
	}

	// Build headers with user info. Strip any client-supplied identity headers
	// first so they can only ever be set server-side from the validated session.
	const headers = new Headers(request.headers);
	headers.delete('X-User-Id');
	headers.delete('X-Display-Name');
	headers.delete('X-Avatar-Seed');
	headers.delete('Authorization');
	headers.set('X-User-Id', user.id);

	// Fetch profile from database for display name (prefer over Google metadata)
	const { data: profile } = await locals.supabase
		.from('profiles')
		.select('display_name, avatar_seed')
		.eq('id', user.id)
		.single();

	// Never infer a public display name from provider identity or email fields.
	const displayName = profile?.display_name || `Player-${user.id.slice(0, 6)}`;
	headers.set('X-Display-Name', displayName);

	// Use profile avatar_seed if available, otherwise user id
	headers.set('X-Avatar-Seed', profile?.avatar_seed || user.id);
	headers.set('Authorization', `Bearer ${session.access_token}`);

	// Proxy to the GameRoom DO via service binding
	const proxyUrl = new URL(`/room/${code.toUpperCase()}`, 'https://internal');

	// Forward role param if present
	const role = url.searchParams.get('role');
	if (role) {
		proxyUrl.searchParams.set('role', role);
	}

	// Forward the non-secret protocol version so the DO can refuse outdated clients
	const protocol = url.searchParams.get(GAME_PROTOCOL_QUERY_PARAM);
	if (protocol) {
		proxyUrl.searchParams.set(GAME_PROTOCOL_QUERY_PARAM, protocol);
	}

	const proxyRequest = new Request(proxyUrl.toString(), {
		method: request.method,
		headers,
		body: request.body,
		// @ts-expect-error - duplex required for streaming bodies
		duplex: 'half',
	});

	// Service-binding responses have immutable headers; re-wrap so SvelteKit
	// cookies and the hook's headers can be applied without breaking the upgrade.
	return proxyServiceResponse(await gameWorker.fetch(proxyRequest));
};
