/**
 * Pure data checks for the pack-data suite. Every check returns a list of
 * violation strings `"<file> <where>: <what>"` so tests can compare against an
 * explicit list of known bugs (see known-bugs in each test file).
 */
import fs from 'node:fs';
import path from 'node:path';
import { getProperty } from '../harness/index.mjs';
import { foundrySlugify as slugify } from './lib.mjs';
import {
	allowedValues,
	canonicalUuid,
	imgFile,
	MODULE_ID,
	NIMBLE_ROOT,
	nimDocs,
	readIds,
	readModuleJson,
	REPO_ROOT,
	ruleSchemas,
	rulesOf,
	sysDocs,
	walkStrings,
	configEnum,
} from './lib.mjs';

/* ───────────────────────────── shape ───────────────────────────── */

export const PACK_TYPES = {
	'nim-plus-classes': ['class'],
	'nim-plus-subclasses': ['subclass'],
	'nim-plus-class-features': ['feature'],
	'nim-plus-spells': ['spell'],
	'nim-plus-items': ['object', 'feature'],
	'nim-plus-companions': ['character', 'minion', 'npc', 'soloMonster'],
	'nim-plus-feats': ['feature'],
	'nim-plus-ancestries': ['ancestry', 'ancestryBonus'],
	'nim-plus-backgrounds': ['background'],
};

export function checkTypes() {
	const out = [];
	for (const { doc, file, pack } of nimDocs()) {
		const allowed = PACK_TYPES[pack.name];
		if (!allowed) out.push(`${file}: pack ${pack.name} has no type whitelist`);
		else if (!allowed.includes(doc.type)) out.push(`${file}: type "${doc.type}" not valid for ${pack.name}`);
	}
	return out;
}

export function checkNames() {
	const out = [];
	for (const { doc, file } of nimDocs()) {
		if (typeof doc.name !== 'string' || !doc.name.trim()) out.push(`${file}: empty name`);
		else if (doc.name !== doc.name.trim()) out.push(`${file}: name has surrounding whitespace "${doc.name}"`);
		for (const [i, it] of (doc.items ?? []).entries()) {
			if (typeof it.name !== 'string' || !it.name.trim()) out.push(`${file} items[${i}]: empty name`);
		}
	}
	return out;
}

export function checkImages() {
	const out = [];
	const check = (file, where, img) => {
		if (typeof img !== 'string' || !img.trim()) {
			out.push(`${file} ${where}: img missing`);
			return;
		}
		const f = imgFile(img);
		if (f === null) out.push(`${file} ${where}: img "${img}" is not a module/system/core path`);
		else if (!fs.existsSync(f)) out.push(`${file} ${where}: img "${img}" does not exist (${f})`);
	};
	for (const { doc, file } of nimDocs()) {
		check(file, 'img', doc.img);
		if (doc.prototypeToken?.texture?.src) check(file, 'prototypeToken.texture.src', doc.prototypeToken.texture.src);
		for (const [i, it] of (doc.items ?? []).entries()) check(file, `items[${i}](${it.name}).img`, it.img);
	}
	return out;
}

/** Every Nim+ source file has an ids.json entry (and it matches the file's own `_id`, if any). */
export function checkIds() {
	const out = [];
	const ids = readIds();
	const moduleJson = readModuleJson();
	const seen = new Map();
	for (const meta of moduleJson.packs) {
		const dir = meta.flags?.sourceDir;
		const root = path.join(REPO_ROOT, 'pack-sources');
		for (const file of walkJson(path.join(root, dir))) {
			const rel = path.relative(root, file).replace(/\.json$/, '');
			const id = getProperty(ids, rel.split(path.sep).join('.'));
			const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
			if (typeof id !== 'string') out.push(`pack-sources/${rel}.json: no ids.json entry`);
			else {
				if (!/^[A-Za-z0-9]{16}$/.test(id)) out.push(`pack-sources/${rel}.json: malformed id ${id}`);
				if (json._id && json._id !== id) out.push(`pack-sources/${rel}.json: _id ${json._id} ≠ ids.json ${id}`);
				const key = `${meta.name}:${id}`;
				if (seen.has(key)) out.push(`pack-sources/${rel}.json: duplicate id ${id} (also ${seen.get(key)})`);
				seen.set(key, rel);
			}
		}
	}
	return out;
}

/** ids.json entries whose source file no longer exists (stale ids). */
export function staleIds() {
	const out = [];
	const ids = readIds();
	const root = path.join(REPO_ROOT, 'pack-sources');
	const walk = (obj, prefix) => {
		for (const [k, v] of Object.entries(obj)) {
			const p = prefix ? `${prefix}/${k}` : k;
			if (typeof v === 'string') {
				if (!fs.existsSync(path.join(root, `${p}.json`))) out.push(`ids.json ${p}: no source file`);
			} else if (v && typeof v === 'object') walk(v, p);
		}
	};
	walk(ids, '');
	return out;
}

export function walkJson(dir) {
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...walkJson(full));
		else if (e.name.endsWith('.json')) out.push(full);
	}
	return out.sort();
}

/* ───────────────────────────── folder / path conventions ───────────────────────────── */

export function classIdentifiers() {
	const ids = new Set();
	for (const { doc } of [...nimDocs(), ...sysDocs()]) {
		if (doc.type === 'class') ids.add(doc.system?.identifier || slugify(doc.name, { strict: true }));
	}
	return ids;
}

let dirGroupCache = null;

/** "<class>/<dir>::<group>" for every system class feature (packs/classFeatures/core/<class>/<dir>/…). */
export function systemDirGroups() {
	if (dirGroupCache) return dirGroupCache;
	dirGroupCache = new Set();
	for (const { doc, file } of sysDocs()) {
		const m = /classFeatures\/core\/([^/]+)\/([^/]+)\//.exec(file ?? '');
		if (m && doc.system?.group) dirGroupCache.add(`${m[1]}/${m[2]}::${doc.system.group}`);
	}
	return dirGroupCache;
}

export function checkPaths() {
	const out = [];
	for (const { doc, file, pack } of nimDocs()) {
		const parts = file.split('/').slice(2); // drop pack-sources/<dir>
		const s = doc.system ?? {};
		if (pack.name === 'nim-plus-class-features') {
			// classFeatures/<class>/<group-dir>/[<subclass-slug>/]<slug>.json
			const [cls, groupDir, maybeSub] = parts;
			if (parts.length < 3) out.push(`${file}: expected classFeatures/<class>/<group>/<slug>.json`);
			if (s.class && s.class !== cls) out.push(`${file}: system.class "${s.class}" ≠ directory "${cls}"`);
			const inSubDir = groupDir === `${cls}-subclasses`;
			if (s.subclass && !inSubDir) out.push(`${file}: subclass feature outside ${cls}-subclasses/`);
			if (!s.subclass && inSubDir) out.push(`${file}: non-subclass feature inside ${cls}-subclasses/`);
			if (inSubDir && parts.length !== 4) out.push(`${file}: expected ${cls}-subclasses/<subclass-slug>/<slug>.json`);
			if (inSubDir && s.group && s.group !== maybeSub) out.push(`${file}: group "${s.group}" ≠ subclass dir "${maybeSub}"`);
			// The system itself files some choice groups under a plural directory (sacred-graces/ holds group
			// "sacred-grace"); mirroring the system layout is the convention, so accept any (dir, group) pair
			// the system uses.
			if (!inSubDir && parts.length === 3 && s.group && s.group !== groupDir && !systemDirGroups().has(`${cls}/${groupDir}::${s.group}`)) {
				out.push(`${file}: group "${s.group}" ≠ directory "${groupDir}"`);
			}
		} else if (pack.name === 'nim-plus-subclasses') {
			if (parts.length !== 2) out.push(`${file}: expected subclasses/<class>/<slug>.json`);
			else if (s.parentClass !== parts[0]) out.push(`${file}: parentClass "${s.parentClass}" ≠ directory "${parts[0]}"`);
		} else if (pack.name === 'nim-plus-classes') {
			if (parts.length !== 1) out.push(`${file}: expected classes/<class>.json`);
			else if (s.identifier && `${s.identifier}.json` !== parts[0]) out.push(`${file}: identifier "${s.identifier}" ≠ file name`);
		} else if (pack.name === 'nim-plus-spells' && parts[0] === 'core') {
			if (parts.length !== 3) out.push(`${file}: expected spells/core/<school>/<slug>.json`);
			else if (s.school !== parts[1]) out.push(`${file}: school "${s.school}" ≠ directory "${parts[1]}"`);
		} else if (pack.name === 'nim-plus-feats' || pack.name === 'nim-plus-backgrounds') {
			if (parts.length !== 1) out.push(`${file}: expected a flat directory`);
		}
	}
	return out;
}

/* ───────────────────────────── rules ───────────────────────────── */

export function allRules(docs = nimDocs()) {
	const out = [];
	for (const d of docs) for (const r of rulesOf(d.doc)) out.push({ ...r, file: d.file, docEntry: d });
	return out;
}

export function checkRuleTypes(docs) {
	const S = ruleSchemas();
	return allRules(docs)
		.filter(({ rule }) => !S.has(rule?.type))
		.map(({ file, where, rule }) => `${file} ${where}: unknown rule type "${rule?.type}"`);
}

export function checkRuleFields(docs) {
	const S = ruleSchemas();
	const out = [];
	for (const { rule, where, file } of allRules(docs)) {
		const sch = S.get(rule?.type);
		if (!sch) continue;
		for (const k of Object.keys(rule)) if (!(k in sch)) out.push(`${file} ${where} (${rule.type}): undeclared field "${k}"`);
		for (const [k, e] of Object.entries(sch)) {
			if (!e.nested || !Array.isArray(rule[k])) continue;
			rule[k].forEach((el, i) => {
				if (!el || typeof el !== 'object') {
					out.push(`${file} ${where} (${rule.type}).${k}[${i}]: not an object`);
					return;
				}
				for (const kk of Object.keys(el)) if (!(kk in e.nested)) out.push(`${file} ${where} (${rule.type}).${k}[${i}]: undeclared field "${kk}"`);
			});
		}
	}
	return out;
}

/** Enum values (choices) of every rule field, nested entries included. */
export function checkRuleEnums(docs) {
	const S = ruleSchemas();
	const out = [];
	const test = (file, where, key, entry, value) => {
		const allowed = allowedValues(entry);
		if (!allowed || value === undefined || value === null) return;
		const values = Array.isArray(value) ? value : [value];
		for (const v of values) {
			if (typeof v === 'object' || v === '') continue; // '' = unset (blank StringFields skip the choices check)
			if (!allowed.includes(v)) out.push(`${file} ${where}.${key}: "${v}" not in [${allowed.join('|')}]`);
		}
	};
	for (const { rule, where, file } of allRules(docs)) {
		const sch = S.get(rule?.type);
		if (!sch) continue;
		for (const [k, e] of Object.entries(sch)) {
			if (e.nested) {
				if (Array.isArray(rule[k])) {
					rule[k].forEach((el, i) => {
						for (const [kk, ee] of Object.entries(e.nested)) test(file, `${where}(${rule.type}).${k}[${i}]`, kk, ee, el?.[kk]);
					});
				}
				continue;
			}
			test(file, `${where}(${rule.type})`, k, e, rule[k]);
		}
	}
	return out;
}

/* ── predicates (port of src/etc/Predicate.ts validators) ── */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const BINARY = new Set(['equal', 'max', 'min']);

function isBinary(s) {
	if (!isPlainObject(s)) return false;
	const keys = Object.keys(s);
	if (!keys.length) return false;
	if (keys.includes('equal') && keys.length > 1) return false;
	if (!keys.some((k) => BINARY.has(k))) return false;
	return Object.values(s).every((v) => ['string', 'number'].includes(typeof v));
}
const isArrayOp = (s) => Array.isArray(s) && s.length > 0 && s.every((v) => ['string', 'number'].includes(typeof v));
function isStatement(s) {
	if (isPlainObject(s)) return isBinary(s);
	if (Array.isArray(s)) return isArrayOp(s);
	if (typeof s === 'string') return s.length > 0;
	return false;
}
function isLogicalValue(v) {
	if (!Array.isArray(v)) return false;
	return v.every((item) => {
		if (typeof item === 'string') return item.length > 0;
		if (isPlainObject(item)) {
			const entries = Object.entries(item);
			return entries.length > 0 && isValidEntries(entries);
		}
		return false;
	});
}
function isValidEntries(entries) {
	return entries.every(([k, v]) => (k === '$and' || k === '$or' ? isLogicalValue(v) : isStatement(v)));
}
export function isValidPredicate(p) {
	if (p === undefined || p === null) return true;
	if (!isPlainObject(p)) return false;
	return isValidEntries(Object.entries(p));
}

export function checkPredicates(docs) {
	const out = [];
	for (const { rule, where, file } of allRules(docs)) {
		if (!isValidPredicate(rule.predicate)) out.push(`${file} ${where}: malformed predicate ${JSON.stringify(rule.predicate)}`);
		for (const key of ['recoveries', 'refills', 'addRefills']) {
			(Array.isArray(rule[key]) ? rule[key] : []).forEach((el, i) => {
				if (el && 'predicate' in el && !isValidPredicate(el.predicate)) {
					out.push(`${file} ${where}.${key}[${i}]: malformed predicate ${JSON.stringify(el.predicate)}`);
				}
			});
		}
	}
	return out;
}

/* ── formulas ── */

/** Formula-widget fields per rule type (`widget: 'formula'`), nested ones as `parent[].child`. */
export function formulaFields(type) {
	const sch = ruleSchemas().get(type);
	if (!sch) return [];
	const out = [];
	for (const [k, e] of Object.entries(sch)) {
		if (e.nested) {
			for (const [kk, ee] of Object.entries(e.nested)) if (/widget: 'formula'/.test(ee.text)) out.push(`${k}[].${kk}`);
		} else if (/widget: 'formula'/.test(e.text)) out.push(k);
	}
	return out;
}

/** Roll-data keys the character/actor inject (see NimbleCharacter#getRollData, NimbleBaseActor#getRollData). */
export function knownRollVars() {
	const vars = new Set(['level', 'key']);
	for (const k of configEnum('abilityScores') ?? []) vars.add(k);
	for (const k of configEnum('skills') ?? []) vars.add(k);
	for (const k of configEnum('savingThrows') ?? []) vars.add(`${k}Save`);
	// Every @-variable the system's own pack rules use is, by definition, supported.
	for (const { rule } of allRules(sysDocs())) {
		for (const [, s] of walkStrings(rule)) for (const m of s.matchAll(/@([\w.]+)/g)) vars.add(m[1]);
	}
	return vars;
}

/** Top-level keys of the character data model (for dotted @paths such as @attributes.movement.walk). */
export function actorSystemRoots() {
	return new Set(['abilities', 'attributes', 'savingThrows', 'skills', 'classData', 'details', 'resources', 'proficiencies', 'currency', 'inventory']);
}

/** Validate one formula string; returns a reason string or null. */
export function formulaProblem(formula, known = knownRollVars()) {
	if (typeof formula !== 'string') return `not a string (${typeof formula})`;
	const f = formula.trim();
	if (!f) return null; // empty = unset, fine for optional fields
	let depth = 0;
	for (const c of f) {
		if (c === '(') depth += 1;
		if (c === ')') depth -= 1;
		if (depth < 0) return 'unbalanced parentheses';
	}
	if (depth !== 0) return 'unbalanced parentheses';
	for (const m of f.matchAll(/@([\w.]+)/g)) {
		const v = m[1];
		if (known.has(v)) continue;
		const root = v.split('.')[0];
		if (v.includes('.') && actorSystemRoots().has(root)) continue;
		return `unknown roll variable @${v}`;
	}
	// Structural parse: substitute variables/dice/functions and let JS parse the arithmetic.
	const expr = f
		.replace(/@[\w.]+/g, '1')
		.replace(/\b\d*d\d+(?:(?:kh|kl|k|r|x|min|max)\d*)*/gi, '1')
		.replace(/\b(floor|ceil|round|abs|max|min|trunc|sign)\s*\(/g, 'Math.$1(');
	if (/[^0-9+\-*/%()., \tMath.a-z]/i.test(expr)) return `unexpected characters in "${f}"`;
	if (/[a-z]/i.test(expr.replace(/Math\.(floor|ceil|round|abs|max|min|trunc|sign)/g, ''))) return `unknown identifier in "${f}"`;
	try {
		// eslint-disable-next-line no-new-func
		const val = Function(`"use strict"; return (${expr});`)();
		if (typeof val !== 'number' || Number.isNaN(val)) return `does not evaluate to a number ("${f}")`;
	} catch (e) {
		return `does not parse ("${f}": ${e.message})`;
	}
	return null;
}

/** Every `formula` string inside system.activation.effects (damage/healing trees), recursively. */
export function activationFormulas(doc) {
	const out = [];
	const walk = (node, where) => {
		if (Array.isArray(node)) node.forEach((n, i) => walk(n, `${where}[${i}]`));
		else if (node && typeof node === 'object') {
			for (const [k, v] of Object.entries(node)) {
				if (k === 'formula' && typeof v === 'string') out.push([`${where}.formula`, v]);
				else walk(v, `${where}.${k}`);
			}
		}
	};
	walk(doc.system?.activation?.effects, 'system.activation.effects');
	for (const [i, it] of (doc.items ?? []).entries()) {
		const sub = activationFormulas(it).map(([w, f]) => [`items[${i}](${it.name}).${w}`, f]);
		out.push(...sub);
	}
	return out;
}

/** Roll variables used by the system packs' activation formulas (the system's own vocabulary). */
export function systemActivationVars() {
	const vars = knownRollVars();
	for (const { doc } of sysDocs()) for (const [, f] of activationFormulas(doc)) for (const m of f.matchAll(/@([\w.]+)/g)) vars.add(m[1]);
	return vars;
}

export function checkActivationFormulas(docs = nimDocs()) {
	const known = systemActivationVars();
	const out = [];
	for (const { doc, file } of docs) {
		for (const [where, f] of activationFormulas(doc)) {
			// Parenthesised dice counts, e.g. "(floor(@level / 5))d12", are valid Foundry syntax.
			const p = formulaProblem(f.replace(/\)\s*d\s*(\d+)/gi, ')*1'), known);
			if (p) out.push(`${file} ${where}: ${p}`);
		}
	}
	return out;
}

export function checkFormulas(docs) {
	const out = [];
	const known = knownRollVars();
	for (const { rule, where, file } of allRules(docs)) {
		for (const field of formulaFields(rule?.type)) {
			const [parent, child] = field.split('[].');
			const values = child
				? (Array.isArray(rule[parent]) ? rule[parent] : []).map((el, i) => [`${parent}[${i}].${child}`, el?.[child]])
				: [[field, rule[field]]];
			for (const [k, v] of values) {
				if (v === undefined || v === null) continue;
				const p = formulaProblem(typeof v === 'number' ? String(v) : v, known);
				if (p) out.push(`${file} ${where}(${rule.type}).${k}: ${p}`);
			}
		}
	}
	return out;
}

/* ── pools ── */

/** pool key → [{file, doc, cls, scope}] for chargePool/dicePool rules across system + Nim+. */
export function poolIndex() {
	const idx = { charge: new Map(), dice: new Map() };
	for (const d of [...sysDocs(), ...nimDocs()]) {
		for (const { rule, item } of rulesOf(d.doc)) {
			const kind = rule.type === 'chargePool' ? 'charge' : rule.type === 'dicePool' ? 'dice' : null;
			if (!kind) continue;
			const id = String(rule.identifier || rule.id || '').trim();
			const scope = rule.scope === 'actor' ? 'actor' : 'item';
			const key = `${scope}:${id}`;
			if (!idx[kind].has(key)) idx[kind].set(key, []);
			idx[kind].get(key).push({ file: d.file, doc: d.doc, item, cls: ownerClass(d.doc), pkg: d.pack.pkg });
		}
	}
	return idx;
}

/** The class identifier a doc belongs to (feature.class / subclass.parentClass / class.identifier), or null. */
export function ownerClass(doc) {
	const s = doc?.system ?? {};
	if (doc?.type === 'class') return s.identifier || slugify(doc.name, { strict: true });
	if (doc?.type === 'subclass') return s.parentClass || null;
	return s.class || null;
}

/**
 * Consumers (chargeConsumer/diceConsumer/modifyConsumer: scope+id; modifyPool/poolGainMessage/
 * toggleEffect.clearPoolsOnEnd: id only) must resolve to a pool. A class-bound consumer must find
 * the pool on the same doc or within the same class (class item, features, subclasses).
 */
export function checkPoolRefs(docs) {
	const idx = poolIndex();
	const out = [];
	const findAny = (kinds, id, scope) => {
		const hits = [];
		for (const kind of kinds) {
			for (const [key, list] of idx[kind]) {
				const [s, ...rest] = key.split(':');
				if (rest.join(':') !== id) continue;
				if (scope && s !== scope) continue;
				hits.push(...list.map((h) => ({ ...h, scope: s, kind })));
			}
		}
		return hits;
	};
	for (const { rule, where, file, item, docEntry } of allRules(docs)) {
		let refs = [];
		switch (rule?.type) {
			case 'chargeConsumer':
				refs = [{ kinds: ['charge'], id: rule.poolIdentifier || rule.identifier || rule.id, scope: rule.poolScope === 'actor' ? 'actor' : 'item' }];
				break;
			case 'diceConsumer':
			case 'modifyConsumer':
				refs = [{ kinds: ['dice'], id: rule.poolIdentifier, scope: rule.poolScope === 'actor' ? 'actor' : 'item' }];
				break;
			case 'modifyPool':
				refs = [{ kinds: [rule.poolType === 'charge' ? 'charge' : 'dice'], id: rule.poolIdentifier }];
				break;
			case 'poolGainMessage':
				refs = [{ kinds: ['dice'], id: rule.poolIdentifier }];
				break;
			case 'toggleEffect':
				refs = (rule.clearPoolsOnEnd ?? []).map((id) => ({ kinds: ['dice', 'charge'], id }));
				break;
			default:
		}
		for (const ref of refs) {
			const id = String(ref.id ?? '').trim();
			if (!id) {
				out.push(`${file} ${where}(${rule.type}): empty pool identifier`);
				continue;
			}
			const hits = findAny(ref.kinds, id, ref.scope);
			if (!hits.length) {
				const other = findAny(ref.kinds, id);
				out.push(
					`${file} ${where}(${rule.type}): pool "${id}"${ref.scope ? ` (scope ${ref.scope})` : ''} not defined anywhere` +
						(other.length ? ` — exists with scope ${[...new Set(other.map((o) => o.scope))].join('/')}` : ''),
				);
				continue;
			}
			const cls = ownerClass(docEntry.doc);
			const sameDoc = hits.some((h) => h.doc === docEntry.doc || h.item === item);
			if (!sameDoc && cls && !hits.some((h) => h.cls === cls || h.cls === null)) {
				out.push(`${file} ${where}(${rule.type}): pool "${id}" only defined outside class "${cls}" (${[...new Set(hits.map((h) => h.cls))].join(', ')})`);
			}
		}
	}
	return out;
}

/** Rule ids must be unique per item: RulesManager keys rules by id, so a duplicate silently replaces the first. */
export function checkRuleIds(docs = nimDocs()) {
	const out = [];
	for (const { doc, file } of docs) {
		const lists = [[doc, 'system.rules'], ...(doc.items ?? []).map((it, i) => [it, `items[${i}](${it.name}).system.rules`])];
		for (const [item, where] of lists) {
			const seen = new Set();
			for (const r of Array.isArray(item.system?.rules) ? item.system.rules : []) {
				if (!r?.id) continue;
				if (seen.has(r.id)) out.push(`${file} ${where}: duplicate rule id "${r.id}"`);
				seen.add(r.id);
			}
		}
	}
	return out;
}

export function hiddenPools(docs = nimDocs()) {
	return allRules(docs)
		.filter(({ rule }) => (rule.type === 'chargePool' || rule.type === 'dicePool') && rule.hidden === true)
		.map(({ file, where, rule }) => `${file} ${where}: hidden ${rule.type} "${rule.identifier}"`);
}

/* ───────────────────────────── UUID references ───────────────────────────── */

let sysUuidCache = null;

/** Every system document uuid (all system packs, not only the ones the harness installs). */
export function allSystemUuids() {
	if (sysUuidCache) return sysUuidCache;
	const sj = JSON.parse(fs.readFileSync(path.join(NIMBLE_ROOT, 'public/system.json'), 'utf-8'));
	const ids = JSON.parse(fs.readFileSync(path.join(NIMBLE_ROOT, 'packs/ids.json'), 'utf-8'));
	const out = new Map();
	for (const p of sj.packs) {
		const dir = p.path.replace(/^packs\//, '').replace(/\.db$/, '');
		const root = path.join(NIMBLE_ROOT, 'packs');
		for (const file of walkJson(path.join(root, dir))) {
			const json = JSON.parse(fs.readFileSync(file, 'utf-8'));
			const key = path.relative(root, file).replace(/\.json$/, '').split(path.sep).join('.');
			const mapped = getProperty(ids, key);
			const id = typeof mapped === 'string' ? mapped : json._id;
			if (!id) continue;
			out.set(`Compendium.nimble.${p.name}.${p.type}.${id}`, json);
		}
	}
	sysUuidCache = out;
	return out;
}

export const UUID_RE = /Compendium\.([\w-]+)\.([\w-]+)\.(?:(Item|Actor|RollTable|JournalEntry)\.)?([A-Za-z0-9]{16})/g;

export function resolveUuid(uuid) {
	const m = /^Compendium\.([\w-]+)\.([\w-]+)\.(?:(Item|Actor|RollTable|JournalEntry)\.)?([A-Za-z0-9]{16})$/.exec(uuid);
	if (!m) return null;
	const [, pkg, pack, , id] = m;
	if (pkg === 'nimble') {
		for (const [u, doc] of allSystemUuids()) if (u.startsWith(`Compendium.nimble.${pack}.`) && u.endsWith(`.${id}`)) return doc;
		return null;
	}
	if (pkg === MODULE_ID) {
		const hit = nimDocs().find((d) => d.collection === `${pkg}.${pack}` && d.doc._id === id);
		return hit?.doc ?? null;
	}
	return undefined; // foreign package — not checkable
}

export function checkUuidRefs(docs = nimDocs()) {
	const out = [];
	for (const { doc, file } of docs) {
		for (const [where, s] of walkStrings(doc)) {
			if (where === '_id') continue;
			for (const m of s.matchAll(UUID_RE)) {
				const r = resolveUuid(m[0]);
				if (r === undefined) out.push(`${file} ${where}: foreign-package reference ${m[0]}`);
				else if (r === null) out.push(`${file} ${where}: unresolved ${m[0]}`);
			}
			// Malformed compendium refs (wrong id length etc.)
			for (const m of s.matchAll(/@UUID\[([^\]]+)\]/g)) {
				if (!/^Compendium\.[\w-]+\.[\w-]+\.(?:(?:Item|Actor|RollTable|JournalEntry)\.)?[A-Za-z0-9]{16}$/.test(m[1])) {
					out.push(`${file} ${where}: malformed @UUID[${m[1]}]`);
				}
			}
		}
	}
	return out;
}

export { canonicalUuid };
