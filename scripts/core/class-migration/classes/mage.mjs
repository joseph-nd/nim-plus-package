/**
 * Mage — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * Mage needs nothing beyond the generic pass: 0.2 changes only text (and the
 * class complexity), all replaced in place; no choice group was re-levelled.
 */
export default {
	classId: 'mage',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(_actor, _ctx) {
		return [];
	},

	async migrate(_actor, _ctx) {},
};
