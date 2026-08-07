import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';

/**
 * Show a dialog letting the player pick one of several damage formulas, then
 * roll the chosen formula against the actor's roll data and post a damage
 * chat card.
 *
 * @param {Actor} actor                  The actor rolling.
 * @param {Item}  item                   The item the macro is attached to.
 * @param {Array<{
 *   id: string,
 *   label: string,
 *   formula: string,
 *   damageType?: string,
 *   default?: boolean,
 * }>} options                           Damage variants to choose between.
 *                                       Provide at least one. Mark one as
 *                                       `default: true` to pre-select it.
 * @returns {Promise<ChatMessage|null>}  The posted chat message, or null if
 *                                       the dialog was dismissed.
 */
export async function pickDamage(actor, item, options) {
	if (!actor || !item || !Array.isArray(options) || options.length === 0) {
		ui.notifications?.error(`[${MODULE_ID}] pickDamage: invalid arguments.`);
		return null;
	}

	const defaultOpt = options.find((o) => o.default) ?? options[0];

	const buttonRows = options
		.map((opt) => {
			const dmgTag = opt.damageType ? ` <em>${escape(opt.damageType)}</em>` : '';
			return `<li><strong>${escape(opt.label)}</strong> — <code>${escape(opt.formula)}</code>${dmgTag}</li>`;
		})
		.join('');

	const choiceId = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose Damage` },
		content: `<p>Pick a damage option for <strong>${escape(item.name)}</strong>:</p><ul>${buttonRows}</ul>`,
		buttons: options.map((opt) => ({
			action: opt.id,
			label: opt.label,
			default: opt === defaultOpt,
			callback: () => opt.id,
		})),
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choiceId) return null;

	const selected = options.find((o) => o.id === choiceId);
	if (!selected) return null;

	const rollData = actor.getRollData();
	const roll = await new Roll(selected.formula, rollData).evaluate();

	const flavor =
		`<strong>${escape(item.name)}</strong> — ${escape(selected.label)}` +
		(selected.damageType ? ` <em>(${escape(selected.damageType)})</em>` : '');

	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor,
	});
}

