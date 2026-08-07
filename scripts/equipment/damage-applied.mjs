import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { equippedWithEquipment, isMeleeAttackItem, SPIKED_DIE } from './helpers.mjs';
import { equipmentDecrementBrittle } from './brittle.mjs';

// ── Spiked retaliation + Brittle durability (nimble.damageApplied) ────────────
//
// The system fires `nimble.damageApplied` from ChatMessage.applyDamage, which is
// GM-gated (`if (!game.user?.isGM) return;`) and fires once per applied target.
// But the system has no already-applied guard: a GM re-clicking "Apply Damage"
// re-runs the whole loop and re-fires this hook for every target, which would
// double-fire spiked retaliation and brittle decrements. We remember the
// (card, target) pairs already processed and no-op on repeats. The spiked
// retaliation applies its damage via `sourceActor.applyDamage(...)` directly
// (not through an activation card), so it can never re-enter this hook; the
// melee guard would reject it anyway.
const DAMAGE_APPLIED_SEEN = new Set();
const DAMAGE_APPLIED_SEEN_CAP = 500;

/**
 * Record a (card, target) pair from a `nimble.damageApplied` payload. Returns
 * `false` when the pair was already processed (a re-click), so callers can no-op.
 * The Set is trimmed (oldest-first, insertion-ordered) so it stays bounded.
 */
function markDamageApplied(payload) {
	const cardId = payload?.card?.id;
	const target = payload?.targetActor;
	const targetKey = target?.uuid ?? target?.id;
	if (!cardId || !targetKey) return true; // can't key it — don't block
	const key = `${cardId}::${targetKey}`;
	if (DAMAGE_APPLIED_SEEN.has(key)) return false;
	DAMAGE_APPLIED_SEEN.add(key);
	while (DAMAGE_APPLIED_SEEN.size > DAMAGE_APPLIED_SEEN_CAP) {
		const oldest = DAMAGE_APPLIED_SEEN.values().next().value;
		DAMAGE_APPLIED_SEEN.delete(oldest);
	}
	return true;
}

Hooks.on('nimble.damageApplied', (payload) => {
	if (!markDamageApplied(payload)) return; // already-applied re-click — no-op
	try {
		equipmentSpikedRetaliation(payload);
	} catch (error) {
		console.error(`[${MODULE_ID}] Spiked retaliation failed`, error);
	}
	try {
		equipmentBrittleOnCrit(payload);
	} catch (error) {
		console.error(`[${MODULE_ID}] Brittle durability check failed`, error);
	}
});

/**
 * Spiked: when a melee weapon hits a creature wearing spiked armor/shields, the
 * attacker takes 1d4 piercing per spiked piece (they stack). Retaliation can't
 * crit or miss, so it's applied as flat damage to the attacker.
 */
async function equipmentSpikedRetaliation(payload) {
	if (!payload || payload.isMiss) return;
	const { sourceItem, sourceActor, targetActor } = payload;
	if (!sourceActor || !targetActor) return;
	if (!isMeleeAttackItem(sourceItem)) return;

	const spiked = equippedWithEquipment(targetActor, (flag) => flag.spiked === true);
	if (spiked.length === 0) return;

	const formula = Array.from({ length: spiked.length }, () => SPIKED_DIE).join(' + ');
	const roll = await new Roll(formula).evaluate();
	const total = Math.max(0, Math.floor(Number(roll.total ?? 0)));

	const names = spiked.map((i) => `<strong>${escape(i.name)}</strong>`).join(', ');
	await roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor: targetActor }),
		flavor: `Spikes — ${escape(sourceActor.name)} strikes ${escape(targetActor.name)}'s ${names} and takes <strong>${total}</strong> piercing.`,
	});

	if (total > 0 && typeof sourceActor.applyDamage === 'function') {
		await sourceActor.applyDamage(total);
	}
}

/**
 * Brittle: a critical hit landed on a creature wearing brittle gear degrades
 * each brittle piece by one. Delegates to the shared decrement helper.
 */
async function equipmentBrittleOnCrit(payload) {
	if (!payload || !payload.isCritical) return;
	const { targetActor } = payload;
	if (!targetActor) return;
	const brittle = equippedWithEquipment(targetActor, (flag) => Number(flag.brittle) > 0);
	for (const item of brittle) {
		// Await sequentially so overlapping item.update() calls don't race.
		// eslint-disable-next-line no-await-in-loop
		await equipmentDecrementBrittle(item);
	}
}

