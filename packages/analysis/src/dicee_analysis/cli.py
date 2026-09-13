"""
Command-line interface for dicee-analysis.

Commands:
    dicee-convert: Convert NDJSON to Parquet format
    dicee-analyze: Run basic analysis on results
"""

import argparse
import sys
from pathlib import Path


def convert_ndjson() -> None:
    """Convert NDJSON files to Parquet format."""
    parser = argparse.ArgumentParser(
        prog="dicee-convert",
        description="Convert NDJSON simulation results to Parquet format",
    )
    parser.add_argument(
        "input_dir",
        help="Directory containing NDJSON files (games.ndjson, etc.)",
    )
    parser.add_argument(
        "-o", "--output",
        default=None,
        help="Output directory (default: input_dir/parquet)",
    )
    parser.add_argument(
        "--compression",
        choices=["zstd", "snappy", "gzip", "lz4", "uncompressed"],
        default="zstd",
        help="Compression algorithm (default: zstd)",
    )

    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output) if args.output else input_dir / "parquet"

    if not input_dir.exists():
        print(f"Error: Input directory does not exist: {input_dir}", file=sys.stderr)
        sys.exit(1)

    from dicee_analysis.loaders import convert_to_parquet

    print(f"Converting NDJSON files in {input_dir} to Parquet...")
    results = convert_to_parquet(input_dir, output_dir, compression=args.compression)

    if results:
        print(f"\nConversion complete! Output: {output_dir}")
        for file_type, path in results.items():
            print(f"  - {file_type}: {path}")
    else:
        print("No NDJSON files found to convert.", file=sys.stderr)
        sys.exit(1)


def analyze() -> None:
    """Run basic analysis on simulation results."""
    parser = argparse.ArgumentParser(
        prog="dicee-analyze",
        description="Analyze Dicee simulation results",
    )
    parser.add_argument(
        "input",
        help="Path to games.ndjson or games.parquet file",
    )
    parser.add_argument(
        "-n", "--limit",
        type=int,
        default=None,
        help="Limit number of games to analyze",
    )
    parser.add_argument(
        "--by-profile",
        action="store_true",
        help="Show statistics by profile",
    )
    parser.add_argument(
        "--compare",
        nargs=2,
        metavar=("PROFILE1", "PROFILE2"),
        help="Compare two profiles",
    )

    args = parser.parse_args()

    input_path = Path(args.input)

    if not input_path.exists():
        print(f"Error: File does not exist: {input_path}", file=sys.stderr)
        sys.exit(1)

    import polars as pl

    from dicee_analysis.loaders import load_games
    from dicee_analysis.stats import compare_profiles, describe_scores

    # Load data
    print(f"Loading data from {input_path}...")

    if input_path.suffix == ".parquet":
        df = pl.read_parquet(input_path)
        if args.limit:
            df = df.head(args.limit)
    else:
        df = load_games(input_path, limit=args.limit, progress=True)

    n_games = df.n_unique("game_id")
    print(f"Loaded {n_games} games\n")

    # Basic statistics
    print("=" * 50)
    print("SCORE STATISTICS")
    print("=" * 50)

    if args.by_profile:
        profile_stats_by_id = describe_scores(df, by_profile=True)
        for profile, profile_stats in profile_stats_by_id.items():
            print(f"\n{profile.upper()}:")
            print(f"  N: {profile_stats.n}")
            print(f"  Mean: {profile_stats.mean:.2f} ± {profile_stats.std:.2f}")
            print(f"  Median: {profile_stats.median:.1f}")
            print(f"  Range: [{profile_stats.min:.0f}, {profile_stats.max:.0f}]")
            print(f"  95% CI: [{profile_stats.ci95_lower:.2f}, {profile_stats.ci95_upper:.2f}]")
    else:
        overall_stats = describe_scores(df, by_profile=False)
        print(f"N: {overall_stats.n}")
        print(f"Mean: {overall_stats.mean:.2f} ± {overall_stats.std:.2f}")
        print(f"Median: {overall_stats.median:.1f}")
        print(f"Range: [{overall_stats.min:.0f}, {overall_stats.max:.0f}]")
        print(f"95% CI: [{overall_stats.ci95_lower:.2f}, {overall_stats.ci95_upper:.2f}]")

    # Profile comparison
    if args.compare:
        print("\n" + "=" * 50)
        print("PROFILE COMPARISON")
        print("=" * 50)

        profile1, profile2 = args.compare
        try:
            result = compare_profiles(df, profile1, profile2)
            print(f"\n{result.conclusion}")
            print(f"  Test: {result.test_name}")
            print(f"  p-value: {result.p_value:.4f}")
            print(f"  Effect size: {result.effect_size:.3f} ({result.effect_interpretation})")
        except ValueError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    # For testing
    analyze()
