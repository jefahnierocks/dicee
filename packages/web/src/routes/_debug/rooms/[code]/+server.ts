/**
 * Debug API Proxy: /_debug/rooms/[code] → GlobalLobby /_debug/rooms/[code]
 *
 * DELETE - Close a specific room by code.
 * Requires moderator+ role for access.
 */

import { requireAdminPermission } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
	const authorization = await requireAdminPermission(locals, 'rooms:close');
	if (authorization instanceof Response) return authorization;

	const gameWorker = platform?.env?.GAME_WORKER;

	if (!gameWorker) {
		console.error('[_debug/rooms/code] GAME_WORKER service binding not available');
		return new Response(JSON.stringify({ error: 'Service unavailable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const roomCode = params.code.toUpperCase();
	if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
		return new Response(JSON.stringify({ error: 'Invalid room code' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Proxy to GlobalLobby debug endpoint
	const response = await gameWorker.fetch(
		new Request(`https://internal/_debug/rooms/${roomCode}`, {
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
