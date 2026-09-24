import { itemRuleValues, addSyntheticRule } from '../../core/rules.mjs';
import { playtestCoreClassesEnabled } from '../../core/playtest-settings.mjs';

/* ── Commander — Champion of the Arena, Single-minded Fighter ────────────────
 *
 * "You forego all Commander's Orders. Whenever you would choose one, you gain
 *  +1 max Combat Die instead."
 *
 * The content carries a `modifyPool` ladder, one step per Order pick. Its first
 * step (+2, for the two Orders) has no level predicate, because Heroes 2.0.3
 * hands those Orders out at level 2 — before the subclass arrives at 3.
 *
 * Nimble 0.2 moves that pick to level 4 ("Commander's Orders. Choose 2
 * Commander's Orders."), so with the playtest rules on a level-3 Arena champion
 * would get the two dice one level early. The step is swapped, in memory only,
 * for the same rule gated on level 4. The later steps (levels 6-16, Fit for Any
 * Battlefield) are the same in both rule sets and are left alone.
 */

const FIRST_STEP_RULE_ID = 'single-minded-max-l2';
const PLAYTEST_LABEL = 'Single-Minded Fighter → +2 max Combat Dice (level 4 Orders, Nimble 0.2)';

export function ensureSingleMindedOrderLevel(item) {
	if (!playtestCoreClassesEnabled()) return;
	const rule = itemRuleValues(item).find((r) => r?.id === FIRST_STEP_RULE_ID);
	if (!rule || rule.disabled || rule.type !== 'modifyPool') return;
	if (rule.label === PLAYTEST_LABEL) return;

	addSyntheticRule(item, {
		id: FIRST_STEP_RULE_ID,
		type: 'modifyPool',
		label: PLAYTEST_LABEL,
		predicate: { level: { min: 4 } },
		priority: rule.priority ?? 1,
		poolType: 'charge',
		poolIdentifier: rule.poolIdentifier || 'combat-dice',
		dieSize: null,
		maxDelta: rule.maxDelta ?? '+2',
	});
}
