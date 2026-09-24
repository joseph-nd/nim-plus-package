import { sysId } from '../../core/system.mjs';
import { itemRuleValues, hasActiveRule, addSyntheticRule } from '../../core/rules.mjs';
import { iterateDicePools } from '../../core/pools.mjs';

/* ── Oathsworn — Radiant Judgement ───────────────────────────────────────────
 *
 * "Whenever an enemy attacks you, if you have no Judgment Dice, roll your
 *  Judgment dice (2d6). On your next melee attack this encounter, if you hit,
 *  deal that much additional radiant damage. The dice are expended whether you
 *  hit or miss."
 *
 * The system models the pool: `radiant-judgement.json` carries a `dicePool`
 * rule with an `onAttacked` refill and an `encounterEnd` clear, and the level
 * scaling (d8/d10/d12/d20, +1 die at 14) rides on `modifyPool` rules. What it
 * does not carry is a `diceConsumer`, and without one the activation dialog
 * falls back to treating the dice as manually spendable — it draws them as
 * buttons and asks the player to choose which ones to spend. The feature offers
 * no such choice: on your next melee attack, all of them apply.
 *
 * So we supply the missing consumer in `autoBonus` mode, restricted to melee
 * delivery. The system then adds every face to qualifying melee damage on its
 * own and renders the pool as a read-only summary row, because nothing about it
 * is optional. Two gaps are left for this code to close:
 *
 *   1. `autoBonus` pools deliberately never decrement — the mode exists for
 *      snowballing pools like the Berserker's Fury Dice. Radiant Judgement
 *      expends its dice, so we clear the pool after a swing that actually
 *      carried the bonus (hit or miss, exactly as written).
 *   2. `onAttacked` is driven off `nimble.damageApplied`, which only fires when
 *      the GM applies damage — so being attacked does not roll the dice, and a
 *      miss never rolls them at all. We watch attack cards aimed at an
 *      Oathsworn and emit the same hook the system listens to, re-using its
 *      refill engine rather than reimplementing it, then announce the result.
 */

const JUDGMENT_CONSUMER_RULE_ID = 'nimPlusJudgmentConsumer';

/**
 * Features that change how many Judgment Dice are rolled, or how they are
 * rolled. Radiant Judgement's own level-14 rider ("roll 1 more") ships as a
 * `modifyPool` rule; the two below say the same kind of thing in prose and ship
 * with no rules at all, so we supply or apply them.
 */
export const RELIABLE_JUSTICE_IDENTIFIER = 'reliable-justice';
const AURA_OF_ZEAL_IDENTIFIER = 'aura-of-zeal';

export function poolRefillsOn(pool, trigger) {
	const refills = pool?.refills;
	return Array.isArray(refills) && refills.some((entry) => entry?.trigger === trigger);
}

/**
 * Locate the Oathsworn's Judgment dice pool in flag storage. Identified by a
 * fuzzy identifier match — the system spells it "judgment" in the rule and
 * "Judgement" in the feature name, and either could shift — plus the presence of
 * an `onAttacked` refill, which is what makes it the roll-when-struck pool this
 * automation is allowed to spend on the player's behalf.
 */
export function findJudgmentPool(actor) {
	if (!actor) return null;
	for (const entry of iterateDicePools(actor)) {
		const identifier = String(entry.pool.identifier ?? entry.key).toLowerCase();
		if (!identifier.includes('judg')) continue;
		if (!poolRefillsOn(entry.pool, 'onAttacked')) continue;
		return entry;
	}
	return null;
}

export function judgmentFaces(entry) {
	const faces = entry?.pool?.faces;
	if (!Array.isArray(faces)) return [];
	return faces.filter((face) => Number.isFinite(face) && face > 0);
}

/** Empty the pool, flagged so the system's sync pass leaves the write alone. */
export async function clearJudgmentPool(entry) {
	if (!entry?.document) return;
	const scope = sysId();
	await entry.document.update(
		{ flags: { [scope]: { dicePools: { [entry.key]: { faces: [] } } } } },
		{ [scope]: { skipDicePoolSync: true } },
	);
}

/**
 * The item-level `dicePool` rule behind a roll-when-attacked pool, if this item
 * defines one. Matched on a fuzzy identifier (the system spells it "judgment" in
 * the rule and "Judgement" in the feature name, and either could shift) plus the
 * presence of an `onAttacked` refill, which is what makes it this pool.
 */
function judgmentPoolRule(item) {
	for (const rule of itemRuleValues(item)) {
		if (rule?.type !== 'dicePool' || rule.disabled) continue;
		const identifier = String(rule.identifier || rule.id || '').toLowerCase();
		if (!identifier.includes('judg')) continue;
		if (!poolRefillsOn(rule, 'onAttacked')) continue;
		return rule;
	}
	return null;
}

/**
 * Whether this Judgment pool pays out on ranged attacks too, not melee only.
 * Nimble 0.2 reworded Radiant Judgment to "your next attack", and the Nim+ 0.2
 * copy ships its own `autoBonus` consumer with delivery `any` to say so (Nim+
 * reads that as any *weapon or unarmed* attack — see `isWeaponItem`); the
 * 2.0.3 system copy has no consumer and gets the melee-only synthetic one below.
 * Read off the live rule, so the two rule sets never need to be told apart by
 * name or UUID.
 */
export function judgmentAppliesToAnyAttack(entry) {
	const item = entry?.document;
	if (!item || entry.scope !== 'item') return false;
	const identifier = String(entry.pool?.identifier ?? entry.key).toLowerCase();
	return itemRuleValues(item).some(
		(rule) =>
			rule?.type === 'diceConsumer' &&
			!rule.disabled &&
			rule.mode === 'autoBonus' &&
			String(rule.poolIdentifier ?? '').trim().toLowerCase() === identifier &&
			(rule.bonusOnAttackDelivery ?? 'any') === 'any',
	);
}

/**
 * Nim+ ruling: the Judgment Dice ride on *physical* attacks only — weapon
 * attacks (melee or ranged) and unarmed strikes — never on a spell, and never on
 * a feature or ability that is not a weapon or unarmed attack. This is the one
 * test for "is this Item a weapon attack"; unarmed strikes are not Items at all
 * (the system builds them on the fly) and are recognised by their card instead.
 */
export function isWeaponItem(item) {
	return item?.type === 'object' && item.system?.objectType === 'weapon';
}

/**
 * Every `autoBonus` consumer on the actor that feeds the Judgment pool — the
 * rules whose delivery filter decides whether the system's activation dialog
 * folds the dice into a roll.
 */
export function judgmentAutoBonusConsumers(actor, entry) {
	if (!actor || !entry) return [];
	const identifier = String(entry.pool?.identifier ?? entry.key).trim().toLowerCase();
	const consumers = [];
	for (const item of actor.items ?? []) {
		for (const rule of itemRuleValues(item)) {
			if (rule?.type !== 'diceConsumer' || rule.disabled || rule.mode !== 'autoBonus') continue;
			if (String(rule.poolIdentifier ?? '').trim().toLowerCase() !== identifier) continue;
			consumers.push(rule);
		}
	}
	return consumers;
}

/**
 * Give the Judgment pool the `diceConsumer` the system's content omits: every
 * face, automatically, on melee attacks only. Skipped entirely if some consumer
 * already targets the pool, so a future system-side fix wins over ours.
 */
export function ensureJudgmentConsumer(item) {
	const poolRule = judgmentPoolRule(item);
	if (!poolRule) return;

	const identifier = String(poolRule.identifier || poolRule.id || '').trim();
	if (identifier.length < 1) return;

	const alreadyConsumed = hasActiveRule(
		item,
		(rule) =>
			rule.type === 'diceConsumer' &&
			String(rule.poolIdentifier ?? '').trim().toLowerCase() === identifier.toLowerCase(),
	);
	if (alreadyConsumed) return;

	addSyntheticRule(item, {
		id: JUDGMENT_CONSUMER_RULE_ID,
		type: 'diceConsumer',
		label: 'Radiant Judgement (Nim+)',
		poolIdentifier: identifier,
		poolScope: poolRule.scope ?? 'item',
		mode: 'autoBonus',
		bonusOnAttackDelivery: 'melee',
		cost: '1',
	});
}

/**
 * Oath of Vengeance — **Aura of Zeal**: "Whenever you roll Judgment Dice, roll 1
 * more." Word for word what Radiant Judgement's level-14 rider does, and that one
 * ships as a `modifyPool` rule — so this is the same rule on a different feature.
 * The aura half of Aura of Zeal (Radiant Judgement also triggering when an ally
 * in the aura is attacked) stays a table call.
 */
export function ensureJudgmentPoolModifier(item) {
	if (item?.system?.identifier !== AURA_OF_ZEAL_IDENTIFIER) return;
	if (hasActiveRule(item, (rule) => rule.type === 'modifyPool')) return;

	addSyntheticRule(item, {
		id: 'nimPlusZealJudgmentDice',
		type: 'modifyPool',
		label: 'Aura of Zeal: roll 1 more',
		poolType: 'dice',
		poolIdentifier: 'judgment',
		dieSize: null,
		maxDelta: '+1',
	});
}

