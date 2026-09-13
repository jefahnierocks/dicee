#!/usr/bin/env node

/**
 * Simulation Benchmark CLI
 *
 * Measure simulation throughput and performance characteristics.
 *
 * @example
 * # Run a 30-second benchmark
 * pnpm sim:bench --duration 30s
 *
 * # Quick 10-second benchmark with verbose output
 * pnpm sim:bench --duration 10s --verbose
 *
 * # Benchmark with specific profile
 * pnpm sim:bench --profile professor --duration 60s
 */

import { benchmark } from '../batch/index.js';
import type { ProfileId } from '../schemas/index.js';
import {
	formatDuration,
	formatNumber,
	getBoolean,
	getString,
	parseArgs,
	parseDuration,
} from './args.js';

const VALID_PROFILES = ['riley', 'carmen', 'liam', 'professor', 'charlie'] as const;

interface BenchmarkOptions {
	duration: number;
	profile: ProfileId;
	warmup: number;
	verbose: boolean;
	json: boolean;
}

function printUsage(): void {
	console.log(`
Usage: sim:bench [options]

Benchmark simulation throughput and performance.

Options:
  --duration <time>   Benchmark duration (default: 30s)
                      Formats: 10s, 1m, 30000 (ms)
  --profile <name>    AI profile to use (default: professor)
                      Valid: ${VALID_PROFILES.join(', ')}
  --warmup <time>     Warmup duration (default: 2s)
  --verbose           Show detailed progress information
  --json              Output results as JSON
  --help              Show this help message

Examples:
  sim:bench --duration 30s
  sim:bench --duration 1m --profile carmen --verbose
  sim:bench --duration 10s --json
`);
}

function parseOptions(): BenchmarkOptions | null {
	const args = parseArgs();

	if (getBoolean(args, 'help') || getBoolean(args, 'h')) {
		printUsage();
		return null;
	}

	const durationStr = getString(args, 'duration', '30s');
	const warmupStr = getString(args, 'warmup', '2s');

	let duration: number;
	let warmup: number;

	try {
		duration = parseDuration(durationStr ?? '30s');
	} catch {
		console.error(`Error: Invalid duration format '${durationStr}'`);
		process.exit(1);
	}

	try {
		warmup = parseDuration(warmupStr ?? '2s');
	} catch {
		console.error(`Error: Invalid warmup format '${warmupStr}'`);
		process.exit(1);
	}

	const profile = (getString(args, 'profile', 'professor') ?? 'professor') as ProfileId;
	if (!VALID_PROFILES.includes(profile as (typeof VALID_PROFILES)[number])) {
		console.error(`Error: Invalid profile '${profile}'`);
		console.error(`Valid profiles: ${VALID_PROFILES.join(', ')}`);
		process.exit(1);
	}

	return {
		duration,
		profile,
		warmup,
		verbose: getBoolean(args, 'verbose') || getBoolean(args, 'v'),
		json: getBoolean(args, 'json'),
	};
}

interface BenchmarkResult {
	profile: string;
	durationMs: number;
	warmupMs: number;
	totalGames: number;
	gamesPerSecond: number;
	avgGameTimeMs: number;
	peakGamesPerSecond?: number;
	minGamesPerSecond?: number;
	samples: number[];
}

async function runBenchmark(options: BenchmarkOptions): Promise<void> {
	if (!options.json) {
		console.log('\n=== Dicee Simulation Benchmark ===\n');
		console.log(`Profile: ${options.profile}`);
		console.log(`Duration: ${formatDuration(options.duration)}`);
		console.log(`Warmup: ${formatDuration(options.warmup)}`);
		console.log('');
	}

	// Warmup phase
	if (!options.json && options.warmup > 0) {
		process.stdout.write('Warming up...');
		await benchmark({
			simulationConfig: {
				players: [{ id: 'bench-player', profileId: options.profile }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			durationMs: options.warmup,
		});
		console.log(' done\n');
	}

	// Collect samples for statistics
	const samples: number[] = [];
	const sampleInterval = 1000; // 1 second samples
	const numSamples = Math.max(1, Math.floor(options.duration / sampleInterval));
	const actualSampleDuration = options.duration / numSamples;

	let totalGames = 0;

	if (!options.json) {
		console.log('Running benchmark...');
	}

	for (let i = 0; i < numSamples; i++) {
		const sampleResult = await benchmark({
			simulationConfig: {
				players: [{ id: 'bench-player', profileId: options.profile }],
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			durationMs: actualSampleDuration,
		});

		samples.push(sampleResult.gamesPerSecond);
		totalGames += sampleResult.gamesCompleted;

		if (options.verbose && !options.json) {
			const pct = (((i + 1) / numSamples) * 100).toFixed(0);
			process.stdout.write(
				`\r  Sample ${i + 1}/${numSamples} (${pct}%): ${sampleResult.gamesPerSecond.toFixed(1)} games/sec`,
			);
		}
	}

	if (options.verbose && !options.json) {
		console.log('\n');
	}

	// Calculate statistics
	const avgGamesPerSecond = samples.reduce((a, b) => a + b, 0) / samples.length;
	const peakGamesPerSecond = Math.max(...samples);
	const minGamesPerSecond = Math.min(...samples);
	const avgGameTimeMs = 1000 / avgGamesPerSecond;

	// Calculate standard deviation
	const variance =
		samples.reduce((sum, s) => sum + (s - avgGamesPerSecond) ** 2, 0) / samples.length;
	const stdDev = Math.sqrt(variance);

	const result: BenchmarkResult = {
		profile: options.profile,
		durationMs: options.duration,
		warmupMs: options.warmup,
		totalGames,
		gamesPerSecond: avgGamesPerSecond,
		avgGameTimeMs,
		peakGamesPerSecond,
		minGamesPerSecond,
		samples,
	};

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	// Print results
	console.log('--- Results ---\n');
	console.log(`Total Games: ${formatNumber(totalGames)}`);
	console.log(`Throughput: ${avgGamesPerSecond.toFixed(1)} ± ${stdDev.toFixed(1)} games/second`);
	console.log(`Average Game Time: ${avgGameTimeMs.toFixed(3)} ms`);
	console.log('');
	console.log(
		`Peak: ${peakGamesPerSecond.toFixed(1)} games/sec | Min: ${minGamesPerSecond.toFixed(1)} games/sec`,
	);

	// Performance assessment
	console.log('\n--- Performance Assessment ---\n');

	if (avgGamesPerSecond >= 2000) {
		console.log('Excellent performance! Suitable for large-scale experiments.');
	} else if (avgGamesPerSecond >= 1000) {
		console.log('Good performance. Suitable for medium-scale experiments.');
	} else if (avgGamesPerSecond >= 500) {
		console.log('Moderate performance. Consider smaller batch sizes.');
	} else {
		console.log('Lower performance detected. Check system resources or optimize configuration.');
	}

	// Estimate run times
	console.log('\n--- Estimated Run Times ---\n');
	const estimates = [
		{ games: 1000, label: '1K games' },
		{ games: 10000, label: '10K games' },
		{ games: 100000, label: '100K games' },
		{ games: 1000000, label: '1M games' },
	];

	for (const { games, label } of estimates) {
		const timeMs = (games / avgGamesPerSecond) * 1000;
		console.log(`  ${label.padEnd(12)} ~${formatDuration(timeMs)}`);
	}

	console.log('');
}

async function main(): Promise<void> {
	const options = parseOptions();
	if (!options) {
		process.exit(0);
	}

	try {
		await runBenchmark(options);
	} catch (error) {
		console.error('Error:', error instanceof Error ? error.message : error);
		if (process.env.DEBUG) {
			console.error(error);
		}
		process.exit(1);
	}
}

main();
