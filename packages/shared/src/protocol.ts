/**
 * Client/server protocol version handshake.
 *
 * Every lobby, room and spectator WebSocket sends GAME_PROTOCOL_VERSION as the
 * `protocol` query parameter. A Durable Object that speaks a different version
 * accepts the upgrade and closes it at once with UPGRADE_REQUIRED_CLOSE_CODE,
 * because a browser cannot read the HTTP status of a failed upgrade. The client
 * then reloads to fetch the current app. Policy: current protocol or refresh.
 */

/**
 * Bump whenever the lobby/room WebSocket message contract changes incompatibly.
 * Deploy the Worker first, then the web app.
 */
export const GAME_PROTOCOL_VERSION = 1;

/** Query parameter that carries the protocol version on WebSocket upgrades. */
export const GAME_PROTOCOL_QUERY_PARAM = 'protocol';

/** Application close code for an outdated client (4000-4999 is application-defined). */
export const UPGRADE_REQUIRED_CLOSE_CODE = 4426;

/** Close reason sent with UPGRADE_REQUIRED_CLOSE_CODE. */
export const UPGRADE_REQUIRED_CLOSE_REASON = 'upgrade_required';
