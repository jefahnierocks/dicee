# Codex compatibility note

Codex reads [`AGENTS.md`](AGENTS.md) automatically. Repository-scoped settings live in `.codex/config.toml`, and reusable read-only roles live in `.codex/agents/`.

Trust the repository before expecting project configuration or hooks to load. Keep personal models, credentials, and approval preferences in the user configuration, not this repository.
