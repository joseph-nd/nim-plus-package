import { MODULE_ID } from '../core/constants.mjs';
import { ensureCombatDicePoolBonus } from './commander/combat-dice.mjs';
import { ensureCombatDiceDiscard } from './commander/combat-dice-discard.mjs';
import { ensureCoordinatedStrikeCounter } from './commander/coordinated-strike.mjs';
import { ensureMasterCommanderRecovery } from './commander/master-commander.mjs';
import { ensureSingleMindedOrderLevel } from './commander/single-minded-fighter.mjs';
import { ensureJudgmentConsumer, ensureJudgmentPoolModifier } from './oathsworn/judgment-rules.mjs';
import { iterateChargePools } from '../core/pools.mjs';
import { ensureAncestryUseCounters } from '../ancestry/use-counters.mjs';
import { classQoLEnabled } from './shared/settings.mjs';

/* ── Wiring ─────────────────────────────────────────────────────────────────── */

/** The item types this module supplies rules for, and so must re-prepare. */
const INJECTED_RULE_TYPES = new Set(['feature', 'ancestry']);

/**
 * Every rule this module supplies on the system's behalf, applied to one item.
 * Called from item data preparation, so it runs on load, on every update, and
 * on every level-up — there is no "install" step to miss and nothing to undo.
 *
 * Every `ensure*` below matches the item by `system.identifier` (which the
 * system re-derives from the item's *name* in `prepareBaseData`), by name, or by
 * pool/rule identifier — never by compendium UUID. So the Nim+ 0.2 playtest
 * copies of the core features (see `core/supersede.mjs`), which keep the
 * system's names but have ids of their own, are injected into exactly like the
 * system documents they replace. Where 0.2 changes what a rule should do, the
 * `ensure*` itself decides (they step aside when the content already carries the
 * rule); nothing here needs to know which side of the setting an item is from.
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
	ensureCombatDiceDiscard(item);
	ensureCombatDicePoolBonus(item);
	ensureSingleMindedOrderLevel(item);
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
function patchRulePreparation(documentClass, sentinel, inject) {
	if (!documentClass?.prototype || documentClass.prototype[sentinel]) return false;

	const originalPrepareBaseData = documentClass.prototype.prepareBaseData;
	documentClass.prototype.prepareBaseData = function patchedPrepareBaseData(...args) {
		const result = originalPrepareBaseData?.apply(this, args);
		try {
			inject(this);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to supply rules for ${this?.name}`, error);
		}
		return result;
	};
	documentClass.prototype[sentinel] = true;
	return true;
}

export function patchFeatureRulePreparation() {
	return patchRulePreparation(
		CONFIG?.NIMBLE?.Item?.documentClasses?.feature,
		'__nimPlusRulesPatched',
		injectMissingRules,
	);
}

/**
 * The same seam on the ancestry class, for the use counters its traits describe
 * in prose. A separate prototype, so it needs its own patch and its own
 * sentinel — nothing about the charge subsystem cares which of the two declared
 * the pool.
 */
export function patchAncestryRulePreparation() {
	return patchRulePreparation(
		CONFIG?.NIMBLE?.Item?.documentClasses?.ancestry,
		'__nimPlusAncestryRulesPatched',
		ensureAncestryUseCounters,
	);
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
export function reprepareInjectedRules() {
	for (const actor of game.actors ?? []) {
		if (actor?.type !== 'character') continue;
		let touched = false;
		for (const item of actor.items ?? []) {
			if (!INJECTED_RULE_TYPES.has(item?.type) || item.initialized !== true) continue;
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
		patchAncestryRulePreparation();
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to patch item rule preparation`, error);
	}
});

Hooks.once('ready', () => {
	resyncStaleChargePools().catch((error) =>
		console.error(`[${MODULE_ID}] Failed to re-sync charge pool state`, error),
	);
});
