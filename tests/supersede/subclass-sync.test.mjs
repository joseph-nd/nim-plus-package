/**
 * scripts/core/subclass-sync.mjs — preview/apply, the supersede interplay
 * (pending migrations, hidden docs), LEGACY_IDENTIFIERS, and the startup chain
 * with the class migration.
 */
import { describe, expect, it } from 'vitest';
import {
	buildCharacterAtLevel,
	findDoc,
	findDocs,
	itemNames,
	itemsNamed,
	makeCharacter,
	MODULE_ID,
	setupWorld,
	sourceOf,
	supersedeOracle,
} from '../harness/index.mjs';

const NIM_FEATURES = `${MODULE_ID}.nim-plus-class-features`;
const NIM_SUBCLASSES = `${MODULE_ID}.nim-plus-subclasses`;
const SYNC_SETTING = 'subclassSyncVersion';
const MIGRATION_SETTING_PREFIX = 'classMigrationVersion';

/** Mutate an owned item's persisted source without going through update (no call log). */
function editSource(item, fn) {
	fn(item._source);
	item.prepareData();
}

function dupNames(actor) {
	const seen = new Map();
	for (const i of actor.items) seen.set(i.name, (seen.get(i.name) ?? 0) + 1);
	return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

/**
 * Let the (un-awaited) ready-queue work finish. The class migration loads its
 * class modules with a dynamic import(), which takes real time under vitest, so
 * promise flushing alone is not enough: poll until `done()` or the queue is idle.
 */
async function settle(env, done = () => false, ms = 4000) {
	const start = Date.now();
	let quiet = 0;
	let last = -1;
	while (Date.now() - start < ms) {
		await env.flush();
		if (done()) break;
		const n = env.dialogs.log.length + env.log.length;
		quiet = n === last ? quiet + 1 : 0;
		last = n;
		if (quiet > 15) break;
		await new Promise((r) => setTimeout(r, 20));
	}
	await env.flush();
}

const supersedeHas = (mods, actor) => mods[1].hasPendingClassMigration(actor);

const subNames = (a) =>
	a.items
		.filter((i) => i.type === 'feature' && i.system.subclass)
		.map((i) => i.name)
		.sort();

async function world(opts = {}) {
	const { env, mods } = await setupWorld(opts);
	await env.flush();
	const [, supersede, sync, migration] = mods;
	return { env, supersede, sync, migration };
}

async function pactOfTheId(env, level = 7, version = '0.2') {
	return buildCharacterAtLevel(env, 'shadowmancer', level, { version, subclass: 'Pact of the Id' });
}

describe('subclass sync — preview / apply', () => {
	it('an up-to-date character needs nothing', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await pactOfTheId(env);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
		expect(await sync.syncSubclasses({ actors: [actor] })).toBe('nothing');
		expect(env.notifications.messages('info').join()).toMatch(/up to date/);
		expect(env.dialogs.log).toEqual([]);
	});

	it('stale text → updated in place (id and flags kept); missing feature added; level gating respected', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await pactOfTheId(env, 7);
		const [fp] = itemsNamed(actor, 'Fractured Psyche');
		editSource(fp, (s) => {
			s.system.description = '<p>old text</p>';
			s.flags.nimble = { chargePools: { x: { current: 1 } } };
		});
		const [hyper] = itemsNamed(actor, 'Hyperfixation');
		actor.items.delete(hyper.id);

		const report = await sync.planSubclassSync([actor]);
		expect(report).toHaveLength(1);
		const [plan] = report[0].plans;
		expect(plan.featureUpdates.map((u) => u._id)).toEqual([fp.id]);
		expect(plan.featureAdditions.map((d) => d.name)).toEqual(['Hyperfixation']);
		expect(plan.featureRemovals).toEqual([]);
		expect(actor.calls).toEqual([]); // planning never writes

		env.dialogs.answerWhen(/Subclass update/, 'apply');
		expect(await sync.syncSubclasses({ actors: [actor] })).toBe('applied');
		const [after] = itemsNamed(actor, 'Fractured Psyche');
		expect(after.id).toBe(fp.id);
		expect(after.system.description).not.toBe('<p>old text</p>');
		expect(after.flags.nimble.chargePools.x.current).toBe(1);
		expect(itemsNamed(actor, 'Hyperfixation')).toHaveLength(1);
		expect(sourceOf(itemsNamed(actor, 'Hyperfixation')[0])).toBe(findDoc({ pack: NIM_FEATURES, name: 'Hyperfixation' }).uuid);
		// L11/L15 features are not added at 7.
		expect(itemNames(actor)).not.toContain('Know Your Limits');
		expect(dupNames(actor)).toEqual([]);
		// Idempotent.
		expect(await sync.planSubclassSync([actor])).toEqual([]);
	});

	it('a feature whose pack entry vanished is removed; a duplicate copy is removed; other-pack features are left alone', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await pactOfTheId(env, 3);
		const [dm] = itemsNamed(actor, 'Defense Mechanism');
		await actor.createEmbeddedDocuments('Item', [
			{ ...dm.toObject(), _id: undefined, name: 'Defense Mechanism' },
			{
				name: 'Ghost',
				type: 'feature',
				system: { subclass: true, class: 'shadowmancer', group: 'pact-of-the-id', gainedAtLevels: [3] },
				_stats: { compendiumSource: `Compendium.${NIM_FEATURES}.Item.GGGGGGGGGGGGGGGG` },
			},
			{
				name: 'Foreign',
				type: 'feature',
				system: { subclass: true, class: 'shadowmancer', group: 'pact-of-the-id', gainedAtLevels: [3] },
				_stats: { compendiumSource: 'Compendium.other-mod.features.Item.FFFFFFFFFFFFFFFF' },
			},
		]);
		const [plan] = (await sync.planSubclassSync([actor]))[0].plans;
		expect(plan.featureRemovals.map((f) => f.name).sort()).toEqual(['Defense Mechanism', 'Ghost']);
		await sync.applySubclassSync(await sync.planSubclassSync([actor]));
		expect(itemsNamed(actor, 'Defense Mechanism')).toHaveLength(1);
		expect(itemNames(actor)).toContain('Foreign');
		expect(itemNames(actor)).not.toContain('Ghost');
	});

	it.each([
		['later', 'postponed'],
		[null, 'postponed'],
	])('dialog answer %s → %s, nothing written', async (answer, result) => {
		const { env, sync } = await world({ playtest: true });
		const actor = await pactOfTheId(env, 7);
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		env.dialogs.answerWhen(/Subclass update/, answer);
		expect(await sync.syncSubclasses({ actors: [actor] })).toBe(result);
		expect(actor.calls).toEqual([]);
	});

	it('a player cannot sync', async () => {
		const { env, sync } = await world({ playtest: true, isGM: false });
		const actor = await pactOfTheId(env, 7);
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		expect(await sync.syncSubclasses({ actors: [actor], apply: true })).toBe('nothing');
		expect(env.notifications.messages('warn').join()).toMatch(/Only a GM/);
		expect(actor.calls).toEqual([]);
	});

	it('the preview escapes names', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await pactOfTheId(env, 7);
		actor.name = '<b>Evil</b>';
		actor._source.name = '<b>Evil</b>';
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		env.dialogs.answerWhen(/Subclass update/, 'later');
		await sync.syncSubclasses({ actors: [actor] });
		expect(env.dialogs.log[0].content).not.toContain('<b>Evil</b>');
	});
});

describe('subclass sync — LEGACY_IDENTIFIERS and source-less items', () => {
	it.each([
		['shadowmancer', 'Pact of the Ego', 'Pact of the Id'],
		['shadowmancer', 'Pact of the High Celestial', 'Pact of the Celestial'],
		['berserker', 'Path of the Titans', 'Path of the Titan'],
	])('%s: a source-less "%s" is renamed to "%s"', async (cls, oldName, newName) => {
		const { env, sync } = await world({ playtest: true });
		const actor = await buildCharacterAtLevel(env, cls, 3, { version: '0.2', subclass: newName });
		const sub = actor.items.find((i) => i.type === 'subclass');
		editSource(sub, (s) => {
			s.name = oldName;
			delete s._stats.compendiumSource;
		});
		expect(sub.system.identifier).toBe(oldName.slugify({ strict: true }));
		const report = await sync.planSubclassSync([actor]);
		const plan = report[0]?.plans[0];
		expect(plan?.update?.name).toBe(newName);
		await sync.applySubclassSync(report);
		expect(actor.items.find((i) => i.type === 'subclass').name).toBe(newName);
		expect(dupNames(actor)).toEqual([]);
	});

	it('the legacy fallback requires the same parent class', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await buildCharacterAtLevel(env, 'shadowmancer', 3, { version: '0.2', subclass: 'Pact of the Id' });
		const sub = actor.items.find((i) => i.type === 'subclass');
		editSource(sub, (s) => {
			s.name = 'Pact of the Ego';
			s.system.parentClass = 'mage';
			delete s._stats.compendiumSource;
		});
		const report = await sync.planSubclassSync([actor]);
		expect(report.flatMap((r) => r.plans).filter((p) => p.item.id === sub.id)).toEqual([]);
	});

	it('keeper-of-the-pack is deliberately not a legacy alias (only exact identifiers match)', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await buildCharacterAtLevel(env, 'hunter', 3, { version: '0.2', subclass: 'Keeper of the Primal Pack' });
		const sub = actor.items.find((i) => i.type === 'subclass');
		editSource(sub, (s) => {
			s.name = 'Keeper of the Wolfpack';
			delete s._stats.compendiumSource;
		});
		const report = await sync.planSubclassSync([actor]);
		expect(report.flatMap((r) => r.plans).filter((p) => p.item.id === sub.id)).toEqual([]);
	});

	it('legacy flags.core.sourceId sources are matched like _stats.compendiumSource', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await buildCharacterAtLevel(env, 'shadowmancer', 7, { version: '0.2', subclass: 'Pact of the Id', legacySourceId: true });
		expect(await sync.planSubclassSync([actor])).toEqual([]);
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		const [plan] = (await sync.planSubclassSync([actor]))[0].plans;
		expect(plan.featureAdditions.map((d) => d.name)).toEqual(['Hyperfixation']);
		expect(plan.featureRemovals).toEqual([]);
	});

	it('fixed BUG-supersede-3: a source-less OFFICIAL 2.0.3 subclass is not hijacked by the same-named Nim+ 0.2 copy', async () => {
		// Before 0.2 every Nim+ subclass name was unique; the 0.2 copies share their name with the
		// official subclass, so the identifier fallback now matches system subclasses too.
		const { env, sync } = await world({ playtest: true });
		const actor = await buildCharacterAtLevel(env, 'shepherd', 7, { version: '2.0.3', subclass: 'Luminary of Mercy' });
		for (const item of actor.items) editSource(item, (s) => delete s._stats.compendiumSource); // a very old world
		const report = await sync.planSubclassSync([actor]);
		expect(report).toEqual([]);
	});

	it.fails('BUG-supersede-6: a source-less unchanged system feature of an official 0.2 subclass is not deleted by the sync', async () => {
		// An official 0.2 subclass keeps its unchanged system features in the system pack. A
		// source-less copy of one of those has no Nim+ counterpart, so the sync removes it
		// ("owned copy of a deleted pack entry") and nothing ever re-adds it.
		const oracle = await supersedeOracle();
		const nimSubs = findDocs({ pack: NIM_SUBCLASSES, where: (d) => d.flags?.[MODULE_ID]?.supersedes?.length });
		let found = null;
		for (const { doc } of nimSubs) {
			const group = doc.name.toLowerCase().replace(/&/g, 'and').replace(/[\s-]+/g, '-').replace(/[^a-z0-9-]/g, '');
			const sys = findDocs({ pack: 'nimble.nimble-class-features', class: doc.system.parentClass, group, subclass: true }).filter(
				(h) => !oracle.supersededBy.has(h.uuid) && !oracle.retired.has(h.uuid),
			);
			if (sys.length) {
				found = { doc, sys: sys[0] };
				break;
			}
		}
		if (!found) return; // every official 0.2 subclass copies all its features — nothing to check
		const { env, sync } = await world({ playtest: true });
		const level = Math.max(3, ...(found.sys.doc.system.gainedAtLevels ?? [3]));
		const actor = await buildCharacterAtLevel(env, found.doc.system.parentClass, level, { version: '0.2', subclass: found.doc.name });
		const [owned] = itemsNamed(actor, found.sys.doc.name);
		expect(owned, `${found.sys.doc.name} should be owned`).toBeDefined();
		editSource(owned, (s) => delete s._stats.compendiumSource);
		const report = await sync.planSubclassSync([actor]);
		const removals = report.flatMap((r) => r.plans).flatMap((p) => p.featureRemovals).map((f) => f.name);
		expect(removals).not.toContain(found.sys.doc.name);
	});
});

describe('subclass sync — supersede interplay', () => {
	it('skips a character whose class migration is pending (setting on, 2.0.3 items left)', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await buildCharacterAtLevel(env, 'shepherd', 7, { version: '2.0.3', subclass: 'Luminary of Mercy' });
		// A half-migrated character: its subclass item already points at the Nim+ 0.2 copy.
		const sub = actor.items.find((i) => i.type === 'subclass');
		const nim = findDoc({ pack: NIM_SUBCLASSES, name: 'Luminary of Mercy' });
		editSource(sub, (s) => (s._stats.compendiumSource = nim.uuid));
		expect(await sync.planSubclassSync([actor])).toEqual([]);
		// With every 2.0.3 item gone it is no longer pending and the sync takes it on.
		const oracle = await supersedeOracle();
		for (const item of [...actor.items]) if (oracle.supersededBy.has(sourceOf(item)) || oracle.retired.has(sourceOf(item))) actor.items.delete(item.id);
		expect((await sync.planSubclassSync([actor])).length).toBe(1);
	});

	it('skips a character with 0.2 items while the setting is off', async () => {
		const { env, sync } = await world({ playtest: false });
		const actor = await buildCharacterAtLevel(env, 'shadowmancer', 7, { version: '0.2', subclass: 'Pact of the Id' });
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
	});

	it('setting off: a non-core Nim+ subclass on a 2.0.3 character still syncs', async () => {
		const { env, sync } = await world({ playtest: false });
		const actor = await buildCharacterAtLevel(env, 'shadowmancer', 7, { version: '2.0.3', subclass: 'Pact of the Id' });
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		const [plan] = (await sync.planSubclassSync([actor]))[0].plans;
		expect(plan.featureAdditions.map((d) => d.name)).toEqual(['Hyperfixation']);
	});

	it('setting off: a hidden (playtest02) feature of a visible Nim+ subclass is never added', async () => {
		const target = findDoc({ pack: NIM_FEATURES, name: 'Hyperfixation' });
		const { env, sync, supersede } = await world({
			playtest: false,
			packs: {
				transform(doc) {
					if (doc._id === target.doc._id) doc.flags[MODULE_ID] = { playtest02: true };
					return doc;
				},
			},
		});
		const actor = await buildCharacterAtLevel(env, 'shadowmancer', 7, { version: '2.0.3', subclass: 'Pact of the Id' });
		// (the harness builder reads the untransformed JSON, so drop the copy it granted)
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		expect(supersede.isHiddenUuid(target.uuid)).toBe(true);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
	});

	it('setting off: a hidden Nim+ subclass is not a sync target', async () => {
		const { env, sync } = await world({ playtest: false });
		const actor = await buildCharacterAtLevel(env, 'shepherd', 7, { version: '2.0.3', subclass: 'Luminary of Mercy' });
		const sub = actor.items.find((i) => i.type === 'subclass');
		// Source-less: the identifier fallback must not find the hidden 0.2 copy.
		editSource(sub, (s) => delete s._stats.compendiumSource);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
	});

	it('a subclass pack that is missing → nothing to do, no throw', async () => {
		const { env, sync } = await world({ playtest: true, packs: { module: ['nim-plus-class-features', 'nim-plus-classes'] } });
		const actor = await buildCharacterAtLevel(env, 'shadowmancer', 3, { version: '0.2' });
		expect(await sync.planSubclassSync([actor])).toEqual([]);
	});

	it('non-character actors and actors with no subclass are ignored', async () => {
		const { env, sync } = await world({ playtest: true });
		const a = await makeCharacter(env, {});
		a.type = 'npc';
		const b = await makeCharacter(env, { classId: 'mage', level: 2, version: '0.2' });
		expect(await sync.planSubclassSync([a, b])).toEqual([]);
		expect(await sync.planSubclassSync()).toEqual([]);
	});
});

describe('subclass sync — startup (runSubclassSyncStartup + queue)', () => {
	it('version gate: runs once per module version; postponed does not stamp', async () => {
		const { env, sync } = await world({ playtest: true });
		const actor = await pactOfTheId(env, 7);
		actor.items.delete(itemsNamed(actor, 'Hyperfixation')[0].id);
		env.dialogs.answerWhen(/Subclass update/, 'later');
		await sync.runSubclassSyncStartup();
		expect(env.settings.get(MODULE_ID, SYNC_SETTING)).toBe('');
		env.dialogs.answerWhen(/Subclass update/, 'apply');
		await sync.runSubclassSyncStartup();
		const version = env.game.modules.get(MODULE_ID).version;
		expect(env.settings.get(MODULE_ID, SYNC_SETTING)).toBe(version);
		const n = env.dialogs.log.length;
		await sync.runSubclassSyncStartup();
		expect(env.dialogs.log.length).toBe(n);
	});

	it('player: never prompts', async () => {
		const { env, sync } = await world({ playtest: true, isGM: false });
		await sync.runSubclassSyncStartup();
		expect(env.dialogs.log).toEqual([]);
	});

	it('ready: the migration preview comes first, then the subclass sync, one at a time', async () => {
		const { env } = await setupWorld({ playtest: true, boot: 'setup' });
		await env.flush();
		const stale = await pactOfTheId(env, 7);
		stale.items.delete(itemsNamed(stale, 'Hyperfixation')[0].id);
		const pending = await buildCharacterAtLevel(env, 'commander', 3, { version: '2.0.3' });
		const order = [];
		env.dialogs.answerWhen(/Migrate classes/, () => {
			order.push('migration');
			// the sync prompt must not be open yet
			expect(env.dialogs.log.filter((d) => /Subclass update/.test(d.title ?? d.config?.window?.title ?? '')).length).toBe(0);
			return false;
		});
		env.dialogs.answerWhen(/Subclass update/, () => {
			order.push('sync');
			return true;
		});
		await env.boot({ until: 'ready' });
		await settle(env, () => order.length >= 2);
		expect(order).toEqual(['migration', 'sync']);
		// The pending (postponed) character was not touched by the sync.
		expect(pending.calls).toEqual([]);
		expect(itemsNamed(stale, 'Hyperfixation')).toHaveLength(1);
	});

	it('migration postponed at startup, applied later: no duplicate items anywhere', async () => {
		const { env, migration } = await setupWorld({ playtest: true, boot: 'setup' }).then(({ env, mods }) => ({ env, migration: mods[3] }));
		await env.flush();
		const actor = await buildCharacterAtLevel(env, 'shepherd', 7, { version: '2.0.3', subclass: 'Luminary of Mercy' });
		env.dialogs.answerWhen(/Migrate classes/, 'later');
		await env.boot({ until: 'ready' });
		await settle(env, () => env.settings.get(MODULE_ID, SYNC_SETTING) !== '');
		expect(env.dialogs.pending()).toBe(0);
		expect(actor.calls).toEqual([]);
		// The startup sync skipped the pending character: no sync prompt at all.
		expect(env.dialogs.log.map((d) => d.title)).toEqual(['Nim+ | Migrate classes to Nimble 0.2 playtest']);
		// Later, the GM applies the migration; its follow-up subclass sync is accepted.
		env.dialogs.answerWhen(/Subclass update/, 'apply');
		expect(await migration.migrateCoreClasses({ actors: [actor], apply: true })).toBe('applied');
		expect(dupNames(actor)).toEqual([]);
		// And the subclass is now the 0.2 copy, with its 0.2 features present once.
		const sub = actor.items.find((i) => i.type === 'subclass');
		expect(sourceOf(sub)).toBe(findDoc({ pack: NIM_SUBCLASSES, name: 'Luminary of Mercy' }).uuid);
		const fresh = await buildCharacterAtLevel(env, 'shepherd', 7, { version: '0.2', subclass: 'Luminary of Mercy', world: false });
		expect(subNames(actor)).toEqual(subNames(fresh));
	});

	it.each([
		['shepherd', 'Luminary of Mercy'],
		['commander', 'Champion of the Bulwark'],
		['stormshifter', 'Circle of Fang & Claw'],
		['songweaver', 'Herald of Courage'],
		['hunter', 'Keeper of the Shadowpath'],
		['shadowmancer', 'Reaver'],
	])('GM migration to02 of %s (%s) at 3/7/11/15/20 → subclass features match a fresh 0.2 build, no duplicates', async (cls, subclass) => {
		for (const level of [3, 7, 11, 15, 20]) {
			const { env, mods } = await setupWorld({ playtest: true });
			await env.flush();
			const migration = mods[3];
			const actor = await buildCharacterAtLevel(env, cls, level, { version: '2.0.3', subclass });
			env.dialogs.answerWhen(/Subclass update/, 'apply');
			await migration.migrateCoreClasses({ actors: [actor], apply: true });
			expect(dupNames(actor), `${cls} ${level}`).toEqual([]);
			expect(supersedeHas(mods, actor), `${cls} ${level} still pending`).toBe(false);
			const fresh = await buildCharacterAtLevel(env, cls, level, { version: '0.2', subclass, world: false });
			expect(subNames(actor), `${cls} ${level}`).toEqual(subNames(fresh));
			// A second pass has nothing left to do.
			expect(await mods[2].planSubclassSync([actor]), `${cls} ${level} idempotent`).toEqual([]);
		}
	});

	it.each([
		['shepherd', 'Luminary of Mercy'],
		['songweaver', 'Herald of Courage'],
		['hunter', 'Keeper of the Shadowpath'],
		['stormshifter', 'Circle of Fang & Claw'],
	])('GM migration to203 of %s (%s) at 3/7/15 with the setting off → subclass features match a fresh 2.0.3 build', async (cls, subclass) => {
		for (const level of [3, 7, 15]) {
			const { env, mods } = await setupWorld({ playtest: false });
			await env.flush();
			const actor = await buildCharacterAtLevel(env, cls, level, { version: '0.2', subclass });
			env.dialogs.answerWhen(/Subclass update/, 'apply');
			await mods[3].migrateCoreClasses({ actors: [actor], apply: true });
			expect(dupNames(actor), `${cls} ${level}`).toEqual([]);
			expect(mods[1].hasPendingClassMigration(actor), `${cls} ${level} still pending`).toBe(false);
			const fresh = await buildCharacterAtLevel(env, cls, level, { version: '2.0.3', subclass, world: false });
			expect(subNames(actor), `${cls} ${level}`).toEqual(subNames(fresh));
			expect(await mods[2].planSubclassSync([actor])).toEqual([]);
		}
	});

	it('fixed BUG-supersede-4: a player migrating their own character from the sheet still gets the 0.2 subclass features', async () => {
		const { env, mods } = await setupWorld({ playtest: true });
		await env.flush();
		const migration = mods[3];
		const actor = await buildCharacterAtLevel(env, 'songweaver', 7, { version: '2.0.3', subclass: 'Herald of Courage' });
		const fresh = await buildCharacterAtLevel(env, 'songweaver', 7, { version: '0.2', subclass: 'Herald of Courage', world: false });
		env.setUser({ isGM: false });
		expect(await migration.migrateCoreClasses({ actors: [actor], apply: true })).toBe('applied');
		// migrateCoreClasses only runs the follow-up subclass sync for a GM, and the startup
		// sync has already been stamped for this version — the 0.2 subclass features never arrive.
		expect(subNames(actor)).toEqual(subNames(fresh));
	});

	it('fixed BUG-supersede-5: subclass features postponed after a later migration are offered again on the next startup', async () => {
		const { env, mods } = await setupWorld({ playtest: true, boot: 'setup' });
		await env.flush();
		const [, , sync, migration] = mods;
		const actor = await buildCharacterAtLevel(env, 'songweaver', 7, { version: '2.0.3', subclass: 'Herald of Courage' });
		env.dialogs.answerWhen(/Migrate classes/, 'later');
		await env.boot({ until: 'ready' });
		await settle(env, () => env.settings.get(MODULE_ID, SYNC_SETTING) !== '');
		// Startup: migration postponed; the sync skipped the pending character but stamped the version.
		expect(env.settings.get(MODULE_ID, SYNC_SETTING)).toBe(env.game.modules.get(MODULE_ID).version);
		// The GM migrates from the sheet and clicks "Later" on the subclass preview that follows.
		env.dialogs.answerWhen(/Subclass update/, 'later');
		await migration.migrateCoreClasses({ actors: [actor], apply: true });
		const n = env.dialogs.log.length;
		// Next reload: the startup sync should offer the outstanding subclass features again.
		await sync.runSubclassSyncStartup();
		expect(env.dialogs.log.length).toBe(n + 1);
	});
});
