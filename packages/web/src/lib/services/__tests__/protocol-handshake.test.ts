/**
 * Room and spectator service protocol handshake.
 *
 * Uses the real reconnecting-websocket over a fake browser WebSocket, so "no
 * reconnect" means the library never opens another underlying socket.
 */

import { GAME_PROTOCOL_QUERY_PARAM, GAME_PROTOCOL_VERSION } from '@dicee/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }));

vi.mock('$app/environment', () => ({ browser: true, dev: false }));

vi.mock('$lib/services/protocolUpgrade.svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/services/protocolUpgrade.svelte')>();
	return {
		...actual,
		protocolUpgrade: new actual.ProtocolUpgradeState({
			reload,
			getStorage: () => window.sessionStorage,
			now: () => Date.now(),
		}),
	};
});

import { PROTOCOL_RELOAD_STORAGE_KEY, protocolUpgrade } from '$lib/services/protocolUpgrade.svelte';
import type { RoomCode } from '$lib/types/multiplayer';
import { roomService } from '../roomService.svelte';
import { spectatorService } from '../spectatorService.svelte';

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly url: string;
	readyState = FakeWebSocket.CONNECTING;
	binaryType = 'blob';
	readonly #listeners = new Map<string, Set<(event: unknown) => void>>();
	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = FakeWebSocket.CLOSED;
	});

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const listeners = this.#listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.#listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.#listeners.get(type)?.delete(listener);
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.#dispatch('open', { type: 'open' });
	}

	serverClose(code: number, wasClean: boolean): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.#dispatch('close', { type: 'close', code, reason: '', wasClean });
	}

	#dispatch(type: string, event: unknown): void {
		for (const listener of [...(this.#listeners.get(type) ?? [])]) {
			listener(event);
		}
	}
}

const ROOM_CODE = 'ABC123' as RoomCode;

/** Open the first socket before reconnecting-websocket's 4 s connection timeout. */
async function openFirstSocket(): Promise<FakeWebSocket> {
	await vi.advanceTimersByTimeAsync(10);
	expect(FakeWebSocket.instances).toHaveLength(1);
	const socket = FakeWebSocket.instances[0];
	socket.open();
	return socket;
}

const services = [
	{ name: 'room service', service: roomService, role: null },
	{ name: 'spectator service', service: spectatorService, role: 'spectator' },
] as const;

describe.each(services)('$name protocol handshake', ({ service, role }) => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('WebSocket', FakeWebSocket);
		FakeWebSocket.instances = [];
		window.sessionStorage.clear();
		protocolUpgrade.status = 'current';
		reload.mockClear();
	});

	afterEach(() => {
		service.disconnect();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('sends the protocol version on the room socket', async () => {
		await service.connect(ROOM_CODE, 'unused-token');
		const socket = await openFirstSocket();

		const url = new URL(socket.url);
		expect(url.pathname).toBe('/ws/room/ABC123');
		expect(url.searchParams.get(GAME_PROTOCOL_QUERY_PARAM)).toBe(String(GAME_PROTOCOL_VERSION));
		expect(url.searchParams.get('role')).toBe(role);
		expect(service.status).toBe('connected');
	});

	it('stops reconnecting-websocket and reloads once on 4426', async () => {
		await service.connect(ROOM_CODE, 'unused-token');
		const socket = await openFirstSocket();

		socket.serverClose(4426, true);
		await vi.advanceTimersByTimeAsync(120_000);

		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(service.status).toBe('disconnected');
		expect(reload).toHaveBeenCalledTimes(1);
		expect(protocolUpgrade.status).toBe('reloading');

		service.triggerReconnect();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(FakeWebSocket.instances).toHaveLength(1);
	});

	it('does not reload again when a reloaded page is still outdated', async () => {
		window.sessionStorage.setItem(PROTOCOL_RELOAD_STORAGE_KEY, String(Date.now()));
		await service.connect(ROOM_CODE, 'unused-token');
		const socket = await openFirstSocket();

		socket.serverClose(4426, true);
		await vi.advanceTimersByTimeAsync(120_000);

		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(reload).not.toHaveBeenCalled();
		expect(protocolUpgrade.status).toBe('updating');
	});

	it('keeps reconnecting after other closes', async () => {
		await service.connect(ROOM_CODE, 'unused-token');
		const socket = await openFirstSocket();

		socket.serverClose(1006, false);
		await vi.advanceTimersByTimeAsync(2_000);

		expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
		expect(reload).not.toHaveBeenCalled();
		expect(protocolUpgrade.status).toBe('current');
	});
});
