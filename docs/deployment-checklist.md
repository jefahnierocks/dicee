# Dicee Cloudflare deployment guidance

- **Status:** superseded checklist retained as a safe pointer
- **Operational authority:** none
- **Replacement tracked by:** [`docs/planning/dicee-cloudflare-resource-guidance.md`](planning/dicee-cloudflare-resource-guidance.md)

The previous contents described an obsolete automatic-deployment,
`wrangler.toml`, named-production-environment, secret, permission, and rollback
model. Those executable instructions were removed on 2026-07-21 because they
conflicted with current repository configuration and agent safety rules. The old
text remains recoverable from Git history.

Start at [`docs/cloudflare/README.md`](cloudflare/README.md). Current deployment
structure is expressed by `.github/workflows/ci.yml`, the package scripts, and
the two `wrangler.jsonc` files, but repository configuration is not evidence of
live Cloudflare state.

## Current repository facts

- Validation runs on pushes and pull requests.
- Production deployment is available only through an explicit manual workflow
  dispatch in the current working tree.
- The Durable Objects Worker deploy precedes the Pages deployment because the
  web application depends on its Service Binding.
- Both deployment jobs target the GitHub `Production` environment.
- Live deployment, secrets, migrations, routes, and rollback remain
  operator-gated.

## Blockers before an authoritative runbook can be published

1. Incorporate the applicable organization Cloudflare, DNS, token, environment,
   approval, and infrastructure-as-code policies.
2. Download and compare the live Pages configuration with the repository before
   the first configuration-driven Pages deployment.
3. Confirm the deployed Durable Object namespace/migration history before the
   first live declarative-`exports` deployment; lifecycle changes cannot use a
   gradual rollout or an ordinary rollback across the transition.
4. Resolve the runtime-secret custody mismatch between the documented
   Infisical/1Password model and the GitHub Environment secrets consumed by CI.
5. Protect the GitHub `Production` environment and main branch according to the
   accepted organization policy.
6. Define and test environment-specific deployment, smoke-test, failure,
   rollback, and incident procedures without exposing credentials or personal
   identifiers.
7. Decide the candidate target architecture in the consolidation plan before
   adding OpenTofu, D1, R2, new Worker identities, or custom-domain ownership.

Until these blockers are resolved, no document in this repository should be
used as a copy-paste production deployment or rollback runbook.
