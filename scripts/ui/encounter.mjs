/**
 * True while a fight is on the combat tracker.
 *
 * Deliberately *not* `combat.started`, which is a derived getter meaning
 * `round > 0 && turns.length > 0` — false for an encounter that has its
 * combatants staged but has not had Begin Combat clicked yet. That is still very
 * much a fight from the table's point of view, and gating on `started` made
 * combat-only UI vanish during setup and reappear a click later.
 *
 * A combat with no combatants is somebody having opened the tracker, so it does
 * not count. The other end needs no test: ending an encounter deletes the Combat
 * document outright, so the last one leaving the tracker is the fight ending.
 */
export function encounterActive() {
	for (const combat of game.combats ?? []) {
		if ((combat?.combatants?.size ?? 0) > 0) return true;
	}
	return false;
}

/** Every hook after which `encounterActive()` may have changed its answer. */
export const ENCOUNTER_EDGE_HOOKS = [
	'createCombat',
	'updateCombat',
	'deleteCombat',
	'combatStart',
	'createCombatant',
	'deleteCombatant',
];
