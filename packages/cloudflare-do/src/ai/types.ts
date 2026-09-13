/**
 * AI Player Types
 *
 * Core type definitions for AI opponents in Dicee.
 * Server-authoritative AI runs entirely in Durable Objects.
 */

import type { Category, DiceArray, KeptMask, Scorecard } from '../game';

// ============================================================================
// Speed Mode
// ============================================================================

/**
 * Speed mode for AI gameplay.
 * - 'normal': Standard timing (default, already ~40% faster than before)
 * - 'fast': Additional 40% faster for snappy gameplay
 */
export type AISpeedMode = 'normal' | 'fast';

/**
 * Speed multipliers applied to base timing values.
 */
export const SPEED_MULTIPLIERS: Record<AISpeedMode, number> = {
	normal: 1.0,
	fast: 0.6, // 40% reduction
};

// ============================================================================
// Brain Types
// ============================================================================

/**
 * Brain implementation strategies for AI decision-making.
 *
 * - optimal: Pure EV maximization using WASM engine
 * - probabilistic: EV-based with configurable variance
 * - personality: Trait-influenced decisions (risk tolerance, etc.)
 * - adaptive: Situation-aware personality (phase + position aware)
 * - random: Uniform random choices (chaos mode)
 * - llm: Future LLM-based reasoning (not implemented)
 */
export type BrainType = 'optimal' | 'probabilistic' | 'personality' | 'adaptive' | 'random' | 'llm';

// ============================================================================
// AI Traits
// ============================================================================

/**
 * Personality traits that influence AI decision-making.
 * All values are 0.0-1.0 where 0.5 is neutral/balanced.
 */
export interface AITraits {
	/** Willingness to take risks for higher rewards (0 = conservative, 1 = aggressive) */
	riskTolerance: number;

	/** Tendency to chase Dicee even when suboptimal (0 = pragmatic, 1 = obsessive) */
	diceeChaser: number;

	/** Focus on completing upper section bonus (0 = balanced, 1 = upper-focused) */
	upperSectionFocus: number;

	/** Tendency to use all available rolls (0 = decisive, 1 = thorough) */
	usesAllRolls: number;

	/** Makes decisions quickly vs deliberately (0 = instant, 1 = slow/thoughtful) */
	thinkingTime: number;

	/** Responds to game events in chat (0 = silent, 1 = chatty) */
	chattiness: number;
}

// ============================================================================
// AI Timing
// ============================================================================

/**
 * Timing configuration for natural-feeling AI turns.
 * All values in milliseconds. Actual timing = base + random(0, variance).
 */
export interface AITiming {
	/** Base time before deciding to roll again */
	rollDecisionMs: number;

	/** Base time before deciding which dice to keep */
	keepDecisionMs: number;

	/** Base time before selecting a category to score */
	scoreDecisionMs: number;

	/** Random variance added to each decision (+/- this value) */
	varianceMs: number;

	/** Multiplier applied when "thinking hard" (difficult decisions) */
	thinkingMultiplier: number;
}

// ============================================================================
// AI Profile
// ============================================================================

/**
 * Complete AI opponent profile.
 * Combines identity, brain type, skill level, and personality.
 */
export interface AIProfile {
	/** Unique identifier for the profile */
	id: string;

	/** Display name shown in game */
	name: string;

	/** Seed for avatar generation (DiceBear or similar) */
	avatarSeed: string;

	/** Short description/personality shown in profile */
	tagline: string;

	/** Brain implementation to use for decisions */
	brain: BrainType;

	/**
	 * Skill level affecting decision quality (0.0-1.0).
	 * - 1.0: Always makes optimal decisions
	 * - 0.5: Makes good decisions ~50% of time
	 * - 0.0: Essentially random (but still valid moves)
	 */
	skillLevel: number;

	/** Personality traits influencing behavior */
	traits: AITraits;

	/** Timing configuration for natural pacing */
	timing: AITiming;
}

// ============================================================================
// Game Context
// ============================================================================

/**
 * Snapshot of game state provided to AI brain for decision-making.
 * Contains all information needed to make optimal choices.
 */
export interface GameContext {
	/** Current dice values (5 dice) */
	dice: DiceArray;

	/** Which dice are currently kept */
	keptDice: KeptMask;

	/** Rolls remaining this turn (0-2) */
	rollsRemaining: number;

	/** AI player's scorecard */
	scorecard: Scorecard;

	/** Current round number (1-13) */
	round: number;

	/** Opponent scorecards for strategy consideration */
	opponentScores: Array<{
		playerId: string;
		scorecard: Scorecard;
		totalScore: number;
	}>;

	/** Whether this is the final round */
	isFinalRound: boolean;

	/** Score difference from leader (negative = behind, positive = ahead) */
	scoreDifferential: number;
}

// ============================================================================
// Turn Decisions
// ============================================================================

/**
 * Action types an AI can take during their turn.
 */
export type TurnAction = 'roll' | 'keep' | 'score';

/**
 * Decision output from AI brain.
 * Represents a single step in the turn (roll, keep, or score).
 */
export interface TurnDecision {
	/** Type of action to take */
	action: TurnAction;

	/** For 'keep' action: which dice to keep */
	keepMask?: KeptMask;

	/** For 'score' action: which category to score in */
	category?: Category;

	/** Human-readable explanation (for debugging/chat) */
	reasoning?: string;

	/** Confidence level in the decision (0-1, for personality variation) */
	confidence?: number;
}

// ============================================================================
// AI Player State
// ============================================================================

/**
 * Runtime state for an AI player in a game.
 * Tracks turn progress and scheduled actions.
 */
export interface AIPlayerState {
	/** Player ID in the game */
	playerId: string;

	/** Profile being used */
	profile: AIProfile;

	/** Current turn step (for multi-step turn execution) */
	turnStep: number;

	/** Whether AI is currently "thinking" (decision scheduled) */
	isThinking: boolean;

	/** Timestamp of last action (for timing) */
	lastActionAt: number;

	/** Accumulated "think time" for complex decisions */
	accumulatedThinkTime: number;
}

// ============================================================================
// AI Controller Events
// ============================================================================

/**
 * Events emitted by AI controller for game integration.
 */
export type AIEvent =
	| { type: 'ai_thinking'; playerId: string; estimatedMs: number }
	| { type: 'ai_roll'; playerId: string }
	| { type: 'ai_keep'; playerId: string; keptDice: KeptMask }
	| { type: 'ai_score'; playerId: string; category: Category; score: number }
	| { type: 'ai_chat'; playerId: string; message: string }
	| { type: 'ai_reaction'; playerId: string; reaction: string };

// ============================================================================
// Factory Types
// ============================================================================

/**
 * Options for creating an AI player.
 */
export interface CreateAIPlayerOptions {
	/** Profile to use (or profile ID to look up) */
	profile: AIProfile | string;

	/** Override skill level from profile */
	skillOverride?: number;

	/** Override timing from profile */
	timingOverride?: Partial<AITiming>;
}
