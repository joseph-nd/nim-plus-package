/**
 * Local helpers for the pack-data suite (pure data checks, no Foundry mock).
 *
 * - ruleSchemas(): rule type → declared field tree, parsed from the Nimble TS
 *   sources (src/models/rules/<type>.ts `function schema()` + base.ts).
 * - nimDocs()/sysDocs(): every Nim+ / system document with its pack + uuid.
 * - walkStrings(): every string value in a doc (for UUID scanning).
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPackData, NIMBLE_ROOT, REPO_ROOT, MODULE_ID } from '../harness/index.mjs';

export const RULES_DIR = path.join(NIMBLE_ROOT, 'src/models/rules');
export const FOUNDRY_PUBLIC = '/home/jnunez/.local/opt/foundryvtt/resources/app/public';
export const TXT_DIR =
	'/tmp/claude-1000/-home-jnunez-Projects-foundry-vtt-modules-blue-codex-package/9221e053-ac5e-40f6-8b85-ed07b67e312c/scratchpad/core02/txt';

/* ───────────────────────────── TS schema parser ───────────────────────────── */

/** Index of the brace/paren/bracket that closes the one opening at `start`. Skips strings and comments. */
function matchClose(src, start) {
	const open = src[start];
	const close = { '{': '}', '(': ')', '[': ']' }[open];
	let depth = 0;
	for (let i = start; i < src.length; i += 1) {
		const c = src[i];
		if (c === '/' && src[i + 1] === '/') {
			i = src.indexOf('\n', i);
			if (i < 0) return -1;
			continue;
		}
		if (c === '/' && src[i + 1] === '*') {
			i = src.indexOf('*/', i) + 1;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') {
			let j = i + 1;
			while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
			i = j;
			continue;
		}
		if (c === open) depth += 1;
		else if (c === close) {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Parse an object literal body `{ ... }` into {key: {text, nested?}} at depth 1.
 * `nested` is set when the value contains `new fields.SchemaField({` (directly or in an ArrayField).
 */
function parseObjectLiteral(src, openIdx) {
	const closeIdx = matchClose(src, openIdx);
	const body = src.slice(openIdx + 1, closeIdx);
	const out = {};
	let i = 0;
	while (i < body.length) {
		const rest = body.slice(i);
		const ws = /^[\s,]+/.exec(rest);
		if (ws) {
			i += ws[0].length;
			continue;
		}
		if (rest.startsWith('//')) {
			i = body.indexOf('\n', i);
			if (i < 0) break;
			continue;
		}
		if (rest.startsWith('/*')) {
			i = body.indexOf('*/', i) + 2;
			continue;
		}
		if (rest.startsWith('...')) {
			// spread — skip the expression
			const m = /^\.\.\.[\w.()]+/.exec(rest);
			i += m ? m[0].length : 3;
			continue;
		}
		const km = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:/.exec(rest);
		if (!km) {
			i += 1;
			continue;
		}
		const key = km[1] ?? km[2] ?? km[3];
		let j = i + km[0].length;
		const valStart = j;
		// value runs until the next depth-0 comma
		while (j < body.length && body[j] !== ',') {
			if ('{(['.includes(body[j])) j = matchClose(body, j) + 1;
			else if (body[j] === "'" || body[j] === '"' || body[j] === '`') {
				let k = j + 1;
				while (k < body.length && body[k] !== body[j]) k += body[k] === '\\' ? 2 : 1;
				j = k + 1;
			} else if (body[j] === '/' && body[j + 1] === '/') j = body.indexOf('\n', j);
			else j += 1;
		}
		const text = body.slice(valStart, j);
		const entry = { text };
		const sm = /new fields\.SchemaField\(\s*\{/.exec(text);
		if (sm) {
			const braceAt = text.indexOf('{', sm.index);
			entry.nested = parseObjectLiteral(text, braceAt);
		}
		out[key] = entry;
		i = j + 1;
	}
	return out;
}

function schemaOfFile(file) {
	const src = fs.readFileSync(file, 'utf-8');
	const fn = src.indexOf('function schema()');
	if (fn < 0) return null;
	const ret = src.indexOf('return {', fn);
	return parseObjectLiteral(src, src.indexOf('{', ret));
}

let schemaCache = null;

/**
 * rule type → field tree ({key: {text, nested?}}), base fields merged in.
 * Types come from config/registerRulesConfig.ts `ruleDataModels`.
 */
export function ruleSchemas() {
	if (schemaCache) return schemaCache;
	const reg = fs.readFileSync(path.join(NIMBLE_ROOT, 'src/config/registerRulesConfig.ts'), 'utf-8');
	const imports = new Map(
		[...reg.matchAll(/import \{ (\w+) \} from '\.\.\/models\/rules\/(\w+)\.(?:js|ts)'/g)].map((m) => [m[1], m[2]]),
	);
	const modelsBlock = reg.slice(reg.indexOf('const ruleDataModels'));
	const body = modelsBlock.slice(modelsBlock.indexOf('{'), matchClose(modelsBlock, modelsBlock.indexOf('{')));
	const base = schemaOfFile(path.join(RULES_DIR, 'base.ts'));
	const out = new Map();
	for (const m of body.matchAll(/(\w+):\s*(\w+),/g)) {
		const file = imports.get(m[2]);
		if (!file) continue;
		const own = schemaOfFile(path.join(RULES_DIR, `${file}.ts`)) ?? {};
		out.set(m[1], { ...base, ...own });
	}
	schemaCache = out;
	return out;
}

/* ── choices resolution: literal arrays, file-level consts, *RuleConfig objects ── */

let constCache = null;

/** NAME → expression text for every top-level `const NAME = …;` in the rule files, plus `Config.key` entries. */
function constTable() {
	if (constCache) return constCache;
	const table = new Map();
	for (const f of fs.readdirSync(RULES_DIR)) {
		if (!f.endsWith('.ts') || f.includes('.test.')) continue;
		const src = fs.readFileSync(path.join(RULES_DIR, f), 'utf-8');
		for (const m of src.matchAll(/^const ([A-Z_][A-Z0-9_]*) = /gm)) {
			let j = m.index + m[0].length;
			const start = j;
			while (j < src.length && src[j] !== ';') j = '{(['.includes(src[j]) ? matchClose(src, j) + 1 : j + 1;
			if (!table.has(m[1])) table.set(m[1], src.slice(start, j));
		}
	}
	for (const [file, name] of [
		['src/utils/chargePoolRuleConfig.ts', 'ChargePoolRuleConfig'],
		['src/utils/dicePool/dicePoolRuleConfig.ts', 'DicePoolRuleConfig'],
	]) {
		const src = fs.readFileSync(path.join(NIMBLE_ROOT, file), 'utf-8');
		const at = src.indexOf(`const ${name} = {`);
		const obj = parseObjectLiteral(src, src.indexOf('{', at));
		for (const [k, v] of Object.entries(obj)) table.set(`${name}.${k}`, v.text);
	}
	constCache = table;
	return table;
}

/** Split an array-literal body on depth-0 commas. */
function splitTop(body) {
	const parts = [];
	let depth = 0;
	let cur = '';
	for (let i = 0; i < body.length; i += 1) {
		const c = body[i];
		if (c === "'" || c === '"') {
			const j = body.indexOf(c, i + 1);
			cur += body.slice(i, j + 1);
			i = j;
			continue;
		}
		if ('([{'.includes(c)) depth += 1;
		if (')]}'.includes(c)) depth -= 1;
		if (c === ',' && depth === 0) {
			parts.push(cur);
			cur = '';
		} else cur += c;
	}
	parts.push(cur);
	return parts.map((p) => p.replace(/\/\/.*$/gm, '').trim()).filter(Boolean);
}

/** Evaluate a static string-array expression, or null when it is dynamic (CONFIG lookups, functions). */
export function resolveArrayExpr(expr, depth = 0) {
	if (depth > 8) return null;
	let e = String(expr)
		.replace(/\/\/.*$/gm, '')
		.replace(/\bas (?:const|unknown|never|string\[\])/g, '')
		.trim();
	e = e.replace(/\s+as\s*$/, '').trim();
	const af = /^Array\.from\(\s*new Set(?:<[^>]*>)?\(\s*([\s\S]*)\)\s*,?\s*\)$/.exec(e);
	if (af) return resolveArrayExpr(af[1], depth + 1);
	if (e.startsWith('[')) {
		const close = matchClose(e, 0);
		const out = [];
		for (const part of splitTop(e.slice(1, close))) {
			const lit = /^'([^']*)'$|^"([^"]*)"$/.exec(part);
			if (lit) out.push(lit[1] ?? lit[2]);
			else if (part.startsWith('...')) {
				const sub = resolveArrayExpr(part.slice(3), depth + 1);
				if (!sub) return null;
				out.push(...sub);
			} else return null;
		}
		return [...new Set(out)];
	}
	const t = constTable();
	if (t.has(e)) return resolveArrayExpr(t.get(e), depth + 1);
	return null;
}

/** Static `choices` of a schema field, or null (no choices / dynamic). */
export function fieldChoices(entry) {
	const text = entry?.text ?? '';
	const m = /choices:\s*/.exec(text);
	if (!m) return null;
	// only the choices of the field itself (ArrayField element choices are the element's)
	let j = m.index + m[0].length;
	const start = j;
	while (j < text.length && text[j] !== ',' && text[j] !== '\n') j = '{(['.includes(text[j]) ? matchClose(text, j) + 1 : j + 1;
	return resolveArrayExpr(text.slice(start, j));
}

/* ───────────────────────────── documents ───────────────────────────── */

/** [{uuid, doc, pack, collection, file}] for one package. */
function docsOf(pkg) {
	const out = [];
	for (const pack of loadPackData().packs.values()) {
		if (pack.pkg !== pkg) continue;
		for (const doc of pack.docs) {
			out.push({
				uuid: `Compendium.${pack.collection}.${pack.type}.${doc._id}`,
				doc,
				pack,
				collection: pack.collection,
				file: doc.__file,
			});
		}
	}
	return out;
}

export const nimDocs = () => docsOf(MODULE_ID);
export const sysDocs = () => docsOf('nimble');

/** Every (path, string) in an object tree. */
export function walkStrings(obj, prefix = '', out = []) {
	if (typeof obj === 'string') out.push([prefix, obj]);
	else if (Array.isArray(obj)) obj.forEach((v, i) => walkStrings(v, `${prefix}[${i}]`, out));
	else if (obj && typeof obj === 'object') {
		for (const [k, v] of Object.entries(obj)) walkStrings(v, prefix ? `${prefix}.${k}` : k, out);
	}
	return out;
}

/** Embedded items of an actor doc (companions), for rule checks. */
export function rulesOf(doc) {
	const own = Array.isArray(doc.system?.rules) ? doc.system.rules.map((r, i) => ({ rule: r, where: `system.rules[${i}]`, item: doc })) : [];
	const embedded = (doc.items ?? []).flatMap((it, j) =>
		(Array.isArray(it.system?.rules) ? it.system.rules : []).map((r, i) => ({ rule: r, where: `items[${j}](${it.name}).system.rules[${i}]`, item: it })),
	);
	return [...own, ...embedded];
}

export function canonicalUuid(uuid) {
	const m = /^Compendium\.([^.]+)\.([^.]+)\.(?:(Item|Actor)\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ''));
	return m ? `Compendium.${m[1]}.${m[2]}.${m[3] ?? 'Item'}.${m[4]}` : null;
}

export function readModuleJson() {
	return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'module.json'), 'utf-8'));
}

export function readIds() {
	return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'pack-sources/ids.json'), 'utf-8'));
}

/** Resolve an `img` path to a filesystem path (or null when it is not a local path we can check). */
export function imgFile(img) {
	if (!img) return null;
	if (img.startsWith(`modules/${MODULE_ID}/`)) return path.join(REPO_ROOT, img.slice(`modules/${MODULE_ID}/`.length));
	if (img.startsWith('systems/nimble/')) return path.join(NIMBLE_ROOT, 'public', img.slice('systems/nimble/'.length));
	if (img.startsWith('icons/')) return path.join(FOUNDRY_PUBLIC, img);
	return null;
}

export function txt(name) {
	return fs.readFileSync(path.join(TXT_DIR, name), 'utf-8');
}

export { REPO_ROOT, NIMBLE_ROOT, MODULE_ID };

/* ── CONFIG.NIMBLE enums (keys of the static objects in src/config.ts / registerConditionsConfig.ts) ── */

let configCache = null;

export function configEnum(name) {
	if (!configCache) {
		configCache = new Map();
		const src = fs.readFileSync(path.join(NIMBLE_ROOT, 'src/config.ts'), 'utf-8');
		for (const m of src.matchAll(/^const (\w+)(?::[^=]+)? = \{/gm)) {
			const open = src.indexOf('{', m.index + m[0].length - 1);
			configCache.set(m[1], Object.keys(parseObjectLiteral(src, open)));
		}
		const cond = fs.readFileSync(path.join(NIMBLE_ROOT, 'src/config/registerConditionsConfig.ts'), 'utf-8');
		const open = cond.indexOf('{', cond.indexOf('blinded') - 40);
		configCache.set('conditions', Object.keys(parseObjectLiteral(cond, open)));
	}
	return configCache.get(name) ?? null;
}

/**
 * Allowed values of a schema field: static choices, or for `() => CONFIG.NIMBLE.x` choices the config keys
 * plus any literal extras ('all', 'known'). Null when there are no choices or they cannot be derived.
 */
export function allowedValues(entry) {
	const stat = fieldChoices(entry);
	if (stat) return stat;
	const text = entry?.text ?? '';
	const m = /choices:\s*\(\)\s*=>([^\n]*)/.exec(text) ?? /choices:\s*([A-Z_]+)/.exec(text);
	if (!m) return null;
	const cfg = /CONFIG\.NIMBLE\.(\w+)/.exec(m[1]);
	if (!cfg) return null;
	const keys = configEnum(cfg[1]);
	if (!keys) return null;
	const extras = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
	if (/ALL_TARGETS/.test(m[1])) extras.push('all');
	return [...keys, ...extras];
}

/* ── exact Foundry slugify (the harness one approximates CHAR_MAP with NFD and misses '&' → 'and') ── */

let charMap = null;

function foundryCharMap() {
	if (charMap) return charMap;
	const src = fs.readFileSync(path.join(FOUNDRY_PUBLIC, '../common/primitives/string.mjs'), 'utf-8');
	const m = /const CHAR_MAP = JSON\.parse\('((?:[^'\\]|\\.)*)'\);/.exec(src);
	// The literal is a JS single-quoted string holding JSON: let JS unescape it, then parse the JSON.
	// eslint-disable-next-line no-new-func
	charMap = JSON.parse(Function(`return '${m[1]}';`)());
	return charMap;
}

/** String.prototype.slugify from Foundry v14 common/primitives/string.mjs. */
export function foundrySlugify(str, { replacement = '-', strict = false, lowercase = true } = {}) {
	const map = foundryCharMap();
	let slug = String(str)
		.split('')
		.reduce((r, c) => r + (map[c] || c), '')
		.trim();
	if (lowercase) slug = slug.toLowerCase();
	slug = slug.replace(new RegExp(`[\\s${replacement}]+`, 'g'), replacement);
	if (strict) slug = slug.replace(new RegExp(`[^a-zA-Z0-9${replacement}]`, 'g'), '');
	return slug;
}

/* ── known-bug bookkeeping ── */

/**
 * Violations not explained by any known bug. `known` maps a bug id to a predicate over a violation
 * string; each known bug also gets its own `it.fails` test asserting `onlyBug(...)` is empty.
 */
export function unexplained(violations, known) {
	return violations.filter((v) => !Object.values(known).some((match) => match(v)));
}

export function onlyBug(violations, known, id) {
	return violations.filter((v) => known[id](v));
}
