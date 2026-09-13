@AGENTS.md

# Claude Code additions

- Claude Code loads this file, not nested `AGENTS.md` files: read `packages/web/AGENTS.md` or `packages/cloudflare-do/AGENTS.md` before editing that package.
- `.claude/settings.json` holds shared permissions and `enabledMcpjsonServers` (`akg`, `cloudflare-docs`); personal approvals go in the ignored settings.local.json beside it.
- Project skills are symlinks `.claude/skills/<name>` -> `.agents/skills/<name>`; edit the target, never the link.
- `.claude/settings.json` and `.claude/skills/` are owner-approval paths: propose changes, never bypass the permission prompt.
