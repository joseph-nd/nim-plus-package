/**
 * Feats — activatable / configurable feat mechanics:
 * Healer, Second Wind (scripts/feats/mechanics/healer-second-wind.mjs),
 * Academic (academic.mjs), Elemental Specialist (elemental-specialist.mjs +
 * the spell `activate` patch in scripts/core/document-patches.mjs).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MODULE_ID, randomID } from '../harness/index.mjs';
import { character, featItem, featsWorld } from './feats-helpers.mjs';

/**
 * Press button `action` of a DialogV2 the way Foundry v14 does: the fields live
 * in DialogV2's own <form> (a nested <form> in the content is dropped by the
 * HTML parser), which is the clicked button's `form`.
 */
const withForm = (elements, action = 'ok') => (config) => {
	const form = { elements: Object.fromEntries(Object.entries(elements).map(([k, v]) => [k, { value: v }])) };
	const root = { querySelector: (sel) => (sel === 'form' || sel === 'form.dialog-form' ? form : null) };
	return config.buttons.find((b) => b.action === action).callback({}, { form }, { element: root });
};

const setTargets = (env, ...actors) => {
	env.game.user.targets = new Set(actors.map((a) => ({ actor: a })));
};

describe('Healer', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld());
	});

	it('heals the first target KEY HP, marks the feat used and posts a chat card', async () => {
		const actor = await character(env, { items: [featItem('Healer')], key: 3 });
		const target = await character(env, { name: 'Target' });
		setTargets(env, target);
		const healer = actor.items.find((i) => i.name === 'Healer');
		await m.healer.healerHeal(actor, healer);
		expect(target.applyHealing).toHaveBeenCalledWith(3);
		expect(healer.getFlag(MODULE_ID, 'healerUsed')).toBe(true);
		expect(env.ChatMessage.created.at(-1).content).toMatch(/healing <strong>3<\/strong>/);
	});

	it('refuses a second use before a Safe Rest (no healing)', async () => {
		const actor = await character(env, { items: [featItem('Healer', { flags: { [MODULE_ID]: { healerUsed: true } } })] });
		const target = await character(env, { name: 'Target' });
		setTargets(env, target);
		await m.healer.healerHeal(actor, actor.items.find((i) => i.name === 'Healer'));
		expect(target.applyHealing).not.toHaveBeenCalled();
		expect(env.notifications.messages('warn')[0]).toMatch(/already been used/);
	});

	it('no target → warning, feat NOT consumed', async () => {
		const actor = await character(env, { items: [featItem('Healer')] });
		setTargets(env);
		const healer = actor.items.find((i) => i.name === 'Healer');
		expect(await m.healer.healerHeal(actor, healer)).toBeNull();
		expect(healer.getFlag(MODULE_ID, 'healerUsed')).toBeUndefined();
	});

	it('target that cannot be healed → error, feat NOT consumed', async () => {
		const actor = await character(env, { items: [featItem('Healer')] });
		const target = await character(env, { name: 'Wall' });
		target.applyHealing = undefined;
		setTargets(env, target);
		const healer = actor.items.find((i) => i.name === 'Healer');
		expect(await m.healer.healerHeal(actor, healer)).toBeNull();
		expect(healer.getFlag(MODULE_ID, 'healerUsed')).toBeUndefined();
	});

	it('missing actor/item → error, no throw', async () => {
		expect(await m.healer.healerHeal(null, null)).toBeNull();
		expect(env.notifications.messages('error')[0]).toMatch(/missing actor or item/);
	});
});

describe('Second Wind', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld());
	});

	const withDice = (hitDice, extra = {}) => ({ items: [featItem('Second Wind')], system: { attributes: { hitDice } }, ...extra });

	it('one die size: spends one, heals roll total, marks used', async () => {
		env.Roll.nextTotal = 7;
		const actor = await character(env, { ...withDice({ 8: { current: 2, total: 3 } }), key: 2 });
		const sw = actor.items.find((i) => i.name === 'Second Wind');
		const roll = await m.healer.secondWind(actor, sw);
		expect(env.dialogs.log).toHaveLength(0);
		expect(roll.formula).toBe('1d8 + 2');
		expect(actor.system.attributes.hitDice[8].current).toBe(1);
		expect(actor.applyHealing).toHaveBeenCalledWith(7);
		expect(sw.getFlag(MODULE_ID, 'secondWindUsed')).toBe(true);
		expect(roll.message.content).toMatch(/Remaining d8 Hit Dice: <strong>1<\/strong>/);
	});

	it('KEY 0 → plain 1dX formula', async () => {
		const actor = await character(env, { ...withDice({ 6: { current: 1 } }), key: 0 });
		const roll = await m.healer.secondWind(actor, actor.items.find((i) => i.name === 'Second Wind'));
		expect(roll.formula).toBe('1d6');
	});

	it('a negative roll total heals 0, never a negative (damage) amount', async () => {
		env.Roll.nextTotal = -2;
		const actor = await character(env, { ...withDice({ 6: { current: 1 } }), key: -3 });
		await m.healer.secondWind(actor, actor.items.find((i) => i.name === 'Second Wind'));
		expect(actor.applyHealing).toHaveBeenCalledWith(0);
	});

	it('several die sizes: asks which, largest first, spends the picked one', async () => {
		const actor = await character(env, withDice({ 6: { current: 1 }, 10: { current: 2 }, 12: { current: 0 } }));
		env.dialogs.answer(withForm({ size: '6' }));
		const roll = await m.healer.secondWind(actor, actor.items.find((i) => i.name === 'Second Wind'));
		const opts = [...env.dialogs.log[0].content.matchAll(/value="(\d+)"/g)].map((x) => x[1]);
		expect(opts).toEqual(['10', '6']); // d12 has none left → not offered
		expect(roll.formula).toMatch(/^1d6/);
		expect(actor.system.attributes.hitDice[6].current).toBe(0);
		expect(actor.system.attributes.hitDice[10].current).toBe(2);
	});

	it.each([
		['Cancel', (c) => c.buttons.find((b) => b.action === 'cancel').callback()],
		['Cancel (v14 resolves the "cancel" action string)', 'cancel'],
		['a raw "cancel" result', () => 'cancel'],
		['closing the dialog', null],
	])('%s spends nothing and leaves the feat available', async (_l, answer) => {
		const actor = await character(env, withDice({ 6: { current: 1 }, 10: { current: 2 } }));
		env.dialogs.answer(answer);
		const sw = actor.items.find((i) => i.name === 'Second Wind');
		expect(await m.healer.secondWind(actor, sw)).toBeNull();
		expect(actor.system.attributes.hitDice[10].current).toBe(2);
		expect(actor.system.attributes.hitDice[6].current).toBe(1);
		expect(sw.getFlag(MODULE_ID, 'secondWindUsed')).toBeUndefined();
		expect(actor.applyHealing).not.toHaveBeenCalled();
	});

	it('no Hit Dice left → warning, nothing spent, feat not consumed', async () => {
		const actor = await character(env, withDice({ 8: { current: 0 } }));
		const sw = actor.items.find((i) => i.name === 'Second Wind');
		expect(await m.healer.secondWind(actor, sw)).toBeNull();
		expect(sw.getFlag(MODULE_ID, 'secondWindUsed')).toBeUndefined();
		expect(env.notifications.messages('warn')[0]).toMatch(/No Hit Dice/);
	});

	it('already used → warning, no die spent', async () => {
		const actor = await character(env, withDice({ 8: { current: 2 } }, { items: [featItem('Second Wind', { flags: { [MODULE_ID]: { secondWindUsed: true } } })] }));
		await m.healer.secondWind(actor, actor.items.find((i) => i.name === 'Second Wind'));
		expect(actor.system.attributes.hitDice[8].current).toBe(2);
	});
});

describe('Safe Rest reset', () => {
	let env;
	beforeEach(async () => {
		({ env } = await featsWorld());
	});

	it.each([
		['safe', false],
		['field', true],
		[undefined, true],
	])('rest %s → flags still used=%s', async (restType, stillUsed) => {
		const actor = await character(env, {
			items: [
				featItem('Healer', { flags: { [MODULE_ID]: { healerUsed: true } } }),
				featItem('Second Wind', { flags: { [MODULE_ID]: { secondWindUsed: true } } }),
			],
		});
		await env.Hooks.callAllAsync('nimble.rest', { actor, restType });
		await env.flush();
		expect(!!actor.items.find((i) => i.name === 'Healer').getFlag(MODULE_ID, 'healerUsed')).toBe(stillUsed);
		expect(!!actor.items.find((i) => i.name === 'Second Wind').getFlag(MODULE_ID, 'secondWindUsed')).toBe(stillUsed);
	});

	it('does not write anything when nothing was used', async () => {
		const actor = await character(env, { items: [featItem('Healer'), featItem('Second Wind')] });
		await env.Hooks.callAllAsync('nimble.rest', { actor, restType: 'safe' });
		expect(actor.callsOf('update')).toHaveLength(0);
	});
});

describe('Academic', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld());
	});

	it('allocates 3 points (stacking allowed) onto existing skill points, once', async () => {
		const actor = await character(env, { items: [featItem('Academic')], system: { skills: { arcana: { points: 1 }, lore: { points: 0 } } } });
		const feat = actor.items.find((i) => i.name === 'Academic');
		env.dialogs.answer(withForm({ s1: 'arcana', s2: 'arcana', s3: 'lore' }));
		await m.academic.allocateAcademic(actor, feat);
		expect(actor.system.skills.arcana.points).toBe(3);
		expect(actor.system.skills.lore.points).toBe(1);
		expect(feat.getFlag(MODULE_ID, 'academicAllocated')).toBe(true);
		expect(feat.getFlag(MODULE_ID, 'academicAllocation')).toEqual({ arcana: 2, lore: 1 });
		// Re-opening does nothing.
		await m.academic.allocateAcademic(actor, feat);
		expect(env.dialogs.log).toHaveLength(1);
		expect(actor.system.skills.arcana.points).toBe(3);
	});

	it.each([
		['Later', (c) => c.buttons.find((b) => b.action === 'cancel').callback()],
		['Later (v14 resolves the "cancel" action string)', () => 'cancel'],
		['close', null],
		['an empty pick', withForm({ s1: 'arcana', s2: '', s3: 'lore' })],
	])('%s → nothing written, still configurable later', async (_l, answer) => {
		const actor = await character(env, { items: [featItem('Academic')] });
		const feat = actor.items.find((i) => i.name === 'Academic');
		env.dialogs.answer(answer);
		expect(await m.academic.allocateAcademic(actor, feat)).toBeNull();
		expect(actor.system.skills).toBeUndefined();
		expect(m.configStatus.featsNeedingConfig(actor).map((c) => c.kind)).toEqual(['academic']);
	});

	it('gaining the feat opens the allocation dialog (granting client only)', async () => {
		const actor = await character(env, { level: 1 });
		env.dialogs.answer(withForm({ s1: 'might', s2: 'might', s3: 'might' }));
		await actor.createEmbeddedDocuments('Item', [featItem('Academic')]);
		await env.flush();
		expect(actor.system.skills.might.points).toBe(3);
		// Another user's creation does not prompt here.
		const other = await character(env, { level: 1 });
		const [item] = await other.createEmbeddedDocuments('Item', [featItem('Academic')], {});
		env.Hooks.callAll('createItem', item, {}, 'someoneElse0000');
		await env.flush();
		expect(env.dialogs.log.filter((d) => /Academic/.test(d.title))).toHaveLength(2); // one per own create
	});

	it.fails('BUG-module-misc-101: removing the Academic feat (level-down / delete) takes its 3 skill points back', async () => {
		const actor = await character(env, { items: [featItem('Academic')], system: { skills: { arcana: { points: 1 } } } });
		const feat = actor.items.find((i) => i.name === 'Academic');
		env.dialogs.answer(withForm({ s1: 'arcana', s2: 'arcana', s3: 'arcana' }));
		await m.academic.allocateAcademic(actor, feat);
		expect(actor.system.skills.arcana.points).toBe(4);
		await actor.deleteEmbeddedDocuments('Item', [feat.id]);
		await env.flush();
		expect(actor.system.skills.arcana.points).toBe(1);
	});
});

describe('Elemental Specialist', () => {
	let env, m, SpellClass, seen, gate;

	beforeEach(async () => {
		seen = [];
		gate = null;
		({ env, m } = await featsWorld({
			beforeImport: (e) => {
				SpellClass = class Spell {
					async activate(options) {
						seen.push({ formula: this.system.activation.effects[0].formula, options });
						if (gate) await gate;
						if (options?.boom) throw new Error('boom');
						return 'activated';
					}
				};
				e.CONFIG.NIMBLE.Item.documentClasses.spell = SpellClass;
			},
		}));
	});

	const spellSrc = ({ school = 'fire', tier = 1, formula = '2d6' } = {}) => ({
		_id: randomID(),
		name: `Test ${school} ${tier}`,
		type: 'spell',
		system: { school, tier, activation: { effects: [{ type: 'damage', formula }] } },
		flags: {},
	});
	const specialist = (school = 'fire', ability = 'key') =>
		featItem('Elemental Specialist', { flags: { [MODULE_ID]: { elementalChosen: { school, ability } } } });

	async function caster({ spell = {}, feat, key = 3, system = {} } = {}) {
		if (feat === undefined) feat = specialist();
		const actor = await character(env, { items: [feat, spellSrc(spell)].filter(Boolean), key, system });
		return { actor, spell: actor.items.find((i) => i.type === 'spell') };
	}

	it('appends +KEY to the primary damage formula and the thunk restores it', async () => {
		const { spell } = await caster();
		const restore = m.elemental.applyElementalSpecialistBonus(spell);
		expect(spell.system.activation.effects[0].formula).toBe('2d6 + 3');
		restore();
		expect(spell.system.activation.effects[0].formula).toBe('2d6');
	});

	it('uses the chosen ability instead of KEY when one is picked', async () => {
		const { spell } = await caster({ feat: specialist('fire', 'intelligence'), system: { abilities: { intelligence: { mod: 4 } } } });
		m.elemental.applyElementalSpecialistBonus(spell);
		expect(spell.system.activation.effects[0].formula).toBe('2d6 + 4');
	});

	it.each([
		['a cantrip (tier 0)', { spell: { tier: 0 } }],
		['another school', { spell: { school: 'ice' } }],
		['no choice made yet', { feat: () => featItem('Elemental Specialist') }],
		['no feat', { feat: null }],
		['KEY 0', { key: 0 }],
		['negative KEY', { key: -2 }],
		['no damage node', { spell: { formula: '' } }],
	])('no bonus for %s', async (_l, opts) => {
		const { spell } = await caster({ ...opts, feat: typeof opts.feat === 'function' ? opts.feat() : opts.feat === null ? null : undefined });
		expect(m.elemental.applyElementalSpecialistBonus(spell)).toBeNull();
	});

	it('no bonus when the Feats setting is off', async () => {
		({ env, m } = await featsWorld({ enabled: false }));
		const { spell } = await caster();
		expect(m.elemental.applyElementalSpecialistBonus(spell)).toBeNull();
	});

	it('patched spell.activate: bonus visible during activation, restored after, never accumulates', async () => {
		const { spell } = await caster();
		for (let i = 0; i < 3; i += 1) await SpellClass.prototype.activate.call(spell, {});
		expect(seen.map((s) => s.formula)).toEqual(['2d6 + 3', '2d6 + 3', '2d6 + 3']);
		expect(spell.system.activation.effects[0].formula).toBe('2d6');
	});

	it('patched spell.activate: restored even when activation throws', async () => {
		const { spell } = await caster();
		await expect(SpellClass.prototype.activate.call(spell, { boom: true })).rejects.toThrow('boom');
		expect(spell.system.activation.effects[0].formula).toBe('2d6');
	});

	it('patched spell.activate: macro executions get no bonus', async () => {
		const { spell } = await caster();
		await SpellClass.prototype.activate.call(spell, { executeMacro: true });
		expect(seen[0].formula).toBe('2d6');
	});

	it.fails('BUG-module-misc-102: overlapping activations (double-click) neither double the bonus nor leave it behind', async () => {
		const { spell } = await caster();
		let release;
		gate = new Promise((r) => (release = r));
		const a = SpellClass.prototype.activate.call(spell, {});
		const b = SpellClass.prototype.activate.call(spell, {});
		await env.flush();
		release();
		await Promise.all([a, b]);
		gate = null;
		expect(seen.map((s) => s.formula)).toEqual(['2d6 + 3', '2d6 + 3']);
		expect(spell.system.activation.effects[0].formula).toBe('2d6');
	});

	it('chooser stores {school, ability}; Later leaves it unconfigured', async () => {
		const actor = await character(env, { items: [featItem('Elemental Specialist')] });
		const feat = actor.items.find((i) => i.name === 'Elemental Specialist');
		env.dialogs.answer((c) => c.buttons.find((b) => b.action === 'cancel').callback());
		expect(await m.elemental.chooseElementalSpecialist(actor, feat)).toBeNull();
		expect(m.configStatus.featsNeedingConfig(actor).map((c) => c.kind)).toEqual(['elemental']);
		env.dialogs.answer(withForm({ school: 'wind', ability: 'will' }));
		await m.elemental.chooseElementalSpecialist(actor, feat);
		expect(feat.getFlag(MODULE_ID, 'elementalChosen')).toEqual({ school: 'wind', ability: 'will' });
		expect(m.configStatus.featsNeedingConfig(actor)).toEqual([]);
	});

	it('every chooser school is a real Nimble spell school', async () => {
		const { loadPackData } = await import('../harness/index.mjs');
		const schools = new Set();
		for (const pack of loadPackData().packs.values()) for (const d of pack.docs) if (d.type === 'spell' && d.system?.school) schools.add(d.system.school);
		for (const [k] of m.helpers.ELEM_SCHOOLS) expect(schools).toContain(k);
	});
});
