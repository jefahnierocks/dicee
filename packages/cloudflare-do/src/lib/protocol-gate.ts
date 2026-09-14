/**
 * Protocol version gate for WebSocket upgrades.
 *
 * Durable Objects run this before any seat, presence, join or lobby work. An
 * outdated client gets a 101 whose socket is closed at once with 4426
 * `upgrade_required`: a browser cannot read the HTTP status of a failed
 * upgrade, but it can read a close code. No compatibility shims: current
 * protocol or refresh.
 */

import {
	GAME_PROTOCOL_QUERY_PARAM,
	GAME_PROTOCOL_VERSION,
	UPGRADE_REQUIRED_CLOSE_CODE,
	UPGRADE_REQUIRED_CLOSE_REASON,
} from '@dicee/shared';
import { createLogger } from './logger';

/** True when the upgrade URL carries the protocol version this Worker speaks. */
export function hasCurrentProtocol(url: URL): boolean {
	return url.searchParams.get(GAME_PROTOCOL_QUERY_PARAM) === String(GAME_PROTOCOL_VERSION);
}

/**
 * Accept the upgrade and close it immediately with 4426 `upgrade_required`.
 *
 * Uses the standard `accept()`, not `ctx.acceptWebSocket()`: the socket never
 * joins the hibernation set, so `getWebSockets()` presence and the
 * `webSocketClose` handlers never see it.
 */
export function rejectOutdatedProtocol(url: URL, component: 'GameRoom' | 'GlobalLobby'): Response {
	const { 0: client, 1: server } = new WebSocketPair();
	server.accept();
	server.close(UPGRADE_REQUIRED_CLOSE_CODE, UPGRADE_REQUIRED_CLOSE_REASON);

	createLogger({ component }).info('Closed outdated protocol upgrade', {
		operation: 'protocol_upgrade_required',
		clientProtocol: (url.searchParams.get(GAME_PROTOCOL_QUERY_PARAM) ?? 'missing').slice(0, 16),
		serverProtocol: GAME_PROTOCOL_VERSION,
	});

	return new Response(null, { status: 101, webSocket: client });
}
