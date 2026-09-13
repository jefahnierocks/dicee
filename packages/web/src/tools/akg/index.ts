/**
 * Architectural Knowledge Graph (AKG)
 *
 * Static architectural analysis for Dicee codebase.
 * Provides graph-based invariant checking and dependency analysis.
 *
 * @see docs/architecture/akg/README.md
 */

// Re-export config utilities
export * from './config/index.js';
// Re-export discovery utilities
export * from './discovery/index.js';
// Re-export invariant system
export * from './invariants/index.js';
// Re-export query engine
export * from './query/index.js';
// Re-export all schemas
export * from './schema/index.js';

// Version
export const AKG_VERSION = '1.0.0';
