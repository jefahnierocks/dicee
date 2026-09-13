# packages/web

- Use Svelte 5 runes and the root `AGENTS.md` conventions: lowercase DOM event properties, `onVerb` callback props, `handleVerb` handlers.
- Preserve accessibility semantics and add Testing Library coverage for user-visible behavior.
- Respect AKG import boundaries: after import changes run `pnpm akg:discover && pnpm akg:check`; if the architecture change was not intended, `git restore docs/architecture/akg/graph docs/architecture/akg/diagrams` before committing.
