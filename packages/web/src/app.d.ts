// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { Database } from '$lib/types/database';

/**
 * Cloudflare Service Binding to the dicee Worker
 * Provides zero-latency RPC access to Durable Objects
 */
interface GameWorkerBinding {
	/**
	 * Fetch from the dicee worker
	 * Routes: /lobby, /lobby/*, /room/:code, /health
	 */
	fetch(request: Request): Promise<Response>;
}

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			supabase: SupabaseClient<Database>;
			/**
			 * Safe session getter that validates the JWT.
			 * ALWAYS use this instead of supabase.auth.getSession()
			 */
			safeGetSession: () => Promise<{
				session: Session | null;
				user: User | null;
			}>;
		}
		interface PageData {
			session: Session | null;
			user: User | null;
			// Note: supabase is provided by +layout.ts and inherited by all pages
			// It's intentionally not declared here to allow proper type inference
			// through SvelteKit's generated types
		}
		// interface PageState {}

		/**
		 * Bindings of the `dicee-web` Worker (packages/web/wrangler.jsonc), available in
		 * server routes via `platform.env`. `ctx`, `caches` and `cf` are declared by the
		 * @sveltejs/adapter-cloudflare ambient types.
		 *
		 * @example
		 * export const GET: RequestHandler = async ({ platform }) => {
		 *   const response = await platform?.env.GAME_WORKER.fetch(
		 *     new Request('https://internal/lobby/rooms')
		 *   );
		 *   return response;
		 * };
		 */
		interface Platform {
			env: {
				/** Service Binding to dicee Worker (Durable Objects) */
				GAME_WORKER: GameWorkerBinding;
			};
		}
	}
}
