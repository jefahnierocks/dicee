# September 2026 modernization PR review

The owner authorized branch publication and PR creation on 2026-09-13 UTC.
The original handoff is preserved on `work/2026-09-modernization` at `8e3c6b2`.
Publication and local validation do not authorize or prove a production change.

## Review order

| Branch | Base | Scope |
| --- | --- | --- |
| `review/2026-09-baseline` | `main` | Portable agent contract, native OAuth MCP, operator scripts, pinned toolchains and dependencies, CI, Worker/web compatibility and security, deterministic simulations, urgent profiles privilege migration, redacted docs, and reproducible AKG/WASM output. Includes telemetry and nested environment-file regression fixes found during independent review. |
| `review/2026-09-database-privacy` | `review/2026-09-baseline` | Migration `20260913000002`, local-schema generated database types, and dedicated pgTAP coverage of profile visibility, function grants, and the weekly gallery view. |

The baseline preserves the first 16 original commits as review subdivisions.
They are one integration unit: the dependency commit enables Python dependency
groups and generated Worker checks supplied by later commits; runtime changes
need the refreshed dependency APIs; AKG code and artifacts must agree. Splitting
at those chronological boundaries would produce failing intermediate PR tips.

The two original status commits are incorporated with updated publication and
operator boundaries. The privacy migration is intentionally absent from the
baseline branch so the urgent privilege fix can be selected independently.

CI and CodeQL accept PRs against predecessor branches. Push validation remains
limited to `main`; the candidate workflow permits production deployment only
through an explicit manual dispatch with `deploy=true` on `main`.

## Review and validation evidence

Independent reviewers inspected runtime security, commit dependencies, database
compatibility, and publication controls. The baseline fixes the first five
findings below; the separately tested database changes belong to the second PR:

- nested private environment filenames missed by the publication scan;
- telemetry payload URLs and query strings surviving privacy normalization;
- stacked PRs excluded by workflow branch filters;
- Git fixture tests inheriting hook variables and altering the parent repository;
- CI relying on an uninstalled `ripgrep` dependency for the publication scan;
- stale database types and missing security-specific tests for migration
  `20260913000002` (owned by the second PR).

Use `pnpm install --frozen-lockfile` and `pnpm validate:ci` with CI's synthetic
public Supabase settings in a clean worktree. The full gate does not run database
tests: record `supabase test db` separately against an isolated local stack.
Never regenerate database types from hosted production as part of these checks.
Local generation for the second PR uses the pinned CLI, applied local migrations,
and the public schema.

The publication scanner checks candidate files, not historical Git objects.
A separate value-blind review of added lines found no newly introduced home-path,
hosted Supabase reference, account-ID, JWT, or Supabase-token patterns in the
original series. Inherited identifiers remain in already-published history; the
redacted tip does not remove them from Git history.

## Merge and rollout boundaries

Keep both PRs in draft while the owner resolves the operator follow-ups in
[`docs/status.md`](../status.md). Configure the required check using its actual
display name, **Full repository validation**, and protect the `Production`
environment before any deployment. The current default-branch workflow still
auto-deploys on pushes to `main`; the baseline replaces that behavior.

The database rollout order remains backup, migration `20260913000001`, updated
Pages application, then migration `20260913000002`. The second migration removes
legacy report columns and disables client writes to selected derived tables.
Its merge is not permission to apply it. Do not use a broad database push to apply
both stages together.

After the baseline merges, retarget the privacy PR to `main` and verify its
diff and newly emitted checks. If the baseline was squash-merged, rebuild the
privacy branch from the merged base while preserving only its database-specific
changes; do not accidentally replay the entire baseline.

The external audit, evaluation, and revised RFC drafts named in the handoff were
not present in this checkout. Existing RFCs remain drafts. This PR series does
not select a Supabase plan, approve an organization transfer, or adopt OpenTofu.
