import { MODULE_ID } from '../../constants.mjs';
import { sysId } from '../../system.mjs';

/**
 * The Cheat — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * What is left for this class (to02 only):
 *   - Sunder Armor. 0.2 merges Sunder Armor (Medium) and (Heavy) into one
 *     Underhanded Ability. A character who took both keeps one Sunder Armor
 *     (the generic pass replaces the first and removes the other as "merged"),
 *     so one Underhanded Ability pick is freed and the player chooses a
 *     replacement. Going back (to203) the generic pass restores Medium and
 *     reports that Heavy has to be re-added by hand.
 */

const SUNDER_SOURCES = [
	'Compendium.nimble.nimble-class-features.Item.TrR4gkjE1SStGF4G', // Sunder Armor (Medium)
	'Compendium.nimble.nimble-class-features.Item.kQGzBvAflQsAVCnk', // Sunder Armor (Heavy)
];
const UNDERHANDED_GROUP = 'underhanded-abilities';

/** Sunder Armor copies the generic pass removes as merged — each one is a freed pick. */
function mergedSunders(ctx) {
	const sources = new Set(SUNDER_SOURCES.map((uuid) => ctx.helpers.canonicalUuid(uuid)));
	return ctx.plan.removals.filter(({ item }) => sources.has(ctx.helpers.itemSourceUuid(item)));
}

/**
 * The 0.2 options of a choice group the character does not own: unchanged
 * system documents plus Nim+ 0.2 copies, minus superseded and retired ones.
 * Read unfiltered, since the migration may run against the setting.
 */
async function openOptions(actor, ctx, group) {
	const { helpers, data, classId } = ctx;
	const packs = [
		{ pack: game.packs.get(`${MODULE_ID}.nim-plus-class-features`), nim: true },
		{ pack: game.packs.get(`${sysId()}.nimble-class-features`), nim: false },
	];
	const options = [];
	for (const { pack, nim } of packs) {
		if (!pack) continue;
		const entries = await helpers.readUnfilteredIndex(pack, helpers.FEATURE_INDEX_FIELDS);
		for (const entry of entries) {
			if (entry.type !== 'feature' || entry.system?.subclass) continue;
			if (entry.system?.class !== classId || entry.system?.group !== group) continue;
			const uuid = helpers.canonicalUuid(entry.uuid);
			if (!uuid) continue;
			if (nim) {
				const flags = entry.flags?.[MODULE_ID] ?? {};
				if (flags.playtest02 !== true && !(flags.supersedes?.length > 0)) continue;
			} else if (data.supersededBy.has(uuid) || data.retired.has(uuid)) {
				continue;
			}
			if (helpers.findOwnedBySource(actor, [uuid]).length) continue;
			if (helpers.findOwnedByName(actor, entry.name, 'feature').length) continue;
			options.push({ value: uuid, label: entry.name });
		}
	}
	return options.sort((a, b) => a.label.localeCompare(b.label));
}

export default {
	classId: 'the-cheat',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(_actor, ctx) {
		if (ctx.direction !== 'to02') return [];
		const freed = mergedSunders(ctx).length;
		if (!freed) return [];
		return [
			'<em>Sunder Armor (Medium)</em> and <em>(Heavy)</em> merge into one <em>Sunder Armor</em> — you will be asked to choose a replacement Underhanded Ability',
		];
	},

	async migrate(actor, ctx) {
		if (ctx.direction !== 'to02') return;
		const freed = mergedSunders(ctx).length;
		if (!freed) return;
		const { helpers } = ctx;
		const options = await openOptions(actor, ctx, UNDERHANDED_GROUP);
		if (!options.length) return;
		const picked = await helpers.promptChoice(actor, {
			title: 'Replace Sunder Armor (Heavy)',
			content:
				'<p>In 0.2 Sunder Armor is a single Underhanded Ability, which frees one of your picks. Choose an Underhanded Ability to take its place.</p>',
			options,
			count: Math.min(freed, options.length),
		});
		if (!picked) {
			ui.notifications?.info(`Nim+ | ${actor.name}: no Underhanded Ability picked — choose one by hand.`);
			return;
		}
		const docs = (await Promise.all(picked.map((uuid) => helpers.loadDoc(uuid)))).filter(Boolean);
		await helpers.addFeature(actor, docs);
	},
};
