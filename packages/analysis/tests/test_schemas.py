"""
Schema Validation Tests

Validates Python Pydantic schemas with fixtures matching TypeScript Zod schemas.
Ensures cross-language consistency for JSON interchange.
"""

from datetime import datetime

import pytest
from pydantic import ValidationError

from dicee_analysis.schemas import (
    AdaptiveStoppingRule,
    BatchConfig,
    BrainType,
    Category,
    DecisionResult,
    ExperimentDefinition,
    ExperimentType,
    FixedStoppingRule,
    GameResult,
    Hypothesis,
    ProfileId,
    # Models
    Scorecard,
    SequentialStoppingRule,
    SimulationConfig,
    TurnResult,
    parse_experiment_definition,
    # Validators
    parse_game_result,
)

# =============================================================================
# Test Fixtures (matching TypeScript fixtures)
# =============================================================================


VALID_SCORECARD = {
    "ones": 3,
    "twos": 6,
    "threes": 9,
    "fours": 12,
    "fives": 15,
    "sixes": 18,
    "threeOfAKind": 25,
    "fourOfAKind": 28,
    "fullHouse": 25,
    "smallStraight": 30,
    "largeStraight": 40,
    "dicee": 50,
    "chance": 23,
    "diceeBonus": 0,
    "upperBonus": 35,
}

VALID_SIMULATION_CONFIG = {
    "players": [
        {"id": "player-1", "profileId": "professor", "brainOverride": "optimal"},
        {"id": "player-2", "profileId": "carmen"},
    ],
    "seed": 42,
    "captureDecisions": True,
    "captureIntermediateStates": False,
}

VALID_GAME_RESULT = {
    "gameId": "550e8400-e29b-41d4-a716-446655440000",
    "seed": 42,
    "experimentId": "calibration_v1",
    "startedAt": "2024-12-10T10:00:00.000Z",
    "completedAt": "2024-12-10T10:00:05.123Z",
    "durationMs": 5123,
    "players": [
        {
            "id": "player-1",
            "profileId": "professor",
            "finalScore": 312,
            "scorecard": VALID_SCORECARD,
            "upperBonus": True,
            "diceeCount": 1,
            "optimalDecisions": 35,
            "totalDecisions": 39,
            "evLoss": 4.2,
        }
    ],
    "winnerId": "player-1",
    "winnerProfileId": "professor",
}

VALID_EXPERIMENT_DEFINITION = {
    "id": "calibration_v1",
    "version": "1.0.0",
    "title": "AI Profile Calibration Experiment",
    "description": "Calibrate AI profiles to target score distributions for balanced gameplay",
    "type": "CALIBRATION",
    "createdAt": "2024-12-10T10:00:00.000Z",
    "author": "test",
    "tags": ["calibration", "ai", "profiles"],
    "hypotheses": [
        {
            "id": "H1",
            "nullHypothesis": "Professor AI average score equals 310 points",
            "alternativeHypothesis": "Professor AI average score differs from 310 points",
            "metric": "total_score",
            "profileId": "professor",
            "direction": "within_range",
            "target": {"low": 305, "high": 315},
            "test": "t_test_one_sample",
            "alpha": 0.05,
            "minEffectSize": 0.5,
            "power": 0.8,
        }
    ],
    "profileIds": ["professor", "carmen", "riley"],
    "stoppingRule": {
        "type": "ADAPTIVE",
        "targetCIWidth": 5,
        "maxGames": 5000,
        "minGames": 100,
    },
    "metrics": ["total_score", "upper_bonus_rate", "dicee_rate"],
    "masterSeed": 12345,
    "playersPerGame": 1,
}


# =============================================================================
# Scorecard Tests
# =============================================================================


class TestScorecard:
    def test_validates_complete_scorecard(self):
        scorecard = Scorecard.model_validate(VALID_SCORECARD)
        assert scorecard.ones == 3
        assert scorecard.three_of_a_kind == 25
        assert scorecard.upper_bonus == 35

    def test_handles_null_categories(self):
        partial = {"diceeBonus": 0, "upperBonus": 0}
        scorecard = Scorecard.model_validate(partial)
        assert scorecard.ones is None
        assert scorecard.dicee is None


# =============================================================================
# Simulation Config Tests
# =============================================================================


class TestSimulationConfig:
    def test_validates_correct_config(self):
        config = SimulationConfig.model_validate(VALID_SIMULATION_CONFIG)
        assert len(config.players) == 2
        assert config.seed == 42
        assert config.capture_decisions is True

    def test_rejects_too_many_players(self):
        invalid = {
            **VALID_SIMULATION_CONFIG,
            "players": [
                {"id": f"p{i}", "profileId": "riley"} for i in range(5)
            ],
        }
        with pytest.raises(ValidationError):
            SimulationConfig.model_validate(invalid)

    def test_rejects_invalid_profile(self):
        invalid = {
            **VALID_SIMULATION_CONFIG,
            "players": [{"id": "p1", "profileId": "invalid_profile"}],
        }
        with pytest.raises(ValidationError):
            SimulationConfig.model_validate(invalid)


# =============================================================================
# Batch Config Tests
# =============================================================================


class TestBatchConfig:
    def test_validates_correct_config(self):
        config = BatchConfig.model_validate({
            "gameCount": 10000,
            "workerCount": 12,
            "baseSeed": 42,
            "outputFormat": "ndjson",
            "outputPath": "./results/games.ndjson",
        })
        assert config.game_count == 10000
        assert config.worker_count == 12

    def test_applies_defaults(self):
        minimal = BatchConfig.model_validate({"gameCount": 100})
        assert minimal.worker_count == 12
        assert minimal.output_format == "ndjson"
        assert minimal.batch_size == 10000

    def test_rejects_excessive_game_count(self):
        with pytest.raises(ValidationError):
            BatchConfig.model_validate({"gameCount": 2_000_000})


# =============================================================================
# Game Result Tests
# =============================================================================


class TestGameResult:
    def test_validates_correct_result(self):
        result = GameResult.model_validate(VALID_GAME_RESULT)
        assert result.game_id == "550e8400-e29b-41d4-a716-446655440000"
        assert result.seed == 42
        assert len(result.players) == 1
        assert result.players[0].final_score == 312

    def test_parse_game_result_function(self):
        result = parse_game_result(VALID_GAME_RESULT)
        assert result.winner_profile_id == "professor"

    def test_handles_datetime_parsing(self):
        result = GameResult.model_validate(VALID_GAME_RESULT)
        assert isinstance(result.started_at, datetime)
        assert isinstance(result.completed_at, datetime)


# =============================================================================
# Turn Result Tests
# =============================================================================


class TestTurnResult:
    def test_validates_correct_turn(self):
        turn = TurnResult.model_validate({
            "turnId": "turn-001",
            "gameId": "550e8400-e29b-41d4-a716-446655440000",
            "playerId": "player-1",
            "profileId": "professor",
            "turnNumber": 7,
            "rollCount": 2,
            "finalDice": [3, 3, 3, 4, 5],
            "scoredCategory": "threes",
            "scoredPoints": 9,
            "optimalCategory": "threes",
            "wasOptimal": True,
        })
        assert turn.turn_number == 7
        assert turn.scored_category == Category.THREES

    def test_rejects_invalid_turn_number(self):
        with pytest.raises(ValidationError):
            TurnResult.model_validate({
                "turnId": "turn-001",
                "gameId": "550e8400-e29b-41d4-a716-446655440000",
                "playerId": "player-1",
                "profileId": "professor",
                "turnNumber": 14,  # Invalid: max is 13
                "rollCount": 1,
                "finalDice": [1, 2, 3, 4, 5],
                "scoredCategory": "chance",
                "scoredPoints": 15,
            })


# =============================================================================
# Decision Result Tests
# =============================================================================


class TestDecisionResult:
    def test_validates_correct_decision(self):
        decision = DecisionResult.model_validate({
            "decisionId": "dec-001",
            "turnId": "turn-001",
            "gameId": "550e8400-e29b-41d4-a716-446655440000",
            "playerId": "player-1",
            "rollNumber": 1,
            "diceBefore": [1, 2, 3, 4, 5],
            "diceAfter": [1, 2, 3, 6, 6],
            "keptMask": [True, True, True, False, False],
            "wasOptimalHold": True,
            "evLoss": 0,
        })
        assert decision.roll_number == 1
        assert decision.kept_mask == (True, True, True, False, False)


# =============================================================================
# Experiment Definition Tests
# =============================================================================


class TestExperimentDefinition:
    def test_validates_correct_definition(self):
        exp = ExperimentDefinition.model_validate(VALID_EXPERIMENT_DEFINITION)
        assert exp.id == "calibration_v1"
        assert exp.type == ExperimentType.CALIBRATION
        assert len(exp.hypotheses) == 1

    def test_parse_experiment_definition_function(self):
        exp = parse_experiment_definition(VALID_EXPERIMENT_DEFINITION)
        assert exp.title == "AI Profile Calibration Experiment"

    def test_rejects_invalid_id_format(self):
        invalid = {**VALID_EXPERIMENT_DEFINITION, "id": "Invalid-ID"}
        with pytest.raises(ValidationError):
            ExperimentDefinition.model_validate(invalid)

    def test_rejects_invalid_hypothesis_id(self):
        invalid = {
            **VALID_EXPERIMENT_DEFINITION,
            "hypotheses": [{
                **VALID_EXPERIMENT_DEFINITION["hypotheses"][0],
                "id": "not-H-format",
            }],
        }
        with pytest.raises(ValidationError):
            ExperimentDefinition.model_validate(invalid)


# =============================================================================
# Hypothesis Tests
# =============================================================================


class TestHypothesis:
    def test_validates_numeric_target(self):
        hypothesis = Hypothesis.model_validate({
            "id": "H2",
            "nullHypothesis": "Carmen AI average score equals 260 points",
            "alternativeHypothesis": "Carmen AI average score differs from 260 points",
            "metric": "total_score",
            "profileId": "carmen",
            "direction": "not_equal",
            "target": 260,
            "test": "t_test_one_sample",
        })
        assert hypothesis.target == 260

    def test_validates_range_target(self):
        hypothesis = Hypothesis.model_validate({
            "id": "H3",
            "nullHypothesis": "Win rate is within expected range",
            "alternativeHypothesis": "Win rate is outside expected range",
            "metric": "win_rate",
            "direction": "within_range",
            "target": {"low": 0.45, "high": 0.55},
            "test": "chi_square",
        })
        assert hypothesis.target.low == 0.45
        assert hypothesis.target.high == 0.55


# =============================================================================
# Stopping Rule Tests
# =============================================================================


class TestStoppingRules:
    def test_validates_fixed_rule(self):
        rule = FixedStoppingRule.model_validate({
            "type": "FIXED",
            "gamesPerUnit": 1000,
        })
        assert rule.games_per_unit == 1000

    def test_validates_sequential_rule(self):
        rule = SequentialStoppingRule.model_validate({
            "type": "SEQUENTIAL",
            "minGames": 100,
            "maxGames": 10000,
            "checkEveryN": 50,
            "futilityPValue": 0.01,
        })
        assert rule.min_games == 100
        assert rule.futility_p_value == 0.01

    def test_validates_adaptive_rule(self):
        rule = AdaptiveStoppingRule.model_validate({
            "type": "ADAPTIVE",
            "targetCIWidth": 5,
            "maxGames": 5000,
            "minGames": 100,
        })
        assert rule.target_ci_width == 5


# =============================================================================
# Cross-Language Consistency Tests
# =============================================================================


class TestCrossLanguageConsistency:
    """
    These tests verify that Python can parse JSON generated by TypeScript.
    The fixtures here match the testFixtures exported from TypeScript tests.
    """

    def test_game_result_roundtrip(self):
        """Verify GameResult can parse camelCase JSON and export snake_case."""
        result = GameResult.model_validate(VALID_GAME_RESULT)

        # Check Python-style access works
        assert result.game_id == "550e8400-e29b-41d4-a716-446655440000"
        assert result.winner_profile_id == "professor"
        assert result.players[0].final_score == 312

        # Check JSON export with camelCase aliases
        json_dict = result.model_dump(by_alias=True)
        assert "gameId" in json_dict
        assert "winnerProfileId" in json_dict
        assert json_dict["players"][0]["finalScore"] == 312

    def test_experiment_definition_roundtrip(self):
        """Verify ExperimentDefinition handles nested structures."""
        exp = ExperimentDefinition.model_validate(VALID_EXPERIMENT_DEFINITION)

        # Check Python-style access
        assert exp.stopping_rule.type == "ADAPTIVE"
        assert exp.hypotheses[0].profile_id == ProfileId.PROFESSOR

        # Check JSON export
        json_dict = exp.model_dump(by_alias=True)
        assert "stoppingRule" in json_dict
        assert json_dict["stoppingRule"]["targetCIWidth"] == 5

    def test_enum_values_match_typescript(self):
        """Verify enum string values match TypeScript."""
        assert ProfileId.PROFESSOR.value == "professor"
        assert BrainType.OPTIMAL.value == "optimal"
        assert ExperimentType.CALIBRATION.value == "CALIBRATION"
        assert Category.THREE_OF_A_KIND.value == "threeOfAKind"
