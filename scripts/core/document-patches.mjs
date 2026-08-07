import { MODULE_ID } from './constants.mjs';
import { FEATS_SETTING, FEATS_GROUP } from '../feats/settings.mjs';
import { applyFeatArmorAdjustments } from '../feats/mechanics/armor.mjs';
import { applyElementalSpecialistBonus } from '../feats/mechanics/elemental-specialist.mjs';

/**
 * Make features with `flags.nim-plus-package.showAsAttack === true` show up in
 * the character sheet's Heroic Actions → Attack panel. The panel filter checks
 * `system.actionType?.includes('attack')`, but `actionType` isn't part of the
 * feature schema, so it would be stripped from `_source` on load. We instead
 * inject it on the prepared-data side at runtime — it never persists, but it
 * satisfies the panel's reactive filter for the lifetime of the session.
 *
 * The feature still also needs `system.activation.cost.type === 'action'` for
 * the panel to include it.
 */
Hooks.once('setup', () => {
	const ItemClass = CONFIG.Item.documentClass;
	if (!ItemClass) return;

	const original = ItemClass.prototype.prepareDerivedData;
	ItemClass.prototype.prepareDerivedData = function patchedPrepareDerivedData() {
		original.call(this);

		// When Feats are enabled, advertise the `feats` group on every class item
		// so the native level-up dialog renders our class-less feat pool at the
		// feat levels (4/8/12/16). Mutates derived data only — never `_source` —
		// so it self-clears when the setting is turned off and the item is
		// re-prepared. Guarded because data prep can run before settings register.
		if (this.type === 'class') {
			try {
				if (game.settings?.get?.(MODULE_ID, FEATS_SETTING)) {
					const groups = this.system?.groupIdentifiers;
					if (Array.isArray(groups) && !groups.includes(FEATS_GROUP)) groups.push(FEATS_GROUP);
				}
			} catch (_error) {
				/* settings not ready yet — nothing to inject */
			}
			return;
		}

		if (this.type !== 'feature') return;
		if (this.getFlag(MODULE_ID, 'showAsAttack')) {
			this.system.actionType = 'attack';
		}
	};

	// Patch the character document's prepareDerivedData to apply conditional feat
	// armor bonuses (Defensive Duelist, Dual Wielder) and the Bulwark aura. These
	// can't be expressed as static `armorClass` rules because the system's
	// predicate domain has no tag for "wielding a DEX weapon", "dual wielding", or
	// "an ally with Bulwark is adjacent". We compute them off live item/canvas
	// state AFTER the system finishes its own AC math, adding to the final
	// `system.attributes.armor.value`. This mutates derived data only — it is
	// recomputed every prepare, so the bonus is inherently applied exactly once and
	// self-clears when the feat/condition goes away or the setting is disabled.
	//
	// The real character class lives behind Nimble's ActorProxy at
	// CONFIG.NIMBLE.Actor.documentClasses.character and overrides prepareDerivedData,
	// so that is the prototype we must wrap (patching CONFIG.Actor.documentClass —
	// the proxy — would never intercept the subclass override).
	const CharacterClass = CONFIG?.NIMBLE?.Actor?.documentClasses?.character;
	if (CharacterClass?.prototype?.prepareDerivedData && !CharacterClass.prototype.__nimPlusFeatACPatched) {
		const originalActorPrep = CharacterClass.prototype.prepareDerivedData;
		CharacterClass.prototype.prepareDerivedData = function patchedActorPrepareDerivedData() {
			originalActorPrep.call(this);
			try {
				applyFeatArmorAdjustments(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply feat armor adjustments`, error);
			}
		};
		CharacterClass.prototype.__nimPlusFeatACPatched = true;
	}

	// Patch the spell document's `activate` to implement Elemental Specialist.
	// The feat grants "+KEY damage to Tiered Spells of one chosen school". The
	// rules engine cannot scope a damageBonus by spell *school* (only by damage
	// type / source / delivery), and many spell damage effects carry no explicit
	// damage type, so we instead append `+ KEY` to the cast spell's primary damage
	// formula in-memory right before the activation manager clones it — the same
	// proven technique used by Psionic Field Attack. The original formula is
	// restored immediately after so repeated casts never accumulate the bonus.
	const SpellClass = CONFIG?.NIMBLE?.Item?.documentClasses?.spell;
	if (SpellClass?.prototype?.activate && !SpellClass.prototype.__nimPlusElementalPatched) {
		const originalSpellActivate = SpellClass.prototype.activate;
		SpellClass.prototype.activate = async function patchedSpellActivate(options = {}) {
			let restore = null;
			try {
				if (!options?.executeMacro) restore = applyElementalSpecialistBonus(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply Elemental Specialist bonus`, error);
			}
			try {
				return await originalSpellActivate.call(this, options);
			} finally {
				try {
					restore?.();
				} catch (error) {
					console.error(`[${MODULE_ID}] Failed to restore spell formula after Elemental Specialist`, error);
				}
			}
		};
		SpellClass.prototype.__nimPlusElementalPatched = true;
	}

	// Weapons never merge into stacks. The system's object `_preCreate` folds any
	// stackable/smallSized object into an existing same-name item (one document,
	// one shared `equipped` boolean), which makes "equip one of my three daggers"
	// inexpressible. Masquerade weapons as the non-stacking `slots` size type for
	// the duration of the system's merge check so each weapon stays its own
	// document; the created document keeps its real objectSizeType (only the
	// prepared in-memory value is touched, and it is restored immediately).
	// Quantity>1 weapon creations are split by the createItem hook further down.
	const ObjectClass = CONFIG?.NIMBLE?.Item?.documentClasses?.object;
	if (ObjectClass?.prototype?._preCreate && !ObjectClass.prototype.__nimPlusWeaponUnstackPatched) {
		const originalObjectPreCreate = ObjectClass.prototype._preCreate;
		ObjectClass.prototype._preCreate = async function patchedObjectPreCreate(data, options, user) {
			const sizeType = this.system?.objectSizeType;
			const wouldMerge = sizeType === 'stackable' || sizeType === 'smallSized';
			if (this.isEmbedded && wouldMerge && this.system?.objectType === 'weapon') {
				this.system.objectSizeType = 'slots';
				try {
					return await originalObjectPreCreate.call(this, data, options, user);
				} finally {
					this.system.objectSizeType = sizeType;
				}
			}
			return originalObjectPreCreate.call(this, data, options, user);
		};
		ObjectClass.prototype.__nimPlusWeaponUnstackPatched = true;
	}
});
