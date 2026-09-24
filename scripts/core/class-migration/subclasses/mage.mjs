/**
 * Mage official subclasses — subclass-specific migration steps (Heroes 2.0.3 ⇄
 * Nimble 0.2 playtest). Runs after `../classes/mage.mjs`, with the same `ctx`
 * (`ctx.subclass` is the owned Mage subclass item, or null).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface) has
 * already replaced superseded subclass items and features in place; subclass
 * features that are new in 0.2 are added by the subclass sync that runs after
 * the migration. Put here only what neither can do. Every change `migrate`
 * makes must have a line in `describe`.
 */
export default {
	classId: 'mage',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(_actor, _ctx) {
		return [];
	},

	async migrate(_actor, _ctx) {},
};
