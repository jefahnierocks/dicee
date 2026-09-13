/**
 * AKG Configuration Schema
 *
 * Zod 4 schemas for AKG configuration files.
 *
 * @see docs/architecture/akg/README.md
 */

import { z } from 'zod';
import { Severity } from './graph.schema.js';

// =============================================================================
// Layer Configuration
// =============================================================================

/**
 * Layer definition for architecture enforcement
 */
export const LayerDefinition = z.object({
	/** Layer name */
	name: z.string().min(1),

	/** Glob patterns for files in this layer */
	paths: z.array(z.string()).min(1),

	/** Description */
	description: z.string().optional(),

	/** Layers this layer may import from */
	mayImport: z.array(z.string()).optional(),

	/** Layers this layer must not import from */
	mayNotImport: z.array(z.string()).optional(),

	/** Special handling notes */
	notes: z.string().optional(),
});

export type LayerDefinition = z.infer<typeof LayerDefinition>;

// =============================================================================
// Invariant Configuration
// =============================================================================

/**
 * Invariant override in config
 */
export const InvariantOverride = z.object({
	/** Invariant ID to override */
	id: z.string().min(1),

	/** Override severity */
	severity: Severity.optional(),

	/** Disable entirely */
	enabled: z.boolean().optional(),

	/** Additional exclude patterns */
	exclude: z.array(z.string()).optional(),
});

export type InvariantOverride = z.infer<typeof InvariantOverride>;

/**
 * Invariants configuration section
 */
export const InvariantsConfig = z.object({
	/** Invariants to enable (if not enabledByDefault) */
	enable: z.array(z.string()).optional(),

	/** Invariants to disable */
	disable: z.array(z.string()).optional(),

	/** Per-invariant overrides */
	overrides: z.array(InvariantOverride).optional(),
});

export type InvariantsConfig = z.infer<typeof InvariantsConfig>;

// =============================================================================
// Discovery Configuration
// =============================================================================

/**
 * Discovery settings
 */
export const DiscoveryConfig = z.object({
	/** File patterns to include */
	include: z
		.array(z.string())
		.default([
			'packages/web/src/**/*.ts',
			'packages/web/src/**/*.svelte',
			'packages/shared/src/**/*.ts',
			'packages/cloudflare-do/src/**/*.ts',
		]),

	/** File patterns to exclude */
	exclude: z
		.array(z.string())
		.default([
			'**/*.test.ts',
			'**/*.spec.ts',
			'**/__tests__/**',
			'**/__mocks__/**',
			'**/node_modules/**',
		]),

	/** TypeScript config path */
	tsconfig: z.string().default('packages/web/tsconfig.json'),
});

export type DiscoveryConfig = z.infer<typeof DiscoveryConfig>;

// =============================================================================
// Output Configuration
// =============================================================================

/**
 * Output settings
 */
export const OutputConfig = z.object({
	/** Graph output path */
	graphPath: z.string().default('docs/architecture/akg/graph/current.json'),

	/** Enable history snapshots */
	history: z.boolean().default(true),

	/** History directory */
	historyPath: z.string().default('docs/architecture/akg/graph/history'),
});

export type OutputConfig = z.infer<typeof OutputConfig>;

// =============================================================================
// CI Configuration
// =============================================================================

/**
 * CI settings
 */
export const CIConfig = z.object({
	/** Fail on error-severity violations */
	failOnError: z.boolean().default(true),

	/** Fail on warning-severity violations */
	failOnWarning: z.boolean().default(false),

	/** Generate SARIF output for GitHub */
	sarif: z.boolean().default(false),
});

export type CIConfig = z.infer<typeof CIConfig>;

// =============================================================================
// Main Configuration
// =============================================================================

/**
 * AKG configuration file schema
 */
export const AKGConfig = z.object({
	/** Config version */
	version: z.string().default('1.0.0'),

	/** Project name */
	project: z.string().min(1),

	/** Discovery settings */
	discovery: DiscoveryConfig.optional(),

	/** Layer definitions */
	layers: z.array(LayerDefinition).optional(),

	/** Invariant configuration */
	invariants: InvariantsConfig.optional(),

	/** Output settings */
	output: OutputConfig.optional(),

	/** CI settings */
	ci: CIConfig.optional(),
});

export type AKGConfig = z.infer<typeof AKGConfig>;

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default configuration for Dicee project
 */
export const defaultConfig: AKGConfig = {
	version: '1.0.0',
	project: 'dicee',

	discovery: {
		include: [
			'packages/web/src/**/*.ts',
			'packages/web/src/**/*.svelte',
			'packages/shared/src/**/*.ts',
			'packages/cloudflare-do/src/**/*.ts',
		],
		exclude: [
			'**/*.test.ts',
			'**/*.spec.ts',
			'**/__tests__/**',
			'**/__mocks__/**',
			'**/node_modules/**',
		],
		tsconfig: 'packages/web/tsconfig.json',
	},

	layers: [
		// Cross-package shared layer (foundation)
		{
			name: 'shared',
			paths: ['packages/shared/src/**'],
			mayImport: [], // Shared imports nothing external
			description: 'Cross-package shared types and schemas (@dicee/shared)',
		},
		// Cloudflare Durable Objects package
		{
			name: 'cloudflare-do',
			paths: ['packages/cloudflare-do/src/**'],
			mayImport: ['shared'],
			description: 'Cloudflare Durable Objects (GameRoom, GlobalLobby)',
		},
		// Web package layers
		{
			name: 'routes',
			paths: ['packages/web/src/routes/**'],
			mayImport: ['components', 'stores', 'services', 'types', 'lib', 'shared'],
			description: 'SvelteKit page routes and layouts',
		},
		{
			name: 'components',
			paths: ['packages/web/src/lib/components/**'],
			mayImport: ['components', 'types', 'utils', 'shared'],
			mayNotImport: ['stores', 'services'],
			notes: 'Smart containers may import stores (exception)',
		},
		{
			name: 'stores',
			paths: ['packages/web/src/lib/stores/**'],
			mayImport: ['services', 'types', 'supabase', 'shared'],
			mayNotImport: ['components', 'routes'],
			description: 'Svelte 5 rune stores',
		},
		{
			name: 'services',
			paths: ['packages/web/src/lib/services/**'],
			mayImport: ['types', 'supabase', 'wasm', 'shared'],
			mayNotImport: ['components', 'routes', 'stores'],
			description: 'Business logic and external API wrappers',
		},
		{
			name: 'types',
			paths: ['packages/web/src/lib/types/**', 'packages/web/src/lib/types.ts'],
			mayImport: ['types', 'shared'],
			description: 'TypeScript type definitions',
		},
		{
			name: 'supabase',
			paths: ['packages/web/src/lib/supabase/**'],
			mayImport: ['types', 'shared'],
			mayNotImport: ['components', 'routes', 'stores', 'services'],
			description: 'Supabase client and helpers',
		},
		{
			name: 'wasm',
			paths: ['packages/web/src/lib/wasm/**', 'packages/web/src/lib/engine.ts'],
			mayImport: ['types', 'shared'],
			notes: 'Only engine.ts should be imported by other modules',
			description: 'WASM bridge (generated + wrapper)',
		},
	],

	invariants: {
		overrides: [{ id: 'layer_component_isolation', severity: 'warning' }],
	},

	output: {
		graphPath: 'docs/architecture/akg/graph/current.json',
		history: true,
		historyPath: 'docs/architecture/akg/graph/history',
	},

	ci: {
		failOnError: true,
		failOnWarning: false,
		sarif: false,
	},
};

// =============================================================================
// Config Loading Utilities
// =============================================================================

/**
 * Deep partial type utility for nested config merging.
 * Makes all properties optional recursively, but preserves array element types.
 */
export type DeepPartial<T> = T extends (infer U)[]
	? DeepPartial<U>[]
	: T extends object
		? { [P in keyof T]?: DeepPartial<T[P]> }
		: T;

/**
 * Merge user config with defaults
 */
export function mergeWithDefaults(userConfig: DeepPartial<AKGConfig>): AKGConfig {
	const defaultDiscovery = defaultConfig.discovery ?? {
		include: [
			'packages/web/src/**/*.ts',
			'packages/web/src/**/*.svelte',
			'packages/shared/src/**/*.ts',
			'packages/cloudflare-do/src/**/*.ts',
		],
		exclude: [
			'**/*.test.ts',
			'**/*.spec.ts',
			'**/__tests__/**',
			'**/__mocks__/**',
			'**/node_modules/**',
		],
		tsconfig: 'packages/web/tsconfig.json',
	};
	const discovery = {
		include: userConfig.discovery?.include ?? defaultDiscovery.include,
		exclude: userConfig.discovery?.exclude ?? defaultDiscovery.exclude,
		tsconfig: userConfig.discovery?.tsconfig ?? defaultDiscovery.tsconfig,
	};

	const defaultOutput = defaultConfig.output ?? {
		graphPath: 'docs/architecture/akg/graph/current.json',
		history: true,
		historyPath: 'docs/architecture/akg/graph/history',
	};
	const output = {
		graphPath: userConfig.output?.graphPath ?? defaultOutput.graphPath,
		history: userConfig.output?.history ?? defaultOutput.history,
		historyPath: userConfig.output?.historyPath ?? defaultOutput.historyPath,
	};

	const defaultCi = defaultConfig.ci ?? { failOnError: true, failOnWarning: false, sarif: false };
	const ci = {
		failOnError: userConfig.ci?.failOnError ?? defaultCi.failOnError,
		failOnWarning: userConfig.ci?.failOnWarning ?? defaultCi.failOnWarning,
		sarif: userConfig.ci?.sarif ?? defaultCi.sarif,
	};

	// Type assertion is safe here: either we use validated defaults or user-provided
	// values that should be validated separately via validateConfig/safeValidateConfig
	return {
		version: userConfig.version ?? defaultConfig.version,
		project: userConfig.project ?? defaultConfig.project,
		discovery,
		layers: userConfig.layers ?? defaultConfig.layers,
		invariants: userConfig.invariants ?? defaultConfig.invariants,
		output,
		ci,
	} as AKGConfig;
}

/**
 * Validate config and throw on error
 */
export function validateConfig(config: unknown): AKGConfig {
	return AKGConfig.parse(config);
}

/**
 * Validate config and return result
 */
export function safeValidateConfig(
	config: unknown,
): { success: true; data: AKGConfig } | { success: false; error: z.ZodError } {
	const result = AKGConfig.safeParse(config);
	if (result.success) {
		return { success: true, data: result.data };
	}
	return { success: false, error: result.error };
}
