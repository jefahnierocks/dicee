# Dicee

Family-friendly dice game for mobile browsers. No app install required.

**Live:** https://dicee.games

## Architecture

| Layer | Technology |
|---|---|
| Frontend | SvelteKit 2 (Svelte 5) on a Cloudflare Worker with Workers Static Assets |
| Game engine | Rust compiled to WebAssembly |
| Realtime | Cloudflare Worker with SQLite Durable Objects and WebSocket hibernation |
| Auth and data | Supabase (Postgres, Row Level Security) |
| Simulation | TypeScript experiment framework plus Python analysis |

## Features

- **Solo and multiplayer**: play against AI opponents or friends in real time
- **AI opponents**: built-in profiles with distinct play styles
- **Mobile first**: touch controls, responsive layout, keyboard handling
- **Spectators**: watch games in progress
- **Lobby**: chat, presence, and a room browser

## Project structure

```text
packages/
  engine/        # Rust probability engine
  web/           # SvelteKit frontend
  cloudflare-do/ # Worker and Durable Objects (game rooms, lobby)
  shared/        # Shared domain types and validation schemas
  simulation/    # Seeded AI simulations and experiments
  analysis/      # Python statistics and visualization
supabase/        # Migrations and pgTAP tests
```

## Development

Versions: `.mise.toml`; policy: [docs/development/toolchain.md](docs/development/toolchain.md). A clean clone needs local Supabase public values before the web app builds; see [Local limitations](docs/development/toolchain.md#local-limitations).

```bash
mise install
direnv allow
pnpm install --frozen-lockfile
pnpm dev:full      # web and Worker dev servers
pnpm test:agent    # complete test suite with concise output
pnpm check         # Rust, TypeScript, Python, Worker types
pnpm lint          # Rust, Python, Biome, AKG, Cloudflare config audit, script tests, docs gate
pnpm build
pnpm validate:ci   # completion gate: validate, dependency audit, public-safety scan
```

Engine tests on their own:

```bash
cd packages/engine && env -u RUSTUP_TOOLCHAIN cargo test --all-features
```

## Docs

- [AGENTS.md](AGENTS.md): contributor and coding-agent contract, with a map of every current document
- [docs/status.md](docs/status.md): current status, decisions, and operator actions
- [docs/roadmap.md](docs/roadmap.md): ordered next work
- [docs/cloudflare.md](docs/cloudflare.md): Cloudflare topology, configuration, and deploy path
- [Organization alignment](docs/development/organization-alignment.md): intended Jefahnierocks ownership, governance, naming and infrastructure boundaries
- [docs/architecture/README.md](docs/architecture/README.md): system architecture
- [SECURITY.md](SECURITY.md): private vulnerability reporting

## License

[MIT](LICENSE)
