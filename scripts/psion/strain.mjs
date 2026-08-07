import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Psion — Strain Dice runtime
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Psion's Strain Dice is a pool of dice (d6 → d8@L5 → d10@L10 → d12@L17)
 * accumulated by using Psionic Abilities. At end of turn the pool is rolled;
 * any die showing a 1 breaks Concentration, deals the sum of all dice as
 * psychic damage to the Psion, and Incapacitates them until next turn.
 *
 * State is stored as an integer flag — `flags['nim-plus-package'].psion.strainDice`.
 */

export const STRAIN_FLAG = 'psion.strainDice';

export function strainGetDieSize(actor) {
	if (!actor) return 6;
	const psion = actor.items?.find?.((i) => i.type === 'class' && i.system?.identifier === 'psion');
	const level = Number(psion?.system?.classLevel ?? 0);
	if (level >= 17) return 12;
	if (level >= 10) return 10;
	if (level >= 5) return 8;
	return 6;
}

export async function strainGain(actor, n = 1) {
	if (!actor) return 0;
	const count = Math.max(0, Math.floor(Number(n) || 0));
	if (count === 0) return Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const current = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const next = current + count;
	const size = strainGetDieSize(actor);
	await actor.setFlag(MODULE_ID, STRAIN_FLAG, next);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain +${count}</strong>`,
		content: `<p>${escape(actor.name)}: <strong>${next}</strong> Strain Die${next === 1 ? '' : 's'} (d${size}).</p>`,
	});
	return next;
}

export async function strainLose(actor, n = 1) {
	if (!actor) return 0;
	const count = Math.max(0, Math.floor(Number(n) || 0));
	const current = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	if (current === 0 || count === 0) return current;
	const next = Math.max(0, current - count);
	const size = strainGetDieSize(actor);
	await actor.setFlag(MODULE_ID, STRAIN_FLAG, next);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain −${current - next}</strong>`,
		content: `<p>${escape(actor.name)}: <strong>${next}</strong> Strain Die${next === 1 ? '' : 's'} (d${size}).</p>`,
	});
	return next;
}

export async function strainClear(actor) {
	if (!actor) return;
	if (actor.getFlag(MODULE_ID, STRAIN_FLAG) === undefined) return;
	await actor.unsetFlag(MODULE_ID, STRAIN_FLAG);
}

/**
 * Post the actor's current Strain Dice pool to chat. Useful as a console
 * helper for players to check their count at any time:
 *     nimPlus.strain.show(actor)
 */
export function strainShow(actor) {
	if (!actor) return null;
	const count = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const size = strainGetDieSize(actor);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain</strong>`,
		content: `<p>${escape(actor.name)}: <strong>${count}</strong> Strain Die${count === 1 ? '' : 's'} (d${size}).</p>`,
	});
	return { count, size };
}

/**
 * Roll all active Strain Dice. Returns `{ rolled, broken }` where `rolled` is
 * an array of integers and `broken` is true iff any die rolled a 1.
 *
 * Side effects: posts a chat card with the roll, and if any die rolls a 1
 * AND the Psion does NOT own `new-core-ability` (or rolled more than one 1),
 * toggles off the Concentration status — which fires the deleteActiveEffect
 * handler below to apply the break consequences.
 */
export async function strainRoll(actor) {
	if (!actor) return { rolled: [], broken: false };
	const count = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	if (count === 0) return { rolled: [], broken: false };

	const size = strainGetDieSize(actor);
	const formula = `${count}d${size}`;
	const roll = await new Roll(formula).evaluate();
	const rolled = roll.dice[0]?.results?.map((r) => r.result) ?? [];
	const onesCount = rolled.filter((v) => v === 1).length;

	const hasNewCore = actor.items?.some?.((i) => i.system?.identifier === 'new-core-ability');
	// New Core Ability ignores exactly 1 die rolled a 1. With one 1 it absorbs
	// the break; with two or more, one is ignored and the rest still break.
	const broken = hasNewCore ? onesCount > 1 : onesCount >= 1;

	const display = rolled
		.map((v) => (v === 1 ? `<strong style="color:#a32;">${v}</strong>` : String(v)))
		.join(', ');

	await roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain Roll</strong> — ${count}d${size}${hasNewCore && onesCount === 1 ? ' · <em>New Core Ability absorbs the 1</em>' : ''}`,
		content: `<p>Results: ${display}. Sum: <strong>${roll.total}</strong>.</p>`,
	});

	if (broken && actor.statuses?.has('concentration')) {
		// Stash the already-rolled dice so the deleteActiveEffect handler can
		// re-use them as the psychic-damage roll — per PDF, the break and the
		// damage come from the *same* roll, not two separate rolls.
		await actor.setFlag(MODULE_ID, 'psion.strainBreakInflight', {
			rolled,
			sum: roll.total,
		});
		await actor.toggleStatusEffect('concentration', { active: false });
	}

	return { rolled, broken };
}

export function actorIsPsion(actor) {
	return !!actor?.items?.some?.((i) => i.type === 'class' && i.system?.identifier === 'psion');
}
