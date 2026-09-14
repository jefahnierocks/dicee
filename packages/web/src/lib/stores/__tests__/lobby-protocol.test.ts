/**
 * Lobby store protocol handshake: 4426 stops reconnecting and reloads once.
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
import { lobby } from '../lobby.svelte';

class FakeWebSocket {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readonly url: string;
	readyState = FakeWebSocket.CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = FakeWebSocket.CLOSED;
	});

	constructor(url: string) {
		this.url = url;
		FakeWebSocket.instances.push(this);
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.();
	}

	serverClose(code: number, wasClean: boolean): void {
		this.readyState = FakeWebSocket.CLOSED;
		this.onclose?.({ code, reason: '', wasClean });
	}
}

async function connectLobby(): Promise<FakeWebSocket> {
	const connecting = lobby.connect();
	const socket = FakeWebSocket.instances.at(-1);
	if (!socket) throw new Error('lobby did not open a socket');
	socket.open();
	await connecting;
	return socket;
}

describe('lobby store protocol handshake', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('WebSocket', FakeWebSocket);
		FakeWebSocket.instances = [];
		window.sessionStorage.clear();
		protocolUpgrade.status = 'current';
		reload.mockClear();
	});

	afterEach(() => {
		lobby.disconnect();
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('sends the protocol version on the lobby socket', async () => {
		const socket = await connectLobby();

		const url = new URL(socket.url);
		expect(url.pathname).toBe('/ws/lobby');
		expect(url.searchParams.get(GAME_PROTOCOL_QUERY_PARAM)).toBe(String(GAME_PROTOCOL_VERSION));
	});

	it('stops reconnecting and reloads once on 4426', async () => {
		const socket = await connectLobby();

		socket.serverClose(4426, true);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(lobby.connectionState).toBe('disconnected');
		expect(reload).toHaveBeenCalledTimes(1);
		expect(protocolUpgrade.status).toBe('reloading');
	});

	it('does not reload again when a reloaded page is still outdated', async () => {
		window.sessionStorage.setItem(PROTOCOL_RELOAD_STORAGE_KEY, String(Date.now() - 30_000));
		const socket = await connectLobby();

		socket.serverClose(4426, false);
		await vi.advanceTimersByTimeAsync(60_000);

		expect(FakeWebSocket.instances).toHaveLength(1);
		expect(reload).not.toHaveBeenCalled();
		expect(protocolUpgrade.status).toBe('updating');
	});

	it('keeps reconnecting after other abnormal closes', async () => {
		const socket = await connectLobby();

		socket.serverClose(1006, false);
		expect(lobby.connectionState).toBe('reconnecting');
		await vi.advanceTimersByTimeAsync(1_000);

		expect(FakeWebSocket.instances).toHaveLength(2);
		expect(reload).not.toHaveBeenCalled();
		expect(protocolUpgrade.status).toBe('current');
	});
});
