---
name: dicee-verify
description: Verify a Dicee change - run targeted checks for the changed paths, then the completion gate, and report any skipped lane with evidence.
---

# Verify a Dicee change

1. List what changed: `git status --short` and `git diff --name-only main...HEAD`.
2. Run the targeted checks for each changed area:

   | Changed path | Command |
   |---|---|
   | `packages/web/` | `pnpm --filter @dicee/web check` and `pnpm --filter @dicee/web test:agent` |
   | `packages/cloudflare-do/` | `pnpm --filter @dicee/cloudflare-do test:agent` |
   | `packages/simulation/` | `pnpm --filter @dicee/simulation test:agent` |
   | `packages/engine/` | `cd packages/engine && env -u RUSTUP_TOOLCHAIN cargo test --all-features` |
   | `packages/analysis/` | `uv run --project packages/analysis --group dev pytest -q packages/analysis` |
   | `supabase/` | `supabase db reset --local && supabase test db` (local stack only) |
   | `packages/cloudflare-do/wrangler.jsonc` | `pnpm --filter @dicee/cloudflare-do types`, `pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run --env=""`, and `pnpm cf:audit` |
   | `packages/web/wrangler.jsonc` | `pnpm --filter @dicee/web types` (or `pnpm check:workers`), `pnpm --filter @dicee/web build`, and `pnpm cf:audit` |
   | docs or agent files | `pnpm lint:docs` |

3. Run the completion gate: `pnpm validate:ci`.
4. Run `git diff --check`.
5. Report each failure with its command and first error. Name any check you could not run and why.

Never deploy, push, apply hosted migrations, or regenerate Supabase types from the live schema while verifying.
