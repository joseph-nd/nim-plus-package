import { MODULE_ID } from '../../core/constants.mjs';
import { getCharacterLevel } from '../../feats/core.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';

/* ── The Shadowmancer's spell tiers ──────────────────────────────────────────
 *
 * Every other caster in Nimble unlocks a new spell tier on the same ladder, and
 * the system hardcodes it once for all of them — `getHighestSpellTier` walks
 * `[1, 4, 6, 8, 10, 12, 14, 16, 18]` against the character's level and never
 * asks which class is doing the casting.
 *
 * The Shadowmancer does not use that ladder. Its own progression grants tier 1
 * at level 2 and then climbs more slowly, topping out at tier 7:
 *
 *     tier 1 → level 2      tier 5 → level 13
 *     tier 2 → level 5      tier 6 → level 16
 *     tier 3 → level 7      tier 7 → level 19
 *     tier 4 → level 10
 *
 * Read against the generic table that is wrong in both directions: a level-4
 * Shadowmancer was handed tier 2 a level early, and a level-20 one reached tier
 * 9 — two tiers the class never gets at all.
 *
 * The cap is a stored field the system assigns with `??=`, so a value already
 * on the actor wins and the derived one is never recomputed. We therefore
 * assign after the original preparation rather than before it, which also means
 * a Shadowmancer's cap is not adjustable from the sheet's +/- stepper — the
 * class's ladder is the ladder. Nothing is written to the actor: this is
 * derived data, rebuilt on every preparation, so it disappears the moment the
 * module or its setting is turned off.
 */

/** Level at which each tier unlocks, tier 1 first. The class stops at tier 7. */
const SHADOWMANCER_TIER_LEVELS = [2, 5, 7, 10, 13, 16, 19];

/** Highest tier a Shadowmancer of `level` may cast; 0 below level 2. */
export function shadowmancerHighestTier(level) {
	const value = Number(level) || 0;
	for (let index = SHADOWMANCER_TIER_LEVELS.length - 1; index >= 0; index -= 1) {
		if (value >= SHADOWMANCER_TIER_LEVELS[index]) return index + 1;
	}
	return 0;
}

/**
 * True when the actor carries a Shadowmancer class item, in any multiclass slot.
 * Matched on `system.identifier`, which the system slugifies from the item name,
 * with the name itself as a fallback for a copy that never got one.
 */
export function isShadowmancerActor(actor) {
	if (!actor || actor.type !== 'character') return false;
	for (const item of actor.items ?? []) {
		if (item.type !== 'class') continue;
		const identifier = item.system?.identifier || item.name?.slugify?.({ strict: true }) || '';
		if (identifier === 'shadowmancer') return true;
	}
	return false;
}

/**
 * Replace the generic cap with the class's own. Skipped for a character with no
 * mana pool, which is how the system itself decides someone is not a caster yet.
 *
 * The level read is the total character level, matching what the system's own
 * `getHighestSpellTier` does — exact for a single-class Shadowmancer, and an
 * approximation for a multiclass, the same approximation core already makes.
 */
function applyShadowmancerSpellTier(actor) {
	if (!classQoLEnabled()) return;
	if (!isShadowmancerActor(actor)) return;

	const resources = actor.system?.resources;
	if (!resources) return;
	if ((Number(resources.mana?.max) || 0) <= 0) return;

	resources.highestUnlockedSpellTier = shadowmancerHighestTier(getCharacterLevel(actor));
}

Hooks.once('setup', () => {
	// The real character class sits behind Nimble's ActorProxy; patching
	// CONFIG.Actor.documentClass would never intercept the subclass override.
	const CharacterClass = CONFIG?.NIMBLE?.Actor?.documentClasses?.character;
	if (!CharacterClass?.prototype?.prepareDerivedData) return;
	if (CharacterClass.prototype.__nimPlusShadowmancerTierPatched) return;

	const originalPrep = CharacterClass.prototype.prepareDerivedData;
	CharacterClass.prototype.prepareDerivedData = function patchedShadowmancerTierPrep(...args) {
		const result = originalPrep.apply(this, args);
		try {
			applyShadowmancerSpellTier(this);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to apply Shadowmancer spell tiers`, error);
		}
		return result;
	};
	CharacterClass.prototype.__nimPlusShadowmancerTierPatched = true;
});

Hooks.once('ready', () => {
	// Characters prepared between the system registering its document classes and
	// the patch landing carry the generic cap; rebuild them once so the ladder
	// applies without a reload.
	if (!classQoLEnabled()) return;
	for (const actor of game.actors ?? []) {
		if (!isShadowmancerActor(actor)) continue;
		try {
			actor.prepareData();
		} catch (error) {
			console.error(`[${MODULE_ID}] Could not refresh Shadowmancer ${actor?.name}`, error);
		}
	}
});
