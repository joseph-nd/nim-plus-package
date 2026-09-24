import { escape } from '../core/html.mjs';
import { getDialogForm, readField, readNumber, waitDialog } from '../core/dialog.mjs';
import { actorKeyMod } from '../feats/mechanics/helpers.mjs';
import { vol4ConsumeOne } from './runes.mjs';

// ── Vol IV item macros ───────────────────────────────────────────────────────

/** Bloodseeker — sacrifice up to KEY HP to add that much damage to the strike. */
export async function vol4Bloodseeker(actor, item) {
	if (!actor || !item) return null;
	const key = Math.max(1, actorKeyMod(actor) || 1);
	const maxSacrifice = Math.min(key, Math.max(0, Number(actor.system?.attributes?.hp?.value ?? 0) - 1));

	const sacrifice = await waitDialog({
		window: { title: `${item.name} — Blood Price` },
		content: `
			<div class="nim-plus-bloodseeker">
				<p>Sacrifice up to <strong>${maxSacrifice}</strong> HP (KEY ${key}) to add that much damage.</p>
				<div class="form-group"><label>HP to sacrifice</label>
				<input type="number" name="hp" value="0" min="0" max="${maxSacrifice}" step="1"></div>
			</div>`,
		buttons: [
			{
				action: 'ok',
				label: 'Strike',
				default: true,
				callback: (_event, button, dialog) => readNumber(getDialogForm(button, dialog), 'hp', 0),
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	});
	if (typeof sacrifice !== 'number' || !Number.isFinite(sacrifice)) return null;

	const bonus = Math.max(0, Math.min(maxSacrifice, Math.floor(sacrifice)));
	if (bonus > 0 && typeof actor.applyDamage === 'function') await actor.applyDamage(bonus);

	const formula = bonus > 0 ? `1d6 + @strength + ${bonus}` : '1d6 + @strength';
	const roll = await new Roll(formula, actor.getRollData()).evaluate();
	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — Slashing${bonus > 0 ? ` <em>(sacrificed ${bonus} HP)</em>` : ''}`,
	});
}

const ELEMENTAL_WEAPON_TYPES = ['fire', 'lightning', 'cold'];

/** Elemental Weapon — rewrite an owned weapon's damage type; consume the enchantment. */
export async function vol4ElementalWeapon(actor, item) {
	if (!actor || !item) return null;
	const weapons = actor.items.filter(
		(i) => i.type === 'object' && i.system?.objectType === 'weapon',
	);
	if (weapons.length === 0) {
		ui.notifications?.warn('No weapons to enchant.');
		return null;
	}

	const weaponOpts = weapons.map((w) => `<option value="${w.id}">${escape(w.name)}</option>`).join('');
	const choice = await waitDialog({
		window: { title: `${item.name}` },
		content: `
			<div class="nim-plus-elemental-weapon">
				<div class="form-group"><label>Weapon</label><select name="weapon">${weaponOpts}</select></div>
				<div class="form-group"><label>Element</label><select name="element">
					<option value="fire">Fire</option>
					<option value="lightning">Lightning</option>
					<option value="cold">Ice</option>
				</select></div>
			</div>`,
		buttons: [
			{
				action: 'ok',
				label: 'Enchant',
				default: true,
				callback: (_event, button, dialog) => {
					const form = getDialogForm(button, dialog);
					return { weaponId: readField(form, 'weapon'), element: readField(form, 'element') };
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	});
	if (!choice?.weaponId || !ELEMENTAL_WEAPON_TYPES.includes(choice.element)) return null;

	const weapon = actor.items.get(choice.weaponId);
	if (!weapon) return null;
	const effects = foundry.utils.deepClone(weapon._source?.system?.activation?.effects ?? weapon.system?.activation?.effects ?? []);
	let changed = false;
	for (const node of effects) {
		if (node?.type === 'damage') {
			node.damageType = choice.element;
			changed = true;
		}
	}
	if (!changed) {
		ui.notifications?.warn(`${weapon.name} has no damage roll to enchant.`);
		return null;
	}
	await weapon.update({ 'system.activation.effects': effects });
	await vol4ConsumeOne(item);

	const label = choice.element === 'cold' ? 'Ice' : choice.element[0].toUpperCase() + choice.element.slice(1);
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p><strong>${escape(weapon.name)}</strong> now deals <strong>${label}</strong> damage.</p>`,
	});
}

