import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Tables } from '$lib/types/database';

/** Derived projection maintained by the database; clients only read it. */
export type PlayerStats = Tables<'player_stats'>;
export type GamePlayer = Tables<'game_players'>;
export type Game = Tables<'games'>;

/**
 * Game history entry with denormalized data for easy display
 */
export interface GameHistoryEntry {
	game_id: string;
	game_mode: string;
	completed_at: string | null;
	final_score: number | null;
	final_rank: number | null;
	player_count: number;
	won: boolean;
}

/**
 * Get a player's aggregate statistics
 */
export async function getPlayerStats(
	supabase: SupabaseClient<Database>,
	userId: string,
): Promise<{ data: PlayerStats | null; error: Error | null }> {
	const { data, error } = await supabase
		.from('player_stats')
		.select('*')
		.eq('user_id', userId)
		.single();

	if (error) {
		// If stats don't exist yet, return null instead of error
		if (error.code === 'PGRST116') {
			return { data: null, error: null };
		}
		return { data: null, error: new Error(error.message) };
	}

	return { data, error: null };
}

/**
 * Get a player's game history
 * Returns games in reverse chronological order (most recent first)
 */
export async function getGameHistory(
	supabase: SupabaseClient<Database>,
	userId: string,
	limit = 20,
): Promise<{ data: GameHistoryEntry[] | null; error: Error | null }> {
	// Query game_players joined with games to get full history
	const { data, error } = await supabase
		.from('game_players')
		.select(
			`
			game_id,
			final_score,
			final_rank,
			games (
				game_mode,
				completed_at,
				winner_id
			)
		`,
		)
		.eq('user_id', userId)
		.not('games.completed_at', 'is', null)
		.order('games(completed_at)', { ascending: false })
		.limit(limit);

	if (error) {
		return { data: null, error: new Error(error.message) };
	}

	if (!data) {
		return { data: [], error: null };
	}

	// Transform the data into GameHistoryEntry format
	const history: GameHistoryEntry[] = data
		.filter((entry) => entry.games !== null)
		.map((entry) => {
			const game = entry.games as unknown as Game;
			return {
				game_id: entry.game_id,
				game_mode: game.game_mode,
				completed_at: game.completed_at,
				final_score: entry.final_score,
				final_rank: entry.final_rank,
				player_count: 1, // TODO: Could query game_players count if needed
				won: game.winner_id === userId,
			};
		});

	return { data: history, error: null };
}

/**
 * Get detailed game information including all players
 * Useful for showing a game summary with all participants
 */
export async function getGameDetails(
	supabase: SupabaseClient<Database>,
	gameId: string,
): Promise<{
	data: { game: Game; players: (GamePlayer & { profiles: Tables<'profiles'> })[] } | null;
	error: Error | null;
}> {
	// Get game details
	const { data: game, error: gameError } = await supabase
		.from('games')
		.select('*')
		.eq('id', gameId)
		.single();

	if (gameError) {
		return { data: null, error: new Error(gameError.message) };
	}

	// Get all players with their profiles
	const { data: players, error: playersError } = await supabase
		.from('game_players')
		.select(
			`
			*,
			profiles (*)
		`,
		)
		.eq('game_id', gameId)
		.order('final_rank', { ascending: true });

	if (playersError) {
		return { data: null, error: new Error(playersError.message) };
	}

	return {
		data: {
			game,
			players: players as (GamePlayer & { profiles: Tables<'profiles'> })[],
		},
		error: null,
	};
}

/**
 * Calculate win rate from player stats
 */
export function calculateWinRate(stats: PlayerStats): number {
	if (stats.games_completed === 0) {
		return 0;
	}
	return (stats.games_won / stats.games_completed) * 100;
}

/**
 * Calculate decision quality percentage
 */
export function calculateDecisionQuality(stats: PlayerStats): number {
	if (stats.total_decisions === 0) {
		return 0;
	}
	return (stats.optimal_decisions / stats.total_decisions) * 100;
}

// =============================================================================
// Enhanced Stats API (C4)
// =============================================================================

/**
 * Detailed analysis of a completed game
 */
export interface GameAnalysis {
	gameId: string;
	players: GamePlayerAnalysis[];
	summary: {
		averageEfficiency: number;
		bestDecision: {
			playerId: string;
			turn: number;
			category: string;
			evGain: number;
		} | null;
		worstDecision: {
			playerId: string;
			turn: number;
			category: string;
			evLoss: number;
		} | null;
	};
}

export interface GamePlayerAnalysis {
	userId: string;
	displayName: string;
	finalScore: number;
	finalRank: number;
	efficiency: number;
	optimalDecisions: number;
	totalDecisions: number;
	totalEvLoss: number;
	decisions: TurnDecision[];
}

export interface TurnDecision {
	turn: number;
	category: string;
	score: number;
	optimalCategory: string;
	optimalScore: number;
	evDifference: number;
	wasOptimal: boolean;
}

/**
 * Get detailed game analysis with decision-by-decision review
 */
export async function getGameAnalysis(
	supabase: SupabaseClient<Database>,
	gameId: string,
): Promise<{ data: GameAnalysis | null; error: Error | null }> {
	// Get game players with profiles
	const { data: players, error: playersError } = await supabase
		.from('game_players')
		.select(
			`
			user_id,
			final_score,
			final_rank,
			scorecard,
			profiles (display_name)
		`,
		)
		.eq('game_id', gameId)
		.order('final_rank');

	if (playersError) {
		return { data: null, error: new Error(playersError.message) };
	}

	if (!players || players.length === 0) {
		return { data: null, error: new Error('Game not found') };
	}

	// Get domain events for decision analysis
	const { data: events, error: eventsError } = await supabase
		.from('domain_events')
		.select('event_type, player_id, turn_number, payload')
		.eq('game_id', gameId)
		.eq('event_type', 'TurnScored')
		.order('turn_number');

	if (eventsError) {
		return { data: null, error: new Error(eventsError.message) };
	}

	// Build player analysis
	const playerAnalyses: GamePlayerAnalysis[] = [];
	let bestDecision: GameAnalysis['summary']['bestDecision'] = null;
	let worstDecision: GameAnalysis['summary']['worstDecision'] = null;

	for (const player of players) {
		// AI seats have no profile and no decision events.
		const userId = player.user_id;
		if (!userId) continue;
		const playerEvents = events?.filter((e) => e.player_id === userId) ?? [];
		const decisions: TurnDecision[] = [];
		let optimalCount = 0;
		let totalEvLoss = 0;

		for (const event of playerEvents) {
			const payload = event.payload as {
				category?: string;
				score?: number;
				optimal_category?: string;
				optimal_score?: number;
				ev_difference?: number;
				was_optimal?: boolean;
			};

			const decision: TurnDecision = {
				turn: event.turn_number ?? 0,
				category: payload.category ?? '',
				score: payload.score ?? 0,
				optimalCategory: payload.optimal_category ?? payload.category ?? '',
				optimalScore: payload.optimal_score ?? payload.score ?? 0,
				evDifference: payload.ev_difference ?? 0,
				wasOptimal: payload.was_optimal ?? false,
			};

			decisions.push(decision);

			if (decision.wasOptimal) {
				optimalCount++;
			}

			const evLoss = Math.max(0, decision.evDifference);
			totalEvLoss += evLoss;

			// Track best/worst decisions
			if (decision.evDifference < 0) {
				// Positive EV gain (did better than expected)
				const evGain = Math.abs(decision.evDifference);
				if (!bestDecision || evGain > bestDecision.evGain) {
					bestDecision = {
						playerId: userId,
						turn: decision.turn,
						category: decision.category,
						evGain,
					};
				}
			} else if (decision.evDifference > 0) {
				// EV loss
				if (!worstDecision || decision.evDifference > worstDecision.evLoss) {
					worstDecision = {
						playerId: userId,
						turn: decision.turn,
						category: decision.category,
						evLoss: decision.evDifference,
					};
				}
			}
		}

		const totalDecisions = decisions.length;
		const efficiency = totalDecisions > 0 ? (optimalCount / totalDecisions) * 100 : 0;

		const profileData = player.profiles as { display_name: string } | null;

		playerAnalyses.push({
			userId,
			displayName: profileData?.display_name ?? 'Unknown',
			finalScore: player.final_score ?? 0,
			finalRank: player.final_rank ?? 0,
			efficiency,
			optimalDecisions: optimalCount,
			totalDecisions,
			totalEvLoss,
			decisions,
		});
	}

	const averageEfficiency =
		playerAnalyses.length > 0
			? playerAnalyses.reduce((sum, p) => sum + p.efficiency, 0) / playerAnalyses.length
			: 0;

	return {
		data: {
			gameId,
			players: playerAnalyses,
			summary: {
				averageEfficiency,
				bestDecision,
				worstDecision,
			},
		},
		error: null,
	};
}

/**
 * Category mastery breakdown
 */
export interface CategoryMastery {
	category: string;
	timesScored: number;
	totalScore: number;
	avgScore: number;
	maxPossible: number;
	masteryPercent: number;
}

/**
 * Get category mastery breakdown for a player
 */
export async function getCategoryMastery(
	supabase: SupabaseClient<Database>,
	userId: string,
): Promise<{ data: CategoryMastery[] | null; error: Error | null }> {
	const { data: stats, error } = await getPlayerStats(supabase, userId);

	if (error) {
		return { data: null, error };
	}

	if (!stats || !stats.category_stats) {
		return { data: [], error: null };
	}

	// Max possible scores for each category
	const maxScores: Record<string, number> = {
		Ones: 5,
		Twos: 10,
		Threes: 15,
		Fours: 20,
		Fives: 25,
		Sixes: 30,
		ThreeOfAKind: 30,
		FourOfAKind: 30,
		FullHouse: 25,
		SmallStraight: 30,
		LargeStraight: 40,
		Dicee: 50,
		Chance: 30,
	};

	const categoryStats = stats.category_stats as Record<
		string,
		{ times_scored: number; total_score: number; avg_score: number }
	>;

	const mastery: CategoryMastery[] = Object.entries(categoryStats).map(([category, data]) => {
		const maxPossible = maxScores[category] ?? 30;
		return {
			category,
			timesScored: data.times_scored,
			totalScore: data.total_score,
			avgScore: data.avg_score,
			maxPossible,
			masteryPercent: (data.avg_score / maxPossible) * 100,
		};
	});

	// Sort by mastery percent descending
	mastery.sort((a, b) => b.masteryPercent - a.masteryPercent);

	return { data: mastery, error: null };
}

/**
 * Efficiency data point for trend tracking
 */
export interface EfficiencyPoint {
	gameId: string;
	completedAt: string;
	efficiency: number;
	score: number;
	evLoss: number;
}

/**
 * Get efficiency trend for last N games
 */
export async function getEfficiencyTrend(
	supabase: SupabaseClient<Database>,
	userId: string,
	limit = 20,
): Promise<{ data: EfficiencyPoint[] | null; error: Error | null }> {
	// Get recent completed games
	const { data: gameRecords, error: gamesError } = await supabase
		.from('game_players')
		.select(
			`
			game_id,
			final_score,
			games (completed_at)
		`,
		)
		.eq('user_id', userId)
		.not('games.completed_at', 'is', null)
		.order('games(completed_at)', { ascending: false })
		.limit(limit);

	if (gamesError) {
		return { data: null, error: new Error(gamesError.message) };
	}

	if (!gameRecords || gameRecords.length === 0) {
		return { data: [], error: null };
	}

	// Get domain events for efficiency calculation
	const gameIds = gameRecords.map((g) => g.game_id);
	const { data: events, error: eventsError } = await supabase
		.from('domain_events')
		.select('game_id, player_id, payload')
		.eq('player_id', userId)
		.eq('event_type', 'TurnScored')
		.in('game_id', gameIds);

	if (eventsError) {
		return { data: null, error: new Error(eventsError.message) };
	}

	// Group events by game
	const eventsByGame = new Map<string, typeof events>();
	for (const event of events ?? []) {
		const gameEvents = eventsByGame.get(event.game_id) ?? [];
		gameEvents.push(event);
		eventsByGame.set(event.game_id, gameEvents);
	}

	// Calculate efficiency for each game
	const trend: EfficiencyPoint[] = gameRecords
		.filter((g) => g.games !== null)
		.map((record) => {
			const gameEvents = eventsByGame.get(record.game_id) ?? [];
			let optimal = 0;
			let total = 0;
			let evLoss = 0;

			for (const event of gameEvents) {
				const payload = event.payload as { was_optimal?: boolean; ev_difference?: number };
				total++;
				if (payload.was_optimal) {
					optimal++;
				}
				evLoss += Math.max(0, payload.ev_difference ?? 0);
			}

			const gameData = record.games as { completed_at: string } | null;

			return {
				gameId: record.game_id,
				completedAt: gameData?.completed_at ?? '',
				efficiency: total > 0 ? (optimal / total) * 100 : 0,
				score: record.final_score ?? 0,
				evLoss,
			};
		})
		.reverse(); // Chronological order (oldest first)

	return { data: trend, error: null };
}
