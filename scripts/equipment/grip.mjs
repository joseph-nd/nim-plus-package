import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { findFirstDamageNode } from '../core/damage.mjs';
import { EQUIP_FLAG, equipmentFlag } from './helpers.mjs';

// ── Grip toggle (api.equipment.toggleGrip) ───────────────────────────────────
//
// A versatile weapon carries `equipment.grip = { twoHanded, oneHanded }` damage
// formulas. Toggling swaps the primary damage-effect formula between them,
// adds/removes the `twoHanded` property, and persists the active grip on a flag.
const GRIP_TWO_HANDED = 'twoHanded';
const GRIP_ONE_HANDED = 'oneHanded';

/**
 * Swap a versatile weapon between its two-handed and one-handed grips.
 * Exposed as `api.equipment.toggleGrip`.
 */
export async function equipmentToggleGrip(item) {
	const flag = equipmentFlag(item);
	const grip = flag?.grip;
	if (!grip || typeof grip.twoHanded !== 'string' || typeof grip.oneHanded !== 'string') {
		ui.notifications?.warn(`${item?.name ?? 'This item'} has no versatile grip to toggle.`);
		return null;
	}

	const currentGrip = flag.activeGrip === GRIP_ONE_HANDED ? GRIP_ONE_HANDED : GRIP_TWO_HANDED;
	const nextGrip = currentGrip === GRIP_TWO_HANDED ? GRIP_ONE_HANDED : GRIP_TWO_HANDED;
	const nextFormula = grip[nextGrip];

	// Swap the primary damage formula. Only retune an actual damage node (robust
	// to a nested effects tree); bail rather than risk retuning a non-damage node.
	const effects = foundry.utils.deepClone(item.system?.activation?.effects ?? []);
	const node = findFirstDamageNode(effects);
	if (!node) {
		ui.notifications?.warn(`${item.name} has no damage effect to retune.`);
		return null;
	}
	node.formula = nextFormula;

	// Maintain the `twoHanded` weapon property in step with the grip.
	let selected = Array.from(item.system?.properties?.selected ?? []);
	if (nextGrip === GRIP_TWO_HANDED) {
		if (!selected.includes('twoHanded')) selected.push('twoHanded');
	} else {
		selected = selected.filter((p) => p !== 'twoHanded');
	}

	await item.update({
		'system.activation.effects': effects,
		'system.properties.selected': selected,
		[`flags.${MODULE_ID}.${EQUIP_FLAG}.activeGrip`]: nextGrip,
	});

	const label = nextGrip === GRIP_TWO_HANDED ? 'two-handed' : 'one-handed';
	const actor = item.actor;
	await ChatMessage.create({
		speaker: actor ? ChatMessage.getSpeaker({ actor }) : undefined,
		flavor: `<strong>${escape(item.name)}</strong> — Grip`,
		content: `<p>${escape(item.name)} is now wielded <strong>${label}</strong> (damage <code>${escape(nextFormula)}</code>).</p>`,
	});
	return nextGrip;
}

