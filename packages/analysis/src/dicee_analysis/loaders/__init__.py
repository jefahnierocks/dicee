"""
Data loaders for Dicee simulation results.

Supports loading from NDJSON (streaming) and Parquet (efficient) formats.

Example:
    >>> from dicee_analysis.loaders import load_games, convert_to_parquet
    >>> 
    >>> # Load NDJSON directly (slower but works with raw output)
    >>> games = load_games("results/games.ndjson")
    >>> 
    >>> # Convert to Parquet first (recommended for large datasets)
    >>> convert_to_parquet("results/", "results/parquet/")
    >>> games = load_games("results/parquet/games.parquet")
"""

from dicee_analysis.loaders.ndjson import (
    iter_games,
    iter_turns,
    load_decisions,
    load_games,
    load_turns,
)
from dicee_analysis.loaders.parquet import (
    convert_to_parquet,
    games_to_parquet,
    turns_to_parquet,
)

__all__ = [
    "load_games",
    "load_turns",
    "load_decisions",
    "iter_games",
    "iter_turns",
    "convert_to_parquet",
    "games_to_parquet",
    "turns_to_parquet",
]
