@AGENTS.md

# Claude Code additions

- Treat `AGENTS.md` as the repository authority; keep this file small so Claude's context remains focused.
- Project MCP servers are declared in `.mcp.json`. Enable only the servers needed for the task.
- `.claude/settings.json` contains shared permissions and portable hooks. Personal approvals belong in the ignored `.claude/settings.local.json`.
- Run `./scripts/check-1password-setup.sh` only for an explicitly authorized task that needs operator Cloudflare credentials.
- `/quality` runs the `pnpm validate:ci` gate and `/mcp-auth` follows `docs/MCP-SETUP.md`. `/awaken`, `/status`, `/phase`, `/task`, `/verify`, `/tidyup`, `/handoff`, and `/health` are legacy until Phase 2 replaces them: they still read archival `.claude/state/current-phase.json` or retired Memory MCP tools. `docs/status.md`, current Git state, and `AGENTS.md` outrank them.
