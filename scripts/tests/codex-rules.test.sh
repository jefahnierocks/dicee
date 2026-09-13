#!/usr/bin/env bash
# Validate the Codex command policy in .codex/rules/dicee.rules.
# Static checks always run. Decision checks run only when the codex CLI is installed
# (CI has no codex); they parse the top-level "decision" of `codex execpolicy check`.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RULES="${CODEX_RULES_FILE:-$PROJECT_ROOT/.codex/rules/dicee.rules}"
failures=0

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	failures=$((failures + 1))
}

finish() {
	if [[ "$failures" -ne 0 ]]; then
		printf '%d Codex rules assertion(s) failed.\n' "$failures" >&2
		exit 1
	fi
	printf 'Codex rules tests passed.\n'
	exit 0
}

if [[ ! -f "$RULES" ]]; then
	fail "missing rules file: $RULES"
	finish
fi

# Static: every prefix_rule block has decision, justification, match and not_match.
rest="$(<"$RULES")"
rules=0
while [[ "$rest" == *'prefix_rule('* ]]; do
	rest="${rest#*prefix_rule(}"
	block="${rest%%prefix_rule(*}"
	rules=$((rules + 1))
	for field in decision justification match not_match; do
		field_re="(^|[^_[:alnum:]])${field}[[:space:]]*="
		[[ "$block" =~ $field_re ]] || fail "rule $rules has no $field"
	done
done
[[ "$rules" -gt 0 ]] || fail 'no prefix_rule entries found'
if grep -nE 'decision[[:space:]]*=[[:space:]]*"allow"' "$RULES" >&2; then
	fail 'rules file must not auto-approve commands (decision="allow")'
fi
grep -qE 'decision[[:space:]]*=[[:space:]]*"forbidden"' "$RULES" || fail 'no forbidden rule'
grep -qE 'decision[[:space:]]*=[[:space:]]*"prompt"' "$RULES" || fail 'no prompt rule'
printf 'ok: static checks (%d rules)\n' "$rules"

if ! command -v codex >/dev/null 2>&1; then
	printf 'SKIP: codex not installed; decision checks not run.\n'
	finish
fi

decision_re='"decision":[[:space:]]*"([a-z]+)"[[:space:]]*}[[:space:]]*$'

expect() {
	local expected="$1"
	shift
	local output status=0 actual=none
	output="$(codex execpolicy check --rules "$RULES" -- "$@" 2>/dev/null)" || status=$?
	if [[ "$status" -ne 0 ]]; then
		fail "codex execpolicy check exited $status for: $*"
		return
	fi
	if [[ "$output" =~ $decision_re ]]; then
		actual="${BASH_REMATCH[1]}"
	fi
	if [[ "$actual" == "$expected" ]]; then
		printf 'ok: %s -> %s\n' "$*" "$actual"
	else
		fail "$* -> $actual (expected $expected)"
	fi
}

expect forbidden git reset --hard
expect forbidden git push --force origin main
expect forbidden git clean -fdx
expect prompt pnpm do:deploy
expect prompt pnpm run deploy
expect prompt pnpm run do:deploy
expect prompt pnpm run do:tail
expect prompt pnpm run pages:deploy
expect prompt pnpm run pages:deploy:preview
expect prompt pnpm run db:types
expect prompt pnpm --dir packages/cloudflare-do deploy
expect prompt pnpm --dir packages/cloudflare-do tail
expect prompt pnpm --dir packages/web pages:deploy
expect prompt pnpm --dir packages/web pages:deploy:preview
expect prompt pnpm --filter @dicee/cloudflare-do deploy
expect prompt pnpm --filter @dicee/cloudflare-do tail
expect prompt pnpm --filter @dicee/web pages:deploy
expect prompt pnpm --filter @dicee/web pages:deploy:preview
expect prompt wrangler secret put X
expect prompt supabase db push
expect prompt pnpm exec wrangler deploy
expect prompt git push origin main
expect prompt pnpm --filter @dicee/cloudflare-do exec wrangler deploy
expect prompt pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run
expect prompt pnpm -F @dicee/web exec wrangler pages deploy
expect prompt pnpm --filter @dicee/shared exec supabase db push
expect prompt pnpm -F @dicee/simulation exec supabase gen types typescript
expect prompt pnpm --dir packages/cloudflare-do exec wrangler deploy
expect prompt pnpm -C packages/web exec wrangler secret put X
expect prompt pnpm --dir packages/web exec supabase db push
expect prompt pnpm -C packages/analysis exec supabase migration up
expect prompt scripts/with-dicee-cloudflare.sh -- wrangler deploy
expect prompt scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen
expect prompt scripts/with-dicee-infisical-auth.sh dev -- true
expect prompt ./scripts/with-dicee-cloudflare.sh -- wrangler deploy
expect prompt bash scripts/with-dicee-cloudflare.sh -- wrangler deploy
expect prompt bash ./scripts/with-dicee-cloudflare.sh -- wrangler deploy
expect prompt bash scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen
expect prompt bash ./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen
expect prompt bash scripts/with-dicee-infisical-auth.sh dev -- true
expect prompt bash ./scripts/with-dicee-infisical-auth.sh dev -- true
expect none pnpm lint
expect none git status
expect none pnpm test:agent
expect none pnpm run lint
expect none pnpm --dir packages/web build
expect none pnpm --filter @dicee/cloudflare-do test:agent
expect none pnpm --filter @dicee/cloudflare-do exec vitest run
expect none pnpm --dir packages/web exec biome check
expect none bash scripts/public-safety-scan.sh
expect none scripts/public-safety-scan.sh

finish
