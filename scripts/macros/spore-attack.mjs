import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';

/**
 * Sporesphere (Stormshifter / Circle of Spores) — pop a dialog letting the
 * player pick a Sporesphere damage formula and (optionally) Decay-fueled
 * upgrades, then run the standard activation flow with the chosen formula.
 *
 * Damage / reach scale automatically with owned features:
 *   - Sporulation (L15)        2d8 / Reach 6
 *   - Mycelium Growth (L11)    1d8 / Reach 4
 *   - Germination (L7)         1d6 / Reach 3
 *   - Sporesphere (L3, base)   1d4 / Reach 2
 *
 * With Decay (L7), the player may spend Beastshift charges to either bump
 * the die size by one step (d4→d6→d8→d10→d12→d20) or stack Blinded /
 * Poisoned conditions on top of the always-applied Dazed.
 *
 * Resource consumption (Beastshift charges) is the player's responsibility
 * — the macro records the spend in the chat card flavor only.
 *
 * Optional conditions (Blinded / Poisoned) are stashed on an actor flag and
 * re-applied by the `nimble.useItem` hook below if the activation lands
 * (i.e. is not a miss).
 */
export async function sporeAttack(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] sporeAttack: missing actor or item.`);
		return null;
	}

	const has = (id) => actor.items?.some((i) => i.system?.identifier === id);
	const hasGermination = has('germination');
	const hasMycelium = has('mycelium-growth');
	const hasSporulation = has('sporulation');
	const hasDecay = has('decay');

	const dieSizes = [4, 6, 8, 10, 12, 20];
	let baseDieCount = 1;
	let baseDieSize = 4;
	let reach = 2;
	let stage = 'Sporesphere (base)';
	if (hasSporulation) {
		baseDieCount = 2;
		baseDieSize = 8;
		reach = 6;
		stage = 'Sporulation';
	} else if (hasMycelium) {
		baseDieCount = 1;
		baseDieSize = 8;
		reach = 4;
		stage = 'Mycelium Growth';
	} else if (hasGermination) {
		baseDieCount = 1;
		baseDieSize = 6;
		reach = 3;
		stage = 'Germination';
	}

	let dialogContent = `<form class="nim-plus-spore-dialog">
		<p><strong>${escape(stage)}</strong> — base damage <code>${baseDieCount}d${baseDieSize}</code> necrotic, Reach ${reach}. Target is Dazed on hit.</p>`;

	if (hasDecay) {
		dialogContent += `
		<hr>
		<p><strong>Decay (L7).</strong> Spend Beastshift charges. Each charge bumps the die size or applies a condition:</p>
		<div class="form-group"><label>Die-size bumps</label><input type="number" name="dieBumps" value="0" min="0" max="${dieSizes.length - 1}" /></div>
		<div class="form-group"><label><input type="checkbox" name="blinded"> Apply <strong>Blinded</strong> (1 charge)</label></div>
		<div class="form-group"><label><input type="checkbox" name="poisoned"> Apply <strong>Poisoned</strong> (1 charge)</label></div>
		<p style="opacity:0.75;font-size:0.85em;">Beastshift consumption is tracked manually — the chat card will note the spend.</p>`;
	}

	dialogContent += `</form>`;

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Cast Sporesphere` },
		content: dialogContent,
		buttons: [
			{
				action: 'cast',
				label: 'Cast',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-spore-dialog');
					if (!form) return { cast: true };
					const dieBumps = Number(form.elements.dieBumps?.value ?? 0) || 0;
					const blinded = !!form.elements.blinded?.checked;
					const poisoned = !!form.elements.poisoned?.checked;
					return { cast: true, dieBumps, blinded, poisoned };
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice?.cast) return null;

	const dieBumps = Math.max(0, Math.min(choice.dieBumps ?? 0, dieSizes.length - 1));
	let dieSize = baseDieSize;
	if (dieBumps > 0) {
		const baseIndex = dieSizes.indexOf(baseDieSize);
		const newIndex = Math.min(baseIndex + dieBumps, dieSizes.length - 1);
		dieSize = dieSizes[newIndex];
	}

	const finalFormula = `${baseDieCount}d${dieSize}`;
	const charges = dieBumps + (choice.blinded ? 1 : 0) + (choice.poisoned ? 1 : 0);

	const pendingConditions = [];
	if (choice.blinded) pendingConditions.push('blinded');
	if (choice.poisoned) pendingConditions.push('poisoned');

	if (pendingConditions.length > 0) {
		await actor.setFlag(MODULE_ID, 'sporePendingConditions', pendingConditions);
	} else {
		// Clear stale state from a prior cast.
		if (actor.getFlag(MODULE_ID, 'sporePendingConditions') !== undefined) {
			await actor.unsetFlag(MODULE_ID, 'sporePendingConditions');
		}
	}

	if (charges > 0) {
		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>${escape(item.name)}</strong> — ${escape(stage)} (Decay)`,
			content: `<p>${escape(actor.name)} expends <strong>${charges}</strong> Beastshift charge${charges === 1 ? '' : 's'} on Sporesphere — final damage <code>${escape(finalFormula)}</code>${pendingConditions.length > 0 ? `, +${pendingConditions.map((c) => c[0].toUpperCase() + c.slice(1)).join(', ')} on hit` : ''}.</p>`,
		});
	}

	return item.activate({ executeMacro: false, fastForward: true, rollFormula: finalFormula });
}

/**
 * After Sporesphere lands (any non-miss outcome), apply any optional
 * conditions the player picked in the dialog (Blinded / Poisoned). Dazed is
 * handled by the activation rules on the item itself.
 */
Hooks.on('nimble.useItem', (item, _chatCard, context) => {
	if (!item || item.type !== 'feature') return;
	if (item.system?.identifier !== 'sporesphere') return;
	const actor = item.actor;
	if (!actor) return;

	const pending = actor.getFlag?.(MODULE_ID, 'sporePendingConditions');
	if (!Array.isArray(pending) || pending.length === 0) return;

	// Clear the flag immediately — it's a one-shot per cast regardless of outcome.
	actor.unsetFlag(MODULE_ID, 'sporePendingConditions').catch(() => {});

	if (context?.isMiss) return;

	const targets = Array.from(context?.targets ?? []);
	if (targets.length === 0) return;

	for (const target of targets) {
		const targetActor = target?.actor;
		if (!targetActor) continue;
		for (const conditionId of pending) {
			if (targetActor.statuses?.has(conditionId)) continue;
			Promise.resolve(
				targetActor.toggleStatusEffect(conditionId, { active: true }),
			).catch((error) => {
				console.error(
					`[${MODULE_ID}] Failed to apply ${conditionId} to ${targetActor.name}`,
					error,
				);
			});
		}
	}
});

