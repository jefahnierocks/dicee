# Dicee

Family-friendly game platform for mobile browsers. No app install required.

**Live:** https://dicee.games

## Architecture

| Layer | Technology |
|-------|------------|
| Frontend | SvelteKit (Svelte 5) on Cloudflare Pages |
| Game Engine | Rust compiled to WebAssembly (45KB) |
| Realtime | Cloudflare Durable Objects with WebSocket hibernation |
| Auth & Data | Supabase (PostgreSQL, Row Level Security) |
| Simulation | TypeScript experiment framework + Python analysis |

## Features

- **Solo & Multiplayer** - Play against AI or friends in real-time
- **AI Opponents** - 5 difficulty profiles with distinct play styles
- **Mobile-First** - Touch controls, responsive layout, keyboard handling
- **Spectator Mode** - Watch games with live predictions
- **Global Lobby** - Chat, presence, room browser

## Project Structure

```
packages/
  engine/        # Rust probability engine
  web/           # SvelteKit frontend
  cloudflare-do/ # Durable Objects (game state, lobby)
  shared/        # Shared domain types and validation schemas
  simulation/    # Seeded AI simulations and experiments
  analysis/      # Python statistics and visualization
```

## Development

### Prerequisites

- Node.js 24.18.0 LTS
- pnpm 11.15.1
- Rust 1.97.1
- Python 3.13 and uv 0.11.30
- Bun 1.3.14 and wasm-pack 0.15.0

The authoritative versions are pinned in `.mise.toml` and the language manifests.

```bash
mise install
direnv allow
cargo --version
cargo clippy -V
pnpm check:rust
cargo test --manifest-path packages/engine/Cargo.toml
```

### Commands

```bash
pnpm install
pnpm dev:full     # Frontend + DO servers
pnpm test:agent   # Complete suite with concise agent output
pnpm check        # Rust, TypeScript, Python, and Worker types
pnpm lint         # Rust, Python, Biome, and AKG
pnpm build
pnpm validate:ci  # Completion gate: validate + dependency audit + public-safety scan
```

Coding agents should read [`AGENTS.md`](AGENTS.md). Tooling decisions and the July 21, 2026 refresh are recorded in [`docs/development/toolchain.md`](docs/development/toolchain.md) and [`docs/audits/2026-07-21-tooling-agentic-refresh.md`](docs/audits/2026-07-21-tooling-agentic-refresh.md).

Cloudflare architecture, configuration authority, operator boundaries, and the
resource-consolidation plan start at
[`docs/cloudflare/README.md`](docs/cloudflare/README.md).

## License

MIT
