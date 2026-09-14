# Agent clients

## Contract

- [AGENTS.md](../../AGENTS.md) is the repository contract for every client.
- [packages/web/AGENTS.md](../../packages/web/AGENTS.md) and [packages/cloudflare-do/AGENTS.md](../../packages/cloudflare-do/AGENTS.md) add package rules.
- Client files add only real behavioral differences, never copies of the contract.
- Claude Code and Codex started at the repository root do not load nested `AGENTS.md` files on their own. Read the package file before editing that package.

## Client matrix

| Client | Reads | Project configuration | Source |
|---|---|---|---|
| Claude Code | `CLAUDE.md`, which imports `@AGENTS.md` | `.mcp.json`, `.claude/settings.json`, skill symlinks in `.claude/skills/` | [memory](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills), [permissions](https://code.claude.com/docs/en/permissions), [MCP](https://code.claude.com/docs/en/mcp) |
| Codex | `AGENTS.md` from the root down to the working directory | `.codex/config.toml`, `.codex/agents/`, `.codex/rules/`, `.agents/skills/` (trusted projects only) | [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [rules](https://learn.chatgpt.com/docs/agent-configuration/rules), [config](https://learn.chatgpt.com/docs/config-file/config-reference), [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [skills](https://learn.chatgpt.com/docs/build-skills) |
| Gemini CLI | `AGENTS.md` through `.gemini/settings.json` | none beyond the context file | [context files](https://geminicli.com/docs/cli/gemini-md/), [configuration](https://geminicli.com/docs/reference/configuration/) |
| GitHub Copilot | `AGENTS.md` (root and nested); IDE code review reads `.github/copilot-instructions.md` | `.mcp.json` for Copilot CLI after folder trust | [repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support), [CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) |
| Cursor | `AGENTS.md` (root and nested) | `.cursor/mcp.json`; skills from `.agents/skills/` and `.claude/skills/` | [rules](https://cursor.com/docs/context/rules), [MCP](https://cursor.com/docs/context/mcp), [skills](https://cursor.com/docs/context/skills) |

The following are retired and must not be reintroduced: Windsurf and Cascade files, root client files other than `AGENTS.md` and `CLAUDE.md`, Cursor project rules, the Copilot MCP template, and path-scoped Copilot instruction files.

## MCP

| Server | Transport | Auth | Default |
|---|---|---|---|
| `akg` | stdio, `bun run packages/web/src/tools/akg/mcp/server.ts` | none (local) | enabled |
| `cloudflare-docs` | HTTP | none | enabled |
| `cloudflare-api` | HTTP | client OAuth | opt-in (`.mcp.json` only) |
| `supabase` | HTTP, `read_only=true`, `features=database,docs,functions` | client OAuth | opt-in (`.mcp.json` only) |

- **Which tool for which task.** Use `akg` for imports and invariants and `cloudflare-docs` for Cloudflare product docs. `cloudflare-api` is for live account reads and read-only `supabase` for schema inspection. Migrations go through `supabase/migrations/` and the Supabase CLI under explicit authority, never through MCP.
- **An MCP session is not authority.** Deploys, remote database writes, migrations, and binding or secret changes need explicit user authority, whatever the OAuth grant allows.
- **Claude Code.** `.claude/settings.json` `enabledMcpjsonServers` approves `akg` and `cloudflare-docs`. Accept workspace trust. To keep an opt-in server off, list it under `disabledMcpjsonServers` in your ignored local settings file (settings.local.json next to the shared settings). Sign in with `/mcp` or `claude mcp login cloudflare-api` / `claude mcp login supabase`, granting the narrowest consent. Non-interactive runs load project servers without a prompt, and an OAuth server with no stored session exposes no tools.
- **Supabase project scope.** The URL reads `DICEE_SUPABASE_PROJECT_REF`. Set it as a non-secret export in the ignored `.envrc.local.nonsecret`, which `.envrc` sources. When the variable is unset, Claude Code keeps the literal placeholder and the server rejects it, so the entry fails closed. No project ref is ever committed.
- **Cursor.** `.cursor/mcp.json` lists only `akg` (`"type": "stdio"`) and `cloudflare-docs` (`url`). To opt in, add `cloudflare-api` or `supabase` to your user-level Cursor MCP config with the same URLs and let Cursor run OAuth. Cursor does not document how it expands an unset `${env:...}` value, so leave `supabase` off until the variable is set.
- **Codex.** `.codex/config.toml` declares `akg` and `cloudflare-docs` only.

## Skills

- Portable skills live in `.agents/skills/<name>/SKILL.md` (`dicee-verify`, `akg-boundaries`). Each file needs `name`, matching its directory, and `description`.
- Claude Code does not read `.agents/skills/`, so `.claude/skills/<name>` is a symlink to `../../.agents/skills/<name>`. Edit the target, never the link.
- Codex reads `.agents/skills/` directly.
- Cursor reads both directories, so it lists each skill twice. This is cosmetic.

## Codex

- **Trust.** Project `.codex/config.toml`, `.codex/rules/`, and custom agents load only after the project is trusted. Personal model, auth, approval, and sandbox choices stay in user config.
- **Config.** `[agents]` sets `max_concurrent_threads_per_session = 4` and `max_depth = 1`. The read-only `reviewer` and `researcher` agents in `.codex/agents/` are discovered automatically.
- **Launch.** Start Codex from the repository root: the `akg` entry uses repo-relative paths and sets no `cwd`.
- **Rules.** `.codex/rules/dicee.rules` deliberately allows the listed Supabase forms, `pnpm db:types`, `op read`, and `op whoami`. Deploys, live logs, listed Wrangler account commands, credential wrappers, `op run`, `git push`, and workflow/release commands retain `prompt`. The listed `git reset --hard`, `git clean`, and force-push prefixes are `forbidden`. These are prefix rules, not exhaustive coverage of every invocation.
- **Permission and authority.** An `allow` decision removes a rule-level prompt; it does not expand the user's task authorization, bypass operator stop points in `docs/roadmap.md` section 1, or make live Supabase type generation part of ordinary validation. Resolve secrets only when the authorized operation needs them. Other active policy layers and the session's approval mode still apply. If execution is rejected, report the exact barrier; do not change command form or access policy to evade it.
- **Checking a command.** `codex execpolicy check --rules .codex/rules/dicee.rules -- git push -f origin main` evaluates the supplied file without executing the example. It prints JSON with `matchedRules` and a top-level `decision`; the most restrictive match wins (`forbidden` > `prompt` > `allow`). An unmatched command prints empty `matchedRules` and no `decision`. This file-only check does not prove what the running session permits. `bash scripts/tests/codex-rules.test.sh` validates literal declarations and requires explicit decisions, justifications, and nonempty `match` examples; `not_match` is optional. It also checks decisions where `codex` is installed (CI has none). See the [official OpenAI rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules).
- **Filtered workspace commands.** The workspace package set is fixed. The rules enumerate its names for `pnpm --filter <pkg> exec ...` and directory forms, with separate decisions for Wrangler (`prompt`) and Supabase (`allow`).

## Gemini

`.gemini/settings.json` sets `context.fileName` to `["AGENTS.md"]`. Gemini has no project MCP configuration, and whether Gemini CLI reads `.mcp.json` has not been verified.

## Copilot

- The coding agent, Copilot CLI and GitHub.com code review read `AGENTS.md`; nested package files apply for the coding agent.
- VS Code and Visual Studio code review read only `.github/copilot-instructions.md`, a short pointer back to the contract.
- Copilot CLI loads project MCP from `.mcp.json` after folder trust; no user-level template is merged.
- Not verified: whether GitHub.com code review honours nested package `AGENTS.md` files.

## Prohibited patterns

- No bearer tokens, API tokens, personal access tokens, or secret references in any MCP `url`, `headers`, `args`, or `env`.
- No stdio bridge that takes an authorization header as an argument: argv shows up in process listings and client logs.
- No repository script that resolves an MCP credential or edits user-global client config, and no template merges into user-global config.
- No secret exports in `.envrc`, `.envrc.local.nonsecret`, or shell startup files. Operator commands that need a Cloudflare token use `./scripts/with-dicee-cloudflare.sh -- <command>`, which passes the token to one child process through the environment.

## Verification

Static checks, safe anywhere:

```bash
python3 -m json.tool .mcp.json >/dev/null
python3 -m json.tool .cursor/mcp.json >/dev/null
jq -e '[.mcpServers[] | select(has("url"))] | all(.type=="http")' .mcp.json
pnpm akg:test
bash scripts/tests/codex-rules.test.sh
```

Operator checks in interactive sessions after a client-surface change:

- Claude Code: `/context` and `/skills` show `CLAUDE.md`, `AGENTS.md` and the two skills; `claude mcp list` shows `akg` and `cloudflare-docs` enabled.
- Codex: trust the project, then `codex mcp list` from the repository root lists `akg` and `cloudflare-docs`.
- Gemini CLI: `/memory show` includes `AGENTS.md`.
- Cursor: the skills list shows `dicee-verify` and `akg-boundaries` (twice).

If a remote server needs authentication, complete its OAuth flow. Never work around it with a token.
