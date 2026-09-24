/**
 * Mock characters built from the REAL pack documents.
 *
 *   const actor = await buildCharacterAtLevel(env, 'commander', 5, {
 *     version: '2.0.3',
 *     subclass: 'Champion of the Bulwark',
 *     picks: ["Face Me!", 'Hold the Line'],   // choice-group features (names or uuids)
 *   });
 *
 *   const actor = await makeCharacter(env, {
 *     classId: 'shepherd', level: 3, version: '0.2',
 *     features: ['Compendium.nimble.nimble-class-features.Item.…', 'Searing Light'],
 *   });
 *
 * Owned items are created the way Foundry's `fromCompendium` does it: the raw
 * pack source minus `_id`/`folder`/`sort`/`ownership`, a fresh `_id`, and
 * `_stats.compendiumSource` set to the canonical source uuid
 * (`Compendium.nimble.…` / `Compendium.nim-plus-package.…`).
 *
 * `version` picks which side a *name* resolves to and which documents the
 * level-up walk sees, mirroring what the index shows in each playtest mode:
 *   '2.0.3'  setting off — system docs, plus Nim+ docs that are not 0.2 copies;
 *   '0.2'    setting on  — Nim+ 0.2 copies first, then system docs that are not
 *            superseded/retired, then other Nim+ docs.
 * A UUID ref always resolves to exactly that document, whatever the version.
 */
import { deepClone, randomID, setProperty, slugify } from './foundry-utils.mjs';
import { MODULE_ID } from './foundry.mjs';
import { loadPackData, supersedeOracle, SYSTEM_PACKAGE } from './packs.mjs';

const ABILITY_LEVELS = { 4: 'primary', 5: 'secondary', 8: 'primary', 9: 'secondary', 12: 'primary', 13: 'secondary', 16: 'primary', 17: 'secondary', 20: 'capstone' };

export function normalizeVersion(version = '2.0.3') {
	const v = String(version).toLowerCase();
	if (['0.2', '02', 'to02', 'playtest'].includes(v)) return '0.2';
	if (['2.0.3', '203', 'to203', 'heroes'].includes(v)) return '2.0.3';
	throw new Error(`harness: unknown version "${version}" (use '2.0.3' or '0.2')`);
}

function isUuid(ref) {
	return typeof ref === 'string' && /^Compendium\./.test(ref);
}

function canonical(uuid) {
	const m = /^Compendium\.([^.]+)\.([^.]+)\.(?:Item\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ''));
	if (!m) return null;
	return `Compendium.${m[1]}.${m[2]}.Item.${m[3]}`;
}

function is02(doc) {
	const f = doc.flags?.[MODULE_ID] ?? {};
	return f.playtest02 === true || (Array.isArray(f.supersedes) && f.supersedes.length > 0);
}

function levelsOf(doc) {
	const s = doc.system ?? {};
	const levels = new Set(Array.isArray(s.gainedAtLevels) ? s.gainedAtLevels : []);
	if (Number.isFinite(s.gainedAtLevel) && s.gainedAtLevel > 0) levels.add(s.gainedAtLevel);
	return [...levels];
}

function minLevel(doc) {
	const l = levelsOf(doc);
	return l.length ? Math.min(...l) : Infinity;
}

function isAutoGroup(group) {
	const g = String(group ?? '');
	return g === '' || g === 'ungrouped' || g.endsWith('-progression');
}

/**
 * Every Item doc as `{uuid, doc, collection, tier}` visible to a version, best tier first.
 * @returns {Promise<{uuid, doc, collection, tier}[]>}
 */
export async function visibleDocs(version) {
	const v = normalizeVersion(version);
	const oracle = await supersedeOracle();
	const hidden = oracle.hiddenWhen(v === '0.2');
	const out = [];
	for (const pack of loadPackData().packs.values()) {
		if (pack.type !== 'Item') continue;
		for (const doc of pack.docs) {
			const uuid = `Compendium.${pack.collection}.Item.${doc._id}`;
			if (hidden.has(uuid)) continue;
			const system = pack.pkg === SYSTEM_PACKAGE;
			const tier = v === '2.0.3' ? (system ? 1 : 2) : !system && is02(doc) ? 1 : system ? 2 : 3;
			out.push({ uuid, doc, collection: pack.collection, tier });
		}
	}
	return out.sort((a, b) => a.tier - b.tier);
}

/**
 * Resolve a document ref (uuid or name) for a version.
 * @param {string} ref
 * @param {object} [opts]
 * @param {string} [opts.version='2.0.3']
 * @param {string} [opts.type]      item type filter ('feature', 'spell', 'subclass', 'class', …)
 * @param {string} [opts.classId]   prefer docs of this class (system.class / parentClass / identifier)
 * @returns {Promise<{uuid: string, doc: object}>}
 */
export async function resolveDoc(ref, { version = '2.0.3', type, classId } = {}) {
	const data = loadPackData();
	if (isUuid(ref)) {
		const uuid = canonical(ref);
		const doc = data.byUuid.get(uuid);
		if (!doc) throw new Error(`harness: no pack document ${ref}`);
		return { uuid, doc };
	}
	const name = String(ref).trim().toLowerCase();
	const all = (await visibleDocs(version)).filter(
		(e) => e.doc.name.trim().toLowerCase() === name && (!type || e.doc.type === type),
	);
	if (!all.length) throw new Error(`harness: no ${type ?? 'document'} named "${ref}" visible in ${version}`);
	const classOf = (d) => d.system?.class ?? d.system?.parentClass ?? (d.type === 'class' ? d.system?.identifier : undefined);
	for (const tier of [1, 2, 3]) {
		let hits = all.filter((e) => e.tier === tier);
		if (!hits.length) continue;
		if (classId && hits.length > 1) {
			const exact = hits.filter((e) => classOf(e.doc) === classId);
			if (exact.length) hits = exact;
		}
		if (hits.length > 1) {
			throw new Error(`harness: "${ref}" is ambiguous in ${version}: ${hits.map((h) => h.uuid).join(', ')} — pass a uuid`);
		}
		return { uuid: hits[0].uuid, doc: hits[0].doc };
	}
	throw new Error(`harness: could not resolve "${ref}"`);
}

/** Owned-item source data for a pack doc, as Foundry's fromCompendium produces it. */
export function ownedSource(uuid, doc, { legacySourceId = false } = {}) {
	const src = structuredClone(doc);
	delete src.folder;
	delete src.sort;
	delete src.ownership;
	src._id = randomID();
	src.flags ??= {};
	src._stats = { ...(src._stats ?? {}) };
	if (legacySourceId) {
		delete src._stats.compendiumSource;
		setProperty(src.flags, 'core.sourceId', uuid);
	} else {
		src._stats.compendiumSource = uuid;
	}
	return src;
}

function predicateOk(predicate, level) {
	if (!predicate || !Object.keys(predicate).length) return true;
	const lv = predicate.level;
	if (lv && typeof lv === 'object') {
		if (Number.isFinite(lv.min) && level < lv.min) return false;
		if (Number.isFinite(lv.max) && level > lv.max) return false;
		return Object.keys(predicate).length === 1;
	}
	return false; // unknown predicate: not granted (documented gap)
}

/**
 * Build the item list for a set of refs, following `grantItem` rules whose
 * target is a pack document (a rule pointing at a world `Item.<id>` is skipped).
 */
async function collectItems(entries, { level, followGrants = true, grantGear = false, legacySourceId }) {
	const items = [];
	const bySource = new Map();
	const add = (uuid, doc, grantedById = null) => {
		if (bySource.has(uuid)) return bySource.get(uuid);
		const src = ownedSource(uuid, doc, { legacySourceId });
		if (grantedById) src.system.grantedById = grantedById;
		items.push(src);
		bySource.set(uuid, src);
		return src;
	};
	const grant = (src, doc, depth) => {
		if (!followGrants || depth > 3) return;
		for (const rule of doc.system?.rules ?? []) {
			if (rule?.type !== 'grantItem' || rule.disabled) continue;
			const target = canonical(rule.uuid);
			if (!target) continue;
			const tdoc = loadPackData().byUuid.get(target);
			if (!tdoc) continue;
			if (!grantGear && tdoc.type !== 'feature' && tdoc.type !== 'spell') continue;
			if (!predicateOk(rule.predicate, level)) continue;
			if (!rule.allowDuplicate && bySource.has(target)) continue;
			const granted = add(target, tdoc, src._id);
			grant(granted, tdoc, depth + 1);
		}
	};
	for (const { uuid, doc } of entries) {
		const already = bySource.has(uuid);
		const src = add(uuid, doc);
		if (!already) grant(src, doc, 0);
	}
	return items;
}

function classState(classDoc, level, override = {}) {
	const hitDie = classDoc.system?.hitDieSize ?? 8;
	const hpData = Array.from({ length: level }, (_, i) => (i === 0 ? hitDie : ((i * 3) % hitDie) + 1));
	const key = classDoc.system?.keyAbilityScores?.[0] ?? 'strength';
	const abilityScoreData = deepClone(classDoc.system?.abilityScoreData ?? {});
	for (const [lv, kind] of Object.entries(ABILITY_LEVELS)) {
		if (Number(lv) > level) continue;
		abilityScoreData[lv] = { ...(abilityScoreData[lv] ?? {}), value: key, type: kind === 'capstone' ? 'boon' : 'statIncrease' };
	}
	return { classLevel: level, hpData, abilityScoreData, ...override };
}

/**
 * Create a character with exactly the listed documents (no progression walk
 * unless `progression: true`; see buildCharacterAtLevel).
 *
 * @param {object} env
 * @param {object} spec
 * @param {string} [spec.name]
 * @param {string} [spec.classId]           class identifier (resolved by identifier, version-aware)
 * @param {string} [spec.classUuid]         or an exact class document
 * @param {number} [spec.level=1]
 * @param {string} [spec.version='2.0.3']
 * @param {string} [spec.subclass]          subclass name/identifier/uuid (items only — no features unless progression)
 * @param {string[]} [spec.features]        refs (uuid or name) of features to own
 * @param {string[]} [spec.spells]          refs of spells to own
 * @param {object[]} [spec.items]           extra raw item sources (owned as-is; give `_stats.compendiumSource` yourself)
 * @param {object} [spec.pools]             { '<item name>': { chargePools: {id: {current,max}}, dicePools: {…} }, '@actor': {…} }
 * @param {object} [spec.flags]             per-item extra flags: { '<item name>': { scope: {…} } }
 * @param {object} [spec.classState]        overrides for the class item's classLevel/hpData/abilityScoreData
 * @param {boolean} [spec.followGrants=true]
 * @param {boolean} [spec.startingGear=false]  follow class grantItem rules to gear (needs system pack 'items' installed for fromUuid)
 * @param {boolean} [spec.legacySourceId=false] store the source in flags.core.sourceId instead of _stats
 * @param {boolean} [spec.world=true]       add to game.actors
 * @param {boolean} [spec.ownedByPlayer=true] the harness player owns it
 * @param {boolean} [spec.progression=false]
 * @param {string[]} [spec.picks]           (progression) choice features to add
 * @returns {Promise<Actor>}
 */
export async function makeCharacter(env, spec = {}) {
	const version = normalizeVersion(spec.version ?? '2.0.3');
	const level = spec.level ?? 1;
	const entries = [];
	let classDoc = null;
	let classId = spec.classId ?? null;
	const push = (hit) => entries.push(hit);

	if (spec.classUuid || classId) {
		const hit = spec.classUuid
			? await resolveDoc(spec.classUuid, { version, type: 'class' })
			: await resolveClass(classId, version);
		classDoc = hit.doc;
		classId = classDoc.system?.identifier || classId;
		push(hit);
	}

	let subclassHit = null;
	if (spec.subclass) {
		subclassHit = await resolveSubclass(spec.subclass, classId, version);
		push(subclassHit);
	}

	if (spec.progression && classDoc) {
		for (const hit of await progressionEntries(classDoc, classId, level, version)) push(hit);
		if (subclassHit) for (const hit of await subclassEntries(subclassHit.doc, classId, level, version)) push(hit);
	}

	for (const ref of [...(spec.picks ?? []), ...(spec.features ?? [])]) {
		push(await resolveDoc(ref, { version, type: isUuid(ref) ? undefined : 'feature', classId }));
	}
	for (const ref of spec.spells ?? []) push(await resolveDoc(ref, { version, type: isUuid(ref) ? undefined : 'spell', classId }));

	const items = await collectItems(entries, {
		level,
		followGrants: spec.followGrants !== false,
		grantGear: !!spec.startingGear,
		legacySourceId: !!spec.legacySourceId,
	});
	for (const raw of spec.items ?? []) items.push({ _id: randomID(), flags: {}, _stats: {}, system: {}, ...deepClone(raw) });

	// Class item state.
	if (classDoc) {
		const cls = items.find((i) => i.type === 'class');
		Object.assign(cls.system, classState(classDoc, level, spec.classState));
	}

	// Per-item flags and pools.
	const byName = (name) => {
		const hits = items.filter((i) => i.name.trim().toLowerCase() === name.trim().toLowerCase());
		if (hits.length !== 1) throw new Error(`harness: pools/flags target "${name}" matched ${hits.length} items`);
		return hits[0];
	};
	const actorFlags = {};
	for (const [name, scopes] of Object.entries(spec.flags ?? {})) {
		const item = byName(name);
		for (const [scope, value] of Object.entries(scopes)) item.flags[scope] = { ...(item.flags[scope] ?? {}), ...deepClone(value) };
	}
	const sys = env.game.system.id;
	for (const [name, kinds] of Object.entries(spec.pools ?? {})) {
		const target = name === '@actor' ? { flags: actorFlags } : byName(name);
		target.flags[sys] ??= {};
		for (const [kind, pools] of Object.entries(kinds)) {
			target.flags[sys][kind] = { ...(target.flags[sys][kind] ?? {}), ...deepClone(pools) };
		}
	}

	const levels = classId ? Array.from({ length: level }, () => classId) : [];
	const ownership = { default: 0 };
	if (spec.ownedByPlayer !== false) ownership[env.users.player.id] = 3;
	const actor = new env.classes.Actor({
		_id: randomID(),
		name: spec.name ?? `${classId ?? 'Test'} ${level} (${version})`,
		type: 'character',
		img: 'icons/svg/mystery-man.svg',
		system: { classData: { startingClass: classId, levels } },
		flags: actorFlags,
		ownership,
		items,
	});
	if (spec.world !== false) env.game.actors.set(actor.id, actor);
	return actor;
}

/**
 * A character as the level-up window would have built it at `level`:
 * the class, every auto-grant class feature (`<class>-progression` group or
 * ungrouped, class-bound or via the class's `groupIdentifiers`) gained at or
 * below `level` (following their `grantItem` rules), the subclass and its
 * features gained at or below `level` (when `subclass` is given), plus `picks`
 * (choice-group features: Orders, Tactics, graces…, names or uuids) and `spells`.
 *
 * @param {object} env
 * @param {string} classId
 * @param {number} level
 * @param {object} [opts]  everything makeCharacter takes; `version` defaults to '2.0.3'
 * @returns {Promise<Actor>}
 */
export async function buildCharacterAtLevel(env, classId, level, opts = {}) {
	return makeCharacter(env, { ...opts, classId, level, progression: true });
}

async function resolveClass(classId, version) {
	const hits = (await visibleDocs(version)).filter((e) => e.doc.type === 'class' && e.doc.system?.identifier === classId);
	if (!hits.length) throw new Error(`harness: no class "${classId}" visible in ${version}`);
	const best = hits.filter((h) => h.tier === hits[0].tier);
	if (best.length > 1) throw new Error(`harness: class "${classId}" ambiguous: ${best.map((b) => b.uuid).join(', ')}`);
	return { uuid: best[0].uuid, doc: best[0].doc };
}

async function resolveSubclass(ref, classId, version) {
	if (isUuid(ref)) return resolveDoc(ref, { version });
	const want = String(ref).trim().toLowerCase();
	const hits = (await visibleDocs(version)).filter(
		(e) =>
			e.doc.type === 'subclass' &&
			(!classId || e.doc.system?.parentClass === classId) &&
			(e.doc.name.trim().toLowerCase() === want ||
				e.doc.system?.identifier === want ||
				slugify(e.doc.name, { strict: true }) === want),
	);
	if (!hits.length) throw new Error(`harness: no subclass "${ref}" of ${classId} visible in ${version}`);
	const best = hits.filter((h) => h.tier === hits[0].tier);
	if (best.length > 1) throw new Error(`harness: subclass "${ref}" ambiguous: ${best.map((b) => b.uuid).join(', ')}`);
	return { uuid: best[0].uuid, doc: best[0].doc };
}

/** Auto-grant class features at or below `level` (deduplicated by uuid). */
export async function progressionEntries(classDoc, classId, level, version) {
	const groups = new Set(classDoc.system?.groupIdentifiers ?? []);
	const out = [];
	const seen = new Set();
	for (const e of await visibleDocs(version)) {
		const s = e.doc.system ?? {};
		if (e.doc.type !== 'feature' || s.subclass) continue;
		const bound = s.class ? s.class === classId : groups.has(s.group);
		if (!bound || !isAutoGroup(s.group)) continue;
		// Option features (levelUpOptions) are granted as the "header" item the first time an
		// option is chosen — i.e. at their lowest level. The option's own picks go in `picks`.
		if (minLevel(e.doc) > level) continue;
		if (seen.has(e.uuid)) continue;
		seen.add(e.uuid);
		out.push({ uuid: e.uuid, doc: e.doc });
	}
	return out.sort((a, b) => minLevel(a.doc) - minLevel(b.doc) || a.doc.name.localeCompare(b.doc.name));
}

/** Subclass features (group = subclass identifier or name slug) at or below `level`. */
export async function subclassEntries(subclassDoc, classId, level, version) {
	const idents = new Set([subclassDoc.system?.identifier, slugify(subclassDoc.name, { strict: true })].filter(Boolean));
	const out = [];
	for (const e of await visibleDocs(version)) {
		const s = e.doc.system ?? {};
		if (e.doc.type !== 'feature' || !s.subclass || s.class !== classId || !idents.has(s.group)) continue;
		if (minLevel(e.doc) > level) continue;
		out.push({ uuid: e.uuid, doc: e.doc });
	}
	return out.sort((a, b) => minLevel(a.doc) - minLevel(b.doc) || a.doc.name.localeCompare(b.doc.name));
}

/* ───────────────────────────── inspection helpers ───────────────────────────── */

/** The canonical compendium source of an owned item (or null). */
export function sourceOf(item) {
	return canonical(item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null);
}

/** A stable, sorted summary of an actor's items: [{name, type, source, group, id}]. */
export function itemSummary(actor) {
	return actor.items
		.map((i) => ({ id: i.id, name: i.name, type: i.type, source: sourceOf(i), group: i.system?.group ?? null }))
		.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}

/** Sorted item names (optionally of one type). */
export function itemNames(actor, type) {
	return actor.items
		.filter((i) => !type || i.type === type)
		.map((i) => i.name)
		.sort();
}

/** Owned items whose name matches (case-insensitive). */
export function itemsNamed(actor, name) {
	const want = name.trim().toLowerCase();
	return actor.items.filter((i) => i.name.trim().toLowerCase() === want);
}

/** A deep snapshot of an actor's items (source data), keyed by item id — compare before/after. */
export function snapshotItems(actor) {
	return Object.fromEntries(actor.items.map((i) => [i.id, i.toObject()]));
}

/** Set a pool value on an owned item (source, no hooks) — for arranging state. */
export function setPool(env, item, kind, key, value) {
	const sys = env.game.system.id;
	item._source.flags ??= {};
	item._source.flags[sys] ??= {};
	item._source.flags[sys][kind] ??= {};
	item._source.flags[sys][kind][key] = deepClone(value);
	item.prepareData();
	return item;
}
