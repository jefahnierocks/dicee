"""
Descriptive statistics for Dicee simulation results.
"""

from dataclasses import dataclass
from typing import Any, Literal, overload

import numpy as np
import polars as pl


@dataclass
class ScoreStats:
    """Descriptive statistics for a score distribution."""

    n: int
    mean: float
    std: float
    median: float
    min: float
    max: float
    q1: float
    q3: float
    ci95_lower: float
    ci95_upper: float

    @property
    def iqr(self) -> float:
        """Interquartile range."""
        return self.q3 - self.q1

    @property
    def ci_width(self) -> float:
        """Width of 95% confidence interval."""
        return self.ci95_upper - self.ci95_lower

    def __repr__(self) -> str:
        return (
            f"ScoreStats(n={self.n}, mean={self.mean:.2f}±{self.std:.2f}, "
            f"median={self.median:.1f}, range=[{self.min:.0f}, {self.max:.0f}])"
        )


def _calculate_stats(values: np.ndarray) -> ScoreStats:
    """Calculate descriptive statistics for an array of values."""
    n = len(values)
    if n == 0:
        return ScoreStats(
            n=0, mean=0, std=0, median=0, min=0, max=0,
            q1=0, q3=0, ci95_lower=0, ci95_upper=0
        )

    mean = float(np.mean(values))
    std = float(np.std(values, ddof=1)) if n > 1 else 0.0

    # Confidence interval
    se = std / np.sqrt(n) if n > 0 else 0
    ci_margin = 1.96 * se

    return ScoreStats(
        n=n,
        mean=mean,
        std=std,
        median=float(np.median(values)),
        min=float(np.min(values)),
        max=float(np.max(values)),
        q1=float(np.percentile(values, 25)),
        q3=float(np.percentile(values, 75)),
        ci95_lower=mean - ci_margin,
        ci95_upper=mean + ci_margin,
    )


@overload
def describe_scores(
    df: pl.DataFrame,
    *,
    score_col: str = "final_score",
    by_profile: Literal[True],
) -> dict[str, ScoreStats]: ...


@overload
def describe_scores(
    df: pl.DataFrame,
    *,
    score_col: str = "final_score",
    by_profile: Literal[False] = False,
) -> ScoreStats: ...


@overload
def describe_scores(
    df: pl.DataFrame,
    *,
    score_col: str = "final_score",
    by_profile: bool,
) -> dict[str, ScoreStats] | ScoreStats: ...


def describe_scores(
    df: pl.DataFrame,
    *,
    score_col: str = "final_score",
    by_profile: bool = False,
) -> dict[str, ScoreStats] | ScoreStats:
    """
    Calculate descriptive statistics for scores.
    
    Args:
        df: DataFrame with game results
        score_col: Column containing scores
        by_profile: If True, group by profile_id
        
    Returns:
        If by_profile: dict mapping profile_id to ScoreStats
        Otherwise: single ScoreStats for all data
    """
    if by_profile:
        result: dict[str, ScoreStats] = {}
        for profile_id in df["profile_id"].unique().to_list():
            profile_df = df.filter(pl.col("profile_id") == profile_id)
            values = profile_df[score_col].to_numpy()
            result[profile_id] = _calculate_stats(values)
        return result
    else:
        values = df[score_col].to_numpy()
        return _calculate_stats(values)


def describe_by_category(
    df: pl.DataFrame,
    *,
    profile_id: str | None = None,
) -> pl.DataFrame:
    """
    Get statistics for each scoring category.
    
    Args:
        df: DataFrame with game results
        profile_id: Filter to specific profile (optional)
        
    Returns:
        DataFrame with category statistics
    """
    if profile_id:
        df = df.filter(pl.col("profile_id") == profile_id)

    categories = [
        "ones", "twos", "threes", "fours", "fives", "sixes",
        "three_of_a_kind", "four_of_a_kind", "full_house",
        "small_straight", "large_straight", "dicee", "chance",
    ]

    stats_data: list[dict[str, Any]] = []

    for cat in categories:
        if cat not in df.columns:
            continue

        # Filter out nulls
        values = df[cat].drop_nulls().to_numpy()
        if len(values) == 0:
            continue

        stats_data.append({
            "category": cat,
            "n": len(values),
            "mean": float(np.mean(values)),
            "std": float(np.std(values, ddof=1)) if len(values) > 1 else 0.0,
            "median": float(np.median(values)),
            "min": float(np.min(values)),
            "max": float(np.max(values)),
        })

    return pl.DataFrame(stats_data)


def calculate_win_rates(
    df: pl.DataFrame,
) -> pl.DataFrame:
    """
    Calculate win rates by profile.
    
    Args:
        df: DataFrame with game results (must have winner_profile_id column)
        
    Returns:
        DataFrame with profile, wins, games, win_rate columns
    """
    # Count games per profile
    games_per_profile = (
        df.group_by("profile_id")
        .agg(pl.len().alias("games"))
    )

    # Count wins per profile
    wins_per_profile = (
        df.filter(pl.col("profile_id") == pl.col("winner_profile_id"))
        .group_by("profile_id")
        .agg(pl.len().alias("wins"))
    )

    # Join and calculate rate
    result = (
        games_per_profile
        .join(wins_per_profile, on="profile_id", how="left")
        .with_columns(
            pl.col("wins").fill_null(0),
            (pl.col("wins").fill_null(0) / pl.col("games")).alias("win_rate"),
        )
        .sort("win_rate", descending=True)
    )

    return result


def calculate_bonus_rates(
    df: pl.DataFrame,
) -> pl.DataFrame:
    """
    Calculate upper bonus achievement rates by profile.
    
    Args:
        df: DataFrame with game results (must have upper_bonus column)
        
    Returns:
        DataFrame with profile, bonuses, games, bonus_rate columns
    """
    result = (
        df.group_by("profile_id")
        .agg([
            pl.len().alias("games"),
            pl.col("upper_bonus").sum().alias("bonuses"),
        ])
        .with_columns(
            (pl.col("bonuses") / pl.col("games")).alias("bonus_rate"),
        )
        .sort("bonus_rate", descending=True)
    )

    return result
