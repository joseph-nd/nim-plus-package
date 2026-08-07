import { sysId } from './system.mjs';

/**
 * Every pool of one kind the actor owns, item-scoped and actor-scoped alike.
 * Both subsystems persist their state the same way — `flags.<sysId>.<kind>`,
 * keyed by pool identifier — so one walker serves both.
 */
function* iteratePoolFlags(actor, flagKey) {
	const scope = sysId();
	for (const item of actor?.items ?? []) {
		const pools = item.flags?.[scope]?.[flagKey];
		if (!pools || typeof pools !== 'object') continue;
		for (const [key, pool] of Object.entries(pools)) {
			if (pool && typeof pool === 'object') yield { document: item, key, pool, scope: 'item' };
		}
	}

	const actorPools = actor?.flags?.[scope]?.[flagKey];
	if (!actorPools || typeof actorPools !== 'object') return;
	for (const [key, pool] of Object.entries(actorPools)) {
		if (!key.startsWith('actor:')) continue;
		if (pool && typeof pool === 'object') yield { document: actor, key, pool, scope: 'actor' };
	}
}

export function* iterateDicePools(actor) {
	yield* iteratePoolFlags(actor, 'dicePools');
}

export function* iterateChargePools(actor) {
	yield* iteratePoolFlags(actor, 'chargePools');
}

/** Write a charge pool's remaining uses, clamped to the pool's own bounds. */
export async function setChargePoolCurrent(entry, next) {
	const clamped = Math.max(0, Math.min(Math.round(next), entry.max));
	if (clamped === entry.current) return;
	await entry.document.update({
		flags: { [sysId()]: { chargePools: { [entry.key]: { current: clamped } } } },
	});
}
