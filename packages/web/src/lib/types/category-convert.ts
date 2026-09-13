/**
 * Category Type Conversion Utilities
 *
 * This module provides conversion between the two Category representations:
 * - CoreCategory ($lib/types.ts): PascalCase, used internally in TypeScript
 * - WireCategory ($lib/types/multiplayer.ts): camelCase, used in JSON/WebSocket
 *
 * @invariant category_type_consistency
 * @see docs/architecture/akg/README.md#authoring-invariants
 */

import type { Category as CoreCategory } from '../types.js';
import type { Category as WireCategory } from './multiplayer.js';

// =============================================================================
// Bidirectional Mapping
// =============================================================================

/**
 * Maps CoreCategory (PascalCase) to WireCategory (camelCase)
 */
export const CORE_TO_WIRE: Record<CoreCategory, WireCategory> = {
	Ones: 'ones',
	Twos: 'twos',
	Threes: 'threes',
	Fours: 'fours',
	Fives: 'fives',
	Sixes: 'sixes',
	ThreeOfAKind: 'threeOfAKind',
	FourOfAKind: 'fourOfAKind',
	FullHouse: 'fullHouse',
	SmallStraight: 'smallStraight',
	LargeStraight: 'largeStraight',
	Dicee: 'dicee',
	Chance: 'chance',
};

/**
 * Maps WireCategory (camelCase) to CoreCategory (PascalCase)
 */
export const WIRE_TO_CORE: Record<WireCategory, CoreCategory> = {
	ones: 'Ones',
	twos: 'Twos',
	threes: 'Threes',
	fours: 'Fours',
	fives: 'Fives',
	sixes: 'Sixes',
	threeOfAKind: 'ThreeOfAKind',
	fourOfAKind: 'FourOfAKind',
	fullHouse: 'FullHouse',
	smallStraight: 'SmallStraight',
	largeStraight: 'LargeStraight',
	dicee: 'Dicee',
	chance: 'Chance',
};

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert CoreCategory (PascalCase) to WireCategory (camelCase).
 * Use at boundaries when sending data to PartyKit/WebSocket.
 *
 * @example
 * const wireCategory = toWireCategory('Dicee'); // 'dicee'
 */
export function toWireCategory(category: CoreCategory): WireCategory {
	return CORE_TO_WIRE[category];
}

/**
 * Convert WireCategory (camelCase) to CoreCategory (PascalCase).
 * Use at boundaries when receiving data from PartyKit/WebSocket.
 *
 * @example
 * const coreCategory = toCoreCategory('dicee'); // 'Dicee'
 */
export function toCoreCategory(category: WireCategory): CoreCategory {
	return WIRE_TO_CORE[category];
}

// =============================================================================
// Type Guards
// =============================================================================

const WIRE_CATEGORIES = new Set<string>([
	'ones',
	'twos',
	'threes',
	'fours',
	'fives',
	'sixes',
	'threeOfAKind',
	'fourOfAKind',
	'fullHouse',
	'smallStraight',
	'largeStraight',
	'dicee',
	'chance',
]);

const CORE_CATEGORIES = new Set<string>([
	'Ones',
	'Twos',
	'Threes',
	'Fours',
	'Fives',
	'Sixes',
	'ThreeOfAKind',
	'FourOfAKind',
	'FullHouse',
	'SmallStraight',
	'LargeStraight',
	'Dicee',
	'Chance',
]);

/**
 * Type guard for WireCategory (camelCase)
 */
export function isWireCategory(value: unknown): value is WireCategory {
	return typeof value === 'string' && WIRE_CATEGORIES.has(value);
}

/**
 * Type guard for CoreCategory (PascalCase)
 */
export function isCoreCategory(value: unknown): value is CoreCategory {
	return typeof value === 'string' && CORE_CATEGORIES.has(value);
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { CoreCategory, WireCategory };
