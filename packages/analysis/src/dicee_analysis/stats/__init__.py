"""
Statistical analysis functions for Dicee simulation results.

Provides descriptive statistics, hypothesis testing, and profile comparisons.

Example:
    >>> from dicee_analysis import load_games
    >>> from dicee_analysis.stats import describe_scores, compare_profiles
    >>> 
    >>> games = load_games("results/games.ndjson")
    >>> stats = describe_scores(games, by_profile=True)
    >>> comparison = compare_profiles(games, "professor", "carmen")
"""

from dicee_analysis.stats.descriptive import (
    calculate_bonus_rates,
    calculate_win_rates,
    describe_by_category,
    describe_scores,
)
from dicee_analysis.stats.hypothesis import (
    compare_profiles,
    mann_whitney_test,
    t_test,
    test_calibration,
)

__all__ = [
    "describe_scores",
    "describe_by_category",
    "calculate_win_rates",
    "calculate_bonus_rates",
    "compare_profiles",
    "test_calibration",
    "t_test",
    "mann_whitney_test",
]
