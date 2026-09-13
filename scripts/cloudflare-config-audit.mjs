#!/usr/bin/env node
/**
 * cloudflare-config-audit.mjs — offline static audit of Dicee's Wrangler configuration.
 *
 * WHAT THIS CHECKS
 *   packages/cloudflare-do/wrangler.jsonc  (the `dicee` Durable Object Worker)
 *     B1  workers_dev is explicitly false, and no named environment overrides it
 *     B1P preview_urls is explicitly false, and no named environment overrides it
 *     B2  exactly one Durable Object lifecycle mode is declared: `migrations` or `exports`
 *     B3  that mode is the one ADR-005 authorises (docs/rfcs/adr-005-durable-object-lifecycle.md):
 *         `migrations` while ADR-005 is not accepted; the ADR's declared **Lifecycle mode:**
 *         once it is accepted
 *     B3E lifecycle keys are declared only at the top level (both are inheritable)
 *     B2H migrations mode: the array begins with the already-applied history, unedited
 *     B2N migrations mode: no unapplied lifecycle step is pending                (advisory)
 *     B2S every declared Durable Object class is SQLite-backed
 *     B4  every durable_objects binding (top level and each environment) resolves to a declared class
 *     B4R every declared Durable Object class has a binding in this Worker       (advisory)
 *     B5  every non-inherited key present at top level is repeated in each named environment
 *     B6  inheritable keys are NOT duplicated into named environments
 *     B7  every name in secrets.required is referenced somewhere in packages/cloudflare-do/src
 *     B8  every secret read as `env.NAME` in src is declared in secrets.required
 *     B9  secrets.required is identical across top level and every named environment
 *     B10 every declared Durable Object class is named in an export of src/worker.ts
 *     B11 every `vars` key is read as `env.NAME` somewhere in src            (advisory)
 *
 *   packages/web/wrangler.jsonc  (the `dicee` Pages project)
 *     F1  declares none of: durable_objects, d1_databases, r2_buckets, kv_namespaces,
 *         ai, exports, queues  — the frontend's only backend reach is its service binding
 *     F2  every services[].service value names a Worker the backend config declares
 *         (top-level binding: strict equality with the backend's top-level `name`)
 *     F3  exactly one service binding, at the top level and in each named environment
 *     F4  no route / routes / custom_domain key — ingress stays explicit
 *     F5  every non-inherited key present at top level is repeated in each named environment
 *     F7  the `preview` environment is not bound to the production service     (advisory)
 *
 *   both files
 *     X1  no hardcoded Cloudflare account id or API token literal
 *     X2  no wrangler.toml beside either wrangler.jsonc (working tree)
 *     G1  both wrangler.jsonc files are tracked by git                        (advisory)
 *
 * WHY
 *   None of these invariants is covered by any test, lint rule, or CI step in this
 *   repository today. `pnpm validate` cannot detect workers_dev or preview_urls flipping to
 *   true, the Durable Object lifecycle mode drifting away from what ADR-005 authorises, an
 *   applied migration tag being edited, a storage binding being added to the frontend, or a
 *   secret being read in source but never declared. This script turns those from
 *   reviewer memory into a command.
 *
 * WHAT THIS IS NOT
 *   Read-only and fully offline. It opens no sockets, reads no credential, and imports
 *   nothing from node_modules — Node built-ins only. It inspects repository
 *   *configuration*, which is never evidence of live Cloudflare state. It cannot tell you
 *   whether the Worker is deployed, which secrets are actually set, what Durable Object
 *   namespaces exist, or whether any route is attached. Those are operator-only checks
 *   against the live account.
 *
 *   One exception to "no subprocess": G1 shells out to `git ls-files` (read-only, no
 *   network, no credentials) to answer whether the configs are tracked. It runs only when
 *   a .git directory is present and degrades to a warn if git is unavailable. Nothing else
 *   in this script spawns anything.
 *
 * WHICH STATE EACH CHECK ASSERTS OVER — read this before believing an X2 or G1 result
 *   Every check except G1 reads the WORKING TREE, not HEAD. That distinction is load-
 *   bearing right now, because the two states disagree:
 *     working tree — packages/{cloudflare-do,web}/wrangler.jsonc exist; both
 *                    wrangler.toml files are deleted. X2 therefore PASSES today.
 *     HEAD         — the opposite: both wrangler.toml files are tracked and neither
 *                    wrangler.jsonc is. A run against a fresh actions/checkout would fail
 *                    B0/F0 (no config to read) and X2 (wrangler.toml present).
 *   G1 is the only check that looks at git, and it exists precisely to surface that gap:
 *   it warns while the .jsonc files are untracked. X2 passing and G1 warning at the same
 *   time is the expected, correct reading of today's repository — not a contradiction.
 *
 * SEVERITY MODEL
 *   error  must fix — exits non-zero always
 *   warn   advisory — exits non-zero only under --strict
 *   pass   satisfied
 *   Without --strict this script exits 0 on the repository's current configuration, so it
 *   can be adopted without disturbing the existing gate.
 *
 * WIRING IT INTO A GATE LATER  (read this before adding a CI step)
 *   Both wrangler.jsonc files are currently UNTRACKED. `git ls-tree -r HEAD` contains only
 *   packages/{cloudflare-do,web}/wrangler.toml. GitHub Actions runs actions/checkout, which
 *   materialises HEAD — so a CI step added today would find no wrangler.jsonc to read and
 *   would fail on its first run no matter how clean the working tree is. Local green is not
 *   evidence of CI green.
 *   Order of adoption:
 *     1. commit both wrangler.jsonc files and remove the staged-deleted wrangler.toml files
 *     2. then add `node scripts/cloudflare-config-audit.mjs` to CI (non-strict first)
 *     3. a lefthook pre-commit entry globbed to packages/{web,cloudflare-do}/wrangler.jsonc
 *        will not fire while those files are unstaged — glob-scoped hooks match staged paths
 *     4. promote to --strict only once every warn-severity finding is resolved or retired
 *   Adding it to `pnpm validate` is deliberately left to the primary agent; this script does
 *   not modify package.json.
 *
 * USAGE
 *   node scripts/cloudflare-config-audit.mjs            # advisory, exit 0 unless an error
 *   node scripts/cloudflare-config-audit.mjs --strict   # warnings also exit non-zero
 *   node scripts/cloudflare-config-audit.mjs --json     # machine-readable, deterministic
 *   node scripts/cloudflare-config-audit.mjs --self-test # prove the JSONC reader
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const BACKEND_CONFIG = 'packages/cloudflare-do/wrangler.jsonc';
const FRONTEND_CONFIG = 'packages/web/wrangler.jsonc';
const BACKEND_SRC = 'packages/cloudflare-do/src';
const BACKEND_ENTRY = 'packages/cloudflare-do/src/worker.ts';
const LEGACY_TOML = ['packages/cloudflare-do/wrangler.toml', 'packages/web/wrangler.toml'];
const ADR_005 = 'docs/rfcs/adr-005-durable-object-lifecycle.md';

/* ────────────────────────────────────────────────────────────────────────────
 * Durable Object lifecycle mode
 *
 * Wrangler accepts two mutually exclusive ways to declare Durable Object classes:
 * the legacy `migrations` array and the declarative `exports` map. Moving a deployed
 * Worker from `migrations` to `exports` is a one-way door (no return to `migrations`,
 * no rollback across the change), so which mode the config may carry is an
 * architecture decision owned by ADR-005, not a config preference.
 *
 *   ADR-005 not accepted  -> `migrations` is the only permitted mode (owner decision,
 *                            2026-09-12: the baseline keeps the applied v1/v2 history;
 *                            `exports` is deferred to a standalone operator deploy).
 *   ADR-005 accepted      -> the mode named on the ADR's `**Lifecycle mode:**` line.
 *
 * APPLIED_MIGRATIONS is the history HEAD's wrangler.toml applied
 * (`git show 2c3e875:packages/cloudflare-do/wrangler.toml`, lines 26-32, repeated
 * under [env.production] at 60-66). It is repository history, not live state: which
 * script carries which migration tag is an operator question (OPS-02, OPS-04).
 * Wrangler uploads only the steps after the tag the live script already carries, so
 * editing or reordering an applied step silently changes what a deploy would send.
 * Append a new tag here only after the operator deploy that applies it.
 * ──────────────────────────────────────────────────────────────────────────── */

const APPLIED_MIGRATIONS = [
	{ tag: 'v1', new_sqlite_classes: ['GameRoom'] },
	{ tag: 'v2', new_sqlite_classes: ['GlobalLobby'] },
];

const LIFECYCLE_KEYS = ['migrations', 'exports'];

/* ────────────────────────────────────────────────────────────────────────────
 * Wrangler environment inheritance
 *
 * Both config files carry keys at the top level and repeat some of them inside
 * `env.*`. Getting this backwards in either direction is a real failure mode:
 * omitting a NON-inherited key from a named environment silently drops that
 * binding for that environment, and duplicating an INHERITED key is a redundant
 * "fix" that future readers then have to maintain in lockstep.
 *
 * Sources, in the authority order this repository uses:
 *   1. developers.cloudflare.com/workers/wrangler/configuration/ (retrieved
 *      2026-07-22) enumerates non-inheritable keys as: define, vars,
 *      durable_objects, kv_namespaces, r2_buckets, ai_search_namespaces,
 *      ai_search, vectorize, services, queues, workflows, tail_consumers,
 *      secrets, secrets_store_secrets — and inheritable keys as including
 *      exports, observability, workers_dev, preview_urls, compatibility_date,
 *      compatibility_flags, main, name, routes, migrations, assets, placement,
 *      limits, logpush.
 *   2. The installed wrangler 4.113.0 normalizer registers the same keys via
 *      notInheritable(...) / inheritable(...), and additionally marks `ai`,
 *      `d1_databases`, `hyperdrive`, `browser` and `analytics_engine_datasets`
 *      as notInheritable — none of which appear in the docs page's enumerated
 *      list. The docs list is therefore not exhaustive.
 *
 * `ai` is treated as conclusive (STRICT tier): the installed normalizer marks it
 * notInheritable AND that was reproduced empirically — deleting `ai` from
 * env.staging in a scratch copy made wrangler emit "…\"ai\" is not inherited by
 * environments" and drop the AI binding from the resolved binding table.
 *
 * The remaining installed-only keys sit in the ADVISORY tier: the installed
 * schema is authoritative for what THIS repo runs but never for current upstream,
 * they are absent from the published enumeration, and no empirical reproduction
 * was performed for them. They are reported at warn severity with that caveat.
 * All of them are absent from both configs today, so the distinction is currently
 * academic — it exists so the check does not over-claim if one is added later.
 * ──────────────────────────────────────────────────────────────────────────── */

const NON_INHERITED_STRICT = [
	'define',
	'vars',
	'durable_objects',
	'kv_namespaces',
	'r2_buckets',
	'ai_search',
	'ai_search_namespaces',
	'vectorize',
	'services',
	'queues',
	'workflows',
	'tail_consumers',
	'secrets',
	'secrets_store_secrets',
	'ai',
];

const NON_INHERITED_ADVISORY = [
	'd1_databases',
	'hyperdrive',
	'browser',
	'analytics_engine_datasets',
];

const INHERITED_KEYS = [
	'name',
	'main',
	'compatibility_date',
	'compatibility_flags',
	'workers_dev',
	'preview_urls',
	'route',
	'routes',
	'observability',
	'exports',
	'migrations',
	'assets',
	'placement',
	'limits',
	'logpush',
	'pages_build_output_dir',
];

/**
 * Ingress keys that must not appear in the frontend config.
 *
 * The Pages project's hostnames are attached out-of-band; declaring a route here would
 * make ingress implicit and split-brained across two places. Adding any of these is a
 * CF-D07 decision, not a config tweak.
 */
const FRONTEND_INGRESS_KEYS = ['route', 'routes', 'custom_domain'];

/** Bindings that must never appear in the frontend config. */
const FRONTEND_FORBIDDEN = [
	'durable_objects',
	'd1_databases',
	'r2_buckets',
	'kv_namespaces',
	'ai',
	'exports',
	'queues',
];

/** Config paths whose string leaves are NAMES, not credential values. */
const NAME_ONLY_LEAF_PATHS = [
	/^secrets\.required(\.|$)/,
	/^env\.[^.]+\.secrets\.required(\.|$)/,
	/^compatibility_flags(\.|$)/,
];

/* ────────────────────────────────────────────────────────────────────────────
 * JSONC reader
 *
 * Both config files use // comments AND carry trailing prose comments after the
 * closing brace, so JSON.parse cannot be used directly. A regex strip is not safe
 * here: a naive /\/\/.*$/ would truncate any string containing "//" — the classic
 * case being a URL, and this repo already stores path-like values such as
 * "./node_modules/wrangler/config-schema.json".
 *
 * This is a character state machine that tracks string literals (with backslash
 * escapes), line comments, block comments, and brace depth. It returns only the
 * first top-level JSON value, discarding anything after it. Newlines inside block
 * comments are preserved so JSON.parse error line numbers stay meaningful.
 * Trailing commas are removed, but only when the comma was emitted outside a
 * string literal.
 *
 * A leading U+FEFF byte-order mark is dropped before anything else. Neither config
 * carries one today, but an editor or a Windows tool can add one invisibly, and the
 * resulting JSON.parse failure ("Unexpected token") points at nothing a reader can
 * see. Stripping it costs one comparison.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * @param {string} raw raw file contents
 * @returns {string} a strict-JSON string containing only the first top-level value
 */
export function stripJsonc(raw) {
	// BOM: only meaningful at offset 0. A U+FEFF anywhere else is a legal character
	// inside a string literal and is left alone.
	const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

	/** @type {string[]} */
	const out = [];
	/** indices in `out` that originated inside a string literal */
	const inStringIdx = new Set();

	let i = 0;
	let depth = 0;
	let started = false;

	while (i < text.length) {
		const c = text[i];
		const next = text[i + 1];

		// line comment — consume to end of line, leave the newline itself
		if (c === '/' && next === '/') {
			i += 2;
			while (i < text.length && text[i] !== '\n') i++;
			continue;
		}

		// block comment — consume through the terminator, keeping newlines
		if (c === '/' && next === '*') {
			i += 2;
			while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
				if (text[i] === '\n') out.push('\n');
				i++;
			}
			i += 2; // skip the closing */ (a no-op if unterminated)
			continue;
		}

		// string literal — copy verbatim, including anything that looks like a comment
		if (c === '"') {
			out.push('"');
			i++;
			while (i < text.length) {
				const ch = text[i];
				if (ch === '\\') {
					inStringIdx.add(out.length);
					out.push(ch);
					i++;
					if (i < text.length) {
						inStringIdx.add(out.length);
						out.push(text[i]);
						i++;
					}
					continue;
				}
				if (ch === '"') {
					out.push('"');
					i++;
					break;
				}
				inStringIdx.add(out.length);
				out.push(ch);
				i++;
			}
			continue;
		}

		if (c === '{' || c === '[') {
			depth++;
			started = true;
		} else if (c === '}' || c === ']') {
			depth--;
			if (started && depth === 0) {
				out.push(c);
				break; // first top-level value complete; ignore trailing content
			}
		}

		out.push(c);
		i++;
	}

	// trailing commas: a comma emitted outside a string, followed only by
	// whitespace and then a closing brace or bracket emitted outside a string
	for (let k = out.length - 1; k >= 0; k--) {
		if (out[k] !== ',' || inStringIdx.has(k)) continue;
		let j = k + 1;
		while (j < out.length && /\s/.test(out[j]) && !inStringIdx.has(j)) j++;
		if (j < out.length && (out[j] === '}' || out[j] === ']') && !inStringIdx.has(j)) {
			out[k] = ' ';
		}
	}

	return out.join('');
}

/* ──────────────────────────────────────────────────────────────────────────── */

/** @typedef {{id: string, status: 'pass'|'warn'|'error', file: string, message: string, note?: string}} Finding */

/** @type {Finding[]} */
const findings = [];

/**
 * @param {string} id
 * @param {'pass'|'warn'|'error'} status
 * @param {string} file
 * @param {string} message
 * @param {string} [note]
 */
function record(id, status, file, message, note) {
	findings.push(note ? { id, status, file, message, note } : { id, status, file, message });
}

/**
 * Record a pass when `ok`, otherwise a finding at `severity`.
 * @param {string} id
 * @param {boolean} ok
 * @param {'warn'|'error'} severity
 * @param {string} file
 * @param {string} passMessage
 * @param {string} failMessage
 * @param {string} [note]
 */
function assert(id, ok, severity, file, passMessage, failMessage, note) {
	if (ok) record(id, 'pass', file, passMessage);
	else record(id, severity, file, failMessage, note);
}

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Read and parse a JSONC config.
 * @param {string} relPath
 * @returns {{ok: true, data: any, raw: string} | {ok: false, reason: string}}
 */
function loadConfig(relPath) {
	const abs = join(ROOT, relPath);
	if (!existsSync(abs)) return { ok: false, reason: 'file not found' };
	let raw;
	try {
		raw = readFileSync(abs, 'utf8');
	} catch (err) {
		return { ok: false, reason: `unreadable: ${err.message}` };
	}
	try {
		const data = JSON.parse(stripJsonc(raw));
		if (!isPlainObject(data)) return { ok: false, reason: 'top-level value is not an object' };
		return { ok: true, data, raw };
	} catch (err) {
		return { ok: false, reason: `JSONC parse failed: ${err.message}` };
	}
}

/** Recursively collect .ts source files, excluding tests. */
function collectSources(absDir, acc = []) {
	let entries;
	try {
		entries = readdirSync(absDir, { withFileTypes: true });
	} catch {
		return acc;
	}
	for (const entry of entries) {
		const abs = join(absDir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
			collectSources(abs, acc);
			continue;
		}
		if (!entry.isFile()) continue;
		if (!entry.name.endsWith('.ts')) continue;
		if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')) continue;
		if (statSync(abs).size > 4 * 1024 * 1024) continue;
		acc.push(abs);
	}
	return acc;
}

/** Named environments of a config, as [name, block] pairs. */
function namedEnvs(config) {
	if (!isPlainObject(config.env)) return [];
	return Object.entries(config.env).filter(([, block]) => isPlainObject(block));
}

/* ─────────────────────── pure helpers (self-tested below) ────────────────── */

/**
 * Blank out comments and string/template literals in TypeScript source.
 *
 * Only used to find `export` statements, so string *contents* are irrelevant and are
 * replaced with whitespace — which also means a string containing the text "export {"
 * can never be mistaken for a real export. Newlines are preserved.
 *
 * Known limitation: a regular-expression literal containing a bare `//` sequence would
 * be misread as a line comment. packages/cloudflare-do/src/worker.ts contains one regex
 * literal (`/^\/room\/([A-Z0-9]{6})$/i`) and it has no such sequence; the self-test
 * asserts the real file still yields both Durable Object class names.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripTsComments(source) {
	/** @type {string[]} */
	const out = [];
	let i = 0;
	while (i < source.length) {
		const c = source[i];
		const next = source[i + 1];

		if (c === '/' && next === '/') {
			i += 2;
			while (i < source.length && source[i] !== '\n') i++;
			continue;
		}
		if (c === '/' && next === '*') {
			i += 2;
			while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
				if (source[i] === '\n') out.push('\n');
				i++;
			}
			i += 2;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			out.push(' ');
			i++;
			while (i < source.length) {
				if (source[i] === '\\') {
					i += 2;
					continue;
				}
				if (source[i] === c) {
					i++;
					break;
				}
				if (source[i] === '\n') out.push('\n');
				i++;
			}
			out.push(' ');
			continue;
		}

		out.push(c);
		i++;
	}
	return out.join('');
}

/**
 * Names this module makes available to the Workers runtime.
 *
 * A Durable Object declared in `exports` but not actually exported from the entry
 * module is a deploy-time failure at best and a 500 on first instantiation at worst,
 * and neither `svelte-check` nor `tsc` notices, because `wrangler.jsonc` is not a
 * TypeScript input.
 *
 * @param {string} source raw worker entry source
 * @returns {{names: Set<string>, wildcard: boolean}} wildcard is true when an
 *   `export * from` re-export makes the set non-exhaustive
 */
export function parseWorkerExports(source) {
	const code = stripTsComments(source);
	/** @type {Set<string>} */
	const names = new Set();

	// export { A, B as C, type D }   — including `export { … } from './x'`
	for (const clause of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
		for (const piece of clause[1].split(',')) {
			const trimmed = piece.trim();
			if (trimmed === '') continue;
			const parts = trimmed.split(/\s+as\s+/);
			const name = (parts.length > 1 ? parts[parts.length - 1] : parts[0])
				.replace(/^type\s+/, '')
				.trim();
			if (name !== '') names.add(name);
		}
	}

	// export class Foo / export const foo / export async function foo …
	for (const decl of code.matchAll(
		/\bexport\s+(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
	)) {
		names.add(decl[1]);
	}

	return { names, wildcard: /\bexport\s*\*/.test(code) };
}

/**
 * Every block that can carry bindings: the top level plus each named environment.
 * @param {any} config
 * @returns {{path: string, block: any}[]}
 */
function bindingBlocks(config) {
	return [
		{ path: '(top level)', block: config },
		...namedEnvs(config).map(([name, block]) => ({ path: `env.${name}`, block })),
	];
}

/**
 * Service bindings declared anywhere in a config.
 * @param {any} config
 * @returns {{path: string, blockPath: string, binding: unknown, service: unknown}[]}
 */
export function serviceBindings(config) {
	const out = [];
	for (const { path, block } of bindingBlocks(config)) {
		if (!Array.isArray(block.services)) continue;
		block.services.filter(isPlainObject).forEach((svc, idx) => {
			out.push({
				path: `${path === '(top level)' ? '' : `${path}.`}services[${idx}]`,
				blockPath: path,
				binding: svc.binding,
				service: svc.service,
			});
		});
	}
	return out;
}

/**
 * Plain `vars` keys declared anywhere in a config, mapped to the paths declaring them.
 * @param {any} config
 * @returns {Map<string, string[]>}
 */
export function declaredVars(config) {
	/** @type {Map<string, string[]>} */
	const out = new Map();
	for (const { path, block } of bindingBlocks(config)) {
		if (!isPlainObject(block.vars)) continue;
		for (const key of Object.keys(block.vars)) {
			const prefix = path === '(top level)' ? '' : `${path}.`;
			out.set(key, [...(out.get(key) ?? []), `${prefix}vars.${key}`]);
		}
	}
	return out;
}

/**
 * Every Worker name this backend config can resolve to.
 *
 * Wrangler deploys a named environment as `{name}-{envName}` unless the environment
 * block overrides `name` itself. So a config with top-level name "dicee" and
 * environments development/staging can legitimately produce three Worker names. A
 * service binding must target one of them; anything else names a Worker that this
 * repository never declares.
 *
 * @param {any} config parsed backend config
 * @returns {{top: string | null, all: Set<string>}}
 */
export function resolvableWorkerNames(config) {
	const base = typeof config.name === 'string' && config.name !== '' ? config.name : null;
	if (base === null) return { top: null, all: new Set() };
	const all = new Set([base]);
	for (const [envName, block] of namedEnvs(config)) {
		all.add(
			typeof block.name === 'string' && block.name !== '' ? block.name : `${base}-${envName}`,
		);
	}
	return { top: base, all };
}

/**
 * Occurrences of any of `keys` at the top level or inside a named environment.
 * @param {any} config
 * @param {string[]} keys
 * @returns {string[]} dotted paths
 */
export function keyOccurrences(config, keys) {
	const hits = [];
	for (const key of keys) {
		for (const { path, block } of bindingBlocks(config)) {
			if (key in block) hits.push(path === '(top level)' ? key : `${path}.${key}`);
		}
	}
	return hits;
}

/** @param {unknown} v */
const stringList = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);

/**
 * Which Durable Object lifecycle mode a config declares.
 *
 * Mirrors wrangler 4.113.0 `errorIfMigrationsAndExportsBothSet`: `exports` counts only
 * when it carries at least one `durable-object` entry, so a Worker-entrypoint-only
 * `exports` map may coexist with `migrations`.
 *
 * @param {any} config
 * @returns {{mode: 'migrations'|'exports'|'both'|'none', migrations: any[], doExports: string[], envPaths: string[]}}
 */
export function lifecycleMode(config) {
	const migrations = Array.isArray(config.migrations) ? config.migrations : [];
	const exportsMap = isPlainObject(config.exports) ? config.exports : {};
	const doExports = Object.keys(exportsMap).filter(
		(k) => isPlainObject(exportsMap[k]) && exportsMap[k].type === 'durable-object',
	);
	const hasMigrations = migrations.length > 0;
	const hasExports = doExports.length > 0;
	/** @type {'migrations'|'exports'|'both'|'none'} */
	let mode = 'none';
	if (hasMigrations && hasExports) mode = 'both';
	else if (hasMigrations) mode = 'migrations';
	else if (hasExports) mode = 'exports';

	/** @type {string[]} */
	const envPaths = [];
	for (const [envName, block] of namedEnvs(config)) {
		for (const key of LIFECYCLE_KEYS) if (key in block) envPaths.push(`env.${envName}.${key}`);
	}
	return { mode, migrations, doExports, envPaths };
}

/**
 * Durable Object classes left live by a `migrations` array, with their storage backend.
 *
 * `new_sqlite_classes` -> sqlite; `new_classes` -> kv (the legacy key-value backend);
 * `renamed_classes` carries the backend across; `transferred_classes` targets are
 * recorded as unknown; `deleted_classes` removes.
 *
 * @param {any[]} migrations
 * @returns {Map<string, 'sqlite'|'kv'|'unknown'>}
 */
export function migrationClasses(migrations) {
	/** @type {Map<string, 'sqlite'|'kv'|'unknown'>} */
	const live = new Map();
	for (const step of migrations) {
		if (!isPlainObject(step)) continue;
		for (const name of stringList(step.new_sqlite_classes)) live.set(name, 'sqlite');
		for (const name of stringList(step.new_classes)) live.set(name, 'kv');
		for (const r of Array.isArray(step.renamed_classes) ? step.renamed_classes : []) {
			if (!isPlainObject(r) || typeof r.from !== 'string' || typeof r.to !== 'string') continue;
			live.set(r.to, live.get(r.from) ?? 'unknown');
			live.delete(r.from);
		}
		for (const t of Array.isArray(step.transferred_classes) ? step.transferred_classes : []) {
			if (isPlainObject(t) && typeof t.to === 'string') live.set(t.to, 'unknown');
		}
		for (const name of stringList(step.deleted_classes)) live.delete(name);
	}
	return live;
}

/**
 * A migration step with its keys in a stable order, for exact comparison.
 * @param {any} step
 */
function canonicalStep(step) {
	return JSON.stringify(
		Object.keys(step)
			.sort()
			.map((k) => [k, step[k]]),
	);
}

/**
 * Differences between the declared `migrations` array and the already-applied history.
 * The applied history must be an exact prefix; steps after it are not reported here.
 *
 * @param {any[]} migrations
 * @param {{tag: string}[]} [applied]
 * @returns {string[]} one message per mismatched or missing applied step
 */
export function appliedHistoryMismatch(migrations, applied = APPLIED_MIGRATIONS) {
	/** @type {string[]} */
	const problems = [];
	applied.forEach((expected, idx) => {
		const actual = migrations[idx];
		if (!isPlainObject(actual)) {
			problems.push(`migrations[${idx}] is missing (applied tag "${expected.tag}")`);
		} else if (canonicalStep(actual) !== canonicalStep(expected)) {
			problems.push(
				`migrations[${idx}] is ${JSON.stringify(actual)}, applied history is ${JSON.stringify(expected)}`,
			);
		}
	});
	return problems;
}

/**
 * Read the status and declared lifecycle mode from ADR-005's header.
 *
 * @param {string} markdown
 * @returns {{status: string | null, accepted: boolean, declaredMode: 'migrations'|'exports'|null}}
 */
export function parseAdrLifecycle(markdown) {
	const statusMatch = markdown.match(/^\*\*ADR Status:\*\*[ \t]*(.+?)[ \t]*$/m);
	const status = statusMatch ? statusMatch[1] : null;
	const modeMatch = markdown.match(/^\*\*Lifecycle mode:\*\*[ \t]*`?(migrations|exports)`?/m);
	return {
		status,
		accepted: status !== null && /^accepted\b/i.test(status),
		declaredMode: modeMatch ? /** @type {'migrations'|'exports'} */ (modeMatch[1]) : null,
	};
}

/**
 * The lifecycle mode ADR-005 authorises right now.
 *
 * @param {{status: string | null, accepted: boolean, declaredMode: 'migrations'|'exports'|null} | null} adr
 *   null when the ADR file could not be read
 * @returns {{mode: 'migrations'|'exports'|null, reason: string}}
 */
export function expectedLifecycleMode(adr) {
	if (adr === null) return { mode: null, reason: `${ADR_005} could not be read` };
	if (adr.status === null) return { mode: null, reason: `${ADR_005} has no **ADR Status:** line` };
	if (!adr.accepted) {
		return {
			mode: 'migrations',
			reason: `ADR-005 status is "${adr.status}" — not accepted, so only the baseline \`migrations\` mode is authorised`,
		};
	}
	if (adr.declaredMode === null) {
		return {
			mode: null,
			reason: 'ADR-005 is accepted but its header declares no **Lifecycle mode:** line',
		};
	}
	return {
		mode: adr.declaredMode,
		reason: `ADR-005 is accepted and declares **Lifecycle mode:** \`${adr.declaredMode}\``,
	};
}

/**
 * Blocks that expose `key` as anything other than `false`. The top level must set it
 * explicitly; a named environment is flagged only when it overrides the inherited value.
 *
 * @param {any} config
 * @param {'workers_dev'|'preview_urls'} key
 * @returns {string[]} dotted `path=value` descriptions
 */
export function subdomainExposure(config, key) {
	return bindingBlocks(config)
		.filter(({ path, block }) =>
			path === '(top level)' ? block[key] !== false : key in block && block[key] !== false,
		)
		.map(
			({ path, block }) =>
				`${path === '(top level)' ? key : `${path}.${key}`}=${JSON.stringify(block[key]) ?? 'unset'}`,
		);
}

/**
 * Shared inheritance check. Non-inherited keys present at top level must be
 * repeated in every named environment, or they are simply absent there.
 * @param {string} prefix assertion id prefix
 * @param {any} config
 * @param {string} file
 */
function checkEnvInheritance(prefix, config, file) {
	const envs = namedEnvs(config);

	for (const [tier, keys, severity] of [
		['strict', NON_INHERITED_STRICT, 'error'],
		['advisory', NON_INHERITED_ADVISORY, 'warn'],
	]) {
		const present = keys.filter((k) => k in config);
		/** @type {string[]} */
		const missing = [];
		for (const [envName, block] of envs) {
			for (const key of present) {
				if (!(key in block)) missing.push(`env.${envName}.${key}`);
			}
		}
		const id = tier === 'strict' ? `${prefix}5` : `${prefix}5A`;
		const scope =
			present.length === 0
				? 'no such keys at top level'
				: `${present.length} key(s) x ${envs.length} env(s)`;

		assert(
			id,
			missing.length === 0,
			/** @type {'warn'|'error'} */ (severity),
			file,
			`non-inherited keys (${tier}) repeated in every named environment — ${scope}`,
			`non-inherited key(s) declared at top level but missing from an environment: ${missing.join(', ')}`,
			tier === 'advisory'
				? 'these keys are marked notInheritable by the installed wrangler 4.113.0 normalizer but do not appear in the published non-inheritable list; reported as advisory rather than error because that evidence was not independently reproduced'
				: undefined,
		);
	}

	// Inverse guard: duplicating an inherited key into an environment is
	// redundant and creates two places to keep in sync.
	/** @type {string[]} */
	const duplicated = [];
	for (const [envName, block] of envs) {
		for (const key of INHERITED_KEYS) {
			if (key in block) duplicated.push(`env.${envName}.${key}`);
		}
	}
	assert(
		`${prefix}6`,
		duplicated.length === 0,
		'warn',
		file,
		'no inheritable keys redundantly duplicated into named environments',
		`inheritable key(s) duplicated into an environment (they are inherited from the top level already): ${duplicated.join(', ')}`,
	);
}

/**
 * Walk a parsed config and flag anything that looks like a committed credential.
 * @param {any} config
 * @param {string} raw
 * @param {string} file
 */
function checkNoCredentials(config, raw, file) {
	/** @type {string[]} */
	const hits = [];
	/** hex values already reported, so the structured and raw-text scans do not double-count */
	const seenHex = new Set();

	const HEX32 = /^[0-9a-fA-F]{32}$/;
	const CREDENTIAL_KEY =
		/(^|_)(api_?token|api_?key|auth_?key|access_?key|account_?id|token|secret_?key)$/i;

	/**
	 * @param {any} node
	 * @param {string} path
	 */
	function walk(node, path) {
		if (Array.isArray(node)) {
			for (const [idx, v] of node.entries()) walk(v, `${path}${path ? '.' : ''}${idx}`);
			return;
		}
		if (isPlainObject(node)) {
			for (const [k, v] of Object.entries(node)) walk(v, `${path}${path ? '.' : ''}${k}`);
			return;
		}
		if (typeof node !== 'string' || node.length === 0) return;
		if (NAME_ONLY_LEAF_PATHS.some((re) => re.test(path))) return;

		const leafKey = path.split('.').pop() ?? '';
		if (HEX32.test(node)) {
			seenHex.add(node);
			hits.push(`${path} looks like a 32-hex Cloudflare account id`);
		} else if (CREDENTIAL_KEY.test(leafKey))
			hits.push(`${path} is a credential-shaped key with a literal value`);
	}

	walk(config, '');

	// Also scan the raw text so a value pasted into a comment is caught. The
	// $schema line is excluded because it is a path, not a credential. This scan is
	// deliberately scoped to the two wrangler configs — a repo-wide 32-hex sweep
	// would match the wrangler-types hash comment in worker-configuration.d.ts.
	for (const [lineNo, line] of raw.split('\n').entries()) {
		if (line.includes('$schema')) continue;
		const m = line.match(/\b[0-9a-fA-F]{32}\b/);
		if (m && !seenHex.has(m[0])) {
			seenHex.add(m[0]);
			hits.push(`line ${lineNo + 1} contains a bare 32-hex token (${m[0].slice(0, 6)}…)`);
		}
	}

	assert(
		'X1',
		hits.length === 0,
		'error',
		file,
		'no hardcoded account id or API token literal',
		`possible committed credential: ${hits.join('; ')}`,
	);
}

/* ────────────────────────────── backend checks ───────────────────────────── */

/**
 * @returns {{top: string | null, all: Set<string>} | null} the Worker names this
 *   backend config can resolve to, or null when the config could not be read — the
 *   frontend's F2 cross-check needs them.
 */
function auditBackend() {
	const file = BACKEND_CONFIG;
	const loaded = loadConfig(file);
	if (!loaded.ok) {
		// A missing wrangler.jsonc is exactly the condition that makes a CI step
		// unsafe today — see the wiring note in the header. It is an error because
		// an audit that cannot read its input has verified nothing.
		record('B0', 'error', file, `cannot audit: ${loaded.reason}`);
		return null;
	}
	record('B0', 'pass', file, 'config parsed as JSONC');

	const cfg = loaded.data;

	// B1 / B1P — no public subdomain surface. Both keys are inheritable, so the top level
	// must set them explicitly and a named environment is checked only if it overrides.
	const workersDevHits = subdomainExposure(cfg, 'workers_dev');
	assert(
		'B1',
		workersDevHits.length === 0,
		'error',
		file,
		'workers_dev is explicitly false and no named environment overrides it',
		`workers_dev must be false: ${workersDevHits.join(', ')}. The backend Worker is reached only through the frontend service binding; a workers.dev subdomain would expose it directly (HEAD's wrangler.toml omitted the key, and wrangler defaults it to true when no route is declared).`,
	);
	const previewHits = subdomainExposure(cfg, 'preview_urls');
	assert(
		'B1P',
		previewHits.length === 0,
		'error',
		file,
		'preview_urls is explicitly false and no named environment overrides it',
		`preview_urls must be explicitly false: ${previewHits.join(', ')}. When the key is unset, wrangler 4.113.0 sends no value and the platform default applies; an explicit false keeps per-version Preview URLs off whatever that default becomes.`,
	);

	// B2 / B3 / B3E — exactly one lifecycle mode, the one ADR-005 authorises, top level only.
	const lifecycle = lifecycleMode(cfg);
	const adrAbs = join(ROOT, ADR_005);
	const adr = existsSync(adrAbs) ? parseAdrLifecycle(readFileSync(adrAbs, 'utf8')) : null;
	const expected = expectedLifecycleMode(adr);

	assert(
		'B2',
		lifecycle.mode === 'migrations' || lifecycle.mode === 'exports',
		'error',
		file,
		`exactly one Durable Object lifecycle mode is declared: \`${lifecycle.mode}\``,
		lifecycle.mode === 'both'
			? '`migrations` and `exports` (with durable-object entries) are both declared; wrangler rejects this as mutually exclusive'
			: 'neither a `migrations` array nor a durable-object `exports` entry is declared; a Worker that binds Durable Objects must declare exactly one lifecycle mode',
	);

	assert(
		'B3',
		expected.mode !== null && lifecycle.mode === expected.mode,
		'error',
		file,
		`lifecycle mode \`${lifecycle.mode}\` is the one ADR-005 authorises (${expected.reason})`,
		expected.mode === null
			? `cannot key the lifecycle mode to ADR-005: ${expected.reason}`
			: `lifecycle mode is \`${lifecycle.mode}\`, but ${expected.reason}. Adopting \`exports\` is irreversible (no return to \`migrations\`, no rollback across the change) and ships only as a standalone operator deploy after ADR-005 is accepted.`,
	);

	assert(
		'B3E',
		lifecycle.envPaths.length === 0,
		'error',
		file,
		'lifecycle keys are declared only at the top level and inherited by every named environment',
		`lifecycle key(s) redeclared in a named environment: ${lifecycle.envPaths.join(', ')}. \`migrations\` and \`exports\` are inheritable in wrangler 4.113.0; an environment copy replaces the top-level history for that environment and can silently diverge from what was applied.`,
	);

	/** @type {Map<string, 'sqlite'|'kv'|'unknown'>} */
	let declared;
	if (lifecycle.mode === 'exports') {
		declared = new Map(
			lifecycle.doExports.map((k) => [k, cfg.exports[k].storage === 'sqlite' ? 'sqlite' : 'kv']),
		);
		// `state: "deleted"` / `"transferred"` / `"renamed"` entries are tombstones, not live classes.
		for (const k of lifecycle.doExports) {
			const state = cfg.exports[k].state ?? 'created';
			if (state !== 'created' && state !== 'expecting-transfer') declared.delete(k);
		}
	} else {
		declared = migrationClasses(lifecycle.migrations);
		for (const k of lifecycle.doExports)
			declared.set(k, cfg.exports[k].storage === 'sqlite' ? 'sqlite' : 'kv');
	}
	const declaredNames = [...declared.keys()];

	// B2H / B2N — the applied history is immutable, and new steps are lifecycle changes.
	if (lifecycle.mode === 'migrations') {
		const drift = appliedHistoryMismatch(lifecycle.migrations);
		assert(
			'B2H',
			drift.length === 0,
			'error',
			file,
			`\`migrations\` begins with the applied history unedited (${APPLIED_MIGRATIONS.map((m) => m.tag).join(', ')})`,
			`applied migration history was edited: ${drift.join('; ')}. Wrangler uploads only the steps after the live script's migration tag, so an edited or reordered applied step changes what the next deploy sends.`,
		);
		const pending = lifecycle.migrations.slice(APPLIED_MIGRATIONS.length);
		assert(
			'B2N',
			pending.length === 0,
			'warn',
			file,
			'no unapplied Durable Object migration step is pending',
			`${pending.length} migration step(s) beyond the applied history: ${pending
				.map((s) => JSON.stringify(isPlainObject(s) ? s.tag : s))
				.join(
					', ',
				)}. A new step is a Durable Object lifecycle change: follow ADR-005, deploy it on its own, then record it in APPLIED_MIGRATIONS.`,
		);
	}

	// B2S — storage type is immutable once a namespace exists, and new namespaces can only
	// be created on the SQLite backend.
	const badStorage = declaredNames.filter((k) => declared.get(k) === 'kv');
	assert(
		'B2S',
		badStorage.length === 0,
		'error',
		file,
		`all ${declaredNames.length} declared Durable Object class(es) are SQLite-backed`,
		`Durable Object class(es) declared without SQLite storage (\`new_classes\` or an \`exports\` entry whose storage is not "sqlite"): ${badStorage.join(', ')}`,
	);

	// B4 / B4R — declared classes <-> durable_objects.bindings, both directions. Bindings are
	// not inheritable, so every environment block is checked; a binding with script_name
	// targets another Worker's class and is out of scope here.
	/** @type {{path: string, className: string}[]} */
	const localBindings = [];
	for (const { path, block } of bindingBlocks(cfg)) {
		const list =
			isPlainObject(block.durable_objects) && Array.isArray(block.durable_objects.bindings)
				? block.durable_objects.bindings
				: [];
		for (const b of list.filter(isPlainObject)) {
			if (typeof b.class_name !== 'string' || typeof b.script_name === 'string') continue;
			localBindings.push({ path, className: b.class_name });
		}
	}
	const orphanBindings = localBindings
		.filter((b) => !declared.has(b.className))
		.map((b) => `${b.path}: ${b.className}`);
	assert(
		'B4',
		orphanBindings.length === 0,
		'error',
		file,
		`all ${localBindings.length} durable_objects binding(s) resolve to a class declared by \`${lifecycle.mode}\``,
		`durable_objects binding(s) reference a class the lifecycle declaration does not create: ${orphanBindings.join(', ')}`,
	);

	const boundClasses = new Set(localBindings.map((b) => b.className));
	const unbound = declaredNames.filter((k) => !boundClasses.has(k));
	assert(
		'B4R',
		unbound.length === 0,
		'warn', // legitimate when another Worker binds the class; flagged, not failed
		file,
		'every declared Durable Object class has a binding in this Worker',
		`declared Durable Object class(es) with no binding in this Worker: ${unbound.join(', ')} (legitimate only if another Worker binds them)`,
	);

	// The third leg of the lifecycle triangle. B4/B4R relate the lifecycle declaration to
	// durable_objects.bindings; both live inside wrangler.jsonc, so they stay consistent
	// with each other while diverging from the code. This one relates the declared classes
	// to the entry module's actual exports, which is the only leg that crosses the
	// config/source boundary. Nothing else in the repository checks it: wrangler.jsonc is
	// not a TypeScript input, so renaming the class in worker.ts typechecks clean.
	auditEntryExports(declaredNames, file);

	// Advisory: vars declared but never read. Distinct from B7 (which covers
	// secrets.required) because vars are inlined into the deployed Worker and cost
	// nothing to leave behind, so they rot silently.
	auditDeclaredVars(cfg, file);

	checkEnvInheritance('B', cfg, file);

	// secrets.required consistency across environments
	const topRequired =
		isPlainObject(cfg.secrets) && Array.isArray(cfg.secrets.required) ? cfg.secrets.required : [];
	const normalise = (a) => [...a].sort().join(',');
	const divergent = namedEnvs(cfg)
		.filter(([, block]) => {
			const req =
				isPlainObject(block.secrets) && Array.isArray(block.secrets.required)
					? block.secrets.required
					: [];
			return normalise(req) !== normalise(topRequired);
		})
		.map(([name]) => `env.${name}`);
	assert(
		'B9',
		divergent.length === 0,
		'warn',
		file,
		'secrets.required is identical across the top level and every named environment',
		`secrets.required differs from the top level in: ${divergent.join(', ')}`,
	);

	auditSecretNames(topRequired, file);
	checkNoCredentials(cfg, loaded.raw, file);

	return resolvableWorkerNames(cfg);
}

/**
 * B10 — every declared Durable Object class is exported from the entry module.
 * @param {string[]} classNames classes created by `migrations` or live in `exports`
 * @param {string} file
 */
function auditEntryExports(classNames, file) {
	const abs = join(ROOT, BACKEND_ENTRY);
	if (!existsSync(abs)) {
		record(
			'B10',
			'warn',
			file,
			`entry module ${BACKEND_ENTRY} not found; export cross-check skipped`,
		);
		return;
	}

	const { names, wildcard } = parseWorkerExports(readFileSync(abs, 'utf8'));
	const missing = classNames.filter((k) => !names.has(k));

	// `export * from './x'` makes the exported set unknowable without resolving the
	// re-export, so a miss cannot be proven. Downgrade rather than guess.
	const severity = /** @type {'warn'|'error'} */ (wildcard ? 'warn' : 'error');

	assert(
		'B10',
		missing.length === 0,
		severity,
		file,
		`all ${classNames.length} declared Durable Object class(es) are exported from ${BACKEND_ENTRY}`,
		`declared Durable Object class(es) not exported from ${BACKEND_ENTRY}: ${missing.join(', ')} — the class is declared to Cloudflare but the entry module does not provide it`,
		wildcard
			? `${BACKEND_ENTRY} contains an \`export *\` re-export, so the exported set could not be enumerated exhaustively; reported at warn`
			: undefined,
	);
}

/**
 * B11 — advisory: `vars` keys declared in config but never read as `env.NAME` in source.
 * @param {any} cfg
 * @param {string} file
 */
function auditDeclaredVars(cfg, file) {
	const vars = declaredVars(cfg);
	if (vars.size === 0) {
		record('B11', 'pass', file, 'no plain `vars` declared');
		return;
	}

	const files = collectSources(join(ROOT, BACKEND_SRC));
	if (files.length === 0) {
		record('B11', 'warn', file, `no source files under ${BACKEND_SRC}; vars cross-check skipped`);
		return;
	}
	const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n');

	const unread = [...vars.keys()]
		.filter((name) => !new RegExp(`\\benv\\.${name}\\b`).test(corpus))
		.sort();

	// WARN, NOT ERROR — DELIBERATE. This fires today on ENVIRONMENT, which is
	// declared in all three `vars` blocks of the backend config and is read nowhere
	// in packages/cloudflare-do/src outside __tests__ (which collectSources excludes).
	// That is a real, open finding tracked in docs/cloudflare/risk-register.md, not a
	// bug in this check; it is held at warn so that adopting this script does not
	// break the existing gate. Promote to 'error' once the register entry is resolved
	// — either by reading the var or by deleting it.
	assert(
		'B11',
		unread.length === 0,
		'warn',
		file,
		`all ${vars.size} declared var(s) are read as \`env.NAME\` in ${BACKEND_SRC}`,
		`vars declared but never read as \`env.NAME\` in ${BACKEND_SRC}: ${unread
			.map((n) => `${n} (${vars.get(n).join(', ')})`)
			.join('; ')}`,
		'test files are excluded from the source scan, so a var used only in __tests__ counts as unread; tracked in docs/cloudflare/risk-register.md',
	);
}

/**
 * Cross-check declared secret names against the Worker source.
 *
 * `secrets.required` drives type generation and makes `wrangler deploy` /
 * `wrangler versions upload` fail when a listed secret is not configured on the
 * Worker. It is a deploy-time presence guardrail and a typegen source of truth.
 *
 * @param {string[]} required declared secret names
 * @param {string} file
 */
function auditSecretNames(required, file) {
	const srcDir = join(ROOT, BACKEND_SRC);
	const files = collectSources(srcDir);

	if (files.length === 0) {
		record(
			'B7',
			'warn',
			file,
			`no source files found under ${BACKEND_SRC}; secret cross-check skipped`,
		);
		return;
	}

	const corpus = files.map((f) => readFileSync(f, 'utf8')).join('\n');

	// Declared but never mentioned in source. A bare word-boundary match is
	// deliberate here: it is the loosest test, so it produces the fewest false
	// positives for "this declared name is dead config".
	const unreferenced = required.filter((name) => {
		if (!/^[A-Z][A-Z0-9_]*$/.test(name)) return false; // unusual shape; do not guess
		return !new RegExp(`\\b${name}\\b`).test(corpus);
	});
	assert(
		'B7',
		unreferenced.length === 0,
		'warn',
		file,
		`all ${required.length} declared secret name(s) are referenced in ${BACKEND_SRC}`,
		`secrets.required declares name(s) never referenced in ${BACKEND_SRC}: ${unreferenced.join(', ')}`,
	);

	// The reverse direction: read from the environment but never declared. This is
	// the more valuable check — an undeclared secret gets no deploy-time presence
	// validation and no generated type.
	//
	// DELIBERATELY DOWNGRADED TO warn. This assertion fires today on
	// SUPABASE_JWT_SECRET, which is read at packages/cloudflare-do/src/GameRoom.ts
	// and packages/cloudflare-do/src/api/transcribe.ts but is absent from every
	// secrets.required block (the config's own trailing comment names it as an
	// out-of-band `wrangler secret put` item, and src/types.ts declares it optional
	// by hand). That is a real, open finding tracked in
	// docs/cloudflare/risk-register.md — it is not suppressed here, only held at
	// warn so that adopting this script does not break the existing gate. Promote
	// it to 'error' once the register entry is resolved.
	const envReads = new Set();
	for (const m of corpus.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) envReads.add(m[1]);

	// Only Supabase-prefixed names are treated as secrets; the rest of the reads
	// (GAME_ROOM, GLOBAL_LOBBY, AI, ENVIRONMENT) are bindings or plain vars.
	const undeclared = [...envReads]
		.filter((n) => n.startsWith('SUPABASE_'))
		.filter((n) => !required.includes(n))
		.sort();

	assert(
		'B8',
		undeclared.length === 0,
		'warn',
		file,
		'every Supabase secret read as `env.NAME` in source is declared in secrets.required',
		`read in ${BACKEND_SRC} as env.NAME but absent from secrets.required: ${undeclared.join(', ')}`,
		'undeclared secrets get no deploy-time presence validation and are omitted from generated types; tracked in docs/cloudflare/risk-register.md',
	);
}

/* ───────────────────────────── frontend checks ───────────────────────────── */

/**
 * @param {{top: string | null, all: Set<string>} | null} backendNames Worker names the
 *   backend config resolves to, or null when it could not be read.
 */
function auditFrontend(backendNames) {
	const file = FRONTEND_CONFIG;
	const loaded = loadConfig(file);
	if (!loaded.ok) {
		record('F0', 'error', file, `cannot audit: ${loaded.reason}`);
		return;
	}
	record('F0', 'pass', file, 'config parsed as JSONC');

	const cfg = loaded.data;

	// Least-privilege boundary: the frontend's only reach into the backend is its
	// service binding. Any storage, AI, or Durable Object binding here would give
	// the SSR surface direct access to state it should reach only through the Worker.
	/** @type {string[]} */
	const declared = [];
	for (const key of FRONTEND_FORBIDDEN) {
		if (key in cfg) declared.push(key);
		for (const [envName, block] of namedEnvs(cfg)) {
			if (key in block) declared.push(`env.${envName}.${key}`);
		}
	}
	assert(
		'F1',
		declared.length === 0,
		'error',
		file,
		`declares none of the forbidden bindings (${FRONTEND_FORBIDDEN.join(', ')})`,
		`frontend config declares backend-only binding(s): ${declared.join(', ')}`,
	);

	auditServiceBinding(cfg, backendNames, file);
	auditFrontendIngress(cfg, file);

	checkEnvInheritance('F', cfg, file);
	checkNoCredentials(cfg, loaded.raw, file);
}

/**
 * F2 / F3 / F7 — the service binding is the whole contract between the two packages.
 *
 * F2 is the single highest-value check in this script. Ten `+server.ts` routes under
 * packages/web/src/routes proxy through `platform.env.GAME_WORKER`
 * (`grep -rln GAME_WORKER packages/web/src/routes --include='+server.ts'` returns ten;
 * api/telemetry and auth/callback do not proxy). A service binding names its target by
 * string. Renaming the backend Worker — which CF-D03 proposes doing, `dicee` to
 * `dicee-game-{env}` — without updating this string leaves a binding pointing at a
 * Worker that does not exist, and every one of those ten routes starts returning 503.
 * No test, typecheck, or CI job in this repository catches it, because no CI job
 * deploys the Worker and the binding target is not a TypeScript symbol.
 *
 * The top-level binding is held to strict equality with the backend's top-level `name`.
 * A binding inside a named environment may target any name the backend config can
 * resolve to (see resolvableWorkerNames) — otherwise this check would become a
 * false positive the moment CF-D03/CF-D13 give each environment its own Worker, and a
 * check that must be disabled to make progress gets disabled.
 *
 * @param {any} cfg parsed frontend config
 * @param {{top: string | null, all: Set<string>} | null} backendNames
 * @param {string} file
 */
function auditServiceBinding(cfg, backendNames, file) {
	const bindings = serviceBindings(cfg);

	if (backendNames === null || backendNames.top === null) {
		record(
			'F2',
			'warn',
			file,
			`backend name unavailable (${BACKEND_CONFIG} did not parse or declares no \`name\`); service-target cross-check skipped`,
		);
	} else {
		const mismatched = bindings
			.filter((b) =>
				b.blockPath === '(top level)'
					? b.service !== backendNames.top
					: !backendNames.all.has(/** @type {string} */ (b.service)),
			)
			.map((b) => `${b.path}.service=${JSON.stringify(b.service)}`);
		const resolvable = [...backendNames.all].sort().join(', ');
		assert(
			'F2',
			bindings.length > 0 && mismatched.length === 0,
			'error',
			file,
			`all ${bindings.length} service binding(s) target a Worker name ${BACKEND_CONFIG} declares (${resolvable})`,
			bindings.length === 0
				? 'no service binding declared — the frontend has no route to the backend Worker'
				: `service binding target(s) name no Worker declared by ${BACKEND_CONFIG}: ${mismatched.join(', ')}. The top-level binding must equal the backend's top-level \`name\` ("${backendNames.top}"); a binding in a named environment may target any of: ${resolvable}. A service binding resolves its target by string, so a mismatch is not a type error — it is a 503 on every proxied route.`,
		);
	}

	// Exactly one binding, per block. More than one means a second backend reach
	// that this audit's least-privilege reasoning (F1) does not account for.
	const wrong = bindingBlocks(cfg)
		.filter(({ block }) => 'services' in block)
		.map(({ path, block }) => ({
			path,
			count: Array.isArray(block.services) ? block.services.filter(isPlainObject).length : -1,
		}))
		.filter(({ count }) => count !== 1)
		.map(({ path, count }) => `${path}: ${count < 0 ? 'not an array' : `${count} binding(s)`}`);

	const topDeclares = Array.isArray(cfg.services);
	assert(
		'F3',
		topDeclares && wrong.length === 0,
		'error',
		file,
		'exactly one service binding at the top level and in each named environment',
		!topDeclares
			? 'no top-level `services` array — `services` is not inherited by named environments, so it must be declared at the top level too'
			: `service binding count is not exactly one in: ${wrong.join('; ')}`,
	);

	// Advisory: a preview/staging environment pointed at the same Worker as
	// production has no isolation — preview traffic mutates production Durable
	// Object state.
	const topTargets = new Set(
		bindings.filter((b) => b.blockPath === '(top level)').map((b) => b.service),
	);
	const sharedWithProduction = bindings
		.filter((b) => b.blockPath !== '(top level)' && topTargets.has(b.service))
		.map((b) => `${b.path} -> ${JSON.stringify(b.service)}`);

	// WARN, NOT ERROR — DELIBERATE. This fires today: env.preview binds
	// service "dicee", the same Worker the top-level (production) block binds. That
	// is a real, open finding tracked in docs/cloudflare/risk-register.md, held at
	// warn so that adopting this script does not break the existing gate. Resolving
	// it depends on CF-D03 (backend identity `dicee` -> `dicee-game-{env}`) and
	// CF-D13 (named environments on the DO Worker); promote to 'error' once a
	// per-environment backend Worker exists to point at.
	assert(
		'F7',
		sharedWithProduction.length === 0,
		'warn',
		file,
		'no named environment shares a service target with the top-level (production) block',
		`named environment(s) bound to the same backend Worker as production: ${sharedWithProduction.join(
			', ',
		)} — preview traffic reaches production Durable Object state`,
		'depends on CF-D03 and CF-D13; tracked in docs/cloudflare/risk-register.md',
	);
}

/**
 * F4 — ingress stays explicit.
 * @param {any} cfg
 * @param {string} file
 */
function auditFrontendIngress(cfg, file) {
	const hits = keyOccurrences(cfg, FRONTEND_INGRESS_KEYS);
	assert(
		'F4',
		hits.length === 0,
		'error',
		file,
		`declares no ingress key (${FRONTEND_INGRESS_KEYS.join(', ')})`,
		`frontend config declares ingress key(s): ${hits.join(', ')}. Attaching hostnames from this file is a CF-D07 decision (custom domains via Wrangler \`routes\`), not a config tweak; until that decision lands, hostname attachment stays out-of-band and this file stays free of route declarations.`,
	);
}

/* ─────────────────────────── repository-state checks ─────────────────────── */

const REPO_SCOPE = '(repository)';

/**
 * X2 and G1 — the two checks that are about the repository rather than a config's
 * contents. See the "WHICH STATE EACH CHECK ASSERTS OVER" note in the header: X2 reads
 * the working tree, G1 reads git. They disagree today, and that is the point.
 */
function auditRepoState() {
	// X2 — no wrangler.toml beside a wrangler.jsonc.
	//
	// Two config files for one Worker is not a merge conflict waiting to happen, it is
	// a silent wrong-answer machine: wrangler resolves .jsonc over .toml, so a stale
	// .toml that still carries `compatibility_date = "2025-01-01"` and a legacy
	// [[migrations]] array reads as authoritative to every human and every agent while
	// being ignored by the tool.
	//
	// This asserts over the WORKING TREE. Both .toml files are deleted there, so it
	// passes. At HEAD both are still tracked (the deletions are unstaged) — that is
	// G1's business, not X2's.
	const stray = LEGACY_TOML.filter((rel) => existsSync(join(ROOT, rel)));
	assert(
		'X2',
		stray.length === 0,
		'error',
		REPO_SCOPE,
		`no legacy wrangler.toml in the working tree (checked: ${LEGACY_TOML.join(', ')})`,
		`wrangler.toml present alongside wrangler.jsonc: ${stray.join(', ')}. Wrangler resolves .jsonc first, so the .toml is inert but still reads as authoritative — delete it.`,
	);

	// G1 — are the .jsonc configs actually tracked?
	//
	// The only check in this script that looks at git rather than the filesystem, and
	// the only one that spawns a subprocess. `git ls-files` is read-only, touches no
	// remote, and needs no credential.
	if (!existsSync(join(ROOT, '.git'))) {
		record('G1', 'warn', REPO_SCOPE, 'no .git directory found; tracked-ness check skipped');
		return;
	}

	let tracked;
	try {
		const stdout = execFileSync(
			'git',
			['ls-files', '--', ...LEGACY_TOML, BACKEND_CONFIG, FRONTEND_CONFIG],
			{
				cwd: ROOT,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		);
		tracked = new Set(
			stdout
				.split('\n')
				.map((s) => s.trim())
				.filter(Boolean),
		);
	} catch (err) {
		record('G1', 'warn', REPO_SCOPE, `could not run \`git ls-files\`: ${err.message}`);
		return;
	}

	const untracked = [BACKEND_CONFIG, FRONTEND_CONFIG].filter((rel) => !tracked.has(rel));
	const tomlStillTracked = LEGACY_TOML.filter((rel) => tracked.has(rel));

	// WARN, NOT ERROR — DELIBERATE, and this one is structural rather than a
	// judgement call: making it an error would mean this script cannot be adopted
	// until the very commit it is meant to guard has already landed. It fires today
	// on both counts — neither wrangler.jsonc is tracked and both wrangler.toml files
	// still are. That is a real, open finding tracked in
	// docs/cloudflare/risk-register.md (see also CF-D09, commit and deploy
	// sequencing). Its practical consequence: CI runs actions/checkout, which
	// materialises HEAD, so a CI step added today reads no wrangler.jsonc at all and
	// fails B0/F0 no matter how green this run is locally. Promote to 'error' after
	// the configs are committed.
	const problems = [
		...untracked.map((rel) => `${rel} is untracked`),
		...tomlStillTracked.map((rel) => `${rel} is still tracked at HEAD`),
	];
	assert(
		'G1',
		problems.length === 0,
		'warn',
		REPO_SCOPE,
		'both wrangler.jsonc files are tracked and no wrangler.toml remains tracked',
		`git and the working tree disagree: ${problems.join('; ')}. Everything else in this run audited the working tree; a fresh actions/checkout would see HEAD instead and could not read a config at all.`,
		'tracked in docs/cloudflare/risk-register.md; sequencing is CF-D09',
	);
}

/* ──────────────────────────────── self-test ──────────────────────────────── */

function selfTest() {
	const cases = [
		{
			name: 'double slash inside a string is not a comment',
			input: '{"url": "https://example.com//deep"} // trailing note\n',
			check: (v) => v.url === 'https://example.com//deep',
		},
		{
			name: 'relative path value survives intact',
			input: '{"$schema": "./node_modules/wrangler/config-schema.json"}\n',
			check: (v) => v.$schema === './node_modules/wrangler/config-schema.json',
		},
		{
			name: 'leading and trailing line comments',
			input: '// header\n{"b": 1}\n// footer\n',
			check: (v) => v.b === 1,
		},
		{
			name: 'block-comment syntax inside a string is preserved',
			input: '{"c": "keep /* this */ text"}',
			check: (v) => v.c === 'keep /* this */ text',
		},
		{
			name: 'escaped quotes inside a string',
			input: '{"d": "say \\"hi\\" // not a comment"}',
			check: (v) => v.d === 'say "hi" // not a comment',
		},
		{
			name: 'trailing backslash escape does not swallow the closing quote',
			input: '{"e": "back\\\\", "f": 2}',
			check: (v) => v.e === 'back\\' && v.f === 2,
		},
		{
			name: 'trailing commas removed in objects and arrays',
			input: '{"g": [1, 2, ], }',
			check: (v) => Array.isArray(v.g) && v.g.length === 2,
		},
		{
			name: 'comma inside a string is not treated as a trailing comma',
			input: '{"h": ["x,y" ]}',
			check: (v) => v.h[0] === 'x,y',
		},
		{
			name: 'only the first top-level object is parsed',
			input: '{"i": 1}\n{"j": 2}\n',
			check: (v) => v.i === 1 && !('j' in v),
		},
		{
			name: 'multi-line block comment inside an object',
			input: '{\n"k": 1,\n/* one\n   two */\n"l": 2\n}',
			check: (v) => v.k === 1 && v.l === 2,
		},
		{
			name: 'tab indentation and nested structures',
			input: '{\n\t"m": {\n\t\t"n": ["a"] // note\n\t}\n}',
			check: (v) => v.m.n[0] === 'a',
		},
		{
			name: 'block comment between a key and its value',
			input: '{"o": /* mid */ 3}',
			check: (v) => v.o === 3,
		},
		{
			// Regression: before the BOM strip this threw `Unexpected token` pointing at
			// a character the reader cannot see in the file.
			name: 'leading UTF-8 BOM is stripped',
			input: '﻿{"a": 1}',
			check: (v) => v.a === 1,
		},
		{
			name: 'BOM followed by a line comment',
			input: '﻿// header\n{"a": 2}\n',
			check: (v) => v.a === 2,
		},
		{
			name: 'U+FEFF inside a string value is preserved, not stripped',
			input: '{"a": "x﻿y"}',
			check: (v) => v.a === 'x﻿y',
		},
	];

	let total = 0;
	let failed = 0;

	/**
	 * @param {string} name
	 * @param {() => boolean} fn
	 */
	function expect(name, fn) {
		total++;
		let ok = false;
		let detail = '';
		try {
			ok = fn() === true;
		} catch (err) {
			detail = ` (${err.message})`;
		}
		if (!ok) failed++;
		console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail}`);
	}

	for (const c of cases) expect(c.name, () => c.check(JSON.parse(stripJsonc(c.input))));

	// The real configs must also round-trip.
	for (const rel of [BACKEND_CONFIG, FRONTEND_CONFIG]) {
		expect(`real file parses: ${rel}`, () => loadConfig(rel).ok === true);
	}

	/* ── assertion helpers ─────────────────────────────────────────────────── */

	console.log('\nAssertion helper self-test\n');

	// B10 — worker export parsing
	expect('parseWorkerExports reads a plain export clause', () => {
		const { names, wildcard } = parseWorkerExports('export { GameRoom, GlobalLobby };');
		return names.has('GameRoom') && names.has('GlobalLobby') && wildcard === false;
	});
	expect('parseWorkerExports resolves `as` aliases to the exported name', () => {
		const { names } = parseWorkerExports('export { Internal as GameRoom };');
		return names.has('GameRoom') && !names.has('Internal');
	});
	expect('parseWorkerExports handles a multi-line clause and `type` specifiers', () => {
		const { names } = parseWorkerExports('export {\n\tA,\n\ttype B,\n\tC,\n} from "./x";');
		return names.has('A') && names.has('B') && names.has('C');
	});
	expect('parseWorkerExports reads `export class`', () => {
		const { names } = parseWorkerExports('export class GameRoom extends DurableObject {}');
		return names.has('GameRoom');
	});
	expect('parseWorkerExports ignores a commented-out export', () => {
		const { names } = parseWorkerExports('// export { Ghost };\n/* export { Ghost2 } */\n');
		return !names.has('Ghost') && !names.has('Ghost2');
	});
	expect('parseWorkerExports ignores an export inside a string literal', () => {
		const { names } = parseWorkerExports('const s = "export { Ghost };";\nexport const real = 1;');
		return !names.has('Ghost') && names.has('real') && names.size === 1;
	});
	expect('parseWorkerExports flags a wildcard re-export as non-exhaustive', () => {
		const { wildcard } = parseWorkerExports('export * from "./classes";');
		return wildcard === true;
	});
	expect(`real entry module exports its declared classes: ${BACKEND_ENTRY}`, () => {
		const abs = join(ROOT, BACKEND_ENTRY);
		if (!existsSync(abs)) return false;
		const { names } = parseWorkerExports(readFileSync(abs, 'utf8'));
		return names.has('GameRoom') && names.has('GlobalLobby');
	});

	// F2 / F3 / F7 — service bindings
	expect('serviceBindings finds top-level and named-environment bindings', () => {
		const found = serviceBindings({
			services: [{ binding: 'GAME_WORKER', service: 'dicee' }],
			env: { preview: { services: [{ binding: 'GAME_WORKER', service: 'dicee-preview' }] } },
		});
		return (
			found.length === 2 &&
			found[0].path === 'services[0]' &&
			found[0].service === 'dicee' &&
			found[1].path === 'env.preview.services[0]' &&
			found[1].service === 'dicee-preview'
		);
	});
	expect('serviceBindings detects a target that does not match the backend name', () => {
		const found = serviceBindings({ services: [{ binding: 'GAME_WORKER', service: 'dicee' }] });
		return found.filter((b) => b.service !== 'dicee-game-production').length === 1;
	});
	expect('serviceBindings returns nothing when no services array is declared', () => {
		return serviceBindings({ name: 'x', env: { preview: {} } }).length === 0;
	});
	expect('resolvableWorkerNames derives {name}-{env} for each named environment', () => {
		const { top, all } = resolvableWorkerNames({
			name: 'dicee',
			env: { development: {}, staging: {} },
		});
		return (
			top === 'dicee' &&
			all.size === 3 &&
			all.has('dicee') &&
			all.has('dicee-development') &&
			all.has('dicee-staging')
		);
	});
	expect('resolvableWorkerNames honours a per-environment `name` override', () => {
		const { all } = resolvableWorkerNames({
			name: 'dicee',
			env: { staging: { name: 'dicee-game-staging' } },
		});
		return all.has('dicee-game-staging') && !all.has('dicee-staging');
	});
	expect('resolvableWorkerNames yields nothing when `name` is missing', () => {
		const { top, all } = resolvableWorkerNames({ env: { staging: {} } });
		return top === null && all.size === 0;
	});
	expect(`real configs agree: ${FRONTEND_CONFIG} targets a name ${BACKEND_CONFIG} declares`, () => {
		const be = loadConfig(BACKEND_CONFIG);
		const fe = loadConfig(FRONTEND_CONFIG);
		if (!be.ok || !fe.ok) return false;
		const names = resolvableWorkerNames(be.data);
		const bindings = serviceBindings(fe.data);
		return bindings.length > 0 && bindings.every((b) => names.all.has(b.service));
	});

	// F4 — ingress keys
	expect('keyOccurrences finds an ingress key at the top level', () => {
		const hits = keyOccurrences({ routes: ['a'] }, FRONTEND_INGRESS_KEYS);
		return hits.length === 1 && hits[0] === 'routes';
	});
	expect('keyOccurrences finds an ingress key inside a named environment', () => {
		const hits = keyOccurrences(
			{ env: { preview: { custom_domain: true } } },
			FRONTEND_INGRESS_KEYS,
		);
		return hits.length === 1 && hits[0] === 'env.preview.custom_domain';
	});
	expect('keyOccurrences returns nothing for a clean config', () => {
		return (
			keyOccurrences({ name: 'dicee', env: { preview: {} } }, FRONTEND_INGRESS_KEYS).length === 0
		);
	});

	// B11 — declared vars
	expect('declaredVars collects every path declaring a var', () => {
		const vars = declaredVars({
			vars: { ENVIRONMENT: 'production' },
			env: { staging: { vars: { ENVIRONMENT: 'staging' } } },
		});
		const paths = vars.get('ENVIRONMENT');
		return vars.size === 1 && paths.length === 2 && paths[1] === 'env.staging.vars.ENVIRONMENT';
	});

	// B1 / B1P — subdomain exposure
	expect('subdomainExposure flags an unset top-level key', () => {
		const hits = subdomainExposure({ name: 'x' }, 'preview_urls');
		return hits.length === 1 && hits[0] === 'preview_urls=unset';
	});
	expect('subdomainExposure flags a named environment overriding to true', () => {
		const hits = subdomainExposure(
			{ workers_dev: false, env: { staging: { workers_dev: true }, development: {} } },
			'workers_dev',
		);
		return hits.length === 1 && hits[0] === 'env.staging.workers_dev=true';
	});
	expect('subdomainExposure passes an explicit false inherited by environments', () => {
		return (
			subdomainExposure({ preview_urls: false, env: { staging: {} } }, 'preview_urls').length === 0
		);
	});

	// B2 / B3 / B3E — lifecycle mode
	const APPLIED = [
		{ tag: 'v1', new_sqlite_classes: ['GameRoom'] },
		{ tag: 'v2', new_sqlite_classes: ['GlobalLobby'] },
	];
	const DO_EXPORTS = {
		GameRoom: { type: 'durable-object', storage: 'sqlite' },
		GlobalLobby: { type: 'durable-object', storage: 'sqlite' },
	};
	expect('lifecycleMode detects `migrations` mode', () => {
		return lifecycleMode({ migrations: APPLIED }).mode === 'migrations';
	});
	expect('lifecycleMode detects `exports` mode', () => {
		return lifecycleMode({ exports: DO_EXPORTS }).mode === 'exports';
	});
	expect('lifecycleMode reports both modes declared together', () => {
		return lifecycleMode({ migrations: APPLIED, exports: DO_EXPORTS }).mode === 'both';
	});
	expect('lifecycleMode reports no mode, including an empty migrations array', () => {
		return lifecycleMode({ migrations: [], exports: {} }).mode === 'none';
	});
	expect('lifecycleMode ignores a Worker-entrypoint-only `exports` map beside migrations', () => {
		const { mode } = lifecycleMode({
			migrations: APPLIED,
			exports: { Api: { type: 'worker' } },
		});
		return mode === 'migrations';
	});
	expect('lifecycleMode reports lifecycle keys redeclared in a named environment', () => {
		const { envPaths } = lifecycleMode({
			migrations: APPLIED,
			env: { staging: { migrations: APPLIED }, development: {} },
		});
		return envPaths.length === 1 && envPaths[0] === 'env.staging.migrations';
	});
	expect('migrationClasses follows create, rename, delete and kv-backed steps', () => {
		const live = migrationClasses([
			...APPLIED,
			{ tag: 'v3', renamed_classes: [{ from: 'GlobalLobby', to: 'LobbyShard' }] },
			{ tag: 'v4', new_classes: ['Legacy'] },
			{ tag: 'v5', deleted_classes: ['Legacy'] },
			{ tag: 'v6', new_classes: ['Kv'] },
		]);
		return (
			live.get('GameRoom') === 'sqlite' &&
			live.get('LobbyShard') === 'sqlite' &&
			!live.has('GlobalLobby') &&
			!live.has('Legacy') &&
			live.get('Kv') === 'kv' &&
			live.size === 3
		);
	});
	expect('appliedHistoryMismatch accepts the exact history plus later steps', () => {
		return (
			appliedHistoryMismatch(APPLIED, APPLIED).length === 0 &&
			appliedHistoryMismatch([...APPLIED, { tag: 'v3', deleted_classes: ['X'] }], APPLIED)
				.length === 0
		);
	});
	expect('appliedHistoryMismatch flags a reordered, edited or missing applied step', () => {
		const reordered = appliedHistoryMismatch([APPLIED[1], APPLIED[0]], APPLIED);
		const edited = appliedHistoryMismatch(
			[APPLIED[0], { tag: 'v2', new_classes: ['GlobalLobby'] }],
			APPLIED,
		);
		const missing = appliedHistoryMismatch([APPLIED[0]], APPLIED);
		return reordered.length === 2 && edited.length === 1 && missing.length === 1;
	});
	expect('appliedHistoryMismatch ignores key order inside a step', () => {
		return (
			appliedHistoryMismatch([{ new_sqlite_classes: ['GameRoom'], tag: 'v1' }, APPLIED[1]], APPLIED)
				.length === 0
		);
	});
	expect('parseAdrLifecycle reads a draft status and a declared mode', () => {
		const adr = parseAdrLifecycle(
			'# ADR\n\n**ADR Status:** Draft — not accepted\n**Lifecycle mode:** `migrations` (baseline)\n',
		);
		return (
			adr.status === 'Draft — not accepted' &&
			adr.accepted === false &&
			adr.declaredMode === 'migrations'
		);
	});
	expect('expectedLifecycleMode requires `migrations` while the ADR is not accepted', () => {
		const draft = parseAdrLifecycle('**ADR Status:** Proposed\n**Lifecycle mode:** `exports`\n');
		return expectedLifecycleMode(draft).mode === 'migrations';
	});
	expect('expectedLifecycleMode follows the declared mode once accepted', () => {
		const accepted = parseAdrLifecycle(
			'**ADR Status:** Accepted — 2026-10-01\n**Lifecycle mode:** `exports`\n',
		);
		return accepted.accepted && expectedLifecycleMode(accepted).mode === 'exports';
	});
	expect('expectedLifecycleMode cannot key a mode without a status or declared mode', () => {
		const noStatus = expectedLifecycleMode(parseAdrLifecycle('# nothing here\n'));
		const noMode = expectedLifecycleMode(parseAdrLifecycle('**ADR Status:** Accepted\n'));
		return (
			noStatus.mode === null && noMode.mode === null && expectedLifecycleMode(null).mode === null
		);
	});
	expect(`real config lifecycle mode is the one ${ADR_005} authorises`, () => {
		const be = loadConfig(BACKEND_CONFIG);
		const abs = join(ROOT, ADR_005);
		if (!be.ok || !existsSync(abs)) return false;
		const expected = expectedLifecycleMode(parseAdrLifecycle(readFileSync(abs, 'utf8')));
		return expected.mode !== null && lifecycleMode(be.data).mode === expected.mode;
	});
	expect(`real config preserves the applied migration history when in migrations mode`, () => {
		const be = loadConfig(BACKEND_CONFIG);
		if (!be.ok) return false;
		const lifecycle = lifecycleMode(be.data);
		return (
			lifecycle.mode !== 'migrations' || appliedHistoryMismatch(lifecycle.migrations).length === 0
		);
	});

	// X2 — the working-tree wrangler.toml assertion, stated explicitly so the
	// self-test records which state it is asserting over.
	expect('X2 operates on the working tree (no wrangler.toml present there today)', () => {
		return LEGACY_TOML.every((rel) => !existsSync(join(ROOT, rel)));
	});

	console.log(`\n  ${total - failed} passed, ${failed} failed\n`);
	return failed === 0 ? 0 : 1;
}

/* ──────────────────────────────── reporting ──────────────────────────────── */

function report({ json, strict }) {
	const counts = {
		pass: findings.filter((f) => f.status === 'pass').length,
		warn: findings.filter((f) => f.status === 'warn').length,
		error: findings.filter((f) => f.status === 'error').length,
	};
	const exitCode = counts.error > 0 || (strict && counts.warn > 0) ? 1 : 0;

	if (json) {
		// Deterministic: no timestamps, stable ordering.
		console.log(
			JSON.stringify(
				{ tool: 'cloudflare-config-audit', strict, exitCode, counts, findings },
				null,
				2,
			),
		);
		return exitCode;
	}

	const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
	const paint = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
	const label = {
		pass: paint('32', 'pass '),
		warn: paint('33', 'warn '),
		error: paint('31', 'error'),
	};

	const idWidth = Math.max(...findings.map((f) => f.id.length), 2);
	const fileWidth = Math.max(...findings.map((f) => f.file.length), 4);

	console.log('\nCloudflare config audit — offline, read-only, no network calls');
	const rel = relative(process.cwd(), ROOT);
	console.log(`Repository: ${rel === '' ? '.' : rel.startsWith('..') ? ROOT : rel}\n`);

	let lastFile = null;
	for (const f of findings) {
		if (f.file !== lastFile) {
			if (lastFile !== null) console.log('');
			lastFile = f.file;
		}
		console.log(
			`  ${label[f.status]}  ${f.id.padEnd(idWidth)}  ${f.file.padEnd(fileWidth)}  ${f.message}`,
		);
		if (f.note)
			console.log(
				`  ${' '.repeat(5)}  ${' '.repeat(idWidth)}  ${' '.repeat(fileWidth)}  note: ${f.note}`,
			);
	}

	console.log(
		`\n  ${counts.pass} passed · ${counts.warn} warning(s) · ${counts.error} error(s)` +
			(strict ? ' · --strict: warnings are fatal' : ''),
	);

	if (counts.warn > 0 && !strict) {
		console.log('  warnings are advisory; re-run with --strict to make them fatal');
	}
	console.log(
		'  scope: repository configuration only. This says nothing about live Cloudflare state.\n',
	);

	return exitCode;
}

/* ────────────────────────────────── main ─────────────────────────────────── */

function main() {
	const argv = process.argv.slice(2);

	if (argv.includes('--help') || argv.includes('-h')) {
		console.log(`
cloudflare-config-audit — offline static audit of Dicee's Wrangler configuration

  node scripts/cloudflare-config-audit.mjs             advisory run (exit 0 unless an error)
  node scripts/cloudflare-config-audit.mjs --strict    warnings also exit non-zero
  node scripts/cloudflare-config-audit.mjs --json      deterministic machine-readable output
  node scripts/cloudflare-config-audit.mjs --self-test verify the JSONC reader

Reads ${BACKEND_CONFIG}, ${FRONTEND_CONFIG}, and ${BACKEND_SRC}.
Makes no network calls, reads no credentials, and modifies nothing.
`);
		return 0;
	}

	const unknown = argv.filter((a) => !['--strict', '--json', '--self-test'].includes(a));
	if (unknown.length > 0) {
		console.error(`unknown argument(s): ${unknown.join(', ')}  (try --help)`);
		return 2;
	}

	if (argv.includes('--self-test')) {
		console.log('\nJSONC reader self-test\n');
		return selfTest();
	}

	const backendNames = auditBackend();
	auditFrontend(backendNames);
	auditRepoState();

	return report({ json: argv.includes('--json'), strict: argv.includes('--strict') });
}

/*
 * Entry-point guard.
 *
 * `stripJsonc` and the assertion helpers above are exported so they can be unit-tested.
 * Without this guard, `import { stripJsonc } from './cloudflare-config-audit.mjs'` would
 * run the entire audit as an import side effect and then call process.exit — killing the
 * importing process, test runner included, before a single assertion ran.
 *
 * process.argv[1] is undefined for `node --eval` and for a REPL, in which case this
 * module was not invoked as a script and must not run.
 */
const invokedDirectly =
	typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) process.exit(main());
