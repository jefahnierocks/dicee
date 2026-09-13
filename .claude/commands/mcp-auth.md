# Authenticate MCP Servers

Check and authenticate Dicee's project MCP servers. `docs/MCP-SETUP.md` is the
authority for the server list and auth model.

## Instructions

1. Check current MCP server status:
```bash
claude mcp list
```

2. Expected project servers:
   - `akg`: local stdio server, no auth, enabled
   - `cloudflare-docs`: HTTP, no auth, enabled
   - `cloudflare-api`: HTTP, client OAuth, opt-in
   - `supabase`: HTTP, client OAuth, read-only, opt-in

3. Enable an opt-in server only for a task that needs live Cloudflare or
   Supabase reads and has explicit user authority. To authenticate an approved
   server, use `/mcp` or:
```bash
claude mcp login cloudflare-api
claude mcp login supabase
```
   The client opens a browser OAuth flow. Grant the narrowest permissions the
   task needs. Never paste tokens into MCP config, command arguments, or headers.

4. Report status of each server:
   - akg: Connected / Not Connected
   - cloudflare-docs: Connected / Not Connected
   - cloudflare-api: Disabled / Needs Auth / Authenticated
   - supabase: Disabled / Needs Auth / Authenticated

Run `claude mcp list` now and report the status.
