/**
 * Vol IV — manual charge spending (charges.mjs) and the wondrous-item macros
 * (wondrous.mjs): Battlemage Gloves, Cloak of the Fold, Duneguard's Brooch,
 * Sight of the Blind Oracle, Guidance of the Elements, Magic Jellybeans,
 * Tear of a Unicorn.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { bootVol4, idealWait, itemByName, realItem, vol4Actor } from './vol-helpers.mjs';
import { fakeDialogElement, foundryWait } from './psion-helpers.mjs';

let env, charges, wondrous;

beforeEach(async () => {
	({ env, charges, wondrous } = await bootVol4());
});

const poolItem = (pools, rules = []) => ({
	name: 'Charged Thing',
	type: 'object',
	system: { objectType: 'misc', quantity: 1, rules },
	flags: pools ? { nimble: { chargePools: pools } } : {},
});

describe('vol4SpendCharge', () => {
	const rule = (identifier, max) => ({ type: 'chargePool', identifier, max, scope: 'item' });

	it.each([
		['pool present', { p: { current: 3, max: 5 } }, [rule('p', '5')], 2],
		['pool absent, rule max "1" (fresh item)', null, [rule('p', '1')], 0],
		['pool absent, no rule → max 1', null, [], 0],
		['GM raised current above max by hand', { p: { current: 7, max: 5 } }, [rule('p', '5')], 6],
		['pool without current → starts at max', { p: { max: 4 } }, [], 3],
	])('%s', async (_label, pools, rules, expected) => {
		const actor = vol4Actor(env, { items: [poolItem(pools, rules)] });
		const item = actor.items.contents[0];
		await expect(charges.vol4SpendCharge(item, 'p')).resolves.toBe(true);
		expect(item.flags.nimble.chargePools.p.current).toBe(expected);
	});

	it('refuses (and does not write) at 0 charges', async () => {
		const actor = vol4Actor(env, { items: [poolItem({ p: { current: 0, max: 3 } })] });
		const item = actor.items.contents[0];
		await expect(charges.vol4SpendCharge(item, 'p')).resolves.toBe(false);
		expect(actor.callsOf('update')).toHaveLength(0);
		expect(env.notifications.messages('warn')[0]).toMatch(/no charges/);
	});

	it('keeps the other pool fields and never goes negative over repeated spends', async () => {
		const actor = vol4Actor(env, { items: [poolItem({ p: { current: 2, max: 2, recoveries: [{ trigger: 'safeRest' }] } })] });
		const item = actor.items.contents[0];
		const results = [];
		for (let i = 0; i < 4; i += 1) results.push(await charges.vol4SpendCharge(item, 'p'));
		expect(results).toEqual([true, true, false, false]);
		expect(item.flags.nimble.chargePools.p).toMatchObject({ current: 0, max: 2, recoveries: [{ trigger: 'safeRest' }] });
	});

	it.fails('BUG-module-misc-300: on a nimble-dev install the charge is written under the system scope (flags.nimble-dev)', async () => {
		({ env, charges } = await bootVol4({ systemId: 'nimble-dev' }));
		const actor = vol4Actor(env, {
			items: [{ name: 'X', type: 'object', system: { objectType: 'misc', rules: [] }, flags: { 'nimble-dev': { chargePools: { p: { current: 2, max: 2 } } } } }],
		});
		const item = actor.items.contents[0];
		await charges.vol4SpendCharge(item, 'p');
		expect(item.flags['nimble-dev'].chargePools.p.current).toBe(1);
		expect(item.flags.nimble).toBeUndefined();
	});
});

describe('charge-backed macros on the real items', () => {
	it('Sight of the Blind Oracle: spends its 1 charge and blinds; second use refused without blinding again', async () => {
		const actor = vol4Actor(env, { items: [realItem('Sight of the Blind Oracle')] });
		const item = itemByName(actor, 'Sight of the Blind Oracle');
		await wondrous.vol4BlindOracle(actor, item);
		expect(item.flags.nimble.chargePools['blind-oracle'].current).toBe(0);
		expect(actor.statuses.has('blinded')).toBe(true);
		actor.statuses.clear();
		expect(await wondrous.vol4BlindOracle(actor, item)).toBeNull();
		expect(actor.statuses.has('blinded')).toBe(false);
	});

	it('Guidance of the Elements: 1d4 → Water on a 3, charge spent', async () => {
		const actor = vol4Actor(env, { items: [realItem('Guidance of the Elements')] });
		const item = itemByName(actor, 'Guidance of the Elements');
		env.rollQueue.push([3]);
		await wondrous.vol4ElementalGuidance(actor, item);
		expect(env.ChatMessage.created.at(-1).flavor).toMatch(/Water/);
		expect(item.flags.nimble.chargePools['elemental-guidance'].current).toBe(0);
	});

	it.each([[1, 'Green Bean'], [8, 'White Bean']])('Jellybeans: 1d8 = %i → %s', async (face, bean) => {
		const actor = vol4Actor(env, { items: [realItem("Traveling Tom's Magic Jellybeans")] });
		const item = actor.items.contents[0];
		env.rollQueue.push([face]);
		await wondrous.vol4Jellybean(actor, item);
		expect(env.ChatMessage.created.at(-1).flavor).toContain(bean);
	});

	it('Jellybeans: exactly 5 bites, then refused', async () => {
		const actor = vol4Actor(env, { items: [realItem("Traveling Tom's Magic Jellybeans")] });
		const item = actor.items.contents[0];
		const out = [];
		for (let i = 0; i < 6; i += 1) out.push((await wondrous.vol4Jellybean(actor, item)) !== null);
		expect(out).toEqual([true, true, true, true, true, false]);
		expect(item.flags.nimble.chargePools.jellybeans.current).toBe(0);
	});
});

describe('Battlemage Gloves — Infusion', () => {
	const mk = (mana, tier) =>
		vol4Actor(env, { key: 3, system: { resources: { mana: { current: mana }, highestUnlockedSpellTier: tier } }, items: [realItem('Battlemage Gloves')] });

	it.each([
		// mana, tier, asked, spent, die
		[5, 2, 3, 2, 8],
		[5, 3, 1, 1, 6],
		[1, 5, 4, 1, 6],
		[5, 2, 0, 0, 4],
		[0, 3, 2, 0, 4],
		[9, 9, 9, 9, 20],
	])('mana %i tier %i asks %i → spends %i, rolls 1d%i', async (mana, tier, asked, spent, die) => {
		const actor = mk(mana, tier);
		env.dialogs.answer(idealWait('ok', { mana: asked }));
		await wondrous.vol4BattlemageInfusion(actor, actor.items.contents[0]);
		expect(actor.system.resources.mana.current).toBe(mana - spent);
		expect(env.rolls.at(-1).formula).toBe(`1d${die} + @arcana${spent ? ` + ${spent * 3}` : ''}`);
	});

	it('negative input spends nothing', async () => {
		const actor = mk(4, 4);
		env.dialogs.answer(idealWait('ok', { mana: -3 }));
		await wondrous.vol4BattlemageInfusion(actor, actor.items.contents[0]);
		expect(actor.system.resources.mana.current).toBe(4);
	});

	it('fixed BUG-module-misc-301: Cancel (Foundry returns the "cancel" action) still posts a strike', async () => {
		const actor = mk(4, 2);
		env.dialogs.answer(foundryWait('cancel'));
		const result = await wondrous.vol4BattlemageInfusion(actor, actor.items.contents[0]);
		expect(result).toBeNull();
		expect(env.rolls).toHaveLength(0);
	});

	it('fixed BUG-module-misc-302: the mana typed in the real dialog is ignored (nested <form> is dropped, callback reads 0)', async () => {
		const actor = mk(4, 2);
		env.dialogs.answer(foundryWait('ok', { dialog: { element: fakeDialogElement({ mana: { value: '2' } }) } }));
		await wondrous.vol4BattlemageInfusion(actor, actor.items.contents[0]);
		expect(actor.system.resources.mana.current).toBe(2);
	});
});

describe('Cloak of the Fold — Reality Fold', () => {
	it.each([
		[10, 4, 4],
		[10, 20, 9],
		[5, 1, 1],
	])('hp %i asks %i spaces → pays %i HP', async (hp, asked, paid) => {
		const actor = vol4Actor(env, { hp, items: [realItem('Cloak of the Fold')] });
		env.dialogs.answer(idealWait('ok', { spaces: asked }));
		await wondrous.vol4RealityFold(actor, actor.items.contents[0]);
		expect(actor.system.attributes.hp.value).toBe(hp - paid);
		expect(actor.system.attributes.hp.value).toBeGreaterThan(0);
	});

	it('0 spaces → nothing', async () => {
		const actor = vol4Actor(env, { hp: 10, items: [realItem('Cloak of the Fold')] });
		env.dialogs.answer(idealWait('ok', { spaces: 0 }));
		expect(await wondrous.vol4RealityFold(actor, actor.items.contents[0])).toBeNull();
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it.fails('BUG-module-misc-303: at 1 HP (nothing to pay) the fold still "teleports 0 spaces" and posts a card', async () => {
		const actor = vol4Actor(env, { hp: 1, items: [realItem('Cloak of the Fold')] });
		env.dialogs.answer(idealWait('ok', { spaces: 1 }));
		const out = await wondrous.vol4RealityFold(actor, actor.items.contents[0]);
		expect(out).toBeNull();
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('fixed BUG-module-misc-304: in the real dialog OK never teleports (form not found → 0 spaces)', async () => {
		const actor = vol4Actor(env, { hp: 10, items: [realItem('Cloak of the Fold')] });
		env.dialogs.answer(foundryWait('ok', { dialog: { element: fakeDialogElement({ spaces: { value: '3' } }) } }));
		await wondrous.vol4RealityFold(actor, actor.items.contents[0]);
		expect(actor.system.attributes.hp.value).toBe(7);
	});

	it('fixed BUG-module-misc-305: Cancel posts a "teleporting NaN spaces" card', async () => {
		const actor = vol4Actor(env, { hp: 10, items: [realItem('Cloak of the Fold')] });
		env.dialogs.answer(foundryWait('cancel'));
		expect(await wondrous.vol4RealityFold(actor, actor.items.contents[0])).toBeNull();
		expect(env.ChatMessage.created).toHaveLength(0);
	});
});

describe("Duneguard's Brooch", () => {
	it('confirmed → card + brooch deleted', async () => {
		const actor = vol4Actor(env, { items: [realItem("Duneguard's Brooch")] });
		env.dialogs.answer(true);
		await wondrous.vol4DuneguardBrooch(actor, actor.items.contents[0]);
		expect(actor.items.size).toBe(0);
		expect(env.ChatMessage.created).toHaveLength(1);
	});

	it.each([[false], [null]])('declined/closed (%s) → brooch kept, no card', async (answer) => {
		const actor = vol4Actor(env, { items: [realItem("Duneguard's Brooch")] });
		env.dialogs.answer(answer);
		await wondrous.vol4DuneguardBrooch(actor, actor.items.contents[0]);
		expect(actor.items.size).toBe(1);
		expect(env.ChatMessage.created).toHaveLength(0);
	});
});

describe('Tear of a Unicorn', () => {
	it('heals 20, clears wounds and every status, consumes one of a stack', async () => {
		const tear = realItem('Tear of a Unicorn');
		tear.system.quantity = 2;
		const actor = vol4Actor(env, { hp: 3, statuses: ['blinded', 'prone'], items: [tear] });
		await actor.update({ 'system.attributes.wounds.value': 2, 'system.attributes.hp.max': 40 });
		await wondrous.vol4UnicornTear(actor, actor.items.contents[0]);
		expect(actor.system.attributes.hp.value).toBe(23);
		expect(actor.system.attributes.wounds.value).toBe(0);
		expect([...actor.statuses]).toEqual([]);
		expect(actor.items.contents[0].system.quantity).toBe(1);
	});

	it('the last tear is deleted', async () => {
		const actor = vol4Actor(env, { items: [realItem('Tear of a Unicorn')] });
		await wondrous.vol4UnicornTear(actor, actor.items.contents[0]);
		expect(actor.items.size).toBe(0);
	});
});

describe('macros guard missing actor/item', () => {
	it.each([
		'vol4BattlemageInfusion',
		'vol4RealityFold',
		'vol4DuneguardBrooch',
		'vol4BlindOracle',
		'vol4ElementalGuidance',
		'vol4Jellybean',
		'vol4UnicornTear',
	])('%s(null, null) → null without dialogs', async (fn) => {
		expect(await wondrous[fn](null, null)).toBeNull();
		expect(env.dialogs.log).toHaveLength(0);
	});
});
