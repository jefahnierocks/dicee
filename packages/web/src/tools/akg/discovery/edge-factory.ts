/**
 * AKG Discovery - Edge Factory
 *
 * Creates AKG graph edges from discovered relationships.
 * Handles import edges, component usage, and layer membership.
 *
 * @see docs/architecture/akg/README.md
 */

import type { AKGConfig } from '../schema/config.schema.js';
import {
	type AKGEdge,
	type AKGNode,
	type Confidence,
	createMetadata,
	type DiscoveryMethod,
	type EdgeType,
	generateEdgeId,
	generateNodeId,
} from '../schema/graph.schema.js';
import type { ResolvedImport } from './import-analyzer.js';
import type { SvelteAnalysis } from './svelte-parser.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for edge creation
 */
export interface EdgeCreationOptions {
	/** Project root for relative paths */
	projectRoot: string;
	/** Map of file paths to node IDs */
	nodeMap: Map<string, string>;
	/** Discovery method */
	discoveryMethod?: DiscoveryMethod;
	/** Confidence level */
	confidence?: Confidence;
}

// =============================================================================
// Import Edge Creation
// =============================================================================

/**
 * Create edges from import relationships
 *
 * @param sourceNodeId - ID of the source node
 * @param imports - Resolved imports from the source
 * @param options - Edge creation options
 * @returns Array of created edges
 */
export function createImportEdges(
	sourceNodeId: string,
	imports: ResolvedImport[],
	options: EdgeCreationOptions,
): AKGEdge[] {
	const edges: AKGEdge[] = [];

	for (const imp of imports) {
		// Skip external/unresolved imports
		if (!imp.relativePath) continue;

		// Find target node ID
		const targetNodeId = options.nodeMap.get(imp.relativePath);
		if (!targetNodeId) continue;

		// Determine edge type
		const edgeType = getImportEdgeType(imp);

		const edge: AKGEdge = {
			id: generateEdgeId(edgeType, sourceNodeId, targetNodeId),
			type: edgeType,
			sourceNodeId,
			targetNodeId,
			attributes: {
				isTypeOnly: imp.isTypeOnly,
				isDynamic: imp.isDynamic,
				importedNames: imp.importedNames,
			},
			evidence: [
				{
					filePath: '', // Will be filled by caller
					line: imp.location.line,
					column: imp.location.column,
					importSpecifier: imp.moduleSpecifier,
				},
			],
			metadata: createMetadata(
				options.confidence ?? 'high',
				options.discoveryMethod ?? 'static_analysis',
			),
		};

		edges.push(edge);
	}

	return edges;
}

/**
 * Determine the edge type for an import
 */
function getImportEdgeType(imp: ResolvedImport): EdgeType {
	if (imp.isDynamic) return 'dynamic_imports';
	if (imp.isTypeOnly) return 'imports_type';
	return 'imports';
}

// =============================================================================
// Component Usage Edges
// =============================================================================

/**
 * Create edges from Svelte component usage in templates
 *
 * @param sourceNodeId - ID of the source component node
 * @param analysis - Svelte component analysis
 * @param options - Edge creation options
 * @returns Array of component usage edges
 */
export function createComponentUsageEdges(
	sourceNodeId: string,
	analysis: SvelteAnalysis,
	options: EdgeCreationOptions,
): AKGEdge[] {
	const edges: AKGEdge[] = [];

	for (const usage of analysis.template.componentUsages) {
		// Try to find the target node by component name
		// This requires matching component name to a node
		const targetNodeId = findComponentNodeId(usage.name, options.nodeMap);
		if (!targetNodeId) continue;

		const edge: AKGEdge = {
			id: generateEdgeId('uses_component', sourceNodeId, targetNodeId),
			type: 'uses_component',
			sourceNodeId,
			targetNodeId,
			attributes: {
				componentProps: usage.props,
			},
			evidence: [
				{
					filePath: analysis.filePath,
					line: usage.line,
				},
			],
			metadata: createMetadata(
				options.confidence ?? 'high',
				options.discoveryMethod ?? 'static_analysis',
			),
		};

		edges.push(edge);
	}

	return edges;
}

/**
 * Find a component node ID by component name
 */
function findComponentNodeId(componentName: string, nodeMap: Map<string, string>): string | null {
	// Search for a node that matches the component name
	for (const [path, nodeId] of nodeMap.entries()) {
		// Match by file name
		const fileName = path.split('/').pop()?.replace('.svelte', '');
		if (fileName === componentName) {
			return nodeId;
		}
	}
	return null;
}

// =============================================================================
// Layer Edges
// =============================================================================

/**
 * Create edges connecting nodes to their layers
 *
 * @param nodes - All discovered nodes
 * @param config - AKG configuration with layer definitions
 * @returns Array of belongs_to edges
 */
export function createLayerMembershipEdges(nodes: AKGNode[], _config: AKGConfig): AKGEdge[] {
	const edges: AKGEdge[] = [];

	for (const node of nodes) {
		const layerName = node.attributes.layer;
		if (!layerName) continue;

		const layerNodeId = generateNodeId('Layer', layerName);

		const edge: AKGEdge = {
			id: generateEdgeId('belongs_to', node.id, layerNodeId),
			type: 'belongs_to',
			sourceNodeId: node.id,
			targetNodeId: layerNodeId,
			attributes: {},
			evidence: [],
			metadata: createMetadata('high', 'inference'),
		};

		edges.push(edge);
	}

	return edges;
}

/**
 * Create edges representing allowed/forbidden layer imports
 *
 * @param config - AKG configuration with layer definitions
 * @returns Array of layer relationship edges
 */
export function createLayerRuleEdges(config: AKGConfig): AKGEdge[] {
	const edges: AKGEdge[] = [];
	const layers = config.layers ?? [];

	for (const layer of layers) {
		const sourceLayerId = generateNodeId('Layer', layer.name);

		// Allowed imports
		for (const targetLayer of layer.mayImport ?? []) {
			const targetLayerId = generateNodeId('Layer', targetLayer);

			edges.push({
				id: generateEdgeId('allowed_import', sourceLayerId, targetLayerId),
				type: 'allowed_import',
				sourceNodeId: sourceLayerId,
				targetNodeId: targetLayerId,
				attributes: {},
				evidence: [],
				metadata: createMetadata('high', 'manual'),
			});
		}

		// Forbidden imports
		for (const targetLayer of layer.mayNotImport ?? []) {
			const targetLayerId = generateNodeId('Layer', targetLayer);

			edges.push({
				id: generateEdgeId('forbidden_import', sourceLayerId, targetLayerId),
				type: 'forbidden_import',
				sourceNodeId: sourceLayerId,
				targetNodeId: targetLayerId,
				attributes: {},
				evidence: [],
				metadata: createMetadata('high', 'manual'),
			});
		}
	}

	return edges;
}

// =============================================================================
// Store/Service Edges
// =============================================================================

/**
 * Create subscription edges for store usage
 *
 * @param sourceNodeId - ID of the subscribing node
 * @param imports - Resolved imports
 * @param options - Edge creation options
 * @returns Array of subscription edges
 */
export function createSubscriptionEdges(
	sourceNodeId: string,
	imports: ResolvedImport[],
	options: EdgeCreationOptions,
): AKGEdge[] {
	const edges: AKGEdge[] = [];

	// Find imports from stores
	const storeImports = imports.filter(
		(imp) => imp.relativePath?.includes('/stores/') || imp.relativePath?.includes('.svelte.ts'),
	);

	for (const imp of storeImports) {
		if (!imp.relativePath) continue;

		const targetNodeId = options.nodeMap.get(imp.relativePath);
		if (!targetNodeId) continue;

		const edge: AKGEdge = {
			id: generateEdgeId('subscribes_to', sourceNodeId, targetNodeId),
			type: 'subscribes_to',
			sourceNodeId,
			targetNodeId,
			attributes: {
				importedNames: imp.importedNames,
			},
			evidence: [
				{
					filePath: '', // Will be filled by caller
					line: imp.location.line,
					column: imp.location.column,
					importSpecifier: imp.moduleSpecifier,
				},
			],
			metadata: createMetadata(
				options.confidence ?? 'medium',
				options.discoveryMethod ?? 'inference',
			),
		};

		edges.push(edge);
	}

	return edges;
}

/**
 * Create service call edges
 *
 * @param sourceNodeId - ID of the calling node
 * @param imports - Resolved imports
 * @param options - Edge creation options
 * @returns Array of service call edges
 */
export function createServiceCallEdges(
	sourceNodeId: string,
	imports: ResolvedImport[],
	options: EdgeCreationOptions,
): AKGEdge[] {
	const edges: AKGEdge[] = [];

	// Find imports from services
	const serviceImports = imports.filter((imp) => imp.relativePath?.includes('/services/'));

	for (const imp of serviceImports) {
		if (!imp.relativePath) continue;

		const targetNodeId = options.nodeMap.get(imp.relativePath);
		if (!targetNodeId) continue;

		const edge: AKGEdge = {
			id: generateEdgeId('calls_service', sourceNodeId, targetNodeId),
			type: 'calls_service',
			sourceNodeId,
			targetNodeId,
			attributes: {
				importedNames: imp.importedNames,
			},
			evidence: [
				{
					filePath: '',
					line: imp.location.line,
					column: imp.location.column,
					importSpecifier: imp.moduleSpecifier,
				},
			],
			metadata: createMetadata(
				options.confidence ?? 'high',
				options.discoveryMethod ?? 'static_analysis',
			),
		};

		edges.push(edge);
	}

	return edges;
}

// =============================================================================
// WASM Edges
// =============================================================================

/**
 * Create edges for WASM bridge usage
 *
 * @param sourceNodeId - ID of the calling node
 * @param imports - Resolved imports
 * @param options - Edge creation options
 * @returns Array of WASM call edges
 */
export function createWASMCallEdges(
	sourceNodeId: string,
	imports: ResolvedImport[],
	options: EdgeCreationOptions,
): AKGEdge[] {
	const edges: AKGEdge[] = [];

	// Find imports from wasm or engine
	const wasmImports = imports.filter(
		(imp) => imp.relativePath?.includes('/wasm/') || imp.relativePath?.includes('engine.ts'),
	);

	for (const imp of wasmImports) {
		if (!imp.relativePath) continue;

		const targetNodeId = options.nodeMap.get(imp.relativePath);
		if (!targetNodeId) continue;

		const edge: AKGEdge = {
			id: generateEdgeId('calls_wasm', sourceNodeId, targetNodeId),
			type: 'calls_wasm',
			sourceNodeId,
			targetNodeId,
			attributes: {
				importedNames: imp.importedNames,
			},
			evidence: [
				{
					filePath: '',
					line: imp.location.line,
					column: imp.location.column,
					importSpecifier: imp.moduleSpecifier,
				},
			],
			metadata: createMetadata(
				options.confidence ?? 'high',
				options.discoveryMethod ?? 'static_analysis',
			),
		};

		edges.push(edge);
	}

	return edges;
}

// =============================================================================
// Batch Edge Creation
// =============================================================================

/**
 * Create all edges for a node based on its imports
 *
 * @param node - Source node
 * @param imports - Resolved imports
 * @param options - Edge creation options
 * @returns All created edges
 */
export function createAllEdgesForNode(
	node: AKGNode,
	imports: ResolvedImport[],
	options: EdgeCreationOptions,
): AKGEdge[] {
	const edges: AKGEdge[] = [];

	// Basic import edges
	const importEdges = createImportEdges(node.id, imports, options);
	for (const edge of importEdges) {
		edge.evidence[0].filePath = node.filePath ?? '';
	}
	edges.push(...importEdges);

	// Store subscription edges
	const subscriptionEdges = createSubscriptionEdges(node.id, imports, options);
	for (const edge of subscriptionEdges) {
		edge.evidence[0].filePath = node.filePath ?? '';
	}
	edges.push(...subscriptionEdges);

	// Service call edges
	const serviceEdges = createServiceCallEdges(node.id, imports, options);
	for (const edge of serviceEdges) {
		edge.evidence[0].filePath = node.filePath ?? '';
	}
	edges.push(...serviceEdges);

	// WASM call edges
	const wasmEdges = createWASMCallEdges(node.id, imports, options);
	for (const edge of wasmEdges) {
		edge.evidence[0].filePath = node.filePath ?? '';
	}
	edges.push(...wasmEdges);

	return edges;
}
