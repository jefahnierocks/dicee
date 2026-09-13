# Architecture Knowledge Graph (AKG)

The AKG turns the TypeScript and Svelte import graph into a model the repository can check. It discovers modules, checks them against the layer rules in `akg.config.ts` and the registered invariants, renders Mermaid diagrams, and answers agent queries over MCP.

The tooling lives in `packages/web/src/tools/akg` and runs on Bun. For the system it describes, see the [architecture overview](../README.md).

## Commands

| Command | Effect |
|---|---|
| `pnpm akg:discover` | Scan sources and write `docs/architecture/akg/graph/current.json`, plus a snapshot in the gitignored history directory |
| `pnpm akg:check` | Run the enabled invariants against the committed graph |
| `pnpm akg:mermaid` | Regenerate the diagrams; `pnpm akg:mermaid --check` fails when they are stale |
| `pnpm akg:all` | `akg:discover`, then `akg:mermaid` |
| `pnpm akg:test` | List the seven MCP tools and call six of them over stdio; `akg_cache_status` is not called (`packages/web/src/tools/akg/mcp/test-server.ts`) |
| `pnpm akg:verify` | `akg:check`, `akg:mermaid --check` and `akg:test`; `pnpm lint` runs it |

`pnpm akg:check` flags (`packages/web/src/tools/akg/cli/check.ts`):

- `--only ID,ID` and `--skip ID,ID` select invariants by id. `--list` prints the registered ones.
- `--fail-on-warning` also fails the run on warnings. Errors always fail it.
- `--json` prints the summary as JSON. `--sarif` prints SARIF 2.1.0 for code scanning.
- `--config FILE`, `--graph FILE` and `--verbose` change the inputs and the logging.

After any import or boundary change, run `pnpm akg:discover && pnpm akg:check`; `akg:check` alone validates only the committed graph. Run `pnpm akg:all` and commit the graph and diagrams only when the task changes the architecture; otherwise restore them before committing (`git restore docs/architecture/akg/graph docs/architecture/akg/diagrams`).

## Configuration and layer rules

`akg.config.ts` is loaded by `packages/web/src/tools/akg/config/loader.ts` and validated by `packages/web/src/tools/akg/schema/config.schema.ts`. It sets:

- `discovery`: TypeScript and Svelte files under `packages/web/src`, `packages/shared/src` and `packages/cloudflare-do/src`. Tests, mocks and `node_modules` are excluded.
- `layers`: each layer's paths, `mayImport` list and optional `mayNotImport` list. The table below mirrors them.
- `invariants`: `enable` and `disable` lists of ids, plus per-id severity `overrides`.
- `output`: where the graph and its history are written.

| Layer | Paths | May import | May not import |
|---|---|---|---|
| shared | `packages/shared/src` | nothing | |
| cloudflare-do | `packages/cloudflare-do/src` | shared | |
| routes | `packages/web/src/routes` | components, stores, services, types, wasm, shared | |
| components | `packages/web/src/lib/components` | components, types, shared | stores, services (smart containers are the exception) |
| stores | `packages/web/src/lib/stores` | services, types, supabase, shared | components, routes |
| services | `packages/web/src/lib/services` | types, supabase, wasm, shared | components, routes, stores |
| types | `packages/web/src/lib/types`, `packages/web/src/lib/types.ts` | types, shared | |
| supabase | `packages/web/src/lib/supabase` | types, shared | components, routes, stores, services |
| wasm | `packages/web/src/lib/wasm`, `packages/web/src/lib/engine.ts` | types, shared | other modules import only `packages/web/src/lib/engine.ts` |

## MCP tools

The `akg` server is `packages/web/src/tools/akg/mcp/server.ts`, declared in `.mcp.json`. It reads the graph from `AKG_GRAPH_PATH` and the diagrams from `AKG_DIAGRAMS_PATH`; both default to the committed outputs under `docs/architecture/akg`.

| Tool | Input | Use it to |
|---|---|---|
| `akg_check_import` | `fromPath`, `toPath` | check an import before you write it |
| `akg_layer_rules` | `layer` | see what a layer may and may not import |
| `akg_node_info` | `nodeId` or `filePath` | get a module's type, layer and edges |
| `akg_path_find` | `from`, `to` (node id or file path) | find the shortest import path between two modules |
| `akg_invariant_status` | optional `invariantId` | run the invariants and report pass or fail |
| `akg_diagram` | `name`: layer-overview (default), component-dependencies, store-relationships or dataflow | fetch a Mermaid diagram |
| `akg_cache_status` | optional `reload` | inspect the graph cache, or reload it from disk |

Answers come from the graph file on disk. After changing imports, run `pnpm akg:discover` and then call `akg_cache_status` with `reload` before you trust the answers.

## Authoring invariants

An invariant is a named check over the graph that returns violations.

1. Add a file under `packages/web/src/tools/akg/invariants/definitions` that calls `defineInvariant(definition, check)` from `packages/web/src/tools/akg/invariants/registry.ts`.
2. Import that file in `packages/web/src/tools/akg/invariants/definitions/index.ts` and add its id to `BUILTIN_INVARIANTS`.
3. Run `pnpm akg:check --only your_id`, then `pnpm akg:verify`.
4. Add Vitest cases under `packages/web/src/tools/akg/__tests__`. They run with the web test suite.

**Definition** (`InvariantDefinition` in `packages/web/src/tools/akg/schema/invariant.schema.ts`):

| Field | Rule |
|---|---|
| `id` | snake_case: a lowercase letter, then lowercase letters, digits or underscores |
| `name`, `description` | non-empty |
| `businessRule` | non-empty; says why the rule exists |
| `category` | structural, naming, domain, security or performance |
| `severity` | error, warning or info; a config override can change it |
| `enabledByDefault`, `fixable` | default to true and false |
| `docsUrl` | optional absolute URL, used as the SARIF help link |
| `meta` | optional `added`, `deprecated` and `replacedBy` |

The schema also accepts `include` and `exclude` globs, but the runner does not apply them. Filter nodes inside the check instead.

**Check function.** A check has the signature `(graph, engine) => InvariantViolation[]`.

- Build each violation with `createViolation(invariantId, invariantName, message, sourceNode, severity)`; the severity defaults to warning.
- Add `evidence` entries with `filePath` and `line`, and optionally `column`, `endLine`, `endColumn` and `snippet`. A violation may also carry `suggestion`, `targetNode`, `businessRule` and `context`.

**Query engine** (`packages/web/src/tools/akg/query/engine.ts`) methods:

- nodes and edges: `getNode`, `getNodes(filter)`, `getEdges(filter)`, `getNodesInLayer`, `getNodesByType`;
- neighbors: `getOutgoing`, `getIncoming`, `getDependencies`, `getDependents`;
- edges: `getImportEdges`, `getEdgesByType`, `getEdgesBetween`, `hasEdge`;
- traversal: `isReachable`, `findPath`, `findCycles`;
- the whole graph: `getGraph`, `getStats`.

**Practice.**

- Query through the engine instead of looping over raw graph arrays.
- Name the offending module in the message and give evidence with a line number.
- Choose severity by impact: `error` fails `pnpm akg:check`; `warning` reports without failing.
- Keep ids stable, because config overrides and `--only` refer to them.

**Built-in invariants** (registered in `packages/web/src/tools/akg/invariants/definitions/index.ts`):

| Id | Category | Severity |
|---|---|---|
| `wasm_single_entry` | structural | error |
| `store_no_circular_deps` | structural | error |
| `service_layer_boundaries` | structural | error |
| `shared_isolation` | structural | error |
| `type_schema_consistency` | structural | error |
| `layer_component_isolation` | structural | warning |
| `globallobby_uses_shared` | structural | warning |
| `websocket_uses_shared_validation` | structural | warning |
| `store_file_naming` | naming | error |
| `callback_prop_naming` | naming | warning |

## Generated outputs

- **Graph.** `docs/architecture/akg/graph/current.json` and the snapshots in `docs/architecture/akg/graph/milestones` are committed. History snapshots are gitignored.
- **Diagrams.** `docs/architecture/akg/diagrams` holds LAYER_ARCHITECTURE, COMPONENT_DEPENDENCIES, STORE_DEPENDENCIES and DATAFLOW, each as Markdown and JSON, plus a generated index.
- **Never hand-edit.** Regenerate with `pnpm akg:all`. `pnpm akg:mermaid --check` catches stale diagrams.
- **SARIF.** `pnpm akg:check --sarif` prints SARIF 2.1.0 on stdout. A result that has no evidence points to this file, because code scanning requires a location (`packages/web/src/tools/akg/output/sarif.ts`). A rule links to its `docsUrl` when one is set.
