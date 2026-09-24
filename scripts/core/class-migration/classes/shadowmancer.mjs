import { MODULE_ID } from '../../constants.mjs';
import { sysId } from '../../system.mjs';

/**
 * Shadowmancer — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * What is left for this class (to02 only):
 *   - Command Shadows. 0.2 splits "command ALL your Shadows" out of Summon
 *     Shadow into its own cantrip, granted by Conduit of Shadow. It is a spell,
 *     not a progression feature, so the generic pass never adds it. Going back
 *     (to203) it is a 0.2-only document and the generic pass removes it.
 *   - Vengeful Blast is retired. The generic pass removes it, which leaves the
 *     character one Greater Invocation short, so the player picks a replacement
 *     from the 0.2 list. Going back, the old pick is not guessed.
 */

/** Nim+ Command Shadows (the id is persisted in pack-sources/ids.json). */
const COMMAND_SHADOWS = `Compendium.${MODULE_ID}.nim-plus-spells.Item.uHirzuVSdqt7jVPU`;
const VENGEFUL_BLAST = 'Compendium.nimble.nimble-class-features.Item.smUoANfxnZS95YVz';
const GREATER_GROUP = 'greater-invocations';

function ownsCommandShadows(actor, helpers) {
	return (
		helpers.findOwnedBySource(actor, [COMMAND_SHADOWS]).length > 0 ||
		helpers.findOwnedByName(actor, 'Command Shadows', 'spell').length > 0
	);
}

/** Planned removals of Vengeful Blast (read in both describe and migrate). */
function vengefulRemovals(ctx) {
	const target = ctx.helpers.canonicalUuid(VENGEFUL_BLAST);
	return ctx.plan.removals.filter(({ item }) => ctx.helpers.itemSourceUuid(item) === target);
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
	classId: 'shadowmancer',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(actor, ctx) {
		if (ctx.direction !== 'to02') return [];
		const lines = [];
		if (!ownsCommandShadows(actor, ctx.helpers)) {
			lines.push('Add the <em>Command Shadows</em> cantrip (0.2 Conduit of Shadow)');
		}
		if (vengefulRemovals(ctx).length) {
			lines.push(
				'<em>Vengeful Blast</em> is retired — you will be asked to choose a replacement Greater Invocation',
			);
		}
		return lines;
	},

	async migrate(actor, ctx) {
		if (ctx.direction !== 'to02') return;
		const { helpers } = ctx;

		if (!ownsCommandShadows(actor, helpers)) {
			const doc = await helpers.loadDoc(COMMAND_SHADOWS);
			if (doc) await helpers.addFeature(actor, doc);
			else ui.notifications?.warn(`Nim+ | ${actor.name}: Command Shadows could not be loaded — add it by hand.`);
		}

		const lost = vengefulRemovals(ctx).length;
		if (!lost) return;
		const options = await openOptions(actor, ctx, GREATER_GROUP);
		if (!options.length) return;
		const picked = await helpers.promptChoice(actor, {
			title: 'Replace Vengeful Blast',
			content: '<p>Vengeful Blast is retired in 0.2. Choose a Greater Shadow Invocation to take its place.</p>',
			options,
			count: Math.min(lost, options.length),
		});
		if (!picked) {
			ui.notifications?.info(`Nim+ | ${actor.name}: no Greater Invocation picked — choose one by hand.`);
			return;
		}
		const docs = (await Promise.all(picked.map((uuid) => helpers.loadDoc(uuid)))).filter(Boolean);
		await helpers.addFeature(actor, docs);
	},
};
