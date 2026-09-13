/**
 * ElevenLabs API Schemas
 *
 * Zod 4 schemas for ElevenLabs Sound Effects API.
 * @see packages/web/src/tools/audio-gen/README.md#elevenlabs-api-references
 *
 * @see https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
 */

import { z } from 'zod';

// =============================================================================
// API Request Schemas
// =============================================================================

/**
 * Prompt influence level - controls how strictly the model follows the prompt
 */
export const PromptInfluenceSchema = z.enum(['high', 'low']);
export type PromptInfluence = z.infer<typeof PromptInfluenceSchema>;

/**
 * Sound effect generation request
 */
export const SoundEffectRequestSchema = z.object({
	/** Text description of the sound effect to generate */
	text: z
		.string()
		.min(1, { error: 'Prompt text is required' })
		.max(1000, { error: 'Prompt must be 1000 characters or less' }),

	/** Duration in seconds (0.1 to 30) */
	duration_seconds: z
		.number()
		.min(0.1, { error: 'Duration must be at least 0.1 seconds' })
		.max(30, { error: 'Duration cannot exceed 30 seconds' })
		.optional(),

	/** Enable seamless looping for ambient sounds */
	enable_looping: z.boolean().optional(),

	/** Prompt influence level */
	prompt_influence: PromptInfluenceSchema.optional(),
});

export type SoundEffectRequest = z.infer<typeof SoundEffectRequestSchema>;

/**
 * API response headers we care about
 */
export const ResponseHeadersSchema = z.object({
	/** Request ID for tracking */
	'request-id': z.string().optional(),
	/** Content type of the response */
	'content-type': z.string(),
	/** Content length in bytes */
	'content-length': z.string().optional(),
});

// =============================================================================
// API Configuration
// =============================================================================

/**
 * ElevenLabs API configuration
 */
export const ElevenLabsConfigSchema = z.object({
	/** API key (from environment or secrets manager) */
	apiKey: z.string().min(1, { error: 'API key is required' }),

	/** Base URL for the API */
	baseUrl: z.string().url().default('https://api.elevenlabs.io'),

	/** Request timeout in milliseconds */
	timeoutMs: z.number().int().min(1000).max(120000).default(60000),

	/** Number of retries for failed requests */
	retries: z.number().int().min(0).max(5).default(2),

	/** Delay between retries in milliseconds */
	retryDelayMs: z.number().int().min(100).max(10000).default(1000),
});

export type ElevenLabsConfig = z.infer<typeof ElevenLabsConfigSchema>;

// =============================================================================
// API Endpoints
// =============================================================================

/** Sound effects endpoint path */
export const SOUND_EFFECTS_ENDPOINT = '/v1/sound-generation';

/** API header for authentication */
export const API_KEY_HEADER = 'xi-api-key';

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate a sound effect request
 */
export function validateSoundEffectRequest(input: unknown) {
	return SoundEffectRequestSchema.safeParse(input);
}

/**
 * Validate ElevenLabs configuration
 */
export function validateConfig(input: unknown) {
	return ElevenLabsConfigSchema.safeParse(input);
}
