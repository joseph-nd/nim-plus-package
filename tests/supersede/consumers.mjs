/**
 * Local ports of the Nimble system consumers that read the compendium indexes
 * (FoundryVTT-Nimble/src/utils/*). Kept faithful to the system source so the
 * tests see what the character creator / level-up window would see:
 *
 *   buildClassFeatureIndex   utils/getClassFeatures.ts
 *   classFeaturesAt          the grouping half of getClassFeaturesFromIndex (no fromUuid)
 *   buildSubclassFeatureIndex utils/buildSubclassFeatureIndex.ts
 *   getSubclassChoices       utils/getSubclassChoices.ts (reads pack.index, then getDocument)
 *   getChoicesFromCompendium utils/getChoicesFromCompendium.ts
 *   buildSpellIndex          utils/getSpells.ts
 */

export async function buildClassFeatureIndex() {
	const index = new Map();
	const seen = new Map();
	const add = (key, level, entry) => {
		const k = `${key}:${level}`;
		if (!seen.has(k)) seen.set(k, new Set());
		if (seen.get(k).has(entry.uuid)) return;
		seen.get(k).add(entry.uuid);
		if (!index.has(key)) index.set(key, new Map());
		const lm = index.get(key);
		if (!lm.has(level)) lm.set(level, []);
		lm.get(level).push(entry);
	};
	const processFeature = (uuid, name, system) => {
		if (system.subclass) return;
		const key = system.class || system.group;
		if (!key) return;
		const entry = { uuid, name, group: system.group || 'ungrouped', selectionCountByLevel: system.selectionCountByLevel ?? {} };
		if (system.gainedAtLevel) add(key, system.gainedAtLevel, entry);
		for (const level of system.gainedAtLevels ?? []) add(key, level, entry);
	};
	for (const item of game.items) if (item.type === 'feature') processFeature(item.uuid, item.name, item.system);
	const fields = ['system.class', 'system.subclass', 'system.gainedAtLevel', 'system.gainedAtLevels', 'system.group', 'system.selectionCountByLevel'];
	for (const pack of game.packs) {
		if (pack.documentName !== 'Item') continue;
		const packIndex = await pack.getIndex({ fields });
		for (const e of packIndex) {
			if (e.type !== 'feature' || !e.system) continue;
			processFeature(e.uuid, e.name, e.system);
		}
	}
	return index;
}

/** Entries a class sees at one level, grouped like getClassFeaturesFromIndex (by uuid, class first then groups). */
export function classFeaturesAt(index, classIdentifier, level, groupIdentifiers = []) {
	const all = [];
	const seen = new Set();
	for (const key of [classIdentifier, ...groupIdentifiers]) {
		for (const e of index.get(key)?.get(level) ?? []) {
			if (seen.has(e.uuid)) continue;
			seen.add(e.uuid);
			all.push(e);
		}
	}
	const byGroup = new Map();
	for (const e of all) {
		if (!byGroup.has(e.group)) byGroup.set(e.group, []);
		byGroup.get(e.group).push(e);
	}
	return byGroup;
}

const SUBCLASS_FIELDS = ['system.class', 'system.subclass', 'system.gainedAtLevel', 'system.gainedAtLevels', 'system.group'];

export async function buildSubclassFeatureIndex() {
	const index = new Map();
	const add = (cls, sub, level, entry) => {
		if (!index.has(cls)) index.set(cls, new Map());
		const cm = index.get(cls);
		if (!cm.has(sub)) cm.set(sub, new Map());
		const sm = cm.get(sub);
		if (!sm.has(level)) sm.set(level, []);
		const arr = sm.get(level);
		if (!arr.some((e) => e.uuid === entry.uuid)) arr.push(entry);
	};
	const indexFeature = (uuid, name, system) => {
		if (!system?.subclass || !system.class || !system.group) return;
		const entry = { uuid, name };
		if (system.gainedAtLevel) add(system.class, system.group, system.gainedAtLevel, entry);
		for (const level of system.gainedAtLevels ?? []) add(system.class, system.group, level, entry);
	};
	for (const item of game.items) if (item.type === 'feature') indexFeature(item.uuid, item.name, item.system);
	for (const pack of game.packs) {
		if (pack.documentName !== 'Item') continue;
		const packIndex = await pack.getIndex({ fields: SUBCLASS_FIELDS });
		for (const e of packIndex) if (e.type === 'feature') indexFeature(e.uuid, e.name, e.system);
	}
	return index;
}

export async function getSubclassChoices(parentClassIdentifier) {
	const out = [];
	for (const item of game.items) {
		if (item.type !== 'subclass' || item.system.parentClass !== parentClassIdentifier) continue;
		out.push({ uuid: item.uuid, name: item.name, identifier: foundrySlug(item.name), parentClass: item.system.parentClass });
	}
	for (const pack of game.packs) {
		// Snapshot like a for..of over a Map — getDocument below may mutate pack.index.
		for (const entry of pack.index) {
			if (entry.type !== 'subclass') continue;
			const document = await pack.getDocument(entry._id);
			if (!document || document.system.parentClass !== parentClassIdentifier) continue;
			out.push({
				uuid: entry.uuid,
				name: entry.name,
				identifier: foundrySlug(entry.name),
				parentClass: document.system.parentClass,
			});
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function getChoicesFromCompendium(documentType) {
	const ids = [];
	for (const item of game.items) if (item.type === documentType) ids.push(item.uuid);
	for (const pack of game.packs) for (const doc of pack.index) if (doc.type === documentType) ids.push(doc.uuid);
	return ids;
}

export async function buildSpellIndex({ includeSecretSpells = false } = {}) {
	const index = new Map();
	const seen = new Set();
	const add = (entry) => {
		if (seen.has(entry.uuid)) return;
		seen.add(entry.uuid);
		if (!index.has(entry.school)) index.set(entry.school, new Map());
		const tm = index.get(entry.school);
		if (!tm.has(entry.tier)) tm.set(entry.tier, []);
		tm.get(entry.tier).push(entry);
	};
	const fields = ['system.school', 'system.tier', 'system.classes', 'system.activation.cost', 'system.properties.selected'];
	for (const pack of game.packs) {
		if (pack.documentName !== 'Item') continue;
		const packIndex = await pack.getIndex({ fields });
		for (const e of packIndex) {
			if (e.type !== 'spell' || !e.system?.school) continue;
			const sel = e.system.properties?.selected ?? [];
			const isSecret = sel.includes('secretSpell');
			if (isSecret && !includeSecretSpells) continue;
			add({
				uuid: e.uuid,
				name: e.name,
				school: e.system.school,
				tier: e.system.tier ?? 0,
				isUtility: sel.includes('utilitySpell'),
				classes: e.system.classes ?? [],
			});
		}
	}
	return index;
}

/** Class items a character creator would offer: index entries of type class → loaded docs. */
export async function classChoices() {
	const out = [];
	for (const uuid of getChoicesFromCompendium('class')) {
		const doc = await fromUuid(uuid);
		if (doc) out.push({ uuid, name: doc.name, identifier: foundrySlug(doc.name), groupIdentifiers: doc.system.groupIdentifiers ?? [] });
	}
	return out;
}

/**
 * Foundry's real `String#slugify` (common/primitives/string.mjs): CHAR_MAP
 * transliterates first — notably "&" → "and" — which the harness's NFD
 * approximation does not do. Only the ASCII part of CHAR_MAP is reproduced.
 */
const CHAR_MAP = { $: 'dollar', '%': 'percent', '&': 'and', '<': 'less', '>': 'greater', '|': 'or', '\u2018': "'", '\u2019': "'" };
export function foundrySlug(str, { strict = true } = {}) {
	let slug = String(str)
		.split('')
		.reduce((r, c) => r + (CHAR_MAP[c] || c), '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.trim()
		.toLowerCase();
	slug = slug.replace(/[\s-]+/g, '-');
	if (strict) slug = slug.replace(/[^a-zA-Z0-9-]/g, '');
	return slug;
}

/** Names that occur more than once in a list of {name}. */
export function duplicateNames(entries) {
	const counts = new Map();
	for (const e of entries) {
		const k = String(e.name ?? '').trim().toLowerCase();
		counts.set(k, (counts.get(k) ?? 0) + 1);
	}
	return [...counts].filter(([, n]) => n > 1).map(([k]) => k);
}
