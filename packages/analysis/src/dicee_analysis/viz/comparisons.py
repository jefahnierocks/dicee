"""
Comparison and rate visualization functions.
"""

import matplotlib.pyplot as plt
import numpy as np
import polars as pl

from dicee_analysis.stats.descriptive import calculate_bonus_rates, calculate_win_rates

# Profile colors
PROFILE_COLORS = {
    "riley": "#66c2a5",
    "carmen": "#fc8d62",
    "liam": "#8da0cb",
    "professor": "#e78ac3",
    "charlie": "#a6d854",
    "custom": "#808080",
}


def plot_profile_comparison(
    df: pl.DataFrame,
    *,
    score_col: str = "final_score",
    figsize: tuple[int, int] = (12, 5),
    title: str | None = None,
) -> plt.Figure:
    """
    Compare profiles with mean + CI error bars.
    
    Args:
        df: DataFrame with game results
        score_col: Column containing scores
        figsize: Figure size
        title: Plot title
        
    Returns:
        Matplotlib Figure
    """
    fig, ax = plt.subplots(figsize=figsize)

    pdf = df.to_pandas()

    # Calculate statistics per profile
    stats_data = []
    for profile in pdf["profile_id"].unique():
        scores = pdf[pdf["profile_id"] == profile][score_col]
        n = len(scores)
        mean = scores.mean()
        std = scores.std()
        se = std / np.sqrt(n)
        ci = 1.96 * se
        stats_data.append({
            "profile": profile,
            "mean": mean,
            "ci": ci,
            "n": n,
        })

    # Sort by mean
    stats_data.sort(key=lambda x: x["mean"], reverse=True)

    profiles = [s["profile"] for s in stats_data]
    means = [s["mean"] for s in stats_data]
    cis = [s["ci"] for s in stats_data]
    colors = [PROFILE_COLORS.get(p, "#808080") for p in profiles]

    # Plot bars with error bars
    bars = ax.barh(profiles, means, xerr=cis, color=colors, alpha=0.7, capsize=5)

    # Add value labels
    for bar, mean, ci in zip(bars, means, cis, strict=True):
        ax.text(
            mean + ci + 2,
            bar.get_y() + bar.get_height() / 2,
            f"{mean:.1f} ± {ci:.1f}",
            va="center",
            fontsize=10,
        )

    ax.set_xlabel("Mean Score")
    ax.set_ylabel("Profile")
    ax.set_title(title or "Profile Comparison (Mean ± 95% CI)")

    plt.tight_layout()
    return fig


def plot_win_rates(
    df: pl.DataFrame,
    *,
    figsize: tuple[int, int] = (10, 6),
    title: str | None = None,
) -> plt.Figure:
    """
    Plot win rates by profile.
    
    Args:
        df: DataFrame with game results
        figsize: Figure size
        title: Plot title
        
    Returns:
        Matplotlib Figure
    """
    fig, ax = plt.subplots(figsize=figsize)

    win_rates = calculate_win_rates(df)
    pdf = win_rates.to_pandas()

    # Sort by win rate
    pdf = pdf.sort_values("win_rate", ascending=True)

    colors = [PROFILE_COLORS.get(p, "#808080") for p in pdf["profile_id"]]

    bars = ax.barh(pdf["profile_id"], pdf["win_rate"] * 100, color=colors, alpha=0.7)

    # Add value labels
    for bar, rate, wins, games in zip(
        bars, pdf["win_rate"], pdf["wins"], pdf["games"], strict=True
    ):
        ax.text(
            bar.get_width() + 1,
            bar.get_y() + bar.get_height() / 2,
            f"{rate * 100:.1f}% ({wins}/{games})",
            va="center",
            fontsize=10,
        )

    ax.set_xlabel("Win Rate (%)")
    ax.set_ylabel("Profile")
    ax.set_title(title or "Win Rates by Profile")
    ax.set_xlim(0, 100)

    # Add 50% reference line for equal win rate
    ax.axvline(50, color="gray", linestyle="--", alpha=0.5, label="50%")

    plt.tight_layout()
    return fig


def plot_bonus_rates(
    df: pl.DataFrame,
    *,
    figsize: tuple[int, int] = (10, 6),
    title: str | None = None,
) -> plt.Figure:
    """
    Plot upper bonus achievement rates by profile.
    
    Args:
        df: DataFrame with game results
        figsize: Figure size
        title: Plot title
        
    Returns:
        Matplotlib Figure
    """
    fig, ax = plt.subplots(figsize=figsize)

    bonus_rates = calculate_bonus_rates(df)
    pdf = bonus_rates.to_pandas()

    # Sort by bonus rate
    pdf = pdf.sort_values("bonus_rate", ascending=True)

    colors = [PROFILE_COLORS.get(p, "#808080") for p in pdf["profile_id"]]

    bars = ax.barh(pdf["profile_id"], pdf["bonus_rate"] * 100, color=colors, alpha=0.7)

    # Add value labels
    for bar, rate, bonuses, games in zip(
        bars, pdf["bonus_rate"], pdf["bonuses"], pdf["games"], strict=True
    ):
        ax.text(
            bar.get_width() + 1,
            bar.get_y() + bar.get_height() / 2,
            f"{rate * 100:.1f}% ({bonuses}/{games})",
            va="center",
            fontsize=10,
        )

    ax.set_xlabel("Bonus Rate (%)")
    ax.set_ylabel("Profile")
    ax.set_title(title or "Upper Bonus Achievement Rate by Profile")
    ax.set_xlim(0, 100)

    plt.tight_layout()
    return fig
