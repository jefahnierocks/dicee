# Agent clients

## Contract

- [AGENTS.md](../../AGENTS.md) is the repository contract for every client.
- [packages/web/AGENTS.md](../../packages/web/AGENTS.md) and [packages/cloudflare-do/AGENTS.md](../../packages/cloudflare-do/AGENTS.md) add package rules.
- Client files add only real behavioral differences, never copies of the contract.
- No client loads nested `AGENTS.md` by default. Claude Code reads `CLAUDE.md` and never `AGENTS.md` itself; Codex walks the repository root down to the working directory and stops there; VS Code keeps nested files behind an experimental, off-by-default setting. Read the package file before editing that package.

## Supported clients

Claude Code, Codex CLI and VS Code. Their supported minimums live in `scripts/agent-doctor.config.json` and deliberately appear in no document, including this one: a version written into prose is stale within days and has to be hand-corrected everywhere it was copied. `pnpm agent:doctor --local` reads that file, reports the installed build, and warns when a client falls below its minimum or runs a prerelease the project has not opted into.

A minimum is a floor, not a mirror. Raise one when the project actually needs something a newer build provides — not because a client shipped a patch release. An installed build ahead of or behind public stable is a local fact and never a repository requirement.

## Client matrix

| Client | Reads | Project configuration | Source |
|---|---|---|---|
| Claude Code | `CLAUDE.md`, which imports `@AGENTS.md` | `.mcp.json`, `.claude/settings.json`, skill symlinks in `.claude/skills/` | [memory](https://code.claude.com/docs/en/memory), [skills](https://code.claude.com/docs/en/skills), [permissions](https://code.claude.com/docs/en/permissions), [MCP](https://code.claude.com/docs/en/mcp) |
| Codex | `AGENTS.md` from the root down to the working directory | `.codex/config.toml`, `.codex/agents/`, `.codex/rules/`, `.agents/skills/` (trusted projects only) | [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [rules](https://learn.chatgpt.com/docs/agent-configuration/rules), [config](https://learn.chatgpt.com/docs/config-file/config-reference), [subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [skills](https://learn.chatgpt.com/docs/build-skills) |
| VS Code | root `AGENTS.md` (`chat.useAgentsMdFile`, default on) and `CLAUDE.md` (`chat.useClaudeMdFile`, default on) | `.vscode/mcp.json`, `.vscode/settings.json` | [custom instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions), [AI settings](https://code.visualstudio.com/docs/agents/reference/ai-settings) |
| Gemini CLI | `AGENTS.md` through `.gemini/settings.json` | none beyond the context file | [context files](https://geminicli.com/docs/cli/gemini-md/), [configuration](https://geminicli.com/docs/reference/configuration/) |
| GitHub Copilot | `AGENTS.md` in Copilot CLI, the coding agent, GitHub.com code review and VS Code chat; `.github/copilot-instructions.md` on the surfaces that do not read it | `.mcp.json` for Copilot CLI after folder trust | [repository instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions), [support matrix](https://docs.github.com/en/copilot/reference/custom-instructions-support), [CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) |
| Cursor | `AGENTS.md` (root and nested) | `.cursor/mcp.json`; skills from `.agents/skills/` and `.claude/skills/` | [rules](https://cursor.com/docs/context/rules), [MCP](https://cursor.com/docs/context/mcp), [skills](https://cursor.com/docs/context/skills) |

VS Code loads `AGENTS.md` and `CLAUDE.md` together by default, and Dicee's `CLAUDE.md` imports `@AGENTS.md`, so the contract lands in context twice. Turn `chat.useClaudeMdFile` off in user settings; Dicee commits no project override for it.

The following are retired and must not be reintroduced: Windsurf and Cascade files, root client files other than `AGENTS.md` and `CLAUDE.md`, Cursor project rules, the Copilot MCP template, and path-scoped Copilot instruction files.

`pnpm lint:docs` also refuses a `hooks` key in `.claude/settings.json`, and refuses tracked files in the Claude commands and hooks directories or a hooks directory under scripts. That is a ratchet, not a judgement on the features: those paths had accumulated roughly 3,500 lines of stale generated guidance and session scripts, which one 2026-09-13 change removed in favour of the two portable skills. Reversing it is an owner decision, and the argument has to be a concrete need rather than "the client supports it". Claude agent and rule directories are deliberately not part of the ratchet.

## MCP

| Server | Transport | Auth | Default |
|---|---|---|---|
| `akg` | stdio, `mise exec -- bun run packages/web/src/tools/akg/mcp/server.ts` | none (local) | enabled |
| `cloudflare-docs` | HTTP | none | enabled |
| `cloudflare-api` | HTTP | client OAuth | opt-in (`.mcp.json` only) |
| `supabase` | HTTP, `read_only=true`, `features=database,docs,functions` | client OAuth | opt-in (`.mcp.json` only) |

- **Which tool for which task.** Use `akg` for imports and invariants and `cloudflare-docs` for Cloudflare product docs. `cloudflare-api` is for live account reads and read-only `supabase` for schema inspection. Migrations go through `supabase/migrations/` and the Supabase CLI under explicit authority, never through MCP.
- **An MCP session is not authority.** Deploys, remote database writes, migrations, and binding or secret changes need explicit user authority, whatever the OAuth grant allows.
- **Claude Code.** `.claude/settings.json` `enabledMcpjsonServers` approves `akg` and `cloudflare-docs`. Accept workspace trust. To keep an opt-in server off, list it under `disabledMcpjsonServers` in your ignored local settings file (settings.local.json next to the shared settings). Never set `enableAllProjectMcpServers`: it enables every entry in `.mcp.json`, including the opt-in OAuth servers, and the docs gate cannot see it because it reads only the shared settings file. Sign in with `/mcp` or `claude mcp login cloudflare-api` / `claude mcp login supabase`, granting the narrowest consent. Non-interactive runs load project servers without a prompt, and an OAuth server with no stored session exposes no tools.
- **Supabase project scope.** The URL reads `DICEE_SUPABASE_PROJECT_REF`. Set it as a non-secret export in the ignored `.envrc.local.nonsecret`, which `.envrc` sources. When the variable is unset, Claude Code keeps the literal placeholder and the server rejects it, so the entry fails closed. No project ref is ever committed.
- **Cursor.** `.cursor/mcp.json` lists only `akg` (`"type": "stdio"`) and `cloudflare-docs` (`url`). An authorized opt-in adds `cloudflare-api` or `supabase` to that project-native file with client OAuth; never add Dicee servers to user-global configuration. Use Cursor's `${env:DICEE_SUPABASE_PROJECT_REF}` interpolation for the Supabase project parameter (Claude uses `${DICEE_SUPABASE_PROJECT_REF}`). Keep provider identifiers out of committed configuration and leave `supabase` off until its non-secret project variable is set.
- **Codex.** `.codex/config.toml` declares `akg` and `cloudflare-docs` only.
- **Launcher.** Every client starts `akg` through `mise exec -- bun`, so it always runs on the Bun pinned in `.mise.toml` rather than whatever is first on that client's PATH. `pnpm agent:doctor` checks the four files agree; change them together.
- **VS Code.** `.vscode/mcp.json` uses native top-level `servers` for `akg` and `cloudflare-docs` only. Workspace trust and server startup remain operator decisions. See the [editor setup](../../.vscode/README.md) for settings, recommendations and tasks.

## Skills

- Portable skills live in `.agents/skills/<name>/SKILL.md` (`dicee-verify`, `akg-boundaries`). Each file needs `name`, matching its directory, and `description`. `pnpm lint:docs` enforces both fields and a 60-line cap per skill; Claude Code itself treats `name` as optional, so the gate is the stricter rule.
- Claude Code does not read `.agents/skills/`, so `.claude/skills/<name>` is a symlink to `../../.agents/skills/<name>`. Edit the target, never the link.
- Codex reads `.agents/skills/` directly.
- Cursor reads both directories, so it lists each skill twice. This is cosmetic.

## Codex

- **Trust.** Project `.codex/config.toml`, `.codex/rules/`, and custom agents load only after the project is trusted. Personal model, auth, approval, and sandbox choices stay in user config.
- **Config.** `[agents]` sets `max_concurrent_threads_per_session = 4` and `max_depth = 1`; `akg` sets `startup_timeout_sec` because `mise exec` may resolve the pinned Bun on a cold checkout. The read-only `reviewer` and `researcher` agents in `.codex/agents/` are discovered automatically. Codex rejects an unknown key rather than ignoring it, so the installed binary is the schema for the build in front of you: `pnpm agent:doctor --local` asks it whether this repository's configuration loads instead of keeping a copy of the schema here. The published reference does not list every accepted key, so check behavior before removing one as obsolete.
- **Launch.** Start Codex from the repository root: the `akg` entry uses repo-relative paths and sets no `cwd`. Project servers are added to the user-level set rather than replacing it, so `codex mcp list` shows more than this repository declares.
- **Rules.** `.codex/rules/dicee.rules` allows read-only inspection — `supabase --version`, `status`, `start`, `migration list --linked`, project and function inventory, `op whoami`. Anything that writes to a linked project or reaches a live credential is `prompt`: `db push`, `db pull`, `db dump`, `db reset`, `migration repair/up/apply`, `link`, `login`, `secrets`, `functions deploy/delete`, `gen types`, `pnpm db:types`, `op read`/`op item`, credential wrappers, deploys, live logs, Wrangler account commands, `git push`, and workflow/release commands. The listed `git reset --hard`, `git clean`, and force-push prefixes are `forbidden`. These are prefix rules matched by token position, so a global flag placed before a subcommand escapes them; never change command form to evade a stop.
- **Permission and authority.** An `allow` decision removes a rule-level prompt; it does not expand the user's task authorization, bypass operator stop points in `docs/roadmap.md` section 1, or make live Supabase type generation part of ordinary validation. Resolve secrets only when the authorized operation needs them. Other active policy layers and the session's approval mode still apply. If execution is rejected, report the exact barrier; do not change command form or access policy to evade it.
- **Checking a command.** `codex execpolicy check --rules .codex/rules/dicee.rules -- git push -f origin main` evaluates the supplied file without executing the example. It prints JSON with `matchedRules` and a top-level `decision`; the most restrictive match wins (`forbidden` > `prompt` > `allow`). An unmatched command prints empty `matchedRules` and no `decision`. This file-only check does not prove what the running session permits. `bash scripts/tests/codex-rules.test.sh` validates literal declarations and requires explicit decisions, justifications, and nonempty `match` examples; `not_match` is optional. It also checks decisions where `codex` is installed (CI has none). See the [official OpenAI rules documentation](https://learn.chatgpt.com/docs/agent-configuration/rules).
- **Filtered workspace commands.** The workspace package set is fixed. The rules enumerate its names for `pnpm --filter <pkg> exec ...` and directory forms, with separate decisions for Wrangler and Supabase.
- **Known friction.** `supabase db reset --local` prompts, because a prefix rule cannot tell `--local` from `--linked` at that position and a destructive reset defaults to the safer decision. The local pgTAP loop takes one approval.

## Gemini

`.gemini/settings.json` sets `context.fileName` to `["AGENTS.md"]`. Gemini has no project MCP configuration, and whether Gemini CLI reads `.mcp.json` has not been verified.

## Copilot

- Copilot CLI, the coding agent, GitHub.com code review and VS Code chat read `AGENTS.md`.
- `.github/copilot-instructions.md` survives for the surfaces that do not: Copilot code review in VS Code and in Visual Studio, and Visual Studio chat. Dicee keeps it to a few lines pointing back at the contract.
- Do not restate the contract there and do not add path-scoped Copilot instruction files. VS Code combines every always-on instruction source it finds and guarantees no order between them, so a second copy is a conflict risk, not redundancy.
- Settings-based code and test generation instructions are deprecated in favour of file-based instructions; do not reintroduce them in `.vscode/settings.json`.
- **Project MCP.** Copilot CLI walks from the working directory up to the repository root loading `.mcp.json`, in interactive mode only after folder trust (prompt mode has a documented environment-variable override); project definitions beat the user-level file at `~/.copilot/mcp-config.json`. The system-config project contract lists that filename as a Copilot CLI *project* file; current GitHub documentation places it in the home directory, so `.mcp.json` is the correct project file and Dicee commits no Copilot-specific MCP file.
- Not verified: which Copilot surfaces honour nested `AGENTS.md`. GitHub documents nesting generically, and VS Code gates it behind an experimental setting, so the package-file instruction above stands either way.

## Models

Guidance only. Model, reasoning effort, auth, approval mode, and sandbox are personal user policy and never belong in Dicee's tracked configuration: `.claude/settings.json` carries no `model` key and `.codex/config.toml` says so explicitly. Prefer an alias over a dated model id so this section does not rot, and do not target a model approaching retirement.

| Work | Claude Code | Codex |
|---|---|---|
| Ordinary implementation | `sonnet` (currently Sonnet 5) | `gpt-5.6-sol`, or the client's current default; do not repo-pin one |
| Deep architecture, adversarial review | `opus` (currently Opus 5) | `gpt-6-astra`, normally high effort |

- Raise Codex effort past high (`xhigh`) only when the task justifies the cost. It is not a default, and Astra at lower effort often beats the previous model at high.
- Reproducible evaluations, headless runs, and `codex exec` record client version, model, reasoning effort, commit, and config provenance in the evidence. Unpinned automation has been observed changing behavior as vendor defaults move, so "we ran Codex" without those five facts is not evidence.
- Alias mappings are the vendor's, not ours: see the [Claude Code model aliases](https://code.claude.com/docs/en/model-config) table and the Codex [config reference](https://learn.chatgpt.com/docs/config-file/config-reference) for the effort values the installed client accepts.

## Prohibited patterns

- No bearer tokens, API tokens, personal access tokens, or secret references in any MCP `url`, `headers`, `args`, or `env`.
- No stdio bridge that takes an authorization header as an argument: argv shows up in process listings and client logs.
- No repository script that resolves an MCP credential or edits user-global client config, and no template merges into user-global config.
- No secret exports in `.envrc`, `.envrc.local.nonsecret`, or shell startup files. Operator commands that need a Cloudflare token use `./scripts/with-dicee-cloudflare.sh -- <command>`, which passes the token to one child process through the environment.

## Verification

Static checks, safe anywhere:

```bash
pnpm lint:docs
pnpm agent:doctor
python3 -m json.tool .mcp.json >/dev/null
python3 -m json.tool .cursor/mcp.json >/dev/null
jq -e '[.mcpServers[] | select(has("url"))] | all(.type=="http")' .mcp.json
pnpm akg:test
bash scripts/tests/codex-rules.test.sh
```

Operator checks in interactive sessions after a client-surface change:

- Claude Code: `/context` and `/skills` show `CLAUDE.md`, `AGENTS.md` and the two skills; `claude mcp list` shows `akg` and `cloudflare-docs` enabled.
- Codex: trust the project, then `codex mcp list` from the repository root includes `akg` and `cloudflare-docs`, and `codex doctor` reports `config.toml parse ok`. A non-zero exit from either means the project configuration was refused, which `pnpm agent:doctor --local` also reports.
- VS Code: trust the workspace, then the chat context shows `AGENTS.md` and the two MCP servers start.
- Gemini CLI: `/memory show` includes `AGENTS.md`.
- Cursor: the skills list shows `dicee-verify` and `akg-boundaries` (twice).

If a remote server needs authentication, complete its OAuth flow. Never work around it with a token.
