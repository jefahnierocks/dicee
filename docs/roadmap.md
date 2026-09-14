# Dicee roadmap

Ordered next work. State, decisions and deadlines live in [status.md](status.md). Each item reads: work — gate.

## 1. Safety now

The backup, profile-role hardening/audit, two-script Worker URL restrictions and credential containment are recorded as complete in [status](status.md#latest-live-readbacks). Status action numbers are stable references; this is the execution order. Preserve durable facts (Supabase data, migrations, backups), not obsolete runtime topology: fix forward, delete classified legacy surfaces, and make the next production release the architecture we keep. Each production step retains its operator authority and stop points.

1. Read-only discovery (actions 5 and 8): `GameRoom` and `GlobalLobby` owners through the Durable Objects Deployments tab, SQLite and migration tags, production and preview `GAME_WORKER` targets, routes and domains on every Dicee Worker script and Pages project, last deployments of `dicee` and `dicee-production`, secret names on `dicee`, and whether `dicee.games` and `www` sit in a zone on this account and with which record types. Do not measure ephemeral Durable Object state — private readback, then a status decision naming the scripts and projects to delete.
2. Fix the self-referencing `game_players` SELECT policy: its subquery's unqualified `game_id` makes signed-in reads fail with infinite recursion, which breaks game history once games persist. Ship a migration that applies alone, like `20260914000001` — pgTAP as a seated player, a spectator and an outsider.
3. Establish the `main` ruleset, Production deployment protections and Dependabot controls (action 10) before the release. Require the exact check `Full repository validation`; inspect bypass behavior and the existing Wrangler/Miniflare ignore policy — authenticated control readbacks.
4. First release (action 3) from a clean checkout of the exact successful CI commit, at a quiet time, with operator commands rather than a CI dispatch: read back the completed `games` count, `player_stats` rows and summed `games_played` (the one-time rebuild resets stats that no completed game backs), apply `20260914000001` and the policy fix alone, deploy `dicee-web`, detach `dicee.games` from Pages and attach it to `dicee-web` (short outage), then deploy `dicee` (its protocol gate closes the old Pages client's sockets), run the smoke checks including one completed game, delete the deployed `aggregate-game-stats` Edge Function and rebuild all `player_stats` once, then delete the Pages project and the classified scripts (action 8) — sign-in, room/lobby, a persisted game with stats, headers, transcription, non-admin refusal and deletion readbacks.
5. Implement the profile visibility opt-in control, initially off for private profiles, writing `profiles.is_public`; explain that visibility is voluntary and cover it with tests. Merge through the new ruleset — successful full validation on the PR.
6. Deploy the opt-in code, verify the control and a test bug report, then take a fresh complete encrypted backup. Recheck the production link and history (`000001` remote, `000002` local-only), apply only `000002`, and verify the schema and two-account privacy behavior (action 4). Invite opt-ins only after verification; the migration clears earlier opt-ins. Fix forward — fresh backup evidence, migration readback and privacy tests.

Do not reapply or reverse `000001`, run a broad database push, or treat a successful dry run as namespace proof. Hosted multiplayer testing waits for an isolated backend (section 8).

## 2. Supabase obligations

Date-driven and independent of the organization move. Agents write and test the migrations locally; the operator applies them before the external dates.

- Explicit per-table grants and default-privilege revokes for tables and sequences, with a pgTAP privilege matrix — `supabase db reset --local && supabase test db`; operator applies before 2026-10-30.
- Secretless CI lane that runs a local `supabase db reset` and `supabase test db` — green on a PR.
- API key migration: web to a publishable key; decide the Worker's key shape ([open decision](cloudflare.md#open-decisions); default: one secret key on the `apikey` header only, dropping the Bearer header in `packages/cloudflare-do/src/lib/persistence/supabase-rpc.ts`), then implement it, update `secrets.required`, run `pnpm types` and rename the CI secrets — tests and dry run; operator deactivates legacy keys before end-2026.
- Asymmetric JWT signing: decide how to clear audit warning B8 ([open decision](cloudflare.md#open-decisions); default: remove HS256), then pin the JWKS verification algorithms and remove the HS256 fallback, `SUPABASE_JWT_SECRET` and the trailing `packages/cloudflare-do/wrangler.jsonc` comment that asks for it — auth tests; operator confirms the signing-key state first.
- Minimize Supabase after a row-count readback and a fresh dump: drop vestigial tables, RPCs and columns (gallery, `solo_leaderboard`, `rooms`, `analysis_events`, `feature_flags`, spectator policies, Glicko and badge columns) with their TypeScript; keep `log_admin_action` as the only admin audit writer; close the `bug_reports` delete-policy gap — pgTAP green; operator applies.
- Residual policy fixes for whatever minimization keeps: the open read policies on `admin_permissions` and `feature_flags`, `SET search_path` on the gallery security-definer functions, and spectator policies that match a `playing` status the `games` check never allows — pgTAP green; operator applies.
- Persistence follow-ups: the Worker's `TurnScored` events carry `was_optimal` and `ev_difference`, so Decision Quality stops reading 0; scheduled abandonment, schema-validated outbox rows and surfaced permanent failures — tests.

## 3. Worker correctness and security

Agent-safe to build. Worker deploys wait for status action 5.

- Move admin diagnostics behind the service binding with in-Worker authorization; lobby room removal moves from `setTimeout` to an alarm — lobby auth tests and dry run.
- GameRoom: alarm reconciler, alarm-based invite and join expiry, admission in `onConnect` (private rooms admit only invited players), a decision on finished-room storage retention ([open decision](cloudflare.md#open-decisions); default: reclaim when finished and empty) and its implementation, and the structured logger in place of ad hoc `console.error` — `vitest run src/lib src/game` in `packages/cloudflare-do`.
- Worker test split: a separate integration config so the default include stops matching integration tests, and `unstable_dev` replaced by the current Wrangler test harness — both lanes green.
- Transcription: rate limit keyed on the verified user, the Workers AI model id out of the call site, and the unused `estimateAudioDuration` removed — tests.
- CSP `connect-src` built from `PUBLIC_SUPABASE_URL`, and security headers on static asset responses through the adapter's `_headers` (it never applies to Worker responses) — the web build output `_headers` carries them.
- Table-driven regression test for the auth callback's `safeRedirectTarget` — web test lane.

## 4. Repository hygiene

Agent-safe unless noted.

- Retire the Infisical scripts, metadata names and .infisical.json handling — `rg -i infisical scripts .gitignore` is empty; operator revoked the identities (status action 13).
- History secret scan (pinned Gitleaks; the publication scan checks only candidate files) and a workflow policy check — both run in CI.
- AKG graph drift gate: `pnpm akg:check` fails when discovery differs from the committed graph — `git diff --exit-code` on the graph after discovery.
- Remove or restore the dangling `web:analyze-logs` scripts, whose CLI entry file is missing — the script runs or is gone.
- Decide the unused `ENVIRONMENT` var (config audit B11; [open decision](cloudflare.md#open-decisions); default: delete it from both configs), then implement — `pnpm cf:audit --strict` loses the warning.
- Stop claiming untested Python 3.14: drop the 3.14 classifier and narrow `requires-python` to `>=3.13,<3.14` in `packages/analysis/pyproject.toml`, regenerating `uv.lock` in the same change — `uv lock --check --project packages/analysis` and `pnpm test:analysis`.

## 5. Toolchain

Agent-safe.

- JS runtime pins and catalog patch/minor refresh; take wasm-pack from a verified source instead of the npm devDependency — `pnpm validate:ci`.
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

Near-term direction (status decision 9). Documentation, inventory planning and credential-free source validation can proceed now. Ownership changes and infrastructure adoption wait for the Supabase key migration, HS256 removal and Infisical retirement (credentials before ownership). Section 1 keeps its operator stop points; this section does not advance them.

The [selected Cloudflare strategy](cloudflare.md#governance-strategy) preserves the current application shape and separates Jefahnierocks service governance from shared-account stewardship. The [organization alignment guide](development/organization-alignment.md) remains the intake proposal for destination, naming and ownership. Neither establishes completed intake, transfer or deployment authority.

- Accept the Jefahnierocks intake: name the service owner, current shared-account steward, actual reviewers/operators, exact infrastructure repository/root and protected state boundary. Dicee-specific resources go in that owner's root even when account-scoped; global placement is for shared resources. Plan fresh inventory of namespace owners, Pages targets/domains, all ingress, secret names, token reach, zone/registrar ownership and GitHub controls — accepted responsibility/field map and private inventory, with unresolved items explicit.
- Transfer the repository to the intended `jefahnierocks/dicee` destination after accepted intake: record reviewers, rulesets, bypass behavior, installed Apps, Actions variables and deployment protections first; afterwards re-verify them and update `SECURITY.md`, `packages/engine/Cargo.toml`, `.github/ISSUE_TEMPLATE/config.yml`, `project.yaml` and the git remote. Preserve the public URL, package structure and history; never recreate the old repository name — readback after transfer. Manifest ownership changes only with the accepted transfer.
- Establish separate inventory/plan, infrastructure-apply, application-release and local-operator credentials through accepted delivery paths; preserve the current 1Password wrapper and GitHub Environment wiring until replacements are accepted. Separate production and test consumers where supported; document effective account/zone permissions and remaining reach — capability readbacks, with no claim that a token label restricts access to one Worker.
- Adopt OpenTofu in the designated infrastructure root: pin tool/provider versions and commit the lockfile; establish ignore rules, approved encrypted state/plan storage, access controls and recovery before generating artifacts. Keep initial CI credential-free (fmt, validate, policy), and authenticated plans in protected environments. Discover/import existing resources without recreation; use the owning repository's accepted execution path — reviewed import/no-op plan and explicit authority for the first infrastructure write, followed by readback.
- Prove the Pages field boundary before managing its project with OpenTofu: retain application artifact, bindings, vars and compatibility in Wrangler; assign infrastructure identity/domain and any overlapping build fields explicitly. Verify import/no-op behavior, an authorized ordinary Wrangler release and the next infrastructure plan. Defer unmanaged fields or the resource when the pinned provider cannot preserve ownership — no unintended reset/recreation in that sequence. Keep Worker releases and v1/v2 Durable Object lifecycle in Wrangler; deliver runtime secret values outside infrastructure state.
- Retain the existing shared Cloudflare account under its current steward during alignment. Consider account relocation only for an accepted isolation/governance need, with a separate state-preservation, recovery, domain-cutover and verification plan. Resolve `dicee`/`dicee-production` namespace ownership before any Worker release; do not rename scripts/classes or assume a new account retains state — acceptance and current ownership/readback evidence before any relocation action.
- Supabase project into an organization-owned Supabase org (same region; URL, JWKS and keys unchanged), with auth and other non-secret settings as code in plan-only mode and a `supabase/config.toml` parity check — sign-in and room-join readback.
- Google OAuth client into an organization-governed Google Cloud project, in its own change window — sign-in readback.
- Decommission only classified obsolete scripts, credentials and memberships after checking namespace/data ownership, bindings, consumers and recovery. Keep unrelated shared-account resources and unresolved `dicee-production` intact; legacy keys stay deactivated — readback confirming the approved removals and retained required resources, not an empty shared-account inventory.

## 8. Deferred with a trigger

- Durable Object `exports` adoption — a concrete need recorded in status.
- D1 or R2 — a data need Supabase cannot meet.
- An isolated hosted staging backend (its own Worker, data and credentials) — a real multi-person hosted test need.
- Anonymous sign-in captcha, WebSocket re-authentication and a per-connection message-rate cap — players beyond the family.
- TypeScript 7 — Svelte tooling supports its stable API. pnpm 12 and uv 0.12 — Dependabot supports them.
- DiceBear 10 — `@dicebear/collection` supports it. Python 3.14 support (a CI job first, then the package claim) — an analysis dependency or feature needs 3.14.
- Nine sound-bank sounds with no audio file (playback skips them) — the owner wants them generated with `pnpm audio:gen`.
