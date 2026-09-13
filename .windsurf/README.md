# Windsurf configuration

Windsurf uses the repository-wide authority in `AGENTS.md`, `WINDSURF.md`, and
the rules under `.windsurf/rules/`. Dicee has no project-managed Windsurf MCP
configuration: follow the "Windsurf and Copilot CLI" section of
`docs/MCP-SETUP.md`, copy the remote server URLs into user-level configuration,
and let the client perform OAuth. No credentials, operator account names,
private service hosts, or workstation paths belong in tracked configuration.

Run `pnpm validate:ci` before completing a change. Use the checked-in workflows
for component construction and verification.
