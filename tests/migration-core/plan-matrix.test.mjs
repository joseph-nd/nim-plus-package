/**
 * Table-driven plan/apply invariants for every core class at levels
 * 1,2,3,4,5,7,10,11,15,18,20, both directions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, supersedeOracle, sourceOf } from '../harness/index.mjs';
import {
	CLASSES,
	LEVELS,
	acceptEverything,
	diff,
	duplicates,
	fingerprint,
	migrate,
	planSummary,
	seedPools,
	world,
} from './helpers.mjs';

/**
 * Choice-group picks a *complete* character would own, where a class module
 * reconciles that group by level (without them the fresh build is not what the
 * rules give, and the round trip "gains" them — correctly).
 */
function picks203(cls, level) {
	if (cls === 'stormshifter') {
		return [
			[2, 'Fearsome Beast'],
			[3, 'Beast of the Pack'],
			[5, 'Beast of Nightmares'],
		]
			.filter(([l]) => l <= level)
			.map(([, n]) => n);
	}
	if (cls === 'shepherd') {
		// 2.0.3 graces: 2 at 5, +1 at 9 and 13. Assist Me is a grace in 2.0.3 and a core feature in 0.2.
		const graces = ['Assist Me, My Friend!', 'Guiding Spirit', 'Hasty Companion', 'Light Bearer'];
		const n = level >= 13 ? 4 : level >= 9 ? 3 : level >= 5 ? 2 : 0;
		return graces.slice(0, n);
	}
	return [];
}

function spells203(cls, level) {
	// Lifebinding Spirit (the tier-1 spell) comes with the L2 Lifebinding Spirit feature in 2.0.3.
	if (cls === 'shepherd' && level >= 2) return ['Lifebinding Spirit'];
	return [];
}

function picks02(cls, level) {
	if (cls === 'stormshifter') {
		return [
			[1, 'Fearsome Beast'],
			[2, 'Beast of the Pack'],
			[5, 'Beast of Nightmares'],
		]
			.filter(([l]) => l <= level)
			.map(([, n]) => n);
	}
	if (cls === 'shepherd') {
		const graces = ['Guiding Spirit', 'Hasty Companion', 'Light Bearer'];
		const n = level >= 13 ? 3 : level >= 9 ? 2 : level >= 4 ? 1 : 0;
		return graces.slice(0, n);
	}
	return [];
}

function spells02(cls) {
	// 0.2 cantrips granted outside the harness's grantItem walk.
	if (cls === 'shepherd') return ['Lifebinding Spirit'];
	if (cls === 'shadowmancer') return ['Command Shadows'];
	return [];
}

const build203 = (env, cls, level, extra = {}) =>
	buildCharacterAtLevel(env, cls, level, {
		version: '2.0.3',
		picks: picks203(cls, level),
		spells: spells203(cls, level),
		...extra,
	});
const build02 = (env, cls, level, extra = {}) =>
	buildCharacterAtLevel(env, cls, level, { version: '0.2', picks: picks02(cls, level), spells: spells02(cls), ...extra });

let oracle;
let env;
let migration;

beforeEach(async () => {
	({ env, migration } = await world({ playtest: true }));
	oracle ??= await supersedeOracle();
});

/**
 * Round-trip differences a class module makes on purpose (listed in its preview):
 *   shepherd 4 — 2.0.3 grants no Sacred Grace before level 5, so going to 2.0.3
 *   the level-4 0.2 grace is removed ("all 1 removed"); coming back, the picker
 *   is closed in this test, so nothing is re-picked.
 */
const JUSTIFIED_02_ROUND_TRIP = {
	'shepherd:4': {
		missing: ['feature:Guiding Spirit|Compendium.nim-plus-package.nim-plus-class-features.Item.da44hPomkQQ32mPu'],
		extra: [],
	},
};

const CASES = CLASSES.flatMap((cls) => LEVELS.map((level) => [cls, level]));

describe('to02 on a 2.0.3 character', () => {
	it.each(CASES)('%s %i: plan writes nothing; apply leaves no superseded/retired item, no duplicate names', async (cls, level) => {
		const actor = await build203(env, cls, level);
		const before = fingerprint(actor);
		await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(actor.calls).toEqual([]);
		expect(fingerprint(actor)).toEqual(before);

		acceptEverything(env);
		await migrate(migration, actor, 'to02');
		const stale = actor.items.filter((i) => {
			const s = sourceOf(i);
			return s && (oracle.supersededBy.has(s) || oracle.retired.has(s));
		});
		expect(stale.map((i) => i.name)).toEqual([]);
		expect(duplicates(actor.items.map((i) => `${i.type}:${i.name}`))).toEqual([]);
		// The class item (replaced in place when 0.2 has a copy of it) still knows its level.
		const [cls02] = actor.items.filter((i) => i.type === 'class');
		expect(actor.levels.classes[cls]).toBe(level);
		expect(cls02.system.classLevel).toBe(level);
	});

	it.each(CASES)('%s %i: applying twice is a no-op', async (cls, level) => {
		const actor = await build203(env, cls, level);
		acceptEverything(env);
		await migrate(migration, actor, 'to02');
		const after = fingerprint(actor);
		const calls = actor.calls.length;
		const [again] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(planSummary(again)).toBeNull();
		await migrate(migration, actor, 'to02');
		expect(actor.calls.length).toBe(calls);
		expect(fingerprint(actor)).toEqual(after);
	});

	it.each(CASES)('%s %i: pool values and ids of kept items survive', async (cls, level) => {
		const actor = await build203(env, cls, level);
		const seeded = seedPools(env, actor);
		actor._source.flags.nimble = { chargePools: { actorPool: { current: 3 } } };
		actor.prepareData();
		acceptEverything(env);
		await migrate(migration, actor, 'to02');
		const survivors = Object.keys(seeded).filter((id) => actor.items.has(id));
		expect(survivors.length).toBeGreaterThan(0);
		for (const id of survivors) {
			const item = actor.items.get(id);
			expect(item.flags.nimble.chargePools['test-pool'].current, item.name).toBe(seeded[id]);
			expect(item.flags.nimble.dicePools['test-dice'].current, item.name).toEqual([seeded[id]]);
		}
		expect(actor.flags.nimble.chargePools.actorPool.current).toBe(3);
	});
});

describe('to203 on a 0.2 character', () => {
	it.each(CASES)('%s %i: apply leaves no Nim+ 0.2 item, no duplicate names; twice is a no-op', async (cls, level) => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await build02(env, cls, level);
		acceptEverything(env);
		await migrate(migration, actor, 'to203');
		const stale = actor.items.filter((i) => {
			const s = sourceOf(i);
			return s && (oracle.supersedes.has(s) || oracle.playtestOnly.has(s));
		});
		expect(stale.map((i) => i.name)).toEqual([]);
		expect(duplicates(actor.items.map((i) => `${i.type}:${i.name}`))).toEqual([]);
		const after = fingerprint(actor);
		const [again] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		expect(planSummary(again)).toBeNull();
		expect(fingerprint(actor)).toEqual(after);
	});

	it.each(CASES)('%s %i: pool values of kept items survive', async (cls, level) => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await build02(env, cls, level);
		const seeded = seedPools(env, actor);
		acceptEverything(env);
		await migrate(migration, actor, 'to203');
		for (const id of Object.keys(seeded).filter((i) => actor.items.has(i))) {
			expect(actor.items.get(id).flags.nimble.chargePools['test-pool'].current).toBe(seeded[id]);
		}
	});
});

describe('round trips (class-module prompts closed: nothing picked, nothing dropped by choice)', () => {
	it.each(CASES)('%s %i: 2.0.3 → to02 → to203 gives back a fresh 2.0.3 build', async (cls, level) => {
		const actor = await build203(env, cls, level);
		const fresh = fingerprint(actor);
		const ids = new Set(actor.items.map((i) => i.id));
		await migrate(migration, actor, 'to02');
		await migrate(migration, actor, 'to203');
		expect(diff(fresh, fingerprint(actor))).toEqual({ missing: [], extra: [] });
		expect(duplicates(actor.items.map((i) => `${i.type}:${i.name}`))).toEqual([]);
		// Items replaced both ways keep their ids.
		const [clsItem] = actor.items.filter((i) => i.type === 'class');
		expect(ids.has(clsItem.id)).toBe(true);
	});

	it.each(CASES)('%s %i: 0.2 → to203 → to02 gives back a fresh 0.2 build', async (cls, level) => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await build02(env, cls, level);
		const fresh = fingerprint(actor);
		await migrate(migration, actor, 'to203');
		await migrate(migration, actor, 'to02');
		expect(diff(fresh, fingerprint(actor))).toEqual(JUSTIFIED_02_ROUND_TRIP[`${cls}:${level}`] ?? { missing: [], extra: [] });
	});
});
