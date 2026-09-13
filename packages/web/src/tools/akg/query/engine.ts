/**
 * AKG Query Engine
 *
 * Implementation of the AKGQueryEngine interface for graph queries.
 * Provides efficient node/edge lookups, traversals, and cycle detection.
 *
 * @see docs/architecture/akg/README.md
 */

import type {
	AdjacencyList,
	AKGEdge,
	AKGGraph,
	AKGNode,
	NodeMap,
	NodeType,
} from '../schema/graph.schema.js';
import { buildAdjacencyList, buildNodeMap } from '../schema/graph.schema.js';
import type { AKGQueryEngine } from '../schema/invariant.schema.js';
import { findAllCycles } from './cycles.js';
import { findShortestPath } from './traversal.js';

/**
 * Query engine implementation
 *
 * Provides O(1) node lookups and O(n) filtered queries.
 * Caches adjacency list for efficient traversal operations.
 */
export class QueryEngine implements AKGQueryEngine {
	private readonly graph: AKGGraph;
	private readonly nodeMap: NodeMap;
	private readonly adjacencyList: AdjacencyList;

	// Cached queries
	private layerCache: Map<string, AKGNode[]> | null = null;
	private typeCache: Map<string, AKGNode[]> | null = null;
	private cycleCache: string[][] | null = null;

	constructor(graph: AKGGraph) {
		this.graph = graph;
		this.nodeMap = buildNodeMap(graph);
		this.adjacencyList = buildAdjacencyList(graph);
	}

	/**
	 * Get the underlying graph
	 */
	getGraph(): AKGGraph {
		return this.graph;
	}

	/**
	 * Get node by ID - O(1)
	 */
	getNode(id: string): AKGNode | undefined {
		return this.nodeMap.get(id);
	}

	/**
	 * Get all nodes matching filter - O(n)
	 */
	getNodes(filter?: (n: AKGNode) => boolean): AKGNode[] {
		if (!filter) {
			return [...this.graph.nodes];
		}
		return this.graph.nodes.filter(filter);
	}

	/**
	 * Get all edges matching filter - O(m)
	 */
	getEdges(filter?: (e: AKGEdge) => boolean): AKGEdge[] {
		if (!filter) {
			return [...this.graph.edges];
		}
		return this.graph.edges.filter(filter);
	}

	/**
	 * Get outgoing edges from a node - O(1) lookup + O(k) where k is out-degree
	 */
	getOutgoing(nodeId: string): AKGEdge[] {
		const entry = this.adjacencyList.get(nodeId);
		return entry ? [...entry.outgoing] : [];
	}

	/**
	 * Get incoming edges to a node - O(1) lookup + O(k) where k is in-degree
	 */
	getIncoming(nodeId: string): AKGEdge[] {
		const entry = this.adjacencyList.get(nodeId);
		return entry ? [...entry.incoming] : [];
	}

	/**
	 * Find all cycles in the graph using Tarjan's algorithm
	 *
	 * Results are cached after first computation.
	 * @returns Array of cycles, each cycle is an array of node IDs
	 */
	findCycles(): string[][] {
		if (this.cycleCache === null) {
			this.cycleCache = findAllCycles(this.graph.nodes, this.adjacencyList);
		}
		return this.cycleCache;
	}

	/**
	 * Find shortest path between two nodes using BFS
	 *
	 * @returns Array of node IDs from source to target, or null if no path exists
	 */
	findPath(from: string, to: string): string[] | null {
		return findShortestPath(from, to, this.adjacencyList);
	}

	/**
	 * Get all nodes in a specific layer
	 *
	 * Results are cached after first access.
	 */
	getNodesInLayer(layer: string): AKGNode[] {
		if (this.layerCache === null) {
			this.buildLayerCache();
		}
		return this.layerCache?.get(layer) ?? [];
	}

	/**
	 * Get all nodes of a specific type
	 *
	 * Results are cached after first access.
	 */
	getNodesByType(type: string): AKGNode[] {
		if (this.typeCache === null) {
			this.buildTypeCache();
		}
		return this.typeCache?.get(type) ?? [];
	}

	/**
	 * Get edges between two specific nodes
	 */
	getEdgesBetween(sourceId: string, targetId: string): AKGEdge[] {
		const outgoing = this.getOutgoing(sourceId);
		return outgoing.filter((e) => e.targetNodeId === targetId);
	}

	/**
	 * Check if there's a direct edge between two nodes
	 */
	hasEdge(sourceId: string, targetId: string): boolean {
		return this.getEdgesBetween(sourceId, targetId).length > 0;
	}

	/**
	 * Check if target is reachable from source (including transitive)
	 */
	isReachable(from: string, to: string): boolean {
		return this.findPath(from, to) !== null;
	}

	/**
	 * Get all nodes that a node depends on (transitively)
	 */
	getDependencies(nodeId: string): AKGNode[] {
		const visited = new Set<string>();
		const result: AKGNode[] = [];

		const visit = (id: string) => {
			if (visited.has(id)) return;
			visited.add(id);

			for (const edge of this.getOutgoing(id)) {
				const targetNode = this.getNode(edge.targetNodeId);
				if (targetNode && !visited.has(edge.targetNodeId)) {
					result.push(targetNode);
					visit(edge.targetNodeId);
				}
			}
		};

		visit(nodeId);
		return result;
	}

	/**
	 * Get all nodes that depend on a node (transitively)
	 */
	getDependents(nodeId: string): AKGNode[] {
		const visited = new Set<string>();
		const result: AKGNode[] = [];

		const visit = (id: string) => {
			if (visited.has(id)) return;
			visited.add(id);

			for (const edge of this.getIncoming(id)) {
				const sourceNode = this.getNode(edge.sourceNodeId);
				if (sourceNode && !visited.has(edge.sourceNodeId)) {
					result.push(sourceNode);
					visit(edge.sourceNodeId);
				}
			}
		};

		visit(nodeId);
		return result;
	}

	/**
	 * Get import edges (imports, imports_type, dynamic_imports)
	 */
	getImportEdges(): AKGEdge[] {
		return this.getEdges(
			(e) => e.type === 'imports' || e.type === 'imports_type' || e.type === 'dynamic_imports',
		);
	}

	/**
	 * Get all edges of a specific type
	 */
	getEdgesByType(type: AKGEdge['type']): AKGEdge[] {
		return this.getEdges((e) => e.type === type);
	}

	/**
	 * Count nodes by type
	 */
	countByType(): Map<NodeType, number> {
		const counts = new Map<NodeType, number>();
		for (const node of this.graph.nodes) {
			counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
		}
		return counts;
	}

	/**
	 * Count edges by type
	 */
	countEdgesByType(): Map<AKGEdge['type'], number> {
		const counts = new Map<AKGEdge['type'], number>();
		for (const edge of this.graph.edges) {
			counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
		}
		return counts;
	}

	/**
	 * Get graph statistics
	 */
	getStats(): GraphStats {
		return {
			nodeCount: this.graph.nodes.length,
			edgeCount: this.graph.edges.length,
			nodesByType: Object.fromEntries(this.countByType()),
			edgesByType: Object.fromEntries(this.countEdgesByType()),
			cycleCount: this.findCycles().length,
		};
	}

	/**
	 * Build layer cache for fast layer lookups
	 */
	private buildLayerCache(): void {
		this.layerCache = new Map<string, AKGNode[]>();
		for (const node of this.graph.nodes) {
			const layer = node.attributes.layer;
			if (layer) {
				const existing = this.layerCache.get(layer) ?? [];
				existing.push(node);
				this.layerCache.set(layer, existing);
			}
		}
	}

	/**
	 * Build type cache for fast type lookups
	 */
	private buildTypeCache(): void {
		this.typeCache = new Map<string, AKGNode[]>();
		for (const node of this.graph.nodes) {
			const existing = this.typeCache.get(node.type) ?? [];
			existing.push(node);
			this.typeCache.set(node.type, existing);
		}
	}

	/**
	 * Invalidate all caches (call after graph modification)
	 */
	invalidateCaches(): void {
		this.layerCache = null;
		this.typeCache = null;
		this.cycleCache = null;
	}
}

/**
 * Graph statistics
 */
export interface GraphStats {
	nodeCount: number;
	edgeCount: number;
	nodesByType: Record<string, number>;
	edgesByType: Record<string, number>;
	cycleCount: number;
}

/**
 * Create a query engine from a graph
 */
export function createQueryEngine(graph: AKGGraph): QueryEngine {
	return new QueryEngine(graph);
}
