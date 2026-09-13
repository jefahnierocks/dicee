---
name: akg-boundaries
description: Check Dicee architecture layer boundaries before and after changing imports, using the AKG graph.
---

# Check architecture boundaries

1. Before adding an import, check it:
   - With the `akg` MCP server, call `akg_check_import` (from file, to file) or `akg_layer_rules`.
   - Without MCP, read the layer rules in `akg.config.ts`.

   Allowed direction (from `akg.config.ts`): routes -> components, stores, services, types, wasm; components -> components, types; stores -> services, types, supabase; services -> types, supabase, wasm; types, supabase, and wasm -> types. Every web layer may import `shared`; `cloudflare-do` imports only `shared`. Exceptions (smart-container components may import stores; other modules reach the wasm layer only through `packages/web/src/lib/engine.ts`) are in the layer table in `docs/architecture/akg/README.md`.
2. After editing imports, run `pnpm akg:discover && pnpm akg:check`. `akg:check` reads only the committed graph, so discover first.
3. If the architecture changed on purpose, run `pnpm akg:mermaid` and commit the regenerated graph and diagrams with the change. Otherwise restore them before committing: `git restore docs/architecture/akg/graph docs/architecture/akg/diagrams`.
4. Never hand-edit `docs/architecture/akg/graph/` or `docs/architecture/akg/diagrams/`.

Details: `docs/architecture/akg/README.md`.
