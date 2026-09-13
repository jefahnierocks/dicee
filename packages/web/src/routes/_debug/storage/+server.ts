/**
 * Debug API Proxy: /_debug/storage → GlobalLobby /_debug/storage
 *
 * Returns storage state from the GlobalLobby DO.
 * Requires admin+ role for access.
 */

import { requireAdminPermission } from '$lib/server/admin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
	const authorization = await requireAdminPermission(locals, 'audit:view');
	if (authorization instanceof Response) return authorization;

	const gameWorker = platform?.env?.GAME_WORKER;

	if (!gameWorker) {
		console.error('[_debug/storage] GAME_WORKER service binding not available');
		return new Response(JSON.stringify({ error: 'Service unavailable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Proxy to GlobalLobby debug endpoint
	const response = await gameWorker.fetch(new Request('https://internal/_debug/storage'));

	return new Response(response.body, {
		status: response.status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
		},
	});
};
