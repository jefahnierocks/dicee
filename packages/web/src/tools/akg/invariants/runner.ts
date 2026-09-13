/**
 * AKG Invariant Runner
 *
 * Executes invariant checks against a graph and produces results.
 */

import { createQueryEngine, type QueryEngine } from '../query/engine.js';
import type { AKGConfig } from '../schema/config.schema.js';
import type { AKGGraph, Severity } from '../schema/graph.schema.js';
import {
	aggregateCounts,
	type CheckSummary,
	calculateExitCode,
	type InvariantCheckResult,
	type InvariantViolation,
} from '../schema/invariant.schema.js';
import { type RegisteredInvariant, registry } from './registry.js';

/**
 * Runner options
 */
export interface RunnerOptions {
	/** Only run specific invariants */
	only?: string[];
	/** Skip specific invariants */
	skip?: string[];
	/** Override severity for all violations */
	severityOverride?: Severity;
	/** Stop on first failure */
	failFast?: boolean;
	/** Verbose logging */
	verbose?: boolean;
	/** Custom logger */
	logger?: (message: string) => void;
}

/**
 * Run all enabled invariants against a graph
 */
export async function runInvariants(
	graph: AKGGraph,
	config?: AKGConfig,
	options: RunnerOptions = {},
): Promise<CheckSummary> {
	const startTime = performance.now();
	const engine = createQueryEngine(graph);
	// biome-ignore lint/suspicious/noConsole: CLI tool - console.log is the default logger
	const log = options.logger ?? console.log;

	// Determine which invariants to run
	let invariantsToRun: RegisteredInvariant[];

	if (options.only && options.only.length > 0) {
		// Only run specified invariants
		invariantsToRun = options.only
			.map((id) => registry.get(id))
			.filter((inv): inv is RegisteredInvariant => inv !== undefined);
	} else {
		// Get enabled invariants from config
		const enable = config?.invariants?.enable;
		const disable = [...(config?.invariants?.disable ?? []), ...(options.skip ?? [])];
		invariantsToRun = registry.getEnabled(enable, disable);
	}

	if (options.verbose) {
		log(`Running ${invariantsToRun.length} invariants...`);
	}

	// Run each invariant
	const results: InvariantCheckResult[] = [];

	for (const invariant of invariantsToRun) {
		const result = await runSingleInvariant(invariant, graph, engine, config, options);
		results.push(result);

		if (options.verbose) {
			const status = result.passed ? '✓' : '✗';
			const violationCount = result.violations.length;
			log(`  ${status} ${invariant.definition.name} (${violationCount} violations)`);
		}

		// Fail fast if requested
		if (options.failFast && !result.passed) {
			break;
		}
	}

	const endTime = performance.now();

	// Build summary
	const summary: CheckSummary = {
		timestamp: new Date().toISOString(),
		totalDurationMs: endTime - startTime,
		graphVersion: graph.version,
		results,
		summary: aggregateCounts(results),
		exitCode: calculateExitCode(results),
	};

	if (options.verbose) {
		log(`\nCompleted in ${summary.totalDurationMs.toFixed(2)}ms`);
		log(`  Passed: ${summary.summary.passed}/${summary.summary.totalInvariants}`);
		log(`  Errors: ${summary.summary.errors}, Warnings: ${summary.summary.warnings}`);
	}

	return summary;
}

/**
 * Run a single invariant
 */
async function runSingleInvariant(
	invariant: RegisteredInvariant,
	graph: AKGGraph,
	engine: QueryEngine,
	config?: AKGConfig,
	options: RunnerOptions = {},
): Promise<InvariantCheckResult> {
	const startTime = performance.now();
	const def = invariant.definition;

	try {
		// Run the check
		let violations = invariant.check(graph, engine);

		// Apply severity override from config
		const configOverride = config?.invariants?.overrides?.find((o) => o.id === def.id);
		if (configOverride?.severity) {
			const overrideSeverity = configOverride.severity;
			violations = violations.map((v) => ({
				...v,
				severity: overrideSeverity,
			}));
		}

		// Apply global severity override
		if (options.severityOverride) {
			const globalSeverity = options.severityOverride;
			violations = violations.map((v) => ({
				...v,
				severity: globalSeverity,
			}));
		}

		const endTime = performance.now();

		return {
			invariantId: def.id,
			passed: violations.length === 0,
			violations,
			durationMs: endTime - startTime,
			nodesChecked: graph.nodes.length,
			edgesChecked: graph.edges.length,
		};
	} catch (error) {
		// Create an error violation if the check throws
		const endTime = performance.now();
		const errorViolation: InvariantViolation = {
			invariantId: def.id,
			invariantName: def.name,
			severity: 'error',
			message: `Invariant check failed with error: ${error instanceof Error ? error.message : String(error)}`,
			sourceNode: 'internal',
			evidence: [],
			context: {
				error: error instanceof Error ? error.stack : String(error),
			},
		};

		return {
			invariantId: def.id,
			passed: false,
			violations: [errorViolation],
			durationMs: endTime - startTime,
			nodesChecked: 0,
			edgesChecked: 0,
		};
	}
}

/**
 * Run a single invariant by ID
 */
export async function runInvariant(
	invariantId: string,
	graph: AKGGraph,
	config?: AKGConfig,
): Promise<InvariantCheckResult | null> {
	const invariant = registry.get(invariantId);
	if (!invariant) {
		return null;
	}

	const engine = createQueryEngine(graph);
	return runSingleInvariant(invariant, graph, engine, config);
}

/**
 * Validate graph before running invariants
 */
export function validateGraph(graph: AKGGraph): string[] {
	const errors: string[] = [];

	if (!graph.version) {
		errors.push('Graph is missing version');
	}

	if (!graph.nodes || !Array.isArray(graph.nodes)) {
		errors.push('Graph nodes must be an array');
	}

	if (!graph.edges || !Array.isArray(graph.edges)) {
		errors.push('Graph edges must be an array');
	}

	// Check for orphaned edges
	const nodeIds = new Set(graph.nodes.map((n) => n.id));
	for (const edge of graph.edges) {
		if (!nodeIds.has(edge.sourceNodeId)) {
			errors.push(`Edge ${edge.id} references non-existent source node: ${edge.sourceNodeId}`);
		}
		if (!nodeIds.has(edge.targetNodeId)) {
			errors.push(`Edge ${edge.id} references non-existent target node: ${edge.targetNodeId}`);
		}
	}

	// Check for duplicate node IDs
	const seenNodeIds = new Set<string>();
	for (const node of graph.nodes) {
		if (seenNodeIds.has(node.id)) {
			errors.push(`Duplicate node ID: ${node.id}`);
		}
		seenNodeIds.add(node.id);
	}

	// Edge IDs must also remain unique or query results can silently overwrite
	// distinct relationships between files with the same basename.
	const seenEdgeIds = new Set<string>();
	for (const edge of graph.edges) {
		if (seenEdgeIds.has(edge.id)) {
			errors.push(`Duplicate edge ID: ${edge.id}`);
		}
		seenEdgeIds.add(edge.id);
	}

	return errors;
}

/**
 * Format check summary for console output
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Summary formatting requires branching for different result states
export function formatSummary(summary: CheckSummary): string {
	const lines: string[] = [];

	lines.push('═══════════════════════════════════════════════════════════════');
	lines.push('                    AKG Invariant Check Results');
	lines.push('═══════════════════════════════════════════════════════════════');
	lines.push('');

	// Results by invariant
	for (const result of summary.results) {
		const status = result.passed ? '✓ PASS' : '✗ FAIL';
		lines.push(`${status}  ${result.invariantId} (${result.durationMs.toFixed(1)}ms)`);

		if (!result.passed) {
			for (const v of result.violations) {
				const icon = v.severity === 'error' ? '🔴' : v.severity === 'warning' ? '🟡' : 'ℹ️';
				lines.push(`       ${icon} ${v.message}`);
				if (v.evidence.length > 0) {
					const e = v.evidence[0];
					lines.push(`          at ${e.filePath}:${e.line}`);
				}
			}
		}
	}

	lines.push('');
	lines.push('───────────────────────────────────────────────────────────────');
	lines.push(`Total: ${summary.summary.totalInvariants} invariants`);
	lines.push(`Passed: ${summary.summary.passed} | Failed: ${summary.summary.failed}`);
	lines.push(
		`Errors: ${summary.summary.errors} | Warnings: ${summary.summary.warnings} | Info: ${summary.summary.infos}`,
	);
	lines.push(`Duration: ${summary.totalDurationMs.toFixed(2)}ms`);
	lines.push('───────────────────────────────────────────────────────────────');

	const exitIcon =
		summary.exitCode === 'success' ? '✓' : summary.exitCode === 'warnings' ? '⚠' : '✗';
	lines.push(`Exit: ${exitIcon} ${summary.exitCode.toUpperCase()}`);

	return lines.join('\n');
}
