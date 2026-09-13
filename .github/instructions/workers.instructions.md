---
applyTo: "packages/cloudflare-do/**/*.ts"
---

- Follow the Durable Object rules in `AGENTS.md` and keep room/lobby state strongly consistent.
- Use generated `Cloudflare.Env` bindings plus explicit secret-binding types.
- Preserve hibernatable WebSockets, alarms, input validation, and structured observability.
- After `wrangler.jsonc` changes, run `pnpm --filter @dicee/cloudflare-do types` and a Wrangler dry run; never deploy without explicit authority.
