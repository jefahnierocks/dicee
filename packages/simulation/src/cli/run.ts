#!/usr/bin/env node

/**
 * Simulation Runner CLI
 *
 * Run experiments and simulations from the command line.
 *
 * @example
 * # Run a calibration experiment
 * pnpm sim:run --profiles professor --games 1000
 *
 * # Run with multiple profiles
 * pnpm sim:run --profiles professor,carmen,riley --games 500 --seed 42
 *
 * # Output to directory
 * pnpm sim:run --profiles professor --games 10000 --output ./results
 */

import { runBatchSingleThreaded } from '../batch/index.js';
import { runQuickExperiment } from '../experiment/index.js';
import type { DescriptiveStats, ExperimentResults, ProfileId } from '../schemas/index.js';
import {
	formatDuration,
	formatNumber,
	getBoolean,
	getNumber,
	getString,
	parseArgs,
} from './args.js';

const VALID_PROFILES = [
	'riley',
	'carmen',
	'liam',
	'sage',
	'professor',
	'charlie',
	'phase-greedy',
	'phase-conservative',
	'phase-upper',
	'phase-lower',
] as const;

interface RunOptions {
	profiles: ProfileId[];
	games: number;
	seed?: number;
	output?: string;
	verbose: boolean;
	json: boolean;
}

function printUsage(): void {
	console.log(`
Usage: sim:run [options]

Run simulations and experiments for AI calibration and analysis.

Options:
  --profiles <list>   Comma-separated AI profiles (default: professor)
                      Valid: ${VALID_PROFILES.join(', ')}
  --games <n>         Number of games to run (default: 100)
  --seed <n>          Random seed for reproducibility
  --output <dir>      Output directory for results (NDJSON files)
  --verbose           Show detailed progress information
  --json              Output results as JSON
  --help              Show this help message

Examples:
  sim:run --profiles professor --games 1000
  sim:run --profiles professor,carmen --games 500 --seed 42
  sim:run --profiles riley,liam --games 10000 --output ./results --verbose
`);
}

function parseOptions(): RunOptions | null {
	const args = parseArgs();

	if (getBoolean(args, 'help') || getBoolean(args, 'h')) {
		printUsage();
		return null;
	}

	const profilesStr = getString(args, 'profiles', 'professor');
	const profiles = profilesStr
		? profilesStr.split(',').map((p) => p.trim() as ProfileId)
		: (['professor'] as ProfileId[]);

	// Validate profiles
	for (const profile of profiles) {
		if (!VALID_PROFILES.includes(profile as (typeof VALID_PROFILES)[number])) {
			console.error(`Error: Invalid profile '${profile}'`);
			console.error(`Valid profiles: ${VALID_PROFILES.join(', ')}`);
			process.exit(1);
		}
	}

	return {
		profiles,
		games: getNumber(args, 'games', 100) ?? 100,
		seed: getNumber(args, 'seed'),
		output: getString(args, 'output'),
		verbose: getBoolean(args, 'verbose') || getBoolean(args, 'v'),
		json: getBoolean(args, 'json'),
	};
}

function printStats(label: string, stats: DescriptiveStats): void {
	console.log(`  ${label}:`);
	console.log(
		`    Mean: ${stats.mean.toFixed(2)} ± ${stats.stdDev.toFixed(2)} (95% CI: ${stats.ci95Lower.toFixed(2)}-${stats.ci95Upper.toFixed(2)})`,
	);
	console.log(`    Median: ${stats.median.toFixed(2)} | Range: ${stats.min}-${stats.max}`);
}

function printResults(results: ExperimentResults, verbose: boolean): void {
	console.log('\n=== Experiment Results ===\n');

	console.log(`Experiment: ${results.experimentId}`);
	console.log(`Version: ${results.experimentVersion}`);
	console.log(`Duration: ${formatDuration(results.durationMs)}`);
	console.log(`Total Games: ${formatNumber(results.totalGames)}`);

	console.log('\n--- Metrics by Profile ---\n');

	for (const [profileId, metricStats] of Object.entries(results.statsByProfile)) {
		console.log(`Profile: ${profileId.toUpperCase()}`);

		// Total score stats
		const totalScore = metricStats['total_score'];
		if (totalScore) {
			printStats('Total Score', totalScore);
		}

		// Upper section stats
		const upperScore = metricStats['upper_section_score'];
		if (upperScore) {
			printStats('Upper Section', upperScore);
		}

		// Lower section stats
		const lowerScore = metricStats['lower_section_score'];
		if (lowerScore) {
			printStats('Lower Section', lowerScore);
		}

		if (verbose) {
			// Show quartile info from total score
			if (totalScore) {
				console.log(`  Distribution:`);
				console.log(`    25th percentile (Q1): ${totalScore.q1.toFixed(1)}`);
				console.log(`    75th percentile (Q3): ${totalScore.q3.toFixed(1)}`);
				console.log(`    IQR: ${(totalScore.q3 - totalScore.q1).toFixed(1)}`);
			}
		}

		console.log('');
	}

	// Hypothesis results
	if (results.hypothesisResults.length > 0) {
		console.log('--- Hypothesis Tests ---\n');

		for (const result of results.hypothesisResults) {
			const status = result.rejected ? '✓ REJECTED' : '✗ NOT REJECTED';
			console.log(`${result.hypothesisId}: ${status}`);
			console.log(`  p-value: ${result.pValue.toFixed(4)}`);
			console.log(
				`  Effect size: ${result.effectSize.toFixed(3)} (${result.effectInterpretation})`,
			);
			console.log(`  Conclusion: ${result.conclusion}`);
			console.log('');
		}
	}

	// Summary
	if (results.summary) {
		console.log('--- Summary ---\n');
		console.log(results.summary);
		console.log('');
	}
}

async function runSimulation(options: RunOptions): Promise<void> {
	const startTime = Date.now();

	console.log('\n=== Dicee AI Simulation ===\n');
	console.log(`Profiles: ${options.profiles.join(', ')}`);
	console.log(`Games: ${formatNumber(options.games)}`);
	if (options.seed !== undefined) {
		console.log(`Seed: ${options.seed}`);
	}
	if (options.output) {
		console.log(`Output: ${options.output}`);
	}
	console.log('');

	// If output directory specified, use batch runner for streaming
	if (options.output) {
		console.log('Running batch simulation with NDJSON output...\n');

		let lastProgress = 0;
		const result = await runBatchSingleThreaded({
			gameCount: options.games,
			simulationConfig: {
				players: options.profiles.map((profileId, i) => ({
					id: `player-${i + 1}`,
					profileId,
				})),
				captureDecisions: false,
				captureIntermediateStates: false,
			},
			seed: options.seed,
			outputDir: options.output,
			onProgress: (progress) => {
				if (options.verbose || progress.completedGames - lastProgress >= 100) {
					const pct = ((progress.completedGames / progress.totalGames) * 100).toFixed(1);
					const rate = progress.gamesPerSecond.toFixed(1);
					process.stdout.write(
						`\r  Progress: ${formatNumber(progress.completedGames)}/${formatNumber(progress.totalGames)} (${pct}%) | ${rate} games/sec`,
					);
					lastProgress = progress.completedGames;
				}
			},
		});

		console.log('\n');
		console.log(
			`Completed: ${formatNumber(result.totalGames)} games in ${formatDuration(result.durationMs)}`,
		);
		console.log(`Throughput: ${result.gamesPerSecond.toFixed(1)} games/second`);
		console.log(`Output: ${options.output}/games.ndjson`);

		return;
	}

	// Otherwise, use the experiment runner
	console.log('Running experiment...\n');

	const results = await runQuickExperiment(options.profiles, options.games, options.seed);

	const elapsed = Date.now() - startTime;

	if (options.json) {
		console.log(JSON.stringify(results, null, 2));
	} else {
		printResults(results, options.verbose);
	}

	if (options.verbose) {
		console.log(`Total time: ${formatDuration(elapsed)}`);
		console.log(
			`Throughput: ${((options.games * options.profiles.length) / (elapsed / 1000)).toFixed(1)} games/second`,
		);
	}
}

async function main(): Promise<void> {
	const options = parseOptions();
	if (!options) {
		process.exit(0);
	}

	try {
		await runSimulation(options);
	} catch (error) {
		console.error('Error:', error instanceof Error ? error.message : error);
		if (process.env.DEBUG) {
			console.error(error);
		}
		process.exit(1);
	}
}

main();
