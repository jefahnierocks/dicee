/**
 * AKG Discovery - Node Factory
 *
 * Creates AKG graph nodes from discovered source files.
 * Classifies nodes by type, layer, and component characteristics.
 *
 * @see docs/architecture/akg/README.md
 */

import { basename, relative } from 'node:path';
import type { SourceFile } from 'ts-morph';
import type { AKGConfig } from '../schema/config.schema.js';
import {
	type AKGNode,
	type ComponentClassification,
	type Confidence,
	createMetadata,
	type DiscoveryMethod,
	type ExportKind,
	generateNodeId,
	type NodeType,
} from '../schema/graph.schema.js';
import { getExports, usesRunes as tsUsesRunes } from './project.js';
import { isSmartContainer, type SvelteAnalysis, usesRunes } from './svelte-parser.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for node creation
 */
export interface NodeCreationOptions {
	/** Project root for relative paths */
	projectRoot: string;
	/** AKG configuration for layer classification */
	config: AKGConfig;
	/** Discovery method */
	discoveryMethod?: DiscoveryMethod;
	/** Confidence level */
	confidence?: Confidence;
}

/**
 * Layer match result
 */
interface LayerMatch {
	name: string;
	description?: string;
}

// =============================================================================
// Node Creation - TypeScript Files
// =============================================================================

/**
 * Create an AKG node from a TypeScript source file
 *
 * @param sourceFile - ts-morph SourceFile
 * @param options - Node creation options
 * @returns Created AKG node
 */
export function createNodeFromTS(sourceFile: SourceFile, options: NodeCreationOptions): AKGNode {
	const filePath = sourceFile.getFilePath();
	const relativePath = relative(options.projectRoot, filePath);
	const fileName = basename(filePath);
	const name = fileName.replace(/\.(ts|js)$/, '');

	// Determine node type based on file location and content
	const nodeType = classifyTSFile(relativePath, sourceFile);

	// Get layer classification
	const layer = getLayerForPath(relativePath, options.config);

	// Extract exports
	const exports = getExports(sourceFile);
	const exportDefs = exports.map((exp) => ({
		name: exp.name,
		kind: exp.kind as ExportKind,
		line: exp.line,
	}));

	// Build node ID
	const nodeId = generateNodeId(nodeType, name, relativePath);

	return {
		id: nodeId,
		type: nodeType,
		name,
		filePath: relativePath,
		attributes: {
			layer: layer?.name,
			package: getPackageName(relativePath),
			isExported: exports.length > 0,
			exports: exportDefs,
			usesRunes: tsUsesRunes(sourceFile),
			startLine: 1,
			endLine: sourceFile.getEndLineNumber(),
		},
		metadata: createMetadata(
			options.confidence ?? 'high',
			options.discoveryMethod ?? 'static_analysis',
		),
	};
}

/**
 * Classify a TypeScript file based on path and content
 */
function classifyTSFile(relativePath: string, _sourceFile: SourceFile): NodeType {
	// Check for specific patterns
	if (relativePath.includes('.svelte.ts')) {
		return 'Store';
	}
	if (relativePath.includes('/stores/')) {
		return 'Store';
	}
	if (relativePath.includes('/services/')) {
		return 'Service';
	}
	if (relativePath.includes('/types/') || relativePath.includes('/types.ts')) {
		return 'Type';
	}
	if (relativePath.includes('/wasm/') || relativePath.includes('engine.ts')) {
		return 'WASMBridge';
	}
	if (relativePath.includes('/supabase/')) {
		return 'SupabaseModule';
	}
	if (relativePath.includes('partykit') && relativePath.includes('server')) {
		return 'PartyKitServer';
	}

	// Default to Module
	return 'Module';
}

// =============================================================================
// Node Creation - Svelte Components
// =============================================================================

/**
 * Create an AKG node from a Svelte component analysis
 *
 * @param analysis - Svelte analysis result
 * @param options - Node creation options
 * @returns Created AKG node
 */
export function createNodeFromSvelte(
	analysis: SvelteAnalysis,
	options: NodeCreationOptions,
): AKGNode {
	const relativePath = relative(options.projectRoot, analysis.filePath);
	const fileName = basename(analysis.filePath);
	const name = fileName.replace(/\.svelte$/, '');

	// Determine node type (Component, SmartContainer, Route, Layout)
	const nodeType = classifySvelteFile(relativePath, analysis);

	// Determine component classification (smart vs dumb)
	const classification = getComponentClassification(analysis);

	// Get layer
	const layer = getLayerForPath(relativePath, options.config);

	// Build node ID
	const nodeId = generateNodeId(nodeType, name, relativePath);

	return {
		id: nodeId,
		type: nodeType,
		name,
		filePath: relativePath,
		attributes: {
			layer: layer?.name,
			package: getPackageName(relativePath),
			classification,
			hasSlots: analysis.template.hasSlots,
			usesRunes: usesRunes(analysis.scripts),
			startLine: 1,
			// Note: could extract end line from AST if needed
		},
		metadata: createMetadata(
			options.confidence ?? 'high',
			options.discoveryMethod ?? 'static_analysis',
		),
	};
}

/**
 * Classify a Svelte file based on path and content
 */
function classifySvelteFile(relativePath: string, analysis: SvelteAnalysis): NodeType {
	// Routes
	if (relativePath.includes('/routes/')) {
		if (relativePath.includes('+layout')) {
			return 'Layout';
		}
		if (relativePath.includes('+page') || relativePath.includes('+error')) {
			return 'Route';
		}
	}

	// Smart containers import stores/services
	if (isSmartContainer(analysis.scripts)) {
		return 'SmartContainer';
	}

	// Default component
	return 'Component';
}

/**
 * Determine if a component is smart (imports stores/services) or dumb
 */
function getComponentClassification(analysis: SvelteAnalysis): ComponentClassification {
	if (isSmartContainer(analysis.scripts)) {
		return 'smart';
	}
	return 'dumb';
}

// =============================================================================
// Layer Classification
// =============================================================================

/**
 * Get the layer for a file path based on configuration
 *
 * @param relativePath - Relative file path
 * @param config - AKG configuration with layer definitions
 * @returns Matched layer or undefined
 */
export function getLayerForPath(relativePath: string, config: AKGConfig): LayerMatch | undefined {
	const layers = config.layers ?? [];

	for (const layer of layers) {
		for (const pattern of layer.paths) {
			if (matchesGlobPattern(relativePath, pattern)) {
				return {
					name: layer.name,
					description: layer.description,
				};
			}
		}
	}

	return undefined;
}

/**
 * Simple glob pattern matching
 */
function matchesGlobPattern(path: string, pattern: string): boolean {
	// Normalize path separators
	const normalizedPath = path.replace(/\\/g, '/');
	const normalizedPattern = pattern.replace(/\\/g, '/');

	// Convert glob to regex
	const regexPattern = normalizedPattern
		.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
		.replace(/\*\*/g, '<<<GLOBSTAR>>>') // Preserve **
		.replace(/\*/g, '[^/]*') // * matches any except /
		.replace(/<<<GLOBSTAR>>>/g, '.*') // ** matches anything
		.replace(/\?/g, '.'); // ? matches single char

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(normalizedPath);
}

// =============================================================================
// Package Identification
// =============================================================================

/**
 * Extract package name from file path
 */
function getPackageName(relativePath: string): string {
	if (relativePath.startsWith('packages/web/')) {
		return '@dicee/web';
	}
	if (relativePath.startsWith('packages/cloudflare-do/')) {
		return '@dicee/cloudflare-do';
	}
	if (relativePath.startsWith('packages/shared/')) {
		return '@dicee/shared';
	}
	if (relativePath.startsWith('packages/simulation/')) {
		return '@dicee/simulation';
	}
	if (relativePath.startsWith('packages/partykit/')) {
		return '@dicee/partykit';
	}
	if (relativePath.startsWith('packages/engine/')) {
		return '@dicee/engine';
	}
	return 'unknown';
}

// =============================================================================
// Layer Node Creation
// =============================================================================

/**
 * Create virtual Layer nodes from configuration
 *
 * @param config - AKG configuration
 * @returns Array of Layer nodes
 */
export function createLayerNodes(config: AKGConfig): AKGNode[] {
	const layers = config.layers ?? [];

	return layers.map((layer) => ({
		id: generateNodeId('Layer', layer.name),
		type: 'Layer' as NodeType,
		name: layer.name,
		attributes: {
			description: layer.description,
			mayImport: layer.mayImport,
			mayNotImport: layer.mayNotImport,
			notes: layer.notes,
		},
		metadata: createMetadata('high', 'manual'),
	}));
}

/**
 * Create Package nodes for discovered packages
 *
 * @param packages - Array of package names
 * @returns Array of Package nodes
 */
export function createPackageNodes(packages: string[]): AKGNode[] {
	return packages.map((pkg) => ({
		id: generateNodeId('Package', pkg),
		type: 'Package' as NodeType,
		name: pkg,
		attributes: {},
		metadata: createMetadata('high', 'static_analysis'),
	}));
}

// =============================================================================
// Batch Node Creation
// =============================================================================

/**
 * Create nodes from multiple TypeScript files
 */
export function createNodesFromTSFiles(
	sourceFiles: SourceFile[],
	options: NodeCreationOptions,
): AKGNode[] {
	return sourceFiles.map((sf) => createNodeFromTS(sf, options));
}

/**
 * Create nodes from multiple Svelte analyses
 */
export function createNodesFromSvelteFiles(
	analyses: SvelteAnalysis[],
	options: NodeCreationOptions,
): AKGNode[] {
	return analyses.map((analysis) => createNodeFromSvelte(analysis, options));
}
