// @vitest-environment node
/**
 * workerd runtime test for the service-binding proxy helpers.
 *
 * Node cannot represent a 101 Response or workerd's immutable service-binding
 * headers, so this loads the real ws-proxy module into Miniflare. A front
 * Worker proxies through a GAME_WORKER service binding the way the /ws routes
 * and hooks.server.ts do, using the web package's compatibility settings.
 */
import { readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECURITY_HEADERS, STRICT_TRANSPORT_SECURITY } from './ws-proxy';

interface WranglerCompatibility {
	compatibility_date: string;
	compatibility_flags?: string[];
}

const wrangler = ts.parseConfigFileTextToJson(
	'wrangler.jsonc',
	readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8'),
).config as WranglerCompatibility;

const helperModule = ts.transpileModule(
	readFileSync(new URL('./ws-proxy.ts', import.meta.url), 'utf8'),
	{ compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
).outputText;

const GAME_WORKER_SCRIPT = `
export default {
	async fetch(request) {
		if (request.headers.get('Upgrade') === 'websocket') {
			const [client, server] = Object.values(new WebSocketPair());
			server.accept();
			if (request.headers.get('X-Close-Upgrade-Required') === '1') {
				// Mirrors packages/cloudflare-do/src/lib/protocol-gate.ts: close before returning the 101.
				server.close(4426, 'upgrade_required');
				return new Response(null, { status: 101, webSocket: client });
			}
			server.send('hello from GAME_WORKER');
			return new Response(null, {
				status: 101,
				webSocket: client,
				headers: { 'X-Upstream': 'game-worker' },
			});
		}
		return new Response('ok', {
			headers: { 'Content-Type': 'text/plain', 'X-Upstream': 'game-worker' },
		});
	},
};
`;

// mode=probe reports whether binding headers are immutable (the test premise);
// mode=unwrapped simulates a route that forgot to re-wrap, so only the hook's
// immutable-header fallback protects it.
const PAGES_SCRIPT = `
import { proxyServiceResponse, withSecurityHeaders } from './ws-proxy.js';

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const mode = url.searchParams.get('mode');
		const upstream = await env.GAME_WORKER.fetch(
			new Request('https://internal/lobby', { headers: request.headers }),
		);

		if (mode === 'probe') {
			try {
				upstream.headers.set('X-Probe', '1');
				return new Response('mutable');
			} catch {
				return new Response('immutable');
			}
		}

		if (mode === 'unwrapped') {
			return withSecurityHeaders(upstream, { https: url.protocol === 'https:' });
		}

		const response = proxyServiceResponse(upstream);
		// SvelteKit appends refreshed Supabase auth cookies after the route returns.
		response.headers.append('Set-Cookie', 'sb-session=refreshed; Path=/; HttpOnly');
		return withSecurityHeaders(response, { https: url.protocol === 'https:' });
	},
};
`;

describe('ws-proxy in workerd', () => {
	let mf: Miniflare;

	beforeAll(async () => {
		mf = new Miniflare({
			workers: [
				{
					name: 'pages',
					modulesRoot: '/virtual',
					modules: [
						{ type: 'ESModule', path: '/virtual/pages.js', contents: PAGES_SCRIPT },
						{ type: 'ESModule', path: '/virtual/ws-proxy.js', contents: helperModule },
					],
					compatibilityDate: wrangler.compatibility_date,
					compatibilityFlags: wrangler.compatibility_flags,
					serviceBindings: { GAME_WORKER: 'game-worker' },
				},
				{
					name: 'game-worker',
					modules: true,
					script: GAME_WORKER_SCRIPT,
					compatibilityDate: wrangler.compatibility_date,
				},
			],
		});
		await mf.ready;
	}, 60_000);

	afterAll(async () => {
		await mf?.dispose();
	}, 30_000);

	it('receives service-binding responses with immutable headers', async () => {
		const response = await mf.dispatchFetch('http://localhost/ws/lobby?mode=probe');

		expect(await response.text()).toBe('immutable');
	});

	it('proxies a WebSocket upgrade as a 101 with a usable WebSocket', async () => {
		const response = await mf.dispatchFetch('https://localhost/ws/lobby', {
			headers: { Upgrade: 'websocket' },
		});

		expect(response.status).toBe(101);
		const socket = response.webSocket;
		expect(socket).not.toBeNull();
		expect(response.headers.get('X-Content-Type-Options')).toBeNull();

		const message = new Promise<string>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('no WebSocket message')), 5_000);
			socket?.addEventListener('message', (event) => {
				clearTimeout(timer);
				resolve(String(event.data));
			});
		});
		socket?.accept();

		expect(await message).toBe('hello from GAME_WORKER');
		socket?.close();
	});

	it('delivers the 4426 upgrade_required close code through the proxy', async () => {
		const response = await mf.dispatchFetch('https://localhost/ws/lobby', {
			headers: { Upgrade: 'websocket', 'X-Close-Upgrade-Required': '1' },
		});

		expect(response.status).toBe(101);
		const socket = response.webSocket;
		expect(socket).not.toBeNull();

		const closed = new Promise<{ code: number; reason: string }>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('no WebSocket close')), 5_000);
			socket?.addEventListener('close', (event) => {
				clearTimeout(timer);
				resolve({ code: event.code, reason: event.reason });
			});
		});
		socket?.accept();

		expect(await closed).toEqual({ code: 4426, reason: 'upgrade_required' });
	});

	it('adds security headers and cookies to a proxied non-upgrade response', async () => {
		const response = await mf.dispatchFetch('https://localhost/ws/lobby');

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
		expect(response.headers.get('X-Upstream')).toBe('game-worker');
		expect(response.headers.get('Set-Cookie')).toContain('sb-session=refreshed');
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			expect(response.headers.get(name)).toBe(value);
		}
		expect(response.headers.get('Strict-Transport-Security')).toBe(STRICT_TRANSPORT_SECURITY);
	});

	it('does not throw on an unwrapped immutable response in the hook path', async () => {
		const response = await mf.dispatchFetch('http://localhost/ws/lobby?mode=unwrapped');

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('ok');
		expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		expect(response.headers.get('Strict-Transport-Security')).toBeNull();
	});
});
