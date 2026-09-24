/**
 * scripts/core/supersede.mjs — the index filter itself: the wrapped getIndex /
 * indexDocument, the setup/ready purges, the hidden set, and the helpers.
 */
import { describe, expect, it, vi } from 'vitest';
import {
	addPack,
	buildCharacterAtLevel,
	findDoc,
	importScripts,
	installFoundry,
	installPacks,
	loadPackData,
	makeCharacter,
	MODULE_ID,
	rawDoc,
	setupWorld,
	supersedeOracle,
} from '../harness/index.mjs';

const SYS = ['nimble-classes', 'nimble-class-features', 'nimble-subclasses', 'nimble-spells'];
const NIM_FEATURES = `${MODULE_ID}.nim-plus-class-features`;
const SETTING = `${MODULE_ID}.playtestCoreClasses`;

const idOf = (uuid) => uuid.split('.').pop();
const collOf = (uuid) => uuid.split('.').slice(1, 3).join('.');

/** Hidden ids per live collection, from the oracle. */
async function hiddenByPack(enabled, systemId = 'nimble') {
	const oracle = await supersedeOracle();
	const out = new Map();
	for (const uuid of oracle.hiddenWhen(enabled)) {
		let coll = collOf(uuid);
		if (coll.startsWith('nimble.')) coll = `${systemId}.${coll.slice('nimble.'.length)}`;
		if (!out.has(coll)) out.set(coll, new Set());
		out.get(coll).add(idOf(uuid));
	}
	return out;
}

function leaked(env, hidden) {
	const out = [];
	for (const [coll, ids] of hidden) {
		const pack = env.game.packs.get(coll);
		if (!pack) continue;
		for (const id of ids) if (pack.index.has(id)) out.push(`${coll}.${id}`);
	}
	return out;
}

describe.each([
	[true, 'nimble'],
	[false, 'nimble'],
	[true, 'nimble-dev'],
	[false, 'nimble-dev'],
])('index filter — playtest %s, system id %s', (playtest, systemId) => {
	it('setup purge hides exactly the oracle set (every pack)', async () => {
		const { env, mods } = await setupWorld({ playtest, systemId });
		await env.flush();
		const hidden = await hiddenByPack(playtest, systemId);
		expect(hidden.size).toBeGreaterThan(0);
		expect(leaked(env, hidden)).toEqual([]);
		// Nothing else was removed: every other raw doc of every relevant pack is still indexed.
		for (const pack of env.game.packs) {
			const raw = [...pack._sources.keys()];
			const hide = hidden.get(pack.collection) ?? new Set();
			const missing = raw.filter((id) => !hide.has(id) && !pack.index.has(id));
			expect(missing, pack.collection).toEqual([]);
		}
		const data = mods[1].supersedeDataSync();
		expect(data.enabled).toBe(playtest);
	});

	it('getIndex with new fields (full re-read) keeps them hidden, repeatedly', async () => {
		const { env } = await setupWorld({ playtest, systemId });
		await env.flush();
		const hidden = await hiddenByPack(playtest, systemId);
		for (const fields of [['system.description'], ['system.group', 'system.class'], ['flags'], ['system.rules']]) {
			for (const pack of env.game.packs) await pack.getIndex({ fields });
			expect(leaked(env, hidden), fields.join()).toEqual([]);
		}
		// Cached (fields covered) path too.
		for (const pack of env.game.packs) await pack.getIndex({ fields: ['system.group'] });
		expect(leaked(env, hidden)).toEqual([]);
	});

	it('getDocument / getDocuments / fromUuid load hidden docs without re-indexing them', async () => {
		const { env, mods } = await setupWorld({ playtest, systemId });
		await env.flush();
		const hidden = await hiddenByPack(playtest, systemId);
		const [coll, ids] = [...hidden].find(([, s]) => s.size > 2);
		const pack = env.game.packs.get(coll);
		const [a, b, c] = [...ids];
		expect((await pack.getDocument(a))?.id).toBe(a);
		expect((await pack.getDocuments({ _id__in: [b] }))[0]?.id).toBe(b);
		const doc = await fromUuid(`Compendium.${coll}.Item.${c}`);
		expect(doc?.id).toBe(c);
		expect(mods[1].isHiddenUuid(doc.uuid)).toBe(true);
		for (const id of [a, b, c]) expect(pack.index.has(id)).toBe(false);
		// Loading the whole pack.
		await pack.getDocuments();
		expect(leaked(env, hidden)).toEqual([]);
		// Loaded docs are still in the document cache (an open sheet keeps working).
		expect(pack.has(a)).toBe(true);
	});
});

describe('index filter — direction specifics', () => {
	it('setting on: superseded + retired system entries gone, Nim+ copies and playtest02 docs visible', async () => {
		const { env } = await setupWorld({ playtest: true });
		await env.flush();
		const oracle = await supersedeOracle();
		for (const uuid of oracle.retired) expect(env.game.packs.get(collOf(uuid)).index.has(idOf(uuid)), uuid).toBe(false);
		for (const uuid of [...oracle.supersedes.keys(), ...oracle.playtestOnly]) {
			expect(env.game.packs.get(collOf(uuid)).index.has(idOf(uuid)), uuid).toBe(true);
		}
	});

	it('setting off: Nim+ supersedes/playtest02 docs gone, system superseded + retired visible', async () => {
		const { env } = await setupWorld({ playtest: false });
		await env.flush();
		const oracle = await supersedeOracle();
		for (const uuid of [...oracle.supersedes.keys(), ...oracle.playtestOnly]) {
			expect(env.game.packs.get(collOf(uuid)).index.has(idOf(uuid)), uuid).toBe(false);
		}
		for (const uuid of [...oracle.supersededBy.keys(), ...oracle.retired]) {
			const pack = env.game.packs.get(collOf(uuid));
			if (pack) expect(pack.index.has(idOf(uuid)), uuid).toBe(true);
		}
	});

	it('setting off: a Nim+ doc flagged playtest02:false and no supersedes stays visible', async () => {
		const target = findDoc({ pack: NIM_FEATURES, name: 'Face Me!' });
		const { env } = await setupWorld({
			playtest: false,
			packs: {
				transform(doc) {
					if (doc._id === target.doc._id) doc.flags[MODULE_ID] = { playtest02: false, supersedes: [] };
					return doc;
				},
			},
		});
		await env.flush();
		expect(env.game.packs.get(NIM_FEATURES).index.has(target.doc._id)).toBe(true);
	});

	it('the unregistered setting counts as on (default true)', async () => {
		const env = installFoundry();
		await installPacks(env);
		const [supersede] = await importScripts(['scripts/core/supersede.mjs']);
		await env.boot({ until: 'setup' });
		await env.flush();
		expect(supersede.supersedeDataSync().enabled).toBe(true);
	});
});

describe('index filter — packs that are not ours', () => {
	it('non-nimble packs are untouched, even when they share ids with hidden docs', async () => {
		const oracle = await supersedeOracle();
		const hiddenUuid = [...oracle.hiddenWhen(true)].find((u) => u.startsWith('Compendium.nimble.nimble-class-features.'));
		const clash = { ...structuredClone(rawDoc(hiddenUuid)), _id: idOf(hiddenUuid) };
		const env = installFoundry({ settings: { [SETTING]: true } });
		await installPacks(env, {
			extra: [
				{ collection: 'other-mod.features', type: 'Item', docs: [clash] },
				{ collection: 'world.features', type: 'Item', docs: [clash] },
				{ collection: 'nimbleextras.features', type: 'Item', docs: [clash] },
			],
		});
		await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'ready' });
		await env.flush();
		for (const coll of ['other-mod.features', 'world.features', 'nimbleextras.features']) {
			const pack = env.game.packs.get(coll);
			await pack.getIndex({ fields: ['system.description'] });
			await pack.getDocument(clash._id);
			expect(pack.index.has(clash._id), coll).toBe(true);
			expect(pack.treeInitializations, coll).toBe(0);
		}
		expect(env.game.packs.get('nimble.nimble-class-features').index.has(clash._id)).toBe(false);
	});

	it('Actor packs of nimble / Nim+ are never touched', async () => {
		const env = installFoundry();
		await installPacks(env, {
			extra: [{ collection: 'nimble.nimble-monsters', type: 'Actor', docs: [{ _id: 'AAAAAAAAAAAAAAAA', name: 'Goblin', type: 'npc', system: {}, items: [] }] }],
		});
		await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'ready' });
		const pack = env.game.packs.get('nimble.nimble-monsters');
		await pack.getIndex({ fields: ['system.attributes'] });
		expect(pack.index.has('AAAAAAAAAAAAAAAA')).toBe(true);
	});

	it('fixed BUG-supersede-2: a Nim+ doc naming a third-party UUID in supersedes does not hide it from that pack', async () => {
		// supersedes is documented as nimble-only; a stray foreign UUID must not reach another module's pack
		// (and if it did, it should at least be consistent: purgeAll hides it, the getIndex wrapper never re-hides it).
		const target = findDoc({ pack: NIM_FEATURES, name: 'Face Me!' });
		const env = installFoundry({ settings: { [SETTING]: true } });
		await installPacks(env, {
			transform(doc) {
				if (doc._id === target.doc._id) doc.flags[MODULE_ID].supersedes = [...doc.flags[MODULE_ID].supersedes, 'Compendium.other-mod.features.Item.BBBBBBBBBBBBBBBB'];
				return doc;
			},
			extra: [{ collection: 'other-mod.features', type: 'Item', docs: [{ _id: 'BBBBBBBBBBBBBBBB', name: 'Theirs', type: 'feature', system: {} }] }],
		});
		await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'ready' });
		await env.flush();
		const pack = env.game.packs.get('other-mod.features');
		// Record what happens: purgeAll() deletes it, while getIndex on that pack (not "relevant") would bring it back.
		const afterPurge = pack.index.has('BBBBBBBBBBBBBBBB');
		await pack.getIndex({ fields: ['system.description'] });
		const afterReindex = pack.index.has('BBBBBBBBBBBBBBBB');
		expect({ afterPurge, afterReindex }).toEqual({ afterPurge: true, afterReindex: true });
	});
});

describe('index filter — build order & robustness', () => {
	it('no deadlock: a nimble getIndex fired during setup before the set exists resolves filtered', async () => {
		const env = installFoundry({ settings: { [SETTING]: true } });
		await installPacks(env);
		let supersede;
		let result = 'pending';
		let sawNull = null;
		// Registered before the module's scripts load, like the system's setup-time preparePackIndexes.
		env.Hooks.once('setup', () => {
			sawNull = supersede.supersedeDataSync() === null;
			const pack = game.packs.get('nimble.nimble-class-features');
			const nim = game.packs.get(NIM_FEATURES);
			Promise.all([
				pack.getIndex({ fields: ['system.class', 'system.group'] }),
				nim.getIndex({ fields: ['system.class'] }),
				pack.getIndex({ fields: ['system.class', 'system.group'] }),
			]).then(() => (result = 'done'));
		});
		[, supersede] = await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'setup' });
		await env.flush();
		expect(env.Hooks.errors).toEqual([]);
		expect(sawNull).toBe(true);
		expect(result).toBe('done');
		expect(leaked(env, await hiddenByPack(true))).toEqual([]);
	});

	it('build reads the Nim+ packs through the original getIndex only (no wrapper recursion)', async () => {
		const env = installFoundry();
		await installPacks(env);
		const [, supersede] = await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'init' });
		const spy = vi.spyOn(console, 'error');
		const data = await Promise.race([
			supersede.supersedeData(),
			new Promise((r) => setTimeout(() => r('timeout'), 2000)),
		]);
		expect(data).not.toBe('timeout');
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
		// Concurrent callers share one build.
		const [x, y] = await Promise.all([supersede.supersedeData(), supersede.supersedeData()]);
		expect(x).toBe(y);
		expect(x).toBe(data);
	});

	it('the tree is rebuilt after each purge that removed something, and open apps re-render', async () => {
		const { env } = await setupWorld({ playtest: true, boot: 'init' });
		const pack = env.game.packs.get('nimble.nimble-class-features');
		const app = { rendered: true, render: vi.fn() };
		pack.apps.push(app);
		await env.boot({ until: 'setup' });
		await env.flush();
		const afterSetup = pack.treeInitializations;
		expect(afterSetup).toBeGreaterThan(0);
		expect(app.render).toHaveBeenCalled();
		// A re-read resurrects entries → purge → tree rebuilt again.
		await pack.getIndex({ fields: ['system.description'] });
		expect(pack.treeInitializations).toBeGreaterThan(afterSetup);
		// A cached getIndex removes nothing → no extra rebuild.
		const n = pack.treeInitializations;
		await pack.getIndex({ fields: ['system.description'] });
		expect(pack.treeInitializations).toBe(n);
		// Packs with nothing hidden are never rebuilt.
		const spells = env.game.packs.get(`${MODULE_ID}.nim-plus-items`);
		if (spells) expect(spells.treeInitializations).toBe(0);
	});

	it('a failing initializeTree does not break getIndex', async () => {
		const { env } = await setupWorld({ playtest: true, boot: 'init' });
		const pack = env.game.packs.get('nimble.nimble-class-features');
		pack.initializeTree = () => {
			throw new Error('boom');
		};
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await env.boot({ until: 'setup' });
		await env.flush();
		await expect(pack.getIndex({ fields: ['system.description'] })).resolves.toBe(pack.index);
		expect(leaked(env, await hiddenByPack(true))).toEqual([]);
		err.mockRestore();
	});

	it('the prototype is patched once even if the script is imported twice', async () => {
		const env = installFoundry();
		await installPacks(env);
		await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'init' });
		const patched = env.CompendiumCollection.prototype.getIndex;
		const [, second] = await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.Hooks.callAllAsync('init');
		expect(env.CompendiumCollection.prototype.getIndex).toBe(patched);
		// The second copy never installed, so it never builds or purges (it has no original getIndex).
		expect(second.supersedeDataSync()).toBeNull();
	});

	it('a CompendiumCollection without getIndex/indexDocument: warns and does nothing', async () => {
		const env = installFoundry();
		await installPacks(env);
		delete env.CompendiumCollection.prototype.indexDocument;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'ready' });
		expect(warn.mock.calls.flat().join(' ')).toMatch(/changed shape/);
		warn.mockRestore();
	});
});

describe('index filter — pack re-creation', () => {
	it('a pack re-created after ready is filtered once someone calls getIndex', async () => {
		const { env } = await setupWorld({ playtest: true, boot: 'ready' });
		await env.flush();
		const old = env.game.packs.get('nimble.nimble-subclasses');
		const docs = [...old._sources.values()];
		const fresh = addPack(env, { collection: 'nimble.nimble-subclasses', type: 'Item', docs });
		await fresh.getIndex({ fields: ['system.parentClass'] });
		expect(leaked(env, await hiddenByPack(true))).toEqual([]);
	});

	it.fails('BUG-supersede-1: a pack re-created after ready hides its entries from pack.index readers (getSubclassChoices) without a getIndex call', async () => {
		const { env } = await setupWorld({ playtest: true, boot: 'ready' });
		await env.flush();
		const old = env.game.packs.get('nimble.nimble-subclasses');
		const fresh = addPack(env, { collection: 'nimble.nimble-subclasses', type: 'Item', docs: [...old._sources.values()] });
		await env.flush();
		// getSubclassChoices / getChoicesFromCompendium iterate pack.index directly.
		const hidden = (await hiddenByPack(true)).get('nimble.nimble-subclasses');
		expect([...hidden].filter((id) => fresh.index.has(id))).toEqual([]);
	});
});

describe('isHidden / data before and after startup', () => {
	it('before setup: data null, nothing hidden, no pending migration; after: populated', async () => {
		const { env, mods } = await setupWorld({ playtest: true, boot: 'init' });
		const [, supersede] = mods;
		const oracle = await supersedeOracle();
		const someHidden = [...oracle.supersededBy.keys()][0];
		expect(supersede.supersedeDataSync()).toBeNull();
		expect(supersede.isHiddenUuid(someHidden)).toBe(false);
		const actor = await buildCharacterAtLevel(env, 'commander', 3, { version: '2.0.3' });
		expect(supersede.hasPendingClassMigration(actor)).toBe(false);

		await env.boot({ until: 'setup' });
		await env.flush();
		expect(supersede.supersedeDataSync()).not.toBeNull();
		expect(supersede.isHiddenUuid(someHidden)).toBe(true);
		expect(supersede.hasPendingClassMigration(actor)).toBe(true);

		await env.boot({ until: 'ready' });
		expect(supersede.isHiddenUuid(someHidden)).toBe(true);
	});

	it('isHiddenUuid accepts legacy (no .Item.), nimble-dev and garbage UUIDs', async () => {
		const { env, mods } = await setupWorld({ playtest: true, systemId: 'nimble-dev' });
		await env.flush();
		const [, s] = mods;
		const oracle = await supersedeOracle();
		const u = [...oracle.supersededBy.keys()][0];
		const [, , pack, , id] = u.split('.');
		expect(s.isHiddenUuid(u)).toBe(true);
		expect(s.isHiddenUuid(`Compendium.nimble-dev.${pack}.Item.${id}`)).toBe(true);
		expect(s.isHiddenUuid(`Compendium.nimble.${pack}.${id}`)).toBe(true);
		for (const bad of [null, undefined, '', 'Item.abc', `Compendium.nimble.${pack}.Item.short`, 42]) {
			expect(s.isHiddenUuid(bad)).toBe(false);
		}
		expect(s.liveUuid(u)).toBe(`Compendium.nimble-dev.${pack}.Item.${id}`);
		expect(s.canonicalUuid(`Compendium.nimble-dev.${pack}.Item.${id}`)).toBe(u);
	});

	it('supersedeData matches the oracle (on and off)', async () => {
		const oracle = await supersedeOracle();
		for (const playtest of [true, false]) {
			const { env, mods } = await setupWorld({ playtest });
			await env.flush();
			const d = await mods[1].supersedeData();
			expect(new Map(d.supersededBy)).toEqual(oracle.supersededBy);
			expect(new Map(d.supersedes)).toEqual(oracle.supersedes);
			expect(d.playtestOnly).toEqual(oracle.playtestOnly);
			expect(d.retired).toEqual(oracle.retired);
			let n = 0;
			for (const s of d.hidden.values()) n += s.size;
			expect(n).toBe(oracle.hiddenWhen(playtest).size);
		}
	});
});

describe('hasPendingClassMigration', () => {
	it.each([
		[true, '2.0.3', true],
		[true, '0.2', false],
		[false, '2.0.3', false],
		[false, '0.2', true],
	])('setting %s, %s commander L5 → pending %s', async (playtest, version, pending) => {
		const { env, mods } = await setupWorld({ playtest });
		await env.flush();
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version });
		expect(mods[1].hasPendingClassMigration(actor)).toBe(pending);
	});

	it('detects legacy flags.core.sourceId and nimble-dev sources', async () => {
		const { env, mods } = await setupWorld({ playtest: true, systemId: 'nimble-dev' });
		await env.flush();
		const legacy = await buildCharacterAtLevel(env, 'commander', 3, { version: '2.0.3', legacySourceId: true });
		expect(mods[1].hasPendingClassMigration(legacy)).toBe(true);
		// A nimble-dev world stores nimble-dev UUIDs on its items.
		const a = await buildCharacterAtLevel(env, 'commander', 3, { version: '2.0.3' });
		for (const item of a.items) {
			const src = item._source._stats?.compendiumSource;
			if (src) item._source._stats.compendiumSource = src.replace('Compendium.nimble.', 'Compendium.nimble-dev.');
			if (item._stats?.compendiumSource) item._stats.compendiumSource = item._source._stats.compendiumSource;
		}
		expect(mods[1].hasPendingClassMigration(a)).toBe(true);
	});

	it('retired-only item → pending (on); no sourced items / no actor → false', async () => {
		const { env, mods } = await setupWorld({ playtest: true });
		await env.flush();
		const oracle = await supersedeOracle();
		const retired = [...oracle.retired][0];
		const a = await makeCharacter(env, { features: [retired] });
		expect(mods[1].hasPendingClassMigration(a)).toBe(true);
		const b = await makeCharacter(env, { items: [{ name: 'Homebrew', type: 'feature' }] });
		expect(mods[1].hasPendingClassMigration(b)).toBe(false);
		expect(mods[1].hasPendingClassMigration(null)).toBe(false);
		expect(mods[1].hasPendingClassMigration({})).toBe(false);
	});

	it('an unchanged system doc (not superseded) is not pending', async () => {
		const { env, mods } = await setupWorld({ playtest: true });
		await env.flush();
		const oracle = await supersedeOracle();
		const unchanged = loadPackData()
			.packs.get('nimble.nimble-class-features')
			.docs.find((d) => !oracle.supersededBy.has(`Compendium.nimble.nimble-class-features.Item.${d._id}`) && !oracle.retired.has(`Compendium.nimble.nimble-class-features.Item.${d._id}`));
		const a = await makeCharacter(env, { features: [`Compendium.nimble.nimble-class-features.Item.${unchanged._id}`] });
		expect(mods[1].hasPendingClassMigration(a)).toBe(false);
	});
});

describe('readUnfilteredIndex', () => {
	it('returns hidden entries with uuids and extra fields, and leaves pack.index + indexed fields alone', async () => {
		const { env, mods } = await setupWorld({ playtest: true });
		await env.flush();
		const pack = env.game.packs.get('nimble.nimble-class-features');
		const before = new Map([...pack.index.entries()].map(([k, v]) => [k, structuredClone(v)]));
		const fieldsBefore = pack.indexedFields;
		const trees = pack.treeInitializations;
		const all = await mods[1].readUnfilteredIndex(pack, ['system.class', 'flags']);
		expect(all.length).toBe(pack._sources.size);
		const hidden = (await hiddenByPack(true)).get(pack.collection);
		for (const id of hidden) expect(all.some((e) => e._id === id)).toBe(true);
		expect(all.every((e) => e.uuid === pack.getUuid(e._id))).toBe(true);
		expect(all.some((e) => e.system?.class)).toBe(true);
		// pack.index untouched, entry objects untouched.
		expect(new Map([...pack.index.entries()].map(([k, v]) => [k, structuredClone(v)]))).toEqual(before);
		expect(pack.indexedFields).toEqual(fieldsBefore);
		expect(pack.treeInitializations).toBe(trees);
		// Mutating the result does not touch the index.
		all[0].name = 'MUTATED';
		expect([...pack.index.values()].some((e) => e.name === 'MUTATED')).toBe(false);
	});
});

describe('RETIRED_CORE_UUIDS', () => {
	it('every retired UUID resolves to a system class feature with the commented name', async () => {
		const fs = await import('node:fs');
		const path = await import('node:path');
		const { REPO_ROOT } = await import('../harness/index.mjs');
		const text = fs.readFileSync(path.join(REPO_ROOT, 'scripts/core/supersede-retired.mjs'), 'utf-8');
		const { RETIRED_CORE_UUIDS } = await importScripts('scripts/core/supersede-retired.mjs');
		expect(new Set(RETIRED_CORE_UUIDS).size).toBe(RETIRED_CORE_UUIDS.length);
		const oracle = await supersedeOracle();
		for (const uuid of RETIRED_CORE_UUIDS) {
			const doc = rawDoc(uuid);
			expect(doc, uuid).not.toBeNull();
			expect(uuid).toMatch(/^Compendium\.nimble\.nimble-class-features\.Item\.[A-Za-z0-9]{16}$/);
			const comment = new RegExp(`${uuid.replace(/\./g, '\\.')}',\\s*//\\s*([^(\\n]+)`).exec(text)?.[1]?.trim();
			// The comment starts with the doc's name ("Combat Tactics die-size card" names a card called Combat Tactics).
			expect(comment?.toLowerCase().startsWith(doc.name.toLowerCase().replace(/[^\w ]/g, '').slice(0, 10).toLowerCase()) || comment?.toLowerCase().includes(doc.name.toLowerCase()), `${uuid} ${doc.name} vs "${comment}"`).toBe(true);
			// A retired doc must not also be superseded (it would be both removed and replaced).
			expect(oracle.supersededBy.has(uuid), uuid).toBe(false);
		}
	});
});

describe('Nim+ packs missing, empty, or broken', () => {
	it('no Nim+ packs: nothing superseded, retired still hidden (on), nothing hidden (off)', async () => {
		for (const playtest of [true, false]) {
			const { env, mods } = await setupWorld({ playtest, packs: { module: false } });
			await env.flush();
			const d = mods[1].supersedeDataSync();
			expect(d.supersededBy.size).toBe(0);
			let n = 0;
			for (const s of d.hidden.values()) n += s.size;
			expect(n).toBe(playtest ? d.retired.size : 0);
		}
	});

	it('empty Nim+ packs behave like missing ones', async () => {
		const { env, mods } = await setupWorld({ playtest: true, packs: { transform: (doc, pack) => (pack.pkg === MODULE_ID ? null : doc) } });
		await env.flush();
		expect(mods[1].supersedeDataSync().supersededBy.size).toBe(0);
		expect(env.game.packs.get('nimble.nimble-classes').index.size).toBe(env.game.packs.get('nimble.nimble-classes')._sources.size);
	});

	it('a Nim+ pack that fails to index is skipped; the others still count', async () => {
		const env = installFoundry({ settings: { [SETTING]: true } });
		await installPacks(env);
		const get = env.database.get.bind(env.database);
		env.database.get = async (cls, req, user) => {
			if (req.pack === `${MODULE_ID}.nim-plus-subclasses` && req.index) throw new Error('server down');
			return get(cls, req, user);
		};
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const [, s] = await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'setup' });
		await env.flush();
		const d = s.supersedeDataSync();
		expect(d.supersededBy.size).toBeGreaterThan(0);
		expect([...d.supersedes.keys()].some((u) => u.includes('nim-plus-subclasses'))).toBe(false);
		expect(err.mock.calls.flat().join(' ')).toMatch(/could not index/);
		err.mockRestore();
	});

	it('superseding a non-existent / malformed UUID is harmless', async () => {
		const target = findDoc({ pack: NIM_FEATURES, name: 'Face Me!' });
		const ghost = 'Compendium.nimble.nimble-class-features.Item.ZZZZZZZZZZZZZZZZ';
		const { env, mods } = await setupWorld({
			playtest: true,
			packs: {
				transform(doc) {
					if (doc._id === target.doc._id) doc.flags[MODULE_ID].supersedes = [ghost, 'not a uuid', null, 'Compendium.nimble.no-such-pack.Item.YYYYYYYYYYYYYYYY'];
					return doc;
				},
			},
		});
		await env.flush();
		const d = mods[1].supersedeDataSync();
		expect(d.supersededBy.get(ghost)).toBe(target.uuid);
		expect(d.supersedes.get(target.uuid)).toEqual([ghost, 'Compendium.nimble.no-such-pack.Item.YYYYYYYYYYYYYYYY']);
		expect(env.Hooks.errors).toEqual([]);
		// The real target of Face Me! is now visible again (its flag was overwritten).
		const real = target.doc.flags[MODULE_ID].supersedes[0];
		expect(env.game.packs.get(collOf(real)).index.has(idOf(real))).toBe(true);
	});

	it('supersedes given as a string (not an array) is ignored — doc then counts as neither', async () => {
		const target = findDoc({ pack: NIM_FEATURES, name: 'Face Me!' });
		const { env, mods } = await setupWorld({
			playtest: false,
			packs: {
				transform(doc) {
					if (doc._id === target.doc._id) doc.flags[MODULE_ID] = { supersedes: doc.flags[MODULE_ID].supersedes[0] };
					return doc;
				},
			},
		});
		await env.flush();
		expect(mods[1].supersedeDataSync().supersedes.has(target.uuid)).toBe(false);
	});

	it('two Nim+ docs superseding the same system doc: first wins, warning logged', async () => {
		const a = findDoc({ pack: NIM_FEATURES, name: 'Face Me!' });
		const b = findDoc({ pack: NIM_FEATURES, name: 'Hold the Line!' });
		const shared = a.doc.flags[MODULE_ID].supersedes[0];
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { env, mods } = await setupWorld({
			playtest: true,
			packs: {
				transform(doc) {
					if (doc._id === b.doc._id) doc.flags[MODULE_ID].supersedes = [shared];
					return doc;
				},
			},
		});
		await env.flush();
		expect(mods[1].supersedeDataSync().supersededBy.get(shared)).toBeDefined();
		expect(warn.mock.calls.flat().join(' ')).toMatch(/superseded twice/);
		warn.mockRestore();
	});

	it('the shipped content never supersedes one system doc twice', async () => {
		const oracle = await supersedeOracle();
		const counts = new Map();
		for (const targets of oracle.supersedes.values()) for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
		expect([...counts].filter(([, n]) => n > 1)).toEqual([]);
	});

	it('every supersedes target in the shipped content exists in the system packs', async () => {
		const oracle = await supersedeOracle();
		expect([...oracle.supersededBy.keys()].filter((u) => !rawDoc(u))).toEqual([]);
	});
});
