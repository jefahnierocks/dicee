# Core guardrails

**Scope:** Always on

Read and follow `AGENTS.md`. It owns repository architecture, commands, safety boundaries, agent delegation, and the definition of done.

Windsurf-specific reminders:

- Use the scoped rules in this directory only when their file patterns apply.
- Keep MCP credentials out of repository and editor JSON. Configure remote MCP servers at user level with client OAuth, as described in the "Windsurf and Copilot CLI" section of `docs/MCP-SETUP.md`.
- Ask before live Cloudflare/Supabase actions, secret changes, migrations, deployment, or destructive Git operations.
