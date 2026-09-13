// @vitest-environment node
/**
 * Node unit tests for the service-binding proxy helpers.
 *
 * Node's Response rejects status 101, so upgrade paths use an injected
 * recording factory. Response.redirect() provides real immutable headers.
 * The workerd behavior is covered by ws-proxy.runtime.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
	type ProxyResponseInit,
	proxyServiceResponse,
	type ResponseFactory,
	SECURITY_HEADERS,
	STRICT_TRANSPORT_SECURITY,
	withSecurityHeaders,
} from './ws-proxy';

interface FactoryCall {
	body: BodyInit | null;
	init: ProxyResponseInit;
}

function recordingFactory(): { calls: FactoryCall[]; Factory: ResponseFactory } {
	const calls: FactoryCall[] = [];
	class RecordingResponse {
		readonly body: BodyInit | null;
		readonly status: number;
		readonly headers: Headers;
		readonly webSocket: unknown;

		constructor(body: BodyInit | null, init: ProxyResponseInit = {}) {
			calls.push({ body, init });
			this.body = body;
			this.status = init.status ?? 200;
			this.headers = new Headers(init.headers);
			this.webSocket = init.webSocket ?? null;
		}
	}
	return { calls, Factory: RecordingResponse as unknown as ResponseFactory };
}

function upgradeResponse(webSocket: unknown): Response {
	return {
		status: 101,
		body: null,
		headers: new Headers({ 'X-Upstream': 'game-worker' }),
		webSocket,
	} as unknown as Response;
}

function immutableRedirect(): Response {
	const response = Response.redirect('https://dicee.test/lobby', 302);
	expect(() => response.headers.set('X-Probe', '1')).toThrow(TypeError);
	return response;
}

describe('proxyServiceResponse', () => {
	it('rebuilds a 101 upgrade around the upstream WebSocket and headers', () => {
		const { calls, Factory } = recordingFactory();
		const socket = { kind: 'client-socket' };
		const upstream = upgradeResponse(socket);

		const result = proxyServiceResponse(upstream, Factory) as Response & { webSocket: unknown };

		expect(calls).toHaveLength(1);
		expect(calls[0].body).toBeNull();
		expect(calls[0].init.status).toBe(101);
		expect(calls[0].init.webSocket).toBe(socket);
		expect(calls[0].init.headers).toBe(upstream.headers);
		expect(result.status).toBe(101);
		expect(result.webSocket).toBe(socket);
		expect(result.headers.get('X-Upstream')).toBe('game-worker');
	});

	it('returns 502 for a 101 response without a WebSocket', () => {
		const { calls, Factory } = recordingFactory();

		const result = proxyServiceResponse(upgradeResponse(null), Factory);

		expect(result.status).toBe(502);
		expect(calls[0].init.webSocket).toBeUndefined();
	});

	it('copies a non-upgrade response into one with mutable headers', () => {
		const upstream = immutableRedirect();

		const result = proxyServiceResponse(upstream);

		expect(result).not.toBe(upstream);
		expect(result.status).toBe(302);
		expect(result.headers.get('Location')).toBe('https://dicee.test/lobby');
		result.headers.append('Set-Cookie', 'sb-session=refreshed; Path=/');
		expect(result.headers.get('Set-Cookie')).toContain('sb-session=refreshed');
		expect(upstream.headers.get('Set-Cookie')).toBeNull();
	});

	it('preserves body, status, statusText, and headers', async () => {
		const upstream = new Response('room not found', {
			status: 404,
			statusText: 'Not Found',
			headers: { 'Content-Type': 'text/plain' },
		});

		const result = proxyServiceResponse(upstream);

		expect(result.status).toBe(404);
		expect(result.statusText).toBe('Not Found');
		expect(result.headers.get('Content-Type')).toBe('text/plain');
		expect(await result.text()).toBe('room not found');
	});
});

describe('withSecurityHeaders', () => {
	it('sets security headers on a mutable response in place', () => {
		const response = new Response('ok');

		const result = withSecurityHeaders(response, { https: false });

		expect(result).toBe(response);
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(result.headers.get(name)).toBe(value);
		}
		expect(result.headers.get('Strict-Transport-Security')).toBeNull();
	});

	it('adds HSTS only for https requests', () => {
		const result = withSecurityHeaders(new Response('ok'), { https: true });

		expect(result.headers.get('Strict-Transport-Security')).toBe(STRICT_TRANSPORT_SECURITY);
	});

	it('leaves 101 upgrade responses untouched', () => {
		const { calls, Factory } = recordingFactory();
		const upstream = upgradeResponse({ kind: 'client-socket' });

		const result = withSecurityHeaders(upstream, { https: true }, Factory);

		expect(result).toBe(upstream);
		expect(calls).toHaveLength(0);
		expect(result.headers.get('X-Content-Type-Options')).toBeNull();
	});

	it('re-wraps instead of throwing when headers are immutable', () => {
		const upstream = immutableRedirect();

		const result = withSecurityHeaders(upstream, { https: true });

		expect(result).not.toBe(upstream);
		expect(result.status).toBe(302);
		expect(result.headers.get('Location')).toBe('https://dicee.test/lobby');
		expect(result.headers.get('X-Frame-Options')).toBe('DENY');
		expect(result.headers.get('Strict-Transport-Security')).toBe(STRICT_TRANSPORT_SECURITY);
	});

	it('rethrows errors other than immutable-header TypeErrors', () => {
		const headers = new Headers();
		headers.set = () => {
			throw new Error('unexpected failure');
		};
		const response = { status: 200, headers } as unknown as Response;

		expect(() => withSecurityHeaders(response, { https: false })).toThrow('unexpected failure');
	});
});
