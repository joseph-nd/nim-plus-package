/**
 * Hunter — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * Nothing class-specific: 0.2 changes only the text of four Thrill of the Hunt
 * options (Heavy Shot, Fleet Feet, Hail of Arrows, Pinning Shot), at the same
 * levels and in the same group — the generic in-place replacement is the whole
 * migration, both ways.
 */
export default {
	classId: 'hunter',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(_actor, _ctx) {
		return [];
	},

	async migrate(_actor, _ctx) {},
};
