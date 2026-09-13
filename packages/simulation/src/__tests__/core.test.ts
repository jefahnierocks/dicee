/**
 * Core Simulation Engine Tests
 *
 * Tests for SeededRandom, seeded dice, brain adapter, and game simulator.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type {
	DiceArray,
	KeptMask,
	SimulationBrain,
	SimulationConfig,
	SimulationContext,
	SimulationDecision,
	SimulationProfile,
} from '../index.js';
import {
	BrainRngAdapter,
	countDice,
	createRandom,
	executeTurnRolls,
	GameSimulator,
	hasFullHouse,
	hasLargeStraight,
	hasNOfAKind,
	hasSmallStraight,
	indicesToMask,
	isDicee,
	KEEP_ALL,
	KEEP_NONE,
	MathRandomOverride,
	maskToIndices,
	rerollDice,
	rollDice,
	rollDie,
	runSingleGame,
	SeededRandom,
	sortDice,
	sumDice,
	sumMatching,
	withDeterministicRandom,
	withDeterministicRandomAsync,
} from '../index.js';

// =============================================================================
// Test Helpers
// =============================================================================

/** Create a valid simulation config for testing */
function testConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
	return {
		players: [{ id: 'p1', profileId: 'custom' }],
		captureDecisions: false,
		captureIntermediateStates: false,
		...overrides,
	};
}

// =============================================================================
// SeededRandom Tests
// =============================================================================

describe('SeededRandom', () => {
	describe('determinism', () => {
		it('produces same sequence for same seed', () => {
			const rng1 = new SeededRandom(12345);
			const rng2 = new SeededRandom(12345);

			const seq1 = Array.from({ length: 100 }, () => rng1.random());
			const seq2 = Array.from({ length: 100 }, () => rng2.random());

			expect(seq1).toEqual(seq2);
		});

		it('produces different sequences for different seeds', () => {
			const rng1 = new SeededRandom(12345);
			const rng2 = new SeededRandom(54321);

			const seq1 = Array.from({ length: 10 }, () => rng1.random());
			const seq2 = Array.from({ length: 10 }, () => rng2.random());

			expect(seq1).not.toEqual(seq2);
		});
	});

	describe('random()', () => {
		it('returns values in [0, 1)', () => {
			const rng = new SeededRandom(42);
			for (let i = 0; i < 1000; i++) {
				const value = rng.random();
				expect(value).toBeGreaterThanOrEqual(0);
				expect(value).toBeLessThan(1);
			}
		});
	});

	describe('randomInt()', () => {
		it('returns values within specified range inclusive', () => {
			const rng = new SeededRandom(42);
			for (let i = 0; i < 1000; i++) {
				const value = rng.randomInt(1, 6);
				expect(value).toBeGreaterThanOrEqual(1);
				expect(value).toBeLessThanOrEqual(6);
			}
		});

		it('covers all values in range', () => {
			const rng = new SeededRandom(42);
			const seen = new Set<number>();
			for (let i = 0; i < 1000; i++) {
				seen.add(rng.randomInt(1, 6));
			}
			expect(seen.size).toBe(6);
		});
	});

	describe('randomChoice()', () => {
		it('returns element from array', () => {
			const rng = new SeededRandom(42);
			const items = ['a', 'b', 'c', 'd'];
			for (let i = 0; i < 100; i++) {
				const choice = rng.randomChoice(items);
				expect(items).toContain(choice);
			}
		});

		it('throws on empty array', () => {
			const rng = new SeededRandom(42);
			expect(() => rng.randomChoice([])).toThrow('Cannot choose from empty array');
		});
	});

	describe('shuffle()', () => {
		it('preserves array length', () => {
			const rng = new SeededRandom(42);
			const arr = [1, 2, 3, 4, 5];
			rng.shuffle(arr);
			expect(arr).toHaveLength(5);
		});

		it('preserves array elements', () => {
			const rng = new SeededRandom(42);
			const arr = [1, 2, 3, 4, 5];
			rng.shuffle(arr);
			expect(arr.sort()).toEqual([1, 2, 3, 4, 5]);
		});

		it('is deterministic with same seed', () => {
			const rng1 = new SeededRandom(42);
			const rng2 = new SeededRandom(42);
			const arr1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
			const arr2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
			rng1.shuffle(arr1);
			rng2.shuffle(arr2);
			expect(arr1).toEqual(arr2);
		});
	});

	describe('randomChance()', () => {
		it('returns false for probability 0', () => {
			const rng = new SeededRandom(42);
			for (let i = 0; i < 100; i++) {
				expect(rng.randomChance(0)).toBe(false);
			}
		});

		it('returns true for probability 1', () => {
			const rng = new SeededRandom(42);
			for (let i = 0; i < 100; i++) {
				expect(rng.randomChance(1)).toBe(true);
			}
		});
	});

	describe('fork()', () => {
		it('creates independent stream', () => {
			const rng = new SeededRandom(42);
			const forked = rng.fork('test');

			// Forked stream should be independent - advancing it doesn't affect parent
			const forkedVal1 = forked.random();
			const forkedVal2 = forked.random();
			const parentVal1 = rng.random();

			// Create fresh forked stream and verify it matches
			const rng2 = new SeededRandom(42);
			const forked2 = rng2.fork('test');

			expect(forked2.random()).toBe(forkedVal1);
			expect(forked2.random()).toBe(forkedVal2);
			expect(rng2.random()).toBe(parentVal1);
		});

		it('is deterministic with same salt', () => {
			const rng1 = new SeededRandom(42);
			const rng2 = new SeededRandom(42);

			const forked1 = rng1.fork('player-1');
			const forked2 = rng2.fork('player-1');

			const seq1 = Array.from({ length: 10 }, () => forked1.random());
			const seq2 = Array.from({ length: 10 }, () => forked2.random());

			expect(seq1).toEqual(seq2);
		});

		it('different salts produce different streams', () => {
			const rng = new SeededRandom(42);
			const forked1 = rng.fork('player-1');
			const forked2 = rng.fork('player-2');

			const seq1 = Array.from({ length: 10 }, () => forked1.random());
			const seq2 = Array.from({ length: 10 }, () => forked2.random());

			expect(seq1).not.toEqual(seq2);
		});
	});

	describe('getSeed()', () => {
		it('returns the original seed', () => {
			const rng = new SeededRandom(12345);
			expect(rng.getSeed()).toBe(12345);

			// Seed remains constant after operations
			rng.random();
			rng.randomInt(1, 10);
			expect(rng.getSeed()).toBe(12345);
		});
	});

	describe('createRandom()', () => {
		it('creates SeededRandom with explicit seed', () => {
			const rng = createRandom(42);
			expect(rng.getSeed()).toBe(42);
		});

		it('creates SeededRandom with random seed when none provided', () => {
			const rng1 = createRandom();
			const rng2 = createRandom();
			// Very unlikely to be equal with random seeds
			expect(rng1.getSeed()).not.toBe(rng2.getSeed());
		});
	});
});

// =============================================================================
// Seeded Dice Tests
// =============================================================================

describe('Seeded Dice', () => {
	let rng: SeededRandom;

	beforeEach(() => {
		rng = new SeededRandom(42);
	});

	describe('rollDie()', () => {
		it('returns values 1-6', () => {
			for (let i = 0; i < 100; i++) {
				const value = rollDie(rng);
				expect(value).toBeGreaterThanOrEqual(1);
				expect(value).toBeLessThanOrEqual(6);
			}
		});
	});

	describe('rollDice()', () => {
		it('returns 5 dice', () => {
			const dice = rollDice(rng);
			expect(dice).toHaveLength(5);
		});

		it('all values are 1-6', () => {
			const dice = rollDice(rng);
			for (const d of dice) {
				expect(d).toBeGreaterThanOrEqual(1);
				expect(d).toBeLessThanOrEqual(6);
			}
		});

		it('is deterministic', () => {
			const rng1 = new SeededRandom(42);
			const rng2 = new SeededRandom(42);
			expect(rollDice(rng1)).toEqual(rollDice(rng2));
		});
	});

	describe('rerollDice()', () => {
		it('keeps dice where mask is true', () => {
			const dice: DiceArray = [1, 2, 3, 4, 5];
			const kept: KeptMask = [true, false, true, false, true];
			const result = rerollDice(dice, kept, rng);

			expect(result[0]).toBe(1); // kept
			expect(result[2]).toBe(3); // kept
			expect(result[4]).toBe(5); // kept
		});

		it('rerolls dice where mask is false', () => {
			const dice: DiceArray = [6, 6, 6, 6, 6];
			const kept: KeptMask = [false, false, false, false, false];
			const rng1 = new SeededRandom(42);
			const result = rerollDice(dice, kept, rng1);

			// Very unlikely all 5 would be 6 again
			expect(result).not.toEqual([6, 6, 6, 6, 6]);
		});

		it('returns same dice when all kept', () => {
			const dice: DiceArray = [1, 2, 3, 4, 5];
			const result = rerollDice(dice, KEEP_ALL, rng);
			expect(result).toEqual(dice);
		});
	});

	describe('executeTurnRolls()', () => {
		it('returns initial roll when scoring immediately', () => {
			const result = executeTurnRolls(rng, () => null);
			expect(result.roll1).toBeDefined();
			expect(result.roll2).toBeUndefined();
			expect(result.roll3).toBeUndefined();
			expect(result.keeps).toHaveLength(0);
			expect(result.final).toEqual(result.roll1);
		});

		it('returns roll2 when kept once', () => {
			const result = executeTurnRolls(rng, (_, rollNumber) =>
				rollNumber === 1 ? KEEP_NONE : null,
			);
			expect(result.roll1).toBeDefined();
			expect(result.roll2).toBeDefined();
			expect(result.roll3).toBeUndefined();
			expect(result.keeps).toHaveLength(1);
			expect(result.final).toEqual(result.roll2);
		});

		it('returns roll3 when kept twice', () => {
			const result = executeTurnRolls(rng, () => KEEP_NONE);
			expect(result.roll1).toBeDefined();
			expect(result.roll2).toBeDefined();
			expect(result.roll3).toBeDefined();
			expect(result.keeps).toHaveLength(2);
			expect(result.final).toEqual(result.roll3);
		});
	});

	describe('dice analysis helpers', () => {
		it('countDice counts correctly', () => {
			const counts = countDice([1, 1, 2, 2, 2]);
			expect(counts.get(1)).toBe(2);
			expect(counts.get(2)).toBe(3);
			expect(counts.get(3)).toBeUndefined();
		});

		it('sortDice sorts ascending', () => {
			expect(sortDice([5, 2, 4, 1, 3])).toEqual([1, 2, 3, 4, 5]);
		});

		it('hasNOfAKind detects n of a kind', () => {
			expect(hasNOfAKind([1, 1, 1, 2, 3], 3)).toBe(true);
			expect(hasNOfAKind([1, 1, 2, 2, 3], 3)).toBe(false);
			expect(hasNOfAKind([1, 1, 1, 1, 2], 4)).toBe(true);
			expect(hasNOfAKind([1, 1, 1, 1, 1], 5)).toBe(true);
		});

		it('hasSmallStraight detects small straights', () => {
			expect(hasSmallStraight([1, 2, 3, 4, 6])).toBe(true);
			expect(hasSmallStraight([2, 3, 4, 5, 1])).toBe(true);
			expect(hasSmallStraight([3, 4, 5, 6, 1])).toBe(true);
			expect(hasSmallStraight([1, 2, 3, 5, 6])).toBe(false);
		});

		it('hasLargeStraight detects large straights', () => {
			expect(hasLargeStraight([1, 2, 3, 4, 5])).toBe(true);
			expect(hasLargeStraight([2, 3, 4, 5, 6])).toBe(true);
			expect(hasLargeStraight([1, 2, 3, 4, 6])).toBe(false);
		});

		it('hasFullHouse detects full house', () => {
			expect(hasFullHouse([1, 1, 2, 2, 2])).toBe(true);
			expect(hasFullHouse([3, 3, 3, 5, 5])).toBe(true);
			expect(hasFullHouse([1, 1, 1, 1, 2])).toBe(false);
		});

		it('isDicee detects Dicee (5 of a kind)', () => {
			expect(isDicee([1, 1, 1, 1, 1])).toBe(true);
			expect(isDicee([6, 6, 6, 6, 6])).toBe(true);
			expect(isDicee([1, 1, 1, 1, 2])).toBe(false);
		});

		it('sumDice sums all dice', () => {
			expect(sumDice([1, 2, 3, 4, 5])).toBe(15);
			expect(sumDice([6, 6, 6, 6, 6])).toBe(30);
		});

		it('sumMatching sums matching values', () => {
			expect(sumMatching([1, 1, 2, 2, 2], 1)).toBe(2);
			expect(sumMatching([1, 1, 2, 2, 2], 2)).toBe(6);
			expect(sumMatching([1, 1, 2, 2, 2], 3)).toBe(0);
		});
	});

	describe('mask utilities', () => {
		it('indicesToMask converts correctly', () => {
			expect(indicesToMask([0, 2, 4])).toEqual([true, false, true, false, true]);
			expect(indicesToMask([])).toEqual(KEEP_NONE);
			expect(indicesToMask([0, 1, 2, 3, 4])).toEqual(KEEP_ALL);
		});

		it('maskToIndices converts correctly', () => {
			expect(maskToIndices([true, false, true, false, true])).toEqual([0, 2, 4]);
			expect(maskToIndices(KEEP_NONE)).toEqual([]);
			expect(maskToIndices(KEEP_ALL)).toEqual([0, 1, 2, 3, 4]);
		});
	});
});

// =============================================================================
// Brain Adapter Tests
// =============================================================================

describe('Brain Adapter', () => {
	describe('MathRandomOverride', () => {
		it('overrides Math.random during execution', () => {
			const rng = new SeededRandom(42);
			const override = new MathRandomOverride(rng);

			const results: number[] = [];
			override.withOverride(() => {
				for (let i = 0; i < 5; i++) {
					results.push(Math.random());
				}
			});

			// Verify sequence matches what SeededRandom would produce
			const rng2 = new SeededRandom(42);
			const expected = Array.from({ length: 5 }, () => rng2.random());
			expect(results).toEqual(expected);
		});

		it('restores original Math.random after execution', () => {
			const originalRandom = Math.random;
			const rng = new SeededRandom(42);
			const override = new MathRandomOverride(rng);

			override.withOverride(() => {
				// Inside override
			});

			// Math.random should be restored
			expect(Math.random).toBe(originalRandom);
		});

		it('restores on error', () => {
			const originalRandom = Math.random;
			const rng = new SeededRandom(42);
			const override = new MathRandomOverride(rng);

			try {
				override.withOverride(() => {
					throw new Error('Test error');
				});
			} catch {
				// Expected
			}

			expect(Math.random).toBe(originalRandom);
		});
	});

	describe('withDeterministicRandom', () => {
		it('makes Math.random deterministic', () => {
			const rng = new SeededRandom(42);
			const results = withDeterministicRandom(rng, () => {
				return [Math.random(), Math.random(), Math.random()];
			});

			const rng2 = new SeededRandom(42);
			const expected = [rng2.random(), rng2.random(), rng2.random()];
			expect(results).toEqual(expected);
		});
	});

	describe('withDeterministicRandomAsync', () => {
		it('works with async functions', async () => {
			const rng = new SeededRandom(42);
			const results = await withDeterministicRandomAsync(rng, async () => {
				await Promise.resolve(); // Simulate async
				return [Math.random(), Math.random()];
			});

			const rng2 = new SeededRandom(42);
			const expected = [rng2.random(), rng2.random()];
			expect(results).toEqual(expected);
		});
	});

	describe('BrainRngAdapter', () => {
		class MockBrain implements SimulationBrain {
			readonly type = 'mock';
			decisions: SimulationDecision[] = [];
			randomValues: number[] = [];

			async initialize(_profile: SimulationProfile): Promise<void> {}

			async decide(_context: SimulationContext): Promise<SimulationDecision> {
				// Capture what Math.random returns during decision
				this.randomValues.push(Math.random());
				return { action: 'score', category: 'chance', confidence: 1 };
			}

			dispose(): void {}
		}

		it('wraps brain with deterministic RNG', async () => {
			const rng1 = new SeededRandom(42);
			const rng2 = new SeededRandom(42);

			const brain1 = new MockBrain();
			const brain2 = new MockBrain();

			const adapted1 = new BrainRngAdapter(brain1, rng1);
			const adapted2 = new BrainRngAdapter(brain2, rng2);

			const mockContext: SimulationContext = {
				dice: [1, 2, 3, 4, 5],
				keptDice: [false, false, false, false, false],
				rollsRemaining: 2,
				scorecard: {},
				round: 1,
				opponentScores: [],
				isFinalRound: false,
				scoreDifferential: 0,
			};

			await adapted1.decide(mockContext);
			await adapted2.decide(mockContext);

			// Both brains should see same Math.random values
			expect(brain1.randomValues).toEqual(brain2.randomValues);
		});
	});
});

// =============================================================================
// Game Simulator Tests
// =============================================================================

describe('GameSimulator', () => {
	describe('determinism', () => {
		it('produces identical results with same seed', async () => {
			const config = testConfig();

			const result1 = await runSingleGame(config, 42);
			const result2 = await runSingleGame(config, 42);

			expect(result1.players[0].finalScore).toBe(result2.players[0].finalScore);
			expect(result1.winnerId).toBe(result2.winnerId);
		});

		it('produces different results with different seeds', async () => {
			const config = testConfig();

			// Run multiple games to ensure we get some variation
			const results1: number[] = [];
			const results2: number[] = [];

			for (let i = 0; i < 5; i++) {
				const r1 = await runSingleGame(config, 1000 + i);
				const r2 = await runSingleGame(config, 2000 + i);
				results1.push(r1.players[0].finalScore);
				results2.push(r2.players[0].finalScore);
			}

			// Very unlikely all scores would be identical
			expect(results1).not.toEqual(results2);
		});
	});

	describe('single player game', () => {
		it('runs a complete game', async () => {
			const result = await runSingleGame(testConfig(), 42);

			expect(result.gameId).toBeDefined();
			expect(result.seed).toBeDefined();
			expect(result.startedAt).toBeDefined();
			expect(result.completedAt).toBeDefined();
			expect(result.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.players).toHaveLength(1);
			expect(result.winnerId).toBe('p1');
		});

		it('fills all categories', async () => {
			const result = await runSingleGame(testConfig(), 42);

			const scorecard = result.players[0].scorecard;
			const categories = [
				'ones',
				'twos',
				'threes',
				'fours',
				'fives',
				'sixes',
				'threeOfAKind',
				'fourOfAKind',
				'fullHouse',
				'smallStraight',
				'largeStraight',
				'dicee',
				'chance',
			];

			for (const cat of categories) {
				expect(scorecard[cat as keyof typeof scorecard]).not.toBeNull();
			}
		});
	});

	describe('multiplayer game', () => {
		it('runs with multiple players', async () => {
			const result = await runSingleGame(
				testConfig({
					players: [
						{ id: 'p1', profileId: 'riley' },
						{ id: 'p2', profileId: 'carmen' },
					],
				}),
				42,
			);

			expect(result.players).toHaveLength(2);
			expect(result.winnerId).toBeDefined();
			expect(['p1', 'p2']).toContain(result.winnerId);
		});

		it('determines winner correctly', async () => {
			const result = await runSingleGame(
				testConfig({
					players: [
						{ id: 'p1', profileId: 'liam' },
						{ id: 'p2', profileId: 'professor' },
					],
				}),
				42,
			);

			const winner = result.players.find((p) => p.id === result.winnerId);
			const loser = result.players.find((p) => p.id !== result.winnerId);

			expect(winner).toBeDefined();
			expect(loser).toBeDefined();
			expect(winner!.finalScore).toBeGreaterThanOrEqual(loser!.finalScore);
		});
	});

	describe('GameSimulator class', () => {
		it('tracks seed', () => {
			const sim = new GameSimulator({ seed: 12345 });
			expect(sim.getSeed()).toBe(12345);
		});

		it('runs multiple games deterministically', async () => {
			const sim1 = new GameSimulator({ seed: 42 });
			const sim2 = new GameSimulator({ seed: 42 });

			const config = testConfig();

			const r1a = await sim1.runGame(config);
			const r1b = await sim1.runGame(config);
			const r2a = await sim2.runGame(config);
			const r2b = await sim2.runGame(config);

			// Same simulator with same seed should produce same sequence
			expect(r1a.players[0].finalScore).toBe(r2a.players[0].finalScore);
			expect(r1b.players[0].finalScore).toBe(r2b.players[0].finalScore);
		});
	});

	describe('scoring validation', () => {
		it('scores are within valid range', async () => {
			// Run several games to check score validity
			for (let i = 0; i < 10; i++) {
				const result = await runSingleGame(testConfig(), 1000 + i);

				const score = result.players[0].finalScore;
				// Minimum possible: 0 (all zeros)
				// Maximum possible: 375 (all sixes in upper + bonuses + lower max)
				// Theoretical max with Dicee bonuses much higher, but practical range
				expect(score).toBeGreaterThanOrEqual(0);
				expect(score).toBeLessThanOrEqual(500);
			}
		});
	});
});
