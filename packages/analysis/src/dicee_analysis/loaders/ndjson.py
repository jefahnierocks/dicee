"""
NDJSON file loaders for simulation results.

Provides both streaming (memory-efficient) and batch loading options.
"""

import json
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

import polars as pl
from tqdm import tqdm

from dicee_analysis.schemas import (
    DecisionResult,
    GameResult,
    TurnResult,
)


def iter_games(path: str | Path) -> Iterator[GameResult]:
    """
    Iterate over games from NDJSON file.
    
    Memory-efficient streaming - processes one game at a time.
    
    Args:
        path: Path to games.ndjson file
        
    Yields:
        GameResult for each line in the file
    """
    path = Path(path)
    with path.open() as f:
        for line in f:
            if line.strip():
                data = json.loads(line)
                yield GameResult.model_validate(data)


def iter_turns(path: str | Path) -> Iterator[TurnResult]:
    """
    Iterate over turns from NDJSON file.
    
    Args:
        path: Path to turns.ndjson file
        
    Yields:
        TurnResult for each line in the file
    """
    path = Path(path)
    with path.open() as f:
        for line in f:
            if line.strip():
                data = json.loads(line)
                yield TurnResult.model_validate(data)


def load_games(
    path: str | Path,
    *,
    limit: int | None = None,
    progress: bool = False,
) -> pl.DataFrame:
    """
    Load games from NDJSON into a Polars DataFrame.
    
    Flattens player results for easier analysis.
    
    Args:
        path: Path to games.ndjson file
        limit: Maximum number of games to load (None for all)
        progress: Show progress bar
        
    Returns:
        Polars DataFrame with one row per player per game
    """
    path = Path(path)

    # Count lines for progress bar
    total = None
    if progress:
        with path.open() as f:
            total = sum(1 for _ in f)
        if limit:
            total = min(total, limit)

    records: list[dict[str, Any]] = []

    iterator: Iterable[GameResult] = iter_games(path)
    if progress:
        iterator = tqdm(iterator, total=total, desc="Loading games")

    for i, game in enumerate(iterator):
        if limit and i >= limit:
            break

        for player in game.players:
            records.append({
                "game_id": game.game_id,
                "seed": game.seed,
                "experiment_id": game.experiment_id,
                "started_at": game.started_at,
                "completed_at": game.completed_at,
                "duration_ms": game.duration_ms,
                "winner_id": game.winner_id,
                "winner_profile_id": game.winner_profile_id,
                # Player fields
                "player_id": player.id,
                "profile_id": player.profile_id,
                "final_score": player.final_score,
                "upper_bonus": player.upper_bonus,
                "dicee_count": player.dicee_count,
                "optimal_decisions": player.optimal_decisions,
                "total_decisions": player.total_decisions,
                "ev_loss": player.ev_loss,
                # Scorecard summary
                "upper_section_score": player.scorecard.upper_section_score,
                "lower_section_score": player.scorecard.lower_section_score,
                # Individual categories
                "ones": player.scorecard.ones,
                "twos": player.scorecard.twos,
                "threes": player.scorecard.threes,
                "fours": player.scorecard.fours,
                "fives": player.scorecard.fives,
                "sixes": player.scorecard.sixes,
                "three_of_a_kind": player.scorecard.three_of_a_kind,
                "four_of_a_kind": player.scorecard.four_of_a_kind,
                "full_house": player.scorecard.full_house,
                "small_straight": player.scorecard.small_straight,
                "large_straight": player.scorecard.large_straight,
                "dicee": player.scorecard.dicee,
                "chance": player.scorecard.chance,
            })

    return pl.DataFrame(records)


def load_turns(
    path: str | Path,
    *,
    limit: int | None = None,
    progress: bool = False,
) -> pl.DataFrame:
    """
    Load turns from NDJSON into a Polars DataFrame.
    
    Args:
        path: Path to turns.ndjson file
        limit: Maximum number of turns to load
        progress: Show progress bar
        
    Returns:
        Polars DataFrame with turn data
    """
    path = Path(path)

    total = None
    if progress:
        with path.open() as f:
            total = sum(1 for _ in f)
        if limit:
            total = min(total, limit)

    records: list[dict[str, Any]] = []

    iterator: Iterable[TurnResult] = iter_turns(path)
    if progress:
        iterator = tqdm(iterator, total=total, desc="Loading turns")

    for i, turn in enumerate(iterator):
        if limit and i >= limit:
            break

        records.append({
            "turn_id": turn.turn_id,
            "game_id": turn.game_id,
            "player_id": turn.player_id,
            "profile_id": turn.profile_id,
            "turn_number": turn.turn_number,
            "roll_count": turn.roll_count,
            "final_dice": list(turn.final_dice),
            "scored_category": turn.scored_category,
            "scored_points": turn.scored_points,
            "optimal_category": turn.optimal_category,
            "optimal_points": turn.optimal_points,
            "ev_difference": turn.ev_difference,
            "was_optimal": turn.was_optimal,
        })

    return pl.DataFrame(records)


def load_decisions(
    path: str | Path,
    *,
    limit: int | None = None,
    progress: bool = False,
) -> pl.DataFrame:
    """
    Load decisions from NDJSON into a Polars DataFrame.
    
    Args:
        path: Path to decisions.ndjson file
        limit: Maximum number of decisions to load
        progress: Show progress bar
        
    Returns:
        Polars DataFrame with decision data
    """
    path = Path(path)

    records: list[dict[str, Any]] = []

    with path.open() as f:
        iterator: Iterable[str] = f
        if progress:
            iterator = tqdm(f, desc="Loading decisions")

        for i, line in enumerate(iterator):
            if limit and i >= limit:
                break
            if not line.strip():
                continue

            data = json.loads(line)
            decision = DecisionResult.model_validate(data)

            records.append({
                "decision_id": decision.decision_id,
                "turn_id": decision.turn_id,
                "game_id": decision.game_id,
                "player_id": decision.player_id,
                "roll_number": decision.roll_number,
                "dice_before": list(decision.dice_before),
                "dice_after": list(decision.dice_after),
                "kept_mask": list(decision.kept_mask),
                "was_optimal_hold": decision.was_optimal_hold,
                "ev_loss": decision.ev_loss,
            })

    return pl.DataFrame(records)
