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
 * Nothing runs unprompted: on `ready` the GM gets a preview dialog when the
 * module version changed since the last sync, and applies it or postpones it.
 * The same preview/apply is available from a macro:
 *
 *   await nimPlus.syncSubclasses();                 // preview dialog
 *   await nimPlus.syncSubclasses({ apply: true });  // apply without asking
 *   await nimPlus.syncSubclasses({ actors: [actor] });
 *
 * Only world actors are covered — unlinked tokens keep their own copies.
 */
import { MODULE_ID } from './constants.mjs';
import { escape } from './html.mjs';

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

	const subclasses = await subclassPack.getDocuments();
	const subclassesById = new Map(subclasses.map((d) => [d.id, d]));
	const subclassesByIdentifier = new Map(subclasses.map((d) => [d.system.identifier, d]));

	const index = await featurePack.getIndex({ fields: FEATURE_INDEX_FIELDS });
	const featureIndex = index.filter((e) => e.system?.subclass && e.system?.group);

	const loaded = new Map();
	const loadFeatures = async (ids) => {
		const missing = ids.filter((id) => !loaded.has(id));
		if (missing.length) {
			const docs = await featurePack.getDocuments({ _id__in: missing });
			for (const doc of docs) loaded.set(doc.id, doc);
		}
		return ids.map((id) => loaded.get(id)).filter(Boolean);
	};

	return { subclassesById, subclassesByIdentifier, featureIndex, loadFeatures };
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
			if (byIdent && byIdent.system.parentClass === item.system.parentClass) target = byIdent;
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
		const packByIdentifier = new Map(packEntries.map((e) => [e.system.identifier, e._id]));

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
			if (id && !matched.has(id)) matched.set(id, feature);
			else if (src?.pack === FEATURE_PACK || !src) featureRemovals.push(feature);
			// Features sourced from another pack are left alone.
		}

		const wantedIds = packEntries.filter((e) => minLevel(e) <= level).map((e) => e._id);
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
	const packs = await loadPacks();
	if (!packs) return [];
	const list = actors ?? game.actors.filter((a) => a.type === 'character');
	const out = [];
	for (const actor of list) {
		if (actor.type !== 'character') continue;
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

/* ───────────────────────────── UI ───────────────────────────── */

function renderReport(report) {
	const parts = [];
	for (const { actor, plans } of report) {
		for (const plan of plans) {
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
			parts.push(
				`<h4 style="margin:.5em 0 .2em">${escape(actor.name)} — ${escape(plan.target.name)} (level ${plan.level})</h4>` +
					`<ul style="margin:0 0 .4em 1.2em">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`,
			);
		}
	}
	return (
		`<p>The Nim+ packs changed since these characters took their subclass. ` +
		`Applying keeps each character's items and flags and only rewrites the subclass data:</p>` +
		`<div style="max-height:60vh;overflow:auto">${parts.join('')}</div>`
	);
}

/**
 * Preview and (optionally) apply subclass sync.
 * @param {object} [options]
 * @param {Actor[]} [options.actors]   restrict to these actors (default: all world characters)
 * @param {boolean} [options.apply]    apply without a preview dialog
 * @param {boolean} [options.silent]   no "nothing to do" notification
 * @returns {Promise<'applied'|'postponed'|'nothing'>}
 */
export async function syncSubclasses({ actors, apply = false, silent = false } = {}) {
	if (!game.user?.isGM) {
		ui.notifications?.warn('Nim+ | Only a GM can sync subclasses.');
		return 'nothing';
	}
	const report = await planSubclassSync(actors);
	if (!report.length) {
		if (!silent) ui.notifications?.info('Nim+ | All subclasses are up to date.');
		return 'nothing';
	}

	let go = apply;
	if (!go) {
		go = await foundry.applications.api.DialogV2.wait({
			window: { title: 'Nim+ | Subclass update available', icon: 'fa-solid fa-arrows-rotate' },
			position: { width: 560 },
			content: renderReport(report),
			buttons: [
				{ action: 'apply', label: 'Apply', icon: 'fa-solid fa-check', default: true, callback: () => true },
				{ action: 'later', label: 'Later', icon: 'fa-solid fa-clock', callback: () => false },
			],
			rejectClose: false,
		});
	}
	if (!go) return 'postponed';

	const touched = await applySubclassSync(report);
	ui.notifications?.info(`Nim+ | Subclasses synced on ${touched} character${touched === 1 ? '' : 's'}.`);
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

Hooks.once('ready', async () => {
	if (!game.user?.isGM) return;
	const version = game.modules.get(MODULE_ID)?.version ?? '';
	if (game.settings.get(MODULE_ID, SYNC_SETTING) === version) return;
	try {
		const result = await syncSubclasses({ silent: true });
		if (result !== 'postponed') await game.settings.set(MODULE_ID, SYNC_SETTING, version);
	} catch (error) {
		console.error(`${MODULE_ID} | subclass sync failed`, error);
	}
});
