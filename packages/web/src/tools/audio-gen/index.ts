/**
 * Audio Generation Tool
 *
 * CLI tool for generating audio assets using ElevenLabs Sound Effects API.
 * Provides structured asset definitions, generation tracking, and output management.
 *
 * @see packages/web/src/tools/audio-gen/README.md#audio-plan
 *
 * Usage:
 *   pnpm audio:list     - List all defined assets
 *   pnpm audio:status   - Show generation status
 *   pnpm audio:gen      - Generate assets (see --help for options)
 */

// Re-export client
export * from './client/index.js';

// Re-export config
export * from './config/index.js';
// Re-export schemas
export * from './schema/index.js';

// Version
export const AUDIO_GEN_VERSION = '1.0.0';
