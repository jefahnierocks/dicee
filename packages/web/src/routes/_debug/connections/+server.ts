/**
 * Debug API Proxy: /_debug/connections → GlobalLobby /_debug/connections
 *
 * Returns the list of active WebSocket connections from the GlobalLobby DO.
 * Requires moderator+ role for access.
 */

import { requireAdminPermission } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const authorization = await requireAdminPermission(locals, 'users:view');
	if (authorization instanceof Response) return authorization;

	const gameWorker = platform?.env?.GAME_WORKER;

	if (!gameWorker) {
		console.error('[_debug/connections] GAME_WORKER service binding not available');
		return new Response(JSON.stringify({ error: 'Service unavailable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Proxy to GlobalLobby debug endpoint
	const response = await gameWorker.fetch(new Request('https://internal/_debug/connections'));

	return new Response(response.body, {
		status: response.status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	});
};
