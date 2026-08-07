import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { EQUIP_FLAG, equipmentFlag } from './helpers.mjs';

/**
 * Decrement an item's brittle counter by one, posting the remaining count. The
 * counter lives at `flags["nim-plus-package"].equipment.brittleRemaining` and
 * is seeded from `equipment.brittle` on first use. At zero the item is
 * destroyed (auto-unequipped) and a destruction message is posted.
 * @returns {Promise<number|null>} the remaining count, or null when inapplicable.
 */
export async function equipmentDecrementBrittle(item) {
	const flag = equipmentFlag(item);
	const max = Number(flag?.brittle);
	if (!flag || !(max > 0)) {
		ui.notifications?.warn(`${item?.name ?? 'Item'} is not a brittle item.`);
		return null;
	}
	const current = Number.isFinite(Number(flag.brittleRemaining)) ? Number(flag.brittleRemaining) : max;
	const remaining = Math.max(0, current - 1);

	const update = { [`flags.${MODULE_ID}.${EQUIP_FLAG}.brittleRemaining`]: remaining };
	if (remaining <= 0) update['system.equipped'] = false;
	await item.update(update);

	const actor = item.actor;
	if (remaining <= 0) {
		await ChatMessage.create({
			speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
			flavor: `<strong>${escape(item.name)}</strong> — Brittle`,
			content: `<p><strong>${escape(item.name)} is destroyed!</strong> It shatters and is unequipped.</p>`,
		});
	} else {
		await ChatMessage.create({
			speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
			flavor: `<strong>${escape(item.name)}</strong> — Brittle`,
			content: `<p>${escape(item.name)} cracks further — <strong>${remaining}</strong> use${remaining === 1 ? '' : 's'} remaining before it shatters.</p>`,
		});
	}
	return remaining;
}

/**
 * Manually spend one brittle use (e.g. on a Defend, which is a manual action in
 * Nimble with no automatable trigger). Exposed as `api.equipment.spendBrittle`.
 */
export async function equipmentSpendBrittle(item) {
	if (!item) return null;
	return equipmentDecrementBrittle(item);
}

/**
 * Reset an item's brittle counter back to full. Exposed as
 * `api.equipment.repairBrittle`. Writes `equipment.brittleRemaining` back up to
 * the item's `equipment.brittle` maximum.
 */
export async function equipmentRepairBrittle(item) {
	const flag = equipmentFlag(item);
	const max = Number(flag?.brittle);
	if (!flag || !(max > 0)) {
		ui.notifications?.warn(`${item?.name ?? 'Item'} is not a brittle item.`);
		return null;
	}
	await item.update({ [`flags.${MODULE_ID}.${EQUIP_FLAG}.brittleRemaining`]: max });
	ui.notifications?.info(`${item.name} repaired — ${max} brittle uses restored.`);
	return max;
}

