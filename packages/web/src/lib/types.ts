/**
 * Dicee Type Definitions
 * Aligned with RFC-003 Data Contracts (docs/architecture/README.md#data-contracts)
 */

// =============================================================================
// Dice Types
// =============================================================================

export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type DiceArray = [DieValue, DieValue, DieValue, DieValue, DieValue];
export type KeptMask = [boolean, boolean, boolean, boolean, boolean];

// =============================================================================
// Category Types (Internal - PascalCase)
//
// These are the canonical category types for internal TypeScript use.
// For JSON/WebSocket wire format (camelCase), see $lib/types/multiplayer.ts
// Use $lib/types/category-convert.ts when crossing the boundary.
//
// @invariant category_type_consistency
// =============================================================================

export const UPPER_CATEGORIES = ['Ones', 'Twos', 'Threes', 'Fours', 'Fives', 'Sixes'] as const;

export const LOWER_CATEGORIES = [
	'ThreeOfAKind',
	'FourOfAKind',
	'FullHouse',
	'SmallStraight',
	'LargeStraight',
	'Dicee',
	'Chance',
] as const;

export const ALL_CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES] as const;

export type UpperCategory = (typeof UPPER_CATEGORIES)[number];
export type LowerCategory = (typeof LOWER_CATEGORIES)[number];
export type Category = (typeof ALL_CATEGORIES)[number];

export const CATEGORY_DISPLAY_NAMES: Record<Category, string> = {
	Ones: 'Ones',
	Twos: 'Twos',
	Threes: 'Threes',
	Fours: 'Fours',
	Fives: 'Fives',
	Sixes: 'Sixes',
	ThreeOfAKind: 'Three of a Kind',
	FourOfAKind: 'Four of a Kind',
	FullHouse: 'Full House',
	SmallStraight: 'Small Straight',
	LargeStraight: 'Large Straight',
	Dicee: 'Dicee',
	Chance: 'Chance',
};

export const CATEGORY_TO_INDEX: Record<Category, number> = {
	Ones: 0,
	Twos: 1,
	Threes: 2,
	Fours: 3,
	Fives: 4,
	Sixes: 5,
	ThreeOfAKind: 6,
	FourOfAKind: 7,
	FullHouse: 8,
	SmallStraight: 9,
	LargeStraight: 10,
	Dicee: 11,
	Chance: 12,
};

// =============================================================================
// Scorecard Types
// =============================================================================

export interface CategoryScore {
	category: Category;
	score: number | null; // null = not yet scored
	potentialScore: number; // what you'd get if you scored now
}

export interface Scorecard {
	// Individual category scores (null = not scored)
	scores: Record<Category, number | null>;

	// Computed totals
	upperSubtotal: number;
	upperBonus: number; // 35 if upperSubtotal >= 63
	upperTotal: number;
	lowerTotal: number;
	grandTotal: number;

	// Tracking
	categoriesRemaining: Category[];
	turnsCompleted: number;
}

// =============================================================================
// Game State Types
// =============================================================================

export type GameStatus = 'idle' | 'rolling' | 'keeping' | 'scoring' | 'completed';

export type TurnPhase = 'pre_roll' | 'rolling' | 'deciding' | 'scored';

export interface GameState {
	// Game status
	status: GameStatus;

	// Turn tracking
	turnNumber: number; // 1-13
	rollNumber: number; // 1-3
	phase: TurnPhase;

	// Dice state
	dice: DiceArray;
	keptMask: KeptMask;

	// Scorecard
	scorecard: Scorecard;

	// Timestamps
	gameStartedAt: number | null;
	gameCompletedAt: number | null;
}

// =============================================================================
// Scoring Result Types (from WASM engine)
// =============================================================================

export interface ScoringResult {
	category: Category;
	score: number;
	valid: boolean;
}

// =============================================================================
// Probability Types (from WASM engine)
// =============================================================================

export interface CategoryProbability {
	category: Category;
	probability: number; // 0-1
	expectedValue: number;
	currentScore: number;
	isOptimal: boolean;
}

export interface ProbabilityAnalysis {
	categories: CategoryProbability[];
	bestCategory: Category;
	bestEV: number;
	rollsRemaining: number;
}

// =============================================================================
// Stats Profile Types
// =============================================================================

export type StatsProfile = 'beginner' | 'intermediate' | 'expert';

export interface UserPreferences {
	statsProfile: StatsProfile;
	statsEnabled: boolean;
	soundEnabled: boolean;
	animationsEnabled: boolean;
}

// =============================================================================
// Decision Quality Types
// =============================================================================

export type DecisionQuality =
	| 'optimal'
	| 'excellent'
	| 'good'
	| 'acceptable'
	| 'suboptimal'
	| 'poor';

export interface DecisionFeedback {
	quality: DecisionQuality;
	chosenCategory: Category;
	optimalCategory: Category;
	pointsEarned: number;
	optimalPoints: number;
	evDifference: number;
}

// =============================================================================
// Turn Analysis Types (M1-M4 Solver API)
// =============================================================================

/**
 * Solver's recommended action for the current turn.
 * - "score": Score a category now (optimal to stop rolling)
 * - "reroll": Keep some dice and reroll others (optimal to continue)
 */
export type TurnAction = 'score' | 'reroll';

/**
 * Keep pattern as counts per face value.
 * Index 0 = count of 1s, index 1 = count of 2s, etc.
 * Example: [0, 0, 3, 0, 2, 0] = keep three 3s and two 5s
 */
export type KeepPattern = [number, number, number, number, number, number];

/**
 * Recommendation for which dice to keep when rerolling.
 */
export interface KeepRecommendation {
	/** Keep pattern as face value counts [count_1s, ..., count_6s] */
	keepPattern: KeepPattern;
	/** Human-readable explanation (e.g., "Keep three 5s") */
	explanation: string;
	/** Expected value if following this recommendation */
	expectedValue: number;
}

/**
 * Analysis for a single category from the solver.
 */
export interface CategoryAnalysis {
	/** Category identifier */
	category: Category;
	/** Score if scored immediately */
	immediateScore: number;
	/** Whether the category is valid (meets requirements) */
	isValid: boolean;
	/** Expected value with optimal play */
	expectedValue: number;
}

/**
 * Complete turn analysis from the M1-M4 solver.
 * Provides optimal strategy recommendation.
 */
export interface TurnAnalysis {
	/** Recommended action: score or reroll */
	action: TurnAction;
	/** Category to score (only if action === "score") */
	recommendedCategory?: Category;
	/** Score value (only if action === "score") */
	categoryScore?: number;
	/** Keep recommendation (only if action === "reroll") */
	keepRecommendation?: KeepRecommendation;
	/** Expected value of optimal play from this position */
	expectedValue: number;
	/** Analysis for all available categories */
	categories: CategoryAnalysis[];
}
