/**
 * The orchestrator: migrateCoreClasses options and results, the non-GM path,
 * the ready gate (classMigrationVersion), the syncCoreClasses alias, the sheet
 * header control and the ordering with the subclass sync.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, importScripts, itemNames, itemsNamed, makeCharacter, snapshotItems } from '../harness/index.mjs';
import { MODULE_ID, acceptEverything, world } from './helpers.mjs';

const MIGRATE = /Migrate classes/;
const VERSION_KEY = `${MODULE_ID}.classMigrationVersion`;
const SYNC_KEY = `${MODULE_ID}.subclassSyncVersion`;

let w;
let env;
let migration;

beforeEach(async () => {
	w = await world({ playtest: true });
	({ env, migration } = w);
});

const titles = () => env.dialogs.log.map((d) => d.title);

describe('migrateCoreClasses — options and results', () => {
	it('rejects an unknown direction with an error and does nothing', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5);
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to99' })).toBe('nothing');
		expect(env.notifications.messages('error').join()).toMatch(/Unknown migration direction "to99"/);
		expect(actor.calls).toEqual([]);
		expect(env.dialogs.log).toEqual([]);
	});

	it.each([
		[true, 'to02', 'Nimble 0.2 playtest', '2.0.3'],
		[false, 'to203', 'Heroes 2.0.3', '0.2'],
	])('playtest setting %s → default direction %s', async (playtest, direction, label, version) => {
		({ env, migration } = await world({ playtest }));
		expect(migration.defaultDirection()).toBe(direction);
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version });
		env.dialogs.answerWhen(MIGRATE, 'later');
		expect(await migration.migrateCoreClasses({ actors: [actor] })).toBe('postponed');
		expect(titles()).toEqual([`Nim+ | Migrate classes to ${label}`]);
	});

	it('the default direction follows a setting change made after startup', async () => {
		await env.settings.set(MODULE_ID, 'playtestCoreClasses', false);
		expect(migration.defaultDirection()).toBe('to203');
	});

	it('without actors, every world character is planned (non-characters and up-to-date ones skipped)', async () => {
		const a = await buildCharacterAtLevel(env, 'commander', 5);
		const b = await buildCharacterAtLevel(env, 'mage', 5);
		const done = await buildCharacterAtLevel(env, 'hunter', 3, { version: '0.2' });
		const offWorld = await buildCharacterAtLevel(env, 'shepherd', 3, { world: false });
		const npc = await buildCharacterAtLevel(env, 'oathsworn', 3);
		npc.type = 'npc';
		const plans = await migration.planCoreClassMigration({ direction: 'to02' });
		const planned = plans.map((p) => p.actor);
		expect(planned).toEqual(expect.arrayContaining([a, b]));
		expect(planned).not.toContain(done);
		expect(planned).not.toContain(offWorld);
		expect(planned).not.toContain(npc);
	});

	it('apply: true skips the preview and applies; returns "applied" with an info notification', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 3);
		const result = await migration.migrateCoreClasses({ actors: [actor], direction: 'to02', apply: true });
		expect(result).toBe('applied');
		expect(titles().some((t) => MIGRATE.test(t))).toBe(false);
		expect(itemNames(actor)).toContain('My Buddy!');
		expect(env.notifications.messages('info').join()).toMatch(/Classes migrated to Nimble 0.2 playtest on 1 character\./);
	});

	it('the preview confirmed → applied; plural notification for several characters', async () => {
		const a = await buildCharacterAtLevel(env, 'shepherd', 3);
		const b = await buildCharacterAtLevel(env, 'stormshifter', 20);
		acceptEverything(env);
		expect(await migration.migrateCoreClasses({ actors: [a, b], direction: 'to02' })).toBe('applied');
		expect(titles()[0]).toBe('Nim+ | Migrate classes to Nimble 0.2 playtest');
		expect(env.notifications.messages('info').join()).toMatch(/on 2 characters\./);
		expect(itemNames(b)).not.toContain('Expert Shifter');
	});

	it('the preview lists every actor, its class/level heading, and every change', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3, { name: 'Ada <x>' });
		env.dialogs.answerWhen(MIGRATE, 'later');
		await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' });
		const html = env.dialogs.log[0].content;
		expect(html).toContain('Ada &lt;x&gt; — Commander 3');
		expect(html).toMatch(/Removed: <s>Commander&#39;s Orders<\/s> <em>\(now gained at level 4\)<\/em>/);
		expect(html).toMatch(/Added: <strong>Fit for Any Battlefield<\/strong>/);
		// The class module's line and the "check by hand" line are part of the preview.
		expect(html).toContain('<li>Fit for Any Battlefield (level 2) brings a Combat Tactic: you will be asked to choose one</li>');
		expect(html).toMatch(/<i class="fa-solid fa-hand"><\/i> Commander: 0.2 changed <em>combat tactics<\/em>/);
	});

	it.each([
		['later', 'postponed'],
		[null, 'postponed'],
	])('preview answered %s → %s, nothing written, no subclass sync', async (answer, expected) => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { subclass: 'Champion of the Arena' });
		const before = snapshotItems(actor);
		env.dialogs.answerWhen(MIGRATE, answer);
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' })).toBe(expected);
		expect(actor.calls).toEqual([]);
		expect(snapshotItems(actor)).toEqual(before);
		expect(titles()).toHaveLength(1);
		expect(env.notifications.messages('info')).toEqual([]);
	});

	it('nothing to do → "nothing" with an info message, or silently with silent: true', async () => {
		const actor = await buildCharacterAtLevel(env, 'hunter', 3, { version: '0.2' });
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' })).toBe('nothing');
		expect(env.notifications.messages('info').join()).toMatch(/Already on the Nimble 0.2 playtest class rules/);
		env.notifications.info.mockClear?.();
		const before = env.notifications.messages('info').length;
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02', silent: true })).toBe('nothing');
		expect(env.notifications.messages('info').length).toBe(before);
		expect(env.dialogs.log).toEqual([]);
	});

	it('an empty actors list plans nothing (does not fall back to every character)', async () => {
		await buildCharacterAtLevel(env, 'commander', 5);
		expect(await migration.migrateCoreClasses({ actors: [], direction: 'to02', silent: true })).toBe('nothing');
	});

	it('the classes filter restricts the run', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3);
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02', classes: ['mage'], silent: true })).toBe('nothing');
		expect(actor.calls).toEqual([]);
	});

	it('after applying, the GM gets the subclass sync for the migrated characters (after the class-module prompts)', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { subclass: 'Champion of the Arena' });
		const [glory] = itemsNamed(actor, 'Glory Seeker');
		await actor.deleteEmbeddedDocuments('Item', [glory.id]);
		acceptEverything(env);
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' })).toBe('applied');
		const t = titles();
		expect(t[0]).toMatch(MIGRATE);
		expect(t.at(-1)).toBe('Nim+ | Subclass update available');
		expect(itemNames(actor)).toContain('Glory Seeker');
	});

	it('syncCoreClasses is an alias of migrateCoreClasses', () => {
		expect(migration.syncCoreClasses).toBe(migration.migrateCoreClasses);
	});

	it('the module api exposes both names', async () => {
		const { installFoundry, installPacks } = await import('../harness/index.mjs');
		env = installFoundry({ settings: { [`${MODULE_ID}.playtestCoreClasses`]: true } });
		await installPacks(env);
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'setup' });
		const api = env.game.modules.get(MODULE_ID).api;
		expect(typeof api.migrateCoreClasses).toBe('function');
		expect(api.syncCoreClasses).toBe(api.migrateCoreClasses);
	});
});

describe('migrateCoreClasses — players', () => {
	it('a player migrates a character they own (no subclass sync: GM only)', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: true });
		env.setUser({ isGM: false });
		acceptEverything(env);
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' })).toBe('applied');
		expect(itemNames(actor)).toContain('My Buddy!');
		expect(env.notifications.messages('warn').join()).not.toMatch(/Only a GM/);
		expect(titles().some((t) => /Subclass update/.test(t))).toBe(false);
	});

	it('a player\'s list is cut down to the characters they own', async () => {
		const mine = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: true });
		const theirs = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: false });
		env.setUser({ isGM: false });
		acceptEverything(env);
		expect(await migration.migrateCoreClasses({ actors: [mine, theirs, null], direction: 'to02' })).toBe('applied');
		expect(itemNames(mine)).toContain('My Buddy!');
		expect(theirs.calls).toEqual([]);
		expect(env.dialogs.log[0].content).not.toContain(theirs.name === mine.name ? '\u0000' : theirs.name);
	});

	it('a player with only non-owned characters is warned and nothing happens', async () => {
		const theirs = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: false });
		env.setUser({ isGM: false });
		expect(await migration.migrateCoreClasses({ actors: [theirs], direction: 'to02' })).toBe('nothing');
		expect(env.notifications.warn).toHaveBeenCalledWith(expect.stringMatching(/only migrate characters you own/));
		expect(theirs.calls).toEqual([]);
		expect(env.dialogs.log).toEqual([]);
	});

	it.fails('BUG-migration-core-6: a player calling migrateCoreClasses() without actors is told they own nothing', async () => {
		const mine = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: true });
		env.setUser({ isGM: false });
		acceptEverything(env);
		const result = await migration.migrateCoreClasses({ direction: 'to02' });
		expect(env.notifications.messages('warn').join()).not.toMatch(/only migrate characters you own/);
		expect(result).toBe('applied');
		expect(itemNames(mine)).toContain('My Buddy!');
	});
});

describe('startup (ready) gate — classMigrationVersion', () => {
	async function boot({ playtest = true, isGM = true, stamp, syncStamp, prepare } = {}) {
		const settings = {};
		if (stamp !== undefined) settings[VERSION_KEY] = stamp;
		if (syncStamp !== undefined) settings[SYNC_KEY] = syncStamp;
		w = await world({ playtest, isGM, boot: false, settings });
		({ env, migration } = w);
		const actors = (await prepare?.(env)) ?? [];
		await env.boot({ until: 'ready' });
		await w.queue.queueStartupPrompt(() => {}); // wait for every queued startup prompt
		await env.flush();
		return actors;
	}
	const version = () => env.game.modules.get(MODULE_ID).version;

	it('GM, confirmed: migrates the world and stamps "<version>|to02"', async () => {
		const [actor] = await boot({
			prepare: async (e) => {
				acceptEverything(e);
				return [await buildCharacterAtLevel(e, 'shepherd', 3)];
			},
		});
		expect(titles()[0]).toBe('Nim+ | Migrate classes to Nimble 0.2 playtest');
		expect(itemNames(actor)).toContain('My Buddy!');
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to02`);
	});

	it('already stamped for this version + direction → no preview', async () => {
		const [actor] = await boot({
			stamp: `${MODULE_JSON_VERSION()}|to02`,
			syncStamp: MODULE_JSON_VERSION(),
			prepare: async (e) => [await buildCharacterAtLevel(e, 'shepherd', 3)],
		});
		expect(env.dialogs.log).toEqual([]);
		expect(actor.calls).toEqual([]);
	});

	it('stamped for the other direction → preview again (a setting flip re-offers it)', async () => {
		await boot({
			stamp: `${MODULE_JSON_VERSION()}|to203`,
			prepare: async (e) => {
				e.dialogs.answerWhen(MIGRATE, 'later');
				return [await buildCharacterAtLevel(e, 'shepherd', 3)];
			},
		});
		expect(titles()[0]).toMatch(MIGRATE);
	});

	it('stamped for an older version → preview again', async () => {
		await boot({
			stamp: '0.0.1|to02',
			prepare: async (e) => {
				e.dialogs.answerWhen(MIGRATE, 'later');
				return [await buildCharacterAtLevel(e, 'shepherd', 3)];
			},
		});
		expect(titles()[0]).toMatch(MIGRATE);
	});

	it('postponed → not stamped, nothing written', async () => {
		const [actor] = await boot({
			prepare: async (e) => {
				e.dialogs.answerWhen(MIGRATE, 'later');
				return [await buildCharacterAtLevel(e, 'shepherd', 3)];
			},
		});
		expect(actor.calls).toEqual([]);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe('');
	});

	it('nothing to migrate → stamped silently (no dialog, no info)', async () => {
		await boot({ prepare: async (e) => [await buildCharacterAtLevel(e, 'hunter', 3, { version: '0.2' })] });
		expect(titles().some((t) => MIGRATE.test(t))).toBe(false);
		expect(env.notifications.messages('info').join()).not.toMatch(/Already on/);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to02`);
	});

	it('setting off → the to203 preview and a "|to203" stamp', async () => {
		await boot({
			playtest: false,
			prepare: async (e) => {
				acceptEverything(e);
				return [await buildCharacterAtLevel(e, 'shepherd', 3, { version: '0.2' })];
			},
		});
		expect(titles()[0]).toBe('Nim+ | Migrate classes to Heroes 2.0.3');
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to203`);
	});

	it('a player gets no startup preview and nothing is stamped', async () => {
		const [actor] = await boot({
			isGM: false,
			prepare: async (e) => [await buildCharacterAtLevel(e, 'shepherd', 3, { ownedByPlayer: true })],
		});
		expect(env.dialogs.log).toEqual([]);
		expect(actor.calls).toEqual([]);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe('');
	});

	it('the subclass-sync startup preview runs after the migration preview has closed', async () => {
		await boot({
			prepare: async (e) => {
				const a = await buildCharacterAtLevel(e, 'commander', 5, { version: '0.2', subclass: 'Champion of the Arena' });
				const [glory] = itemsNamed(a, 'Glory Seeker');
				a.items.delete(glory.id);
				const b = await buildCharacterAtLevel(e, 'shepherd', 3);
				acceptEverything(e);
				return [a, b];
			},
		});
		const t = titles();
		const iMig = t.findIndex((x) => MIGRATE.test(x));
		const iSync = t.findIndex((x) => /Subclass update/.test(x));
		expect(iMig).toBeGreaterThanOrEqual(0);
		expect(iSync).toBeGreaterThan(iMig);
		// The migration's stamp is written before the sync's.
		const keys = env.log.filter((e) => e.method === 'settings.set').map((e) => e.key);
		expect(keys).toEqual([VERSION_KEY, SYNC_KEY]);
	});

	it('a postponed migration keeps its character out of the startup subclass sync', async () => {
		const [pending] = await boot({
			prepare: async (e) => {
				const a = await buildCharacterAtLevel(e, 'commander', 5, { subclass: 'Champion of the Arena' });
				const [glory] = itemsNamed(a, 'Glory Seeker');
				a.items.delete(glory.id);
				e.dialogs.answerWhen(MIGRATE, 'later').answerWhen(/Subclass update/, 'apply');
				return [a];
			},
		});
		expect(pending.calls).toEqual([]);
		expect(itemNames(pending)).not.toContain('Glory Seeker');
		expect(titles().some((t) => /Subclass update/.test(t))).toBe(false);
		// Postponed: the migration is not stamped; the sync (nothing else to do) is.
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe('');
	});
});

/** module.json version, read the way the harness does (before a world exists). */
function MODULE_JSON_VERSION() {
	return env.game.modules.get(MODULE_ID).version;
}

describe('sheet header control (getHeaderControlsActorSheetV2)', () => {
	function controlsFor(document) {
		const controls = [];
		env.Hooks.callAll('getHeaderControlsActorSheetV2', { document }, controls);
		return controls.filter((c) => c.action === 'nimPlusMigrateClass');
	}

	it('GM + core-class character → "Migrate class to 0.2 rules"', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 3);
		const [control] = controlsFor(actor);
		expect(control).toMatchObject({ label: 'Migrate class to 0.2 rules', visible: true, icon: 'fa-solid fa-arrows-rotate' });
	});

	it('setting off → "Migrate class to 2.0.3 rules"', async () => {
		({ env, migration } = await world({ playtest: false }));
		const actor = await buildCharacterAtLevel(env, 'mage', 3, { version: '0.2' });
		expect(controlsFor(actor)[0].label).toBe('Migrate class to 2.0.3 rules');
	});

	it('owner player → shown; non-owner player → hidden', async () => {
		const mine = await buildCharacterAtLevel(env, 'mage', 3, { ownedByPlayer: true });
		const theirs = await buildCharacterAtLevel(env, 'mage', 3, { ownedByPlayer: false });
		env.setUser({ isGM: false });
		expect(controlsFor(mine)).toHaveLength(1);
		expect(controlsFor(theirs)).toHaveLength(0);
	});

	it('hidden for a classless character, a non-core class, a non-character and a non-actor sheet', async () => {
		const none = await makeCharacter(env, {});
		const engineer = await makeCharacter(env, { items: [{ name: 'Engineer', type: 'class', system: { identifier: 'engineer' } }] });
		const npc = await buildCharacterAtLevel(env, 'mage', 3);
		npc.type = 'npc';
		expect(controlsFor(none)).toHaveLength(0);
		expect(controlsFor(engineer)).toHaveLength(0);
		expect(controlsFor(npc)).toHaveLength(0);
		expect(controlsFor({ type: 'character', items: [] })).toHaveLength(0);
		expect(controlsFor(undefined)).toHaveLength(0);
		expect(env.Hooks.errors).toEqual([]);
	});

	it('the control is shown even when the character is already migrated (it then reports "Already on …")', async () => {
		const actor = await buildCharacterAtLevel(env, 'hunter', 3, { version: '0.2' });
		const [control] = controlsFor(actor);
		expect(control).toBeTruthy();
		control.onClick();
		await env.flush();
		expect(env.notifications.messages('info').join()).toMatch(/Already on the Nimble 0.2 playtest/);
	});

	it('onClick previews that character only, in the setting\'s direction', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 3, { name: 'Clicked' });
		await buildCharacterAtLevel(env, 'commander', 5, { name: 'Other' });
		env.dialogs.answerWhen(MIGRATE, 'later');
		controlsFor(actor)[0].onClick();
		await env.flush();
		expect(titles()).toEqual(['Nim+ | Migrate classes to Nimble 0.2 playtest']);
		expect(env.dialogs.log[0].content).toContain('Clicked');
		expect(env.dialogs.log[0].content).not.toContain('Other');
	});

	it('a player clicking on their own character runs the migration', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: true });
		env.setUser({ isGM: false });
		acceptEverything(env);
		controlsFor(actor)[0].onClick();
		await env.flush(60);
		expect(itemNames(actor)).toContain('My Buddy!');
	});
});
