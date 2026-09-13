# Supabase MCP Setup

Dicee's Supabase MCP entry is a native remote HTTP server with client-performed
OAuth. The canonical setup and security model is [`docs/MCP-SETUP.md`](../docs/MCP-SETUP.md).

## Launch Path

- `.mcp.json` and `.cursor/mcp.json` declare `supabase` as
  `https://mcp.supabase.com/mcp` with `read_only=true` and a project scope from
  the non-secret `DICEE_SUPABASE_PROJECT_REF` client variable.
- The entry is opt-in. The client performs the OAuth flow and stores its own
  session; no repository script resolves or forwards a Supabase token.

## Verification

```bash
claude mcp list
claude mcp get supabase
```

## Security Notes

- Dicee does not export a Supabase MCP token from `.envrc`.
- Dicee does not write MCP credentials into user-global client configuration.
- The former 1Password-backed token wrapper was removed on 2026-09-12; if it ever
  ran on a workstation, rotate or revoke the Supabase access token it used.
