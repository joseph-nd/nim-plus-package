/**
 * Pure helpers in scripts/core: constants, html, damage, system, pools, rules,
 * level-up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importScripts, installFoundry, makeCharacter } from '../harness/index.mjs';
import { el, installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

let env;
let constants, html, damage, system, pools, rules, levelUp;

beforeEach(async () => {
	env = installFoundry();
	[constants, html, damage, system, pools, rules, levelUp] = await importScripts([
		'scripts/core/constants.mjs',
		'scripts/core/html.mjs',
		'scripts/core/damage.mjs',
		'scripts/core/system.mjs',
		'scripts/core/pools.mjs',
		'scripts/core/rules.mjs',
		'scripts/core/level-up.mjs',
	]);
});

describe('core/constants', () => {
	it('MODULE_ID matches module.json id', () => {
		expect(constants.MODULE_ID).toBe('nim-plus-package');
	});
});

describe('core/html escape', () => {
	it.each([
		[null, ''],
		[undefined, ''],
		[0, '0'],
		[false, 'false'],
		['plain', 'plain'],
		['<b>"Tom" & \'Jerry\'</b>', '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;'],
		['&amp;', '&amp;amp;'],
	])('escape(%j) → %j', (input, out) => {
		expect(html.escape(input)).toBe(out);
	});
});

describe('core/damage findFirstDamageNode', () => {
	it.each([
		['not an array', null, null],
		['empty', [], null],
		['blank formula skipped', [{ type: 'damage', formula: '   ' }], null],
		['non-string formula skipped', [{ type: 'damage', formula: 4 }], null],
	])('%s', (_name, effects, expected) => {
		expect(damage.findFirstDamageNode(effects)).toBe(expected);
	});

	it('returns the top-level damage node', () => {
		const node = { type: 'damage', formula: '1d6' };
		expect(damage.findFirstDamageNode([{ type: 'text' }, node])).toBe(node);
	});

	it('descends into nested arrays and objects (depth first)', () => {
		const nested = { type: 'damage', formula: '2d8' };
		const later = { type: 'damage', formula: '1d4' };
		const effects = [{ type: 'savingThrow', on: { failedSave: [{ type: 'condition' }, nested] } }, later];
		expect(damage.findFirstDamageNode(effects)).toBe(nested);
	});

	it('tolerates null / primitive entries', () => {
		const node = { type: 'damage', formula: '1' };
		expect(damage.findFirstDamageNode([null, 3, 'x', node])).toBe(node);
	});
});

describe('core/system', () => {
	it('sysId follows game.system.id and falls back to nimble', () => {
		expect(system.sysId()).toBe('nimble');
		env.game.system.id = 'nimble-dev';
		expect(system.sysId()).toBe('nimble-dev');
		expect(system.sysHook('useItem')).toBe('nimble-dev.useItem');
		env.game.system = undefined;
		expect(system.sysId()).toBe('nimble');
	});

	it('getDamageRollClass finds the class by capability, or null', () => {
		expect(system.getDamageRollClass()).toBeNull();
		class Plain {}
		class DamageRollLike {
			_evaluate() {}
			_finalizeOutcome() {}
			_recalculateTotal() {}
		}
		CONFIG.Dice.rolls = [Plain, DamageRollLike];
		expect(system.getDamageRollClass()).toBe(DamageRollLike);
		CONFIG.Dice.rolls = undefined;
		expect(system.getDamageRollClass()).toBeNull();
	});
});

describe('core/pools', () => {
	async function actorWithPools() {
		return makeCharacter(env, {
			items: [
				{
					name: 'Feat A',
					type: 'feature',
					flags: {
						nimble: {
							chargePools: { a1: { current: 2, max: 3 }, junk: 5, nil: null },
							dicePools: { d1: { current: 1, max: 2 } },
						},
					},
				},
				{ name: 'Plain', type: 'feature' },
			],
			pools: {
				'@actor': {
					chargePools: { 'actor:x': { current: 1, max: 1 }, 'noprefix': { current: 9, max: 9 } },
				},
			},
		});
	}

	it('iterates item- and actor-scoped charge pools, skipping non-objects and un-prefixed actor keys', async () => {
		const actor = await actorWithPools();
		const entries = [...pools.iterateChargePools(actor)].map((e) => [e.scope, e.key, e.document.name]);
		expect(entries).toEqual([
			['item', 'a1', 'Feat A'],
			['actor', 'actor:x', actor.name],
		]);
		expect([...pools.iterateDicePools(actor)].map((e) => e.key)).toEqual(['d1']);
	});

	it('handles null / item-less actors', () => {
		expect([...pools.iterateChargePools(null)]).toEqual([]);
		expect([...pools.iterateChargePools({})]).toEqual([]);
	});

	it('uses the dev system id as the flag scope', async () => {
		env.game.system.id = 'nimble-dev';
		const actor = await makeCharacter(env, {
			items: [{ name: 'F', type: 'feature', flags: { 'nimble-dev': { chargePools: { k: { current: 1, max: 1 } } }, nimble: { chargePools: { old: { current: 1, max: 1 } } } } }],
		});
		expect([...pools.iterateChargePools(actor)].map((e) => e.key)).toEqual(['k']);
	});

	it.each([
		[2, 3, 0, 0],
		[2, 3, -4, 0],
		[2, 3, 9, 3],
		[2, 3, 1.6, 2], // rounds → 2 === current → no write
		[2, 3, 1.4, 1],
		[0, 3, 3, 3],
	])('setChargePoolCurrent current=%i max=%i next=%s → %i (clamped)', async (current, max, next, expected) => {
		const actor = await actorWithPools();
		const item = actor.items.find((i) => i.name === 'Feat A');
		const entry = { document: item, key: 'a1', current, max };
		await pools.setChargePoolCurrent(entry, next);
		const stored = item._source.flags.nimble.chargePools.a1.current;
		expect(stored).toBe(expected === current ? 2 : expected);
		if (expected === current) expect(actor.callsOf('update')).toHaveLength(0);
	});

	it('setChargePoolCurrent writes only `current`, preserving other pool fields', async () => {
		const actor = await actorWithPools();
		const item = actor.items.find((i) => i.name === 'Feat A');
		await pools.setChargePoolCurrent({ document: item, key: 'a1', current: 2, max: 3 }, 1);
		expect(item._source.flags.nimble.chargePools.a1).toEqual({ current: 1, max: 3 });
	});

	it('setChargePoolCurrent on an actor-scoped pool updates the actor', async () => {
		const actor = await actorWithPools();
		await pools.setChargePoolCurrent({ document: actor, key: 'actor:x', current: 1, max: 1 }, 0);
		expect(actor._source.flags.nimble.chargePools['actor:x'].current).toBe(0);
	});

	it.fails('BUG-module-misc-1: setChargePoolCurrent never writes NaN (non-numeric next or missing max)', async () => {
		const actor = await actorWithPools();
		const item = actor.items.find((i) => i.name === 'Feat A');
		// A raw iterateChargePools entry has no top-level max/current.
		const raw = [...pools.iterateChargePools(actor)][0];
		await pools.setChargePoolCurrent(raw, 1);
		await pools.setChargePoolCurrent({ document: item, key: 'a1', current: 2, max: 3 }, undefined);
		expect(Number.isNaN(item._source.flags.nimble.chargePools.a1.current)).toBe(false);
	});
});

describe('core/rules', () => {
	function itemWithRules(list) {
		const map = new Map(list.map((r, i) => [r.id ?? `r${i}`, r]));
		return { name: 'Item', rules: map };
	}

	it('itemRuleValues tolerates missing / odd rules', () => {
		expect(rules.itemRuleValues(null)).toEqual([]);
		expect(rules.itemRuleValues({ rules: [] })).toEqual([]); // array has values() — returns elements
		expect(rules.itemRuleValues({ rules: {} })).toEqual([]);
		expect(rules.itemRuleValues(itemWithRules([{ type: 'a' }]))).toHaveLength(1);
	});

	it('hasActiveRule ignores disabled rules', () => {
		const item = itemWithRules([{ type: 'chargePool', disabled: true }, { type: 'other' }]);
		expect(rules.hasActiveRule(item, (r) => r.type === 'chargePool')).toBe(false);
		expect(rules.hasActiveRule(item, (r) => r.type === 'other')).toBe(true);
	});

	it('addSyntheticRule returns null for an unregistered rule type or rule-less item', () => {
		expect(rules.addSyntheticRule(itemWithRules([]), { type: 'nope', id: 'x' })).toBeNull();
		CONFIG.NIMBLE.ruleDataModels.chargePool = class {};
		expect(rules.addSyntheticRule({ name: 'x' }, { type: 'chargePool', id: 'x' })).toBeNull();
	});

	it('addSyntheticRule builds with the system class, keyed by rule id then source id', () => {
		const seen = [];
		CONFIG.NIMBLE.ruleDataModels.chargePool = class {
			constructor(source, options) {
				seen.push({ source, options });
				this.type = source.type;
				if (source.withId) this.id = 'fromRule';
			}
		};
		const item = itemWithRules([]);
		const a = rules.addSyntheticRule(item, { type: 'chargePool', id: 'src' });
		const b = rules.addSyntheticRule(item, { type: 'chargePool', id: 'src2', withId: true });
		expect(item.rules.get('src')).toBe(a);
		expect(item.rules.get('fromRule')).toBe(b);
		expect(seen[0].options).toEqual({ parent: item, strict: false });
	});

	it('addSyntheticRule swallows constructor errors and returns null', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		CONFIG.NIMBLE.ruleDataModels.bad = class {
			constructor() {
				throw new Error('boom');
			}
		};
		const item = itemWithRules([]);
		expect(rules.addSyntheticRule(item, { type: 'bad', id: 'b' })).toBeNull();
		expect(item.rules.size).toBe(0);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('core/level-up levelUpDialogActor', () => {
	async function character(opts = {}) {
		return makeCharacter(env, { classId: 'berserker', level: 2, ...opts });
	}
	class GenericDialog {
		constructor(data, options, open = new Map()) {
			this.data = data;
			this.options = options;
			GenericDialog.registry = open;
		}
		static getOpen(id) {
			return GenericDialog.registry?.get(id);
		}
	}

	it('matches the v13 uniqueId option', async () => {
		const actor = await character();
		const app = { data: { document: actor }, options: { uniqueId: `${actor.id}-level-up` } };
		expect(levelUp.levelUpDialogActor(app)).toBe(actor);
	});

	it('matches via the v14 singleton registry, and rejects a different registered app', async () => {
		const actor = await character();
		const app = new GenericDialog({ document: actor }, { uniqueId: '61' });
		GenericDialog.registry.set(`${actor.id}-level-up`, app);
		expect(levelUp.levelUpDialogActor(app)).toBe(actor);
		const other = new GenericDialog({ document: actor }, { uniqueId: '62', window: { title: 'X: Level Up (1 → 2)' } }, GenericDialog.registry);
		expect(levelUp.levelUpDialogActor(other)).toBeNull();
	});

	it.each([
		['Hero: Level Up (6 → 7)', true],
		['Hero: Level Down (7 → 6)', false],
		['Character Creator', false],
		['', false],
	])('title fallback %j → %s', async (title, matches) => {
		const actor = await character();
		const app = { data: { document: actor }, options: { uniqueId: '61', window: { title } } };
		expect(levelUp.levelUpDialogActor(app)).toBe(matches ? actor : null);
	});

	it('uses actor.getLevelUpDialogId when the actor provides it', async () => {
		const actor = await character();
		actor.getLevelUpDialogId = () => 'custom-id';
		expect(levelUp.levelUpDialogActor({ data: { document: actor }, options: { uniqueId: 'custom-id' } })).toBe(actor);
		expect(levelUp.levelUpDialogActor({ data: { document: actor }, options: { uniqueId: `${actor.id}-level-up` } })).toBeNull();
	});

	it('rejects non-actors, npcs and actors the user does not own', async () => {
		expect(levelUp.levelUpDialogActor(null)).toBeNull();
		expect(levelUp.levelUpDialogActor({ data: { document: { id: 'x', type: 'character' } } })).toBeNull();
		const npc = new env.classes.Actor({ name: 'Npc', type: 'npc' });
		expect(levelUp.levelUpDialogActor({ data: { document: npc }, options: { uniqueId: `${npc.id}-level-up` } })).toBeNull();
		const actor = await character({ ownedByPlayer: false });
		env.setUser({ isGM: false });
		expect(levelUp.levelUpDialogActor({ data: { document: actor }, options: { uniqueId: `${actor.id}-level-up` } })).toBeNull();
	});
});

describe('core/level-up waitForLevelUpAnchors', () => {
	beforeEach(() => installFakeDom());
	afterEach(() => uninstallFakeDom());

	it('resolves {} at once for a detached root', async () => {
		const root = el('div');
		await expect(levelUp.waitForLevelUpAnchors(root)).resolves.toEqual({});
	});

	it('finds body and footer once mounted', async () => {
		const body = el('div', { class: 'nimble-sheet__body' });
		const footer = el('div', { class: 'nimble-sheet__footer' });
		const root = el('div', {}, [body]);
		document.body.append(root);
		const p = levelUp.waitForLevelUpAnchors(root, 5);
		setTimeout(() => root.append(footer), 0);
		const out = await p;
		expect(out.body).toBe(body);
		expect(out.footer).toBe(footer);
	});

	it('gives up after the retry budget with whatever it found', async () => {
		const body = el('div', { class: 'nimble-sheet__body' });
		const root = el('div', {}, [body]);
		document.body.append(root);
		const out = await levelUp.waitForLevelUpAnchors(root, 2);
		expect(out).toEqual({ body, footer: null });
	});
});
