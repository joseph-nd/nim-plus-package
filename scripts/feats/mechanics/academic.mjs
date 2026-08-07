import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { resyncFeatsForActor } from '../sheet-section.mjs';
import { NIM_SKILLS } from './helpers.mjs';

// ── Academic: distribute 3 skill points ─────────────────────────────────────

/**
 * Distribute Academic's 3 skill points. The system's level-up dialog hardcodes
 * "1 point per level" in compiled Svelte that an external module can't safely
 * patch, so we grant the 3 extra points the same way the level-up flow does —
 * by writing `system.skills.<key>.points` directly — through a dedicated dialog
 * shown when the feat is gained (and re-openable from the Feats panel).
 */
export async function allocateAcademic(actor, item) {
	const feat = item ?? actor?.items?.find?.((i) => i.system?.identifier === 'academic');
	if (!actor || !feat) {
		ui.notifications?.warn(`[${MODULE_ID}] No Academic feat on this character.`);
		return null;
	}
	if (feat.getFlag(MODULE_ID, 'academicAllocated') === true) {
		ui.notifications?.info('Academic skill points have already been allocated.');
		return null;
	}

	const options = NIM_SKILLS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
	const selectRow = (n) =>
		`<div class="form-group"><label>Point ${n}</label><select name="s${n}">${options}</select></div>`;

	const picks = await foundry.applications.api.DialogV2.wait({
		window: { title: `Academic — Allocate 3 Skill Points — ${actor.name}` },
		content: `
			<form class="nim-plus-academic">
				<p>Academic grants <strong>3 skill points</strong> to distribute (stack them on one skill or spread them out) plus <strong>3 extra languages</strong> (track those on your sheet notes).</p>
				${selectRow(1)}${selectRow(2)}${selectRow(3)}
			</form>`,
		buttons: [
			{
				action: 'ok',
				label: 'Allocate',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-academic');
					if (!form) return null;
					return [form.elements.s1?.value, form.elements.s2?.value, form.elements.s3?.value];
				},
			},
			{ action: 'cancel', label: 'Later', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!Array.isArray(picks) || picks.some((p) => !p)) {
		ui.notifications?.info('Academic points can be allocated later from the Feats panel.');
		return null;
	}

	const tally = {};
	for (const key of picks) tally[key] = (tally[key] ?? 0) + 1;

	const updates = {};
	for (const [key, n] of Object.entries(tally)) {
		const current = Number(actor.system?.skills?.[key]?.points ?? 0);
		updates[`system.skills.${key}.points`] = current + n;
	}
	await actor.update(updates);
	await feat.setFlag(MODULE_ID, 'academicAllocated', true);
	await feat.setFlag(MODULE_ID, 'academicAllocation', tally);
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
	resyncFeatsForActor(actor);

	const summary = Object.entries(tally)
		.map(([k, n]) => `+${n} ${NIM_SKILLS.find((s) => s[0] === k)?.[1] ?? k}`)
		.join(', ');
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Academic</strong>`,
		content: `<p>${escape(actor.name)} allocates 3 skill points: <strong>${escape(summary)}</strong>. <em>(Also learns 3 extra languages.)</em></p>`,
	});
}
