import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';

/**
 * Mirage (2) dispatcher — Adept of Illusions L11. Pop a dialog letting the
 * player pick Disguise (enemy gets Blinded/Taunted/Prone) or Distortion
 * (ally gets Full Cover / Invisible / Fear-source), then apply the chosen
 * status to currently-targeted tokens.
 *
 * Foundry/Nimble status IDs used: blinded, taunted, prone, invisible.
 * "Full Cover" and "Fear-source" don't have native status IDs — they're
 * applied narratively and noted in the chat card.
 */
export async function mirageDispatch(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] mirageDispatch: missing actor or item.`);
		return null;
	}

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose an Effect` },
		content: `
			<form class="nim-plus-mirage-dialog">
				<p>Mirage (2): choose one effect to apply to your selected targets.</p>
				<fieldset>
					<legend><strong>Disguise</strong> (lower-level enemy; same/higher level WIL save)</legend>
					<label><input type="radio" name="effect" value="blinded" checked> Blinded</label>
					<label><input type="radio" name="effect" value="taunted"> Taunted</label>
					<label><input type="radio" name="effect" value="prone"> Prone</label>
				</fieldset>
				<fieldset>
					<legend><strong>Distortion</strong> (willing ally)</legend>
					<label><input type="radio" name="effect" value="cover"> Full Cover</label>
					<label><input type="radio" name="effect" value="invisible"> Invisible</label>
					<label><input type="radio" name="effect" value="fear"> Source of Fear</label>
				</fieldset>
			</form>
		`,
		buttons: [
			{
				action: 'apply',
				label: 'Apply',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-mirage-dialog');
					if (!form) return null;
					const checked = form.querySelector('input[name="effect"]:checked');
					return checked?.value ?? null;
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice) return null;

	const targets = Array.from(game.user?.targets ?? []);
	const statusForEffect = { blinded: 'blinded', taunted: 'taunted', prone: 'prone', invisible: 'invisible' };
	const statusId = statusForEffect[choice];
	const applied = [];

	if (statusId) {
		for (const t of targets) {
			const target = t?.actor;
			if (!target) continue;
			if (target.statuses?.has?.(statusId)) continue;
			Promise.resolve(target.toggleStatusEffect(statusId, { active: true })).catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply ${statusId} via Mirage (2)`, error);
			});
			applied.push(target.name);
		}
	}

	const effectLabels = {
		blinded: 'Disguise — Blinded',
		taunted: 'Disguise — Taunted',
		prone: 'Disguise — Prone',
		cover: 'Distortion — Full Cover',
		invisible: 'Distortion — Invisible',
		fear: 'Distortion — Source of Fear',
	};
	const label = effectLabels[choice] ?? choice;

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — ${escape(label)}`,
		content: `<p>${applied.length > 0 ? `Auto-applied to: <em>${applied.map(escape).join(', ')}</em>.` : '<em>No status applied automatically — target the affected tokens before activating, or apply manually for Full Cover / Source of Fear.</em>'}</p>`,
	});
}

