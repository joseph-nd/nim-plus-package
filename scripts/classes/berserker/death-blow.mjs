import { MODULE_ID } from '../../core/constants.mjs';
import { currentActivation } from '../shared/activation.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { appendDamageToRoll } from '../cheat/sneak-attack.mjs';

/* ── Berserker — Death Blow (Nimble 0.2) ─────────────────────────────────────
 *
 * "Whenever you crit, double the damage from your Fury Dice."
 *
 * 2.0.3 spent Fury Dice after the crit for twice their sum; 0.2 spends nothing.
 * Fury Dice are an `autoBonus` pool: the system writes each face into the
 * attack's formula as `+N[Fury Dice]` before the dice are rolled. So on a crit
 * the same faces are read back off the roll and appended once more, landing on
 * the same card under the same Apply Damage button. Reading the roll rather
 * than the pool means only the dice that actually rode this attack count — a
 * ranged swing, which Fury Dice do not boost, adds nothing.
 *
 * Keyed on the 0.2 copy's module flag, so the 2.0.3 feature (a manual spend on
 * the crit card, which the system handles itself) is left alone.
 */

const DEATH_BLOW_MATCH = /^death\s*blow$/i;
const FURY_FLAVOR_MATCH = /fury/i;

function actorDeathBlow(actor) {
	return (
		actor?.items?.find?.(
			(item) =>
				item.type === 'feature' &&
				DEATH_BLOW_MATCH.test(String(item.name ?? '').trim()) &&
				item.getFlag?.(MODULE_ID, 'playtest02') === true,
		) ?? null
	);
}

/** Sum of the Fury Dice faces the system folded into this roll's formula. */
function furyBonusOnRoll(roll) {
	const NumericTerm = foundry.dice?.terms?.NumericTerm;
	const OperatorTerm = foundry.dice?.terms?.OperatorTerm;
	if (!NumericTerm) return 0;

	let sum = 0;
	roll.terms.forEach((term, index) => {
		if (!(term instanceof NumericTerm)) return;
		if (!FURY_FLAVOR_MATCH.test(String(term.options?.flavor ?? ''))) return;
		const previous = roll.terms[index - 1];
		const negative = OperatorTerm && previous instanceof OperatorTerm && previous.operator === '-';
		const value = Number(term.number);
		if (Number.isFinite(value)) sum += negative ? -value : value;
	});
	return Math.max(0, sum);
}

export async function applyDeathBlow(roll) {
	if (!classQoLEnabled()) return;
	if (roll?.isCritical !== true) return;

	const activation = currentActivation();
	// One doubling per activation, however many damage rolls it produces.
	if (!activation || activation.deathBlowHandled) return;

	const actor = activation.actor;
	if (!actor || actor.type !== 'character') return;
	if (!actorDeathBlow(actor)) return;
	activation.deathBlowHandled = true;

	const fury = furyBonusOnRoll(roll);
	if (fury < 1) return;

	await appendDamageToRoll(roll, String(fury), 'Death Blow');
}
