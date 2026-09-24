import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { waitDialog } from '../core/dialog.mjs';

/**
 * Seasoned Journeyman (Shepherd / Luminary of the Forge, L3) — let the
 * Shepherd pick Weaponsmith or Armorsmith at Safe Rest.
 *
 * Two rule sets, picked by the feature's own macro call:
 *   - Nim+ original (`seasonedJourneyman(actor, item)`): +WIL, upgraded to
 *     +WIL+STR if the actor also owns Master of the Hammer (L11);
 *   - Nimble 0.2 playtest copy (`seasonedJourneyman(actor, item, '0.2')`):
 *     +STR, upgraded to +STR+WIL by Masterwork (L11), which also lets the
 *     Shepherd "choose twice" — offered as a third button, Both.
 * The rule set comes from the argument rather than from the item's flags: a
 * class migration rewrites `system` (and so the macro) but merges flags.
 *
 * Persists the choice as an actor flag (`journeymanChoice` — 'weapon', 'armor'
 * or 'both' — and `journeymanBonus`) so the player can reference it during
 * play. The flag is cleared automatically on Safe Rest by the `nimble.rest`
 * hook below.
 */
export async function seasonedJourneyman(actor, item, rules = null) {
	if (!actor) {
		ui.notifications?.error(`[${MODULE_ID}] seasonedJourneyman: missing actor.`);
		return null;
	}

	const playtest = rules === '0.2';
	const wil = Number(actor.system?.abilities?.will?.mod ?? 0);
	const str = Number(actor.system?.abilities?.strength?.mod ?? 0);
	const upgrade = playtest ? 'masterwork' : 'master-of-the-hammer';
	const upgraded = actor.items?.some((i) => i.system?.identifier === upgrade);
	const [base, extra, baseLabel, extraLabel] = playtest ? [str, wil, 'STR', 'WIL'] : [wil, str, 'WIL', 'STR'];
	const bonusValue = upgraded ? base + extra : base;
	const formulaLabel = upgraded ? `${baseLabel} + ${extraLabel}` : baseLabel;
	const both = playtest && upgraded;
	const armorWord = playtest ? 'Armor' : 'defense';

	const choice = await waitDialog({
		window: { title: `${item.name} — Choose Bonus` },
		content:
			`<p>Choose your Safe-Rest specialization${both ? ' (Masterwork: you may choose both)' : ''}:</p>` +
			`<ul><li><strong>Weaponsmith</strong> — your weapon${playtest ? 's gain' : ' gains'} <strong>+${bonusValue}</strong> damage (${formulaLabel}) until your next Safe Rest.</li>` +
			`<li><strong>Armorsmith</strong> — your armor gains <strong>+${bonusValue}</strong> ${armorWord} (${formulaLabel}) until your next Safe Rest.</li></ul>`,
		buttons: [
			{ action: 'weapon', label: 'Weaponsmith', default: true, callback: () => 'weapon' },
			{ action: 'armor', label: 'Armorsmith', callback: () => 'armor' },
			...(both ? [{ action: 'both', label: 'Both', callback: () => 'both' }] : []),
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	});

	const allowed = both ? ['weapon', 'armor', 'both'] : ['weapon', 'armor'];
	if (!allowed.includes(choice)) return null;

	await actor.setFlag(MODULE_ID, 'journeymanChoice', choice);
	await actor.setFlag(MODULE_ID, 'journeymanBonus', bonusValue);

	const label = { weapon: 'Weaponsmith', armor: 'Armorsmith', both: 'Weaponsmith + Armorsmith' }[choice] ?? choice;
	const effect = {
		weapon: `+${bonusValue} damage`,
		armor: `+${bonusValue} ${armorWord}`,
		both: `+${bonusValue} damage and +${bonusValue} ${armorWord}`,
	}[choice];

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

