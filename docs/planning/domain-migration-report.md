# Historical Cloudflare domain-migration planning record

- **Status:** superseded; no operational authority
- **Current Cloudflare entry point:** [`docs/cloudflare/README.md`](../cloudflare/README.md)
- **Current consolidation plan:** [`dicee-cloudflare-resource-guidance.md`](dicee-cloudflare-resource-guidance.md)

The previous document was a session-specific domain migration plan. It contained
obsolete `wrangler.toml` paths plus direct Worker, Pages, DNS deletion, and
deployment commands under a “follow exactly” heading. That executable body was
removed on 2026-07-21 because it conflicted with current configuration,
organization-policy gating, and the repository's remote-operation rules. It
remains recoverable from Git history.

Current source establishes only the desired repository configuration; it does
not prove live DNS, routes, custom-domain, certificate, Pages, or Worker state.
Any future domain change must begin at the Cloudflare authority hub, retrieve
live read-only evidence in an authorized lane, map organization DNS/domain
policy, and produce a reviewed migration and rollback record before mutation.
