/**
 * Commander — class-specific migration steps (Heroes 2.0.3 ⇄ Nimble 0.2 playtest).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface and
 * `ctx`) has already replaced superseded items in place, removed retired ones
 * and added missing auto-grant features. Put here only what it cannot do for
 * this class — re-levelled choice groups, merged or split features, a pool that
 * changed identifier — for both `ctx.direction`s. Every change `migrate` makes
 * must have a line in `describe`.
 *
 * What moved between the two versions:
 *
 *   2.0.3                                    0.2
 *   L1  Commander's Orders → grants          L1  Coordinated Strike! (own feature,
 *       Coordinated Strike! (INT/Safe Rest)      1/encounter; +INT/Safe Rest from L5)
 *   L2  Commander's Orders: choose 2         L2  Fit for Any Battlefield: choose a
 *   L4  Fit for Any Battlefield: choose a        Combat Tactic, gain Combat Dice
 *       Combat Tactic, gain Combat Dice      L4  Commander's Orders: choose 2
 *       (Commanding Presence is a Tactic)        (Commanding Presence is an Order)
 *
 * Coordinated Strike!, Fit for Any Battlefield and the Commander's Orders card
 * are auto-grants, so the generic pass replaces them in place (pool values kept
 * by identifier), adds them, or removes them when they now come later. The
 * Combat Tactics die-size card is retired. What is left is the two choice groups
 * whose levels swapped, plus Commanding Presence changing group:
 *
 *   to02  — a level 2–3 character owns Orders it does not get until level 4:
 *           list them and, confirmed, remove them. A level 2+ character with no
 *           Combat Tactic (a level 2–3 character, or one whose only tactic was
 *           Commanding Presence, now an Order) is offered one.
 *   to203 — a level 2–3 character owns a Combat Tactic it does not get until
 *           level 4: list it and, confirmed, remove it. A level 2+ character
 *           with fewer than 2 Orders is offered the missing ones.
 *   both  — from level 4 both sides grant the same number of Combat Abilities
 *           (Orders + Tactics), so a pick offered only because Commanding
 *           Presence changed group leaves one too many: the character is asked
 *           which ability to drop, from a group above its minimum.
 *
 * A Spellblade (official, both versions) forgoes Combat Tactics — it takes
 * another Order instead — so it is never offered one, and needs none.
 *
 * Every step asks: a cancelled prompt changes nothing, and anything skipped can
 * be done by hand from the compendium. The startup pass (non-interactive) asks
 * nothing: all four steps are deferred to the sheet's "Migrate class" control,
 * where they are re-derived from what the character owns.
 */
import { MODULE_ID } from '../../constants.mjs';
import { sysId } from '../../system.mjs';

const ORDERS_GROUP = 'commanders-orders';
const TACTICS_GROUP = 'combat-tactics';
const COORDINATED_STRIKE_MATCH = /coordinated\s*strike/i;
const NIM_FEATURE_PACK = `${MODULE_ID}.nim-plus-class-features`;
const SYSTEM_FEATURE_PACK = 'nimble-class-features';

/** Choice-step keys (see `../generic.mjs` `choiceLine`). */
const KEYS = {
	removeOrders: 'orders-early',
	removeTactics: 'tactics-early',
	pickTactic: 'combat-tactic',
	pickOrders: 'commanders-orders',
	dropSurplus: 'combat-abilities-surplus',
};

// The level each group is first chosen at, on the side being migrated to.
const LEVELS = {
	to02: { orders: 4, tactic: 2 },
	to203: { orders: 2, tactic: 4 },
};

// From level 4 both versions grant 3 Combat Abilities (Orders + Tactics), +1 at each of these levels.
const EXTRA_ABILITY_LEVELS = [6, 8, 10, 12, 16];
const SPELLBLADE_MATCH = /^spellblade$/i;

/** Spellblades forgo Combat Tactics (an Order or a spell instead), in both versions. */
function forgoesTactics(ctx) {
	const subclass = ctx.subclass;
	if (!subclass) return false;
	return SPELLBLADE_MATCH.test(String(subclass.system?.identifier || subclass.name || '').trim());
}

/** Combat Abilities (Orders + Tactics) the target side grants at `ctx.level` — from level 4 only. */
function abilityAllowance(ctx) {
	return 3 + EXTRA_ABILITY_LEVELS.filter((level) => level <= ctx.level).length;
}

/** The fewest picks each group must keep on the target side at `ctx.level`. */
function groupMinimums(ctx) {
	const levels = LEVELS[ctx.direction];
	return {
		[ORDERS_GROUP]: ctx.level >= levels.orders ? 2 : 0,
		[TACTICS_GROUP]: ctx.level >= levels.tactic && !forgoesTactics(ctx) ? 1 : 0,
	};
}

/**
 * How many Combat Abilities over the level's allowance the top-up picks would
 * leave, given `total` owned (after the generic pass) and `added` more. Only
 * from level 4, where both versions grant the same total: below it, the
 * re-levelled group's early picks are what is over, and that step asks already.
 * A character already over the allowance is never asked to go below what it had.
 */
function surplusAfter(ctx, total, added) {
	if (ctx.level < 4 || added <= 0) return 0;
	return Math.max(0, total + added - Math.max(abilityAllowance(ctx), total));
}

function isPick(item) {
	return (
		item.type === 'feature' &&
		!item.system?.subclass &&
		// The 2.0.3 Coordinated Strike! is filed under the Orders group, but it is
		// granted, not picked.
		!COORDINATED_STRIKE_MATCH.test(item.name ?? '')
	);
}

function ownedInGroup(actor, group) {
	return actor.items.filter((item) => isPick(item) && item.system?.group === group);
}

/**
 * The group an owned item will be in once the generic pass has run — an Order
 * replaced by a document of another group (Commanding Presence) counts under its
 * new one, and an item about to be removed counts nowhere.
 */
function groupAfterMigration(item, ctx) {
	if (ctx.plan?.removals?.some((entry) => entry.item.id === item.id)) return null;
	const replacement = ctx.plan?.replacements?.find((entry) => entry.item.id === item.id);
	return replacement?.target?.system?.group ?? item.system?.group ?? null;
}

function projectedInGroup(actor, ctx, group) {
	return actor.items.filter((item) => isPick(item) && groupAfterMigration(item, ctx) === group);
}

function names(items, escape) {
	return items.map((item) => `<em>${escape(item.name)}</em>`).join(', ');
}

/** The choosable documents of one group on the side being migrated to. */
async function candidates(ctx, group) {
	const { readUnfilteredIndex, minLevel } = ctx.helpers;
	const collection =
		ctx.direction === 'to02' ? NIM_FEATURE_PACK : `${sysId()}.${SYSTEM_FEATURE_PACK}`;
	const pack = game.packs.get(collection);
	if (!pack) return [];
	const entries = await readUnfilteredIndex(pack, [
		'system.class',
		'system.group',
		'system.subclass',
		'system.gainedAtLevels',
		'system.gainedAtLevel',
		`flags.${MODULE_ID}.playtest02`,
		`flags.${MODULE_ID}.supersedes`,
	]);
	return entries
		.filter((entry) => {
			if (entry.type !== 'feature' || entry.system?.subclass) return false;
			if (entry.system?.class !== 'commander' || entry.system?.group !== group) return false;
			if (COORDINATED_STRIKE_MATCH.test(entry.name ?? '')) return false;
			if (minLevel(entry) > ctx.level) return false;
			if (ctx.direction !== 'to02') return true;
			const flags = entry.flags?.[MODULE_ID] ?? {};
			return flags.playtest02 === true || (flags.supersedes?.length ?? 0) > 0;
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Offer `count` picks from a group, leaving out what the actor already owns.
 * @returns {Promise<{added: Item[], deferred: number}>} what was added, and how
 *          many picks a non-interactive run left for the sheet
 */
async function offerPicks(actor, ctx, { key, group, count, title, content }) {
	const { promptChoice, loadDoc, addFeature } = ctx.helpers;
	const ownedNames = new Set(
		actor.items.filter((item) => item.type === 'feature').map((item) => item.name.trim().toLowerCase()),
	);
	const options = (await candidates(ctx, group))
		.filter((entry) => !ownedNames.has(entry.name.trim().toLowerCase()))
		.map((entry) => ({ value: entry.uuid, label: entry.name }));
	if (!options.length) return { added: [], deferred: 0 };

	const n = Math.min(count, options.length);
	const picked = await promptChoice(actor, { key, title, content, options, count: n });
	if (ctx.helpers.isDeferred(picked)) return { added: [], deferred: n };
	if (!picked?.length) return { added: [], deferred: 0 };
	const docs = [];
	for (const uuid of picked) {
		const doc = await loadDoc(uuid);
		if (doc) docs.push(doc);
	}
	return { added: (await addFeature(actor, docs)) ?? [], deferred: 0 };
}

/** Owned Combat Abilities (Orders + Tactics). */
function ownedAbilities(actor) {
	return actor.items.filter((item) => isPick(item) && [ORDERS_GROUP, TACTICS_GROUP].includes(item.system?.group));
}

function surplusLine(ctx, surplus) {
	return ctx.helpers.choiceLine(
		`Combat Abilities: that is ${surplus} more than the ${abilityAllowance(ctx)} a level ${ctx.level} Commander has ` +
			`(Commanding Presence changed group): you will be asked which ${surplus} to drop`,
		KEYS.dropSurplus,
	);
}

/**
 * After a top-up pick, ask which Combat Ability to drop when the level's total
 * is now exceeded — only from groups above their minimum, never the new pick.
 * When the top-up was deferred, this step is deferred with it.
 */
async function dropSurplus(actor, ctx, total, offered) {
	const { promptChoice, removeItems, escape, isDeferred } = ctx.helpers;
	const added = (offered?.added?.length ?? 0) + (offered?.deferred ?? 0);
	const surplus = surplusAfter(ctx, total, added);
	if (!surplus) return [];
	const newIds = new Set((offered?.added ?? []).map((item) => item.id));
	const minimums = groupMinimums(ctx);
	const owned = ownedAbilities(actor);
	const options = owned
		.filter((item) => !newIds.has(item.id))
		.filter((item) => owned.filter((o) => o.system.group === item.system.group).length > (minimums[item.system.group] ?? 0))
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((item) => ({ value: item.id, label: item.name, hint: groupLabelOf(item.system.group) }));
	if (!options.length) return [];
	const count = Math.min(surplus, options.length);
	const picked = await promptChoice(actor, {
		key: KEYS.dropSurplus,
		title: 'Drop a Combat Ability',
		content:
			`<p>A level ${ctx.level} Commander has ${abilityAllowance(ctx)} Combat Abilities (Orders and Tactics). ` +
			`Commanding Presence changed group, so ${escape(actor.name)} now has ${surplus} too many.</p>` +
			'<p>Choose which to remove. <em>Cancelling keeps them all — you can remove one by hand later.</em></p>',
		options,
		count,
	});
	if (isDeferred(picked) || !picked?.length) return [];
	return removeItems(actor, picked);
}

function groupLabelOf(group) {
	return group === ORDERS_GROUP ? "Commander's Order" : 'Combat Tactic';
}

async function confirmRemoval(actor, ctx, key, items, why) {
	const { escape, removeItems, confirmChoice, isDeferred } = ctx.helpers;
	const live = items.filter((item) => actor.items.has(item.id));
	if (!live.length) return [];
	const confirmed = await confirmChoice(actor, {
		key,
		title: actor.name,
		content:
			`<p>${why}</p><p>Remove ${names(live, escape)}?</p>` +
			'<p><em>Keeping them is fine too — they stay on the sheet as they are.</em></p>',
		yes: 'Remove',
		yesIcon: 'fa-solid fa-trash',
		no: 'Keep',
	});
	if (isDeferred(confirmed) || !confirmed) return [];
	return removeItems(actor, live);
}

export default {
	classId: 'commander',

	/** @returns {string[]|Promise<string[]>} preview lines (HTML) */
	describe(actor, ctx) {
		const { escape, choiceLine } = ctx.helpers;
		const levels = LEVELS[ctx.direction];
		if (!levels || ctx.level < 2) return [];
		const lines = [];

		if (ctx.direction === 'to02') {
			if (ctx.level < levels.orders) {
				const early = projectedInGroup(actor, ctx, ORDERS_GROUP);
				if (early.length) {
					lines.push(
						choiceLine(
							`Commander's Orders now come at level ${levels.orders}: you will be asked whether to remove ${names(early, escape)}`,
							KEYS.removeOrders,
						),
					);
				}
			}
			const orders = projectedInGroup(actor, ctx, ORDERS_GROUP).length;
			const tactics = projectedInGroup(actor, ctx, TACTICS_GROUP).length;
			if (!tactics && !forgoesTactics(ctx)) {
				lines.push(
					choiceLine('Fit for Any Battlefield (level 2) brings a Combat Tactic: you will be asked to choose one', KEYS.pickTactic),
				);
				const surplus = surplusAfter(ctx, orders + tactics, 1);
				if (surplus) lines.push(surplusLine(ctx, surplus));
			}
			return lines;
		}

		if (ctx.level < levels.tactic) {
			const early = projectedInGroup(actor, ctx, TACTICS_GROUP);
			if (early.length) {
				lines.push(
					choiceLine(
						`Combat Tactics come at level ${levels.tactic} in 2.0.3: you will be asked whether to remove ${names(early, escape)}`,
						KEYS.removeTactics,
					),
				);
			}
		}
		const orders = projectedInGroup(actor, ctx, ORDERS_GROUP).length;
		if (orders < 2) {
			lines.push(
				choiceLine(`Commander's Orders are chosen at level 2 in 2.0.3: you will be asked to choose ${2 - orders}`, KEYS.pickOrders),
			);
			const tactics = projectedInGroup(actor, ctx, TACTICS_GROUP).length;
			const surplus = surplusAfter(ctx, orders + tactics, 2 - orders);
			if (surplus) lines.push(surplusLine(ctx, surplus));
		}
		return lines;
	},

	async migrate(actor, ctx) {
		const levels = LEVELS[ctx.direction];
		if (!levels || ctx.level < 2) return;

		if (ctx.direction === 'to02') {
			if (ctx.level < levels.orders) {
				await confirmRemoval(
					actor,
					ctx,
					KEYS.removeOrders,
					ownedInGroup(actor, ORDERS_GROUP),
					`In Nimble 0.2, Commander's Orders are chosen at level ${levels.orders} (this Commander is level ${ctx.level}).`,
				);
			}
			if (!ownedInGroup(actor, TACTICS_GROUP).length && !forgoesTactics(ctx)) {
				const total = ownedAbilities(actor).length;
				const offered = await offerPicks(actor, ctx, {
					key: KEYS.pickTactic,
					group: TACTICS_GROUP,
					count: 1,
					title: 'Choose a Combat Tactic',
					content:
						'<p>In Nimble 0.2, Fit for Any Battlefield brings a Combat Tactic at level 2, and Commanding Presence is an Order.</p>',
				});
				await dropSurplus(actor, ctx, total, offered);
			}
			return;
		}

		if (ctx.level < levels.tactic) {
			await confirmRemoval(
				actor,
				ctx,
				KEYS.removeTactics,
				ownedInGroup(actor, TACTICS_GROUP),
				`In Heroes 2.0.3, Combat Tactics are chosen at level ${levels.tactic} (this Commander is level ${ctx.level}).`,
			);
		}
		const orders = ownedInGroup(actor, ORDERS_GROUP).length;
		if (orders < 2) {
			const total = ownedAbilities(actor).length;
			const offered = await offerPicks(actor, ctx, {
				key: KEYS.pickOrders,
				group: ORDERS_GROUP,
				count: 2 - orders,
				title: "Choose Commander's Orders",
				content: "<p>In Heroes 2.0.3, Commander's Orders are chosen at level 2.</p>",
			});
			await dropSurplus(actor, ctx, total, offered);
		}
	},
};
