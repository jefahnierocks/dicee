/**
 * Cloudflare Worker Entry Point
 *
 * Routes requests to Durable Objects:
 * - /lobby/* → GlobalLobby (singleton for global chat, presence, room browser)
 * - /room/:code → GameRoom (per-room for game state)
 */

import { handleTranscribe } from './api/transcribe';
import { GameRoom } from './GameRoom';
import { GlobalLobby } from './GlobalLobby';
import type { Env } from './types';

// Export Durable Object classes for Cloudflare
export { GameRoom, GlobalLobby };

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// Root - API info
		if (url.pathname === '/' || url.pathname === '') {
			return Response.json({
				service: 'Game Lobby API',
				version: '2.0.0',
				status: 'running',
				endpoints: {
					health: '/health',
					transcribe: '/api/transcribe - Audio transcription',
					lobby: '/lobby (WebSocket) - Global chat & presence',
					lobbyRooms: '/lobby/rooms (REST) - Public rooms list',
					lobbyOnline: '/lobby/online (REST) - Online count',
					room: '/room/:roomCode (WebSocket) - Game room',
				},
				frontend: 'https://dicee.games',
			});
		}

		// Health check endpoint
		if (url.pathname === '/health') {
			return Response.json({
				status: 'healthy',
				timestamp: new Date().toISOString(),
			});
		}

		// Audio transcription endpoint
		if (url.pathname === '/api/transcribe') {
			return handleTranscribe(request, env);
		}

		// Global Lobby (singleton) - all /lobby and /_debug paths
		if (
			url.pathname === '/lobby' ||
			url.pathname.startsWith('/lobby/') ||
			url.pathname.startsWith('/_debug/')
		) {
			const id = env.GLOBAL_LOBBY.idFromName('singleton');
			const stub = env.GLOBAL_LOBBY.get(id);
			return stub.fetch(request);
		}

		// Room routing: /room/:roomCode
		// Room codes are 6 uppercase alphanumeric characters
		const roomMatch = url.pathname.match(/^\/room\/([A-Z0-9]{6})$/i);
		if (roomMatch) {
			const roomCode = roomMatch[1].toUpperCase();
			const id = env.GAME_ROOM.idFromName(roomCode);
			const stub = env.GAME_ROOM.get(id);
			return stub.fetch(request);
		}

		return new Response('Not Found', { status: 404 });
	},
};
