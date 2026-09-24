import { beforeEach, describe, expect, it } from 'vitest';
import { importScripts, installFoundry, MODULE_ID } from '../harness/index.mjs';
import { feature, foundryWait, installScriptedRoll, makeActor } from './psion-helpers.mjs';

const LIVING_WEAPON = [
	{ id: 'tiny', label: 'Tiny — Light, Thrown 6', formula: '1d4 + @abilities.strength.mod', damageType: 'bludgeoning' },
	{ id: 'small', label: 'Small — Thrown 4', formula: '1d6 + @abilities.strength.mod', damageType: 'bludgeoning', default: true },
	{ id: 'medium', label: 'Medium — 2-handed', formula: '1d10 + @abilities.strength.mod', damageType: 'bludgeoning' },
];

describe('pickDamage (scripts/macros/pick-damage.mjs)', () => {
	let env, mod, actor, item;
	beforeEach(async () => {
		env = installFoundry();
		installScriptedRoll(env);
		mod = await importScripts('scripts/macros/pick-damage.mjs');
		actor = makeActor(env, { items: [feature('Living Weapon')] });
		item = actor.items.contents?.[0] ?? [...actor.items.values()][0];
	});

	it.each([
		[null, 'item', LIVING_WEAPON],
		['actor', null, LIVING_WEAPON],
		['actor', 'item', []],
		['actor', 'item', undefined],
		['actor', 'item', 'nope'],
	])('invalid args (%s, %s, %j) → error, no dialog', async (a, i, opts) => {
		const r = await mod.pickDamage(a && actor, i && item, opts);
		expect(r).toBeNull();
		expect(env.notifications.error).toHaveBeenCalled();
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('one button per option; the default option is the default button', async () => {
		env.dialogs.answer(null);
		await mod.pickDamage(actor, item, LIVING_WEAPON);
		const buttons = env.dialogs.log[0].config.buttons;
		expect(buttons.map((b) => b.action)).toEqual(['tiny', 'small', 'medium']);
		expect(buttons.filter((b) => b.default).map((b) => b.action)).toEqual(['small']);
	});

	it('first option is the default when none is marked', async () => {
		env.dialogs.answer(null);
		await mod.pickDamage(actor, item, LIVING_WEAPON.map(({ default: _d, ...o }) => o));
		expect(env.dialogs.log[0].config.buttons[0].default).toBe(true);
	});

	it.each(['tiny', 'small', 'medium'])('choosing %s rolls that formula against the actor roll data', async (id) => {
		env.dialogs.answer(foundryWait(id));
		await mod.pickDamage(actor, item, LIVING_WEAPON);
		const opt = LIVING_WEAPON.find((o) => o.id === id);
		expect(env.rolls.map((r) => r.formula)).toEqual([opt.formula]);
		expect(env.rolls[0].data.abilities.strength.mod).toBe(2);
		expect(env.ChatMessage.created[0].flavor).toContain('(bludgeoning)');
	});

	it('closing the dialog rolls nothing', async () => {
		env.dialogs.answer(null);
		expect(await mod.pickDamage(actor, item, LIVING_WEAPON)).toBeNull();
		expect(env.rolls).toHaveLength(0);
	});

	it('labels and formulas are escaped in the dialog', async () => {
		env.dialogs.answer(null);
		await mod.pickDamage(actor, item, [{ id: 'x', label: '<img src=x>', formula: '1d4' }]);
		expect(env.dialogs.log[0].content).not.toContain('<img src=x>');
	});
});

describe('seasonedJourneyman (scripts/macros/seasoned-journeyman.mjs)', () => {
	let env, mod, item;
	beforeEach(async () => {
		env = installFoundry();
		mod = await importScripts('scripts/macros/seasoned-journeyman.mjs');
	});
	const shepherd = (extra = []) => {
		const actor = makeActor(env, { items: [feature('Seasoned Journeyman'), ...extra.map((n) => feature(n))] });
		item = [...actor.items.values()].find((i) => i.name === 'Seasoned Journeyman');
		return actor;
	};

	it.each([
		['weapon', [], 3, 'damage'],
		['armor', [], 3, 'defense'],
		['weapon', ['Master of the Hammer'], 5, 'damage'],
		['armor', ['Master of the Hammer'], 5, 'defense'],
	])('%s with %j → +%i %s, flags stored', async (choice, extra, bonus, word) => {
		const actor = shepherd(extra);
		env.dialogs.answer(foundryWait(choice));
		await mod.seasonedJourneyman(actor, item);
		expect(actor.getFlag(MODULE_ID, 'journeymanChoice')).toBe(choice);
		expect(actor.getFlag(MODULE_ID, 'journeymanBonus')).toBe(bonus);
		expect(env.ChatMessage.created[0].content).toContain(`+${bonus} ${word}`);
	});

	it('closing the dialog stores nothing', async () => {
		const actor = shepherd();
		env.dialogs.answer(null);
		expect(await mod.seasonedJourneyman(actor, item)).toBeNull();
		expect(actor.getFlag(MODULE_ID, 'journeymanChoice')).toBeUndefined();
	});

	it('fixed BUG-module-misc-206: Cancel (callback → null → Foundry returns "cancel") stores nothing and posts no Armorsmith card', async () => {
		const actor = shepherd();
		env.dialogs.answer(foundryWait('cancel'));
		await mod.seasonedJourneyman(actor, item);
		expect(actor.getFlag(MODULE_ID, 'journeymanChoice')).toBeUndefined();
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('missing actor → error', async () => {
		expect(await mod.seasonedJourneyman(null, item)).toBeNull();
		expect(env.notifications.error).toHaveBeenCalled();
	});

	it.fails('BUG-module-misc-207: missing item does not throw (the null-actor path is guarded, the null-item path is not)', async () => {
		const actor = shepherd();
		env.dialogs.answer(null);
		await expect(mod.seasonedJourneyman(actor, undefined)).resolves.toBeNull();
	});

	describe('nimble.rest', () => {
		it('safe rest clears both flags; a field rest keeps them', async () => {
			const actor = shepherd();
			env.dialogs.answer(foundryWait('weapon'));
			await mod.seasonedJourneyman(actor, item);
			env.Hooks.callAll('nimble.rest', { restType: 'field', actor });
			await env.flush();
			expect(actor.getFlag(MODULE_ID, 'journeymanChoice')).toBe('weapon');
			env.Hooks.callAll('nimble.rest', { restType: 'safe', actor });
			await env.flush();
			expect(actor.getFlag(MODULE_ID, 'journeymanChoice')).toBeUndefined();
			expect(actor.getFlag(MODULE_ID, 'journeymanBonus')).toBeUndefined();
		});

		it('tolerates payloads without an actor or without flags', async () => {
			const actor = shepherd();
			env.Hooks.callAll('nimble.rest', { restType: 'safe' });
			env.Hooks.callAll('nimble.rest', { restType: 'safe', actor });
			env.Hooks.callAll('nimble.rest', null);
			await env.flush();
			expect(env.Hooks.errors).toEqual([]);
			expect(env.log.filter((l) => l.method === 'update')).toHaveLength(0);
		});
	});
});
