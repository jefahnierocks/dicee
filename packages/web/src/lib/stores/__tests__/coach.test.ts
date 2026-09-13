/**
 * Coach Store Unit Tests
 *
 * Tests for coach.svelte.ts - Coach mode state management
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '$lib/types';
import {
	COACH_LEVEL_INFO,
	type CoachFeedback,
	type CoachLevel,
	type CoachPreferences,
	coach,
	type PendingDecision,
} from '../coach.svelte';

// =============================================================================
// Mock localStorage
// =============================================================================

const mockLocalStorage = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: vi.fn((key: string) => store[key] || null),
		setItem: vi.fn((key: string, value: string) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key: string) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
	};
})();

vi.stubGlobal('localStorage', mockLocalStorage);

// =============================================================================
// Test Setup
// =============================================================================

const DEFAULT_PREFERENCES: CoachPreferences = {
	level: 'hints',
	showProbabilities: true,
	highlightOptimal: true,
	showEVDelta: true,
	animateSuggestions: true,
};

describe('CoachStore', () => {
	beforeEach(() => {
		// Reset store state before each test
		coach.__testing.reset();
		mockLocalStorage.clear();
		vi.clearAllMocks();
	});

	// ===========================================================================
	// Initial State
	// ===========================================================================

	describe('initial state', () => {
		it('should have default preferences', () => {
			expect(coach.level).toBe('hints');
			expect(coach.preferences).toEqual(DEFAULT_PREFERENCES);
		});

		it('should not be initialized until init() is called', () => {
			expect(coach.initialized).toBe(false);
		});

		it('should be active by default (hints mode)', () => {
			expect(coach.isActive).toBe(true);
		});

		it('should not show suggestions in hints mode', () => {
			expect(coach.showSuggestions).toBe(false);
		});
	});

	// ===========================================================================
	// Coach Level Info
	// ===========================================================================

	describe('COACH_LEVEL_INFO', () => {
		it('should have info for all coach levels', () => {
			const levels: CoachLevel[] = ['off', 'hints', 'coach', 'training'];

			levels.forEach((level) => {
				expect(COACH_LEVEL_INFO[level]).toBeDefined();
				expect(COACH_LEVEL_INFO[level].label).toBeTruthy();
				expect(COACH_LEVEL_INFO[level].description).toBeTruthy();
				expect(COACH_LEVEL_INFO[level].icon).toBeTruthy();
			});
		});

		it('should have correct labels', () => {
			expect(COACH_LEVEL_INFO.off.label).toBe('Off');
			expect(COACH_LEVEL_INFO.hints.label).toBe('Hints');
			expect(COACH_LEVEL_INFO.coach.label).toBe('Coach');
			expect(COACH_LEVEL_INFO.training.label).toBe('Training');
		});
	});

	// ===========================================================================
	// setLevel
	// ===========================================================================

	describe('setLevel', () => {
		it('should update coach level', () => {
			coach.setLevel('coach');

			expect(coach.level).toBe('coach');
		});

		it('should persist level to localStorage', () => {
			coach.setLevel('training');

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'dicee_coach_preferences',
				expect.stringContaining('"level":"training"'),
			);
		});

		it.each([
			['off', false],
			['hints', true],
			['coach', true],
			['training', true],
		] as const)('level %s should have isActive = %s', (level, expectedActive) => {
			coach.setLevel(level);

			expect(coach.isActive).toBe(expectedActive);
		});

		it.each([
			['off', false],
			['hints', false],
			['coach', true],
			['training', true],
		] as const)('level %s should have showSuggestions = %s', (level, expected) => {
			coach.setLevel(level);

			expect(coach.showSuggestions).toBe(expected);
		});

		it.each([
			['off', false],
			['hints', false],
			['coach', false],
			['training', true],
		] as const)('level %s should have requiresConfirmation = %s', (level, expected) => {
			coach.setLevel(level);

			expect(coach.requiresConfirmation).toBe(expected);
		});
	});

	// ===========================================================================
	// Derived State
	// ===========================================================================

	describe('derived state', () => {
		it('should compute showProbabilities correctly', () => {
			// Active with showProbabilities true
			coach.setLevel('hints');
			expect(coach.showProbabilities).toBe(true);

			// Not active (off) - should be false
			coach.setLevel('off');
			expect(coach.showProbabilities).toBe(false);
		});

		it('should compute highlightOptimal correctly', () => {
			coach.setLevel('coach');
			expect(coach.highlightOptimal).toBe(true);

			coach.setLevel('off');
			expect(coach.highlightOptimal).toBe(false);
		});

		it('should compute showEVDelta correctly', () => {
			coach.setLevel('hints');
			expect(coach.showEVDelta).toBe(true);

			coach.setLevel('off');
			expect(coach.showEVDelta).toBe(false);
		});

		it('should compute animateSuggestions only for coach mode', () => {
			coach.setLevel('coach');
			expect(coach.animateSuggestions).toBe(true);

			coach.setLevel('hints');
			expect(coach.animateSuggestions).toBe(false);

			coach.setLevel('training');
			expect(coach.animateSuggestions).toBe(false);
		});
	});

	// ===========================================================================
	// updatePreferences
	// ===========================================================================

	describe('updatePreferences', () => {
		it('should update partial preferences', () => {
			coach.updatePreferences({ showProbabilities: false });

			expect(coach.preferences.showProbabilities).toBe(false);
			expect(coach.preferences.level).toBe('hints'); // Unchanged
		});

		it('should persist updated preferences', () => {
			coach.updatePreferences({ highlightOptimal: false });

			expect(mockLocalStorage.setItem).toHaveBeenCalled();
		});

		it('should allow multiple preferences to be updated', () => {
			coach.updatePreferences({
				showProbabilities: false,
				showEVDelta: false,
				animateSuggestions: false,
			});

			expect(coach.preferences.showProbabilities).toBe(false);
			expect(coach.preferences.showEVDelta).toBe(false);
			expect(coach.preferences.animateSuggestions).toBe(false);
		});
	});

	// ===========================================================================
	// resetToDefaults
	// ===========================================================================

	describe('resetToDefaults', () => {
		it('should reset all preferences to defaults', () => {
			// Modify preferences
			coach.setLevel('training');
			coach.updatePreferences({
				showProbabilities: false,
				highlightOptimal: false,
			});

			// Reset
			coach.resetToDefaults();

			expect(coach.preferences).toEqual(DEFAULT_PREFERENCES);
		});

		it('should persist reset preferences', () => {
			coach.resetToDefaults();

			expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
				'dicee_coach_preferences',
				JSON.stringify(DEFAULT_PREFERENCES),
			);
		});
	});

	// ===========================================================================
	// Feedback Management
	// ===========================================================================

	describe('feedback management', () => {
		it('should initially have no feedback', () => {
			expect(coach.lastFeedback).toBeNull();
		});

		it('should set feedback', () => {
			const feedback: CoachFeedback = {
				type: 'optimal',
				message: 'Great choice!',
				category: 'threes' as Category,
			};

			coach.setFeedback(feedback);

			expect(coach.lastFeedback).toEqual(feedback);
		});

		it('should clear feedback', () => {
			coach.setFeedback({
				type: 'info',
				message: 'Test message',
			});

			coach.clearFeedback();

			expect(coach.lastFeedback).toBeNull();
		});

		it('should allow setting feedback to null', () => {
			coach.setFeedback({ type: 'info', message: 'Test' });
			coach.setFeedback(null);

			expect(coach.lastFeedback).toBeNull();
		});
	});

	// ===========================================================================
	// generateScoringFeedback
	// ===========================================================================

	describe('generateScoringFeedback', () => {
		it('should generate optimal feedback when choice matches optimal', () => {
			const feedback = coach.generateScoringFeedback(
				'threes' as Category,
				9,
				'threes' as Category,
				9,
				25.5,
				25.5,
			);

			expect(feedback.type).toBe('optimal');
			expect(feedback.message).toContain('Great choice');
			expect(feedback.category).toBe('threes');
			expect(feedback.evLoss).toBeUndefined();
		});

		it('should generate suboptimal feedback when choice differs from optimal', () => {
			const feedback = coach.generateScoringFeedback(
				'threes' as Category,
				6,
				'fullHouse' as Category,
				25,
				20.0,
				28.5,
			);

			expect(feedback.type).toBe('suboptimal');
			expect(feedback.message).toContain('fullHouse');
			expect(feedback.message).toContain('25');
			expect(feedback.message).toContain('8.5');
			expect(feedback.category).toBe('threes');
			expect(feedback.evLoss).toBeCloseTo(8.5, 1);
		});

		it('should format EV loss with one decimal', () => {
			const feedback = coach.generateScoringFeedback(
				'twos' as Category,
				4,
				'fours' as Category,
				12,
				15.333,
				22.777,
			);

			expect(feedback.message).toContain('7.4'); // 22.777 - 15.333 = 7.444
		});
	});

	// ===========================================================================
	// Training Mode Confirmation
	// ===========================================================================

	describe('requestConfirmation', () => {
		it('should allow optimal decisions immediately', () => {
			coach.setLevel('training');

			const decision: PendingDecision = {
				type: 'score',
				category: 'fours' as Category,
				isOptimal: true,
				chosenEV: 25.0,
				optimalEV: 25.0,
			};

			const result = coach.requestConfirmation(decision);

			expect(result).toBe(true);
			expect(coach.showConfirmModal).toBe(false);
			expect(coach.pendingDecision).toBeNull();
		});

		it('should block suboptimal decisions in training mode', () => {
			coach.setLevel('training');

			const decision: PendingDecision = {
				type: 'score',
				category: 'ones' as Category,
				isOptimal: false,
				chosenEV: 15.0,
				optimalEV: 28.5,
				explanation: 'Full House would be better',
			};

			const result = coach.requestConfirmation(decision);

			expect(result).toBe(false);
			expect(coach.showConfirmModal).toBe(true);
			expect(coach.pendingDecision).toEqual(decision);
		});

		it('should allow suboptimal decisions in non-training modes', () => {
			coach.setLevel('coach');

			const decision: PendingDecision = {
				type: 'score',
				isOptimal: false,
				chosenEV: 15.0,
				optimalEV: 28.5,
			};

			const result = coach.requestConfirmation(decision);

			expect(result).toBe(true);
			expect(coach.showConfirmModal).toBe(false);
		});

		it.each(['off', 'hints', 'coach'] as const)(
			'should not block decisions in %s mode',
			(level) => {
				coach.setLevel(level);

				const decision: PendingDecision = {
					type: 'reroll',
					isOptimal: false,
					chosenEV: 10.0,
					optimalEV: 20.0,
				};

				expect(coach.requestConfirmation(decision)).toBe(true);
			},
		);
	});

	describe('confirmDecision', () => {
		it('should clear pending decision and hide modal', () => {
			coach.setLevel('training');

			// Create a pending decision
			coach.requestConfirmation({
				type: 'score',
				isOptimal: false,
				chosenEV: 10,
				optimalEV: 20,
			});

			expect(coach.showConfirmModal).toBe(true);

			// Confirm
			coach.confirmDecision();

			expect(coach.pendingDecision).toBeNull();
			expect(coach.showConfirmModal).toBe(false);
		});
	});

	describe('cancelDecision', () => {
		it('should clear pending decision and hide modal', () => {
			coach.setLevel('training');

			// Create a pending decision
			coach.requestConfirmation({
				type: 'reroll',
				isOptimal: false,
				chosenEV: 10,
				optimalEV: 25,
			});

			// Cancel
			coach.cancelDecision();

			expect(coach.pendingDecision).toBeNull();
			expect(coach.showConfirmModal).toBe(false);
		});
	});

	// ===========================================================================
	// Initialization
	// ===========================================================================

	describe('init', () => {
		it('should load preferences from localStorage', () => {
			const savedPrefs: CoachPreferences = {
				level: 'training',
				showProbabilities: false,
				highlightOptimal: true,
				showEVDelta: true,
				animateSuggestions: false,
			};
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify(savedPrefs));

			coach.init();

			expect(coach.level).toBe('training');
			expect(coach.preferences.showProbabilities).toBe(false);
			expect(coach.initialized).toBe(true);
		});

		it('should use defaults when localStorage is empty', () => {
			mockLocalStorage.getItem.mockReturnValue(null);

			coach.init();

			expect(coach.preferences).toEqual(DEFAULT_PREFERENCES);
			expect(coach.initialized).toBe(true);
		});

		it('should handle corrupted localStorage gracefully', () => {
			mockLocalStorage.getItem.mockReturnValue('invalid json');

			// Should not throw
			coach.init();

			expect(coach.preferences).toEqual(DEFAULT_PREFERENCES);
		});

		it('should only initialize once', () => {
			coach.init();
			const firstLevel = coach.level;

			// Try to init again with different stored data
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ level: 'off' }));
			coach.init();

			// Should still have first level
			expect(coach.level).toBe(firstLevel);
		});

		it('should merge partial stored preferences with defaults', () => {
			mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ level: 'coach' }));

			coach.init();

			// Level from storage
			expect(coach.level).toBe('coach');
			// Others from defaults
			expect(coach.preferences.showProbabilities).toBe(true);
			expect(coach.preferences.highlightOptimal).toBe(true);
		});
	});

	// ===========================================================================
	// Testing Helpers
	// ===========================================================================

	describe('__testing helpers', () => {
		it('should reset all state', () => {
			// Modify state
			coach.setLevel('training');
			coach.setFeedback({ type: 'info', message: 'test' });
			coach.requestConfirmation({
				type: 'score',
				isOptimal: false,
				chosenEV: 10,
				optimalEV: 20,
			});

			// Reset
			coach.__testing.reset();

			expect(coach.level).toBe('hints');
			expect(coach.lastFeedback).toBeNull();
			expect(coach.pendingDecision).toBeNull();
			expect(coach.showConfirmModal).toBe(false);
			expect(coach.initialized).toBe(false);
		});

		it('should allow setting preferences directly', () => {
			const customPrefs: CoachPreferences = {
				level: 'off',
				showProbabilities: false,
				highlightOptimal: false,
				showEVDelta: false,
				animateSuggestions: false,
			};

			coach.__testing.setPreferences(customPrefs);

			expect(coach.preferences).toEqual(customPrefs);
			expect(coach.level).toBe('off');
			expect(coach.isActive).toBe(false);
		});
	});
});
