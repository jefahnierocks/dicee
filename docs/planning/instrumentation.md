# Historical Cloudflare observability planning record

- **Status:** superseded; no operational authority
- **Current Cloudflare entry point:** [`docs/cloudflare/README.md`](../cloudflare/README.md)
- **Current consolidation plan:** [`dicee-cloudflare-resource-guidance.md`](dicee-cloudflare-resource-guidance.md)

The previous document described a pre-implementation observability strategy
using obsolete `wrangler.toml` edits, direct production log-tail commands, and
identifier-oriented queries. Its executable body was removed on 2026-07-21
because it predates the current `wrangler.jsonc` configuration, structured
logger, event schemas, identifier-redaction policy, and operator gate. It remains
recoverable from Git history.

Current observability work must derive behavior from:

- `packages/cloudflare-do/wrangler.jsonc`;
- `packages/cloudflare-do/src/lib/logger.ts`;
- `packages/cloudflare-do/src/lib/observability/`;
- their focused tests and generated Worker types; and
- live official Cloudflare documentation retrieved for the task.

Live logs, analytics, traces, Logpush, and GraphQL data remain authorized
operator surfaces and must not expose credentials or personal identifiers.
