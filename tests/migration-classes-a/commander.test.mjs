/**
 * Commander — class module (classes/commander.mjs) through the orchestrator.
 *
 * Rules (Heroes 2.0.3 vs Nimble 0.2 sheet):
 *   2.0.3  L1 Commander's Orders card → Coordinated Strike!; L2 choose 2 Orders; L4 Fit for Any
 *          Battlefield: a Combat Tactic (Commanding Presence is a Tactic); 6/8/10/12/16 +1 ability.
 *   0.2    L1 Coordinated Strike! (own feature); L2 Fit for Any Battlefield: a Combat Tactic;
 *          L4 choose 2 Orders (Commanding Presence is an Order); 6/8/10/12/16 +1 ability.
 */
import { describe, expect, it } from 'vitest';
import { findDoc, itemsNamed, setupWorld, sourceOf } from '../harness/index.mjs';
import { build, choiceOptions, classPrompts, expectedFromPlan, picksByGroup, runMigration, snapshot } from './helpers.mjs';
import { pickCounts, LEGAL } from './matrix.mjs';

const NIM = 'nim-plus-package.nim-plus-class-features';
const SYS = 'nimble.nimble-class-features';
const nim = (name) => findDoc({ pack: NIM, name, where: (d) => !d.system?.subclass }).uuid;
const sys = (name) => findDoc({ pack: SYS, name, where: (d) => !d.system?.subclass }).uuid;

async function world(direction) {
	const { env, mods } = await setupWorld({ playtest: direction === 'to02' });
	return { env, migration: mods[3] };
}

async function planOf(migration, actor, direction) {
	const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction });
	return plan;
}

const lines = (plan) => plan.classes.flatMap((c) => c.lines);

describe('commander to02', () => {
	it.each([2, 3])('L%i: Orders listed, removed on confirm; one Nim+ Combat Tactic offered (subset pick)', async (level) => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', level, '2.0.3');
		const plan = await planOf(migration, actor, 'to02');
		const exp = expectedFromPlan(plan);
		expect(exp.askRemove).toEqual(['Face Me!', 'Hold the Line!']);
		expect(exp.askPick).toEqual([{ group: 'combat-tactics', count: 1 }]);

		let offered;
		const r = await runMigration(env, migration, actor, 'to02', {
			pick: (o) => {
				offered = o;
				return o.values.slice(-1);
			},
		});
		expect(r.result).toBe('applied');
		// Only 0.2 tactics gained by this level, Commanding Presence is not one of them any more.
		expect(offered.count).toBe(1);
		expect(offered.values.sort()).toEqual(
			['Heavy Strike', 'Inerrant Strike', 'Lunging Strike', 'Sweeping Strike'].map(nim).sort(),
		);
		expect(picksByGroup(actor)).toEqual({ 'combat-tactics': ['Sweeping Strike'] });
		const [tactic] = itemsNamed(actor, 'Sweeping Strike');
		expect(sourceOf(tactic)).toBe(nim('Sweeping Strike'));
	});

	it('L3: keeping the Orders (confirm = Keep) leaves them untouched; tactic cancel adds nothing', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 3, '2.0.3');
		const orders = itemsNamed(actor, 'Face Me!').concat(itemsNamed(actor, 'Hold the Line!'));
		const r = await runMigration(env, migration, actor, 'to02', { confirm: false, pick: 'cancel' });
		expect(r.result).toBe('applied');
		// Replaced in place by the generic pass (0.2 docs), but kept.
		for (const o of orders) {
			expect(actor.items.has(o.id)).toBe(true);
			expect(sourceOf(actor.items.get(o.id))).toMatch(/nim-plus-class-features/);
		}
		expect(picksByGroup(actor)['combat-tactics']).toBeUndefined();
	});

	it('L1: Coordinated Strike! becomes the standalone 0.2 feature; the Orders card goes; pools kept', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 1, '2.0.3', {
			pools: {
				'Coordinated Strike!': {
					chargePools: {
						'coordinated-strike-uses': { current: 2, max: 3, recoveries: [] },
						'coordinated-strike-round': { current: 0, max: 1, recoveries: [] },
					},
				},
			},
		});
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		const [card] = itemsNamed(actor, "Commander's Orders");
		expect(strike.system.grantedById).toBe(card.id);

		const plan = await planOf(migration, actor, 'to02');
		expect(plan.removals.map((r) => [r.item.name, r.reason])).toEqual([["Commander's Orders", 'now gained at level 4']]);
		expect(lines(plan)).toEqual([]); // nothing class-specific below L2

		await runMigration(env, migration, actor, 'to02');
		const after = actor.items.get(strike.id);
		expect(after).toBeTruthy();
		expect(sourceOf(after)).toBe(nim('Coordinated Strike!'));
		expect(after.system.group).toBe('commander-progression');
		expect(after.flags.nimble.chargePools['coordinated-strike-uses']).toEqual({ current: 2, max: 3, recoveries: [] });
		expect(after.flags.nimble.chargePools['coordinated-strike-round']).toEqual({ current: 0, max: 1, recoveries: [] });
		expect(actor.items.has(card.id)).toBe(false);
		expect(classPrompts(env)).toEqual([]);
	});

	it.fails(
		'BUG-migration-classes-a-2: to02 leaves Coordinated Strike! pointing (grantedById) at the removed 2.0.3 Orders card',
		async () => {
			const { env, migration } = await world('to02');
			const actor = await build(env, 'commander', 1, '2.0.3');
			const [strike] = itemsNamed(actor, 'Coordinated Strike!');
			await runMigration(env, migration, actor, 'to02');
			const fresh = await build(env, 'commander', 1, '0.2', { world: false });
			const [freshStrike] = itemsNamed(fresh, 'Coordinated Strike!');
			// A fresh 0.2 Commander's Coordinated Strike! is standalone.
			expect(freshStrike.system.grantedById).toBeUndefined();
			const id = actor.items.get(strike.id).system.grantedById;
			expect(id === undefined || actor.items.has(id)).toBe(true);
		},
	);

	it('L4: 2.0.3 picks Face Me!/Hold the Line!/Heavy Strike carry over, no prompts', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 4, '2.0.3');
		const plan = await planOf(migration, actor, 'to02');
		expect(lines(plan)).toEqual([]);
		await runMigration(env, migration, actor, 'to02');
		expect(classPrompts(env)).toEqual([]);
		expect(picksByGroup(actor)).toEqual({
			'combat-tactics': ['Heavy Strike'],
			'commanders-orders': ['Face Me!', 'Hold the Line!'],
		});
	});

	it('L4: Commanding Presence (a 2.0.3 Tactic) moves to Orders and a Tactic is offered', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 4, '2.0.3', { picks: ['Face Me!', 'Hold the Line!', 'Commanding Presence'] });
		const [cp] = itemsNamed(actor, 'Commanding Presence');
		const plan = await planOf(migration, actor, 'to02');
		// A choice step: marked so the startup pass defers it and the report says so.
		expect(lines(plan)).toEqual([
			expect.stringMatching(
				/^<i [^>]*data-nim-plus-choice="combat-tactic"[^>]*><\/i> Fit for Any Battlefield \(level 2\) brings a Combat Tactic: you will be asked to choose one$/,
			),
		]);
		expect(plan.pendingChoice).toBe(true);
		await runMigration(env, migration, actor, 'to02');
		const after = actor.items.get(cp.id);
		expect(sourceOf(after)).toBe(nim('Commanding Presence'));
		expect(after.system.group).toBe('commanders-orders');
		expect(picksByGroup(actor)['combat-tactics']).toHaveLength(1);
	});

	it.fails(
		'BUG-migration-classes-a-3: to02 L4 with Commanding Presence as the Tactic ends with 3 Orders + 1 Tactic (0.2 grants 3 abilities); no Order is dropped',
		async () => {
			const { env, migration } = await world('to02');
			const actor = await build(env, 'commander', 4, '2.0.3', { picks: ['Face Me!', 'Hold the Line!', 'Commanding Presence'] });
			await runMigration(env, migration, actor, 'to02');
			expect(pickCounts(actor, 'commander')).toEqual(LEGAL.commander('0.2', 4));
		},
	);

	it('L2: a 2.0.3 character is offered exactly one tactic even when the tactic prompt answer is a wrong count first', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 2, '2.0.3');
		let calls = 0;
		await runMigration(env, migration, actor, 'to02', {
			pick: (o) => {
				calls += 1;
				return calls === 1 ? o.values.slice(0, 2) : o.values.slice(0, 1);
			},
		});
		expect(calls).toBe(2);
		expect(env.notifications.messages('warn').join('\n')).toMatch(/Choose exactly 1/);
		expect(picksByGroup(actor)['combat-tactics']).toHaveLength(1);
	});

	it('preview lists the Orders before the generic pass renames nothing (names match what is removed)', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 3, '2.0.3', { picks: ['I Can Do This ALL DAY!', 'Move it! Move it!'] });
		const plan = await planOf(migration, actor, 'to02');
		const exp = expectedFromPlan(plan);
		expect(exp.askRemove).toEqual(['I Can Do This ALL DAY!', 'Move it! Move it!']);
		const r = await runMigration(env, migration, actor, 'to02');
		const confirm = classPrompts(env).find((p) => p.kind === 'confirm');
		expect(confirm.content).toMatch(/I Can Do This ALL DAY!/);
		expect(r.migrationDiff.removed.map((x) => x.name).sort()).toEqual(
			["Commander's Orders", 'I Can Do This ALL DAY!', 'Move it! Move it!'].sort(),
		);
	});
});

describe('commander to203', () => {
	it.each([1, 2, 3])('L%i: the 2.0.3 Orders card is added back and Coordinated Strike! restored in place', async (level) => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'commander', level, '0.2', {
			pools: { 'Coordinated Strike!': { chargePools: { 'coordinated-strike-encounter': { current: 0, max: 1, recoveries: [] } } } },
		});
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		const plan = await planOf(migration, actor, 'to203');
		expect(plan.additions.map((a) => a.doc.name)).toContain("Commander's Orders");
		await runMigration(env, migration, actor, 'to203');
		expect(sourceOf(actor.items.get(strike.id))).toBe(sys('Coordinated Strike!'));
		expect(actor.items.get(strike.id).flags.nimble.chargePools['coordinated-strike-encounter'].current).toBe(0);
		expect(itemsNamed(actor, 'Coordinated Strike!')).toHaveLength(1);
		expect(itemsNamed(actor, "Commander's Orders")).toHaveLength(1);
	});

	it.fails(
		'BUG-migration-classes-a-4: to203 preview tells the GM Coordinated Strike! "is now chosen at level Infinity" (the 2.0.3 doc has no gainedAtLevels)',
		async () => {
			const { env, migration } = await world('to203');
			const actor = await build(env, 'commander', 5, '0.2');
			const plan = await planOf(migration, actor, 'to203');
			expect(plan.manual.join('\n')).not.toMatch(/Infinity/);
		},
	);

	it.each([2, 3])('L%i: the Tactic is listed and removed on confirm; 2 Orders are offered (system Orders only)', async (level) => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'commander', level, '0.2');
		const plan = await planOf(migration, actor, 'to203');
		const exp = expectedFromPlan(plan);
		expect(exp.askRemove).toEqual(['Heavy Strike']);
		expect(exp.askPick).toEqual([{ group: 'commanders-orders', count: 2 }]);
		let offered;
		await runMigration(env, migration, actor, 'to203', {
			pick: (o) => {
				offered = o;
				return [o.values[0], o.values[2]];
			},
		});
		expect(offered.count).toBe(2);
		expect(offered.values.sort()).toEqual(
			["Face Me!", 'Hold the Line!', 'I Can Do This ALL DAY!', 'Move it! Move it!', 'Reposition!'].map(sys).sort(),
		);
		const by = picksByGroup(actor);
		expect(by['combat-tactics']).toBeUndefined();
		expect(by['commanders-orders']).toHaveLength(2);
		for (const i of actor.items.filter((i) => i.system?.group === 'commanders-orders')) expect(sourceOf(i)).toMatch(/^Compendium\.nimble\./);
	});

	it('L2: cancelling the Orders prompt and keeping the Tactic changes nothing class-specific', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'commander', 2, '0.2');
		const [heavy] = itemsNamed(actor, 'Heavy Strike');
		await runMigration(env, migration, actor, 'to203', { confirm: false, pick: 'cancel' });
		expect(actor.items.has(heavy.id)).toBe(true);
		expect(picksByGroup(actor)['commanders-orders']).toBeUndefined();
	});

	it('L4: Commanding Presence (a 0.2 Order) moves back to Tactics and the missing Order is offered', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'commander', 4, '0.2', { picks: ['Heavy Strike', 'Face Me!', 'Commanding Presence'] });
		const plan = await planOf(migration, actor, 'to203');
		expect(expectedFromPlan(plan).askPick).toEqual([{ group: 'commanders-orders', count: 1 }]);
		let offered;
		await runMigration(env, migration, actor, 'to203', {
			pick: (o) => {
				offered = o;
				return o.values.slice(0, 1);
			},
		});
		// Face Me! already owned → not offered.
		expect(offered.values).not.toContain(sys('Face Me!'));
		expect(picksByGroup(actor)['commanders-orders']).toHaveLength(2);
		expect(picksByGroup(actor)['combat-tactics']).toEqual(['Commanding Presence', 'Heavy Strike']);
	});

	it.fails(
		'BUG-migration-classes-a-3: to203 L4 with Commanding Presence as an Order ends with 2 Orders + 2 Tactics (2.0.3 grants 3 abilities)',
		async () => {
			const { env, migration } = await world('to203');
			const actor = await build(env, 'commander', 4, '0.2', { picks: ['Heavy Strike', 'Face Me!', 'Commanding Presence'] });
			await runMigration(env, migration, actor, 'to203');
			expect(pickCounts(actor, 'commander')).toEqual(LEGAL.commander('2.0.3', 4));
		},
	);
});

describe('commander round trips and edge cases', () => {
	it.each([1, 2, 3, 4, 5, 9, 18, 20])('L%i: to02 then to203 returns to the same sources, picks and pools', async (level) => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', level, '2.0.3');
		const start = snapshot(actor);
		const srcs = [...start.values()].map((x) => `${x.name}|${x.source}`).sort();
		// L2-3 would drop Orders and add a Tactic; keep the Orders and skip the tactic to make the trip reversible.
		await runMigration(env, migration, actor, 'to02', { confirm: false, pick: 'cancel' });
		env.dialogs.reset();
		await runMigration(env, migration, actor, 'to203', { confirm: false, pick: 'cancel' });
		const end = snapshot(actor);
		expect([...end.values()].map((x) => `${x.name}|${x.source}`).sort()).toEqual(srcs);
		// Pools and ids survive the trip.
		for (const [id, v] of start) {
			if (v.obj.flags?.nimble) expect(end.get(id)?.obj.flags.nimble, v.name).toEqual(v.obj.flags.nimble);
		}
	});

	it('legacy flags.core.sourceId: migrates and a second run finds nothing to do', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 5, '2.0.3', { legacySourceId: true });
		await runMigration(env, migration, actor, 'to02');
		for (const i of actor.items) expect(sourceOf(i)).toMatch(/nim-plus-package|nimble-class-features\.Item\.(KyQivlTfzYYudgsT)|nimble-subclasses/);
		const again = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(again).toEqual([]);
	});

	it('two Commanders in one run: each gets its own prompts', async () => {
		const { env, migration } = await world('to02');
		const a = await build(env, 'commander', 2, '2.0.3', { name: 'A' });
		const b = await build(env, 'commander', 3, '2.0.3', { name: 'B' });
		const { script } = await import('./helpers.mjs');
		script(env);
		const result = await migration.migrateCoreClasses({ actors: [a, b], direction: 'to02' });
		expect(result).toBe('applied');
		const prompts = classPrompts(env);
		expect(prompts.filter((p) => p.kind === 'confirm')).toHaveLength(2);
		expect(prompts.filter((p) => p.kind !== 'confirm')).toHaveLength(2);
		for (const actor of [a, b]) expect(picksByGroup(actor)).toEqual({ 'combat-tactics': [expect.any(String)] });
	});

	it('the tactic prompt offers nothing already owned by name (e.g. a hand-made Heavy Strike)', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'commander', 2, '2.0.3', {
			items: [{ name: 'Heavy Strike', type: 'feature', system: { class: 'commander', group: 'misc' } }],
		});
		let offered;
		await runMigration(env, migration, actor, 'to02', {
			pick: (o) => {
				offered = o;
				return null;
			},
		});
		expect(offered.values).not.toContain(nim('Heavy Strike'));
		expect(choiceOptions).toBeTypeOf('function');
	});
});

describe('commander subclasses that change the pick rules (subclasses/commander.mjs is a no-op)', () => {
	// Spellblade (official, both versions): "lose access to Weapon Mastery and Combat Tactics …
	// whenever you could choose a Combat Tactic … instead choose another Commander's Order".
	it.fails(
		'BUG-migration-classes-a-7: to02 offers a Spellblade Commander a Combat Tactic, which Spellblades cannot take',
		async () => {
			const { env, migration } = await world('to02');
			const { buildCharacterAtLevel } = await import('../harness/index.mjs');
			const sb = await buildCharacterAtLevel(env, 'commander', 4, {
				version: '2.0.3',
				subclass: 'Spellblade',
				picks: ['Face Me!', 'Hold the Line!', 'Reposition!'],
			});
			const [plan] = await migration.planCoreClassMigration({ actors: [sb], direction: 'to02' });
			expect(plan.classes.flatMap((c) => c.lines).join('\n')).not.toMatch(/Combat Tactic/);
			await runMigration(env, migration, sb, 'to02');
			expect(classPrompts(env).filter((p) => /Combat Tactic/.test(p.title))).toEqual([]);
			expect(picksByGroup(sb)['combat-tactics']).toBeUndefined();
		},
	);

	// Champion of the Arena (Nim+): "Single-minded Fighter. You forego all Commander's Orders."
	it.fails(
		"BUG-migration-classes-a-8: to203 asks a Champion of the Arena Commander to choose 2 Orders it foregoes",
		async () => {
			const { env, migration } = await world('to203');
			const { buildCharacterAtLevel } = await import('../harness/index.mjs');
			const arena = await buildCharacterAtLevel(env, 'commander', 5, {
				version: '0.2',
				subclass: 'Champion of the Arena',
				picks: ['Heavy Strike'],
			});
			const [plan] = await migration.planCoreClassMigration({ actors: [arena], direction: 'to203' });
			expect(plan?.classes.flatMap((c) => c.lines).join('\n') ?? '').not.toMatch(/Commander's Orders/);
			await runMigration(env, migration, arena, 'to203');
			expect(picksByGroup(arena)['commanders-orders']).toBeUndefined();
		},
	);
});
