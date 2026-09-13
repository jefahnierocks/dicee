/**
 * Structured Logger
 *
 * JSON-formatted logging for Cloudflare Workers with structured context.
 * Designed for use with `wrangler tail` and jq filtering.
 *
 * @example
 * ```typescript
 * const logger = createLogger({ component: 'GameRoom' });
 * logger.info('Player joined', { operation: 'player_join', userId: '123' });
 *
 * // Filter with: wrangler tail | jq 'select(.component == "GameRoom")'
 * ```
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
	/** Component name (e.g., 'GameRoom', 'GlobalLobby') */
	component: string;
	/** Operation being performed (e.g., 'notify_lobby', 'chat_receive') */
	operation: string;
	/** Room code if applicable */
	roomCode?: string;
	/** User ID if applicable */
	userId?: string;
	/** Request/correlation ID for tracing */
	requestId?: string;
	/** Operation duration in milliseconds */
	duration?: number;
	/** Allow additional context fields */
	[key: string]: unknown;
}

export interface Logger {
	debug: (message: string, context?: Partial<LogContext>) => void;
	info: (message: string, context?: Partial<LogContext>) => void;
	warn: (message: string, context?: Partial<LogContext>) => void;
	error: (message: string, context?: Partial<LogContext>) => void;
	/** Create a child logger with additional base context */
	child: (context: Partial<LogContext>) => Logger;
	/** Create a timed operation logger */
	timed: (operation: string) => TimedLogger;
}

export interface TimedLogger {
	/** End the timed operation and log with duration */
	end: (message: string, context?: Partial<LogContext>) => void;
	/** End with info level */
	endInfo: (message: string, context?: Partial<LogContext>) => void;
	/** End with error level */
	endError: (message: string, context?: Partial<LogContext>) => void;
}

interface LogEntry {
	level: LogLevel;
	message: string;
	timestamp: string;
	[key: string]: unknown;
}

const PRIVATE_LOG_KEY =
	/(?:authorization|token|secret|password|cookie|email|displayname|avatar|userid|connectionid|sessionid|gameid|roomcode|targetid)/i;

/** Remove credentials and personal identifiers before data reaches provider logs. */
export function sanitizeLogValue(value: unknown, key = '', depth = 0): unknown {
	if (PRIVATE_LOG_KEY.test(key)) return '[REDACTED]';
	if (depth > 6) return '[TRUNCATED]';
	if (value instanceof Error) return { name: value.name };
	if (Array.isArray(value))
		return value.slice(0, 50).map((item) => sanitizeLogValue(item, '', depth + 1));
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([childKey, childValue]) => [
				childKey,
				sanitizeLogValue(childValue, childKey, depth + 1),
			]),
		);
	}
	if (typeof value === 'string') {
		return value
			.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
			.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
			.slice(0, 1024);
	}
	return value;
}

/**
 * Create a structured logger with base context
 *
 * @param baseContext - Default context included in all log entries
 * @returns Logger instance
 */
export function createLogger(baseContext: Partial<LogContext> = {}): Logger {
	const log = (level: LogLevel, message: string, context?: Partial<LogContext>) => {
		const entry: LogEntry = {
			level,
			message,
			timestamp: new Date().toISOString(),
			...baseContext,
			...context,
		};
		const safeEntry = sanitizeLogValue(entry) as LogEntry;

		// Use appropriate console method
		// Note: In Workers, all output goes to console.log but we use the methods
		// for semantic clarity and potential future differentiation
		switch (level) {
			case 'debug':
				console.log(JSON.stringify(safeEntry));
				break;
			case 'info':
				console.info(JSON.stringify(safeEntry));
				break;
			case 'warn':
				console.warn(JSON.stringify(safeEntry));
				break;
			case 'error':
				console.error(JSON.stringify(safeEntry));
				break;
		}
	};

	const createTimed = (operation: string): TimedLogger => {
		const startTime = Date.now();
		return {
			end: (message: string, context?: Partial<LogContext>) => {
				log('debug', message, { operation, duration: Date.now() - startTime, ...context });
			},
			endInfo: (message: string, context?: Partial<LogContext>) => {
				log('info', message, { operation, duration: Date.now() - startTime, ...context });
			},
			endError: (message: string, context?: Partial<LogContext>) => {
				log('error', message, { operation, duration: Date.now() - startTime, ...context });
			},
		};
	};

	return {
		debug: (msg: string, ctx?: Partial<LogContext>) => log('debug', msg, ctx),
		info: (msg: string, ctx?: Partial<LogContext>) => log('info', msg, ctx),
		warn: (msg: string, ctx?: Partial<LogContext>) => log('warn', msg, ctx),
		error: (msg: string, ctx?: Partial<LogContext>) => log('error', msg, ctx),
		child: (ctx: Partial<LogContext>) => createLogger({ ...baseContext, ...ctx }),
		timed: createTimed,
	};
}

/**
 * Pre-configured loggers for common components
 */
export const Loggers = {
	GameRoom: (roomCode?: string) => createLogger({ component: 'GameRoom', roomCode }),
	GlobalLobby: () => createLogger({ component: 'GlobalLobby' }),
	ChatManager: (roomCode?: string) => createLogger({ component: 'ChatManager', roomCode }),
	JoinRequestRepo: (roomCode?: string) => createLogger({ component: 'JoinRequestRepo', roomCode }),
	// AI components
	AIController: (roomCode?: string) => createLogger({ component: 'AIController', roomCode }),
	AIRoomManager: (roomCode?: string) => createLogger({ component: 'AIRoomManager', roomCode }),
	AIEngine: () => createLogger({ component: 'AIEngine' }),
	OptimalBrain: () => createLogger({ component: 'OptimalBrain' }),
	AdaptiveBrain: () => createLogger({ component: 'AdaptiveBrain' }),
	// Auth
	Auth: () => createLogger({ component: 'Auth' }),
	// Alarm system (Phase 1)
	AlarmQueue: () => createLogger({ component: 'AlarmQueue' }),
} as const;
