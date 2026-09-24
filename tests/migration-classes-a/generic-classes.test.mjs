/**
 * Berserker / Hunter / Oathsworn / Mage: their class modules are no-ops (generic
 * pass only); Hunter's subclass module restores Keeper of the Shadowpath's Pack Hunter.
 * Verify the generic pass really covers what each module header claims.
 */
import { describe, expect, it } from 'vitest';
import { findDoc, itemsNamed, setupWorld, sourceOf } from '../harness/index.mjs';
import { build, classPrompts, expectedFromPlan, picksByGroup, runMigration, snapshot } from './helpers.mjs';

const NIM = 'nim-plus-package.nim-plus-class-features';
const SYS = 'nimble.nimble-class-features';
const doc = (pack, name, where) => findDoc({ pack, name, where }).doc;
const uuid = (pack, name, where) => findDoc({ pack, name, where }).uuid;

async function world(direction, opts = {}) {
	const { env, mods } = await setupWorld({ playtest: direction === 'to02', ...opts });
	return { env, migration: mods[3], mods };
}

const ruleTypes = (item) => (item.system.rules ?? []).map((r) => `${r.type}:${r.identifier || r.id}`);

describe('berserker', () => {
	it('L20 to02: BOUNDLESS RAGE replaced in place; Fury (Rage) pool untouched; no class lines or prompts', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'berserker', 20, '2.0.3');
		const [br] = itemsNamed(actor, 'BOUNDLESS RAGE');
		const [rage] = itemsNamed(actor, 'Rage');
		const rageBefore = structuredClone(rage.toObject());
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.classes.flatMap((c) => c.lines)).toEqual([]);
		await runMigration(env, migration, actor, 'to02');
		expect(sourceOf(actor.items.get(br.id))).toBe(uuid(NIM, 'BOUNDLESS RAGE'));
		expect(actor.items.get(rage.id).toObject()).toEqual(rageBefore);
		expect(classPrompts(env)).toEqual([]);
	});

	it('L20 to203: BOUNDLESS RAGE goes back to the system doc', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'berserker', 20, '0.2');
		const [br] = itemsNamed(actor, 'BOUNDLESS RAGE');
		await runMigration(env, migration, actor, 'to203');
		expect(sourceOf(actor.items.get(br.id))).toBe(uuid(SYS, 'BOUNDLESS RAGE'));
	});

	it('to02: Death Blow loses its Fury diceConsumer (0.2 doc has none — no stale rule survives the replace)', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'berserker', 4, '2.0.3');
		const [db] = itemsNamed(actor, 'Death Blow');
		expect(ruleTypes(db)).toContain('diceConsumer:death-blow-fury-consumer');
		await runMigration(env, migration, actor, 'to02');
		const after = actor.items.get(db.id);
		expect(sourceOf(after)).toBe(uuid(NIM, 'Death Blow'));
		expect(after.system.rules.filter((r) => r.type === 'diceConsumer')).toEqual([]);
		expect(after.system.rules).toEqual(doc(NIM, 'Death Blow').system.rules);
		// ... and back.
		env.dialogs.reset();
		await runMigration(env, migration, actor, 'to203');
		expect(ruleTypes(actor.items.get(db.id))).toContain('diceConsumer:death-blow-fury-consumer');
	});

	it('Deathless Rage charge pool and MORE BLOOD! rules follow the side; pool state kept both ways', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'berserker', 10, '2.0.3');
		const [dr] = itemsNamed(actor, 'Deathless Rage');
		const [mb] = itemsNamed(actor, 'MORE BLOOD!');
		const poolBefore = structuredClone(dr.flags.nimble.chargePools);
		await runMigration(env, migration, actor, 'to02');
		expect(actor.items.get(dr.id).flags.nimble.chargePools).toEqual(poolBefore);
		expect(ruleTypes(actor.items.get(mb.id))).toContain('modifyToggle:more-blood-auto-rage');
		env.dialogs.reset();
		await runMigration(env, migration, actor, 'to203');
		expect(actor.items.get(dr.id).flags.nimble.chargePools).toEqual(poolBefore);
		expect(ruleTypes(actor.items.get(mb.id))).not.toContain('modifyToggle:more-blood-auto-rage');
	});

	it('Savage Arsenal picks never re-levelled: counts unchanged at every arsenal level', async () => {
		for (const level of [4, 6, 8, 10, 12, 14, 16]) {
			const { env, migration } = await world('to02');
			const actor = await build(env, 'berserker', level, '2.0.3');
			const before = picksByGroup(actor);
			const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
			expect(plan.manual.join(' '), `L${level}`).toMatch(/savage arsenal/);
			await runMigration(env, migration, actor, 'to02');
			expect(picksByGroup(actor)).toEqual(before);
		}
	});
});

describe('oathsworn', () => {
	it.each([1, 3, 5, 10, 14, 20])('L%i: Radiant Judgement keeps its judgment dice pool state both ways', async (level) => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'oathsworn', level, '2.0.3');
		const [rj] = itemsNamed(actor, 'Radiant Judgement');
		const pool = structuredClone(rj.flags.nimble.dicePools.judgment);
		expect(pool.current).toEqual([4, 2]);
		await runMigration(env, migration, actor, 'to02');
		const after = actor.items.get(rj.id);
		expect(sourceOf(after)).toBe(uuid(NIM, 'Radiant Judgement'));
		expect(after.flags.nimble.dicePools.judgment).toEqual(pool);
		// The 0.2 doc still defines the pool under the same identifier.
		expect(after.system.rules.find((r) => r.type === 'dicePool')?.identifier).toBe('judgment');
		env.dialogs.reset();
		await runMigration(env, migration, actor, 'to203');
		expect(actor.items.get(rj.id).flags.nimble.dicePools.judgment).toEqual(pool);
		expect(sourceOf(actor.items.get(rj.id))).toBe(uuid(SYS, 'Radiant Judgement'));
	});

	it('L2 to02: Zealot and Mana and Radiant Spellcasting replaced; no class lines', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'oathsworn', 2, '2.0.3');
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.replacements.map((r) => r.item.name)).toEqual(
			expect.arrayContaining(['Oathsworn', 'Zealot', 'Mana and Radiant Spellcasting', 'Radiant Judgement']),
		);
		expect(plan.removals).toEqual([]);
		expect(plan.additions).toEqual([]);
		expect(plan.classes.flatMap((c) => c.lines)).toEqual([]);
	});
});

describe('mage', () => {
	it.each([1, 4, 9, 13, 20])('L%i: generic only — class item, spellcasting features and Echo Casting replaced in place', async (level) => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'mage', level, '2.0.3');
		const ids = actor.items.map((i) => i.id).sort();
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.removals).toEqual([]);
		expect(plan.additions).toEqual([]);
		expect(plan.classes.flatMap((c) => c.lines)).toEqual([]);
		await runMigration(env, migration, actor, 'to02');
		expect(actor.items.map((i) => i.id).sort()).toEqual(ids);
		const cls = actor.items.find((i) => i.type === 'class');
		expect(cls.system.classLevel).toBe(level);
		expect(cls.system.hpData).toHaveLength(level);
	});
});

describe('hunter (Keeper of the Shadowpath via subclasses/hunter.mjs + restore-203)', () => {
	it('L11 to02: Pack Hunter retired; subclass sync adds Dread Hunter afterwards', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'hunter', 11, '2.0.3');
		const [pack] = itemsNamed(actor, 'Pack Hunter');
		const r = await runMigration(env, migration, actor, 'to02');
		expect(actor.items.has(pack.id)).toBe(false);
		expect(r.migrationDiff.added.map((x) => x.name)).not.toContain('Dread Hunter');
		expect(itemsNamed(actor, 'Dread Hunter')).toHaveLength(1);
	});

	it('L11 to203: Dread Hunter removed, Pack Hunter restored (describe line = migrate)', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'hunter', 11, '0.2');
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		const exp = expectedFromPlan(plan);
		expect(exp.added).toEqual(['Pack Hunter']);
		expect(exp.removed).toEqual(['Dread Hunter']);
		const r = await runMigration(env, migration, actor, 'to203');
		expect(r.migrationDiff.added.map((x) => x.name)).toEqual(['Pack Hunter']);
		expect(itemsNamed(actor, 'Pack Hunter').map(sourceOf)).toEqual([uuid(SYS, 'Pack Hunter')]);
	});

	it('L10 to203: nothing to restore below level 11', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'hunter', 10, '0.2');
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		expect(plan?.classes.flatMap((c) => c.lines) ?? []).toEqual([]);
	});

	it('L11 to203 twice: Pack Hunter is not restored a second time', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'hunter', 11, '0.2');
		await runMigration(env, migration, actor, 'to203');
		env.dialogs.reset();
		const again = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		expect(again).toEqual([]);
		expect(itemsNamed(actor, 'Pack Hunter')).toHaveLength(1);
	});

	it('L11 to203 with a legacy-sourced (flags.core.sourceId) 0.2 character: same result', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'hunter', 11, '0.2', { legacySourceId: true });
		await runMigration(env, migration, actor, 'to203');
		expect(itemsNamed(actor, 'Pack Hunter')).toHaveLength(1);
		expect(itemsNamed(actor, 'Dread Hunter')).toHaveLength(0);
		const again = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		expect(again).toEqual([]);
	});

	it('Nim+ own subclass (Keeper of Traps) is not touched by restore-203', async () => {
		const { env, migration } = await world('to203');
		const actor = await build(env, 'hunter', 11, '0.2', { subclass: false });
		const { buildCharacterAtLevel } = await import('../harness/index.mjs');
		const traps = await buildCharacterAtLevel(env, 'hunter', 11, { version: '0.2', subclass: 'Keeper of Traps' });
		const [plan] = await migration.planCoreClassMigration({ actors: [traps], direction: 'to203' });
		expect(plan?.classes.flatMap((c) => c.lines) ?? []).toEqual([]);
		expect(actor).toBeTruthy();
	});

	it(
		'fixed BUG-migration-classes-a-6: a player (owner) migrating to02 never gets the 0.2 subclass features (sync runs for the GM only) — Dread Hunter missing',
		async () => {
			const { env, migration } = await world('to02');
			const actor = await build(env, 'hunter', 11, '2.0.3');
			env.setUser({ isGM: false });
			const r = await runMigration(env, migration, actor, 'to02');
			expect(r.result).toBe('applied');
			expect(itemsNamed(actor, 'Dread Hunter')).toHaveLength(1);
		},
	);
});

describe('orchestrator scoping and robustness (these classes)', () => {
	it('the classes filter leaves other classes alone', async () => {
		const { env, migration } = await world('to02');
		const actor = await build(env, 'oathsworn', 5, '2.0.3');
		const before = snapshot(actor);
		const r = await runMigration(env, migration, actor, 'to02');
		expect(r.result).toBe('applied');
		const other = await build(env, 'mage', 5, '2.0.3');
		const res = await migration.migrateCoreClasses({ actors: [other], classes: ['oathsworn'], direction: 'to02', apply: true });
		expect(res).toBe('nothing');
		expect(other.calls).toEqual([]);
		expect(before.size).toBeGreaterThan(0);
	});

	it('an actor with no class item is skipped', async () => {
		const { env, migration } = await world('to02');
		const { makeCharacter } = await import('../harness/index.mjs');
		const actor = await makeCharacter(env, { features: [uuid(SYS, 'Death Blow')] });
		// No class → the class module never runs, but the generic pass still replaces a superseded item.
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan?.classes ?? []).toEqual([]);
	});

	it.each(['berserker', 'hunter', 'oathsworn', 'mage'])('%s: the startup pass (interactive: false) gives the same end state as the sheet run — no choice steps, nothing pending', async (classId) => {
		const a = await world('to02');
		const x = await build(a.env, classId, 12, '2.0.3');
		await runMigration(a.env, a.migration, x, 'to02');
		const b = await world('to02');
		const y = await build(b.env, classId, 12, '2.0.3');
		b.env.dialogs.fallback = 'throw';
		await b.migration.migrateCoreClasses({ actors: [y], direction: 'to02', interactive: false });
		expect(b.env.dialogs.log).toEqual([]);
		expect(b.migration.pendingChoices(y, 'to02')).toEqual({});
		const sig = (actor) => actor.items.map((i) => `${i.type}|${sourceOf(i)}`).sort();
		expect(sig(y)).toEqual(sig(x));
	});
});
