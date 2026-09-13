# Dicee Codex configuration

Codex automatically reads the root `AGENTS.md`. Once the repository is trusted, `.codex/config.toml` enables the stable multi-agent and shell-snapshot features and registers two bounded, read-only roles:

- `reviewer`: independent correctness, security, regression, and test review.
- `researcher`: primary-source version and framework research.

The primary agent owns planning, edits, integration, and final verification. Personal models, authentication, permissions, and sandbox defaults remain in the user configuration.

Run `./scripts/setup-codex-cli.sh` to check the installed CLI and parse the project configuration; it does not write outside the repository.
