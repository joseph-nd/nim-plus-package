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
/** Chat cards posted so far whose content matches `re`. */
const cards = (re = /./) => env.ChatMessage.created.filter((c) => re.test(String(c.content)));
const CLASS_CARD = /Class migration/;
const SYNC_CARD = /Subclass sync/;
const GM_ID = () => env.users.gm.id;

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
		expect(await migration.migrateCoreClasses({ actors: [actor], apply: false })).toBe('previewed');
		expect(titles()).toEqual([]);
		expect(cards(CLASS_CARD).map((c) => c.content)).toEqual([expect.stringContaining(`Class migration → ${label} (dry run)`)]);
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

	it('applies without a confirmation popup; returns "applied" with a toast summing up the changes', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 3);
		const before = snapshotItems(actor);
		const result = await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' });
		expect(result).toBe('applied');
		expect(titles()).toEqual([]);
		expect(itemNames(actor)).toContain('My Buddy!');
		const [toast] = env.notifications.messages('info');
		expect(toast).toMatch(/^Nim\+ migrated 1 character to the 0\.2 rules \(\d+ items? updated, \d+ added, \d+ removed\)\.$/);
		// The counts are what happened to the actor's items.
		const [updated, added, removed] = /\((\d+) items? updated, (\d+) added, (\d+) removed\)/.exec(toast).slice(1).map(Number);
		const after = snapshotItems(actor);
		expect(added).toBe(Object.keys(after).filter((id) => !before[id]).length);
		expect(removed).toBe(Object.keys(before).filter((id) => !after[id]).length);
		expect(updated).toBe(Object.keys(after).filter((id) => before[id] && JSON.stringify(before[id]) !== JSON.stringify(after[id])).length);
	});

	it('apply: false is a dry run — the card lists the plan, nothing is written, no subclass sync', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { subclass: 'Champion of the Arena' });
		const before = snapshotItems(actor);
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02', apply: false })).toBe('previewed');
		expect(actor.calls).toEqual([]);
		expect(snapshotItems(actor)).toEqual(before);
		expect(titles()).toEqual([]);
		expect(cards(CLASS_CARD)).toHaveLength(1);
		expect(cards(SYNC_CARD)).toEqual([]);
		expect(env.notifications.messages('info').join()).toMatch(/dry run: 1 character would change/);
	});

	it('several characters → plural toast and one chat card, whispered to the GMs', async () => {
		const a = await buildCharacterAtLevel(env, 'shepherd', 3);
		const b = await buildCharacterAtLevel(env, 'stormshifter', 20);
		acceptEverything(env);
		expect(await migration.migrateCoreClasses({ actors: [a, b], direction: 'to02' })).toBe('applied');
		expect(titles().some((t) => MIGRATE.test(t))).toBe(false);
		expect(env.notifications.messages('info').join()).toMatch(/Nim\+ migrated 2 characters to the 0\.2 rules/);
		expect(itemNames(b)).not.toContain('Expert Shifter');
		const [card] = cards(CLASS_CARD);
		expect(card.whisper).toEqual([GM_ID()]);
		expect(card.content).toContain(a.name);
		expect(card.content).toContain(b.name);
	});

	it('the chat card lists every actor, its class/level heading, and every change', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3, { name: 'Ada <x>' });
		acceptEverything(env);
		await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' });
		const html = cards(CLASS_CARD)[0].content;
		expect(html).toContain('Ada &lt;x&gt; — Commander 3');
		expect(html).toMatch(/Removed: <s>Commander&#39;s Orders<\/s> <em>\(now gained at level 4\)<\/em>/);
		expect(html).toMatch(/Added: <strong>Fit for Any Battlefield<\/strong>/);
		// The class module's (choice) line and the "check by hand" line are part of the report.
		expect(html).toMatch(/data-nim-plus-choice="combat-tactic"><\/i> Fit for Any Battlefield \(level 2\) brings a Combat Tactic: you will be asked to choose one<\/li>/);
		expect(html).toMatch(/<i class="fa-solid fa-hand"><\/i> Commander: 0.2 changed <em>combat tactics<\/em>/);
		expect(html).not.toMatch(/skipped|needs a choice/);
	});

	it('interactive: false → no dialog; the choice step is skipped and reported, the rest applied, the subclass sync still runs', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { subclass: 'Champion of the Arena', name: 'Cora' });
		const [glory] = itemsNamed(actor, 'Glory Seeker');
		await actor.deleteEmbeddedDocuments('Item', [glory.id]);
		env.dialogs.fallback = 'throw';
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02', interactive: false })).toBe('applied');
		expect(env.dialogs.log).toEqual([]);
		// Deterministic steps applied…
		expect(itemNames(actor)).toContain('Fit for Any Battlefield');
		expect(itemNames(actor)).toContain('Glory Seeker');
		// …the Combat Tactic pick left for the sheet.
		expect(actor.items.filter((i) => i.system?.group === 'combat-tactics')).toEqual([]);
		expect(migration.pendingChoices(actor, 'to02')).toEqual({ commander: { 'combat-tactic': { title: 'Choose a Combat Tactic', count: 1 } } });
		const html = cards(CLASS_CARD)[0].content;
		expect(html).toMatch(/brings a Combat Tactic: you will be asked to choose one <em>— skipped: needs a choice<\/em>/);
		expect(html).toMatch(/1 character needs a choice<\/strong> \(Cora\): open their sheet → <em>Migrate class to 0\.2 rules<\/em>/);
		expect(env.notifications.messages('info').join()).toMatch(/Nim\+ migrated 1 character to the 0\.2 rules/);
		expect(env.notifications.messages('warn')).toEqual(['Nim+ | 1 character needs a choice (Cora): open their sheet → Migrate class to 0.2 rules.']);
		// The planner keeps reporting it.
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.pendingChoice).toBe(true);
		expect(plan.pendingStored).toEqual([{ classId: 'commander', key: 'combat-tactic', title: 'Choose a Combat Tactic' }]);
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

	it('after applying, the GM gets the subclass sync for the migrated characters (after the class-module prompts), with its own card', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { subclass: 'Champion of the Arena' });
		const [glory] = itemsNamed(actor, 'Glory Seeker');
		await actor.deleteEmbeddedDocuments('Item', [glory.id]);
		acceptEverything(env);
		expect(await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' })).toBe('applied');
		expect(titles().some((t) => /Subclass update/.test(t))).toBe(false);
		const order = env.ChatMessage.created.map((c) => (CLASS_CARD.test(c.content) ? 'class' : SYNC_CARD.test(c.content) ? 'sync' : '?'));
		expect(order).toEqual(['class', 'sync']);
		expect(cards(SYNC_CARD)[0].content).toMatch(/Feature added: <strong>Glory Seeker<\/strong>/);
		expect(env.notifications.messages('info').join('\n')).toMatch(/Nim\+ synced subclasses on 1 character/);
		expect(itemsNamed(actor, 'Glory Seeker')).toHaveLength(1);
	});

	it('pending-choice records of another direction or of a class the character lacks are ignored', async () => {
		const actor = await buildCharacterAtLevel(env, 'hunter', 3, { version: '0.2' });
		actor._source.flags[MODULE_ID] = {
			...(actor._source.flags[MODULE_ID] ?? {}),
			classMigrationChoices: { direction: 'to02', steps: { shepherd: { 'sacred-graces-pick': { title: 'Sacred Graces' } } } },
		};
		actor.prepareData();
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' })).toEqual([]);
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' })).not.toContainEqual(
			expect.objectContaining({ pendingStored: expect.arrayContaining([expect.anything()]) }),
		);
		expect(migration.pendingChoices(actor, 'to203')).toEqual({});
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
		expect(cards(SYNC_CARD)).toEqual([]);
		// The report goes to the GMs and to the player who ran it.
		expect(cards(CLASS_CARD)[0].whisper).toEqual([GM_ID(), env.users.player.id]);
	});

	it('a player\'s list is cut down to the characters they own', async () => {
		const mine = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: true });
		const theirs = await buildCharacterAtLevel(env, 'shepherd', 3, { ownedByPlayer: false });
		env.setUser({ isGM: false });
		acceptEverything(env);
		expect(await migration.migrateCoreClasses({ actors: [mine, theirs, null], direction: 'to02' })).toBe('applied');
		expect(itemNames(mine)).toContain('My Buddy!');
		expect(theirs.calls).toEqual([]);
		const [card] = cards(CLASS_CARD);
		expect(card.content.match(/<h4/g)).toHaveLength(1);
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

	it('GM: migrates the world without a dialog, toasts, whispers the card, and stamps "<version>|to02"', async () => {
		const [actor] = await boot({
			prepare: async (e) => {
				e.dialogs.fallback = 'throw';
				return [await buildCharacterAtLevel(e, 'shepherd', 3)];
			},
		});
		expect(env.dialogs.log).toEqual([]);
		expect(itemNames(actor)).toContain('My Buddy!');
		expect(env.notifications.messages('info').join()).toMatch(/Nim\+ migrated 1 character to the 0\.2 rules/);
		expect(cards(CLASS_CARD)).toHaveLength(1);
		expect(cards(CLASS_CARD)[0].whisper).toEqual([GM_ID()]);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to02`);
	});

	it('a mixed world: every character migrated, the ones with choices listed and left for their sheet, stamp written', async () => {
		const [shep, cmd, sm] = await boot({
			prepare: async (e) => {
				e.dialogs.fallback = 'throw';
				return [
					await buildCharacterAtLevel(e, 'shepherd', 3, { name: 'Shep' }),
					await buildCharacterAtLevel(e, 'commander', 5, { name: 'Cmd' }),
					await buildCharacterAtLevel(e, 'shadowmancer', 4, { name: 'Sm', picks: ['Beguiling Influence', 'Vengeful Blast', 'Hungering Shadows'] }),
				];
			},
		});
		expect(env.dialogs.log).toEqual([]);
		expect(env.notifications.messages('info').join()).toMatch(/Nim\+ migrated 3 characters to the 0\.2 rules/);
		expect(env.notifications.messages('warn')).toEqual([
			'Nim+ | 2 characters need a choice (Cmd, Sm): open their sheet → Migrate class to 0.2 rules.',
		]);
		expect(migration.pendingChoices(shep, 'to02')).toEqual({});
		expect(Object.keys(migration.pendingChoices(cmd, 'to02'))).toEqual(['commander']);
		expect(Object.keys(migration.pendingChoices(sm, 'to02'))).toEqual(['shadowmancer']);
		expect(itemNames(sm)).not.toContain('Vengeful Blast');
		expect(cards(CLASS_CARD)[0].content).toMatch(/2 characters need a choice<\/strong> \(Cmd, Sm\)/);
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

	it('stamped for the other direction → runs again (a setting flip re-runs it)', async () => {
		const [actor] = await boot({
			stamp: `${MODULE_JSON_VERSION()}|to203`,
			prepare: async (e) => [await buildCharacterAtLevel(e, 'shepherd', 3)],
		});
		expect(itemNames(actor)).toContain('My Buddy!');
		expect(cards(CLASS_CARD)).toHaveLength(1);
	});

	it('stamped for an older version → runs again', async () => {
		const [actor] = await boot({
			stamp: '0.0.1|to02',
			prepare: async (e) => [await buildCharacterAtLevel(e, 'shepherd', 3)],
		});
		expect(itemNames(actor)).toContain('My Buddy!');
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to02`);
	});

	it('a pending choice does not hold back the stamp; the next startup does not run again, the sheet does', async () => {
		const [actor] = await boot({
			prepare: async (e) => [await buildCharacterAtLevel(e, 'commander', 5)],
		});
		expect(Object.keys(migration.pendingChoices(actor, 'to02'))).toEqual(['commander']);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to02`);
		// The sheet's control says so and runs it interactively.
		const controls = [];
		env.Hooks.callAll('getHeaderControlsActorSheetV2', { document: actor }, controls);
		const [control] = controls.filter((c) => c.action === 'nimPlusMigrateClass');
		expect(control).toMatchObject({ label: 'Migrate class to 0.2 rules (choice needed)', icon: 'fa-solid fa-list-check' });
		acceptEverything(env);
		control.onClick();
		await env.flush(60);
		expect(env.dialogs.log.filter((d) => /Combat Tactic/.test(d.title))).toHaveLength(1);
		expect(actor.items.filter((i) => i.system?.group === 'combat-tactics')).toHaveLength(1);
		expect(migration.pendingChoices(actor, 'to02')).toEqual({});
	});

	it('nothing to migrate → stamped silently (no dialog, no info, no card)', async () => {
		await boot({ prepare: async (e) => [await buildCharacterAtLevel(e, 'hunter', 3, { version: '0.2' })] });
		expect(titles().some((t) => MIGRATE.test(t))).toBe(false);
		expect(cards(CLASS_CARD)).toEqual([]);
		expect(env.notifications.messages('info').join()).not.toMatch(/Already on|migrated/);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to02`);
	});

	it('setting off → the to203 migration and a "|to203" stamp', async () => {
		await boot({
			playtest: false,
			prepare: async (e) => [await buildCharacterAtLevel(e, 'shepherd', 3, { version: '0.2' })],
		});
		expect(cards(CLASS_CARD)[0].content).toContain('Class migration → Heroes 2.0.3');
		expect(env.notifications.messages('info').join()).toMatch(/to the 2\.0\.3 rules/);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to203`);
	});

	it('a player gets no startup pass and nothing is stamped', async () => {
		const [actor] = await boot({
			isGM: false,
			prepare: async (e) => [await buildCharacterAtLevel(e, 'shepherd', 3, { ownedByPlayer: true })],
		});
		expect(env.dialogs.log).toEqual([]);
		expect(actor.calls).toEqual([]);
		expect(env.ChatMessage.created).toEqual([]);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe('');
	});

	it('a GM that is not the active GM runs nothing', async () => {
		const [actor] = await boot({
			prepare: async (e) => {
				e.game.users.activeGM = { id: 'otherGM000000000' };
				return [await buildCharacterAtLevel(e, 'shepherd', 3)];
			},
		});
		expect(actor.calls).toEqual([]);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe('');
		expect(env.settings.get(MODULE_ID, 'subclassSyncVersion')).toBe('');
	});

	it('the subclass-sync startup pass runs after the migration pass', async () => {
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
		expect(titles()).toEqual([]);
		const order = env.ChatMessage.created.map((c) => (CLASS_CARD.test(c.content) ? 'class' : SYNC_CARD.test(c.content) ? 'sync' : '?'));
		expect(order.indexOf('class')).toBeGreaterThanOrEqual(0);
		expect(order.lastIndexOf('sync')).toBeGreaterThan(order.indexOf('class'));
		// The migration's stamp is written before the sync's.
		const keys = env.log.filter((e) => e.method === 'settings.set').map((e) => e.key);
		expect(keys).toEqual([VERSION_KEY, SYNC_KEY]);
	});

	it('a character migrated at startup gets its subclass features once (migration pass + sync pass), with a pending choice kept', async () => {
		const [actor] = await boot({
			prepare: async (e) => {
				const a = await buildCharacterAtLevel(e, 'commander', 5, { subclass: 'Champion of the Arena' });
				const [glory] = itemsNamed(a, 'Glory Seeker');
				a.items.delete(glory.id);
				return [a];
			},
		});
		expect(itemsNamed(actor, 'Glory Seeker')).toHaveLength(1);
		const names = itemNames(actor);
		expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
		expect(await w.sync.planSubclassSync([actor])).toEqual([]);
		expect(Object.keys(migration.pendingChoices(actor, 'to02'))).toEqual(['commander']);
		expect(env.settings.get(MODULE_ID, 'classMigrationVersion')).toBe(`${version()}|to02`);
		expect(env.settings.get(MODULE_ID, 'subclassSyncVersion')).toBe(version());
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

	it('onClick migrates that character only, in the setting\'s direction, without a confirmation popup', async () => {
		const actor = await buildCharacterAtLevel(env, 'shepherd', 3, { name: 'Clicked' });
		const other = await buildCharacterAtLevel(env, 'commander', 5, { name: 'Other' });
		controlsFor(actor)[0].onClick();
		await env.flush(60);
		expect(titles()).toEqual([]);
		expect(itemNames(actor)).toContain('My Buddy!');
		expect(other.calls).toEqual([]);
		const [card] = cards(CLASS_CARD);
		expect(card.content).toContain('Class migration → Nimble 0.2 playtest');
		expect(card.content).toContain('Clicked');
		expect(card.content).not.toContain('Other');
	});

	it('onClick asks the player-choice prompts (interactive), and cancelling one skips only that step', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { name: 'Clicked' });
		env.dialogs.answerWhen(/Combat Tactic/, 'cancel');
		controlsFor(actor)[0].onClick();
		await env.flush(60);
		expect(titles().filter((t) => /Combat Tactic/.test(t))).toHaveLength(1);
		expect(itemNames(actor)).toContain('Fit for Any Battlefield');
		expect(actor.items.filter((i) => i.system?.group === 'combat-tactics')).toEqual([]);
		// Cancelled on the sheet: not remembered as pending.
		expect(migration.pendingChoices(actor, 'to02')).toEqual({});
		expect(env.notifications.messages('warn').join()).not.toMatch(/needs a choice/);
		expect(controlsFor(actor)[0].label).toBe('Migrate class to 0.2 rules');
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
