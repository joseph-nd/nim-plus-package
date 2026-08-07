import { MODULE_ID } from '../core/constants.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Expanded Equipment — mundane gear runtime
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Automation for the Expanded Equipment content set (67 mundane weapons /
 * armor / shields, `pack-sources/items/…`). Each item carries a
 * `flags["nim-plus-package"].equipment` object describing the special
 * properties the base Nimble object schema can't model. The helpers below
 * cover what the system's static rules engine can't express:
 *
 * - **Spiked** (armor/shield) — melee attackers take 1d4 piercing per spiked
 *   piece the target wears. Wired to `nimble.damageApplied` (fires GM-side,
 *   once per damaged target — a multi-target melee hit retaliates once per
 *   spiked target).
 * - **Parry** (weapon) — a wielded parry weapon widens the target's miss
 *   window: a primary die of 2 (which would normally *hit*) instead misses.
 *   Advisory only (Nimble has no to-hit roll to cancel), posted from
 *   `nimble.useItem` by reading the primary damage die.
 * - **Brittle** (weapon/shield) — a Defend/critical charge counter tracked on
 *   the item flag; destroys (auto-unequips) the item at zero.
 * - **Mana bonus** (focus/implement) — +N max mana while equipped, added as a
 *   prepareDerivedData rider (mirrors the Vol IV derived-data riders; mana.max
 *   is final by the time our wrapper runs — see `_prepareMaxMana` note below).
 * - **Requirement warnings** — non-blocking `ui.notifications.warn` when an
 *   under-qualified wearer equips gear with an ability requirement.
 * - **Grip toggle** — `api.equipment.toggleGrip` swaps a versatile weapon
 *   between its one- and two-handed damage formulas + `twoHanded` property.
 * - **Loud** (armor) — disadvantage on Stealth checks, injected cleanly at the
 *   `rollSkillCheck` patch point.
 *
 * Hook-name convention: this module registers the system's custom hooks with
 * the hard-coded `nimble.` prefix (see the existing `nimble.useItem` /
 * `nimble.rest` listeners). The system builds these via
 * `systemHookName(suffix)` = `${SYSTEM_ID}.suffix`; we follow the module's
 * established literal-prefix convention for `nimble.damageApplied` too.
 */

export const EQUIP_FLAG = 'equipment';
export const SPIKED_DIE = '1d4';

/** Read the `equipment` sub-object off an item's module flags (or null). */
export function equipmentFlag(item) {
	const flag = item?.flags?.[MODULE_ID]?.[EQUIP_FLAG] ?? item?.getFlag?.(MODULE_ID, EQUIP_FLAG);
	return flag && typeof flag === 'object' ? flag : null;
}

/** All of the actor's equipped objects whose `equipment` flag matches `predicate`. */
export function equippedWithEquipment(actor, predicate) {
	const items = actor?.items?.contents ?? Array.from(actor?.items ?? []);
	return items.filter((i) => {
		if (i.type !== 'object' || i.system?.equipped !== true) return false;
		const flag = equipmentFlag(i);
		return flag ? !!predicate(flag, i) : false;
	});
}

/** An ability modifier off the actor's prepared data (0 when missing). */
export function actorAbilityMod(actor, abilityKey) {
	return Math.floor(Number(actor?.system?.abilities?.[abilityKey]?.mod ?? 0)) || 0;
}

/**
 * True when `item` is a melee attack — either an equipped object weapon or a
 * monster/NPC feature attack. Nimble's `activation.targets.attackType` is one of
 * `'' | 'reach' | 'range'` (system `models/item/common.ts` ~80-86); blank and
 * `reach` are both melee, `range` is ranged. Monster attacks are `monsterFeature`
 * items whose `subtype` is `action` or `attackSequence` (see
 * `MonsterFeatureDataModel.ts`); spells and ranged features are excluded so they
 * never trigger retaliation.
 */
export function isMeleeAttackItem(item) {
	if (item?.system?.activation?.targets?.attackType === 'range') return false;
	if (item?.type === 'object') return item.system?.objectType === 'weapon';
	if (item?.type === 'monsterFeature') {
		const subtype = item.system?.subtype;
		return subtype === 'action' || subtype === 'attackSequence';
	}
	return false;
}

/** The primary DamageRoll from a `nimble.useItem` context (crit/miss die), or null. */
export function findPrimaryDamageRoll(rolls) {
	if (!Array.isArray(rolls)) return null;
	return (
		rolls.find((r) => r && (r.primaryDie !== undefined || r.primaryDieValue !== undefined)) ?? null
	);
}

