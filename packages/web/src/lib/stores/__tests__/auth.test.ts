/**
 * Auth Store Unit Tests
 *
 * Tests for auth.svelte.ts - the auth state store.
 * Uses mocked Supabase client to test state management.
 */

import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { describe, expect, it, type Mock, vi } from 'vitest';
import type { Database } from '$lib/types/database';

// =============================================================================
// Mock Supabase Client
// =============================================================================

function createMockUser(overrides: Partial<User> = {}): User {
	return {
		id: 'test-user-id',
		email: 'test@example.com',
		app_metadata: { provider: 'email' },
		user_metadata: {},
		aud: 'authenticated',
		created_at: new Date().toISOString(),
		is_anonymous: false,
		...overrides,
	} as User;
}

function createMockSession(user: User): Session {
	return {
		access_token: 'mock-access-token',
		refresh_token: 'mock-refresh-token',
		expires_in: 3600,
		expires_at: Date.now() / 1000 + 3600,
		token_type: 'bearer',
		user,
	};
}

/** Mocked auth methods - retains Mock interface for test manipulation */
interface MockAuthMethods {
	signInAnonymously: Mock;
	signInWithOAuth: Mock;
	signInWithOtp: Mock;
	linkIdentity: Mock;
	updateUser: Mock;
	signOut: Mock;
	getUserIdentities: Mock;
	onAuthStateChange: Mock;
}

/** Mock Supabase client - typed for test usage, castable to real client */
interface MockSupabaseClient {
	auth: MockAuthMethods;
	from: Mock;
	__triggerAuthChange: (event: AuthChangeEvent, session: Session | null) => void;
}

function createMockSupabaseClient(): MockSupabaseClient {
	const authListeners: Array<(event: AuthChangeEvent, session: Session | null) => void> = [];

	return {
		auth: {
			signInAnonymously: vi.fn().mockResolvedValue({ data: {}, error: null }),
			signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
			signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
			linkIdentity: vi.fn().mockResolvedValue({ data: {}, error: null }),
			updateUser: vi.fn().mockResolvedValue({ data: {}, error: null }),
			signOut: vi.fn().mockResolvedValue({ error: null }),
			getUserIdentities: vi.fn().mockResolvedValue({ data: { identities: [] }, error: null }),
			onAuthStateChange: vi.fn((callback) => {
				authListeners.push(callback);
				return { data: { subscription: { unsubscribe: vi.fn() } } };
			}),
		},
		from: vi.fn().mockReturnValue({
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockResolvedValue({ error: null }),
			}),
		}),
		// Helper to trigger auth state changes in tests
		__triggerAuthChange: (event: AuthChangeEvent, session: Session | null) => {
			authListeners.forEach((listener) => {
				listener(event, session);
			});
		},
	};
}

// =============================================================================
// Test Helpers
// =============================================================================

// We need to create a fresh AuthState for each test since it's a singleton
// This requires a bit of module mocking
async function createFreshAuthStore() {
	// Clear module cache and re-import
	vi.resetModules();
	const module = await import('../auth.svelte.js');
	return module.auth;
}

// =============================================================================
// Initial State Tests
// =============================================================================

describe('AuthState: Initial State', () => {
	it('starts uninitialized', async () => {
		const auth = await createFreshAuthStore();
		expect(auth.initialized).toBe(false);
	});

	it('starts loading', async () => {
		const auth = await createFreshAuthStore();
		expect(auth.loading).toBe(true);
	});

	it('starts unauthenticated', async () => {
		const auth = await createFreshAuthStore();
		expect(auth.isAuthenticated).toBe(false);
	});

	it('starts without user', async () => {
		const auth = await createFreshAuthStore();
		expect(auth.user).toBeNull();
	});

	it('starts without session', async () => {
		const auth = await createFreshAuthStore();
		expect(auth.session).toBeNull();
	});

	it('userId is null when not authenticated', async () => {
		const auth = await createFreshAuthStore();
		expect(auth.userId).toBeNull();
	});

	it('email is null when not authenticated', async () => {
		const auth = await createFreshAuthStore();
		expect(auth.email).toBeNull();
	});
});

// =============================================================================
// Initialization Tests
// =============================================================================

describe('AuthState: init', () => {
	it('sets initialized to true', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);

		expect(auth.initialized).toBe(true);
	});

	it('sets loading to false', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);

		expect(auth.loading).toBe(false);
	});

	it('stores session and user when provided', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser();
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);

		expect(auth.session).toStrictEqual(session);
		expect(auth.user).toStrictEqual(user);
		expect(auth.isAuthenticated).toBe(true);
	});

	it('registers auth state change listener', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);

		expect(mockClient.auth.onAuthStateChange).toHaveBeenCalledOnce();
	});

	it('updates state on auth change events', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);
		expect(auth.isAuthenticated).toBe(false);

		// Simulate sign in
		const user = createMockUser();
		const session = createMockSession(user);
		mockClient.__triggerAuthChange('SIGNED_IN', session);

		expect(auth.isAuthenticated).toBe(true);
		expect(auth.user).toStrictEqual(user);
	});

	it('clears state on SIGNED_OUT event', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser();
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);
		expect(auth.isAuthenticated).toBe(true);

		// Simulate sign out
		mockClient.__triggerAuthChange('SIGNED_OUT', null);

		expect(auth.isAuthenticated).toBe(false);
		expect(auth.session).toBeNull();
		expect(auth.user).toBeNull();
	});
});

// =============================================================================
// Anonymous Auth Tests
// =============================================================================

describe('AuthState: Anonymous Sign-In', () => {
	it('isAnonymous is true for anonymous users', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({
			is_anonymous: true,
			app_metadata: { provider: 'anonymous' },
		});
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);

		expect(auth.isAnonymous).toBe(true);
	});

	it('isAnonymous is false for email users', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({
			is_anonymous: false,
			app_metadata: { provider: 'email' },
		});
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);

		expect(auth.isAnonymous).toBe(false);
	});

	it('signInAnonymously calls supabase', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);
		await auth.signInAnonymously();

		expect(mockClient.auth.signInAnonymously).toHaveBeenCalledOnce();
	});

	it('signInAnonymously sets loading during call', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		// Make the call hang
		let resolveSignIn: () => void;
		mockClient.auth.signInAnonymously.mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSignIn = () => resolve({ data: {}, error: null });
				}),
		);

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);

		const promise = auth.signInAnonymously();
		expect(auth.loading).toBe(true);

		resolveSignIn!();
		await promise;
		expect(auth.loading).toBe(false);
	});

	it('signInAnonymously throws on error', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		mockClient.auth.signInAnonymously.mockResolvedValue({
			data: {},
			error: new Error('Rate limited'),
		});

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);

		await expect(auth.signInAnonymously()).rejects.toThrow('Rate limited');
	});

	it('signInAnonymously throws if not initialized', async () => {
		const auth = await createFreshAuthStore();

		await expect(auth.signInAnonymously()).rejects.toThrow('Supabase not initialized');
	});
});

// =============================================================================
// OAuth Tests
// =============================================================================

describe('AuthState: Google OAuth', () => {
	it('signInWithGoogle calls supabase with correct provider', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		// Mock window.location
		const originalLocation = window.location;
		// @ts-expect-error - deleting readonly property for test mock
		window.location = undefined;
		// @ts-expect-error - assigning partial Location for test mock
		window.location = { origin: 'http://localhost:5173' } as Location;

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);
		await auth.signInWithGoogle();

		expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
			provider: 'google',
			options: {
				redirectTo: 'http://localhost:5173/auth/callback',
			},
		});

		// @ts-expect-error - restoring original location
		window.location = originalLocation;
	});

	it('signInWithGoogle uses custom redirectTo', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);
		await auth.signInWithGoogle('http://localhost:5173/game');

		expect(mockClient.auth.signInWithOAuth).toHaveBeenCalledWith({
			provider: 'google',
			options: {
				redirectTo: 'http://localhost:5173/game',
			},
		});
	});

	it('linkGoogle calls linkIdentity for anonymous users', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({ is_anonymous: true });
		const session = createMockSession(user);

		// Mock window.location
		const originalLocation = window.location;
		// @ts-expect-error - deleting readonly property for test mock
		window.location = undefined;
		// @ts-expect-error - assigning partial Location for test mock
		window.location = { origin: 'http://localhost:5173' } as Location;

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);
		await auth.linkGoogle();

		expect(mockClient.auth.linkIdentity).toHaveBeenCalledWith({
			provider: 'google',
			options: {
				redirectTo: 'http://localhost:5173/auth/callback',
			},
		});

		// @ts-expect-error - restoring original location
		window.location = originalLocation;
	});

	it('linkGoogle throws for non-anonymous users', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({ is_anonymous: false });
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);

		await expect(auth.linkGoogle()).rejects.toThrow('User is not anonymous');
	});
});

// =============================================================================
// Magic Link Tests
// =============================================================================

describe('AuthState: Magic Link', () => {
	it('signInWithEmail calls supabase with email', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();

		// Mock window.location
		const originalLocation = window.location;
		// @ts-expect-error - deleting readonly property for test mock
		window.location = undefined;
		// @ts-expect-error - assigning partial Location for test mock
		window.location = { origin: 'http://localhost:5173' } as Location;

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);
		await auth.signInWithEmail('test@example.com');

		expect(mockClient.auth.signInWithOtp).toHaveBeenCalledWith({
			email: 'test@example.com',
			options: {
				emailRedirectTo: 'http://localhost:5173/auth/callback',
			},
		});

		// @ts-expect-error - restoring original location
		window.location = originalLocation;
	});

	it('linkEmail calls updateUser for anonymous users', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({ is_anonymous: true });
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);
		await auth.linkEmail('upgrade@example.com');

		expect(mockClient.auth.updateUser).toHaveBeenCalledWith({
			email: 'upgrade@example.com',
		});
	});
});

// =============================================================================
// Sign Out Tests
// =============================================================================

describe('AuthState: Sign Out', () => {
	it('signOut calls supabase', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser();
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);
		await auth.signOut();

		expect(mockClient.auth.signOut).toHaveBeenCalledOnce();
	});

	it('signOut throws on error', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		mockClient.auth.signOut.mockResolvedValue({ error: new Error('Network error') });

		auth.init(mockClient as unknown as SupabaseClient<Database>, null, null);

		await expect(auth.signOut()).rejects.toThrow('Network error');
	});
});

// =============================================================================
// Profile Sync Tests
// =============================================================================

describe('AuthState: Profile Sync', () => {
	it('does not write profiles.is_anonymous from the client', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({ is_anonymous: true });
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);
		await auth.linkEmail('upgrade@example.com');

		// The database trigger syncs is_anonymous from auth.users
		expect('syncProfileAnonymousStatus' in auth).toBe(false);
		expect(mockClient.from).not.toHaveBeenCalled();
	});
});

// =============================================================================
// Derived State Tests
// =============================================================================

describe('AuthState: Derived State', () => {
	it('userId returns user.id when authenticated', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({ id: 'specific-user-id' });
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);

		expect(auth.userId).toBe('specific-user-id');
	});

	it('email returns user.email when authenticated', async () => {
		const auth = await createFreshAuthStore();
		const mockClient = createMockSupabaseClient();
		const user = createMockUser({ email: 'specific@example.com' });
		const session = createMockSession(user);

		auth.init(mockClient as unknown as SupabaseClient<Database>, session, user);

		expect(auth.email).toBe('specific@example.com');
	});
});
