/**
 * Telemetry Service
 *
 * Client-side telemetry collection with batching, session management,
 * and privacy controls. Follows RFC-003 three-stream architecture (docs/architecture/README.md#data-contracts).
 *
 * @module services/telemetry
 */

import { browser, dev } from '$app/environment';
import type {
	TelemetryConfig,
	TelemetryEvent,
	TelemetryEventInput,
	TelemetryEventType,
	TelemetryPayloadMap,
} from '$lib/types/telemetry';
import { DEFAULT_TELEMETRY_CONFIG } from '$lib/types/telemetry';

// Debug logging only in development when debug mode enabled
function debugLog(message: string, ...args: unknown[]): void {
	if (dev) console.log(`[Telemetry] ${message}`, ...args);
}

// =============================================================================
// Constants
// =============================================================================

const SESSION_ID_KEY = 'dicee_session_id';
const CONSENT_KEY = 'dicee_telemetry_consent';
const SESSION_START_KEY = 'dicee_session_start';

// =============================================================================
// Types
// =============================================================================

type TelemetryState =
	| { status: 'uninitialized' }
	| { status: 'ready'; sessionId: string }
	| { status: 'disabled' };

// =============================================================================
// State
// =============================================================================

let state: TelemetryState = { status: 'uninitialized' };
let config: TelemetryConfig = { ...DEFAULT_TELEMETRY_CONFIG };
let eventQueue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let pageCount = 0;
let sessionStartTime: number | null = null;

// =============================================================================
// Session Management
// =============================================================================

/**
 * Generate a cryptographically secure session ID
 */
function generateSessionId(): string {
	if (typeof crypto !== 'undefined' && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	// Fallback for older browsers
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Get or create session ID
 */
function getOrCreateSessionId(): string {
	if (!browser) {
		return generateSessionId();
	}

	let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
	if (!sessionId) {
		sessionId = generateSessionId();
		sessionStorage.setItem(SESSION_ID_KEY, sessionId);
	}
	return sessionId;
}

/**
 * Get session start time
 */
function getSessionStartTime(): number {
	if (!browser) {
		return Date.now();
	}

	const stored = sessionStorage.getItem(SESSION_START_KEY);
	if (stored) {
		return Number.parseInt(stored, 10);
	}
	const now = Date.now();
	sessionStorage.setItem(SESSION_START_KEY, String(now));
	return now;
}

// =============================================================================
// Consent Management
// =============================================================================

/**
 * Check if telemetry consent is granted
 */
export function hasConsent(): boolean {
	if (!browser) {
		return true; // Default to enabled for SSR
	}
	const consent = localStorage.getItem(CONSENT_KEY);
	// Default to true if no explicit opt-out
	return consent !== 'false';
}

/**
 * Set telemetry consent
 */
export function setConsent(granted: boolean): void {
	if (!browser) return;

	localStorage.setItem(CONSENT_KEY, String(granted));

	if (!granted) {
		// Disable telemetry and clear queue
		state = { status: 'disabled' };
		eventQueue = [];
		stopFlushTimer();
	} else if (state.status === 'disabled') {
		// Re-enable telemetry
		initializeTelemetry(config);
	}
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize telemetry service
 */
export function initializeTelemetry(userConfig: Partial<TelemetryConfig> = {}): void {
	config = { ...DEFAULT_TELEMETRY_CONFIG, ...userConfig };

	if (!config.enabled || !hasConsent()) {
		state = { status: 'disabled' };
		return;
	}

	const sessionId = getOrCreateSessionId();
	sessionStartTime = getSessionStartTime();
	state = { status: 'ready', sessionId };

	// Start flush timer
	startFlushTimer();

	// Track session start
	if (browser && pageCount === 0) {
		track('session_start', {
			entry_page: window.location.pathname,
			referrer: document.referrer || null,
		});
	}

	if (config.debug) {
		debugLog('Initialized with session:', sessionId);
	}
}

/**
 * Shutdown telemetry service (call on page unload)
 */
export function shutdownTelemetry(): void {
	if (state.status !== 'ready') return;

	// Track session end
	if (browser && sessionStartTime) {
		track('session_end', {
			duration_ms: Date.now() - sessionStartTime,
			page_count: pageCount,
		});
	}

	// Flush remaining events synchronously
	flushSync();
	stopFlushTimer();
}

// =============================================================================
// Event Tracking
// =============================================================================

/**
 * Track a telemetry event
 */
export function track<T extends TelemetryEventType>(
	eventType: T,
	payload: T extends keyof TelemetryPayloadMap ? TelemetryPayloadMap[T] : Record<string, unknown>,
): void {
	if (state.status !== 'ready') {
		if (config.debug) {
			debugLog('Skipped (not ready):', eventType);
		}
		return;
	}

	const event: TelemetryEventInput<T> = {
		session_id: state.sessionId,
		event_type: eventType,
		payload,
		page_url: browser ? window.location.pathname : null,
		referrer: browser ? document.referrer || null : null,
		user_agent: browser ? navigator.userAgent : null,
		timestamp: new Date().toISOString(),
	};

	// Cast to TelemetryEvent for queue - validated at API boundary
	eventQueue.push(event as unknown as TelemetryEvent);

	if (config.debug) {
		debugLog('Tracked:', eventType, payload);
	}

	// Auto-flush if batch size reached
	if (eventQueue.length >= config.batchSize) {
		flush();
	}
}

/**
 * Track a page view
 */
export function trackPageView(page: string, previousPage: string | null = null): void {
	pageCount++;
	track('page_view', { page, previous_page: previousPage });
}

/**
 * Set user ID for authenticated sessions
 */
export function setUserId(userId: string | null): void {
	// Update all queued events with user ID
	for (const event of eventQueue) {
		event.user_id = userId;
	}
}

// =============================================================================
// Flushing
// =============================================================================

/**
 * Start the periodic flush timer
 */
function startFlushTimer(): void {
	if (flushTimer) return;
	flushTimer = setInterval(() => {
		flush();
	}, config.flushIntervalMs);
}

/**
 * Stop the periodic flush timer
 */
function stopFlushTimer(): void {
	if (flushTimer) {
		clearInterval(flushTimer);
		flushTimer = null;
	}
}

/**
 * Flush events asynchronously
 */
async function flush(): Promise<void> {
	if (eventQueue.length === 0) return;

	const eventsToSend = [...eventQueue];
	eventQueue = [];

	try {
		await sendEvents(eventsToSend);
		if (config.debug) {
			debugLog('Flushed', eventsToSend.length, 'events');
		}
	} catch (error) {
		// Re-queue events on failure
		eventQueue = [...eventsToSend, ...eventQueue];
		if (config.debug) {
			console.error('[Telemetry] Flush failed:', error);
		}
	}
}

/**
 * Flush events synchronously (for page unload)
 */
function flushSync(): void {
	if (eventQueue.length === 0) return;

	const eventsToSend = [...eventQueue];
	eventQueue = [];

	// Use sendBeacon for reliable delivery during page unload
	if (browser && navigator.sendBeacon) {
		const url = '/api/telemetry';
		const data = JSON.stringify({ events: eventsToSend });
		navigator.sendBeacon(url, data);
	}
}

/**
 * Send events to the server
 */
async function sendEvents(events: TelemetryEvent[]): Promise<void> {
	if (!browser) return;

	const response = await fetch('/api/telemetry', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ events }),
	});

	if (!response.ok) {
		throw new Error(`Telemetry send failed: ${response.status}`);
	}
}

// =============================================================================
// Diagnostics
// =============================================================================

/**
 * Get current telemetry state (for debugging)
 */
export function getTelemetryState(): {
	status: TelemetryState['status'];
	queueLength: number;
	sessionId: string | null;
} {
	return {
		status: state.status,
		queueLength: eventQueue.length,
		sessionId: state.status === 'ready' ? state.sessionId : null,
	};
}

/**
 * Reset telemetry state (for testing)
 */
export function resetTelemetry(): void {
	state = { status: 'uninitialized' };
	eventQueue = [];
	pageCount = 0;
	sessionStartTime = null;
	stopFlushTimer();
}

// =============================================================================
// Convenience Exports
// =============================================================================

export type { TelemetryEventType } from '$lib/types/telemetry';
export { TELEMETRY_EVENT_TYPES } from '$lib/types/telemetry';
