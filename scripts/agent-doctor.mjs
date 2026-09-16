#!/usr/bin/env node
/**
 * agent-doctor.mjs — dependency-free agent-configuration drift gate.
 *
 * WHY THIS EXISTS
 *   scripts/check-docs.mjs fixes its file set to `git ls-files` and knows exactly one
 *   settings file, so every ignored file is structurally invisible to it. That is how a
 *   personal, ignored Claude settings file came to enable every project MCP server and
 *   pre-allow mutating Supabase tools while `pnpm lint:docs` stayed green. check-docs also
 *   never compares two client files against each other, so one MCP server can drift into
 *   four different launchers without a finding. This gate closes both blind spots without
 *   making CI depend on local state.
 *
 * TWO CLASSES OF CHECK
 *   COMMITTED  deterministic, reads only tracked files, runs in CI, fails hard (error).
 *   LOCAL      opportunistic, included only with --local. Each local check runs only when
 *              the file or executable it needs actually exists; an absent one is a skipped
 *              note, never a failure. Local findings are warnings and never fail a default
 *              run, so `pnpm lint` can invoke the bare command safely while a developer
 *              running `pnpm agent:doctor` (which passes --local) still sees everything.
 *              `--strict` makes warnings fatal for anyone who wants that locally.
 *
 * COMMITTED RULES
 *   CONTRACT  AGENTS.md exists and stays inside its line budget
 *   PARSE     every committed agent-configuration file parses
 *   DENY      .claude/settings.json denies the mutating Supabase MCP tools
 *   POLICY    .claude/settings.json pins no model or effort level — that is personal policy
 *   MODEL     no deprecated or pinned model id in any tracked client configuration file
 *   LAUNCHER  every client launches the AKG MCP server through the pinned toolchain
 *   SERVERS   every client declares exactly the MCP servers its role allows
 *   SECRET    no `headers` key and no credential-shaped literal in an MCP-carrying file
 *   RETIRED   no retired agent surface is tracked
 *
 * LOCAL RULES
 *   CLIENT    each installed agent client meets the minimum in agent-doctor.config.json
 *   CODEX     the installed Codex accepts this repository's .codex/config.toml
 *   PERSONAL  the ignored personal Claude settings file keeps the agreed shape
 *   IDENTITY  Git identity routing covers this repository
 *   STRAY     no retired agent surface sits untracked in the working tree
 *
 * WHAT THIS IS NOT
 *   Read-only and offline. It opens no socket, reads no credential, and imports nothing
 *   from node_modules. It never prints a secret, an account identifier, or the configured
 *   Git email; the IDENTITY rule reports only which configuration file supplied the value.
 *   It inspects configuration, which is never evidence of live state.
 *
 * DELIBERATE NON-DUPLICATION
 *   The `retired` table in scripts/check-docs.config.json already enforces retired
 *   *content* tokens — the memory MCP namespace, the remote-MCP bridge, the
 *   credential-forwarding wrappers, the retired secret store and the retired editor
 *   client — across every tracked file with a scanned extension. This gate therefore
 *   checks retired *paths*, which a content scan cannot see: a tracked directory whose
 *   files never happen to name it stays invisible to it.
 *
 * USAGE
 *   node scripts/agent-doctor.mjs                  # committed checks; exit 1 on any error
 *   node scripts/agent-doctor.mjs --local          # also run the local checks (warnings)
 *   node scripts/agent-doctor.mjs --report         # print every finding, always exit 0
 *   node scripts/agent-doctor.mjs --strict         # warnings are fatal too
 *   node scripts/agent-doctor.mjs --json           # deterministic machine-readable output
 *   node scripts/agent-doctor.mjs --only LAUNCHER  # run a subset of the rules
 *   node scripts/agent-doctor.mjs --root <dir>     # audit another checkout (test fixtures)
 *   node scripts/agent-doctor.mjs --self-test      # exercise the pure helpers
 *
 * Findings print as `path:line: RULE message`, sorted, with `[warn]` or `[info]` marking
 * anything that is not an error. Exit 2 is a usage or environment error.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonc } from './cloudflare-config-audit.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');

const COMMITTED_RULES = [
	'CONTRACT',
	'PARSE',
	'DENY',
	'POLICY',
	'MODEL',
	'LAUNCHER',
	'SERVERS',
	'SECRET',
	'RETIRED',
];
const LOCAL_RULES = ['CLIENT', 'CODEX', 'PERSONAL', 'IDENTITY', 'STRAY'];
const RULES = [...COMMITTED_RULES, ...LOCAL_RULES];

/* ── Repository surface under inspection ─────────────────────────────────── */

/**
 * `.claude` is spelled once and every path below is built from it. Written out in full,
 * the personal settings path would be read by the SEE rule of scripts/check-docs.mjs as a
 * reference that must resolve — and it never resolves, because that file is ignored by
 * design. Composing it states the same path without asking a gate to believe an ignored
 * file is tracked.
 */
const CLAUDE_DIR = '.claude';
const SETTINGS = `${CLAUDE_DIR}/settings.json`;
const LOCAL_SETTINGS = `${CLAUDE_DIR}/settings.local.json`;

const AGENTS = 'AGENTS.md';
const DOCS_CONFIG = 'scripts/check-docs.config.json';
const AKG_SERVER = 'packages/web/src/tools/akg/mcp/server.ts';
const AGENTS_FALLBACK_BUDGET = 120;

/** Pseudo-paths for findings that belong to the environment rather than a file. */
const CLIENTS_SCOPE = '(clients)';
const GIT_SCOPE = '(git)';
const TREE_SCOPE = '(working tree)';

/** The two servers every client may enable without an explicit opt-in. */
const ENABLED_MCP = ['akg', 'cloudflare-docs'];

/**
 * MCP-carrying client files.
 *
 * `.mcp.json` is the project file Claude Code reads, and Claude Code gates each server
 * behind `enabledMcpjsonServers`, so it may also *declare* the two opt-in OAuth servers.
 * No other client has that gate, so every other file declares only the enabled two.
 * These four sentences are prose in docs/development/agent-clients.md; here they are one
 * comparison that fails when a client drifts.
 */
const MCP_FILES = [
	{
		file: '.mcp.json',
		format: 'json',
		key: 'mcpServers',
		expect: [...ENABLED_MCP, 'cloudflare-api', 'supabase'],
	},
	{ file: '.cursor/mcp.json', format: 'jsonc', key: 'mcpServers', expect: ENABLED_MCP },
	{ file: '.vscode/mcp.json', format: 'jsonc', key: 'servers', expect: ENABLED_MCP },
	{ file: '.codex/config.toml', format: 'toml', key: 'mcp_servers', expect: ENABLED_MCP },
];

/** Every committed file this gate parses, including the ones that carry no MCP server. */
const PARSED_FILES = [{ file: SETTINGS, format: 'json' }, ...MCP_FILES];

/**
 * The pinned launcher. `mise exec -- bun run …` runs the AKG server under the toolchain
 * pinned in .mise.toml; a bare `bun` uses whatever bun is first on the developer's PATH,
 * which is how this drifted apart across four files in the first place.
 */
const PINNED_COMMAND = 'mise';
const PINNED_ARGS = ['exec', '--', 'bun'];

/** Keys that make model or effort choice a repository decision instead of a personal one. */
const PERSONAL_POLICY_KEYS = ['model', 'maxEffortLevel'];

/**
 * Model ids that must never be pinned in repository configuration: retired families, and
 * models near retirement that new configuration must not target. Guidance about which
 * model to use belongs in prose, not in a committed key that silently outlives the model.
 */
const DEPRECATED_MODEL_IDS = [
	{ id: 'claude-3', re: /claude-3/i },
	{ id: 'claude-4 family', re: /claude-(?:sonnet-|opus-|haiku-)?4/i },
	{ id: 'sonnet-4', re: /(?<![A-Za-z0-9])sonnet-4/i },
	{ id: 'haiku-4', re: /(?<![A-Za-z0-9])haiku-4/i },
	{ id: 'gpt-4', re: /(?<![A-Za-z0-9])gpt-4/i },
	{ id: 'gpt-5.0', re: /(?<![A-Za-z0-9])gpt-5\.0/i },
	{ id: 'o1 family', re: /(?<![A-Za-z0-9-])o1-/i },
	{ id: 'o3 family', re: /(?<![A-Za-z0-9-])o3-/i },
];

/** Tracked configuration files a pinned model id could hide in. */
const MODEL_SCAN_GLOBS = [
	`${CLAUDE_DIR}/*.json`,
	'.codex/*.toml',
	'.cursor/*.json',
	'.vscode/*.json',
	'.mcp.json',
];

/**
 * Retired agent surfaces, as repository *paths*.
 *
 * The first entry's directory name is assembled from a fragment on purpose: the RETIRED
 * rule of scripts/check-docs.mjs greps every tracked .mjs file for that exact token and
 * cannot tell a policy table from a relapse, exactly as check-docs exempts its own files
 * through its SELF set. Everything else here is spelled out.
 */
const RETIRED_SURFACES = [
	{
		id: 'retired-editor-client',
		glob: `.wind${'surf'}/**`,
		probe: { dir: `.wind${'surf'}` },
		reason: 'retired editor client surface',
	},
	{
		id: 'codex-workflows',
		glob: '.codex/workflows/**',
		probe: { dir: '.codex/workflows' },
		reason: 'retired Codex surface; .codex/agents and .codex/rules are the current ones',
	},
	{
		id: 'claude-agent-notes',
		glob: `${CLAUDE_DIR}/AGENT-*.md`,
		probe: { dir: CLAUDE_DIR, entry: /^AGENT-.+\.md$/ },
		reason: `generated agent summary; ${AGENTS} and docs/development/agent-clients.md are the homes`,
	},
	{
		id: 'cursor-rules-file',
		glob: '.cursorrules',
		probe: { file: '.cursorrules' },
		reason: 'retired Cursor rules file; .cursor/mcp.json is the current surface',
	},
	{
		id: 'copilot-instructions-dir',
		glob: '.github/instructions/**',
		probe: { dir: '.github/instructions' },
		reason: 'retired Copilot surface; .github/copilot-instructions.md is the current one',
	},
];

/**
 * MCP namespaces that must not appear in any permission rule. The memory namespace is
 * assembled from a fragment for the same reason as the retired directory above.
 */
const RETIRED_MCP_NAMESPACES = [`mcp__mem${'ory'}__`];

/**
 * Supabase MCP tools that must be denied outright in committed settings.
 */
const SUPABASE_MUTATION_TOOLS = ['mcp__supabase__execute_sql', 'mcp__supabase__apply_migration'];

/**
 * Supabase MCP tools that are safe to pre-allow. Anything else under that namespace is
 * treated as a mutation: the server's tool list grows, and an allowlist that enumerates
 * mutations goes stale the moment it does.
 */
const SUPABASE_READ_ONLY_TOOLS = new Set([
	'authenticate',
	'complete_authentication',
	'generate_typescript_types',
	'get_advisors',
	'get_anon_key',
	'get_cost',
	'get_logs',
	'get_organization',
	'get_project',
	'get_project_url',
	'list_branches',
	'list_edge_functions',
	'list_extensions',
	'list_migrations',
	'list_organizations',
	'list_projects',
	'list_tables',
	'search_docs',
]);

/** Client baselines live in the config file so no document has to restate a version. */
const DOCTOR_CONFIG = join(SCRIPT_DIR, 'agent-doctor.config.json');

/**
 * The first dotted-numeric run in a `--version` line, with any prerelease suffix.
 *
 * Clients spell this differently — `2.1.273 (Claude Code)`, `codex-cli 0.155.0-alpha.2.5`,
 * a bare `1.137.0` — so the shape is found rather than assumed, and an unparseable line is
 * reported as-is instead of being guessed at.
 */
function parseVersion(line) {
	const match = /(\d+(?:\.\d+)+)(-[0-9A-Za-z.-]+)?/.exec(line);
	if (!match) return null;
	return {
		release: match[1].split('.').map(Number),
		prerelease: match[2] ? match[2].slice(1) : null,
	};
}

/** Compare two dotted-numeric releases. Missing components count as zero. */
function compareRelease(a, b) {
	for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
		const diff = (a[i] ?? 0) - (b[i] ?? 0);
		if (diff !== 0) return diff < 0 ? -1 : 1;
	}
	return 0;
}

/* ── Credential shapes ───────────────────────────────────────────────────── */

/** A key whose value would be a credential rather than a name or a path. */
const CREDENTIAL_KEY =
	/^(?:authorization|bearer|token|secret|password|credential|api[_-]?key|api[_-]?token|access[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)$/i;

/** A URL query parameter whose value would be a credential. */
const CREDENTIAL_PARAM =
	/^(?:access_token|token|key|secret|auth|password|apikey|api_key|api-key|client_secret)$/i;

/** Value shapes that are credentials regardless of the key that carries them. */
const CREDENTIAL_VALUES = [
	{ id: 'bearer scheme', re: /\bbearer\s+\S/i },
	{ id: 'provider key', re: /\bsk-[A-Za-z0-9_-]{12,}/ },
	{ id: 'GitHub token', re: /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}/ },
	{ id: 'Supabase token', re: /\bsbp_[A-Za-z0-9]{16,}|\bsb_secret_[A-Za-z0-9_-]{8,}/ },
	{ id: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
	{ id: 'long hex literal', re: /(?<![0-9A-Za-z])[0-9a-f]{32,}(?![0-9A-Za-z])/ },
];

/**
 * A `${VAR}` reference resolves at launch time and is not a literal, so it is removed
 * before a value is tested. `${DICEE_SUPABASE_PROJECT_REF}` in an MCP URL is the intended
 * shape, not a finding.
 */
const withoutPlaceholders = (value) => value.replace(/\$\{[^}]*\}/g, '');

class DoctorError extends Error {}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
	const options = {
		local: false,
		strict: false,
		report: false,
		json: false,
		selfTest: false,
		help: false,
		root: DEFAULT_ROOT,
		only: null,
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg];
		if (inline === undefined && flag === '--local') options.local = true;
		else if (inline === undefined && flag === '--strict') options.strict = true;
		else if (inline === undefined && flag === '--report') options.report = true;
		else if (inline === undefined && flag === '--json') options.json = true;
		else if (inline === undefined && flag === '--self-test') options.selfTest = true;
		else if (inline === undefined && (flag === '--help' || flag === '-h')) options.help = true;
		else if (flag === '--root' || flag === '--only') {
			const value = inline ?? argv[++i];
			if (value === undefined || value === '') throw new DoctorError(`${flag} needs a value`);
			if (flag === '--root') {
				options.root = resolve(process.cwd(), value);
			} else {
				options.only = value
					.split(',')
					.map((rule) => rule.trim().toUpperCase())
					.filter(Boolean);
				const unknown = options.only.filter((rule) => !RULES.includes(rule));
				if (unknown.length > 0 || options.only.length === 0) {
					throw new DoctorError(`--only accepts ${RULES.join(',')}; got "${value}"`);
				}
			}
		} else {
			throw new DoctorError(`unknown argument "${arg}"`);
		}
	}
	// `--only PERSONAL` would otherwise select a rule and then skip it.
	if (options.only?.some((rule) => LOCAL_RULES.includes(rule))) options.local = true;
	return options;
}

/* ── Small helpers ───────────────────────────────────────────────────────── */

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Minimal glob matcher: `**` spans directories, `*` and `?` stay within one segment. */
function globToRegExp(glob) {
	let source = '';
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		if (char === '*' && glob[i + 1] === '*') {
			i++;
			if (glob[i + 1] === '/') {
				i++;
				source += '(?:.*/)?';
			} else {
				source += '.*';
			}
		} else if (char === '*') {
			source += '[^/]*';
		} else if (char === '?') {
			source += '[^/]';
		} else {
			source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${source}$`);
}

const countLines = (text) => text.split('\n').length - 1;

/** 1-based line of the first occurrence of `needle`, or 1 when it is absent. */
function lineContaining(text, needle) {
	const index = text.indexOf(needle);
	return index === -1 ? 1 : countLines(text.slice(0, index)) + 1;
}

/**
 * Replace the home directory with `~` anywhere in a reported string. Local findings quote
 * real configuration, and a home directory carries a user name that nothing here needs.
 */
function tilde(text) {
	const home = homedir();
	if (!home) return text;
	return text.split(home).join('~');
}

/* ── Minimal TOML reader ─────────────────────────────────────────────────── */

/**
 * Enough TOML to read `[mcp_servers.*]` tables and their values: table headings, key/value
 * pairs, basic and literal strings, arrays (including multi-line ones) and inline tables.
 *
 * A TOML dependency is not worth taking for this. What matters is that a file this reader
 * cannot understand is reported as unparsed rather than silently treated as empty — an
 * empty table set would make SERVERS and LAUNCHER pass on a broken file.
 *
 * Not supported, and rejected rather than mis-read: multi-line (triple-quoted) strings and
 * arrays of tables. Neither appears in this repository's Codex configuration.
 */
function parseMiniToml(text) {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	/** @type {Map<string, Map<string, {value: unknown, line: number}>>} */
	const tables = new Map();
	const errors = [];
	let current = '';
	tables.set('', new Map());

	for (let i = 0; i < lines.length; i++) {
		const stripped = stripTomlComment(lines[i]);
		if (!stripped.ok) {
			errors.push({ line: i + 1, message: 'unterminated string' });
			continue;
		}
		let body = stripped.text.trim();
		if (body === '') continue;

		if (body.startsWith('[[')) {
			errors.push({ line: i + 1, message: 'arrays of tables are not supported by this reader' });
			continue;
		}
		if (body.startsWith('[')) {
			if (!body.endsWith(']')) {
				errors.push({ line: i + 1, message: `malformed table heading "${body}"` });
				continue;
			}
			current = body.slice(1, -1).trim();
			if (current === '') {
				errors.push({ line: i + 1, message: 'empty table heading' });
				continue;
			}
			if (tables.has(current)) {
				errors.push({ line: i + 1, message: `table [${current}] is declared twice` });
				continue;
			}
			tables.set(current, new Map());
			continue;
		}

		const equals = indexOfTopLevel(body, '=');
		if (equals === -1) {
			errors.push({ line: i + 1, message: `not a table heading or key/value pair: "${body}"` });
			continue;
		}
		const key = unquote(body.slice(0, equals).trim());
		let raw = body.slice(equals + 1).trim();
		// A value whose brackets or braces are still open continues on the next lines.
		let consumed = i;
		while (unbalanced(raw) && consumed + 1 < lines.length) {
			consumed++;
			const more = stripTomlComment(lines[consumed]);
			if (!more.ok) {
				errors.push({ line: consumed + 1, message: 'unterminated string' });
				break;
			}
			raw = `${raw} ${more.text.trim()}`;
		}
		i = consumed;
		if (key === '' || unbalanced(raw)) {
			errors.push({ line: i + 1, message: `malformed key/value pair: "${body}"` });
			continue;
		}
		const parsed = parseTomlValue(raw);
		if (!parsed.ok) {
			errors.push({ line: i + 1, message: `unreadable value for "${key}": ${parsed.reason}` });
			continue;
		}
		tables.get(current).set(key, { value: parsed.value, line: i + 1 });
	}

	return { tables, errors };
}

/** Drop a `#` comment, keeping `#` inside a string. `ok` is false for an unterminated string. */
function stripTomlComment(line) {
	let out = '';
	let i = 0;
	while (i < line.length) {
		const char = line[i];
		if (char === '#') return { text: out, ok: true };
		if (char === '"' || char === "'") {
			let closed = false;
			out += char;
			i++;
			while (i < line.length) {
				const next = line[i];
				if (char === '"' && next === '\\' && i + 1 < line.length) {
					out += line.slice(i, i + 2);
					i += 2;
					continue;
				}
				out += next;
				i++;
				if (next === char) {
					closed = true;
					break;
				}
			}
			if (!closed) return { text: out, ok: false };
			continue;
		}
		out += char;
		i++;
	}
	return { text: out, ok: true };
}

/** Index of the first `needle` outside any string, bracket or brace, or -1. */
function indexOfTopLevel(text, needle) {
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"' || char === "'") {
			i = skipString(text, i);
			continue;
		}
		if (char === '[' || char === '{') depth++;
		else if (char === ']' || char === '}') depth--;
		else if (depth === 0 && char === needle) return i;
	}
	return -1;
}

/** Index of the closing quote of the string starting at `start`, or the end of the text. */
function skipString(text, start) {
	const quote = text[start];
	for (let i = start + 1; i < text.length; i++) {
		if (quote === '"' && text[i] === '\\') {
			i++;
			continue;
		}
		if (text[i] === quote) return i;
	}
	return text.length;
}

/** True when a value still has an open bracket or brace. */
function unbalanced(text) {
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"' || char === "'") {
			i = skipString(text, i);
			continue;
		}
		if (char === '[' || char === '{') depth++;
		else if (char === ']' || char === '}') depth--;
	}
	return depth > 0;
}

/** Split on top-level commas, ignoring commas inside strings, arrays and inline tables. */
function splitTopLevel(text) {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (char === '"' || char === "'") {
			i = skipString(text, i);
			continue;
		}
		if (char === '[' || char === '{') depth++;
		else if (char === ']' || char === '}') depth--;
		else if (char === ',' && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/** Remove surrounding quotes from a bare or quoted key. */
function unquote(token) {
	const match = token.match(/^(["'])(.*)\1$/s);
	return match ? match[2] : token;
}

/** Parse a TOML value into a JavaScript value. Unknown scalars stay as their raw text. */
function parseTomlValue(raw) {
	const text = raw.trim();
	if (text === '') return { ok: false, reason: 'empty value' };
	if (text.startsWith('"') || text.startsWith("'")) {
		const end = skipString(text, 0);
		if (end >= text.length) return { ok: false, reason: 'unterminated string' };
		if (text.slice(end + 1).trim() !== '') return { ok: false, reason: 'trailing text after string' };
		const body = text.slice(1, end);
		return { ok: true, value: text[0] === "'" ? body : unescapeBasic(body) };
	}
	if (text.startsWith('[')) {
		if (!text.endsWith(']')) return { ok: false, reason: 'unterminated array' };
		const items = [];
		for (const part of splitTopLevel(text.slice(1, -1))) {
			const item = parseTomlValue(part);
			if (!item.ok) return item;
			items.push(item.value);
		}
		return { ok: true, value: items };
	}
	if (text.startsWith('{')) {
		if (!text.endsWith('}')) return { ok: false, reason: 'unterminated inline table' };
		const table = {};
		for (const part of splitTopLevel(text.slice(1, -1))) {
			const equals = indexOfTopLevel(part, '=');
			if (equals === -1) return { ok: false, reason: `inline table entry "${part}" has no value` };
			const item = parseTomlValue(part.slice(equals + 1));
			if (!item.ok) return item;
			table[unquote(part.slice(0, equals).trim())] = item.value;
		}
		return { ok: true, value: table };
	}
	if (text === 'true') return { ok: true, value: true };
	if (text === 'false') return { ok: true, value: false };
	if (/^[+-]?(?:\d[\d_]*)(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?$/.test(text)) {
		return { ok: true, value: Number(text.replace(/_/g, '')) };
	}
	return { ok: true, value: text };
}

/** The escapes TOML basic strings actually use in this repository's configuration. */
function unescapeBasic(body) {
	return body.replace(/\\(["\\bfnrt])/g, (_, char) => {
		const map = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
		return map[char] ?? char;
	});
}

/** Fold dotted table names into one nested object, so TOML and JSON walk identically. */
function tomlToObject(tables) {
	const root = {};
	for (const [name, entries] of tables) {
		let node = root;
		if (name !== '') {
			for (const segment of splitDottedKey(name)) {
				if (!isObject(node[segment])) node[segment] = {};
				node = node[segment];
			}
		}
		for (const [key, entry] of entries) node[key] = entry.value;
	}
	return root;
}

/** Split `a.b."c.d"` into its segments. */
function splitDottedKey(name) {
	const segments = [];
	let start = 0;
	for (let i = 0; i < name.length; i++) {
		if (name[i] === '"' || name[i] === "'") {
			i = skipString(name, i);
			continue;
		}
		if (name[i] === '.') {
			segments.push(unquote(name.slice(start, i).trim()));
			start = i + 1;
		}
	}
	segments.push(unquote(name.slice(start).trim()));
	return segments.filter((segment) => segment !== '');
}

/* ── Repository model ────────────────────────────────────────────────────── */

function loadRepository(root) {
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new DoctorError(`--root ${root} is not a directory`);
	}
	let output;
	try {
		output = execFileSync('git', ['ls-files', '-z'], {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 1 << 28,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (error) {
		throw new DoctorError(`git ls-files failed (${String(error.stderr || error.message).trim()})`);
	}
	const tracked = new Set(output.split('\0').filter(Boolean));
	return { root, tracked, texts: new Map(), documents: new Map() };
}

function readText(repo, path) {
	let text = repo.texts.get(path);
	if (text === undefined) {
		text = readFileSync(join(repo.root, path), 'utf8').replace(/\r\n?/g, '\n');
		repo.texts.set(path, text);
	}
	return text;
}

/**
 * Parse one committed configuration file once, in the format its client actually accepts.
 * Returns `{ ok, data, text }` or `{ ok: false, reason, line }`.
 */
function loadDocument(repo, entry) {
	const cached = repo.documents.get(entry.file);
	if (cached) return cached;
	let result;
	if (!repo.tracked.has(entry.file)) {
		result = { ok: false, reason: 'file is not tracked', line: 1 };
	} else if (!existsSync(join(repo.root, entry.file))) {
		result = { ok: false, reason: 'tracked file is missing from the working tree', line: 1 };
	} else {
		const text = readText(repo, entry.file);
		if (entry.format === 'toml') {
			const { tables, errors } = parseMiniToml(text);
			result = errors.length
				? { ok: false, reason: errors[0].message, line: errors[0].line, text }
				: { ok: true, data: tomlToObject(tables), text };
		} else {
			try {
				// Claude Code reads .mcp.json and its settings as strict JSON; VS Code and
				// Cursor accept comments, so their files are read as JSONC.
				const source = entry.format === 'jsonc' ? stripJsonc(text) : text;
				const data = JSON.parse(source);
				result = isObject(data)
					? { ok: true, data, text }
					: { ok: false, reason: 'top-level value is not an object', line: 1, text };
			} catch (error) {
				result = { ok: false, reason: error.message, line: 1, text };
			}
		}
	}
	repo.documents.set(entry.file, result);
	return result;
}

/** The MCP servers a parsed client document declares, normalised across formats. */
function declaredServers(entry, data) {
	const container = data[entry.key];
	if (!isObject(container)) return null;
	const servers = new Map();
	for (const [name, definition] of Object.entries(container)) {
		if (isObject(definition)) servers.set(name, definition);
	}
	return servers;
}

/* ── Committed rules ─────────────────────────────────────────────────────── */

function ruleContract({ repo, add }) {
	if (!repo.tracked.has(AGENTS)) {
		add(AGENTS, 1, 'CONTRACT', 'error', 'the repository contract is missing');
		return;
	}
	// The budget lives in the docs gate's config so there is one number, not two.
	let budget = AGENTS_FALLBACK_BUDGET;
	let source = 'built-in default';
	if (repo.tracked.has(DOCS_CONFIG)) {
		try {
			const configured = JSON.parse(readText(repo, DOCS_CONFIG))?.budgets?.[AGENTS]?.maxLines;
			if (Number.isInteger(configured) && configured > 0) {
				budget = configured;
				source = DOCS_CONFIG;
			}
		} catch {
			// A malformed docs config is that gate's finding, not this one's.
		}
	}
	const lines = countLines(readText(repo, AGENTS));
	if (lines > budget) {
		add(AGENTS, budget + 1, 'CONTRACT', 'error', `${lines} lines exceeds the budget of ${budget}`);
		return;
	}
	add(
		AGENTS,
		1,
		'CONTRACT',
		'info',
		`${lines} of ${budget} lines (${budget - lines} line(s) of headroom, budget from ${source})`,
	);
}

function ruleParse({ repo, add }) {
	for (const entry of PARSED_FILES) {
		const document = loadDocument(repo, entry);
		if (!document.ok) {
			add(entry.file, document.line ?? 1, 'PARSE', 'error', `does not parse: ${document.reason}`);
		}
	}
}

function ruleDeny({ repo, add }) {
	const document = loadDocument(repo, { file: SETTINGS, format: 'json' });
	if (!document.ok) return; // PARSE owns this failure
	const deny = document.data.permissions?.deny;
	const rules = new Set(Array.isArray(deny) ? deny : []);
	for (const tool of SUPABASE_MUTATION_TOOLS) {
		if (!rules.has(tool)) {
			add(
				SETTINGS,
				lineContaining(document.text, '"deny"'),
				'DENY',
				'error',
				`permissions.deny must list "${tool}"; an MCP session is not authority for a remote database write`,
			);
		}
	}
}

function rulePolicy({ repo, add }) {
	const document = loadDocument(repo, { file: SETTINGS, format: 'json' });
	if (!document.ok) return;
	for (const key of PERSONAL_POLICY_KEYS) {
		if (key in document.data) {
			add(
				SETTINGS,
				lineContaining(document.text, `"${key}"`),
				'POLICY',
				'error',
				`"${key}" is personal policy, not repository policy; keep model and effort choices in the user configuration`,
			);
		}
	}
}

function ruleModel({ repo, add }) {
	const matchers = MODEL_SCAN_GLOBS.map(globToRegExp);
	const files = [...repo.tracked]
		.filter((path) => matchers.some((matcher) => matcher.test(path)))
		.sort();
	for (const file of files) {
		if (!existsSync(join(repo.root, file))) continue;
		readText(repo, file)
			.split('\n')
			.forEach((line, index) => {
				for (const model of DEPRECATED_MODEL_IDS) {
					const match = line.match(model.re);
					if (match) {
						add(
							file,
							index + 1,
							'MODEL',
							'error',
							`pinned or deprecated model id "${match[0]}" (${model.id}); model choice is guidance, not committed configuration`,
						);
					}
				}
			});
	}
}

function ruleLauncher({ repo, add }) {
	for (const entry of MCP_FILES) {
		const document = loadDocument(repo, entry);
		if (!document.ok) continue;
		const servers = declaredServers(entry, document.data);
		const akg = servers?.get('akg');
		if (!akg) continue; // SERVERS owns a missing server
		const line = lineContaining(document.text, 'akg');
		const command = akg.command;
		const args = Array.isArray(akg.args) ? akg.args.map(String) : [];
		if (command !== PINNED_COMMAND) {
			add(
				entry.file,
				line,
				'LAUNCHER',
				'error',
				`akg command is ${JSON.stringify(command ?? null)}; every client must launch it with "${PINNED_COMMAND}" so it runs under the pinned toolchain`,
			);
			continue;
		}
		const prefix = args.slice(0, PINNED_ARGS.length);
		if (prefix.join('\u0000') !== PINNED_ARGS.join('\u0000')) {
			add(
				entry.file,
				line,
				'LAUNCHER',
				'error',
				`akg args begin ${JSON.stringify(prefix)}; they must begin ${JSON.stringify(PINNED_ARGS)} so the runtime comes from .mise.toml rather than PATH`,
			);
		}
	}
}

function ruleServers({ repo, add }) {
	for (const entry of MCP_FILES) {
		const document = loadDocument(repo, entry);
		if (!document.ok) continue;
		const servers = declaredServers(entry, document.data);
		if (servers === null) {
			add(
				entry.file,
				1,
				'SERVERS',
				'error',
				`no "${entry.key}" object; this file declares no MCP server at all`,
			);
			continue;
		}
		const declared = [...servers.keys()].sort();
		const expected = [...entry.expect].sort();
		if (declared.join(',') !== expected.join(',')) {
			add(
				entry.file,
				lineContaining(document.text, entry.key),
				'SERVERS',
				'error',
				`declares ${JSON.stringify(declared)}; expected ${JSON.stringify(expected)}`,
			);
		}
	}
}

/**
 * The 2026-05-08 MCP bearer-argv rule, mechanised: no MCP-carrying file may hold a
 * credential, and none may set request headers. A header block is how a token gets
 * forwarded without ever looking like one, so the key itself is the finding.
 *
 * Every string leaf is scanned, not only url / args / env, because a credential pasted
 * into some other key is the same incident with a different field name.
 */
function ruleSecret({ repo, add }) {
	for (const entry of MCP_FILES) {
		const document = loadDocument(repo, entry);
		if (!document.ok) continue;
		for (const hit of credentialHits(document.data)) {
			add(
				entry.file,
				lineContaining(document.text, hit.anchor),
				'SECRET',
				'error',
				hit.message,
			);
		}
	}
}

/** Walk a parsed configuration document and describe everything credential-shaped in it. */
function credentialHits(data) {
	const hits = [];
	const walk = (node, path) => {
		if (Array.isArray(node)) {
			node.forEach((item, index) => walk(item, `${path}[${index}]`));
			return;
		}
		if (isObject(node)) {
			for (const [key, value] of Object.entries(node)) {
				const here = path === '' ? key : `${path}.${key}`;
				if (key.toLowerCase() === 'headers') {
					hits.push({
						anchor: key,
						message: `"${here}" sets request headers; an MCP server is configured without credentials, and a header block is how a token reaches one`,
					});
				} else if (CREDENTIAL_KEY.test(key) && typeof value === 'string') {
					if (withoutPlaceholders(value).trim() !== '') {
						hits.push({
							anchor: key,
							message: `"${here}" is a credential-shaped key with a literal value`,
						});
					}
				}
				walk(value, here);
			}
			return;
		}
		if (typeof node !== 'string' || node === '') return;
		const value = withoutPlaceholders(node);
		for (const shape of CREDENTIAL_VALUES) {
			if (shape.re.test(value)) {
				hits.push({ anchor: path.split('.').pop(), message: `"${path}" contains a ${shape.id}` });
				return;
			}
		}
		for (const param of credentialQueryParams(value)) {
			hits.push({
				anchor: path.split('.').pop(),
				message: `"${path}" carries "${param}" in a URL; a credential must never travel in a URL`,
			});
		}
	};
	walk(data, '');
	return hits;
}

/** Query parameter names in `value` that would carry a credential, with a real value. */
function credentialQueryParams(value) {
	const start = value.indexOf('?');
	if (start === -1) return [];
	const query = value.slice(start + 1);
	const names = [];
	for (const pair of query.split(/[&;]/)) {
		const equals = pair.indexOf('=');
		if (equals <= 0) continue;
		const name = pair.slice(0, equals);
		if (CREDENTIAL_PARAM.test(name) && pair.slice(equals + 1).trim() !== '') names.push(name);
	}
	return names;
}

function ruleRetired({ repo, add }) {
	for (const surface of RETIRED_SURFACES) {
		const matcher = globToRegExp(surface.glob);
		for (const path of [...repo.tracked].filter((file) => matcher.test(file)).sort()) {
			add(path, 1, 'RETIRED', 'error', `tracked retired surface (${surface.reason})`);
		}
	}
}

/* ── Local rules ─────────────────────────────────────────────────────────── */

function ruleClient({ add }) {
	let clients;
	try {
		clients = JSON.parse(readFileSync(DOCTOR_CONFIG, 'utf8')).clients;
	} catch (error) {
		add(CLIENTS_SCOPE, 1, 'CLIENT', 'warn', `no client baseline: ${error.message}`);
		return;
	}

	for (const client of clients) {
		let output;
		try {
			output = execFileSync(client.bin, ['--version'], {
				encoding: 'utf8',
				timeout: 15_000,
				stdio: ['ignore', 'pipe', 'ignore'],
			});
		} catch {
			add(CLIENTS_SCOPE, 1, 'CLIENT', 'info', `${client.label}: ${client.bin} is not on PATH`);
			continue;
		}

		// Some builds greet on the first line; the version is whichever line carries one.
		const lines = output.split('\n').filter((line) => line.trim() !== '');
		const line = lines.find((candidate) => parseVersion(candidate))?.trim() ?? lines[0]?.trim();
		const installed = line ? parseVersion(line) : null;
		if (!installed) {
			add(
				CLIENTS_SCOPE,
				1,
				'CLIENT',
				'warn',
				`${client.label}: could not read a version out of "${line ?? '(no output)'}"`,
			);
			continue;
		}

		const minimum = parseVersion(client.minimum);
		const order = minimum ? compareRelease(installed.release, minimum.release) : 0;
		const shown = installed.release.join('.') + (installed.prerelease ? `-${installed.prerelease}` : '');

		if (order < 0) {
			add(
				CLIENTS_SCOPE,
				1,
				'CLIENT',
				'warn',
				`${client.label} ${shown} is below the ${client.minimum} minimum in ${tilde(DOCTOR_CONFIG)}; upgrade the client, or lower the minimum if the project no longer needs that build`,
			);
			continue;
		}
		if (installed.prerelease && client.prerelease === 'warn') {
			add(
				CLIENTS_SCOPE,
				1,
				'CLIENT',
				'warn',
				`${client.label} ${shown} is a prerelease and this client is set to stable-only in ${tilde(DOCTOR_CONFIG)}`,
			);
			continue;
		}
		const channel = installed.prerelease ? ' (prerelease channel, allowed for this client)' : '';
		add(
			CLIENTS_SCOPE,
			1,
			'CLIENT',
			'info',
			`${client.label} ${shown} meets the ${client.minimum} minimum${channel} — an installed build, not a claim about the vendor's channel`,
		);
	}
}

/**
 * Ask the installed Codex whether it accepts this repository's configuration.
 *
 * The binary is the only accurate schema for the build in front of you, and it moves faster
 * than any table we could keep here: 0.155 rejects an unknown key outright, and keys the
 * public reference omits — `agents.max_depth` — are still accepted. So this asks instead of
 * asserting. Codex reads `.codex/` only for a trusted project, so an untrusted checkout
 * makes this a no-op rather than a false pass; that limitation is reported, not hidden.
 */
function ruleCodex({ repo, add }) {
	const config = join(repo.root, '.codex', 'config.toml');
	if (!existsSync(config)) return;
	try {
		execFileSync('codex', ['mcp', 'list'], {
			cwd: repo.root,
			encoding: 'utf8',
			timeout: 60_000,
			stdio: ['ignore', 'ignore', 'pipe'],
		});
	} catch (error) {
		if (error.code === 'ENOENT') {
			add(CLIENTS_SCOPE, 1, 'CODEX', 'info', 'codex is not on PATH, so .codex/config.toml was not validated');
			return;
		}
		add(
			'.codex/config.toml',
			1,
			'CODEX',
			'warn',
			`the installed Codex refused to load this repository's configuration: ${String(error.stderr ?? '').trim().split('\n').pop() ?? error.message}`,
		);
		return;
	}
	add(
		'.codex/config.toml',
		1,
		'CODEX',
		'info',
		'the installed Codex loads this repository\'s configuration (only meaningful once the project is trusted)',
	);
}

/**
 * The ignored personal settings file. Nothing in CI reads it, and the docs gate cannot see
 * it at all, so this is the only place it is checked; every finding is a warning.
 */
function rulePersonal({ repo, add }) {
	const absolute = join(repo.root, LOCAL_SETTINGS);
	if (!existsSync(absolute)) {
		add(LOCAL_SETTINGS, 1, 'PERSONAL', 'info', 'not present; personal-settings checks skipped');
		return;
	}
	const text = readFileSync(absolute, 'utf8').replace(/\r\n?/g, '\n');
	let settings;
	try {
		settings = JSON.parse(text);
	} catch (error) {
		add(LOCAL_SETTINGS, 1, 'PERSONAL', 'warn', `does not parse: ${error.message}`);
		return;
	}
	if (!isObject(settings)) {
		add(LOCAL_SETTINGS, 1, 'PERSONAL', 'warn', 'top-level value is not an object');
		return;
	}

	if (settings.enableAllProjectMcpServers) {
		add(
			LOCAL_SETTINGS,
			lineContaining(text, '"enableAllProjectMcpServers"'),
			'PERSONAL',
			'warn',
			`enableAllProjectMcpServers turns on every server in .mcp.json, including the opt-in OAuth ones; enable servers by name instead (${ENABLED_MCP.join(', ')})`,
		);
	}

	const enabled = Array.isArray(settings.enabledMcpjsonServers) ? settings.enabledMcpjsonServers : [];
	for (const name of enabled) {
		if (!ENABLED_MCP.includes(name)) {
			add(
				LOCAL_SETTINGS,
				lineContaining(text, JSON.stringify(name)),
				'PERSONAL',
				'warn',
				`enables MCP server "${name}"; only ${ENABLED_MCP.join(' and ')} are enabled by default, the rest are opt-in per session`,
			);
		}
	}

	const permissions = isObject(settings.permissions) ? settings.permissions : {};
	const preapproved = [
		...(Array.isArray(permissions.allow) ? permissions.allow : []),
		...(Array.isArray(permissions.ask) ? permissions.ask : []),
	];
	const everyRule = [...preapproved, ...(Array.isArray(permissions.deny) ? permissions.deny : [])];
	const akgTools = akgToolNames(repo);

	for (const rule of preapproved) {
		if (typeof rule !== 'string') continue;
		const line = lineContaining(text, JSON.stringify(rule));
		const supabase = rule.match(/^mcp__supabase__([A-Za-z0-9_]+)$/);
		if (supabase && !SUPABASE_READ_ONLY_TOOLS.has(supabase[1])) {
			add(
				LOCAL_SETTINGS,
				line,
				'PERSONAL',
				'warn',
				`pre-approves "${rule}"; the Supabase MCP server is read-only by configuration, and anything outside its read-only tool set must stay a per-call decision`,
			);
		}
		if (akgTools && rule.startsWith('mcp__akg__')) {
			const tool = rule.slice('mcp__akg__'.length);
			if (!akgTools.has(tool)) {
				add(
					LOCAL_SETTINGS,
					line,
					'PERSONAL',
					'warn',
					`names "${rule}", which the AKG server does not expose; it exposes ${[...akgTools].sort().join(', ')}`,
				);
			}
		}
		for (const problem of malformedBashRule(repo, rule)) {
			add(LOCAL_SETTINGS, line, 'PERSONAL', 'warn', problem);
		}
	}

	for (const rule of everyRule) {
		if (typeof rule !== 'string') continue;
		for (const namespace of RETIRED_MCP_NAMESPACES) {
			if (rule.startsWith(namespace)) {
				add(
					LOCAL_SETTINGS,
					lineContaining(text, JSON.stringify(rule)),
					'PERSONAL',
					'warn',
					`names "${rule}", a retired MCP namespace this repository no longer configures`,
				);
			}
		}
	}
}

/** Tool names the AKG MCP server registers, or null when the server source is unavailable. */
function akgToolNames(repo) {
	const absolute = join(repo.root, AKG_SERVER);
	if (!existsSync(absolute)) return null;
	const names = new Set();
	for (const match of readFileSync(absolute, 'utf8').matchAll(
		/registerTool\(\s*['"]([A-Za-z0-9_]+)['"]/g,
	)) {
		names.add(match[1]);
	}
	return names.size > 0 ? names : null;
}

/** An absolute path inside a permission rule, wherever it sits in the command line. */
const ABSOLUTE_PATH_TOKEN = /(?:^|[\s:="'])(\/(?!\/)[^\s:="'*]+)/g;

/**
 * Why a `Bash(...)` permission rule names a file instead of a command.
 *
 * Two shapes are reported. An absolute path outside the repository is machine-specific:
 * it silently matches nothing on any other checkout, and it is the shape a path-completion
 * mistake produces. Such a path is looked for anywhere in the rule, not only in the first
 * word, because the ones that survive review hide behind an environment prefix such as
 * `PATH="…" tool` or `VAR=value /opt/…/tool`. A path that instead resolves inside the
 * repository to a file with no execute bit is not a command at all, so the rule can never
 * match anything either.
 */
function malformedBashRule(repo, rule) {
	const match = rule.match(/^Bash\((.*)\)$/s);
	if (!match) return [];
	const body = match[1].trim();
	if (body === '') return [];
	const problems = [];

	const foreign = [...body.matchAll(ABSOLUTE_PATH_TOKEN)]
		.map((found) => found[1])
		.filter((path) => path !== repo.root && !path.startsWith(`${repo.root}/`));
	if (foreign.length > 0) {
		problems.push(
			`rule ${JSON.stringify(rule)} names the machine-specific absolute path(s) ${foreign.map((path) => JSON.stringify(path)).join(', ')}; a permission rule names a command on PATH or a repository-relative script`,
		);
	}

	// The command word, after any leading `NAME=value` environment assignments.
	const words = body.split(/\s+/).filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
	const first = (words[0] ?? '').replace(/:\*+$/, '').replace(/\*+$/, '');
	if (first !== '' && !first.includes('*') && !first.startsWith('/')) {
		if (first.includes('/') || first.includes('.')) {
			const absolute = join(repo.root, first);
			const stat = existsSync(absolute) ? statSync(absolute) : null;
			if (stat?.isFile() && (stat.mode & 0o111) === 0) {
				problems.push(
					`rule ${JSON.stringify(rule)} names "${first}", a file with no execute bit; it is a path, not a command, so the rule can never match`,
				);
			}
		}
	}
	return problems;
}

/**
 * Git identity routing. Reports only whether a conditional include covers this repository
 * and which configuration file supplied the value — never the address itself.
 */
function ruleIdentity({ repo, add }) {
	const git = (args) => {
		try {
			return execFileSync('git', args, {
				cwd: repo.root,
				encoding: 'utf8',
				timeout: 15_000,
				stdio: ['ignore', 'pipe', 'ignore'],
			});
		} catch {
			return null;
		}
	};

	const value = git(['config', '--get', 'user.email']);
	if (value === null || value.trim() === '') {
		add(GIT_SCOPE, 1, 'IDENTITY', 'warn', 'no user.email is configured for this repository');
		return;
	}

	const shown = git(['config', '--show-origin', '--get', 'user.email']);
	// `file:<path>\t<value>` — only the path is ever read out of this.
	const origin = shown?.split('\n')[0]?.split('\t')[0]?.replace(/^file:/, '') ?? null;
	const originLabel = origin ? tilde(origin) : '(unknown)';

	const routes = git(['config', '--show-origin', '--get-regexp', '^includeif\\.']) ?? '';
	const matched = [];
	for (const line of routes.split('\n')) {
		const key = line.split('\t')[1]?.split(' ')[0];
		if (!key) continue;
		const condition = key.replace(/^includeif\./i, '').replace(/\.path$/i, '');
		if (includeIfMatches(condition, repo.root)) matched.push(condition);
	}

	if (matched.length > 0) {
		add(
			GIT_SCOPE,
			1,
			'IDENTITY',
			'info',
			`identity routing covers this repository (${matched.length} matching includeIf condition(s)); user.email comes from ${originLabel}`,
		);
		return;
	}
	add(
		GIT_SCOPE,
		1,
		'IDENTITY',
		'warn',
		`no includeIf condition matches this repository, so user.email falls back to ${originLabel}; add a conditional include for this workspace instead of relying on the global default`,
	);
}

/**
 * Resolve the symlink-free form of the literal directory prefix of a glob pattern.
 *
 * `git rev-parse` reports a repository through its real path, while a condition in
 * `~/.gitconfig` is usually written through whatever path the operator types. On macOS
 * `/var` is a symlink to `/private/var`, so the two spellings of one directory would not
 * compare equal. Only the part before the first glob character can be resolved; the rest
 * is left alone, and an unresolvable prefix keeps the original spelling.
 */
function resolveLiteralPrefix(pattern) {
	const glob = pattern.search(/[*?[]/);
	const literal = glob === -1 ? pattern : pattern.slice(0, glob);
	const rest = glob === -1 ? '' : pattern.slice(glob);
	const trailing = literal.endsWith('/') ? '/' : '';
	const probe = trailing ? literal.slice(0, -1) : literal;
	if (!probe) return pattern;
	try {
		return realpathSync(probe) + trailing + rest;
	} catch {
		return pattern;
	}
}

/**
 * Whether a `gitdir:` includeIf condition covers `root`.
 *
 * Follows gitconfig(5) closely enough to answer the question honestly: `~/` expands to the
 * home directory, a pattern ending in `/` matches everything beneath it, a pattern with no
 * slash matches at any depth, `/i` makes the comparison case-insensitive, and `*`/`**`
 * keep their glob meaning. Conditions this does not model (`onbranch:`, `hasconfig:`) never
 * select an identity by path and are reported as non-matching.
 */
function includeIfMatches(condition, root) {
	const lower = condition.toLowerCase();
	const insensitive = lower.startsWith('gitdir/i:');
	if (!insensitive && !lower.startsWith('gitdir:')) return false;
	let pattern = condition.slice(condition.indexOf(':') + 1);
	if (pattern.startsWith('~/')) pattern = join(homedir(), pattern.slice(2));
	pattern = resolveLiteralPrefix(pattern);
	if (pattern.endsWith('/')) pattern += '**';
	if (!pattern.includes('/')) pattern = `**/${pattern}`;
	const matcher = new RegExp(globToRegExp(pattern).source, insensitive ? 'i' : '');
	// A condition and a repository path can name the same directory through different
	// symlinks — /var vs /private/var on macOS is the common case — so both forms are tried.
	const roots = new Set([root]);
	try {
		roots.add(realpathSync(root));
	} catch {
		// An unreadable path simply has no second form to compare.
	}
	for (const candidate of roots) {
		if (matcher.test(candidate)) return true;
		if (matcher.test(`${candidate}/`)) return true;
		if (matcher.test(join(candidate, '.git'))) return true;
	}
	return false;
}

function ruleStray({ repo, add }) {
	for (const surface of RETIRED_SURFACES) {
		for (const path of probePaths(repo, surface)) {
			if (repo.tracked.has(path)) continue; // RETIRED already owns a tracked path
			add(
				TREE_SCOPE,
				1,
				'STRAY',
				'warn',
				`"${path}" is present but untracked (${surface.reason}); it is ignored, so nothing else reports it — delete it rather than carrying it`,
			);
		}
	}
}

/** Working-tree paths a retired surface's probe finds, if it has one. */
function probePaths(repo, surface) {
	const probe = surface.probe;
	if (!probe) return [];
	if (probe.file) return existsSync(join(repo.root, probe.file)) ? [probe.file] : [];
	if (probe.entry) {
		let entries;
		try {
			entries = readdirSync(join(repo.root, probe.dir));
		} catch {
			return [];
		}
		return entries.filter((name) => probe.entry.test(name)).map((name) => `${probe.dir}/${name}`);
	}
	return existsSync(join(repo.root, probe.dir)) ? [`${probe.dir}/`] : [];
}

const RULE_IMPLEMENTATIONS = {
	CONTRACT: ruleContract,
	PARSE: ruleParse,
	DENY: ruleDeny,
	POLICY: rulePolicy,
	MODEL: ruleModel,
	LAUNCHER: ruleLauncher,
	SERVERS: ruleServers,
	SECRET: ruleSecret,
	RETIRED: ruleRetired,
	CLIENT: ruleClient,
	CODEX: ruleCodex,
	PERSONAL: rulePersonal,
	IDENTITY: ruleIdentity,
	STRAY: ruleStray,
};

/* ── Self-test ───────────────────────────────────────────────────────────── */

function selfTest() {
	let total = 0;
	let failed = 0;
	const expect = (name, fn) => {
		total++;
		let ok = false;
		let detail = '';
		try {
			ok = fn() === true;
		} catch (error) {
			detail = ` (${error.message})`;
		}
		if (!ok) failed++;
		console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail}`);
	};

	console.log('\nagent-doctor self-test\n');

	expect('version reader handles each client spelling', () => {
		const claude = parseVersion('2.1.273 (Claude Code)');
		const codex = parseVersion('codex-cli 0.155.0-alpha.2.5');
		const vscode = parseVersion('1.137.0');
		return (
			claude.release.join('.') === '2.1.273' &&
			claude.prerelease === null &&
			codex.release.join('.') === '0.155.0' &&
			codex.prerelease === 'alpha.2.5' &&
			vscode.release.join('.') === '1.137.0'
		);
	});
	expect('version reader returns null when there is no version', () => {
		return parseVersion('command not found') === null;
	});
	expect('release comparison orders by component, not lexically', () => {
		// 0.155 > 0.154 decimally but "0.154" sorts after "0.155" as text, and 2.1.9 < 2.1.10.
		return (
			compareRelease([0, 155, 0], [0, 154, 0]) === 1 &&
			compareRelease([2, 1, 9], [2, 1, 10]) === -1 &&
			compareRelease([1, 137], [1, 137, 0]) === 0
		);
	});
	expect('a prerelease of the minimum still meets the minimum', () => {
		const installed = parseVersion('codex-cli 0.155.0-alpha.2.5');
		const minimum = parseVersion('0.154.0');
		return compareRelease(installed.release, minimum.release) >= 0;
	});
	expect('every client baseline declares the fields the CLIENT rule reads', () => {
		const { clients } = JSON.parse(readFileSync(DOCTOR_CONFIG, 'utf8'));
		return (
			clients.length > 0 &&
			clients.every(
				(client) =>
					typeof client.bin === 'string' &&
					typeof client.label === 'string' &&
					parseVersion(client.minimum) !== null &&
					['allow', 'warn'].includes(client.prerelease),
			)
		);
	});
	expect('TOML reader finds a dotted table and its string value', () => {
		const { tables, errors } = parseMiniToml('[mcp_servers.akg]\ncommand = "mise"\n');
		return errors.length === 0 && tables.get('mcp_servers.akg').get('command').value === 'mise';
	});
	expect('TOML reader reads an array of strings', () => {
		const { tables } = parseMiniToml('[a]\nargs = ["exec", "--", "bun"]\n');
		return tables.get('a').get('args').value.join(',') === 'exec,--,bun';
	});
	expect('TOML reader reads a multi-line array', () => {
		const { tables, errors } = parseMiniToml('[a]\nargs = [\n "exec",\n "--",\n]\n');
		return errors.length === 0 && tables.get('a').get('args').value.length === 2;
	});
	expect('TOML reader reads an inline table', () => {
		const { tables } = parseMiniToml('[a]\nenv = { X = "1", Y = "2" }\n');
		return tables.get('a').get('env').value.Y === '2';
	});
	expect('TOML reader keeps a # inside a string', () => {
		const { tables } = parseMiniToml('[a]\nurl = "https://x/y#frag" # note\n');
		return tables.get('a').get('url').value === 'https://x/y#frag';
	});
	expect('TOML reader reports an unterminated string instead of dropping the line', () => {
		return parseMiniToml('[a]\nurl = "https://x\n').errors.length === 1;
	});
	expect('TOML reader reports a line that is neither a heading nor a pair', () => {
		return parseMiniToml('[a]\nnonsense\n').errors.length === 1;
	});
	expect('TOML reader reports a duplicated table', () => {
		return parseMiniToml('[a]\nx = 1\n[a]\ny = 2\n').errors.length === 1;
	});
	expect('TOML tables fold into one nested object', () => {
		const object = tomlToObject(parseMiniToml('[mcp_servers.akg]\ncommand = "mise"\n').tables);
		return object.mcp_servers.akg.command === 'mise';
	});

	expect('a headers key is a finding wherever it appears', () => {
		const hits = credentialHits({ mcpServers: { x: { headers: { a: 'b' } } } });
		return hits.length === 1 && hits[0].message.includes('request headers');
	});
	expect('a bearer literal in an env value is a finding', () => {
		return credentialHits({ env: { AUTH: 'Bearer abc123' } }).length >= 1;
	});
	expect('a credential-shaped key with a literal value is a finding', () => {
		return credentialHits({ servers: { x: { api_key: 'literal-value' } } }).length === 1;
	});
	expect('a ${VAR} placeholder is not a literal', () => {
		return credentialHits({ servers: { x: { token: '${MY_TOKEN}' } } }).length === 0;
	});
	expect('a credential query parameter in a URL is a finding', () => {
		const hits = credentialHits({ url: ['https://example.com/mcp', 'secret=abc'].join('?') });
		return hits.length === 1 && hits[0].message.includes('never travel in a URL');
	});
	expect('the real project_ref URL shape is not a finding', () => {
		const url = 'https://mcp.example.com/mcp?project_ref=${REF}&read_only=true&features=docs';
		return credentialHits({ url }).length === 0;
	});

	expect('globToRegExp keeps * inside one segment', () => {
		return globToRegExp('.codex/*.toml').test('.codex/config.toml') === true;
	});
	expect('globToRegExp spans directories with **', () => {
		const matcher = globToRegExp('.github/instructions/**');
		return matcher.test('.github/instructions/deep/rule.md') && !matcher.test('.github/other.md');
	});

	expect('an includeIf gitdir prefix matches a repository beneath it', () => {
		return includeIfMatches('gitdir:/tmp/example/', '/tmp/example/repo') === true;
	});
	expect('an includeIf gitdir prefix does not match a sibling', () => {
		return includeIfMatches('gitdir:/tmp/example/', '/tmp/other/repo') === false;
	});
	expect('an onbranch condition never selects an identity by path', () => {
		return includeIfMatches('onbranch:main', '/tmp/example/repo') === false;
	});

	const fixtureRepo = { root: '/tmp/example/repo' };
	expect('a machine-specific absolute path in a Bash rule is malformed', () => {
		return malformedBashRule(fixtureRepo, 'Bash(/opt/example/bin/tool:*)').length === 1;
	});
	expect('an absolute path hidden behind an environment prefix is still found', () => {
		const rule = 'Bash(VAR=stable /opt/example/bin/tool build:*)';
		return malformedBashRule(fixtureRepo, rule).length === 1;
	});
	expect('an absolute path inside a quoted assignment is still found', () => {
		const rule = 'Bash(PATH="/opt/example/bin:$PATH" tool build:*)';
		return malformedBashRule(fixtureRepo, rule).length === 1;
	});
	expect('a path under the audited checkout is not machine-specific', () => {
		return malformedBashRule(fixtureRepo, 'Bash(/tmp/example/repo/scripts/x.sh:*)').length === 0;
	});
	expect('an ordinary command in a Bash rule is fine', () => {
		return malformedBashRule(fixtureRepo, 'Bash(pnpm lint*)').length === 0;
	});
	expect('a URL in a Bash rule is not read as a filesystem path', () => {
		return malformedBashRule(fixtureRepo, 'Bash(curl https://example.com/x:*)').length === 0;
	});

	console.log(`\n  ${total - failed} passed · ${failed} failed\n`);
	return failed === 0 ? 0 : 1;
}

/* ── Reporting ───────────────────────────────────────────────────────────── */

const SEVERITY_SUFFIX = { error: '', warn: ' [warn]', info: ' [info]' };

function report(findings, options, selected) {
	const counts = {
		error: findings.filter((finding) => finding.severity === 'error').length,
		warn: findings.filter((finding) => finding.severity === 'warn').length,
		info: findings.filter((finding) => finding.severity === 'info').length,
	};

	if (options.json) {
		console.log(
			JSON.stringify({ tool: 'agent-doctor', rules: selected, counts, findings }, null, 2),
		);
	} else {
		const lines = findings.flatMap((finding) => [
			`${finding.file}:${finding.line}: ${finding.rule} ${finding.message}${SEVERITY_SUFFIX[finding.severity]}`,
			...(finding.note ? [`    note: ${finding.note}`] : []),
		]);
		if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
	}

	process.stderr.write(
		`agent-doctor: ${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} note(s)` +
			` across ${selected.length} rule(s): ${selected.join(', ')}` +
			`${options.local ? '' : ' (committed only; pass --local for the local checks)'}\n`,
	);

	if (options.report) return 0;
	return counts.error > 0 || (options.strict && counts.warn > 0) ? 1 : 0;
}

/* ── Main ────────────────────────────────────────────────────────────────── */

const HELP = `
agent-doctor — agent-configuration drift gate for Dicee

  node scripts/agent-doctor.mjs                 committed checks only (CI-safe default)
  node scripts/agent-doctor.mjs --local         also run the local, opportunistic checks
  node scripts/agent-doctor.mjs --report        print every finding, always exit 0
  node scripts/agent-doctor.mjs --strict        warnings are fatal too
  node scripts/agent-doctor.mjs --json          deterministic machine-readable output
  node scripts/agent-doctor.mjs --only A,B      run a subset of the rules
  node scripts/agent-doctor.mjs --root <dir>    audit another checkout
  node scripts/agent-doctor.mjs --self-test     exercise the pure helpers

Committed rules: ${COMMITTED_RULES.join(', ')}
Local rules:     ${LOCAL_RULES.join(', ')}

Read-only and offline. Prints no secret, no account identifier and no email address.
`;

function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		if (!(error instanceof DoctorError)) throw error;
		process.stderr.write(`agent-doctor: ${error.message}\n`);
		return 2;
	}
	if (options.help) {
		console.log(HELP);
		return 0;
	}
	if (options.selfTest) return selfTest();

	let repo;
	try {
		repo = loadRepository(options.root);
	} catch (error) {
		if (!(error instanceof DoctorError)) throw error;
		process.stderr.write(`agent-doctor: ${error.message}\n`);
		return 2;
	}

	const available = options.local ? RULES : COMMITTED_RULES;
	const selected = (options.only ?? available).filter((rule) => available.includes(rule));

	const findings = [];
	// Local findings quote real configuration, so every message is redacted on the way in
	// rather than at each call site: no output of this gate ever names a home directory.
	const add = (file, line, rule, severity, message, note) => {
		const finding = { file, line, rule, severity, message: tilde(message) };
		findings.push(note ? { ...finding, note: tilde(note) } : finding);
	};
	for (const rule of selected) RULE_IMPLEMENTATIONS[rule]({ repo, add });

	findings.sort(
		(a, b) =>
			(a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
			a.line - b.line ||
			(a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
			(a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
	);

	return report(findings, options, selected);
}

// `process.exitCode` rather than `process.exit`, so a piped stdout is never truncated.
process.exitCode = main();
