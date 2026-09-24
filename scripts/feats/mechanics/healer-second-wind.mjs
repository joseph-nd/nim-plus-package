import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { getDialogForm, readField, waitDialog } from '../../core/dialog.mjs';
import { featsEnabled } from '../settings.mjs';
import { actorKeyMod } from './helpers.mjs';
import { allocateAcademic } from './academic.mjs';
import { chooseElementalSpecialist } from './elemental-specialist.mjs';

// ── Healer: targetable KEY-HP heal, once per Safe Rest ───────────────────────

export async function healerHeal(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] healerHeal: missing actor or item.`);
		return null;
	}
	if (item.getFlag(MODULE_ID, 'healerUsed') === true) {
		ui.notifications?.warn(`${item.name} has already been used — available again after a Safe Rest.`);
		return null;
	}

	const key = Math.max(1, actorKeyMod(actor) || 1);
	const targets = Array.from(game.user?.targets ?? []);
	const targetActor = targets[0]?.actor;
	if (!targetActor) {
		ui.notifications?.warn('Target a creature first (set it as your token target), then use Healer.');
		return null;
	}
	if (typeof targetActor.applyHealing !== 'function') {
		ui.notifications?.error(`[${MODULE_ID}] Target cannot receive healing.`);
		return null;
	}

	await targetActor.applyHealing(key);
	await item.setFlag(MODULE_ID, 'healerUsed', true);
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>${escape(actor.name)} touches <strong>${escape(targetActor.name)}</strong>, healing <strong>${key}</strong> HP (KEY). <em>Usable again after a Safe Rest.</em></p>`,
	});
}

// ── Second Wind: spend a Hit Die to heal its result +KEY, once per day ───────

export async function secondWind(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] secondWind: missing actor or item.`);
		return null;
	}
	if (item.getFlag(MODULE_ID, 'secondWindUsed') === true) {
		ui.notifications?.warn(`${item.name} has already been used — available again after a Safe Rest.`);
		return null;
	}

	const pool = actor.system?.attributes?.hitDice ?? {};
	const available = Object.keys(pool)
		.filter((s) => Number(pool[s]?.current ?? 0) > 0)
		.map((s) => Number(s))
		.filter((s) => Number.isFinite(s) && s > 0)
		.sort((a, b) => b - a);

	if (available.length === 0) {
		ui.notifications?.warn('No Hit Dice available to spend on Second Wind.');
		return null;
	}

	let size = available[0];
	if (available.length > 1) {
		const opts = available
			.map((s) => `<option value="${s}">d${s} (${pool[String(s)].current} available)</option>`)
			.join('');
		const picked = await waitDialog({
			window: { title: `${item.name} — Spend a Hit Die` },
			content: `<div class="nim-plus-second-wind"><div class="form-group"><label>Hit Die to spend</label><select name="size">${opts}</select></div></div>`,
			buttons: [
				{
					action: 'ok',
					label: 'Spend',
					default: true,
					callback: (_event, button, dialog) => readField(getDialogForm(button, dialog), 'size') ?? null,
				},
				{ action: 'cancel', label: 'Cancel', callback: () => null },
			],
			rejectClose: false,
			modal: false,
		});
		if (!available.includes(Number(picked))) return null;
		size = Number(picked);
	}

	const current = Number(pool[String(size)]?.current ?? 0);
	if (current <= 0) {
		ui.notifications?.warn(`No d${size} Hit Dice remain.`);
		return null;
	}

	await actor.update({ [`system.attributes.hitDice.${size}.current`]: current - 1 });

	const key = actorKeyMod(actor);
	const formula = key !== 0 ? `1d${size} + ${key}` : `1d${size}`;
	const roll = await new Roll(formula, actor.getRollData()).evaluate();
	const healAmount = Math.max(0, roll.total);
	if (typeof actor.applyHealing === 'function') await actor.applyHealing(healAmount);
	await item.setFlag(MODULE_ID, 'secondWindUsed', true);
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);

	await roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — spent a d${size} Hit Die${key !== 0 ? ` + ${key} KEY` : ''}`,
		content: `<p>${escape(actor.name)} heals <strong>${healAmount}</strong> HP. Remaining d${size} Hit Dice: <strong>${current - 1}</strong>. <em>Available again after a Safe Rest.</em></p>`,
	});
	return roll;
}

// ── Grant-time configuration + per-rest usage reset ─────────────────────────

// When a feat that needs configuration is gained (via the native level-up
// dialog or our sheet picker), prompt for it. Gated by userId so only the
// granting client opens the dialog; guarded by the stored flag so it never
// re-prompts once configured.
Hooks.on('createItem', (item, _options, userId) => {
	if (userId !== game.user?.id) return;
	if (!featsEnabled()) return;
	const actor = item?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	if (item.type !== 'feature') return;
	const identifier = item.system?.identifier;
	if (identifier === 'academic') {
		if (item.getFlag(MODULE_ID, 'academicAllocated') !== true) {
			allocateAcademic(actor, item).catch((error) =>
				console.error(`[${MODULE_ID}] Academic allocation failed`, error),
			);
		}
	} else if (identifier === 'elemental-specialist') {
		if (!item.getFlag(MODULE_ID, 'elementalChosen')) {
			chooseElementalSpecialist(actor, item).catch((error) =>
				console.error(`[${MODULE_ID}] Elemental Specialist setup failed`, error),
			);
		}
	}
});

// Reset once-per-Safe-Rest feat usages (Healer, Second Wind) when the actor
// completes a Safe Rest. Uses the system's `nimble.rest` hook (payload
// `{ actor, restType }`), the same one the Seasoned Journeyman handler listens to.
Hooks.on('nimble.rest', (payload) => {
	if (payload?.restType !== 'safe') return;
	const actor = payload.actor;
	if (!actor) return;
	const resets = [];
	for (const it of actor.items ?? []) {
		if (it.type !== 'feature') continue;
		const id = it.system?.identifier;
		if (id === 'healer' && it.getFlag(MODULE_ID, 'healerUsed')) {
			resets.push(it.setFlag(MODULE_ID, 'healerUsed', false));
		}
		if (id === 'second-wind' && it.getFlag(MODULE_ID, 'secondWindUsed')) {
			resets.push(it.setFlag(MODULE_ID, 'secondWindUsed', false));
		}
	}
	if (resets.length === 0) return;
	Promise.all(resets)
		.then(() => {
			for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
		})
		.catch((error) => console.error(`[${MODULE_ID}] Failed to reset feat usages on Safe Rest`, error));
});
