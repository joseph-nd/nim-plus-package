/**
 * Berserker: Death Blow (0.2 doubles the Fury Dice already on a crit roll) and
 * Boundless Flames (offers to remove Boundless Rage, either creation order).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCharacter, MODULE_ID } from '../harness/index.mjs';
import { itemNamed, meleeWeapon, rawItem, rollDamage, world } from './_mocks.mjs';

const SCRIPTS = [
	'scripts/classes/shared/activation.mjs',
	'scripts/classes/berserker/death-blow.mjs',
	'scripts/classes/activation-lifecycle.mjs',
];

async function berserker(env, { version = '0.2', deathBlow = true, extra = [] } = {}) {
	return makeCharacter(env, {
		classId: 'berserker',
		level: 6,
		version,
		features: deathBlow ? ['Death Blow'] : [],
		items: [meleeWeapon('Greataxe'), ...extra],
	});
}

async function attack(env, actor, formula, faces, { rolls = 1 } = {}) {
	const made = [];
	env.onActivate = async () => {
		for (let i = 0; i < rolls; i += 1) made.push(await rollDamage(env, formula, i === 0 ? faces : [8]));
		return { id: 'card', rolls: made };
	};
	await itemNamed(actor, 'Greataxe').activate({});
	await env.flush();
	return made;
}

describe('Death Blow (0.2): double the Fury Dice on a crit', () => {
	it('0.2 copy is the one flagged playtest02; the 2.0.3 system copy is not', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const a = await berserker(env);
		expect(itemNamed(a, 'Death Blow').getFlag(MODULE_ID, 'playtest02')).toBe(true);
		const b = await berserker(env, { version: '2.0.3' });
		expect(itemNamed(b, 'Death Blow').getFlag(MODULE_ID, 'playtest02')).toBeUndefined();
	});

	it.each([
		['one term', '1d8 + 4[Fury Dice]', 4],
		['two terms', '1d8 + 4[Fury Dice] + 3[Fury Dice]', 7],
		['lower-case flavor', '1d8 + 5[fury dice]', 5],
		['a subtracted term', '1d8 + 4[Fury Dice] - 1[Fury Dice]', 3],
		['other flavored bonuses ignored', '1d8 + 2[Radiant] + 3[Fury Dice]', 3],
	])('crit, %s → +%s appended as Death Blow', async (_label, formula, fury) => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await berserker(env);
		const [roll] = await attack(env, actor, formula, [8]);
		expect(roll.isCritical).toBe(true);
		const deathBlow = roll.terms.filter((t) => t.options?.flavor === 'Death Blow');
		expect(deathBlow.map((t) => t.number)).toEqual([fury]);
		// The whole roll: primary + every flat term + the doubled Fury.
		const base = await (async () => {
			const r = new env.Roll(formula.replace('1d8', '8'));
			await r.evaluate();
			return r.total;
		})();
		expect(roll.total).toBe(base + fury);
	});

	it.each([
		['no Fury Dice on the roll', '1d8 + 2', [8]],
		['a non-crit', '1d8 + 4[Fury Dice]', [5]],
		['a miss', '1d8 + 4[Fury Dice]', [1]],
		['Fury that nets to zero or less', '1d8 + 2[Fury Dice] - 3[Fury Dice]', [8]],
	])('nothing is added for %s', async (_label, formula, faces) => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await berserker(env);
		const [roll] = await attack(env, actor, formula, faces);
		expect(roll.terms.some((t) => t.options?.flavor === 'Death Blow')).toBe(false);
	});

	it('the 2.0.3 system copy is left to the system (no doubling)', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await berserker(env, { version: '2.0.3' });
		const [roll] = await attack(env, actor, '1d8 + 4[Fury Dice]', [8]);
		expect(roll.total).toBe(12);
	});

	it('a renamed/world copy is matched by name only when it carries the 0.2 flag', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const flagged = await berserker(env, { deathBlow: false, extra: [rawItem('death blow', 'feature', {}, { flags: { [MODULE_ID]: { playtest02: true } } })] });
		expect((await attack(env, flagged, '1d8 + 4[Fury Dice]', [8]))[0].total).toBe(16);
		const bare = await berserker(env, { deathBlow: false, extra: [rawItem('Death Blow')] });
		expect((await attack(env, bare, '1d8 + 4[Fury Dice]', [8]))[0].total).toBe(12);
	});

	it('doubles once per activation, however many crit rolls it makes', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await berserker(env);
		const rolls = await attack(env, actor, '1d8 + 4[Fury Dice]', [8], { rolls: 2 });
		expect(rolls.map((r) => r.terms.filter((t) => t.options?.flavor === 'Death Blow').length)).toEqual([1, 0]);
	});

	it('spends nothing and posts no card (no resource to correct)', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await berserker(env);
		await attack(env, actor, '1d8 + 4[Fury Dice]', [8]);
		expect(env.ChatMessage.created).toHaveLength(0);
		expect(actor.callsOf('update')).toHaveLength(0);
	});

	it('automation off: no doubling', async () => {
		const { env } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await berserker(env);
		const [roll] = await attack(env, actor, '1d8 + 4[Fury Dice]', [8]);
		expect(roll.total).toBe(12);
	});

	it('a crit outside any tracked activation is ignored', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		await berserker(env);
		const roll = await rollDamage(env, '1d8 + 4[Fury Dice]', [8]);
		expect(roll.total).toBe(12);
		expect(m['classes/shared/activation'].activationStack).toHaveLength(0);
	});
});

describe('Boundless Flames replaces Boundless Rage', () => {
	const FLAMES = ['scripts/classes/berserker/boundless-flames.mjs'];
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout'] });
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	async function settle(env) {
		await vi.advanceTimersByTimeAsync(300);
		await env.flush();
	}

	const rage = () => rawItem('BOUNDLESS RAGE', 'feature', { group: 'berserker-progression' });
	const flames = () => rawItem('Boundless Flames', 'feature', { group: 'path-of-the-burning-rage' });

	it.each([
		['Rage then Flames (one batch)', (a) => a.createEmbeddedDocuments('Item', [rage(), flames()])],
		['Flames then Rage (one batch)', (a) => a.createEmbeddedDocuments('Item', [flames(), rage()])],
		['Flames, then Rage later', async (a, env) => { await a.createEmbeddedDocuments('Item', [flames()]); await settle(env); await a.createEmbeddedDocuments('Item', [rage()]); }],
		['Rage, then Flames later', async (a, env) => { await a.createEmbeddedDocuments('Item', [rage()]); await settle(env); await a.createEmbeddedDocuments('Item', [flames()]); }],
	])('%s: one prompt; yes removes Boundless Rage', async (_label, create) => {
		const { env } = await world({ scripts: FLAMES });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 19 });
		env.dialogs.answerWhen('Boundless Flames', true);
		await create(actor, env);
		await settle(env);
		expect(env.dialogs.log.filter((d) => d.title === 'Boundless Flames')).toHaveLength(1);
		expect(actor.items.some((i) => /boundless rage/i.test(i.name))).toBe(false);
		expect(actor.items.some((i) => i.name === 'Boundless Flames')).toBe(true);
	});

	it('no removes nothing', async () => {
		const { env } = await world({ scripts: FLAMES });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 19 });
		env.dialogs.answerWhen('Boundless Flames', false);
		await actor.createEmbeddedDocuments('Item', [rage(), flames()]);
		await settle(env);
		expect(env.dialogs.pending()).toBe(0);
		expect(actor.items.filter((i) => /boundless/i.test(i.name))).toHaveLength(2);
	});

	it('closing the dialog removes nothing', async () => {
		const { env } = await world({ scripts: FLAMES });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 19 });
		await actor.createEmbeddedDocuments('Item', [rage(), flames()]);
		await settle(env);
		expect(env.dialogs.log).toHaveLength(1);
		expect(actor.items.filter((i) => /boundless/i.test(i.name))).toHaveLength(2);
	});

	it('the pack copies (system 2.0.3 BOUNDLESS RAGE and Nim+ 0.2 copy) are both recognised', async () => {
		for (const version of ['2.0.3', '0.2']) {
			const { env } = await world({ scripts: FLAMES, playtest: version === '0.2' });
			const actor = await makeCharacter(env, { classId: 'berserker', level: 19, version, features: ['BOUNDLESS RAGE'] });
			env.dialogs.answerWhen('Boundless Flames', true);
			await actor.createEmbeddedDocuments('Item', [flames()]);
			await settle(env);
			expect(actor.items.some((i) => /boundless rage/i.test(i.name))).toBe(false);
		}
	});

	it('no prompt when only one of the two is owned, or on a client that did not create the item', async () => {
		const { env } = await world({ scripts: FLAMES });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 19 });
		await actor.createEmbeddedDocuments('Item', [flames()]);
		await settle(env);
		expect(env.dialogs.log).toHaveLength(0);
		// Another user's creation: this client stays quiet.
		const item = new env.classes.Item(rage(), { parent: actor });
		actor.items.set(item.id, item);
		env.Hooks.callAll('createItem', item, {}, env.users.player.id);
		await settle(env);
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('a player who does not own the actor gets no prompt', async () => {
		const { env } = await world({ scripts: FLAMES, isGM: false });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 19, ownedByPlayer: false, features: [] });
		const item = new env.classes.Item(flames(), { parent: actor });
		actor.items.set(item.id, item);
		const other = new env.classes.Item(rage(), { parent: actor });
		actor.items.set(other.id, other);
		env.Hooks.callAll('createItem', item, {}, env.users.player.id);
		await settle(env);
		expect(env.dialogs.log).toHaveLength(0);
	});

	it('automation off: no prompt', async () => {
		const { env } = await world({ scripts: FLAMES, automation: false });
		const actor = await makeCharacter(env, { classId: 'berserker', level: 19 });
		await actor.createEmbeddedDocuments('Item', [rage(), flames()]);
		await settle(env);
		expect(env.dialogs.log).toHaveLength(0);
	});
});
