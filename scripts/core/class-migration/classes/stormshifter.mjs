/**
 * Stormshifter — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * What is left for this module is the Direbeast forms. They sit in a choice
 * group (`direbeast-form`), so the generic pass never adds or drops them, but
 * every level offers exactly one form, so the right set is known at any level:
 *   2.0.3: Fearsome Beast 2, Beast of the Pack 3, Beast of Nightmares 5;
 *   0.2:   Fearsome Beast 1, Beast of the Pack 2, Beast of Nightmares 5.
 * to02 adds the forms the character is now due. to203 removes the ones it has
 * not reached yet under 2.0.3, and the level-up window grants them again.
 *
 * Pools: the 2.0.3 Beastshift charges were never a pool (description text only).
 * The 0.2 Direbeast Form pool (`direbeast-form`, actor scope) comes from the
 * replaced Direbeast Form feature's rule and starts full, so nothing is carried.
 * Expert Shifter is retired and removed by the generic pass. The lightning/wind
 * spell copies are swapped by the generic replace on every actor that owns them:
 * a spell has no `system.class`, so it is always in scope.
 */

const SYSTEM_FEATURES = 'Compendium.nimble.nimble-class-features.Item';

/** The Direbeast forms: system id and the level each rule set grants them at. */
const FORMS = [
	{ name: 'Fearsome Beast', systemId: 'tZkAluN0peHdleIx', to02: 1, to203: 2 },
	{ name: 'Beast of the Pack', systemId: 'bQW0Iy4BSeXNRD2x', to02: 2, to203: 3 },
	{ name: 'Beast of Nightmares', systemId: 'qFGSdrw0ZItRK00x', to02: 5, to203: 5 },
];

/** Owned Stormshifter copies of a form, whichever side they came from. */
function ownedForm(actor, ctx, form) {
	return ctx.helpers
		.findOwnedByName(actor, form.name, 'feature')
		.filter((item) => !item.system?.class || item.system.class === 'stormshifter');
}

/** The 0.2 copy of a form: the Nim+ document superseding the system one. */
function replacementUuid(ctx, form) {
	const systemUuid = ctx.helpers.canonicalUuid(`${SYSTEM_FEATURES}.${form.systemId}`);
	return ctx.data?.supersededBy?.get(systemUuid) ?? null;
}

/** The forms this actor gains (to02) or loses (to203) in this migration. */
function plannedForms(actor, ctx) {
	const { level, direction } = ctx;
	if (direction === 'to02') {
		return FORMS.filter((form) => form.to02 <= level && !ownedForm(actor, ctx, form).length).map(
			(form) => ({ form, action: 'add' }),
		);
	}
	return FORMS.filter((form) => form.to203 > level && ownedForm(actor, ctx, form).length).map(
		(form) => ({ form, action: 'remove' }),
	);
}

export default {
	classId: 'stormshifter',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(actor, ctx) {
		const { escape } = ctx.helpers;
		return plannedForms(actor, ctx).map(({ form, action }) =>
			action === 'add'
				? `Added: <strong>${escape(form.name)}</strong> <em>(Direbeast form, level ${form.to02} in 0.2)</em>`
				: `Removed: <s>${escape(form.name)}</s> <em>(Direbeast form, level ${form.to203} in 2.0.3)</em>`,
		);
	},

	async migrate(actor, ctx) {
		const { helpers } = ctx;
		const toAdd = [];
		const toRemove = [];
		for (const { form, action } of plannedForms(actor, ctx)) {
			if (action === 'remove') {
				toRemove.push(...ownedForm(actor, ctx, form));
				continue;
			}
			const uuid = replacementUuid(ctx, form);
			const doc = uuid ? await helpers.loadDoc(uuid) : null;
			if (doc) toAdd.push(doc);
			else console.warn(`nim-plus-package | stormshifter migration: no 0.2 copy of ${form.name} to add`);
		}
		if (toRemove.length) await helpers.removeItems(actor, toRemove);
		if (toAdd.length) await helpers.addFeature(actor, toAdd);
	},
};
