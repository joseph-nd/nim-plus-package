/**
 * Nim+ Package — supersede layer (Nimble 0.2 playtest core classes)
 *
 * Nim+ ships 0.2 playtest copies of system documents. Each copy names the
 * document(s) it replaces in `flags.nim-plus-package.supersedes` (full
 * `Compendium.nimble.<pack>.Item.<id>` UUIDs); documents that only exist in 0.2
 * carry `flags.nim-plus-package.playtest02 = true`; documents 0.2 removes with no
 * replacement are listed in `./supersede-retired.mjs`.
 *
 * A copy may also supersede one of Nim+'s *own* documents
 * (`Compendium.nim-plus-package.<pack>.Item.<id>`) — the 0.2 sheet versions of
 * Nim+ subclasses that predate it (Luminary of Protection, Luminary of the
 * Forge). Those behave exactly like system targets, only the hidden entry lives
 * in a Nim+ pack. Any other package in `supersedes` is ignored with a warning:
 * third-party packs are never touched.
 *
 * Every system consumer that offers documents to a player reads the pack
 * *index* — `buildClassFeatureIndex`/`getClassFeatures` and
 * `buildSubclassFeatureIndex` (level-up), `getSubclassChoices` and
 * `getChoicesFromCompendium` (character creator), `getSpells` (spell pickers),
 * `compendiumSpellsFilter`, and Foundry's own compendium window, whose tree is
 * built from `pack.index` (`CompendiumCollection#_getVisibleTreeContents`). So
 * this layer does its whole job by deleting entries from `pack.index`:
 *
 *   setting on  — superseded + retired ids are removed from the `nimble.*` packs
 *                 (and superseded Nim+ originals from the Nim+ packs);
 *   setting off — Nim+ ids flagged `supersedes`/`playtest02` are removed from the
 *                 Nim+ packs.
 *
 * `fromUuid` does not go through the index, so an existing character's items
 * still resolve their (hidden) compendium source.
 *
 * ── Why it has to be re-applied, and where ──────────────────────────────────
 * Foundry v14, `client/documents/collections/compendium-collection.mjs`:
 *
 *   - the constructor (l. 62-66) fills `this.index` from the world data's
 *     `metadata.index` — every entry, before any hook we could run;
 *   - `getIndex({fields})` (l. 336-366) returns `this.index` untouched when the
 *     fields are already indexed (l. 341), but otherwise asks the server for the
 *     *whole* pack again and `index.set()`s every entry back (l. 344-360). A
 *     later call with a new field would therefore resurrect every id we removed;
 *   - `set()` (l. 301-308) calls `indexDocument()` (l. 658-668), which re-adds a
 *     document to the index whenever it is loaded — `getDocument`, `getDocuments`
 *     and `fromUuid` all end there.
 *
 * Hence two prototype wrappers, installed on `init` (before `setupGame` creates
 * the packs — `client/game.mjs` l. 729 — and before the system's `setup`-time
 * `preparePackIndexes` fires its `getIndex` calls, l. 740):
 *
 *   - `getIndex` runs the original, awaits the hidden set, then deletes;
 *   - `indexDocument` runs the original, then deletes the entry if hidden.
 *
 * Plus a one-off purge of every pack once the set is built (`setup`), which
 * catches the constructor-seeded entries of packs nobody has re-indexed yet, and
 * again on `ready`. After each purge the pack's directory tree is rebuilt
 * (`DirectoryCollectionMixin#initializeTree`), since the compendium window
 * renders `pack.tree`, not the index.
 *
 * The hidden set itself is built from the Nim+ packs' indexes (the flag fields
 * above), read through the *original* `getIndex`, so building it can never wait
 * on itself. It is available synchronously once built (`supersedeDataSync()`),
 * and asynchronously from the start (`supersedeData()`); every `getIndex` call
 * on a relevant pack awaits it, so no consumer ever sees an unfiltered index
 * after its own `getIndex` resolves. Consumers that read `pack.index` without
 * calling `getIndex` (`getChoicesFromCompendium`, `getSubclassChoices`) run from
 * the character creator, which opens after `ready`, by which point the set is
 * long built and applied.
 *
 * Not covered: `game.documentIndex` (the @-mention / sidebar search trie) is
 * built from the index on its own schedule (`client/game.mjs` l. 773) and may
 * still list a hidden entry by name. It offers no class content to a player.
 */
import { MODULE_ID } from './constants.mjs';
import { sysId } from './system.mjs';
import { playtestCoreClassesEnabled } from './playtest-settings.mjs';
import { RETIRED_CORE_UUIDS } from './supersede-retired.mjs';

const SYSTEM_PACKAGE = 'nimble';
const FLAG_FIELDS = [`flags.${MODULE_ID}.supersedes`, `flags.${MODULE_ID}.playtest02`];
const PATCH_SENTINEL = '__nimPlusSupersedePatched';

let originalGetIndex = null;
let originalIndexDocument = null;

/** @type {SupersedeData|null} */
let data = null;
/** @type {Promise<SupersedeData>|null} */
let building = null;

/**
 * @typedef {object} SupersedeData
 * @property {boolean} enabled                     the playtest setting, as read when built
 * @property {Map<string,string>} supersededBy     system (or Nim+ original) UUID → the Nim+ UUID replacing it
 * @property {Map<string,string[]>} supersedes     Nim+ UUID → the system (or Nim+ original) UUIDs it replaces
 * @property {Set<string>} playtestOnly            Nim+ UUIDs flagged `playtest02` that replace nothing
 * @property {Set<string>} retired                 system UUIDs removed by 0.2
 * @property {Map<string,Set<string>>} hidden      pack collection → ids taken out of its index
 *
 * Every UUID in here is canonical (see `canonicalUuid`).
 */

/* ───────────────────────────── UUIDs ───────────────────────────── */

/**
 * `Compendium.<pkg>.<pack>[.Item].<id>` → its parts, with the system package
 * spelled `nimble` whatever the running system id is, so UUIDs authored in the
 * content, stored on actors, and read from the live packs all compare equal.
 */
export function parseCompendiumUuid(uuid) {
	const m = /^Compendium\.([^.]+)\.([^.]+)\.(?:Item\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ''));
	if (!m) return null;
	const pkg = m[1] === sysId() ? SYSTEM_PACKAGE : m[1];
	return { pkg, pack: m[2], id: m[3], uuid: `Compendium.${pkg}.${m[2]}.Item.${m[3]}` };
}

export function canonicalUuid(uuid) {
	return parseCompendiumUuid(uuid)?.uuid ?? null;
}

/** The live pack collection a canonical package/pack pair lives in. */
export function packCollection(pkg, pack) {
	return `${pkg === SYSTEM_PACKAGE ? sysId() : pkg}.${pack}`;
}

/** A canonical UUID rewritten for the running system id (`nimble-dev` builds). */
export function liveUuid(uuid) {
	const parts = parseCompendiumUuid(uuid);
	if (!parts) return uuid;
	return `Compendium.${packCollection(parts.pkg, parts.pack)}.Item.${parts.id}`;
}

/** An owned item's compendium source, canonical, or null. */
export function itemSourceUuid(item) {
	const src = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? null;
	return canonicalUuid(src);
}

/* ───────────────────────────── the set ───────────────────────────── */

function isModulePack(pack) {
	return pack?.documentName === 'Item' && String(pack.collection ?? '').startsWith(`${MODULE_ID}.`);
}

function isSystemPack(pack) {
	return pack?.documentName === 'Item' && String(pack.collection ?? '').startsWith(`${sysId()}.`);
}

/** Packages a `supersedes` target may live in: the system's, or Nim+'s own. */
function isSupersedableUuid(parts) {
	return parts?.pkg === SYSTEM_PACKAGE || parts?.pkg === MODULE_ID;
}

function addHidden(hidden, uuid) {
	const parts = parseCompendiumUuid(uuid);
	if (!parts) return;
	const collection = packCollection(parts.pkg, parts.pack);
	if (!hidden.has(collection)) hidden.set(collection, new Set());
	hidden.get(collection).add(parts.id);
}

async function build() {
	const enabled = playtestCoreClassesEnabled();
	const supersededBy = new Map();
	const supersedes = new Map();
	const playtestOnly = new Set();
	const retired = new Set(RETIRED_CORE_UUIDS.map(canonicalUuid).filter(Boolean));

	for (const pack of game.packs ?? []) {
		if (!isModulePack(pack)) continue;
		let index;
		try {
			index = await originalGetIndex.call(pack, { fields: FLAG_FIELDS });
		} catch (error) {
			console.error(`${MODULE_ID} | supersede: could not index ${pack.collection}`, error);
			continue;
		}
		for (const entry of index) {
			const flags = entry?.flags?.[MODULE_ID];
			if (!flags) continue;
			const uuid = canonicalUuid(pack.getUuid(entry._id));
			if (!uuid) continue;
			const replaced = [];
			for (const raw of Array.isArray(flags.supersedes) ? flags.supersedes : []) {
				const parts = parseCompendiumUuid(raw);
				if (!parts) continue;
				if (!isSupersedableUuid(parts)) {
					console.warn(`${MODULE_ID} | supersede: ${uuid} names ${raw}, which is neither a system nor a Nim+ document; ignored`);
					continue;
				}
				if (parts.uuid === uuid) continue;
				replaced.push(parts.uuid);
			}
			if (replaced.length) {
				supersedes.set(uuid, replaced);
				for (const target of replaced) {
					if (supersededBy.has(target) && supersededBy.get(target) !== uuid) {
						console.warn(
							`${MODULE_ID} | supersede: ${target} is superseded twice (${supersededBy.get(target)}, ${uuid}); keeping the first`,
						);
						continue;
					}
					supersededBy.set(target, uuid);
				}
			} else if (flags.playtest02 === true) {
				playtestOnly.add(uuid);
			}
		}
	}

	const hidden = new Map();
	if (enabled) {
		for (const uuid of supersededBy.keys()) addHidden(hidden, uuid);
		for (const uuid of retired) addHidden(hidden, uuid);
	} else {
		for (const uuid of supersedes.keys()) addHidden(hidden, uuid);
		for (const uuid of playtestOnly) addHidden(hidden, uuid);
	}

	let count = 0;
	for (const ids of hidden.values()) count += ids.size;
	console.log(
		`${MODULE_ID} | supersede: 0.2 playtest core classes ${enabled ? 'on' : 'off'} — ` +
			`${supersededBy.size} superseded, ${retired.size} retired, ${playtestOnly.size} new; ${count} index entries hidden`,
	);

	return { enabled, supersededBy, supersedes, playtestOnly, retired, hidden };
}

/** The supersede data, building it on first call. Never rejects. */
export function supersedeData() {
	if (data) return Promise.resolve(data);
	if (!building) {
		building = build()
			.catch((error) => {
				console.error(`${MODULE_ID} | supersede: failed to build the hidden set — nothing is hidden`, error);
				return {
					enabled: playtestCoreClassesEnabled(),
					supersededBy: new Map(),
					supersedes: new Map(),
					playtestOnly: new Set(),
					retired: new Set(),
					hidden: new Map(),
				};
			})
			.then((built) => {
				data = built;
				return built;
			});
	}
	return building;
}

/** The supersede data if it has been built, else null. */
export function supersedeDataSync() {
	return data;
}

/** True when this compendium UUID is currently taken out of its pack's index. */
export function isHiddenUuid(uuid) {
	const parts = parseCompendiumUuid(uuid);
	if (!parts || !data) return false;
	return data.hidden.get(packCollection(parts.pkg, parts.pack))?.has(parts.id) ?? false;
}

/**
 * True when the actor still owns items from the side the setting turned away
 * from — superseded or retired system documents while it is on, Nim+ 0.2
 * documents while it is off — i.e. a class migration is still pending for it.
 * False until the set is built.
 */
export function hasPendingClassMigration(actor) {
	if (!data) return false;
	for (const item of actor?.items ?? []) {
		const src = itemSourceUuid(item);
		if (!src) continue;
		if (data.enabled) {
			if (data.supersededBy.has(src) || data.retired.has(src)) return true;
		} else if (data.supersedes.has(src) || data.playtestOnly.has(src)) {
			return true;
		}
	}
	return false;
}

/* ───────────────────────────── purging ───────────────────────────── */

function purge(pack) {
	const ids = data?.hidden.get(pack?.collection);
	if (!ids?.size) return false;
	let removed = false;
	for (const id of ids) {
		// `index.delete`, never `pack.delete` — the latter also evicts a loaded
		// document from the collection, which an open sheet may be showing.
		if (pack.index.delete(id)) removed = true;
	}
	if (!removed) return false;
	try {
		pack.initializeTree?.();
		for (const app of pack.apps ?? []) if (app?.rendered) app.render?.();
	} catch (error) {
		console.error(`${MODULE_ID} | supersede: could not refresh ${pack.collection}`, error);
	}
	return true;
}

function purgeAll() {
	if (!data) return;
	for (const collection of data.hidden.keys()) {
		const pack = game.packs?.get(collection);
		if (pack) purge(pack);
	}
}

/**
 * A pack's full index as the server has it — hidden entries included — without
 * touching `pack.index`. For the class migration, which must see both sides.
 * This is the same request `getIndex` makes (compendium-collection.mjs l. 344).
 */
export async function readUnfilteredIndex(pack, fields = []) {
	const cls = pack.documentClass;
	const indexFields = new Set([...(pack.indexFields ?? []), ...fields]);
	const entries = await cls.database.get(
		cls,
		{ query: {}, index: true, indexFields: Array.from(indexFields), pack: pack.collection },
		game.user,
	);
	for (const entry of entries) entry.uuid = pack.getUuid(entry._id);
	return entries;
}

/* ───────────────────────────── wrappers ───────────────────────────── */

function relevant(pack) {
	return isSystemPack(pack) || isModulePack(pack);
}

function install() {
	const Compendium =
		foundry?.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
	const proto = Compendium?.prototype;
	if (!proto || proto[PATCH_SENTINEL]) return;
	if (typeof proto.getIndex !== 'function' || typeof proto.indexDocument !== 'function') {
		console.warn(`${MODULE_ID} | supersede: CompendiumCollection changed shape — layer not installed`);
		return;
	}

	originalGetIndex = proto.getIndex;
	originalIndexDocument = proto.indexDocument;

	proto.getIndex = async function nimPlusSupersedeGetIndex(...args) {
		const index = await originalGetIndex.apply(this, args);
		if (!relevant(this)) return index;
		try {
			await supersedeData();
			purge(this);
		} catch (error) {
			console.error(`${MODULE_ID} | supersede: could not filter ${this?.collection}`, error);
		}
		return index;
	};

	proto.indexDocument = function nimPlusSupersedeIndexDocument(document, ...rest) {
		const result = originalIndexDocument.call(this, document, ...rest);
		try {
			const ids = data?.hidden.get(this.collection);
			if (ids?.has(document?.id)) this.index.delete(document.id);
		} catch (error) {
			console.error(`${MODULE_ID} | supersede: could not filter ${this?.collection}`, error);
		}
		return result;
	};

	proto[PATCH_SENTINEL] = true;
}

Hooks.once('init', () => {
	try {
		install();
	} catch (error) {
		console.error(`${MODULE_ID} | supersede: failed to install`, error);
	}
});

Hooks.once('setup', () => {
	if (!originalGetIndex) return;
	supersedeData().then(purgeAll);
});

Hooks.once('ready', () => {
	if (!originalGetIndex) return;
	supersedeData().then(purgeAll);
});
