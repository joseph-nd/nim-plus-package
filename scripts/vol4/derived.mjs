import { MODULE_ID } from '../core/constants.mjs';
import { findFirstDamageNode } from '../core/damage.mjs';
import { actorKeyMod } from '../feats/mechanics/helpers.mjs';
import { vol4OwnedWithFlag } from './dawnmark.mjs';

// ── Vol IV derived-data riders ───────────────────────────────────────────────

// Strength-o-Maxer: while equipped, every owned weapon's STR requirement drops
// by 1. Derived data only — recomputed each prepare, self-clears on unequip.
function applyVol4DerivedAdjustments(actor) {
	const maxer = vol4OwnedWithFlag(actor, 'vol4StrengthOMaxer', { equippedOnly: true })[0];
	if (!maxer) return;
	for (const item of actor.items) {
		if (item.type !== 'object' || item.system?.objectType !== 'weapon') continue;
		const req = item.system?.properties?.strengthRequirement;
		if (req && typeof req.value === 'number' && req.value > 0) req.value -= 1;
	}
}

// Spellslinger's Prism: +KEY damage on cantrips while the prism is equipped.
// Same formula-splice-and-restore technique as Elemental Specialist.
function applyVol4CantripBonus(spell) {
	if (spell?.type !== 'spell') return null;
	const actor = spell.actor;
	if (!actor) return null;
	if (Number(spell.system?.tier ?? 0) !== 0) return null; // cantrips only

	const prism = vol4OwnedWithFlag(actor, 'vol4CantripBonus', { equippedOnly: true })[0];
	if (!prism) return null;

	const key = actorKeyMod(actor);
	if (!Number.isFinite(key) || key <= 0) return null;

	const node = findFirstDamageNode(spell.system?.activation?.effects);
	if (!node) return null;
	const original = node.formula;
	node.formula = `${original} + ${key}`;
	return () => {
		node.formula = original;
	};
}

Hooks.once('setup', () => {
	const CharacterClass = CONFIG?.NIMBLE?.Actor?.documentClasses?.character;
	if (CharacterClass?.prototype?.prepareDerivedData && !CharacterClass.prototype.__nimPlusVol4Patched) {
		const originalPrep = CharacterClass.prototype.prepareDerivedData;
		CharacterClass.prototype.prepareDerivedData = function vol4PatchedPrepareDerivedData() {
			originalPrep.call(this);
			try {
				applyVol4DerivedAdjustments(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply Vol IV derived adjustments`, error);
			}
		};
		CharacterClass.prototype.__nimPlusVol4Patched = true;
	}

	const SpellClass = CONFIG?.NIMBLE?.Item?.documentClasses?.spell;
	if (SpellClass?.prototype?.activate && !SpellClass.prototype.__nimPlusVol4PrismPatched) {
		const originalActivate = SpellClass.prototype.activate;
		SpellClass.prototype.activate = async function vol4PatchedSpellActivate(options = {}) {
			let restore = null;
			try {
				if (!options?.executeMacro) restore = applyVol4CantripBonus(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply Spellslinger's Prism bonus`, error);
			}
			try {
				return await originalActivate.call(this, options);
			} finally {
				try {
					restore?.();
				} catch (error) {
					console.error(`[${MODULE_ID}] Failed to restore cantrip formula`, error);
				}
			}
		};
		SpellClass.prototype.__nimPlusVol4PrismPatched = true;
	}
});

