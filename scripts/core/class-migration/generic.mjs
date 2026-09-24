/**
 * Class migration — the reusable steps and helpers.
 *
 * Everything the orchestrator (`./index.mjs`) does for every class, exported so
 * the per-class modules (`./classes/<class>.mjs`, `./subclasses/<class>.mjs`)
 * can do the same things for the cases the generic pass leaves to them. Nothing
 * here registers a hook, and nothing here asks for confirmation: callers only
 * reach these after the GM/owner confirmed the preview that listed the change.
 *
 * Owned state is sacred. A replacement rewrites what the pack owns (name, img,
 * `system`) and keeps what the actor owns:
 *   - the item `_id` (so grants, sheet state and macros keep pointing at it);
 *   - every flag, including the system's `chargePools`/`dicePools` state, which
 *     is keyed by pool identifier — a pool whose identifier survives keeps its
 *     current value, and the sheet's +/- corrects anything else;
 *   - the actor-state fields inside `system` listed in `ACTOR_STATE_FIELDS`.
 */
import { MODULE_ID } from '../constants.mjs';
import {
	canonicalUuid,
	itemSourceUuid,
	liveUuid,
	parseCompendiumUuid,
	readUnfilteredIndex,
} from '../supersede.mjs';
import { escape } from '../html.mjs';

export { canonicalUuid, itemSourceUuid, liveUuid, parseCompendiumUuid, readUnfilteredIndex, escape };

/**
 * `system` fields an owned copy fills in for its actor, per item type — never
 * overwritten by a replacement. `grantedById` links a granted item to the item
 * whose `grantItem` rule created it; the class item carries the character's
 * level, rolled hit points and chosen stat increases.
 */
export const ACTOR_STATE_FIELDS = {
	'*': ['grantedById'],
	class: ['classLevel', 'hpData', 'abilityScoreData'],
};

export const FEATURE_INDEX_FIELDS = [
	'system.class',
	'system.group',
	'system.subclass',
	'system.gainedAtLevels',
	'system.gainedAtLevel',
	`flags.${MODULE_ID}.supersedes`,
	`flags.${MODULE_ID}.playtest02`,
];

/* ───────────────────────────── reading ───────────────────────────── */

/** An auto-granted group: a `<class>-progression` group, or no group at all. */
export function isAutoGrantGroup(group) {
	const g = String(group ?? '');
	return g.length === 0 || g.endsWith('-progression');
}

/** The character's level in one class (multiclass-aware), else the character level. */
export function classLevel(actor, classId) {
	const levels = actor?.levels ?? {};
	return levels.classes?.[classId] ?? levels.character ?? 0;
}

/** The lowest level a feature (document or index entry) is gained at. */
export function minLevel(feature) {
	const system = feature?.system ?? {};
	const levels = Array.isArray(system.gainedAtLevels) ? system.gainedAtLevels : [];
	if (levels.length) return Math.min(...levels);
	if (Number.isFinite(system.gainedAtLevel)) return system.gainedAtLevel;
	return Number.POSITIVE_INFINITY;
}

/** The actor's class items (a multiclassed character has several). */
export function classItems(actor) {
	return actor?.items?.filter?.((item) => item.type === 'class') ?? [];
}

/** Owned items whose compendium source is one of `uuids` (any spelling). */
export function findOwnedBySource(actor, uuids) {
	const wanted = new Set([...(uuids ?? [])].map(canonicalUuid).filter(Boolean));
	return actor?.items?.filter?.((item) => wanted.has(itemSourceUuid(item))) ?? [];
}

/** Owned items of one type whose name matches (case-insensitive). */
export function findOwnedByName(actor, name, type = null) {
	const wanted = String(name ?? '').trim().toLowerCase();
	return (
		actor?.items?.filter?.(
			(item) => (!type || item.type === type) && item.name.trim().toLowerCase() === wanted,
		) ?? []
	);
}

/** Resolve a compendium document by (canonical or live) UUID; null if gone. */
export async function loadDoc(uuid) {
	try {
		return (await fromUuid(liveUuid(uuid))) ?? null;
	} catch (_error) {
		return null;
	}
}

/* ───────────────────────────── writing ───────────────────────────── */

/**
 * The update that turns `item` into a copy of `target`, keeping what the actor
 * owns (see the header). The target's own Nim+ flags are merged over the item's
 * (Foundry merges `flags` on update, so every other scope — the system's pool
 * state included — is left exactly as it was), except the content-contract keys
 * (`CONTENT_FLAG_KEYS`) the target lacks, which are deleted; and the compendium source is
 * moved to the target, so the next migration and the subclass sync both see
 * the item for what it now is.
 */
export function replacementUpdate(item, target) {
	const src = target.toObject();
	const system = foundry.utils.deepClone(src.system ?? {});
	const keep = [...ACTOR_STATE_FIELDS['*'], ...(ACTOR_STATE_FIELDS[item.type] ?? [])];
	const owned = item._source?.system ?? {};
	for (const key of keep) {
		if (key in owned) system[key] = foundry.utils.deepClone(owned[key]);
	}
	const update = {
		_id: item.id,
		name: src.name,
		img: src.img,
		...replaceWhole('system', system),
		'_stats.compendiumSource': target.uuid,
	};
	const moduleFlags = src.flags?.[MODULE_ID];
	const targetFlags = moduleFlags && typeof moduleFlags === 'object' ? foundry.utils.deepClone(moduleFlags) : {};
	// The Nim+ content contract (which side a document is on) belongs to the pack
	// document, not the actor: drop the source side's keys the target does not
	// declare, so an item moved back to 2.0.3 stops running 0.2 automation.
	// Written as dotted keys when the target has no Nim+ flags of its own, so the
	// update never carries a `flags` object that could be mistaken for new state.
	const ownedFlags = item._source?.flags?.[MODULE_ID] ?? item.flags?.[MODULE_ID] ?? {};
	const hasOwn = Object.keys(targetFlags).length > 0;
	for (const key of CONTENT_FLAG_KEYS) {
		if (!(key in ownedFlags) || key in targetFlags) continue;
		const [k, v] = deletionOf(key);
		if (hasOwn) targetFlags[k] = v;
		else update[`flags.${MODULE_ID}.${k}`] = v;
	}
	if (hasOwn) update.flags = { [MODULE_ID]: targetFlags };
	return update;
}

/**
 * Nim+ flags that describe the pack document itself (the 0.2 contract), as
 * opposed to runtime state the actor owns — a replacement takes these from its
 * target and never keeps the old side's.
 */
export const CONTENT_FLAG_KEYS = ['playtest02', 'supersedes'];

/** `[key, value]` that deletes `key` in an update: Foundry v14's `_del` operator, else the legacy `-=key`. */
function deletionOf(key) {
	const del = globalThis._del;
	const Deletion = foundry.data?.operators?.ForcedDeletion;
	if (Deletion && del instanceof Deletion) return [key, del];
	return [`-=${key}`, null];
}

/**
 * `{ key: value }` as a forced replacement rather than a merge. An update merges
 * objects by default, so a replaced `system` would keep keys the new document
 * dropped — a stale `selectionCountByLevel` level, for one. Foundry v14's
 * operator (`common/data/operators.mjs` l. 92, exposed as `_replace` in
 * `client/client.mjs` l. 81), with the legacy `==key` spelling as fallback.
 */
function replaceWhole(key, value) {
	const Forced = foundry.data?.operators?.ForcedReplacement;
	if (typeof Forced?.create === 'function') return { [key]: Forced.create(value) };
	return { [`==${key}`]: value };
}

/** Replace one owned item in place with a pack document. */
export async function replaceInPlace(actor, item, target) {
	const [updated] = await actor.updateEmbeddedDocuments('Item', [replacementUpdate(item, target)]);
	return updated ?? null;
}

/** Item creation data for a pack document, with its compendium source recorded. */
export function creationData(doc) {
	const src = doc.toObject();
	delete src._id;
	delete src.folder;
	delete src.sort;
	delete src.ownership;
	src._stats ??= {};
	src._stats.compendiumSource = doc.uuid;
	return src;
}

/** Add one or more pack documents to the actor. */
export async function addFeature(actor, docs) {
	const list = (Array.isArray(docs) ? docs : [docs]).filter(Boolean);
	if (!list.length) return [];
	return actor.createEmbeddedDocuments('Item', list.map(creationData));
}

/** Remove owned items (documents or ids). */
export async function removeItems(actor, items) {
	const ids = (Array.isArray(items) ? items : [items])
		.map((item) => (typeof item === 'string' ? item : item?.id))
		.filter((id) => id && actor.items.has(id));
	if (!ids.length) return [];
	return actor.deleteEmbeddedDocuments('Item', ids);
}

/* ───────────────────────────── asking ───────────────────────────── */

/**
 * Ask the current user to pick `count` of `options` — for re-levelled choice
 * groups (which grace to drop, which Orders to keep). Loops until exactly
 * `count` are picked or the dialog is cancelled.
 *
 * @param {Actor} actor
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.content]                HTML shown above the options
 * @param {{value: string, label: string, hint?: string, checked?: boolean}[]} spec.options
 * @param {number} [spec.count=1]
 * @returns {Promise<string[]|null>} the picked values, or null if cancelled
 */
export async function promptChoice(actor, { title, content = '', options = [], count = 1 } = {}) {
	if (!options.length || count < 1) return [];
	if (count >= options.length) return options.map((o) => o.value);

	const type = count === 1 ? 'radio' : 'checkbox';
	const rows = options
		.map(
			(o) =>
				`<label style="display:flex;gap:.5em;align-items:baseline;margin:.2em 0">` +
				`<input type="${type}" name="nimPlusChoice" value="${escape(o.value)}"${o.checked ? ' checked' : ''}>` +
				`<span><strong>${escape(o.label)}</strong>${o.hint ? ` — ${escape(o.hint)}` : ''}</span></label>`,
		)
		.join('');
	const html =
		`<p><strong>${escape(actor?.name ?? '')}</strong></p>${content}` +
		`<p>Choose ${count}:</p><div style="max-height:50vh;overflow:auto">${rows}</div>`;

	for (;;) {
		const picked = await foundry.applications.api.DialogV2.wait({
			window: { title: `Nim+ | ${title}`, icon: 'fa-solid fa-list-check' },
			position: { width: 480 },
			content: html,
			buttons: [
				{
					action: 'ok',
					label: 'Confirm',
					icon: 'fa-solid fa-check',
					default: true,
					callback: (_event, button) =>
						[...button.form.querySelectorAll('input[name="nimPlusChoice"]:checked')].map((i) => i.value),
				},
				{ action: 'cancel', label: 'Cancel', icon: 'fa-solid fa-xmark', callback: () => null },
			],
			rejectClose: false,
		});
		if (!Array.isArray(picked)) return null;
		if (picked.length === count) return picked;
		ui.notifications?.warn(`Nim+ | Choose exactly ${count}.`);
	}
}
