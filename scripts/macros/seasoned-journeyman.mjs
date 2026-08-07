import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';

/**
 * Seasoned Journeyman (Shepherd / Luminary of the Forge, L3) — let the
 * Shepherd pick Weaponsmith or Armorsmith at Safe Rest. The bonus is +WIL,
 * upgraded to +WIL+STR if the actor also owns Master of the Hammer (L11).
 *
 * Persists the choice as an actor flag (`journeymanChoice` and
 * `journeymanBonus`) so the player can reference it during play. The flag is
 * cleared automatically on Safe Rest by the `nimble.rest` hook below.
 */
export async function seasonedJourneyman(actor, item) {
	if (!actor) {
		ui.notifications?.error(`[${MODULE_ID}] seasonedJourneyman: missing actor.`);
		return null;
	}

	const wil = Number(actor.system?.abilities?.will?.mod ?? 0);
	const str = Number(actor.system?.abilities?.strength?.mod ?? 0);
	const hasHammer = actor.items?.some((i) => i.system?.identifier === 'master-of-the-hammer');
	const bonusValue = hasHammer ? wil + str : wil;
	const formulaLabel = hasHammer ? 'WIL + STR' : 'WIL';

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose Bonus` },
		content: `<p>Choose your Safe-Rest specialization:</p><ul><li><strong>Weaponsmith</strong> — your weapon gains <strong>+${bonusValue}</strong> damage (${formulaLabel}) until your next Safe Rest.</li><li><strong>Armorsmith</strong> — your armor gains <strong>+${bonusValue}</strong> defense (${formulaLabel}) until your next Safe Rest.</li></ul>`,
		buttons: [
			{ action: 'weapon', label: 'Weaponsmith', default: true, callback: () => 'weapon' },
			{ action: 'armor', label: 'Armorsmith', callback: () => 'armor' },
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice) return null;

	await actor.setFlag(MODULE_ID, 'journeymanChoice', choice);
	await actor.setFlag(MODULE_ID, 'journeymanBonus', bonusValue);

	const label = choice === 'weapon' ? 'Weaponsmith' : 'Armorsmith';
	const effect = choice === 'weapon' ? `+${bonusValue} damage` : `+${bonusValue} defense`;

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — ${escape(label)}`,
		content: `<p>${escape(actor.name)} chooses <strong>${escape(label)}</strong> (${escape(formulaLabel)} = <strong>${bonusValue}</strong>): <em>${escape(effect)}</em> until next Safe Rest.</p>`,
	});
}

/**
 * Clear Seasoned Journeyman state on Safe Rest. The Shepherd reselects on
 * each Safe Rest, so the flag is wiped here and re-set when they activate
 * the feature again.
 */
Hooks.on('nimble.rest', (payload) => {
	if (payload?.restType !== 'safe') return;
	const actor = payload.actor;
	if (!actor) return;
	if (actor.getFlag?.(MODULE_ID, 'journeymanChoice') === undefined) return;
	Promise.all([
		actor.unsetFlag(MODULE_ID, 'journeymanChoice'),
		actor.unsetFlag(MODULE_ID, 'journeymanBonus'),
	]).catch((error) => {
		console.error(`[${MODULE_ID}] Failed to clear Seasoned Journeyman flags on Safe Rest`, error);
	});
});

