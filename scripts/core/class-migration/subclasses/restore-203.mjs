/**
 * Shared step for the official-subclass modules: restoring 2.0.3 subclass
 * features when migrating back (`to203`).
 *
 * Going to 0.2, the generic pass replaces an official subclass's superseded
 * features in place, removes the retired ones, and removes features that 0.2
 * grants at a higher level; the subclass sync then adds the 0.2 features the
 * character is due. Going back, the generic pass restores what the character
 * owns a 0.2 copy of, but nothing re-adds a 2.0.3 feature it owns no copy of:
 * one 0.2 retired (Pack Hunter, Martyr Spawn, …) or one 2.0.3 grants earlier
 * than 0.2 does (Windborne Protector: 2.0.3 level 3, 0.2 level 7). The subclass
 * sync does not help either — after the migration the subclass item is sourced
 * from the system pack, which the sync leaves alone.
 *
 * `restoreModule(classId, groups)` builds a class module that, for `to203` and
 * a subclass whose group is listed, adds every 2.0.3 feature of that subclass
 * gained at or below the character's class level that it will not own after the
 * generic pass. `to02` needs nothing from it.
 */
import { MODULE_ID } from '../../constants.mjs';
import { sysId } from '../../system.mjs';

const SYSTEM_FEATURE_PACK = 'nimble-class-features';

/** The 2.0.3 subclass document behind the owned subclass item (Nim+ copy or system original). */
async function systemSubclass(subclass, ctx) {
	const { canonicalUuid, itemSourceUuid, loadDoc } = ctx.helpers;
	const src = itemSourceUuid(subclass);
	if (!src) return null;
	const replaced = ctx.data?.supersedes?.get(src);
	const uuid = replaced?.length ? replaced[0] : src;
	if (!canonicalUuid(uuid)?.startsWith('Compendium.nimble.nimble-subclasses.')) return null;
	return loadDoc(uuid);
}

/** 2.0.3 features of `group` gained at or below `level`, read past the supersede filter. */
async function systemFeatures(classId, group, level, ctx) {
	const pack = game.packs.get(`${sysId()}.${SYSTEM_FEATURE_PACK}`);
	if (!pack) return [];
	const { FEATURE_INDEX_FIELDS, readUnfilteredIndex, minLevel } = ctx.helpers;
	const entries = await readUnfilteredIndex(pack, FEATURE_INDEX_FIELDS);
	return entries.filter(
		(e) =>
			e.type === 'feature' &&
			e.system?.subclass &&
			e.system?.class === classId &&
			e.system?.group === group &&
			minLevel(e) <= level,
	);
}

/**
 * What the actor will own once the generic plan is applied: the sources of the
 * items it keeps or gets replaced (by the replacement's source), plus the names
 * of kept items that have no compendium source (hand-made copies).
 * With `plan` null (in `migrate`, after the generic pass), the actor as it is.
 */
function ownedAfterPlan(actor, classId, ctx, plan) {
	const { canonicalUuid, itemSourceUuid } = ctx.helpers;
	const removed = new Set((plan?.removals ?? []).map((r) => r.item.id));
	const replaced = new Map((plan?.replacements ?? []).map((r) => [r.item.id, canonicalUuid(r.target.uuid)]));
	const sources = new Set();
	const names = new Set();
	for (const item of actor.items) {
		if (removed.has(item.id)) continue;
		const src = replaced.get(item.id) ?? itemSourceUuid(item);
		if (src) sources.add(src);
		else if (item.type === 'feature' && (!item.system?.class || item.system.class === classId)) {
			names.add(item.name.trim().toLowerCase());
		}
	}
	return { sources, names };
}

async function missingFeatures(actor, ctx, groups, plan) {
	if (ctx.direction !== 'to203' || !ctx.subclass) return [];
	const subclass = await systemSubclass(ctx.subclass, ctx);
	if (!subclass) return [];
	const group = subclass.name.slugify({ strict: true });
	if (!groups.includes(group)) return [];

	const { canonicalUuid, loadDoc } = ctx.helpers;
	const { sources, names } = ownedAfterPlan(actor, ctx.classId, ctx, plan);
	const out = [];
	for (const entry of await systemFeatures(ctx.classId, group, ctx.level, ctx)) {
		const uuid = canonicalUuid(entry.uuid);
		if (!uuid || sources.has(uuid) || names.has(String(entry.name).trim().toLowerCase())) continue;
		const doc = await loadDoc(uuid);
		if (doc) out.push({ doc, subclass });
	}
	return out;
}

/**
 * @param {string} classId
 * @param {string[]} groups  official subclass groups (slugified names) that need the step
 */
export function restoreModule(classId, groups) {
	return {
		classId,

		async describe(actor, ctx) {
			const { escape, minLevel } = ctx.helpers;
			const missing = await missingFeatures(actor, ctx, groups, ctx.plan);
			return missing.map(
				({ doc, subclass }) =>
					`Added: <strong>${escape(doc.name)}</strong> <em>(${escape(subclass.name)} 2.0.3 feature, level ${minLevel(doc)})</em>`,
			);
		},

		async migrate(actor, ctx) {
			const missing = await missingFeatures(actor, ctx, groups, null);
			if (!missing.length) return;
			await ctx.helpers.addFeature(
				actor,
				missing.map((m) => m.doc),
			);
			console.log(
				`${MODULE_ID} | ${actor.name}: restored 2.0.3 subclass features — ${missing.map((m) => m.doc.name).join(', ')}`,
			);
		},
	};
}
