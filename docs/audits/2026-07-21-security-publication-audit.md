# July 21, 2026 security and public-release audit

Status: current publication candidate hardened and locally verified; production
deployment, database migration, history rewrite, and disruptive GitHub policy
changes were not performed. This is a point-in-time record; see the 2026-09-12
status note below before relying on any conclusion.

## Status note (2026-09-12)

This record describes the uncommitted working tree of 2026-07-21. The 2026-09-12
modernization audit re-checked it and contradicts several conclusions. Finding
IDs (D-xx) refer to that audit. The current status of record is
[`docs/status.md`](../status.md), and the remediation ledger is in the
[publication hardening plan](2026-07-21-publication-hardening-plan.md). No live
action is implied by anything below.

Contradicted or point-in-time claims:

- **"Repository public-safety gate: pass."** Contradicted (D-18). On 2026-09-12
  the scan failed on documentation prose, did not detect hosted-database
  hostnames written without a URL scheme, and a companion audit document still
  contained unredacted infrastructure identifiers and raw control bytes. The
  document and the scan were corrected locally in the 2026-09 remediation; rerun
  `pnpm security:public` for a current result.
- **"pnpm audit: no known vulnerabilities."** Contradicted (D-05). On 2026-09-12
  the working-tree lockfile reported 33 advisories (12 high), and the committed
  lockfile reported 181 (2 critical).
- **"`pnpm validate`: pass."** Point-in-time (D-06). No full validation covered
  the final working tree between 2026-07-21 and 2026-09-12.
- **Database-backed `/_debug` permissions and RLS as the real control.**
  Incomplete (D-01). Row-level security was enabled, but the permission check
  trusts a profile role that an ordinary signed-in account can change.
- **Disabled `workers.dev` endpoint.** Source change only (D-02). The deployed
  Worker predates it, and live state has not been read back.

Pending remediations:

- **D-01 (critical): `profiles.role` self-escalation.** A new forward migration
  restricts column-level update privileges on `profiles`. The operator backs up
  and applies it live before the baseline is pushed. The July privacy migration
  ships separately, after it.
- **D-02 (high): unauthenticated Durable Object `/_debug` routes.** The operator
  confirms that workers.dev and Preview URLs are disabled on every Dicee Worker
  script. The Durable Object debug surface then moves behind RPC that is
  reachable only through the service binding after the RBAC check.

## Release decision

The current file candidate is suitable for public source review: it contains no
detected credential value, private operator metadata file, non-example email
address, workstation home path, live hosted-database project URL, or private
infrastructure hostname. (Point-in-time: contradicted on 2026-09-12; see the
status note.) The repository is **not yet cleared as fully remediated end to
end** because reachable Git history and live platform controls still require
operator work described below.

The GitHub repository was already public when this audit began. A history rewrite
cannot retract data from existing clones, forks, caches, or logs.

## High-risk findings remediated in source

- Enforced database-backed permissions on every `/_debug` route. Authentication
  alone no longer grants room deletion, connection inspection, or storage access.
  (Incomplete until D-01 is remediated; see the status note.)
- Removed WebSocket access tokens from browser and internal URLs. Tokens now move
  only in an `Authorization` header after the same-origin session is validated.
- Disabled the Durable Object Worker's public `workers.dev` endpoint and retained
  access through the Pages service binding. (Source change only; see D-02.)
- Removed lobby-client commands that could forge room creation, updates, and
  closure; removed the unauthenticated room-status HTTP fallback.
- Added message type and size bounds to lobby and game WebSockets and bounded
  correlation identifiers.
- Required a verified session for transcription, restricted audio types, and
  bounded request and decoded-audio sizes.
- Strictly validates telemetry events, bounds batches and request size, discards
  client-supplied user identifiers, normalizes same-origin URLs, and uses the
  request user agent rather than a client claim.
- Closed the authentication callback open redirect and stopped reflecting or
  logging provider error details.
- Restricted JWT verification claims and the legacy algorithm fallback; provider
  full names, email prefixes, and untrusted avatar hosts are no longer promoted
  into public identity.
- Added CSP, HSTS on HTTPS, clickjacking, MIME-sniffing, referrer, opener, and
  permissions-policy headers.
- Redacts credentials and personal identifiers before structured Worker logs are
  serialized.
- Removed raw console capture and duplicate email/display-name storage from the
  bug-report path.
- Added a forward database migration that defaults profiles to private, makes
  existing profiles private, removes legacy duplicate identity/console columns,
  narrows leaderboard policies, and revokes broad execution of privileged RPCs.
- Pinned every GitHub Action to a full commit SHA, made production deployment a
  manual workflow dispatch, attached deploy jobs to `Production`, and added
  CodeQL for JavaScript/TypeScript and Python.
- Replaced unpinned MCP execution with a locked dependency and made the Supabase
  MCP wrapper read-only. (Superseded 2026-09-12: bearer-token MCP wrappers are
  removed in favor of native OAuth HTTP servers.)
- Moved operator metadata to ignored `.dicee/operator-metadata.sh` with mode 0600
  and retained only a placeholder template in source.
- Added a fail-closed `pnpm security:public` gate to CI and pre-push hooks.
- Enabled GitHub private vulnerability reporting and added `SECURITY.md`.

These choices follow the current platform guidance for service-binding-only
Workers, full-SHA Actions, and restricted database functions:

- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/database/postgres/row-level-security

## Publication and secret-scan evidence

The exact candidate was assembled from tracked files plus non-ignored untracked
files: 756 files and approximately 9.54 MB. Every result in this section is
point-in-time as of 2026-07-21.

- Repository public-safety gate: pass on 2026-07-21 (contradicted on 2026-09-12;
  see the status note).
- Gitleaks current candidate, redacted: no findings.
- detect-secrets current candidate: no findings.
- TruffleHog current candidate without verification: one unverified false positive
  for the GitHub Actions secret-expression placeholder in `ci.yml`; no credential
  value is present.
- Gitleaks reachable history: one historical JWT-shaped browser key finding.
- Reachable Git metadata: three distinct author/committer email addresses.

The history finding and author metadata are not fixed by current-tree edits.
Rewriting public history is destructive and requires explicit authorization.

## Dependency and static-analysis evidence

- pnpm audit: no known vulnerabilities on 2026-07-21 (contradicted on
  2026-09-12; see the status note). A narrow `sharp` override was held at a line
  then believed patched until Wrangler/Miniflare admit it directly.
- cargo-audit: 114 locked dependencies, no vulnerabilities, no warnings.
- pip-audit: 132 exported locked packages, no known vulnerabilities.
- Bandit: 1,698 Python source lines, zero findings.
- CodeQL workflow: added for JavaScript/TypeScript and Python; it has not run on
  GitHub yet.
- Local Semgrep was unavailable because its package could not install the matching
  core binary. No Semgrep result is claimed.

## Functional verification

Point-in-time as of 2026-07-21; see the status note for what changed.

- `pnpm validate`: pass.
- Tests: 107 Rust tests plus 13 doc tests, 1,574 web tests, 522 Durable Object
  tests, 204 simulation tests, and 26 Python tests passed; 3 web tests remain
  intentionally skipped.
- Svelte/TypeScript: zero errors and zero warnings from `svelte-check`; all
  workspace type checks passed.
- Ruff, mypy, Clippy, AKG 8/8 invariants, and AKG MCP 10/10 tests: pass.
- Production SvelteKit and remapped-path WASM builds: pass.
- Wrangler 4.113.0 Durable Object dry run: pass; no deployment occurred.
- Database hardening migration syntax: pass with `pgsanity`; no live migration
  occurred.
- `git diff --check`, generated Worker type checks, public-safety scan, and pnpm
  audit: pass after the final build on 2026-07-21.

Existing advisory-only Biome warnings remain visible and non-blocking under the
repository's established policy.

## Required operator work before a production-safe closeout

1. Review and explicitly authorize a public-history rewrite if removal of the
   historical browser key and author emails is still desired. Rotate/revoke any
   operational identifier whose continued use is unnecessary, then coordinate
   fork/cache expectations.
2. Back up the database and apply the D-01 profiles privilege migration first.
   Then review and apply the July privacy migration
   (`*_public_security_hardening.sql`, renumbered in 2026-09 to sort after the
   D-01 migration) as a separate step in a controlled database lane. It
   intentionally makes all existing profiles private and removes four legacy
   bug-report columns. Verify function grants, RLS behavior, and generated
   database types afterward.
3. Add a main-branch ruleset or branch protection with required CI/CodeQL checks.
   The live repository currently has neither branch protection nor a ruleset.
4. Protect the `Production` environment with allowed branches and a reviewer or
   equivalent deployment policy; it currently has no protection rules and allows
   admin bypass.
5. Decide whether to enable Dependabot security updates. Secret scanning and push
   protection are enabled, but automated security fixes remain disabled.
6. Validate live secrets/variables and run the manually dispatched deployment.
   Then perform authenticated authorization, WebSocket, CSP, transcription,
   telemetry, and RLS smoke tests against production.

Until those steps are complete, local source verification must not be described
as proof that production or historical public exposure is remediated.
