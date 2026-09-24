/**
 * Unit tests for scripts/core/class-migration/generic.mjs — every exported helper.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, findDoc, itemsNamed, makeCharacter, sourceOf } from '../harness/index.mjs';
import { MODULE_ID, NIM_FEATURES, SYS_FEATURES, world } from './helpers.mjs';

let env;
let generic;
let supersede;

beforeEach(async () => {
	({ env, generic, supersede } = await world({ playtest: true }));
});

const sysDoc = (name, q = {}) => findDoc({ pack: SYS_FEATURES, name, ...q });
const nimDoc = (name, q = {}) => findDoc({ pack: NIM_FEATURES, name, ...q });

describe('re-exports', () => {
	it('re-exports the supersede UUID helpers and escape', () => {
		for (const key of ['canonicalUuid', 'itemSourceUuid', 'liveUuid', 'parseCompendiumUuid', 'readUnfilteredIndex', 'escape']) {
			expect(typeof generic[key]).toBe('function');
		}
		expect(generic.canonicalUuid).toBe(supersede.canonicalUuid);
		expect(generic.escape(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
	});

	it('ACTOR_STATE_FIELDS keeps grantedById everywhere and the class state on class items', () => {
		expect(generic.ACTOR_STATE_FIELDS['*']).toEqual(['grantedById']);
		expect(generic.ACTOR_STATE_FIELDS.class).toEqual(['classLevel', 'hpData', 'abilityScoreData']);
	});

	it('FEATURE_INDEX_FIELDS includes the Nim+ supersede flags', () => {
		expect(generic.FEATURE_INDEX_FIELDS).toEqual(
			expect.arrayContaining([`flags.${MODULE_ID}.supersedes`, `flags.${MODULE_ID}.playtest02`, 'system.group']),
		);
	});
});

describe('isAutoGrantGroup', () => {
	it.each([
		['', true],
		[null, true],
		[undefined, true],
		['commander-progression', true],
		['shepherd-progression', true],
		['commanders-orders', false],
		['sacred-grace', false],
		['progression-x', false],
		['direbeast-form', false],
	])('%s → %s', (group, expected) => {
		expect(generic.isAutoGrantGroup(group)).toBe(expected);
	});
});

describe('classLevel', () => {
	it('reads the per-class level, falls back to the character level, else 0', () => {
		expect(generic.classLevel({ levels: { character: 7, classes: { mage: 3, hunter: 4 } } }, 'mage')).toBe(3);
		expect(generic.classLevel({ levels: { character: 7, classes: { mage: 3 } } }, 'hunter')).toBe(7);
		expect(generic.classLevel({ levels: {} }, 'mage')).toBe(0);
		expect(generic.classLevel(null, 'mage')).toBe(0);
		expect(generic.classLevel(undefined, 'mage')).toBe(0);
	});

	it('matches a built character', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 11);
		expect(generic.classLevel(actor, 'mage')).toBe(11);
	});
});

describe('minLevel', () => {
	it.each([
		[{ system: { gainedAtLevels: [5, 2, 9] } }, 2],
		[{ system: { gainedAtLevels: [], gainedAtLevel: 4 } }, 4],
		[{ system: { gainedAtLevel: 3 } }, 3],
		[{ system: { gainedAtLevels: [7], gainedAtLevel: 1 } }, 7], // the array wins
		[{ system: {} }, Number.POSITIVE_INFINITY],
		[{ system: { gainedAtLevel: null } }, Number.POSITIVE_INFINITY],
		[{}, Number.POSITIVE_INFINITY],
		[null, Number.POSITIVE_INFINITY],
	])('%j → %s', (feature, expected) => {
		expect(generic.minLevel(feature)).toBe(expected);
	});
});

describe('classItems', () => {
	it('returns every class item, [] for no items or no actor', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 2);
		expect(generic.classItems(actor).map((i) => i.name)).toEqual(['Mage']);
		const empty = await makeCharacter(env, {});
		expect(generic.classItems(empty)).toEqual([]);
		expect(generic.classItems(null)).toEqual([]);
	});
});

describe('findOwnedBySource', () => {
	it('matches _stats.compendiumSource, any spelling of the uuid', async () => {
		const orders = sysDoc("Commander's Orders");
		const actor = await buildCharacterAtLevel(env, 'commander', 1);
		const [owned] = itemsNamed(actor, "Commander's Orders");
		expect(generic.findOwnedBySource(actor, [orders.uuid])).toEqual([owned]);
		// Without the `.Item.` segment.
		expect(generic.findOwnedBySource(actor, [orders.uuid.replace('.Item.', '.')])).toEqual([owned]);
		// A Set works too.
		expect(generic.findOwnedBySource(actor, new Set([orders.uuid]))).toEqual([owned]);
	});

	it('matches the legacy flags.core.sourceId', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 1, { legacySourceId: true });
		const [owned] = itemsNamed(actor, "Commander's Orders");
		expect(owned._stats.compendiumSource).toBeUndefined();
		expect(generic.findOwnedBySource(actor, [sysDoc("Commander's Orders").uuid])).toEqual([owned]);
	});

	it('matches a live nimble-dev spelling on a nimble world (canonical package)', async () => {
		({ env, generic } = await world({ playtest: true, systemId: 'nimble-dev' }));
		const actor = await buildCharacterAtLevel(env, 'commander', 1);
		const [owned] = itemsNamed(actor, "Commander's Orders");
		const live = sysDoc("Commander's Orders").uuid.replace('Compendium.nimble.', 'Compendium.nimble-dev.');
		expect(generic.findOwnedBySource(actor, [live])).toEqual([owned]);
	});

	it('ignores items without a source and world-item sources', async () => {
		const actor = await makeCharacter(env, {
			items: [
				{ name: 'Homebrew', type: 'feature', system: {} },
				{ name: 'From world', type: 'feature', system: {}, _stats: { compendiumSource: 'Item.abcdefghijklmnop' } },
			],
		});
		expect(generic.findOwnedBySource(actor, ['Item.abcdefghijklmnop'])).toEqual([]);
		expect(generic.findOwnedBySource(actor, [null, undefined, ''])).toEqual([]);
		expect(generic.findOwnedBySource(actor, [])).toEqual([]);
		expect(generic.findOwnedBySource(actor, undefined)).toEqual([]);
		expect(generic.findOwnedBySource(null, ['x'])).toEqual([]);
	});

	it('returns every copy when an actor owns duplicates', async () => {
		const uuid = sysDoc('Face Me!').uuid;
		const actor = await makeCharacter(env, { classId: 'commander', features: [uuid] });
		// A second copy of the same doc.
		await actor.createEmbeddedDocuments('Item', [{ ...actor.items.find((i) => i.name === 'Face Me!').toObject(), _id: undefined }]);
		expect(generic.findOwnedBySource(actor, [uuid])).toHaveLength(2);
	});
});

describe('findOwnedByName', () => {
	it('is case- and whitespace-insensitive and filters by type', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 1);
		expect(generic.findOwnedByName(actor, "  commander's ORDERS ")).toHaveLength(1);
		expect(generic.findOwnedByName(actor, "Commander's Orders", 'feature')).toHaveLength(1);
		expect(generic.findOwnedByName(actor, "Commander's Orders", 'spell')).toHaveLength(0);
		expect(generic.findOwnedByName(actor, 'Commander', 'class')).toHaveLength(1);
		expect(generic.findOwnedByName(actor, 'nope')).toEqual([]);
		expect(generic.findOwnedByName(actor, null)).toEqual([]);
		expect(generic.findOwnedByName(null, 'x')).toEqual([]);
	});
});

describe('loadDoc', () => {
	it('loads a canonical uuid, a no-.Item. uuid, and returns null for deleted / junk uuids', async () => {
		const uuid = sysDoc('Face Me!').uuid;
		expect((await generic.loadDoc(uuid))?.name).toBe('Face Me!');
		expect((await generic.loadDoc(uuid.replace('.Item.', '.')))?.name).toBe('Face Me!');
		expect(await generic.loadDoc('Compendium.nimble.nimble-class-features.Item.AAAAAAAAAAAAAAAA')).toBeNull();
		expect(await generic.loadDoc('not a uuid')).toBeNull();
		expect(await generic.loadDoc(null)).toBeNull();
	});

	it('resolves canonical nimble uuids against a nimble-dev system', async () => {
		({ env, generic } = await world({ playtest: true, systemId: 'nimble-dev' }));
		const doc = await generic.loadDoc(sysDoc('Face Me!').uuid);
		expect(doc?.name).toBe('Face Me!');
		expect(doc.uuid).toMatch(/^Compendium\.nimble-dev\./);
	});
});

describe('replacementUpdate / replaceInPlace', () => {
	async function commanderWithState() {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, {
			version: '2.0.3',
			picks: ['Heavy Strike'],
			pools: { 'Coordinated Strike!': { chargePools: { 'coordinated-strike': { current: 1, max: 3, recoveries: [] } } } },
			flags: { 'Coordinated Strike!': { [MODULE_ID]: { someRuntimeState: 42 }, world: { note: 'x' } } },
		});
		return actor;
	}

	it('keeps _id, every flag scope and grantedById; replaces name/img/system; moves the source', async () => {
		const actor = await commanderWithState();
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		const [orders] = itemsNamed(actor, "Commander's Orders");
		expect(strike.system.grantedById).toBe(orders.id);
		const target = await generic.loadDoc(nimDoc('Coordinated Strike!').uuid);

		const update = generic.replacementUpdate(strike, target);
		expect(update._id).toBe(strike.id);
		expect(update.name).toBe(target.name);
		expect(update.img).toBe(target.img);
		expect(update['_stats.compendiumSource']).toBe(target.uuid);
		// ForcedReplacement of system (v14 operator), with the actor state merged in.
		const system = update.system;
		expect(system).toBeInstanceOf(foundry.data.operators.ForcedReplacement);
		// Only the target's Nim+ flags are written; other scopes are untouched by the merge.
		expect(Object.keys(update.flags ?? {})).toEqual([MODULE_ID]);

		const updated = await generic.replaceInPlace(actor, strike, target);
		expect(updated.id).toBe(strike.id);
		const after = actor.items.get(strike.id);
		expect(sourceOf(after)).toBe(nimDoc('Coordinated Strike!').uuid);
		expect(after.flags.nimble.chargePools['coordinated-strike'].current).toBe(1);
		expect(after.flags.world.note).toBe('x');
		expect(after.flags[MODULE_ID].someRuntimeState).toBe(42);
		expect(after.flags[MODULE_ID].supersedes).toEqual(target.flags[MODULE_ID].supersedes);
		expect(after.system.grantedById).toBe(orders.id);
		// The whole system is the target's (plus grantedById): no stale keys survive.
		const expected = { ...target.toObject().system, grantedById: orders.id };
		expect(after._source.system).toEqual(expected);
	});

	it('drops system keys the target does not have (ForcedReplacement, not a merge)', async () => {
		const actor = await commanderWithState();
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		await strike.update({ 'system.staleKey': { a: 1 }, 'system.selectionCountByLevel': { 99: 1 } });
		const target = await generic.loadDoc(nimDoc('Coordinated Strike!').uuid);
		await generic.replaceInPlace(actor, strike, target);
		const after = actor.items.get(strike.id);
		expect(after._source.system.staleKey).toBeUndefined();
		expect(after._source.system.selectionCountByLevel?.[99]).toBeUndefined();
	});

	it('keeps classLevel, hpData and abilityScoreData on the class item', async () => {
		const actor = await commanderWithState();
		const [cls] = actor.items.filter((i) => i.type === 'class');
		const before = foundry.utils.deepClone(cls._source.system);
		const target = await generic.loadDoc(findDoc({ pack: 'nim-plus-package.nim-plus-classes', name: 'Commander' }).uuid);
		await generic.replaceInPlace(actor, cls, target);
		const after = actor.items.get(cls.id);
		expect(after._source.system.classLevel).toBe(5);
		expect(after._source.system.hpData).toEqual(before.hpData);
		expect(after._source.system.abilityScoreData).toEqual(before.abilityScoreData);
		expect(sourceOf(after)).toBe(target.uuid);
		expect(actor.levels.classes.commander).toBe(5);
	});

	it('does not add actor-state keys that the owned item did not have', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 1);
		const [orders] = itemsNamed(actor, "Commander's Orders");
		expect('grantedById' in orders._source.system).toBe(false);
		const target = await generic.loadDoc(nimDoc("Commander's Orders").uuid);
		const update = generic.replacementUpdate(orders, target);
		await actor.updateEmbeddedDocuments('Item', [update]);
		expect('grantedById' in actor.items.get(orders.id)._source.system).toBe(false);
	});

	it('writes no flags key when the target has no Nim+ flags (to203)', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version: '0.2' });
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		const target = await generic.loadDoc(sysDoc('Coordinated Strike!').uuid);
		const update = generic.replacementUpdate(strike, target);
		expect(update.flags).toBeUndefined();
	});

	it('falls back to the ==system key when the ForcedReplacement operator is missing', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 1);
		const [orders] = itemsNamed(actor, "Commander's Orders");
		const target = await generic.loadDoc(nimDoc("Commander's Orders").uuid);
		const saved = foundry.data.operators.ForcedReplacement;
		try {
			delete foundry.data.operators.ForcedReplacement;
			const update = generic.replacementUpdate(orders, target);
			expect(update['==system']).toBeDefined();
			expect(update.system).toBeUndefined();
			await actor.updateEmbeddedDocuments('Item', [update]);
			expect(actor.items.get(orders.id)._source.system.gainedAtLevels).toEqual([4]);
		} finally {
			foundry.data.operators.ForcedReplacement = saved;
		}
	});

	it('replaceInPlace records exactly one update call', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 1);
		const [orders] = itemsNamed(actor, "Commander's Orders");
		await generic.replaceInPlace(actor, orders, await generic.loadDoc(nimDoc("Commander's Orders").uuid));
		expect(actor.callsOf('update')).toHaveLength(1);
		expect(actor.callsOf('create')).toHaveLength(0);
		expect(actor.callsOf('delete')).toHaveLength(0);
	});
});

describe('creationData / addFeature', () => {
	it('strips _id/folder/sort/ownership and records the compendium source', async () => {
		const doc = await generic.loadDoc(nimDoc('Heavy Strike').uuid);
		const data = generic.creationData(doc);
		expect(data._id).toBeUndefined();
		expect(data.folder).toBeUndefined();
		expect(data.sort).toBeUndefined();
		expect(data.ownership).toBeUndefined();
		expect(data._stats.compendiumSource).toBe(doc.uuid);
		expect(data.name).toBe('Heavy Strike');
		// Does not mutate the pack document.
		expect(doc._id).toBeTruthy();
	});

	it('addFeature creates one or several docs, ignoring nulls; [] for nothing', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 1);
		const heavy = await generic.loadDoc(nimDoc('Heavy Strike').uuid);
		const lunge = await generic.loadDoc(nimDoc('Lunging Strike').uuid);
		expect(await generic.addFeature(actor, [])).toEqual([]);
		expect(await generic.addFeature(actor, [null, undefined])).toEqual([]);
		expect(actor.callsOf('create')).toHaveLength(0);
		const [one] = await generic.addFeature(actor, heavy);
		expect(sourceOf(one)).toBe(heavy.uuid);
		const two = await generic.addFeature(actor, [lunge, null]);
		expect(two.map((i) => i.name)).toEqual(['Lunging Strike']);
		expect(actor.callsOf('create')).toHaveLength(2);
	});
});

describe('removeItems', () => {
	it('accepts documents or ids, skips unknown ids, and never throws on a missing item', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { picks: ['Face Me!', 'Hold the Line!'] });
		const [face] = itemsNamed(actor, 'Face Me!');
		const [hold] = itemsNamed(actor, 'Hold the Line!');
		expect(await generic.removeItems(actor, [])).toEqual([]);
		expect(await generic.removeItems(actor, ['nope', null, undefined])).toEqual([]);
		expect(actor.callsOf('delete')).toHaveLength(0);
		await generic.removeItems(actor, face);
		expect(actor.items.has(face.id)).toBe(false);
		await generic.removeItems(actor, [hold.id, face.id]); // face already gone
		expect(actor.items.has(hold.id)).toBe(false);
		expect(actor.callsOf('delete').map((c) => c.ids)).toEqual([[face.id], [hold.id]]);
	});
});

describe('promptChoice', () => {
	const options = [
		{ value: 'a', label: 'Alpha', hint: 'first' },
		{ value: 'b', label: 'Beta', checked: true },
		{ value: 'c', label: 'Gamma <c>', checked: true },
	];

	it('returns [] without a dialog for no options or count < 1', async () => {
		expect(await generic.promptChoice(null, { title: 'T', options: [], count: 1 })).toEqual([]);
		expect(await generic.promptChoice(null, { title: 'T', options, count: 0 })).toEqual([]);
		expect(await generic.promptChoice(null)).toEqual([]);
		expect(env.dialogs.log).toEqual([]);
	});

	it('returns every value without a dialog when count >= options', async () => {
		expect(await generic.promptChoice(null, { title: 'T', options, count: 3 })).toEqual(['a', 'b', 'c']);
		expect(await generic.promptChoice(null, { title: 'T', options, count: 9 })).toEqual(['a', 'b', 'c']);
		expect(env.dialogs.log).toEqual([]);
	});

	it('radio for count 1, checkbox for more; escapes labels; shows the actor name', async () => {
		env.dialogs.answerWhen(/Pick one/, { action: 'ok', checked: ['a'] });
		env.dialogs.answerWhen(/Pick two/, { action: 'ok', checked: ['a', 'c'] });
		const actor = { name: 'Zed <b>' };
		expect(await generic.promptChoice(actor, { title: 'Pick one', options, count: 1 })).toEqual(['a']);
		expect(await generic.promptChoice(actor, { title: 'Pick two', options, count: 2 })).toEqual(['a', 'c']);
		const [one, two] = env.dialogs.log;
		expect(one.title).toBe('Nim+ | Pick one');
		expect(one.content).toMatch(/type="radio"/);
		expect(two.content).toMatch(/type="checkbox"/);
		expect(one.content).toContain('Gamma &lt;c&gt;');
		expect(one.content).toContain('Zed &lt;b&gt;');
		expect(one.content).toContain('Choose 1:');
		expect(two.content).toContain('Choose 2:');
	});

	it('the checked defaults are pre-selected (confirming without changes picks them)', async () => {
		env.dialogs.answerWhen(/Defaults/, { action: 'ok' }); // no `checked`: the content's checked inputs
		expect(await generic.promptChoice(null, { title: 'Defaults', options, count: 2 })).toEqual(['b', 'c']);
	});

	it('cancel → null; closing the dialog → null', async () => {
		env.dialogs.answerWhen(/Cancel me/, 'cancel');
		expect(await generic.promptChoice(null, { title: 'Cancel me', options, count: 1 })).toBeNull();
		env.dialogs.answerWhen(/Close me/, null);
		expect(await generic.promptChoice(null, { title: 'Close me', options, count: 1 })).toBeNull();
	});

	it('loops with a warning until exactly count are picked', async () => {
		env.dialogs
			.answerWhen(/Loop/, { action: 'ok', checked: ['a'] })
			.answerWhen(/Loop/, { action: 'ok', checked: ['a', 'b', 'c'] })
			.answerWhen(/Loop/, { action: 'ok', checked: ['b', 'c'] });
		expect(await generic.promptChoice(null, { title: 'Loop', options, count: 2 })).toEqual(['b', 'c']);
		expect(env.dialogs.log).toHaveLength(3);
		expect(env.notifications.messages('warn').filter((m) => /Choose exactly 2/.test(m))).toHaveLength(2);
	});

	it('a wrong count followed by a close ends the loop with null', async () => {
		env.dialogs.answerWhen(/Once/, { action: 'ok', checked: [] });
		expect(await generic.promptChoice(null, { title: 'Once', options, count: 1 })).toBeNull();
		expect(env.dialogs.log).toHaveLength(2);
	});
});
