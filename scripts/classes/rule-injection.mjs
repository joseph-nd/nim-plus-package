import { MODULE_ID } from '../core/constants.mjs';
import { ensureCombatDicePoolBonus } from './commander/combat-dice.mjs';
import { ensureCombatDiceDiscard } from './commander/combat-dice-discard.mjs';
import { ensureCoordinatedStrikeCounter } from './commander/coordinated-strike.mjs';
import { ensureMasterCommanderRecovery, ensureMasterCommanderUses } from './commander/master-commander.mjs';
import { ensureJudgmentConsumer, ensureJudgmentPoolModifier } from './oathsworn/judgment-rules.mjs';
import { iterateChargePools } from '../core/pools.mjs';
import { classQoLEnabled } from './shared/settings.mjs';

/* ── Wiring ─────────────────────────────────────────────────────────────────── */

/**
 * Every rule this module supplies on the system's behalf, applied to one item.
 * Called from item data preparation, so it runs on load, on every update, and
 * on every level-up — there is no "install" step to miss and nothing to undo.
 */
function injectMissingRules(item) {
	if (!classQoLEnabled()) return;
	if (item?.type !== 'feature' || !item.rules) return;
	ensureJudgmentConsumer(item);
	ensureJudgmentPoolModifier(item);
	ensureCoordinatedStrikeCounter(item);
	// After the counter exists: this writes onto the pool rule the line above
	// supplies when the content carries none of its own.
	ensureMasterCommanderRecovery(item);
	ensureMasterCommanderUses(item);
	ensureCombatDiceDiscard(item);
	ensureCombatDicePoolBonus(item);
}

/**
 * `prepareBaseData` is where the system builds `item.rules` from the stored
 * source, so it is the one place a synthetic rule can be added early enough for
 * the pool engines — which read that map — to see it.
 *
 * Installed from `init` rather than `setup`, and idempotent so a second call is
 * free. The timing matters: `Game#setupGame` runs `initializeDocuments()`
 * *before* it fires the `setup` hook, so by then every world item already
 * exists — and a Nimble item builds its rules exactly once, its `prepareData`
 * short-circuiting on an `initialized` flag from then on. A patch installed at
 * `setup` therefore never reached a single item that was already in the world;
 * it only caught items created afterwards. That is why a feature worked
 * perfectly the moment it was granted and was quietly unautomated after the next
 * reload.
 */
export function patchFeatureRulePreparation() {
	const FeatureClass = CONFIG?.NIMBLE?.Item?.documentClasses?.feature;
	if (!FeatureClass?.prototype || FeatureClass.prototype.__nimPlusRulesPatched) return false;

	const originalPrepareBaseData = FeatureClass.prototype.prepareBaseData;
	FeatureClass.prototype.prepareBaseData = function patchedPrepareBaseData(...args) {
		const result = originalPrepareBaseData?.apply(this, args);
		try {
			injectMissingRules(this);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to supply rules for ${this?.name}`, error);
		}
		return result;
	};
	FeatureClass.prototype.__nimPlusRulesPatched = true;
	return true;
}

/**
 * Rebuild the rules of features that were prepared before the patch landed.
 *
 * Only needed when the system registered its document classes after we did — we
 * both listen for `init`, and the loser of that race would otherwise be a whole
 * world of items holding rule maps with nothing of ours in them. Clearing the
 * item's `initialized` flag is what makes the system's own `prepareData` run a
 * second time; the actor is re-prepared afterwards so anything derived from
 * those rules is rebuilt with them.
 */
export function reprepareFeatureRules() {
	for (const actor of game.actors ?? []) {
		if (actor?.type !== 'character') continue;
		let touched = false;
		for (const item of actor.items ?? []) {
			if (item?.type !== 'feature' || item.initialized !== true) continue;
			item.initialized = false;
			touched = true;
		}
		if (!touched) continue;
		try {
			actor.prepareData();
		} catch (error) {
			console.error(`[${MODULE_ID}] Could not re-prepare ${actor?.name}`, error);
		}
	}
}

/**
 * True when an item declares a charge pool that its stored pool state has no
 * entry for — the signature of state written while our rules were missing.
 *
 * The system rebuilds that state from the live rules and persists it, but only
 * from a document CRUD hook, so a world that has just been repaired carries the
 * stale version until something happens to the actor. This is how we find those
 * actors without duplicating the system's map builder.
 */
function actorHasUnsyncedChargePool(actor) {
	// Both scopes in one set: an `actor`-scoped pool is stored on the actor, not
	// on the item that declares it, and looking only at the item would report
	// every one of those as missing on every load.
	const known = new Set();
	for (const entry of iterateChargePools(actor)) {
		known.add(String(entry.pool?.identifier ?? entry.key));
	}

	for (const item of actor?.items ?? []) {
		const rules = item?.rules;
		if (!rules?.values) continue;
		for (const rule of rules.values()) {
			if (rule?.type !== 'chargePool' || rule.disabled) continue;
			const identifier = String(rule.identifier || rule.id || '');
			if (identifier.length > 0 && !known.has(identifier)) return true;
		}
	}
	return false;
}

/**
 * Nudge the system into re-syncing pool state for any actor left stale by the
 * bug above. Writing one of our own flags is the whole trick: the system syncs
 * on `updateActor` and ignores updates that touch its own pool flag, so a
 * namespaced write of ours is the smallest thing that reaches it. Guarded by the
 * mismatch test, so it writes once after a repair and never again.
 */
async function resyncStaleChargePools() {
	if (!game.user?.isGM || !classQoLEnabled()) return;
	for (const actor of game.actors ?? []) {
		if (actor?.type !== 'character') continue;
		if (!actorHasUnsyncedChargePool(actor)) continue;
		// Always a different value, or Foundry would diff the write away and the
		// `updateActor` the system listens for would never fire.
		const previous = Number(actor.getFlag(MODULE_ID, 'chargePoolResync')) || 0;
		try {
			await actor.update({ [`flags.${MODULE_ID}.chargePoolResync`]: previous + 1 });
		} catch (error) {
			console.error(`[${MODULE_ID}] Could not re-sync pool state for ${actor?.name}`, error);
		}
	}
}

Hooks.once('init', () => {
	try {
		patchFeatureRulePreparation();
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to patch feature rule preparation`, error);
	}
});

Hooks.once('ready', () => {
	resyncStaleChargePools().catch((error) =>
		console.error(`[${MODULE_ID}] Failed to re-sync charge pool state`, error),
	);
});
