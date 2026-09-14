/**
 * @dicee/shared
 *
 * Shared types and schemas for Dicee multiplayer game.
 * Single source of truth for all WebSocket message types.
 *
 * @example
 * // Import types
 * import type { GameState, DiceArray, Category } from '@dicee/shared';
 *
 * // Import events
 * import type { ServerEvent, Command } from '@dicee/shared';
 * import { isValidServerEventType, isDiceEvent } from '@dicee/shared';
 *
 * // Import validation schemas
 * import { ServerEventSchema, CommandSchema, parseServerEvent } from '@dicee/shared';
 *
 * // Import utilities
 * import { createEmptyScorecard, calculateTotalScore } from '@dicee/shared';
 */

// =============================================================================
// Core Types
// =============================================================================

// Re-export all types
export * from './types/index.js';

// =============================================================================
// WebSocket Protocol
// =============================================================================

// Re-export all events
export * from './events/index.js';

// Protocol version handshake
export * from './protocol.js';

// =============================================================================
// Validation Schemas
// =============================================================================

// Re-export validation schemas
export * from './validation/index.js';

// =============================================================================
// Utilities
// =============================================================================

// Re-export utility functions
export * from './utils/index.js';
