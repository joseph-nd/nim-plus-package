import { MODULE_ID } from '../../core/constants.mjs';
import { sysHook } from '../../core/system.mjs';
import { itemRuleValues } from '../../core/rules.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { iterateChargePools, setChargePoolCurrent } from '../../core/pools.mjs';
import { COORDINATED_STRIKE_IDENTIFIER } from './coordinated-strike.mjs';

/* ── Commander — Master Commander ────────────────────────────────────────────
 *
 * "Your Combat Dice are now d8s. When you roll Initiative, regain 1 spent use
 *  of Coordinated Strike (it is lost if not spent during that encounter).
 *  Attacks made from your Coordinated Strikes also now ignore disadvantage."
 *
 * The feature ships with `rules: []`, so every clause is prose.
 *
 * **This feature grants no extra uses.** The copy the system ships carries a
 * trailing block the published feature does not — "Levels 5, 9, 13, 17: Gain
 * +1 use of Coordinated Strike per Safe Rest" — and the module used to supply a
 * `modifyPool` ladder for it. On the publication's reading the maximum stays at
 * INT for the whole career and what this feature gives you is the *regain*: a
 * use has to have been spent before Initiative for there to be anything to get
 * back. That reading is what is implemented, so nothing here touches the pool's
 * maximum.
 *
 * The regain itself is the charge subsystem's own vocabulary — an
 * `onInitiativeRolled` recovery of `add 1`, which clamps at the maximum, so
 * with nothing spent it is a no-op exactly as written.
 *
 * The other half of that clause — the granted use being lost if the encounter
 * ends without it — has no vocabulary, since recovery values cannot go
 * negative. It is the one part done in code, below.
 *
 * "Attacks ignore disadvantage" is left to the table: the attacks Coordinated
 * Strike grants are made separately, each with its own dialog, and nothing
 * connects them back to the order that prompted them.
 *
 * ── Nimble 0.2 ────────────────────────────────────────────────────────────────
 * The 0.2 Master Commander has no Initiative regain at all: it adds a Safe Rest
 * pool of INT uses on top of Coordinated Strike's own 1/encounter use, and the
 * die sizes. Both live in the module's 0.2 copies as native rules, so this file
 * only acts on the 2.0.3 feature — a Coordinated Strike! carrying the module's
 * `playtest02` flag is left exactly as its content declares it.
 */

const MASTER_COMMANDER_MATCH = /master\s*commander/i;
const COORD_STRIKE_USES_IDENTIFIER = 'coordinated-strike-uses';

/** The module's Nimble 0.2 copy, which declares its own pools and recoveries. */
function isPlaytest02(item) {
	return item?.getFlag?.(MODULE_ID, 'playtest02') === true;
}
const COORD_STRIKE_TEMP_USE_FLAG = 'coordinatedStrikeTempUse';

function actorHasMasterCommander(actor) {
	for (const item of actor?.items ?? []) {
		if (item?.type !== 'feature') continue;
		if (MASTER_COMMANDER_MATCH.test(String(item.name ?? ''))) return true;
	}
	return false;
}

/**
 * The Coordinated Strike! use counter in flag state, however it was created.
 *
 * The feature carries more than one pool as of system 0.8.9 — the uses, and a
 * hidden one gating it to once per round — and both identifiers begin with the
 * feature's own, so the hidden ones are skipped rather than matched by luck of
 * iteration order.
 */
export function findCoordinatedStrikePool(actor) {
	const candidates = [];
	for (const entry of iterateChargePools(actor)) {
		if (entry.pool.hidden) continue;
		const identifier = String(entry.pool.identifier ?? entry.key).toLowerCase();
		if (!identifier.includes(COORDINATED_STRIKE_IDENTIFIER)) continue;
		candidates.push({ entry, identifier });
	}
	// The 0.2 copy shows two counters (the encounter use and the Safe Rest uses);
	// the Safe Rest one is the counter the rest of this file means.
	candidates.sort(
		(a, b) =>
			Number(b.identifier === COORD_STRIKE_USES_IDENTIFIER) -
			Number(a.identifier === COORD_STRIKE_USES_IDENTIFIER),
	);
	for (const { entry } of candidates) {
		const max = Math.max(0, Math.floor(Number(entry.pool.max) || 0));
		return {
			...entry,
			max,
			current: Math.max(0, Math.min(Math.floor(Number(entry.pool.current) || 0), max)),
			label: String(entry.pool.label ?? 'Coordinated Strike!'),
		};
	}
	return null;
}

/**
 * Give the Coordinated Strike! use counter its Initiative recovery, once its
 * owner has Master Commander. Written onto whichever `chargePool` rule is there
 * rather than onto ours specifically, so it still lands now that the system
 * ships the pool itself — which it has done since 0.8.9.
 *
 * The hidden pool that shares the feature is skipped: it is the "once per
 * round" gate, refreshed at the start of every turn, and handing it a second
 * use at Initiative would let the order be given twice in the first round.
 */
export function ensureMasterCommanderRecovery(item) {
	if (item?.system?.identifier !== COORDINATED_STRIKE_IDENTIFIER) return;
	if (isPlaytest02(item)) return;
	if (!actorHasMasterCommander(item.parent)) return;

	for (const rule of itemRuleValues(item)) {
		if (rule?.type !== 'chargePool' || rule.disabled || rule.hidden) continue;
		const identifier = String(rule.identifier ?? rule.id ?? '').toLowerCase();
		if (!identifier.includes(COORDINATED_STRIKE_IDENTIFIER)) continue;

		const recoveries = Array.isArray(rule.recoveries) ? rule.recoveries : [];
		if (recoveries.some((entry) => entry?.trigger === 'onInitiativeRolled')) continue;
		try {
			rule.recoveries = [
				...recoveries,
				{ trigger: 'onInitiativeRolled', mode: 'add', value: '1' },
			];
		} catch (error) {
			console.error(
				`[${MODULE_ID}] Could not add Master Commander's Initiative recovery`,
				error,
			);
		}
	}
}

/**
 * Remember that the Initiative recovery actually handed a use back, and what the
 * count was immediately afterwards.
 *
 * Recorded only when the pool really moved: at full uses there is nothing spent
 * to regain, the recovery clamps to no change, and there is nothing to take away
 * at the end either.
 */
function noteCoordinatedStrikeRecovery(payload) {
	if (!classQoLEnabled()) return;
	if (payload?.trigger !== 'onInitiativeRolled') return;

	const actor = payload.actor;
	if (actor?.type !== 'character' || !actor.isOwner) return;
	if (!actorHasMasterCommander(actor)) return;

	const pool = findCoordinatedStrikePool(actor);
	if (!pool) return;

	for (const entry of payload.recovery ?? []) {
		if (entry?.poolId !== pool.key) continue;
		if (!(entry.recoveredAmount > 0)) continue;
		actor
			.setFlag(MODULE_ID, COORD_STRIKE_TEMP_USE_FLAG, entry.newValue)
			.catch((error) =>
				console.error(`[${MODULE_ID}] Could not note the regained use`, error),
			);
		return;
	}
}

/**
 * "It is lost if not spent during that encounter."
 *
 * The regained use is only taken back when the count is still exactly where the
 * recovery left it. Spend anything at all during the fight and the granted use
 * is the one you spent — the reading that never punishes a player for having
 * used the feature — and a count that has since gone *up* was topped up by
 * something else, a Safe Rest most likely, which is not ours to dock.
 */
async function expireCoordinatedStrikeTempUse(actor) {
	const granted = Number(actor?.getFlag?.(MODULE_ID, COORD_STRIKE_TEMP_USE_FLAG));
	if (!Number.isFinite(granted)) return;

	await actor.unsetFlag(MODULE_ID, COORD_STRIKE_TEMP_USE_FLAG);

	const pool = findCoordinatedStrikePool(actor);
	if (!pool || pool.current !== granted || pool.current < 1) return;
	await setChargePoolCurrent(pool, pool.current - 1);
}

// The GM alone runs the clean-up: `deleteCombat` fires for everyone, and a GM
// can write to any character, so this settles every combatant exactly once.
Hooks.on('deleteCombat', () => {
	if (!classQoLEnabled() || !game.user?.isGM) return;
	for (const actor of game.actors ?? []) {
		if (actor?.type !== 'character') continue;
		expireCoordinatedStrikeTempUse(actor).catch((error) =>
			console.error(`[${MODULE_ID}] Could not expire the regained use for ${actor.name}`, error),
		);
	}
});

// Registered at setup, not at load: `sysHook` needs `game.system` to exist.
Hooks.once('setup', () => {
	Hooks.on(sysHook('chargePool.recovered'), (payload) => {
		try {
			noteCoordinatedStrikeRecovery(payload);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to track the regained use`, error);
		}
	});
});
