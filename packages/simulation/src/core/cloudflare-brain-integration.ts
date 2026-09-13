/**
 * Cloudflare DO Brain Integration
 *
 * Adapts the real AI brains from @dicee/cloudflare-do
 * to work with the simulation framework.
 *
 * This allows simulations to use the same decision-making
 * logic as the production game.
 */

import type { AIBrain, AIProfile, GameContext, TurnDecision } from '@dicee/cloudflare-do';
import {
	AI_PROFILES,
	createBrain as createCFBrain,
	getProfile as getCFProfile,
	initializeBrainFactory,
} from '@dicee/cloudflare-do';
import type {
	SimulationBrain,
	SimulationContext,
	SimulationDecision,
	SimulationProfile,
} from './brain-adapter.js';
import { PhaseShiftingBrain, type PhaseShiftingVariant } from './phase-shifting-brain.js';
import { SeededRandom } from './seeded-random.js';

// Track initialization
let initialized = false;

/**
 * Initialize the brain factory.
 * Must be called before using any brains.
 */
export async function initializeBrains(): Promise<void> {
	if (!initialized) {
		await initializeBrainFactory(true); // Force TypeScript mode
		initialized = true;
	}
}

/**
 * Adapt cloudflare-do GameContext to simulation SimulationContext
 */
function toGameContext(ctx: SimulationContext): GameContext {
	// Convert scorecard format
	const scorecard: Record<string, number | null> = {};
	for (const [key, value] of Object.entries(ctx.scorecard)) {
		scorecard[key] = value;
	}

	return {
		dice: ctx.dice,
		keptDice: ctx.keptDice,
		rollsRemaining: ctx.rollsRemaining,
		scorecard: scorecard as unknown as GameContext['scorecard'],
		round: ctx.round,
		opponentScores: ctx.opponentScores.map((o) => ({
			playerId: o.playerId,
			scorecard: o.scorecard as unknown as GameContext['scorecard'],
			totalScore: o.totalScore,
		})),
		isFinalRound: ctx.isFinalRound,
		scoreDifferential: ctx.scoreDifferential,
	};
}

/**
 * Adapt TurnDecision to SimulationDecision
 */
function toSimulationDecision(decision: TurnDecision): SimulationDecision {
	if (decision.action === 'score' && decision.category) {
		return {
			action: 'score',
			category: decision.category as string,
			confidence: decision.confidence ?? 0.8,
		};
	}

	if (decision.action === 'keep' && decision.keepMask) {
		return {
			action: 'keep',
			keepMask: decision.keepMask,
			confidence: decision.confidence ?? 0.8,
		};
	}

	// Roll action - keep nothing and continue
	return {
		action: 'keep',
		keepMask: [false, false, false, false, false],
		confidence: decision.confidence ?? 0.8,
	};
}

/**
 * Wrapper that adapts a cloudflare-do AIBrain to SimulationBrain
 */
class BrainWrapper implements SimulationBrain {
	readonly type: string;
	private brain: AIBrain;

	constructor(brain: AIBrain) {
		this.brain = brain;
		this.type = brain.type;
	}

	async initialize(profile: SimulationProfile): Promise<void> {
		// Convert SimulationProfile to AIProfile
		const aiProfile: AIProfile = {
			id: profile.id,
			name: profile.name,
			avatarSeed: profile.avatarSeed,
			tagline: profile.tagline,
			brain: profile.brain as AIProfile['brain'],
			skillLevel: profile.skillLevel,
			traits: {
				riskTolerance: profile.traits.riskTolerance,
				diceeChaser: profile.traits.diceeChaser,
				upperSectionFocus: profile.traits.upperSectionFocus,
				usesAllRolls: profile.traits.usesAllRolls,
				thinkingTime: profile.traits.thinkingTime,
				chattiness: profile.traits.chattiness,
			},
			timing: {
				rollDecisionMs: profile.timing.rollDecisionMs,
				keepDecisionMs: profile.timing.keepDecisionMs,
				scoreDecisionMs: profile.timing.scoreDecisionMs,
				varianceMs: profile.timing.varianceMs,
				thinkingMultiplier: profile.timing.thinkingMultiplier,
			},
		};

		await this.brain.initialize(aiProfile);
	}

	async decide(context: SimulationContext): Promise<SimulationDecision> {
		const gameContext = toGameContext(context);
		const decision = await this.brain.decide(gameContext);
		return toSimulationDecision(decision);
	}

	dispose(): void {
		this.brain.dispose();
	}
}

// Phase-shifting brain variants
const PHASE_SHIFTING_VARIANTS: Record<string, PhaseShiftingVariant> = {
	'phase-greedy': 'greedy-to-strategic',
	'phase-conservative': 'conservative-to-aggressive',
	'phase-upper': 'upper-first',
	'phase-lower': 'lower-first',
};

// Seed counter for phase-shifting brains (to ensure different RNG streams)
let phaseShiftingSeedCounter = 0;

/**
 * Create a SimulationBrain using the real AI implementation
 */
export async function createSimulationBrain(brainType: string): Promise<SimulationBrain> {
	// Handle phase-shifting brain types
	if (brainType.startsWith('phase-')) {
		const variant = PHASE_SHIFTING_VARIANTS[brainType];
		if (variant) {
			// Create a unique RNG for each phase-shifting brain
			const rng = new SeededRandom(Date.now() + phaseShiftingSeedCounter++);
			return new PhaseShiftingBrain(rng, { variant });
		}
	}

	await initializeBrains();

	// Create a temporary profile with the requested brain type
	const tempProfile: AIProfile = {
		id: 'temp',
		name: 'temp',
		avatarSeed: 'temp',
		tagline: 'temp',
		brain: brainType as AIProfile['brain'],
		skillLevel: 0.5,
		traits: {
			riskTolerance: 0.5,
			diceeChaser: 0.5,
			upperSectionFocus: 0.5,
			usesAllRolls: 0.5,
			thinkingTime: 0.5,
			chattiness: 0.5,
		},
		timing: {
			rollDecisionMs: 0,
			keepDecisionMs: 0,
			scoreDecisionMs: 0,
			varianceMs: 0,
			thinkingMultiplier: 1,
		},
	};

	const brain = await createCFBrain(tempProfile);
	return new BrainWrapper(brain);
}

// Phase-shifting profile definitions
const PHASE_SHIFTING_PROFILES: Record<string, SimulationProfile> = {
	'phase-greedy': {
		id: 'phase-greedy',
		name: 'Greedy-Strategic Shifter',
		avatarSeed: 'phase-greedy',
		tagline: 'Starts greedy, shifts based on position',
		brain: 'phase-greedy',
		skillLevel: 0.7,
		traits: {
			riskTolerance: 0.5,
			diceeChaser: 0.4,
			upperSectionFocus: 0.5,
			usesAllRolls: 0.6,
			thinkingTime: 0.5,
			chattiness: 0.3,
		},
		timing: {
			rollDecisionMs: 0,
			keepDecisionMs: 0,
			scoreDecisionMs: 0,
			varianceMs: 0,
			thinkingMultiplier: 1,
		},
	},
	'phase-conservative': {
		id: 'phase-conservative',
		name: 'Conservative-Aggressive Shifter',
		avatarSeed: 'phase-conservative',
		tagline: 'Starts safe, gets aggressive when behind',
		brain: 'phase-conservative',
		skillLevel: 0.7,
		traits: {
			riskTolerance: 0.3,
			diceeChaser: 0.5,
			upperSectionFocus: 0.6,
			usesAllRolls: 0.4,
			thinkingTime: 0.5,
			chattiness: 0.3,
		},
		timing: {
			rollDecisionMs: 0,
			keepDecisionMs: 0,
			scoreDecisionMs: 0,
			varianceMs: 0,
			thinkingMultiplier: 1,
		},
	},
	'phase-upper': {
		id: 'phase-upper',
		name: 'Upper Section First',
		avatarSeed: 'phase-upper',
		tagline: 'Prioritizes upper section bonus',
		brain: 'phase-upper',
		skillLevel: 0.7,
		traits: {
			riskTolerance: 0.4,
			diceeChaser: 0.3,
			upperSectionFocus: 0.9,
			usesAllRolls: 0.5,
			thinkingTime: 0.5,
			chattiness: 0.3,
		},
		timing: {
			rollDecisionMs: 0,
			keepDecisionMs: 0,
			scoreDecisionMs: 0,
			varianceMs: 0,
			thinkingMultiplier: 1,
		},
	},
	'phase-lower': {
		id: 'phase-lower',
		name: 'Lower Section First',
		avatarSeed: 'phase-lower',
		tagline: 'Prioritizes big lower section scores',
		brain: 'phase-lower',
		skillLevel: 0.7,
		traits: {
			riskTolerance: 0.6,
			diceeChaser: 0.7,
			upperSectionFocus: 0.2,
			usesAllRolls: 0.6,
			thinkingTime: 0.5,
			chattiness: 0.3,
		},
		timing: {
			rollDecisionMs: 0,
			keepDecisionMs: 0,
			scoreDecisionMs: 0,
			varianceMs: 0,
			thinkingMultiplier: 1,
		},
	},
};

/**
 * Get a SimulationProfile from a profile ID
 */
export function getSimulationProfile(profileId: string): SimulationProfile | undefined {
	// Check for phase-shifting profiles first
	if (profileId.startsWith('phase-')) {
		return PHASE_SHIFTING_PROFILES[profileId];
	}

	const profile = getCFProfile(profileId);
	if (!profile) return undefined;

	return {
		id: profile.id,
		name: profile.name,
		avatarSeed: profile.avatarSeed,
		tagline: profile.tagline,
		brain: profile.brain,
		skillLevel: profile.skillLevel,
		traits: {
			riskTolerance: profile.traits.riskTolerance,
			diceeChaser: profile.traits.diceeChaser,
			upperSectionFocus: profile.traits.upperSectionFocus,
			usesAllRolls: profile.traits.usesAllRolls,
			thinkingTime: profile.traits.thinkingTime,
			chattiness: profile.traits.chattiness,
		},
		timing: {
			rollDecisionMs: profile.timing.rollDecisionMs,
			keepDecisionMs: profile.timing.keepDecisionMs,
			scoreDecisionMs: profile.timing.scoreDecisionMs,
			varianceMs: profile.timing.varianceMs,
			thinkingMultiplier: profile.timing.thinkingMultiplier,
		},
	};
}

/**
 * Get all available profile IDs (including phase-shifting variants)
 */
export function getAvailableProfileIds(): string[] {
	return [...Object.keys(AI_PROFILES), ...Object.keys(PHASE_SHIFTING_PROFILES)];
}
