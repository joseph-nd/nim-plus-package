/**
 * Nim+ Package — subclass sync (migration of owned subclass data)
 *
 * The compendia are rebuilt on every release, but a character that already
 * took a subclass owns *copies* of the subclass item and its features. When a
 * subclass is renamed (Pact of the Ego → Pact of the Id), reworded, or rebuilt
 * with different features (Way of Shadows), those copies silently fall out of
 * date. This module brings them back in line with the shipped packs.
 *
 * Matching is by compendium source, not by name: every item the system grants
 * from a pack carries `_stats.compendiumSource` (`flags.core.sourceId` on very
 * old worlds), and the module keeps a subclass's `_id` stable across renames.
 * So an actor's "Pact of the Ego" still points at the pack entry now called
 * "Pact of the Id", and its features point at the features that survived the
 * rewrite. From there, for each pack-sourced subclass an actor owns:
 *
 *   - the subclass item is updated in place if its pack entry changed;
 *   - owned subclass features whose pack entry changed are updated in place
 *     (their `_id` and flags — charge-pool state and so on — are kept);
 *   - owned subclass features whose pack entry no longer exists are removed;
 *   - pack features of the (renamed) subclass gained at or below the actor's
 *     class level that the actor lacks are added.
 *
 * No confirmation popup: on `ready` the active GM applies it once per module
 * version, and the macro applies it straight away. Either way a toast sums it
 * up and a GM-whispered chat card lists every change per character (the audit
 * trail; see `./migration-report.mjs`). Nothing in the sync needs a choice.
 * Ids and flags (pool state) are kept, so the sheet's +/- still corrects them.
 *
 *   await nimPlus.syncSubclasses();                  // apply, toast + chat card
 *   await nimPlus.syncSubclasses({ apply: false });  // dry run: chat card only
 *   await nimPlus.syncSubclasses({ actors: [actor] });
 *
 * Only world actors are covered — unlinked tokens keep their own copies.
 *
 * ── Nimble 0.2 playtest core classes ─────────────────────────────────────
 * The subclass sync runs *after* the core class migration
 * (`./class-migration/index.mjs`), which both starts it on `ready` and runs it
 * for the characters it just migrated. It stays out of the migration's way:
 *
 *   - a character that still owns documents from the side the playtest setting
 *     turned away from (a migration not run yet) is skipped whole, so
 *     0.2 subclass features are never added next to the 2.0.3 copies they
 *     supersede;
 *   - Nim+ documents the supersede layer currently hides (0.2 docs while the
 *     setting is off; Nim+ originals a 0.2 copy supersedes — Luminary of
 *     Protection / of the Forge — while it is on) are never added, updated to,
 *     or synced to — and an owned copy of one is left alone rather than treated
 *     as deleted from the pack. Moving a character between an original and its
 *     0.2 copy is the class migration's job, never the sync's;
 *   - a 0.2 copy shares its original's name, so it shares its identifier and
 *     feature group: the identifier fallback for source-less items never lands
 *     on a subclass that supersedes something (that would convert a subclass
 *     the migration cannot see), and source-less features resolve to the entry
 *     the setting shows before a hidden one of the same identifier.
 */
import { MODULE_ID } from './constants.mjs';
import { escape } from './html.mjs';
import { plural, whisperReport } from './migration-report.mjs';
import {
	hasPendingClassMigration,
	canonicalUuid,
	isHiddenUuid,
	readUnfilteredIndex,
	supersedeData,
	supersedeDataSync,
} from './supersede.mjs';

const SUBCLASS_PACK = `${MODULE_ID}.nim-plus-subclasses`;
const FEATURE_PACK = `${MODULE_ID}.nim-plus-class-features`;
const SYNC_SETTING = 'subclassSyncVersion';

/**
 * Fallback for subclass items that lost their compendium source: old
 * identifier → current identifier. Only renames whose old name is unambiguous
 * belong here (the module's old "keeper-of-the-pack" is now the official
 * subclass of that name, so it is deliberately absent).
 */
const LEGACY_IDENTIFIERS = {
	'path-of-the-titans': 'path-of-the-titan',
	'pact-of-the-ego': 'pact-of-the-id',
	'pact-of-the-high-celestial': 'pact-of-the-celestial',
};

const FEATURE_INDEX_FIELDS = [
	'system.identifier',
	'system.class',
	'system.group',
	'system.subclass',
	'system.gainedAtLevels',
];

/* ───────────────────────────── helpers ───────────────────────────── */

/** `Compendium.<pkg>.<pack>.Item.<id>` (or the pre-v11 form without `Item`) → { pack, id }. */
function parseSource(item) {
	const uuid = item?._stats?.compendiumSource ?? item?.flags?.core?.sourceId ?? '';
	const m = /^Compendium\.([^.]+\.[^.]+)\.(?:Item\.)?([A-Za-z0-9]{16})$/.exec(uuid);
	return m ? { pack: m[1], id: m[2] } : null;
}

function stableStringify(value) {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	if (value && typeof value === 'object') {
		const keys = Object.keys(value).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value);
}

/** The part of an item that the packs own; flags, ids and ownership are the actor's. */
function fingerprint(doc) {
	const src = doc.toObject();
	return stableStringify({ name: src.name, img: src.img, system: src.system });
}

function syncPayload(target) {
	const src = target.toObject();
	return { name: src.name, img: src.img, system: src.system };
}

function creationData(target) {
	const src = target.toObject();
	delete src._id;
	delete src.folder;
	delete src.sort;
	delete src.ownership;
	src._stats ??= {};
	src._stats.compendiumSource = target.uuid;
	return src;
}

function classLevel(actor, classIdentifier) {
	const levels = actor.levels ?? {};
	return levels.classes?.[classIdentifier] ?? levels.character ?? 0;
}

function minLevel(feature) {
	const levels = feature.system?.gainedAtLevels ?? [];
	return levels.length ? Math.min(...levels) : Number.POSITIVE_INFINITY;
}

/* ───────────────────────────── pack access ───────────────────────────── */

async function loadPacks() {
	const subclassPack = game.packs.get(SUBCLASS_PACK);
	const featurePack = game.packs.get(FEATURE_PACK);
	if (!subclassPack || !featurePack) return null;

	const subclasses = (await subclassPack.getDocuments()).filter((d) => !isHiddenUuid(d.uuid));
	const subclassesById = new Map(subclasses.map((d) => [d.id, d]));
	const subclassesByIdentifier = new Map(subclasses.map((d) => [d.system.identifier, d]));

	// Unfiltered: an owned copy of a hidden entry must not look like a deletion.
	const index = await readUnfilteredIndex(featurePack, FEATURE_INDEX_FIELDS);
	const featureIndex = index.filter((e) => e.system?.subclass && e.system?.group);
	const hiddenIds = new Set(featureIndex.filter((e) => isHiddenUuid(e.uuid)).map((e) => e._id));

	const loaded = new Map();
	const loadFeatures = async (ids) => {
		const missing = ids.filter((id) => !loaded.has(id));
		if (missing.length) {
			const docs = await featurePack.getDocuments({ _id__in: missing });
			for (const doc of docs) loaded.set(doc.id, doc);
		}
		return ids.map((id) => loaded.get(id)).filter(Boolean);
	};

	return { subclassesById, subclassesByIdentifier, featureIndex, hiddenIds, loadFeatures };
}

/* ───────────────────────────── planning ───────────────────────────── */

/**
 * @typedef {object} SubclassPlan
 * @property {Item} item            the owned subclass item
 * @property {Item} target          its current pack entry
 * @property {object|null} update   `{_id, ...payload}` if the subclass item itself changed
 * @property {object[]} featureUpdates
 * @property {Item[]} featureRemovals
 * @property {Item[]} featureAdditions  pack docs to copy onto the actor
 * @property {number} level
 */

async function planActor(actor, packs) {
	const plans = [];

	for (const item of actor.items) {
		if (item.type !== 'subclass') continue;

		const source = parseSource(item);
		let target = null;
		if (source?.pack === SUBCLASS_PACK) target = packs.subclassesById.get(source.id) ?? null;
		if (!target && !source) {
			const ident = LEGACY_IDENTIFIERS[item.system.identifier] ?? item.system.identifier;
			const byIdent = packs.subclassesByIdentifier.get(ident);
			const replaces = byIdent && supersedeDataSync()?.supersedes.has(canonicalUuid(byIdent.uuid));
			if (byIdent && !replaces && byIdent.system.parentClass === item.system.parentClass) target = byIdent;
		}
		if (!target) continue; // not one of ours (base system, homebrew, or a deleted subclass)

		const oldIdent = item.system.identifier;
		const newIdent = target.system.identifier;
		const cls = target.system.parentClass;
		const level = classLevel(actor, cls);

		const packEntries = packs.featureIndex.filter(
			(e) => e.system.group === newIdent && e.system.class === cls,
		);
		const packIds = new Set(packEntries.map((e) => e._id));
		// Visible entries win over hidden ones sharing an identifier (a 0.2 copy and its original).
		const packByIdentifier = new Map();
		for (const e of [...packEntries].sort((a, b) => packs.hiddenIds.has(b._id) - packs.hiddenIds.has(a._id))) {
			packByIdentifier.set(e.system.identifier, e._id);
		}

		const owned = actor.items.filter(
			(i) =>
				i.type === 'feature' &&
				i.system?.subclass &&
				i.system?.class === cls &&
				(i.system?.group === oldIdent || i.system?.group === newIdent),
		);

		// Resolve each owned feature to a pack id (by source, then by identifier).
		const matched = new Map(); // pack id → owned item
		const featureRemovals = [];
		for (const feature of owned) {
			const src = parseSource(feature);
			let id = src?.pack === FEATURE_PACK && packIds.has(src.id) ? src.id : null;
			if (!id && !src) id = packByIdentifier.get(feature.system.identifier) ?? null;
			if (id && packs.hiddenIds.has(id)) continue; // the class migration's to handle
			if (id && !matched.has(id)) matched.set(id, feature);
			else if (src?.pack === FEATURE_PACK || !src) featureRemovals.push(feature);
			// Features sourced from another pack are left alone.
		}

		const wantedIds = packEntries
			.filter((e) => minLevel(e) <= level && !packs.hiddenIds.has(e._id))
			.map((e) => e._id);
		const docs = await packs.loadFeatures([...new Set([...matched.keys(), ...wantedIds])]);
		const docById = new Map(docs.map((d) => [d.id, d]));

		const featureUpdates = [];
		for (const [id, feature] of matched) {
			const doc = docById.get(id);
			if (!doc) continue;
			if (fingerprint(feature) !== fingerprint(doc)) {
				featureUpdates.push({ _id: feature.id, ...syncPayload(doc), _name: feature.name, _to: doc.name });
			}
		}

		const featureAdditions = wantedIds
			.filter((id) => !matched.has(id))
			.map((id) => docById.get(id))
			.filter(Boolean);

		const update =
			fingerprint(item) !== fingerprint(target) ? { _id: item.id, ...syncPayload(target) } : null;

		if (!update && !featureUpdates.length && !featureRemovals.length && !featureAdditions.length) {
			continue;
		}

		plans.push({ item, target, update, featureUpdates, featureRemovals, featureAdditions, level });
	}

	return plans;
}

/** @returns {Promise<{actor: Actor, plans: SubclassPlan[]}[]>} */
export async function planSubclassSync(actors) {
	await supersedeData();
	const packs = await loadPacks();
	if (!packs) return [];
	const list = actors ?? game.actors.filter((a) => a.type === 'character');
	const out = [];
	for (const actor of list) {
		if (actor.type !== 'character') continue;
		if (hasPendingClassMigration(actor)) {
			console.log(`${MODULE_ID} | subclass sync: skipping ${actor.name} until its class migration is applied`);
			continue;
		}
		const plans = await planActor(actor, packs);
		if (plans.length) out.push({ actor, plans });
	}
	return out;
}

/* ───────────────────────────── applying ───────────────────────────── */

export async function applySubclassSync(report) {
	let touched = 0;
	for (const { actor, plans } of report) {
		const updates = [];
		const removals = [];
		const creations = [];
		for (const plan of plans) {
			if (plan.update) updates.push(plan.update);
			for (const u of plan.featureUpdates) {
				const { _name, _to, ...data } = u;
				updates.push(data);
			}
			removals.push(...plan.featureRemovals.map((f) => f.id));
			creations.push(...plan.featureAdditions.map(creationData));
		}
		if (removals.length) await actor.deleteEmbeddedDocuments('Item', removals);
		if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
		if (creations.length) await actor.createEmbeddedDocuments('Item', creations);
		touched += 1;
		console.log(
			`${MODULE_ID} | ${actor.name}: subclass sync — ${updates.length} updated, ${removals.length} removed, ${creations.length} added`,
		);
	}
	return touched;
}

/* ───────────────────────────── reporting ───────────────────────────── */

/** The report lines of one subclass plan (HTML). */
function planLines(plan) {
	const lines = [];
	if (plan.update) {
		const renamed = plan.item.name !== plan.target.name;
		lines.push(
			renamed
				? `Subclass renamed: ${escape(plan.item.name)} → <strong>${escape(plan.target.name)}</strong>`
				: 'Subclass text updated',
		);
	}
	for (const u of plan.featureUpdates) {
		lines.push(
			u._name !== u._to
				? `Feature renamed: ${escape(u._name)} → <strong>${escape(u._to)}</strong>`
				: `Feature updated: ${escape(u._name)}`,
		);
	}
	for (const f of plan.featureRemovals) lines.push(`Feature removed: <s>${escape(f.name)}</s>`);
	for (const f of plan.featureAdditions) lines.push(`Feature added: <strong>${escape(f.name)}</strong>`);
	return lines;
}

/** One section per (character, subclass): `{heading, lines}`. */
export function reportSections(report) {
	return report.flatMap(({ actor, plans }) =>
		plans.map((plan) => ({
			heading: `${escape(actor.name)} — ${escape(plan.target.name)} (level ${plan.level})`,
			lines: planLines(plan),
		})),
	);
}

function countChanges(report) {
	let updated = 0;
	let removed = 0;
	let added = 0;
	for (const { plans } of report) {
		for (const plan of plans) {
			updated += (plan.update ? 1 : 0) + plan.featureUpdates.length;
			removed += plan.featureRemovals.length;
			added += plan.featureAdditions.length;
		}
	}
	return { updated, removed, added };
}

/**
 * Plan and apply the subclass sync — no confirmation popup.
 * @param {object} [options]
 * @param {Actor[]} [options.actors]   restrict to these actors (default: all world characters)
 * @param {boolean} [options.apply=true]  false: dry run — post the report card, write nothing
 * @param {boolean} [options.silent]   no "nothing to do" notification
 * @returns {Promise<'applied'|'previewed'|'nothing'>}
 */
export async function syncSubclasses({ actors, apply = true, silent = false } = {}) {
	if (!game.user?.isGM) {
		ui.notifications?.warn('Nim+ | Only a GM can sync subclasses.');
		return 'nothing';
	}
	const report = await planSubclassSync(actors);
	if (!report.length) {
		if (!silent) ui.notifications?.info('Nim+ | All subclasses are up to date.');
		return 'nothing';
	}

	const sections = reportSections(report);
	if (apply === false) {
		await whisperReport({
			title: 'Nim+ | Subclass sync (dry run)',
			intro: 'Dry run — nothing was written. The Nim+ packs changed since these characters took their subclass; syncing would make these changes:',
			sections,
		});
		ui.notifications?.info(`Nim+ | Subclass sync dry run: ${plural(report.length, 'character')} would change — see the chat card.`);
		return 'previewed';
	}

	const { updated, removed, added } = countChanges(report);
	const touched = await applySubclassSync(report);
	await whisperReport({
		title: 'Nim+ | Subclass sync',
		intro:
			"The Nim+ packs changed since these characters took their subclass. Each character's items and flags were kept; " +
			'only the subclass data was rewritten:',
		sections,
	});
	ui.notifications?.info(
		`Nim+ synced subclasses on ${plural(touched, 'character')} (${plural(updated, 'item')} updated, ${added} added, ${removed} removed).`,
	);
	return 'applied';
}

/* ───────────────────────────── startup ───────────────────────────── */

Hooks.once('init', () => {
	game.settings.register(MODULE_ID, SYNC_SETTING, {
		scope: 'world',
		config: false,
		type: String,
		default: '',
	});
});

/**
 * The version-gated startup pass (applied without a dialog). Not a `ready` hook
 * of its own: the class migration's `ready` handler queues it after the
 * migration's pass, so the two never run out of order (see the header).
 */
export async function runSubclassSyncStartup() {
	if (!game.user?.isGM) return;
	const active = game.users?.activeGM;
	if (active && active.id !== game.user.id) return;
	const version = game.modules.get(MODULE_ID)?.version ?? '';
	if (game.settings.get(MODULE_ID, SYNC_SETTING) === version) return;
	try {
		await syncSubclasses({ silent: true });
		await game.settings.set(MODULE_ID, SYNC_SETTING, version);
	} catch (error) {
		console.error(`${MODULE_ID} | subclass sync failed`, error);
	}
}

/**
 * Forget that this version's startup sync ran, so the next `ready` runs it
 * again. Nothing in the module calls it any more (the sync can no longer be
 * postponed); kept for macros. GM only (world setting).
 */
export async function resetSubclassSyncStamp() {
	if (!game.user?.isGM) return;
	try {
		if (game.settings.get(MODULE_ID, SYNC_SETTING) !== '') await game.settings.set(MODULE_ID, SYNC_SETTING, '');
	} catch (error) {
		console.error(`${MODULE_ID} | could not reset the subclass sync version`, error);
	}
}
