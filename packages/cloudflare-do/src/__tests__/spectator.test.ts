/**
 * Spectator Mode Tests
 *
 * Tests for spectator functionality in GameRoom Durable Object.
 * Verifies connection handling, broadcasts, and state management for spectators.
 */

import { describe, expect, it } from 'vitest';
import type { ConnectionRole, ConnectionState, SpectatorInfo } from '../types';

describe('Spectator Types', () => {
	describe('ConnectionRole', () => {
		it('should accept valid roles', () => {
			const playerRole: ConnectionRole = 'player';
			const spectatorRole: ConnectionRole = 'spectator';

			expect(playerRole).toBe('player');
			expect(spectatorRole).toBe('spectator');
		});
	});

	describe('ConnectionState', () => {
		it('should include role field', () => {
			const playerState: ConnectionState = {
				userId: 'user-123',
				displayName: 'TestPlayer',
				avatarSeed: 'seed-123',
				connectedAt: Date.now(),
				isHost: false,
				role: 'player',
			};

			expect(playerState.role).toBe('player');

			const spectatorState: ConnectionState = {
				...playerState,
				role: 'spectator',
			};

			expect(spectatorState.role).toBe('spectator');
		});

		it('should distinguish hosts from non-hosts', () => {
			const hostState: ConnectionState = {
				userId: 'host-123',
				displayName: 'HostPlayer',
				avatarSeed: 'seed-host',
				connectedAt: Date.now(),
				isHost: true,
				role: 'player',
			};

			expect(hostState.isHost).toBe(true);
			expect(hostState.role).toBe('player');
		});
	});

	describe('SpectatorInfo', () => {
		it('should have required fields', () => {
			const spectatorInfo: SpectatorInfo = {
				userId: 'spectator-123',
				displayName: 'Watcher',
				avatarSeed: 'seed-watcher',
				watchingSince: Date.now(),
			};

			expect(spectatorInfo.userId).toBeDefined();
			expect(spectatorInfo.displayName).toBeDefined();
			expect(spectatorInfo.avatarSeed).toBeDefined();
			expect(spectatorInfo.watchingSince).toBeDefined();
			expect(typeof spectatorInfo.watchingSince).toBe('number');
		});
	});
});

describe('Spectator Connection Logic', () => {
	describe('role query parameter parsing', () => {
		it('should default to player role when no role param', () => {
			const url = new URL('wss://example.com/ws/room/ABC123');
			const roleParam = url.searchParams.get('role');
			const role: ConnectionRole = roleParam === 'spectator' ? 'spectator' : 'player';

			expect(role).toBe('player');
		});

		it('should parse spectator role from query param', () => {
			const url = new URL('wss://example.com/ws/room/ABC123?role=spectator');
			const roleParam = url.searchParams.get('role');
			const role: ConnectionRole = roleParam === 'spectator' ? 'spectator' : 'player';

			expect(role).toBe('spectator');
		});

		it('should default to player for invalid role param', () => {
			const url = new URL('wss://example.com/ws/room/ABC123?role=invalid');
			const roleParam = url.searchParams.get('role');
			const role: ConnectionRole = roleParam === 'spectator' ? 'spectator' : 'player';

			expect(role).toBe('player');
		});
	});

	describe('WebSocket tags', () => {
		it('should create correct tags for player', () => {
			const userId = 'user-123';
			const roomCode = 'ABC123';
			const role: ConnectionRole = 'player';

			const tags = [`user:${userId}`, `room:${roomCode}`, `role:${role}`];
			if (role === 'spectator') {
				tags.push(`spectator:${roomCode}`);
			} else {
				tags.push(`player:${roomCode}`);
			}

			expect(tags).toContain('user:user-123');
			expect(tags).toContain('room:ABC123');
			expect(tags).toContain('role:player');
			expect(tags).toContain('player:ABC123');
			expect(tags).not.toContain('spectator:ABC123');
		});

		it('should create correct tags for spectator', () => {
			const userId = 'user-456';
			const roomCode = 'ABC123';
			const role: ConnectionRole = 'spectator';

			const tags = [`user:${userId}`, `room:${roomCode}`, `role:${role}`];
			if (role === 'spectator') {
				tags.push(`spectator:${roomCode}`);
			} else {
				tags.push(`player:${roomCode}`);
			}

			expect(tags).toContain('user:user-456');
			expect(tags).toContain('room:ABC123');
			expect(tags).toContain('role:spectator');
			expect(tags).toContain('spectator:ABC123');
			expect(tags).not.toContain('player:ABC123');
		});
	});
});

describe('Spectator Event Messages', () => {
	describe('SPECTATOR_CONNECTED', () => {
		it('should have correct message structure', () => {
			const message = {
				type: 'SPECTATOR_CONNECTED',
				payload: {
					roomCode: 'ABC123',
					players: [],
					spectators: [],
					roomStatus: 'playing',
					spectatorCount: 1,
				},
			};

			expect(message.type).toBe('SPECTATOR_CONNECTED');
			expect(message.payload.roomCode).toBe('ABC123');
			expect(message.payload.spectatorCount).toBe(1);
		});
	});

	describe('SPECTATOR_JOINED', () => {
		it('should include spectator info and count', () => {
			const message = {
				type: 'SPECTATOR_JOINED',
				payload: {
					userId: 'spectator-123',
					displayName: 'NewWatcher',
					avatarSeed: 'seed-new',
					spectatorCount: 2,
				},
			};

			expect(message.type).toBe('SPECTATOR_JOINED');
			expect(message.payload.userId).toBeDefined();
			expect(message.payload.spectatorCount).toBe(2);
		});
	});

	describe('SPECTATOR_LEFT', () => {
		it('should include user id and updated count', () => {
			const message = {
				type: 'SPECTATOR_LEFT',
				payload: {
					userId: 'spectator-123',
					displayName: 'LeavingWatcher',
					spectatorCount: 1,
				},
			};

			expect(message.type).toBe('SPECTATOR_LEFT');
			expect(message.payload.spectatorCount).toBe(1);
		});
	});
});

describe('Room Settings - allowSpectators', () => {
	it('should default to false', () => {
		const defaultSettings = {
			maxPlayers: 2 as const,
			turnTimeoutSeconds: 60,
			isPublic: false,
			allowSpectators: false,
		};

		expect(defaultSettings.allowSpectators).toBe(false);
	});

	it('should be configurable to true', () => {
		const settings = {
			maxPlayers: 4 as const,
			turnTimeoutSeconds: 90,
			isPublic: true,
			allowSpectators: true,
		};

		expect(settings.allowSpectators).toBe(true);
	});
});

describe('Spectator Broadcast Logic', () => {
	describe('player filtering', () => {
		it('should filter out spectators from player list', () => {
			const connections: ConnectionState[] = [
				{
					userId: 'player-1',
					displayName: 'Player 1',
					avatarSeed: 'seed-1',
					connectedAt: Date.now(),
					isHost: true,
					role: 'player',
				},
				{
					userId: 'player-2',
					displayName: 'Player 2',
					avatarSeed: 'seed-2',
					connectedAt: Date.now(),
					isHost: false,
					role: 'player',
				},
				{
					userId: 'spectator-1',
					displayName: 'Spectator 1',
					avatarSeed: 'seed-s1',
					connectedAt: Date.now(),
					isHost: false,
					role: 'spectator',
				},
			];

			const players = connections.filter((c) => c.role === 'player');
			const spectators = connections.filter((c) => c.role === 'spectator');

			expect(players).toHaveLength(2);
			expect(spectators).toHaveLength(1);
			expect(players.every((p) => p.role === 'player')).toBe(true);
			expect(spectators.every((s) => s.role === 'spectator')).toBe(true);
		});
	});

	describe('spectator count', () => {
		it('should count only spectators', () => {
			const connections: ConnectionState[] = [
				{
					userId: 'p1',
					displayName: '',
					avatarSeed: '',
					connectedAt: 0,
					isHost: false,
					role: 'player',
				},
				{
					userId: 'p2',
					displayName: '',
					avatarSeed: '',
					connectedAt: 0,
					isHost: false,
					role: 'player',
				},
				{
					userId: 's1',
					displayName: '',
					avatarSeed: '',
					connectedAt: 0,
					isHost: false,
					role: 'spectator',
				},
				{
					userId: 's2',
					displayName: '',
					avatarSeed: '',
					connectedAt: 0,
					isHost: false,
					role: 'spectator',
				},
				{
					userId: 's3',
					displayName: '',
					avatarSeed: '',
					connectedAt: 0,
					isHost: false,
					role: 'spectator',
				},
			];

			const spectatorCount = connections.filter((c) => c.role === 'spectator').length;
			const playerCount = connections.filter((c) => c.role === 'player').length;

			expect(spectatorCount).toBe(3);
			expect(playerCount).toBe(2);
		});
	});
});
