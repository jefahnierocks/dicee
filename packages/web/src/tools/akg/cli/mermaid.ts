#!/usr/bin/env bun

/**
 * AKG Mermaid Diagram CLI
 *
 * Generates Mermaid diagrams from the AKG graph.
 *
 * Usage:
 *   bun run packages/web/src/tools/akg/cli/mermaid.ts [options]
 *
 * Options:
 *   --output <dir>    Output directory (default: docs/architecture/akg/diagrams)
 *   --type <type>     Diagram type: layer, store, component, all (default: all)
 *   --check           Verify diagrams are current (for CI)
 *   --verbose         Enable verbose logging
 *
 * @see docs/architecture/akg/README.md
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadConfig } from '../config/index.js';
import {
	checkStaleness,
	type DiagramJson,
	type DiagramResult,
	type DiagramType,
	generateAllDiagrams,
	generateComponentDependencies,
	generateDataflow,
	generateGraphHash,
	generateLayerArchitecture,
	generateStoreDependencies,
	getDiagramFilename,
} from '../output/mermaid.js';
import type { AKGGraph } from '../schema/graph.schema.js';

// =============================================================================
// Types
// =============================================================================

interface MermaidCliOptions {
	outputDir?: string;
	type?: 'layer' | 'store' | 'component' | 'dataflow' | 'all';
	check?: boolean;
	verbose?: boolean;
}

// biome-ignore lint/suspicious/noConsole: CLI tool requires console output
const log = (msg: string) => console.log(msg);
const logError = (msg: string) => console.error(msg);

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Find project root
 */
function findProjectRoot(): string {
	let dir = process.cwd();
	while (dir !== '/') {
		if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'packages'))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return process.cwd();
}

/**
 * Get current git commit
 */
function getGitCommit(): string | undefined {
	try {
		return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
	} catch {
		return undefined;
	}
}

/**
 * Load the AKG graph from disk
 */
async function loadGraph(
	projectRoot: string,
	config: { output?: { graphPath?: string } },
): Promise<AKGGraph> {
	const graphPath = config.output?.graphPath ?? 'docs/architecture/akg/graph/current.json';
	const absolutePath = resolve(projectRoot, graphPath);

	if (!existsSync(absolutePath)) {
		throw new Error(`Graph file not found: ${graphPath}. Run 'pnpm akg:discover' first.`);
	}

	const content = await readFile(absolutePath, 'utf-8');
	return JSON.parse(content) as AKGGraph;
}

/**
 * Write diagram files (markdown + JSON sidecar)
 */
async function writeDiagram(
	result: DiagramResult,
	outputDir: string,
	verbose: boolean,
): Promise<void> {
	const filename = getDiagramFilename(result.type);
	const mdPath = join(outputDir, `${filename}.md`);
	const jsonPath = join(outputDir, `${filename}.json`);

	// Ensure output directory exists
	await mkdir(outputDir, { recursive: true });

	// Write markdown
	await writeFile(mdPath, result.markdown);
	if (verbose) log(`  Wrote ${filename}.md`);

	// Write JSON sidecar
	await writeFile(jsonPath, JSON.stringify(result.json, null, '\t'));
	if (verbose) log(`  Wrote ${filename}.json`);
}

/**
 * Generate README index for diagrams directory
 */
async function writeReadmeIndex(
	results: DiagramResult[],
	outputDir: string,
	verbose: boolean,
): Promise<void> {
	const lines: string[] = [
		'# AKG Architecture Diagrams',
		'',
		'> Auto-generated diagrams from the Architectural Knowledge Graph.',
		'> Do not edit directly. Run `pnpm akg:mermaid` to regenerate.',
		'',
		'## Available Diagrams',
		'',
	];

	for (const result of results) {
		const filename = getDiagramFilename(result.type);
		const title = result.type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
		lines.push(`- [${title}](./${filename}.md)`);
	}

	lines.push('', '## Verification', '');
	lines.push('To verify diagrams are current:');
	lines.push('```bash');
	lines.push('pnpm akg:mermaid --check');
	lines.push('```');
	lines.push('');
	lines.push('To regenerate all diagrams:');
	lines.push('```bash');
	lines.push('pnpm akg:mermaid');
	lines.push('```');
	lines.push('');

	const readmePath = join(outputDir, 'README.md');
	await writeFile(readmePath, lines.join('\n'));
	if (verbose) log('  Wrote README.md');
}

/**
 * Check if existing diagrams are stale
 */
async function checkDiagramStaleness(
	outputDir: string,
	graph: AKGGraph,
	verbose: boolean,
): Promise<{ stale: boolean; details: string[] }> {
	const details: string[] = [];
	let hasStale = false;

	const diagramTypes: DiagramType[] = [
		'layer_architecture',
		'store_dependencies',
		'component_dependencies',
		'dataflow',
	];

	for (const type of diagramTypes) {
		const filename = getDiagramFilename(type);
		const jsonPath = join(outputDir, `${filename}.json`);

		if (!existsSync(jsonPath)) {
			details.push(`${filename}: MISSING`);
			hasStale = true;
			continue;
		}

		try {
			const content = await readFile(jsonPath, 'utf-8');
			const existingJson = JSON.parse(content) as DiagramJson;
			const result = checkStaleness(existingJson, graph);

			if (result.stale) {
				details.push(`${filename}: STALE - ${result.reason}`);
				hasStale = true;
			} else if (verbose) {
				details.push(`${filename}: OK`);
			}
		} catch (error) {
			details.push(`${filename}: ERROR - ${error}`);
			hasStale = true;
		}
	}

	return { stale: hasStale, details };
}

/**
 * Main CLI function
 */
async function main() {
	const args = process.argv.slice(2);
	const options: MermaidCliOptions = {};

	// Parse arguments
	for (let i = 0; i < args.length; i++) {
		switch (args[i]) {
			case '--output':
			case '-o':
				options.outputDir = args[++i];
				break;
			case '--type':
			case '-t':
				options.type = args[++i] as MermaidCliOptions['type'];
				break;
			case '--check':
				options.check = true;
				break;
			case '--verbose':
			case '-v':
				options.verbose = true;
				break;
			case '--help':
			case '-h':
				log(`
AKG Mermaid Diagram Generator

Usage:
  bun run packages/web/src/tools/akg/cli/mermaid.ts [options]

Options:
  --output, -o <dir>   Output directory (default: docs/architecture/akg/diagrams)
  --type, -t <type>    Diagram type: layer, store, component, dataflow, all (default: all)
  --check              Verify diagrams are current (for CI)
  --verbose, -v        Enable verbose logging
  --help, -h           Show this help
`);
				process.exit(0);
		}
	}

	const projectRoot = findProjectRoot();
	const config = await loadConfig(undefined, projectRoot);
	const outputDir = options.outputDir
		? resolve(projectRoot, options.outputDir)
		: resolve(projectRoot, 'docs/architecture/akg/diagrams');

	// Load graph
	const graph = await loadGraph(projectRoot, config);
	const verbose = options.verbose ?? false;

	if (verbose) {
		log(`Project root: ${projectRoot}`);
		log(`Output dir: ${outputDir}`);
		log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
	}

	// Check mode
	if (options.check) {
		log('Checking diagram staleness...');
		const { stale, details } = await checkDiagramStaleness(outputDir, graph, verbose);

		for (const detail of details) {
			log(`  ${detail}`);
		}

		if (stale) {
			logError('\n⚠️ Diagrams are stale. Run: pnpm akg:mermaid');
			process.exit(1);
		}

		log('\n✓ All diagrams are current');
		process.exit(0);
	}

	// Generation mode
	log('Generating Mermaid diagrams...');

	const mermaidOptions = {
		sourceCommit: getGitCommit(),
		maxNodes: 30,
		includeForbiddenImports: true,
	};

	let results: DiagramResult[] = [];

	switch (options.type) {
		case 'layer':
			results = [generateLayerArchitecture(graph, config, mermaidOptions)];
			break;
		case 'store':
			results = [generateStoreDependencies(graph, config, mermaidOptions)];
			break;
		case 'component':
			results = [generateComponentDependencies(graph, config, mermaidOptions)];
			break;
		case 'dataflow':
			results = [generateDataflow(graph, config, mermaidOptions)];
			break;
		default:
			results = generateAllDiagrams(graph, config, mermaidOptions);
	}

	// Write outputs
	for (const result of results) {
		await writeDiagram(result, outputDir, verbose);
	}

	// Write README index
	if (options.type === 'all' || !options.type) {
		await writeReadmeIndex(results, outputDir, verbose);
	}

	log(`\n✓ Generated ${results.length} diagram(s)`);
	log(`  Output: ${outputDir}`);
	log(`  Graph hash: ${generateGraphHash(graph).slice(0, 20)}...`);
}

// Run
main().catch((error) => {
	logError(`Error: ${error.message}`);
	process.exit(1);
});
