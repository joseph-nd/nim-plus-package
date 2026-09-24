/**
 * Vol IV — derived.mjs: Strength-o-Maxer (weapon STR requirement −1 in
 * prepared data) and Spellslinger's Prism (+KEY on cantrip damage for the
 * duration of `activate`, restored afterwards).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { bootVol4, realItem, vol4Actor, weapon } from './vol-helpers.mjs';

let env, seen, FakeSpell;

beforeEach(async () => {
	seen = [];
	({ env } = await bootVol4({
		before(e) {
			FakeSpell = class FakeSpell extends e.classes.Item {
				async activate(options = {}) {
					seen.push(JSON.parse(JSON.stringify(this.system.activation?.effects ?? [])));
					if (options.explode) throw new Error('boom');
					return 'activated';
				}
			};
			e.CONFIG.NIMBLE.Item.documentClasses.spell = FakeSpell;
		},
	}));
});

/** Re-prepare like Foundry: items from source first, then the actor's derived data. */
function reprepare(actor) {
	for (const i of actor.items) i.prepareData();
	actor.prepareDerivedData();
}

const strWeapon = (name, req) => weapon(name, { extra: { properties: { strengthRequirement: { value: req } } } });

describe("Strength-o-Maxer", () => {
	it.each([
		['equipped', true, [2, 0, 4], [1, 0, 3]],
		['unequipped', false, [2, 0, 4], [2, 0, 4]],
	])('%s → requirements %j become %j', (_l, equipped, reqs, expected) => {
		const maxer = realItem('Strength-o-Maxer');
		maxer.system.equipped = equipped;
		const actor = vol4Actor(env, { items: [maxer, ...reqs.map((r, i) => strWeapon(`W${i}`, r))] });
		reprepare(actor);
		expect(reqs.map((_, i) => actor.items.find((x) => x.name === `W${i}`).system.properties.strengthRequirement.value)).toEqual(expected);
	});

	it('only prepared data changes (source untouched) and repeated prepares do not stack', () => {
		const maxer = realItem('Strength-o-Maxer');
		maxer.system.equipped = true;
		const actor = vol4Actor(env, { items: [maxer, strWeapon('W', 3)] });
		reprepare(actor);
		reprepare(actor);
		const w = actor.items.find((x) => x.name === 'W');
		expect(w.system.properties.strengthRequirement.value).toBe(2);
		expect(w._source.system.properties.strengthRequirement.value).toBe(3);
	});

	it('weapons without a numeric requirement are left alone', () => {
		const maxer = realItem('Strength-o-Maxer');
		maxer.system.equipped = true;
		const actor = vol4Actor(env, { items: [maxer, weapon('Plain'), strWeapon('Str', '2')] });
		expect(() => reprepare(actor)).not.toThrow();
		expect(actor.items.find((x) => x.name === 'Str').system.properties.strengthRequirement.value).toBe('2');
	});
});

describe("Spellslinger's Prism", () => {
	const cantrip = (tier = 0, formula = '1d10') => ({
		name: 'Bolt',
		type: 'spell',
		system: { tier, activation: { effects: [{ type: 'savingThrow', on: { failedSave: [{ type: 'damage', formula }] } }] } },
	});
	const cast = async ({ key = 3, equipped = true, tier = 0, prism = true, options = {}, formula } = {}) => {
		const p = realItem("Spellslinger's Prism");
		p.system.equipped = equipped;
		const actor = vol4Actor(env, { key, items: prism ? [p] : [] });
		const spell = new FakeSpell(cantrip(tier, formula), { parent: actor });
		let out;
		try {
			out = await spell.activate(options);
		} catch (e) {
			out = e;
		}
		return { spell, out, during: seen.at(-1)?.[0]?.on.failedSave[0].formula };
	};

	it('adds + KEY to the first (nested) damage node during activate, restores afterwards', async () => {
		const { spell, during, out } = await cast({ key: 4 });
		expect(during).toBe('1d10 + 4');
		expect(out).toBe('activated');
		expect(spell.system.activation.effects[0].on.failedSave[0].formula).toBe('1d10');
	});

	it.each([
		['tiered spell', { tier: 1 }],
		['prism unequipped', { equipped: false }],
		['no prism', { prism: false }],
		['KEY 0', { key: 0 }],
		['negative KEY', { key: -1 }],
		['macro execution', { options: { executeMacro: true } }],
	])('%s → no bonus', async (_l, opts) => {
		const { during } = await cast(opts);
		expect(during).toBe('1d10');
	});

	it('restores the formula even when activate throws', async () => {
		const { spell, out } = await cast({ options: { explode: true } });
		expect(out).toBeInstanceOf(Error);
		expect(spell.system.activation.effects[0].on.failedSave[0].formula).toBe('1d10');
	});

	it('repeated casts never accumulate', async () => {
		const p = realItem("Spellslinger's Prism");
		p.system.equipped = true;
		const actor = vol4Actor(env, { key: 2, items: [p] });
		const spell = new FakeSpell(cantrip(), { parent: actor });
		await spell.activate();
		await spell.activate();
		expect(seen.map((s) => s[0].on.failedSave[0].formula)).toEqual(['1d10 + 2', '1d10 + 2']);
	});
});
