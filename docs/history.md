# Removed documents

Git history is the archive; nothing removed is authority. Current homes are listed in [AGENTS.md](../AGENTS.md#where-things-live).

The 2026-09 docs streamline removed `docs/archive`, `docs/planning`, `docs/audits`, `docs/rfcs`, `docs/cloudflare/`, `docs/testing`, the superseded architecture reports, root reports and client files (`ROADMAP.md`, `CODEX.md`, `GEMINI.md`, `WINDSURF.md`, `COPILOT-*`), `.windsurf`, `.cursor/rules`, `.github/instructions`, the `.claude` commands and strategy docs, `scripts/hooks`, the MCP wrappers, and the fish helpers.

```sh
git log --diff-filter=D --name-only --format='%h %s' -- <path>   # find the removing commit
git show <commit>^:<path>                                          # recover a file
```
