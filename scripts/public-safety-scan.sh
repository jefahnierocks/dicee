#!/usr/bin/env bash
# Fail closed when the exact Git publication candidate contains private material.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Fail closed if the scanner itself is unavailable. A missing `rg` or missing
# PCRE2 support would otherwise make every pattern silently "pass".
if ! command -v rg >/dev/null 2>&1; then
  printf 'FAIL: ripgrep (rg) is not installed; cannot run the public-safety scan.\n' >&2
  exit 1
fi
if ! printf 'probe' | rg --pcre2 --quiet 'probe' 2>/dev/null; then
  printf 'FAIL: rg lacks working --pcre2 support; cannot run the public-safety scan.\n' >&2
  exit 1
fi

# An explicit template honors TMPDIR with both BSD and GNU mktemp.
candidate_file="$(mktemp "${TMPDIR:-/tmp}/dicee-public-safety.XXXXXX")"
trap 'rm -f "$candidate_file"' EXIT
git ls-files -co --exclude-standard -z >"$candidate_file"

failed=0

# Formats that carry machine configuration: MCP client files, CI workflows,
# environment templates, and shell launchers. Prose may name a flag; only
# configuration can set it.
is_config_file() {
  case "${1,,}" in
    *.json|*.jsonc|*.json5|*.toml|*.yaml|*.yml|*.ini|*.cfg|*.conf) return 0 ;;
    *.sh|*.bash|*.zsh|.envrc|*/.envrc|*.env.example) return 0 ;;
    *) return 1 ;;
  esac
}

# Media and compiled assets legitimately contain arbitrary bytes.
is_binary_asset() {
  case "${1,,}" in
    *.wasm|*.ogg|*.mp3|*.wav|*.flac|*.m4a|*.mp4|*.webm) return 0 ;;
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.avif|*.ico) return 0 ;;
    *.woff|*.woff2|*.ttf|*.otf|*.eot|*.pdf|*.zip|*.gz|*.tgz|*.br|*.zst) return 0 ;;
    *) return 1 ;;
  esac
}

# Optional third argument: a predicate function that limits which paths are scanned.
scan_pattern() {
  local label="$1"
  local pattern="$2"
  local path_filter="${3:-}"
  local found=0
  while IFS= read -r -d '' file; do
    [[ -f "$file" ]] || continue
    [[ "$file" == "scripts/public-safety-scan.sh" ]] && continue
    if [[ -n "$path_filter" ]] && ! "$path_filter" "$file"; then
      continue
    fi
    if LC_ALL=C rg --pcre2 --quiet --no-ignore-vcs -- "$pattern" "$file" 2>/dev/null; then
      if [[ "$found" -eq 0 ]]; then
        printf 'FAIL: %s\n' "$label" >&2
      fi
      printf '  %s\n' "$file" >&2
      found=1
      failed=1
    fi
  done <"$candidate_file"
}

# Text files must not carry raw control bytes; TAB, LF, VT, FF, and CR are
# allowed. A NUL byte makes recursive search tools classify a file as binary
# and skip it, which hides its contents from reviewers and ad hoc scans.
scan_control_bytes() {
  local found=0
  while IFS= read -r -d '' file; do
    [[ -f "$file" ]] || continue
    is_binary_asset "$file" && continue
    if LC_ALL=C rg --text --quiet --no-ignore-vcs -- '(?-u:[\x00-\x08\x0E-\x1F\x7F])' "$file" 2>/dev/null; then
      if [[ "$found" -eq 0 ]]; then
        printf 'FAIL: raw control bytes in a non-binary file\n' >&2
      fi
      printf '  %s\n' "$file" >&2
      found=1
      failed=1
    fi
  done <"$candidate_file"
}

scan_control_bytes

scan_pattern 'workstation-specific home path' '(/Users/|/home/|[A-Za-z]:\\Users\\)'
scan_pattern 'credential-manager item URI' 'op://'
scan_pattern 'hosted database project hostname' '\b[a-z]{20}\.supabase\.(co|com)\b'
scan_pattern 'hosted database project reference' "project[_-]ref\b[\"']?[[:space:]]*[=:]?[[:space:]]*[\"']?[a-z]{20}\b"
scan_pattern 'private infrastructure hostname' 'https?://infisical\.(?!com(?:[/[:space:]]|$)|example\.)[A-Za-z0-9.-]+'
scan_pattern 'access token transported in a URL' '[?&](access_)?token='
scan_pattern 'write-enabled hosted MCP configuration' 'read_only=false' is_config_file
scan_pattern 'mutable GitHub Action reference' 'uses:[[:space:]]+[^[:space:]#]+@(main|master|v[0-9]+)([[:space:]#]|$)'
scan_pattern 'private-key material' 'BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY'
scan_pattern 'Google OAuth client identifier' '[0-9]{9,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com'
scan_pattern 'credential-like assignment' "(API_KEY|API_TOKEN|CLIENT_SECRET|SERVICE_ROLE_KEY|JWT_SECRET)[[:space:]]*[:=][[:space:]]*[\"']?[A-Za-z0-9_+/.=-]{16,}"
# Value-shaped credentials, regardless of how they are assigned or quoted.
scan_pattern 'JSON Web Token (for example a Supabase anon or service-role key)' 'eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.'
scan_pattern 'Supabase personal access token or secret key' '\bsbp_[A-Za-z0-9]{20,}|\bsb_secret_[A-Za-z0-9_-]{10,}'
scan_pattern 'GitHub token' '\b(ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{20,}'
# Cloudflare account and zone IDs are 32 lowercase hex characters. All-zero
# placeholders and the `(hash: ...)` header that `wrangler types` generates are
# allowed; 40- and 64-character digests do not match.
scan_pattern '32-hex account or zone identifier' '(?<![0-9A-Za-z])(?<!hash: )(?!0{32}(?![0-9A-Za-z]))[0-9a-f]{32}(?![0-9A-Za-z])'
# `<script>.<subdomain>.workers.dev` placeholders are allowed.
scan_pattern 'workers.dev hostname with an account subdomain' '\.[a-z0-9-]+\.workers\.dev\b'

while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue
  [[ "$file" == "scripts/public-safety-scan.sh" ]] && continue
  # Apply private-name rules at every depth, including package-local env files.
  case "${file##*/}" in
    .env.example|.infisical.example.json) ;;
    .env|.env.*|*.pem|*.key|*.p12|*.pfx|.infisical.json)
      printf 'FAIL: private file is part of the publication candidate\n  %s\n' "$file" >&2
      failed=1
      ;;
  esac
done <"$candidate_file"

while IFS= read -r -d '' file; do
  [[ -f "$file" ]] || continue
  [[ "$file" == "scripts/public-safety-scan.sh" ]] && continue
  while IFS= read -r email; do
    domain="${email##*@}"
    case "${domain,,}" in
      example.com|example.org|example.net|users.noreply.github.com) ;;
      *)
        printf 'FAIL: non-example email address\n  %s\n' "$file" >&2
        failed=1
        break
        ;;
    esac
  done < <(LC_ALL=C rg --only-matching --no-filename --no-ignore-vcs \
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$file" 2>/dev/null || true)
done <"$candidate_file"

if [[ "$failed" -ne 0 ]]; then
  printf 'Public-safety scan failed; matched values were intentionally not printed.\n' >&2
  exit 1
fi

printf 'Public-safety scan passed.\n'
