import adapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		csrf: { trustedOrigins: [] },
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				// 'wasm-unsafe-eval' is required for the WASM probability engine:
				// Chromium (V8) blocks WebAssembly.instantiate/compile of a buffer under
				// a strict CSP unless this source is present. It does NOT permit JS eval.
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline', 'https://fonts.googleapis.com'],
				'font-src': ['self', 'data:', 'https://fonts.gstatic.com'],
				'img-src': ['self', 'data:', 'blob:', 'https://api.dicebear.com'],
				'connect-src': ['self', 'https://*.supabase.co', 'wss://*.supabase.co'],
				'media-src': ['self', 'blob:'],
				'worker-src': ['self', 'blob:'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none'],
				'upgrade-insecure-requests': true,
			},
		},
		// Using Cloudflare Pages adapter for deployment
		// See https://svelte.dev/docs/kit/adapter-cloudflare
		adapter: adapter({
			// Routes are generated automatically based on +server.ts files
			routes: {
				// Include API routes and auth callback
				include: ['/*'],
				// Exclude static assets
				exclude: ['<all>'],
			},
		}),
	},
};

export default config;
