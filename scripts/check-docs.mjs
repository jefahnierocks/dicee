#!/usr/bin/env node
/**
 * check-docs.mjs — dependency-free documentation and agent-surface gate.
 *
 * RULES
 *   LINK     Markdown links, images and reference definitions resolve, #anchors included
 *   PATH     backticked repository paths in agent-facing docs (config.pathScope) resolve
 *   SEE      docs/, .claude/, .agents/, AGENTS.md and CLAUDE.md references in source and config
 *            (jsonc, toml, yaml, rules) comments and string literals resolve
 *   RETIRED  retired tokens (config.retired) appear only in each entry's allow list
 *   ROOT     root-level files and docs/ top-level entries are allowlisted
 *   BUDGET   budgeted files exist and stay within their line budgets
 *   HOME     status and roadmap live only in docs/status.md and docs/roadmap.md
 *   SYNC     project.yaml status mirrors docs/status.md; decisions are numbered 1..n
 *   SURFACE  Claude settings, portable skills and their Claude symlinks keep their agreed shape
 *
 * USAGE
 *   node scripts/check-docs.mjs                    # exit 1 on any finding
 *   node scripts/check-docs.mjs --report           # print every finding, always exit 0
 *   node scripts/check-docs.mjs --config <file>    # alternate policy file
 *   node scripts/check-docs.mjs --only LINK,PATH   # run a subset of the rules
 *
 * Findings print as `path:line: RULE message`, sorted. Exit 2 is a usage or config error.
 * The file set is `git ls-files`, limited to paths still present in the working tree.
 * config.generated globs stay resolvable as link targets but are never scanned.
 * Policy (budgets, allowlists, retired tokens) lives only in the config file, so every
 * change to it is a visible diff. The scanner has no dependencies beyond Node built-ins.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';

const SCRIPT_DIR =
	import.meta.dirname ?? dirname(decodeURIComponent(new URL(import.meta.url).pathname));
const ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_CONFIG = join(ROOT, 'scripts', 'check-docs.config.json');

const RULES = ['LINK', 'PATH', 'SEE', 'RETIRED', 'ROOT', 'BUDGET', 'HOME', 'SYNC', 'SURFACE'];
const SURFACE_CHECKS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/** The gate's own files name retired and missing paths by design. */
const SELF = new Set([
	'scripts/check-docs.mjs',
	'scripts/check-docs.config.json',
	'scripts/tests/check-docs.test.sh',
]);
/** Names removed paths on purpose, so it is exempt from PATH and RETIRED. */
const HISTORY = 'docs/history.md';
const STATUS = 'docs/status.md';
const ROADMAP = 'docs/roadmap.md';
const PROJECT = 'project.yaml';
const SETTINGS = '.claude/settings.json';

const MARKDOWN = /\.(?:md|mdc)$/;
const PATH_EXTENSION =
	/\.(?:md|mdc|json|jsonc|toml|yaml|yml|ts|tsx|svelte|js|mjs|cjs|css|sh|rs|py|sql|rules)$/;
// JSON is not scanned: it has no comments, and its strings are data rather than prose.
const SEE_EXTENSION = /\.(?:ts|tsx|svelte|js|mjs|cjs|jsonc|css|rs|py|sql|sh|toml|yaml|yml|rules)$/;
const RETIRED_EXTENSION = /\.(?:md|mdc|txt|json|jsonc|toml|yaml|yml|sh|mjs|js|ts|svelte|rules)$/;
// The retired allow lists name .gitignore, so it is scanned alongside .envrc.
const RETIRED_BASENAMES = new Set(['.envrc', '.gitignore']);

class ConfigError extends Error {}

/* ── CLI and config ──────────────────────────────────────────────────────── */

function parseArgs(argv) {
	const options = { report: false, config: DEFAULT_CONFIG, only: null };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg];
		if (flag === '--report' && inline === undefined) {
			options.report = true;
		} else if (flag === '--config' || flag === '--only') {
			const value = inline ?? argv[++i];
			if (value === undefined || value === '') throw new ConfigError(`${flag} needs a value`);
			if (flag === '--config') {
				options.config = resolve(process.cwd(), value);
			} else {
				options.only = value
					.split(',')
					.map((rule) => rule.trim().toUpperCase())
					.filter(Boolean);
				const unknown = options.only.filter((rule) => !RULES.includes(rule));
				if (unknown.length > 0 || options.only.length === 0) {
					throw new ConfigError(`--only accepts ${RULES.join(',')}; got "${value}"`);
				}
			}
		} else {
			throw new ConfigError(`unknown argument "${arg}"`);
		}
	}
	return options;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.length > 0;
const isTextArray = (value) => Array.isArray(value) && value.every(isText);

function requireShape(ok, message) {
	if (!ok) throw new ConfigError(message);
}

function requireKeys(value, keys, where) {
	requireShape(isObject(value), `${where} must be an object`);
	for (const key of Object.keys(value)) {
		requireShape(keys.includes(key), `${where} has unknown key "${key}"`);
	}
	for (const key of keys) requireShape(key in value, `${where} is missing "${key}"`);
}

function compile(source, where) {
	try {
		return new RegExp(source);
	} catch (error) {
		throw new ConfigError(`${where}: invalid regular expression (${error.message})`);
	}
}

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

function globMatcher(globs) {
	const patterns = globs.map(globToRegExp);
	return (path) => patterns.some((pattern) => pattern.test(path));
}

const CONFIG_KEYS = [
	'generated',
	'pathScope',
	'pathAllow',
	'rootAllowlist',
	'docsAllowlist',
	'budgets',
	'globBudgets',
	'homeOnlyPatterns',
	'retired',
	'broadAllow',
	'enabledMcp',
];

function loadConfig(file) {
	let text;
	try {
		text = readFileSync(file, 'utf8');
	} catch (error) {
		throw new ConfigError(`cannot read config ${file} (${error.code ?? error.message})`);
	}
	let raw;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		throw new ConfigError(`config ${file} is not valid JSON (${error.message})`);
	}
	requireShape(isObject(raw), 'config must be a JSON object');
	for (const key of Object.keys(raw)) {
		requireShape(CONFIG_KEYS.includes(key) || key === 'surfaceSkip', `unknown config key "${key}"`);
	}
	for (const key of CONFIG_KEYS) requireShape(key in raw, `missing config key "${key}"`);
	for (const key of [
		'generated',
		'pathScope',
		'rootAllowlist',
		'docsAllowlist',
		'homeOnlyPatterns',
		'broadAllow',
		'enabledMcp',
	]) {
		requireShape(isTextArray(raw[key]), `"${key}" must be an array of non-empty strings`);
	}
	requireShape(Array.isArray(raw.pathAllow), '"pathAllow" must be an array');
	raw.pathAllow.forEach((entry, i) => {
		requireKeys(entry, ['file', 'token', 'reason'], `pathAllow[${i}]`);
		requireShape(
			isText(entry.file) && isText(entry.token) && isText(entry.reason),
			`pathAllow[${i}] needs non-empty file, token and reason`,
		);
	});
	requireShape(isObject(raw.budgets), '"budgets" must be an object');
	for (const [path, budget] of Object.entries(raw.budgets)) {
		requireKeys(budget, ['maxLines'], `budgets["${path}"]`);
		requireShape(
			Number.isInteger(budget.maxLines) && budget.maxLines > 0,
			`budgets["${path}"].maxLines must be a positive integer`,
		);
	}
	requireShape(Array.isArray(raw.globBudgets), '"globBudgets" must be an array');
	raw.globBudgets.forEach((budget, i) => {
		requireKeys(budget, ['glob', 'maxLinesEach'], `globBudgets[${i}]`);
		requireShape(
			isText(budget.glob) && Number.isInteger(budget.maxLinesEach) && budget.maxLinesEach > 0,
			`globBudgets[${i}] needs a glob and a positive integer maxLinesEach`,
		);
	});
	requireShape(Array.isArray(raw.retired), '"retired" must be an array');
	const retiredIds = new Set();
	raw.retired.forEach((entry, i) => {
		requireKeys(entry, ['id', 're', 'allow'], `retired[${i}]`);
		requireShape(
			isText(entry.id) && isText(entry.re) && isTextArray(entry.allow),
			`retired[${i}] needs an id, a re and an allow array of paths`,
		);
		requireShape(!retiredIds.has(entry.id), `retired id "${entry.id}" is duplicated`);
		retiredIds.add(entry.id);
	});
	const surfaceSkip = raw.surfaceSkip ?? [];
	requireShape(
		isTextArray(surfaceSkip) && surfaceSkip.every((check) => SURFACE_CHECKS.includes(check)),
		`"surfaceSkip" must list SURFACE checks among ${SURFACE_CHECKS.join(',')}`,
	);
	return {
		generated: globMatcher(raw.generated),
		pathScope: globMatcher(raw.pathScope),
		pathAllow: raw.pathAllow.map((entry) => ({ ...entry, matches: globMatcher([entry.file]) })),
		rootAllowlist: new Set(raw.rootAllowlist),
		docsAllowlist: new Set(raw.docsAllowlist),
		budgets: Object.entries(raw.budgets).map(([path, budget]) => ({ path, max: budget.maxLines })),
		globBudgets: raw.globBudgets.map((budget) => ({
			matches: globMatcher([budget.glob]),
			max: budget.maxLinesEach,
		})),
		homeOnly: raw.homeOnlyPatterns.map((source, i) => compile(source, `homeOnlyPatterns[${i}]`)),
		retired: raw.retired.map((entry, i) => ({
			id: entry.id,
			re: compile(entry.re, `retired[${i}] (${entry.id})`),
			allowed: globMatcher(entry.allow),
		})),
		broadAllow: new Set(raw.broadAllow),
		broadBash: raw.broadAllow.map(bashPrefix).filter((prefix) => prefix !== null),
		enabledMcp: raw.enabledMcp,
		surfaceSkip: new Set(surfaceSkip),
	};
}

/* ── Repository model ────────────────────────────────────────────────────── */

function loadRepository(config) {
	let output;
	try {
		output = execFileSync('git', ['ls-files', '-z'], {
			cwd: ROOT,
			encoding: 'utf8',
			maxBuffer: 1 << 28,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (error) {
		throw new ConfigError(`git ls-files failed (${String(error.stderr || error.message).trim()})`);
	}
	const files = new Set();
	const dirs = new Set();
	const symlinks = [];
	for (const path of output.split('\0')) {
		if (!path || files.has(path)) continue;
		let stat;
		try {
			stat = lstatSync(join(ROOT, path));
		} catch {
			continue; // tracked, but removed from the working tree
		}
		files.add(path);
		if (stat.isSymbolicLink()) symlinks.push(path);
		for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
			dirs.add(path.slice(0, i));
		}
	}
	const scanned = [...files].filter((path) => !config.generated(path)).sort();
	const packageDirs = [...dirs].filter((dir) => /^packages\/[^/]+$/.test(dir)).sort();
	return { files, dirs, symlinks, scanned, packageDirs, texts: new Map(), markdown: new Map() };
}

function readText(repo, path) {
	let text = repo.texts.get(path);
	if (text === undefined) {
		text = readFileSync(join(ROOT, path), 'utf8').replace(/\r\n?/g, '\n');
		repo.texts.set(path, text);
	}
	return text;
}

/** Repo-relative normal form; null when the path escapes the repository. */
function normalizeRel(path) {
	const normal = posix.normalize(path).replace(/\/+$/, '');
	if (normal === '.' || normal === '') return '';
	if (normal === '..' || normal.startsWith('../') || normal.startsWith('/')) return null;
	return normal;
}

/** A tracked file, a tracked directory prefix, or an existing path behind a tracked symlink. */
function isTracked(repo, rel) {
	if (rel === null) return false;
	if (rel === '' || repo.files.has(rel) || repo.dirs.has(rel)) return true;
	return repo.symlinks.some((link) => rel.startsWith(`${link}/`)) && existsSync(join(ROOT, rel));
}

function lineLocator(text) {
	const starts = [0];
	for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
	return (offset) => {
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const mid = (low + high + 1) >> 1;
			if (starts[mid] <= offset) low = mid;
			else high = mid - 1;
		}
		return low + 1;
	};
}

/* ── Markdown scanner ────────────────────────────────────────────────────── */

/**
 * Blank front matter and fenced code (CommonMark fences: >=3 backticks or tildes; the closer
 * uses the same character and is at least as long). Container blocks are approximated by
 * ignoring blockquote markers and indentation, so fences nested in list items are found.
 */
function maskFences(lines) {
	const masked = lines.slice();
	let start = 0;
	if (lines[0]?.trim() === '---') {
		const end = lines.findIndex((line, i) => i > 0 && /^(?:---|\.\.\.)[ \t]*$/.test(line));
		if (end !== -1) {
			for (let i = 0; i <= end; i++) masked[i] = '';
			start = end + 1;
		}
	}
	let fence = null;
	for (let i = start; i < lines.length; i++) {
		const body = lines[i].replace(/^(?:[ \t]*>)*[ \t]*/, '');
		if (fence) {
			const close = body.match(/^(`{3,}|~{3,})[ \t]*$/);
			if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
			masked[i] = '';
			continue;
		}
		const open = body.match(/^(`{3,}|~{3,})(.*)$/);
		if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
			fence = { char: open[1][0], length: open[1].length };
			masked[i] = '';
		}
	}
	return masked;
}

const blank = (segment) => segment.replace(/[^\n]/g, ' ');

function codeSpanEnd(text, from, length) {
	const pattern = /`+|\n[ \t]*\n/g;
	pattern.lastIndex = from;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		if (match[0][0] === '\n') return -1; // a code span never crosses a paragraph break
		if (match[0].length === length) return match.index;
	}
	return -1;
}

/** Blank inline code spans and HTML comments in document order; collect code span contents. */
function maskInline(text) {
	const parts = [];
	const spans = [];
	let copied = 0;
	const special = /\\.|<!--|`+/gs;
	for (let match = special.exec(text); match; match = special.exec(text)) {
		const token = match[0];
		if (token[0] === '\\') continue;
		let end;
		if (token === '<!--') {
			const close = text.indexOf('-->', match.index + 4);
			end = close === -1 ? text.length : close + 3;
		} else {
			const close = codeSpanEnd(text, match.index + token.length, token.length);
			if (close === -1) continue; // an unmatched backtick run is literal text
			spans.push({
				offset: match.index + token.length,
				content: text.slice(match.index + token.length, close),
			});
			end = close + token.length;
		}
		parts.push(text.slice(copied, match.index), blank(text.slice(match.index, end)));
		copied = end;
		special.lastIndex = end;
	}
	parts.push(text.slice(copied));
	return { text: parts.join(''), spans };
}

function markdownModel(repo, path) {
	let model = repo.markdown.get(path);
	if (!model) {
		const masked = maskFences(readText(repo, path).split('\n'));
		const joined = masked.join('\n');
		const inline = maskInline(joined);
		model = { masked, inline: inline.text, spans: inline.spans, lineAt: lineLocator(joined) };
		repo.markdown.set(path, model);
	}
	return model;
}

function headingTexts(masked) {
	const texts = [];
	for (let i = 0; i < masked.length; i++) {
		const line = masked[i];
		const atx = line.match(/^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/);
		if (atx) {
			texts.push(atx[1] ?? '');
			continue;
		}
		const next = masked[i + 1];
		if (
			next !== undefined &&
			line.trim() !== '' &&
			/^ {0,3}(?:=+|-+)[ \t]*$/.test(next) &&
			!/^ {0,3}(?:[-*+>|#]|\d+[.)])/.test(line)
		) {
			texts.push(line.trim());
			i++;
		}
	}
	return texts;
}

/** GitHub heading anchors (github-slugger rules) plus explicit <a name|id> anchors. */
function anchorsOf(repo, path) {
	const model = markdownModel(repo, path);
	if (!model.anchors) {
		const anchors = new Set();
		const seen = new Map();
		for (const heading of headingTexts(model.masked)) {
			const base = heading
				.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
				.replace(/<[^>]*>/g, '')
				.trim()
				.toLowerCase()
				.replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
				.replace(/ /g, '-');
			let slug = base;
			while (seen.has(slug)) {
				seen.set(base, seen.get(base) + 1);
				slug = `${base}-${seen.get(base)}`;
			}
			seen.set(slug, 0);
			anchors.add(slug);
		}
		for (const match of model.inline.matchAll(/<a\s[^>]*\b(?:name|id)=["']([^"']+)["']/gi)) {
			anchors.add(match[1].toLowerCase());
		}
		model.anchors = anchors;
	}
	return model.anchors;
}

function decode(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** Returns a finding message for an unresolved target or anchor, or null when it resolves. */
function checkReference(repo, rel, anchor, label) {
	if (!isTracked(repo, rel)) return `unresolved ${label}`;
	if (anchor && MARKDOWN.test(rel) && repo.files.has(rel)) {
		if (!anchorsOf(repo, rel).has(decode(anchor).toLowerCase())) {
			return `missing anchor "#${anchor}" in ${rel}`;
		}
	}
	return null;
}

/* ── Rules ───────────────────────────────────────────────────────────────── */

const INLINE_LINK =
	/\]\(\s*(<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/g;
const REFERENCE_DEFINITION = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(<[^<>\n]*>|\S+)/gm;

function ruleLink({ repo, add }) {
	for (const file of repo.scanned.filter((path) => MARKDOWN.test(path))) {
		const model = markdownModel(repo, file);
		const targets = [];
		for (const match of model.inline.matchAll(INLINE_LINK)) {
			targets.push({ raw: match[1], offset: match.index });
		}
		for (const match of model.inline.matchAll(REFERENCE_DEFINITION)) {
			if (!match[1].startsWith('^')) targets.push({ raw: match[2], offset: match.index });
		}
		for (const { raw, offset } of targets) {
			let target = (raw.startsWith('<') ? raw.slice(1, -1) : raw).trim();
			if (!target || /^(?:https?|mailto|tel):/i.test(target)) continue;
			let anchor = null;
			const hash = target.indexOf('#');
			if (hash !== -1) {
				anchor = target.slice(hash + 1);
				target = target.slice(0, hash);
			}
			const query = target.indexOf('?');
			if (query !== -1) {
				target = target.slice(0, query);
				anchor = null; // ?plain=1#L10 style anchors point into rendered source, not headings
			}
			const path = decode(target);
			let rel = file;
			if (path.startsWith('/')) rel = normalizeRel(path.slice(1));
			else if (path !== '') rel = normalizeRel(posix.join(posix.dirname(file), path));
			const problem = checkReference(repo, rel, anchor, `link target "${raw}"`);
			if (problem) add(file, model.lineAt(offset), 'LINK', problem);
		}
	}
}

const DOMAIN_PREFIX = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\//;
// A URI scheme such as chrome://inspect or wss://, but not a file:line suffix such as auth.ts:12.
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** The repository path a code span names, or null when the span is not path-like. */
function pathCandidate(content) {
	const token = content.trim();
	if (!token || /^[/~@$]/.test(token) || token.startsWith('http') || DOMAIN_PREFIX.test(token)) {
		return null;
	}
	if (/[\s*<>{…]/u.test(token) || token.includes('...') || URI_SCHEME.test(token)) return null;
	const path = token.replace(/#.*$/s, '').replace(/:\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/, '');
	// A bare extension such as `.toml` names a file type, not a file.
	const named = PATH_EXTENSION.test(path) && /[^/]\.[a-z]+$/.test(path);
	if (!path || !(path.includes('/') || named)) return null;
	return path;
}

/**
 * A slash token names a repository path only when it has a known extension, a trailing `/`,
 * a leading `./` or `../`, or a first segment that exists under one of the resolution bases.
 * Ordinary slash terms such as `origin/main` or `application/json` are not paths.
 */
function looksLikeRepoPath(repo, bases, path) {
	if (!path.includes('/') || PATH_EXTENSION.test(path) || path.endsWith('/')) return true;
	const first = path.slice(0, path.indexOf('/'));
	if (first === '.' || first === '..') return true;
	return bases.some((base) => isTracked(repo, normalizeRel(posix.join(base, first))));
}

function rulePath({ repo, config, add }) {
	const files = repo.scanned.filter(
		(path) => MARKDOWN.test(path) && path !== HISTORY && config.pathScope(path),
	);
	for (const file of files) {
		const model = markdownModel(repo, file);
		const bases = [posix.dirname(file), '', ...repo.packageDirs];
		for (const span of model.spans) {
			const path = pathCandidate(span.content);
			// Generated output locations may be absent or ignored until a generator runs.
			if (path === null || config.generated(normalizeRel(path) ?? '')) continue;
			if (!looksLikeRepoPath(repo, bases, path)) continue;
			const token = span.content.trim();
			if (bases.some((base) => isTracked(repo, normalizeRel(posix.join(base, path))))) continue;
			const allowed = config.pathAllow.some(
				(entry) => entry.matches(file) && (entry.token === token || entry.token === path),
			);
			if (!allowed) add(file, model.lineAt(span.offset), 'PATH', `unresolved path "${token}"`);
		}
	}
}

/** `#` line comments with single, double and triple-quoted strings (Python, TOML, Starlark). */
const HASH_TRIPLE = {
	line: ['#'],
	block: [
		['"""', '"""'],
		["'''", "'''"],
	],
	quotes: '\'"',
	multiline: '',
};

/**
 * Comment and string syntax per source language; `null` treats every match as a reference.
 * Extensions without an entry (ts, tsx, js, mjs, cjs, jsonc) use the C-style lexer.
 */
const LEXERS = {
	c: { line: ['//'], block: [['/*', '*/']], quotes: '\'"`', multiline: '`' },
	svelte: {
		line: ['//'],
		block: [
			['/*', '*/'],
			['<!--', '-->'],
		],
		quotes: '\'"`',
		multiline: '`',
	},
	css: { line: [], block: [['/*', '*/']], quotes: '\'"', multiline: '' },
	rs: { line: ['//'], block: [['/*', '*/']], quotes: '"', multiline: '"' },
	py: HASH_TRIPLE,
	toml: HASH_TRIPLE,
	rules: HASH_TRIPLE,
	yaml: { line: ['#'], block: [], quotes: '\'"', multiline: '' },
	yml: { line: ['#'], block: [], quotes: '\'"', multiline: '' },
	sql: { line: ['--'], block: [['/*', '*/']], quotes: '\'"', multiline: "'" },
	// Shell words are strings, so every match in a shell script counts.
	sh: null,
};

function lexerFor(path) {
	const extension = path.slice(path.lastIndexOf('.') + 1);
	return extension in LEXERS ? LEXERS[extension] : LEXERS.c;
}

/** Sorted [start, end) ranges of comments and string literals. */
function literalRanges(text, lexer) {
	const ranges = [];
	let i = 0;
	scan: while (i < text.length) {
		for (const marker of lexer.line) {
			if (text.startsWith(marker, i)) {
				const newline = text.indexOf('\n', i);
				const end = newline === -1 ? text.length : newline;
				ranges.push([i, end]);
				i = end;
				continue scan;
			}
		}
		for (const [open, close] of lexer.block) {
			if (text.startsWith(open, i)) {
				const found = text.indexOf(close, i + open.length);
				const end = found === -1 ? text.length : found + close.length;
				ranges.push([i, end]);
				i = end;
				continue scan;
			}
		}
		const char = text[i];
		if (lexer.quotes.includes(char)) {
			let j = i + 1;
			while (j < text.length && text[j] !== char) {
				if (text[j] === '\\') j++;
				else if (text[j] === '\n' && !lexer.multiline.includes(char)) break;
				j++;
			}
			const end = Math.min(j + 1, text.length);
			ranges.push([i, end]);
			i = end;
			continue;
		}
		i++;
	}
	return ranges;
}

function insideRanges(ranges, offset) {
	let low = 0;
	let high = ranges.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		if (offset < ranges[mid][0]) high = mid - 1;
		else if (offset >= ranges[mid][1]) low = mid + 1;
		else return true;
	}
	return false;
}

const SEE_TOKEN =
	/(?<![\w/.:-])(?:(?:docs|\.claude|\.agents)\/[\w./-]+|(?:AGENTS|CLAUDE)\.md)(?:#[\w-]+)?/g;

function ruleSee({ repo, config, add }) {
	for (const file of repo.scanned.filter((path) => SEE_EXTENSION.test(path) && !SELF.has(path))) {
		const text = readText(repo, file);
		const matches = [...text.matchAll(SEE_TOKEN)];
		if (matches.length === 0) continue;
		const lexer = lexerFor(file);
		const ranges = lexer ? literalRanges(text, lexer) : null;
		const lineAt = lineLocator(text);
		for (const match of matches) {
			if (ranges && !insideRanges(ranges, match.index)) continue;
			const [target, anchor = null] = match[0].split('#');
			const rel = normalizeRel(target.replace(/[./]+$/, ''));
			// Generated output locations (for example an ignored history directory) are not docs.
			if (rel !== null && config.generated(rel)) continue;
			const problem = checkReference(repo, rel, anchor, `reference "${match[0]}"`);
			if (problem) add(file, lineAt(match.index), 'SEE', problem);
		}
	}
}

function ruleRetired({ repo, config, add }) {
	const files = repo.scanned.filter(
		(path) =>
			(RETIRED_EXTENSION.test(path) || RETIRED_BASENAMES.has(posix.basename(path))) &&
			!SELF.has(path) &&
			path !== HISTORY,
	);
	for (const file of files) {
		const entries = config.retired.filter((entry) => !entry.allowed(file));
		if (entries.length === 0) continue;
		readText(repo, file)
			.split('\n')
			.forEach((line, i) => {
				for (const entry of entries) {
					const match = line.match(entry.re);
					if (match) add(file, i + 1, 'RETIRED', `${entry.id}: "${match[0]}"`);
				}
			});
	}
}

function ruleRoot({ repo, config, add }) {
	const docsEntries = new Set();
	for (const path of repo.files) {
		if (!path.includes('/') && !config.rootAllowlist.has(path)) {
			add(path, 1, 'ROOT', 'root-level file is not in rootAllowlist');
		}
		if (path.startsWith('docs/')) {
			const rest = path.slice('docs/'.length);
			const slash = rest.indexOf('/');
			docsEntries.add(slash === -1 ? rest : rest.slice(0, slash + 1));
		}
	}
	for (const entry of docsEntries) {
		if (!config.docsAllowlist.has(entry)) {
			add(`docs/${entry}`, 1, 'ROOT', 'docs/ top-level entry is not in docsAllowlist');
		}
	}
}

const countLines = (text) => text.split('\n').length - 1;

function ruleBudget({ repo, config, add }) {
	const check = (path, max) => {
		const lines = countLines(readFileSync(join(ROOT, path), 'utf8'));
		if (lines > max) add(path, max + 1, 'BUDGET', `${lines} lines exceeds the budget of ${max}`);
	};
	for (const { path, max } of config.budgets) {
		if (repo.files.has(path)) check(path, max);
		else add(path, 1, 'BUDGET', `budgeted file is missing (maxLines ${max})`);
	}
	for (const { matches, max } of config.globBudgets) {
		for (const path of repo.scanned.filter(matches)) check(path, max);
	}
}

function ruleHome({ repo, config, add }) {
	for (const file of repo.scanned.filter((path) => MARKDOWN.test(path))) {
		const base = posix.basename(file).toLowerCase();
		if (base === 'status.md' && file !== STATUS) {
			add(file, 1, 'HOME', `status documents live only in ${STATUS}`);
		}
		if (base === 'roadmap.md' && file !== ROADMAP) {
			add(file, 1, 'HOME', `roadmap documents live only in ${ROADMAP}`);
		}
		if (file === STATUS) continue;
		readText(repo, file)
			.split('\n')
			.forEach((line, i) => {
				for (const pattern of config.homeOnly) {
					if (pattern.test(line)) {
						add(file, i + 1, 'HOME', `status marker /${pattern.source}/ belongs only in ${STATUS}`);
					}
				}
			});
	}
}

function findLine(lines, pattern) {
	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(pattern);
		if (match) return { line: i + 1, value: match[1] };
	}
	return null;
}

function ruleSync({ repo, add }) {
	const missing = [PROJECT, STATUS].filter((path) => !repo.files.has(path));
	for (const path of missing) add(path, 1, 'SYNC', 'file is missing');
	if (missing.length > 0) return;

	const yaml = readText(repo, PROJECT).split('\n');
	const phase = findLine(yaml, /^\s*local_phase:\s*"(.*)"\s*$/);
	const asOf = findLine(yaml, /^\s*as_of:\s*"(.*)"\s*$/);
	const record = findLine(yaml, /^\s*status_of_record:\s*(.*?)\s*$/);
	if (!phase) add(PROJECT, 1, 'SYNC', 'no quoted status.local_phase line');
	if (!asOf) add(PROJECT, 1, 'SYNC', 'no quoted status.as_of line');
	if (!record || record.value.replace(/^(["'])(.*)\1$/, '$2') !== STATUS) {
		add(PROJECT, record?.line ?? 1, 'SYNC', `authority.status_of_record must be ${STATUS}`);
	}

	const model = markdownModel(repo, STATUS);
	const statusPhase = findLine(
		model.masked,
		/^(?:[-*][ \t]+)?\*\*Current phase:\*\*[ \t]+(.*?)[ \t]*$/,
	);
	const statusAsOf = findLine(model.masked, /^(?:[-*][ \t]+)?\*\*As of:\*\*[ \t]+(\S+)/);
	if (!statusPhase) add(STATUS, 1, 'SYNC', 'no **Current phase:** line');
	else if (phase && statusPhase.value !== phase.value) {
		add(
			STATUS,
			statusPhase.line,
			'SYNC',
			`**Current phase:** "${statusPhase.value}" differs from ${PROJECT} local_phase "${phase.value}"`,
		);
	}
	if (!statusAsOf) add(STATUS, 1, 'SYNC', 'no **As of:** line');
	else if (asOf && statusAsOf.value !== asOf.value) {
		add(
			STATUS,
			statusAsOf.line,
			'SYNC',
			`**As of:** "${statusAsOf.value}" differs from ${PROJECT} as_of "${asOf.value}"`,
		);
	}

	const heading = model.masked.findIndex((line) =>
		/^##[ \t]+(?:\d+\.[ \t]+)?Decisions[ \t]*$/.test(line),
	);
	if (heading === -1) {
		add(STATUS, 1, 'SYNC', 'no "## Decisions" section');
		return;
	}
	let expected = 1;
	for (let i = heading + 1; i < model.masked.length; i++) {
		const line = model.masked[i];
		if (/^#{1,2}[ \t]/.test(line)) break;
		const number = line.match(/^([0-9]+)\. /);
		if (!number) continue;
		if (Number(number[1]) !== expected) {
			add(
				STATUS,
				i + 1,
				'SYNC',
				`decision ${number[1]} breaks the sequence (expected ${expected})`,
			);
			return;
		}
		expected++;
	}
	if (expected === 1)
		add(STATUS, heading + 1, 'SYNC', 'the Decisions section has no numbered decisions');
}

function lineContaining(text, needle) {
	const index = text.indexOf(needle);
	return index === -1 ? 1 : countLines(text.slice(0, index)) + 1;
}

function frontMatter(text) {
	const lines = text.split('\n');
	if (lines[0]?.trim() !== '---') return null;
	const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
	if (end === -1) return null;
	const fields = {};
	let key = null;
	for (const line of lines.slice(1, end)) {
		const field = line.match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
		if (field) {
			key = field[1];
			fields[key] = field[2].trim();
		} else if (key && /^[ \t]+\S/.test(line)) {
			fields[key] = `${fields[key]} ${line.trim()}`.trim();
		}
	}
	for (const [name, value] of Object.entries(fields)) {
		fields[name] = value
			.replace(/^[>|][+-]?\s*/, '')
			.replace(/^(["'])(.*)\1$/, '$2')
			.trim();
	}
	return fields;
}

/**
 * The command prefix a Claude `Bash` permission rule allows, or null for any other tool.
 * A trailing `:*` equals a trailing ` *`; trailing wildcards and whitespace are dropped, so
 * `Bash`, `Bash(*)` and `Bash( *)` all become the empty prefix that matches every command.
 */
function bashPrefix(rule) {
	const match = typeof rule === 'string' ? rule.match(/^Bash(?:\((.*)\))?$/s) : null;
	if (!match) return null;
	return (match[1] ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/:\*+$/, ' *')
		.replace(/[\s*]+$/, '');
}

/**
 * Why an allow rule is broad, or null when it is narrow. A rule is broad when listed verbatim,
 * when its Bash prefix covers a broad prefix, or when a `*` remains before its trailing
 * wildcard: Claude Code matches a mid-pattern `*` across spaces, so `Bash(pnpm --filter * x)`
 * allows `pnpm --filter y exec git push origin x`. Only allow rules are checked.
 */
function broadAllowReason(config, rule) {
	if (config.broadAllow.has(rule)) return 'is listed in broadAllow';
	const prefix = bashPrefix(rule);
	if (prefix === null) return null;
	if (prefix === '') return 'allows every command';
	if (prefix.includes('*')) return 'has a mid-pattern wildcard that matches across words';
	return config.broadBash.some((broad) => broad.startsWith(prefix))
		? 'covers a broadAllow prefix'
		: null;
}

function ruleSurface({ repo, config, add }) {
	const report = (check, file, line, message) =>
		add(file, line, 'SURFACE', `(${check}) ${message}`, config.surfaceSkip.has(check));

	if (!repo.files.has(SETTINGS)) {
		report('a', SETTINGS, 1, 'settings file is missing');
	} else {
		const text = readText(repo, SETTINGS);
		let settings = null;
		try {
			settings = JSON.parse(text);
		} catch (error) {
			report('a', SETTINGS, 1, `settings do not parse (${error.message})`);
		}
		if (isObject(settings)) {
			if ('hooks' in settings) {
				report('a', SETTINGS, lineContaining(text, '"hooks"'), 'settings must not register hooks');
			}
			const allow = settings.permissions?.allow;
			for (const rule of Array.isArray(allow) ? allow : []) {
				const reason = broadAllowReason(config, rule);
				if (reason) {
					report(
						'b',
						SETTINGS,
						lineContaining(text, JSON.stringify(rule)),
						`broad allow rule ${JSON.stringify(rule)} ${reason}`,
					);
				}
			}
			const enabled = JSON.stringify(settings.enabledMcpjsonServers ?? null);
			if (enabled !== JSON.stringify(config.enabledMcp)) {
				report(
					'c',
					SETTINGS,
					lineContaining(text, '"enabledMcpjsonServers"'),
					`enabledMcpjsonServers is ${enabled}; expected ${JSON.stringify(config.enabledMcp)}`,
				);
			}
		} else if (settings !== null) {
			report('a', SETTINGS, 1, 'settings must be a JSON object');
		}
	}

	const skills = new Set();
	for (const path of repo.files) {
		const match = path.match(/^\.agents\/skills\/([^/]+)\//);
		if (match) skills.add(match[1]);
	}
	for (const name of [...skills].sort()) {
		const skillFile = `.agents/skills/${name}/SKILL.md`;
		if (!repo.files.has(skillFile)) {
			report('d', `.agents/skills/${name}`, 1, 'skill directory has no SKILL.md');
		} else {
			const fields = frontMatter(readText(repo, skillFile));
			if (!fields) report('d', skillFile, 1, 'SKILL.md has no YAML front matter');
			else {
				if (fields.name !== name) {
					report(
						'd',
						skillFile,
						1,
						`front matter name "${fields.name ?? ''}" must equal "${name}"`,
					);
				}
				if (!fields.description) report('d', skillFile, 1, 'front matter description is empty');
			}
		}
		const link = `.claude/skills/${name}`;
		const expected = `../../.agents/skills/${name}`;
		let stat = null;
		try {
			stat = lstatSync(join(ROOT, link));
		} catch {
			report('e', link, 1, `missing symlink to ${expected}`);
		}
		if (stat && !stat.isSymbolicLink()) report('e', link, 1, `must be a symlink to ${expected}`);
		else if (stat && readlinkSync(join(ROOT, link)) !== expected) {
			report('e', link, 1, `symlink must point to ${expected}`);
		}
	}

	// Tracked entries only (tracked symlinks are files here), so untracked local clutter such
	// as .DS_Store or a personal skill cannot make the local result differ from CI.
	const entries = new Set();
	for (const path of repo.files) {
		if (path.startsWith('.claude/skills/')) entries.add(path.slice('.claude/skills/'.length));
	}
	for (const entry of [...entries].sort()) {
		if (!skills.has(entry)) {
			report('f', `.claude/skills/${entry}`, 1, 'not a symlink to a portable .agents skill');
		}
	}

	for (const path of repo.files) {
		if (/^(?:\.claude\/commands|\.claude\/hooks|scripts\/hooks)\//.test(path)) {
			report('g', path, 1, 'retired agent surface is tracked');
		}
	}
}

const RULE_IMPLEMENTATIONS = {
	LINK: ruleLink,
	PATH: rulePath,
	SEE: ruleSee,
	RETIRED: ruleRetired,
	ROOT: ruleRoot,
	BUDGET: ruleBudget,
	HOME: ruleHome,
	SYNC: ruleSync,
	SURFACE: ruleSurface,
};

/* ── Main ────────────────────────────────────────────────────────────────── */

function main() {
	let options;
	let config;
	let repo;
	try {
		options = parseArgs(process.argv.slice(2));
		config = loadConfig(options.config);
		repo = loadRepository(config);
	} catch (error) {
		if (!(error instanceof ConfigError)) throw error;
		process.stderr.write(`check-docs: ${error.message}\n`);
		process.exitCode = 2;
		return;
	}

	const findings = [];
	const add = (file, line, rule, message, reportOnly = false) =>
		findings.push({ file, line, rule, message, reportOnly });
	for (const rule of options.only ?? RULES) RULE_IMPLEMENTATIONS[rule]({ repo, config, add });

	findings.sort(
		(a, b) =>
			(a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
			a.line - b.line ||
			(a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
			(a.message < b.message ? -1 : a.message > b.message ? 1 : 0),
	);
	const lines = findings.map(
		(f) =>
			`${f.file}:${f.line}: ${f.rule} ${f.message}${f.reportOnly ? ' (report-only: surfaceSkip)' : ''}`,
	);
	if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);

	const failing = findings.filter((finding) => !finding.reportOnly).length;
	process.stderr.write(
		`check-docs: ${failing} finding(s) across ${repo.scanned.length} scanned files` +
			`${findings.length > failing ? `, ${findings.length - failing} report-only` : ''}\n`,
	);
	process.exitCode = options.report || failing === 0 ? 0 : 1;
}

main();
