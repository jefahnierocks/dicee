/**
 * ElevenLabs API Client
 *
 * HTTP client for ElevenLabs Sound Effects API.
 * Handles authentication, retries, and response parsing.
 *
 * @see packages/web/src/tools/audio-gen/README.md#elevenlabs-api-references
 */

import {
	API_KEY_HEADER,
	type ElevenLabsConfig,
	SOUND_EFFECTS_ENDPOINT,
	type SoundEffectRequest,
	validateConfig,
	validateSoundEffectRequest,
} from '../schema/index.js';

// =============================================================================
// Types
// =============================================================================

export interface ApiGenerationResult {
	/** Whether the generation succeeded */
	success: boolean;
	/** Audio data as Buffer (if success) */
	audioData?: Buffer;
	/** Content type of the audio */
	contentType?: string;
	/** ElevenLabs request ID for tracking */
	requestId?: string;
	/** Error message (if failed) */
	error?: string;
	/** HTTP status code */
	statusCode?: number;
}

export interface ClientOptions {
	/** Enable verbose logging */
	verbose?: boolean;
	/** Custom logger function */
	logger?: (msg: string) => void;
}

// =============================================================================
// ElevenLabs Client Class
// =============================================================================

export class ElevenLabsClient {
	readonly #config: ElevenLabsConfig;
	readonly #verbose: boolean;
	readonly #log: (msg: string) => void;

	constructor(config: ElevenLabsConfig, options: ClientOptions = {}) {
		// Validate config
		const result = validateConfig(config);
		if (!result.success) {
			throw new Error(`Invalid ElevenLabs config: ${JSON.stringify(result.error)}`);
		}

		this.#config = result.data;
		this.#verbose = options.verbose ?? false;
		// biome-ignore lint/suspicious/noConsole: CLI tool logging
		this.#log = options.logger ?? ((msg: string) => console.log(`[ElevenLabs] ${msg}`));
	}

	/**
	 * Generate a sound effect from a text prompt
	 */
	async generateSoundEffect(request: SoundEffectRequest): Promise<ApiGenerationResult> {
		// Validate request
		const validation = validateSoundEffectRequest(request);
		if (!validation.success) {
			return {
				success: false,
				error: `Invalid request: ${JSON.stringify(validation.error)}`,
			};
		}

		const url = `${this.#config.baseUrl}${SOUND_EFFECTS_ENDPOINT}`;
		const body = JSON.stringify(validation.data);

		if (this.#verbose) {
			this.#log(`Generating sound effect: "${request.text.slice(0, 50)}..."`);
			this.#log(
				`Duration: ${request.duration_seconds ?? 'auto'}s, Looping: ${request.enable_looping ?? false}`,
			);
		}

		// Retry loop
		let lastError: string | undefined;
		for (let attempt = 0; attempt <= this.#config.retries; attempt++) {
			if (attempt > 0) {
				if (this.#verbose) {
					this.#log(`Retry attempt ${attempt}/${this.#config.retries}...`);
				}
				await this.#sleep(this.#config.retryDelayMs * attempt);
			}

			try {
				const result = await this.#makeRequest(url, body);
				if (result.success || !this.#isRetryable(result.statusCode)) {
					return result;
				}
				lastError = result.error;
			} catch (err) {
				lastError = err instanceof Error ? err.message : String(err);
			}
		}

		return {
			success: false,
			error: lastError ?? 'Unknown error after retries',
		};
	}

	/**
	 * Make the actual HTTP request
	 */
	async #makeRequest(url: string, body: string): Promise<ApiGenerationResult> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), this.#config.timeoutMs);

		try {
			const response = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					[API_KEY_HEADER]: this.#config.apiKey,
				},
				body,
				signal: controller.signal,
			});

			const requestId = response.headers.get('request-id') ?? undefined;
			const contentType = response.headers.get('content-type') ?? 'audio/mpeg';

			if (!response.ok) {
				const errorText = await response.text().catch(() => 'Unknown error');
				return {
					success: false,
					error: `API error ${response.status}: ${errorText}`,
					statusCode: response.status,
					requestId,
				};
			}

			// Get audio data as ArrayBuffer then convert to Buffer
			const arrayBuffer = await response.arrayBuffer();
			const audioData = Buffer.from(arrayBuffer);

			if (this.#verbose) {
				this.#log(`Generated ${audioData.length} bytes of audio (${contentType})`);
			}

			return {
				success: true,
				audioData,
				contentType,
				requestId,
				statusCode: response.status,
			};
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				return {
					success: false,
					error: `Request timeout after ${this.#config.timeoutMs}ms`,
				};
			}
			throw err;
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Check if an error is retryable
	 */
	#isRetryable(statusCode?: number): boolean {
		if (!statusCode) return true;
		// Retry on 5xx errors and 429 (rate limit)
		return statusCode >= 500 || statusCode === 429;
	}

	/**
	 * Sleep for a given number of milliseconds
	 */
	#sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an ElevenLabs client from environment variables
 */
export function createClientFromEnv(options: ClientOptions = {}): ElevenLabsClient {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	if (!apiKey) {
		throw new Error(
			'ELEVENLABS_API_KEY environment variable is not set.\n' +
				'Run the command through ./scripts/with-dicee-elevenlabs-local.sh -- <command>.',
		);
	}

	return new ElevenLabsClient(
		{
			apiKey,
			baseUrl: process.env.ELEVENLABS_BASE_URL ?? 'https://api.elevenlabs.io',
			timeoutMs: Number.parseInt(process.env.ELEVENLABS_TIMEOUT_MS ?? '60000', 10),
			retries: Number.parseInt(process.env.ELEVENLABS_RETRIES ?? '2', 10),
			retryDelayMs: Number.parseInt(process.env.ELEVENLABS_RETRY_DELAY_MS ?? '1000', 10),
		},
		options,
	);
}
