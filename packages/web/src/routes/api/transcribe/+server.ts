/**
 * REST API Proxy: /api/transcribe → GAME_WORKER /api/transcribe
 *
 * Proxies audio transcription requests to the Cloudflare Workers AI endpoint.
 */

import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	const gameWorker = platform?.env?.GAME_WORKER;

	if (!gameWorker) {
		console.error('[api/transcribe] GAME_WORKER service binding not available');
		return new Response(JSON.stringify({ error: 'Service unavailable' }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		});
	}
	const { session } = await locals.safeGetSession();
	if (!session?.access_token) {
		return Response.json({ error: 'Authentication required' }, { status: 401 });
	}
	const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
	if (declaredLength > 7 * 1024 * 1024) {
		return Response.json({ error: 'Request too large' }, { status: 413 });
	}

	try {
		// Get the request body
		// Proxy to GAME_WORKER transcription endpoint
		const response = await gameWorker.fetch(
			new Request('https://internal/api/transcribe', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${session.access_token}`,
				},
				body: request.body,
				// @ts-expect-error - duplex is required for streamed request bodies
				duplex: 'half',
			}),
		);

		// Return the response
		return new Response(response.body, {
			status: response.status,
			headers: {
				'Content-Type': 'application/json',
			},
		});
	} catch {
		console.error('[api/transcribe] Proxy failed');
		return new Response(JSON.stringify({ error: 'Transcription failed' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
