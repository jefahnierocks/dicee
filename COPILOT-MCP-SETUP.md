# GitHub Copilot CLI MCP Setup

Dicee no longer ships a repo script that edits `~/.copilot/mcp-config.json`.

## Supported Pattern

1. Open `.copilot-mcp.json` in this repo.
2. Replace every `/absolute/path/to/dicee` placeholder with your local checkout path.
3. Manually merge the servers you want into your own `~/.copilot/mcp-config.json`.

## What `.copilot-mcp.json` Provides

- `akg`

Local-only quality, public-safety, build/check, and Git-status workflows are
handled by `scripts/copilot-mcp-wrapper.sh`. `public-safety` and `status` are
read-only; quality/build checks may rebuild tracked generated output and require
a diff review. The wrapper intentionally exposes no deployment or log-tail
commands.

## Cloudflare operator boundary

Start at `docs/cloudflare/README.md`. Only for an explicitly authorized
Cloudflare task:

```bash
direnv allow
./scripts/check-1password-setup.sh
./scripts/with-dicee-cloudflare.sh -- wrangler whoami
```

The command-scoped wrapper resolves Cloudflare credentials from 1Password on
demand. It does not grant deployment authority. Dicee does not require
project-local GitHub or Context7 tokens.

## References

- `docs/MCP-SETUP.md`
- `.copilot-mcp-README.md`
- `.copilot-mcp.json`
