import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { currentActivation } from '../shared/activation.mjs';
import { appendDamageToRoll } from '../cheat/sneak-attack.mjs';
import {
	findCombatDicePool,
	spendCombatDie,
	combatDieFormula,
	combatDieLabel,
} from './combat-dice.mjs';
import {
	COMBAT_TACTICS,
	INERRANT_STRIKE,
	tacticArm,
	setTacticArm,
	ownsCombatTactic,
	resolveCombatTactic,
	weaponAttackDelivery,
} from './tactics.mjs';

/**
 * Resolve the tactic the player declared in the dialog against the roll that just
 * landed. The Combat Die is rolled here, into the attack's own damage roll, so it
 * shares the card and the Apply Damage button; spending and announcing wait until
 * the activation has actually produced that card.
 */
async function resolveDeclaredTactic(roll, activation, armed) {
	const declared = COMBAT_TACTICS.find((entry) => entry.key === armed.key);
	if (!declared) return null;
	const tactic = resolveCombatTactic(activation.actor, declared);

	// Re-read the pool rather than trusting the dialog's snapshot: the die may
	// have been spent elsewhere while the dialog was open.
	const pool = findCombatDicePool(activation.actor);
	if (!pool || pool.current < 1) return { tactic, spend: false, kind: 'empty' };

	if (tactic.cannotMiss && roll.isMiss === true) {
		roll.isMiss = false;
	}

	// 0.2 Sweeping Strike is an AoE attack, which never crits on the max.
	if (tactic.cannotCrit && roll.isCritical === true) {
		revokeCritical(roll);
	}

	// "When you hit, …" — nothing landed, so nothing is rolled and nothing spent.
	if (tactic.requiresHit && roll.isMiss === true) {
		return { tactic, spend: false, kind: 'miss' };
	}

	let bonus = null;
	if (tactic.dieMultiplier > 0) {
		// "2× a roll of your Combat Die" is one die doubled, not two dice — same
		// average, wider spread, and it is what the tactic says.
		const formula = combatDieFormula(activation.actor, pool, tactic.dieMultiplier);
		bonus = await appendDamageToRoll(roll, formula, tactic.name);
	}

	return {
		tactic,
		spend: true,
		kind: 'applied',
		bonus,
		pool,
		face: bonus?.faces?.[0] ?? null,
		amount: bonus?.total ?? 0,
	};
}

/**
 * Undo a crit the dice rolled on an attack that cannot crit: every explosion
 * result after the kept Primary Die face is dropped from the total. Only the
 * standard explosion chain is unpicked — a `vicious` weapon rolls its extra dice
 * through the system's own chain, which is left untouched rather than guessed at
 * (the rider on the chat card still says the attack cannot crit).
 */
function revokeCritical(roll) {
	if (roll.options?.explosionStyle === 'vicious') return false;
	const primary = roll.primaryDie;
	const results = primary?.results;
	if (!Array.isArray(results)) return false;

	const keptIndex = results.findIndex((result) => result.active && !result.discarded);
	if (keptIndex < 0) return false;
	for (let i = keptIndex + 1; i < results.length; i += 1) {
		if (!results[i].active || results[i].discarded) continue;
		results[i].active = false;
		results[i].discarded = true;
	}
	results[keptIndex].exploded = false;

	roll._recalculateTotal();
	if (roll.options?.primaryDieAsDamage === false) {
		const kept = results[keptIndex].result;
		roll.excludedPrimaryDieValue = kept;
		roll._total = (roll._total ?? 0) - kept;
	}
	roll.isCritical = false;
	roll.critCount = 0;
	roll.resetFormula();
	return true;
}

/** The kept (active, undiscarded) result of a die term. */
function keptDieResult(term) {
	return term?.results?.find((result) => result.active && !result.discarded) ?? null;
}

/**
 * Roll the crit explosion for a primary die that has just been raised to its max
 * face by a feature rather than by the dice.
 *
 * Mirrors what the system does for a natural max: `vicious` weapons delegate to
 * its own two-dice chain, `standard` replays Foundry's `x` modifier by hand
 * (the modifier itself already ran during evaluation), and `none` rolls nothing.
 */
export async function explodeRaisedPrimaryDie(roll, primary, faces) {
	if (roll.options?.explosionStyle === 'none') return;

	if (
		roll.options?.explosionStyle === 'vicious' &&
		typeof roll._evaluateViciousExplosion === 'function'
	) {
		await roll._evaluateViciousExplosion(primary);
		return;
	}

	const MAX_CHAIN = 100;
	let last = faces;
	for (let i = 0; last === faces && i < MAX_CHAIN; i += 1) {
		const explosion = await new Roll(`1d${faces}`).evaluate();
		const value = explosion.dice?.[0]?.results?.[0]?.result ?? explosion.total;
		if (!Number.isFinite(value)) break;
		primary.results.push({ result: value, active: true, exploded: value === faces });
		last = value;
	}
}

/**
 * Reroll every die of a missed attack and raise the new Primary Die by 1 — the
 * whole of Inerrant Strike's mechanical text.
 *
 * The dice are rerolled *in place*, which means the primary die's own khn/kln
 * (advantage) and `x` (explosion) modifiers are re-applied by Foundry rather
 * than reimplemented here. Results are snapshotted first and restored if any
 * term fails to reroll, so a failure leaves the original roll untouched instead
 * of a half-rerolled one.
 *
 * A rerolled primary die can be at most `faces`, and +1 can never take it back
 * down to 1, so the attack always stops being a miss — which is what the tactic
 * is for.
 */
async function rerollAttackForInerrantStrike(roll) {
	const Die = foundry.dice?.terms?.Die;
	const primary = roll.primaryDie;
	const faces = primary?.faces;
	if (!Die || !primary || !Number.isFinite(faces) || faces < 2) return null;

	const dieTerms = roll.terms.filter((term) => term instanceof Die);
	const snapshot = dieTerms.map((term) => foundry.utils.deepClone(term.results));
	const before = keptDieResult(primary)?.result ?? null;

	try {
		for (const term of dieTerms) {
			term.results = [];
			// `evaluate` refuses to run twice; clearing the flag is what lets the
			// term re-roll itself with all of its modifiers intact.
			term._evaluated = false;
			await term.evaluate();
		}
	} catch (error) {
		dieTerms.forEach((term, index) => {
			term.results = snapshot[index];
			term._evaluated = true;
		});
		console.error(`[${MODULE_ID}] Inerrant Strike could not reroll the attack`, error);
		return null;
	}

	const kept = keptDieResult(primary);
	if (!kept) {
		dieTerms.forEach((term, index) => {
			term.results = snapshot[index];
		});
		return null;
	}

	const rerolled = kept.result;
	const raised = Math.min(faces, rerolled + 1);
	const overflow = Math.max(0, rerolled + 1 - faces);
	const raisedIntoMax = rerolled < faces && raised === faces;
	kept.result = raised;
	if (raisedIntoMax) kept.exploded = true;

	if (raisedIntoMax && roll.options?.canCrit) {
		await explodeRaisedPrimaryDie(roll, primary, faces);
	}

	// The +1 can push the die past its own maximum; the system's own
	// `primaryDieModifier` preset carries that excess as a flat term, so this does
	// the same rather than silently dropping it.
	const Terms = foundry.dice?.terms;
	if (overflow > 0 && Terms?.OperatorTerm && Terms?.NumericTerm) {
		const operator = new Terms.OperatorTerm({ operator: '+' });
		operator._evaluated = true;
		const numeric = new Terms.NumericTerm({
			number: overflow,
			options: { flavor: 'Inerrant Strike' },
		});
		numeric._evaluated = true;
		roll.terms.push(operator, numeric);
	}

	roll._recalculateTotal();

	// `_recalculateTotal` sums every active result, so the system's "the primary
	// die does not count as damage" adjustment has to be re-applied against the
	// value that is now on the die.
	if (roll.options?.primaryDieAsDamage === false) {
		roll.excludedPrimaryDieValue = raised;
		roll._total = (roll._total ?? 0) - raised;
	}

	roll.isCritical = roll.options?.canCrit
		? primary.results.some((result) => result.active && !result.discarded && result.result === faces)
		: false;
	roll.critCount = roll.isCritical ? 1 : 0;
	roll.isMiss = roll.options?.canMiss ? (primary.isMiss ?? false) : false;
	roll.resetFormula();

	return { before, rerolled, raised, overflow };
}

/**
 * Offer Inerrant Strike on a miss. Like Sneak Attack this has to be a prompt
 * rather than a dialog control — you do not know the attack missed until it has.
 */
async function offerInerrantStrike(roll, activation) {
	const actor = activation.actor;
	if (!ownsCombatTactic(actor, INERRANT_STRIKE)) return null;
	if (!weaponAttackDelivery(activation.item)) return null;

	// Modifier-mode formulas have no single primary die to reroll, and a Brutal
	// remapping re-points it at whichever die rolled highest. Neither shape can be
	// rerolled coherently, so the tactic is not offered rather than guessed at.
	if (roll.modifierMode || roll.options?.brutalPrimary) return null;
	if (!roll.primaryDie) return null;

	const pool = findCombatDicePool(actor);
	if (!pool || pool.current < 1) return null;

	const confirmed = await foundry.applications.api.DialogV2.confirm({
		window: { title: 'Inerrant Strike' },
		content:
			'<p><strong>Missed.</strong> Expend a Combat Die on <strong>Inerrant Strike</strong>?</p>' +
			`<p>The attack is rerolled, the Primary Die is raised by 1, and <strong>${combatDieLabel(actor, pool, INERRANT_STRIKE.dieMultiplier)}</strong> is added to the damage.</p>` +
			`<p><em>${pool.current} of ${pool.max} Combat Dice left.</em></p>`,
		yes: { label: 'Inerrant Strike', icon: 'fa-solid fa-crosshairs' },
		no: { label: 'Let it miss' },
		modal: true,
		rejectClose: false,
	}).catch(() => false);
	if (!confirmed) return null;

	const reroll = await rerollAttackForInerrantStrike(roll);
	if (!reroll) return null;

	const bonus = await appendDamageToRoll(
		roll,
		combatDieFormula(actor, pool, INERRANT_STRIKE.dieMultiplier),
		INERRANT_STRIKE.name,
	);
	return {
		tactic: INERRANT_STRIKE,
		spend: true,
		kind: 'applied',
		bonus,
		pool,
		face: bonus?.faces?.[0] ?? null,
		amount: bonus?.total ?? 0,
		reroll,
	};
}

/**
 * The Combat Tactics half of the DamageRoll patch. Runs after Vicious
 * Opportunist (which can turn a hit into a crit) and before Sneak Attack (which
 * triggers on one), so an Inerrant Strike that rerolls into a crit is offered a
 * Sneak Attack exactly as a natural crit would be.
 */
export async function applyCombatTactic(roll) {
	if (!classQoLEnabled()) return;

	const activation = currentActivation();
	// A damage roll outside a tracked activation — a macro item, a monster — can
	// never be the attack the tactic was declared on, so drop the arm rather than
	// letting it survive to the next weapon swing.
	if (!activation) {
		setTacticArm(null);
		return;
	}
	// One tactic per attack, however many damage rolls the activation produces.
	if (activation.tacticHandled) return;

	const actor = activation.actor;
	if (!actor || actor.type !== 'character') return;

	let outcome = null;

	const armed = tacticArm;
	if (armed && (!armed.itemId || !activation.item?.id || armed.itemId === activation.item.id)) {
		setTacticArm(null);
		outcome = await resolveDeclaredTactic(roll, activation, armed);
	}

	// A declared tactic that never landed — Heavy Strike on a miss — leaves this
	// attack's one Combat Die unspent, so Inerrant Strike can still claim it.
	if (!outcome?.spend && roll?.isMiss === true) {
		outcome = (await offerInerrantStrike(roll, activation)) ?? outcome;
	}

	activation.tacticHandled = true;
	if (outcome) activation.tactic = outcome;
}

/** Spend the die and report what the tactic did, once the card exists. */
export async function resolveCombatTacticOutcome(actor, item, outcome) {
	if (!outcome) return;

	const { tactic } = outcome;
	const speaker = ChatMessage.getSpeaker({ actor });
	const name = escape(item?.name ?? 'the attack');

	if (outcome.kind === 'empty') {
		ChatMessage.create({
			speaker,
			flavor: `<strong>${escape(tactic.name)}</strong>`,
			content: `<p>No Combat Dice left — ${name} resolved without the tactic.</p>`,
		});
		return;
	}

	if (outcome.kind === 'miss') {
		ChatMessage.create({
			speaker,
			flavor: `<strong>${escape(tactic.name)}</strong>`,
			content: `<p>${name} <strong>missed</strong>, and ${escape(tactic.name)} only triggers on a hit — <em>no Combat Die spent</em>.</p>`,
		});
		return;
	}

	let spent = null;
	try {
		spent = await spendCombatDie(actor, outcome.pool);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to spend a Combat Die`, error);
	}

	const parts = [];
	if (outcome.reroll) {
		parts.push(
			`<p>Rerolled the attack: Primary Die <strong>${outcome.reroll.rerolled}</strong> + 1 → <strong>${outcome.reroll.raised}</strong>${
				outcome.reroll.overflow > 0 ? ` (+${outcome.reroll.overflow} carried over)` : ''
			}.</p>`,
		);
	}
	if (outcome.amount > 0) {
		parts.push(
			`<p>Combat Die <strong>${outcome.face ?? outcome.amount}</strong>${
				tactic.dieMultiplier > 1 ? ` doubled` : ''
			} — <strong>+${outcome.amount}</strong> damage.</p>`,
		);
	}
	if (tactic.rider) parts.push(`<p>${tactic.rider}</p>`);

	const remaining = spent?.remaining ?? null;
	parts.push(
		`<p><em>Combat Die spent — ${
			remaining === null
				? 'pool unchanged'
				: remaining > 0
					? `${remaining} of ${outcome.pool.max} left`
					: 'none left'
		}.</em></p>`,
	);

	ChatMessage.create({
		speaker,
		flavor: `<strong>${escape(tactic.name)}</strong>`,
		content: parts.join(''),
	});
}
