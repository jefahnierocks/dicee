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

# Dicee uses literal prefix_rule declarations, a Python-compatible Starlark
# subset. Parse their syntax and values without evaluating any rule or command.
# Requiring justification and match is repository policy; not_match is optional.
if ! python3 - "$RULES" <<'PY'
import ast
import sys
from pathlib import Path

errors = []
decisions = set()

try:
    declarations = ast.parse(Path(sys.argv[1]).read_text()).body
except (OSError, SyntaxError) as error:
    print(f"FAIL: cannot parse rules file ({type(error).__name__})", file=sys.stderr)
    sys.exit(1)

if not declarations:
    errors.append("no prefix_rule entries found")

for index, declaration in enumerate(declarations, start=1):
    if not (
        isinstance(declaration, ast.Expr)
        and isinstance(declaration.value, ast.Call)
        and isinstance(declaration.value.func, ast.Name)
        and declaration.value.func.id == "prefix_rule"
        and not declaration.value.args
    ):
        errors.append(f"rule {index} must be a literal prefix_rule declaration")
        continue
    fields = {}
    for keyword in declaration.value.keywords:
        if keyword.arg not in {"pattern", "decision", "justification", "match", "not_match"}:
            errors.append(f"rule {index} has an unsupported field")
            continue
        if keyword.arg in fields:
            errors.append(f"rule {index} repeats {keyword.arg}")
        try:
            fields[keyword.arg] = ast.literal_eval(keyword.value)
        except (ValueError, TypeError):
            errors.append(f"rule {index} {keyword.arg} must be literal")

    pattern = fields.get("pattern")
    if not isinstance(pattern, list) or not pattern or not all(
        (isinstance(part, str) and part)
        or (isinstance(part, list) and part and all(isinstance(token, str) and token for token in part))
        for part in pattern
    ):
        errors.append(f"rule {index} needs a nonempty pattern of tokens or token alternatives")
    decision = fields.get("decision")
    if not isinstance(decision, str) or decision not in {"allow", "prompt", "forbidden"}:
        errors.append(f"rule {index} needs an explicit allow, prompt, or forbidden decision")
    else:
        decisions.add(decision)
    justification = fields.get("justification")
    if not isinstance(justification, str) or not justification.strip():
        errors.append(f"rule {index} needs a nonempty justification")
    for field in ("match", "not_match"):
        if field == "not_match" and field not in fields:
            continue
        examples = fields.get(field)
        if (
            not isinstance(examples, list)
            or (field == "match" and not examples)
            or not all(isinstance(example, str) and example.strip() for example in examples)
        ):
            errors.append(f"rule {index} needs valid {field} examples")

for decision in ("allow", "prompt", "forbidden"):
    if decision not in decisions:
        errors.append(f"no {decision} rule")
if errors:
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    sys.exit(1)
print(f"ok: static checks ({len(declarations)} rules)")
PY
then
	fail 'static rule validation failed'
	finish
fi

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

# These are arguments to the policy checker, never commands to execute.
expect allow supabase --version
expect allow supabase status
expect allow supabase start
expect allow supabase db query --help
expect allow supabase db dump --linked -f backup.sql
expect allow supabase db push --linked --dry-run
expect allow supabase db push --linked
expect allow supabase migration list --linked
expect allow supabase migration repair --status applied 20260913000001 --linked
expect allow supabase link --project-ref example
expect allow supabase storage cp --help
expect allow supabase projects list
expect allow supabase login
expect allow supabase secrets list
expect allow supabase functions list --project-ref example
expect allow supabase gen types typescript
expect allow pnpm db:types
expect allow pnpm run db:types
expect allow pnpm exec supabase migration list --linked
expect allow npx supabase migration list --linked
expect allow mise exec -- supabase migration list --linked
expect allow pnpm --filter @dicee/shared exec supabase db push
expect allow pnpm -F @dicee/simulation exec supabase gen types typescript
expect allow pnpm --dir packages/web exec supabase db push
expect allow pnpm -C packages/analysis exec supabase migration up
expect allow op read CREDENTIAL_REFERENCE_PLACEHOLDER
expect allow op whoami

expect forbidden git reset --hard
expect forbidden git push --force origin main
expect forbidden git push -f origin main
expect forbidden git clean -fdx
expect prompt pnpm do:deploy
expect prompt pnpm pages:deploy
expect prompt pnpm run deploy
expect prompt pnpm run do:deploy
expect prompt pnpm run do:tail
expect prompt pnpm run pages:deploy
expect prompt pnpm run pages:deploy:preview
expect prompt pnpm --dir packages/cloudflare-do deploy
expect prompt pnpm --dir packages/cloudflare-do tail
expect prompt pnpm --dir packages/web pages:deploy
expect prompt pnpm --dir packages/web pages:deploy:preview
expect prompt pnpm --filter @dicee/cloudflare-do deploy
expect prompt pnpm --filter @dicee/cloudflare-do tail
expect prompt pnpm --filter @dicee/web pages:deploy
expect prompt pnpm --filter @dicee/web pages:deploy:preview
expect prompt wrangler secret put X
expect prompt wrangler deploy
expect prompt wrangler tail
expect prompt wrangler pages deployment list
expect prompt pnpm exec wrangler deploy
expect prompt npx wrangler whoami
expect prompt git push origin main
expect prompt gh workflow run ci.yml
expect prompt gh release create v1
expect prompt op run -- pnpm build
expect prompt pnpm --filter @dicee/cloudflare-do exec wrangler deploy
expect prompt pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run
expect prompt pnpm -F @dicee/web exec wrangler pages deploy
expect prompt pnpm --dir packages/cloudflare-do exec wrangler deploy
expect prompt pnpm -C packages/web exec wrangler secret put X
expect prompt scripts/with-dicee-cloudflare.sh -- wrangler deploy
expect prompt scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen
expect prompt scripts/with-dicee-infisical-auth.sh dev -- true
expect prompt ./scripts/with-dicee-cloudflare.sh -- wrangler deploy
expect prompt ./scripts/with-dicee-cloudflare.sh -- true
expect prompt ./scripts/with-dicee-elevenlabs-local.sh -- pnpm audio:gen
expect prompt ./scripts/with-dicee-infisical-auth.sh dev -- true
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
