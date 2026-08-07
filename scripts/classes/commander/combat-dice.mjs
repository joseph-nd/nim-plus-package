import { MODULE_ID } from '../../core/constants.mjs';
import { sysHook } from '../../core/system.mjs';
import { hasActiveRule, addSyntheticRule } from '../../core/rules.mjs';
import { iterateChargePools, setChargePoolCurrent } from '../../core/pools.mjs';

/* ── Commander — Combat Dice & Combat Tactics ────────────────────────────────
 *
 * "1/attack, you can expend a Combat Die to add one of the following effects to
 *  your attack." — with STR Combat Dice gained when you roll Initiative, each a
 *  d6 that grows to a d20 as you level.
 *
 * The resource is modelled: `fit-for-any-battlefield.json` carries a
 * `chargePool` (`combat-dice`, `max: "@strength"`, `dieSize: "d6"`, refreshed
 * `onInitiativeRolled`) plus the `modifyPool` rules that upgrade the die at
 * levels 5/9/13/17. `dieSize` on a charge pool means "roll-on-spend": the count
 * is how many times you may roll that die, and the system's own sheet rail draws
 * one pip per die with a click-to-roll-and-spend button.
 *
 * That is exactly the rule as written — "extra damage equal to **a roll of** your
 * Combat Die" — so the dice are *not* pre-rolled here. What the content does not
 * carry is anything connecting the resource to the five Combat Tactic items,
 * whose only content is the paragraph describing them, and there is no moment at
 * which a player says "I am using Heavy Strike on this swing". Without that, the
 * rail's button is the whole feature: it rolls a die at any time, spends it
 * immediately, and leaves the player to work out what it was for.
 *
 * So this section supplies the missing half:
 *
 *   - **A "Combat Tactic" picker on the attack.** The activation dialog lists the
 *     tactics this Commander actually chose, filtered to the weapon in hand
 *     (Lunging and Sweeping name your Reach, so they are melee-only).
 *   - **The Combat Die is rolled into the attack's own damage roll**, so it shares
 *     the card, the tooltip and the single Apply Damage button — and Lunging
 *     Strike's "2× a roll of your Combat Die" is one die doubled rather than two
 *     dice, which is a different spread of damage for the same average.
 *   - **The die is spent only when the tactic did something.** Heavy Strike says
 *     "when you hit", so a miss costs nothing and is not even rolled.
 *   - **Inerrant Strike responds to a miss**, so it cannot be declared in advance:
 *     it is offered as a prompt the moment an attack misses.
 *   - **Sweeping Strike's "this attack does not miss on a 1"** is applied to the
 *     roll itself, so the card reads as a hit.
 *   - **Combat Dice are lost when combat ends** — the pool ships with no
 *     `encounterEnd` recovery, so a Commander walks out of a fight still holding
 *     the dice they did not use. One recovery entry, added in memory, fixes it.
 *   - **Commanding Presence** is a Combat Tactic but an Action rather than an
 *     attack rider, and nothing makes it cost anything. It is blocked with an
 *     empty pool and spends a die on use; its die is never rolled, because the
 *     save DC is 10+STR and the value is never read.
 *
 * The system's own charge stepper for this pool stays in the dialog and keeps
 * working — it is the escape hatch for spending a die on anything this section
 * does not model. It is hidden only while a tactic is actually selected, so the
 * same attack can never spend two dice through two different controls.
 *
 * ── Update-resilience ────────────────────────────────────────────────────────
 * The pool is found by a fuzzy identifier/label match on flag state rather than
 * by a hardcoded rule id; the tactics are found by matching the actor's own
 * feature names, so a rename or a homebrew copy still resolves; the encounter-end
 * recovery stands down the day the content declares one itself; and every DOM
 * anchor is optional, so a missing one means the picker does not render and the
 * weapon rolls exactly as it does today.
 */

export const COMBAT_DICE_IDENTIFIER = 'combat-dice';
export const COMBAT_TACTIC_FIELD_CLASS = 'nim-plus-combat-tactic';
export const COMBAT_TACTIC_STYLE_ID = 'nim-plus-combat-tactic-styles';
export const COMMANDING_PRESENCE_MATCH = /commanding.presence/i;

/** Whether this item is the Commanding Presence combat tactic. */
export function isCommandingPresence(item) {
	if (item?.type !== 'feature') return false;
	return (
		COMMANDING_PRESENCE_MATCH.test(String(item.system?.identifier ?? '')) ||
		COMMANDING_PRESENCE_MATCH.test(String(item.name ?? ''))
	);
}
const COMBAT_DICE_ADVANTAGE_MATCH = /master\s*at\s*arms|relentless\s*assault/i;

/**
 * Subclass features whose text changes the size of the Combat Dice pool.
 *
 * These are carried as `modifyPool` rules in the content itself — this table is
 * the repair for the copies that predate them. An item on a character sheet is a
 * snapshot of the compendium as it was the day it was granted and is never
 * updated afterwards, so a Commander who took *Seasoned Combatant* before the
 * rule existed would keep a feature that does nothing for the rest of the
 * campaign. Every entry is skipped when the item already carries a Combat Dice
 * `modifyPool` of its own, so the content always wins and nothing ever doubles.
 *
 * `deltas` is `[maxDelta, minimumLevel]`; a null level means it always applies.
 */
const COMBAT_DICE_POOL_BONUSES = [
	{ id: 'nimPlusSeasonedCombatant', match: /seasoned\s*combatant/i, deltas: [['+1', null]] },
	{ id: 'nimPlusRelentlessAssault', match: /relentless\s*assault/i, deltas: [['+2', null]] },
	{
		id: 'nimPlusSingleMindedFighter',
		match: /single.?minded\s*fighter/i,
		// The two Orders chosen at level 2, then one more at each level an Order
		// would have been chosen.
		deltas: [
			['+2', null],
			['+1', 6],
			['+1', 8],
			['+1', 10],
			['+1', 12],
			['+1', 16],
		],
	},
];

export function ensureCombatDicePoolBonus(item) {
	const bonus = COMBAT_DICE_POOL_BONUSES.find(
		(entry) =>
			entry.match.test(String(item.name ?? '')) ||
			entry.match.test(String(item.system?.identifier ?? '')),
	);
	if (!bonus) return;

	// The content's own rule, if this copy is new enough to have it.
	const alreadyModifies = hasActiveRule(
		item,
		(rule) =>
			rule.type === 'modifyPool' &&
			rule.poolType === 'charge' &&
			String(rule.poolIdentifier ?? '')
				.toLowerCase()
				.includes(COMBAT_DICE_IDENTIFIER),
	);
	if (alreadyModifies) return;

	bonus.deltas.forEach(([maxDelta, minLevel], index) => {
		addSyntheticRule(item, {
			id: `${bonus.id}-${index}`,
			type: 'modifyPool',
			identifier: '',
			label: `${item.name} → ${maxDelta} max Combat Dice`,
			predicate: minLevel === null ? {} : { level: { min: minLevel } },
			priority: index + 1,
			poolType: 'charge',
			poolIdentifier: COMBAT_DICE_IDENTIFIER,
			dieSize: null,
			maxDelta,
		});
	});
}

/**
 * The Commander's Combat Dice pool, read from charge-pool flag state.
 *
 * Matched on a fuzzy identifier or label — the rule ships as `combat-dice` today
 * but a homebrew copy or a rename should still resolve — and only accepted when
 * it carries a `dieSize`, which is what marks a charge pool as the roll-on-spend
 * kind rather than a plain counter. Returns null for anyone who has not reached
 * level 4.
 */
export function findCombatDicePool(actor) {
	if (!actor) return null;

	for (const entry of iterateChargePools(actor)) {
		const identifier = String(entry.pool.identifier ?? entry.key).toLowerCase();
		const label = String(entry.pool.label ?? '').toLowerCase();
		if (!identifier.includes(COMBAT_DICE_IDENTIFIER) && !label.includes('combat dice')) continue;
		if (!entry.pool.dieSize) continue;

		const max = Math.max(0, Math.floor(Number(entry.pool.max) || 0));
		return {
			...entry,
			dieSize: String(entry.pool.dieSize),
			max,
			current: Math.max(0, Math.min(Math.floor(Number(entry.pool.current) || 0), max)),
			label: String(entry.pool.label ?? 'Combat Dice'),
		};
	}

	return null;
}

/**
 * Expend one die. The roll itself is not made here — a tactic's die is rolled
 * into the attack's own damage roll, and Commanding Presence never rolls one at
 * all — so this is purely the count.
 */
export async function spendCombatDie(actor, pool) {
	if (!pool || pool.current < 1) return null;

	const remaining = pool.current - 1;
	await setChargePoolCurrent(pool, remaining);

	Hooks.callAll(sysHook('chargePool.changed'), {
		actor,
		poolId: pool.key,
		poolLabel: pool.label,
		previousValue: pool.current,
		newValue: remaining,
		maxValue: pool.max,
		reason: 'consume',
		trigger: 'manual',
	});

	return { remaining };
}

/**
 * "You roll Combat Dice with advantage" — Champion of the Pit's *Master at Arms*
 * and Champion of the Siege Breaker's *Relentless Assault* today.
 *
 * Read from a module flag on the feature rather than from its name, so a
 * subclass added later only has to set `flags.<module>.combatDiceAdvantage` to
 * be picked up, with no change here. Advantage on a die roll is "roll two, keep
 * the higher", which is `2dN kh1`.
 */
export function combatDiceAdvantage(actor) {
	for (const item of actor?.items ?? []) {
		if (item.getFlag?.(MODULE_ID, 'combatDiceAdvantage') === true) return true;
		// A copy granted before the flag existed carries none, so the feature is
		// also recognised by name — an item on a sheet is a snapshot of the pack
		// as it was the day it was granted, and is never updated afterwards.
		if (COMBAT_DICE_ADVANTAGE_MATCH.test(String(item.name ?? ''))) return true;
	}
	return false;
}

/**
 * The formula for a tactic's Combat Die: one die, multiplied if the tactic
 * doubles it, rolled with advantage where the character has it.
 */
export function combatDieFormula(actor, pool, multiplier) {
	const die = combatDiceAdvantage(actor) ? `2${pool.dieSize}kh1` : `1${pool.dieSize}`;
	return multiplier > 1 ? `${multiplier} * ${die}` : die;
}

/** How a tactic's Combat Die reads in the dialog: `2 × 1d6`, `1d6 (adv)`. */
export function combatDieLabel(actor, pool, multiplier) {
	const die = `1${pool.dieSize}${combatDiceAdvantage(actor) ? ' adv' : ''}`;
	return multiplier > 1 ? `${multiplier} × ${die}` : die;
}

