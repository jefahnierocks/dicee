import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function safeRedirectTarget(value: string | null): string {
	if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
	// Reject embedded control chars (TAB/CR/LF etc.). Browsers strip these from the
	// Location header, so "/\t/evil.com" would otherwise become a protocol-relative
	// "//evil.com" and open-redirect off-origin.
	if ([...value].some((ch) => ch.charCodeAt(0) <= 0x1f || ch.charCodeAt(0) === 0x7f)) return '/';
	return value;
}

/**
 * OAuth and Magic Link callback handler.
 *
 * This endpoint handles:
 * - OAuth redirects (Google sign-in)
 * - Magic link email confirmations
 * - Identity linking callbacks
 *
 * Query params:
 * - code: Authorization code from OAuth flow
 * - token_hash: Token from magic link email
 * - type: Type of callback (e.g., 'email', 'recovery')
 * - next: URL to redirect to after auth (default: '/')
 * - error: Error code from OAuth provider
 * - error_description: Human-readable error message
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	const token_hash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type');
	const next = safeRedirectTarget(url.searchParams.get('next'));
	const error = url.searchParams.get('error');

	// Handle OAuth errors
	if (error) {
		console.error('Auth callback rejected by provider');
		redirect(303, '/?auth_error=provider_error');
	}

	// Handle OAuth code exchange
	if (code) {
		const { error: exchangeError } = await locals.supabase.auth.exchangeCodeForSession(code);

		if (exchangeError) {
			console.error('Auth code exchange failed');
			redirect(303, '/?auth_error=exchange_failed');
		}

		// Successful OAuth - redirect to intended destination
		redirect(303, next);
	}

	// Handle magic link / email verification
	if (token_hash && type) {
		const { error: verifyError } = await locals.supabase.auth.verifyOtp({
			token_hash,
			type: type as 'email' | 'recovery' | 'invite' | 'magiclink' | 'signup' | 'email_change',
		});

		if (verifyError) {
			console.error('OTP verification failed');
			redirect(303, '/?auth_error=verification_failed');
		}

		// Successful verification - redirect to intended destination
		redirect(303, next);
	}

	// No valid auth params - redirect to home
	redirect(303, '/');
};
