/**
 * AKG Invariant Schema
 *
 * Zod 4 schemas for invariant definitions, violations, and check results.
 *
 * @see docs/architecture/akg/README.md
 */

import { z } from 'zod';
import type { AKGGraph } from './graph.schema.js';
import { Severity } from './graph.schema.js';

// =============================================================================
// Invariant Definition
// =============================================================================

/**
 * Invariant category
 */
export const InvariantCategory = z.enum([
	'structural', // Code organization and dependencies
	'naming', // Convention enforcement
	'domain', // Business rule enforcement
	'security', // Security constraints
	'performance', // Performance constraints
]);

export type InvariantCategory = z.infer<typeof InvariantCategory>;

/**
 * Invariant metadata
 */
export const InvariantMeta = z.object({
	/** Version when invariant was added */
	added: z.string(),
	/** Version when deprecated (if applicable) */
	deprecated: z.string().optional(),
	/** Replacement invariant ID (if deprecated) */
	replacedBy: z.string().optional(),
});

export type InvariantMeta = z.infer<typeof InvariantMeta>;

/**
 * Invariant definition
 */
export const InvariantDefinition = z.object({
	/** Unique invariant identifier (snake_case) */
	id: z.string().regex(/^[a-z][a-z0-9_]*$/, {
		error: 'Invariant ID must be snake_case starting with a letter',
	}),

	/** Human-readable name */
	name: z.string().min(1),

	/** Detailed description */
	description: z.string().min(1),

	/** Invariant category */
	category: InvariantCategory,

	/** Default severity (can be overridden in config) */
	severity: Severity,

	/** Business rule this enforces */
	businessRule: z.string().min(1),

	/** Reference to documentation */
	docsUrl: z.url().optional(),

	/** Whether this invariant is enabled by default */
	enabledByDefault: z.boolean().default(true),

	/** File patterns to include (glob) */
	include: z.array(z.string()).optional(),

	/** File patterns to exclude (glob) */
	exclude: z.array(z.string()).optional(),

	/** Whether violations are auto-fixable */
	fixable: z.boolean().default(false),

	/** Metadata */
	meta: InvariantMeta.optional(),
});

export type InvariantDefinition = z.infer<typeof InvariantDefinition>;

// =============================================================================
// Violation Schema
// =============================================================================

/**
 * Evidence for a violation
 */
export const ViolationEvidence = z.object({
	filePath: z.string(),
	line: z.number().int().positive(),
	column: z.number().int().positive().optional(),
	endLine: z.number().int().positive().optional(),
	endColumn: z.number().int().positive().optional(),
	snippet: z.string().optional(),
});

export type ViolationEvidence = z.infer<typeof ViolationEvidence>;

/**
 * Violation instance
 */
export const InvariantViolation = z.object({
	/** Invariant that was violated */
	invariantId: z.string().min(1),

	/** Invariant name for display */
	invariantName: z.string().min(1),

	/** Severity of this violation */
	severity: Severity,

	/** Human-readable message */
	message: z.string().min(1),

	/** Suggestion for fixing */
	suggestion: z.string().optional(),

	/** Source node that caused violation */
	sourceNode: z.string().min(1),

	/** Target node involved (if applicable) */
	targetNode: z.string().optional(),

	/** Evidence locations */
	evidence: z.array(ViolationEvidence),

	/** Business rule violated */
	businessRule: z.string().optional(),

	/** Additional context */
	context: z.record(z.string(), z.unknown()).optional(),
});

export type InvariantViolation = z.infer<typeof InvariantViolation>;

// =============================================================================
// Check Result Schema
// =============================================================================

/**
 * Result of running a single invariant check
 */
export const InvariantCheckResult = z.object({
	/** Invariant that was checked */
	invariantId: z.string().min(1),

	/** Whether the invariant passed */
	passed: z.boolean(),

	/** Violations found (empty if passed) */
	violations: z.array(InvariantViolation),

	/** Time taken to check in ms */
	durationMs: z.number().nonnegative(),

	/** Nodes checked */
	nodesChecked: z.number().int().nonnegative(),

	/** Edges checked */
	edgesChecked: z.number().int().nonnegative(),
});

export type InvariantCheckResult = z.infer<typeof InvariantCheckResult>;

/**
 * Exit code recommendation
 */
export const ExitCode = z.enum(['success', 'warnings', 'errors']);

export type ExitCode = z.infer<typeof ExitCode>;

/**
 * Summary counts
 */
export const CheckSummaryCounts = z.object({
	totalInvariants: z.number().int().nonnegative(),
	passed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	errors: z.number().int().nonnegative(),
	warnings: z.number().int().nonnegative(),
	infos: z.number().int().nonnegative(),
});

export type CheckSummaryCounts = z.infer<typeof CheckSummaryCounts>;

/**
 * Summary of all invariant checks
 */
export const CheckSummary = z.object({
	/** When the check was run */
	timestamp: z.iso.datetime(),

	/** Total time in ms */
	totalDurationMs: z.number().nonnegative(),

	/** Graph version used */
	graphVersion: z.string(),

	/** Results per invariant */
	results: z.array(InvariantCheckResult),

	/** Aggregated counts */
	summary: CheckSummaryCounts,

	/** Exit code recommendation */
	exitCode: ExitCode,
});

export type CheckSummary = z.infer<typeof CheckSummary>;

// =============================================================================
// Query Engine Interface
// =============================================================================

import type { AKGEdge, AKGNode } from './graph.schema.js';

/**
 * Query engine interface for invariant checks
 */
export interface AKGQueryEngine {
	/** Get node by ID */
	getNode(id: string): AKGNode | undefined;

	/** Get nodes matching filter */
	getNodes(filter?: (n: AKGNode) => boolean): AKGNode[];

	/** Get edges matching filter */
	getEdges(filter?: (e: AKGEdge) => boolean): AKGEdge[];

	/** Get outgoing edges from a node */
	getOutgoing(nodeId: string): AKGEdge[];

	/** Get incoming edges to a node */
	getIncoming(nodeId: string): AKGEdge[];

	/** Find all cycles in the graph (returns arrays of node IDs) */
	findCycles(): string[][];

	/** Find path between two nodes */
	findPath(from: string, to: string): string[] | null;

	/** Get nodes in a specific layer */
	getNodesInLayer(layer: string): AKGNode[];

	/** Get nodes of a specific type */
	getNodesByType(type: string): AKGNode[];
}

/**
 * Invariant check function signature
 */
export type InvariantCheckFn = (graph: AKGGraph, engine: AKGQueryEngine) => InvariantViolation[];

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an empty check summary
 */
export function createCheckSummary(graphVersion: string): CheckSummary {
	return {
		timestamp: new Date().toISOString(),
		totalDurationMs: 0,
		graphVersion,
		results: [],
		summary: {
			totalInvariants: 0,
			passed: 0,
			failed: 0,
			errors: 0,
			warnings: 0,
			infos: 0,
		},
		exitCode: 'success',
	};
}

/**
 * Calculate exit code from check results
 */
export function calculateExitCode(results: InvariantCheckResult[]): ExitCode {
	let hasErrors = false;
	let hasWarnings = false;

	for (const result of results) {
		for (const violation of result.violations) {
			if (violation.severity === 'error') hasErrors = true;
			if (violation.severity === 'warning') hasWarnings = true;
		}
	}

	if (hasErrors) return 'errors';
	if (hasWarnings) return 'warnings';
	return 'success';
}

/**
 * Aggregate counts from check results
 */
export function aggregateCounts(results: InvariantCheckResult[]): CheckSummaryCounts {
	const counts: CheckSummaryCounts = {
		totalInvariants: results.length,
		passed: 0,
		failed: 0,
		errors: 0,
		warnings: 0,
		infos: 0,
	};

	for (const result of results) {
		if (result.passed) {
			counts.passed++;
		} else {
			counts.failed++;
		}

		for (const violation of result.violations) {
			if (violation.severity === 'error') counts.errors++;
			if (violation.severity === 'warning') counts.warnings++;
			if (violation.severity === 'info') counts.infos++;
		}
	}

	return counts;
}

/**
 * Create a violation with defaults
 */
export function createViolation(
	invariantId: string,
	invariantName: string,
	message: string,
	sourceNode: string,
	severity: z.infer<typeof Severity> = 'warning',
): InvariantViolation {
	return {
		invariantId,
		invariantName,
		severity,
		message,
		sourceNode,
		evidence: [],
	};
}
