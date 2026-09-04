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
const PSION_FIELD_REGION_FLAG = 'psionicFieldRegionId';
/** Pre-v14 flag: the id of the MeasuredTemplate the aura used to draw. */
const PSION_FIELD_LEGACY_TEMPLATE_FLAG = 'psionicFieldTemplateId';
const PSION_FIELD_REACH = 3;
const PSION_FIELD_COLOR = '#39d6c8';
const PSION_AURA_LIGHT = {
	dim: 3,
	bright: 0,
	color: PSION_FIELD_COLOR,
	alpha: 0.35,
	luminosity: 0.5,
	angle: 360,
	// No animation — animated lights run shader passes per frame on the
	// canvas, which hits Firefox especially hard. The dim radius + color +
	// Region boundary already convey the aura.
	animation: { type: 'none', speed: 1, intensity: 1, reverse: false },
};

/**
 * The token's centre, in scene pixels. `changes` is the update payload when
 * called from an `updateToken` hook: on Foundry v14 a token's document
 * coordinates trail its movement animation, so inside the hook `doc.x`/`doc.y`
 * still hold the origin and only the payload knows the destination.
 */
function getTokenCenter(doc, changes = {}) {
	const scene = doc.parent;
	const gridSize = scene?.grid?.size ?? 100;
	const x = typeof changes.x === 'number' ? changes.x : doc.x;
	const y = typeof changes.y === 'number' ? changes.y : doc.y;
	return {
		x: x + (doc.width * gridSize) / 2,
		y: y + (doc.height * gridSize) / 2,
	};
}

/**
 * The Region shape for the field: a grid-conformed circle of Reach squares
 * around the token's centre. Foundry v14 folded MeasuredTemplate into Region
 * (the template document is deprecated until v16), and Region shapes measure
 * in pixels, so the radius scales by the scene grid size — the same convention
 * the system's own AoE placement uses.
 */
function psionicFieldShape(doc, changes = {}) {
	const gridSize = doc.parent?.grid?.size ?? 100;
	const { x, y } = getTokenCenter(doc, changes);
	return { type: 'circle', x, y, radius: PSION_FIELD_REACH * gridSize, gridBased: true };
}

function getPsionicFieldRegion(doc) {
	const regionId = doc.getFlag(MODULE_ID, PSION_FIELD_REGION_FLAG);
	return regionId ? (doc.parent?.regions?.get?.(regionId) ?? null) : null;
}

async function createPsionicFieldRegion(doc) {
	const scene = doc.parent;
	if (!scene) return;
	if (getPsionicFieldRegion(doc)) return; // already there
	const [region] = await scene.createEmbeddedDocuments('Region', [
		{
			name: 'Psionic Field',
			shapes: [psionicFieldShape(doc)],
			color: PSION_FIELD_COLOR,
			visibility: CONST.REGION_VISIBILITY.ALWAYS,
			flags: {
				[MODULE_ID]: {
					psionicField: true,
					ownerTokenId: doc.id,
				},
			},
		},
	]);
	if (region) await doc.setFlag(MODULE_ID, PSION_FIELD_REGION_FLAG, region.id);
}

async function removePsionicFieldRegion(doc) {
	const region = getPsionicFieldRegion(doc);
	if (region) await region.delete();
	if (doc.getFlag(MODULE_ID, PSION_FIELD_REGION_FLAG) !== undefined) {
		await doc.unsetFlag(MODULE_ID, PSION_FIELD_REGION_FLAG);
	}

	// A field drawn on v13 left a MeasuredTemplate behind; v14 migrates those
	// into Regions under the same id, so the legacy flag still points at it.
	const legacyId = doc.getFlag(MODULE_ID, PSION_FIELD_LEGACY_TEMPLATE_FLAG);
	if (legacyId !== undefined) {
		const legacy = doc.parent?.regions?.get?.(legacyId);
		if (legacy) await legacy.delete();
		await doc.unsetFlag(MODULE_ID, PSION_FIELD_LEGACY_TEMPLATE_FLAG);
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
				await createPsionicFieldRegion(doc);
			} else {
				const prev = doc.getFlag(MODULE_ID, PSION_AURA_FLAG);
				await doc.update({ light: prev ?? { dim: 0, bright: 0, alpha: 0.5, color: null } });
				if (prev !== undefined) await doc.unsetFlag(MODULE_ID, PSION_AURA_FLAG);
				await removePsionicFieldRegion(doc);
			}
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to ${on ? 'apply' : 'remove'} Psionic Field aura`, error);
		}
	}
}

// Gate by userId: createActiveEffect / deleteActiveEffect fire on every
// client, but only the triggering user should mutate the scene (regions,
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

// Follow-the-token: when a token with an active Psionic Field moves, re-centre
// the field's Region on the new token position. Gated by userId so only the
// user who moved the token issues the Region update.
Hooks.on('updateToken', (doc, changes, _options, userId) => {
	if (userId !== game.user.id) return;
	if (!('x' in changes || 'y' in changes)) return;
	const region = getPsionicFieldRegion(doc);
	if (!region) return;
	region.update({ shapes: [psionicFieldShape(doc, changes)] }).catch((error) => {
		console.error(`[${MODULE_ID}] Failed to move Psionic Field region`, error);
	});
});
