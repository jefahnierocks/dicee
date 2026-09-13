# Dicee roadmap

Ordered next work. State, decisions and deadlines live in [status.md](status.md). Each item reads: work — gate.

## 1. Safety now

- Profile visibility opt-in control in the web app: the privacy migration makes every profile private and leaderboards list only opted-in players, so the control must ship before that migration is applied — web test.
- Complete the status [open operator actions](status.md#open-operator-actions) 1-10 in order — each readback recorded in status.

## 2. Supabase obligations

Date-driven and independent of the organization move. Agents write and test the migrations locally; the operator applies them before the external dates.

- Explicit per-table grants and default-privilege revokes for tables and sequences, with a pgTAP privilege matrix — `supabase db reset --local && supabase test db`; operator applies before 2026-10-30.
- Secretless CI lane that runs a local `supabase db reset` and `supabase test db` — green on a PR.
- API key migration: web to a publishable key; decide the Worker's key shape ([open decision](cloudflare.md#open-decisions); default: one secret key on the `apikey` header only, dropping the Bearer header in `packages/cloudflare-do/src/lib/persistence/supabase-rpc.ts`), then implement it, update `secrets.required`, run `pnpm types` and rename the CI secrets — tests and dry run; operator deactivates legacy keys before end-2026.
- Asymmetric JWT signing: decide how to clear audit warning B8 ([open decision](cloudflare.md#open-decisions); default: remove HS256), then pin the JWKS verification algorithms and remove the HS256 fallback, `SUPABASE_JWT_SECRET` and the trailing `packages/cloudflare-do/wrangler.jsonc` comment that asks for it — auth tests; operator confirms the signing-key state first.
- Minimize Supabase after a row-count readback and a fresh dump: drop vestigial tables, RPCs and columns (gallery, `solo_leaderboard`, `rooms`, `analysis_events`, `feature_flags`, spectator policies, Glicko and badge columns) with their TypeScript; keep `log_admin_action` as the only admin audit writer; close the `bug_reports` delete-policy gap — pgTAP green; operator applies.
- Residual policy fixes for whatever minimization keeps: the open read policies on `admin_permissions` and `feature_flags`, `SET search_path` on the gallery security-definer functions, and spectator policies that match a `playing` status the `games` check never allows — pgTAP green; operator applies.
- Persistence pipeline, owner picks: repair (jsonb RPC parameters instead of hand-built array literals, a storage model for AI seats, scheduled abandonment, schema-validated outbox rows, surfaced permanent failures, and removal of the never-constructed `GamePersistenceService`) or freeze (the Worker drops the service-role key) — tests.

## 3. Worker correctness and security

Agent-safe to build. Worker deploys wait for status action 5.

- Move admin diagnostics behind the service binding with in-Worker authorization; lobby room removal moves from `setTimeout` to an alarm — lobby auth tests and dry run.
- GameRoom: alarm reconciler, alarm-based invite and join expiry, admission in `onConnect` (private rooms admit only invited players), a decision on finished-room storage retention ([open decision](cloudflare.md#open-decisions); default: reclaim when finished and empty) and its implementation, and the structured logger in place of ad hoc `console.error` — `vitest run src/lib src/game` in `packages/cloudflare-do`.
- Worker test split: a separate integration config so the default include stops matching integration tests, and `unstable_dev` replaced by the current Wrangler test harness — both lanes green.
- Transcription: rate limit keyed on the verified user, the Workers AI model id out of the call site, and the unused `estimateAudioDuration` removed — tests.
- CSP `connect-src` built from `PUBLIC_SUPABASE_URL`, plus a static `_headers` file — the web build output contains `_headers`.
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

Near-term (status decision 9). Gate for every item: the Supabase key migration, HS256 removal and Infisical retirement are complete (credentials before ownership).

- Transfer the repository to the chosen GitHub organization: record reviewers, rulesets, installed Apps and Actions variables first; afterwards re-verify them and update `SECURITY.md`, `packages/engine/Cargo.toml`, `.github/ISSUE_TEMPLATE/config.yml`, `project.yaml` and the git remote; never recreate the old repository name — readback after transfer.
- Organization-governed Cloudflare account: decide the token split ([open decision](cloudflare.md#open-decisions); default: least-privilege tokens for plan read, IaC apply and Wrangler deploy), then issue the tokens. A new account starts with empty Durable Object namespaces and moves custom domains detach-then-attach — token scope readback.
- Decide the IaC tool and split ([open decision](cloudflare.md#open-decisions); default: OpenTofu for account-level resources only, zone, DNS, Pages project and domains, with Wrangler keeping the Worker, Durable Objects and secrets), then implement it: exact pins and a committed lock file, state and variable entries in `.gitignore` before any IaC file, encrypted state, a secretless PR lane (fmt, validate, policy) and plans only in protected environments — the tool's validate command in CI; a reviewed plan before any apply.
- Supabase project into an organization-owned Supabase org (same region; URL, JWKS and keys unchanged), with auth and other non-secret settings as code in plan-only mode and a `supabase/config.toml` parity check — sign-in and room-join readback.
- Google OAuth client into an organization-governed Google Cloud project, in its own change window — sign-in readback.
- Decommission legacy Worker scripts, dormant tokens and personal memberships; legacy keys stay deactivated — readback of the empty inventory.

## 8. Deferred with a trigger

- Durable Object `exports` adoption — a concrete need recorded in status.
- Workers Static Assets instead of Pages — a Pages limitation that matters.
- D1 or R2 — a data need Supabase cannot meet.
- Staging Worker environment in CI with its own Pages preview binding — a real multi-person test need.
- Anonymous sign-in captcha, WebSocket re-authentication and a per-connection message-rate cap — players beyond the family.
- TypeScript 7 — Svelte tooling supports its stable API. pnpm 12 and uv 0.12 — Dependabot supports them.
- DiceBear 10 — `@dicebear/collection` supports it. Python 3.14 support (a CI job first, then the package claim) — an analysis dependency or feature needs 3.14.
- Nine sound-bank sounds with no audio file (playback skips them) — the owner wants them generated with `pnpm audio:gen`.
