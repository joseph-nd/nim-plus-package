import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import {
	STRAIN_FLAG,
	strainClear,
	strainGetDieSize,
	strainLose,
	strainRoll,
} from './strain.mjs';

/**
 * End-of-turn auto-roll for the Psion. Fires on the system-emitted
 * `nimbleCombatTurnEnd` (combat.svelte.ts:692). Only acts when the actor has
 * an active Psionic Field. If they also own `i-can-hold`, sheds 1 Strain Die
 * BEFORE the roll (player-friendly ordering — losing first reduces both the
 * sum and the chance of a 1).
 */
Hooks.on('nimbleCombatTurnEnd', async (combatant) => {
	const actor = combatant?.actor;
	if (!actor) return;
	const has = (id) => actor.items?.some?.((i) => i.system?.identifier === id);
	if (!has('psionic-field')) return;
	if (has('i-can-hold')) await strainLose(actor, 1);
	await strainRoll(actor);
});

/**
 * Concentration-break handler — the system has no `nimble.conditionRemoved`
 * hook, so we listen to Foundry core's `deleteActiveEffect` and filter for
 * concentration on a combatant actor. When concentration ends mid-combat
 * with any Strain Dice on the pool, roll them as psychic damage, Incapacitate
 * the Psion, and fire a downstream hook for subclass reactors.
 *
 * The roll here is separate from `strainRoll` — that one fires every turn
 * and only breaks on a 1; this one fires the consequence regardless of how
 * the break happened (an enemy disrupted the field, the player ended it, the
 * turn-end roller rolled a 1).
 */
Hooks.on('deleteActiveEffect', (effect, _options, userId) => {
	if (userId !== game.user.id) return; // run once per concentration end
	if (!effect?.statuses?.has?.('concentration')) return;
	const actor = effect.parent;
	if (!(actor instanceof Actor)) return;
	if (actor.items?.some?.((i) => i.system?.identifier === 'psionic-field') !== true) return;
	if (!game.combat?.combatants?.some?.((c) => c.actorId === actor.id)) return;

	const strainCount = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const inflight = actor.getFlag(MODULE_ID, 'psion.strainBreakInflight');
	const isInvoluntaryBreak = !!inflight;

	// Always clear strain when Concentration ends — per the PDF, "all Psionic
	// effects cease" when the field drops, so the Strain Dice pool resets
	// regardless of whether the break was voluntary (player toggle) or
	// involuntary (a 1 rolled). Break consequences (psychic damage,
	// Incapacitated, subclass reactor hook) only fire on involuntary breaks.
	(async () => {
		try {
			if (!isInvoluntaryBreak) {
				// Voluntary end of the field — just clear strain silently.
				if (strainCount > 0) await strainClear(actor);
				return;
			}

			const size = strainGetDieSize(actor);
			const rolled =
				inflight && Array.isArray(inflight.rolled) && inflight.rolled.length > 0
					? inflight.rolled
					: null;
			await actor.unsetFlag(MODULE_ID, 'psion.strainBreakInflight');

			let resolvedRolled = rolled;
			let chatRoll = null;
			if (!resolvedRolled) {
				const freshRoll = await new Roll(`${strainCount}d${size}`).evaluate();
				resolvedRolled = freshRoll.dice[0]?.results?.map((r) => r.result) ?? [];
				chatRoll = freshRoll;
			}

			let sum = resolvedRolled.reduce((acc, v) => acc + v, 0);
			const hasMOM2 = actor.items?.some?.((i) => i.system?.identifier === 'mind-over-matter-2');
			let droppedNote = '';
			if (hasMOM2 && resolvedRolled.length > 0) {
				const sorted = [...resolvedRolled].sort((a, b) => b - a);
				const dropped = sorted[0];
				sum = sum - dropped;
				droppedNote = ` · <em>Mind Over Matter (2) ignores highest die (${dropped})</em>`;
			}

			const messagePayload = {
				speaker: ChatMessage.getSpeaker({ actor }),
				flavor: `<strong>Concentration Breaks</strong> — ${strainCount}d${size}${droppedNote}`,
				content: `<p>Results: ${resolvedRolled.join(', ')}. Psychic damage to ${escape(actor.name)}: <strong>${sum}</strong>.</p><p><em>Apply damage and Incapacitate until the start of ${escape(actor.name)}'s next turn.</em></p>`,
			};
			if (chatRoll) {
				await chatRoll.toMessage(messagePayload);
			} else {
				await ChatMessage.create(messagePayload);
			}

			await actor.toggleStatusEffect('incapacitated', { active: true });
			Hooks.callAll('nim-plus-package.concentration-broken', {
				actor,
				strainSum: sum,
				strainCount,
				rolled: resolvedRolled,
			});
			await strainClear(actor);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to resolve concentration break`, error);
		}
	})();
});

/**
 * Subclass reactors — Mind Collapse / Reverberating Mind / Mind Shield / Big
 * Mind. Single listener inspects what the broken Psion owns and posts the
 * appropriate prompts/auto-applications.
 */
Hooks.on('nim-plus-package.concentration-broken', ({ actor, strainSum }) => {
	const has = (id) => actor.items?.some?.((i) => i.system?.identifier === id);

	if (has('mind-collapse')) {
		const hasBig = has('big-mind');
		const hasReverb = has('reverberating-mind');
		const reach = hasBig ? 12 : hasReverb ? 6 : 3;
		const diceToRedirect = hasBig ? 3 : 2;
		const extraTargets = hasBig ? 1 : 0;
		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>Mind Collapse</strong>`,
			content: `<p>Choose up to <strong>${diceToRedirect}</strong> Strain Dice from the break roll. Redirect that damage to an enemy within Reach <strong>${reach}</strong>${extraTargets > 0 ? ` (plus 1 additional enemy)` : ''}. If no enemy is in range, ${escape(actor.name)} takes the full damage as normal.</p>`,
		});
	}

	if (has('mind-shield')) {
		const hasBig = has('big-mind');
		const reach = hasBig ? 12 : 6;
		const wil = Math.max(1, Number(actor.system?.abilities?.will?.mod ?? 1));
		const targets = Array.from(game.user?.targets ?? []);
		const taunted = [];
		for (const t of targets.slice(0, wil)) {
			const target = t?.actor;
			if (!target) continue;
			if (target.statuses?.has?.('taunted')) continue;
			Promise.resolve(target.toggleStatusEffect('taunted', { active: true })).catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply Taunted via Mind Shield`, error);
			});
			taunted.push(target.name);
		}
		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>Mind Shield</strong>`,
			content: `<p>Taunt up to <strong>${wil}</strong> creatures within Reach <strong>${reach}</strong> for 1 round. ${taunted.length > 0 ? `Auto-applied to: <em>${taunted.map(escape).join(', ')}</em>.` : '<em>Select targets first to auto-apply Taunted; otherwise apply manually.</em>'} You may Defend for free while Incapacitated; the first attacker takes <strong>${strainSum}</strong> psychic damage.</p>`,
		});
	}
});

/**
 * End-of-encounter cleanup — wipe any lingering Strain Dice flag when combat
 * ends so the next encounter starts fresh.
 */
Hooks.on('deleteCombat', (combat) => {
	for (const c of combat.combatants ?? []) {
		const actor = c.actor;
		if (actor?.getFlag?.(MODULE_ID, STRAIN_FLAG) !== undefined) {
			strainClear(actor).catch(() => {});
		}
	}
});

