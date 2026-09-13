#!/usr/bin/env bun

/**
 * AKG Check CLI
 *
 * Runs invariant checks against the architectural knowledge graph.
 *
 * Usage:
 *   bun run packages/web/src/tools/akg/cli/check.ts [options]
 *
 * Options:
 *   --config <path>    Path to akg.config.ts (default: auto-detect)
 *   --graph <path>     Path to graph JSON (default: from config)
 *   --only <ids>       Comma-separated invariant IDs to run
 *   --skip <ids>       Comma-separated invariant IDs to skip
 *   --verbose          Enable verbose logging
 *   --fail-on-warning  Exit with error code on warnings
 *   --json             Output results as JSON
 *   --sarif            Output results as SARIF 2.1.0 (for GitHub Code Scanning)
 *   --list             List available invariants
 *
 * @see docs/architecture/akg/README.md
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from '../config/index.js';
import { formatSummary, getRegistry, runInvariants, validateGraph } from '../invariants/index.js';
import { toSarifString } from '../output/sarif.js';
import { type AKGGraph, AKGGraph as AKGGraphSchema } from '../schema/graph.schema.js';
import type { CheckSummary } from '../schema/invariant.schema.js';

// =============================================================================
// Types
// =============================================================================

interface CheckOptions {
	configPath?: string;
	graphPath?: string;
	only?: string[];
	skip?: string[];
	verbose?: boolean;
	failOnWarning?: boolean;
	json?: boolean;
	sarif?: boolean;
	list?: boolean;
}

// biome-ignore lint/suspicious/noConsole: CLI tool requires console output
const log = (msg: string) => console.log(msg);
const logError = (msg: string) => console.error(msg);

// =============================================================================
// Main Check Function
// =============================================================================

/**
 * Run invariant checks against the graph
 */
export async function check(options: CheckOptions = {}): Promise<CheckSummary> {
	const verbose = options.verbose ?? false;

	// Find project root
	const projectRoot = findProjectRoot();
	if (verbose) log(`Project root: ${projectRoot}`);

	// Load configuration
	const config = await loadConfig(options.configPath, projectRoot);
	if (verbose) log(`Loaded config for project: ${config.project}`);

	// Determine graph path
	const graphPath =
		options.graphPath ?? config.output?.graphPath ?? 'docs/architecture/akg/graph/current.json';
	const absoluteGraphPath = resolve(projectRoot, graphPath);

	if (!existsSync(absoluteGraphPath)) {
		throw new Error(
			`Graph file not found: ${graphPath}\nRun 'pnpm akg:discover' first to generate the graph.`,
		);
	}

	// Load and validate graph
	if (verbose) log(`Loading graph from ${graphPath}...`);
	const graphJson = readFileSync(absoluteGraphPath, 'utf-8');
	const graphData = JSON.parse(graphJson);

	const parseResult = AKGGraphSchema.safeParse(graphData);
	if (!parseResult.success) {
		throw new Error(`Invalid graph schema: ${JSON.stringify(parseResult.error.issues)}`);
	}

	const graph: AKGGraph = parseResult.data;
	if (verbose) log(`Loaded graph with ${graph.nodes.length} nodes and ${graph.edges.length} edges`);

	// Validate graph integrity
	const validationErrors = validateGraph(graph);
	if (validationErrors.length > 0) {
		throw new Error(`Graph integrity validation failed:\n- ${validationErrors.join('\n- ')}`);
	}

	// Run invariant checks
	if (verbose) log('\nRunning invariant checks...');

	const summary = await runInvariants(graph, config, {
		only: options.only,
		skip: options.skip,
		verbose,
		logger: log,
	});

	return summary;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Find the project root by looking for package.json
 */
function findProjectRoot(): string {
	let dir = process.cwd();
	while (dir !== '/') {
		if (existsSync(join(dir, 'package.json'))) {
			// Check if this is the monorepo root (has packages/)
			if (existsSync(join(dir, 'packages'))) {
				return dir;
			}
		}
		dir = dirname(dir);
	}
	return process.cwd();
}

/**
 * List all available invariants
 */
function listInvariants(): void {
	const registry = getRegistry();
	const invariants = registry.getAll();

	log('\nAvailable Invariants:');
	log('═══════════════════════════════════════════════════════════════\n');

	// Group by category
	const byCategory = new Map<string, typeof invariants>();
	for (const inv of invariants) {
		const category = inv.definition.category;
		const existing = byCategory.get(category) ?? [];
		existing.push(inv);
		byCategory.set(category, existing);
	}

	for (const [category, invs] of byCategory) {
		log(`[${category.toUpperCase()}]`);
		for (const inv of invs) {
			const def = inv.definition;
			const enabled = def.enabledByDefault ? '✓' : '○';
			const severity = def.severity === 'error' ? '🔴' : def.severity === 'warning' ? '🟡' : 'ℹ️';
			log(`  ${enabled} ${severity} ${def.id}`);
			log(`     ${def.name}`);
			log(`     ${def.description.slice(0, 70)}...`);
			log('');
		}
	}

	log('Legend:');
	log('  ✓ = Enabled by default');
	log('  ○ = Disabled by default');
	log('  🔴 = Error severity');
	log('  🟡 = Warning severity');
	log('  ℹ️  = Info severity');
}

/**
 * Determine exit code based on results and options
 */
function getExitCode(summary: CheckSummary, failOnWarning: boolean): number {
	if (summary.exitCode === 'errors') return 1;
	if (summary.exitCode === 'warnings' && failOnWarning) return 1;
	return 0;
}

// =============================================================================
// CLI Entry Point
// =============================================================================

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI argument parsing has inherent complexity
async function main() {
	const args = process.argv.slice(2);
	const options: CheckOptions = {};

	// Parse arguments
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--config':
				options.configPath = args[++i];
				break;
			case '--graph':
				options.graphPath = args[++i];
				break;
			case '--only':
				options.only = args[++i].split(',').map((s) => s.trim());
				break;
			case '--skip':
				options.skip = args[++i].split(',').map((s) => s.trim());
				break;
			case '--verbose':
			case '-v':
				options.verbose = true;
				break;
			case '--fail-on-warning':
				options.failOnWarning = true;
				break;
			case '--json':
				options.json = true;
				break;
			case '--sarif':
				options.sarif = true;
				break;
			case '--list':
			case '-l':
				options.list = true;
				break;
			case '--help':
			case '-h':
				log(`
AKG Check CLI

Usage:
  bun run packages/web/src/tools/akg/cli/check.ts [options]

Options:
  --config <path>    Path to akg.config.ts (default: auto-detect)
  --graph <path>     Path to graph JSON (default: from config)
  --only <ids>       Comma-separated invariant IDs to run
  --skip <ids>       Comma-separated invariant IDs to skip
  --verbose, -v      Enable verbose logging
  --fail-on-warning  Exit with error code on warnings
  --json             Output results as JSON
  --sarif            Output results as SARIF 2.1.0 (for GitHub Code Scanning)
  --list, -l         List available invariants
  --help, -h         Show this help

Examples:
  # Run all checks
  bun run packages/web/src/tools/akg/cli/check.ts

  # Run specific invariants
  bun run packages/web/src/tools/akg/cli/check.ts --only wasm_single_entry,store_no_circular_deps

  # Skip certain checks
  bun run packages/web/src/tools/akg/cli/check.ts --skip layer_component_isolation

  # Verbose output with JSON
  bun run packages/web/src/tools/akg/cli/check.ts -v --json
`);
				process.exit(0);
		}
	}

	// Handle list option
	if (options.list) {
		listInvariants();
		process.exit(0);
	}

	try {
		const quietMode = options.json || options.sarif;
		if (!quietMode) {
			log('AKG Check starting...\n');
		}

		const summary = await check(options);

		if (options.sarif) {
			log(toSarifString(summary, { toolVersion: '1.0.0' }));
		} else if (options.json) {
			log(JSON.stringify(summary, null, 2));
		} else {
			log(`\n${formatSummary(summary)}`);
		}

		const exitCode = getExitCode(summary, options.failOnWarning ?? false);
		process.exit(exitCode);
	} catch (error) {
		if (options.json || options.sarif) {
			log(
				JSON.stringify({
					error: true,
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		} else {
			logError(`\nCheck failed: ${error instanceof Error ? error.message : error}`);
		}
		process.exit(1);
	}
}

// Run if executed directly
main();
