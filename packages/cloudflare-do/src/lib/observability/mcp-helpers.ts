/**
 * MCP Query Helpers for Observability
 *
 * Provides reusable query patterns for Cloudflare Observability MCP.
 * These helpers abstract common query patterns for easier debugging.
 *
 * @example
 * ```typescript
 * import { queryLifecycleEvents, queryStorageEvents } from './mcp-helpers.js';
 *
 * // Query lifecycle events for a room
 * const events = await queryLifecycleEvents('TEST-ROOM', '-1h');
 * ```
 *
 * Note: These are TypeScript types/interfaces for MCP queries.
 * Actual queries are executed via MCP tools in the agent environment.
 */

/**
 * Timeframe for observability queries
 */
export interface QueryTimeframe {
	/** ISO-8601 timestamp for absolute queries */
	from?: string;
	to?: string;
	/** Relative timeframe */
	reference?: string;
	offset?: string; // e.g., '-1h', '-30m', '-1d'
}

/**
 * Filter for observability queries
 */
export interface QueryFilter {
	key: string;
	operation:
		| 'eq'
		| 'neq'
		| 'gt'
		| 'gte'
		| 'lt'
		| 'lte'
		| 'includes'
		| 'not_includes'
		| 'starts_with'
		| 'regex'
		| 'exists'
		| 'is_null'
		| 'in'
		| 'not_in';
	type: 'string' | 'number' | 'boolean';
	value: string | number | boolean;
}

/**
 * Query parameters for Cloudflare Observability
 */
export interface ObservabilityQuery {
	queryId: string;
	view: 'events' | 'calculations' | 'invocations';
	parameters: {
		datasets?: string[];
		filters?: QueryFilter[];
		filterCombination?: 'and' | 'or';
		calculations?: Array<{
			key: string;
			keyType: 'string' | 'number' | 'boolean';
			operator:
				| 'count'
				| 'avg'
				| 'max'
				| 'min'
				| 'sum'
				| 'p99'
				| 'p95'
				| 'p90'
				| 'median'
				| 'stddev'
				| 'variance'
				| 'uniq';
			alias?: string;
		}>;
		groupBys?: Array<{
			type: 'string' | 'number' | 'boolean';
			value: string;
		}>;
		orderBy?: {
			value: string;
			order: 'asc' | 'desc';
		};
		limit?: number;
	};
	timeframe: QueryTimeframe;
	limit?: number;
}

/**
 * Query lifecycle events for a room
 *
 * @param roomCode - Room code to filter by
 * @param timeframe - Timeframe for query (e.g., '-1h', '-30m')
 * @returns Query configuration
 */
export function queryLifecycleEvents(roomCode: string, timeframe: string): ObservabilityQuery {
	return {
		queryId: 'lifecycle-events',
		view: 'events',
		parameters: {
			filters: [
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: `"roomCode":"${roomCode}"`,
				},
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: '"lifecycle.',
				},
			],
			filterCombination: 'and',
		},
		timeframe: {
			reference: new Date().toISOString(),
			offset: timeframe,
		},
		limit: 100,
	};
}

/**
 * Query storage events for a room
 *
 * @param roomCode - Room code to filter by
 * @param timeframe - Timeframe for query
 * @returns Query configuration
 */
export function queryStorageEvents(roomCode: string, timeframe: string): ObservabilityQuery {
	return {
		queryId: 'storage-events',
		view: 'events',
		parameters: {
			filters: [
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: `"roomCode":"${roomCode}"`,
				},
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: '"storage.',
				},
			],
			filterCombination: 'and',
		},
		timeframe: {
			reference: new Date().toISOString(),
			offset: timeframe,
		},
		limit: 100,
	};
}

/**
 * Query error events for a room
 *
 * @param roomCode - Room code to filter by
 * @param timeframe - Timeframe for query
 * @returns Query configuration
 */
export function queryErrorEvents(roomCode: string, timeframe: string): ObservabilityQuery {
	return {
		queryId: 'error-events',
		view: 'events',
		parameters: {
			filters: [
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: `"roomCode":"${roomCode}"`,
				},
				{
					key: '$metadata.level',
					operation: 'eq',
					type: 'string',
					value: 'error',
				},
			],
			filterCombination: 'and',
		},
		timeframe: {
			reference: new Date().toISOString(),
			offset: timeframe,
		},
		limit: 50,
	};
}

/**
 * Query events by correlation ID
 *
 * @param correlationId - Correlation ID to trace
 * @param timeframe - Timeframe for query
 * @returns Query configuration
 */
export function queryByCorrelationId(correlationId: string, timeframe: string): ObservabilityQuery {
	return {
		queryId: 'correlation-trace',
		view: 'events',
		parameters: {
			filters: [
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: `"_correlationId":"${correlationId}"`,
				},
			],
		},
		timeframe: {
			reference: new Date().toISOString(),
			offset: timeframe,
		},
		limit: 200,
	};
}

/**
 * Calculate average storage read duration
 *
 * @param roomCode - Room code to filter by
 * @param timeframe - Timeframe for query
 * @returns Query configuration
 */
export function queryStorageReadPerformance(
	roomCode: string,
	timeframe: string,
): ObservabilityQuery {
	return {
		queryId: 'storage-read-performance',
		view: 'calculations',
		parameters: {
			filters: [
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: `"roomCode":"${roomCode}"`,
				},
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: '"storage.read.end"',
				},
			],
			filterCombination: 'and',
			calculations: [
				{
					key: 'durationMs',
					keyType: 'number',
					operator: 'avg',
					alias: 'avgDuration',
				},
				{
					key: 'durationMs',
					keyType: 'number',
					operator: 'p99',
					alias: 'p99Duration',
				},
			],
		},
		timeframe: {
			reference: new Date().toISOString(),
			offset: timeframe,
		},
	};
}

/**
 * Query seat management events
 *
 * @param roomCode - Room code to filter by
 * @param timeframe - Timeframe for query
 * @returns Query configuration
 */
export function querySeatEvents(roomCode: string, timeframe: string): ObservabilityQuery {
	return {
		queryId: 'seat-events',
		view: 'events',
		parameters: {
			filters: [
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: `"roomCode":"${roomCode}"`,
				},
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: '"seat.',
				},
			],
			filterCombination: 'and',
		},
		timeframe: {
			reference: new Date().toISOString(),
			offset: timeframe,
		},
		limit: 100,
	};
}

/**
 * Query game events
 *
 * @param roomCode - Room code to filter by
 * @param timeframe - Timeframe for query
 * @returns Query configuration
 */
export function queryGameEvents(roomCode: string, timeframe: string): ObservabilityQuery {
	return {
		queryId: 'game-events',
		view: 'events',
		parameters: {
			filters: [
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: `"roomCode":"${roomCode}"`,
				},
				{
					key: '$metadata.message',
					operation: 'includes',
					type: 'string',
					value: '"game.',
				},
			],
			filterCombination: 'and',
		},
		timeframe: {
			reference: new Date().toISOString(),
			offset: timeframe,
		},
		limit: 100,
	};
}
