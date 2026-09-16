# Dicee roadmap

Ordered next work. State, decisions and deadlines live in [status.md](status.md). Each item reads: work — gate.

## 1. Safety now

The first production release is done: `20260914000001` and `20260914000002` are applied and recorded, `player_stats` was rebuilt once, `dicee-web` serves `dicee.games` over the `GAME_WORKER` binding to `dicee`, and the Pages project is deleted. [Status](status.md#latest-live-readbacks) holds the evidence; do not restate it here. Status action numbers stay stable references; what follows is the execution order for the work the release did not close, and each production step keeps its operator authority and stop points.

Two release-time assumptions are retired. Reattaching a hostname to Pages is no longer a rollback path: roll forward, and target `dicee-web` for every web release. There is no deployed `aggregate-game-stats` Edge Function to delete; the projection refresh is `aggregate_game_stats(uuid)` in the database. The scoped Cloudflare credential still returns HTTP 403 for zone-level Worker route reads; close that gap with a dashboard read before each deletion, never by widening the token.

1. Delete the obsolete legacy Workers (action 8) one at a time, each preceded by a dashboard read of that script's Domains & Routes. Take `gamelobby` first — no Durable Object namespaces, no custom domains, no service-binding consumers — with an ordinary non-force deletion. `dicee-production` and `gamelobby-production` are separate decisions: both still own SQLite `GameRoom`/`GlobalLobby` namespaces, so force-deleting either destroys that legacy state, and `gamelobby-production` also still exposes `workers.dev` and Preview URLs, which is live public ingress on a retired script — zero Worker Routes shown for the script, then a deletion readback and a green public smoke.
2. Narrow the Cloudflare deploy/operator credential (action 16), independently of the deletions above — a capability readback showing the reduced scope, confirmed functionally by the next authorized release.
3. Implement the profile visibility opt-in control, initially off for private profiles, writing `profiles.is_public`; explain that visibility is voluntary and cover it with tests. Merge through the ruleset — successful full validation on the PR.
4. Deploy the opt-in build, verify the control and a test bug report, then take a fresh complete encrypted backup. Recheck the production link and migration history, apply only `20260913000002`, and verify the schema and two-account privacy behavior (action 4). Invite opt-ins only after verification; the migration resets every profile to private and clears earlier opt-ins. Fix forward — fresh backup evidence, migration readback and privacy tests.

Do not reapply or reverse an applied migration, run a broad database push, or treat a successful dry run as namespace proof. Hosted multiplayer testing waits for an isolated backend (section 8).

## 2. Supabase obligations

Date-driven and independent of the organization move. `20260913000001`, `20260914000001` and `20260914000002` are applied; `20260913000002` is section 1 work. Agents write and test the migrations locally; the operator applies them before the external dates.

- Explicit per-table grants and default-privilege revokes for tables and sequences, with a pgTAP privilege matrix — `supabase db reset --local && supabase test db`; operator applies before 2026-10-30.
- Secretless CI lane that runs a local `supabase db reset` and `supabase test db` — green on a PR.
- Re-set the GitHub `PUBLIC_SUPABASE_ANON_KEY` repository secret to the current canonical legacy anon key through the approved delivery path. The release used that key and verified it functionally, but the stored CI value was never read back, so a CI dispatch remains unproven — a `workflow_dispatch` web deploy that reaches production sign-in. This is CI confidence on the legacy key, deliberately not the migration below.
- API key migration: web to a publishable key; decide the Worker's key shape ([open decision](cloudflare.md#open-decisions); default: one secret key on the `apikey` header only, dropping the Bearer header in `packages/cloudflare-do/src/lib/persistence/supabase-rpc.ts`), then implement it, update `secrets.required`, run `pnpm types` and rename the CI secrets — tests and dry run; operator deactivates legacy keys before end-2026.
- Asymmetric JWT signing: decide how to clear audit warning B8 ([open decision](cloudflare.md#open-decisions); default: remove HS256), then pin the JWKS verification algorithms and remove the HS256 fallback, `SUPABASE_JWT_SECRET` and the trailing `packages/cloudflare-do/wrangler.jsonc` comment that asks for it — auth tests; operator confirms the signing-key state first.
- Minimize Supabase after a row-count readback and a fresh dump: drop vestigial tables, RPCs and columns (gallery, `solo_leaderboard`, `rooms`, `analysis_events`, `feature_flags`, spectator policies, Glicko and badge columns) with their TypeScript; keep `log_admin_action` as the only admin audit writer; close the `bug_reports` delete-policy gap — pgTAP green; operator applies.
- Keep the stats projection out of that sweep: `rebuild_player_stats(uuid)`, `refresh_player_stats_for_game(uuid)` and the `aggregate_game_stats(uuid)` wrapper the Worker still calls are current, and `update_category_stats` is already dropped — do not relist it.
- Residual policy fixes for whatever minimization keeps: the open read policies on `admin_permissions` and `feature_flags`, `SET search_path` on the gallery security-definer functions, and the spectator branch of the live `games` and `game_players` SELECT policies, which matches a `playing` status the `games` check constraint never allows. A rewrite preserves `is_game_participant(uuid)` and the non-recursive shape `20260914000002` established — pgTAP green; operator applies.
- Persistence follow-ups: the Worker's `TurnScored` events carry `was_optimal` and `ev_difference`, so Decision Quality stops reading 0; scheduled abandonment, schema-validated outbox rows and surfaced permanent failures — tests.

## 3. Worker correctness and security

Agent-safe to build. Shipping any of it is an ordinary authorized release, not a cutover: a `dicee` deploy restarts its Durable Objects and closes live sockets, so batch these items and release at a quiet time.

- Move admin diagnostics behind the service binding with in-Worker authorization; lobby room removal moves from `setTimeout` to an alarm — lobby auth tests and dry run.
- GameRoom: alarm reconciler, alarm-based invite and join expiry, admission in `onConnect` (private rooms admit only invited players), a decision on finished-room storage retention ([open decision](cloudflare.md#open-decisions); default: reclaim when finished and empty) and its implementation, and the structured logger in place of ad hoc `console.error` — `vitest run src/lib src/game` in `packages/cloudflare-do`.
- Worker test split: a separate integration config so the default include stops matching integration tests, and `unstable_dev` replaced by the current Wrangler test harness — both lanes green.
- Transcription: rate limit keyed on the verified user, the Workers AI model id out of the call site, and the unused `estimateAudioDuration` removed — tests.
- CSP `connect-src` built from `PUBLIC_SUPABASE_URL`, and security headers on static asset responses through the adapter's `_headers` (it never applies to Worker responses) — the web build output `_headers` carries them.
- Table-driven regression test for the auth callback's `safeRedirectTarget` — web test lane.

## 4. Repository hygiene

Agent-safe unless noted.

- History secret scan (pinned Gitleaks; the publication scan checks only candidate files) and a workflow policy check — both run in CI.
- AKG graph drift gate: `pnpm akg:check` fails when discovery differs from the committed graph — `git diff --exit-code` on the graph after discovery.
- Remove or restore the dangling `web:analyze-logs` scripts: the log-analyzer tool directory under packages/web is gitignored, so a clean clone has no CLI entry file — the script runs from a clean clone or is gone.
- Decide the unused `ENVIRONMENT` var (config audit B11; [open decision](cloudflare.md#open-decisions); default: delete it), then implement. Only `packages/cloudflare-do/wrangler.jsonc` still declares it, at the top level and in both named environments, and it is live on the deployed Worker, so removal ships with a `dicee` release — `pnpm cf:audit:strict` loses the warning.
- Stop claiming untested Python 3.14: drop the 3.14 classifier and narrow `requires-python` to `>=3.13,<3.14` in `packages/analysis/pyproject.toml`, regenerating `uv.lock` in the same change — `uv lock --check --project packages/analysis` and `pnpm test:analysis`.

## 5. Toolchain

Agent-safe.

- Post-release maintenance PR, kept separate from this documentation reconciliation and never backported into the release commit: refresh the package manager and the Wrangler/miniflare pair from their current pins (`packageManager` pnpm 11.15.1 in `package.json` and `.mise.toml`; catalog `wrangler` 4.113.0 with `miniflare` 4.20260721.0 bumped in lockstep), respecting the miniflare hold in status decision 5, which `.github/dependabot.yml` also cites to suppress wrangler and miniflare security PRs — `pnpm validate:ci` green on its own PR, with the released commit unamended.
- JS runtime pins and the rest of the catalog patch/minor refresh; take wasm-pack from a verified source instead of the npm devDependency — `pnpm validate:ci`.
- Node 26 after its 2026-10-28 LTS: widen `engines` and move the pins — `pnpm validate:ci` on Node 26.
- mise-driven CI toolchain install; Rust, Python and wasm-pack refresh — CI green.
- Biome config migration and a ratchet on the advisory warnings — the ratchet script passes.
- Wrangler on the miniflare 5 line (non-alpha) with a newer compatibility date, plus runtime Durable Object tests — the owner revisits status decision 5.

## 6. App modernization

Agent-safe, in order. Gate for each: `pnpm validate` and `pnpm akg:check`.

- Protocol unification with schema validation of inbound Durable Object messages (today only chat payloads have a schema).
- Scoring rules into `packages/shared` with a table-driven test lane.
- Web runes and `$app/state` in place of `$app/stores`; the generated `GAME_WORKER` type in place of the hand declaration in `packages/web/src/app.d.ts`.
- Web dead code: `packages/web/src/lib/supabase/generated-types.ts`, `packages/web/src/lib/components/lobby/RoomCard.svelte`, the parked hub, gallery, skeleton and BugReportAdmin components, the always-true new-engine flag with `VITE_ENABLE_NEW_ENGINE`, the undefined `PUBLIC_WORKER_HOST` and the stale `PUBLIC_PARTYKIT_HOST` example.
- WASM typing, Cargo lints, a WASM reproducibility check and the Pydantic contract.
- Extract the `akg`, `audio-gen` and `ai` packages; move Supabase types into shared after minimization.
- Split oversized modules.

## 7. Organization move with governance and IaC

Near-term direction (status decision 9). The GitHub repository transfer and local checkout move are complete, and the application now runs on the committed two-Worker architecture, so discovery describes live resources rather than a planned shape. Remaining provider/infrastructure ownership changes and infrastructure adoption still wait for the Supabase key migration and the HS256 removal. Section 1 keeps its operator stop points; this section does not advance them.

The [selected Cloudflare strategy](cloudflare.md#governance-strategy) preserves the running application shape and separates Jefahnierocks service governance from shared-account stewardship. The [organization alignment guide](development/organization-alignment.md) records the completed GitHub/local move and remains the proposal for the remaining provider and infrastructure boundaries. The repository transfer does not establish Cloudflare, Supabase, Google or infrastructure execution authority.

- Accept the Jefahnierocks intake: name the service owner, current shared-account steward, actual reviewers/operators, exact infrastructure repository/root and protected state boundary. Dicee-specific resources go in that owner's root even when account-scoped; global placement is for shared resources. Plan fresh inventory of namespace owners, the canonical and any surviving legacy Worker scripts, custom domains, zone DNS and redirect rules, all other ingress, secret names, token reach, registrar ownership and GitHub controls — accepted responsibility/field map and private inventory, with unresolved items explicit.
- **Completed 2026-09-14:** transferred the repository to `jefahnierocks/dicee`, moved the checkout to `~/Organizations/jefahnierocks/dicee`, preserved history, Actions secrets and the Production environment, updated repository identity metadata and the git remote, and left the old GitHub path unrecreated so its redirect remains available. GitHub governance is established separately by action 10.
- Establish separate inventory/plan, infrastructure-apply, application-release and local-operator credentials through accepted delivery paths; preserve the current 1Password wrapper and GitHub Environment wiring until replacements are accepted. The Pages Write reduction in section 1 is a narrowing of today's token, not this split. Separate production and test consumers where supported; document effective account/zone permissions and remaining reach — capability readbacks, with no claim that a token label restricts access to one Worker.
- Adopt OpenTofu in the designated infrastructure root: pin tool/provider versions and commit the lockfile; establish ignore rules, approved encrypted state/plan storage, access controls and recovery before generating artifacts. Keep initial CI credential-free (fmt, validate, policy), and authenticated plans in protected environments. Discover/import existing resources without recreation; use the owning repository's accepted execution path — reviewed import/no-op plan and explicit authority for the first infrastructure write, followed by readback.
- Prove the field boundary on the surfaces that actually overlap: the `dicee-web` custom domain serving `dicee.games`, the apex and `www` DNS records, and the zone redirect rules that canonicalize `www` and the retired legacy aliases onto the apex. Retain artifact, bindings, vars and compatibility in Wrangler; assign infrastructure identity and domain fields explicitly. Verify import/no-op behavior, an authorized ordinary Wrangler release and the next infrastructure plan. Defer unmanaged fields or the resource when the pinned provider cannot preserve ownership — no unintended reset, recreation or dropped redirect in that sequence. Keep Worker releases and v1/v2 Durable Object lifecycle in Wrangler; deliver runtime secret values outside infrastructure state.
- Retain the existing shared Cloudflare account under its current steward during alignment. Consider account relocation only for an accepted isolation/governance need, with a separate state-preservation, recovery, domain-cutover and verification plan. `dicee` is the confirmed owner of the live `GameRoom` and `GlobalLobby` namespaces; do not rename scripts/classes or assume a new account retains state — acceptance and current ownership/readback evidence before any relocation action.
- Supabase project into an organization-owned Supabase org (same region; URL, JWKS and keys unchanged), with auth and other non-secret settings as code in plan-only mode and a `supabase/config.toml` parity check — sign-in and room-join readback.
- Google OAuth client into an organization-governed Google Cloud project, in its own change window — sign-in readback.
- Decommission only classified obsolete scripts, credentials and memberships after checking namespace/data ownership, bindings, consumers and recovery. The legacy Dicee Workers are section 1 work, not part of a blanket sweep; keep unrelated shared-account resources intact and legacy keys deactivated — readback confirming the approved removals and retained required resources, not an empty shared-account inventory.

## 8. Deferred with a trigger

- Durable Object `exports` adoption — a concrete need recorded in status.
- D1 or R2 — a data need Supabase cannot meet.
- An isolated hosted staging backend (its own Worker, data and credentials) — a real multi-person hosted test need.
- Anonymous sign-in captcha, WebSocket re-authentication and a per-connection message-rate cap — players beyond the family.
- TypeScript 7 — Svelte tooling supports its stable API. pnpm 12 and uv 0.12 — Dependabot supports them.
- DiceBear 10 — `@dicebear/collection` supports it. Python 3.14 support (a CI job first, then the package claim) — an analysis dependency or feature needs 3.14.
- Nine sound-bank sounds with no audio file (playback skips them) — the owner wants them generated with `pnpm audio:gen`.
