# @dicee/analysis

Python analysis stack for Dicee AI simulation results.

## Features

- **Data Loading**: Load NDJSON results from `@dicee/simulation` with Polars
- **Parquet Conversion**: Convert to efficient Parquet format for large datasets
- **Statistical Analysis**: Descriptive stats, hypothesis testing, profile comparisons
- **Visualization**: Score distributions, box plots, comparison charts
- **Jupyter Notebooks**: Pre-built analysis templates

## Installation

From the repository root (uv and Python come from `.mise.toml`):

```bash
uv sync --project packages/analysis --group dev
uv run --project packages/analysis --group dev pytest -q packages/analysis
```

## Quick Start

### 1. Run Simulations (from monorepo root)

```bash
# Generate simulation data
pnpm sim:run --profiles professor,carmen,riley --games 1000 --output ./results
```

### 2. Load and Analyze in Python

```python
from dicee_analysis import (
    load_games,
    describe_scores,
    compare_profiles,
    plot_score_distribution,
)

# Load game results
games = load_games("results/games.ndjson")

# Get descriptive statistics
stats = describe_scores(games, by_profile=True)
for profile, s in stats.items():
    print(f"{profile}: mean={s.mean:.2f}±{s.std:.2f}")

# Compare profiles statistically
result = compare_profiles(games, "professor", "carmen")
print(result.conclusion)

# Visualize
fig = plot_score_distribution(games, by_profile=True)
fig.savefig("score_distribution.png")
```

### 3. Use Jupyter Notebooks

```bash
uv run --project packages/analysis jupyter lab packages/analysis/notebooks
```

## CLI Commands

```bash
# Convert NDJSON to Parquet (faster loading for large files)
uv run --project packages/analysis dicee-convert ./results -o ./results/parquet

# Quick analysis
uv run --project packages/analysis dicee-analyze ./results/games.ndjson --by-profile

# Compare specific profiles
uv run --project packages/analysis dicee-analyze ./results/games.ndjson --compare professor carmen
```

## Package Structure

```
packages/analysis/
├── pyproject.toml           # Package config
├── README.md               
├── src/dicee_analysis/
│   ├── __init__.py          # Main exports
│   ├── schemas.py           # Pydantic models (mirrors TypeScript)
│   ├── cli.py               # CLI commands
│   ├── loaders/
│   │   ├── ndjson.py        # NDJSON loading
│   │   └── parquet.py       # Parquet conversion
│   ├── stats/
│   │   ├── descriptive.py   # Descriptive statistics
│   │   └── hypothesis.py    # Hypothesis testing
│   └── viz/
│       ├── distributions.py # Histograms, box plots
│       └── comparisons.py   # Comparison charts
├── notebooks/
│   ├── 01_data_exploration.ipynb
│   └── 02_profile_comparison.ipynb
└── tests/
```

## Key Types (Pydantic)

```python
from dicee_analysis.schemas import GameResult, PlayerResult, DescriptiveStats

# Types mirror TypeScript schemas from @dicee/simulation
# JSON field names use camelCase, Python uses snake_case
game = GameResult.model_validate_json(json_string)
print(game.winner_profile_id)  # Alias: winnerProfileId in JSON
```

## Dependencies

- **polars**: Fast DataFrame library
- **scipy**: Statistical tests
- **seaborn/matplotlib**: Visualization
- **pydantic**: Data validation
- **jupyterlab**: Interactive notebooks
