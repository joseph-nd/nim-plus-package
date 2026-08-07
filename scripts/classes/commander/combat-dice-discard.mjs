import { MODULE_ID } from '../../core/constants.mjs';
import { itemRuleValues } from '../../core/rules.mjs';
import { COMBAT_DICE_IDENTIFIER } from './combat-dice.mjs';

/**
 * "Combat Dice are lost when combat ends."
 *
 * The shipped pool refreshes itself `onInitiativeRolled` and declares nothing for
 * the other end of the fight, so unspent dice survive the encounter and carry
 * into the next one. The charge subsystem dispatches an `encounterEnd` trigger
 * already — there is simply no recovery entry listening for it — so one entry
 * added in memory is the whole fix, and the day the content declares its own we
 * stop adding ours.
 *
 * `recoveries` is replaced rather than pushed to, so the rule's own source array
 * is never mutated: this lives on the prepared instance and evaporates when the
 * module is turned off, at which point the system's next sync pass rewrites the
 * persisted pool state from the rules and the entry disappears with it.
 */
export function ensureCombatDiceDiscard(item) {
	for (const rule of itemRuleValues(item)) {
		if (rule?.type !== 'chargePool' || rule.disabled) continue;

		const identifier = String(rule.identifier || rule.id || '').toLowerCase();
		if (!identifier.includes(COMBAT_DICE_IDENTIFIER)) continue;

		const recoveries = Array.isArray(rule.recoveries) ? rule.recoveries : [];
		if (recoveries.some((entry) => entry?.trigger === 'encounterEnd')) continue;

		try {
			rule.recoveries = [...recoveries, { trigger: 'encounterEnd', mode: 'set', value: '0' }];
		} catch (error) {
			// A field the data model exposes read-only. Nothing else in the section
			// depends on this, so the dice simply keep their old behaviour.
			console.error(`[${MODULE_ID}] Could not add the Combat Dice encounter-end reset`, error);
		}
	}
}
