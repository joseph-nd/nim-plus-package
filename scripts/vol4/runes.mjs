import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { vol4ItemFlag } from './dawnmark.mjs';

/** Decrement quantity, deleting the item at 0. */
export async function vol4ConsumeOne(item) {
	const qty = Number(item.system?.quantity ?? 1);
	if (qty > 1) return item.update({ 'system.quantity': qty - 1 });
	return item.delete();
}

/** Rarity → Dverung rune capacity (zine p. 24). */
function vol4RuneCapacity(targetItem) {
	const description = targetItem.system?.description?.public ?? '';
	if (/legendary/i.test(description)) return 3;
	if (/very rare|(?<!very )rare/i.test(description)) return 2;
	return 1;
}

/**
 * Meld a Dverung Rune into an owned item. Weapon runes append a damage node
 * (or on-hit/on-miss rider notes) to the weapon's activation tree; armor
 * runes append a rule (armorClass / speedBonus / grantMovement / maxHpBonus /
 * healingPotionBonus) or a description rider. The rune is consumed and the
 * meld recorded in the target's `vol4Runes` flag for capacity enforcement.
 */
export async function vol4ApplyRune(actor, item) {
	if (!actor || !item) return null;
	const runeSpec = vol4ItemFlag(item, 'vol4Rune');
	if (!runeSpec?.slot) {
		ui.notifications?.error(`[${MODULE_ID}] ${item.name} carries no rune definition.`);
		return null;
	}

	const eligible = actor.items.filter((i) => {
		if (i.type !== 'object') return false;
		if (runeSpec.slot === 'weapon') return i.system?.objectType === 'weapon';
		return i.system?.objectType === 'armor' || i.system?.objectType === 'shield';
	});
	if (eligible.length === 0) {
		ui.notifications?.warn(`No ${runeSpec.slot} to meld ${item.name} into.`);
		return null;
	}

	const rows = eligible
		.map((i) => {
			const used = (i.getFlag(MODULE_ID, 'vol4Runes') ?? []).length;
			const cap = vol4RuneCapacity(i);
			const full = used >= cap ? ' disabled' : '';
			return `<option value="${i.id}"${full}>${escape(i.name)} (${used}/${cap} runes)</option>`;
		})
		.join('');
	const targetId = await foundry.applications.api.DialogV2.wait({
		window: { title: `Meld ${item.name}` },
		content: `
			<form class="nim-plus-rune">
				<p>Melding is permanent and consumes the rune. Capacity: Common/Uncommon 1 &middot; Rare/Very Rare 2 &middot; Legendary 3.</p>
				<div class="form-group"><label>Meld into</label><select name="target">${rows}</select></div>
			</form>`,
		buttons: [
			{
				action: 'ok',
				label: 'Meld',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-rune');
					return form?.elements?.target?.value ?? null;
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);
	if (!targetId) return null;

	const target = actor.items.get(targetId);
	if (!target) return null;
	const used = target.getFlag(MODULE_ID, 'vol4Runes') ?? [];
	if (used.length >= vol4RuneCapacity(target)) {
		ui.notifications?.warn(`${target.name} cannot hold more runes.`);
		return null;
	}

	const payload = runeSpec.payload ?? {};
	const updates = {};
	let detail = '';

	// Damage-type choice (Elemental / Divinity runes)
	let damageType = null;
	if (payload.damage) {
		const choices = payload.damageTypeChoice ?? ['force'];
		damageType = choices[0];
		if (choices.length > 1) {
			const opts = choices
				.map((t) => `<option value="${t}">${t === 'cold' ? 'Ice' : t[0].toUpperCase() + t.slice(1)}</option>`)
				.join('');
			damageType = await foundry.applications.api.DialogV2.wait({
				window: { title: `${item.name} — Damage Type` },
				content: `<form class="nim-plus-rune-type"><div class="form-group"><label>Damage type</label><select name="dtype">${opts}</select></div></form>`,
				buttons: [
					{
						action: 'ok',
						label: 'Choose',
						default: true,
						callback: (_event, button, dialog) => {
							const root = dialog?.element ?? button;
							return root?.querySelector?.('form.nim-plus-rune-type')?.elements?.dtype?.value ?? null;
						},
					},
					{ action: 'cancel', label: 'Cancel', callback: () => null },
				],
				rejectClose: false,
				modal: false,
			}).catch(() => null);
			if (!damageType) return null;
		}
	}

	const effects = foundry.utils.deepClone(
		target._source?.system?.activation?.effects ?? target.system?.activation?.effects ?? [],
	);
	const primary = effects.find((n) => n?.type === 'damage');
	let effectsChanged = false;

	if (payload.damage && damageType) {
		const nid = `rune-${runeSpec.key}-${foundry.utils.randomID(6)}`;
		effects.push({
			id: nid,
			type: 'damage',
			damageType,
			formula: payload.damage,
			parentContext: null,
			parentNode: null,
			canCrit: false,
			canMiss: true,
			on: {
				hit: [
					{ id: `${nid}-hit`, type: 'damageOutcome', outcome: 'fullDamage', parentContext: 'hit', parentNode: nid },
				],
				criticalHit: [],
				miss: [],
			},
		});
		effectsChanged = true;
		detail = `+${payload.damage} ${damageType === 'cold' ? 'Ice' : damageType} damage`;
	}
	if (payload.hitNote && primary) {
		primary.on = primary.on ?? { hit: [], criticalHit: [], miss: [] };
		primary.on.hit = primary.on.hit ?? [];
		primary.on.hit.push({
			id: `rune-${runeSpec.key}-note`,
			type: 'note',
			noteType: 'info',
			text: payload.hitNote,
			parentContext: 'hit',
			parentNode: primary.id,
		});
		effectsChanged = true;
		detail = detail || payload.hitNote;
	}
	if (payload.missNote && primary) {
		primary.on = primary.on ?? { hit: [], criticalHit: [], miss: [] };
		primary.on.miss = primary.on.miss ?? [];
		primary.on.miss.push({
			id: `rune-${runeSpec.key}-missnote`,
			type: 'note',
			noteType: 'warning',
			text: payload.missNote,
			parentContext: 'miss',
			parentNode: primary.id,
		});
		effectsChanged = true;
	}
	if (effectsChanged) updates['system.activation.effects'] = effects;

	if (payload.rule) {
		const rules = foundry.utils.deepClone(target._source?.system?.rules ?? target.system?.rules ?? []);
		rules.push({
			disabled: target.system?.equipped !== true,
			id: `rune${runeSpec.key}${foundry.utils.randomID(4)}`.slice(0, 16),
			identifier: `rune-${runeSpec.key}`,
			label: item.name,
			predicate: {},
			priority: 1,
			...payload.rule,
		});
		updates['system.rules'] = rules;
		detail = detail || `rule: ${payload.rule.type}`;
	}

	const riderText = payload.note ?? (!payload.rule && !payload.damage && !payload.hitNote ? runeSpec.key : null);
	const runeLine = `<p><strong>${escape(item.name)}:</strong> ${escape(payload.note ?? detail ?? 'melded')}</p>`;
	updates['system.description.public'] = `${target.system?.description?.public ?? ''}${runeLine}`;
	if (riderText && !detail) detail = riderText;

	updates[`flags.${MODULE_ID}.vol4Runes`] = [...used, runeSpec.key];

	await target.update(updates);
	await vol4ConsumeOne(item);

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>Melded into <strong>${escape(target.name)}</strong>${detail ? ` — ${escape(detail)}` : ''}. (${used.length + 1}/${vol4RuneCapacity(target)} runes)</p>`,
	});
}

