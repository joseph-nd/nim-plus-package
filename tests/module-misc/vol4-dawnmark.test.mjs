/**
 * Vol IV — dawnmark.mjs: Dawnmark apply/consume + on-hit hook, The Dwarf's
 * Delight crit, Regal Rest, Ladlor's Tenacity, and the flag helpers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../harness/index.mjs';
import { bootVol4, enforceOwnership, flagged, realItem, vol4Actor } from './vol-helpers.mjs';

let env, dawnmark;

beforeEach(async () => {
	({ env, dawnmark } = await bootVol4());
});

const stacks = (actor) => actor.getFlag(MODULE_ID, 'dawnmark');
const npc = (name = 'Goblin', opts = {}) => vol4Actor(env, { name, type: 'npc', hp: 30, owner: false, ...opts });
const target = (actor) => ({ actor, document: { actor } });

describe('vol4ItemFlag / vol4OwnedWithFlag', () => {
	it('filters objects by flag presence and (optionally) equipped state', () => {
		const actor = vol4Actor(env, {
			items: [
				flagged('A', { vol4RegalRest: true }, { equipped: false }),
				flagged('B', { vol4RegalRest: false }),
				flagged('C', { vol4RegalRest: true }, { type: 'feature' }),
				flagged('D', { other: 1 }),
			],
		});
		expect(dawnmark.vol4OwnedWithFlag(actor, 'vol4RegalRest').map((i) => i.name).sort()).toEqual(['A', 'B']);
		expect(dawnmark.vol4OwnedWithFlag(actor, 'vol4RegalRest', { equippedOnly: true }).map((i) => i.name)).toEqual(['B']);
		expect(dawnmark.vol4OwnedWithFlag(null, 'x')).toEqual([]);
	});
});

describe('vol4DawnmarkApply', () => {
	it('warns without a target', async () => {
		const hero = vol4Actor(env);
		env.game.user.targets = new Set();
		expect(await dawnmark.vol4DawnmarkApply(hero, null)).toBeNull();
		expect(env.notifications.messages('warn')).toHaveLength(1);
	});

	it('stacks one mark per use on the first target', async () => {
		const hero = vol4Actor(env);
		const gob = npc();
		env.game.user.targets = new Set([target(gob)]);
		const item = realItem('Cuirass of Blazing Justice');
		await dawnmark.vol4DawnmarkApply(hero, item);
		await dawnmark.vol4DawnmarkApply(hero, item);
		expect(stacks(gob)).toBe(2);
		expect(env.ChatMessage.created.at(-1).content).toMatch(/2 stacks/);
	});
});

describe('vol4DawnmarkConsume', () => {
	it.each([
		[1, 4],
		[2, 6],
		[5, 12],
		[6, 20],
		[11, 20],
	])('%i stack(s) → 1d%i, damage applied, mark cleared', async (n, die) => {
		const hero = vol4Actor(env);
		const gob = npc();
		await gob.setFlag(MODULE_ID, 'dawnmark', n);
		env.rollQueue.push([3]);
		await dawnmark.vol4DawnmarkConsume(hero, null, gob);
		expect(env.rolls.at(-1).formula).toBe(`1d${die}`);
		expect(gob.damaged).toEqual([3]);
		expect(gob.system.attributes.hp.value).toBe(27);
		expect(stacks(gob)).toBeUndefined();
	});

	it('no stacks → warning, no roll', async () => {
		const gob = npc();
		expect(await dawnmark.vol4DawnmarkConsume(vol4Actor(env), null, gob)).toBeNull();
		expect(env.rolls).toHaveLength(0);
	});

	it.each([
		['The Dawnstar', /adjacent/],
		['The Solar Flare', /Line 3/],
	])('%s names its splash on the card', async (name, re) => {
		const gob = npc();
		await gob.setFlag(MODULE_ID, 'dawnmark', 1);
		const hero = vol4Actor(env, { items: [realItem(name)] });
		await dawnmark.vol4DawnmarkConsume(hero, hero.items.contents[0], gob);
		expect(env.ChatMessage.created.at(-1).flavor).toMatch(re);
	});

	it('falls back to the user target when none is passed', async () => {
		const gob = npc();
		await gob.setFlag(MODULE_ID, 'dawnmark', 1);
		env.game.user.targets = new Set([target(gob)]);
		await dawnmark.vol4DawnmarkConsume(vol4Actor(env), null);
		expect(stacks(gob)).toBeUndefined();
	});
});

describe('nimble.useItem — on-hit Dawnmark', () => {
	const use = async (item, context) => {
		env.Hooks.callAll('nimble.useItem', item, null, context);
		await env.flush();
	};

	it('The Dawnstar hit marks the first target; a miss does nothing', async () => {
		const hero = vol4Actor(env, { items: [realItem('The Dawnstar')] });
		const gob = npc();
		const star = hero.items.contents[0];
		await use(star, { targets: [target(gob)], isMiss: true });
		expect(stacks(gob)).toBeUndefined();
		await use(star, { targets: [target(gob)] });
		expect(stacks(gob)).toBe(1);
	});

	it('with stacks present: accepting the consume prompt rolls, clears, then re-marks to 1', async () => {
		const hero = vol4Actor(env, { items: [realItem('The Dawnstar')] });
		const gob = npc();
		await gob.setFlag(MODULE_ID, 'dawnmark', 3);
		env.dialogs.answerWhen('Dawnmark', true);
		await use(hero.items.contents[0], { targets: [target(gob)] });
		expect(env.rolls.at(-1).formula).toBe('1d8');
		expect(stacks(gob)).toBe(1);
	});

	it('declining (or closing) the prompt just adds a stack', async () => {
		const hero = vol4Actor(env, { items: [realItem('The Dawnstar')] });
		const gob = npc();
		await gob.setFlag(MODULE_ID, 'dawnmark', 3);
		await use(hero.items.contents[0], { targets: [target(gob)] }); // unscripted → closed
		expect(env.rolls).toHaveLength(0);
		expect(stacks(gob)).toBe(4);
	});

	it.each([
		['radiant T1 with Focus equipped', 'radiant', 1, true, true],
		['radiant cantrip', 'radiant', 0, true, false],
		['fire T2', 'fire', 2, true, false],
		['radiant T1, Focus unequipped', 'radiant', 1, false, false],
	])('spell: %s → marks=%s', async (_l, school, tier, focusEquipped, marks) => {
		const focus = realItem('Focus of the New Dawn');
		focus.system.equipped = focusEquipped;
		const hero = vol4Actor(env, { items: [focus, { name: 'Ray', type: 'spell', system: { school, tier } }] });
		const gob = npc();
		const spell = hero.items.find((i) => i.type === 'spell');
		await use(spell, { targets: [target(gob)] });
		expect(stacks(gob) ?? 0).toBe(marks ? 1 : 0);
		expect(env.dialogs.log).toHaveLength(0); // spells never offer to consume
	});

	it('an unflagged weapon never marks', async () => {
		const hero = vol4Actor(env, { items: [{ name: 'Sword', type: 'object', system: { objectType: 'weapon' } }] });
		const gob = npc();
		await use(hero.items.contents[0], { targets: [target(gob)] });
		expect(stacks(gob)).toBeUndefined();
	});

	it.fails('BUG-module-misc-306: a PLAYER hitting a GM-owned NPC with The Dawnstar cannot mark it (target setFlag is a non-owner update)', async () => {
		env.setUser({ isGM: false });
		const hero = vol4Actor(env, { items: [realItem('The Dawnstar')] });
		const gob = enforceOwnership(env, npc());
		await use(hero.items.contents[0], { targets: [target(gob)] });
		expect(stacks(gob)).toBe(1);
	});

	it.fails('BUG-module-misc-307: on a nimble-dev install the on-hit/rest listeners never fire (hard-coded "nimble." hook names)', async () => {
		({ env, dawnmark } = await bootVol4({ systemId: 'nimble-dev' }));
		const hero = vol4Actor(env, { items: [realItem('The Dawnstar')] });
		const gob = npc();
		env.Hooks.callAll('nimble-dev.useItem', hero.items.contents[0], null, { targets: [target(gob)] });
		await env.flush();
		expect(stacks(gob)).toBe(1);
	});
});

describe("The Dwarf's Delight — Cheers! on crit", () => {
	const tok = (actor, x, y, disposition = 1) => ({ actor, document: { actor, actorId: actor.id, x, y, disposition } });

	function scene(level = 4) {
		const hero = vol4Actor(env, { level, items: [realItem("The Dwarf's Delight")] });
		const heroTok = tok(hero, 0, 0);
		hero.getActiveTokens = () => [heroTok.document];
		const near = vol4Actor(env, { name: 'Near' });
		const edge = vol4Actor(env, { name: 'Edge', temp: 9 });
		const far = vol4Actor(env, { name: 'Far' });
		const foe = vol4Actor(env, { name: 'Foe' });
		globalThis.canvas.grid = { size: 100 };
		globalThis.canvas.dimensions = { distance: 1 };
		globalThis.canvas.tokens.placeables = [heroTok, tok(near, 100, 100), tok(edge, 400, 0), tok(far, 500, 0), tok(foe, 100, 0, -1)];
		return { hero, near, edge, far, foe };
	}

	it('allies within Reach 4 gain LVL temp HP (never lowering a bigger pool); foes, far allies and self untouched', async () => {
		const { hero, near, edge, far, foe } = scene(4);
		env.Hooks.callAll('nimble.useItem', hero.items.contents[0], null, { isCritical: true });
		await env.flush();
		expect(near.system.attributes.hp.temp).toBe(4);
		expect(edge.system.attributes.hp.temp).toBe(9);
		expect(far.system.attributes.hp.temp).toBe(0);
		expect(foe.system.attributes.hp.temp).toBe(0);
		expect(hero.system.attributes.hp.temp).toBe(0);
		expect(env.ChatMessage.created).toHaveLength(1);
	});

	it('no crit → nothing', async () => {
		const { hero, near } = scene();
		env.Hooks.callAll('nimble.useItem', hero.items.contents[0], null, { isCritical: false });
		await env.flush();
		expect(near.system.attributes.hp.temp).toBe(0);
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it.fails("BUG-module-misc-308: a player's crit posts no Cheers! card when an ally belongs to someone else (one rejected update aborts the whole run)", async () => {
		const { hero, near, edge } = scene();
		env.setUser({ isGM: false });
		await near.update({ ownership: { default: 0 } });
		enforceOwnership(env, near);
		env.Hooks.callAll('nimble.useItem', hero.items.contents[0], null, { isCritical: true });
		await env.flush();
		expect(env.ChatMessage.created).toHaveLength(1);
		expect(edge.system.attributes.hp.temp).toBe(9);
	});
});

describe('Regal Rest', () => {
	it('any rest: temp HP = LVL when higher, card posted', async () => {
		const hero = vol4Actor(env, { level: 6, temp: 2, items: [realItem('Regal Rest')] });
		env.Hooks.callAll('nimble.rest', { actor: hero, restType: 'field' });
		await env.flush();
		expect(hero.system.attributes.hp.temp).toBe(6);
		expect(env.ChatMessage.created).toHaveLength(1);
	});

	it('does not lower a bigger temp pool; no bedroll → nothing', async () => {
		const hero = vol4Actor(env, { level: 3, temp: 8, items: [realItem('Regal Rest')] });
		const other = vol4Actor(env, { level: 3 });
		env.Hooks.callAll('nimble.rest', { actor: hero, restType: 'safe' });
		env.Hooks.callAll('nimble.rest', { actor: other, restType: 'safe' });
		env.Hooks.callAll('nimble.rest', {});
		await env.flush();
		expect(hero.system.attributes.hp.temp).toBe(8);
		expect(other.system.attributes.hp.temp).toBe(0);
		expect(env.Hooks.errors).toEqual([]);
	});
});

describe("Ladlor's Tenacity (preUpdateActor)", () => {
	const ladleHero = (opts = {}) => vol4Actor(env, { hp: 5, items: [realItem('Ladle of the Kobold Champion')], ...opts });
	const hit = (actor, n) => actor.applyDamage(n);

	it('once per combat: the drop to 0 becomes 1 HP; the next drop in the same combat goes through', async () => {
		env.game.combat = { id: 'combat0000000001' };
		const hero = ladleHero();
		await hit(hero, 50);
		expect(hero.system.attributes.hp.value).toBe(1);
		expect(hero.getFlag(MODULE_ID, 'ladlorUsedCombat')).toBe('combat0000000001');
		await env.flush();
		await hit(hero, 50);
		expect(hero.system.attributes.hp.value).toBe(0);
	});

	it('a new combat re-arms it', async () => {
		env.game.combat = { id: 'combatA' };
		const hero = ladleHero();
		await hit(hero, 9);
		await env.flush();
		await hero.update({ system: { attributes: { hp: { value: 5 } } } });
		env.game.combat = { id: 'combatB' };
		await hit(hero, 9);
		expect(hero.system.attributes.hp.value).toBe(1);
	});

	it.each([
		['outside combat', { combat: null }],
		['already at 0 HP', { hp: 0 }],
		['an NPC', { type: 'npc' }],
		['no ladle', { items: [] }],
	])('%s → no intercept', async (_l, { combat = { id: 'c1' }, ...opts }) => {
		env.game.combat = combat;
		const hero = ladleHero(opts);
		await hero.update({ system: { attributes: { hp: { value: 0 } } } });
		expect(hero.system.attributes.hp.value).toBe(0);
	});

	it('non-lethal damage and temp-only updates are untouched', async () => {
		env.game.combat = { id: 'c1' };
		const hero = ladleHero({ temp: 3 });
		await hit(hero, 2);
		expect(hero.system.attributes.hp.temp).toBe(1);
		expect(hero.system.attributes.hp.value).toBe(5);
		expect(hero.getFlag(MODULE_ID, 'ladlorUsedCombat')).toBeUndefined();
	});
});
