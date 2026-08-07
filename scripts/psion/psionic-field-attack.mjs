import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { STRAIN_FLAG, strainGain } from './strain.mjs';

/**
 * Psionic Field Attack (Psion, L1) — telekinetic attack with an unheld light
 * weapon or object within the Psion's Psionic Field. Per the PDF, the Psion
 * is proficient with these attacks and they deal +WIL damage on top of the
 * weapon's normal damage. If the Psion has also learned **Psionic Strike**,
 * +1 damage per current Strain Die is added automatically (the per-die rider
 * from Psionic Strike's text).
 *
 * Pops a dialog listing the actor's weapon-objects (any owned Item of type
 * `object`/`weapon` with an activation effect that has a `formula`) plus a
 * free-text "improvised" row for objects you haven't cataloged.
 *
 * Warns (but does not block) if Concentration isn't active — sometimes the
 * GM will run a scene where the field is active but the status hasn't been
 * applied yet.
 *
 * Form-parse uses `button.form.elements` (Foundry's documented DialogV2
 * pattern) rather than nested-form querySelector — DialogV2 wraps `content`
 * in its own form alongside the buttons, so the buttons share that form.
 */
export async function psionicFieldAttack(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] psionicFieldAttack: missing actor or item.`);
		return null;
	}

	if (!actor.statuses?.has?.('concentration')) {
		ui.notifications?.warn(
			`[${MODULE_ID}] Psionic Field isn't active — the +WIL damage assumes Concentration is up.`,
		);
	}

	const wil = Number(actor.system?.abilities?.will?.mod ?? 0);
	const wilLabel = wil >= 0 ? `+${wil}` : String(wil);

	// Psionic Strike rider — +1 dmg per Strain Die when the ability is owned.
	const hasStrike = actor.items?.some?.((i) => i.system?.identifier === 'psionic-strike');
	const strainCount = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const strikeBonus = hasStrike ? strainCount : 0;

	// Collect owned items with a damage-formula effect (objects or weapons).
	const items = actor.items?.contents ?? Array.from(actor.items ?? []);
	const weaponData = [];
	for (const i of items) {
		if (i.type !== 'object' && i.type !== 'weapon') continue;
		const effects = i.system?.activation?.effects;
		if (!Array.isArray(effects)) continue;
		const eff = effects.find((e) => e && e.formula);
		if (!eff) continue;
		weaponData.push({
			name: i.name,
			formula: eff.formula,
			damageType: eff.damageType ?? '',
		});
	}

	const rows = weaponData
		.map((w, idx) => {
			const dmgType = w.damageType ? ` <em style="opacity:0.7;">${escape(w.damageType)}</em>` : '';
			return `<label style="display:block;padding:4px 0;"><input type="radio" name="weapon" value="${idx}"${idx === 0 ? ' checked' : ''}> <strong>${escape(w.name)}</strong> — <code>${escape(w.formula)}</code>${dmgType}</label>`;
		})
		.join('');

	const manualRowChecked = weaponData.length === 0 ? ' checked' : '';

	const strikeNote = hasStrike
		? `<p style="opacity:0.75;font-size:0.9em;"><em>Psionic Strike</em> active — adds <strong>+${strikeBonus}</strong> damage (1 per Strain Die; current pool: ${strainCount}).</p>`
		: '';

	const strikeAdvantageRow = hasStrike
		? `<label style="display:block;padding:4px 0;border-top:1px solid #aaa;margin-top:6px;padding-top:8px;"><input type="checkbox" name="strikeAdvantage"> <strong>Spend 1 Strain → roll with Advantage</strong> <em style="opacity:0.7;font-size:0.85em;">(Psionic Strike — also +1 damage from the new die)</em></label>`
		: '';

	// Note: NO outer <form> — Foundry's DialogV2 wraps the content + buttons
	// in its own form, so `button.form` resolves to that wrapper, and any
	// inner <form> would be flattened by the browser anyway.
	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Field Attack` },
		content: `
			<div class="nim-plus-psion-field-attack">
				<p>Pick an unheld light weapon or object in your field. The roll adds <strong>${wilLabel} WIL</strong> damage.</p>
				${rows}
				<label style="display:block;padding:4px 0;border-top:1px solid #aaa;margin-top:6px;padding-top:8px;"><input type="radio" name="weapon" value="__manual"${manualRowChecked}> <strong>Other / improvised</strong> — formula: <input type="text" name="manualFormula" value="1d4" style="width:120px;"> damage type: <input type="text" name="manualType" value="bludgeoning" style="width:100px;"></label>
				${strikeNote}
				${strikeAdvantageRow}
			</div>
		`,
		buttons: [
			{
				action: 'roll',
				label: 'Roll',
				default: true,
				callback: (_event, button) => {
					const form = button?.form;
					if (!form) return { error: 'no-form' };
					const value = form.elements.weapon?.value;
					if (!value) return { error: 'no-weapon-selected' };
					const strikeAdvantage = !!form.elements.strikeAdvantage?.checked;
					if (value === '__manual') {
						return {
							manual: true,
							formula: form.elements.manualFormula?.value?.trim() || '1d4',
							damageType: form.elements.manualType?.value?.trim() || '',
							strikeAdvantage,
						};
					}
					return { manual: false, idx: Number(value), strikeAdvantage };
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => ({ cancelled: true }) },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice || choice.cancelled) return null;
	if (choice.error) {
		ui.notifications?.error(`[${MODULE_ID}] Field Attack dialog: ${choice.error}.`);
		return null;
	}

	let formula;
	let damageType = '';
	let weaponLabel;
	if (choice.manual) {
		formula = choice.formula;
		damageType = choice.damageType;
		weaponLabel = 'Improvised';
	} else {
		const w = weaponData[choice.idx];
		if (!w) {
			ui.notifications?.error(`[${MODULE_ID}] No weapon at index ${choice.idx}.`);
			return null;
		}
		formula = w.formula;
		damageType = w.damageType;
		weaponLabel = w.name;
	}

	// Psionic Strike's "spend 1 Strain → advantage" rider. Gaining the strain
	// FIRST means the new die is included in the +1/die damage bonus for
	// this attack (player-friendly reading of the PDF's ordering).
	let effectiveStrikeBonus = strikeBonus;
	let rollMode = 0;
	if (choice.strikeAdvantage && hasStrike) {
		await strainGain(actor, 1);
		effectiveStrikeBonus = strikeBonus + 1;
		rollMode = 1;
	}

	const combinedFormula =
		effectiveStrikeBonus > 0
			? `${formula} + @abilities.will.mod + ${effectiveStrikeBonus}`
			: `${formula} + @abilities.will.mod`;

	// Inject a damage effect with the correct damageType into the item's
	// prepared activation data — IN-MEMORY ONLY, not via item.update(). The
	// activation manager (Nimble: ItemActivationManager constructor) does a
	// deepClone of `item.system.activation` at construction time, so this
	// mutation is captured per-cast. Using item.update() here would race
	// with Foundry's data-preparation pipeline and cause the first cast for
	// each new weapon to land with empty / stale effects (no dice rolled).
	// Non-persistent: next sheet render restores the placeholder from
	// _source, but every cast re-injects this anyway.
	const targetDamageType = damageType || 'bludgeoning';
	if (item.system?.activation) {
		item.system.activation.effects = [
			{
				id: 'psionFieldAtkDmg1',
				type: 'damage',
				damageType: targetDamageType,
				formula: '1d4 + @abilities.will.mod',
				parentContext: null,
				parentNode: null,
				on: {
					hit: [
						{
							id: 'psionFieldAtkHit1',
							type: 'damageOutcome',
							outcome: 'fullDamage',
							parentContext: 'hit',
							parentNode: 'psionFieldAtkDmg1',
						},
					],
				},
				canCrit: true,
				canMiss: true,
			},
		];
	}

	// Announce the weapon used in chat before the activation card lands, so
	// every Psionic Field Attack roll is clearly labeled with WHICH weapon
	// (and any modifiers) — the activation card on its own just says the
	// feature name, which doesn't surface the per-cast choice.
	const announcementBits = [`<em>${escape(weaponLabel)}</em>${damageType ? ` (${escape(damageType)})` : ''}`];
	announcementBits.push(`<span style="opacity:0.8;">+ ${wilLabel} WIL</span>`);
	if (effectiveStrikeBonus > 0) {
		announcementBits.push(`<span style="opacity:0.8;">+ ${effectiveStrikeBonus} Psionic Strike</span>`);
	}
	if (rollMode === 1) {
		announcementBits.push(`<span style="opacity:0.8;color:#39d6c8;">Advantage (Strain spent)</span>`);
	}
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>${escape(actor.name)} hurls ${announcementBits.join(' · ')}.</p>`,
	});

	// Hand off to Nimble's activation flow so the player can target a token,
	// the damage roll lands in the standard chat card, and the GM/player can
	// click "Apply Damage" on the card. `executeMacro: false` prevents
	// re-entering this macro; `rollFormula` overrides the feature's
	// placeholder damage with our weapon+WIL+Strike formula; `rollMode: 1`
	// pipes advantage into both the attack roll and the damage roll.
	return item.activate({
		executeMacro: false,
		fastForward: true,
		rollFormula: combinedFormula,
		rollMode,
	});
}

