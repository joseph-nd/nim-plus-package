import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { findFirstDamageNode } from '../../core/damage.mjs';
import { featsEnabled } from '../settings.mjs';
import { resyncFeatsForActor } from '../sheet-section.mjs';
import { actorKeyMod, ELEM_SCHOOLS, ELEM_KEY_ABILITIES } from './helpers.mjs';

// ── Elemental Specialist: +KEY damage to a chosen school's tiered spells ─────

function elementalKeyValue(actor, ability) {
	if (!ability || ability === 'key') return actorKeyMod(actor);
	return Math.floor(Number(actor?.system?.abilities?.[ability]?.mod ?? 0)) || 0;
}

/**
 * If `spell` is a tiered spell of the Elemental Specialist's chosen school,
 * append `+ KEY` to its primary damage formula in-memory and return a restore
 * thunk. Returns null when it doesn't apply.
 */
export function applyElementalSpecialistBonus(spell) {
	if (spell?.type !== 'spell') return null;
	const actor = spell.actor;
	if (!actor || !featsEnabled()) return null;
	const feat = actor.items?.find?.((i) => i.system?.identifier === 'elemental-specialist');
	const chosen = feat?.getFlag?.(MODULE_ID, 'elementalChosen');
	if (!chosen?.school) return null;
	if (spell.system?.school !== chosen.school) return null;
	if (Number(spell.system?.tier ?? 0) < 1) return null; // tiered spells only (no cantrips)

	const key = elementalKeyValue(actor, chosen.ability);
	if (!Number.isFinite(key) || key <= 0) return null;

	const node = findFirstDamageNode(spell.system?.activation?.effects);
	if (!node) return null;
	const original = node.formula;
	node.formula = `${original} + ${key}`;
	return () => {
		node.formula = original;
	};
}

/** Open the school + key picker for Elemental Specialist and store the choice. */
export async function chooseElementalSpecialist(actor, item) {
	const feat = item ?? actor?.items?.find?.((i) => i.system?.identifier === 'elemental-specialist');
	if (!actor || !feat) {
		ui.notifications?.warn(`[${MODULE_ID}] No Elemental Specialist feat on this character.`);
		return null;
	}
	const schoolOpts = ELEM_SCHOOLS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
	const keyOpts = ELEM_KEY_ABILITIES.map(
		([k, l]) => `<option value="${k}"${k === 'key' ? ' selected' : ''}>${l}</option>`,
	).join('');

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `Elemental Specialist — ${actor.name}` },
		content: `
			<form class="nim-plus-elemental">
				<p>Choose <strong>one spell school you know</strong>. Its <em>tiered</em> spells gain bonus damage equal to the selected key stat.</p>
				<div class="form-group"><label>Spell School</label><select name="school">${schoolOpts}</select></div>
				<div class="form-group"><label>Damage Key Stat</label><select name="ability">${keyOpts}</select></div>
			</form>`,
		buttons: [
			{
				action: 'ok',
				label: 'Confirm',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-elemental');
					if (!form) return null;
					return { school: form.elements.school?.value, ability: form.elements.ability?.value };
				},
			},
			{ action: 'cancel', label: 'Later', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice?.school) {
		ui.notifications?.info('Elemental Specialist can be configured later from the Feats panel.');
		return null;
	}

	await feat.setFlag(MODULE_ID, 'elementalChosen', { school: choice.school, ability: choice.ability });
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
	resyncFeatsForActor(actor);

	const schoolLabel = ELEM_SCHOOLS.find((s) => s[0] === choice.school)?.[1] ?? choice.school;
	const keyLabel = ELEM_KEY_ABILITIES.find((a) => a[0] === choice.ability)?.[1] ?? choice.ability;
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Elemental Specialist</strong>`,
		content: `<p>${escape(actor.name)} specializes in the <strong>${escape(schoolLabel)}</strong> school — its tiered spells now deal <strong>+${escape(keyLabel)}</strong> damage.</p>`,
	});
}
