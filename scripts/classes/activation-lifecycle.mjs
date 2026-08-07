import { MODULE_ID } from '../core/constants.mjs';
import {
	SNEAK_USED_FLAG,
	announceSneakAttack,
	markSneakUsed,
	setSneakOutcome,
	sneakOutcome,
} from './cheat/sneak-attack.mjs';
import {
	VICIOUS_USED_FLAG,
	announceViciousOutcome,
	markViciousUsed,
	setViciousArm,
	setViciousOutcome,
	viciousEligible,
	viciousOutcome,
} from './cheat/vicious-opportunist.mjs';
import { resolveCombatTacticOutcome } from './commander/tactic-resolution.mjs';
import { setTacticArm, setTacticOutcome, tacticOutcome } from './commander/tactics.mjs';
import { expendJudgment, snapshotJudgment } from './oathsworn/judgment.mjs';
import { patchFeatureRulePreparation, reprepareFeatureRules } from './rule-injection.mjs';
import { activationStack } from './shared/activation.mjs';
import { patchDamageRollForClassQoL } from './shared/damage-roll-patch.mjs';
import { classQoLEnabled } from './shared/settings.mjs';

Hooks.once('setup', () => {
	try {
		patchDamageRollForClassQoL();
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to patch DamageRoll for class automation`, error);
	}

	try {
		// Late only if the system beat us to `init`; the re-prep repairs whatever
		// was built in the meantime and is a no-op when the patch was already in.
		if (patchFeatureRulePreparation()) reprepareFeatureRules();
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to patch feature rule preparation`, error);
	}

	// Weapons are `object` items and do not override `activate`, so patching the
	// object class's prototype gives us a seam that only ever sees weapon/gear
	// use — features and spells keep their untouched inherited implementation.
	const ObjectClass = CONFIG?.NIMBLE?.Item?.documentClasses?.object;
	if (ObjectClass?.prototype?.activate && !ObjectClass.prototype.__nimPlusClassQoLPatched) {
		const originalObjectActivate = ObjectClass.prototype.activate;
		ObjectClass.prototype.activate = async function patchedObjectActivate(options = {}) {
			if (options?.executeMacro || !classQoLEnabled()) {
				return originalObjectActivate.call(this, options);
			}

			const actor = this.actor;
			let judgment = null;
			try {
				judgment = snapshotJudgment(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to read the Judgment Dice`, error);
			}

			setViciousArm(null);
			setViciousOutcome(null);
			setTacticArm(null);
			setTacticOutcome(null);
			activationStack.push({ actor, item: this, vicious: viciousEligible(actor, this) });

			let card = null;
			try {
				card = await originalObjectActivate.call(this, options);
			} finally {
				const finished = activationStack.pop();
				setViciousArm(null);
				setTacticArm(null);
				setSneakOutcome(finished?.sneak ?? null);
				setTacticOutcome(finished?.tactic ?? null);
			}

			// The activation was cancelled (dialog dismissed, charges missing, a
			// `preUseItem` veto): nothing was rolled, so nothing is spent.
			if (!card) {
				setViciousOutcome(null);
				setSneakOutcome(null);
				setTacticOutcome(null);
				return card;
			}

			const outcome = viciousOutcome;
			const sneak = sneakOutcome;
			const tactic = tacticOutcome;
			setViciousOutcome(null);
			setSneakOutcome(null);
			setTacticOutcome(null);
			try {
				if (outcome) {
					announceViciousOutcome(actor, this, outcome);
					if (outcome.kind === 'upgraded') await markViciousUsed(actor);
				}
				// Before Sneak Attack: an Inerrant Strike reroll is what produced the
				// crit that Sneak Attack was then offered on.
				if (tactic) await resolveCombatTacticOutcome(actor, this, tactic);
				if (sneak) {
					announceSneakAttack(actor, sneak);
					await markSneakUsed(actor);
				}
				await expendJudgment(actor, card, judgment);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to resolve class automation for ${this.name}`, error);
			}

			return card;
		};
		ObjectClass.prototype.__nimPlusClassQoLPatched = true;
	}
});

/** Housekeeping: the per-turn markers are meaningless once the combat is gone. */
Hooks.on('deleteCombat', (combat) => {
	for (const combatant of combat?.combatants ?? []) {
		const actor = combatant?.actor;
		if (!actor?.isOwner) continue;
		for (const flag of [VICIOUS_USED_FLAG, SNEAK_USED_FLAG]) {
			if (actor.getFlag?.(MODULE_ID, flag) === undefined) continue;
			actor
				.unsetFlag(MODULE_ID, flag)
				.catch((error) =>
					console.error(`[${MODULE_ID}] Failed to clear the ${flag} marker`, error),
				);
		}
	}
});
