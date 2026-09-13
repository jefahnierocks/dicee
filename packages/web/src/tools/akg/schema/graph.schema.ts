/**
 * AKG Graph Schema
 *
 * Zod 4 schemas for the Architectural Knowledge Graph structure.
 * Defines nodes, edges, and the complete graph container.
 *
 * @see docs/architecture/akg/README.md
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';

// =============================================================================
// Node Types
// =============================================================================

/**
 * Node type taxonomy aligned with Dicee architecture
 */
export const NodeType = z.enum([
	// File-level
	'Module', // Generic .ts file
	'Component', // .svelte file
	'SmartContainer', // Component importing stores/services
	'Store', // .svelte.ts store file
	'Service', // Business logic module
	'Type', // Type definition file
	'Route', // SvelteKit route
	'Layout', // SvelteKit layout

	// Package-level
	'WASMBridge', // engine.ts
	'WASMModule', // Generated WASM bindings
	'SupabaseModule', // Supabase client/helpers
	'PartyKitServer', // PartyKit server entry

	// Meta-level
	'Layer', // Architectural layer (virtual node)
	'Package', // Package boundary (web, partykit, engine)
]);

export type NodeType = z.infer<typeof NodeType>;

/**
 * Confidence level for discovered information
 */
export const Confidence = z.enum(['high', 'medium', 'low']);

export type Confidence = z.infer<typeof Confidence>;

/**
 * Discovery method
 */
export const DiscoveryMethod = z.enum(['static_analysis', 'inference', 'manual']);

export type DiscoveryMethod = z.infer<typeof DiscoveryMethod>;

/**
 * Metadata attached to all graph entities
 */
export const Metadata = z.object({
	discoveredAt: z.iso.datetime(),
	confidence: Confidence,
	lastVerified: z.iso.datetime().optional(),
	discoveryMethod: DiscoveryMethod.optional(),
});

export type Metadata = z.infer<typeof Metadata>;

/**
 * Component classification for layer enforcement
 */
export const ComponentClassification = z.enum(['smart', 'dumb', 'unknown']);

export type ComponentClassification = z.infer<typeof ComponentClassification>;

/**
 * Export kind
 */
export const ExportKind = z.enum([
	'function',
	'class',
	'const',
	'type',
	'interface',
	'default',
	'unknown',
]);

export type ExportKind = z.infer<typeof ExportKind>;

/**
 * Export definition
 */
export const ExportDefinition = z.object({
	name: z.string(),
	kind: ExportKind,
	line: z.number().int().positive(),
});

export type ExportDefinition = z.infer<typeof ExportDefinition>;

/**
 * Node attributes (varies by node type)
 */
export const NodeAttributes = z
	.object({
		// Common
		layer: z.string().optional(), // Layer this node belongs to
		package: z.string().optional(), // Package name

		// Component-specific
		classification: ComponentClassification.optional(),
		propsInterface: z.string().optional(), // Name of Props interface
		hasSlots: z.boolean().optional(),
		usesRunes: z.boolean().optional(),

		// Store-specific
		isExported: z.boolean().optional(),
		stateVariables: z.array(z.string()).optional(),
		derivedVariables: z.array(z.string()).optional(),

		// Export tracking
		exports: z.array(ExportDefinition).optional(),

		// Source location
		startLine: z.number().int().positive().optional(),
		endLine: z.number().int().positive().optional(),

		// Content hash for incremental discovery
		contentHash: z.string().optional(),
	})
	.passthrough(); // Allow additional attributes for extensibility

export type NodeAttributes = z.infer<typeof NodeAttributes>;

/**
 * Graph node representing a code entity
 */
export const AKGNode = z.object({
	/** Unique identifier: {type}::{name}::{filepath_hash} */
	id: z.string().min(1),

	/** Node type from taxonomy */
	type: NodeType,

	/** Human-readable name */
	name: z.string().min(1),

	/** Relative file path from project root */
	filePath: z.string().optional(),

	/** Node-specific attributes */
	attributes: NodeAttributes,

	/** Discovery metadata */
	metadata: Metadata,
});

export type AKGNode = z.infer<typeof AKGNode>;

// =============================================================================
// Edge Types
// =============================================================================

/**
 * Edge type taxonomy
 */
export const EdgeType = z.enum([
	// Import relationships
	'imports', // ES module import
	'imports_type', // Type-only import
	'dynamic_imports', // Dynamic import()

	// Component relationships
	'uses_component', // <Component> in template
	'slots_into', // Slot content relationship

	// Store relationships
	'subscribes_to', // Store subscription
	'derives_from', // $derived dependency

	// Service relationships
	'calls_service', // Service method call
	'calls_wasm', // WASM function call

	// Type relationships
	'implements', // Interface implementation
	'extends', // Class/interface extension
	'type_references', // Type usage

	// Layer relationships
	'belongs_to', // Node → Layer membership
	'allowed_import', // Layer → Layer allowed dependency
	'forbidden_import', // Layer → Layer forbidden dependency

	// Violation tracking
	'violates', // Node → Invariant violation
]);

export type EdgeType = z.infer<typeof EdgeType>;

/**
 * Evidence for an edge (how it was discovered)
 */
export const EdgeEvidence = z.object({
	filePath: z.string(),
	line: z.number().int().positive(),
	column: z.number().int().nonnegative().optional(), // 0-based (ts-morph convention)
	snippet: z.string().optional(),
	importSpecifier: z.string().optional(),
});

export type EdgeEvidence = z.infer<typeof EdgeEvidence>;

/**
 * Severity level (shared with invariants)
 */
export const Severity = z.enum(['error', 'warning', 'info']);

export type Severity = z.infer<typeof Severity>;

/**
 * Edge attributes
 */
export const EdgeAttributes = z
	.object({
		// Import-specific
		isTypeOnly: z.boolean().optional(),
		isDynamic: z.boolean().optional(),
		importedNames: z.array(z.string()).optional(),

		// Component usage
		componentProps: z.array(z.string()).optional(),

		// Violation-specific
		violationSeverity: Severity.optional(),
		violationMessage: z.string().optional(),
	})
	.passthrough();

export type EdgeAttributes = z.infer<typeof EdgeAttributes>;

/**
 * Graph edge representing a relationship
 */
export const AKGEdge = z.object({
	/** Unique identifier */
	id: z.string().min(1),

	/** Edge type from taxonomy */
	type: EdgeType,

	/** Source node ID */
	sourceNodeId: z.string().min(1),

	/** Target node ID */
	targetNodeId: z.string().min(1),

	/** Edge-specific attributes */
	attributes: EdgeAttributes,

	/** Evidence for this edge */
	evidence: z.array(EdgeEvidence),

	/** Discovery metadata */
	metadata: Metadata,
});

export type AKGEdge = z.infer<typeof AKGEdge>;

// =============================================================================
// Graph Container
// =============================================================================

/**
 * Graph metadata
 */
export const GraphMetadata = z.object({
	/** Total files analyzed */
	totalFiles: z.number().int().nonnegative(),

	/** Discovery duration in milliseconds */
	discoveryDurationMs: z.number().nonnegative(),

	/** Packages included */
	packages: z.array(z.string()).optional(),

	/** Git commit hash at discovery time */
	gitCommit: z.string().optional(),

	/** Branch name */
	gitBranch: z.string().optional(),

	/** Whether this was incremental discovery */
	incremental: z.boolean().optional(),

	/** Files changed (for incremental) */
	changedFiles: z.array(z.string()).optional(),
});

export type GraphMetadata = z.infer<typeof GraphMetadata>;

/**
 * Complete graph structure
 */
export const AKGGraph = z.object({
	/** Schema version for migration */
	version: z.string().regex(/^\d+\.\d+\.\d+$/, { error: 'Version must be semver format' }),

	/** When the graph was generated */
	generatedAt: z.iso.datetime(),

	/** Project root path (absolute) */
	projectRoot: z.string().min(1),

	/** All nodes in the graph */
	nodes: z.array(AKGNode),

	/** All edges in the graph */
	edges: z.array(AKGEdge),

	/** Graph-level metadata */
	metadata: GraphMetadata,
});

export type AKGGraph = z.infer<typeof AKGGraph>;

// =============================================================================
// Helper Types
// =============================================================================

/**
 * Node lookup map for O(1) access
 */
export type NodeMap = Map<string, AKGNode>;

/**
 * Adjacency list entry for graph traversal
 */
export interface AdjacencyEntry {
	outgoing: AKGEdge[];
	incoming: AKGEdge[];
}

/**
 * Adjacency list for graph traversal
 */
export type AdjacencyList = Map<string, AdjacencyEntry>;

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create empty graph
 */
export function createEmptyGraph(projectRoot: string): AKGGraph {
	return {
		version: '1.0.0',
		generatedAt: new Date().toISOString(),
		projectRoot,
		nodes: [],
		edges: [],
		metadata: {
			totalFiles: 0,
			discoveryDurationMs: 0,
		},
	};
}

/**
 * Stable digest for graph IDs. Truncating a normalized path caused collisions
 * between SvelteKit routes that share the same trailing path segments.
 */
function stableDigest(value: string): string {
	return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/**
 * Generate node ID
 */
export function generateNodeId(type: NodeType, name: string, filePath?: string): string {
	const pathPart = filePath ? `::${stableDigest(filePath)}` : '';
	return `${type.toLowerCase()}::${name}${pathPart}`;
}

/**
 * Generate edge ID
 */
export function generateEdgeId(type: EdgeType, sourceId: string, targetId: string): string {
	const sourceShort = sourceId.split('::').slice(0, 2).join('::');
	const targetShort = targetId.split('::').slice(0, 2).join('::');
	const digest = stableDigest(`${type}\0${sourceId}\0${targetId}`);
	return `${type}::${sourceShort}->${targetShort}::${digest}`;
}

/**
 * Create metadata with current timestamp
 */
export function createMetadata(
	confidence: Confidence = 'high',
	method: DiscoveryMethod = 'static_analysis',
): Metadata {
	return {
		discoveredAt: new Date().toISOString(),
		confidence,
		discoveryMethod: method,
	};
}

/**
 * Build node map from graph for O(1) lookups
 */
export function buildNodeMap(graph: AKGGraph): NodeMap {
	const map = new Map<string, AKGNode>();
	for (const node of graph.nodes) {
		map.set(node.id, node);
	}
	return map;
}

/**
 * Build adjacency list from graph for traversal
 */
export function buildAdjacencyList(graph: AKGGraph): AdjacencyList {
	const adj = new Map<string, AdjacencyEntry>();

	// Initialize entries for all nodes
	for (const node of graph.nodes) {
		adj.set(node.id, { outgoing: [], incoming: [] });
	}

	// Populate edges
	for (const edge of graph.edges) {
		const sourceEntry = adj.get(edge.sourceNodeId);
		const targetEntry = adj.get(edge.targetNodeId);

		if (sourceEntry) {
			sourceEntry.outgoing.push(edge);
		}
		if (targetEntry) {
			targetEntry.incoming.push(edge);
		}
	}

	return adj;
}
