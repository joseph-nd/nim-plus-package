/**
 * Oathsworn — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * Oathsworn needs nothing beyond the generic pass: every 0.2 change is a
 * replace-in-place (Radiant Judgment keeps its `judgment` dice pool identifier,
 * so rolled dice carry over), and no choice group was re-levelled.
 */
export default {
	classId: 'oathsworn',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(_actor, _ctx) {
		return [];
	},

	async migrate(_actor, _ctx) {},
};
