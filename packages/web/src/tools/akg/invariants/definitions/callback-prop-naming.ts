/**
 * Callback Prop Naming Invariant
 *
 * Enforces that component callback props use the onVerb naming pattern.
 * Example: onRoll, onScore, onClose (not handleRoll, rollHandler, etc.)
 *
 * NOTE: This invariant requires prop type information from Svelte components.
 * Currently disabled by default as the AKG discovery doesn't capture prop types yet.
 * Enable once discovery is enhanced to extract props from Svelte components.
 *
 * @see AGENTS.md for naming conventions
 */

import type { AKGGraph } from '../../schema/graph.schema.js';
import type { AKGQueryEngine, InvariantViolation } from '../../schema/invariant.schema.js';
import { createViolation } from '../../schema/invariant.schema.js';
import { defineInvariant } from '../registry.js';

const INVARIANT_ID = 'callback_prop_naming';
const INVARIANT_NAME = 'Callback Prop Naming';

// Patterns that indicate incorrect callback naming
const INCORRECT_PATTERNS = [
	/^handle[A-Z]/, // handleClick, handleRoll
	/Handler$/, // clickHandler, rollHandler
	/Callback$/, // clickCallback
	/^do[A-Z]/, // doClick
	/^fire[A-Z]/, // fireEvent
];

// Correct pattern: onVerb (camelCase starting with 'on')
const CORRECT_PATTERN = /^on[A-Z][a-zA-Z]*$/;

defineInvariant(
	{
		id: INVARIANT_ID,
		name: INVARIANT_NAME,
		description:
			'Component callback props must use the onVerb naming pattern (e.g., onRoll, onScore, onClose). This ensures consistency across the codebase.',
		category: 'naming',
		severity: 'warning',
		businessRule:
			'Callback props follow the onVerb convention to distinguish them from DOM event handlers (lowercase) and internal handlers (handleVerb).',
		enabledByDefault: false, // Disabled until discovery captures prop types
		meta: {
			added: '1.0.0',
		},
	},
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Complex pattern matching required for naming conventions
	(_graph: AKGGraph, engine: AKGQueryEngine): InvariantViolation[] => {
		const violations: InvariantViolation[] = [];

		// Find all Component nodes
		const componentNodes = engine.getNodes((n) => n.type === 'Component');

		for (const node of componentNodes) {
			// Check exports for callback-looking props
			// NOTE: Currently exports are null for Svelte components
			// This will need enhancement in the discovery phase
			const exports = node.attributes?.exports;
			if (!Array.isArray(exports)) continue;

			for (const exp of exports) {
				// Only check if it looks like a function/callback prop
				const name = typeof exp === 'object' && exp !== null ? exp.name : String(exp);
				if (typeof name !== 'string') continue;

				// Skip if it matches the correct pattern
				if (CORRECT_PATTERN.test(name)) continue;

				// Check if it matches an incorrect pattern
				const matchesIncorrect = INCORRECT_PATTERNS.some((pattern) => pattern.test(name));

				if (matchesIncorrect) {
					const suggestedName = suggestCorrectName(name);

					const violation = createViolation(
						INVARIANT_ID,
						INVARIANT_NAME,
						`Callback prop '${name}' should use onVerb naming pattern.`,
						node.id,
						'warning',
					);

					violation.evidence = [
						{
							filePath: node.filePath ?? 'unknown',
							line: node.attributes?.startLine ?? 1,
						},
					];

					violation.businessRule =
						'Callback props use onVerb (camelCase) to be consistent with Svelte conventions.';
					violation.suggestion = suggestedName
						? `Rename '${name}' to '${suggestedName}'`
						: `Rename '${name}' to follow the onVerb pattern (e.g., onClick, onSubmit)`;

					violations.push(violation);
				}
			}
		}

		return violations;
	},
);

/**
 * Suggest a correct name for an incorrectly named callback
 */
function suggestCorrectName(name: string): string | null {
	// handleClick -> onClick
	if (name.startsWith('handle')) {
		const verb = name.slice(6); // Remove 'handle'
		if (verb.length > 0) {
			return `on${verb}`;
		}
	}

	// clickHandler -> onClick
	if (name.endsWith('Handler')) {
		const verb = name.slice(0, -7); // Remove 'Handler'
		if (verb.length > 0) {
			return `on${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
		}
	}

	// clickCallback -> onClick
	if (name.endsWith('Callback')) {
		const verb = name.slice(0, -8); // Remove 'Callback'
		if (verb.length > 0) {
			return `on${verb.charAt(0).toUpperCase()}${verb.slice(1)}`;
		}
	}

	return null;
}
