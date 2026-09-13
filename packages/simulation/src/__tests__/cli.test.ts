/**
 * CLI Module Tests
 *
 * Tests for argument parsing and CLI utilities.
 */

import { describe, expect, it } from 'vitest';
import {
	formatDuration,
	formatNumber,
	getBoolean,
	getList,
	getNumber,
	getString,
	parseArgs,
	parseDuration,
} from '../cli/args.js';

describe('CLI Argument Parser', () => {
	describe('parseArgs', () => {
		it('should parse simple command', () => {
			const args = parseArgs(['run']);
			expect(args.command).toBe('run');
			expect(args.positional).toEqual([]);
			expect(args.options).toEqual({});
		});

		it('should parse --key=value format', () => {
			const args = parseArgs(['--games=100', '--seed=42']);
			expect(args.options).toEqual({ games: '100', seed: '42' });
		});

		it('should parse --key value format', () => {
			const args = parseArgs(['--games', '100', '--seed', '42']);
			expect(args.options).toEqual({ games: '100', seed: '42' });
		});

		it('should parse boolean flags', () => {
			const args = parseArgs(['--verbose', '--json']);
			expect(args.options).toEqual({ verbose: true, json: true });
		});

		it('should parse short flags', () => {
			const args = parseArgs(['-v', '-n', '5']);
			expect(args.options).toEqual({ v: true, n: '5' });
		});

		it('should handle command with options', () => {
			const args = parseArgs(['run', '--games=100', '--verbose']);
			expect(args.command).toBe('run');
			expect(args.options).toEqual({ games: '100', verbose: true });
		});

		it('should handle positional arguments', () => {
			const args = parseArgs(['run', 'file1.ts', 'file2.ts', '--verbose']);
			expect(args.command).toBe('run');
			expect(args.positional).toEqual(['file1.ts', 'file2.ts']);
			expect(args.options.verbose).toBe(true);
		});

		it('should handle equals sign in value', () => {
			const args = parseArgs(['--filter=name=test']);
			expect(args.options.filter).toBe('name=test');
		});

		it('should handle empty args', () => {
			const args = parseArgs([]);
			expect(args.command).toBeUndefined();
			expect(args.positional).toEqual([]);
			expect(args.options).toEqual({});
		});
	});

	describe('getString', () => {
		it('should get string value', () => {
			const args = parseArgs(['--name=test']);
			expect(getString(args, 'name')).toBe('test');
		});

		it('should return default for missing key', () => {
			const args = parseArgs([]);
			expect(getString(args, 'name', 'default')).toBe('default');
		});

		it('should return undefined when no default', () => {
			const args = parseArgs([]);
			expect(getString(args, 'name')).toBeUndefined();
		});

		it('should ignore boolean values', () => {
			const args = parseArgs(['--verbose']);
			expect(getString(args, 'verbose', 'default')).toBe('default');
		});
	});

	describe('getNumber', () => {
		it('should parse integer', () => {
			const args = parseArgs(['--count=42']);
			expect(getNumber(args, 'count')).toBe(42);
		});

		it('should return default for missing key', () => {
			const args = parseArgs([]);
			expect(getNumber(args, 'count', 10)).toBe(10);
		});

		it('should return undefined for invalid number', () => {
			const args = parseArgs(['--count=abc']);
			expect(getNumber(args, 'count')).toBeUndefined();
		});
	});

	describe('getBoolean', () => {
		it('should return true for flag', () => {
			const args = parseArgs(['--verbose']);
			expect(getBoolean(args, 'verbose')).toBe(true);
		});

		it('should return default for missing key', () => {
			const args = parseArgs([]);
			expect(getBoolean(args, 'verbose')).toBe(false);
			expect(getBoolean(args, 'verbose', true)).toBe(true);
		});

		it('should parse "true" string', () => {
			const args = parseArgs(['--verbose=true']);
			expect(getBoolean(args, 'verbose')).toBe(true);
		});

		it('should parse "false" string', () => {
			const args = parseArgs(['--verbose=false']);
			expect(getBoolean(args, 'verbose')).toBe(false);
		});

		it('should parse "1" as true', () => {
			const args = parseArgs(['--verbose=1']);
			expect(getBoolean(args, 'verbose')).toBe(true);
		});
	});

	describe('getList', () => {
		it('should parse comma-separated values', () => {
			const args = parseArgs(['--profiles=a,b,c']);
			expect(getList(args, 'profiles')).toEqual(['a', 'b', 'c']);
		});

		it('should trim whitespace', () => {
			const args = parseArgs(['--profiles=a , b , c']);
			expect(getList(args, 'profiles')).toEqual(['a', 'b', 'c']);
		});

		it('should return default for missing key', () => {
			const args = parseArgs([]);
			expect(getList(args, 'profiles', ['default'])).toEqual(['default']);
		});

		it('should return empty array when no default', () => {
			const args = parseArgs([]);
			expect(getList(args, 'profiles')).toEqual([]);
		});
	});

	describe('parseDuration', () => {
		it('should parse milliseconds', () => {
			expect(parseDuration('1000')).toBe(1000);
			expect(parseDuration('500ms')).toBe(500);
		});

		it('should parse seconds', () => {
			expect(parseDuration('30s')).toBe(30000);
			expect(parseDuration('1.5s')).toBe(1500);
		});

		it('should parse minutes', () => {
			expect(parseDuration('5m')).toBe(300000);
			expect(parseDuration('0.5m')).toBe(30000);
		});

		it('should parse hours', () => {
			expect(parseDuration('1h')).toBe(3600000);
			expect(parseDuration('0.5h')).toBe(1800000);
		});

		it('should throw for invalid format', () => {
			expect(() => parseDuration('invalid')).toThrow('Invalid duration format');
			expect(() => parseDuration('10x')).toThrow('Invalid duration format');
		});
	});

	describe('formatDuration', () => {
		it('should format milliseconds', () => {
			expect(formatDuration(500)).toBe('500ms');
			expect(formatDuration(999)).toBe('999ms');
		});

		it('should format seconds', () => {
			expect(formatDuration(1000)).toBe('1.00s');
			expect(formatDuration(5500)).toBe('5.50s');
			expect(formatDuration(59000)).toBe('59.00s');
		});

		it('should format minutes', () => {
			expect(formatDuration(60000)).toBe('1.00m');
			expect(formatDuration(150000)).toBe('2.50m');
		});

		it('should format hours', () => {
			expect(formatDuration(3600000)).toBe('1.00h');
			expect(formatDuration(5400000)).toBe('1.50h');
		});
	});

	describe('formatNumber', () => {
		it('should format with locale separators', () => {
			// Note: exact format depends on locale, but should have separators
			const formatted = formatNumber(1000000);
			expect(formatted).toContain('1');
			expect(formatted.length).toBeGreaterThan(6); // Has separators
		});

		it('should format small numbers', () => {
			expect(formatNumber(42)).toBe('42');
			expect(formatNumber(999)).toBe('999');
		});
	});
});

describe('CLI Integration', () => {
	// Note: These are smoke tests to verify the modules can be imported
	// Full CLI testing would require spawning subprocesses

	it('should export all argument utilities', async () => {
		const args = await import('../cli/args.js');
		expect(args.parseArgs).toBeDefined();
		expect(args.getString).toBeDefined();
		expect(args.getNumber).toBeDefined();
		expect(args.getBoolean).toBeDefined();
		expect(args.getList).toBeDefined();
		expect(args.parseDuration).toBeDefined();
		expect(args.formatDuration).toBeDefined();
		expect(args.formatNumber).toBeDefined();
		expect(args.printHelp).toBeDefined();
	});

	it('should export from cli index', async () => {
		const cli = await import('../cli/index.js');
		expect(cli.parseArgs).toBeDefined();
		expect(cli.getString).toBeDefined();
		expect(cli.formatDuration).toBeDefined();
	});
});
