# Dicee MCP Configuration Guide

> **Last Updated**: 2026-09-12
> **Purpose**: Tool-selection guidance and auth model for project MCP servers

## Priority Order

1. Default project MCP servers: `akg`, `cloudflare-docs`
2. Opt-in project MCP servers, only for tasks that need live account reads and
   have explicit user authority: `cloudflare-api`, `supabase`
3. Global/user-baseline tools: `context7`, GitHub
4. Web search only when MCP or primary docs are insufficient

## Task → Tool Mapping

| Task | Primary Tool |
|------|--------------|
| Import validation, layer rules, invariants | `akg` (`akg_check_import`) |
| Cloudflare product documentation | `cloudflare-docs` |
| Live Cloudflare account state (Workers, Durable Object namespaces, bindings, logs, analytics) | `cloudflare-api` (opt-in) |
| Supabase schema inspection and read-only SQL | `supabase` (opt-in, read-only) |
| Supabase migrations and schema changes | `supabase/migrations` in Git plus the Supabase CLI, with explicit authority (never MCP) |
| Repository decisions and state | `AGENTS.md`, source/tests, Git, explicit handoffs |
| Library and framework docs | global `context7` |

Start Cloudflare work at `docs/cloudflare/README.md`. `cloudflare-api` can call
mutating Cloudflare APIs if the OAuth grant allows it. Grant the narrowest
permissions, and treat deploys, binding changes, and secret changes as requiring
explicit user authority whatever the MCP session can reach.

## Auth Model

### Native HTTP with client OAuth

Remote project servers are declared by URL only. The MCP client (Claude Code or
Cursor) runs the OAuth flow and keeps the session in its own credential store.

| Server | Endpoint | Auth |
|--------|----------|------|
| `cloudflare-docs` | `https://docs.mcp.cloudflare.com/mcp` | none |
| `cloudflare-api` | `https://mcp.cloudflare.com/mcp` | Cloudflare OAuth, permissions chosen at consent |
| `supabase` | `https://mcp.supabase.com/mcp?project_ref=<env>&read_only=true&features=database,docs,functions` | Supabase OAuth via dynamic client registration |

The Supabase project ref comes from `DICEE_SUPABASE_PROJECT_REF` through each
client's environment expansion (`${DICEE_SUPABASE_PROJECT_REF}` in Claude Code,
`${env:DICEE_SUPABASE_PROJECT_REF}` in Cursor). No literal project ref is
committed. See `docs/MCP-SETUP.md` for enabling steps and fail-closed behavior.

### Prohibited patterns

- No bearer tokens, API tokens, personal access tokens, or 1Password secret
  references in MCP `url`, `headers`, `args`, or `env`.
- No credential-forwarding stdio bridges that take an authorization header as a
  command-line argument. They place the resolved token in process argv and
  client logs. That exact pattern caused a May 2026 workstation
  credential-exposure incident, and the former Dicee MCP wrapper scripts
  repeated it until they were removed on 2026-09-12.
- No repo script that resolves an MCP credential at launch.

### Global / User-Baseline Auth

Dicee does **not** provide project-local configuration or tokens for:

- Context7
- GitHub

Configure those globally in your own tool environment if you use them.

## Configuration Files

| Client | Config |
|--------|--------|
| Claude Code | `.mcp.json` (`type: "http"` for remote servers) |
| Cursor | `.cursor/mcp.json` (`url` for remote servers, `type: "stdio"` for `akg`) |
| Windsurf | Manual user-level config using the remote URLs above; see `docs/MCP-SETUP.md` |
| Copilot CLI | Manual user-level config using `.copilot-mcp.json` (`akg` only) and `docs/MCP-SETUP.md` |

`direnv` only loads non-secret project state:

- `PROJECT_NAME`
- `DICEE_PROJECT_ROOT`
- `DICEE_ENV`
- `DICEE_MCP_ENABLED`
- `ENABLE_TOOL_SEARCH`
- optional local overrides from an untracked `.envrc.local.nonsecret`, such as
  `DICEE_SUPABASE_PROJECT_REF`

## Verification

```bash
python3 -m json.tool .mcp.json >/dev/null
python3 -m json.tool .cursor/mcp.json >/dev/null
jq -e '[.mcpServers[] | select(has("url"))] | all(.type=="http")' .mcp.json
pnpm akg:test
claude mcp list   # operator, interactive session
```

The generic Memory MCP server was retired on 2026-07-21. It duplicated client-native/session memory and pulled an unnecessary vulnerable HTTP server stack into the workspace dependency graph.

## References

- `docs/MCP-SETUP.md`
- `docs/cloudflare/README.md`
- `AGENTS.md`
