/**
 * Feats — core bookkeeping (scripts/feats/core.mjs), the level-1 auto-prompt
 * (scripts/feats/auto-prompt.mjs) and the settings toggle (scripts/feats/settings.mjs).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MODULE_ID } from '../harness/index.mjs';
import { character, featItem, featsWorld, FEATS_PACK } from './feats-helpers.mjs';

/** Dialog answer that renders the dialog content, ticks radio `value` and presses `action`. */
export function pickRadio(value, action = 'grant') {
	return (config) => {
		const root = document.createElement('div');
		root.innerHTML = config.content;
		const input = root.querySelectorAll('input').find((i) => i.value === value);
		if (input) input.checked = true;
		const button = config.buttons.find((b) => b.action === action);
		// v14: `button.form` is DialogV2's own <form> wrapping the content.
		return button.callback({}, { form: root }, { element: root });
	};
}

describe('feats core: level / milestone math', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld());
	});

	it.each([
		[0, 0],
		[1, 1],
		[3, 1],
		[4, 2],
		[7, 2],
		[8, 3],
		[11, 3],
		[12, 4],
		[15, 4],
		[16, 5],
		[20, 5],
	])('milestonesReached(%i) = %i', (level, n) => {
		expect(m.core.milestonesReached(level)).toBe(n);
	});

	it('getCharacterLevel reads actor.levels.character, falls back to class items, 0 for no actor', async () => {
		const actor = await character(env, { level: 7 });
		expect(m.core.getCharacterLevel(actor)).toBe(7);
		expect(m.core.getCharacterLevel(null)).toBe(0);
		// Fallback: no levels getter → sum classLevel of class items.
		const fake = { levels: undefined, items: [{ type: 'class', system: { classLevel: 3 } }, { type: 'class', system: { classLevel: 2 } }, { type: 'feature', system: { classLevel: 9 } }] };
		expect(m.core.getCharacterLevel(fake)).toBe(5);
	});

	it('an actor with no class is level 0 and owes no feats', async () => {
		const actor = await character(env, { classId: null });
		expect(m.core.getCharacterLevel(actor)).toBe(0);
		expect(m.core.pendingFeatCount(actor)).toBe(0);
	});

	it.each([
		[1, 0, 1],
		[1, 1, 0],
		[3, 1, 0],
		[4, 1, 1],
		[8, 1, 2],
		[16, 0, 5],
		[16, 5, 0],
		[20, 6, 0], // over-granted never goes negative
	])('level %i with %i feats → %i pending', async (level, owned, pending) => {
		const names = ['Alert', 'Tough', 'Lucky', 'Swift', 'Durable', 'Brutal'].slice(0, owned);
		const actor = await character(env, { level, items: names.map((n) => featItem(n)) });
		expect(m.core.ownedFeats(actor)).toHaveLength(owned);
		expect(m.core.pendingFeatCount(actor)).toBe(pending);
	});

	it('ownedFeats counts by flag OR by group, ignores non-features', async () => {
		const byGroupOnly = featItem('Alert', { flags: { [MODULE_ID]: { feat: false } } });
		const byFlagOnly = featItem('Tough', { system: { group: 'other' } });
		const notFeature = { name: 'Feat-ish object', type: 'object', system: { group: 'feats' }, flags: { [MODULE_ID]: { feat: true } } };
		const actor = await character(env, { level: 4, items: [byGroupOnly, byFlagOnly, notFeature] });
		expect(m.core.ownedFeats(actor).map((i) => i.name).sort()).toEqual(['Alert', 'Tough']);
	});

	it.each([
		['', true, true],
		[undefined, true, true],
		['2 DEX', true, true],
		['3 DEX', false, true],
		['3 dex', false, true],
		['4 STR', false, true],
		['1 WIL', true, true],
		['Plate Armor Prof.', true, false],
		['Can cast spells', true, false],
	])('evaluateFeatPrereq(%j) → met=%s checkable=%s (DEX 2, STR 1, WIL 1)', async (req, met, checkable) => {
		const actor = await character(env, { system: { abilities: { dexterity: { mod: 2 }, strength: { mod: 1 }, will: { mod: 1 } } } });
		const v = m.core.evaluateFeatPrereq(actor, req);
		expect(v.met).toBe(met);
		expect(v.checkable).toBe(checkable);
	});
});

describe('feats core: chooseFeat / grantFeatByIdentifier', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld());
	});

	it('grants the picked feat with compendiumSource, excluding feats already owned', async () => {
		const actor = await character(env, { level: 4, items: [featItem('Alert')] });
		env.dialogs.answer(pickRadio('tough'));
		const created = await m.core.chooseFeat(actor);
		expect(created?.name).toBe('Tough');
		expect(created._stats.compendiumSource).toMatch(new RegExp(`^Compendium\\.${FEATS_PACK}\\.Item\\.`));
		expect(m.core.pendingFeatCount(actor)).toBe(0);
		// The picker never offered the owned feat.
		expect(env.dialogs.log[0].content).not.toMatch(/value="alert"/);
		expect(env.dialogs.log[0].content).toMatch(/value="tough"/);
	});

	it('cancel / close grants nothing', async () => {
		const actor = await character(env, { level: 1 });
		env.dialogs.answer('cancel');
		expect(await m.core.chooseFeat(actor)).toBeNull();
		env.dialogs.answer(null);
		expect(await m.core.chooseFeat(actor)).toBeNull();
		expect(actor.callsOf('create')).toHaveLength(0);
	});

	it('pressing Gain Feat with nothing selected grants nothing', async () => {
		const actor = await character(env, { level: 1 });
		env.dialogs.answer(pickRadio('no-such-feat'));
		expect(await m.core.chooseFeat(actor)).toBeNull();
		expect(actor.callsOf('create')).toHaveLength(0);
	});

	it('disables feats whose ability prerequisite is unmet (radio carries disabled)', async () => {
		const actor = await character(env, { level: 1, system: { abilities: { dexterity: { mod: 0 } } } });
		env.dialogs.answer(null);
		await m.core.chooseFeat(actor);
		const content = env.dialogs.log[0].content;
		expect(content).toMatch(/value="defensive-duelist" disabled/);
		expect(content).toMatch(/Requires 2 DEX \(you have 0\)/);
	});

	it('missing actor → error notification, no dialog', async () => {
		expect(await m.core.chooseFeat(null)).toBeNull();
		expect(env.notifications.messages('error')[0]).toMatch(/missing actor/);
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('all feats owned → info, no dialog', async () => {
		const all = (await env.game.packs.get(FEATS_PACK).getDocuments()).filter((d) => d.type === 'feature');
		const actor = await character(env, { level: 20, items: all.map((d) => featItem(d.name)) });
		expect(await m.core.chooseFeat(actor)).toBeNull();
		expect(env.notifications.messages('info')).toContain('All feats have already been taken.');
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('grantFeatByIdentifier with an unknown identifier creates nothing', async () => {
		const actor = await character(env, { level: 1 });
		expect(await m.core.grantFeatByIdentifier(actor, 'nope')).toBeNull();
		expect(actor.callsOf('create')).toHaveLength(0);
	});

	it('no feats pack → error notification, nothing granted', async () => {
		env.game.packs.delete(FEATS_PACK);
		const actor = await character(env, { level: 1 });
		expect(await m.core.chooseFeat(actor)).toBeNull();
		expect(actor.callsOf('create')).toHaveLength(0);
		expect(env.notifications.messages('error').some((x) => /No feats found/.test(x))).toBe(true);
	});
});

describe('feats auto-prompt (level 1)', () => {
	let env, m;
	const sheetFor = (actor) => ({ document: actor, element: null });

	beforeEach(async () => {
		({ env, m } = await featsWorld({ isGM: false }));
	});

	it('player opening a level-1 sheet owed a feat is prompted once and the pick is granted', async () => {
		const actor = await character(env, { level: 1 });
		env.dialogs.answer(pickRadio('alert'));
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(actor.items.some((i) => i.name === 'Alert')).toBe(true);
		// A second render does not prompt again.
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(1);
	});

	it('dismissing stops the loop and the prompt stays disarmed until a class level change', async () => {
		const actor = await character(env, { level: 1 });
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null); // unscripted → closed
		await env.flush();
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(1);
		// Class level change re-arms (level stays 1 here to keep the level-1 scope).
		const cls = actor.items.find((i) => i.type === 'class');
		await cls.update({ 'system.classLevel': 1 });
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(2);
	});

	it.each([
		['level 2', { level: 2 }],
		['already has a feat', { level: 1, items: () => [featItem('Alert')] }],
	])('no prompt when %s', async (_label, spec) => {
		const actor = await character(env, { level: spec.level, items: spec.items?.() ?? [] });
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('no prompt for a non-owner', async () => {
		const actor = await character(env, { level: 1, ownedByPlayer: false });
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('no prompt when the setting is off', async () => {
		({ env, m } = await featsWorld({ isGM: false, enabled: false }));
		const actor = await character(env, { level: 1 });
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('GM is only prompted for their own assigned character', async () => {
		env.setUser({ isGM: true });
		const actor = await character(env, { level: 1 });
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(0);
		env.game.user.character = actor;
		env.Hooks.callAll('renderPlayerCharacterSheet', sheetFor(actor), null);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(1);
		delete env.game.user.character;
	});
});

describe('feats setting', () => {
	it('registers enableFeats (world, default off) and re-prepares + re-renders actors on change', async () => {
		const { env, m } = await featsWorld({ enabled: false });
		const reg = env.settings.registered.get(`${MODULE_ID}.enableFeats`);
		expect(reg).toMatchObject({ scope: 'world', config: true, default: false });
		expect(m.settings.featsEnabled()).toBe(false);
		const actor = await character(env, { level: 4 });
		let renders = 0;
		actor.apps = { a: { render: () => renders++ } };
		const cls = actor.items.find((i) => i.type === 'class');
		await env.settings.set(MODULE_ID, 'enableFeats', true);
		expect(m.settings.featsEnabled()).toBe(true);
		expect(renders).toBe(1);
		// The class-item groupIdentifiers patch now advertises the feats group (derived only) …
		cls.prepareData();
		expect(cls.system.groupIdentifiers).toContain('feats');
		expect(cls._source.system.groupIdentifiers ?? []).not.toContain('feats');
		cls.prepareData();
		expect(cls.system.groupIdentifiers.filter((g) => g === 'feats')).toHaveLength(1);
		// … and self-clears when switched off.
		await env.settings.set(MODULE_ID, 'enableFeats', false);
		cls.prepareData();
		expect(cls.system.groupIdentifiers ?? []).not.toContain('feats');
	});

	it('featsEnabled() is false (not a throw) before the setting is registered', async () => {
		const { m } = await featsWorld({ boot: false });
		expect(m.settings.featsEnabled()).toBe(false);
	});
});
