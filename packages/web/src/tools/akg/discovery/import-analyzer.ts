/**
 * AKG Discovery - Import Analyzer
 *
 * Analyzes import relationships between source files.
 * Resolves module specifiers to actual file paths.
 *
 * @see docs/architecture/akg/README.md
 */

import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { ImportDeclaration, SourceFile } from 'ts-morph';

// =============================================================================
// Types
// =============================================================================

/**
 * Resolved import information
 */
export interface ResolvedImport {
	/** Original module specifier from source */
	moduleSpecifier: string;
	/** Resolved absolute file path (null if external) */
	resolvedPath: string | null;
	/** Relative path from project root */
	relativePath: string | null;
	/** Whether this is a type-only import */
	isTypeOnly: boolean;
	/** Whether this is a dynamic import */
	isDynamic: boolean;
	/** Names imported */
	importedNames: string[];
	/** Default import name */
	defaultImport: string | null;
	/** Namespace import name */
	namespaceImport: string | null;
	/** Source location */
	location: {
		line: number;
		column: number;
	};
	/** Import category */
	category: ImportCategory;
}

/**
 * Import category for classification
 */
export type ImportCategory =
	| 'local' // Relative import to local file
	| 'package' // Import from monorepo package
	| 'node' // Node.js built-in
	| 'external' // npm package
	| 'svelte' // Svelte component import
	| 'alias'; // Path alias (e.g., $lib)

// =============================================================================
// Import Resolution
// =============================================================================

/**
 * Analyze all imports in a source file
 *
 * @param sourceFile - ts-morph SourceFile
 * @param projectRoot - Absolute project root path
 * @returns Array of resolved imports
 */
export function analyzeImports(sourceFile: SourceFile, projectRoot: string): ResolvedImport[] {
	const imports: ResolvedImport[] = [];
	const filePath = sourceFile.getFilePath();
	const fileDir = dirname(filePath);

	// Analyze static imports
	for (const importDecl of sourceFile.getImportDeclarations()) {
		const resolved = resolveImportDeclaration(importDecl, filePath, fileDir, projectRoot);
		imports.push(resolved);
	}

	// Analyze dynamic imports
	const dynamicImports = findDynamicImports(sourceFile, fileDir, projectRoot);
	imports.push(...dynamicImports);

	return imports;
}

/**
 * Resolve a single import declaration
 */
function resolveImportDeclaration(
	importDecl: ImportDeclaration,
	_filePath: string,
	fileDir: string,
	projectRoot: string,
): ResolvedImport {
	const moduleSpecifier = importDecl.getModuleSpecifierValue();
	const isTypeOnly = importDecl.isTypeOnly();

	// Get imported names
	const namedImports = importDecl.getNamedImports().map((n) => n.getName());
	const defaultImport = importDecl.getDefaultImport()?.getText() ?? null;
	const namespaceImport = importDecl.getNamespaceImport()?.getText() ?? null;

	const importedNames = [...namedImports];
	if (defaultImport) importedNames.push(defaultImport);
	if (namespaceImport) importedNames.push(namespaceImport);

	// Resolve the module specifier
	const resolved = resolveModuleSpecifier(moduleSpecifier, fileDir, projectRoot);

	return {
		moduleSpecifier,
		resolvedPath: resolved.absolutePath,
		relativePath: resolved.relativePath,
		isTypeOnly,
		isDynamic: false,
		importedNames,
		defaultImport,
		namespaceImport,
		location: {
			line: importDecl.getStartLineNumber(),
			column: importDecl.getStart() - importDecl.getStartLinePos(),
		},
		category: resolved.category,
	};
}

/**
 * Find dynamic imports in source file
 */
function findDynamicImports(
	sourceFile: SourceFile,
	fileDir: string,
	projectRoot: string,
): ResolvedImport[] {
	const imports: ResolvedImport[] = [];
	const text = sourceFile.getFullText();

	// Match import() calls
	const dynamicImportRegex = /import\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
	let match = dynamicImportRegex.exec(text);

	while (match !== null) {
		const moduleSpecifier = match[1];
		const resolved = resolveModuleSpecifier(moduleSpecifier, fileDir, projectRoot);

		// Calculate line number
		const beforeMatch = text.slice(0, match.index);
		const line = (beforeMatch.match(/\n/g) || []).length + 1;

		imports.push({
			moduleSpecifier,
			resolvedPath: resolved.absolutePath,
			relativePath: resolved.relativePath,
			isTypeOnly: false,
			isDynamic: true,
			importedNames: [],
			defaultImport: null,
			namespaceImport: null,
			location: { line, column: 0 },
			category: resolved.category,
		});

		match = dynamicImportRegex.exec(text);
	}

	return imports;
}

// =============================================================================
// Module Specifier Resolution
// =============================================================================

/**
 * Resolution result for a module specifier
 */
interface ResolutionResult {
	absolutePath: string | null;
	relativePath: string | null;
	category: ImportCategory;
}

/**
 * Resolve a module specifier to a file path
 */
function resolveModuleSpecifier(
	specifier: string,
	fromDir: string,
	projectRoot: string,
): ResolutionResult {
	// Node.js built-ins
	if (specifier.startsWith('node:') || isNodeBuiltin(specifier)) {
		return { absolutePath: null, relativePath: null, category: 'node' };
	}

	// SvelteKit $lib alias
	if (specifier.startsWith('$lib/')) {
		const libPath = specifier.replace('$lib/', 'packages/web/src/lib/');
		return resolveLocalPath(libPath, projectRoot, projectRoot, 'alias');
	}

	// SvelteKit $app imports
	if (specifier.startsWith('$app/') || specifier.startsWith('$env/')) {
		return { absolutePath: null, relativePath: null, category: 'external' };
	}

	// Relative imports
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		return resolveLocalPath(specifier, fromDir, projectRoot, 'local');
	}

	// Svelte imports
	if (specifier === 'svelte' || specifier.startsWith('svelte/')) {
		return { absolutePath: null, relativePath: null, category: 'external' };
	}

	// Monorepo package imports
	if (specifier.startsWith('@dicee/')) {
		const packagePath = resolvePackageImport(specifier, projectRoot);
		if (packagePath) {
			return {
				absolutePath: packagePath,
				relativePath: relative(projectRoot, packagePath),
				category: 'package',
			};
		}
	}

	// External npm packages
	return { absolutePath: null, relativePath: null, category: 'external' };
}

/**
 * Resolve a local/relative path
 */
function resolveLocalPath(
	specifier: string,
	fromDir: string,
	projectRoot: string,
	category: ImportCategory,
): ResolutionResult {
	// Try various extensions
	const extensions = ['.ts', '.js', '.svelte', '.json', '/index.ts', '/index.js'];

	// First, try the specifier as-is (might already have extension)
	const directPath = resolve(fromDir, specifier);
	if (existsSync(directPath)) {
		return {
			absolutePath: directPath,
			relativePath: relative(projectRoot, directPath),
			category: specifier.endsWith('.svelte') ? 'svelte' : category,
		};
	}

	// Try with extensions
	for (const ext of extensions) {
		const testPath = resolve(fromDir, specifier + ext);
		if (existsSync(testPath)) {
			return {
				absolutePath: testPath,
				relativePath: relative(projectRoot, testPath),
				category: ext === '.svelte' ? 'svelte' : category,
			};
		}
	}

	// Try removing .js extension and adding .ts (common in ESM)
	if (specifier.endsWith('.js')) {
		const tsPath = resolve(fromDir, specifier.replace(/\.js$/, '.ts'));
		if (existsSync(tsPath)) {
			return {
				absolutePath: tsPath,
				relativePath: relative(projectRoot, tsPath),
				category,
			};
		}
	}

	// Could not resolve
	return { absolutePath: null, relativePath: null, category };
}

/**
 * Resolve a monorepo package import
 */
function resolvePackageImport(specifier: string, projectRoot: string): string | null {
	// Monorepo package paths
	// @dicee/web -> packages/web/src
	// @dicee/shared -> packages/shared/src
	// @dicee/cloudflare-do -> packages/cloudflare-do/src
	// @dicee/partykit -> packages/partykit/src
	// @dicee/engine -> packages/engine/src

	const packageMap: Record<string, string> = {
		'@dicee/web': 'packages/web/src',
		'@dicee/shared': 'packages/shared/src',
		'@dicee/cloudflare-do': 'packages/cloudflare-do/src',
		'@dicee/partykit': 'packages/partykit/src',
		'@dicee/engine': 'packages/engine/src',
	};

	for (const [pkg, basePath] of Object.entries(packageMap)) {
		if (specifier === pkg) {
			// Import the package index
			const indexPath = resolve(projectRoot, basePath, 'index.ts');
			if (existsSync(indexPath)) return indexPath;
		}
		if (specifier.startsWith(`${pkg}/`)) {
			// Import a specific path from package
			const subPath = specifier.slice(pkg.length + 1);
			const result = resolveLocalPath(
				subPath,
				resolve(projectRoot, basePath),
				projectRoot,
				'package',
			);
			return result.absolutePath;
		}
	}

	return null;
}

/**
 * Check if a module is a Node.js built-in
 */
function isNodeBuiltin(specifier: string): boolean {
	const builtins = new Set([
		'assert',
		'buffer',
		'child_process',
		'cluster',
		'crypto',
		'dgram',
		'dns',
		'events',
		'fs',
		'http',
		'http2',
		'https',
		'net',
		'os',
		'path',
		'process',
		'querystring',
		'readline',
		'stream',
		'string_decoder',
		'timers',
		'tls',
		'url',
		'util',
		'v8',
		'vm',
		'zlib',
		'fs/promises',
	]);

	return builtins.has(specifier) || builtins.has(specifier.split('/')[0]);
}

// =============================================================================
// Import Filtering
// =============================================================================

/**
 * Filter imports to only local project files
 */
export function filterLocalImports(imports: ResolvedImport[]): ResolvedImport[] {
	return imports.filter(
		(imp) =>
			imp.category === 'local' ||
			imp.category === 'alias' ||
			imp.category === 'svelte' ||
			imp.category === 'package',
	);
}

/**
 * Filter to only type imports
 */
export function filterTypeImports(imports: ResolvedImport[]): ResolvedImport[] {
	return imports.filter((imp) => imp.isTypeOnly);
}

/**
 * Filter to only value imports (exclude types)
 */
export function filterValueImports(imports: ResolvedImport[]): ResolvedImport[] {
	return imports.filter((imp) => !imp.isTypeOnly);
}

/**
 * Group imports by category
 */
export function groupImportsByCategory(
	imports: ResolvedImport[],
): Record<ImportCategory, ResolvedImport[]> {
	const grouped: Record<ImportCategory, ResolvedImport[]> = {
		local: [],
		package: [],
		node: [],
		external: [],
		svelte: [],
		alias: [],
	};

	for (const imp of imports) {
		grouped[imp.category].push(imp);
	}

	return grouped;
}
