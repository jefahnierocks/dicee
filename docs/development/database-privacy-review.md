# Database privacy migration review

This is the second PR in the [modernization series](modernization-pr-series.md).
It depends on the baseline's application changes and profiles privilege fix.
Merging this PR does not apply the migration or authorize a hosted database write.

## Resulting behavior

Migration `20260913000002_public_security_hardening.sql` makes new profiles
private and resets existing public profiles to private. Owners can subsequently
opt in through the permitted profile fields. Profile-backed player statistics,
solo scores, gallery statistics, and the weekly gallery view respect visibility.
Achievements remain owner-only, including counts obtained through the view.

The existing profiles policy permits the `authenticated` role. Accordingly,
signed-out `anon` callers cannot see even opted-in profile data. Anonymous
Supabase sign-ins use `authenticated` and can see opted-in public data. The
migration does not introduce a public signed-out profile directory.

Client roles lose gallery and solo-score mutation privileges and execution of
server-owned statistics/gallery functions. Admin helpers restrict authenticated
callers to their own identity; trusted service-role operations remain available.
Four legacy bug-report fields are removed: `user_email`, `user_display_name`,
`user_context`, and `console_capture`.

## Verification and generated types

The new pgTAP file contains 99 assertions using actual SQL roles and JWT claims.
It checks ordinary users, anonymous sign-ins, signed-out callers, admins, and
the service role, with denied operations and successful authorized operations.
Together with the existing two files, all 146 tests passed after applying all
23 migrations in a task-isolated local Supabase project.

The baseline was also tested independently: resetting that isolated project
through `20260913000001` applied 22 migrations, and its two files passed 47 tests.
The privacy-only test file was excluded from that baseline run. No hosted
database was accessed; the task's local containers and volumes were removed.

`packages/web/src/lib/types/database.ts` was generated with the pinned Supabase
CLI 2.117.0, using `gen types typescript --local --schema public` against the
post-migration local schema. Only surplus blank lines at EOF were normalized.
Besides removing the report columns, this reconciles previously missing gallery
tables, the weekly view, and existing RPC/composite definitions. Removal of the
old hosted PostgREST version marker comes from local generator output, not a
claim that the hosted PostgREST version changed.

The normal repository gate checks the generated types and application consumers.
It does not start Supabase or run pgTAP; database results above are a separate
local validation lane. Regeneration against a hosted schema remains operator work.

## Operator sequence

Follow the full checklist in [`docs/status.md`](../status.md): take the required
backup, apply only `20260913000001`, deploy the updated Pages application, and
then apply `20260913000002`. Older Pages code still writes the removed report
columns, so reversing the last two steps breaks report submission. Existing
public profile preferences are reset by this migration; the backup is also the
record of those prior preferences.

The exposed statistics Edge Function, legacy Worker ingress, credential rotation,
and GitHub production protections remain independent operator follow-ups. Tests
of database grants do not prove that those external entry points are contained.
