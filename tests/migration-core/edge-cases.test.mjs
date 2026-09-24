/**
 * Edge cases of the generic class-migration pass (scripts/core/class-migration/index.mjs).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, findDoc, itemNames, itemsNamed, makeCharacter, sourceOf } from '../harness/index.mjs';
import { CLASSES, MODULE_ID, NIM_FEATURES, SYS_FEATURES, duplicates, fingerprint, migrate, planSummary, world } from './helpers.mjs';

let env;
let migration;
let generic;

beforeEach(async () => {
	({ env, migration, generic } = await world({ playtest: true }));
});

const sysDoc = (name, q = {}) => findDoc({ pack: SYS_FEATURES, name, ...q });
const nimDoc = (name, q = {}) => findDoc({ pack: NIM_FEATURES, name, ...q });

describe('actors without a (core) class', () => {
	it('an empty character plans nothing', async () => {
		const actor = await makeCharacter(env, {});
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' })).toEqual([]);
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' })).toEqual([]);
	});

	it('a classless character that owns a superseded spell still gets the spell replaced (spells are always in scope)', async () => {
		const actor = await makeCharacter(env, { spells: ['Compendium.nimble.nimble-spells.Item.KICmDNpyNoMuZ20E'] });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(planSummary(plan).replacements).toEqual(['Lifebinding Spirit -> Lifebinding Spirit']);
		expect(plan.classes).toEqual([]);
		await migration.applyCoreClassMigration([plan], 'to02');
		expect(sourceOf(actor.items.contents[0])).toBe('Compendium.nim-plus-package.nim-plus-spells.Item.SAEd6Nk8SfgJ2Ff7');
	});

	it('non-character actors are skipped', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3);
		actor._source.type = 'npc';
		actor.prepareData();
		actor.type = 'npc';
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' })).toEqual([]);
	});

	it('a character with a non-core class only gets its superseded items touched, no progression added', async () => {
		const actor = await makeCharacter(env, {
			items: [{ name: 'Engineer', type: 'class', system: { identifier: 'engineer', classLevel: 5 } }],
		});
		actor._source.system.classData.levels = Array(5).fill('engineer');
		actor.prepareData();
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' })).toEqual([]);
	});
});

describe('multiclass: two class items', () => {
	async function commanderMage() {
		const actor = await buildCharacterAtLevel(env, 'commander', 3, { version: '2.0.3' });
		const mage = findDoc({ pack: 'nimble.nimble-classes', name: 'Mage' });
		const mageFeatures = (await import('../harness/index.mjs')).progressionEntries;
		const entries = await mageFeatures(mage.doc, 'mage', 2, '2.0.3');
		await actor.createEmbeddedDocuments('Item', [
			{ ...structuredClone(mage.doc), _id: undefined, _stats: { compendiumSource: mage.uuid }, system: { ...structuredClone(mage.doc.system), classLevel: 2 } },
			...entries.map((e) => ({ ...structuredClone(e.doc), _id: undefined, _stats: { compendiumSource: e.uuid } })),
		]);
		actor._source.system.classData.levels = ['commander', 'commander', 'commander', 'mage', 'mage'];
		actor.prepareData();
		actor.calls.length = 0;
		return actor;
	}

	it('uses each class level (not the character level) and runs one class context per class', async () => {
		const actor = await commanderMage();
		expect(actor.levels).toEqual({ character: 5, classes: { commander: 3, mage: 2 } });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.classes.map((c) => [c.ctx.classId, c.ctx.level])).toEqual([
			['commander', 3],
			['mage', 2],
		]);
		// Orders come at 4 in 0.2: the commander is 3 even though the character is 5.
		expect(planSummary(plan).removals).toContain("Commander's Orders (now gained at level 4)");
	});

	it('the classes filter leaves the other class alone', async () => {
		const actor = await commanderMage();
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02', classes: ['mage'] });
		const touched = [...plan.replacements.map((r) => r.item), ...plan.removals.map((r) => r.item)];
		expect(touched.filter((i) => i.system?.class === 'commander' || i.system?.identifier === 'commander')).toEqual([]);
		expect(plan.classes.map((c) => c.ctx.classId)).toEqual(['mage']);
	});

	it('apply on a multiclass character leaves no duplicate and keeps both class levels', async () => {
		const actor = await commanderMage();
		await migrate(migration, actor, 'to02');
		expect(duplicates(actor.items.map((i) => `${i.type}:${i.name}`))).toEqual([]);
		expect(actor.levels.classes).toEqual({ commander: 3, mage: 2 });
		for (const cls of actor.items.filter((i) => i.type === 'class')) {
			expect(cls.system.classLevel).toBe(cls.name === 'Mage' ? 2 : 3);
		}
	});
});

describe('the classes filter', () => {
	it.fails('BUG-migration-core-5: classes: [other class] still rewrites the actor\'s class spells', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 3, { spells: ['Lifebinding Spirit'] });
		const plans = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02', classes: ['mage'] });
		expect(plans).toEqual([]);
	});

	it('a filter on the actor\'s own class plans as without a filter', async () => {
		const a = await buildCharacterAtLevel(env, 'commander', 5);
		const [p1] = await migration.planCoreClassMigration({ actors: [a], direction: 'to02' });
		const [p2] = await migration.planCoreClassMigration({ actors: [a], direction: 'to02', classes: ['commander'] });
		expect(planSummary(p2)).toEqual(planSummary(p1));
	});
});

describe('class items and sources outside the packs', () => {
	it('a hand-made class item (no source) is kept as is; the progression is still reconciled', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5);
		const [cls] = actor.items.filter((i) => i.type === 'class');
		delete cls._source._stats.compendiumSource;
		cls.prepareData();
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.replacements.map((r) => r.item.id)).not.toContain(cls.id);
		expect(plan.classes.map((c) => c.ctx.classId)).toEqual(['commander']);
		await migration.applyCoreClassMigration([plan], 'to02');
		expect(actor.items.get(cls.id).name).toBe('Commander');
		expect(sourceOf(actor.items.get(cls.id))).toBeNull();
	});

	it('a class item copied from a world item is left alone', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 3);
		const [cls] = actor.items.filter((i) => i.type === 'class');
		cls._source._stats.compendiumSource = 'Item.abcdefghijklmnop';
		cls.prepareData();
		const plans = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		for (const plan of plans) expect(plan.replacements.map((r) => r.item.id)).not.toContain(cls.id);
	});

	it('an item whose source points at a deleted pack document is ignored', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 1, {
			items: [
				{ name: 'Ghost', type: 'feature', system: { class: 'mage' }, _stats: { compendiumSource: 'Compendium.nimble.nimble-class-features.Item.AAAAAAAAAAAAAAAA' } },
				{ name: 'Ghost 2', type: 'feature', system: { class: 'mage' }, _stats: { compendiumSource: 'Compendium.nim-plus-package.nim-plus-class-features.Item.BBBBBBBBBBBBBBBB' } },
			],
		});
		for (const direction of ['to02', 'to203']) {
			const plans = await migration.planCoreClassMigration({ actors: [actor], direction });
			for (const plan of plans) {
				const touched = [...plan.replacements, ...plan.removals].map((r) => r.item.name);
				expect(touched).not.toContain('Ghost');
				expect(touched).not.toContain('Ghost 2');
			}
		}
	});

	it('a replacement that cannot be loaded becomes a manual line and the item is left untouched', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { picks: ['Face Me!', 'Hold the Line!'] });
		const face = nimDoc('Face Me!').uuid;
		const real = globalThis.fromUuid;
		globalThis.fromUuid = async (uuid) => (String(uuid).endsWith(face.split('.').pop()) ? null : real(uuid));
		try {
			const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
			expect(plan.manual.join('\n')).toMatch(/Face Me!: its replacement .* could not be loaded/);
			expect(plan.replacements.map((r) => r.item.name)).not.toContain('Face Me!');
			await migration.applyCoreClassMigration([plan], 'to02');
			expect(sourceOf(itemsNamed(actor, 'Face Me!')[0])).toBe(sysDoc('Face Me!').uuid);
		} finally {
			globalThis.fromUuid = real;
		}
	});

	it('legacy flags.core.sourceId items migrate like _stats ones', async () => {
		const legacy = await buildCharacterAtLevel(env, 'commander', 5, { legacySourceId: true, picks: ['Face Me!'] });
		const modern = await buildCharacterAtLevel(env, 'commander', 5, { picks: ['Face Me!'] });
		await migrate(migration, legacy, 'to02');
		await migrate(migration, modern, 'to02');
		expect(fingerprint(legacy)).toEqual(fingerprint(modern));
	});
});

describe('partially migrated actors', () => {
	it('half the items already 0.2: the rest is migrated to the same end state as a fresh 2.0.3 character', async () => {
		const fresh = await buildCharacterAtLevel(env, 'commander', 5, { picks: ['Face Me!', 'Hold the Line!', 'Heavy Strike'] });
		const partial = await buildCharacterAtLevel(env, 'commander', 5, { picks: ['Face Me!', 'Hold the Line!', 'Heavy Strike'] });
		// Migrate half by hand (in place, as the migration would).
		for (const name of ['Commander', 'Coordinated Strike!', 'Face Me!', 'Master Commander']) {
			const [item] = itemsNamed(partial, name);
			const target = await generic.loadDoc(
				name === 'Commander' ? findDoc({ pack: 'nim-plus-package.nim-plus-classes', name }).uuid : nimDoc(name).uuid,
			);
			await generic.replaceInPlace(partial, item, target);
		}
		await migrate(migration, fresh, 'to02');
		await migrate(migration, partial, 'to02');
		expect(fingerprint(partial)).toEqual(fingerprint(fresh));
	});

	it.fails('BUG-migration-core-1: owning both the 2.0.3 and the 0.2 copy of a feature leaves a duplicate after to02', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, {
			picks: ['Face Me!', 'Hold the Line!', nimDoc('Face Me!').uuid],
		});
		expect(itemsNamed(actor, 'Face Me!')).toHaveLength(2);
		await migrate(migration, actor, 'to02');
		expect(itemsNamed(actor, 'Face Me!')).toHaveLength(1);
	});

	it.fails('BUG-migration-core-1: owning both copies leaves a duplicate after to203 too', async () => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await buildCharacterAtLevel(env, 'commander', 5, {
			version: '0.2',
			picks: ['Face Me!', 'Hold the Line!', sysDoc('Face Me!').uuid],
		});
		await migrate(migration, actor, 'to203');
		expect(itemsNamed(actor, 'Face Me!')).toHaveLength(1);
	});
});

describe('merged documents (Sunder Armor)', () => {
	it('to02: both 2.0.3 halves → the first is replaced in place, the other removed as merged', async () => {
		const actor = await buildCharacterAtLevel(env, 'the-cheat', 5, {
			picks: ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)'],
		});
		const [medium] = itemsNamed(actor, 'Sunder Armor (Medium)');
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(planSummary(plan).removals).toContain('Sunder Armor (Heavy) (merged into Sunder Armor)');
		await migration.applyCoreClassMigration([plan], 'to02');
		expect(itemsNamed(actor, 'Sunder Armor').map((i) => i.id)).toEqual([medium.id]);
		expect(itemNames(actor)).not.toContain('Sunder Armor (Heavy)');
	});

	it('to203: the merged 0.2 feature restores the first half and asks for the rest by hand', async () => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await buildCharacterAtLevel(env, 'the-cheat', 5, { version: '0.2', picks: ['Sunder Armor'] });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		expect(planSummary(plan).replacements).toContain('Sunder Armor -> Sunder Armor (Medium)');
		expect(plan.manual.join('\n')).toMatch(/Sunder Armor replaces 2 2\.0\.3 documents; only the first is restored/);
	});
});

describe('Commander L3: Commander\'s Orders (the grantedById parent of Coordinated Strike!) is removed', () => {
	async function l3() {
		return buildCharacterAtLevel(env, 'commander', 3, {
			version: '2.0.3',
			pools: { 'Coordinated Strike!': { chargePools: { 'coordinated-strike': { current: 1, max: 2, recoveries: [] } } } },
		});
	}

	it('to02 removes the Orders card but keeps Coordinated Strike! (same id, 0.2 source, pool kept)', async () => {
		const actor = await l3();
		const [orders] = itemsNamed(actor, "Commander's Orders");
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		expect(strike.system.grantedById).toBe(orders.id);
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(planSummary(plan).removals).toContain("Commander's Orders (now gained at level 4)");
		await migration.applyCoreClassMigration([plan], 'to02');
		expect(actor.items.has(orders.id)).toBe(false);
		const after = actor.items.get(strike.id);
		expect(after).toBeTruthy();
		expect(sourceOf(after)).toBe(nimDoc('Coordinated Strike!').uuid);
		expect(after.flags.nimble.chargePools['coordinated-strike'].current).toBe(1);
	});

	it.fails('BUG-migration-core-2: the kept Coordinated Strike! is left pointing at the removed Orders (dangling grantedById)', async () => {
		const actor = await l3();
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		await migrate(migration, actor, 'to02');
		const id = actor.items.get(strike.id).system.grantedById;
		expect(!id || actor.items.has(id)).toBe(true);
	});

	it('to02 then to203 restores the Orders card and a single Coordinated Strike!', async () => {
		const actor = await l3();
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		await migrate(migration, actor, 'to02');
		await migrate(migration, actor, 'to203');
		expect(itemsNamed(actor, "Commander's Orders")).toHaveLength(1);
		expect(itemsNamed(actor, 'Coordinated Strike!').map((i) => i.id)).toEqual([strike.id]);
		expect(actor.items.get(strike.id).flags.nimble.chargePools['coordinated-strike'].current).toBe(1);
	});

	it.fails('BUG-migration-core-3: to203 reports the granted Coordinated Strike! as "chosen at level Infinity"', async () => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version: '0.2' });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' });
		const text = [...plan.manual, ...plan.classes.flatMap((c) => c.lines)].join('\n');
		expect(text).not.toMatch(/Infinity/);
		expect(text).not.toMatch(/Coordinated Strike! is now chosen/);
	});
});

describe('stale Nim+ content flags after to203', () => {
	it('to02 copies the 0.2 document\'s Nim+ flags onto the replaced item', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { picks: ['Heavy Strike'] });
		await migrate(migration, actor, 'to02');
		expect(itemsNamed(actor, 'Heavy Strike')[0].getFlag(MODULE_ID, 'playtest02')).toBe(true);
	});

	it('fixed BUG-migration-core-4: an item moved back to 2.0.3 keeps flags.nim-plus-package.playtest02 (0.2 runtime rules stay on)', async () => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version: '0.2', picks: ['Heavy Strike'] });
		await migrate(migration, actor, 'to203');
		const [heavy] = itemsNamed(actor, 'Heavy Strike');
		expect(sourceOf(heavy)).toBe(sysDoc('Heavy Strike').uuid);
		expect(heavy.getFlag(MODULE_ID, 'playtest02')).not.toBe(true);
		expect(heavy.getFlag(MODULE_ID, 'supersedes')).toBeUndefined();
	});

	it('fixed BUG-migration-core-4: no class keeps a stale playtest02/supersedes flag after a 2.0.3 → 0.2 → 2.0.3 round trip', async () => {
		const stale = [];
		for (const cls of CLASSES) {
			({ env, migration } = await world({ playtest: true }));
			const actor = await buildCharacterAtLevel(env, cls, 20);
			await migrate(migration, actor, 'to02');
			await migrate(migration, actor, 'to203');
			for (const item of actor.items) {
				const f = item.flags?.[MODULE_ID] ?? {};
				if (f.playtest02 === true || f.supersedes) stale.push(`${cls}: ${item.name}`);
			}
		}
		expect(stale).toEqual([]);
	});
});

describe('plan hygiene', () => {
	it('planning never writes and never opens a dialog (class-module describe included), for every class at 20', async () => {
		for (const cls of CLASSES) {
			for (const [version, direction] of [
				['2.0.3', 'to02'],
				['0.2', 'to203'],
			]) {
				const actor = await buildCharacterAtLevel(env, cls, 20, { version });
				await migration.planCoreClassMigration({ actors: [actor], direction });
				expect(actor.calls, `${cls} ${direction}`).toEqual([]);
			}
		}
		expect(env.dialogs.log).toEqual([]);
	});

	it('a class module whose describe throws yields a warning line, not a failed plan', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3);
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		const mod = plan.classes[0].modules[0];
		const saved = mod.describe;
		mod.describe = () => {
			throw new Error('boom');
		};
		try {
			const [again] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
			expect(again.classes[0].lines).toEqual(['<em>Class-specific step failed to preview — see the console.</em>']);
		} finally {
			mod.describe = saved;
		}
	});

	it('a class module whose migrate throws reports an error and the generic changes still stand', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3);
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		const mod = plan.classes[0].modules[0];
		const saved = mod.migrate;
		mod.migrate = async () => {
			throw new Error('boom');
		};
		try {
			const touched = await migration.applyCoreClassMigration([plan], 'to02');
			expect(touched).toEqual([actor]);
			expect(env.notifications.messages('error').join('\n')).toMatch(/commander migration step failed/);
			expect(itemNames(actor)).not.toContain("Commander's Orders");
		} finally {
			mod.migrate = saved;
		}
	});

	it('applying a stale plan skips items deleted since planning', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { picks: ['Face Me!', 'Hold the Line!'] });
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		const [face] = itemsNamed(actor, 'Face Me!');
		const [tactics] = itemsNamed(actor, 'Combat Tactics'); // a planned removal
		await actor.deleteEmbeddedDocuments('Item', [face.id, tactics.id]);
		const touched = await migration.applyCoreClassMigration([plan], 'to02');
		expect(touched).toEqual([actor]);
		expect(env.notifications.messages('error')).toEqual([]);
	});

	it('the empty plan list applies nothing', async () => {
		expect(await migration.applyCoreClassMigration([], 'to02')).toEqual([]);
	});
});

describe('round trips of characters with choice-group picks (class-module prompts closed)', () => {
	const COMMANDER_PICKS = {
		2: ['Face Me!', 'Hold the Line!'],
		3: ['Face Me!', 'Hold the Line!'],
		4: ['Face Me!', 'Hold the Line!', 'Heavy Strike'],
		5: ['Face Me!', 'Hold the Line!', 'Commanding Presence'],
		10: ['Face Me!', 'Hold the Line!', 'Reposition!', 'Heavy Strike', 'Lunging Strike'],
	};
	it.each(Object.entries(COMMANDER_PICKS).map(([l, p]) => [Number(l), p]))(
		'commander %i with %j: 2.0.3 → to02 → to203 is lossless',
		async (level, picks) => {
			const actor = await buildCharacterAtLevel(env, 'commander', level, { picks });
			const fresh = fingerprint(actor);
			await migrate(migration, actor, 'to02');
			await migrate(migration, actor, 'to203');
			expect(fingerprint(actor)).toEqual(fresh);
		},
	);

	it.each([2, 5, 10])('the-cheat %i with Sunder Armor (Medium): round trip is lossless', async (level) => {
		const picks = level >= 4 ? ['Sunder Armor (Medium)'] : [];
		const actor = await buildCharacterAtLevel(env, 'the-cheat', level, { picks });
		const fresh = fingerprint(actor);
		await migrate(migration, actor, 'to02');
		await migrate(migration, actor, 'to203');
		expect(fingerprint(actor)).toEqual(fresh);
	});
});
