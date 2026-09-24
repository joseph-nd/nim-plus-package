/**
 * Vol IV — runes.mjs (Dverung rune melding, vol4ConsumeOne) and weapons.mjs
 * (Bloodseeker, Elemental Weapon). Dialog answers use `idealWait` (the form
 * lookup the macros assume) for logic tests, and the realistic Foundry v14
 * answer (`foundryWait` + parser-dropped nested form) for the dialog bugs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../harness/index.mjs';
import { armor, bootVol4, idealWait, itemByName, realItem, vol4Actor, weapon } from './vol-helpers.mjs';
import { fakeDialogElement, foundryWait } from './psion-helpers.mjs';

let env, runes, weapons;

beforeEach(async () => {
	({ env, runes, weapons } = await bootVol4());
});

const runesOn = (item) => item.getFlag(MODULE_ID, 'vol4Runes') ?? [];

describe('vol4ConsumeOne', () => {
	it.each([
		[3, 2, true],
		[2, 1, true],
		[1, 0, false],
		[undefined, 0, false],
	])('quantity %s → %s left (kept=%s)', async (qty, left, kept) => {
		const data = { name: 'Potion', type: 'object', system: { objectType: 'consumable' } };
		if (qty !== undefined) data.system.quantity = qty;
		const actor = vol4Actor(env, { items: [data] });
		await runes.vol4ConsumeOne(actor.items.contents[0]);
		expect(actor.items.size).toBe(kept ? 1 : 0);
		if (kept) expect(actor.items.contents[0].system.quantity).toBe(left);
	});
});

describe('vol4ApplyRune — guards', () => {
	it('an item with no rune definition errors out', async () => {
		const actor = vol4Actor(env, { items: [weapon()] });
		expect(await runes.vol4ApplyRune(actor, { name: 'Rock', flags: {} })).toBeNull();
		expect(env.notifications.messages('error')).toHaveLength(1);
	});

	it('no eligible slot → warning, rune kept', async () => {
		const actor = vol4Actor(env, { items: [realItem('Hammer Rune'), armor()] });
		expect(await runes.vol4ApplyRune(actor, itemByName(actor, 'Hammer Rune'))).toBeNull();
		expect(itemByName(actor, 'Hammer Rune')).toBeTruthy();
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('armor runes accept shields too, never weapons', async () => {
		const actor = vol4Actor(env, { items: [realItem('Feather Rune'), weapon('Sword'), armor('Buckler', { objectType: 'shield' })] });
		env.dialogs.answer((config) => {
			expect(config.content).toContain('Buckler');
			expect(config.content).not.toContain('Sword');
			return null;
		});
		await runes.vol4ApplyRune(actor, itemByName(actor, 'Feather Rune'));
	});

	it('cancel on the target dialog: nothing changes', async () => {
		const actor = vol4Actor(env, { items: [realItem('Hammer Rune'), weapon()] });
		env.dialogs.answer(foundryWait('cancel'));
		await runes.vol4ApplyRune(actor, itemByName(actor, 'Hammer Rune'));
		expect(itemByName(actor, 'Hammer Rune')).toBeTruthy();
		expect(runesOn(itemByName(actor, 'Test Blade'))).toEqual([]);
	});
});

describe('vol4ApplyRune — melding (ideal dialog)', () => {
	const meld = async (runeName, targetData, extraAnswers = []) => {
		const actor = vol4Actor(env, { items: [realItem(runeName), targetData] });
		const target = actor.items.find((i) => i.name === targetData.name);
		env.dialogs.answer(idealWait('ok', { target: target.id }), ...extraAnswers);
		await runes.vol4ApplyRune(actor, itemByName(actor, runeName));
		return { actor, target: actor.items.get(target.id), rune: itemByName(actor, runeName) };
	};

	it('Slaying Rune: single-type damage node appended (force), rune consumed, meld recorded', async () => {
		const { target, rune } = await meld('Slaying Rune', weapon());
		const effects = target.system.activation.effects;
		expect(effects).toHaveLength(2);
		expect(effects[1]).toMatchObject({ type: 'damage', damageType: 'force', formula: '1d4', canCrit: false });
		expect(runesOn(target)).toEqual(['slaying']);
		expect(rune).toBeUndefined();
		expect(target.system.description.public).toContain('vs. the chosen creature type only');
	});

	it.each([['fire'], ['cold'], ['lightning']])('Elemental Rune: chosen type %s', async (dtype) => {
		const { target } = await meld('Elemental Rune', weapon(), [idealWait('ok', { dtype })]);
		expect(target.system.activation.effects.at(-1).damageType).toBe(dtype);
	});

	it('Elemental Rune: cancelling the type dialog (closed) keeps the rune and the weapon', async () => {
		const { target, rune } = await meld('Elemental Rune', weapon(), [null]);
		expect(rune).toBeTruthy();
		expect(target.system.activation.effects).toHaveLength(1);
	});

	it('fixed BUG-module-misc-309: pressing Cancel on the damage-type dialog melds a "cancel"-typed damage node and eats the rune', async () => {
		const { target, rune } = await meld('Elemental Rune', weapon(), [foundryWait('cancel')]);
		expect(rune).toBeTruthy();
		expect(target.system.activation.effects.map((e) => e.damageType)).not.toContain('cancel');
	});

	it('Hammer Rune: hit note added under the primary damage node', async () => {
		const { target } = await meld('Hammer Rune', weapon());
		const hit = target.system.activation.effects[0].on.hit;
		expect(hit.at(-1)).toMatchObject({ type: 'note', text: expect.stringMatching(/push the target/), parentNode: 'dmg0000000000000' });
	});

	it('Animosity Rune: damage node + miss note', async () => {
		const { target } = await meld('Animosity Rune', weapon());
		const eff = target.system.activation.effects;
		expect(eff[1]).toMatchObject({ formula: '1d6' });
		expect(eff[0].on.miss.at(-1)).toMatchObject({ noteType: 'warning' });
	});

	it.fails('BUG-module-misc-310: a hit-note rune melded into a weapon with no damage node is consumed but its effect is recorded nowhere', async () => {
		const { target, rune } = await meld('Death Rune', weapon('Net', { damage: null }));
		expect(rune).toBeUndefined();
		expect(target.system.description.public).toContain('gain 5 temp HP on kill');
	});

	it.each([
		['equipped', true, false],
		['unequipped', false, true],
	])('Protection Rune into %s armor: armorClass rule with disabled=%s', async (_l, equipped, disabled) => {
		const { target } = await meld('Protection Rune', armor('Mail', { equipped }));
		const rule = target.system.rules.at(-1);
		expect(rule).toMatchObject({ type: 'armorClass', formula: '1', mode: 'add', identifier: 'rune-protection', disabled });
		expect(rule.id.length).toBeLessThanOrEqual(16);
	});

	it('note-only armor rune (Feather) writes the description rider', async () => {
		const { target } = await meld('Feather Rune', armor());
		expect(target.system.description.public).toContain('immune to fall damage');
		expect(runesOn(target)).toEqual(['feather']);
	});

	it('a rune from a stack of 3 leaves 2', async () => {
		const runeData = realItem('Speed Rune');
		runeData.system.quantity = 3;
		const actor = vol4Actor(env, { items: [runeData, armor()] });
		env.dialogs.answer(idealWait('ok', { target: itemByName(actor, 'Test Mail').id }));
		await runes.vol4ApplyRune(actor, itemByName(actor, 'Speed Rune'));
		expect(itemByName(actor, 'Speed Rune').system.quantity).toBe(2);
	});
});

describe('vol4ApplyRune — rarity capacity', () => {
	const fill = async (targetData, count) => {
		const runeData = realItem('Light Rune');
		runeData.system.quantity = count + 1;
		const actor = vol4Actor(env, { items: [runeData, targetData] });
		const t = actor.items.find((i) => i.name === targetData.name);
		const results = [];
		for (let i = 0; i < count; i += 1) {
			env.dialogs.answer(idealWait('ok', { target: t.id }));
			results.push(await runes.vol4ApplyRune(actor, itemByName(actor, 'Light Rune')));
		}
		return { melded: runesOn(actor.items.get(t.id)).length, left: itemByName(actor, 'Light Rune')?.system.quantity ?? 0, results };
	};

	it.each([
		['mundane', '', 1],
		['Uncommon', '<p><strong>Uncommon Weapon</strong></p>', 1],
		['Rare', '<p><strong>Rare Weapon</strong></p>', 2],
		['Very Rare', '<p><strong>Very Rare Weapon</strong></p>', 2],
		['Legendary', '<p><strong>Legendary Weapon</strong></p>', 3],
	])('%s holds %i rune(s); the extra one is refused and not consumed', async (_l, description, cap) => {
		const { melded, left } = await fill(weapon('Blade', { description }), cap + 1);
		expect(melded).toBe(cap);
		expect(left).toBe(2); // count+1 started, cap consumed
		expect(env.notifications.messages('warn').at(-1)).toMatch(/cannot hold more runes/);
	});

	it('the options list disables full items', async () => {
		const blade = weapon('Blade');
		blade.flags = { [MODULE_ID]: { vol4Runes: ['light'] } };
		const actor = vol4Actor(env, { items: [realItem('Hammer Rune'), blade] });
		env.dialogs.answer(() => null);
		await runes.vol4ApplyRune(actor, itemByName(actor, 'Hammer Rune'));
		expect(env.dialogs.log[0].content).toMatch(/<option value="[^"]+" disabled>Blade \(1\/1 runes\)/);
	});

	it.fails('BUG-module-misc-311: flavor text containing "rarely" doubles a common weapon\'s rune capacity', async () => {
		const { melded } = await fill(weapon('Old Axe', { description: '<p>A plain axe, rarely sharpened.</p>' }), 2);
		expect(melded).toBe(1);
	});

	it('fixed BUG-module-misc-312: in the real dialog (nested <form> dropped by the parser) a rune can never be melded', async () => {
		const actor = vol4Actor(env, { items: [realItem('Hammer Rune'), weapon()] });
		const blade = itemByName(actor, 'Test Blade');
		env.dialogs.answer(foundryWait('ok', { dialog: { element: fakeDialogElement({ target: { value: blade.id } }) } }));
		await runes.vol4ApplyRune(actor, itemByName(actor, 'Hammer Rune'));
		expect(runesOn(actor.items.get(blade.id))).toEqual(['hammer']);
	});
});

describe('Bloodseeker', () => {
	const bs = (opts) => {
		const actor = vol4Actor(env, { items: [realItem('Bloodseeker')], ...opts });
		return { actor, item: actor.items.contents[0] };
	};

	it.each([
		// hp, key, asked, paid
		[20, 3, 2, 2],
		[20, 3, 9, 3],
		[3, 5, 5, 2],
		[1, 3, 3, 0],
		[20, 0, 1, 1], // KEY floors at 1
		[20, 3, -4, 0],
	])('hp %i KEY %i asks %i → pays %i and adds it to the strike', async (hp, key, asked, paid) => {
		const { actor, item } = bs({ hp, key });
		env.dialogs.answer(idealWait('ok', { hp: asked }));
		await weapons.vol4Bloodseeker(actor, item);
		expect(actor.system.attributes.hp.value).toBe(hp - paid);
		expect(env.rolls.at(-1).formula).toBe(paid ? `1d6 + @strength + ${paid}` : '1d6 + @strength');
	});

	it('a closed dialog does not strike', async () => {
		const { actor, item } = bs();
		expect(await weapons.vol4Bloodseeker(actor, item)).toBeNull();
		expect(env.rolls).toHaveLength(0);
	});

	it('fixed BUG-module-misc-313: pressing Cancel still rolls the strike', async () => {
		const { actor, item } = bs();
		env.dialogs.answer(foundryWait('cancel'));
		expect(await weapons.vol4Bloodseeker(actor, item)).toBeNull();
		expect(env.rolls).toHaveLength(0);
	});

	it('fixed BUG-module-misc-314: in the real dialog the HP sacrifice is always 0 (form not found)', async () => {
		const { actor, item } = bs({ hp: 20, key: 3 });
		env.dialogs.answer(foundryWait('ok', { dialog: { element: fakeDialogElement({ hp: { value: '2' } }) } }));
		await weapons.vol4Bloodseeker(actor, item);
		expect(actor.system.attributes.hp.value).toBe(18);
	});
});

describe('Elemental Weapon', () => {
	const setup = (weaponsData = [weapon('Axe')]) => {
		const ew = realItem('Elemental Weapon');
		const actor = vol4Actor(env, { items: [ew, ...weaponsData] });
		return { actor, ew: itemByName(actor, 'Elemental Weapon') };
	};

	it.each([
		['fire', 'Fire'],
		['cold', 'Ice'],
		['lightning', 'Lightning'],
	])('rewrites every top-level damage node to %s, consumes the enchantment', async (element, label) => {
		const { actor, ew } = setup();
		const axe = itemByName(actor, 'Axe');
		env.dialogs.answer(idealWait('ok', { weapon: axe.id, element }));
		await weapons.vol4ElementalWeapon(actor, ew);
		expect(actor.items.get(axe.id).system.activation.effects[0].damageType).toBe(element);
		expect(itemByName(actor, 'Elemental Weapon')).toBeUndefined();
		expect(env.ChatMessage.created.at(-1).content).toContain(label);
	});

	it('no weapons → warning, enchantment kept', async () => {
		const { actor } = setup([armor()]);
		expect(await weapons.vol4ElementalWeapon(actor, itemByName(actor, 'Elemental Weapon'))).toBeNull();
		expect(itemByName(actor, 'Elemental Weapon')).toBeTruthy();
	});

	it('weapon without a damage node → warning, enchantment kept', async () => {
		const { actor, ew } = setup([weapon('Net', { damage: null })]);
		env.dialogs.answer(idealWait('ok', { weapon: itemByName(actor, 'Net').id, element: 'fire' }));
		await weapons.vol4ElementalWeapon(actor, ew);
		expect(itemByName(actor, 'Elemental Weapon')).toBeTruthy();
	});

	it('cancel keeps everything', async () => {
		const { actor, ew } = setup();
		env.dialogs.answer(foundryWait('cancel'));
		await weapons.vol4ElementalWeapon(actor, ew);
		expect(itemByName(actor, 'Elemental Weapon')).toBeTruthy();
		expect(itemByName(actor, 'Axe').system.activation.effects[0].damageType).toBe('slashing');
	});

	it('fixed BUG-module-misc-315: in the real dialog OK does nothing (form not found → choice is the string "ok")', async () => {
		const { actor, ew } = setup();
		const axe = itemByName(actor, 'Axe');
		env.dialogs.answer(foundryWait('ok', { dialog: { element: fakeDialogElement({ weapon: { value: axe.id }, element: { value: 'fire' } }) } }));
		await weapons.vol4ElementalWeapon(actor, ew);
		expect(actor.items.get(axe.id).system.activation.effects[0].damageType).toBe('fire');
	});
});
