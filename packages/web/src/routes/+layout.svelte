<script lang="ts">
import favicon from '$lib/assets/favicon.svg';
import '$lib/styles/global.css';
import { onMount } from 'svelte';
import { afterNavigate, invalidate } from '$app/navigation';
import UpdateRequiredBanner from '$lib/components/ui/UpdateRequiredBanner.svelte';
import { preloadEngine } from '$lib/services/engine';
import { preferencesService } from '$lib/services/preferences.svelte';
import { protocolUpgrade } from '$lib/services/protocolUpgrade.svelte';
import { roomService } from '$lib/services/roomService.svelte';
import {
	initializeTelemetry,
	setUserId,
	shutdownTelemetry,
	trackPageView,
} from '$lib/services/telemetry';
import { audioStore } from '$lib/stores/audio.svelte';
import { auth } from '$lib/stores/auth.svelte';
import { lobby } from '$lib/stores/lobby.svelte';
import { profileStore } from '$lib/stores/profile.svelte';
import { initKeyboardHandler } from '$lib/utils/keyboard';
import { initViewportFix } from '$lib/utils/viewport';

let { data, children } = $props();

// Track previous page for navigation tracking
let previousPage: string | null = null;

// Initialize auth store, telemetry, and preload WASM engine
onMount(() => {
	// Initialize telemetry first (before auth so we capture session start)
	initializeTelemetry({ enabled: true, debug: false });

	// Initialize auth with server-provided session data
	auth.init(data.supabase, data.session, data.user);

	// Initialize audio store
	audioStore.init();

	// Initialize preferences service with Supabase client
	preferencesService.init();
	preferencesService.setSupabase(data.supabase);

	// Initialize profile store with Supabase client
	profileStore.init(data.supabase);

	// Set user ID if already authenticated
	if (data.user?.id) {
		setUserId(data.user.id);
		// Sync preferences on initial load if authenticated
		preferencesService.onLogin(data.user.id);
		// Load user profile (includes admin role)
		profileStore.loadProfile(data.user.id);
	}

	// Listen for auth changes and invalidate the layout data
	const {
		data: { subscription },
	} = data.supabase.auth.onAuthStateChange((event, session) => {
		// Invalidate layout data when auth state changes
		// This ensures server and client stay in sync
		if (session?.expires_at !== data.session?.expires_at) {
			invalidate('supabase:auth');
		}

		// Update telemetry user ID on auth changes
		if (event === 'SIGNED_IN' && session?.user?.id) {
			setUserId(session.user.id);
			// Sync preferences on login
			preferencesService.onLogin(session.user.id);
			// Load user profile (includes admin role)
			profileStore.loadProfile(session.user.id);
		} else if (event === 'SIGNED_OUT') {
			setUserId(null);
			// Stop syncing on logout
			preferencesService.onLogout();
			// Clear profile state
			profileStore.clear();
			// Disconnect from room first (if in one), then lobby
			// This ensures proper cleanup order: room → lobby
			roomService.disconnect();
			lobby.disconnect();
		}
	});

	// Preload WASM engine for faster first-use
	preloadEngine();

	// Connect lobby WebSocket (persists for app lifetime)
	// This keeps the lobby connection alive across navigation
	lobby.connect();

	// Initialize mobile keyboard handler (Safari VisualViewport fallback)
	const cleanupKeyboard = initKeyboardHandler();

	// Initialize iOS viewport fix (pinch-zoom corruption prevention)
	const cleanupViewport = initViewportFix();

	// Handle page unload for telemetry shutdown
	const handleBeforeUnload = () => {
		shutdownTelemetry();
	};
	window.addEventListener('beforeunload', handleBeforeUnload);

	return () => {
		subscription.unsubscribe();
		window.removeEventListener('beforeunload', handleBeforeUnload);
		cleanupKeyboard();
		cleanupViewport();
		shutdownTelemetry();
	};
});

// Track page views on navigation
afterNavigate(({ to }) => {
	if (to?.url?.pathname) {
		trackPageView(to.url.pathname, previousPage);
		previousPage = to.url.pathname;
	}
});

// Protocol handshake: a 4426 close from any game socket shows the update banner
const upgradeStatus = $derived(protocolUpgrade.status);

function handleRetryUpdate(): void {
	protocolUpgrade.retry();
}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600;700;900&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{#if upgradeStatus !== 'current'}
	<UpdateRequiredBanner status={upgradeStatus} onRetry={handleRetryUpdate} />
{/if}

{@render children()}
