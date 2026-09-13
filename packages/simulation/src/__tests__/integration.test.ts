/**
 * Integration Tests
 *
 * End-to-end tests validating the complete simulation workflow:
 * - Real AI brains from @dicee/cloudflare-do
 * - NDJSON output format
 * - Score validation
 * - Profile behavior differentiation
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBatchSingleThreaded } from '../batch/single-threaded.js';
import type { GameResult, SimulationConfig } from '../schemas/index.js';

// =============================================================================
// Test Setup
// =============================================================================

const TEST_OUTPUT_DIR = path.join(process.cwd(), 'test-output');

beforeAll(() => {
	// Clean up any previous test output
	if (fs.existsSync(TEST_OUTPUT_DIR)) {
		fs.rmSync(TEST_OUTPUT_DIR, { recursive: true });
	}
});

afterAll(() => {
	// Clean up test output
	if (fs.existsSync(TEST_OUTPUT_DIR)) {
		fs.rmSync(TEST_OUTPUT_DIR, { recursive: true });
	}
});

// =============================================================================
// End-to-End Workflow Tests
// =============================================================================

describe('End-to-End Workflow', () => {
	it('runs simulation with real brains and produces valid output', async () => {
		const config: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'professor' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		const result = await runBatchSingleThreaded({
			gameCount: 10,
			simulationConfig: config,
			seed: 42,
			outputDir: path.join(TEST_OUTPUT_DIR, 'workflow-test'),
		});

		// Verify batch result
		expect(result.totalGames).toBe(10);
		expect(result.durationMs).toBeGreaterThan(0);
		expect(result.gamesPerSecond).toBeGreaterThan(0);
		expect(result.baseSeed).toBe(42);

		// Verify output file exists
		const gamesFile = path.join(TEST_OUTPUT_DIR, 'workflow-test', 'games.ndjson');
		expect(fs.existsSync(gamesFile)).toBe(true);

		// Verify NDJSON format
		const content = fs.readFileSync(gamesFile, 'utf-8');
		const lines = content.trim().split('\n');
		expect(lines).toHaveLength(10);

		// Verify each line is valid JSON
		const games: GameResult[] = lines.map((line) => JSON.parse(line));
		for (const game of games) {
			expect(game.gameId).toBeDefined();
			expect(game.seed).toBeDefined();
			expect(game.players).toHaveLength(1);
			expect(game.winnerId).toBe('p1');
		}
	}, 30000); // 30s timeout for real brain initialization

	it('produces NDJSON that can be parsed line-by-line', async () => {
		const config: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'carmen' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		await runBatchSingleThreaded({
			gameCount: 5,
			simulationConfig: config,
			seed: 123,
			outputDir: path.join(TEST_OUTPUT_DIR, 'ndjson-test'),
		});

		const gamesFile = path.join(TEST_OUTPUT_DIR, 'ndjson-test', 'games.ndjson');
		const content = fs.readFileSync(gamesFile, 'utf-8');

		// Stream-parse line by line (simulating how Python would read it)
		let gameCount = 0;
		for (const line of content.split('\n')) {
			if (line.trim()) {
				const game = JSON.parse(line);
				expect(game.players[0].profileId).toBe('carmen');
				gameCount++;
			}
		}
		expect(gameCount).toBe(5);
	}, 30000);
});

// =============================================================================
// Real Brain Score Validation Tests
// =============================================================================

describe('Real Brain Score Validation', () => {
	it('professor brain produces realistic scores (150-350 range)', async () => {
		const config: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'professor' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		const result = await runBatchSingleThreaded({
			gameCount: 50,
			simulationConfig: config,
			seed: 999,
		});

		const scores = result.results.map((g) => g.players[0].finalScore);
		const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
		const min = Math.min(...scores);
		const max = Math.max(...scores);

		// Professor (optimal brain) should average 180-220
		expect(mean).toBeGreaterThan(150);
		expect(mean).toBeLessThan(250);

		// Min should rarely be below 100
		expect(min).toBeGreaterThan(80);

		// Max can reach 300+ with good rolls
		expect(max).toBeGreaterThan(200);
		expect(max).toBeLessThan(400);
	}, 60000);

	it('carmen brain produces lower scores than professor', async () => {
		const professorConfig: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'professor' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		const carmenConfig: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'carmen' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		// Use same seeds for fair comparison
		const [profResult, carmenResult] = await Promise.all([
			runBatchSingleThreaded({
				gameCount: 30,
				simulationConfig: professorConfig,
				seed: 777,
			}),
			runBatchSingleThreaded({
				gameCount: 30,
				simulationConfig: carmenConfig,
				seed: 777,
			}),
		]);

		const profMean =
			profResult.results.reduce((a, g) => a + g.players[0].finalScore, 0) /
			profResult.results.length;
		const carmenMean =
			carmenResult.results.reduce((a, g) => a + g.players[0].finalScore, 0) /
			carmenResult.results.length;

		// Carmen (personality-based) should score noticeably lower than optimal professor
		expect(profMean).toBeGreaterThan(carmenMean);
		// Difference should be significant (at least 20 points on average)
		expect(profMean - carmenMean).toBeGreaterThan(20);
	}, 90000);

	it('multiplayer game determines winner correctly', async () => {
		const config: SimulationConfig = {
			players: [
				{ id: 'prof', profileId: 'professor' },
				{ id: 'carm', profileId: 'carmen' },
			],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		const result = await runBatchSingleThreaded({
			gameCount: 20,
			simulationConfig: config,
			seed: 555,
		});

		for (const game of result.results) {
			const prof = game.players.find((p) => p.id === 'prof')!;
			const carm = game.players.find((p) => p.id === 'carm')!;

			// Winner should have highest score
			const winner = game.players.find((p) => p.id === game.winnerId)!;
			const loser = game.players.find((p) => p.id !== game.winnerId)!;
			expect(winner.finalScore).toBeGreaterThanOrEqual(loser.finalScore);

			// Verify scores are realistic
			expect(prof.finalScore).toBeGreaterThan(50);
			expect(carm.finalScore).toBeGreaterThan(50);
		}

		// Professor should win majority of games (optimal vs personality)
		const profWins = result.results.filter((g) => g.winnerId === 'prof').length;
		expect(profWins).toBeGreaterThan(result.results.length / 2);
	}, 60000);
});

// =============================================================================
// Determinism Tests
// =============================================================================

describe('Determinism with Real Brains', () => {
	it('same seed produces identical results', async () => {
		const config: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'professor' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		const [result1, result2] = await Promise.all([
			runBatchSingleThreaded({
				gameCount: 5,
				simulationConfig: config,
				seed: 12345,
			}),
			runBatchSingleThreaded({
				gameCount: 5,
				simulationConfig: config,
				seed: 12345,
			}),
		]);

		// All scores should be identical
		for (let i = 0; i < 5; i++) {
			expect(result1.results[i].players[0].finalScore).toBe(
				result2.results[i].players[0].finalScore,
			);
		}
	}, 60000);

	it('different seeds produce different results', async () => {
		const config: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'professor' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		const [result1, result2] = await Promise.all([
			runBatchSingleThreaded({
				gameCount: 5,
				simulationConfig: config,
				seed: 11111,
			}),
			runBatchSingleThreaded({
				gameCount: 5,
				simulationConfig: config,
				seed: 22222,
			}),
		]);

		const scores1 = result1.results.map((g) => g.players[0].finalScore);
		const scores2 = result2.results.map((g) => g.players[0].finalScore);

		// Very unlikely to be identical
		expect(scores1).not.toEqual(scores2);
	}, 60000);
});

// =============================================================================
// Resume Capability Tests
// =============================================================================

describe('Resume Capability', () => {
	it('can resume from partial output', async () => {
		const config: SimulationConfig = {
			players: [{ id: 'p1', profileId: 'riley' }],
			captureDecisions: false,
			captureIntermediateStates: false,
		};

		const outputDir = path.join(TEST_OUTPUT_DIR, 'resume-test');

		// Run first 5 games
		await runBatchSingleThreaded({
			gameCount: 5,
			simulationConfig: config,
			seed: 42,
			outputDir,
		});

		// Verify 5 games written
		const gamesFile = path.join(outputDir, 'games.ndjson');
		let content = fs.readFileSync(gamesFile, 'utf-8');
		expect(content.trim().split('\n')).toHaveLength(5);

		// Resume and add 5 more
		await runBatchSingleThreaded({
			gameCount: 10,
			simulationConfig: config,
			seed: 42,
			outputDir,
			resume: true,
		});

		// Should now have 10 games
		content = fs.readFileSync(gamesFile, 'utf-8');
		expect(content.trim().split('\n')).toHaveLength(10);
	}, 60000);
});
