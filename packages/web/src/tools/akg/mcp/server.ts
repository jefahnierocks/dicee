#!/usr/bin/env bun
/**
 * AKG MCP Server
 *
 * Model Context Protocol server providing architecture-aware queries for agents.
 * Enables real-time architectural validation and diagram generation.
 *
 * @see docs/architecture/akg/README.md
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { loadConfig } from '../config/loader.js';
import { registry } from '../invariants/registry.js';
import { runInvariants } from '../invariants/runner.js';
import { createQueryEngine, type QueryEngine } from '../query/engine.js';
import type { AKGConfig, LayerDefinition } from '../schema/config.schema.js';
import type { AKGGraph, AKGNode } from '../schema/graph.schema.js';

// Import invariant definitions to register them
import '../invariants/definitions/index.js';

// =============================================================================
// Configuration
// =============================================================================

const GRAPH_PATH = process.env.AKG_GRAPH_PATH || 'docs/architecture/akg/graph/current.json';
const _DIAGRAMS_PATH = process.env.AKG_DIAGRAMS_PATH || 'docs/architecture/akg/diagrams';

/** Cache TTL in milliseconds (5 minutes) */
const CACHE_TTL_MS = 5 * 60 * 1000;

// =============================================================================
// State Management
// =============================================================================

interface ServerState {
	graph: AKGGraph | null;
	config: AKGConfig | null;
	engine: QueryEngine | null;
	lastLoaded: Date | null;
	graphFileMtime: number | null;
	loadCount: number;
	cacheHits: number;
}

const state: ServerState = {
	graph: null,
	config: null,
	engine: null,
	lastLoaded: null,
	graphFileMtime: null,
	loadCount: 0,
	cacheHits: 0,
};

/**
 * Check if cache is stale based on file modification time
 */
function isCacheStale(): boolean {
	if (!state.lastLoaded || !state.graphFileMtime) {
		return true;
	}

	// Check if cache TTL has expired
	const age = Date.now() - state.lastLoaded.getTime();
	if (age > CACHE_TTL_MS) {
		return true;
	}

	// Check if file has been modified
	try {
		const currentMtime = statSync(GRAPH_PATH).mtimeMs;
		if (currentMtime !== state.graphFileMtime) {
			return true;
		}
	} catch {
		return true;
	}

	return false;
}

/**
 * Load or reload the graph from disk
 */
async function loadGraph(): Promise<boolean> {
	try {
		if (!existsSync(GRAPH_PATH)) {
			console.error(`[AKG MCP] Graph file not found: ${GRAPH_PATH}`);
			return false;
		}

		const fileStat = statSync(GRAPH_PATH);
		const content = readFileSync(GRAPH_PATH, 'utf-8');
		state.graph = JSON.parse(content) as AKGGraph;
		state.engine = createQueryEngine(state.graph);
		state.lastLoaded = new Date();
		state.graphFileMtime = fileStat.mtimeMs;
		state.loadCount++;

		// Load config (async)
		state.config = await loadConfig();

		console.error(
			`[AKG MCP] Loaded graph: ${state.graph.nodes.length} nodes, ${state.graph.edges.length} edges (load #${state.loadCount})`,
		);
		return true;
	} catch (error) {
		console.error(`[AKG MCP] Failed to load graph: ${error}`);
		return false;
	}
}

/**
 * Ensure graph is loaded with cache validation
 */
async function ensureLoaded(): Promise<{
	graph: AKGGraph;
	engine: QueryEngine;
	config: AKGConfig | null;
}> {
	// Check if we need to reload
	if (!state.graph || !state.engine || isCacheStale()) {
		if (!(await loadGraph())) {
			throw new Error('Graph not available. Run "pnpm akg:discover" first.');
		}
	} else {
		state.cacheHits++;
	}

	// Capture in local variables for TypeScript narrowing
	const { graph, engine, config } = state;
	if (!graph || !engine) {
		throw new Error('Graph load succeeded but state is invalid');
	}

	return { graph, engine, config };
}

/**
 * Get cache statistics
 */
function getCacheStats(): {
	loadCount: number;
	cacheHits: number;
	hitRate: number;
	lastLoaded: string | null;
	cacheAge: number | null;
} {
	const totalRequests = state.loadCount + state.cacheHits;
	return {
		loadCount: state.loadCount,
		cacheHits: state.cacheHits,
		hitRate: totalRequests > 0 ? state.cacheHits / totalRequests : 0,
		lastLoaded: state.lastLoaded?.toISOString() ?? null,
		cacheAge: state.lastLoaded ? Date.now() - state.lastLoaded.getTime() : null,
	};
}

// =============================================================================
// MCP Server Setup
// =============================================================================

const server = new McpServer(
	{
		name: 'akg',
		version: '1.0.0',
	},
	{
		capabilities: {
			tools: {},
		},
		instructions: `AKG (Architectural Knowledge Graph) server for the Dicee project.

Provides real-time architectural queries to help agents:
- Validate imports before writing code
- Understand layer boundaries
- Check invariant compliance
- Navigate the codebase structure

Use akg_check_import before adding imports to ensure architectural compliance.`,
	},
);

// =============================================================================
// Tool: akg_layer_rules
// =============================================================================

server.registerTool(
	'akg_layer_rules',
	{
		description: `Get import rules for a specific architectural layer.

Returns which layers can be imported (mayImport) and which are forbidden (mayNotImport).

Use this to understand what dependencies are allowed before writing imports.`,
		inputSchema: {
			layer: z.string().describe('Layer name (e.g., "components", "stores", "services")'),
		},
	},
	async (args) => {
		const { config } = await ensureLoaded();
		const layerName = args.layer;

		if (!config?.layers) {
			return {
				content: [{ type: 'text', text: 'No layer configuration found.' }],
			};
		}

		const layer = config.layers.find((l: LayerDefinition) => l.name === layerName);
		if (!layer) {
			const availableLayers = config.layers.map((l: LayerDefinition) => l.name).join(', ');
			return {
				content: [
					{
						type: 'text',
						text: `Layer "${layerName}" not found. Available layers: ${availableLayers}`,
					},
				],
			};
		}

		const result = {
			layer: layer.name,
			description: layer.description || null,
			paths: layer.paths,
			mayImport: layer.mayImport || [],
			mayNotImport: layer.mayNotImport || [],
			notes: layer.notes || null,
		};

		return {
			content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
		};
	},
);

// =============================================================================
// Tool: akg_node_info
// =============================================================================

server.registerTool(
	'akg_node_info',
	{
		description: `Get detailed information about a node in the architecture graph.

Returns node type, layer, file path, and connected edges (imports/dependents).

Use this to understand a file's role in the architecture.`,
		inputSchema: {
			nodeId: z
				.string()
				.optional()
				.describe('Node ID (e.g., "module::engine::eb_src_lib_engine_ts")'),
			filePath: z
				.string()
				.optional()
				.describe('File path (e.g., "packages/web/src/lib/engine.ts")'),
		},
	},
	async (args) => {
		const { engine } = await ensureLoaded();

		let node: AKGNode | undefined;
		if (args.nodeId) {
			node = engine.getNode(args.nodeId);
		} else if (args.filePath) {
			// Search by file path
			node = engine.getNodes((n) => n.filePath === args.filePath)[0];
		}

		if (!node) {
			return {
				content: [
					{
						type: 'text',
						text: `Node not found. Provide either nodeId or filePath.`,
					},
				],
			};
		}

		const outgoing = engine.getOutgoing(node.id);
		const incoming = engine.getIncoming(node.id);

		const result = {
			id: node.id,
			type: node.type,
			name: node.name,
			filePath: node.filePath || null,
			layer: node.attributes.layer || null,
			classification: node.attributes.classification || null,
			imports: outgoing
				.filter((e) => e.type === 'imports' || e.type === 'imports_type')
				.map((e) => ({
					target: e.targetNodeId,
					type: e.type,
					names: e.attributes.importedNames || [],
				})),
			importedBy: incoming
				.filter((e) => e.type === 'imports' || e.type === 'imports_type')
				.map((e) => ({
					source: e.sourceNodeId,
					type: e.type,
				})),
			edgeCounts: {
				outgoing: outgoing.length,
				incoming: incoming.length,
			},
		};

		return {
			content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
		};
	},
);

// =============================================================================
// Tool: akg_check_import
// =============================================================================

server.registerTool(
	'akg_check_import',
	{
		description: `Validate whether an import is architecturally allowed.

ALWAYS use this before adding an import statement to verify layer compliance.

Returns whether the import is allowed, forbidden, or has no specific rule.`,
		inputSchema: {
			fromPath: z.string().describe('Source file path (where the import statement will be)'),
			toPath: z.string().describe('Target file path (what is being imported)'),
		},
	},
	async (args) => {
		const { engine, config } = await ensureLoaded();

		// Find nodes by path
		const fromNode = engine.getNodes((n) => n.filePath === args.fromPath)[0];
		const toNode = engine.getNodes((n) => n.filePath === args.toPath)[0];

		if (!fromNode) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							allowed: true,
							reason: 'Source file not in graph (new file or not discovered)',
							fromPath: args.fromPath,
							toPath: args.toPath,
						}),
					},
				],
			};
		}

		if (!toNode) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							allowed: true,
							reason: 'Target file not in graph (external dependency or not discovered)',
							fromPath: args.fromPath,
							toPath: args.toPath,
						}),
					},
				],
			};
		}

		const fromLayer = fromNode.attributes.layer;
		const toLayer = toNode.attributes.layer;

		if (!fromLayer || !toLayer || !config?.layers) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							allowed: true,
							reason: 'No layer configuration or nodes without layer assignment',
							fromLayer: fromLayer || null,
							toLayer: toLayer || null,
						}),
					},
				],
			};
		}

		const layerDef = config.layers.find((l: LayerDefinition) => l.name === fromLayer);
		if (!layerDef) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							allowed: true,
							reason: `Source layer "${fromLayer}" has no configuration`,
						}),
					},
				],
			};
		}

		// Check forbidden
		if (layerDef.mayNotImport?.includes(toLayer)) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							allowed: false,
							reason: `Layer "${fromLayer}" may NOT import from "${toLayer}"`,
							fromLayer,
							toLayer,
							rule: 'mayNotImport',
							suggestion: `Consider moving shared logic to a lower layer or using dependency injection.`,
						}),
					},
				],
			};
		}

		// Check allowed
		if (layerDef.mayImport?.includes(toLayer)) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							allowed: true,
							reason: `Layer "${fromLayer}" is allowed to import from "${toLayer}"`,
							fromLayer,
							toLayer,
							rule: 'mayImport',
						}),
					},
				],
			};
		}

		// No explicit rule
		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify({
						allowed: true,
						reason: `No explicit rule for "${fromLayer}" → "${toLayer}" (implicitly allowed)`,
						fromLayer,
						toLayer,
						rule: 'none',
					}),
				},
			],
		};
	},
);

// =============================================================================
// Tool: akg_invariant_status
// =============================================================================

server.registerTool(
	'akg_invariant_status',
	{
		description: `Get the current status of architectural invariants.

Returns pass/fail state for each invariant check.

Use this to understand overall architecture health before making changes.`,
		inputSchema: {
			invariantId: z
				.string()
				.optional()
				.describe('Specific invariant ID, or omit for all invariants'),
		},
	},
	async (args) => {
		const { graph, config } = await ensureLoaded();

		if (args.invariantId) {
			// Single invariant
			const invariant = registry.get(args.invariantId);
			if (!invariant) {
				const available = registry.getIds().join(', ');
				return {
					content: [
						{
							type: 'text',
							text: `Invariant "${args.invariantId}" not found. Available: ${available}`,
						},
					],
				};
			}

			const summary = await runInvariants(graph, config ?? undefined, {
				only: [args.invariantId],
			});

			const result = summary.results[0];
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								invariantId: result.invariantId,
								passed: result.passed,
								violationCount: result.violations.length,
								violations: result.violations.slice(0, 5).map((v) => ({
									message: v.message,
									severity: v.severity,
									location: v.evidence[0]
										? `${v.evidence[0].filePath}:${v.evidence[0].line}`
										: null,
								})),
								durationMs: result.durationMs,
							},
							null,
							2,
						),
					},
				],
			};
		}

		// All invariants
		const summary = await runInvariants(graph, config ?? undefined);

		const result = {
			passed: summary.summary.passed,
			failed: summary.summary.failed,
			total: summary.summary.totalInvariants,
			errors: summary.summary.errors,
			warnings: summary.summary.warnings,
			exitCode: summary.exitCode,
			invariants: summary.results.map((r) => ({
				id: r.invariantId,
				passed: r.passed,
				violations: r.violations.length,
			})),
			durationMs: summary.totalDurationMs,
		};

		return {
			content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
		};
	},
);

// =============================================================================
// Tool: akg_diagram
// =============================================================================

server.registerTool(
	'akg_diagram',
	{
		description: `Get a Mermaid diagram of the architecture.

Available diagrams: layer-overview, component-dependencies, store-relationships, dataflow.

Returns Mermaid markdown that can be rendered as a diagram.`,
		inputSchema: {
			name: z
				.string()
				.optional()
				.default('layer-overview')
				.describe(
					'Diagram name (layer-overview, component-dependencies, store-relationships, dataflow)',
				),
		},
	},
	async (args) => {
		const { engine, config } = await ensureLoaded();
		const diagramName = args.name || 'layer-overview';

		// Generate diagram based on type
		let mermaid: string;

		switch (diagramName) {
			case 'layer-overview': {
				mermaid = generateLayerOverview(engine, config);
				break;
			}
			case 'component-dependencies': {
				mermaid = generateComponentDependencies(engine);
				break;
			}
			case 'store-relationships': {
				mermaid = generateStoreRelationships(engine);
				break;
			}
			case 'dataflow': {
				mermaid = generateDataflowDiagram(engine, config);
				break;
			}
			default: {
				return {
					content: [
						{
							type: 'text',
							text: `Unknown diagram: ${diagramName}. Available: layer-overview, component-dependencies, store-relationships, dataflow`,
						},
					],
				};
			}
		}

		return {
			content: [
				{
					type: 'text',
					text: `\`\`\`mermaid\n${mermaid}\n\`\`\``,
				},
			],
		};
	},
);

// =============================================================================
// Tool: akg_path_find
// =============================================================================

server.registerTool(
	'akg_path_find',
	{
		description: `Find the dependency path between two nodes.

Returns the shortest path of imports from source to target.

Use this for impact analysis when modifying a file.`,
		inputSchema: {
			from: z.string().describe('Source node ID or file path'),
			to: z.string().describe('Target node ID or file path'),
		},
	},
	async (args) => {
		const { engine } = await ensureLoaded();

		// Resolve node IDs
		let fromId = args.from;
		let toId = args.to;

		// Try to find by path if not a valid node ID
		if (!engine.getNode(fromId)) {
			const node = engine.getNodes((n) => n.filePath === args.from)[0];
			if (node) fromId = node.id;
		}
		if (!engine.getNode(toId)) {
			const node = engine.getNodes((n) => n.filePath === args.to)[0];
			if (node) toId = node.id;
		}

		if (!engine.getNode(fromId)) {
			return {
				content: [{ type: 'text', text: `Source node not found: ${args.from}` }],
			};
		}
		if (!engine.getNode(toId)) {
			return {
				content: [{ type: 'text', text: `Target node not found: ${args.to}` }],
			};
		}

		const path = engine.findPath(fromId, toId);

		if (!path) {
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({
							found: false,
							reason: 'No dependency path exists between these nodes',
							from: fromId,
							to: toId,
						}),
					},
				],
			};
		}

		const pathDetails = path.map((nodeId) => {
			const node = engine.getNode(nodeId);
			return {
				id: nodeId,
				name: node?.name || 'unknown',
				layer: node?.attributes.layer || null,
				filePath: node?.filePath || null,
			};
		});

		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(
						{
							found: true,
							pathLength: path.length,
							path: pathDetails,
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// =============================================================================
// Tool: akg_cache_status
// =============================================================================

server.registerTool(
	'akg_cache_status',
	{
		description: `Get cache status and optionally reload the graph.

Returns cache statistics: load count, cache hits, hit rate, and cache age.

Use reload=true to force a fresh load from disk.`,
		inputSchema: {
			reload: z.boolean().optional().describe('Set to true to force reload the graph'),
		},
	},
	async (args) => {
		if (args.reload) {
			console.error('[AKG MCP] Forcing graph reload...');
			await loadGraph();
		}

		const stats = getCacheStats();

		return {
			content: [
				{
					type: 'text',
					text: JSON.stringify(
						{
							...stats,
							graphPath: GRAPH_PATH,
							cacheTtlMs: CACHE_TTL_MS,
							reloaded: args.reload ?? false,
						},
						null,
						2,
					),
				},
			],
		};
	},
);

// =============================================================================
// Diagram Generation Helpers
// =============================================================================

function generateLayerOverview(engine: QueryEngine, config: AKGConfig | null): string {
	const lines: string[] = ['flowchart TB'];

	if (!config?.layers) {
		lines.push('  NoLayers["No layer configuration"]');
		return lines.join('\n');
	}

	// Define layer nodes
	for (const layer of config.layers) {
		const nodeCount = engine.getNodesInLayer(layer.name).length;
		lines.push(`  ${layer.name}["${layer.name}<br/>(${nodeCount} nodes)"]`);
	}

	lines.push('');

	// Add allowed imports as edges
	for (const layer of config.layers) {
		for (const target of layer.mayImport || []) {
			lines.push(`  ${layer.name} --> ${target}`);
		}
	}

	return lines.join('\n');
}

function generateComponentDependencies(engine: QueryEngine): string {
	const lines: string[] = ['flowchart LR'];

	const components = engine.getNodesByType('Component').slice(0, 20); // Limit for readability

	for (const comp of components) {
		const shortName = comp.name.replace(/\.svelte$/, '');
		lines.push(`  ${sanitizeId(comp.id)}["${shortName}"]`);
	}

	lines.push('');

	for (const comp of components) {
		const outgoing = engine.getOutgoing(comp.id);
		for (const edge of outgoing) {
			if (edge.type === 'uses_component') {
				const targetComp = components.find((c) => c.id === edge.targetNodeId);
				if (targetComp) {
					lines.push(`  ${sanitizeId(comp.id)} --> ${sanitizeId(targetComp.id)}`);
				}
			}
		}
	}

	return lines.join('\n');
}

function generateStoreRelationships(engine: QueryEngine): string {
	const lines: string[] = ['flowchart LR'];

	const stores = engine.getNodesByType('Store');

	for (const store of stores) {
		const shortName = store.name.replace(/\.svelte\.ts$/, '');
		lines.push(`  ${sanitizeId(store.id)}[("${shortName}")]`);
	}

	lines.push('');

	for (const store of stores) {
		const outgoing = engine.getOutgoing(store.id);
		for (const edge of outgoing) {
			if (edge.type === 'imports' || edge.type === 'derives_from') {
				const targetStore = stores.find((s) => s.id === edge.targetNodeId);
				if (targetStore) {
					const style = edge.type === 'derives_from' ? '-.->|derives|' : '-->';
					lines.push(`  ${sanitizeId(store.id)} ${style} ${sanitizeId(targetStore.id)}`);
				}
			}
		}
	}

	return lines.join('\n');
}

function sanitizeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Diagram generation requires nested iteration
function generateDataflowDiagram(engine: QueryEngine, _config: AKGConfig | null): string {
	const lines: string[] = ['flowchart TB'];

	const layerOrder = ['routes', 'components', 'stores', 'services', 'supabase', 'wasm'];
	const layerIcons: Record<string, string> = {
		routes: '🛣️',
		components: '🧩',
		stores: '🗄️',
		services: '⚙️',
		supabase: '🔌',
		wasm: '🦀',
	};

	// Group nodes by layer
	const layerGroups: Map<string, AKGNode[]> = new Map();
	for (const layerName of layerOrder) {
		const nodesInLayer = engine.getNodesInLayer(layerName).slice(0, 5);
		if (nodesInLayer.length > 0) {
			layerGroups.set(layerName, nodesInLayer);
		}
	}

	// Create subgraphs
	for (const layerName of layerOrder) {
		const nodes = layerGroups.get(layerName);
		if (nodes && nodes.length > 0) {
			const icon = layerIcons[layerName] ?? '📦';
			lines.push(`    subgraph ${layerName}["${icon} ${layerName.toUpperCase()}"]`);

			for (const node of nodes) {
				const nodeId = sanitizeId(node.id);
				const shortName = node.name
					.replace(/\.svelte\.ts$/, '')
					.replace(/\.svelte$/, '')
					.replace(/\.ts$/, '');
				lines.push(`        ${nodeId}["${shortName}"]`);
			}

			lines.push('    end');
			lines.push('');
		}
	}

	// Add cross-layer edges
	const allNodeIds = new Set<string>();
	for (const nodes of layerGroups.values()) {
		for (const node of nodes) {
			allNodeIds.add(node.id);
		}
	}

	for (const nodes of layerGroups.values()) {
		for (const node of nodes) {
			const outgoing = engine.getOutgoing(node.id);
			for (const edge of outgoing) {
				if (allNodeIds.has(edge.targetNodeId)) {
					if (edge.type === 'imports' || edge.type === 'uses_component') {
						lines.push(`    ${sanitizeId(node.id)} --> ${sanitizeId(edge.targetNodeId)}`);
					}
				}
			}
		}
	}

	return lines.join('\n');
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
	// Pre-load graph
	loadGraph();

	// Connect to stdio transport
	const transport = new StdioServerTransport();
	await server.connect(transport);

	console.error('[AKG MCP] Server running on stdio');
}

main().catch((error) => {
	console.error('[AKG MCP] Fatal error:', error);
	process.exit(1);
});
