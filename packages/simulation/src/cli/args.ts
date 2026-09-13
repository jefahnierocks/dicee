/**
 * Simple CLI Argument Parser
 *
 * Minimal argument parsing without external dependencies.
 * Supports: --flag, --key=value, --key value, positional args
 */

export interface ParsedArgs {
	/** Named arguments (--key=value or --key value) */
	options: Record<string, string | boolean>;
	/** Positional arguments */
	positional: string[];
	/** The command name (first positional if present) */
	command?: string;
}

/**
 * Parse command line arguments
 *
 * @example
 * // node cli.js run --games=100 --seed 42 --verbose
 * parseArgs(['run', '--games=100', '--seed', '42', '--verbose'])
 * // => { command: 'run', options: { games: '100', seed: '42', verbose: true }, positional: [] }
 */
export function parseArgs(args: string[] = process.argv.slice(2)): ParsedArgs {
	const result: ParsedArgs = {
		options: {},
		positional: [],
	};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];

		if (arg.startsWith('--')) {
			const withoutDash = arg.slice(2);

			if (withoutDash.includes('=')) {
				// --key=value
				const [key, ...valueParts] = withoutDash.split('=');
				result.options[key] = valueParts.join('=');
			} else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
				// --key value
				result.options[withoutDash] = args[i + 1];
				i++;
			} else {
				// --flag (boolean)
				result.options[withoutDash] = true;
			}
		} else if (arg.startsWith('-') && arg.length === 2) {
			// Short flag -v or -v value
			const flag = arg.slice(1);
			if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
				result.options[flag] = args[i + 1];
				i++;
			} else {
				result.options[flag] = true;
			}
		} else {
			result.positional.push(arg);
		}

		i++;
	}

	// First positional is the command
	if (result.positional.length > 0) {
		result.command = result.positional.shift();
	}

	return result;
}

/**
 * Get a string option value
 */
export function getString(
	args: ParsedArgs,
	key: string,
	defaultValue?: string,
): string | undefined {
	const value = args.options[key];
	if (typeof value === 'string') return value;
	return defaultValue;
}

/**
 * Get a number option value
 */
export function getNumber(
	args: ParsedArgs,
	key: string,
	defaultValue?: number,
): number | undefined {
	const value = args.options[key];
	if (typeof value === 'string') {
		const num = Number.parseInt(value, 10);
		if (!Number.isNaN(num)) return num;
	}
	return defaultValue;
}

/**
 * Get a boolean option value
 */
export function getBoolean(args: ParsedArgs, key: string, defaultValue = false): boolean {
	const value = args.options[key];
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') {
		return value.toLowerCase() === 'true' || value === '1';
	}
	return defaultValue;
}

/**
 * Get a list option value (comma-separated)
 */
export function getList(args: ParsedArgs, key: string, defaultValue: string[] = []): string[] {
	const value = args.options[key];
	if (typeof value === 'string') {
		return value.split(',').map((s) => s.trim());
	}
	return defaultValue;
}

/**
 * Parse duration string to milliseconds
 *
 * @example
 * parseDuration('30s')  // => 30000
 * parseDuration('5m')   // => 300000
 * parseDuration('1h')   // => 3600000
 * parseDuration('100')  // => 100 (raw ms)
 */
export function parseDuration(value: string): number {
	const match = value.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
	if (!match) {
		throw new Error(`Invalid duration format: ${value}`);
	}

	const num = Number.parseFloat(match[1]);
	const unit = match[2] || 'ms';

	switch (unit) {
		case 'ms':
			return num;
		case 's':
			return num * 1000;
		case 'm':
			return num * 60 * 1000;
		case 'h':
			return num * 60 * 60 * 1000;
		default:
			return num;
	}
}

/**
 * Format duration in a human-readable way
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms.toFixed(0)}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
	if (ms < 3600000) return `${(ms / 60000).toFixed(2)}m`;
	return `${(ms / 3600000).toFixed(2)}h`;
}

/**
 * Format a number with commas
 */
export function formatNumber(n: number): string {
	return n.toLocaleString();
}

/**
 * Print usage help
 */
export function printHelp(
	programName: string,
	commands: Array<{ name: string; description: string }>,
	globalOptions: Array<{ name: string; description: string }> = [],
): void {
	console.log(`\nUsage: ${programName} <command> [options]\n`);

	console.log('Commands:');
	for (const cmd of commands) {
		console.log(`  ${cmd.name.padEnd(20)} ${cmd.description}`);
	}

	if (globalOptions.length > 0) {
		console.log('\nGlobal Options:');
		for (const opt of globalOptions) {
			console.log(`  ${opt.name.padEnd(20)} ${opt.description}`);
		}
	}

	console.log('');
}
