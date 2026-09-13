/**
 * Auth Module Unit Tests
 *
 * Tests JWT verification logic and helper functions.
 * Uses mocked jose library since we can't make real JWKS requests in tests.
 */

import * as jose from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearJWKSCache,
	extractAvatarUrl,
	extractDisplayName,
	type JWTClaims,
	verifySupabaseJWT,
} from '../auth';

// =============================================================================
// Test Fixtures
// =============================================================================

const MOCK_SUPABASE_URL = 'https://test-project.supabase.co';

const validClaims: JWTClaims = {
	sub: 'user-123',
	email: 'test@example.com',
	user_metadata: {
		display_name: 'Test User',
		avatar_url: 'https://example.com/avatar.png',
		full_name: 'Test Full Name',
	},
	app_metadata: {
		provider: 'google',
		providers: ['google'],
	},
	aud: 'authenticated',
	exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
	iat: Math.floor(Date.now() / 1000),
	iss: `${MOCK_SUPABASE_URL}/auth/v1`,
	session_id: 'session-456',
	role: 'authenticated',
};

// =============================================================================
// Mock Setup
// =============================================================================

// Mock the jose module
vi.mock('jose', async () => {
	const actual = await vi.importActual<typeof jose>('jose');
	return {
		...actual,
		createRemoteJWKSet: vi.fn(),
		jwtVerify: vi.fn(),
	};
});

// =============================================================================
// Tests
// =============================================================================

describe('verifySupabaseJWT', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearJWKSCache();

		// Default mock: createRemoteJWKSet returns a function
		vi.mocked(jose.createRemoteJWKSet).mockReturnValue(vi.fn() as unknown as jose.JWTVerifyGetKey);
	});

	afterEach(() => {
		clearJWKSCache();
	});

	describe('input validation', () => {
		it('should reject missing token', async () => {
			const result = await verifySupabaseJWT('', MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('MISSING_TOKEN');
				expect(result.error).toContain('Missing');
			}
		});

		it('should reject null token', async () => {
			const result = await verifySupabaseJWT(null as unknown as string, MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('MISSING_TOKEN');
			}
		});

		it('should reject missing supabase URL', async () => {
			const result = await verifySupabaseJWT('valid-token', '');

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('JWKS_ERROR');
			}
		});
	});

	describe('successful verification', () => {
		it('should return success with valid claims', async () => {
			vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
				payload: validClaims,
				protectedHeader: { alg: 'RS256' },
			} as jose.JWTVerifyResult);

			const result = await verifySupabaseJWT('valid-token', MOCK_SUPABASE_URL);

			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.claims.sub).toBe('user-123');
				expect(result.claims.email).toBe('test@example.com');
				expect(result.claims.user_metadata?.display_name).toBe('Test User');
			}
		});

		it('should create JWKS key getter with correct URL', async () => {
			vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
				payload: validClaims,
				protectedHeader: { alg: 'RS256' },
			} as jose.JWTVerifyResult);

			await verifySupabaseJWT('valid-token', MOCK_SUPABASE_URL);

			expect(jose.createRemoteJWKSet).toHaveBeenCalledWith(
				expect.objectContaining({
					href: `${MOCK_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
				}),
				expect.any(Object),
			);
		});

		it('should verify with correct options', async () => {
			vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
				payload: validClaims,
				protectedHeader: { alg: 'RS256' },
			} as jose.JWTVerifyResult);

			await verifySupabaseJWT('test-token', MOCK_SUPABASE_URL);

			expect(jose.jwtVerify).toHaveBeenCalledWith(
				'test-token',
				expect.any(Function),
				expect.objectContaining({
					issuer: `${MOCK_SUPABASE_URL}/auth/v1`,
					audience: 'authenticated',
					clockTolerance: 30,
				}),
			);
		});
	});

	describe('JWKS caching', () => {
		it('should cache JWKS key getter for same URL', async () => {
			vi.mocked(jose.jwtVerify).mockResolvedValue({
				payload: validClaims,
				protectedHeader: { alg: 'RS256' },
			} as jose.JWTVerifyResult);

			// First call
			await verifySupabaseJWT('token-1', MOCK_SUPABASE_URL);
			// Second call
			await verifySupabaseJWT('token-2', MOCK_SUPABASE_URL);

			// Should only create JWKS once
			expect(jose.createRemoteJWKSet).toHaveBeenCalledTimes(1);
		});

		it('should create new JWKS for different URL', async () => {
			vi.mocked(jose.jwtVerify).mockResolvedValue({
				payload: validClaims,
				protectedHeader: { alg: 'RS256' },
			} as jose.JWTVerifyResult);

			await verifySupabaseJWT('token-1', MOCK_SUPABASE_URL);
			await verifySupabaseJWT('token-2', 'https://other-project.supabase.co');

			expect(jose.createRemoteJWKSet).toHaveBeenCalledTimes(2);
		});
	});

	describe('error handling', () => {
		it('should handle expired token', async () => {
			vi.mocked(jose.jwtVerify).mockRejectedValueOnce(new jose.errors.JWTExpired('Token expired'));

			const result = await verifySupabaseJWT('expired-token', MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('EXPIRED');
				expect(result.error).toBe('Token expired');
			}
		});

		it('should handle invalid claims', async () => {
			vi.mocked(jose.jwtVerify).mockRejectedValueOnce(
				new jose.errors.JWTClaimValidationFailed('Invalid audience'),
			);

			const result = await verifySupabaseJWT('invalid-token', MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('INVALID_CLAIMS');
			}
		});

		it('should handle invalid signature', async () => {
			vi.mocked(jose.jwtVerify).mockRejectedValueOnce(
				new jose.errors.JWSSignatureVerificationFailed('Signature verification failed'),
			);

			const result = await verifySupabaseJWT('bad-signature-token', MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('INVALID_SIGNATURE');
			}
		});

		it('should handle missing matching key', async () => {
			vi.mocked(jose.jwtVerify).mockRejectedValueOnce(
				new jose.errors.JWKSNoMatchingKey('No matching key'),
			);

			const result = await verifySupabaseJWT('unknown-key-token', MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('INVALID_SIGNATURE');
			}
		});

		it('should handle missing subject claim', async () => {
			const claimsWithoutSub = { ...validClaims, sub: undefined };
			vi.mocked(jose.jwtVerify).mockResolvedValueOnce({
				payload: claimsWithoutSub,
				protectedHeader: { alg: 'RS256' },
			} as unknown as jose.JWTVerifyResult);

			const result = await verifySupabaseJWT('no-sub-token', MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('INVALID_CLAIMS');
				expect(result.error).toBe('Token is missing required claims');
			}
		});

		it('should handle unknown errors gracefully', async () => {
			vi.mocked(jose.jwtVerify).mockRejectedValueOnce(new Error('Unknown error'));

			const result = await verifySupabaseJWT('error-token', MOCK_SUPABASE_URL);

			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.code).toBe('UNKNOWN');
				expect(result.error).toBe('Authentication failed');
			}
		});
	});
});

describe('extractDisplayName', () => {
	it('should prefer display_name', () => {
		const claims: JWTClaims = {
			...validClaims,
			user_metadata: {
				display_name: 'Display Name',
				full_name: 'Full Name',
			},
		};

		expect(extractDisplayName(claims)).toBe('Display Name');
	});

	it('should not expose provider full_name as a display name', () => {
		const claims: JWTClaims = {
			...validClaims,
			user_metadata: {
				full_name: 'Full Name',
			},
		};

		expect(extractDisplayName(claims)).toBe('Player-user-1');
	});

	it('should not expose an email username as a display name', () => {
		const claims: JWTClaims = {
			...validClaims,
			email: 'john.doe@example.com',
			user_metadata: {},
		};

		expect(extractDisplayName(claims)).toBe('Player-user-1');
	});

	it('should use a non-identifying stable fallback when no display name is available', () => {
		const claims: JWTClaims = {
			...validClaims,
			email: undefined,
			user_metadata: undefined,
		};

		expect(extractDisplayName(claims)).toBe('Player-user-1');
	});
});

describe('extractAvatarUrl', () => {
	it('should reject an avatar URL from an untrusted host', () => {
		const claims: JWTClaims = {
			...validClaims,
			user_metadata: {
				avatar_url: 'https://example.com/avatar.png',
			},
		};

		expect(extractAvatarUrl(claims)).toBeNull();
	});

	it('should accept an HTTPS DiceBear avatar URL', () => {
		const claims: JWTClaims = {
			...validClaims,
			user_metadata: {
				avatar_url: 'https://api.dicebear.com/9.x/identicon/svg?seed=test',
			},
		};

		expect(extractAvatarUrl(claims)).toBe('https://api.dicebear.com/9.x/identicon/svg?seed=test');
	});

	it('should return null when no avatar_url', () => {
		const claims: JWTClaims = {
			...validClaims,
			user_metadata: {},
		};

		expect(extractAvatarUrl(claims)).toBeNull();
	});

	it('should return null when no user_metadata', () => {
		const claims: JWTClaims = {
			...validClaims,
			user_metadata: undefined,
		};

		expect(extractAvatarUrl(claims)).toBeNull();
	});
});

describe('clearJWKSCache', () => {
	it('should allow cache to be cleared', async () => {
		// Reset mock call count for this specific test
		vi.mocked(jose.createRemoteJWKSet).mockClear();

		vi.mocked(jose.jwtVerify).mockResolvedValue({
			payload: validClaims,
			protectedHeader: { alg: 'RS256' },
		} as jose.JWTVerifyResult);

		// First call - creates cache
		await verifySupabaseJWT('token-1', MOCK_SUPABASE_URL);
		expect(jose.createRemoteJWKSet).toHaveBeenCalledTimes(1);

		// Clear cache
		clearJWKSCache();

		// Second call - should create new cache
		await verifySupabaseJWT('token-2', MOCK_SUPABASE_URL);
		expect(jose.createRemoteJWKSet).toHaveBeenCalledTimes(2);
	});
});
