import { MODULE_ID } from '../../core/constants.mjs';
import { getDamageRollClass } from '../../core/system.mjs';
import { applyViciousOpportunist } from '../cheat/vicious-opportunist.mjs';
import { offerSneakAttack } from '../cheat/sneak-attack.mjs';
import { applyCombatTactic, explodeRaisedPrimaryDie } from '../commander/tactic-resolution.mjs';
import { applyDeathBlow } from '../berserker/death-blow.mjs';

/**
 * Raise an evaluated DamageRoll's kept primary die to its maximum face, roll the
 * resulting crit explosion, and restate the roll's outcome.
 *
 * The explosion itself is `explodeRaisedPrimaryDie`, shared with Inerrant
 * Strike — the other feature that pushes a primary die to its maximum after the
 * dice have already been rolled.
 *
 * @returns {{ from: number, to: number }|null} what changed, or null if the roll
 *          was not in a shape this can safely touch.
 */
export async function upgradePrimaryDieToCrit(roll) {
	// Modifier-mode rolls (formulas carrying Nimble's c/cv/v/n tokens) have no
	// single PrimaryDie to raise, and `brutalPrimary` re-points the primary die
	// at whichever die rolled highest. Neither shape occurs on a player's melee
	// weapon today; both are skipped rather than guessed at.
	if (roll.modifierMode || roll.options?.brutalPrimary) return null;
	if (!roll.options?.canCrit) return null;

	const primary = roll.primaryDie;
	const faces = primary?.faces;
	if (!primary || !Number.isFinite(faces) || faces < 2) return null;

	const kept = primary.results?.find((r) => r.active && !r.discarded);
	if (!kept || typeof kept.result !== 'number') return null;
	if (kept.result >= faces) return null; // already a crit — caller handles it
	if (kept.result <= 1) return null; // a miss — Vicious Opportunist needs a hit

	const from = kept.result;
	kept.result = faces;
	kept.exploded = true;

	await explodeRaisedPrimaryDie(roll, primary, faces);

	roll._recalculateTotal();

	// `_recalculateTotal` sums every active result, so the "primary die does not
	// count as damage" adjustment the system applied during evaluation has to be
	// re-applied against the new value.
	if (roll.options?.primaryDieAsDamage === false) {
		roll.excludedPrimaryDieValue = faces;
		roll._total = (roll._total ?? 0) - faces;
	}

	roll.isCritical = true;
	roll.isMiss = false;
	roll.critCount = 1;
	roll.resetFormula();

	return { from, to: faces };
}

/**
 * Wrap `DamageRoll#_evaluate` so an armed Vicious Opportunist can act on the
 * result the instant it exists — before `activate()` reads `isCritical` off the
 * roll, before `nimble.preUseItem` fires, and before the chat card is built. The
 * card, the crit branch of the effect tree, and Dice So Nice therefore all see a
 * single, coherent critical hit.
 */
export function patchDamageRollForClassQoL() {
	const DamageRollClass = getDamageRollClass();
	if (!DamageRollClass || DamageRollClass.prototype.__nimPlusDamageRollPatched) return;

	const originalEvaluate = DamageRollClass.prototype._evaluate;
	DamageRollClass.prototype._evaluate = async function patchedDamageRollEvaluate(options) {
		const result = await originalEvaluate.call(this, options);

		// Order matters: Vicious Opportunist can turn a hit into a crit, an Inerrant
		// Strike reroll can produce one out of a miss, and a crit is what Death Blow
		// and Sneak Attack trigger on.
		try {
			await applyViciousOpportunist(this);
		} catch (error) {
			console.error(`[${MODULE_ID}] Vicious Opportunist could not modify the roll`, error);
		}

		try {
			await applyCombatTactic(this);
		} catch (error) {
			console.error(`[${MODULE_ID}] The Combat Tactic could not modify the roll`, error);
		}

		try {
			await applyDeathBlow(this);
		} catch (error) {
			console.error(`[${MODULE_ID}] Death Blow could not modify the roll`, error);
		}

		try {
			await offerSneakAttack(this);
		} catch (error) {
			console.error(`[${MODULE_ID}] Sneak Attack could not modify the roll`, error);
		}

		return result;
	};
	DamageRollClass.prototype.__nimPlusDamageRollPatched = true;
}

