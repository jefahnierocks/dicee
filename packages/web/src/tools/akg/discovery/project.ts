/**
 * AKG Discovery - ts-morph Project Setup
 *
 * Initializes and manages the ts-morph Project for TypeScript AST analysis.
 * Handles loading TypeScript configuration and adding source files.
 *
 * @see docs/architecture/akg/README.md
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project, type SourceFile } from 'ts-morph';
import type { AKGConfig } from '../schema/config.schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of project initialization
 */
export interface ProjectInitResult {
	success: true;
	project: Project;
	sourceFiles: SourceFile[];
	stats: {
		tsFiles: number;
		svelteFiles: number;
		totalFiles: number;
		loadTimeMs: number;
	};
}

/**
 * Error result from project initialization
 */
export interface ProjectInitError {
	success: false;
	error: {
		type: 'tsconfig_not_found' | 'project_init_failed' | 'no_files_found';
		message: string;
		cause?: unknown;
	};
}

/**
 * Combined result type
 */
export type ProjectResult = ProjectInitResult | ProjectInitError;

// =============================================================================
// Project Creation
// =============================================================================

/**
 * Create a ts-morph project from AKG configuration
 *
 * @param config - AKG configuration with discovery settings
 * @param projectRoot - Absolute path to project root
 * @returns Project initialization result
 */
export async function createProject(
	config: AKGConfig,
	projectRoot: string,
): Promise<ProjectResult> {
	const startTime = performance.now();

	// Resolve tsconfig path
	const tsconfigPath = resolve(
		projectRoot,
		config.discovery?.tsconfig ?? 'packages/web/tsconfig.json',
	);

	// Verify tsconfig exists
	if (!existsSync(tsconfigPath)) {
		return {
			success: false,
			error: {
				type: 'tsconfig_not_found',
				message: `TypeScript config not found: ${tsconfigPath}`,
			},
		};
	}

	try {
		// Create ts-morph project with tsconfig
		const project = new Project({
			tsConfigFilePath: tsconfigPath,
			skipAddingFilesFromTsConfig: true, // We'll add files manually based on config
			skipFileDependencyResolution: false, // We want to resolve dependencies
		});

		// Add source files based on include/exclude patterns
		const sourceFiles = await addSourceFiles(project, config, projectRoot);

		if (sourceFiles.length === 0) {
			return {
				success: false,
				error: {
					type: 'no_files_found',
					message: 'No source files found matching include patterns',
				},
			};
		}

		// Count file types
		const stats = {
			tsFiles: sourceFiles.filter((f) => f.getFilePath().endsWith('.ts')).length,
			svelteFiles: 0, // Svelte files handled separately
			totalFiles: sourceFiles.length,
			loadTimeMs: Math.round(performance.now() - startTime),
		};

		return {
			success: true,
			project,
			sourceFiles,
			stats,
		};
	} catch (error) {
		return {
			success: false,
			error: {
				type: 'project_init_failed',
				message: `Failed to initialize ts-morph project: ${error instanceof Error ? error.message : String(error)}`,
				cause: error,
			},
		};
	}
}

/**
 * Create a minimal ts-morph project for testing or quick analysis
 *
 * @param tsconfigPath - Optional path to tsconfig
 * @returns ts-morph Project instance
 */
export function createMinimalProject(tsconfigPath?: string): Project {
	if (tsconfigPath && existsSync(tsconfigPath)) {
		return new Project({
			tsConfigFilePath: tsconfigPath,
			skipAddingFilesFromTsConfig: true,
		});
	}

	// Create project with default compiler options for analysis
	return new Project({
		compilerOptions: {
			target: 99, // ESNext
			module: 99, // ESNext
			moduleResolution: 100, // Bundler
			strict: true,
			esModuleInterop: true,
			skipLibCheck: true,
			allowSyntheticDefaultImports: true,
		},
	});
}

// =============================================================================
// File Management
// =============================================================================

/**
 * Add source files to project based on config patterns
 */
async function addSourceFiles(
	project: Project,
	config: AKGConfig,
	projectRoot: string,
): Promise<SourceFile[]> {
	const includePatterns = config.discovery?.include ?? [
		'packages/web/src/**/*.ts',
		'packages/shared/src/**/*.ts',
		'packages/cloudflare-do/src/**/*.ts',
	];

	const excludePatterns = config.discovery?.exclude ?? [
		'**/*.test.ts',
		'**/*.spec.ts',
		'**/__tests__/**',
		'**/__mocks__/**',
		'**/node_modules/**',
	];

	// Filter to only .ts files (Svelte files handled by svelte-parser)
	const tsPatterns = includePatterns.filter((p) => p.endsWith('.ts') || p.includes('*.ts'));

	// Build absolute glob patterns
	const absolutePatterns = tsPatterns.map((p) => resolve(projectRoot, p));

	// Add files to project
	const sourceFiles = project.addSourceFilesAtPaths(absolutePatterns);

	// Filter out excluded files
	const excludeRegexes = excludePatterns.map((p) => globToRegex(p));

	return sourceFiles.filter((file) => {
		const relativePath = file.getFilePath().replace(projectRoot, '');
		return !excludeRegexes.some((regex) => regex.test(relativePath));
	});
}

/**
 * Add a virtual source file to the project
 *
 * Used for Svelte script blocks that need type analysis
 *
 * @param project - ts-morph Project
 * @param filePath - Virtual file path (e.g., "Component.svelte.__instance__.ts")
 * @param content - TypeScript content to analyze
 * @returns Created SourceFile
 */
export function addVirtualSourceFile(
	project: Project,
	filePath: string,
	content: string,
): SourceFile {
	return project.createSourceFile(filePath, content, { overwrite: true });
}

/**
 * Remove a source file from the project
 *
 * @param project - ts-morph Project
 * @param filePath - Path to file to remove
 */
export function removeSourceFile(project: Project, filePath: string): void {
	const sourceFile = project.getSourceFile(filePath);
	if (sourceFile) {
		project.removeSourceFile(sourceFile);
	}
}

// =============================================================================
// Analysis Utilities
// =============================================================================

/**
 * Get all imports from a source file
 *
 * @param sourceFile - ts-morph SourceFile
 * @returns Array of import declarations with metadata
 */
export function getImports(sourceFile: SourceFile) {
	return sourceFile.getImportDeclarations().map((imp) => ({
		moduleSpecifier: imp.getModuleSpecifierValue(),
		isTypeOnly: imp.isTypeOnly(),
		namedImports: imp.getNamedImports().map((n) => ({
			name: n.getName(),
			alias: n.getAliasNode()?.getText(),
			isTypeOnly: n.isTypeOnly(),
		})),
		defaultImport: imp.getDefaultImport()?.getText(),
		namespaceImport: imp.getNamespaceImport()?.getText(),
		line: imp.getStartLineNumber(),
	}));
}

/**
 * Get all exports from a source file
 *
 * @param sourceFile - ts-morph SourceFile
 * @returns Array of export information
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AST traversal requires handling many declaration types
export function getExports(sourceFile: SourceFile) {
	const exports: Array<{
		name: string;
		kind: 'function' | 'class' | 'const' | 'type' | 'interface' | 'default' | 'unknown';
		line: number;
		isTypeOnly: boolean;
	}> = [];

	// Named exports from declarations
	for (const exp of sourceFile.getExportedDeclarations()) {
		const [name, declarations] = exp;
		for (const decl of declarations) {
			let kind: (typeof exports)[number]['kind'] = 'unknown';

			if (decl.getKindName() === 'FunctionDeclaration') kind = 'function';
			else if (decl.getKindName() === 'ClassDeclaration') kind = 'class';
			else if (decl.getKindName() === 'VariableDeclaration') kind = 'const';
			else if (decl.getKindName() === 'TypeAliasDeclaration') kind = 'type';
			else if (decl.getKindName() === 'InterfaceDeclaration') kind = 'interface';

			exports.push({
				name,
				kind,
				line: decl.getStartLineNumber(),
				isTypeOnly: kind === 'type' || kind === 'interface',
			});
		}
	}

	// Default export
	const defaultExport = sourceFile.getDefaultExportSymbol();
	if (defaultExport) {
		const decl = defaultExport.getDeclarations()[0];
		exports.push({
			name: 'default',
			kind: 'default',
			line: decl?.getStartLineNumber() ?? 1,
			isTypeOnly: false,
		});
	}

	return exports;
}

/**
 * Check if a source file uses Svelte 5 runes
 *
 * @param sourceFile - ts-morph SourceFile
 * @returns true if file uses $state, $derived, $effect, etc.
 */
export function usesRunes(sourceFile: SourceFile): boolean {
	const text = sourceFile.getFullText();
	const runePatterns = [
		/\$state\s*\(/,
		/\$derived\s*\(/,
		/\$effect\s*\(/,
		/\$props\s*\(/,
		/\$bindable\s*\(/,
	];

	return runePatterns.some((pattern) => pattern.test(text));
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert a glob pattern to a regex
 * Simple implementation for common patterns
 */
function globToRegex(glob: string): RegExp {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars
		.replace(/\*\*/g, '<<<GLOBSTAR>>>') // Preserve **
		.replace(/\*/g, '[^/]*') // * matches any except /
		.replace(/<<<GLOBSTAR>>>/g, '.*') // ** matches anything
		.replace(/\?/g, '.'); // ? matches single char

	return new RegExp(escaped);
}
