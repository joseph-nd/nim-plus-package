import { MODULE_ID } from '../core/constants.mjs';
import { equipmentFlag, equippedWithEquipment } from './helpers.mjs';

// ── Mana bonus + Loud (prepareDerivedData / rollSkillCheck patches) ───────────
//
// Mana: `_prepareMaxMana` sets `system.resources.mana.max` inside
// prepareDerivedData (character.ts ~239), so wrapping prepareDerivedData and
// running AFTER the original (as the Vol IV riders do) sees the final value —
// we add the equipped focus items' `manaBonus` on top. Derived-data only: never
// written to the DB, recomputed each prepare, self-clears on unequip.
//
// Loud: `NimbleCharacter.rollSkillCheck` (character.ts ~1016) computes its roll
// mode via `calculateRollMode(defaultRollMode, rollModeModifier, rollMode)` =
// `defaultRollMode + rollModeModifier` (negative = disadvantage). Wrapping it
// and decrementing `options.rollModeModifier` by 1 for Stealth cleanly injects
// disadvantage while a Loud item is equipped — no dialog hacking required.
function applyEquipmentDerivedAdjustments(actor) {
	const focuses = equippedWithEquipment(actor, (flag) => Number(flag.manaBonus) > 0);
	if (focuses.length === 0) return;
	const mana = actor.system?.resources?.mana;
	if (!mana || typeof mana.max !== 'number') return;
	let bonus = 0;
	for (const item of focuses) bonus += Number(equipmentFlag(item)?.manaBonus) || 0;
	mana.max += bonus;
}

/** True when the actor wears any equipped item flagged `loud`. */
function actorHasEquippedLoud(actor) {
	return equippedWithEquipment(actor, (flag) => flag.loud === true).length > 0;
}

Hooks.once('setup', () => {
	const CharacterClass = CONFIG?.NIMBLE?.Actor?.documentClasses?.character;

	// Mana bonus rider — same wrap-prepareDerivedData technique as the Vol IV
	// riders, added after the original so mana.max is final.
	if (
		CharacterClass?.prototype?.prepareDerivedData &&
		!CharacterClass.prototype.__nimPlusEquipmentManaPatched
	) {
		const originalPrep = CharacterClass.prototype.prepareDerivedData;
		CharacterClass.prototype.prepareDerivedData = function equipmentPatchedPrepareDerivedData() {
			originalPrep.call(this);
			try {
				applyEquipmentDerivedAdjustments(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply Expanded Equipment mana bonus`, error);
			}
		};
		CharacterClass.prototype.__nimPlusEquipmentManaPatched = true;
	}

	// Loud disadvantage on Stealth — clean injection at the skill-check entry.
	if (
		CharacterClass?.prototype?.rollSkillCheck &&
		!CharacterClass.prototype.__nimPlusEquipmentLoudPatched
	) {
		const originalRollSkillCheck = CharacterClass.prototype.rollSkillCheck;
		CharacterClass.prototype.rollSkillCheck = function equipmentPatchedRollSkillCheck(
			skillKey,
			options = {},
		) {
			try {
				if (skillKey === 'stealth' && actorHasEquippedLoud(this)) {
					options = {
						...options,
						rollModeModifier: (Number(options.rollModeModifier) || 0) - 1,
					};
					console.debug(
						`[${MODULE_ID}] ${this.name} wears Loud gear — Stealth check rolled at disadvantage.`,
					);
				}
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply Loud Stealth disadvantage`, error);
			}
			return originalRollSkillCheck.call(this, skillKey, options);
		};
		CharacterClass.prototype.__nimPlusEquipmentLoudPatched = true;
	}
});
