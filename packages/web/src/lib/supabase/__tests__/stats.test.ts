/**
 * Stats API Unit Tests
 *
 * Tests for stats.ts - Player statistics and game history
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '$lib/types/database';
import {
	calculateDecisionQuality,
	calculateWinRate,
	getGameHistory,
	getPlayerStats,
	type PlayerStats,
} from '../stats';

// =============================================================================
// Mock Data
// =============================================================================

const mockStats: PlayerStats = {
	user_id: 'test-user-id',
	games_played: 10,
	games_won: 4,
	games_completed: 10,
	total_score: 2500,
	best_score: 350,
	avg_score: 250.0,
	dicees_rolled: 3,
	bonus_dicees: 1,
	upper_bonuses: 5,
	category_stats: {},
	optimal_decisions: 80,
	total_decisions: 100,
	avg_ev_loss: 5.25,
	updated_at: '2024-01-01T00:00:00Z',
};

// =============================================================================
// Mock Supabase Client
// =============================================================================

function createMockSupabase() {
	const mockSelect = vi.fn().mockReturnThis();
	const mockEq = vi.fn().mockReturnThis();
	const mockNot = vi.fn().mockReturnThis();
	const mockOrder = vi.fn().mockReturnThis();
	const mockLimit = vi.fn().mockReturnThis();
	const mockSingle = vi.fn();
	const mockUpdate = vi.fn().mockReturnThis();
	const mockInsert = vi.fn().mockReturnThis();
	const mockFrom = vi.fn().mockReturnValue({
		select: mockSelect,
		update: mockUpdate,
		insert: mockInsert,
	});

	return {
		from: mockFrom,
		__mocks: {
			from: mockFrom,
			select: mockSelect,
			eq: mockEq,
			not: mockNot,
			order: mockOrder,
			limit: mockLimit,
			single: mockSingle,
			update: mockUpdate,
			insert: mockInsert,
		},
	} as unknown as SupabaseClient<Database> & {
		__mocks: {
			from: ReturnType<typeof vi.fn>;
			select: ReturnType<typeof vi.fn>;
			eq: ReturnType<typeof vi.fn>;
			not: ReturnType<typeof vi.fn>;
			order: ReturnType<typeof vi.fn>;
			limit: ReturnType<typeof vi.fn>;
			single: ReturnType<typeof vi.fn>;
			update: ReturnType<typeof vi.fn>;
			insert: ReturnType<typeof vi.fn>;
		};
	};
}

// =============================================================================
// getPlayerStats Tests
// =============================================================================

describe('getPlayerStats', () => {
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
	});

	it('fetches player stats successfully', async () => {
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				single: mockSupabase.__mocks.single.mockResolvedValue({
					data: mockStats,
					error: null,
				}),
			}),
		});

		const result = await getPlayerStats(mockSupabase, 'test-user-id');

		expect(result.data).toEqual(mockStats);
		expect(result.error).toBeNull();
		expect(mockSupabase.__mocks.from).toHaveBeenCalledWith('player_stats');
	});

	it('returns null when stats do not exist', async () => {
		const mockError = { message: 'Not found', code: 'PGRST116' };
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				single: mockSupabase.__mocks.single.mockResolvedValue({
					data: null,
					error: mockError,
				}),
			}),
		});

		const result = await getPlayerStats(mockSupabase, 'new-user-id');

		expect(result.data).toBeNull();
		expect(result.error).toBeNull(); // Should not be an error, just no stats yet
	});

	it('handles database errors', async () => {
		const mockError = { message: 'Database error', code: 'ERROR' };
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				single: mockSupabase.__mocks.single.mockResolvedValue({
					data: null,
					error: mockError,
				}),
			}),
		});

		const result = await getPlayerStats(mockSupabase, 'test-user-id');

		expect(result.data).toBeNull();
		expect(result.error).toBeInstanceOf(Error);
	});
});

// =============================================================================
// getGameHistory Tests
// =============================================================================

describe('getGameHistory', () => {
	let mockSupabase: ReturnType<typeof createMockSupabase>;

	beforeEach(() => {
		mockSupabase = createMockSupabase();
	});

	it('fetches game history successfully', async () => {
		const mockData = [
			{
				game_id: 'game-1',
				final_score: 300,
				final_rank: 1,
				games: {
					game_mode: 'multiplayer',
					completed_at: '2024-01-15T12:00:00Z',
					winner_id: 'test-user-id',
				},
			},
			{
				game_id: 'game-2',
				final_score: 250,
				final_rank: 1,
				games: {
					game_mode: 'solo',
					completed_at: '2024-01-14T10:00:00Z',
					winner_id: 'test-user-id',
				},
			},
		];

		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				not: mockSupabase.__mocks.not.mockReturnValue({
					order: mockSupabase.__mocks.order.mockReturnValue({
						limit: mockSupabase.__mocks.limit.mockResolvedValue({
							data: mockData,
							error: null,
						}),
					}),
				}),
			}),
		});

		const result = await getGameHistory(mockSupabase, 'test-user-id', 20);

		expect(result.data).toHaveLength(2);
		expect(result.data?.[0].won).toBe(true);
		expect(result.error).toBeNull();
	});

	it('returns empty array when no games exist', async () => {
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				not: mockSupabase.__mocks.not.mockReturnValue({
					order: mockSupabase.__mocks.order.mockReturnValue({
						limit: mockSupabase.__mocks.limit.mockResolvedValue({
							data: [],
							error: null,
						}),
					}),
				}),
			}),
		});

		const result = await getGameHistory(mockSupabase, 'new-user-id');

		expect(result.data).toEqual([]);
		expect(result.error).toBeNull();
	});

	it('handles database errors', async () => {
		const mockError = { message: 'Database error', code: 'ERROR' };
		mockSupabase.__mocks.select.mockReturnValue({
			eq: mockSupabase.__mocks.eq.mockReturnValue({
				not: mockSupabase.__mocks.not.mockReturnValue({
					order: mockSupabase.__mocks.order.mockReturnValue({
						limit: mockSupabase.__mocks.limit.mockResolvedValue({
							data: null,
							error: mockError,
						}),
					}),
				}),
			}),
		});

		const result = await getGameHistory(mockSupabase, 'test-user-id');

		expect(result.data).toBeNull();
		expect(result.error).toBeInstanceOf(Error);
	});
});

// =============================================================================
// Utility Function Tests
// =============================================================================

describe('calculateWinRate', () => {
	it('calculates win rate correctly', () => {
		expect(calculateWinRate(mockStats)).toBe(40); // 4/10 * 100
	});

	it('returns 0 for no games', () => {
		const noGamesStats = { ...mockStats, games_completed: 0, games_won: 0 };
		expect(calculateWinRate(noGamesStats)).toBe(0);
	});

	it('handles 100% win rate', () => {
		const perfectStats = { ...mockStats, games_completed: 5, games_won: 5 };
		expect(calculateWinRate(perfectStats)).toBe(100);
	});
});

describe('calculateDecisionQuality', () => {
	it('calculates decision quality correctly', () => {
		expect(calculateDecisionQuality(mockStats)).toBe(80); // 80/100 * 100
	});

	it('returns 0 for no decisions', () => {
		const noDecisionsStats = { ...mockStats, total_decisions: 0, optimal_decisions: 0 };
		expect(calculateDecisionQuality(noDecisionsStats)).toBe(0);
	});

	it('handles 100% optimal decisions', () => {
		const perfectStats = { ...mockStats, total_decisions: 50, optimal_decisions: 50 };
		expect(calculateDecisionQuality(perfectStats)).toBe(100);
	});
});
