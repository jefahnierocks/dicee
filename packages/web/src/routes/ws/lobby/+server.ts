/**
 * WebSocket Proxy: /ws/lobby → GlobalLobby Durable Object
 *
 * Proxies WebSocket connections from the Pages frontend to the
 * GlobalLobby DO via Service Binding. This enables same-origin
 * WebSocket connections without CORS.
 *
 * The Service Binding (GAME_WORKER) provides zero-latency RPC
 * to the dicee Worker.
 */

import { proxyServiceResponse } from '$lib/server/ws-proxy';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, platform, locals }) => {
	const gameWorker = platform?.env?.GAME_WORKER;

	if (!gameWorker) {
		console.error('[ws/lobby] GAME_WORKER service binding not available');
		return new Response('Service unavailable - GAME_WORKER binding missing', { status: 503 });
	}

	// Build headers with user info from session
	const headers = new Headers(request.headers);

	// Identity headers are server-authoritative. Strip any client-supplied values
	// before deriving identity, so an unauthenticated caller cannot impersonate
	// another user by injecting X-User-Id/X-Display-Name/X-Avatar-Seed/Authorization.
	// (GlobalLobby trusts these headers verbatim.)
	headers.delete('X-User-Id');
	headers.delete('X-Display-Name');
	headers.delete('X-Avatar-Seed');
	headers.delete('Authorization');

	// Get user info from Supabase session
	const { session, user } = await locals.safeGetSession();

	if (user) {
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
	}

	// Add access token if available (for authenticated features)
	if (session?.access_token) {
		headers.set('Authorization', `Bearer ${session.access_token}`);
	}

	// Proxy to the GlobalLobby DO via service binding
	const proxyRequest = new Request(new URL('/lobby', 'https://internal').toString(), {
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
