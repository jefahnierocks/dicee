# Frontend Auth System - Implementation Plan

> **Date**: 2024-12-02 (Updated: 2025-12-02)
> **Phase**: 2 (Frontend Auth System)
> **Status**: Infrastructure Complete, Implementation Ready

---

## Completed Setup (2025-12-02)

### Google Cloud OAuth ✅
- **Project**: dicee (`<gcp-project-id>`)
- **OAuth Client ID**: `<google-oauth-client-id>`
- **Redirect URI**: `https://your-project-ref.supabase.co/auth/v1/callback`
- **Scopes**: email, profile, openid

### Supabase Auth ✅
- **Google Provider**: Enabled with OAuth credentials
- **Skip nonce checks**: Disabled (secure)
- **Allow users without email**: Disabled

### Infisical Secrets ✅
All environments (dev, staging, prod) configured:
- `GOOGLE_CLIENT_ID` - OAuth client ID
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `PUBLIC_SUPABASE_URL` - https://your-project-ref.supabase.co
- `PUBLIC_SUPABASE_ANON_KEY` - Publishable key
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key

### Database Schema ✅
- `profiles` table with `is_anonymous` field
- Auto-create profile trigger on `auth.users` insert
- RLS policies for all tables (awaiting is_anonymous restrictive policies)

### Supabase Dashboard Settings ✅
- [x] **Anonymous Sign-ins** - Enabled
- [x] **Manual Linking** - Enabled
- [x] **Redirect URLs** - Added for dev and prod

---

## Research Summary

### Package Versions (Current Latest)

| Package | Version | Notes |
|---------|---------|-------|
| `@supabase/supabase-js` | 2.86.0 | Node 18 dropped in 2.79.0 |
| `@supabase/ssr` | 0.8.0 | Replaces deprecated auth-helpers |
| `svelte` | 5.43.8 | Already installed |
| `@sveltejs/kit` | 2.48.5 | Already installed |

### Key Findings

#### 1. Supabase SSR ([@supabase/ssr docs](https://supabase.com/docs/guides/auth/server-side/sveltekit))

**Critical Security**:
- **NEVER** use `supabase.auth.getSession()` on server - it doesn't validate the JWT
- **ALWAYS** use `supabase.auth.getClaims()` - validates JWT signature against public keys
- Session stored in cookies (not localStorage) for SSR compatibility
- PKCE flow enabled by default

**Architecture**:
```
hooks.server.ts  →  Creates request-specific Supabase client
                    Validates session with getClaims()
                    Protects routes

+layout.server.ts → Passes session to client
+layout.ts        → Creates browser client from session
```

#### 2. Svelte 5 Auth Patterns ([Global State Guide](https://mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/))

The project already uses an excellent pattern in `game.svelte.ts`:
- Class with `$state()` for reactive properties
- `$derived()` for computed values
- Singleton export for global access

**Recommended auth pattern**:
```typescript
// auth.svelte.ts
class AuthState {
  #session = $state<Session | null>(null);
  #user = $state<User | null>(null);
  #loading = $state(true);

  readonly isAuthenticated = $derived(this.#session !== null);
  readonly isAnonymous = $derived(this.#user?.is_anonymous ?? true);
  // ...
}
export const auth = new AuthState();
```

#### 3. Anonymous Auth ([Supabase Docs](https://supabase.com/docs/guides/auth/auth-anonymous))

- `signInAnonymously()` creates temp user immediately
- JWT includes `is_anonymous` claim for RLS policies
- **Upgrade paths**:
  - `updateUser({ email })` for email/password
  - `linkIdentity({ provider: 'google' })` for OAuth
- **Requires**: Enable "Manual Linking" in Supabase dashboard
- **Gotcha**: If user previously signed in with Google, linking may fail with "Identity already linked"

#### 4. Design System (tokens.css)

- Neo-Brutalist: Hard edges, high contrast, no rounded corners
- Touch targets: 44px minimum, 56px comfortable
- Mobile breakpoints: 320-480px (portrait), 568-844px (landscape)
- Already supports `prefers-reduced-motion`

---

## Mobile-First Auth UX Design

### User Journey

```
┌─────────────────────────────────────────────────────────────────┐
│                      FIRST VISIT                                 │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  │                        DICEE                              │  │
│  │              Learn Probability Through Play               │  │
│  │                                                           │  │
│  │     ┌─────────────────────────────────────────────────┐   │  │
│  │     │                                                 │   │  │
│  │     │              [  PLAY NOW  ]                     │   │  │
│  │     │                                                 │   │  │
│  │     │         No account needed to start              │   │  │
│  │     │                                                 │   │  │
│  │     └─────────────────────────────────────────────────┘   │  │
│  │                                                           │  │
│  │     ────────────────── or ──────────────────             │  │
│  │                                                           │  │
│  │     [G] Continue with Google                              │  │
│  │                                                           │  │
│  │     [✉] Sign in with Email                                │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Mobile: Buttons stacked, full-width, 56px height (touch)       │
│  Desktop: Buttons centered, max-width 320px                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flow States

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Landing Page   │────▶│  Anonymous Game  │────▶│ Upgrade Prompt   │
│   (Not Signed)   │     │   (Playing)      │     │ (After 3 games)  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                                                  │
        │ Google/Email                                     │ Link Account
        ▼                                                  ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Auth Callback   │────▶│   Game (Auth'd)  │────▶│     Profile      │
│  (Processing)    │     │   (Full access)  │     │   (Optional)     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

### Mobile Considerations

1. **Touch Targets**: All buttons min 44px, primary actions 56px
2. **Thumb Zone**: Primary actions in bottom 60% of screen
3. **Single Column**: Stack all form elements vertically
4. **Keyboard Handling**:
   - Auto-focus email input when selected
   - Handle virtual keyboard viewport changes
5. **Loading States**: Full-screen loading for OAuth redirect
6. **Error Display**: Toast notifications (not inline for mobile)

### Anonymous User Experience

| Capability | Anonymous | Authenticated |
|------------|-----------|---------------|
| Play games | ✓ | ✓ |
| See own stats | ✓ (session only) | ✓ (persistent) |
| Join public rooms | ✓ | ✓ |
| Create rooms | ✓ (1 at a time) | ✓ |
| Appear on leaderboard | ✗ | ✓ |
| Persistent profile | ✗ | ✓ |
| Cross-device access | ✗ | ✓ |

### Upgrade Prompt Triggers

- After 3rd game completion
- When attempting leaderboard access
- When trying to create persistent room
- Soft prompt in profile area (non-blocking)

---

## File Structure

```
packages/web/src/
├── app.d.ts                          # Add Supabase types to locals
├── hooks.server.ts                   # NEW: Server hooks for auth
├── lib/
│   ├── supabase/
│   │   ├── client.ts                 # NEW: Browser client factory
│   │   ├── server.ts                 # NEW: Server client factory
│   │   └── types.ts                  # NEW: Re-export Database types
│   ├── stores/
│   │   └── auth.svelte.ts            # NEW: Auth state (Svelte 5 runes)
│   └── components/
│       └── auth/
│           ├── index.ts              # NEW: Barrel export
│           ├── AuthProvider.svelte   # NEW: Root auth wrapper
│           ├── PlayNowButton.svelte  # NEW: Anonymous sign-in
│           ├── GoogleButton.svelte   # NEW: OAuth button
│           ├── MagicLinkForm.svelte  # NEW: Email input + submit
│           ├── UpgradePrompt.svelte  # NEW: Convert anon to auth
│           └── AuthLoading.svelte    # NEW: Loading state
├── routes/
│   ├── +layout.svelte                # MODIFY: Add AuthProvider
│   ├── +layout.server.ts             # NEW: Pass session from server
│   ├── +layout.ts                    # NEW: Create browser client
│   ├── +page.svelte                  # MODIFY: Add auth-aware UI
│   ├── auth/
│   │   └── callback/
│   │       └── +server.ts            # NEW: OAuth/magic link callback
│   └── (app)/                        # NEW: Auth-optional group
│       ├── +layout.svelte            # NEW: Ensure session exists
│       └── ... (game routes)
```

---

## Implementation Steps

### Phase 2.1: Supabase Client Setup

1. **Install packages**
   ```bash
   cd packages/web
   pnpm add @supabase/supabase-js @supabase/ssr
   ```

2. **Create `src/app.d.ts`** - Add Supabase types to SvelteKit
   ```typescript
   import type { Session, User } from '@supabase/supabase-js';
   import type { Database } from '$lib/types/database';

   declare global {
     namespace App {
       interface Locals {
         supabase: SupabaseClient<Database>;
         safeGetSession: () => Promise<{ session: Session | null; user: User | null }>;
       }
       interface PageData {
         session: Session | null;
         user: User | null;
       }
     }
   }
   ```

3. **Create `src/lib/supabase/server.ts`** - Server client factory
   ```typescript
   import { createServerClient } from '@supabase/ssr';
   import type { RequestEvent } from '@sveltejs/kit';

   export function createSupabaseServerClient(event: RequestEvent) {
     return createServerClient(
       import.meta.env.PUBLIC_SUPABASE_URL,
       import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
       {
         cookies: {
           getAll: () => event.cookies.getAll(),
           setAll: (cookies) => {
             cookies.forEach(({ name, value, options }) => {
               event.cookies.set(name, value, { ...options, path: '/' });
             });
           },
         },
       }
     );
   }
   ```

4. **Create `src/hooks.server.ts`** - Server hooks
   ```typescript
   import { createSupabaseServerClient } from '$lib/supabase/server';
   import type { Handle } from '@sveltejs/kit';

   export const handle: Handle = async ({ event, resolve }) => {
     event.locals.supabase = createSupabaseServerClient(event);

     event.locals.safeGetSession = async () => {
       const { data: { session } } = await event.locals.supabase.auth.getSession();
       if (!session) return { session: null, user: null };

       // CRITICAL: Validate the JWT
       const { data: { user }, error } = await event.locals.supabase.auth.getUser();
       if (error) {
         return { session: null, user: null };
       }

       return { session, user };
     };

     return resolve(event, {
       filterSerializedResponseHeaders(name) {
         return name === 'content-range' || name === 'x-supabase-api-version';
       },
     });
   };
   ```

### Phase 2.2: Auth State Store

5. **Create `src/lib/stores/auth.svelte.ts`**
   ```typescript
   import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js';
   import type { SupabaseClient } from '@supabase/supabase-js';
   import type { Database } from '$lib/types/database';

   class AuthState {
     #supabase = $state<SupabaseClient<Database> | null>(null);
     #session = $state<Session | null>(null);
     #user = $state<User | null>(null);
     #loading = $state(true);
     #initialized = $state(false);

     // Derived state
     readonly isAuthenticated = $derived(this.#session !== null);
     readonly isAnonymous = $derived(
       this.#user?.app_metadata?.provider === 'anonymous' ||
       this.#user?.is_anonymous === true
     );
     readonly userId = $derived(this.#user?.id ?? null);

     // Getters
     get session() { return this.#session; }
     get user() { return this.#user; }
     get loading() { return this.#loading; }
     get initialized() { return this.#initialized; }

     // Initialize with server data
     init(supabase: SupabaseClient<Database>, session: Session | null, user: User | null) {
       this.#supabase = supabase;
       this.#session = session;
       this.#user = user;
       this.#loading = false;
       this.#initialized = true;

       // Listen for auth changes
       supabase.auth.onAuthStateChange((event, session) => {
         this.#session = session;
         this.#user = session?.user ?? null;
       });
     }

     // Anonymous sign-in
     async signInAnonymously() {
       if (!this.#supabase) throw new Error('Supabase not initialized');
       this.#loading = true;
       const { error } = await this.#supabase.auth.signInAnonymously();
       this.#loading = false;
       if (error) throw error;
     }

     // OAuth sign-in
     async signInWithGoogle() {
       if (!this.#supabase) throw new Error('Supabase not initialized');
       const { error } = await this.#supabase.auth.signInWithOAuth({
         provider: 'google',
         options: { redirectTo: `${window.location.origin}/auth/callback` }
       });
       if (error) throw error;
     }

     // Magic link sign-in
     async signInWithEmail(email: string) {
       if (!this.#supabase) throw new Error('Supabase not initialized');
       this.#loading = true;
       const { error } = await this.#supabase.auth.signInWithOtp({
         email,
         options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
       });
       this.#loading = false;
       if (error) throw error;
     }

     // Upgrade anonymous to permanent
     async linkGoogle() {
       if (!this.#supabase) throw new Error('Supabase not initialized');
       const { error } = await this.#supabase.auth.linkIdentity({
         provider: 'google',
         options: { redirectTo: `${window.location.origin}/auth/callback` }
       });
       if (error) throw error;
     }

     async linkEmail(email: string) {
       if (!this.#supabase) throw new Error('Supabase not initialized');
       const { error } = await this.#supabase.auth.updateUser({ email });
       if (error) throw error;
     }

     // Sign out
     async signOut() {
       if (!this.#supabase) throw new Error('Supabase not initialized');
       const { error } = await this.#supabase.auth.signOut();
       if (error) throw error;
     }
   }

   export const auth = new AuthState();
   ```

### Phase 2.3: Layout Integration

6. **Create `src/routes/+layout.server.ts`**
   ```typescript
   import type { LayoutServerLoad } from './$types';

   export const load: LayoutServerLoad = async ({ locals }) => {
     const { session, user } = await locals.safeGetSession();
     return { session, user };
   };
   ```

7. **Create `src/routes/+layout.ts`**
   ```typescript
   import { createBrowserClient } from '@supabase/ssr';
   import type { LayoutLoad } from './$types';

   export const load: LayoutLoad = async ({ data, depends, fetch }) => {
     depends('supabase:auth');

     const supabase = createBrowserClient(
       import.meta.env.PUBLIC_SUPABASE_URL,
       import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
       { global: { fetch } }
     );

     return { supabase, session: data.session, user: data.user };
   };
   ```

8. **Modify `src/routes/+layout.svelte`**
   ```svelte
   <script lang="ts">
   import { onMount } from 'svelte';
   import { auth } from '$lib/stores/auth.svelte';
   // ... existing imports

   let { data, children } = $props();

   onMount(() => {
     auth.init(data.supabase, data.session, data.user);
   });
   </script>
   ```

### Phase 2.4: Auth Callback

9. **Create `src/routes/auth/callback/+server.ts`**
   ```typescript
   import { redirect } from '@sveltejs/kit';
   import type { RequestHandler } from './$types';

   export const GET: RequestHandler = async ({ url, locals }) => {
     const code = url.searchParams.get('code');
     const next = url.searchParams.get('next') ?? '/';

     if (code) {
       const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
       if (!error) {
         throw redirect(303, next);
       }
     }

     // Auth error, redirect to home with error
     throw redirect(303, '/?error=auth_failed');
   };
   ```

### Phase 2.5: Auth Components

10. **Create auth UI components** (mobile-first, Neo-Brutalist style)
    - `PlayNowButton.svelte` - Large touch target, calls `signInAnonymously()`
    - `GoogleButton.svelte` - OAuth button with Google icon
    - `MagicLinkForm.svelte` - Email input + submit
    - `UpgradePrompt.svelte` - Modal/sheet for converting anonymous users

---

## Environment Variables Required

Add to `.env.local` (and Infisical):
```bash
PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<publishable-key-from-gopass>
```

---

## Supabase Dashboard Configuration

Before implementation:

1. **Enable Anonymous Sign-ins**
   - Authentication > Providers > Anonymous > Enable

2. **Enable Google OAuth**
   - Authentication > Providers > Google > Enable
   - Add OAuth credentials from Google Cloud Console

3. **Enable Manual Linking**
   - Authentication > Settings > Enable Manual Linking
   - Required for anonymous → permanent upgrade

4. **Update Email Templates** (for magic link)
   - Authentication > Email Templates > Confirm signup
   - Change `{{ .ConfirmationURL }}` to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`

5. **Configure Redirect URLs**
   - Authentication > URL Configuration
   - Site URL: `http://localhost:5173` (dev)
   - Redirect URLs: `http://localhost:5173/auth/callback`

---

## Testing Checklist

- [ ] Anonymous sign-in creates session
- [ ] Anonymous user can play games
- [ ] Google OAuth flow completes
- [ ] Magic link email is sent
- [ ] Magic link creates session
- [ ] Anonymous → Google upgrade works
- [ ] Anonymous → Email upgrade works
- [ ] Session persists across page refresh
- [ ] Sign out clears session
- [ ] Protected routes redirect when not authenticated
- [ ] Mobile touch targets are 44px+
- [ ] Loading states display correctly
- [ ] Error states display correctly

---

## Sources

- [Setting up Server-Side Auth for SvelteKit | Supabase Docs](https://supabase.com/docs/guides/auth/server-side/sveltekit)
- [Creating a Supabase client for SSR | Supabase Docs](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=sveltekit)
- [Anonymous Sign-Ins | Supabase Docs](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Runes and Global state: do's and don'ts | Mainmatter](https://mainmatter.com/blog/2025/03/11/global-state-in-svelte-5/)
- [Refactoring Svelte stores to $state runes | Loopwerk](https://www.loopwerk.io/articles/2025/svelte-5-stores/)
- [@supabase/ssr - npm](https://www.npmjs.com/package/@supabase/ssr)
- [@supabase/supabase-js - npm](https://www.npmjs.com/package/@supabase/supabase-js)
