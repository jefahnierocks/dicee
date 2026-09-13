"""
Distribution visualization functions.
"""


import matplotlib.pyplot as plt
import numpy as np
import polars as pl
import seaborn as sns

# Default color palette for profiles
PROFILE_COLORS = {
    "riley": "#66c2a5",      # Teal (beginner)
    "carmen": "#fc8d62",     # Orange (intermediate)
    "liam": "#8da0cb",       # Blue (risk-taker)
    "professor": "#e78ac3",  # Pink (expert)
    "charlie": "#a6d854",    # Green (chaos)
    "custom": "#808080",     # Gray (custom)
}


def plot_score_distribution(
    df: pl.DataFrame,
    *,
    score_col: str = "final_score",
    by_profile: bool = True,
    bins: int = 30,
    kde: bool = True,
    figsize: tuple[int, int] = (12, 6),
    title: str | None = None,
) -> plt.Figure:
    """
    Plot score distribution histogram.
    
    Args:
        df: DataFrame with game results
        score_col: Column containing scores
        by_profile: If True, color by profile
        bins: Number of histogram bins
        kde: If True, overlay kernel density estimate
        figsize: Figure size (width, height)
        title: Plot title (auto-generated if None)
        
    Returns:
        Matplotlib Figure
    """
    fig, ax = plt.subplots(figsize=figsize)

    # Convert to pandas for seaborn
    pdf = df.to_pandas()

    if by_profile:
        # Get unique profiles and assign colors
        profiles = pdf["profile_id"].unique()
        palette = {p: PROFILE_COLORS.get(p, "#808080") for p in profiles}

        sns.histplot(
            data=pdf,
            x=score_col,
            hue="profile_id",
            bins=bins,
            kde=kde,
            palette=palette,
            alpha=0.6,
            ax=ax,
        )
    else:
        sns.histplot(
            data=pdf,
            x=score_col,
            bins=bins,
            kde=kde,
            color="#1f77b4",
            alpha=0.7,
            ax=ax,
        )

    # Styling
    ax.set_xlabel("Score")
    ax.set_ylabel("Count")
    ax.set_title(title or "Score Distribution")

    # Add mean lines
    if by_profile:
        for profile in pdf["profile_id"].unique():
            mean_val = pdf[pdf["profile_id"] == profile][score_col].mean()
            color = PROFILE_COLORS.get(profile, "#808080")
            ax.axvline(mean_val, color=color, linestyle="--", alpha=0.8, linewidth=1.5)
    else:
        mean_val = pdf[score_col].mean()
        ax.axvline(mean_val, color="red", linestyle="--", alpha=0.8, linewidth=2, label=f"Mean: {mean_val:.1f}")
        ax.legend()

    plt.tight_layout()
    return fig


def plot_score_boxplot(
    df: pl.DataFrame,
    *,
    score_col: str = "final_score",
    group_col: str = "profile_id",
    figsize: tuple[int, int] = (10, 6),
    title: str | None = None,
    show_points: bool = False,
) -> plt.Figure:
    """
    Plot score distribution as box plot by group.
    
    Args:
        df: DataFrame with game results
        score_col: Column containing scores
        group_col: Column to group by
        figsize: Figure size
        title: Plot title
        show_points: If True, overlay individual points
        
    Returns:
        Matplotlib Figure
    """
    fig, ax = plt.subplots(figsize=figsize)

    pdf = df.to_pandas()

    # Order by median score
    order = (
        pdf.groupby(group_col)[score_col]
        .median()
        .sort_values(ascending=False)
        .index.tolist()
    )

    palette = {p: PROFILE_COLORS.get(p, "#808080") for p in order}

    sns.boxplot(
        data=pdf,
        x=group_col,
        y=score_col,
        order=order,
        palette=palette,
        ax=ax,
    )

    if show_points:
        sns.stripplot(
            data=pdf,
            x=group_col,
            y=score_col,
            order=order,
            color="black",
            alpha=0.3,
            size=3,
            ax=ax,
        )

    # Add mean markers
    means = pdf.groupby(group_col)[score_col].mean()
    for i, profile in enumerate(order):
        ax.scatter(i, means[profile], color="red", marker="D", s=50, zorder=5)

    ax.set_xlabel("Profile")
    ax.set_ylabel("Score")
    ax.set_title(title or "Score Distribution by Profile")

    plt.tight_layout()
    return fig


def plot_category_heatmap(
    df: pl.DataFrame,
    *,
    profile_id: str | None = None,
    figsize: tuple[int, int] = (12, 8),
    title: str | None = None,
) -> plt.Figure:
    """
    Plot heatmap of average scores by category.
    
    Args:
        df: DataFrame with game results (with category columns)
        profile_id: Filter to specific profile (optional)
        figsize: Figure size
        title: Plot title
        
    Returns:
        Matplotlib Figure
    """
    categories = [
        "ones", "twos", "threes", "fours", "fives", "sixes",
        "three_of_a_kind", "four_of_a_kind", "full_house",
        "small_straight", "large_straight", "dicee", "chance",
    ]

    # Filter available categories
    available = [c for c in categories if c in df.columns]

    if profile_id:
        df = df.filter(pl.col("profile_id") == profile_id)

    fig, ax = plt.subplots(figsize=figsize)

    # Calculate mean scores per category per profile
    if "profile_id" in df.columns:
        pdf = df.to_pandas()
        profiles = pdf["profile_id"].unique()

        # Create matrix
        data = np.zeros((len(profiles), len(available)))
        for i, profile in enumerate(profiles):
            profile_data = pdf[pdf["profile_id"] == profile]
            for j, cat in enumerate(available):
                data[i, j] = profile_data[cat].mean()

        sns.heatmap(
            data,
            xticklabels=available,
            yticklabels=profiles.tolist(),
            annot=True,
            fmt=".1f",
            cmap="YlOrRd",
            ax=ax,
        )
    else:
        # Single row
        pdf = df.to_pandas()
        data = np.array([[pdf[cat].mean() for cat in available]])

        sns.heatmap(
            data,
            xticklabels=available,
            yticklabels=["All"],
            annot=True,
            fmt=".1f",
            cmap="YlOrRd",
            ax=ax,
        )

    ax.set_title(title or "Average Score by Category")
    plt.xticks(rotation=45, ha="right")
    plt.tight_layout()

    return fig
