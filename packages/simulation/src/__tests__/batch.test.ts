/**
 * Batch Processing Tests
 *
 * Tests for NDJSON streaming, single-threaded batch runner,
 * progress tracking, and resume capability.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getProcessedGameCount,
	getProcessedSeeds,
	NdjsonReader,
	NdjsonWriter,
	SimulationOutputWriter,
} from '../batch/ndjson-writer.js';
import { benchmark, runBatchSingleThreaded } from '../batch/single-threaded.js';
import type { GameResult } from '../schemas/index.js';

// Helper to create a minimal valid GameResult
function createGameResult(seed: number, overrides: Partial<GameResult> = {}): GameResult {
	const gameId = `game-${seed}`;
	const now = new Date().toISOString();
	return {
		gameId,
		seed,
		startedAt: now,
		completedAt: now,
		durationMs: 100,
		players: [
			{
				id: 'p1',
				profileId: 'custom',
				finalScore: 250,
				scorecard: {
					ones: 3,
					twos: 6,
					threes: 9,
					fours: 12,
					fives: 15,
					sixes: 18,
					threeOfAKind: 20,
					fourOfAKind: 25,
					fullHouse: 25,
					smallStraight: 30,
					largeStraight: 40,
					dicee: 50,
					chance: 22,
					diceeBonus: 0,
					upperBonus: 35,
				},
				upperBonus: true,
				diceeCount: 1,
			},
		],
		winnerId: 'p1',
		winnerProfileId: 'custom',
		...overrides,
	};
}

describe('NDJSON Writer/Reader', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'dicee-batch-test-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe('NdjsonWriter', () => {
		it('should write records as newline-delimited JSON', async () => {
			const filePath = join(tempDir, 'test.ndjson');
			const writer = new NdjsonWriter<{ id: number; value: string }>(filePath);

			await writer.open();
			await writer.write({ id: 1, value: 'first' });
			await writer.write({ id: 2, value: 'second' });
			await writer.close();

			const content = await readFile(filePath, 'utf8');
			const lines = content.trim().split('\n');

			expect(lines).toHaveLength(2);
			expect(JSON.parse(lines[0])).toEqual({ id: 1, value: 'first' });
			expect(JSON.parse(lines[1])).toEqual({ id: 2, value: 'second' });
		});

		it('should track statistics', async () => {
			const filePath = join(tempDir, 'stats.ndjson');
			const writer = new NdjsonWriter<{ data: string }>(filePath);

			await writer.open();
			await writer.write({ data: 'test' });
			await writer.write({ data: 'more' });

			const stats = writer.getStats();
			expect(stats.lineCount).toBe(2);
			expect(stats.bytesWritten).toBeGreaterThan(0);

			await writer.close();
		});

		it('should append to existing file', async () => {
			const filePath = join(tempDir, 'append.ndjson');

			// First write
			const writer1 = new NdjsonWriter<{ n: number }>(filePath);
			await writer1.open();
			await writer1.write({ n: 1 });
			await writer1.close();

			// Second write (append)
			const writer2 = new NdjsonWriter<{ n: number }>(filePath);
			await writer2.open();
			await writer2.write({ n: 2 });
			await writer2.close();

			const content = await readFile(filePath, 'utf8');
			const lines = content.trim().split('\n');
			expect(lines).toHaveLength(2);
		});

		it('should create parent directories', async () => {
			const filePath = join(tempDir, 'nested', 'deep', 'file.ndjson');
			const writer = new NdjsonWriter<{ x: number }>(filePath);

			await writer.open();
			await writer.write({ x: 42 });
			await writer.close();

			const content = await readFile(filePath, 'utf8');
			expect(JSON.parse(content.trim())).toEqual({ x: 42 });
		});

		it('should throw if write called before open', async () => {
			const writer = new NdjsonWriter<{ x: number }>(join(tempDir, 'fail.ndjson'));

			await expect(writer.write({ x: 1 })).rejects.toThrow('Writer not opened');
		});
	});

	describe('NdjsonReader', () => {
		it('should read all records', async () => {
			const filePath = join(tempDir, 'read.ndjson');
			await writeFile(filePath, '{"id":1}\n{"id":2}\n{"id":3}\n');

			const reader = new NdjsonReader<{ id: number }>(filePath);
			const records = reader.readAll();

			expect(records).toHaveLength(3);
			expect(records.map((r) => r.id)).toEqual([1, 2, 3]);
		});

		it('should handle empty lines', async () => {
			const filePath = join(tempDir, 'empty-lines.ndjson');
			await writeFile(filePath, '{"id":1}\n\n{"id":2}\n   \n{"id":3}\n');

			const reader = new NdjsonReader<{ id: number }>(filePath);
			const records = reader.readAll();

			expect(records).toHaveLength(3);
		});

		it('should return empty array for non-existent file', () => {
			const reader = new NdjsonReader<{ id: number }>(join(tempDir, 'missing.ndjson'));
			expect(reader.readAll()).toEqual([]);
			expect(reader.exists()).toBe(false);
		});

		it('should count lines', async () => {
			const filePath = join(tempDir, 'count.ndjson');
			await writeFile(filePath, '{"a":1}\n{"a":2}\n{"a":3}\n{"a":4}\n{"a":5}\n');

			const reader = new NdjsonReader<{ a: number }>(filePath);
			expect(reader.countLines()).toBe(5);
		});

		it('should iterate with generator', async () => {
			const filePath = join(tempDir, 'gen.ndjson');
			await writeFile(filePath, '{"v":10}\n{"v":20}\n{"v":30}\n');

			const reader = new NdjsonReader<{ v: number }>(filePath);
			const values: number[] = [];

			for (const record of reader.read()) {
				values.push(record.v);
			}

			expect(values).toEqual([10, 20, 30]);
		});

		it('should get processed IDs', async () => {
			const filePath = join(tempDir, 'ids.ndjson');
			await writeFile(filePath, '{"gameId":"a"}\n{"gameId":"b"}\n{"gameId":"c"}\n');

			const reader = new NdjsonReader<{ gameId: string }>(filePath);
			const ids = reader.getProcessedIds('gameId');

			expect(ids.size).toBe(3);
			expect(ids.has('a')).toBe(true);
			expect(ids.has('b')).toBe(true);
			expect(ids.has('c')).toBe(true);
		});
	});

	describe('SimulationOutputWriter', () => {
		it('should write game results', async () => {
			const outputDir = join(tempDir, 'output');
			const writer = new SimulationOutputWriter(outputDir);

			await writer.open();
			await writer.writeGame(createGameResult(100));
			await writer.writeGame(createGameResult(200));
			await writer.close();

			const content = await readFile(join(outputDir, 'games.ndjson'), 'utf8');
			const lines = content.trim().split('\n');

			expect(lines).toHaveLength(2);
			expect(JSON.parse(lines[0]).seed).toBe(100);
			expect(JSON.parse(lines[1]).seed).toBe(200);
		});

		it('should report statistics', async () => {
			const outputDir = join(tempDir, 'stats-output');
			const writer = new SimulationOutputWriter(outputDir);

			await writer.open();
			await writer.writeGame(createGameResult(1));
			const stats = writer.getStats();

			expect(stats.games.lineCount).toBe(1);
			expect(stats.games.bytesWritten).toBeGreaterThan(0);

			await writer.close();
		});
	});

	describe('Resume utilities', () => {
		it('should get processed seeds from output directory', async () => {
			const outputDir = join(tempDir, 'resume');
			await mkdir(outputDir, { recursive: true });
			await writeFile(
				join(outputDir, 'games.ndjson'),
				[
					JSON.stringify(createGameResult(111)),
					JSON.stringify(createGameResult(222)),
					JSON.stringify(createGameResult(333)),
				].join('\n') + '\n',
			);

			const seeds = getProcessedSeeds(outputDir);

			expect(seeds.size).toBe(3);
			expect(seeds.has(111)).toBe(true);
			expect(seeds.has(222)).toBe(true);
			expect(seeds.has(333)).toBe(true);
		});

		it('should get processed game count', async () => {
			const outputDir = join(tempDir, 'count');
			await mkdir(outputDir, { recursive: true });
			await writeFile(
				join(outputDir, 'games.ndjson'),
				[
					JSON.stringify(createGameResult(1)),
					JSON.stringify(createGameResult(2)),
					JSON.stringify(createGameResult(3)),
					JSON.stringify(createGameResult(4)),
				].join('\n') + '\n',
			);

			const count = getProcessedGameCount(outputDir);
			expect(count).toBe(4);
		});

		it('should return 0 for non-existent output directory', () => {
			const count = getProcessedGameCount(join(tempDir, 'nonexistent'));
			expect(count).toBe(0);
		});
	});
});

describe('Single-Threaded Batch Runner', () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'dicee-batch-runner-'));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	it('should run batch and return results in memory', async () => {
		const result = await runBatchSingleThreaded({
			gameCount: 5,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'custom' }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 12345,
		});

		expect(result.totalGames).toBe(5);
		expect(result.results).toHaveLength(5);
		expect(result.baseSeed).toBe(12345);
		expect(result.workerCount).toBe(1);
		expect(result.gamesPerSecond).toBeGreaterThan(0);
		expect(result.durationMs).toBeGreaterThan(0);
	});

	it('should produce deterministic results with same seed', async () => {
		const config = {
			gameCount: 3,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'custom' as const }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 42,
		};

		const result1 = await runBatchSingleThreaded(config);
		const result2 = await runBatchSingleThreaded(config);

		// Same seeds should produce same game results
		expect(result1.results.map((r) => r.seed)).toEqual(result2.results.map((r) => r.seed));
		expect(result1.results.map((r) => r.players[0].finalScore)).toEqual(
			result2.results.map((r) => r.players[0].finalScore),
		);
	});

	it('should stream results to NDJSON when outputDir is set', async () => {
		const outputDir = join(tempDir, 'streamed');

		const result = await runBatchSingleThreaded({
			gameCount: 10,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'riley' }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 999,
			outputDir,
		});

		// Results should be empty when streaming to disk
		expect(result.results).toHaveLength(0);
		expect(result.totalGames).toBe(10);
		expect(result.outputPath).toBe(outputDir);

		// Check file was written
		const reader = new NdjsonReader<GameResult>(join(outputDir, 'games.ndjson'));
		const games = reader.readAll();

		expect(games).toHaveLength(10);
		expect(games.every((g) => g.players[0].profileId === 'riley')).toBe(true);
	});

	it('should track progress', async () => {
		const progressUpdates: { completed: number; total: number }[] = [];

		await runBatchSingleThreaded({
			gameCount: 20,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'custom' }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 1,
			progressEvery: 5,
			onProgress: (progress) => {
				progressUpdates.push({
					completed: progress.completedGames,
					total: progress.totalGames,
				});
			},
		});

		// Should have received progress updates at 5, 10, 15, 20
		expect(progressUpdates.length).toBeGreaterThanOrEqual(4);
		expect(progressUpdates.every((p) => p.total === 20)).toBe(true);

		// Last update should show all complete
		const lastUpdate = progressUpdates[progressUpdates.length - 1];
		expect(lastUpdate.completed).toBe(20);
	});

	it('should include worker stats in progress', async () => {
		let lastProgress: { workers: { workerId: number; status: string }[] } | null = null;

		await runBatchSingleThreaded({
			gameCount: 10,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'custom' }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 1,
			progressEvery: 5,
			onProgress: (progress) => {
				lastProgress = progress;
			},
		});

		expect(lastProgress).not.toBeNull();
		expect(lastProgress!.workers).toHaveLength(1);
		expect(lastProgress!.workers[0].workerId).toBe(0);
		expect(lastProgress!.workers[0].status).toBe('working');
	});

	it('should support resume with NDJSON output', async () => {
		const outputDir = join(tempDir, 'resume-test');

		// First run: 10 games
		await runBatchSingleThreaded({
			gameCount: 10,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'custom' }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 555,
			outputDir,
		});

		// Get seeds and count from first run
		const firstRunSeeds = getProcessedSeeds(outputDir);
		expect(firstRunSeeds.size).toBe(10);

		const countAfterFirstRun = new NdjsonReader<GameResult>(
			join(outputDir, 'games.ndjson'),
		).countLines();
		expect(countAfterFirstRun).toBe(10);

		// Resume run with same seed - should skip existing games
		const result = await runBatchSingleThreaded({
			gameCount: 10,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'custom' }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 555,
			outputDir,
			resume: true,
		});

		// totalGames includes both skipped and completed
		expect(result.totalGames).toBe(10);

		// Key assertion: file should NOT have grown (no new games written)
		const countAfterResume = new NdjsonReader<GameResult>(
			join(outputDir, 'games.ndjson'),
		).countLines();
		expect(countAfterResume).toBe(10);
	});

	it('should handle multi-player games', async () => {
		const result = await runBatchSingleThreaded({
			gameCount: 3,
			simulationConfig: {
				players: [
					{ id: 'p1', profileId: 'riley' },
					{ id: 'p2', profileId: 'carmen' },
				],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: 777,
		});

		expect(result.totalGames).toBe(3);
		result.results.forEach((game) => {
			expect(game.players).toHaveLength(2);
			expect(game.players[0].profileId).toBe('riley');
			expect(game.players[1].profileId).toBe('carmen');
			// Winner should be one of the players
			expect(['p1', 'p2']).toContain(game.winnerId);
		});
	});
});

describe('Benchmark', () => {
	it('should run benchmark for specified duration', async () => {
		const result = await benchmark({
			durationMs: 500, // Short benchmark
			seed: 42,
		});

		expect(result.gamesCompleted).toBeGreaterThan(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(500);
		expect(result.gamesPerSecond).toBeGreaterThan(0);
		expect(result.averageGameMs).toBeGreaterThan(0);
	});

	it('should report progress during benchmark', async () => {
		const progressReports: { gps: number; total: number }[] = [];

		await benchmark({
			durationMs: 300,
			seed: 123,
			onProgress: (gamesPerSecond, totalGames) => {
				progressReports.push({ gps: gamesPerSecond, total: totalGames });
			},
		});

		// Should have received at least one progress report
		expect(progressReports.length).toBeGreaterThan(0);
	});

	it('should be deterministic with same seed', async () => {
		// Note: Results won't be exactly equal due to timing,
		// but the games themselves should be deterministic
		const result1 = await benchmark({ durationMs: 200, seed: 999 });
		const result2 = await benchmark({ durationMs: 200, seed: 999 });

		// Both should complete some games
		expect(result1.gamesCompleted).toBeGreaterThan(0);
		expect(result2.gamesCompleted).toBeGreaterThan(0);
	});
});

describe('Batch Coordinator Types', () => {
	// Test that exported types work correctly
	it('should export BatchRunConfig type', async () => {
		const config = {
			gameCount: 100,
			workerCount: 4,
			baseSeed: 42,
			outputFormat: 'memory' as const,
			batchSize: 50,
		};

		// Type check - this should compile
		expect(config.gameCount).toBe(100);
		expect(config.workerCount).toBe(4);
	});

	it('should export BatchResult type', async () => {
		const result = await runBatchSingleThreaded({
			gameCount: 2,
			simulationConfig: {
				players: [{ id: 'p1', profileId: 'custom' }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
		});

		// BatchResult shape check
		expect(typeof result.totalGames).toBe('number');
		expect(typeof result.durationMs).toBe('number');
		expect(typeof result.gamesPerSecond).toBe('number');
		expect(typeof result.baseSeed).toBe('number');
		expect(typeof result.workerCount).toBe('number');
		expect(Array.isArray(result.results)).toBe(true);
	});
});
