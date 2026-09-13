/**
 * AKG Discovery - Svelte 5 Parser
 *
 * Extracts TypeScript from Svelte 5 components for AST analysis.
 * Uses the native Svelte compiler with modern: true for Svelte 5 AST.
 *
 * @see docs/architecture/akg/README.md
 */

import { readFile } from 'node:fs/promises';
import { type AST, parse } from 'svelte/compiler';
import type { Project, SourceFile } from 'ts-morph';

// =============================================================================
// Types
// =============================================================================

/**
 * Extracted script content from a Svelte component
 */
export interface SvelteScripts {
	/** Instance script (<script>) content */
	instance: string | null;
	/** Module script (<script module>) content */
	module: string | null;
	/** Script language (ts, js, or null) */
	lang: 'ts' | 'js' | null;
	/** Start line of instance script in original file */
	instanceStartLine: number | null;
	/** Start line of module script in original file */
	moduleStartLine: number | null;
}

/**
 * Component template analysis result
 */
export interface SvelteTemplateInfo {
	/** Component names used in template (e.g., ["Button", "Icon"]) */
	componentUsages: Array<{
		name: string;
		line: number;
		props: string[];
	}>;
	/** Whether component uses slots */
	hasSlots: boolean;
	/** Whether component uses snippet blocks */
	hasSnippets: boolean;
}

/**
 * Complete Svelte component analysis result
 */
export interface SvelteAnalysis {
	/** File path */
	filePath: string;
	/** Extracted scripts */
	scripts: SvelteScripts;
	/** Template analysis */
	template: SvelteTemplateInfo;
	/** Raw AST for advanced analysis */
	ast: AST.Root;
}

// =============================================================================
// Script Extraction
// =============================================================================

/**
 * Extract TypeScript/JavaScript from Svelte component
 *
 * @param code - Svelte component source code
 * @param filePath - Path for error reporting
 * @returns Extracted script content
 */
export function extractSvelteScripts(code: string, filePath: string): SvelteScripts {
	try {
		const ast = parse(code, { modern: true });

		// Extract instance script - cast to access start/end from ESTree node
		const instanceContent = ast.instance?.content as unknown as
			| { start: number; end: number }
			| undefined;
		const instance = instanceContent
			? code.slice(instanceContent.start, instanceContent.end)
			: null;

		// Extract module script
		const moduleContent = ast.module?.content as unknown as
			| { start: number; end: number }
			| undefined;
		const module = moduleContent ? code.slice(moduleContent.start, moduleContent.end) : null;

		// Detect language from script attributes
		let lang: 'ts' | 'js' | null = null;
		if (ast.instance?.attributes) {
			const langAttr = ast.instance.attributes.find(
				(attr): attr is AST.Attribute => attr.type === 'Attribute' && attr.name === 'lang',
			);
			if (langAttr && langAttr.value !== true && Array.isArray(langAttr.value)) {
				const value = langAttr.value[0] as { type: string; data?: string } | undefined;
				if (value?.type === 'Text' && value.data === 'ts') {
					lang = 'ts';
				}
			}
		}

		// Default to ts for .svelte files in TypeScript projects
		if (!lang && instance) {
			lang = 'ts';
		}

		// Calculate start lines
		const instanceStartLine = instanceContent ? getLineNumber(code, instanceContent.start) : null;
		const moduleStartLine = moduleContent ? getLineNumber(code, moduleContent.start) : null;

		return {
			instance,
			module,
			lang,
			instanceStartLine,
			moduleStartLine,
		};
	} catch (error) {
		console.warn(`Failed to parse Svelte component: ${filePath}`, error);
		return {
			instance: null,
			module: null,
			lang: null,
			instanceStartLine: null,
			moduleStartLine: null,
		};
	}
}

/**
 * Parse Svelte component and analyze template
 *
 * @param code - Svelte component source code
 * @param filePath - Path for error reporting
 * @returns Complete analysis result
 */
export function analyzeSvelteComponent(code: string, filePath: string): SvelteAnalysis {
	const ast = parse(code, { modern: true });
	const scripts = extractSvelteScripts(code, filePath);
	const template = analyzeTemplate(ast, code);

	return {
		filePath,
		scripts,
		template,
		ast,
	};
}

/**
 * Load and analyze a Svelte file from disk
 *
 * @param filePath - Absolute path to .svelte file
 * @returns Analysis result
 */
export async function loadAndAnalyzeSvelteFile(filePath: string): Promise<SvelteAnalysis> {
	const code = await readFile(filePath, 'utf-8');
	return analyzeSvelteComponent(code, filePath);
}

// =============================================================================
// Template Analysis
// =============================================================================

/**
 * Analyze Svelte template for component usages and features
 */
function analyzeTemplate(ast: AST.Root, code: string): SvelteTemplateInfo {
	const componentUsages: SvelteTemplateInfo['componentUsages'] = [];
	let hasSlots = false;
	let hasSnippets = false;

	// Walk the fragment to find component usages
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: AST walking requires nested conditionals for node types
	function walk(node: AST.SvelteNode | AST.Fragment) {
		if (!node || typeof node !== 'object') return;

		// Check for component usage (PascalCase elements)
		if (node.type === 'Component') {
			const compNode = node as AST.Component;
			const props = compNode.attributes
				.filter((attr): attr is AST.Attribute => attr.type === 'Attribute')
				.map((attr) => attr.name);

			componentUsages.push({
				name: compNode.name,
				line: getLineNumber(code, compNode.start),
				props,
			});
		}

		// Check for slots
		if (node.type === 'SlotElement') {
			hasSlots = true;
		}

		// Check for snippets (Svelte 5)
		if (node.type === 'SnippetBlock') {
			hasSnippets = true;
		}

		// Recurse into children
		if ('fragment' in node && node.fragment) {
			walk(node.fragment);
		}
		if ('nodes' in node && Array.isArray(node.nodes)) {
			for (const child of node.nodes) {
				walk(child);
			}
		}
		if ('children' in node && Array.isArray(node.children)) {
			for (const child of node.children) {
				walk(child as AST.SvelteNode);
			}
		}
	}

	walk(ast.fragment);

	return {
		componentUsages,
		hasSlots,
		hasSnippets,
	};
}

// =============================================================================
// ts-morph Integration
// =============================================================================

/**
 * Add Svelte component scripts to ts-morph project as virtual files
 *
 * @param project - ts-morph Project
 * @param svelteCode - Svelte component source
 * @param filePath - Original .svelte file path
 * @returns Created virtual source files
 */
export function addSvelteToProject(
	project: Project,
	svelteCode: string,
	filePath: string,
): { instance: SourceFile | null; module: SourceFile | null } {
	const scripts = extractSvelteScripts(svelteCode, filePath);

	let instanceFile: SourceFile | null = null;
	let moduleFile: SourceFile | null = null;

	// Add instance script as virtual .ts file
	if (scripts.instance) {
		const virtualPath = `${filePath}.__instance__.ts`;
		instanceFile = project.createSourceFile(virtualPath, scripts.instance, {
			overwrite: true,
		});
	}

	// Add module script as virtual .ts file
	if (scripts.module) {
		const virtualPath = `${filePath}.__module__.ts`;
		moduleFile = project.createSourceFile(virtualPath, scripts.module, {
			overwrite: true,
		});
	}

	return { instance: instanceFile, module: moduleFile };
}

/**
 * Remove Svelte virtual files from project
 *
 * @param project - ts-morph Project
 * @param filePath - Original .svelte file path
 */
export function removeSvelteFromProject(project: Project, filePath: string): void {
	const instancePath = `${filePath}.__instance__.ts`;
	const modulePath = `${filePath}.__module__.ts`;

	const instanceFile = project.getSourceFile(instancePath);
	if (instanceFile) {
		project.removeSourceFile(instanceFile);
	}

	const moduleFile = project.getSourceFile(modulePath);
	if (moduleFile) {
		project.removeSourceFile(moduleFile);
	}
}

// =============================================================================
// Import Extraction
// =============================================================================

/**
 * Extract imports from Svelte component scripts
 *
 * @param analysis - Svelte analysis result
 * @returns Array of import information
 */
export function getSvelteImports(analysis: SvelteAnalysis) {
	const imports: Array<{
		moduleSpecifier: string;
		isTypeOnly: boolean;
		importedNames: string[];
		source: 'instance' | 'module';
		line: number;
	}> = [];

	// Parse instance script for imports
	if (analysis.scripts.instance) {
		const instanceImports = extractImportsFromScript(
			analysis.scripts.instance,
			analysis.scripts.instanceStartLine ?? 1,
		);
		for (const imp of instanceImports) {
			imports.push({ ...imp, source: 'instance' });
		}
	}

	// Parse module script for imports
	if (analysis.scripts.module) {
		const moduleImports = extractImportsFromScript(
			analysis.scripts.module,
			analysis.scripts.moduleStartLine ?? 1,
		);
		for (const imp of moduleImports) {
			imports.push({ ...imp, source: 'module' });
		}
	}

	return imports;
}

/**
 * Extract imports using regex (fast path without full AST)
 */
function extractImportsFromScript(
	script: string,
	startLine: number,
): Array<{
	moduleSpecifier: string;
	isTypeOnly: boolean;
	importedNames: string[];
	line: number;
}> {
	const imports: Array<{
		moduleSpecifier: string;
		isTypeOnly: boolean;
		importedNames: string[];
		line: number;
	}> = [];

	// Match import statements
	const importRegex =
		/import\s+(?:type\s+)?(?:(\{[^}]+\})|(\*\s+as\s+\w+)|(\w+))?\s*(?:,\s*(?:(\{[^}]+\})|(\w+)))?\s*from\s+['"]([^'"]+)['"]/g;

	const lines = script.split('\n');
	let match = importRegex.exec(script);

	while (match !== null) {
		const fullMatch = match[0];
		const moduleSpecifier = match[6];
		const isTypeOnly = fullMatch.includes('import type');

		// Calculate line number
		const matchStart = match.index;
		let currentPos = 0;
		let matchLine = 0;
		for (let i = 0; i < lines.length; i++) {
			if (currentPos + lines[i].length >= matchStart) {
				matchLine = i;
				break;
			}
			currentPos += lines[i].length + 1; // +1 for newline
		}

		// Extract imported names
		const importedNames: string[] = [];
		const namedImports = match[1] || match[4];
		if (namedImports) {
			const names = namedImports
				.replace(/[{}]/g, '')
				.split(',')
				.map((n) =>
					n
						.trim()
						.split(/\s+as\s+/)[0]
						.replace(/^type\s+/, ''),
				)
				.filter(Boolean);
			importedNames.push(...names);
		}
		const defaultImport = match[3] || match[5];
		if (defaultImport) {
			importedNames.push(defaultImport);
		}
		const namespaceImport = match[2];
		if (namespaceImport) {
			const nsName = namespaceImport.replace(/\*\s+as\s+/, '');
			importedNames.push(nsName);
		}

		imports.push({
			moduleSpecifier,
			isTypeOnly,
			importedNames,
			line: startLine + matchLine,
		});

		match = importRegex.exec(script);
	}

	return imports;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get line number from character offset
 */
function getLineNumber(code: string, offset: number): number {
	let line = 1;
	for (let i = 0; i < offset && i < code.length; i++) {
		if (code[i] === '\n') line++;
	}
	return line;
}

/**
 * Check if a component is a "smart" container (imports stores/services)
 */
export function isSmartContainer(scripts: SvelteScripts): boolean {
	const combinedScript = [scripts.instance ?? '', scripts.module ?? ''].join('\n');

	// Check for store or service imports
	const smartPatterns = [
		/from\s+['"][^'"]*\/stores\//,
		/from\s+['"][^'"]*\/services\//,
		/from\s+['"][^'"]*\.svelte\.ts['"]/,
	];

	return smartPatterns.some((pattern) => pattern.test(combinedScript));
}

/**
 * Check if a component uses Svelte 5 runes
 */
export function usesRunes(scripts: SvelteScripts): boolean {
	const combinedScript = [scripts.instance ?? '', scripts.module ?? ''].join('\n');

	const runePatterns = [
		/\$state\s*[(<]/,
		/\$derived\s*[(<]/,
		/\$effect\s*[(<]/,
		/\$props\s*[(<]/,
		/\$bindable\s*[(<]/,
	];

	return runePatterns.some((pattern) => pattern.test(combinedScript));
}
