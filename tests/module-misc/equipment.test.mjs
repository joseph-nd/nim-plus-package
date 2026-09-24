/**
 * scripts/equipment/**: helpers, brittle, grip, damage-applied (spiked +
 * brittle on crit, re-click dedupe), derived (mana bonus + Loud), hooks
 * (parry note, requirement warnings), weapon-stacking, and the
 * document-patches weapon-unstack wrapper.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deepClone, findDoc, makeCharacter, MODULE_ID, setupWorld } from '../harness/index.mjs';

const SCRIPTS = [
	'scripts/equipment/helpers.mjs',
	'scripts/equipment/brittle.mjs',
	'scripts/equipment/grip.mjs',
	'scripts/equipment/damage-applied.mjs',
	'scripts/equipment/derived.mjs',
	'scripts/equipment/hooks.mjs',
	'scripts/equipment/weapon-stacking.mjs',
];

/** A pack item as fromCompendium would embed it. */
function packItem(name, overrides = {}) {
	// Expanded Equipment copies (Vol IV has a same-named, unflagged Spiked Shield).
	const { doc } = findDoc({ pack: `${MODULE_ID}.nim-plus-items`, name, where: (d) => String(d.__file ?? '').includes('/equipment/') });
	const src = deepClone(doc);
	delete src._id;
	delete src.folder;
	delete src.sort;
	delete src.ownership;
	return foundry.utils.mergeObject(src, overrides, { inplace: false });
}

let env, helpers, brittle, grip;
let rejections;
const onRejection = (r) => rejections.push(r);

beforeEach(async () => {
	({ env, mods: [helpers, brittle, grip] } = await setupWorld({ scripts: SCRIPTS, boot: 'setup' }));
	rejections = [];
	process.on('unhandledRejection', onRejection);
	// Roll that "rolls" a fixed total and can post itself.
	globalThis.Roll = class FixedRoll {
		static nextTotal = 3;
		constructor(formula) {
			this.formula = formula;
			this.total = FixedRoll.nextTotal;
		}
		async evaluate() {
			return this;
		}
		async toMessage(data) {
			env.ChatMessage.created.push({ roll: this.formula, ...data });
		}
	};
});
afterEach(() => process.off('unhandledRejection', onRejection));

async function actorWith(items, { abilities } = {}) {
	const actor = await makeCharacter(env, { items });
	if (abilities) {
		actor._source.system.abilities = Object.fromEntries(Object.entries(abilities).map(([k, mod]) => [k, { mod }]));
		actor.prepareData();
	}
	return actor;
}
const named = (actor, name) => actor.items.find((i) => i.name === name);

/* ─────────────────────────── helpers ─────────────────────────── */

describe('equipment/helpers', () => {
	it('equipmentFlag reads the flag object or null', () => {
		expect(helpers.equipmentFlag(null)).toBeNull();
		expect(helpers.equipmentFlag({ flags: {} })).toBeNull();
		expect(helpers.equipmentFlag({ flags: { [MODULE_ID]: { equipment: 'x' } } })).toBeNull();
		expect(helpers.equipmentFlag({ flags: { [MODULE_ID]: { equipment: { loud: true } } } })).toEqual({ loud: true });
	});

	it('equippedWithEquipment only returns equipped objects with a matching flag', async () => {
		const actor = await actorWith([
			packItem('Chain Mail', { system: { equipped: true } }),
			packItem('Half Plate', { system: { equipped: false } }),
			{ name: 'Loud Feature', type: 'feature', system: { equipped: true }, flags: { [MODULE_ID]: { equipment: { loud: true } } } },
		]);
		expect(helpers.equippedWithEquipment(actor, (f) => f.loud).map((i) => i.name)).toEqual(['Chain Mail']);
		expect(helpers.equippedWithEquipment(null, () => true)).toEqual([]);
	});

	it.each([
		[{ type: 'object', system: { objectType: 'weapon' } }, true],
		[{ type: 'object', system: { objectType: 'weapon', activation: { targets: { attackType: 'reach' } } } }, true],
		[{ type: 'object', system: { objectType: 'weapon', activation: { targets: { attackType: 'range' } } } }, false],
		[{ type: 'object', system: { objectType: 'armor' } }, false],
		[{ type: 'monsterFeature', system: { subtype: 'action' } }, true],
		[{ type: 'monsterFeature', system: { subtype: 'attackSequence' } }, true],
		[{ type: 'monsterFeature', system: { subtype: 'passive' } }, false],
		[{ type: 'spell', system: {} }, false],
		[null, false],
	])('isMeleeAttackItem(%j) → %s', (item, expected) => {
		expect(helpers.isMeleeAttackItem(item)).toBe(expected);
	});

	it('actorAbilityMod floors, defaults to 0', () => {
		expect(helpers.actorAbilityMod({ system: { abilities: { strength: { mod: 2.7 } } } }, 'strength')).toBe(2);
		expect(helpers.actorAbilityMod({ system: { abilities: { strength: { mod: -1.5 } } } }, 'strength')).toBe(-2);
		expect(helpers.actorAbilityMod(null, 'strength')).toBe(0);
		expect(helpers.actorAbilityMod({ system: { abilities: { strength: { mod: 'x' } } } }, 'strength')).toBe(0);
	});

	it('findPrimaryDamageRoll picks the first roll with a primary die', () => {
		const r = { primaryDieValue: 2 };
		expect(helpers.findPrimaryDamageRoll([null, {}, r])).toBe(r);
		expect(helpers.findPrimaryDamageRoll('x')).toBeNull();
	});
});

/* ─────────────────────────── brittle ─────────────────────────── */

describe('equipment/brittle', () => {
	const remaining = (item) => item._source.flags[MODULE_ID].equipment.brittleRemaining;

	it('warns and does nothing for a non-brittle item / no item', async () => {
		const actor = await actorWith([packItem('Chain Mail')]);
		expect(await brittle.equipmentSpendBrittle(named(actor, 'Chain Mail'))).toBeNull();
		expect(await brittle.equipmentSpendBrittle(null)).toBeNull();
		expect(await brittle.equipmentRepairBrittle(named(actor, 'Chain Mail'))).toBeNull();
		expect(env.notifications.warn).toHaveBeenCalledTimes(2);
		expect(actor.callsOf('update')).toHaveLength(0);
	});

	it('first spend seeds from max and counts down; the last use destroys and unequips', async () => {
		const actor = await actorWith([packItem('Wooden Plank', { system: { equipped: true } })]);
		const plank = named(actor, 'Wooden Plank');
		expect(await brittle.equipmentSpendBrittle(plank)).toBe(2);
		expect(await brittle.equipmentSpendBrittle(plank)).toBe(1);
		expect(plank.system.equipped).toBe(true);
		expect(await brittle.equipmentSpendBrittle(plank)).toBe(0);
		expect(remaining(plank)).toBe(0);
		expect(plank.system.equipped).toBe(false);
		expect(env.ChatMessage.created.at(-1).content).toMatch(/destroyed/);
		expect(env.ChatMessage.created[1].content).toMatch(/<strong>1<\/strong> use remaining/);
	});

	it('repair restores to max without re-equipping (correctable by hand)', async () => {
		const actor = await actorWith([packItem('Wooden Plank', { system: { equipped: true } })]);
		const plank = named(actor, 'Wooden Plank');
		for (let i = 0; i < 3; i += 1) await brittle.equipmentSpendBrittle(plank);
		expect(await brittle.equipmentRepairBrittle(plank)).toBe(3);
		expect(remaining(plank)).toBe(3);
		expect(plank.system.equipped).toBe(false);
	});

	it('escapes the item name in chat output', async () => {
		const actor = await actorWith([
			{ name: '<img src=x onerror=alert(1)>', type: 'object', system: { objectType: 'shield', equipped: true }, flags: { [MODULE_ID]: { equipment: { brittle: 2 } } } },
		]);
		await brittle.equipmentSpendBrittle(actor.items.contents[0]);
		expect(env.ChatMessage.created[0].content).not.toContain('<img');
	});

	it.fails('BUG-module-misc-2: spending an already-shattered item (0 left) is a no-op, not a second destruction', async () => {
		const actor = await actorWith([packItem('Wooden Plank', { system: { equipped: true }, flags: { [MODULE_ID]: { equipment: { brittleRemaining: 0 } } } })]);
		const plank = named(actor, 'Wooden Plank');
		const before = env.ChatMessage.created.length;
		await brittle.equipmentSpendBrittle(plank);
		expect(env.ChatMessage.created.length).toBe(before);
	});

	it.fails('BUG-module-misc-3: a null brittleRemaining (cleared field) re-seeds from max instead of counting as 0', async () => {
		const actor = await actorWith([packItem('Rusty Mail', { system: { equipped: true }, flags: { [MODULE_ID]: { equipment: { brittleRemaining: null } } } })]);
		const mail = named(actor, 'Rusty Mail');
		expect(await brittle.equipmentSpendBrittle(mail)).toBe(4);
		expect(mail.system.equipped).toBe(true);
	});
});

/* ─────────────────────────── grip ─────────────────────────── */

describe('equipment/grip', () => {
	it.each(['War Hammer', 'Trident', 'Spear'])('%s toggles 2h → 1h → 2h and round-trips to the authored state', async (name) => {
		const actor = await actorWith([packItem(name)]);
		const item = named(actor, name);
		const original = item.toObject();
		const flag = helpers.equipmentFlag(item);

		expect(await grip.equipmentToggleGrip(item)).toBe('oneHanded');
		expect(item.system.activation.effects[0].formula).toBe(flag.grip.oneHanded);
		expect(item.system.properties.selected).not.toContain('twoHanded');

		expect(await grip.equipmentToggleGrip(item)).toBe('twoHanded');
		expect(item.system.activation.effects[0].formula).toBe(flag.grip.twoHanded);
		const after = item.toObject();
		expect(after.system.activation).toEqual(original.system.activation);
		expect([...after.system.properties.selected].sort()).toEqual([...original.system.properties.selected].sort());
		expect(env.ChatMessage.created).toHaveLength(2);
	});

	it('authored initial formula equals the twoHanded grip (so the default grip state is right)', async () => {
		for (const name of ['War Hammer', 'Trident', 'Spear']) {
			const item = packItem(name);
			expect(item.system.activation.effects[0].formula).toBe(item.flags[MODULE_ID].equipment.grip.twoHanded);
		}
	});

	it('warns for a non-versatile weapon, and for one without a damage node', async () => {
		const actor = await actorWith([
			packItem('Longsword'),
			{ name: 'Odd', type: 'object', system: { activation: { effects: [] } }, flags: { [MODULE_ID]: { equipment: { grip: { twoHanded: '1d8', oneHanded: '1d6' } } } } },
		]);
		expect(await grip.equipmentToggleGrip(named(actor, 'Longsword'))).toBeNull();
		expect(await grip.equipmentToggleGrip(named(actor, 'Odd'))).toBeNull();
		expect(await grip.equipmentToggleGrip(undefined)).toBeNull();
		expect(env.notifications.warn).toHaveBeenCalledTimes(3);
		expect(actor.callsOf('update')).toHaveLength(0);
	});
});

/* ─────────────────────────── damage-applied ─────────────────────────── */

describe('equipment/damage-applied (nimble.damageApplied)', () => {
	async function fight({ targetItems, weapon = packItem('Longsword'), isCritical = false, isMiss = false } = {}) {
		const attacker = await actorWith([weapon]);
		attacker.applyDamage = vi.fn(async () => {});
		const target = await actorWith(targetItems);
		const sourceItem = attacker.items.contents[0];
		const payload = { card: { id: 'card1' }, sourceActor: attacker, targetActor: target, sourceItem, isCritical, isMiss };
		return { attacker, target, payload };
	}

	it('spiked: melee hit on two spiked pieces → 2d4 applied to the attacker', async () => {
		globalThis.Roll.nextTotal = 5;
		const { attacker, payload } = await fight({
			targetItems: [packItem('Spiked Mail', { system: { equipped: true } }), packItem('Spiked Shield', { system: { equipped: true } })],
		});
		env.Hooks.callAll('nimble.damageApplied', payload);
		await env.flush();
		expect(env.ChatMessage.created[0].roll).toBe('1d4 + 1d4');
		expect(attacker.applyDamage).toHaveBeenCalledWith(5);
	});

	it.each([
		['a miss', { isMiss: true }],
		['a ranged attack', { weapon: { name: 'Bow', type: 'object', system: { objectType: 'weapon', activation: { targets: { attackType: 'range' } } } } }],
		['a spell', { weapon: { name: 'Bolt', type: 'spell', system: {} } }],
	])('spiked: no retaliation for %s', async (_n, opts) => {
		const { attacker, payload } = await fight({ targetItems: [packItem('Spiked Mail', { system: { equipped: true } })], ...opts });
		env.Hooks.callAll('nimble.damageApplied', payload);
		await env.flush();
		expect(attacker.applyDamage).not.toHaveBeenCalled();
	});

	it('spiked: unequipped spiked gear does nothing', async () => {
		const { attacker, payload } = await fight({ targetItems: [packItem('Spiked Mail', { system: { equipped: false } })] });
		env.Hooks.callAll('nimble.damageApplied', payload);
		await env.flush();
		expect(attacker.applyDamage).not.toHaveBeenCalled();
	});

	it('re-clicking Apply Damage on the same card/target does not retaliate or degrade twice', async () => {
		const { attacker, target, payload } = await fight({
			targetItems: [packItem('Spiked Mail', { system: { equipped: true } }), packItem('Wooden Plank', { system: { equipped: true } })],
			isCritical: true,
		});
		env.Hooks.callAll('nimble.damageApplied', payload);
		await env.flush();
		env.Hooks.callAll('nimble.damageApplied', { ...payload });
		await env.flush();
		expect(attacker.applyDamage).toHaveBeenCalledTimes(1);
		expect(named(target, 'Wooden Plank')._source.flags[MODULE_ID].equipment.brittleRemaining).toBe(2);
		// a different card is a new hit
		env.Hooks.callAll('nimble.damageApplied', { ...payload, card: { id: 'card2' } });
		await env.flush();
		expect(named(target, 'Wooden Plank')._source.flags[MODULE_ID].equipment.brittleRemaining).toBe(1);
	});

	it('brittle on crit degrades every equipped brittle piece; a normal hit does not', async () => {
		const { target, payload } = await fight({
			targetItems: [packItem('Rusty Mail', { system: { equipped: true } }), packItem('Wooden Plank', { system: { equipped: true } }), packItem('Rusty Plate', { system: { equipped: false } })],
		});
		env.Hooks.callAll('nimble.damageApplied', payload);
		await env.flush();
		expect(named(target, 'Rusty Mail')._source.flags[MODULE_ID].equipment.brittleRemaining).toBeUndefined();
		env.Hooks.callAll('nimble.damageApplied', { ...payload, card: { id: 'crit' }, isCritical: true });
		await env.flush();
		expect(named(target, 'Rusty Mail')._source.flags[MODULE_ID].equipment.brittleRemaining).toBe(4);
		expect(named(target, 'Wooden Plank')._source.flags[MODULE_ID].equipment.brittleRemaining).toBe(2);
		expect(named(target, 'Rusty Plate')._source.flags[MODULE_ID].equipment.brittleRemaining).toBeUndefined();
	});

	it('a payload without a card id is never deduped (both calls act)', async () => {
		const { attacker, payload } = await fight({ targetItems: [packItem('Spiked Mail', { system: { equipped: true } })] });
		delete payload.card;
		env.Hooks.callAll('nimble.damageApplied', payload);
		env.Hooks.callAll('nimble.damageApplied', payload);
		await env.flush();
		expect(attacker.applyDamage).toHaveBeenCalledTimes(2);
	});

	it.fails('BUG-module-misc-4: a failure inside spiked retaliation is caught and logged, not an unhandled rejection', async () => {
		const { attacker, payload } = await fight({ targetItems: [packItem('Spiked Mail', { system: { equipped: true } })] });
		attacker.applyDamage = vi.fn(async () => {
			throw new Error('applyDamage failed');
		});
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		env.Hooks.callAll('nimble.damageApplied', payload);
		await env.flush();
		spy.mockRestore();
		expect(rejections).toEqual([]);
	});
});

/* ─────────────────────────── derived (mana / loud) ─────────────────────────── */

describe('equipment/derived', () => {
	function withMana(actor, max) {
		// emulate the system's _prepareMaxMana inside prepareDerivedData
		return max;
	}

	it('adds manaBonus of equipped focus items to mana.max, derived only, and clears on unequip', async () => {
		const Actor = CONFIG.NIMBLE.Actor.documentClasses.character;
		// The harness Actor's own prepareDerivedData is wrapped at setup; put mana in before the wrapper runs
		const actor = await actorWith([packItem("Scholar's Outfit", { system: { equipped: true } })]);
		actor._source.system.resources = { mana: { max: 3, value: 3 } };
		actor.prepareData();
		expect(actor.system.resources.mana.max).toBe(5);
		expect(actor._source.system.resources.mana.max).toBe(3);
		actor.prepareData();
		expect(actor.system.resources.mana.max).toBe(5); // not cumulative
		await named(actor, "Scholar's Outfit").update({ 'system.equipped': false });
		expect(actor.system.resources.mana.max).toBe(3);
		expect(withMana(Actor, 0)).toBe(0);
	});

	it('leaves actors without a numeric mana.max alone', async () => {
		const actor = await actorWith([packItem("Scholar's Outfit", { system: { equipped: true } })]);
		expect(actor.system.resources?.mana).toBeUndefined();
	});

	it('the prepareDerivedData wrapper is installed once even if setup fires twice', async () => {
		const proto = CONFIG.NIMBLE.Actor.documentClasses.character.prototype;
		const before = proto.prepareDerivedData;
		await env.Hooks.callAllAsync('setup');
		expect(proto.prepareDerivedData).toBe(before);
	});

	describe('Loud → Stealth disadvantage', () => {
		let seen;
		beforeEach(async () => {
			// Install a system-like rollSkillCheck, then re-run the patch on a fresh registry.
			seen = [];
			const { env: e2 } = await setupWorld({ scripts: [], boot: false });
			env = e2;
			CONFIG.NIMBLE.Actor.documentClasses.character.prototype.rollSkillCheck = function rollSkillCheck(skill, options) {
				seen.push({ skill, options });
				return options;
			};
			const { importScripts } = await import('../harness/index.mjs');
			await importScripts(['scripts/equipment/derived.mjs']);
			await env.boot({ until: 'setup' });
		});

		it.each([
			['stealth', true, {}, -1],
			['stealth', true, { rollModeModifier: 1 }, 0],
			['stealth', true, undefined, -1],
			['stealth', false, {}, undefined],
			['athletics', true, {}, undefined],
		])('%s with loud=%s opts=%j → rollModeModifier %s', async (skill, loud, opts, expected) => {
			const items = loud ? [packItem('Chain Mail', { system: { equipped: true } })] : [];
			const actor = await makeCharacter(env, { items });
			actor.rollSkillCheck(skill, opts);
			expect(seen[0].options?.rollModeModifier).toBe(expected);
		});

		it('does not mutate the caller options object', async () => {
			const actor = await makeCharacter(env, { items: [packItem('Chain Mail', { system: { equipped: true } })] });
			const opts = { rollModeModifier: 0 };
			actor.rollSkillCheck('stealth', opts);
			expect(opts.rollModeModifier).toBe(0);
		});
	});
});

/* ─────────────────────────── hooks (parry / requirements) ─────────────────────────── */

describe('equipment/hooks', () => {
	async function parryScenario(dieValue, { equipped = true } = {}) {
		const attacker = await actorWith([packItem('Longsword')]);
		const defender = await actorWith([packItem('Buckler', { system: { equipped } })]);
		const weapon = attacker.items.contents[0];
		env.Hooks.callAll('nimble.useItem', weapon, {}, { targets: [{ actor: defender }], rolls: [{ primaryDieValue: dieValue }] });
		await env.flush();
		return env.ChatMessage.created;
	}

	it.each([
		[1, 0],
		[2, 1],
		[3, 0],
	])('parry note: primary die %i → %i message(s)', async (die, n) => {
		expect(await parryScenario(die)).toHaveLength(n);
	});

	it('parry note: unequipped parry gear or no targets → nothing', async () => {
		expect(await parryScenario(2, { equipped: false })).toHaveLength(0);
		const attacker = await actorWith([packItem('Longsword')]);
		env.Hooks.callAll('nimble.useItem', attacker.items.contents[0], {}, { targets: [], rolls: [{ primaryDieValue: 2 }] });
		env.Hooks.callAll('nimble.useItem', attacker.items.contents[0], {}, undefined);
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it.each([
		['Chain Mail', { strength: 1 }, 1],
		['Chain Mail', { strength: 2 }, 0],
		['Rapier', { dexterity: 1 }, 1],
		["Scholar's Outfit", { intelligence: 2 }, 0],
		["Scholar's Outfit", { intelligence: 0 }, 1],
		['Longsword', { strength: 2 }, 0],
		['Longsword', { strength: 1 }, 1],
		['Rope-less Plain', {}, 0],
	])('requirement warning when equipping %s with %j → %i warning(s)', async (name, abilities, warnings) => {
		const item = name === 'Rope-less Plain' ? { name, type: 'object', system: { equipped: false } } : packItem(name, { system: { equipped: false } });
		const actor = await actorWith([item], { abilities });
		await named(actor, name).update({ 'system.equipped': true });
		expect(env.notifications.warn).toHaveBeenCalledTimes(warnings);
	});

	it('no warning on unequip, on re-saving an equipped item without change in diff, or for another user', async () => {
		const actor = await actorWith([packItem('Full Plate', { system: { equipped: true } })], { abilities: { strength: 0 } });
		const plate = named(actor, 'Full Plate');
		await plate.update({ 'system.equipped': false });
		await plate.update({ name: 'Full Plate' });
		env.Hooks.callAll('updateItem', plate, { system: { equipped: true } }, {}, 'someoneElse');
		expect(env.notifications.warn).not.toHaveBeenCalled();
	});
});

/* ─────────────────────────── weapon stacking ─────────────────────────── */

describe('equipment/weapon-stacking (createItem split)', () => {
	it.each([
		[1, 1],
		[2, 2],
		[3, 3],
		['3', 3],
		[0, 1],
	])('a weapon created with quantity %j becomes %i documents of quantity 1', async (qty, docs) => {
		const actor = await actorWith([]);
		await actor.createEmbeddedDocuments('Item', [packItem('Longsword', { system: { quantity: qty } })]);
		await env.flush();
		const swords = actor.items.filter((i) => i.name === 'Longsword');
		expect(swords).toHaveLength(docs);
		if (docs > 1) for (const s of swords) expect(s.system.quantity).toBe(1);
	});

	it('non-weapons are not split', async () => {
		const actor = await actorWith([]);
		await actor.createEmbeddedDocuments('Item', [{ name: 'Torch', type: 'object', system: { objectType: 'misc', quantity: 5 } }]);
		await env.flush();
		expect(actor.items.filter((i) => i.name === 'Torch')).toHaveLength(1);
	});

	it("only the creating user's client splits", async () => {
		const actor = await actorWith([]);
		const created = await actor.createEmbeddedDocuments('Item', [packItem('Longsword', { system: { quantity: 1 } })]);
		env.Hooks.callAll('createItem', { ...created[0], system: { objectType: 'weapon', quantity: 3 }, isEmbedded: true, type: 'object' }, {}, 'otherUser');
		await env.flush();
		expect(actor.items.filter((i) => i.name === 'Longsword')).toHaveLength(1);
	});

	it.fails('BUG-module-misc-5: splitting an equipped weapon stack leaves only one copy equipped', async () => {
		const actor = await actorWith([]);
		await actor.createEmbeddedDocuments('Item', [packItem('Longsword', { system: { quantity: 3, equipped: true } })]);
		await env.flush();
		const equipped = actor.items.filter((i) => i.name === 'Longsword' && i.system.equipped);
		expect(equipped).toHaveLength(1);
	});
});

/* ─────────────────────────── document-patches: weapon unstack ─────────────────────────── */

describe('core/document-patches object _preCreate (weapons never merge)', () => {
	let seen;
	beforeEach(async () => {
		seen = [];
		const { env: e2 } = await setupWorld({ scripts: [], boot: false });
		env = e2;
		class ObjectItem extends env.classes.Item {
			async _preCreate() {
				seen.push(this.system.objectSizeType);
				if (this.name === 'Boom') throw new Error('boom');
			}
		}
		CONFIG.NIMBLE.Item.documentClasses.object = ObjectItem;
		const { importScripts } = await import('../harness/index.mjs');
		await importScripts(['scripts/feats/settings.mjs', 'scripts/core/document-patches.mjs']);
		await env.boot({ until: 'setup' });
	});
	const make = (data, embedded = true) => {
		const parent = embedded ? new env.classes.Actor({ name: 'A', type: 'character' }) : null;
		return new CONFIG.NIMBLE.Item.documentClasses.object(data, { parent });
	};

	it.each([
		['stackable', 'weapon', true, 'slots'],
		['smallSized', 'weapon', true, 'slots'],
		['stackable', 'misc', true, 'stackable'],
		['slots', 'weapon', true, 'slots'],
		['stackable', 'weapon', false, 'stackable'],
	])('size=%s type=%s embedded=%s → merge check sees %s; size restored after', async (size, type, embedded, sees) => {
		const item = make({ name: 'X', type: 'object', system: { objectSizeType: size, objectType: type } }, embedded);
		await item._preCreate({}, {}, 'u');
		expect(seen).toEqual([sees]);
		expect(item.system.objectSizeType).toBe(size);
	});

	it('restores the size type even when the system _preCreate throws', async () => {
		const item = make({ name: 'Boom', type: 'object', system: { objectSizeType: 'stackable', objectType: 'weapon' } });
		await expect(item._preCreate({}, {}, 'u')).rejects.toThrow('boom');
		expect(item.system.objectSizeType).toBe('stackable');
	});
});

describe('equipment hooks under the nimble-dev system id', () => {
	it.fails('BUG-module-misc-6: spiked/brittle/parry listen on the dev system hook names too', async () => {
		const { env: e2 } = await setupWorld({ scripts: SCRIPTS, boot: 'setup', systemId: 'nimble-dev' });
		expect(e2.Hooks.count('nimble-dev.damageApplied')).toBeGreaterThan(0);
		expect(e2.Hooks.count('nimble-dev.useItem')).toBeGreaterThan(0);
	});
});
