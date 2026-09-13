#!/usr/bin/env bash
# Exercise every scripts/check-docs.mjs rule against disposable fixture repositories.
# Each case builds a fresh Git repository from synthetic files; the real working tree
# is never scanned, so this test passes whether or not the gate is wired into lint.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATE="$PROJECT_ROOT/scripts/check-docs.mjs"

# Git hooks export repository-local variables that override `git -C`.
# Follow githooks(5)'s foreign-repository guidance before creating the fixtures.
git_local_env_vars="$(git rev-parse --local-env-vars)"
while IFS= read -r name; do
	unset "$name"
done <<<"$git_local_env_vars"
# Keep user and system Git configuration (hooks, excludes, signing) out of the fixtures.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dicee-check-docs-test.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
gate_output="$work_dir/gate-output"
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

# patch_json <path> <js>: run <js> against the parsed JSON document `j`, then rewrite it.
patch_json() {
	node --input-type=module -e '
		import { readFileSync, writeFileSync } from "node:fs";
		const [file, body] = process.argv.slice(1);
		const j = JSON.parse(readFileSync(file, "utf8"));
		new Function("j", body)(j);
		writeFileSync(file, `${JSON.stringify(j, null, "\t")}\n`);
	' "$repo/$1" "$2"
}

# new_repo: a fixture that passes every rule.
new_repo() {
	case_count=$((case_count + 1))
	repo="$work_dir/case-$case_count"
	git -c init.defaultBranch=main init --quiet "$repo"
	mkdir -p "$repo/scripts"
	cp "$GATE" "$repo/scripts/check-docs.mjs"
	put scripts/check-docs.config.json <<'EOF'
{
	"generated": ["gen/**"],
	"pathScope": ["AGENTS.md", "docs/**"],
	"pathAllow": [],
	"rootAllowlist": [".gitignore", "AGENTS.md", "project.yaml"],
	"docsAllowlist": ["guide.md", "status.md"],
	"budgets": { "AGENTS.md": { "maxLines": 10 }, "docs/status.md": { "maxLines": 40 } },
	"globBudgets": [{ "glob": ".agents/skills/*/SKILL.md", "maxLinesEach": 10 }],
	"homeOnlyPatterns": ["\\*\\*Current phase:\\*\\*", "\\*\\*As of:\\*\\*", "^Last (updated|reviewed):", "Active wave", "\\bWave [0-9]\\b"],
	"retired": [{ "id": "windsurf", "re": "\\.windsurf\\b|\\bWindsurf\\b", "allow": [".gitignore"] }],
	"broadAllow": ["Bash", "Bash(*)", "Bash(pnpm --filter:*)"],
	"enabledMcp": ["akg"]
}
EOF
	printf '.windsurf/\n' | put .gitignore
	put AGENTS.md <<'EOF'
# Agents

Status lives in [the status file](docs/status.md); read `docs/guide.md` first.
EOF
	put project.yaml <<'EOF'
status:
  local_phase: "fixture phase"
  as_of: "2026-01-02"
authority:
  status_of_record: docs/status.md
EOF
	put docs/status.md <<'EOF'
# Status

- **As of:** 2026-01-02
- **Current phase:** fixture phase

## Decisions

1. First.
2. Second.
3. Third.

## Actions
EOF
	put docs/guide.md <<'EOF'
# Guide

## Setup

Back to [agents](../AGENTS.md#agents).
EOF
	put src/app.ts <<'EOF'
// @see docs/guide.md#setup
export const guide = 'AGENTS.md';
EOF
	put .claude/settings.json <<'EOF'
{
	"permissions": { "allow": ["Bash(git status *)"] },
	"enabledMcpjsonServers": ["akg"]
}
EOF
	put .agents/skills/demo/SKILL.md <<'EOF'
---
name: demo
description: Demonstrate a portable skill.
---

# Demo
EOF
	mkdir -p "$repo/.claude/skills"
	ln -s ../../.agents/skills/demo "$repo/.claude/skills/demo"
}

commit_fixture() {
	git -C "$repo" add -A
	git -C "$repo" -c user.name=t -c user.email=t@example.com commit --quiet --allow-empty -m fixture
}

run_gate() {
	commit_fixture
	gate_status=0
	(cd "$repo" && node scripts/check-docs.mjs "$@") >"$gate_output" 2>&1 || gate_status=$?
}

show_output() {
	printf 'Gate output:\n' >&2
	sed 's/^/  /' "$gate_output" >&2
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

# expect_fail <label> <RULE> [gate args]: exit 1 with at least one finding for RULE.
expect_fail() {
	local label="$1" rule="$2"
	shift 2
	run_gate "$@"
	if [[ "$gate_status" -eq 1 ]] && grep -Eq "^[^ ]+:[0-9]+: $rule " "$gate_output"; then
		printf 'ok: %s\n' "$label"
	else
		fail "$label (gate exited $gate_status, expected 1 with a $rule finding)"
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
expect_pass 'baseline fixture passes every rule'

# ── LINK ─────────────────────────────────────────────────────────────────────
new_repo
printf '\nSee [missing](missing.md).\n' >>"$repo/docs/guide.md"
expect_fail 'LINK: broken link outside a fence fails' LINK --only LINK

new_repo
printf '\n[missing]: ../nowhere.md\n' >>"$repo/docs/guide.md"
expect_fail 'LINK: broken reference definition fails' LINK --only LINK

new_repo
cat >>"$repo/docs/guide.md" <<'EOF'

```md
[backtick fence](missing.md)
```

~~~
```
[tilde fence with a longer closer](missing.md)
~~~~

1. List item:
   ```sh
   echo "[indented fence](missing.md)"
   ```

Inline `[code span](missing.md)` and ``double `tick` [span](missing.md)`` stay literal.

<!-- [comment](missing.md) -->
EOF
expect_pass 'LINK: links inside fences, code spans and comments are ignored' --only LINK

new_repo
printf '\nSee [bad anchor](status.md#nope).\n' >>"$repo/docs/guide.md"
expect_fail 'LINK: missing #anchor fails' LINK --only LINK

new_repo
printf '\n## Setup\n\nSee [second setup](#setup-1) and [decisions](status.md#decisions).\n' >>"$repo/docs/guide.md"
expect_pass 'LINK: duplicate-heading -1 anchor resolves' --only LINK

new_repo
printf '[broken](missing.md)\n' | put gen/output.md
expect_pass 'LINK: generated files are not scanned' --only LINK

new_repo
printf '\n[z](missing.md)\n' >>"$repo/docs/guide.md"
printf '# Z\n\n[a](missing.md)\n' | put docs/status-z.md
run_gate --report --only LINK
if [[ "$(head -n 1 "$gate_output")" == docs/guide.md:* ]]; then
	printf 'ok: findings are sorted by path\n'
else
	fail 'findings are not sorted by path'
	show_output
fi

# ── PATH ─────────────────────────────────────────────────────────────────────
new_repo
printf '\nRun `scripts/missing.sh` first.\n' >>"$repo/AGENTS.md"
expect_fail 'PATH: missing backticked path fails' PATH --only PATH

new_repo
printf 'export {};\n' | put packages/web/src/entry.ts
cat >>"$repo/docs/guide.md" <<'EOF'

See `scripts/check-docs.mjs:12-30`, `scripts/check-docs.mjs#L4`, `src/entry.ts` and `../AGENTS.md`.
EOF
expect_pass 'PATH: line suffixes and package-relative paths resolve' --only PATH

new_repo
printf '\nNot paths: `@scope/pkg`, `https://x/y`, `chrome://inspect`, `~/.config`, `.toml`, `docs/<name>.md`, `and/or maybe`.\n' >>"$repo/docs/guide.md"
expect_pass 'PATH: scoped packages, URIs, home paths, bare extensions and placeholders are skipped' --only PATH

new_repo
patch_json scripts/check-docs.config.json 'j.generated.push("docs/generated/**");'
printf '\nHistory snapshots land in `docs/generated/history`.\n' >>"$repo/docs/guide.md"
printf "export const historyPath = 'docs/generated/history';\n" >>"$repo/src/app.ts"
expect_pass 'PATH/SEE: generated output locations are not treated as doc references' --only PATH,SEE

new_repo
printf '\nKeep `local/notes.md` untracked.\n' >>"$repo/AGENTS.md"
patch_json scripts/check-docs.config.json 'j.pathAllow.push({ file: "AGENTS.md", token: "local/notes.md", reason: "ignored local file" });'
expect_pass 'PATH: pathAllow entry exempts a token' --only PATH

new_repo
printf '\nRead `docs/missing.md` before editing.\n' >>"$repo/AGENTS.md"
expect_fail 'PATH: missing path under a tracked top-level directory fails' PATH --only PATH

new_repo
printf 'export {};\n' | put packages/web/lib/entry.ts
printf '\nSee `docs/nowhere`, `lib/nowhere` and `missing-dir/`.\n' >>"$repo/docs/guide.md"
run_gate --report --only PATH
if [[ "$(grep -c ': PATH unresolved path ' "$gate_output")" -eq 3 ]]; then
	printf 'ok: PATH: extensionless paths under tracked or package entries and trailing-slash paths are checked\n'
else
	fail 'PATH: expected 3 findings for docs/nowhere, lib/nowhere and missing-dir/'
	show_output
fi

new_repo
printf '\nPush `origin/main`, send `application/json` and fork `owner/repo`.\n' >>"$repo/docs/guide.md"
expect_pass 'PATH: slash terms whose first segment is not a repository entry are skipped' --only PATH

# ── SEE ──────────────────────────────────────────────────────────────────────
new_repo
printf '// @see docs/missing.md\n' >>"$repo/src/app.ts"
expect_fail 'SEE: comment reference to a missing doc fails' SEE --only SEE

new_repo
printf "export const doc = 'docs/guide.md#nope';\n" >>"$repo/src/app.ts"
expect_fail 'SEE: string reference with a missing anchor fails' SEE --only SEE

new_repo
cat >>"$repo/src/app.ts" <<'EOF'
// https://developer.mozilla.org/docs/Web
export const mdn = 'https://example.org/docs/missing';
EOF
expect_pass 'SEE: URL paths are ignored' --only SEE

new_repo
printf '{\n\t// see docs/missing.md\n\t"name": "app"\n}\n' | put config/app.jsonc
expect_fail 'SEE: jsonc comment reference to a missing doc fails' SEE --only SEE

new_repo
printf '{\n\t// see docs/guide.md#setup\n\t"name": "app"\n}\n' | put config/app.jsonc
printf '{ "doc": "docs/missing-json.md" }\n' | put config/data.json
printf '# see docs/missing-generated.md\nkey: 1\n' | put gen/lock.yaml
expect_pass 'SEE: jsonc reference to an existing doc passes; json and generated files are not scanned' --only SEE

new_repo
printf '# see docs/missing-toml.md\nkey = 1\n' | put config/app.toml
printf 'name: ci # see docs/missing-yaml.md\n' | put .github/workflows/ci.yml
printf 'prefix_rule(pattern = ["pnpm"])  # docs/missing-rules.md\n' | put .codex/rules/default.rules
run_gate --report --only SEE
if [[ "$(grep -c ': SEE unresolved reference ' "$gate_output")" -eq 3 ]]; then
	printf 'ok: SEE: # comments in toml, yml and rules files are checked\n'
else
	fail 'SEE: expected 3 findings for the toml, yml and rules comments'
	show_output
fi

# ── RETIRED ──────────────────────────────────────────────────────────────────
new_repo
printf '\nCopy the old .windsurf/ rules.\n' >>"$repo/docs/guide.md"
expect_fail 'RETIRED: retired token in a Markdown file fails' RETIRED --only RETIRED

new_repo
expect_pass 'RETIRED: retired token in the allowlisted .gitignore passes' --only RETIRED

# ── ROOT ─────────────────────────────────────────────────────────────────────
new_repo
printf '# Report\n' | put REPORT.md
expect_fail 'ROOT: stray root-level report fails' ROOT --only ROOT

new_repo
printf '# Old\n' | put docs/archive/old.md
expect_fail 'ROOT: unlisted docs/ entry fails' ROOT --only ROOT

# ── BUDGET ───────────────────────────────────────────────────────────────────
new_repo
for _ in 1 2 3 4 5 6 7 8 9 10; do printf 'line\n' >>"$repo/AGENTS.md"; done
expect_fail 'BUDGET: over-limit file fails' BUDGET --only BUDGET

new_repo
patch_json scripts/check-docs.config.json 'j.budgets["docs/roadmap.md"] = { maxLines: 20 };'
expect_fail 'BUDGET: missing budgeted file fails' BUDGET --only BUDGET

new_repo
for _ in 1 2 3 4 5 6; do printf 'more\n' >>"$repo/.agents/skills/demo/SKILL.md"; done
expect_fail 'BUDGET: glob budget applies to each match' BUDGET --only BUDGET

# ── HOME ─────────────────────────────────────────────────────────────────────
new_repo
printf '# Notes status\n' | put notes/status.md
expect_fail 'HOME: second status.md fails' HOME --only HOME

new_repo
printf '\n**Current phase:** shadow status\n' >>"$repo/docs/guide.md"
expect_fail 'HOME: status marker outside docs/status.md fails' HOME --only HOME

# ── SYNC ─────────────────────────────────────────────────────────────────────
new_repo
printf 'status:\n  local_phase: "other phase"\n  as_of: "2026-01-02"\nauthority:\n  status_of_record: docs/status.md\n' | put project.yaml
expect_fail 'SYNC: phase mismatch fails' SYNC --only SYNC

new_repo
printf 'status:\n  local_phase: "fixture phase"\n  as_of: "2026-01-03"\nauthority:\n  status_of_record: docs/status.md\n' | put project.yaml
expect_fail 'SYNC: as-of mismatch fails' SYNC --only SYNC

new_repo
put docs/status.md <<'EOF'
# Status

- **As of:** 2026-01-02
- **Current phase:** fixture phase

## Decisions

1. First.
2. Second.
4. Fourth.
EOF
expect_fail 'SYNC: decision gap fails' SYNC --only SYNC

# ── SURFACE ──────────────────────────────────────────────────────────────────
new_repo
patch_json .claude/settings.json 'j.hooks = { SessionStart: [] };'
expect_fail 'SURFACE: hooks key fails' SURFACE --only SURFACE

new_repo
patch_json .claude/settings.json 'j.permissions.allow.push("Bash(*)");'
expect_fail 'SURFACE: broad allow rule fails' SURFACE --only SURFACE

# Equivalent or wider spellings of a broad prefix fail even when not listed verbatim, and a
# mid-pattern `*` fails outright because it matches across words.
for rule in 'Bash(pnpm *)' 'Bash(pnpm --filter:*)' 'Bash(pnpm --filter*)' 'Bash( *)' 'Bash' \
	'Bash(pnpm --filter * test:agent)' 'Bash(git log * --oneline)' 'Bash(git:* push)'; do
	new_repo
	patch_json scripts/check-docs.config.json 'j.broadAllow = ["Bash(pnpm --filter *)", "Bash(uv run *)"];'
	patch_json .claude/settings.json "j.permissions.allow.push(\"$rule\");"
	expect_fail "SURFACE: broad allow rule $rule fails" SURFACE --only SURFACE
done

new_repo
patch_json scripts/check-docs.config.json 'j.broadAllow = ["Bash", "Bash(*)", "Bash(pnpm --filter:*)", "Bash(pnpm --filter *)", "Bash(pnpm --filter*)", "Bash(pnpm --dir*)", "Bash(uv run:*)", "Bash(uv run *)", "Bash(pnpm exec:*)", "Bash(pnpm exec *)", "Bash(bun run:*)", "Bash(node:*)"];'
patch_json .claude/settings.json 'j.permissions.allow.push("Bash(pnpm --filter @dicee/web test:agent)", "Bash(pnpm --filter @dicee/cloudflare-do types:check)", "Bash(pnpm test*)", "Bash(pnpm check*)", "Bash(pnpm lint*)", "Bash(pnpm build*)", "Bash(pnpm validate*)", "Bash(pnpm akg*)", "Bash(pnpm cf:audit*)", "Bash(uv run --project packages/analysis --group dev pytest *)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(cargo test:*)", "Read(./docs/**)");'
expect_pass 'SURFACE: narrow allow rules pass the broad-prefix check' --only SURFACE

new_repo
patch_json .claude/settings.json 'j.permissions.ask = ["Bash(pnpm --filter * test:agent)", "Bash(*)"]; j.permissions.deny = ["Bash(git * push)", "Bash"];'
expect_pass 'SURFACE: ask and deny rules are not subject to the broad-allow check' --only SURFACE

new_repo
patch_json .claude/settings.json 'j.enabledMcpjsonServers = ["akg", "supabase"];'
expect_fail 'SURFACE: enabled MCP server drift fails' SURFACE --only SURFACE

new_repo
printf -- '---\nname: other\ndescription: Wrong name.\n---\n' | put .agents/skills/demo/SKILL.md
expect_fail 'SURFACE: skill name mismatch fails' SURFACE --only SURFACE

new_repo
rm "$repo/.claude/skills/demo"
expect_fail 'SURFACE: missing skill symlink fails' SURFACE --only SURFACE

new_repo
printf '# Notes\n' | put .claude/skills/README.md
expect_fail 'SURFACE: tracked non-skill entry in .claude/skills fails' SURFACE --only SURFACE

new_repo
mkdir -p "$repo/.git/info"
printf '.claude/skills/.DS_Store\n.claude/skills/personal/\n' >>"$repo/.git/info/exclude"
printf 'finder metadata\n' | put .claude/skills/.DS_Store
printf -- '---\nname: personal\ndescription: Local only.\n---\n' | put .claude/skills/personal/SKILL.md
expect_pass 'SURFACE: untracked local entries in .claude/skills are ignored' --only SURFACE

new_repo
printf '# Legacy\n' | put .claude/commands/legacy.md
expect_fail 'SURFACE: tracked legacy command fails' SURFACE --only SURFACE

new_repo
patch_json .claude/settings.json 'j.permissions.allow.push("Bash(*)");'
patch_json scripts/check-docs.config.json 'j.surfaceSkip = ["b"];'
run_gate --only SURFACE
if [[ "$gate_status" -eq 0 ]] && grep -q 'report-only' "$gate_output"; then
	printf 'ok: surfaceSkip reports a skipped check without failing\n'
else
	fail "surfaceSkip did not downgrade the finding (gate exited $gate_status)"
	show_output
fi

# ── modes and config errors ──────────────────────────────────────────────────
new_repo
printf '# Report\n' | put REPORT.md
run_gate --report
if [[ "$gate_status" -eq 0 ]] && grep -Eq '^REPORT\.md:1: ROOT ' "$gate_output"; then
	printf 'ok: --report prints findings and exits 0\n'
else
	fail "--report did not print the finding with exit 0 (gate exited $gate_status)"
	show_output
fi

new_repo
printf '{ not json\n' | put scripts/check-docs.config.json
expect_status 'config: malformed JSON exits 2' 2

new_repo
expect_status 'config: missing config file exits 2' 2 --config does-not-exist.json

new_repo
patch_json scripts/check-docs.config.json 'j.retired[0].re = "(";'
expect_status 'config: invalid retired regex exits 2' 2

new_repo
patch_json scripts/check-docs.config.json 'j.budgetz = {};'
expect_status 'config: unknown key exits 2' 2

new_repo
expect_status 'usage: unknown --only rule exits 2' 2 --only NOPE

if [[ "$failures" -ne 0 ]]; then
	printf '%d check-docs assertion(s) failed.\n' "$failures" >&2
	exit 1
fi

printf 'check-docs tests passed (%d fixtures).\n' "$case_count"
