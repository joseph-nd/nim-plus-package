/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Feats — mechanical automation (the eight feats with non-trivial effects)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Vigilant (+KEY initiative) ships as a declarative `initiativeBonus` rule in
 * its JSON, so it needs no code here. The rest are implemented below:
 *
 *   • Academic            — grant-time dialog distributing 3 skill points.
 *   • Bulwark             — token-aura: +2 Armor to adjacent allies.
 *   • Defensive Duelist   — +2 Armor while wielding a DEX melee weapon, no shield.
 *   • Dual Wielder        — +1 Armor while two weapons are equipped.
 *   • Elemental Specialist— +KEY damage to tiered spells of a chosen school.
 *   • Healer              — targetable KEY-HP heal, once per Safe Rest.
 *   • Second Wind         — spend a Hit Die to heal its result +KEY, once per day.
 *
 * The three Armor feats can't be static `armorClass` rules (the predicate domain
 * has no tag for weapon-wielding state or aura adjacency), so they're computed in
 * the patched character `prepareDerivedData` (see the `setup` hook). Healer /
 * Second Wind are activatable via each feat's `system.macro`. Academic / Elemental
 * Specialist are configured at grant time (and re-configurable from the sheet).
 */

export const NIM_SKILLS = [
	['arcana', 'Arcana'],
	['examination', 'Examination'],
	['finesse', 'Finesse'],
	['influence', 'Influence'],
	['insight', 'Insight'],
	['lore', 'Lore'],
	['might', 'Might'],
	['naturecraft', 'Naturecraft'],
	['perception', 'Perception'],
	['stealth', 'Stealth'],
];

export const ELEM_SCHOOLS = [
	['fire', 'Fire'],
	['ice', 'Ice'],
	['lightning', 'Lightning'],
	['necrotic', 'Necrotic'],
	['radiant', 'Radiant'],
	['wind', 'Wind'],
];

export const ELEM_KEY_ABILITIES = [
	['key', 'Key (highest)'],
	['strength', 'Strength'],
	['dexterity', 'Dexterity'],
	['intelligence', 'Intelligence'],
	['will', 'Will'],
];

// ── Shared helpers ──────────────────────────────────────────────────────────

export function actorOwnsFeat(actor, identifier) {
	return !!actor?.items?.some?.((i) => i.type === 'feature' && i.system?.identifier === identifier);
}

/** The actor's KEY ability modifier (highest of its class key abilities). */
export function actorKeyMod(actor) {
	try {
		return Math.floor(Number(actor?.getRollData?.()?.key ?? 0)) || 0;
	} catch {
		return 0;
	}
}

function equippedWeapons(actor) {
	const items = actor?.items?.contents ?? Array.from(actor?.items ?? []);
	return items.filter(
		(i) => i.type === 'object' && i.system?.objectType === 'weapon' && i.system?.equipped === true,
	);
}

function hasEquippedShield(actor) {
	const items = actor?.items?.contents ?? Array.from(actor?.items ?? []);
	return items.some(
		(i) => i.type === 'object' && i.system?.objectType === 'shield' && i.system?.equipped === true,
	);
}

function weaponIsRanged(weapon) {
	if (weapon.system?.activation?.targets?.attackType === 'range') return true;
	const selected = weapon.system?.properties?.selected;
	return Array.isArray(selected) && selected.includes('range');
}

// A weapon "uses DEX" when any of its damage formulas reference `@dexterity`
// (the token Nimble weapons use, e.g. dagger "1d4 + @dexterity").
function weaponUsesDex(weapon) {
	const effects = weapon.system?.activation?.effects;
	if (!Array.isArray(effects)) return false;
	try {
		return JSON.stringify(effects).includes('@dexterity');
	} catch {
		return false;
	}
}

export function hasDexMeleeWeapon(actor) {
	if (hasEquippedShield(actor)) return false; // feat: no benefit while wielding a shield
	return equippedWeapons(actor).some((w) => !weaponIsRanged(w) && weaponUsesDex(w));
}

export function isDualWielding(actor) {
	return equippedWeapons(actor).length >= 2;
}
