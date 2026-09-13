"""
Dicee Analysis - Python analysis stack for AI simulation results.

This package provides tools for analyzing Dicee game simulation data:
- Load NDJSON results from @dicee/simulation
- Convert to efficient Parquet format
- Statistical analysis and hypothesis testing
- Visualization presets for common analyses

Example:
    >>> from dicee_analysis import load_games, plot_score_distribution
    >>> games = load_games("results/games.ndjson")
    >>> plot_score_distribution(games, by_profile=True)
"""

__version__ = "0.1.0"

# Re-export main interfaces
from dicee_analysis.loaders import (
    convert_to_parquet,
    load_games,
    load_turns,
)
from dicee_analysis.schemas import (
    DescriptiveStats,
    GameResult,
    PlayerResult,
    TurnResult,
)
from dicee_analysis.stats import (
    compare_profiles,
    describe_scores,
    test_calibration,
)
from dicee_analysis.viz import (
    plot_profile_comparison,
    plot_score_boxplot,
    plot_score_distribution,
)

__all__ = [
    # Version
    "__version__",
    # Loaders
    "load_games",
    "load_turns",
    "convert_to_parquet",
    # Schemas
    "GameResult",
    "PlayerResult",
    "TurnResult",
    "DescriptiveStats",
    # Stats
    "describe_scores",
    "compare_profiles",
    "test_calibration",
    # Viz
    "plot_score_distribution",
    "plot_score_boxplot",
    "plot_profile_comparison",
]
