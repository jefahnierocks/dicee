---
applyTo: "packages/web/**/*.{svelte,ts}"
---

- Use Svelte 5 runes and the conventions in `AGENTS.md`.
- DOM event properties are lowercase; component callbacks use `onVerb`; internal handlers use `handleVerb`.
- Preserve accessibility semantics and add Testing Library coverage for user-visible behavior.
- Respect AKG import boundaries and run `pnpm akg:check` after boundary changes.
