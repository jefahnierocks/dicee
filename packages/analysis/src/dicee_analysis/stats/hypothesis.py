"""
Hypothesis testing for Dicee simulation results.
"""

from dataclasses import dataclass
from typing import Literal

import numpy as np
import polars as pl
from scipy import stats as scipy_stats


@dataclass
class TestResult:
    """Result of a statistical hypothesis test."""

    test_name: str
    statistic: float
    p_value: float
    effect_size: float
    effect_interpretation: str
    significant: bool
    conclusion: str

    def __repr__(self) -> str:
        sig = "✓" if self.significant else "✗"
        return (
            f"TestResult({self.test_name}: {sig} p={self.p_value:.4f}, "
            f"d={self.effect_size:.3f} ({self.effect_interpretation}))"
        )


def _cohens_d(group1: np.ndarray, group2: np.ndarray) -> float:
    """Calculate Cohen's d effect size."""
    n1, n2 = len(group1), len(group2)
    var1, var2 = np.var(group1, ddof=1), np.var(group2, ddof=1)

    # Pooled standard deviation
    pooled_std = np.sqrt(((n1 - 1) * var1 + (n2 - 1) * var2) / (n1 + n2 - 2))

    if pooled_std == 0:
        return 0.0

    return float((np.mean(group1) - np.mean(group2)) / pooled_std)


def _cohens_d_one_sample(values: np.ndarray, target: float) -> float:
    """Calculate Cohen's d for one-sample test."""
    std = np.std(values, ddof=1)
    if std == 0:
        return 0.0
    return float((np.mean(values) - target) / std)


def _interpret_effect_size(d: float) -> str:
    """Interpret Cohen's d effect size."""
    d_abs = abs(d)
    if d_abs < 0.2:
        return "negligible"
    elif d_abs < 0.5:
        return "small"
    elif d_abs < 0.8:
        return "medium"
    elif d_abs < 1.2:
        return "large"
    else:
        return "very_large"


def t_test(
    group1: np.ndarray,
    group2: np.ndarray,
    *,
    alpha: float = 0.05,
    alternative: Literal["two-sided", "less", "greater"] = "two-sided",
) -> TestResult:
    """
    Perform independent samples t-test (Welch's t-test).
    
    Args:
        group1: First group values
        group2: Second group values
        alpha: Significance level
        alternative: Alternative hypothesis direction
        
    Returns:
        TestResult with test statistics and conclusion
    """
    result = scipy_stats.ttest_ind(group1, group2, equal_var=False, alternative=alternative)

    effect_size = _cohens_d(group1, group2)
    effect_interp = _interpret_effect_size(effect_size)
    significant = result.pvalue < alpha

    mean1, mean2 = np.mean(group1), np.mean(group2)

    if significant:
        direction = "higher" if mean1 > mean2 else "lower"
        conclusion = f"Group 1 mean ({mean1:.2f}) is significantly {direction} than Group 2 ({mean2:.2f})"
    else:
        conclusion = f"No significant difference between groups (p={result.pvalue:.4f})"

    return TestResult(
        test_name="Welch's t-test",
        statistic=float(result.statistic),
        p_value=float(result.pvalue),
        effect_size=effect_size,
        effect_interpretation=effect_interp,
        significant=significant,
        conclusion=conclusion,
    )


def mann_whitney_test(
    group1: np.ndarray,
    group2: np.ndarray,
    *,
    alpha: float = 0.05,
    alternative: Literal["two-sided", "less", "greater"] = "two-sided",
) -> TestResult:
    """
    Perform Mann-Whitney U test (non-parametric alternative to t-test).
    
    Args:
        group1: First group values
        group2: Second group values
        alpha: Significance level
        alternative: Alternative hypothesis direction
        
    Returns:
        TestResult with test statistics and conclusion
    """
    result = scipy_stats.mannwhitneyu(group1, group2, alternative=alternative)

    # Effect size: rank-biserial correlation
    n1, n2 = len(group1), len(group2)
    r = 1 - (2 * result.statistic) / (n1 * n2)  # Rank-biserial correlation

    effect_interp = _interpret_effect_size(r)
    significant = result.pvalue < alpha

    median1, median2 = np.median(group1), np.median(group2)

    if significant:
        direction = "higher" if median1 > median2 else "lower"
        conclusion = f"Group 1 median ({median1:.2f}) is significantly {direction} than Group 2 ({median2:.2f})"
    else:
        conclusion = f"No significant difference between groups (p={result.pvalue:.4f})"

    return TestResult(
        test_name="Mann-Whitney U",
        statistic=float(result.statistic),
        p_value=float(result.pvalue),
        effect_size=float(r),
        effect_interpretation=effect_interp,
        significant=significant,
        conclusion=conclusion,
    )


def compare_profiles(
    df: pl.DataFrame,
    profile1: str,
    profile2: str,
    *,
    score_col: str = "final_score",
    alpha: float = 0.05,
    test: Literal["t", "mann-whitney"] = "t",
) -> TestResult:
    """
    Compare scores between two profiles.
    
    Args:
        df: DataFrame with game results
        profile1: First profile ID
        profile2: Second profile ID
        score_col: Column containing scores
        alpha: Significance level
        test: Statistical test to use
        
    Returns:
        TestResult comparing the two profiles
    """
    scores1 = df.filter(pl.col("profile_id") == profile1)[score_col].to_numpy()
    scores2 = df.filter(pl.col("profile_id") == profile2)[score_col].to_numpy()

    if len(scores1) == 0:
        raise ValueError(f"No data found for profile '{profile1}'")
    if len(scores2) == 0:
        raise ValueError(f"No data found for profile '{profile2}'")

    if test == "t":
        result = t_test(scores1, scores2, alpha=alpha)
    else:
        result = mann_whitney_test(scores1, scores2, alpha=alpha)

    # Update conclusion with profile names
    mean1, mean2 = np.mean(scores1), np.mean(scores2)
    if result.significant:
        better = profile1 if mean1 > mean2 else profile2
        result.conclusion = (
            f"{profile1} (mean={mean1:.2f}) vs {profile2} (mean={mean2:.2f}): "
            f"{better} performs significantly better (p={result.p_value:.4f})"
        )
    else:
        result.conclusion = (
            f"{profile1} (mean={mean1:.2f}) vs {profile2} (mean={mean2:.2f}): "
            f"No significant difference (p={result.p_value:.4f})"
        )

    return result


def test_calibration(
    df: pl.DataFrame,
    profile_id: str,
    target_mean: float,
    *,
    tolerance: float = 10.0,
    score_col: str = "final_score",
    alpha: float = 0.05,
) -> TestResult:
    """
    Test if a profile is calibrated to a target mean score.
    
    Uses a one-sample t-test against the target mean.
    
    Args:
        df: DataFrame with game results
        profile_id: Profile to test
        target_mean: Expected mean score
        tolerance: Acceptable deviation from target
        score_col: Column containing scores
        alpha: Significance level
        
    Returns:
        TestResult indicating calibration status
    """
    scores = df.filter(pl.col("profile_id") == profile_id)[score_col].to_numpy()

    if len(scores) == 0:
        raise ValueError(f"No data found for profile '{profile_id}'")

    # One-sample t-test against target
    result = scipy_stats.ttest_1samp(scores, target_mean)

    effect_size = _cohens_d_one_sample(scores, target_mean)
    effect_interp = _interpret_effect_size(effect_size)

    actual_mean = float(np.mean(scores))
    deviation = abs(actual_mean - target_mean)
    within_tolerance = deviation <= tolerance

    # Calibration passes if:
    # 1. Not significantly different from target, OR
    # 2. Within tolerance range
    calibrated = result.pvalue >= alpha or within_tolerance

    if calibrated:
        conclusion = (
            f"{profile_id} is calibrated: mean={actual_mean:.2f}, "
            f"target={target_mean:.1f}±{tolerance:.1f}"
        )
    else:
        conclusion = (
            f"{profile_id} NOT calibrated: mean={actual_mean:.2f} "
            f"(deviation={deviation:.1f} from target {target_mean:.1f})"
        )

    return TestResult(
        test_name="Calibration Test",
        statistic=float(result.statistic),
        p_value=float(result.pvalue),
        effect_size=effect_size,
        effect_interpretation=effect_interp,
        significant=not calibrated,
        conclusion=conclusion,
    )
