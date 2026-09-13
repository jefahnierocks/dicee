/**
 * Response helpers for the GAME_WORKER service-binding proxy routes
 * (`/ws/lobby`, `/ws/room/[code]`) and for the server hook that decorates
 * responses with security headers.
 *
 * In workerd, a Response returned by a service binding's `fetch()` has
 * immutable headers. SvelteKit appends refreshed Supabase auth cookies and the
 * hook sets security headers after a route returns, so an unwrapped binding
 * response throws `TypeError: Can't modify immutable headers` and the WebSocket
 * upgrade fails. Re-wrapping yields mutable headers while keeping the upgrade's
 * WebSocket attached.
 *
 * This module has no imports so the workerd runtime test can load it verbatim.
 */

/**
 * Workers runtime extension of ResponseInit. The app type-checks against the
 * DOM lib, which does not model a 101 response that carries a WebSocket.
 */
export type ProxyResponseInit = ResponseInit & { webSocket?: unknown };

/** Response constructor; injectable because Node's Response rejects status 101. */
export type ResponseFactory = new (body: BodyInit | null, init?: ProxyResponseInit) => Response;

type ServiceBindingResponse = Response & { webSocket?: unknown };

const SWITCHING_PROTOCOLS = 101;

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()',
	'Cross-Origin-Opener-Policy': 'same-origin',
	'X-Frame-Options': 'DENY',
};

export const STRICT_TRANSPORT_SECURITY = 'max-age=63072000; includeSubDomains';

/**
 * Re-wrap a service-binding response so later header writes succeed.
 *
 * A 101 upgrade is rebuilt around the upstream WebSocket; any other response is
 * copied with its body stream, status, and headers.
 */
export function proxyServiceResponse(
	upstream: Response,
	ResponseImpl: ResponseFactory = Response,
): Response {
	if (upstream.status === SWITCHING_PROTOCOLS) {
		const { webSocket } = upstream as ServiceBindingResponse;
		if (!webSocket) {
			// A 101 without a WebSocket cannot be re-created by the runtime.
			return new ResponseImpl('Bad gateway - upgrade response missing WebSocket', {
				status: 502,
			});
		}
		return new ResponseImpl(null, {
			status: SWITCHING_PROTOCOLS,
			webSocket,
			headers: upstream.headers,
		});
	}

	return new ResponseImpl(upstream.body, upstream);
}

/**
 * Apply security headers to a response without breaking upgrades.
 *
 * 101 responses are returned untouched as defense in depth. If the headers are
 * immutable, the response is re-wrapped first instead of throwing.
 */
export function withSecurityHeaders(
	response: Response,
	options: { https: boolean },
	ResponseImpl: ResponseFactory = Response,
): Response {
	if (response.status === SWITCHING_PROTOCOLS) {
		return response;
	}

	try {
		setSecurityHeaders(response.headers, options.https);
		return response;
	} catch (error) {
		if (!(error instanceof TypeError)) {
			throw error;
		}
		const mutable = proxyServiceResponse(response, ResponseImpl);
		setSecurityHeaders(mutable.headers, options.https);
		return mutable;
	}
}

function setSecurityHeaders(headers: Headers, https: boolean): void {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		headers.set(name, value);
	}
	if (https) {
		headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY);
	}
}
