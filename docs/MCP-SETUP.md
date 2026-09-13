# MCP Setup for Dicee

> **Last Updated**: 2026-09-12
> **Model**: native remote MCP over HTTP with client-performed OAuth; no repository credential wrappers

## Model

Dicee declares a minimal project MCP surface in versioned client configs:

- `.mcp.json` (Claude Code)
- `.cursor/mcp.json` (Cursor)

Remote servers are declared by URL only. The MCP client performs the OAuth flow
and stores its own session. The repository never resolves, exports, or forwards
an MCP credential, and no repo script launches a remote MCP bridge.

| Server | Transport | Auth | Default |
|--------|-----------|------|---------|
| `akg` | stdio (`bun run packages/web/src/tools/akg/mcp/server.ts`) | none (local) | enabled |
| `cloudflare-docs` | HTTP `https://docs.mcp.cloudflare.com/mcp` | none | enabled |
| `cloudflare-api` | HTTP `https://mcp.cloudflare.com/mcp` | client OAuth | opt-in |
| `supabase` | HTTP `https://mcp.supabase.com/mcp` with `read_only=true` and a project scope | client OAuth (dynamic client registration) | opt-in |

`cloudflare-api` is Cloudflare's unified API server. It replaces the former
narrow `cloudflare-bindings`, `cloudflare-observability`, `cloudflare-builds`,
`cloudflare-logpush`, and `cloudflare-graphql` entries.

The generic Memory MCP server was removed on 2026-07-21. Use client-native
memory for personal continuity and commit durable project decisions to source,
tests, Git, or explicit handoff artifacts.

## Opt-in servers

`cloudflare-api` and `supabase` reach live accounts. Enable them only for a task
that needs live Cloudflare or Supabase reads, and only with explicit user
authority. Deployment, remote database writes, migrations, and secret changes
still follow `AGENTS.md`; an MCP session is not that authority.

### Supabase project scope

The `supabase` entry takes its project ref from the environment. No literal
project ref is committed:

- Claude Code: `project_ref=${DICEE_SUPABASE_PROJECT_REF}`
- Cursor: `project_ref=${env:DICEE_SUPABASE_PROJECT_REF}`

Set the variable in the environment that launches the client. With direnv, put a
non-secret export in `.envrc.local.nonsecret`, which `.envrc` sources when it
exists. Keep that file untracked:

```bash
# .envrc.local.nonsecret (local only; never commit)
export DICEE_SUPABASE_PROJECT_REF="<project-ref from the private operator inventory>"
```

The URL also pins `read_only=true` (queries run as a read-only Postgres user and
mutating tools are excluded) and `features=database,docs,functions`.

If the variable is unset, Claude Code warns about the missing variable and keeps
the literal `${DICEE_SUPABASE_PROJECT_REF}` text. The server then rejects that
project ref, so the entry fails closed. Cursor does not document what an unset
`${env:...}` becomes. Do not toggle `supabase` on in Cursor until the variable is
set, because an empty `project_ref` could drop the project scope.

### Claude Code

1. Launch `claude` in the repository and accept the workspace trust dialog.
2. Approve only the project servers you need when prompted. To keep an opt-in
   server off, decline it or list it under `disabledMcpjsonServers` in your
   ignored `.claude/settings.local.json`.
3. Authenticate an approved OAuth server with `/mcp` or:

   ```bash
   claude mcp login cloudflare-api
   claude mcp login supabase
   ```

4. In the Cloudflare and Supabase consent screens, grant the narrowest
   permissions the task needs.

`claude -p`, Agent SDK, and cloud sessions load project servers without an
approval prompt. An OAuth server with no stored session exposes no tools until
someone signs in from an interactive session. Use `disabledMcpjsonServers` if a
non-interactive run must not load it at all.

### Cursor

Cursor reads `.cursor/mcp.json`. Remote servers use `url` with no `type`, and the
local `akg` server uses `"type": "stdio"`. Use the MCP settings toggle to keep
`cloudflare-api` and `supabase` disabled until needed. Cursor starts its own
OAuth flow when a remote server first asks for authorization.

### Windsurf and Copilot CLI

These clients have no project-managed Dicee config. If you add Dicee servers to
their user-level config, copy the same remote URLs with the client's native
remote-server shape and let the client perform OAuth. `.copilot-mcp.json` is a
repo-owned template for the local `akg` server only. Replace
`/absolute/path/to/dicee` with your checkout path before merging it into
`~/.copilot/mcp-config.json`.

## Security rules

- Never put a bearer token, API token, personal access token, or 1Password
  secret reference in an MCP entry, its `headers`, or its `args`.
- Never launch a remote MCP server through a stdio bridge that receives an
  authorization header as a command-line argument.
- Do not add secret exports to `.envrc`, `.envrc.local.nonsecret`, or shell
  profiles (`~/.zshrc`, `~/.bashrc`, `~/.bash_profile`).
- Do not use repo scripts to mutate global MCP config files.

Rationale: in May 2026 a workstation audit found stdio wrappers that resolved
secrets correctly from 1Password, then launched a stdio-to-remote MCP bridge with
the resolved token in a `--header` argument. That bridge had no non-argv way to
set custom headers, so the token sat in process arguments, where any local
process listing, EDR, or process-accounting surface can read it. The bridge also
logged custom headers to stderr, and that output lands in client MCP logs. The
workstation baseline retired the pattern in favor of per-client OAuth sessions
against Cloudflare's native MCP endpoint. Dicee's former Cloudflare and Supabase
MCP wrapper scripts had the same flaw and were
removed on 2026-09-12. If they ever ran on a workstation, treat the Cloudflare
API token and Supabase access token they used as exposed, and rotate or revoke
them.

Non-MCP operator commands that need a Cloudflare token keep using
`./scripts/with-dicee-cloudflare.sh -- <command>`. That wrapper passes the token
to one child process through the environment, never argv.

## Verification

Static checks (safe anywhere):

```bash
python3 -m json.tool .mcp.json >/dev/null
python3 -m json.tool .cursor/mcp.json >/dev/null
jq -e '[.mcpServers[] | select(has("url"))] | all(.type=="http")' .mcp.json
pnpm akg:test
```

Operator checks (interactive, outside the agent sandbox):

```bash
claude mcp list
claude mcp get supabase
```

If a remote server shows as needing authentication, complete its OAuth flow.
Do not work around it by adding a token.
