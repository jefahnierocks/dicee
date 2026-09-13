# packages/cloudflare-do

- Follow the root `AGENTS.md` Durable Object rules: strongly consistent room/lobby state, hibernatable WebSockets, alarms, validated input, structured observability.
- Use generated `Cloudflare.Env` bindings plus explicit secret-binding types.
- After `wrangler.jsonc` changes: run `pnpm --filter @dicee/cloudflare-do types`, commit `worker-configuration.d.ts`, then run `pnpm --filter @dicee/cloudflare-do exec wrangler deploy --dry-run --env=""` and `pnpm cf:audit`.
- Never deploy, tail, roll back, or set secrets without explicit authority.
