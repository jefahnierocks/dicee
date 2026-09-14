/**
 * Protocol upgrade handling for game WebSockets.
 *
 * Every lobby, room and spectator socket carries GAME_PROTOCOL_VERSION. A
 * Durable Object on another version closes the socket with
 * UPGRADE_REQUIRED_CLOSE_CODE, and the page reloads once to fetch the current
 * app. The Worker deploys before the web app, so a reloaded tab can still be
 * stale for a few minutes: another upgrade close within
 * PROTOCOL_RELOAD_GUARD_MS of the recorded reload shows an "updating" notice
 * with a retry action instead of reloading again.
 */

import {
	GAME_PROTOCOL_QUERY_PARAM,
	GAME_PROTOCOL_VERSION,
	UPGRADE_REQUIRED_CLOSE_CODE,
} from '@dicee/shared';

/** `current`: no action; `reloading`: reload started; `updating`: reload suppressed by the loop guard. */
export type ProtocolUpgradeStatus = 'current' | 'reloading' | 'updating';

export const PROTOCOL_RELOAD_STORAGE_KEY = 'dicee:protocol-reload-at';
export const PROTOCOL_RELOAD_GUARD_MS = 2 * 60 * 1000;

/** Browser seams, injectable for tests. */
export interface ProtocolUpgradeEnvironment {
	reload: () => void;
	getStorage: () => Storage;
	now: () => number;
}

const browserEnvironment: ProtocolUpgradeEnvironment = {
	reload: () => window.location.reload(),
	getStorage: () => window.sessionStorage,
	now: () => Date.now(),
};

/** Append the non-secret protocol version to a same-origin game socket URL. */
export function withProtocolVersion(socketUrl: string): string {
	const separator = socketUrl.includes('?') ? '&' : '?';
	return `${socketUrl}${separator}${GAME_PROTOCOL_QUERY_PARAM}=${GAME_PROTOCOL_VERSION}`;
}

/** True when a socket close means this client speaks an outdated protocol. */
export function isUpgradeRequiredClose(code: number): boolean {
	return code === UPGRADE_REQUIRED_CLOSE_CODE;
}

export class ProtocolUpgradeState {
	status = $state<ProtocolUpgradeStatus>('current');

	#environment: ProtocolUpgradeEnvironment;

	constructor(environment: ProtocolUpgradeEnvironment = browserEnvironment) {
		this.#environment = environment;
	}

	get isRequired(): boolean {
		return this.status !== 'current';
	}

	/** Handle an upgrade-required close: reload once, or show the updating notice. */
	handleUpgradeRequired(): void {
		if (this.status !== 'current') return;

		const lastReloadAt = this.readLastReloadAt();
		if (
			lastReloadAt !== null &&
			this.#environment.now() - lastReloadAt < PROTOCOL_RELOAD_GUARD_MS
		) {
			this.status = 'updating';
			return;
		}

		// Without a recorded reload time the loop guard cannot work, so never auto-reload.
		if (!this.recordReload()) {
			this.status = 'updating';
			return;
		}

		this.status = 'reloading';
		this.#environment.reload();
	}

	/** User-initiated retry from the updating notice. */
	retry(): void {
		this.recordReload();
		this.status = 'reloading';
		this.#environment.reload();
	}

	private readLastReloadAt(): number | null {
		try {
			const raw = this.#environment.getStorage().getItem(PROTOCOL_RELOAD_STORAGE_KEY);
			const value = raw === null ? Number.NaN : Number(raw);
			return Number.isFinite(value) ? value : null;
		} catch {
			return null;
		}
	}

	private recordReload(): boolean {
		try {
			this.#environment
				.getStorage()
				.setItem(PROTOCOL_RELOAD_STORAGE_KEY, String(this.#environment.now()));
			return true;
		} catch {
			return false;
		}
	}
}

/** App-wide singleton shared by the lobby store and the room and spectator services. */
export const protocolUpgrade = new ProtocolUpgradeState();
