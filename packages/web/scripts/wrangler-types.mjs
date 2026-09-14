#!/usr/bin/env node
// Generate or check worker-configuration.d.ts independently of build output.
//
// `wrangler types` adds a `mainModule` type only when the `main` entry exists on disk, and
// SvelteKit writes that entry (.svelte-kit/cloudflare/_worker.js) during `vite build`. Types
// would then differ before and after a build, so `types:check` would fail in any checkout
// that has built. This script runs wrangler against a copy of wrangler.jsonc without `main`;
// bindings, compatibility settings and runtime types are unchanged.
//
// Usage: node scripts/wrangler-types.mjs [--check]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const mainLine = /^[ \t]*"main"[ \t]*:[ \t]*"[^"\n]*",?[ \t]*\r?\n/gm;
const source = readFileSync('wrangler.jsonc', 'utf8');
const matches = source.match(mainLine) ?? [];
if (matches.length !== 1) {
	console.error(
		`wrangler-types: expected exactly one "main" line in wrangler.jsonc, found ${matches.length}`,
	);
	process.exit(1);
}

mkdirSync('.svelte-kit', { recursive: true });
const configCopy = '.svelte-kit/wrangler-types.jsonc';
writeFileSync(configCopy, source.replace(mainLine, ''));

const result = spawnSync(
	'wrangler',
	[
		'types',
		'worker-configuration.d.ts',
		`--config=${configCopy}`,
		'--env-file=/dev/null',
		...process.argv.slice(2),
	],
	{ stdio: 'inherit' },
);
process.exit(result.status ?? 1);
