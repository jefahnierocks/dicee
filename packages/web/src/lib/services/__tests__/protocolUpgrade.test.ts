/**
 * Protocol upgrade guard tests: reload once, never loop.
 */

import { GAME_PROTOCOL_VERSION, UPGRADE_REQUIRED_CLOSE_CODE } from '@dicee/shared';
import { describe, expect, it, vi } from 'vitest';
import {
	isUpgradeRequiredClose,
	PROTOCOL_RELOAD_GUARD_MS,
	PROTOCOL_RELOAD_STORAGE_KEY,
	type ProtocolUpgradeEnvironment,
	ProtocolUpgradeState,
	withProtocolVersion,
} from '../protocolUpgrade.svelte';

function createStorage(): Storage {
	const values = new Map<string, string>();
	return {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
		clear: () => values.clear(),
		key: () => null,
		get length() {
			return values.size;
		},
	};
}

function createEnvironment(storage: Storage = createStorage()) {
	let now = 1_000_000;
	const environment = {
		reload: vi.fn(),
		getStorage: () => storage,
		now: () => now,
	} satisfies ProtocolUpgradeEnvironment;
	return {
		environment,
		storage,
		advance: (ms: number) => {
			now += ms;
		},
	};
}

describe('withProtocolVersion', () => {
	it('adds the protocol version to socket URLs with and without a query', () => {
		expect(withProtocolVersion('wss://dicee.games/ws/lobby')).toBe(
			`wss://dicee.games/ws/lobby?protocol=${GAME_PROTOCOL_VERSION}`,
		);
		expect(withProtocolVersion('wss://dicee.games/ws/room/ABC123?role=spectator')).toBe(
			`wss://dicee.games/ws/room/ABC123?role=spectator&protocol=${GAME_PROTOCOL_VERSION}`,
		);
	});
});

describe('isUpgradeRequiredClose', () => {
	it('matches only the upgrade-required close code', () => {
		expect(isUpgradeRequiredClose(UPGRADE_REQUIRED_CLOSE_CODE)).toBe(true);
		expect(isUpgradeRequiredClose(1006)).toBe(false);
		expect(isUpgradeRequiredClose(4004)).toBe(false);
	});
});

describe('ProtocolUpgradeState', () => {
	it('reloads once and records the reload time', () => {
		const { environment, storage } = createEnvironment();
		const upgrade = new ProtocolUpgradeState(environment);

		upgrade.handleUpgradeRequired();
		upgrade.handleUpgradeRequired();

		expect(environment.reload).toHaveBeenCalledTimes(1);
		expect(upgrade.status).toBe('reloading');
		expect(storage.getItem(PROTOCOL_RELOAD_STORAGE_KEY)).toBe('1000000');
	});

	it('shows the updating notice instead of reloading again within the guard window', () => {
		const { environment, storage, advance } = createEnvironment();
		new ProtocolUpgradeState(environment).handleUpgradeRequired();

		// The reloaded page is a fresh state sharing the same sessionStorage.
		advance(PROTOCOL_RELOAD_GUARD_MS - 1);
		const reloadedPage = new ProtocolUpgradeState({ ...environment, getStorage: () => storage });
		reloadedPage.handleUpgradeRequired();

		expect(environment.reload).toHaveBeenCalledTimes(1);
		expect(reloadedPage.status).toBe('updating');
		expect(reloadedPage.isRequired).toBe(true);
	});

	it('reloads again once the guard window has passed', () => {
		const { environment, advance } = createEnvironment();
		new ProtocolUpgradeState(environment).handleUpgradeRequired();

		advance(PROTOCOL_RELOAD_GUARD_MS);
		const laterPage = new ProtocolUpgradeState(environment);
		laterPage.handleUpgradeRequired();

		expect(environment.reload).toHaveBeenCalledTimes(2);
		expect(laterPage.status).toBe('reloading');
	});

	it('does not auto-reload when sessionStorage is unavailable', () => {
		const throwingStorage = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			},
		} as unknown as Storage;
		const { environment } = createEnvironment(throwingStorage);
		const upgrade = new ProtocolUpgradeState(environment);

		upgrade.handleUpgradeRequired();

		expect(environment.reload).not.toHaveBeenCalled();
		expect(upgrade.status).toBe('updating');
	});

	it('retries with a recorded reload', () => {
		const { environment, storage, advance } = createEnvironment();
		new ProtocolUpgradeState(environment).handleUpgradeRequired();
		advance(1_000);
		const reloadedPage = new ProtocolUpgradeState(environment);
		reloadedPage.handleUpgradeRequired();

		advance(60_000);
		reloadedPage.retry();

		expect(environment.reload).toHaveBeenCalledTimes(2);
		expect(reloadedPage.status).toBe('reloading');
		expect(storage.getItem(PROTOCOL_RELOAD_STORAGE_KEY)).toBe('1061000');
	});
});
