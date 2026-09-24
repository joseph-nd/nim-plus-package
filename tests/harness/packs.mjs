/**
 * Real pack data for tests.
 *
 *   const data = loadPackData();       // parsed once per test file, deep-frozen
 *   await installPacks(env);           // mock CompendiumCollections into game.packs
 *
 * System documents come from ../FoundryVTT-Nimble/packs/<dir>/** (pack
 * `nimble.<name>`, uuid `Compendium.nimble.<name>.Item.<_id>`); Nim+ documents
 * from pack-sources/<sourceDir>/** per module.json (pack
 * `nim-plus-package.<name>`). Ids follow the build: the pack's `ids.json`
 * (keyed by the file's path) wins, then the file's own `_id`; a file with
 * neither (freshly authored, not yet built) gets a deterministic hash id and a
 * warning in `data.warnings`.
 *
 * Also exported: an independent oracle of the supersede relationships
 * (`supersedeOracle`) computed straight from the JSON — tests can compare the
 * runtime's `supersedeData()` against it — and lookup helpers.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, MODULE_ID } from './foundry.mjs';
import { getProperty } from './foundry-utils.mjs';

export const NIMBLE_ROOT = path.resolve(REPO_ROOT, '../FoundryVTT-Nimble');
export const SYSTEM_PACKAGE = 'nimble';

/** System pack dir → pack name. */
export const SYSTEM_PACKS = {
	classes: 'nimble-classes',
	classFeatures: 'nimble-class-features',
	subclasses: 'nimble-subclasses',
	spells: 'nimble-spells',
	items: 'nimble-items',
};

/** Default set installed by installPacks (items is large and only needed for starting gear). */
export const DEFAULT_SYSTEM_PACKS = ['classes', 'classFeatures', 'subclasses', 'spells'];

function walk(dir) {
	const out = [];
	if (!fs.existsSync(dir)) return out;
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else if (entry.name.endsWith('.json')) out.push(full);
	}
	return out.sort();
}

function deepFreeze(obj) {
	if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
		Object.freeze(obj);
		for (const v of Object.values(obj)) deepFreeze(v);
	}
	return obj;
}

function hashId(key) {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const bytes = crypto.createHash('sha256').update(key).digest();
	let id = '';
	for (let i = 0; i < 16; i += 1) id += chars[bytes[i] % chars.length];
	return id;
}

function documentType(doc) {
	if (doc?.system && Array.isArray(doc.items)) return 'Actor';
	if (doc?.system && !('text' in doc)) return 'Item';
	return null;
}

/**
 * Load one pack directory.
 * @returns {{collection, pkg, name, type, dir, docs: object[], files: Map<id,string>}}
 */
function loadDir({ root, dir, pkg, name, ids, warnings }) {
	const base = path.join(root, dir);
	const docs = [];
	const files = new Map();
	let type = null;
	for (const file of walk(base)) {
		let json;
		try {
			json = JSON.parse(fs.readFileSync(file, 'utf-8'));
		} catch (error) {
			warnings.push(`${path.relative(REPO_ROOT, file)}: unparsable JSON (${error.message})`);
			continue;
		}
		const docType = documentType(json);
		if (!docType) continue;
		type ??= docType;
		const key = path.relative(root, file).replace(/\.json$/, '').split(path.sep);
		const mapped = getProperty(ids, key.join('.'));
		let id = typeof mapped === 'string' ? mapped : json._id;
		if (!id) {
			id = hashId(`${pkg}/${key.join('/')}`);
			warnings.push(`${path.relative(REPO_ROOT, file)}: no _id and no ids.json entry — using hash id ${id}`);
		} else if (json._id && typeof mapped === 'string' && json._id !== mapped) {
			warnings.push(`${path.relative(REPO_ROOT, file)}: _id ${json._id} ≠ ids.json ${mapped} (build would use ids.json)`);
		}
		json._id = id;
		json._stats ??= {};
		// Harness-only provenance (non-enumerable, so it never reaches toObject()).
		Object.defineProperty(json, '__file', { value: path.relative(REPO_ROOT, file), enumerable: false });
		if (files.has(id)) warnings.push(`${path.relative(REPO_ROOT, file)}: duplicate id ${id} (also ${files.get(id)})`);
		files.set(id, path.relative(REPO_ROOT, file));
		docs.push(json);
	}
	return { collection: `${pkg}.${name}`, pkg, name, type: type ?? 'Item', dir, docs, files };
}

let cache = null;

/**
 * Parse every relevant pack once (per test file) and deep-freeze it.
 * @returns {PackData}
 *
 * @typedef {object} PackData
 * @property {Map<string, object>} packs   collection id → {collection, pkg, name, type, docs, files}
 * @property {Map<string, object>} byUuid  canonical uuid → raw doc
 * @property {string[]} warnings
 */
export function loadPackData() {
	if (cache) return cache;
	const warnings = [];
	const packs = new Map();

	const sysIds = JSON.parse(fs.readFileSync(path.join(NIMBLE_ROOT, 'packs/ids.json'), 'utf-8'));
	for (const [dir, name] of Object.entries(SYSTEM_PACKS)) {
		const pack = loadDir({ root: path.join(NIMBLE_ROOT, 'packs'), dir, pkg: SYSTEM_PACKAGE, name, ids: sysIds, warnings });
		packs.set(pack.collection, pack);
	}

	const moduleJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'module.json'), 'utf-8'));
	const modIds = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'pack-sources/ids.json'), 'utf-8'));
	for (const meta of moduleJson.packs ?? []) {
		const dir = meta.flags?.sourceDir;
		if (!dir) continue;
		const pack = loadDir({ root: path.join(REPO_ROOT, 'pack-sources'), dir, pkg: MODULE_ID, name: meta.name, ids: modIds, warnings });
		pack.type = meta.type ?? pack.type;
		pack.label = meta.label;
		packs.set(pack.collection, pack);
	}

	const byUuid = new Map();
	for (const pack of packs.values()) {
		for (const doc of pack.docs) byUuid.set(`Compendium.${pack.collection}.${pack.type}.${doc._id}`, doc);
	}
	for (const pack of packs.values()) deepFreeze(pack.docs);
	cache = { packs, byUuid, warnings };
	return cache;
}

/**
 * Create mock CompendiumCollections in `env.game.packs`.
 *
 * @param {object} env                       from installFoundry()
 * @param {object} [opts]
 * @param {string[]} [opts.system]           system pack dirs (keys of SYSTEM_PACKS); default DEFAULT_SYSTEM_PACKS
 * @param {boolean|string[]} [opts.module=true]  Nim+ packs: true = all, or pack names ['nim-plus-class-features', …]
 * @param {(doc, pack) => object|null} [opts.transform]  tweak/drop raw docs for this test (receives a clone)
 * @param {object[]} [opts.extra]            extra packs: [{collection:'pkg.name', type:'Item', docs:[…]}]
 * @returns {Promise<object>} env.game.packs
 */
export async function installPacks(env, { system = DEFAULT_SYSTEM_PACKS, module = true, transform, extra = [] } = {}) {
	const data = loadPackData();
	const wantedSystem = new Set(system.map((dir) => `${SYSTEM_PACKAGE}.${SYSTEM_PACKS[dir] ?? dir}`));
	for (const pack of data.packs.values()) {
		if (pack.pkg === SYSTEM_PACKAGE && !wantedSystem.has(pack.collection)) continue;
		if (pack.pkg === MODULE_ID && module !== true && !(Array.isArray(module) && module.includes(pack.name))) continue;
		let docs = pack.docs;
		if (transform) {
			docs = docs
				.map((d) => transform(structuredClone(d), pack))
				.filter(Boolean);
		}
		addPack(env, { collection: liveCollection(env, pack.collection), type: pack.type, label: pack.label ?? pack.name, docs });
	}
	for (const p of extra) addPack(env, p);
	return env.game.packs;
}

/** The live collection id (system packs follow game.system.id, e.g. `nimble-dev.nimble-classes`). */
function liveCollection(env, collection) {
	const [pkg, name] = collection.split('.');
	return pkg === SYSTEM_PACKAGE ? `${env.game.system.id}.${name}` : collection;
}

/** Add one mock pack (raw docs are used as the database, never mutated). */
export function addPack(env, { collection, type = 'Item', label, docs = [] }) {
	const [packageName, name] = collection.split('.');
	const pack = new env.CompendiumCollection({
		id: collection,
		packageName,
		packageType: packageName === env.game.system.id ? 'system' : 'module',
		name,
		label: label ?? name,
		type,
		documents: docs,
	});
	env.game.packs.set(collection, pack);
	return pack;
}

/* ───────────────────────────── lookups (no Foundry needed) ───────────────────────────── */

/** Canonical uuid of a raw doc in a pack collection (`nimble.<name>` spelling). */
export function uuidOf(collection, doc, type = 'Item') {
	return `Compendium.${collection}.${type}.${doc._id}`;
}

/** Raw doc by canonical uuid (or null). */
export function rawDoc(uuid) {
	return loadPackData().byUuid.get(uuid) ?? null;
}

/**
 * Find raw docs.
 * @param {object} q
 * @param {string} [q.pack]        collection, e.g. 'nimble.nimble-class-features'
 * @param {string} [q.name]        case-insensitive exact name
 * @param {string} [q.type]
 * @param {string} [q.class]       system.class
 * @param {string} [q.group]       system.group
 * @param {boolean} [q.subclass]   system.subclass truthy/falsy
 * @param {(doc)=>boolean} [q.where]
 * @returns {{uuid: string, doc: object, collection: string}[]}
 */
export function findDocs(q = {}) {
	const out = [];
	for (const pack of loadPackData().packs.values()) {
		if (q.pack && pack.collection !== q.pack) continue;
		for (const doc of pack.docs) {
			if (q.name && doc.name.trim().toLowerCase() !== q.name.trim().toLowerCase()) continue;
			if (q.type && doc.type !== q.type) continue;
			if (q.class !== undefined && doc.system?.class !== q.class) continue;
			if (q.group !== undefined && doc.system?.group !== q.group) continue;
			if (q.subclass !== undefined && !!doc.system?.subclass !== q.subclass) continue;
			if (q.where && !q.where(doc)) continue;
			out.push({ uuid: uuidOf(pack.collection, doc, pack.type), doc, collection: pack.collection });
		}
	}
	return out;
}

/** Exactly one doc (throws with the candidates otherwise). */
export function findDoc(q) {
	const hits = findDocs(q);
	if (hits.length !== 1) {
		throw new Error(
			`findDoc(${JSON.stringify(q)}): ${hits.length} matches${hits.length ? `: ${hits.map((h) => h.uuid).join(', ')}` : ''}`,
		);
	}
	return hits[0];
}

/* ───────────────────────────── supersede oracle ───────────────────────────── */

function canonical(uuid) {
	const m = /^Compendium\.([^.]+)\.([^.]+)\.(?:Item\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ''));
	return m ? `Compendium.${m[1]}.${m[2]}.Item.${m[3]}` : null;
}

let oracleCache = null;

/**
 * The supersede relationships computed straight from the JSON (independent of
 * scripts/core/supersede.mjs):
 *   supersededBy  system uuid → Nim+ uuid (first wins, like the runtime)
 *   supersedes    Nim+ uuid → system uuids
 *   playtestOnly  Nim+ uuids flagged playtest02 that replace nothing
 *   retired       system uuids from scripts/core/supersede-retired.mjs
 *   hiddenWhen(enabled) → Set of uuids a pack index should NOT show
 */
export async function supersedeOracle() {
	if (oracleCache) return oracleCache;
	const { RETIRED_CORE_UUIDS } = await import(path.join(REPO_ROOT, 'scripts/core/supersede-retired.mjs'));
	const supersededBy = new Map();
	const supersedes = new Map();
	const playtestOnly = new Set();
	for (const pack of loadPackData().packs.values()) {
		if (pack.pkg !== MODULE_ID || pack.type !== 'Item') continue;
		for (const doc of pack.docs) {
			const flags = doc.flags?.[MODULE_ID];
			if (!flags) continue;
			const uuid = uuidOf(pack.collection, doc);
			const replaced = (Array.isArray(flags.supersedes) ? flags.supersedes : []).map(canonical).filter(Boolean);
			if (replaced.length) {
				supersedes.set(uuid, replaced);
				for (const t of replaced) if (!supersededBy.has(t)) supersededBy.set(t, uuid);
			} else if (flags.playtest02 === true) playtestOnly.add(uuid);
		}
	}
	const retired = new Set(RETIRED_CORE_UUIDS.map(canonical).filter(Boolean));
	oracleCache = {
		supersededBy,
		supersedes,
		playtestOnly,
		retired,
		hiddenWhen(enabled) {
			return enabled
				? new Set([...supersededBy.keys(), ...retired])
				: new Set([...supersedes.keys(), ...playtestOnly]);
		},
	};
	return oracleCache;
}
