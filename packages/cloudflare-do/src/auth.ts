/**
 * JWT Authentication Module
 *
 * Verifies Supabase JWTs for WebSocket connections using jose library.
 * Implements JWKS caching for performance.
 */

import * as jose from 'jose';
import { createLogger } from './lib/logger';

const authLogger = createLogger({ component: 'Auth' });

// =============================================================================
// Types
// =============================================================================

/**
 * Claims extracted from a verified Supabase JWT.
 * These are standard Supabase auth claims.
 */
export interface JWTClaims {
	/** User ID (Supabase auth.users.id) */
	sub: string;

	/** User email */
	email?: string;

	/** User metadata from Supabase profile */
	user_metadata?: {
		display_name?: string;
		avatar_url?: string;
		full_name?: string;
	};

	/** App metadata (role, etc.) */
	app_metadata?: {
		provider?: string;
		providers?: string[];
	};

	/** Token audience */
	aud: string;

	/** Token expiration (Unix timestamp) */
	exp: number;

	/** Token issued at (Unix timestamp) */
	iat: number;

	/** Token issuer */
	iss: string;

	/** Session ID */
	session_id?: string;

	/** Role (typically 'authenticated') */
	role?: string;
}

/**
 * Successful authentication result
 */
export interface AuthSuccess {
	success: true;
	claims: JWTClaims;
}

/**
 * Failed authentication result
 */
export interface AuthFailure {
	success: false;
	error: string;
	code:
		| 'MISSING_TOKEN'
		| 'EXPIRED'
		| 'INVALID_CLAIMS'
		| 'INVALID_SIGNATURE'
		| 'JWKS_ERROR'
		| 'UNKNOWN';
}

/**
 * Authentication result union type
 */
export type AuthResult = AuthSuccess | AuthFailure;

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseVerifiedClaims(payload: jose.JWTPayload, expectedIssuer: string): JWTClaims | null {
	if (
		typeof payload.sub !== 'string' ||
		payload.sub.length === 0 ||
		payload.aud !== 'authenticated' ||
		payload.iss !== expectedIssuer ||
		typeof payload.exp !== 'number' ||
		!Number.isFinite(payload.exp) ||
		typeof payload.iat !== 'number' ||
		!Number.isFinite(payload.iat)
	) {
		return null;
	}

	const rawUserMetadata =
		typeof payload.user_metadata === 'object' && payload.user_metadata !== null
			? (payload.user_metadata as Record<string, unknown>)
			: undefined;
	const rawAppMetadata =
		typeof payload.app_metadata === 'object' && payload.app_metadata !== null
			? (payload.app_metadata as Record<string, unknown>)
			: undefined;
	const providers = rawAppMetadata?.providers;

	return {
		sub: payload.sub,
		aud: payload.aud,
		exp: payload.exp,
		iat: payload.iat,
		iss: payload.iss,
		email: optionalString(payload.email),
		role: optionalString(payload.role),
		session_id: optionalString(payload.session_id),
		user_metadata: rawUserMetadata
			? {
					display_name: optionalString(rawUserMetadata.display_name),
					avatar_url: optionalString(rawUserMetadata.avatar_url),
					full_name: optionalString(rawUserMetadata.full_name),
				}
			: undefined,
		app_metadata: rawAppMetadata
			? {
					provider: optionalString(rawAppMetadata.provider),
					providers: Array.isArray(providers)
						? providers.filter((provider): provider is string => typeof provider === 'string')
						: undefined,
				}
			: undefined,
	};
}

// =============================================================================
// JWKS Cache
// =============================================================================

/**
 * Module-level JWKS cache for performance.
 * Persists across requests within the same worker instance.
 * Automatically refreshed by jose when keys rotate.
 */
interface JWKSCache {
	getKey: jose.JWTVerifyGetKey;
	supabaseUrl: string;
	createdAt: number;
}

let jwksCache: JWKSCache | null = null;

/**
 * Cache TTL in milliseconds (1 hour).
 * JWKS keys rarely change, but we refresh periodically to pick up rotations.
 */
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Get or create JWKS key getter for a Supabase project.
 * Uses module-level caching for performance.
 */
function getJWKSKeyGetter(supabaseUrl: string): jose.JWTVerifyGetKey {
	const now = Date.now();

	// Return cached getter if valid and same URL
	if (
		jwksCache &&
		jwksCache.supabaseUrl === supabaseUrl &&
		now - jwksCache.createdAt < JWKS_CACHE_TTL_MS
	) {
		return jwksCache.getKey;
	}

	// Create new JWKS key getter
	const jwksUrl = new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);

	const getKey = jose.createRemoteJWKSet(jwksUrl, {
		// Cache the JWKS response for 10 minutes
		cacheMaxAge: 10 * 60 * 1000,
		// Retry up to 3 times on network errors
		cooldownDuration: 30_000,
	});

	// Update cache
	jwksCache = {
		getKey,
		supabaseUrl,
		createdAt: now,
	};

	return getKey;
}

// =============================================================================
// JWT Verification
// =============================================================================

/**
 * Verify a Supabase JWT token.
 *
 * Supports both:
 * - Asymmetric keys (ES256, RS256) via JWKS discovery endpoint
 * - Legacy HS256 shared secret (fallback)
 *
 * @param token - The JWT access token from the client
 * @param supabaseUrl - The Supabase project URL (e.g., https://xxx.supabase.co)
 * @param jwtSecret - Optional legacy JWT secret for HS256 fallback
 * @returns AuthResult indicating success with claims or failure with error
 *
 * @example
 * ```typescript
 * const result = await verifySupabaseJWT(token, env.SUPABASE_URL, env.SUPABASE_JWT_SECRET);
 * if (!result.success) {
 *   return new Response(result.error, { status: 401 });
 * }
 * const userId = result.claims.sub;
 * ```
 */
export async function verifySupabaseJWT(
	token: string,
	supabaseUrl: string,
	jwtSecret?: string,
): Promise<AuthResult> {
	// Validate inputs
	if (!token || typeof token !== 'string') {
		return {
			success: false,
			error: 'Missing or invalid token',
			code: 'MISSING_TOKEN',
		};
	}

	if (!supabaseUrl || typeof supabaseUrl !== 'string') {
		return {
			success: false,
			error: 'Supabase URL not configured',
			code: 'JWKS_ERROR',
		};
	}

	try {
		// First, try JWKS-based verification (for asymmetric keys like ES256)
		const getKey = getJWKSKeyGetter(supabaseUrl);

		try {
			const { payload } = await jose.jwtVerify(token, getKey, {
				// Verify issuer matches Supabase auth
				issuer: `${supabaseUrl}/auth/v1`,
				// Verify audience is 'authenticated' (Supabase standard)
				audience: 'authenticated',
				// Allow 30 second clock skew
				clockTolerance: 30,
			});

			const claims = parseVerifiedClaims(payload, `${supabaseUrl}/auth/v1`);
			if (!claims) {
				return {
					success: false,
					error: 'Token is missing required claims',
					code: 'INVALID_CLAIMS',
				};
			}

			return {
				success: true,
				claims,
			};
		} catch (jwksError) {
			// If JWKS fails and we have a JWT secret, try HS256 fallback
			if (jwtSecret && jwksError instanceof jose.errors.JWKSNoMatchingKey) {
				authLogger.debug('JWKS verification failed, trying HS256 fallback', {
					operation: 'jwt_verify_hs256_fallback',
				});
				const secret = new TextEncoder().encode(jwtSecret);

				const { payload } = await jose.jwtVerify(token, secret, {
					algorithms: ['HS256'],
					issuer: `${supabaseUrl}/auth/v1`,
					audience: 'authenticated',
					clockTolerance: 30,
				});

				const claims = parseVerifiedClaims(payload, `${supabaseUrl}/auth/v1`);
				if (!claims) {
					return {
						success: false,
						error: 'Token is missing required claims',
						code: 'INVALID_CLAIMS',
					};
				}

				return {
					success: true,
					claims,
				};
			}

			// Re-throw if no fallback available
			throw jwksError;
		}
	} catch (error) {
		// Handle specific jose errors
		if (error instanceof jose.errors.JWTExpired) {
			return {
				success: false,
				error: 'Token expired',
				code: 'EXPIRED',
			};
		}

		if (error instanceof jose.errors.JWTClaimValidationFailed) {
			return {
				success: false,
				error: 'Invalid token claims',
				code: 'INVALID_CLAIMS',
			};
		}

		if (error instanceof jose.errors.JWSSignatureVerificationFailed) {
			return {
				success: false,
				error: 'Invalid token signature',
				code: 'INVALID_SIGNATURE',
			};
		}

		if (error instanceof jose.errors.JWKSNoMatchingKey) {
			return {
				success: false,
				error: 'No matching key found in JWKS (rotate to asymmetric key or provide JWT secret)',
				code: 'INVALID_SIGNATURE',
			};
		}

		// Network errors fetching JWKS
		if (
			error instanceof Error &&
			(error.message.includes('fetch') || error.message.includes('network'))
		) {
			authLogger.error('JWKS fetch error', {
				operation: 'jwt_verify_jwks_error',
				error: error.message,
			});
			return {
				success: false,
				error: 'Unable to verify token (JWKS unavailable)',
				code: 'JWKS_ERROR',
			};
		}

		// Log unexpected errors
		authLogger.error('JWT verification failed', {
			operation: 'jwt_verify_error',
			error: error instanceof Error ? error.message : String(error),
		});

		return {
			success: false,
			error: 'Authentication failed',
			code: 'UNKNOWN',
		};
	}
}

/**
 * Extract user display name from JWT claims.
 * Falls back through metadata sources.
 */
export function extractDisplayName(claims: JWTClaims): string {
	return claims.user_metadata?.display_name || `Player-${claims.sub.slice(0, 6)}`;
}

/**
 * Extract avatar URL from JWT claims.
 * Returns null if not available.
 */
export function extractAvatarUrl(claims: JWTClaims): string | null {
	const avatarUrl = claims.user_metadata?.avatar_url;
	if (!avatarUrl) return null;

	try {
		const url = new URL(avatarUrl);
		return url.protocol === 'https:' && url.hostname === 'api.dicebear.com' ? url.toString() : null;
	} catch {
		return null;
	}
}

/**
 * Clear the JWKS cache.
 * Useful for testing or when keys are known to have rotated.
 */
export function clearJWKSCache(): void {
	jwksCache = null;
}
