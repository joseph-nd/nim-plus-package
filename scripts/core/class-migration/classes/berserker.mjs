/**
 * Berserker — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * Nothing class-specific: 0.2 changes only the text and rules of existing
 * Berserker documents (Boundless Rage, six Savage Arsenal options), at the same
 * levels and in the same groups, and the Fury Dice pool keeps its identifier —
 * the generic in-place replacement is the whole migration, both ways.
 */
export default {
	classId: 'berserker',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(_actor, _ctx) {
		return [];
	},

	async migrate(_actor, _ctx) {},
};
