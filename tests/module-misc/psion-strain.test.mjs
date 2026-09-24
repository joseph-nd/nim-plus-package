import { beforeEach, describe, expect, it } from 'vitest';
import { importScripts, installFoundry, MODULE_ID } from '../harness/index.mjs';
import { feature, installScriptedRoll, makeActor, psionClass, strainOf } from './psion-helpers.mjs';

describe('psion strain math (scripts/psion/strain.mjs)', () => {
	let env, strain;
	beforeEach(async () => {
		env = installFoundry();
		installScriptedRoll(env);
		strain = await importScripts('scripts/psion/strain.mjs');
	});

	describe('strainGetDieSize', () => {
		it.each([
			[1, 6],
			[4, 6],
			[5, 8],
			[9, 8],
			[10, 10],
			[16, 10],
			[17, 12],
			[20, 12],
		])('level %i → d%i', (level, size) => {
			const actor = makeActor(env, { items: [psionClass(level)] });
			expect(strain.strainGetDieSize(actor)).toBe(size);
		});

		it('no actor / no psion class → d6', () => {
			expect(strain.strainGetDieSize(null)).toBe(6);
			expect(strain.strainGetDieSize(makeActor(env))).toBe(6);
		});

		it('ignores a non-psion class at level 20 (multiclass)', () => {
			const actor = makeActor(env, {
				items: [psionClass(2), { name: 'Berserker', type: 'class', system: { classLevel: 18 } }],
			});
			expect(strain.strainGetDieSize(actor)).toBe(6);
		});
	});

	describe('strainGain / strainLose / strainClear', () => {
		it('gain accumulates and posts a chat card', async () => {
			const actor = makeActor(env, { items: [psionClass(5)] });
			expect(await strain.strainGain(actor)).toBe(1);
			expect(await strain.strainGain(actor, 2)).toBe(3);
			expect(strainOf(actor)).toBe(3);
			expect(env.ChatMessage.created).toHaveLength(2);
			expect(env.ChatMessage.created[1].content).toContain('d8');
		});

		it.each([
			[0, 0],
			[-3, 0],
			['abc', 0],
			[2.9, 2],
			[NaN, 0],
		])('gain(%s) adds %i and never goes negative', async (n, added) => {
			const actor = makeActor(env, { flags: { [MODULE_ID]: { psion: { strainDice: 1 } } } });
			const next = await strain.strainGain(actor, n);
			expect(next).toBe(1 + added);
			expect(strainOf(actor)).toBe(1 + added);
		});

		it('gain with count 0 writes nothing and posts nothing', async () => {
			const actor = makeActor(env);
			await strain.strainGain(actor, 0);
			expect(env.ChatMessage.created).toHaveLength(0);
			expect(strainOf(actor)).toBeUndefined();
		});

		it('lose clamps at 0 and reports what was actually removed', async () => {
			const actor = makeActor(env, { flags: { [MODULE_ID]: { psion: { strainDice: 2 } } } });
			expect(await strain.strainLose(actor, 5)).toBe(0);
			expect(strainOf(actor)).toBe(0);
			expect(env.ChatMessage.created.at(-1).flavor).toContain('−2');
		});

		it('lose at 0 is a no-op (no write, no chat)', async () => {
			const actor = makeActor(env);
			expect(await strain.strainLose(actor, 1)).toBe(0);
			expect(env.ChatMessage.created).toHaveLength(0);
			expect(env.log.filter((l) => l.method === 'update')).toHaveLength(0);
		});

		it('negative lose does not add dice', async () => {
			const actor = makeActor(env, { flags: { [MODULE_ID]: { psion: { strainDice: 2 } } } });
			expect(await strain.strainLose(actor, -4)).toBe(2);
			expect(strainOf(actor)).toBe(2);
		});

		it('gain then lose round-trips (hand-correctable)', async () => {
			const actor = makeActor(env);
			await strain.strainGain(actor, 3);
			await strain.strainLose(actor, 3);
			expect(strainOf(actor)).toBe(0);
		});

		it('clear removes the flag; clearing an unset flag writes nothing', async () => {
			const actor = makeActor(env, { flags: { [MODULE_ID]: { psion: { strainDice: 4 } } } });
			await strain.strainClear(actor);
			expect(strainOf(actor)).toBeUndefined();
			const writes = env.log.length;
			await strain.strainClear(actor);
			expect(env.log.length).toBe(writes);
		});

		it('null actor is tolerated everywhere', async () => {
			expect(await strain.strainGain(null)).toBe(0);
			expect(await strain.strainLose(undefined)).toBe(0);
			await expect(strain.strainClear(null)).resolves.toBeUndefined();
			expect(strain.strainShow(null)).toBeNull();
			expect(await strain.strainRoll(null)).toEqual({ rolled: [], broken: false });
		});

		it('names are HTML-escaped in chat', async () => {
			const actor = makeActor(env, { name: '<b>x</b>' });
			await strain.strainGain(actor, 1);
			expect(env.ChatMessage.created[0].content).toContain('&lt;b&gt;');
		});

		it('strainShow reports count and size', () => {
			const actor = makeActor(env, { items: [psionClass(10)], flags: { [MODULE_ID]: { psion: { strainDice: 3 } } } });
			expect(strain.strainShow(actor)).toEqual({ count: 3, size: 10 });
		});
	});

	describe('strainRoll', () => {
		const withStrain = (n, extra = {}) =>
			makeActor(env, {
				items: [psionClass(1), ...(extra.items ?? [])],
				flags: { [MODULE_ID]: { psion: { strainDice: n } } },
				statuses: extra.statuses ?? ['concentration'],
			});

		it('empty pool rolls nothing', async () => {
			const actor = withStrain(0);
			expect(await strain.strainRoll(actor)).toEqual({ rolled: [], broken: false });
			expect(env.rolls).toHaveLength(0);
		});

		it('no 1 → not broken, concentration kept', async () => {
			const actor = withStrain(3);
			env.rollQueue.push([2, 5, 6]);
			const r = await strain.strainRoll(actor);
			expect(r).toEqual({ rolled: [2, 5, 6], broken: false });
			expect(env.rolls[0].formula).toBe('3d6');
			expect(actor.statusToggles).toEqual([]);
		});

		it('a 1 breaks concentration and stashes the inflight roll', async () => {
			const actor = withStrain(2);
			env.rollQueue.push([1, 4]);
			const r = await strain.strainRoll(actor);
			expect(r.broken).toBe(true);
			expect(actor.statusToggles).toEqual([{ id: 'concentration', active: false }]);
			expect(actor.getFlag(MODULE_ID, 'psion.strainBreakInflight')).toEqual({ rolled: [1, 4], sum: 5 });
		});

		it('broken but not concentrating: no toggle, no inflight flag', async () => {
			const actor = withStrain(1, { statuses: [] });
			env.rollQueue.push([1]);
			const r = await strain.strainRoll(actor);
			expect(r.broken).toBe(true);
			expect(actor.statusToggles).toEqual([]);
			expect(actor.getFlag(MODULE_ID, 'psion.strainBreakInflight')).toBeUndefined();
		});

		it.each([
			[[1, 3], false],
			[[1, 1], true],
			[[1, 1, 1], true],
			[[2, 3], false],
		])('New Core Ability absorbs exactly one 1: %j → broken=%s', async (dice, broken) => {
			const actor = withStrain(dice.length, { items: [feature('New Core Ability')] });
			env.rollQueue.push(dice);
			expect((await strain.strainRoll(actor)).broken).toBe(broken);
		});

		it('actorIsPsion', () => {
			expect(strain.actorIsPsion(makeActor(env, { items: [psionClass(1)] }))).toBe(true);
			expect(strain.actorIsPsion(makeActor(env))).toBe(false);
			expect(strain.actorIsPsion(null)).toBe(false);
		});
	});
});
