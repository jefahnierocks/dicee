# Public project-manifest release

Dicee approves Specification 1 release `1` from [jefahnierocks/project-manifest](https://github.com/jefahnierocks/project-manifest/releases/tag/release-1), source `56e3920089726e585eaa0fd7f4dc94e6938a1e0c`.

`release-1/` is the exact public archive payload, including its MIT license and closed release table. `bootstrap.py` is the separate public bootstrap asset. No private system-config consumer code is included.

| Binding | SHA-256 |
|---|---|
| Domain-separated release table | `f7ff9dd0972af5d3a6a3348c3e092de1a6acd97fa3975e13e522cf80ce5e7df2` |
| Public archive | `d13ab1777f8bc8e70aff9f349c6fe7d37e041bbc10baa52ad6aa7d27b074516e` |
| Public bootstrap | `2ccf58e0da97bbbd9dae173d1cca047d465c4a2d950ee6e56052309a9689cf4f` |

The repository-owned adapter `scripts/check-project-manifest.py` verifies the bootstrap before executing it, verifies every released payload, captures and rechecks the six runtime module byte strings, then imports only those captured bytes. It calls the released observation API once. A reviewed literal approval plus verified bytes plus that actual Git observation establish the declaration verdict; nested library diagnostics retain `complete_v1_validity: not_checked` at their own scope.

Exit 0 means a valid declaration, 1 means a known-invalid declaration, and 2 means unavailable evidence. There is no fallback grammar, download, installed validator discovery, project-command execution, host conformance, producer admission or runtime acceptance. Full gates include the declaration check through `pnpm lint:docs`; `pnpm check:manifest` runs it directly.

Entrypoints use `-I -S -B` to exclude ambient Python paths, site startup hooks and bytecode writes. Use Dicee's pinned Python and native Git 2.56 or later. `DICEE_MANIFEST_PYTHON` selects the prepared interpreter for Node, script-test and direct declaration entrypoints; local mise remains the default. CI explicitly installs/finds the existing Python pin in setup-uv's temporary managed store with no bin shim or job PATH rewrite. Setting `UV_PYTHON` alone does not select shell `python3`. `DICEE_MANIFEST_GIT` may select an absolute native executable; otherwise the adapter selects and resolves `git` from PATH. CI prepares its own checksum-pinned Git prefix and passes that executable only to validation; it does not replace runner tools. CI always observes the exact `GITHUB_SHA` revision. Local checks observe index-tracked worktree paths. A linked worktree must explicitly supply `DICEE_MANIFEST_COMMON_DIR` (or `--git-common-dir`) for its common storage; that authority is never inferred from a target.

Declared roles cover dependency installation, source checks/tests/builds, web development and formatting. The setup task installs dependencies; it does not provision environment values or qualify the template. Empty platform, stack and host-requirement lists make no extra portability or host-readiness claim. Optional `db:*` tasks require a container engine and operator setup; they are outside this command map. Native mise owns activation, the pinned toolchain and non-secret environment loading; optional local overrides follow Dicee's [project activation policy](../../docs/development/toolchain.md#project-activation). Secrets remain in command-scoped launchers.

For example, from an owner-selected linked checkout:

```sh
DICEE_MANIFEST_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir)" pnpm check:manifest
```

Do not modify files in the closed release directory, add bytecode there, or normalize their bytes. Upgrades require review of the public release, literal pins and fixture results together. The Git preparation recipe is adapted from the public MIT origin at `9797b48786f6da0e4e5167a25c2a873e6945269c`; it prepares only Git and disables optional Rust bindings.

Native pre-commit and pre-push hooks use the fixed-command launcher `scripts/manifest-hook.py`. It binds Git's exported gitdir, normal index and exec path to this checkout and the selected native executable before normalizing only those three variables in the gate child. Linked storage authority remains explicit. Alternate/partial-commit indexes, foreign storage, config injections and other reader-forbidden overrides are refused. The direct reader stays strict; the parent Git/signing environment is unchanged. Gate children retain the incoming mise Node/pnpm PATH; selecting a native Git prefix cannot replace their runtime authority.
