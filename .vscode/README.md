# VS Code workspace

Open Dicee's repository root. The project owns these settings; no named user
profile or user-global MCP entry is required. Workspace trust, extension
installation and MCP startup remain operator choices.

The workspace TypeScript SDK comes from `packages/web/node_modules/typescript/lib`.
Use the workspace version after installing dependencies with
`pnpm install --frozen-lockfile`; the exact version belongs to the pnpm catalog,
not this document. Language-specific settings choose Biome for JavaScript,
TypeScript, JSON and Svelte, rust-analyzer for Rust, and Ruff for Python.
The Svelte extension provides language support; formatting follows the existing
Biome configuration without enabling experimental full HTML formatting.

Python's interpreter hint points to the analysis package's `.venv` directory,
which `uv run --project packages/analysis` manages with the project Python pin.
If an existing workspace has selected another interpreter, select the analysis
environment explicitly; the hint does not override a stored selection.

The tasks invoke existing root commands through `mise exec`: toolchain versions,
checks, and the CI validation gate. They contain no deployment or credential
steps. Start the editor from a shell with the workstation's mise shims available
so language servers also inherit the project runtime selection.

The native MCP file enables only the local `akg` server and unauthenticated
`cloudflare-docs`. It contains no provider account or authentication data.
Provider access follows the separate authority rules in
[agent-clients.md](../docs/development/agent-clients.md).

See [toolchain.md](../docs/development/toolchain.md) for pins and the
[Python settings reference](https://code.visualstudio.com/docs/python/settings-reference)
for interpreter selection behavior.
