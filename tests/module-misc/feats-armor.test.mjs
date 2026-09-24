/**
 * Feats — conditional Armor: Defensive Duelist, Dual Wielder, Bulwark aura
 * (scripts/feats/mechanics/armor.mjs, helpers.mjs, bulwark-hooks.mjs), applied
 * through the character prepareDerivedData patch in scripts/core/document-patches.mjs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { character, featItem, featsWorld, shieldItem, weaponItem } from './feats-helpers.mjs';

const BASE = 12;
const armorOf = (actor) => actor.system.attributes.armor.value;

async function armored(env, { feats = [], weapons = [], extra = [], ...rest } = {}) {
	return character(env, {
		items: [...feats.map((f) => featItem(f)), ...weapons.map((w) => (typeof w === 'string' ? weaponItem(w) : weaponItem(w[0], w[1]))), ...extra],
		system: { attributes: { armor: { value: BASE, hint: 'base' } } },
		...rest,
	});
}

describe('Defensive Duelist / Dual Wielder', () => {
	let env;
	beforeEach(async () => {
		({ env } = await featsWorld({ systemPacks: ['classes'] }));
	});

	it.each([
		['Dagger (DEX melee)', ['Dagger'], [], 2],
		['Rapier', ['Rapier'], [], 2],
		['Longbow (ranged DEX)', ['Longbow'], [], 0],
		['Sling (ranged DEX)', ['Sling'], [], 0],
		['Greatsword (STR)', ['Greatsword'], [], 0],
		['Dagger + shield', ['Dagger'], [shieldItem()], 0],
		['Dagger + unequipped shield', ['Dagger'], [shieldItem({ equipped: false })], 2],
		['unequipped Dagger', [['Dagger', { equipped: false }]], [], 0],
		['no weapon', [], [], 0],
	])('Defensive Duelist with %s → +%i', async (_l, weapons, extra, bonus) => {
		const actor = await armored(env, { feats: ['Defensive Duelist'], weapons, extra });
		expect(armorOf(actor)).toBe(BASE + bonus);
	});

	it.each([
		['Dagger + Dagger', ['Dagger', 'Dagger'], 1],
		['Dagger + Rapier', ['Dagger', 'Rapier'], 1],
		['one Dagger', ['Dagger'], 0],
		['Dagger + unequipped Rapier', ['Dagger', ['Rapier', { equipped: false }]], 0],
	])('Dual Wielder with %s → +%i', async (_l, weapons, bonus) => {
		const actor = await armored(env, { feats: ['Dual Wielder'], weapons });
		expect(armorOf(actor)).toBe(BASE + bonus);
	});

	it.fails('BUG-module-misc-103: Dual Wielder gives no Armor for two equipped two-handed weapons (Longbow + Greatsword)', async () => {
		const actor = await armored(env, { feats: ['Dual Wielder'], weapons: ['Longbow', 'Greatsword'] });
		expect(armorOf(actor)).toBe(BASE);
	});

	it('both feats stack (+3) and the hint names them', async () => {
		const actor = await armored(env, { feats: ['Defensive Duelist', 'Dual Wielder'], weapons: ['Dagger', 'Rapier'] });
		expect(armorOf(actor)).toBe(BASE + 3);
		expect(actor.system.attributes.armor.hint).toBe('base + Defensive Duelist + Dual Wielder');
	});

	it('applied exactly once per prepare (derived only), and follows equip toggles', async () => {
		const actor = await armored(env, { feats: ['Defensive Duelist'], weapons: ['Dagger'] });
		actor.prepareData();
		actor.prepareData();
		expect(armorOf(actor)).toBe(BASE + 2);
		expect(actor._source.system.attributes.armor.value).toBe(BASE);
		const dagger = actor.items.find((i) => i.name === 'Dagger');
		await dagger.update({ 'system.equipped': false });
		expect(armorOf(actor)).toBe(BASE);
	});

	it('no bonus without the feat, with the setting off, or on an NPC', async () => {
		expect(armorOf(await armored(env, { weapons: ['Dagger', 'Rapier'] }))).toBe(BASE);
		const npc = await armored(env, { feats: ['Defensive Duelist'], weapons: ['Dagger'] });
		npc._source.type = 'npc';
		npc.prepareData();
		expect(armorOf(npc)).toBe(BASE);
		({ env } = await featsWorld({ enabled: false, systemPacks: ['classes'] }));
		expect(armorOf(await armored(env, { feats: ['Defensive Duelist'], weapons: ['Dagger'] }))).toBe(BASE);
	});
});

describe('Bulwark aura', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld({ systemPacks: ['classes'] }));
	});

	function scene(tokens) {
		const sc = { grid: { size: 100 }, tokens };
		for (const t of tokens) t.parent = sc;
		globalThis.canvas = { ready: true, scene: sc };
		return sc;
	}
	const tok = (actor, x, y, extra = {}) => ({ actor, actorId: actor.id, x, y, width: 1, height: 1, disposition: 1, ...extra });

	it.each([
		['orthogonally adjacent', 100, 0, {}, 2],
		['diagonally adjacent', -100, 100, {}, 2],
		['two cells away', 200, 0, {}, 0],
		['overlapping', 0, 0, {}, 2],
		['a large (2x2) ally touching a corner', -200, -200, { width: 2, height: 2 }, 2],
		['a large (2x2) ally one cell short', -300, -300, { width: 2, height: 2 }, 0],
		['a hostile Bulwark', 100, 0, { disposition: -1 }, 0],
	])('ally with Bulwark %s → +%i', async (_l, x, y, extra, bonus) => {
		const me = await armored(env);
		const ally = await armored(env, { feats: ['Bulwark'], name: 'Ally' });
		scene([tok(me, 0, 0), tok(ally, x, y, extra)]);
		me.prepareData();
		expect(armorOf(me)).toBe(BASE + bonus);
	});

	it('the Bulwark owner does not buff itself', async () => {
		const me = await armored(env, { feats: ['Bulwark'] });
		scene([tok(me, 0, 0)]);
		me.prepareData();
		expect(armorOf(me)).toBe(BASE);
	});

	it('an NPC with a Bulwark item grants nothing', async () => {
		const me = await armored(env);
		const npc = await armored(env, { feats: ['Bulwark'], name: 'NPC' });
		npc._source.type = 'npc';
		npc.prepareData();
		scene([tok(me, 0, 0), tok(npc, 100, 0)]);
		me.prepareData();
		expect(armorOf(me)).toBe(BASE);
	});

	it('two adjacent Bulwark allies → +4, hint "Bulwark ×2"', async () => {
		const me = await armored(env);
		const a = await armored(env, { feats: ['Bulwark'], name: 'A' });
		const b = await armored(env, { feats: ['Bulwark'], name: 'B' });
		scene([tok(me, 0, 0), tok(a, 100, 0), tok(b, 0, 100)]);
		me.prepareData();
		expect(armorOf(me)).toBe(BASE + 4);
		expect(me.system.attributes.armor.hint).toMatch(/Bulwark ×2/);
	});

	it('canvas not ready / no scene / no token of mine → no aura', async () => {
		const me = await armored(env);
		const ally = await armored(env, { feats: ['Bulwark'], name: 'Ally' });
		scene([tok(me, 0, 0), tok(ally, 100, 0)]);
		globalThis.canvas.ready = false;
		me.prepareData();
		expect(armorOf(me)).toBe(BASE);
		scene([tok(ally, 100, 0)]);
		me.prepareData();
		expect(armorOf(me)).toBe(BASE);
	});

	it('token hooks re-prepare PC actors only when a Bulwark is on the scene and a PC moved', async () => {
		const me = await armored(env);
		const ally = await armored(env, { feats: ['Bulwark'], name: 'Ally' });
		const tokens = [tok(me, 0, 0), tok(ally, 300, 0)];
		scene(tokens);
		const spy = vi.spyOn(me, 'prepareData');
		// Non-position change → nothing.
		env.Hooks.callAll('updateToken', tokens[1], { name: 'x' });
		expect(spy).not.toHaveBeenCalled();
		// Move the ally adjacent.
		tokens[1].x = 100;
		env.Hooks.callAll('updateToken', tokens[1], { x: 100 });
		expect(spy).toHaveBeenCalled();
		expect(armorOf(me)).toBe(BASE + 2);
		// Settled-movement second pass.
		spy.mockClear();
		let done;
		tokens[1].object = { movementAnimationPromise: new Promise((r) => (done = r)) };
		env.Hooks.callAll('updateToken', tokens[1], { y: 0 });
		expect(spy).toHaveBeenCalledTimes(1);
		done();
		await env.flush();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('no Bulwark anywhere → token moves never re-prepare', async () => {
		const me = await armored(env);
		const other = await armored(env, { name: 'Other' });
		const tokens = [tok(me, 0, 0), tok(other, 100, 0)];
		scene(tokens);
		const spy = vi.spyOn(me, 'prepareData');
		env.Hooks.callAll('updateToken', tokens[1], { x: 100 });
		env.Hooks.callAll('createToken', tokens[1]);
		env.Hooks.callAll('canvasReady');
		expect(spy).not.toHaveBeenCalled();
	});

	it('an NPC token moving is ignored', async () => {
		const me = await armored(env);
		const ally = await armored(env, { feats: ['Bulwark'], name: 'Ally' });
		const npc = await armored(env, { name: 'Goblin' });
		npc._source.type = 'npc';
		npc.prepareData();
		const tokens = [tok(me, 0, 0), tok(ally, 100, 0), tok(npc, 500, 0)];
		scene(tokens);
		const spy = vi.spyOn(me, 'prepareData');
		env.Hooks.callAll('updateToken', tokens[2], { x: 600 });
		expect(spy).not.toHaveBeenCalled();
		m.armor.refreshBulwarkAuras();
		expect(spy).toHaveBeenCalledTimes(1);
	});
});
