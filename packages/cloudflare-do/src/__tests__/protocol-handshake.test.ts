/**
 * Protocol handshake tests for GameRoom, GlobalLobby and the Worker router.
 *
 * Runs the Durable Object classes in Node with a minimal fake runtime. An
 * outdated client must get a 101 whose socket closes with 4426 before any
 * seat, presence, join or lobby state change.
 */

import {
	GAME_PROTOCOL_QUERY_PARAM,
	GAME_PROTOCOL_VERSION,
	UPGRADE_REQUIRED_CLOSE_CODE,
	UPGRADE_REQUIRED_CLOSE_REASON,
} from '@dicee/shared';
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from 'vitest';
import { verifySupabaseJWT } from '../auth';
import { GameRoom } from '../GameRoom';
import { GlobalLobby } from '../GlobalLobby';
import worker from '../worker';

vi.mock('cloudflare:workers', () => ({
	DurableObject: class {
		protected ctx: unknown;
		protected env: unknown;
		constructor(ctx: unknown, env: unknown) {
			this.ctx = ctx;
			this.env = env;
		}
	},
}));

vi.mock('../auth', () => ({
	verifySupabaseJWT: vi.fn(async () => ({ success: true, claims: { sub: 'player-1' } })),
	extractDisplayName: vi.fn(() => 'Player One'),
	extractAvatarUrl: vi.fn(() => null),
}));

// =============================================================================
// Fake Workers runtime
// =============================================================================

class FakeSocket {
	readonly readyState = 1; // WebSocket.OPEN
	accepted = false;
	closeCode: number | null = null;
	closeReason: string | null = null;
	readonly sent: string[] = [];
	#attachment: unknown = null;

	accept(): void {
		this.accepted = true;
	}
	close(code?: number, reason?: string): void {
		this.closeCode = code ?? null;
		this.closeReason = reason ?? null;
	}
	send(message: string): void {
		this.sent.push(message);
	}
	serializeAttachment(value: unknown): void {
		this.#attachment = value;
	}
	deserializeAttachment(): unknown {
		return this.#attachment;
	}
}

const createdPairs: FakeWebSocketPair[] = [];

class FakeWebSocketPair {
	0 = new FakeSocket();
	1 = new FakeSocket();
	constructor() {
		createdPairs.push(this);
	}
}

class FakeResponse {
	readonly body: unknown;
	readonly status: number;
	readonly webSocket: FakeSocket | null;
	constructor(body: unknown, init: { status?: number; webSocket?: FakeSocket } = {}) {
		this.body = body;
		this.status = init.status ?? 200;
		this.webSocket = init.webSocket ?? null;
	}
}

interface AcceptedSocket {
	ws: FakeSocket;
	tags: string[];
}

function createState(name: string) {
	const accepted: AcceptedSocket[] = [];
	const storage = {
		get: vi.fn(async () => undefined),
		put: vi.fn(async () => undefined),
		delete: vi.fn(async () => false),
		list: vi.fn(async () => new Map<string, unknown>()),
		setAlarm: vi.fn(async () => undefined),
		getAlarm: vi.fn(async () => null),
	};
	const ctx = {
		id: { name },
		storage,
		acceptWebSocket: vi.fn((ws: FakeSocket, tags: string[] = []) => {
			accepted.push({ ws, tags });
		}),
		getWebSockets: vi.fn((tag?: string) =>
			accepted.filter((entry) => tag === undefined || entry.tags.includes(tag)).map((e) => e.ws),
		),
		setWebSocketAutoResponse: vi.fn(),
		blockConcurrencyWhile: vi.fn(async () => undefined),
		waitUntil: vi.fn(),
	};
	return { ctx, storage, accepted };
}

const roomEnv = {
	SUPABASE_URL: 'https://test-project.supabase.co',
	SUPABASE_ANON_KEY: 'test-anon-key',
	GLOBAL_LOBBY: { idFromName: vi.fn(() => 'lobby-id'), get: vi.fn(() => ({})) },
};

function upgradeRequest(path: string, query: string): Request {
	return {
		url: `https://internal${path}${query}`,
		method: 'GET',
		headers: new Headers({
			Upgrade: 'websocket',
			Authorization: 'Bearer test-token',
			'X-User-Id': 'lobby-user',
			'X-Display-Name': 'Lobby User',
		}),
	} as unknown as Request;
}

function socketQuery(role: 'player' | 'spectator', protocol: string | null): string {
	const params = new URLSearchParams();
	if (role === 'spectator') params.set('role', 'spectator');
	if (protocol !== null) params.set(GAME_PROTOCOL_QUERY_PARAM, protocol);
	const query = params.toString();
	return query ? `?${query}` : '';
}

const CURRENT_PROTOCOL = String(GAME_PROTOCOL_VERSION);
const OUTDATED_PROTOCOLS = [
	['missing', null],
	['mismatched', String(GAME_PROTOCOL_VERSION + 1)],
] as const;

function expectUpgradeRequired(response: unknown): void {
	const result = response as FakeResponse;
	expect(result.status).toBe(101);
	expect(createdPairs).toHaveLength(1);
	const [client, server] = [createdPairs[0][0], createdPairs[0][1]];
	expect(result.webSocket).toBe(client);
	expect(server.accepted).toBe(true);
	expect(server.closeCode).toBe(UPGRADE_REQUIRED_CLOSE_CODE);
	expect(server.closeReason).toBe(UPGRADE_REQUIRED_CLOSE_REASON);
	expect(server.sent).toEqual([]);
}

beforeAll(() => {
	vi.stubGlobal('WebSocketPair', FakeWebSocketPair);
	vi.stubGlobal(
		'WebSocketRequestResponsePair',
		class {
			constructor(
				readonly request: string,
				readonly response: string,
			) {}
		},
	);
	vi.stubGlobal('Response', FakeResponse);
	vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

beforeEach(() => {
	createdPairs.length = 0;
	vi.mocked(verifySupabaseJWT).mockClear();
});

// =============================================================================
// Tests
// =============================================================================

describe('@dicee/shared protocol exports', () => {
	it('exports the protocol version and the upgrade-required close contract', () => {
		expect(Number.isInteger(GAME_PROTOCOL_VERSION)).toBe(true);
		expect(GAME_PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
		expect(GAME_PROTOCOL_QUERY_PARAM).toBe('protocol');
		expect(UPGRADE_REQUIRED_CLOSE_CODE).toBe(4426);
		expect(UPGRADE_REQUIRED_CLOSE_REASON).toBe('upgrade_required');
	});
});

describe('GameRoom protocol handshake', () => {
	let onConnect: MockInstance;

	beforeEach(() => {
		onConnect = vi
			.spyOn(GameRoom.prototype as unknown as { onConnect: () => Promise<void> }, 'onConnect')
			.mockResolvedValue(undefined);
	});

	for (const role of ['player', 'spectator'] as const) {
		for (const [label, protocol] of OUTDATED_PROTOCOLS) {
			it(`closes a ${role} socket with a ${label} version before any seat or presence`, async () => {
				const { ctx, storage, accepted } = createState('ABC123');
				const room = new GameRoom(ctx as never, roomEnv as never);

				const response = await room.fetch(
					upgradeRequest('/room/ABC123', socketQuery(role, protocol)),
				);

				expectUpgradeRequired(response);
				expect(ctx.acceptWebSocket).not.toHaveBeenCalled();
				expect(accepted).toHaveLength(0);
				expect(ctx.waitUntil).not.toHaveBeenCalled();
				expect(onConnect).not.toHaveBeenCalled();
				expect(storage.put).not.toHaveBeenCalled();
				expect(verifySupabaseJWT).not.toHaveBeenCalled();
			});
		}

		it(`accepts a ${role} socket with the current version`, async () => {
			const { ctx, accepted } = createState('ABC123');
			const room = new GameRoom(ctx as never, roomEnv as never);

			const response = (await room.fetch(
				upgradeRequest('/room/ABC123', socketQuery(role, CURRENT_PROTOCOL)),
			)) as unknown as FakeResponse;

			expect(response.status).toBe(101);
			expect(accepted).toHaveLength(1);
			expect(accepted[0].tags).toContain(`role:${role}`);
			expect(createdPairs[0][1].closeCode).toBeNull();
			expect(onConnect).toHaveBeenCalledTimes(1);
		});
	}
});

describe('GlobalLobby protocol handshake', () => {
	function createLobbyWithOnlineUser() {
		const state = createState('singleton');
		const existing = new FakeSocket();
		existing.serializeAttachment({
			userId: 'existing-user',
			displayName: 'Existing',
			avatarSeed: 'existing-seed',
			connectedAt: 0,
			lastSeen: 0,
			currentRoomCode: null,
		});
		state.accepted.push({ ws: existing, tags: ['user:existing-user'] });
		const lobby = new GlobalLobby(state.ctx as never, {} as never);
		return { ...state, lobby, existing };
	}

	for (const [label, protocol] of OUTDATED_PROTOCOLS) {
		it(`closes a socket with a ${label} version before any presence change`, async () => {
			const { ctx, storage, lobby, existing } = createLobbyWithOnlineUser();

			const response = await lobby.fetch(upgradeRequest('/lobby', socketQuery('player', protocol)));

			expectUpgradeRequired(response);
			expect(ctx.acceptWebSocket).not.toHaveBeenCalled();
			expect(ctx.getWebSockets()).toEqual([existing]);
			expect(existing.sent).toEqual([]);
			expect(storage.put).not.toHaveBeenCalled();
		});
	}

	it('accepts a socket with the current version and announces presence', async () => {
		const { ctx, lobby, existing } = createLobbyWithOnlineUser();

		const response = (await lobby.fetch(
			upgradeRequest('/lobby', socketQuery('player', CURRENT_PROTOCOL)),
		)) as unknown as FakeResponse;

		expect(response.status).toBe(101);
		const server = createdPairs[0][1];
		expect(ctx.acceptWebSocket).toHaveBeenCalledWith(server, ['user:lobby-user']);
		expect(server.closeCode).toBeNull();
		expect(server.sent.map((message) => JSON.parse(message).type)).toContain('PRESENCE_INIT');
		expect(existing.sent.map((message) => JSON.parse(message).type)).toContain('PRESENCE_JOIN');
	});
});

describe('Worker router', () => {
	it.each([
		['/lobby', 'GLOBAL_LOBBY'],
		['/room/ABC123', 'GAME_ROOM'],
	])('forwards the protocol query on %s to the %s Durable Object', async (path, binding) => {
		const stubFetch = vi.fn(async (_request: Request) => new FakeResponse(null, { status: 101 }));
		const namespace = { idFromName: vi.fn(() => 'id'), get: vi.fn(() => ({ fetch: stubFetch })) };
		const unused = { idFromName: vi.fn(), get: vi.fn() };
		const env = {
			GLOBAL_LOBBY: binding === 'GLOBAL_LOBBY' ? namespace : unused,
			GAME_ROOM: binding === 'GAME_ROOM' ? namespace : unused,
		};

		await worker.fetch(
			upgradeRequest(path, socketQuery('spectator', CURRENT_PROTOCOL)),
			env as never,
		);

		expect(stubFetch).toHaveBeenCalledTimes(1);
		const forwarded = new URL(stubFetch.mock.calls[0][0].url);
		expect(forwarded.searchParams.get(GAME_PROTOCOL_QUERY_PARAM)).toBe(CURRENT_PROTOCOL);
		expect(forwarded.searchParams.get('role')).toBe('spectator');
	});
});
