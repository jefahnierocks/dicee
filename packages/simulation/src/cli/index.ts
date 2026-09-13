/**
 * CLI Module
 *
 * Command-line interface for running simulations and benchmarks.
 *
 * Commands:
 * - sim:run - Run experiments and simulations
 * - sim:bench - Benchmark throughput
 *
 * @example
 * # Run a quick experiment
 * pnpm sim:run --profiles professor --games 1000
 *
 * # Benchmark performance
 * pnpm sim:bench --duration 30s
 */

// Argument parsing utilities
export {
	formatDuration,
	formatNumber,
	getBoolean,
	getList,
	getNumber,
	getString,
	type ParsedArgs,
	parseArgs,
	parseDuration,
	printHelp,
} from './args.js';
