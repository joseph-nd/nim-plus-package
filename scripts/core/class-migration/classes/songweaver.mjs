import { MODULE_ID } from '../../constants.mjs';

/**
 * Songweaver — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * 0.2 reshuffles the spellcasting features:
 *   - the level-3 "Windbag" (utility spells) is renamed "I Know Just the Song"
 *     — the generic pass replaces it in place;
 *   - a new level-1 "Windbag" grants Wind cantrips and Vicious Mockery. The
 *     generic pass would add it, but skips it while the character still owns a
 *     feature named "Windbag" (the old one, replaced only once the plan runs),
 *     so from level 3 up it is added here;
 *   - "Wind Spellcasting and…" (the additional school) moves from level 1 to 2.
 *     A level-1 character loses the feature in the generic pass, but still owns
 *     the extra school's cantrips; the player is asked whether to drop them.
 *     Going back (to203) a level-1 character gets the feature again with no
 *     school chosen — reported for the player to pick by hand.
 */

/** Nim+ level-1 Windbag (the id is persisted in pack-sources/ids.json). */
const WINDBAG_L1 = `Compendium.${MODULE_ID}.nim-plus-class-features.Item.pNFFZrY8J15qC8gX`;
/** 2.0.3 "Wind Spellcasting and…" (level 1, the additional school). */
const WIND_SPELLCASTING_203 = 'Compendium.nimble.nimble-class-features.Item.4jKHYa0ZPYXjliJo';

/** True when the generic plan drops (to02) or adds (to203) the 2.0.3 level-1 school feature. */
function schoolFeatureMoves(ctx) {
	const { helpers, plan } = ctx;
	const uuid = helpers.canonicalUuid(WIND_SPELLCASTING_203);
	if (ctx.direction === 'to02') return plan.removals.some(({ item }) => helpers.itemSourceUuid(item) === uuid);
	return plan.additions.some(({ doc }) => helpers.canonicalUuid(doc?.uuid) === uuid);
}

function needsWindbag(actor, ctx) {
	const { helpers } = ctx;
	const uuid = helpers.canonicalUuid(WINDBAG_L1);
	if (ctx.plan.additions.some(({ doc }) => helpers.canonicalUuid(doc?.uuid) === uuid)) return false;
	return helpers.findOwnedBySource(actor, [uuid]).length === 0;
}

/**
 * Cantrips outside the Wind school: at level 1 in 0.2 a Songweaver knows only
 * Wind cantrips and Vicious Mockery, so these came from the 2.0.3 extra school
 * (or from elsewhere — which is why removal is always confirmed).
 */
function extraSchoolCantrips(actor) {
	return (
		actor.items?.filter?.(
			(item) =>
				item.type === 'spell' &&
				Number(item.system?.tier ?? 0) === 0 &&
				item.system?.school &&
				item.system.school !== 'wind' &&
				item.name.trim().toLowerCase() !== 'vicious mockery',
		) ?? []
	);
}

export default {
	classId: 'songweaver',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(actor, ctx) {
		const { escape } = ctx.helpers;
		const lines = [];
		if (ctx.direction === 'to02') {
			if (needsWindbag(actor, ctx)) {
				lines.push('Add the level-1 <em>Windbag</em> feature (Wind cantrips and Vicious Mockery)');
			}
			if (schoolFeatureMoves(ctx)) {
				const extra = extraSchoolCantrips(actor);
				if (extra.length) {
					lines.push(
						`0.2 grants the additional spell school at level 2 — you will be asked whether to remove ${extra
							.map((i) => `<em>${escape(i.name)}</em>`)
							.join(', ')}`,
					);
				}
			}
		} else if (schoolFeatureMoves(ctx)) {
			lines.push(
				'2.0.3 grants <em>Wind Spellcasting and…</em> at level 1 — choose the additional school and add its cantrips by hand',
			);
		}
		return lines;
	},

	async migrate(actor, ctx) {
		if (ctx.direction !== 'to02') return;
		const { helpers } = ctx;

		if (needsWindbag(actor, ctx)) {
			const doc = await helpers.loadDoc(WINDBAG_L1);
			if (doc) await helpers.addFeature(actor, doc);
			else ui.notifications?.warn(`Nim+ | ${actor.name}: Windbag could not be loaded — add it by hand.`);
		}

		if (!schoolFeatureMoves(ctx)) return;
		const extra = extraSchoolCantrips(actor);
		if (!extra.length) return;
		const list = extra.map((i) => `<li>${helpers.escape(i.name)}</li>`).join('');
		const remove = await foundry.applications.api.DialogV2.confirm({
			window: { title: 'Nim+ | Songweaver: additional school', icon: 'fa-solid fa-music' },
			content:
				`<p><strong>${helpers.escape(actor.name)}</strong></p>` +
				'<p>In 0.2 a level-1 Songweaver knows only Wind cantrips and Vicious Mockery; the additional ' +
				'school comes at level 2. Remove these cantrips? (The level-up window offers the school again.)</p>' +
				`<ul>${list}</ul>`,
			rejectClose: false,
		});
		if (remove) await helpers.removeItems(actor, extra);
	},
};
