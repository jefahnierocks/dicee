"""
Parquet conversion and loading utilities.

Parquet format provides:
- Columnar storage for efficient analytics
- Compression for smaller file sizes
- Fast loading with Polars
"""

from pathlib import Path
from typing import Literal

import polars as pl

from dicee_analysis.loaders.ndjson import load_decisions, load_games, load_turns


def games_to_parquet(
    ndjson_path: str | Path,
    output_path: str | Path,
    *,
    compression: Literal["zstd", "snappy", "gzip", "lz4", "uncompressed"] = "zstd",
    progress: bool = True,
) -> Path:
    """
    Convert games NDJSON to Parquet format.
    
    Args:
        ndjson_path: Path to games.ndjson
        output_path: Path for output Parquet file
        compression: Compression algorithm
        progress: Show progress bar
        
    Returns:
        Path to created Parquet file
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    df = load_games(ndjson_path, progress=progress)
    df.write_parquet(output_path, compression=compression)

    return output_path


def turns_to_parquet(
    ndjson_path: str | Path,
    output_path: str | Path,
    *,
    compression: Literal["zstd", "snappy", "gzip", "lz4", "uncompressed"] = "zstd",
    progress: bool = True,
) -> Path:
    """
    Convert turns NDJSON to Parquet format.
    
    Args:
        ndjson_path: Path to turns.ndjson
        output_path: Path for output Parquet file
        compression: Compression algorithm
        progress: Show progress bar
        
    Returns:
        Path to created Parquet file
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    df = load_turns(ndjson_path, progress=progress)
    df.write_parquet(output_path, compression=compression)

    return output_path


def decisions_to_parquet(
    ndjson_path: str | Path,
    output_path: str | Path,
    *,
    compression: Literal["zstd", "snappy", "gzip", "lz4", "uncompressed"] = "zstd",
    progress: bool = True,
) -> Path:
    """
    Convert decisions NDJSON to Parquet format.
    
    Args:
        ndjson_path: Path to decisions.ndjson
        output_path: Path for output Parquet file
        compression: Compression algorithm
        progress: Show progress bar
        
    Returns:
        Path to created Parquet file
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    df = load_decisions(ndjson_path, progress=progress)
    df.write_parquet(output_path, compression=compression)

    return output_path


def convert_to_parquet(
    input_dir: str | Path,
    output_dir: str | Path,
    *,
    compression: Literal["zstd", "snappy", "gzip", "lz4", "uncompressed"] = "zstd",
) -> dict[str, Path]:
    """
    Convert all NDJSON files in a directory to Parquet.
    
    Looks for games.ndjson, turns.ndjson, and decisions.ndjson.
    
    Args:
        input_dir: Directory containing NDJSON files
        output_dir: Directory for Parquet output
        compression: Compression algorithm
        
    Returns:
        Dict mapping file type to output path
    """
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    results: dict[str, Path] = {}

    # Convert games
    games_ndjson = input_dir / "games.ndjson"
    if games_ndjson.exists():
        print(f"Converting {games_ndjson}...")
        results["games"] = games_to_parquet(
            games_ndjson,
            output_dir / "games.parquet",
            compression=compression,
        )
        print(f"  → {results['games']}")

    # Convert turns
    turns_ndjson = input_dir / "turns.ndjson"
    if turns_ndjson.exists():
        print(f"Converting {turns_ndjson}...")
        results["turns"] = turns_to_parquet(
            turns_ndjson,
            output_dir / "turns.parquet",
            compression=compression,
        )
        print(f"  → {results['turns']}")

    # Convert decisions
    decisions_ndjson = input_dir / "decisions.ndjson"
    if decisions_ndjson.exists():
        print(f"Converting {decisions_ndjson}...")
        results["decisions"] = decisions_to_parquet(
            decisions_ndjson,
            output_dir / "decisions.parquet",
            compression=compression,
        )
        print(f"  → {results['decisions']}")

    return results


def load_parquet(path: str | Path) -> pl.DataFrame:
    """
    Load a Parquet file into a Polars DataFrame.
    
    This is a convenience wrapper around pl.read_parquet.
    
    Args:
        path: Path to Parquet file
        
    Returns:
        Polars DataFrame
    """
    return pl.read_parquet(path)
