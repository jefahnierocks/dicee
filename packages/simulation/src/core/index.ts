/**
 * Core Simulation Engine
 *
 * Provides deterministic game simulation with seeded random number generation.
 *
 * @example
 * import { SeededRandom, GameSimulator, runSingleGame } from '@dicee/simulation';
 *
 * const rng = new SeededRandom(42);
 * const result = await runSingleGame({
 *   players: [{ id: 'p1', profileId: 'professor' }],
 *   seed: 42,
 * });
 */

// Brain RNG adapter
export {
	BrainRngAdapter,
	createAdaptedBrain,
	MathRandomOverride,
	type SimulationBrain,
	type SimulationContext,
	type SimulationDecision,
	type SimulationProfile,
	type SimulationTiming,
	type SimulationTraits,
	withDeterministicRandom,
	withDeterministicRandomAsync,
} from './brain-adapter.js';
// Game simulator
export {
	GameSimulator,
	type GameSimulatorConfig,
	runSingleGame,
} from './game-simulator.js';
// Phase-shifting brains
export {
	createPhaseShiftingBrain,
	PhaseShiftingBrain,
	type PhaseShiftingConfig,
	type PhaseShiftingVariant,
} from './phase-shifting-brain.js';
// Deterministic dice generation
export {
	countDice,
	executeTurnRolls,
	hasFullHouse,
	hasLargeStraight,
	hasNOfAKind,
	hasSmallStraight,
	indicesToMask,
	isDicee,
	KEEP_ALL,
	KEEP_NONE,
	maskToIndices,
	rerollDice,
	rollDice,
	rollDie,
	sortDice,
	sumDice,
	sumMatching,
	type TurnRolls,
} from './seeded-dice.js';
// Seeded random number generation
export {
	createRandom,
	type RandomSource,
	SeededRandom,
} from './seeded-random.js';
