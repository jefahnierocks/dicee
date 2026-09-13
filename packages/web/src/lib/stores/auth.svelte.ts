import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

/**
 * Auth state store using Svelte 5 runes.
 *
 * This store manages authentication state and provides methods for:
 * - Anonymous sign-in (Play Now)
 * - Google OAuth sign-in
 * - Magic link email sign-in
 * - Anonymous → permanent user upgrade
 * - Sign out
 */
class AuthState {
	// Private state
	#supabase = $state<SupabaseClient<Database> | null>(null);
	#session = $state<Session | null>(null);
	#user = $state<User | null>(null);
	#loading = $state(true);
	#initialized = $state(false);

	// Derived state - readonly externally
	readonly isAuthenticated = $derived(this.#session !== null);
	readonly isAnonymous = $derived(
		this.#user?.is_anonymous === true || this.#user?.app_metadata?.provider === 'anonymous',
	);
	readonly userId = $derived(this.#user?.id ?? null);
	readonly email = $derived(this.#user?.email ?? null);

	// Public getters
	get session() {
		return this.#session;
	}
	get user() {
		return this.#user;
	}
	get loading() {
		return this.#loading;
	}
	get initialized() {
		return this.#initialized;
	}

	/**
	 * Initialize the auth store with server-provided data.
	 * Call this once in +layout.svelte onMount.
	 */
	init(supabase: SupabaseClient<Database>, session: Session | null, user: User | null) {
		this.#supabase = supabase;
		this.#session = session;
		this.#user = user;
		this.#loading = false;
		this.#initialized = true;

		// Listen for auth state changes (sign in, sign out, token refresh)
		supabase.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
			this.#session = session;
			this.#user = session?.user ?? null;

			// Handle specific events
			if (event === 'SIGNED_OUT') {
				this.#session = null;
				this.#user = null;
			}
		});
	}

	/**
	 * Sign in anonymously - creates a temporary user.
	 * Use this for "Play Now" without requiring account creation.
	 */
	async signInAnonymously(): Promise<void> {
		if (!this.#supabase) throw new Error('Supabase not initialized');

		this.#loading = true;
		try {
			const { error } = await this.#supabase.auth.signInAnonymously();
			if (error) throw error;
		} finally {
			this.#loading = false;
		}
	}

	/**
	 * Sign in with Google OAuth.
	 * Redirects to Google, then back to /auth/callback.
	 */
	async signInWithGoogle(redirectTo?: string): Promise<void> {
		if (!this.#supabase) throw new Error('Supabase not initialized');

		const { error } = await this.#supabase.auth.signInWithOAuth({
			provider: 'google',
			options: {
				redirectTo: redirectTo ?? `${window.location.origin}/auth/callback`,
			},
		});
		if (error) throw error;
	}

	/**
	 * Sign in with magic link (passwordless email).
	 * Sends an email with a sign-in link.
	 */
	async signInWithEmail(email: string, redirectTo?: string): Promise<void> {
		if (!this.#supabase) throw new Error('Supabase not initialized');

		this.#loading = true;
		try {
			const { error } = await this.#supabase.auth.signInWithOtp({
				email,
				options: {
					emailRedirectTo: redirectTo ?? `${window.location.origin}/auth/callback`,
				},
			});
			if (error) throw error;
		} finally {
			this.#loading = false;
		}
	}

	/**
	 * Link Google identity to current anonymous user.
	 * Preserves the user ID and all associated data.
	 */
	async linkGoogle(redirectTo?: string): Promise<void> {
		if (!this.#supabase) throw new Error('Supabase not initialized');
		if (!this.isAnonymous) throw new Error('User is not anonymous');

		const { error } = await this.#supabase.auth.linkIdentity({
			provider: 'google',
			options: {
				redirectTo: redirectTo ?? `${window.location.origin}/auth/callback`,
			},
		});
		if (error) throw error;
	}

	/**
	 * Link email to current anonymous user.
	 * Sends a verification email. After verification, can add password.
	 */
	async linkEmail(email: string): Promise<void> {
		if (!this.#supabase) throw new Error('Supabase not initialized');
		if (!this.isAnonymous) throw new Error('User is not anonymous');

		this.#loading = true;
		try {
			const { error } = await this.#supabase.auth.updateUser({ email });
			if (error) throw error;
		} finally {
			this.#loading = false;
		}
	}

	/**
	 * Add password after email is verified.
	 * Only works if email has been verified first.
	 */
	async setPassword(password: string): Promise<void> {
		if (!this.#supabase) throw new Error('Supabase not initialized');

		this.#loading = true;
		try {
			const { error } = await this.#supabase.auth.updateUser({ password });
			if (error) throw error;
		} finally {
			this.#loading = false;
		}
	}

	/**
	 * Sign out the current user.
	 */
	async signOut(): Promise<void> {
		if (!this.#supabase) throw new Error('Supabase not initialized');

		const { error } = await this.#supabase.auth.signOut();
		if (error) throw error;
	}

	/**
	 * Get all linked identities for the current user.
	 * Useful for showing which providers are connected.
	 */
	async getIdentities() {
		if (!this.#supabase) throw new Error('Supabase not initialized');

		const { data, error } = await this.#supabase.auth.getUserIdentities();
		if (error) throw error;
		return data.identities;
	}

	// profiles.is_anonymous is not client-writable. The database syncs it from
	// auth.users.is_anonymous when an identity is linked (see
	// supabase/migrations/20260913000001_profiles_column_privileges.sql).

	/**
	 * Testing interface - DO NOT USE IN PRODUCTION CODE
	 * Provides controlled access to internal state for unit tests.
	 */
	__testing = {
		setLoading: (value: boolean) => {
			this.#loading = value;
		},
		setSession: (session: Session | null) => {
			this.#session = session;
		},
		setUser: (user: User | null) => {
			this.#user = user;
		},
		setSupabase: (client: SupabaseClient<Database> | null) => {
			this.#supabase = client;
		},
		reset: () => {
			this.#supabase = null;
			this.#session = null;
			this.#user = null;
			this.#loading = true;
			this.#initialized = false;
		},
	};
}

// Singleton export for global access
export const auth = new AuthState();
