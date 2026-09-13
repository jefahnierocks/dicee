/**
 * AKG Configuration
 *
 * Architectural Knowledge Graph configuration for Dicee project.
 *
 * @see docs/architecture/akg/README.md
 */

// Note: Schema types will be imported once implemented
// import type { AKGConfig } from './packages/web/src/tools/akg/schema/config.schema';

export default {
	version: '1.0.0',
	project: 'dicee',

	discovery: {
		include: [
			'packages/web/src/**/*.ts',
			'packages/web/src/**/*.svelte',
			'packages/shared/src/**/*.ts',
			'packages/cloudflare-do/src/**/*.ts',
		],
		exclude: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**', '**/__mocks__/**', '**/node_modules/**'],
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
			mayImport: ['components', 'stores', 'services', 'types', 'wasm', 'shared'],
			description: 'SvelteKit page routes and layouts',
		},
		{
			name: 'components',
			paths: ['packages/web/src/lib/components/**'],
			mayImport: ['components', 'types', 'shared'],
			mayNotImport: ['stores', 'services'],
			notes: 'Smart containers may import stores (exception)',
		},
		{
			name: 'stores',
			paths: ['packages/web/src/lib/stores/**'],
			mayImport: ['services', 'types', 'supabase', 'shared'],
			mayNotImport: ['components', 'routes'],
		},
		{
			name: 'services',
			paths: ['packages/web/src/lib/services/**'],
			mayImport: ['types', 'supabase', 'wasm', 'shared'],
			mayNotImport: ['components', 'routes', 'stores'],
		},
		{
			name: 'types',
			paths: ['packages/web/src/lib/types/**', 'packages/web/src/lib/types.ts'],
			mayImport: ['types', 'shared'],
		},
		{
			name: 'supabase',
			paths: ['packages/web/src/lib/supabase/**'],
			mayImport: ['types', 'shared'],
			mayNotImport: ['components', 'routes', 'stores', 'services'],
		},
		{
			name: 'wasm',
			paths: ['packages/web/src/lib/wasm/**', 'packages/web/src/lib/engine.ts'],
			mayImport: ['types', 'shared'],
			notes: 'Only engine.ts should be imported by other modules',
		},
	],

	invariants: {
		// Start with warnings for layer violations to avoid blocking
		overrides: [{ id: 'layer_component_isolation', severity: 'warning' as const }],
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
