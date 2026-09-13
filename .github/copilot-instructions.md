# GitHub Copilot instructions

`AGENTS.md` is the repository authority. Read it before generating or changing code.

- Match nearby patterns and keep changes scoped.
- Use pnpm catalog dependencies and pinned runtimes; do not introduce npm or yarn lockfiles.
- Keep tests deterministic and update focused tests with behavior changes.
- Do not deploy, migrate, write remote data, change secrets, or regenerate live Supabase types without explicit operator authority.
- Run targeted checks while iterating and `pnpm validate:ci` before handing off a substantial change.
