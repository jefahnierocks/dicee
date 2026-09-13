"""
Pydantic models mirroring TypeScript Zod schemas.

Field names use snake_case per PEP 8, with alias for camelCase JSON interchange.
This ensures compatibility with @dicee/simulation NDJSON output.

Example:
    >>> import json
    >>> from dicee_analysis.schemas import GameResult
    >>> with open("games.ndjson") as f:
    ...     for line in f:
    ...         game = GameResult.model_validate_json(line)
    ...         print(f"Game {game.game_id}: winner={game.winner_id}")
"""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# =============================================================================
# Enums
# =============================================================================


class ProfileId(StrEnum):
    """AI profile identifiers matching TypeScript ProfileIdSchema."""

    RILEY = "riley"
    CARMEN = "carmen"
    LIAM = "liam"
    SAGE = "sage"
    PROFESSOR = "professor"
    CHARLIE = "charlie"
    CUSTOM = "custom"
    PHASE_GREEDY = "phase-greedy"
    PHASE_CONSERVATIVE = "phase-conservative"
    PHASE_UPPER = "phase-upper"
    PHASE_LOWER = "phase-lower"


class BrainType(StrEnum):
    """Brain type identifiers matching TypeScript BrainTypeSchema."""

    OPTIMAL = "optimal"
    PROBABILISTIC = "probabilistic"
    PERSONALITY = "personality"
    ADAPTIVE = "adaptive"
    RANDOM = "random"
    LLM = "llm"


class Category(StrEnum):
    """Score categories matching the shared TypeScript schema."""

    ONES = "ones"
    TWOS = "twos"
    THREES = "threes"
    FOURS = "fours"
    FIVES = "fives"
    SIXES = "sixes"
    THREE_OF_A_KIND = "threeOfAKind"
    FOUR_OF_A_KIND = "fourOfAKind"
    FULL_HOUSE = "fullHouse"
    SMALL_STRAIGHT = "smallStraight"
    LARGE_STRAIGHT = "largeStraight"
    DICEE = "dicee"
    CHANCE = "chance"


class MetricId(StrEnum):
    """Metrics supported by the simulation experiment schema."""

    TOTAL_SCORE = "total_score"
    UPPER_SECTION_SCORE = "upper_section_score"
    LOWER_SECTION_SCORE = "lower_section_score"
    UPPER_BONUS_RATE = "upper_bonus_rate"
    DICEE_RATE = "dicee_rate"
    DICEE_BONUS_RATE = "dicee_bonus_rate"
    OPTIMAL_DECISION_RATE = "optimal_decision_rate"
    EV_LOSS_PER_DECISION = "ev_loss_per_decision"
    WIN_RATE = "win_rate"


class OutputFormat(StrEnum):
    """Batch result destinations."""

    NDJSON = "ndjson"
    MEMORY = "memory"


class HypothesisDirection(StrEnum):
    """Supported hypothesis directions."""

    GREATER_THAN = "greater_than"
    LESS_THAN = "less_than"
    NOT_EQUAL = "not_equal"
    WITHIN_RANGE = "within_range"


class StatisticalTest(StrEnum):
    """Supported statistical tests."""

    T_TEST_ONE_SAMPLE = "t_test_one_sample"
    T_TEST_TWO_SAMPLE = "t_test_two_sample"
    WELCH_T_TEST = "welch_t_test"
    MANN_WHITNEY_U = "mann_whitney_u"
    CHI_SQUARE = "chi_square"
    ANOVA = "anova"


class ExperimentType(StrEnum):
    """Experiment type identifiers matching TypeScript ExperimentTypeSchema."""

    CALIBRATION = "CALIBRATION"
    DECISION_QUALITY = "DECISION_QUALITY"
    HEAD_TO_HEAD = "HEAD_TO_HEAD"
    TRAIT_SENSITIVITY = "TRAIT_SENSITIVITY"
    REGRESSION = "REGRESSION"
    ABLATION = "ABLATION"


class StoppingRuleType(StrEnum):
    """Stopping rule types."""

    FIXED = "FIXED"
    SEQUENTIAL = "SEQUENTIAL"
    ADAPTIVE = "ADAPTIVE"


class EffectInterpretation(StrEnum):
    """Effect size interpretation categories."""

    NEGLIGIBLE = "negligible"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    VERY_LARGE = "very_large"


# =============================================================================
# Scorecard Model
# =============================================================================


class Scorecard(BaseModel):
    """Scorecard state matching TypeScript ScorecardSchema."""

    model_config = ConfigDict(populate_by_name=True)

    ones: int | None = None
    twos: int | None = None
    threes: int | None = None
    fours: int | None = None
    fives: int | None = None
    sixes: int | None = None
    three_of_a_kind: int | None = Field(None, alias="threeOfAKind")
    four_of_a_kind: int | None = Field(None, alias="fourOfAKind")
    full_house: int | None = Field(None, alias="fullHouse")
    small_straight: int | None = Field(None, alias="smallStraight")
    large_straight: int | None = Field(None, alias="largeStraight")
    dicee: int | None = None
    chance: int | None = None
    dicee_bonus: int = Field(alias="diceeBonus", ge=0)
    upper_bonus: int = Field(alias="upperBonus", ge=0)

    @property
    def upper_section_score(self) -> int:
        """Calculate upper section total."""
        return sum(
            v or 0
            for v in [self.ones, self.twos, self.threes, self.fours, self.fives, self.sixes]
        )

    @property
    def lower_section_score(self) -> int:
        """Calculate lower section total."""
        return sum(
            v or 0
            for v in [
                self.three_of_a_kind,
                self.four_of_a_kind,
                self.full_house,
                self.small_straight,
                self.large_straight,
                self.dicee,
                self.chance,
            ]
        )

    @property
    def has_upper_bonus(self) -> bool:
        """Check if upper bonus threshold (63) is met."""
        return self.upper_bonus > 0


# =============================================================================
# Simulation Configuration Models
# =============================================================================


UnitInterval = Annotated[float, Field(ge=0, le=1)]


class PlayerConfig(BaseModel):
    """Configuration for one simulated player."""

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=1)
    profile_id: ProfileId = Field(alias="profileId")
    brain_override: BrainType | None = Field(None, alias="brainOverride")
    skill_override: UnitInterval | None = Field(None, alias="skillOverride")
    traits_override: dict[str, UnitInterval] | None = Field(None, alias="traitsOverride")


class SimulationConfig(BaseModel):
    """Configuration for a single deterministic or random game."""

    model_config = ConfigDict(populate_by_name=True)

    players: Annotated[list[PlayerConfig], Field(min_length=1, max_length=4)]
    seed: int | None = None
    capture_decisions: bool = Field(False, alias="captureDecisions")
    capture_intermediate_states: bool = Field(False, alias="captureIntermediateStates")


class BatchConfig(BaseModel):
    """Configuration for a bounded batch simulation run."""

    model_config = ConfigDict(populate_by_name=True)

    game_count: int = Field(alias="gameCount", ge=1, le=1_000_000)
    worker_count: int = Field(12, alias="workerCount", ge=1, le=32)
    base_seed: int | None = Field(None, alias="baseSeed")
    output_format: OutputFormat = Field(OutputFormat.NDJSON, alias="outputFormat")
    output_path: str | None = Field(None, alias="outputPath")
    batch_size: int = Field(10_000, alias="batchSize", ge=100, le=100_000)
    progress_interval_ms: int = Field(1000, alias="progressIntervalMs", ge=100)


# =============================================================================
# Result Models
# =============================================================================


class PlayerResult(BaseModel):
    """Result for a single player in a game."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    profile_id: ProfileId = Field(alias="profileId")
    final_score: int = Field(alias="finalScore", ge=0)
    scorecard: Scorecard
    upper_bonus: bool = Field(alias="upperBonus")
    dicee_count: int = Field(alias="diceeCount", ge=0)
    optimal_decisions: int | None = Field(None, alias="optimalDecisions")
    total_decisions: int | None = Field(None, alias="totalDecisions")
    ev_loss: float | None = Field(None, alias="evLoss")


class GameResult(BaseModel):
    """Complete result for a single game."""

    model_config = ConfigDict(populate_by_name=True)

    game_id: str = Field(alias="gameId")
    seed: int
    experiment_id: str | None = Field(None, alias="experimentId")
    started_at: datetime = Field(alias="startedAt")
    completed_at: datetime = Field(alias="completedAt")
    duration_ms: int = Field(alias="durationMs", ge=0)
    players: list[PlayerResult]
    winner_id: str = Field(alias="winnerId")
    winner_profile_id: ProfileId = Field(alias="winnerProfileId")

    def get_player(self, player_id: str) -> PlayerResult | None:
        """Get player result by ID."""
        return next((p for p in self.players if p.id == player_id), None)

    def get_player_by_profile(self, profile_id: str) -> PlayerResult | None:
        """Get player result by profile ID."""
        return next((p for p in self.players if p.profile_id == profile_id), None)


class TurnResult(BaseModel):
    """Result for a single turn."""

    model_config = ConfigDict(populate_by_name=True)

    turn_id: str = Field(alias="turnId")
    game_id: str = Field(alias="gameId")
    player_id: str = Field(alias="playerId")
    profile_id: str = Field(alias="profileId")
    turn_number: int = Field(alias="turnNumber", ge=1, le=13)
    roll_count: int = Field(alias="rollCount", ge=1, le=3)
    final_dice: tuple[int, int, int, int, int] = Field(alias="finalDice")
    scored_category: Category = Field(alias="scoredCategory")
    scored_points: int = Field(alias="scoredPoints", ge=0)
    optimal_category: Category | None = Field(None, alias="optimalCategory")
    optimal_points: int | None = Field(None, alias="optimalPoints")
    ev_difference: float | None = Field(None, alias="evDifference")
    was_optimal: bool | None = Field(None, alias="wasOptimal")


class DecisionResult(BaseModel):
    """Result for a dice-keeping decision."""

    model_config = ConfigDict(populate_by_name=True)

    decision_id: str = Field(alias="decisionId")
    turn_id: str = Field(alias="turnId")
    game_id: str = Field(alias="gameId")
    player_id: str = Field(alias="playerId")
    roll_number: int = Field(alias="rollNumber", ge=1, le=3)
    dice_before: tuple[int, int, int, int, int] = Field(alias="diceBefore")
    dice_after: tuple[int, int, int, int, int] = Field(alias="diceAfter")
    kept_mask: tuple[bool, bool, bool, bool, bool] = Field(alias="keptMask")
    was_optimal_hold: bool | None = Field(None, alias="wasOptimalHold")
    ev_loss: float | None = Field(None, alias="evLoss")


# =============================================================================
# Experiment Definition Models
# =============================================================================


class HypothesisRange(BaseModel):
    """Inclusive target range for a hypothesis."""

    low: float
    high: float


class Hypothesis(BaseModel):
    """A single, reproducible statistical hypothesis."""

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(pattern=r"^H\d+$")
    null_hypothesis: str = Field(alias="nullHypothesis", min_length=10)
    alternative_hypothesis: str = Field(alias="alternativeHypothesis", min_length=10)
    metric: MetricId
    profile_id: ProfileId | None = Field(None, alias="profileId")
    direction: HypothesisDirection
    target: float | HypothesisRange
    test: StatisticalTest
    alpha: float = Field(0.05, ge=0.001, le=0.2)
    min_effect_size: float = Field(0.5, alias="minEffectSize", ge=0.1, le=2.0)
    power: float = Field(0.8, ge=0.7, le=0.99)


class FixedStoppingRule(BaseModel):
    """Run an exact number of games per experimental unit."""

    model_config = ConfigDict(populate_by_name=True)

    type: Literal["FIXED"]
    games_per_unit: int = Field(alias="gamesPerUnit", ge=10, le=100_000)


class SequentialStoppingRule(BaseModel):
    """Check periodically for significance or futility."""

    model_config = ConfigDict(populate_by_name=True)

    type: Literal["SEQUENTIAL"]
    min_games: int = Field(50, alias="minGames", ge=30)
    max_games: int = Field(10_000, alias="maxGames", le=100_000)
    check_every_n: int = Field(50, alias="checkEveryN", ge=5)
    futility_p_value: float = Field(0.001, alias="futilityPValue", ge=0.001, le=0.1)


class AdaptiveStoppingRule(BaseModel):
    """Stop after reaching a target confidence-interval width."""

    model_config = ConfigDict(populate_by_name=True)

    type: Literal["ADAPTIVE"]
    target_ci_width: float = Field(alias="targetCIWidth", ge=1, le=50)
    max_games: int = Field(5_000, alias="maxGames", le=100_000)
    min_games: int = Field(100, alias="minGames", ge=30)


StoppingRule = Annotated[
    FixedStoppingRule | SequentialStoppingRule | AdaptiveStoppingRule,
    Field(discriminator="type"),
]


class ExperimentDefinition(BaseModel):
    """Complete source-of-truth definition for a simulation experiment."""

    model_config = ConfigDict(populate_by_name=True)

    id: str = Field(min_length=3, max_length=50, pattern=r"^[a-z][a-z0-9_]*$")
    version: str = Field("1.0.0", pattern=r"^\d+\.\d+\.\d+$")
    title: str = Field(min_length=5, max_length=200)
    description: str = Field(min_length=20)
    type: ExperimentType
    created_at: datetime = Field(alias="createdAt")
    author: str | None = None
    tags: list[str] = Field(default_factory=list)
    hypotheses: Annotated[list[Hypothesis], Field(min_length=1)]
    profile_ids: Annotated[list[ProfileId], Field(min_length=1)] = Field(alias="profileIds")
    stopping_rule: StoppingRule = Field(alias="stoppingRule")
    metrics: Annotated[list[MetricId], Field(min_length=1)]
    master_seed: int | None = Field(None, alias="masterSeed")
    players_per_game: Literal[1, 2, 3, 4] = Field(1, alias="playersPerGame")


# =============================================================================
# Statistical Models
# =============================================================================


class DescriptiveStats(BaseModel):
    """Descriptive statistics for a metric."""

    model_config = ConfigDict(populate_by_name=True)

    n: int = Field(ge=0)
    mean: float
    median: float
    std_dev: float = Field(alias="stdDev", ge=0)
    min: float
    max: float
    q1: float
    q3: float
    ci95_lower: float = Field(alias="ci95Lower")
    ci95_upper: float = Field(alias="ci95Upper")

    @property
    def iqr(self) -> float:
        """Interquartile range."""
        return self.q3 - self.q1

    @property
    def ci_width(self) -> float:
        """Width of 95% confidence interval."""
        return self.ci95_upper - self.ci95_lower


class HypothesisTestResult(BaseModel):
    """Result of a statistical hypothesis test."""

    model_config = ConfigDict(populate_by_name=True)

    hypothesis_id: str = Field(alias="hypothesisId")
    rejected: bool
    p_value: float = Field(alias="pValue", ge=0, le=1)
    test_statistic: float = Field(alias="testStatistic")
    effect_size: float = Field(alias="effectSize")
    effect_interpretation: EffectInterpretation = Field(alias="effectInterpretation")
    sample_size: int = Field(alias="sampleSize", gt=0)
    conclusion: str


class ExperimentResults(BaseModel):
    """Complete results from an experiment run."""

    model_config = ConfigDict(populate_by_name=True)

    experiment_id: str = Field(alias="experimentId")
    experiment_version: str = Field(alias="experimentVersion")
    started_at: datetime = Field(alias="startedAt")
    completed_at: datetime = Field(alias="completedAt")
    total_games: int = Field(alias="totalGames", ge=0)
    duration_ms: int = Field(alias="durationMs", ge=0)
    master_seed: int | None = Field(None, alias="masterSeed")
    stats_by_profile: dict[str, dict[str, DescriptiveStats]] = Field(alias="statsByProfile")
    hypothesis_results: list[HypothesisTestResult] = Field(alias="hypothesisResults")
    all_hypotheses_passed: bool = Field(alias="allHypothesesPassed")
    summary: str


# =============================================================================
# Validators / Parsers
# =============================================================================


def parse_game_result(data: dict[str, Any]) -> GameResult:
    """Parse and validate game result from JSON dict."""
    return GameResult.model_validate(data)


def parse_turn_result(data: dict[str, Any]) -> TurnResult:
    """Parse and validate turn result from JSON dict."""
    return TurnResult.model_validate(data)


def parse_decision_result(data: dict[str, Any]) -> DecisionResult:
    """Parse and validate decision result from JSON dict."""
    return DecisionResult.model_validate(data)


def parse_experiment_results(data: dict[str, Any]) -> ExperimentResults:
    """Parse and validate experiment results from JSON dict."""
    return ExperimentResults.model_validate(data)


def parse_experiment_definition(data: dict[str, Any]) -> ExperimentDefinition:
    """Parse and validate an experiment definition from a JSON dict."""
    return ExperimentDefinition.model_validate(data)
