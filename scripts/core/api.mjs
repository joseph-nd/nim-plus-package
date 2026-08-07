/**
 * Nim+ Package — runtime API
 *
 * Exposes helpers that feature macros (the `system.macro` field on Nimble
 * items) can call. Every helper takes the `actor` and `item` that the macro
 * was invoked with so it can roll against the right actor and label the chat
 * output with the right item.
 *
 * Access patterns:
 *   game.modules.get('nim-plus-package').api.pickDamage(actor, item, options)
 *   nimPlus.pickDamage(actor, item, options)              // shortcut alias
 *
 * This module is imported last by `main.mjs`, after every feature module has
 * registered its hooks, so building the surface here can never reorder them.
 */
import { MODULE_ID } from './constants.mjs';

import { pickDamage } from '../macros/pick-damage.mjs';
import { seasonedJourneyman } from '../macros/seasoned-journeyman.mjs';
import { sporeAttack } from '../macros/spore-attack.mjs';
import { tollTheHour } from '../hexbinder/toll-the-hour.mjs';

import { summonSpiritCompanion } from '../psion/spirit-companion.mjs';
import { mirageDispatch } from '../psion/mirage.mjs';
import { psionicFieldAttack } from '../psion/psionic-field-attack.mjs';
import {
	strainClear,
	strainGain,
	strainGetDieSize,
	strainLose,
	strainRoll,
	strainShow,
} from '../psion/strain.mjs';

import { chooseFeat, getCharacterLevel, ownedFeats, pendingFeatCount } from '../feats/core.mjs';
import { healerHeal, secondWind } from '../feats/mechanics/healer-second-wind.mjs';
import { allocateAcademic } from '../feats/mechanics/academic.mjs';
import { chooseElementalSpecialist } from '../feats/mechanics/elemental-specialist.mjs';

import { vol4DawnmarkApply, vol4DawnmarkConsume } from '../vol4/dawnmark.mjs';
import { vol4Bloodseeker, vol4ElementalWeapon } from '../vol4/weapons.mjs';
import { vol4ApplyRune } from '../vol4/runes.mjs';
import {
	vol4BattlemageInfusion,
	vol4BlindOracle,
	vol4DuneguardBrooch,
	vol4ElementalGuidance,
	vol4Jellybean,
	vol4RealityFold,
	vol4UnicornTear,
} from '../vol4/wondrous.mjs';

import { equipmentRepairBrittle, equipmentSpendBrittle } from '../equipment/brittle.mjs';
import { equipmentToggleGrip } from '../equipment/grip.mjs';

export const api = {
	pickDamage,
	summonSpiritCompanion,
	tollTheHour,
	seasonedJourneyman,
	sporeAttack,
	mirageDispatch,
	psionicFieldAttack,
	strain: {
		gain: strainGain,
		lose: strainLose,
		clear: strainClear,
		roll: strainRoll,
		getDieSize: strainGetDieSize,
		show: strainShow,
	},
	feats: {
		choose: chooseFeat,
		pending: pendingFeatCount,
		owned: ownedFeats,
		characterLevel: getCharacterLevel,
		// Activatable feat macros (wired via each feat's `system.macro`).
		healerHeal,
		secondWind,
		// Grant-time configurators (also re-openable from the sheet Feats panel).
		allocateAcademic,
		chooseElementalSpecialist,
	},
	// Nim+ Volume IV magic items (see `scripts/vol4/`).
	vol4: {
		bloodseeker: vol4Bloodseeker,
		elementalWeapon: vol4ElementalWeapon,
		applyRune: vol4ApplyRune,
		dawnmarkApply: vol4DawnmarkApply,
		dawnmarkConsume: vol4DawnmarkConsume,
		battlemageInfusion: vol4BattlemageInfusion,
		realityFold: vol4RealityFold,
		duneguardBrooch: vol4DuneguardBrooch,
		blindOracle: vol4BlindOracle,
		elementalGuidance: vol4ElementalGuidance,
		jellybean: vol4Jellybean,
		unicornTear: vol4UnicornTear,
	},
	// Nim+ Expanded Equipment — mundane gear (see `scripts/equipment/`).
	equipment: {
		toggleGrip: equipmentToggleGrip,
		spendBrittle: equipmentSpendBrittle,
		repairBrittle: equipmentRepairBrittle,
	},
};

Hooks.once('init', () => {
	const mod = game.modules.get(MODULE_ID);
	if (mod) mod.api = api;
	globalThis.nimPlus = api;
});
