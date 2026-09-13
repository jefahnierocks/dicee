/**
 * Graph Schema Tests
 *
 * Unit tests for AKG graph schemas using Zod 4.
 */

import { describe, expect, it } from 'vitest';
import {
	AKGEdge,
	AKGGraph,
	AKGNode,
	buildAdjacencyList,
	buildNodeMap,
	Confidence,
	createEmptyGraph,
	createMetadata,
	EdgeType,
	generateEdgeId,
	generateNodeId,
	Metadata,
	NodeType,
} from '../../schema/graph.schema.js';

// =============================================================================
// Enum Tests
// =============================================================================

describe('NodeType enum', () => {
	it('should accept valid node types', () => {
		expect(() => NodeType.parse('Component')).not.toThrow();
		expect(() => NodeType.parse('Store')).not.toThrow();
		expect(() => NodeType.parse('Service')).not.toThrow();
		expect(() => NodeType.parse('SmartContainer')).not.toThrow();
	});

	it('should reject invalid node types', () => {
		expect(() => NodeType.parse('InvalidType')).toThrow();
		expect(() => NodeType.parse('')).toThrow();
		expect(() => NodeType.parse(123)).toThrow();
	});
});

describe('EdgeType enum', () => {
	it('should accept valid edge types', () => {
		expect(() => EdgeType.parse('imports')).not.toThrow();
		expect(() => EdgeType.parse('uses_component')).not.toThrow();
		expect(() => EdgeType.parse('violates')).not.toThrow();
	});

	it('should reject invalid edge types', () => {
		expect(() => EdgeType.parse('invalid_edge')).toThrow();
	});
});

describe('Confidence enum', () => {
	it('should accept valid confidence levels', () => {
		expect(Confidence.parse('high')).toBe('high');
		expect(Confidence.parse('medium')).toBe('medium');
		expect(Confidence.parse('low')).toBe('low');
	});
});

// =============================================================================
// Metadata Tests
// =============================================================================

describe('Metadata schema', () => {
	it('should accept valid metadata', () => {
		const validMetadata = {
			discoveredAt: new Date().toISOString(),
			confidence: 'high',
		};

		expect(() => Metadata.parse(validMetadata)).not.toThrow();
	});

	it('should accept metadata with optional fields', () => {
		const fullMetadata = {
			discoveredAt: new Date().toISOString(),
			confidence: 'high',
			lastVerified: new Date().toISOString(),
			discoveryMethod: 'static_analysis',
		};

		const result = Metadata.parse(fullMetadata);
		expect(result.discoveryMethod).toBe('static_analysis');
	});

	it('should reject invalid datetime format', () => {
		const invalidMetadata = {
			discoveredAt: 'not-a-date',
			confidence: 'high',
		};

		expect(() => Metadata.parse(invalidMetadata)).toThrow();
	});
});

// =============================================================================
// AKGNode Tests
// =============================================================================

describe('AKGNode schema', () => {
	const validNode = {
		id: 'component::Die::abc123',
		type: 'Component',
		name: 'Die',
		filePath: 'packages/web/src/lib/components/dice/Die.svelte',
		attributes: {
			layer: 'components',
			classification: 'dumb',
		},
		metadata: {
			discoveredAt: new Date().toISOString(),
			confidence: 'high',
		},
	};

	it('should accept valid component node', () => {
		expect(() => AKGNode.parse(validNode)).not.toThrow();
	});

	it('should accept node with all attributes', () => {
		const fullNode = {
			...validNode,
			attributes: {
				layer: 'components',
				classification: 'smart',
				propsInterface: 'Props',
				hasSlots: true,
				usesRunes: true,
				exports: [{ name: 'Die', kind: 'default', line: 1 }],
				startLine: 1,
				endLine: 100,
				contentHash: 'abc123',
			},
		};

		const result = AKGNode.parse(fullNode);
		expect(result.attributes.classification).toBe('smart');
		expect(result.attributes.exports).toHaveLength(1);
	});

	it('should reject node with invalid type', () => {
		const invalidNode = { ...validNode, type: 'InvalidType' };
		expect(() => AKGNode.parse(invalidNode)).toThrow();
	});

	it('should reject node with empty id', () => {
		const invalidNode = { ...validNode, id: '' };
		expect(() => AKGNode.parse(invalidNode)).toThrow();
	});

	it('should reject node with empty name', () => {
		const invalidNode = { ...validNode, name: '' };
		expect(() => AKGNode.parse(invalidNode)).toThrow();
	});

	it('should allow additional attributes via passthrough', () => {
		const nodeWithExtra = {
			...validNode,
			attributes: {
				...validNode.attributes,
				customField: 'customValue',
			},
		};

		const result = AKGNode.parse(nodeWithExtra);
		expect(result.attributes.customField).toBe('customValue');
	});
});

// =============================================================================
// AKGEdge Tests
// =============================================================================

describe('AKGEdge schema', () => {
	const validEdge = {
		id: 'imports::DiceTray->Die',
		type: 'imports',
		sourceNodeId: 'component::DiceTray::abc',
		targetNodeId: 'component::Die::def',
		attributes: {
			importedNames: ['Die'],
		},
		evidence: [
			{
				filePath: 'packages/web/src/lib/components/dice/DiceTray.svelte',
				line: 5,
				snippet: "import Die from './Die.svelte';",
			},
		],
		metadata: {
			discoveredAt: new Date().toISOString(),
			confidence: 'high',
		},
	};

	it('should accept valid edge', () => {
		expect(() => AKGEdge.parse(validEdge)).not.toThrow();
	});

	it('should accept edge with violation attributes', () => {
		const violationEdge = {
			...validEdge,
			type: 'violates',
			attributes: {
				violationSeverity: 'error',
				violationMessage: 'Direct WASM import not allowed',
			},
		};

		const result = AKGEdge.parse(violationEdge);
		expect(result.attributes.violationSeverity).toBe('error');
	});

	it('should reject edge with invalid type', () => {
		const invalidEdge = { ...validEdge, type: 'invalid_type' };
		expect(() => AKGEdge.parse(invalidEdge)).toThrow();
	});

	it('should accept edge with empty evidence array', () => {
		const edgeNoEvidence = { ...validEdge, evidence: [] };
		expect(() => AKGEdge.parse(edgeNoEvidence)).not.toThrow();
	});
});

// =============================================================================
// AKGGraph Tests
// =============================================================================

describe('AKGGraph schema', () => {
	const validGraph = {
		version: '1.0.0',
		generatedAt: new Date().toISOString(),
		projectRoot: '/workspace/dicee',
		nodes: [],
		edges: [],
		metadata: {
			totalFiles: 0,
			discoveryDurationMs: 100,
		},
	};

	it('should accept valid empty graph', () => {
		expect(() => AKGGraph.parse(validGraph)).not.toThrow();
	});

	it('should accept graph with nodes and edges', () => {
		const graphWithContent = {
			...validGraph,
			nodes: [
				{
					id: 'component::Die::abc',
					type: 'Component',
					name: 'Die',
					attributes: {},
					metadata: { discoveredAt: new Date().toISOString(), confidence: 'high' },
				},
			],
			edges: [],
			metadata: {
				totalFiles: 1,
				discoveryDurationMs: 100,
				packages: ['@dicee/web'],
			},
		};

		const result = AKGGraph.parse(graphWithContent);
		expect(result.nodes).toHaveLength(1);
	});

	it('should reject invalid version format', () => {
		const invalidGraph = { ...validGraph, version: 'v1' };
		expect(() => AKGGraph.parse(invalidGraph)).toThrow();
	});

	it('should accept valid semver versions', () => {
		const versions = ['1.0.0', '2.1.3', '0.0.1', '10.20.30'];
		for (const version of versions) {
			const graph = { ...validGraph, version };
			expect(() => AKGGraph.parse(graph)).not.toThrow();
		}
	});
});

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createEmptyGraph', () => {
	it('should create valid empty graph', () => {
		const graph = createEmptyGraph('/test/project');

		expect(graph.version).toBe('1.0.0');
		expect(graph.projectRoot).toBe('/test/project');
		expect(graph.nodes).toHaveLength(0);
		expect(graph.edges).toHaveLength(0);
		expect(graph.metadata.totalFiles).toBe(0);
	});

	it('should produce schema-valid graph', () => {
		const graph = createEmptyGraph('/test/project');
		expect(() => AKGGraph.parse(graph)).not.toThrow();
	});
});

describe('generateNodeId', () => {
	it('should generate ID without file path', () => {
		const id = generateNodeId('Component', 'Die');
		expect(id).toBe('component::Die');
	});

	it('should generate ID with file path', () => {
		const id = generateNodeId('Component', 'Die', 'src/components/Die.svelte');
		expect(id).toContain('component::Die::');
		expect(id.length).toBeGreaterThan('component::Die'.length);
	});

	it('should distinguish routes with identical trailing segments', () => {
		const first = generateNodeId('Route', '+page', 'src/routes/game/[code]/+page.svelte');
		const second = generateNodeId(
			'Route',
			'+page',
			'src/routes/games/dicee/room/[code]/+page.svelte',
		);

		expect(first).not.toBe(second);
	});
});

describe('generateEdgeId', () => {
	it('should generate descriptive edge ID', () => {
		const id = generateEdgeId('imports', 'component::DiceTray::abc', 'component::Die::def');
		expect(id).toContain('imports');
		expect(id).toContain('->');
	});

	it('should distinguish edges between nodes with the same type and name', () => {
		const first = generateEdgeId('imports', 'module::check::first', 'module::index::first');
		const second = generateEdgeId('imports', 'module::check::first', 'module::index::second');

		expect(first).not.toBe(second);
	});
});

describe('createMetadata', () => {
	it('should create valid metadata with defaults', () => {
		const metadata = createMetadata();

		expect(metadata.confidence).toBe('high');
		expect(metadata.discoveryMethod).toBe('static_analysis');
		expect(() => Metadata.parse(metadata)).not.toThrow();
	});

	it('should respect custom confidence and method', () => {
		const metadata = createMetadata('low', 'inference');

		expect(metadata.confidence).toBe('low');
		expect(metadata.discoveryMethod).toBe('inference');
	});
});

describe('buildNodeMap', () => {
	it('should build map with O(1) access', () => {
		const graph = createEmptyGraph('/test');
		graph.nodes = [
			{
				id: 'component::A::1',
				type: 'Component',
				name: 'A',
				attributes: {},
				metadata: createMetadata(),
			},
			{
				id: 'component::B::2',
				type: 'Component',
				name: 'B',
				attributes: {},
				metadata: createMetadata(),
			},
		];

		const map = buildNodeMap(graph);

		expect(map.size).toBe(2);
		expect(map.get('component::A::1')?.name).toBe('A');
		expect(map.get('component::B::2')?.name).toBe('B');
		expect(map.get('nonexistent')).toBeUndefined();
	});
});

describe('buildAdjacencyList', () => {
	it('should build adjacency list with incoming/outgoing edges', () => {
		const graph = createEmptyGraph('/test');
		graph.nodes = [
			{ id: 'a', type: 'Module', name: 'A', attributes: {}, metadata: createMetadata() },
			{ id: 'b', type: 'Module', name: 'B', attributes: {}, metadata: createMetadata() },
		];
		graph.edges = [
			{
				id: 'edge1',
				type: 'imports',
				sourceNodeId: 'a',
				targetNodeId: 'b',
				attributes: {},
				evidence: [],
				metadata: createMetadata(),
			},
		];

		const adj = buildAdjacencyList(graph);

		expect(adj.get('a')?.outgoing).toHaveLength(1);
		expect(adj.get('a')?.incoming).toHaveLength(0);
		expect(adj.get('b')?.outgoing).toHaveLength(0);
		expect(adj.get('b')?.incoming).toHaveLength(1);
	});
});
