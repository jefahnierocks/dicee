/**
 * Mobile Keyboard Handling Utility
 *
 * Cross-browser keyboard detection using Visual Viewport API.
 * Updates --keyboard-height CSS custom property when keyboard opens/closes.
 *
 * Key insights from research:
 * - iOS Safari and Android Chrome 108+ both keep layout viewport unchanged
 * - Only visual viewport shrinks when keyboard opens
 * - visualViewport.offsetTop is critical for correct positioning on iOS
 * - 150px threshold distinguishes keyboard from browser chrome changes
 * - RAF throttling prevents layout thrashing
 *
 * 2025 Browser Support:
 * - Chrome 108+: interactive-widget meta + VirtualKeyboard API
 * - Firefox 132+: interactive-widget meta
 * - Safari iOS: Visual Viewport API only (this utility is essential)
 */

/** Threshold to distinguish keyboard from browser chrome changes (address bar) */
const KEYBOARD_THRESHOLD = 150;

/**
 * Initialize keyboard height tracking.
 *
 * Listens to VisualViewport resize/scroll events and updates --keyboard-height
 * CSS custom property. Uses RAF throttling to prevent layout thrashing.
 *
 * @returns Cleanup function to remove event listeners
 *
 * @example
 * ```ts
 * // In +layout.svelte onMount
 * import { initKeyboardHandler } from '$lib/utils/keyboard';
 *
 * onMount(() => {
 *   const cleanup = initKeyboardHandler();
 *   return cleanup;
 * });
 * ```
 */
export function initKeyboardHandler(): () => void {
	// SSR guard
	if (typeof window === 'undefined' || typeof document === 'undefined') {
		return () => {
			/* no-op cleanup for SSR */
		};
	}

	// Check for VisualViewport API support
	if (!window.visualViewport) {
		return () => {
			/* no-op cleanup when API not supported */
		};
	}

	const viewport = window.visualViewport;

	// RAF throttling state
	let rafPending = false;

	// Baseline height - captured on init and updated on orientation change
	// This is the "full" viewport height when keyboard is closed
	let baselineHeight = viewport.height;

	/**
	 * Calculate keyboard height using multiple detection methods:
	 * 1. Baseline comparison (works with interactive-widget=resizes-content)
	 * 2. innerHeight vs viewport (works on iOS Safari)
	 */
	const updateKeyboardHeight = (): void => {
		// RAF throttle to prevent layout thrashing
		if (rafPending) return;
		rafPending = true;

		requestAnimationFrame(() => {
			rafPending = false;

			// Method 1: Compare current viewport to baseline (Android with resizes-content)
			const baselineDiff = baselineHeight - viewport.height;

			// Method 2: Compare innerHeight to viewport (iOS Safari)
			const innerDiff = window.innerHeight - viewport.height - viewport.offsetTop;

			// Use the larger of the two methods
			const keyboardHeight = Math.max(0, baselineDiff, innerDiff);

			// Update baseline if viewport grew (orientation change, keyboard closed)
			if (viewport.height > baselineHeight) {
				baselineHeight = viewport.height;
			}

			// Update CSS custom property
			document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);

			// Also set a boolean for CSS selectors
			if (keyboardHeight > KEYBOARD_THRESHOLD) {
				document.documentElement.classList.add('keyboard-open');
			} else {
				document.documentElement.classList.remove('keyboard-open');
			}
		});
	};

	// Initial calculation
	updateKeyboardHeight();

	// Listen for viewport changes (keyboard open/close, orientation change)
	viewport.addEventListener('resize', updateKeyboardHeight);
	viewport.addEventListener('scroll', updateKeyboardHeight);

	// Cleanup function
	return () => {
		viewport.removeEventListener('resize', updateKeyboardHeight);
		viewport.removeEventListener('scroll', updateKeyboardHeight);
		// Reset state on cleanup
		document.documentElement.style.setProperty('--keyboard-height', '0px');
		document.documentElement.classList.remove('keyboard-open');
	};
}

/**
 * Check if the virtual keyboard is currently visible.
 * Uses the 150px threshold to distinguish from browser chrome changes.
 *
 * @returns true if keyboard appears to be open (viewport height reduced significantly)
 */
export function isKeyboardVisible(): boolean {
	if (typeof window === 'undefined' || !window.visualViewport) {
		return false;
	}

	const viewport = window.visualViewport;
	const heightDiff = window.innerHeight - viewport.height - viewport.offsetTop;
	return heightDiff > KEYBOARD_THRESHOLD;
}

/**
 * Get the current keyboard height in pixels.
 * Accounts for visualViewport.offsetTop for correct iOS positioning.
 *
 * @returns Keyboard height in pixels, or 0 if not visible/supported
 */
export function getKeyboardHeight(): number {
	if (typeof window === 'undefined' || !window.visualViewport) {
		return 0;
	}

	const viewport = window.visualViewport;
	return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}
