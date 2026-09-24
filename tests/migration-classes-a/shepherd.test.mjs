/**
 * Shepherd — class module (classes/shepherd.mjs) through the orchestrator.
 *
 * Rules: Sacred Graces 2.0.3 = 2 at L5, 3 at L9, 4 at L13 (Assist Me is a grace);
 *        0.2 = 1 at L4, 2 at L9, 3 at L13 (Assist Me is a core L5 feature).
 *        0.2 My Buddy! (L1) teaches the Lifebinding Spirit cantrip and holds the actor
 *        `lifebindingMend` pool; 2.0.3 learns the tier-1 spell at L2 and has Searing Light (L1).
 */
import { describe, expect, it } from 'vitest';
import { findDoc, itemsNamed, setupWorld, sourceOf } from '../harness/index.mjs';
import { build, classPrompts, expectedFromPlan, picksByGroup, runMigration, snapshot } from './helpers.mjs';

const NIM = 'nim-plus-package.nim-plus-class-features';
const SYS = 'nimble.nimble-class-features';
const CANTRIP = 'Compendium.nim-plus-package.nim-plus-spells.Item.SAEd6Nk8SfgJ2Ff7';
const SPELL_203 = 'Compendium.nimble.nimble-spells.Item.KICmDNpyNoMuZ20E';
const SEARING_LIGHT_CORE = 'Compendium.nimble.nimble-class-features.Item.KQiBYDr1BBTE0iJq';
const ASSIST_CORE = findDoc({ pack: NIM, name: 'Assist Me, My Friend!' }).uuid;
const ASSIST_GRACE = findDoc({ pack: SYS, name: 'Assist Me, My Friend!' }).uuid;

async function world(direction) {
	const { env, mods } = await setupWorld({ playtest: direction === 'to02' });
	return { env, migration: mods[3] };
}
const graces = (actor) => picksByGroup(actor)['sacred-grace'] ?? [];
const allowed = (dir, lv) =>
	dir === 'to02' ? (lv >= 13 ? 3 : lv >= 9 ? 2 : lv >= 4 ? 1 : 0) : lv >= 13 ? 4 : lv >= 9 ? 3 : lv >= 5 ? 2 : 0;

describe('shepherd Sacred Graces', () => {
	// The boundary levels from the task: 4, 5, 8, 9, 12, 13, 20.
	const LEVELS = [4, 5, 8, 9, 12, 13, 20];

	describe.each([
		{ direction: 'to02', from: '2.0.3' },
		{ direction: 'to203', from: '0.2' },
	])('$direction', ({ direction, from }) => {
		it.each(LEVELS)('L%i: count reconciled to the target rules; prompt shows exactly the owned graces', async (level) => {
			const { env, migration } = await world(direction);
			const actor = await build(env, 'shepherd', level, from);
			const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction });
			const exp = expectedFromPlan(plan);
			let prompt = null;
			const r = await runMigration(env, migration, actor, direction, {
				pick: (o) => {
					prompt = o;
					return o.values.slice(-o.count); // keep/pick the LAST ones (a subset, not the default order)
				},
			});
			expect(r.result).toBe('applied');
			expect(graces(actor)).toHaveLength(allowed(direction, level));
			if (exp.askKeep) {
				// A "keep which" prompt: the options are the graces owned after the generic pass.
				expect(prompt.count).toBe(allowed(direction, level));
				expect(prompt.values.every((id) => r.before.has(id))).toBe(true);
				// The kept ones are the ones picked.
				const kept = actor.items.filter((i) => i.system?.group === 'sacred-grace').map((i) => i.id).sort();
				expect(kept).toEqual(prompt.values.slice(-prompt.count).sort());
			} else if (exp.askPick.length) {
				expect(prompt.count).toBe(exp.askPick[0].count);
			} else {
				expect(prompt).toBeNull();
			}
			// Assist Me is a core feature in 0.2 and a grace in 2.0.3.
			const assist = itemsNamed(actor, 'Assist Me, My Friend!');
			if (level >= 5) {
				expect(assist).toHaveLength(1);
				expect(sourceOf(assist[0])).toBe(direction === 'to02' ? ASSIST_CORE : ASSIST_GRACE);
			} else expect(assist).toHaveLength(0);
		});

		it.each(LEVELS)('L%i: cancelling the grace prompt leaves the graces as they were (+ a warning)', async (level) => {
			const { env, migration } = await world(direction);
			const actor = await build(env, 'shepherd', level, from);
			const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction });
			const exp = expectedFromPlan(plan);
			const graceIds = new Set(
				actor.items.filter((i) => i.system?.group === 'sacred-grace' || i.name === 'Assist Me, My Friend!').map((i) => i.id),
			);
			await runMigration(env, migration, actor, direction, { pick: 'cancel' });
			const prompted = exp.askKeep || exp.askPick.length;
			if (prompted) {
				expect(env.notifications.messages('warn').join('\n')).toMatch(/Sacred Grace/);
				// Nothing removed or added by the class module: every grace (or Assist Me) is still there.
				for (const id of graceIds) expect(actor.items.has(id)).toBe(true);
			}
		});
	});

	it('to02 L5: a 2.0.3 character who took Assist Me as a grace keeps one Assist Me (core) and one grace, no prompt', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', 5, '2.0.3', { picks: ['Assist Me, My Friend!', 'Light Bearer'] });
		const [assist] = itemsNamed(actor, 'Assist Me, My Friend!');
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.classes.flatMap((c) => c.lines).filter((l) => /Sacred Graces/.test(l))).toEqual([]);
		await runMigration(env, migration, actor, 'to02');
		expect(classPrompts(env)).toEqual([]);
		expect(itemsNamed(actor, 'Assist Me, My Friend!').map((i) => i.id)).toEqual([assist.id]);
		expect(sourceOf(actor.items.get(assist.id))).toBe(ASSIST_CORE);
		expect(graces(actor)).toEqual(['Light Bearer']);
	});

	it('to203 L4: the single 0.2 grace is removed without asking — preview says so', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'shepherd', 4, '0.2');
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		expect(plan.classes.flatMap((c) => c.lines)).toContain('Sacred Graces: Heroes 2.0.3 grants none before level 5 — all 1 removed');
		await runMigration(env, migration, actor, 'to203', { pick: 'cancel' });
		expect(graces(actor)).toEqual([]);
	});

	it.fails(
		'BUG-migration-classes-a-5: to203 L4 drops the only Sacred Grace with no prompt, so the GM cannot keep it (header: "nothing is dropped without that choice")',
		async () => {
			const { env, migration } = await world('to203');
			const actor = await build(env, 'shepherd', 4, '0.2');
			await runMigration(env, migration, actor, 'to203', { pick: 'cancel' });
			// Cancelling every class prompt should leave the grace in place.
			expect(graces(actor)).toEqual(['Light Bearer']);
		},
	);

	it('to203 L5: a 0.2-only grace (Dark Benediction) is removed and a 2.0.3 replacement is offered', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'shepherd', 5, '0.2', { picks: ['Dark Benediction'] });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		expect(plan.removals.map((r) => r.item.name)).toContain('Dark Benediction');
		expect(expectedFromPlan(plan).askPick).toEqual([{ group: 'sacred-grace', count: 1 }]);
		let offered;
		await runMigration(env, migration, actor, 'to203', {
			pick: (o) => {
				offered = o;
				return o.values.slice(0, 1);
			},
		});
		// 2.0.3 pool: system graces not owned by name (Assist Me is owned after the generic pass).
		for (const uuid of offered.values) expect(uuid).toMatch(/^Compendium\.nimble\.nimble-class-features\./);
		expect(offered.values).not.toContain(ASSIST_GRACE);
		expect(graces(actor)).toHaveLength(2);
	});

	it('to02 L4: a 2.0.3 character (no graces yet) is offered one 0.2 grace from the Nim+ pack', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', 4, '2.0.3');
		let offered;
		await runMigration(env, migration, actor, 'to02', {
			pick: (o) => {
				offered = o;
				return o.values.slice(0, 1);
			},
		});
		expect(offered.count).toBe(1);
		for (const uuid of offered.values) expect(uuid).toMatch(/nim-plus-class-features/);
		expect(graces(actor)).toHaveLength(1);
	});

	it('wrong-count answer re-prompts, then the right count is applied', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', 13, '2.0.3');
		let calls = 0;
		await runMigration(env, migration, actor, 'to02', {
			pick: (o) => {
				calls += 1;
				return calls === 1 ? o.values : o.values.slice(0, o.count);
			},
		});
		expect(calls).toBe(2);
		expect(graces(actor)).toHaveLength(3);
	});
});

describe('shepherd Lifebinding Spirit cantrip and My Buddy!', () => {
	it('to02 L1: My Buddy! and the cantrip are added, Searing Light retired', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', 1, '2.0.3');
		await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'My Buddy!')).toHaveLength(1);
		const spells = actor.items.filter((i) => i.type === 'spell');
		expect(spells.map(sourceOf)).toEqual([CANTRIP]);
		expect(itemsNamed(actor, 'Searing Light')).toHaveLength(0);
	});

	it.each([2, 5, 20])('to02 L%i: the owned 2.0.3 tier-1 spell is replaced in place, not duplicated', async (level) => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', level, '2.0.3');
		const [spell] = actor.items.filter((i) => i.type === 'spell');
		expect(sourceOf(spell)).toBe(SPELL_203);
		await runMigration(env, migration, actor, 'to02');
		const spells = actor.items.filter((i) => i.type === 'spell');
		expect(spells.map((s) => [s.id, sourceOf(s)])).toEqual([[spell.id, CANTRIP]]);
	});

	it('to02 L3: a 2.0.3 character that never learned the spell gets the cantrip (preview line matches)', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', 3, '2.0.3', { spells: [] });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(expectedFromPlan(plan).added).toContain('Lifebinding Spirit');
		await runMigration(env, migration, actor, 'to02');
		expect(actor.items.filter((i) => i.type === 'spell').map(sourceOf)).toEqual([CANTRIP]);
	});

	it('to203 L1: the cantrip is removed (2.0.3 learns the spell at 2); My Buddy! removed; Searing Light back', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'shepherd', 1, '0.2');
		await runMigration(env, migration, actor, 'to203');
		expect(actor.items.filter((i) => i.type === 'spell')).toEqual([]);
		expect(itemsNamed(actor, 'My Buddy!')).toHaveLength(0);
		expect(actor.items.filter((i) => sourceOf(i) === SEARING_LIGHT_CORE)).toHaveLength(1);
	});

	it.each([2, 7])('to203 L%i: the cantrip becomes the 2.0.3 tier-1 spell in place', async (level) => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'shepherd', level, '0.2');
		const [spell] = actor.items.filter((i) => i.type === 'spell');
		await runMigration(env, migration, actor, 'to203');
		expect(actor.items.filter((i) => i.type === 'spell').map((s) => [s.id, sourceOf(s)])).toEqual([[spell.id, SPELL_203]]);
	});

	it('Mend pool (actor-scoped lifebindingMend) survives to203 and back', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'shepherd', 6, '0.2');
		const pool = structuredClone(actor._source.flags.nimble.chargePools.lifebindingMend);
		expect(pool.current).toBe(1);
		await runMigration(env, migration, actor, 'to203');
		expect(actor._source.flags.nimble.chargePools.lifebindingMend).toEqual(pool);
		env.dialogs.reset();
		await runMigration(env, migration, actor, 'to02');
		expect(actor._source.flags.nimble.chargePools.lifebindingMend).toEqual(pool);
		expect(itemsNamed(actor, 'My Buddy!')).toHaveLength(1);
	});
});

describe('shepherd subclass (Luminary of Mercy)', () => {
	it(
		'fixed BUG-migration-classes-a-1: to203 does not restore the core Searing Light for a Luminary of Mercy (0.2 Mercy L7 feature has the same name)',
		async () => {
			const { env, migration } = await world('to203');
			const actor = await build(env, 'shepherd', 7, '0.2');
			await runMigration(env, migration, actor, 'to203');
			expect(actor.items.filter((i) => sourceOf(i) === SEARING_LIGHT_CORE)).toHaveLength(1);
		},
	);

	it('to203 L6 (no Mercy L7 feature yet): Searing Light is restored', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'shepherd', 6, '0.2');
		await runMigration(env, migration, actor, 'to203');
		expect(actor.items.filter((i) => sourceOf(i) === SEARING_LIGHT_CORE)).toHaveLength(1);
	});

	it('to02 L7: Conduit of Light becomes the Mercy "Searing Light" in place and the core Searing Light is removed', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', 7, '2.0.3');
		const [conduit] = itemsNamed(actor, 'Conduit of Light');
		await runMigration(env, migration, actor, 'to02');
		const searing = itemsNamed(actor, 'Searing Light');
		expect(searing.map((i) => i.id)).toEqual([conduit.id]);
		expect(searing[0].system.subclass).toBe(true);
	});

	// A 2.0.3 character who took Assist Me as a grace maps 1:1 onto 0.2 (Assist Me core + one grace fewer),
	// so the trip is lossless with no prompt at all.
	const withAssist = (level) =>
		['Assist Me, My Friend!', 'Light Bearer', 'Hasty Companion', 'Guiding Spirit'].slice(0, level >= 13 ? 4 : level >= 9 ? 3 : level >= 5 ? 2 : 0);

	it.each([1, 4, 5, 6, 9, 13, 20])('L%i round trip to02 → to203 keeps ids, sources and graces, with no prompt', async (level) => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'shepherd', level, '2.0.3', { subclass: level < 7, picks: withAssist(level) });
		const start = [...snapshot(actor).entries()].map(([id, x]) => `${id}|${x.source}`).sort();
		await runMigration(env, migration, actor, 'to02', { pick: 'cancel' });
		env.dialogs.reset();
		await runMigration(env, migration, actor, 'to203', { pick: 'cancel' });
		const end = [...snapshot(actor).entries()].map(([id, x]) => x.source).sort();
		// ids of the items that were never removed are kept (Searing Light / the L1 spell are re-created).
		expect(end).toEqual(start.map((s) => s.split('|')[1]).sort());
		expect(classPrompts(env).filter((p) => p.kind !== 'confirm')).toEqual([]);
	});
});
