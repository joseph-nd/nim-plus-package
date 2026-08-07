import { MODULE_ID } from '../../core/constants.mjs';
import { sysHook } from '../../core/system.mjs';
import { itemRuleValues, hasActiveRule, addSyntheticRule } from '../../core/rules.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { iterateChargePools, setChargePoolCurrent } from '../../core/pools.mjs';
import { COORDINATED_STRIKE_IDENTIFIER } from './coordinated-strike.mjs';

/* ── Commander — Master Commander ────────────────────────────────────────────
 *
 * "When you roll Initiative, regain 1 spent use of Coordinated Strike (it is
 *  lost if not spent during that encounter). Attacks made from your Coordinated
 *  Strikes also now ignore disadvantage.
 *  Levels 5, 9, 13, 17: Gain +1 use of Coordinated Strike per Safe Rest."
 *
 * Another feature shipped with `rules: []`, so all three clauses are prose. Two
 * of them are the charge subsystem's own vocabulary:
 *
 *   - The per-level uses are a `modifyPool` ladder, one `+1` for each of the
 *     four levels. The feature is granted once and never re-granted — the
 *     level-up window filters out anything already owned — so the levels have to
 *     be predicates on that single copy rather than four copies of the item.
 *   - "Regain 1 spent use when you roll Initiative" is an `onInitiativeRolled`
 *     recovery of `add 1`, which clamps at the maximum: with nothing spent there
 *     is nothing to regain, exactly as written.
 *
 * The third clause — the granted use being lost if the encounter ends without
 * it — has no vocabulary, since recovery values cannot go negative. It is the
 * one part done in code, below.
 *
 * "Attacks ignore disadvantage" is left to the table: the attacks Coordinated
 * Strike grants are made separately, each with its own dialog, and nothing
 * connects them back to the order that prompted them.
 */

const MASTER_COMMANDER_MATCH = /master\s*commander/i;
const COORD_STRIKE_TEMP_USE_FLAG = 'coordinatedStrikeTempUse';

function actorHasMasterCommander(actor) {
	for (const item of actor?.items ?? []) {
		if (item?.type !== 'feature') continue;
		if (MASTER_COMMANDER_MATCH.test(String(item.name ?? ''))) return true;
	}
	return false;
}

/** The Coordinated Strike! use counter in flag state, however it was created. */
export function findCoordinatedStrikePool(actor) {
	for (const entry of iterateChargePools(actor)) {
		const identifier = String(entry.pool.identifier ?? entry.key).toLowerCase();
		if (!identifier.includes(COORDINATED_STRIKE_IDENTIFIER)) continue;

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

/** +1 use at each of the four levels the feature calls out. */
export function ensureMasterCommanderUses(item) {
	if (!MASTER_COMMANDER_MATCH.test(String(item.name ?? ''))) return;

	const alreadyModifies = hasActiveRule(
		item,
		(rule) =>
			rule.type === 'modifyPool' &&
			rule.poolType === 'charge' &&
			String(rule.poolIdentifier ?? '')
				.toLowerCase()
				.includes(COORDINATED_STRIKE_IDENTIFIER),
	);
	if (alreadyModifies) return;

	[5, 9, 13, 17].forEach((minLevel, index) => {
		addSyntheticRule(item, {
			id: `nimPlusMasterCommanderUses-${index}`,
			type: 'modifyPool',
			identifier: '',
			label: `${item.name} → +1 use of Coordinated Strike!`,
			predicate: { level: { min: minLevel } },
			priority: index + 1,
			poolType: 'charge',
			poolIdentifier: COORDINATED_STRIKE_IDENTIFIER,
			dieSize: null,
			maxDelta: '+1',
		});
	});
}

/**
 * Give the Coordinated Strike! pool its Initiative recovery, once its owner has
 * Master Commander. Written onto whichever `chargePool` rule is there rather
 * than onto ours specifically, so it still lands if a future system version
 * ships the pool itself.
 */
export function ensureMasterCommanderRecovery(item) {
	if (item?.system?.identifier !== COORDINATED_STRIKE_IDENTIFIER) return;
	if (!actorHasMasterCommander(item.parent)) return;

	for (const rule of itemRuleValues(item)) {
		if (rule?.type !== 'chargePool' || rule.disabled) continue;
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
