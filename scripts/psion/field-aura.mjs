import { MODULE_ID } from '../core/constants.mjs';

/**
 * Auto-manage Concentration when the player activates a feature whose rules
 * text demands it.
 *
 * - **Psionic Field** (Psion, L1) — toggle. The PDF reads "Concentration, up
 *   to 1 min. Action: Create a field…". Re-activating ends the field, which
 *   is the standard Nimble idiom for self-canceling aura concentrations.
 *
 * The visual aura (token light) is wired separately to the createActiveEffect
 * / deleteActiveEffect hooks below so it works regardless of how
 * Concentration was applied or removed (status button, Strain break, GM).
 */
Hooks.on('nimble.useItem', (item) => {
	if (!item || item.type !== 'feature') return;
	const identifier = item.system?.identifier;
	const actor = item.actor;
	if (!actor) return;

	if (identifier === 'psionic-field') {
		const isOn = actor.statuses?.has?.('concentration');
		Promise.resolve(actor.toggleStatusEffect('concentration', { active: !isOn })).catch(
			(error) => {
				console.error(`[${MODULE_ID}] Failed to toggle Concentration for Psionic Field`, error);
			},
		);
		return;
	}
});

/**
 * Psionic Field aura visualization — when Concentration becomes active on a
 * Psion who owns `psionic-field`, set the actor's tokens to emit a low-alpha
 * teal-cyan dim light at radius 3 (matching the field's Reach). On
 * Concentration removal (re-activation, Strain break, manual toggle, GM),
 * restore the token's prior light config.
 *
 * Light state is stashed on a per-token flag so any prior light source the
 * player had configured (torch, ring of light, etc.) is preserved across the
 * toggle. Falls back to "no light" if nothing was stashed.
 */
const PSION_AURA_FLAG = 'psionicFieldPrevLight';
const PSION_FIELD_TEMPLATE_FLAG = 'psionicFieldTemplateId';
const PSION_FIELD_REACH = 3;
const PSION_AURA_LIGHT = {
	dim: 3,
	bright: 0,
	color: '#39d6c8',
	alpha: 0.35,
	luminosity: 0.5,
	angle: 360,
	// No animation — animated lights run shader passes per frame on the
	// canvas, which hits Firefox especially hard. The dim radius + color +
	// MeasuredTemplate boundary already convey the aura.
	animation: { type: 'none', speed: 1, intensity: 1, reverse: false },
};

function getTokenCenter(doc) {
	const scene = doc.parent;
	const gridSize = scene?.grid?.size ?? 100;
	return {
		x: doc.x + (doc.width * gridSize) / 2,
		y: doc.y + (doc.height * gridSize) / 2,
	};
}

async function createPsionicFieldTemplate(doc) {
	const scene = doc.parent;
	if (!scene) return;
	const existing = doc.getFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	if (existing && scene.templates?.get?.(existing)) return; // already there
	const gridDistance = scene.grid?.distance ?? 5;
	const { x, y } = getTokenCenter(doc);
	const [template] = await scene.createEmbeddedDocuments('MeasuredTemplate', [
		{
			t: 'circle',
			user: game.user.id,
			distance: PSION_FIELD_REACH * gridDistance,
			direction: 0,
			angle: 0,
			width: 0,
			x,
			y,
			fillColor: '#39d6c8',
			borderColor: '#0aa697',
			flags: {
				[MODULE_ID]: {
					psionicField: true,
					ownerTokenId: doc.id,
				},
			},
		},
	]);
	if (template) await doc.setFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG, template.id);
}

async function removePsionicFieldTemplate(doc) {
	const templateId = doc.getFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	if (templateId) {
		const scene = doc.parent;
		const template = scene?.templates?.get?.(templateId);
		if (template) await template.delete();
		await doc.unsetFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	}
}

async function setPsionicFieldAura(actor, on) {
	const tokens = actor.getActiveTokens?.(true) ?? [];
	for (const token of tokens) {
		const doc = token.document ?? token;
		try {
			if (on) {
				if (doc.getFlag(MODULE_ID, PSION_AURA_FLAG) === undefined) {
					const prev = doc.light?.toObject?.() ?? foundry.utils.deepClone(doc.light ?? {});
					await doc.setFlag(MODULE_ID, PSION_AURA_FLAG, prev);
				}
				await doc.update({ light: PSION_AURA_LIGHT });
				await createPsionicFieldTemplate(doc);
			} else {
				const prev = doc.getFlag(MODULE_ID, PSION_AURA_FLAG);
				await doc.update({ light: prev ?? { dim: 0, bright: 0, alpha: 0.5, color: null } });
				if (prev !== undefined) await doc.unsetFlag(MODULE_ID, PSION_AURA_FLAG);
				await removePsionicFieldTemplate(doc);
			}
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to ${on ? 'apply' : 'remove'} Psionic Field aura`, error);
		}
	}
}

// Gate by userId: createActiveEffect / deleteActiveEffect fire on every
// client, but only the triggering user should mutate the scene (templates,
// tokens) to avoid duplicate creates and race-y deletes.
Hooks.on('createActiveEffect', (effect, _options, userId) => {
	if (userId !== game.user.id) return;
	if (!effect?.statuses?.has?.('concentration')) return;
	const actor = effect.parent;
	if (!(actor instanceof Actor)) return;
	if (!actor.items?.some?.((i) => i.system?.identifier === 'psionic-field')) return;
	setPsionicFieldAura(actor, true).catch(() => {});
});

Hooks.on('deleteActiveEffect', (effect, _options, userId) => {
	if (userId !== game.user.id) return;
	if (!effect?.statuses?.has?.('concentration')) return;
	const actor = effect.parent;
	if (!(actor instanceof Actor)) return;
	if (!actor.items?.some?.((i) => i.system?.identifier === 'psionic-field')) return;
	setPsionicFieldAura(actor, false).catch(() => {});
});

// Follow-the-token: when a token with an active Psionic Field template moves,
// re-center the template on the new token position. Gated by userId so only
// the user who moved the token issues the template update.
Hooks.on('updateToken', (doc, changes, _options, userId) => {
	if (userId !== game.user.id) return;
	if (!('x' in changes || 'y' in changes)) return;
	const templateId = doc.getFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	if (!templateId) return;
	const scene = doc.parent;
	const template = scene?.templates?.get?.(templateId);
	if (!template) return;
	const { x, y } = getTokenCenter(doc);
	template.update({ x, y }).catch((error) => {
		console.error(`[${MODULE_ID}] Failed to move Psionic Field template`, error);
	});
});

