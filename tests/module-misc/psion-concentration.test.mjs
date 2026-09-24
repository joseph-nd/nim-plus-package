import { beforeEach, describe, expect, it } from 'vitest';
import { importScripts, installFoundry, MODULE_ID } from '../harness/index.mjs';
import { feature, installScriptedRoll, makeActor, psionClass, strainOf } from './psion-helpers.mjs';

const concentrationEffect = (actor) => ({ statuses: new Set(['concentration']), parent: actor });

describe('psion concentration hooks (scripts/psion/concentration.mjs)', () => {
	let env, strain;
	beforeEach(async () => {
		env = installFoundry();
		installScriptedRoll(env);
		[strain] = await importScripts(['scripts/psion/strain.mjs', 'scripts/psion/concentration.mjs']);
	});

	const psion = (n, { items = [], statuses = ['concentration'], extraFlags = {} } = {}) =>
		makeActor(env, {
			name: 'Mira',
			items: [psionClass(1), feature('Psionic Field'), ...items],
			flags: { [MODULE_ID]: { psion: { strainDice: n, ...extraFlags } } },
			statuses,
		});
	const inCombat = (...actors) => {
		env.game.combat = { combatants: actors.map((a) => ({ actorId: a.id, actor: a })) };
	};
	const fireDelete = async (actor, userId = env.game.user.id) => {
		env.Hooks.callAll('deleteActiveEffect', concentrationEffect(actor), {}, userId);
		await env.flush();
	};

	it('registers its hooks', () => {
		for (const h of ['nimbleCombatTurnEnd', 'deleteActiveEffect', 'deleteCombat', 'nim-plus-package.concentration-broken']) {
			expect(env.Hooks.count(h)).toBe(1);
		}
	});

	describe('turn end', () => {
		it('rolls strain for a psion with Psionic Field', async () => {
			const actor = psion(2);
			env.rollQueue.push([3, 4]);
			await env.Hooks.callAllAsync('nimbleCombatTurnEnd', { actor });
			expect(env.rolls.map((r) => r.formula)).toEqual(['2d6']);
		});

		it('I Can Hold sheds one die before the roll', async () => {
			const actor = psion(3, { items: [feature('I Can Hold!')] });
			env.rollQueue.push([3, 4]);
			await env.Hooks.callAllAsync('nimbleCombatTurnEnd', { actor });
			expect(env.rolls.map((r) => r.formula)).toEqual(['2d6']);
			expect(strainOf(actor)).toBe(2);
		});

		it('ignores actors without Psionic Field and missing combatant actors', async () => {
			const actor = makeActor(env, { flags: { [MODULE_ID]: { psion: { strainDice: 2 } } } });
			await env.Hooks.callAllAsync('nimbleCombatTurnEnd', { actor });
			await env.Hooks.callAllAsync('nimbleCombatTurnEnd', {});
			await env.Hooks.callAllAsync('nimbleCombatTurnEnd', null);
			expect(env.rolls).toHaveLength(0);
			expect(env.Hooks.errors).toEqual([]);
		});
	});

	describe('concentration ends', () => {
		it('voluntary end in combat clears strain silently (no damage, no incapacitate)', async () => {
			const actor = psion(3);
			inCombat(actor);
			await fireDelete(actor);
			expect(strainOf(actor)).toBeUndefined();
			expect(actor.statusToggles).toEqual([]);
			expect(env.ChatMessage.created).toHaveLength(0);
		});

		it('involuntary break reuses the stashed roll: damage card, incapacitated, reactor hook, strain cleared', async () => {
			const actor = psion(2);
			inCombat(actor);
			const broken = [];
			env.Hooks.on('nim-plus-package.concentration-broken', (p) => broken.push(p));
			env.rollQueue.push([1, 5]);
			await strain.strainRoll(actor); // toggles concentration off (mock does not fire the hook)
			await fireDelete(actor);
			expect(env.rolls).toHaveLength(1); // no second roll
			expect(actor.statusToggles).toContainEqual({ id: 'incapacitated', active: true });
			expect(broken).toHaveLength(1);
			expect(broken[0]).toMatchObject({ strainSum: 6, strainCount: 2, rolled: [1, 5] });
			expect(strainOf(actor)).toBeUndefined();
			expect(actor.getFlag(MODULE_ID, 'psion.strainBreakInflight')).toBeUndefined();
		});

		it('Mind Over Matter (2) drops the highest die from the damage', async () => {
			const actor = psion(3, {
				items: [feature('Mind Over Matter (2)')],
				extraFlags: { strainBreakInflight: { rolled: [1, 6, 3], sum: 10 } },
			});
			inCombat(actor);
			const broken = [];
			env.Hooks.on('nim-plus-package.concentration-broken', (p) => broken.push(p));
			await fireDelete(actor);
			expect(broken[0].strainSum).toBe(4);
		});

		it('inflight flag with no rolled dice triggers a fresh roll', async () => {
			const actor = psion(2, { extraFlags: { strainBreakInflight: { rolled: [], sum: 0 } } });
			inCombat(actor);
			env.rollQueue.push([2, 2]);
			await fireDelete(actor);
			expect(env.rolls.map((r) => r.formula)).toEqual(['2d6']);
		});

		it('only the triggering user resolves the break', async () => {
			const actor = psion(3);
			inCombat(actor);
			await fireDelete(actor, 'someoneElse0000');
			expect(strainOf(actor)).toBe(3);
		});

		it('non-concentration effects and non-psions are ignored', async () => {
			const actor = psion(3);
			inCombat(actor);
			env.Hooks.callAll('deleteActiveEffect', { statuses: new Set(['prone']), parent: actor }, {}, env.game.user.id);
			const other = makeActor(env, { flags: { [MODULE_ID]: { psion: { strainDice: 2 } } } });
			env.Hooks.callAll('deleteActiveEffect', concentrationEffect(other), {}, env.game.user.id);
			env.Hooks.callAll('deleteActiveEffect', { statuses: new Set(['concentration']), parent: { name: 'not an actor' } }, {}, env.game.user.id);
			await env.flush();
			expect(strainOf(actor)).toBe(3);
			expect(strainOf(other)).toBe(2);
			expect(env.Hooks.errors).toEqual([]);
		});

		it.fails('BUG-module-misc-200: a strain break rolled outside combat does not leave a stale inflight flag that later punishes a voluntary end', async () => {
			// Player presses the sheet widget's Roll button out of combat and rolls a 1.
			const actor = psion(2);
			env.rollQueue.push([1, 4]);
			await strain.strainRoll(actor);
			await fireDelete(actor); // no combat → handler bails before consuming the flag
			// Later, in combat, they drop the field voluntarily.
			actor.statuses.add('concentration');
			await strain.strainGain(actor, 1);
			inCombat(actor);
			actor.statusToggles.length = 0;
			await fireDelete(actor);
			expect(actor.statusToggles).not.toContainEqual({ id: 'incapacitated', active: true });
		});
	});

	describe('subclass reactors', () => {
		const reactor = async (actor, sum = 7) => {
			env.Hooks.callAll('nim-plus-package.concentration-broken', { actor, strainSum: sum });
			await env.flush();
		};

		it.each([
			[[], 3, 2],
			[['Reverberating Mind'], 6, 2],
			[['Big Mind'], 12, 3],
			[['Reverberating Mind', 'Big Mind'], 12, 3],
		])('Mind Collapse with %j → reach %i, %i dice', async (extra, reach, dice) => {
			const actor = psion(0, { items: [feature('Mind Collapse'), ...extra.map((n) => feature(n))] });
			await reactor(actor);
			const card = env.ChatMessage.created.find((m) => m.flavor.includes('Mind Collapse'));
			expect(card.content).toContain(`Reach <strong>${reach}</strong>`);
			expect(card.content).toContain(`<strong>${dice}</strong> Strain Dice`);
		});

		it('Mind Shield taunts at most WIL targets, skipping already-taunted', async () => {
			const actor = psion(0, { items: [feature('Mind Shield')] });
			actor.system.abilities.will.mod = 2;
			const mk = (name, taunted) => {
				const a = makeActor(env, { name, statuses: taunted ? ['taunted'] : [] });
				return { actor: a };
			};
			const targets = [mk('A', false), mk('B', true), mk('C', false)];
			env.game.user.targets = new Set(targets);
			await reactor(actor, 9);
			expect(targets[0].actor.statusToggles).toEqual([{ id: 'taunted', active: true }]);
			expect(targets[1].actor.statusToggles).toEqual([]);
			expect(targets[2].actor.statusToggles).toEqual([]); // third target is beyond WIL=2
			const card = env.ChatMessage.created.find((m) => m.flavor.includes('Mind Shield'));
			expect(card.content).toContain('<strong>9</strong> psychic damage');
		});

		it('Mind Shield with WIL ≤ 0 still allows one taunt', async () => {
			const actor = psion(0, { items: [feature('Mind Shield')] });
			actor.system.abilities.will.mod = -1;
			const t = { actor: makeActor(env, { name: 'T' }) };
			env.game.user.targets = new Set([t]);
			await reactor(actor);
			expect(t.actor.statusToggles).toHaveLength(1);
		});
	});

	describe('deleteCombat cleanup', () => {
		it('clears strain on every combatant that has it', async () => {
			const a = psion(3);
			const b = makeActor(env);
			env.Hooks.callAll('deleteCombat', { combatants: [{ actor: a }, { actor: b }, { actor: null }] });
			await env.flush();
			expect(strainOf(a)).toBeUndefined();
			expect(env.Hooks.errors).toEqual([]);
		});

		it.fails('BUG-module-misc-201: combat end also clears a pending strainBreakInflight flag', async () => {
			const a = psion(2, { extraFlags: { strainBreakInflight: { rolled: [1, 2], sum: 3 } } });
			env.Hooks.callAll('deleteCombat', { combatants: [{ actor: a }] });
			await env.flush();
			expect(a.getFlag(MODULE_ID, 'psion.strainBreakInflight')).toBeUndefined();
		});
	});
});
