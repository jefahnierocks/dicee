/**
 * AKG Configuration Loader
 *
 * Handles loading, validation, and merging of AKG configuration files.
 * Supports JSON and JavaScript/TypeScript config files.
 *
 * @see docs/architecture/akg/README.md
 */

import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	type AKGConfig,
	defaultConfig,
	mergeWithDefaults,
	safeValidateConfig,
} from '../schema/config.schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Config loading result
 */
export interface ConfigLoadResult {
	success: true;
	config: AKGConfig;
	configPath: string | null;
}

/**
 * Config loading error
 */
export interface ConfigLoadError {
	success: false;
	error: ConfigError;
	configPath: string | null;
}

/**
 * Config error details
 */
export interface ConfigError {
	type: 'not_found' | 'parse_error' | 'validation_error' | 'unsupported_format';
	message: string;
	cause?: unknown;
}

/**
 * Combined result type
 */
export type ConfigResult = ConfigLoadResult | ConfigLoadError;

// =============================================================================
// Constants
// =============================================================================

/**
 * Default config file names to search for (in order of priority)
 */
export const CONFIG_FILE_NAMES = [
	'akg.config.ts',
	'akg.config.js',
	'akg.config.mjs',
	'akg.config.json',
	'.akgrc.json',
] as const;

/**
 * Supported config file extensions
 */
export const SUPPORTED_EXTENSIONS = ['.ts', '.js', '.mjs', '.json'] as const;

// =============================================================================
// Config Loading Functions
// =============================================================================

/**
 * Load AKG config from a specific file path
 *
 * @param configPath - Path to the config file
 * @returns ConfigResult with loaded config or error
 */
export async function loadConfigFromPath(configPath: string): Promise<ConfigResult> {
	const resolvedPath = resolve(configPath);
	const ext = extname(resolvedPath);

	if (!SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])) {
		return {
			success: false,
			error: {
				type: 'unsupported_format',
				message: `Unsupported config file extension: ${ext}. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`,
			},
			configPath: resolvedPath,
		};
	}

	try {
		let rawConfig: unknown;

		if (ext === '.json') {
			rawConfig = await loadJsonConfig(resolvedPath);
		} else {
			rawConfig = await loadJsConfig(resolvedPath);
		}

		return validateAndMergeConfig(rawConfig, resolvedPath);
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return {
				success: false,
				error: {
					type: 'not_found',
					message: `Config file not found: ${resolvedPath}`,
					cause: error,
				},
				configPath: resolvedPath,
			};
		}

		return {
			success: false,
			error: {
				type: 'parse_error',
				message: `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
				cause: error,
			},
			configPath: resolvedPath,
		};
	}
}

/**
 * Search for config file in a directory and its parents
 *
 * @param startDir - Directory to start searching from
 * @returns ConfigResult with loaded config or error
 */
export async function findAndLoadConfig(startDir: string): Promise<ConfigResult> {
	let currentDir = resolve(startDir);

	// Walk up the directory tree until we reach the filesystem root
	while (true) {
		for (const fileName of CONFIG_FILE_NAMES) {
			const configPath = resolve(currentDir, fileName);

			try {
				// Check if file exists by trying to read it
				await readFile(configPath);
				return loadConfigFromPath(configPath);
			} catch {
				// File doesn't exist, continue searching
			}
		}

		// Move up one directory
		const parentDir = dirname(currentDir);
		// Stop if we've reached the filesystem root
		if (parentDir === currentDir) break;
		currentDir = parentDir;
	}

	// No config file found, return defaults
	return {
		success: true,
		config: defaultConfig,
		configPath: null,
	};
}

/**
 * Load config with fallback to defaults
 *
 * Convenience function that always returns a valid config.
 *
 * @param configPath - Optional path to config file
 * @param projectRoot - Project root for searching (used if configPath not provided)
 * @returns Resolved AKG config
 */
export async function loadConfig(configPath?: string, projectRoot?: string): Promise<AKGConfig> {
	let result: ConfigResult;

	if (configPath) {
		result = await loadConfigFromPath(configPath);
	} else if (projectRoot) {
		result = await findAndLoadConfig(projectRoot);
	} else {
		// Return defaults if no path or project root provided
		return defaultConfig;
	}

	if (result.success) {
		return result.config;
	}

	// Log warning but return defaults
	console.warn(`AKG config warning: ${result.error.message}. Using defaults.`);
	return defaultConfig;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Load JSON config file
 */
async function loadJsonConfig(filePath: string): Promise<unknown> {
	const content = await readFile(filePath, 'utf-8');
	return JSON.parse(content);
}

/**
 * Load JS/TS config file via dynamic import
 */
async function loadJsConfig(filePath: string): Promise<unknown> {
	const fileUrl = pathToFileURL(filePath).href;
	const module = (await import(fileUrl)) as { default?: unknown; config?: unknown };

	// Support both default export and named 'config' export
	return module.default ?? module.config ?? module;
}

/**
 * Validate raw config and merge with defaults
 */
function validateAndMergeConfig(rawConfig: unknown, configPath: string): ConfigResult {
	const validationResult = safeValidateConfig(rawConfig);

	if (!validationResult.success) {
		return {
			success: false,
			error: {
				type: 'validation_error',
				message: formatValidationError(validationResult.error),
				cause: validationResult.error,
			},
			configPath,
		};
	}

	// Merge with defaults to fill in any missing optional fields
	const mergedConfig = mergeWithDefaults(validationResult.data);

	return {
		success: true,
		config: mergedConfig,
		configPath,
	};
}

/**
 * Format Zod validation error for user-friendly display
 */
function formatValidationError(error: {
	issues: Array<{ path: PropertyKey[]; message: string }>;
}): string {
	const issues = error.issues
		.map((issue) => {
			const path = issue.path.length > 0 ? issue.path.map(String).join('.') : 'config';
			return `  - ${path}: ${issue.message}`;
		})
		.join('\n');

	return `Config validation failed:\n${issues}`;
}

// =============================================================================
// Config File Generation
// =============================================================================

/**
 * Generate a default config file content
 *
 * @param format - Output format ('json' | 'typescript')
 * @returns Config file content as string
 */
export function generateDefaultConfig(format: 'json' | 'typescript' = 'typescript'): string {
	if (format === 'json') {
		return JSON.stringify(defaultConfig, null, '\t');
	}

	return `/**
 * AKG Configuration
 *
 * @see docs/architecture/akg/README.md
 */

import type { AKGConfig } from './src/tools/akg/schema/config.schema.js';

const config: AKGConfig = ${JSON.stringify(defaultConfig, null, '\t').replace(/"([^"]+)":/g, '$1:')};

export default config;
`;
}

/**
 * Get the project name from config or default
 */
export function getProjectName(config: AKGConfig): string {
	return config.project;
}

/**
 * Get discovery patterns from config
 */
export function getDiscoveryPatterns(config: AKGConfig): {
	include: string[];
	exclude: string[];
	tsconfig: string;
} {
	const defaultDiscovery = {
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

	return {
		include: config.discovery?.include ?? defaultDiscovery.include,
		exclude: config.discovery?.exclude ?? defaultDiscovery.exclude,
		tsconfig: config.discovery?.tsconfig ?? defaultDiscovery.tsconfig,
	};
}
