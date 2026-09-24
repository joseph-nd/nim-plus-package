/**
 * Zephyr — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * Intentionally a no-op: there is no Zephyr 0.2 sheet, and the 0.1 playtest
 * sheet matches Heroes 2.0.3 mechanically, so Nim+ ships no Zephyr replacements
 * and there is nothing to migrate in either direction.
 */
export default {
	classId: 'zephyr',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(_actor, _ctx) {
		return [];
	},

	async migrate(_actor, _ctx) {},
};
