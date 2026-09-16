#!/usr/bin/env bash
# Exercise every scripts/agent-doctor.mjs rule against disposable fixture checkouts.
# Each case builds a fresh Git repository from synthetic files and runs the real gate with
# --root, so the working tree of this repository is never inspected and no assertion
# depends on what happens to be installed or configured on this machine.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$PROJECT_ROOT/scripts/agent-doctor.mjs"

# scripts/check-docs.mjs reads every tracked shell script for `.claude/...` references that
# must resolve. The personal settings file this gate inspects is ignored by design and
# never resolves, so its directory is named once and every fixture path is built from it.
CLAUDE_DIR='.claude'

# Git hooks export repository-local variables that override `git -C`.
# Follow githooks(5)'s foreign-repository guidance before creating the fixtures.
git_local_env_vars="$(git rev-parse --local-env-vars)"
while IFS= read -r name; do
	unset "$name"
done <<<"$git_local_env_vars"
export GIT_CONFIG_NOSYSTEM=1

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-agent-doctor-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
gate_output="$work_dir/gate-output"
# A fixture-owned global Git configuration, so the IDENTITY rule sees a known world
# instead of the developer's own identity routing.
global_config="$work_dir/gitconfig-global"
identity_include="$work_dir/gitconfig-included"
export GIT_CONFIG_GLOBAL="$global_config"
printf '[user]\n\temail = fixture@example.com\n' >"$identity_include"

repo=""
case_count=0
failures=0

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	failures=$((failures + 1))
}

# put <path>: write stdin to a fixture file, creating parent directories.
put() {
	mkdir -p "$(dirname "$repo/$1")"
	cat >"$repo/$1"
}

# patch_json <path> <js>: run <js> against the parsed document `j`, then rewrite it.
# Reads through the repository's own JSONC reader so a fixture that carries comments can
# still be patched; the rewrite is plain JSON, which every client file format accepts.
patch_json() {
	node --input-type=module -e '
		import { readFileSync, writeFileSync } from "node:fs";
		import { pathToFileURL } from "node:url";
		const [file, body, reader] = process.argv.slice(1);
		const { stripJsonc } = await import(pathToFileURL(reader).href);
		const j = JSON.parse(stripJsonc(readFileSync(file, "utf8")));
		new Function("j", body)(j);
		writeFileSync(file, `${JSON.stringify(j, null, "\t")}\n`);
	' "$repo/$1" "$2" "$PROJECT_ROOT/scripts/cloudflare-config-audit.mjs"
}

# new_repo: a fixture that passes every committed check.
new_repo() {
	case_count=$((case_count + 1))
	repo="$work_dir/case-$case_count"
	git -c init.defaultBranch=main init --quiet "$repo"
	printf '[user]\n\temail = fixture@example.com\n' >"$global_config"

	put AGENTS.md <<'EOF'
# Agents

The repository contract.
EOF
	put scripts/check-docs.config.json <<'EOF'
{
	"budgets": { "AGENTS.md": { "maxLines": 10 } }
}
EOF
	put "$CLAUDE_DIR/settings.json" <<'EOF'
{
	"permissions": {
		"allow": ["Bash(pnpm lint*)"],
		"deny": ["mcp__supabase__execute_sql", "mcp__supabase__apply_migration"]
	},
	"enabledMcpjsonServers": ["akg", "cloudflare-docs"]
}
EOF
	put .mcp.json <<'EOF'
{
	"mcpServers": {
		"akg": {
			"command": "mise",
			"args": ["exec", "--", "bun", "run", "packages/web/src/tools/akg/mcp/server.ts"],
			"env": { "AKG_PROJECT_ROOT": "." }
		},
		"cloudflare-docs": { "type": "http", "url": "https://docs.example.com/mcp" },
		"cloudflare-api": { "type": "http", "url": "https://api.example.com/mcp" },
		"supabase": {
			"type": "http",
			"url": "https://db.example.com/mcp?project_ref=${FIXTURE_REF}&read_only=true"
		}
	}
}
EOF
	put .cursor/mcp.json <<'EOF'
{
	// Cursor accepts comments in this file.
	"mcpServers": {
		"akg": {
			"type": "stdio",
			"command": "mise",
			"args": ["exec", "--", "bun", "run", "packages/web/src/tools/akg/mcp/server.ts"]
		},
		"cloudflare-docs": { "url": "https://docs.example.com/mcp" }
	}
}
EOF
	put .vscode/mcp.json <<'EOF'
{
	"servers": {
		"akg": {
			"type": "stdio",
			"command": "mise",
			"args": ["exec", "--", "bun", "run", "packages/web/src/tools/akg/mcp/server.ts"]
		},
		"cloudflare-docs": { "type": "http", "url": "https://docs.example.com/mcp" }
	}
}
EOF
	put .codex/config.toml <<'EOF'
# Repository-scoped Codex configuration.
[agents]
max_depth = 1

[mcp_servers.akg]
command = "mise"
args = ["exec", "--", "bun", "run", "packages/web/src/tools/akg/mcp/server.ts"]
env = { AKG_PROJECT_ROOT = "." }

[mcp_servers.cloudflare-docs]
url = "https://docs.example.com/mcp"
EOF
	put packages/web/src/tools/akg/mcp/server.ts <<'EOF'
server.registerTool('akg_check_import', {});
server.registerTool('akg_layer_rules', {});
EOF
}

commit_fixture() {
	git -C "$repo" add -A
	git -C "$repo" -c user.name=t -c user.email=t@example.com commit --quiet --allow-empty -m fixture
}

run_gate() {
	commit_fixture
	gate_status=0
	node "$GATE" --root "$repo" "$@" >"$gate_output" 2>&1 || gate_status=$?
}

show_output() {
	printf 'Gate output:\n' >&2
	sed 's/^/  /' "$gate_output" >&2
}

# finding_re <RULE>: a finding line for that rule, whatever path it is anchored to.
finding_re() {
	printf '^.+:[0-9]+: %s ' "$1"
}

# expect_pass <label> [gate args]
expect_pass() {
	local label="$1"
	shift
	run_gate "$@"
	if [[ "$gate_status" -eq 0 ]]; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label (gate exited $gate_status, expected 0)"
		show_output
	fi
}

# expect_error <label> <RULE> [gate args]: exit 1 with a hard finding for RULE.
expect_error() {
	local label="$1" rule="$2"
	shift 2
	run_gate "$@"
	if [[ "$gate_status" -eq 1 ]] && grep -Eq "$(finding_re "$rule")" "$gate_output" &&
		! grep -Eq "$(finding_re "$rule").*\[(warn|info)\]$" "$gate_output"; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label (gate exited $gate_status, expected 1 with a hard $rule finding)"
		show_output
	fi
}

# expect_warn <label> <RULE> [gate args]: a warning for RULE, and exit 0 without --strict.
expect_warn() {
	local label="$1" rule="$2"
	shift 2
	run_gate "$@"
	if [[ "$gate_status" -eq 0 ]] && grep -Eq "$(finding_re "$rule").*\[warn\]$" "$gate_output"; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label (gate exited $gate_status, expected 0 with a $rule warning)"
		show_output
	fi
}

# expect_silent <label> <RULE> [gate args]: exit 0 and not a single finding for RULE.
expect_silent() {
	local label="$1" rule="$2"
	shift 2
	run_gate "$@"
	if [[ "$gate_status" -eq 0 ]] && ! grep -Eq "$(finding_re "$rule")" "$gate_output"; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label (gate exited $gate_status, expected 0 and no $rule finding)"
		show_output
	fi
}

# expect_status <label> <code> [gate args]
expect_status() {
	local label="$1" code="$2"
	shift 2
	run_gate "$@"
	if [[ "$gate_status" -eq "$code" ]]; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label (gate exited $gate_status, expected $code)"
		show_output
	fi
}

# ── baseline ─────────────────────────────────────────────────────────────────
new_repo
expect_pass 'baseline fixture passes every committed check'

new_repo
expect_pass 'baseline fixture raises no committed warning under --strict' --strict

new_repo
expect_pass 'baseline fixture passes with the local checks included' --local

# ── CONTRACT ─────────────────────────────────────────────────────────────────
new_repo
for _ in 1 2 3 4 5 6 7 8 9 10; do printf 'line\n' >>"$repo/AGENTS.md"; done
expect_error 'CONTRACT: an over-budget contract fails' CONTRACT --only CONTRACT

new_repo
rm "$repo/AGENTS.md"
expect_error 'CONTRACT: a missing contract fails' CONTRACT --only CONTRACT

# ── PARSE ────────────────────────────────────────────────────────────────────
new_repo
printf '{ "mcpServers": \n' | put .mcp.json
expect_error 'PARSE: malformed JSON fails' PARSE --only PARSE

new_repo
printf '[mcp_servers.akg]\nthis line is not TOML\n' | put .codex/config.toml
expect_error 'PARSE: a TOML line that is neither a heading nor a pair fails' PARSE --only PARSE

new_repo
printf '[mcp_servers.akg]\nurl = "https://example.com\n' | put .codex/config.toml
expect_error 'PARSE: an unterminated TOML string fails' PARSE --only PARSE

new_repo
expect_silent 'PARSE: comments in the Cursor and VS Code files are accepted' PARSE --only PARSE

# ── DENY ─────────────────────────────────────────────────────────────────────
new_repo
patch_json "$CLAUDE_DIR/settings.json" 'j.permissions.deny = ["mcp__supabase__execute_sql"];'
expect_error 'DENY: a missing Supabase mutation deny fails' DENY --only DENY

new_repo
patch_json "$CLAUDE_DIR/settings.json" 'delete j.permissions.deny;'
expect_error 'DENY: no deny list at all fails' DENY --only DENY

# ── POLICY ───────────────────────────────────────────────────────────────────
new_repo
patch_json "$CLAUDE_DIR/settings.json" 'j.model = "default";'
expect_error 'POLICY: a committed model key fails' POLICY --only POLICY

new_repo
patch_json "$CLAUDE_DIR/settings.json" 'j.maxEffortLevel = "high";'
expect_error 'POLICY: a committed effort key fails' POLICY --only POLICY

# ── MODEL ────────────────────────────────────────────────────────────────────
new_repo
printf '{ "chat.defaultModel": "gpt-4o" }\n' | put .vscode/settings.json
expect_error 'MODEL: a pinned model id in an editor config fails' MODEL --only MODEL

new_repo
patch_json .mcp.json 'j.mcpServers.akg.env.PREFERRED = "claude-sonnet-4-5";'
expect_error 'MODEL: a near-retirement model id fails' MODEL --only MODEL

new_repo
printf '{ "editor.formatOnSave": true, "files.eol": "\\n" }\n' | put .vscode/settings.json
expect_silent 'MODEL: ordinary editor settings are not model ids' MODEL --only MODEL

# ── LAUNCHER ─────────────────────────────────────────────────────────────────
new_repo
patch_json .cursor/mcp.json 'j.mcpServers.akg.command = "bun";'
expect_error 'LAUNCHER: an unpinned command in the Cursor file fails' LAUNCHER --only LAUNCHER

new_repo
patch_json .vscode/mcp.json 'j.servers.akg.args = ["run", "server.ts"];'
expect_error 'LAUNCHER: args that skip the pinned toolchain fail' LAUNCHER --only LAUNCHER

new_repo
put .codex/config.toml <<'EOF'
[mcp_servers.akg]
command = "bun"
args = ["run", "packages/web/src/tools/akg/mcp/server.ts"]

[mcp_servers.cloudflare-docs]
url = "https://docs.example.com/mcp"
EOF
expect_error 'LAUNCHER: drift in the Codex file fails' LAUNCHER --only LAUNCHER

# ── SERVERS ──────────────────────────────────────────────────────────────────
new_repo
patch_json .cursor/mcp.json 'j.mcpServers.supabase = { url: "https://db.example.com/mcp" };'
expect_error 'SERVERS: an opt-in server in a client file fails' SERVERS --only SERVERS

new_repo
patch_json .mcp.json 'delete j.mcpServers["cloudflare-api"];'
expect_error 'SERVERS: a missing project server fails' SERVERS --only SERVERS

new_repo
printf '[agents]\nmax_depth = 1\n' | put .codex/config.toml
expect_error 'SERVERS: a Codex file that declares no server fails' SERVERS --only SERVERS

# ── SECRET ───────────────────────────────────────────────────────────────────
new_repo
patch_json .cursor/mcp.json 'j.mcpServers["cloudflare-docs"].headers = { Accept: "application/json" };'
expect_error 'SECRET: a headers key fails' SECRET --only SECRET

new_repo
patch_json .mcp.json 'j.mcpServers.akg.env.AUTH = "Bearer fixture-value";'
expect_error 'SECRET: a bearer literal in an env value fails' SECRET --only SECRET

new_repo
patch_json .mcp.json 'j.mcpServers["cloudflare-docs"].url = "https://docs.example.com/mcp?secret=fixture";'
expect_error 'SECRET: a credential query parameter fails' SECRET --only SECRET

new_repo
put .codex/config.toml <<'EOF'
[mcp_servers.akg]
command = "mise"
args = ["exec", "--", "bun", "run", "packages/web/src/tools/akg/mcp/server.ts"]

[mcp_servers.cloudflare-docs]
url = "https://docs.example.com/mcp"
headers = { Authorization = "redacted" }
EOF
expect_error 'SECRET: a headers table in the Codex file fails' SECRET --only SECRET

new_repo
expect_silent 'SECRET: a ${VAR} placeholder in a URL is not a literal' SECRET --only SECRET

# ── RETIRED ──────────────────────────────────────────────────────────────────
new_repo
printf '# retired\n' | put .cursorrules
expect_error 'RETIRED: a tracked retired rules file fails' RETIRED --only RETIRED

new_repo
printf '# retired\n' | put .github/instructions/rule.md
expect_error 'RETIRED: a tracked retired instructions directory fails' RETIRED --only RETIRED

# ── local checks: skipped when the state is absent ───────────────────────────
new_repo
run_gate --local --report
if grep -Eq "$(finding_re PERSONAL).*skipped" "$gate_output"; then
	printf 'ok: PERSONAL: an absent personal settings file is a skipped note, not a failure\n'
else
	fail 'PERSONAL: an absent personal settings file did not report as skipped'
	show_output
fi

new_repo
run_gate --local --report
if grep -Eq "$(finding_re CLIENT)" "$gate_output" &&
	! grep -Eq "$(finding_re CLIENT).*\[(warn)\]$" "$gate_output"; then
	printf 'ok: CLIENT: installed builds are reported as notes, never as failures\n'
else
	fail 'CLIENT: did not report every client as a note'
	show_output
fi

new_repo
expect_silent 'STRAY: a clean working tree raises nothing' STRAY --local --only STRAY

# ── local checks: fire when the state is present ─────────────────────────────
new_repo
printf '%s\n' "$CLAUDE_DIR/settings.local.json" | put .gitignore
put "$CLAUDE_DIR/settings.local.json" <<'EOF'
{
	"enableAllProjectMcpServers": true,
	"enabledMcpjsonServers": ["akg", "supabase"],
	"permissions": {
		"allow": [
			"mcp__supabase__list_tables",
			"mcp__supabase__execute_sql",
			"mcp__akg__akg_check_import",
			"mcp__akg__akg_invariants",
			"Bash(/opt/example/bin/tool:*)",
			"Bash(VAR=stable /opt/example/bin/other build:*)",
			"Bash(pnpm lint*)"
		]
	}
}
EOF
expect_warn 'PERSONAL: a personal settings file with drift warns' PERSONAL --local --only PERSONAL
for expected in \
	'enableAllProjectMcpServers turns on every server' \
	'enables MCP server "supabase"' \
	'pre-approves "mcp__supabase__execute_sql"' \
	'names "mcp__akg__akg_invariants", which the AKG server does not expose' \
	'Bash(/opt/example/bin/tool:*)" names the machine-specific absolute path' \
	'Bash(VAR=stable /opt/example/bin/other build:*)" names the machine-specific absolute path'; do
	if grep -qF "$expected" "$gate_output"; then
		printf 'ok: PERSONAL: reports %s\n' "$expected"
	else
		fail "PERSONAL: did not report: $expected"
		show_output
	fi
done
for allowed in 'mcp__supabase__list_tables' 'Bash(pnpm lint*)' 'mcp__akg__akg_check_import'; do
	if grep -qF "$allowed" "$gate_output"; then
		fail "PERSONAL: flagged a legitimate rule: $allowed"
		show_output
	else
		printf 'ok: PERSONAL: %s is not flagged\n' "$allowed"
	fi
done

# The same fixture, run the way `pnpm lint` runs it: local state is invisible.
expect_silent 'PERSONAL: the CI-default invocation ignores the personal settings file' PERSONAL
expect_status 'PERSONAL: local warnings are fatal only under --local --strict' 1 --local --strict
expect_status 'PERSONAL: the CI default stays green under --strict' 0 --strict

new_repo
printf '.cursorrules\n' | put .gitignore
printf '# retired\n' | put .cursorrules
expect_warn 'STRAY: an ignored retired surface in the working tree warns' STRAY --local --only STRAY
expect_silent 'STRAY: the CI-default invocation ignores the working tree' STRAY

# ── IDENTITY ─────────────────────────────────────────────────────────────────
new_repo
expect_warn 'IDENTITY: no conditional include covering the repository warns' IDENTITY \
	--local --only IDENTITY
if grep -qF 'fixture@example.com' "$gate_output"; then
	fail 'IDENTITY: printed the configured email address'
	show_output
else
	printf 'ok: IDENTITY: the configured address is never printed\n'
fi

new_repo
printf '[includeIf "gitdir:%s/"]\n\tpath = %s\n' "$repo" "$identity_include" >>"$global_config"
run_gate --local --only IDENTITY
if [[ "$gate_status" -eq 0 ]] && grep -Eq "$(finding_re IDENTITY).*\[info\]$" "$gate_output"; then
	printf 'ok: IDENTITY: a matching conditional include reports as a note\n'
else
	fail "IDENTITY: a matching conditional include did not report as a note (exit $gate_status)"
	show_output
fi

# ── modes and usage errors ───────────────────────────────────────────────────
new_repo
printf '# retired\n' | put .cursorrules
run_gate --report
if [[ "$gate_status" -eq 0 ]] && grep -Eq "$(finding_re RETIRED)" "$gate_output"; then
	printf 'ok: --report prints findings and exits 0\n'
else
	fail "--report did not print the finding with exit 0 (gate exited $gate_status)"
	show_output
fi

new_repo
run_gate --json
if node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8").split("\n").filter((l) => !l.startsWith("agent-doctor:")).join("\n"))' "$gate_output"; then
	printf 'ok: --json emits a parseable document\n'
else
	fail '--json did not emit a parseable document'
	show_output
fi

new_repo
expect_status 'usage: an unknown rule exits 2' 2 --only NOPE

new_repo
expect_status 'usage: an unknown argument exits 2' 2 --nope

expect_status 'usage: a --root that is not a directory exits 2' 2 --root "$work_dir/absent"

if ! node "$GATE" --self-test >"$gate_output" 2>&1; then
	fail 'the gate self-test failed'
	show_output
else
	printf 'ok: the gate self-test passes\n'
fi

# The default root resolves from the script's own location; --report keeps this a smoke
# test of that resolution rather than an assertion about the repository's current state.
if node "$GATE" --report --only PARSE >"$gate_output" 2>&1; then
	printf 'ok: the default root resolves to this repository\n'
else
	fail 'the gate could not resolve its default root'
	show_output
fi

if [[ "$failures" -ne 0 ]]; then
	printf '%d agent-doctor assertion(s) failed.\n' "$failures" >&2
	exit 1
fi

printf 'agent-doctor tests passed (%d fixtures).\n' "$case_count"
