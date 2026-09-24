/**
 * scripts/core/document-patches.mjs — the setup-time prototype wrappers:
 *   - class items advertise the `feats` group while Feats are enabled (derived only)
 *   - features flagged showAsAttack get system.actionType = 'attack' (derived only)
 *   - spell.activate applies + always restores the Elemental Specialist bonus
 * (the object _preCreate unstack wrapper is covered in equipment.test.mjs)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { importScripts, makeCharacter, MODULE_ID, setupWorld } from '../harness/index.mjs';

let env, SpellClass, seen;

async function boot({ feats = false } = {}) {
	({ env } = await setupWorld({ scripts: [], boot: false, settings: { [`${MODULE_ID}.enableFeats`]: feats } }));
	seen = [];
	SpellClass = class Spell extends env.classes.Item {
		async activate(options = {}) {
			seen.push({ formula: this.system.activation?.effects?.[0]?.formula, options });
			if (options.boom) throw new Error('cast failed');
			return { card: true };
		}
	};
	CONFIG.NIMBLE.Item.documentClasses.spell = SpellClass;
	await importScripts(['scripts/feats/settings.mjs', 'scripts/core/document-patches.mjs']);
	await env.boot({ until: 'setup' });
}

describe('class items and the feats group', () => {
	it.each([
		[true, true],
		[false, false],
	])('feats enabled=%s → class groupIdentifiers include feats: %s (source untouched)', async (enabled, has) => {
		await boot({ feats: enabled });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 4 });
		const cls = actor.items.find((i) => i.type === 'class');
		cls.prepareData();
		expect(cls.system.groupIdentifiers.includes('feats')).toBe(has);
		expect((cls._source.system.groupIdentifiers ?? []).includes('feats')).toBe(false);
	});

	it('does not add the group twice across repeated preparation', async () => {
		await boot({ feats: true });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 4 });
		const cls = actor.items.find((i) => i.type === 'class');
		cls.prepareData();
		cls.prepareData();
		expect(cls.system.groupIdentifiers.filter((g) => g === 'feats')).toHaveLength(1);
	});

	it('turning Feats off self-clears on the next preparation', async () => {
		await boot({ feats: true });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 4 });
		const cls = actor.items.find((i) => i.type === 'class');
		await env.settings.set(MODULE_ID, 'enableFeats', false);
		cls.prepareData();
		expect(cls.system.groupIdentifiers.includes('feats')).toBe(false);
	});

	it('a class item with no groupIdentifiers array does not throw', async () => {
		await boot({ feats: true });
		expect(() => new env.classes.Item({ name: 'Homebrew', type: 'class', system: {} })).not.toThrow();
	});
});

describe('showAsAttack features', () => {
	it('flagged features get actionType attack in prepared data only', async () => {
		await boot();
		const flagged = new env.classes.Item({ name: 'Strike', type: 'feature', flags: { [MODULE_ID]: { showAsAttack: true } } });
		const plain = new env.classes.Item({ name: 'Plain', type: 'feature' });
		const spell = new env.classes.Item({ name: 'Bolt', type: 'spell', flags: { [MODULE_ID]: { showAsAttack: true } } });
		expect(flagged.system.actionType).toBe('attack');
		expect(flagged._source.system?.actionType).toBeUndefined();
		expect(plain.system.actionType).toBeUndefined();
		expect(spell.system.actionType).toBeUndefined();
	});
});

describe('spell activate wrapper (Elemental Specialist)', () => {
	async function caster({ school = 'fire', tier = 2, strength = 3, chosen = { school: 'fire', ability: 'strength' } } = {}) {
		const actor = await makeCharacter(env, {
			items: [
				{ name: 'Elemental Specialist', type: 'feature', flags: chosen ? { [MODULE_ID]: { elementalChosen: chosen } } : {} },
				{ name: 'Fireball', type: 'spell', system: { school, tier, activation: { effects: [{ type: 'damage', formula: '2d6' }] } } },
			],
		});
		actor._source.system.abilities = { strength: { mod: strength } };
		actor.prepareData();
		return { actor, spell: actor.items.find((i) => i.name === 'Fireball') };
	}
	const cast = (spell, options) => SpellClass.prototype.activate.call(spell, options);

	it('adds +KEY during the cast and restores after; repeated casts never accumulate', async () => {
		await boot({ feats: true });
		const { spell } = await caster();
		for (let i = 0; i < 3; i += 1) await cast(spell, {});
		expect(seen.map((s) => s.formula)).toEqual(['2d6 + 3', '2d6 + 3', '2d6 + 3']);
		expect(spell.system.activation.effects[0].formula).toBe('2d6');
		expect(spell._source.system.activation.effects[0].formula).toBe('2d6');
	});

	it('restores the formula even when the cast throws', async () => {
		await boot({ feats: true });
		const { spell } = await caster();
		await expect(cast(spell, { boom: true })).rejects.toThrow('cast failed');
		expect(spell.system.activation.effects[0].formula).toBe('2d6');
	});

	it.each([
		['feats disabled', { feats: false }, {}],
		['macro execution', { feats: true }, {}, { executeMacro: true }],
		['cantrip', { feats: true }, { tier: 0 }],
		['other school', { feats: true }, { school: 'ice' }],
		['no choice made', { feats: true }, { chosen: null }],
		['zero key', { feats: true }, { strength: 0 }],
		['negative key', { feats: true }, { strength: -2 }],
	])('no bonus: %s', async (_n, bootOpts, casterOpts, castOpts = {}) => {
		await boot(bootOpts);
		const { spell } = await caster(casterOpts);
		await cast(spell, castOpts);
		expect(seen[0].formula).toBe('2d6');
	});

	it('passes options through and returns the original result', async () => {
		await boot({ feats: true });
		const { spell } = await caster();
		await expect(cast(spell, { upcast: 2 })).resolves.toEqual({ card: true });
		expect(seen[0].options).toEqual({ upcast: 2 });
	});

	it('the patch is applied once even if setup fires twice', async () => {
		await boot({ feats: true });
		const wrapped = SpellClass.prototype.activate;
		await env.Hooks.callAllAsync('setup');
		expect(SpellClass.prototype.activate).toBe(wrapped);
	});
});
