"""
Visualization presets for Dicee simulation results.

Uses seaborn and matplotlib for statistical visualizations.

Example:
    >>> from dicee_analysis import load_games
    >>> from dicee_analysis.viz import plot_score_distribution
    >>> 
    >>> games = load_games("results/games.ndjson")
    >>> fig = plot_score_distribution(games, by_profile=True)
    >>> fig.savefig("score_distribution.png")
"""

from dicee_analysis.viz.comparisons import (
    plot_bonus_rates,
    plot_profile_comparison,
    plot_win_rates,
)
from dicee_analysis.viz.distributions import (
    plot_category_heatmap,
    plot_score_boxplot,
    plot_score_distribution,
)

__all__ = [
    "plot_score_distribution",
    "plot_score_boxplot",
    "plot_category_heatmap",
    "plot_profile_comparison",
    "plot_win_rates",
    "plot_bonus_rates",
]
