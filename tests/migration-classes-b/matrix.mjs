/**
 * Level 1–20 × both directions × every class of this area (plus Hunter for the
 * Keeper of the Shadowpath subclass step), through the orchestrator
 * (`migrateCoreClasses`) with scripted dialog answers:
 *   - the preview lists every change and every listed change happens;
 *   - "Later" / closing the preview changes nothing;
 *   - the result equals a fresh character of the target version (with the
 *     corresponding picks), pools and ids are kept, and a second run is a no-op;
 *   - a round trip returns to the starting state (modulo documented losses).
 */
import { describe, expect, it } from 'vitest';
import { setPool } from '../harness/index.mjs';
import {
	LEVELS,
	buildChar,
	checkPreview,
	diff,
	effects,
	other,
	reloadFor,
	runMigration,
	snapshotItems,
	sourceVersion,
	state,
	targetVersion,
	world,
} from './helpers.mjs';
import { PROFILES, targetSide } from './profiles.mjs';


async function sourceActor(env, profile, direction, L) {
	const v = sourceVersion(direction);
	const actor = await buildChar(env, profile.classId, L, {
		version: v,
		...profile.side(v, L),
		pools: { '@actor': { chargePools: { 'direbeast-form': { current: 2, max: 3, recoveries: [] } } } },
	});
	let n = 0;
	for (const item of actor.items) setPool(env, item, 'chargePools', 'probe', { current: ++n, max: 99, recoveries: [] });
	return actor;
}

/** Known bugs by case (see bugs/migration-classes-b.md). */
function knownBug(profile, direction, L, test) {
	if (test === 'preview' && profile.classId === 'stormshifter' && direction === 'to203' && L <= 2) return 'BUG-migration-classes-b-1';
	return null;
}
function test(profile, direction, L, key, name, fn) {
	const bug = knownBug(profile, direction, L, key);
	return bug ? it.fails(`${bug}: ${name}`, fn) : it(name, fn);
}

/** Define the matrix for one profile (one test file per profile keeps the worker's heap small). */
export function defineMatrix(profileId) {
	const profile = PROFILES.find((p) => p.id === profileId);
	const CASES = [];
	for (const direction of ['to02', 'to203']) for (const L of LEVELS) CASES.push([profile.id, direction, L]);
	describe.each(CASES)('%s %s L%i', (_id, direction, L) => matrixCases(profile, direction, L));
}

function matrixCases(profile, direction, L) {
	test(profile, direction, L, 'preview', 'preview lines match what the migration does', async () => {
		const { env, migration } = await world(direction);
		const actor = await sourceActor(env, profile, direction, L);
		const before = snapshotItems(actor);
		const run = await runMigration(env, migration, actor, direction, { answers: profile.answers(direction, L), sync: 'later' });
		if (run.result === 'nothing') {
			expect(snapshotItems(actor)).toEqual(before);
			return;
		}
		expect(run.result).toBe('applied');
		const problems = checkPreview(run.preview.content, effects(before, actor), { picked: profile.picked(direction, L) });
		expect(problems).toEqual([]);
	});

	it('Later / closing the preview changes nothing', async () => {
		const { env, migration } = await world(direction);
		const actor = await sourceActor(env, profile, direction, L);
		const before = snapshotItems(actor);
		for (const answer of ['later', null]) {
			const run = await runMigration(env, migration, actor, direction, { preview: answer });
			expect(['postponed', 'nothing']).toContain(run.result);
			expect(run.log.filter((d) => !/Migrate classes/.test(d.title))).toEqual([]);
		}
		expect(snapshotItems(actor)).toEqual(before);
		expect(actor.calls).toEqual([]);
	});

	it('reaches the fresh target state, keeps ids and pools, and is idempotent', async () => {
		const { env, migration, sync } = await world(direction);
		const actor = await sourceActor(env, profile, direction, L);
		const before = snapshotItems(actor);
		const run = await runMigration(env, migration, actor, direction, { answers: profile.answers(direction, L) });
		expect(run.unused).toBe(0);

		const fresh = await buildChar(env, profile.classId, L, { version: targetVersion(direction), ...targetSide(profile, direction, L) });
		expect(diff(state(actor), state(fresh))).toEqual({ extra: [], missing: [] });

		// Every surviving item kept its pool state; the actor-scope pool too.
		for (const item of actor.items) {
			if (!before[item.id]) continue;
			expect(item.flags.nimble?.chargePools?.probe, item.name).toEqual(before[item.id].flags.nimble.chargePools.probe);
		}
		expect(actor.flags.nimble.chargePools['direbeast-form'].current).toBe(2);
		// The class item keeps its level/HP state.
		const cls = actor.items.find((i) => i.type === 'class');
		expect(cls.system.classLevel).toBe(L);
		expect(cls.system.hpData).toHaveLength(L);

		// Idempotent: nothing left to plan, no subclass sync left, no dialog on a re-run.
		expect(await migration.planCoreClassMigration({ actors: [actor], direction })).toEqual([]);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
		const snap = snapshotItems(actor);
		const again = await runMigration(env, migration, actor, direction);
		expect(again.result).toBe('nothing');
		expect(snapshotItems(actor)).toEqual(snap);
	});

	it('round trip (setting flipped + reload between legs) returns to the starting state (modulo documented losses)', async () => {
		const { env, migration } = await world(direction);
		const actor = await sourceActor(env, profile, direction, L);
		const start = state(actor);
		await runMigration(env, migration, actor, direction, { answers: profile.answers(direction, L) });
		const back = await reloadFor(other(direction), actor);
		await runMigration(back.env, back.migration, back.actor, other(direction), { answers: profile.answers(other(direction), L) });
		const d = diff(state(back.actor), start);
		const lost = profile.lost(direction, L);
		const gained = profile.picked(direction, L);
		expect(d.missing.map((x) => x.replace(/^\w+:|\[.\]$/g, ''))).toEqual([...lost].sort());
		expect(d.extra.map((x) => x.replace(/^\w+:|\[.\]$/g, ''))).toEqual([...gained].sort());
	});
}
