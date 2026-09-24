/**
 * Zephyr (classes/zephyr.mjs, subclasses/zephyr.mjs): intentionally a no-op in
 * both directions — no preview, no writes, no dialog, at any level, with an
 * official or a Nim+ subclass. (Level 1–20 × both directions with Way of Flame
 * is also in matrix-zephyr-way-of-flame.test.mjs.)
 */
import { describe, expect, it } from 'vitest';
import { itemsNamed } from '../harness/index.mjs';
import { LEVELS, buildChar, runMigration, snapshotItems, sourceOf, world } from './helpers.mjs';

describe.each(['to02', 'to203'])('zephyr %s', (direction) => {
	const version = direction === 'to02' ? '2.0.3' : '0.2';

	it.each(LEVELS)('L%i with Way of Hurricanes (Nim+) and martial arts picks: nothing planned, nothing written', async (L) => {
		const { env, migration, sync } = await world(direction);
		const actor = await buildChar(env, 'zephyr', L, {
			version,
			subclass: L >= 3 ? 'Way of Hurricanes' : undefined,
			picks: L >= 4 ? ['Airshift', 'Blur'] : [],
		});
		const before = snapshotItems(actor);
		expect(await migration.planCoreClassMigration({ actors: [actor], direction })).toEqual([]);
		const run = await runMigration(env, migration, actor, direction);
		expect(run.result).toBe('nothing');
		expect(run.log).toEqual([]);
		expect(snapshotItems(actor)).toEqual(before);
		expect(actor.calls).toEqual([]);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
	});

	it('the class and subclass modules contribute no lines even when something else (a spell) is migrated', async () => {
		const { env, migration } = await world(direction);
		const actor = await buildChar(env, 'zephyr', 6, { version, subclass: 'Way of Flame', spells: ['Zap'] });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction });
		expect(plan.classes).toHaveLength(1);
		expect(plan.classes[0].modules.map((m) => m.classId)).toEqual(['zephyr', 'zephyr']);
		expect(plan.classes[0].lines).toEqual([]);
		const zap = itemsNamed(actor, 'Zap')[0];
		const others = actor.items.filter((i) => i.id !== zap.id).map((i) => i.toObject());
		await runMigration(env, migration, actor, direction);
		expect(actor.items.filter((i) => i.id !== zap.id).map((i) => i.toObject())).toEqual(others);
		expect(sourceOf(actor.items.get(zap.id))).toMatch(direction === 'to02' ? /nim-plus-spells/ : /nimble-spells/);
	});
});
