/**
 * Debug API Proxy: /_debug/rooms/all → GlobalLobby /_debug/rooms/all
 *
 * DELETE - Clear ALL rooms (nuclear option).
 * Requires admin+ role for access.
 */

import { requireAdminPermission } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ platform, locals }) => {
	const authorization = await requireAdminPermission(locals, 'rooms:clear_all');
	if (authorization instanceof Response) return authorization;

	const gameWorker = platform?.env?.GAME_WORKER;

	if (!gameWorker) {
		console.error('[_debug/rooms/all] GAME_WORKER service binding not available');
		return new Response(JSON.stringify({ error: 'Service unavailable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Proxy to GlobalLobby debug endpoint
	const response = await gameWorker.fetch(
		new Request('https://internal/_debug/rooms/all', {
			method: 'DELETE',
		}),
	);

	return new Response(response.body, {
		status: response.status,
		headers: {
			'Content-Type': 'application/json',
		},
	});
};
