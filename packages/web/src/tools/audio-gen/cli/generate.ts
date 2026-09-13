#!/usr/bin/env bun

/**
 * Audio Generation CLI
 *
 * Generates audio assets using the ElevenLabs Sound Effects API.
 *
 * Usage:
 *   bun run packages/web/src/tools/audio-gen/cli/generate.ts [options]
 *
 * Options:
 *   --asset <id>       Generate a specific asset by ID (e.g., MVP-01)
 *   --phase <phase>    Generate all assets for a phase (mvp, complete)
 *   --category <cat>   Generate all assets for a category (dice, ui, score, music, ambient)
 *   --dry-run          Show what would be generated without making API calls
 *   --verbose          Enable verbose logging
 *   --output <dir>     Output directory (default: packages/web/static/audio)
 *   --list             List all defined assets
 *   --status           Show generation status from manifest
 *
 * Environment:
 *   ELEVENLABS_API_KEY  Required. Prefer:
 *                       ./scripts/with-dicee-elevenlabs-local.sh -- bun run packages/web/src/tools/audio-gen/cli/generate.ts ...
 *
 * @see packages/web/src/tools/audio-gen/README.md#audio-plan
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createClientFromEnv } from '../client/index.js';
import {
	assetRegistry,
	getAssetById,
	getAssetsByCategory,
	getAssetsByPhase,
} from '../config/index.js';
import {
	type AudioAsset,
	type GenerationManifest,
	GenerationManifestSchema,
	type GenerationResult,
	getAssetPath,
	getCategoryPath,
} from '../schema/index.js';

// =============================================================================
// Types
// =============================================================================

interface GenerateOptions {
	assetId?: string;
	phase?: 'mvp' | 'complete' | 'future';
	category?: 'dice' | 'ui' | 'score' | 'music' | 'ambient';
	dryRun?: boolean;
	verbose?: boolean;
	outputDir?: string;
	list?: boolean;
	status?: boolean;
}

const log = (msg: string) => {
	// biome-ignore lint/suspicious/noConsole: CLI tool requires console output
	console.log(msg);
};
const logError = (msg: string) => {
	console.error(msg);
};

// =============================================================================
// Manifest Management
// =============================================================================

const MANIFEST_FILENAME = 'generation-manifest.json';

function getManifestPath(outputDir: string): string {
	return join(outputDir, MANIFEST_FILENAME);
}

function loadManifest(outputDir: string): GenerationManifest {
	const path = getManifestPath(outputDir);
	if (!existsSync(path)) {
		return {
			version: '1.0.0',
			updatedAt: new Date().toISOString(),
			totalCreditsUsed: 0,
			results: {},
		};
	}

	try {
		const data = JSON.parse(readFileSync(path, 'utf-8'));
		const result = GenerationManifestSchema.safeParse(data);
		if (result.success) {
			return result.data;
		}
		log(`Warning: Invalid manifest, starting fresh`);
		return {
			version: '1.0.0',
			updatedAt: new Date().toISOString(),
			totalCreditsUsed: 0,
			results: {},
		};
	} catch {
		return {
			version: '1.0.0',
			updatedAt: new Date().toISOString(),
			totalCreditsUsed: 0,
			results: {},
		};
	}
}

function saveManifest(outputDir: string, manifest: GenerationManifest): void {
	manifest.updatedAt = new Date().toISOString();
	const path = getManifestPath(outputDir);
	writeFileSync(path, JSON.stringify(manifest, null, 2));
}

// =============================================================================
// Asset Generation
// =============================================================================

async function generateAsset(
	asset: AudioAsset,
	outputDir: string,
	manifest: GenerationManifest,
	options: GenerateOptions,
): Promise<GenerationResult> {
	const assetPath = getAssetPath(asset);
	const fullPath = join(outputDir, assetPath);
	const dir = dirname(fullPath);

	// Ensure directory exists
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	if (options.dryRun) {
		log(`  [DRY RUN] Would generate: ${assetPath}`);
		log(`    Prompt: "${asset.prompt.slice(0, 60)}..."`);
		log(`    Duration: ${asset.durationSeconds ?? 'auto'}s`);
		return {
			assetId: asset.id,
			status: 'pending',
			timestamp: new Date().toISOString(),
		};
	}

	// Update manifest to generating
	manifest.results[asset.id] = {
		assetId: asset.id,
		status: 'generating',
		timestamp: new Date().toISOString(),
	};
	saveManifest(outputDir, manifest);

	try {
		const client = createClientFromEnv({ verbose: options.verbose });

		const result = await client.generateSoundEffect({
			text: asset.prompt,
			duration_seconds: asset.durationSeconds,
			enable_looping: asset.looping,
			prompt_influence: asset.promptInfluence,
		});

		if (!result.success || !result.audioData) {
			const error = result.error ?? 'Unknown error';
			log(`  ❌ Failed: ${error}`);
			manifest.results[asset.id] = {
				assetId: asset.id,
				status: 'failed',
				timestamp: new Date().toISOString(),
				error,
				requestId: result.requestId,
			};
			saveManifest(outputDir, manifest);
			return manifest.results[asset.id];
		}

		// Write audio file
		writeFileSync(fullPath, result.audioData);
		log(`  ✅ Generated: ${assetPath} (${result.audioData.length} bytes)`);

		// Update manifest
		manifest.results[asset.id] = {
			assetId: asset.id,
			status: 'generated',
			timestamp: new Date().toISOString(),
			files: [assetPath],
			requestId: result.requestId,
		};
		saveManifest(outputDir, manifest);

		return manifest.results[asset.id];
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		log(`  ❌ Error: ${error}`);
		manifest.results[asset.id] = {
			assetId: asset.id,
			status: 'failed',
			timestamp: new Date().toISOString(),
			error,
		};
		saveManifest(outputDir, manifest);
		return manifest.results[asset.id];
	}
}

// =============================================================================
// List Command
// =============================================================================

function listAssets(): void {
	log('\n📦 Dicee Audio Asset Registry\n');
	log(`Total assets: ${assetRegistry.assets.length}\n`);

	const phases = ['mvp', 'complete', 'future'] as const;
	for (const phase of phases) {
		const assets = getAssetsByPhase(phase);
		if (assets.length === 0) continue;

		log(`\n## Phase: ${phase.toUpperCase()} (${assets.length} assets)\n`);
		log('| ID | Filename | Category | Duration |');
		log('|----|----------|----------|----------|');
		for (const asset of assets) {
			const duration = asset.durationSeconds ? `${asset.durationSeconds}s` : 'auto';
			log(`| ${asset.id} | ${asset.filename} | ${asset.category} | ${duration} |`);
		}
	}
	log('');
}

// =============================================================================
// Status Command
// =============================================================================

function showStatus(outputDir: string): void {
	const manifest = loadManifest(outputDir);

	log('\n📊 Audio Generation Status\n');
	log(`Last updated: ${manifest.updatedAt}`);
	log(`Total credits used: ${manifest.totalCreditsUsed}\n`);

	const statuses = {
		pending: 0,
		generating: 0,
		generated: 0,
		processed: 0,
		verified: 0,
		failed: 0,
	};

	for (const result of Object.values(manifest.results)) {
		statuses[result.status]++;
	}

	const total = assetRegistry.assets.length;
	const tracked = Object.keys(manifest.results).length;

	log(`Assets: ${tracked}/${total} tracked\n`);
	log('| Status | Count |');
	log('|--------|-------|');
	for (const [status, count] of Object.entries(statuses)) {
		if (count > 0) {
			log(`| ${status} | ${count} |`);
		}
	}

	// Show failed assets
	const failed = Object.values(manifest.results).filter((r) => r.status === 'failed');
	if (failed.length > 0) {
		log('\n❌ Failed Assets:\n');
		for (const result of failed) {
			log(`  - ${result.assetId}: ${result.error}`);
		}
	}

	log('');
}

// =============================================================================
// Argument Parsing
// =============================================================================

const HELP_TEXT = `
Audio Generation CLI

Usage:
  bun run packages/web/src/tools/audio-gen/cli/generate.ts [options]

Options:
  --asset <id>       Generate a specific asset by ID (e.g., MVP-01)
  --phase <phase>    Generate all assets for a phase (mvp, complete)
  --category <cat>   Generate all assets for a category
  --dry-run          Show what would be generated without API calls
  --verbose          Enable verbose logging
  --output <dir>     Output directory (default: packages/web/static/audio)
  --list             List all defined assets
  --status           Show generation status from manifest
  --help             Show this help message

Environment:
  ELEVENLABS_API_KEY  Required for generation. Prefer:
    ./scripts/with-dicee-elevenlabs-local.sh -- bun run packages/web/src/tools/audio-gen/cli/generate.ts ...

Examples:
  # List all assets
  bun run packages/web/src/tools/audio-gen/cli/generate.ts --list

  # Generate MVP assets (dry run)
  bun run packages/web/src/tools/audio-gen/cli/generate.ts --phase mvp --dry-run

  # Generate a specific asset
  bun run packages/web/src/tools/audio-gen/cli/generate.ts --asset MVP-01
`;

interface ParseResult {
	options: GenerateOptions;
	showHelp: boolean;
}

function parseArgs(args: string[]): ParseResult {
	const options: GenerateOptions = {};
	let showHelp = false;

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		switch (arg) {
			case '--asset':
				options.assetId = args[++i];
				break;
			case '--phase':
				options.phase = args[++i] as GenerateOptions['phase'];
				break;
			case '--category':
				options.category = args[++i] as GenerateOptions['category'];
				break;
			case '--dry-run':
				options.dryRun = true;
				break;
			case '--verbose':
				options.verbose = true;
				break;
			case '--output':
				options.outputDir = args[++i];
				break;
			case '--list':
				options.list = true;
				break;
			case '--status':
				options.status = true;
				break;
			case '--help':
			case '-h':
				showHelp = true;
				break;
		}
	}

	return { options, showHelp };
}

function resolveAssets(options: GenerateOptions): AudioAsset[] {
	if (options.assetId) {
		const asset = getAssetById(options.assetId);
		if (!asset) {
			logError(`Asset not found: ${options.assetId}`);
			process.exit(1);
		}
		return [asset];
	}
	if (options.phase) {
		return getAssetsByPhase(options.phase);
	}
	if (options.category) {
		return getAssetsByCategory(options.category);
	}
	logError('Please specify --asset, --phase, or --category');
	logError('Use --list to see available assets, or --help for usage');
	process.exit(1);
}

function ensureDirectories(outputDir: string): void {
	if (!existsSync(outputDir)) {
		mkdirSync(outputDir, { recursive: true });
	}
	const categories = ['dice', 'ui', 'score', 'music', 'ambient'] as const;
	for (const cat of categories) {
		const catPath = join(outputDir, getCategoryPath(cat));
		if (!existsSync(catPath)) {
			mkdirSync(catPath, { recursive: true });
		}
	}
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	const { options, showHelp } = parseArgs(process.argv.slice(2));

	if (showHelp) {
		log(HELP_TEXT);
		return;
	}

	const projectRoot = findProjectRoot();
	const outputDir = options.outputDir ?? join(projectRoot, 'packages/web/static/audio');

	if (options.list) {
		listAssets();
		return;
	}

	if (options.status) {
		showStatus(outputDir);
		return;
	}

	const assets = resolveAssets(options);
	if (assets.length === 0) {
		log('No assets to generate');
		return;
	}

	ensureDirectories(outputDir);

	log(`\n🎵 Generating ${assets.length} audio asset(s)...\n`);
	if (options.dryRun) {
		log('(DRY RUN - no API calls will be made)\n');
	}

	const manifest = loadManifest(outputDir);
	let succeeded = 0;
	let failed = 0;

	for (const asset of assets) {
		log(`\n[${asset.id}] ${asset.filename}`);
		const result = await generateAsset(asset, outputDir, manifest, options);
		if (result.status === 'generated' || result.status === 'pending') {
			succeeded++;
		} else {
			failed++;
		}
	}

	log(`\n✨ Done! ${succeeded} succeeded, ${failed} failed\n`);

	if (failed > 0) {
		process.exit(1);
	}
}

// =============================================================================
// Utilities
// =============================================================================

function findProjectRoot(): string {
	let dir = process.cwd();
	while (dir !== '/') {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return process.cwd();
}

// Run main
main().catch((err) => {
	logError(`Fatal error: ${err}`);
	process.exit(1);
});
