/**
 * Shepherd — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) already swaps every superseded document in place — the graces, the
 * Sacred Graces picker, Lifebinding Spirit (feature) → My Buddy!, the Assist Me
 * grace → the core L5 feature, the Lifebinding Spirit spell → the 0.2 cantrip —
 * drops Searing Light, and adds the auto-grants the character lacks. What it
 * cannot do:
 *
 *   1. Sacred Graces were re-levelled. 2.0.3 grants 2 at L5, then 1 at 9 and 13
 *      (2/3/4); 0.2 grants 1 at 4, 9 and 13 (1/2/3), and Assist Me stopped being
 *      a grace. The player keeps or picks graces until the count matches; nothing
 *      is dropped without that choice, and cancelling leaves them as they were.
 *   2. The Lifebinding Spirit spell. In 0.2 every Shepherd knows the cantrip from
 *      L1 (My Buddy!); a 2.0.3 character below L2 never had the tier-1 spell, so
 *      going to 0.2 it is added, and going back below L2 it is removed.
 *
 * The Mend charges (My Buddy!'s `lifebindingMend` pool) start full: Searing
 * Light kept no tracked pool to carry across, and the sheet's +/- corrects it.
 */

const GRACE_GROUP = 'sacred-grace';
const NIM_FEATURE_PACK = 'nim-plus-package.nim-plus-class-features';
const SYSTEM_FEATURE_PACK = 'nimble-class-features';
const LIFEBINDING_CANTRIP = 'Compendium.nim-plus-package.nim-plus-spells.Item.SAEd6Nk8SfgJ2Ff7';
const LIFEBINDING_NAME = 'lifebinding spirit';

/** Graces the rules grant by this class level. */
function allowedGraces(direction, level) {
	if (direction === 'to02') return level >= 13 ? 3 : level >= 9 ? 2 : level >= 4 ? 1 : 0;
	return level >= 13 ? 4 : level >= 9 ? 3 : level >= 5 ? 2 : 0;
}

function isGrace(system) {
	return system?.group === GRACE_GROUP && (!system.class || system.class === 'shepherd');
}

function rulesLabel(direction) {
	return direction === 'to02' ? 'Nimble 0.2' : 'Heroes 2.0.3';
}

/**
 * The actor's graces once the generic plan is applied: a replaced item takes its
 * target's group (Assist Me leaves the pool going to 0.2 and rejoins it going
 * back), a removed one is gone. In `migrate` the plan has been applied, so the
 * owned items speak for themselves.
 */
function gracesAfterPlan(actor, ctx, applied) {
	if (applied) return actor.items.filter((i) => i.type === 'feature' && isGrace(i.system));
	const removed = new Set(ctx.plan.removals.map((r) => r.item.id));
	const replaced = new Map(ctx.plan.replacements.map((r) => [r.item.id, r.target]));
	const graces = actor.items.filter((i) => {
		if (i.type !== 'feature' || removed.has(i.id)) return false;
		return isGrace((replaced.get(i.id) ?? i).system);
	});
	// Graces the generic pass adds (none today, but keep the count honest).
	const added = ctx.plan.additions.filter((a) => isGrace(a.doc?.system)).length;
	return { length: graces.length + added };
}

/** Whether the actor owns (or, before the plan runs, will own) a Lifebinding Spirit spell. */
function hasLifebindingSpell(actor, ctx, applied) {
	const removed = applied ? new Set() : new Set(ctx.plan.removals.map((r) => r.item.id));
	return actor.items.some(
		(i) => i.type === 'spell' && !removed.has(i.id) && i.name.trim().toLowerCase() === LIFEBINDING_NAME,
	);
}

/** The grace documents of the side being migrated to (unfiltered index entries). */
async function gracePool(ctx) {
	const { helpers, direction } = ctx;
	const collection = direction === 'to02' ? NIM_FEATURE_PACK : `${game.system.id}.${SYSTEM_FEATURE_PACK}`;
	const pack = game.packs.get(collection);
	if (!pack) return [];
	const entries = await helpers.readUnfilteredIndex(pack, helpers.FEATURE_INDEX_FIELDS);
	return entries.filter((e) => e.type === 'feature' && !e.system?.subclass && isGrace(e.system));
}

export default {
	classId: 'shepherd',

	/** @returns {string[]} preview lines (HTML) */
	describe(actor, ctx) {
		const lines = [];
		const rules = rulesLabel(ctx.direction);
		const have = gracesAfterPlan(actor, ctx, false).length;
		const allowed = allowedGraces(ctx.direction, ctx.level);
		if (have > allowed) {
			const drop = have - allowed;
			if (allowed === 0) {
				lines.push(`Sacred Graces: ${rules} grants none before level ${ctx.direction === 'to02' ? 4 : 5} — all ${have} removed`);
			} else lines.push(
				`Sacred Graces: ${have} owned, ${rules} grants ${allowed} at level ${ctx.level} — ` +
					`you choose which ${allowed} to keep; the other ${drop} ${drop === 1 ? 'is' : 'are'} removed`,
			);
		} else if (have < allowed) {
			const add = allowed - have;
			lines.push(
				`Sacred Graces: ${have} owned, ${rules} grants ${allowed} at level ${ctx.level} — ` +
					`you pick ${add} new grace${add === 1 ? '' : 's'}`,
			);
		}

		const hasSpell = hasLifebindingSpell(actor, ctx, false);
		if (ctx.direction === 'to02' && !hasSpell) {
			lines.push('Added: <strong>Lifebinding Spirit</strong> <em>(cantrip, from My Buddy!)</em>');
		} else if (ctx.direction === 'to203' && hasSpell && ctx.level < 2) {
			lines.push('Removed: <s>Lifebinding Spirit</s> <em>(2.0.3 learns it at level 2)</em>');
		}
		return lines;
	},

	async migrate(actor, ctx) {
		const { helpers, direction, level } = ctx;
		const rules = rulesLabel(direction);

		// Lifebinding Spirit spell.
		const hasSpell = hasLifebindingSpell(actor, ctx, true);
		if (direction === 'to02' && !hasSpell) {
			const doc = await helpers.loadDoc(LIFEBINDING_CANTRIP);
			if (doc) await helpers.addFeature(actor, doc);
		} else if (direction === 'to203' && hasSpell && level < 2) {
			await helpers.removeItems(
				actor,
				actor.items.filter((i) => i.type === 'spell' && i.name.trim().toLowerCase() === LIFEBINDING_NAME),
			);
		}

		// Sacred Graces.
		const owned = gracesAfterPlan(actor, ctx, true);
		const allowed = allowedGraces(direction, level);
		if (owned.length > allowed) {
			const keep = await helpers.promptChoice(actor, {
				title: 'Sacred Graces',
				content:
					`<p>${rules} grants ${allowed} Sacred Grace${allowed === 1 ? '' : 's'} at level ${level}. ` +
					'Keep which? The others are removed from the character.</p>',
				options: owned.map((i) => ({ value: i.id, label: i.name })),
				count: allowed,
			});
			if (keep === null) {
				ui.notifications?.warn(`Nim+ | ${actor.name}: Sacred Graces left as they were — adjust them by hand.`);
				return;
			}
			await helpers.removeItems(
				actor,
				owned.filter((i) => !keep.includes(i.id)),
			);
		} else if (owned.length < allowed) {
			const ownedNames = new Set(owned.map((i) => i.name.trim().toLowerCase()));
			const pool = (await gracePool(ctx)).filter((e) => !ownedNames.has(e.name.trim().toLowerCase()));
			const need = Math.min(allowed - owned.length, pool.length);
			if (need < 1) return;
			const picked = await helpers.promptChoice(actor, {
				title: 'Sacred Graces',
				content:
					`<p>${rules} grants ${allowed} Sacred Grace${allowed === 1 ? '' : 's'} at level ${level}; ` +
					`this character has ${owned.length}. Pick the new one${need === 1 ? '' : 's'}.</p>`,
				options: pool.map((e) => ({ value: e.uuid, label: e.name })),
				count: need,
			});
			if (picked === null) {
				ui.notifications?.warn(`Nim+ | ${actor.name}: no Sacred Grace added — pick it on the sheet by hand.`);
				return;
			}
			const docs = [];
			for (const uuid of picked) {
				const doc = await helpers.loadDoc(uuid);
				if (doc) docs.push(doc);
			}
			await helpers.addFeature(actor, docs);
		}
	},
};
