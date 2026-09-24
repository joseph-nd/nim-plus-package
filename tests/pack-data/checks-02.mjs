/**
 * 0.2 supersede contract + class/subclass structure checks (pure data).
 */
import fs from 'node:fs';
import path from 'node:path';
import { foundrySlugify as slugify } from './lib.mjs';
import { canonicalUuid, MODULE_ID, nimDocs, readModuleJson, REPO_ROOT, sysDocs } from './lib.mjs';
import { ownerClass } from './checks.mjs';

export function retiredUuids() {
	const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts/core/supersede-retired.mjs'), 'utf-8');
	return [...src.matchAll(/'(Compendium\.[\w.-]+\.[A-Za-z0-9]{16})'/g)].map((m) => m[1]);
}

const flagsOf = (doc) => doc.flags?.[MODULE_ID] ?? {};

export function supersedeDocs() {
	return nimDocs().filter(({ doc }) => Array.isArray(flagsOf(doc).supersedes) && flagsOf(doc).supersedes.length);
}

export function sysByUuid() {
	return new Map(sysDocs().map((d) => [d.uuid, d]));
}

/**
 * Visible documents with the playtest setting on/off (independent of scripts/core/supersede.mjs).
 * A `supersedes` target may be a system doc or a Nim+ original (the 0.2 sheet versions of
 * Nim+'s own Luminary of Protection / of the Forge); either is hidden while the setting is on.
 */
export function visibleDocs(enabled) {
	const superseded = new Set();
	for (const { doc } of supersedeDocs()) for (const u of flagsOf(doc).supersedes) superseded.add(canonicalUuid(u));
	const retired = new Set(retiredUuids().map(canonicalUuid));
	const out = [];
	for (const d of sysDocs()) if (!enabled || (!superseded.has(d.uuid) && !retired.has(d.uuid))) out.push(d);
	for (const d of nimDocs()) {
		const f = flagsOf(d.doc);
		const is02 = (Array.isArray(f.supersedes) && f.supersedes.length > 0) || f.playtest02 === true;
		if (enabled ? !superseded.has(d.uuid) : !is02) out.push(d);
	}
	return out;
}

/** Nim+ originals a Nim+ 0.2 copy supersedes: uuid → the doc. */
export function supersededNimDocs() {
	const nim = new Map(nimDocs().map((d) => [d.uuid, d]));
	const out = new Map();
	for (const { doc } of supersedeDocs()) {
		for (const u of flagsOf(doc).supersedes) {
			const c = canonicalUuid(u);
			if (nim.has(c)) out.set(c, nim.get(c));
		}
	}
	return out;
}

export function checkSupersedeTargets() {
	const sys = sysByUuid();
	const nim = new Map(nimDocs().map((d) => [d.uuid, d]));
	const retired = new Set(retiredUuids().map(canonicalUuid));
	const out = [];
	const count = new Map();
	for (const { doc, file } of supersedeDocs()) {
		for (const raw of flagsOf(doc).supersedes) {
			const u = canonicalUuid(raw);
			if (!u) {
				out.push(`${file}: malformed supersedes entry "${raw}"`);
				continue;
			}
			if (u.startsWith(`Compendium.${MODULE_ID}.`)) {
				// A Nim+ original: must exist and must not itself be a 0.2 doc (no chains).
				const t = nim.get(u)?.doc;
				if (!t) out.push(`${file}: supersedes missing Nim+ doc ${u}`);
				else if (flagsOf(t).playtest02 === true || flagsOf(t).supersedes?.length) out.push(`${file}: supersedes a 0.2 Nim+ doc ${u}`);
			} else if (!u.startsWith('Compendium.nimble.')) out.push(`${file}: supersedes a non-system doc ${u}`);
			else if (!sys.has(u)) out.push(`${file}: supersedes missing system doc ${u}`);
			if (retired.has(u)) out.push(`${file}: supersedes retired doc ${u}`);
			if (!count.has(u)) count.set(u, []);
			count.get(u).push(file);
		}
	}
	for (const [u, files] of count) if (files.length > 1) out.push(`${u} superseded by ${files.length} docs: ${files.join(', ')}`);
	return out;
}

export function checkRetired() {
	const sys = sysByUuid();
	return retiredUuids()
		.filter((u) => !sys.has(canonicalUuid(u)))
		.map((u) => `retired uuid ${u} is not a system doc`);
}

export function checkPlaytestFlag() {
	return supersedeDocs()
		.filter(({ doc }) => flagsOf(doc).playtest02 !== true)
		.map(({ file }) => `${file}: supersedes without playtest02: true`);
}

/** Differences between a superseding doc and its targets (informational). */
export function supersedeShapeChanges() {
	const sys = sysByUuid();
	const out = [];
	for (const { doc, file } of supersedeDocs()) {
		for (const raw of flagsOf(doc).supersedes) {
			const t = sys.get(canonicalUuid(raw))?.doc;
			if (!t) continue;
			const s = doc.system ?? {};
			const ts = t.system ?? {};
			const diffs = [];
			if (doc.type !== t.type) diffs.push(`type ${t.type}→${doc.type}`);
			if ((s.class ?? null) !== (ts.class ?? null)) diffs.push(`class ${ts.class}→${s.class}`);
			if ((s.group ?? null) !== (ts.group ?? null)) diffs.push(`group ${ts.group}→${s.group}`);
			if (!!s.subclass !== !!ts.subclass) diffs.push(`subclass ${!!ts.subclass}→${!!s.subclass}`);
			if ((s.parentClass ?? null) !== (ts.parentClass ?? null)) diffs.push(`parentClass ${ts.parentClass}→${s.parentClass}`);
			if (doc.name !== t.name) diffs.push(`name "${t.name}"→"${doc.name}"`);
			if (diffs.length) out.push({ file, target: t.name, type: diffs.some((d) => d.startsWith('type ')), diffs });
		}
	}
	return out;
}

export function checkLevels() {
	const out = [];
	for (const { doc, file } of nimDocs()) {
		if (doc.type !== 'feature') continue;
		const s = doc.system ?? {};
		const levels = Array.isArray(s.gainedAtLevels) ? s.gainedAtLevels : [];
		for (const l of levels) if (!Number.isInteger(l) || l < 1 || l > 20) out.push(`${file}: gainedAtLevels has ${JSON.stringify(l)}`);
		if (s.gainedAtLevel !== undefined && s.gainedAtLevel !== null) {
			const l = s.gainedAtLevel;
			if (!Number.isInteger(l) || l < 1 || l > 20) out.push(`${file}: gainedAtLevel ${JSON.stringify(l)}`);
			else if (levels.length && !levels.includes(l)) out.push(`${file}: gainedAtLevel ${l} not in gainedAtLevels [${levels}]`);
		}
		if (new Set(levels).size !== levels.length) out.push(`${file}: duplicate gainedAtLevels [${levels}]`);
		if (levels.some((l, i) => i && l < levels[i - 1])) out.push(`${file}: gainedAtLevels not ascending [${levels}]`);
		const sel = s.selectionCountByLevel;
		if (sel && typeof sel === 'object') {
			for (const [k, v] of Object.entries(sel)) {
				if (!levels.includes(Number(k)) && Number(k) !== s.gainedAtLevel) out.push(`${file}: selectionCountByLevel key ${k} not in gainedAtLevels [${levels}]`);
				if (!Number.isInteger(v) || v < 1) out.push(`${file}: selectionCountByLevel[${k}] = ${JSON.stringify(v)}`);
			}
		}
	}
	return out;
}

/* ───────────────────────────── classes / subclasses ───────────────────────────── */

export function classDocs(docs) {
	return docs.filter((d) => d.doc.type === 'class');
}

export function classId(doc) {
	return doc.system?.identifier || slugify(doc.name, { strict: true });
}

/** Every groupIdentifier of every class visible in that mode has at least one visible non-subclass feature. */
export function checkGroupIdentifiers(enabled) {
	const docs = visibleDocs(enabled);
	const groups = new Set();
	for (const { doc } of docs) {
		if (doc.type !== 'feature' || doc.system?.subclass) continue;
		groups.add(`${doc.system?.class}::${doc.system?.group}`);
	}
	const out = [];
	for (const { doc, file } of classDocs(docs)) {
		const cls = classId(doc);
		for (const g of doc.system?.groupIdentifiers ?? []) {
			if (!groups.has(`${cls}::${g}`)) out.push(`${file ?? doc.name}: groupIdentifier "${g}" has no ${enabled ? '0.2' : '2.0.3'} feature (class ${cls})`);
		}
	}
	return out;
}

/** Nim+ class features whose group is neither in the class's groupIdentifiers nor a subclass group. */
export function checkFeatureGroupsListed(enabled) {
	const docs = visibleDocs(enabled);
	const classGroups = new Map();
	for (const { doc } of classDocs(docs)) classGroups.set(classId(doc), new Set(doc.system?.groupIdentifiers ?? []));
	const out = [];
	for (const { doc, file, pack } of docs) {
		if (pack.pkg !== MODULE_ID || pack.name !== 'nim-plus-class-features' || doc.type !== 'feature') continue;
		const s = doc.system ?? {};
		if (s.subclass || !s.group || !s.class) continue;
		const g = classGroups.get(s.class);
		if (!g) out.push(`${file}: class "${s.class}" has no class item`);
		else if (!g.has(s.group)) out.push(`${file}: group "${s.group}" not in ${s.class} groupIdentifiers [${[...g]}]`);
	}
	return out;
}

export function checkSubclasses(enabled) {
	const docs = visibleDocs(enabled);
	const classes = new Set(classDocs(docs).map((d) => classId(d.doc)));
	const featureGroups = new Map(); // class::group → count
	for (const { doc } of docs) {
		if (doc.type !== 'feature' || !doc.system?.subclass) continue;
		const key = `${doc.system.class}::${doc.system.group}`;
		featureGroups.set(key, (featureGroups.get(key) ?? 0) + 1);
	}
	const out = [];
	const subKeys = new Set();
	for (const { doc, file, pack } of docs) {
		if (doc.type !== 'subclass') continue;
		const s = doc.system ?? {};
		const slug = slugify(doc.name, { strict: true });
		subKeys.add(`${s.parentClass}::${slug}`);
		if (pack.pkg !== MODULE_ID) continue;
		if (!classes.has(s.parentClass)) out.push(`${file}: parentClass "${s.parentClass}" is not a class`);
		if (!featureGroups.has(`${s.parentClass}::${slug}`)) out.push(`${file}: no subclass features with class "${s.parentClass}" and group "${slug}"`);
		// (stored system.identifier is irrelevant: NimbleBaseItem#prepareBaseData overwrites it with the name slug)
	}
	for (const { doc, file, pack } of docs) {
		if (pack.pkg !== MODULE_ID || doc.type !== 'feature' || !doc.system?.subclass) continue;
		const key = `${doc.system.class}::${doc.system.group}`;
		if (!subKeys.has(key)) out.push(`${file}: subclass feature group "${doc.system.group}" matches no ${doc.system.class} subclass name slug`);
	}
	return out;
}

/** Two visible docs with the same (type, class, group, subclass, level, name) — the level-up UI would show both. */
export function duplicateVisible(enabled) {
	const seen = new Map();
	for (const { doc, file, uuid } of visibleDocs(enabled)) {
		const s = doc.system ?? {};
		let keys = [];
		if (doc.type === 'feature' && s.class) {
			const levels = s.gainedAtLevels?.length ? s.gainedAtLevels : [s.gainedAtLevel];
			keys = levels.map((l) => `feature|${s.class}|${s.group}|${!!s.subclass}|${l}|${doc.name.toLowerCase()}`);
		} else if (doc.type === 'subclass') keys = [`subclass|${s.parentClass}|${doc.name.toLowerCase()}`];
		else if (doc.type === 'class') keys = [`class|${classId(doc)}`];
		else if (doc.type === 'spell') keys = [`spell|${s.school}|${doc.name.toLowerCase()}`];
		for (const k of keys) {
			if (!seen.has(k)) seen.set(k, []);
			seen.get(k).push(file ?? uuid);
		}
	}
	return [...seen].filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(', ')}`);
}

export function checkModuleJson() {
	const mj = readModuleJson();
	const out = [];
	const names = new Set();
	for (const p of mj.packs ?? []) {
		if (names.has(p.name)) out.push(`duplicate pack name ${p.name}`);
		names.add(p.name);
		const dir = p.flags?.sourceDir;
		if (!dir) out.push(`pack ${p.name}: no flags.sourceDir`);
		else if (!fs.existsSync(path.join(REPO_ROOT, 'pack-sources', dir))) out.push(`pack ${p.name}: sourceDir "${dir}" missing`);
		if (p.path !== `packs/${p.name}`) out.push(`pack ${p.name}: path "${p.path}" ≠ packs/${p.name}`);
		if (p.system && p.system !== 'nimble') out.push(`pack ${p.name}: system "${p.system}"`);
		if (!['Item', 'Actor', 'JournalEntry', 'RollTable'].includes(p.type)) out.push(`pack ${p.name}: type "${p.type}"`);
	}
	const inFolders = [];
	for (const f of mj.packFolders ?? []) {
		for (const n of f.packs ?? []) {
			if (!names.has(n)) out.push(`packFolder "${f.name}" lists unknown pack ${n}`);
			inFolders.push(n);
		}
	}
	for (const n of names) if (!inFolders.includes(n)) out.push(`pack ${n} not in any packFolder`);
	// every pack-sources subdir is used by a pack
	for (const e of fs.readdirSync(path.join(REPO_ROOT, 'pack-sources'), { withFileTypes: true })) {
		if (e.isDirectory() && !(mj.packs ?? []).some((p) => p.flags?.sourceDir === e.name)) out.push(`pack-sources/${e.name} is not any pack's sourceDir`);
	}
	return out;
}

export { ownerClass };

/**
 * Within one choice group (class + group, features that carry selectionCountByLevel), every option must
 * agree on the per-level count (the system warns and takes the max) and on the levels it is offered at.
 */
export function checkChoiceGroupConsistency(enabled) {
	const groups = new Map();
	for (const { doc, file } of visibleDocs(enabled)) {
		const s = doc.system ?? {};
		if (doc.type !== 'feature' || s.subclass || !s.selectionCountByLevel || !Object.keys(s.selectionCountByLevel).length) continue;
		const k = `${s.class}::${s.group}`;
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push({ file: file ?? doc.name, sel: s.selectionCountByLevel, levels: JSON.stringify(s.gainedAtLevels ?? [s.gainedAtLevel]) });
	}
	const out = [];
	for (const [k, list] of groups) {
		const counts = {};
		for (const { sel } of list) for (const [l, v] of Object.entries(sel)) (counts[l] ??= new Set()).add(v);
		for (const [l, set] of Object.entries(counts)) if (set.size > 1) out.push(`${k}: level ${l} counts disagree [${[...set]}]`);
		const common = new Map();
		for (const { levels } of list) common.set(levels, (common.get(levels) ?? 0) + 1);
		if (common.size > 1) {
			const majority = [...common].sort((a, b) => b[1] - a[1])[0][0];
			for (const { file, levels } of list) if (levels !== majority) out.push(`${file}: gainedAtLevels ${levels} ≠ the group's ${majority} (${k})`);
		}
	}
	return out;
}
