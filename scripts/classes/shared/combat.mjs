/**
 * A stable identity for "the current turn". Used instead of a reset hook so the
 * 1/turn budget re-arms itself the moment the combat tracker moves on — nothing
 * to clear, nothing to miss if a hook is renamed upstream. Returns null outside
 * of a running combat, where there are no turns to budget against.
 */
export function currentTurnKey() {
	const combat = game.combat;
	if (!combat?.started) return null;
	return `${combat.id}:${combat.round}:${combat.turn}`;
}

/**
 * A melee weapon is an equipment `object` of type `weapon` whose activation is
 * not thrown/ranged. Nimble models attack range as
 * `system.activation.targets.attackType` ∈ {'', 'reach', 'range'}, with a
 * `range` entry in `system.properties.selected` as a secondary marker.
 */
export function isMeleeWeapon(item) {
	if (!item || item.type !== 'object') return false;
	if (item.system?.objectType !== 'weapon') return false;
	if (item.system?.activation?.targets?.attackType === 'range') return false;
	const properties = item.system?.properties?.selected;
	if (Array.isArray(properties) && properties.includes('range')) return false;
	return true;
}
