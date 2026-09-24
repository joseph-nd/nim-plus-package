/**
 * scripts/macros/spore-attack.mjs — Sporesphere dialog, Decay spend from the 0.2
 * Direbeast Form pool (blocked when short), manual Beastshift under 2.0.3, and
 * the pending Blinded/Poisoned conditions applied on `nimble.useItem`.
 */
import { describe, expect, it, vi } from 'vitest';
import { makeCharacter, MODULE_ID } from '../harness/index.mjs';
import { itemNamed, rawItem, world } from './_mocks.mjs';

const SCRIPTS = ['scripts/macros/spore-attack.mjs'];

function direbeast(current, max = 3) {
	return { '@actor': { chargePools: { 'actor:direbeast-form': { identifier: 'direbeast-form', label: 'Direbeast Form', current, max, hidden: false } } } };
}

async function stormshifter(env, { features = ['Sporesphere', 'Decay'], pool = direbeast(3), extra = [] } = {}) {
	return makeCharacter(env, { classId: 'stormshifter', level: 7, version: '0.2', features, items: extra, pools: pool ?? {} });
}

const poolNow = (actor) => actor.flags.nimble?.chargePools?.['actor:direbeast-form']?.current;

/** Answer the Sporesphere dialog by running its own Cast callback against a fake form. */
function cast(env, { dieBumps = 0, blinded = false, poisoned = false } = {}) {
	env.dialogs.answerWhen(/Cast Sporesphere/, (config) => {
		const form = { elements: { dieBumps: { value: String(dieBumps) }, blinded: { checked: blinded }, poisoned: { checked: poisoned } } };
		// Foundry v14: the fields live in DialogV2's own <form> (a nested <form> in
		// the content is dropped by the HTML parser), which is the button's `form`.
		const dialog = { element: { querySelector: (sel) => (sel === 'form' || sel === 'form.dialog-form' ? form : null) } };
		return config.buttons.find((b) => b.action === 'cast').callback({}, { form }, dialog);
	});
}

async function run(env, m, actor) {
	const result = await m['macros/spore-attack'].sporeAttack(actor, itemNamed(actor, 'Sporesphere'));
	await env.flush();
	return result;
}

describe('sporeAttack: 0.2 Direbeast Form spend', () => {
	it('spends one use per bump/condition from the visible pool, notes it on a card, casts with the bumped die', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env);
		cast(env, { dieBumps: 1, blinded: true });
		await run(env, m, actor);
		expect(poolNow(actor)).toBe(1);
		const card = env.ChatMessage.created.at(-1);
		expect(card.content).toContain('<strong>2</strong> Direbeast Form uses');
		expect(card.content).toContain('3 → 1');
		expect(env.activations.at(-1).options).toMatchObject({ rollFormula: '1d6', executeMacro: false });
		expect(actor.getFlag(MODULE_ID, 'sporePendingConditions')).toEqual(['blinded']);
		// The pool is a visible counter: correctable by hand.
		expect(actor.flags.nimble.chargePools['actor:direbeast-form'].hidden).toBe(false);
	});

	it('an exact spend empties the pool', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env, { pool: direbeast(2) });
		cast(env, { blinded: true, poisoned: true });
		await run(env, m, actor);
		expect(poolNow(actor)).toBe(0);
		expect(env.activations).toHaveLength(1);
	});

	it.each([
		[1, { dieBumps: 2 }],
		[0, { blinded: true }],
		[2, { dieBumps: 1, blinded: true, poisoned: true }],
	])('pool %i is too small for %j: warned, nothing spent, nothing cast, no conditions stashed', async (current, choice) => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env, { pool: direbeast(current) });
		cast(env, choice);
		expect(await run(env, m, actor)).toBeNull();
		expect(poolNow(actor)).toBe(current);
		expect(env.activations).toHaveLength(0);
		expect(env.notifications.messages('warn').join()).toMatch(/Decay needs/);
		expect(actor.getFlag(MODULE_ID, 'sporePendingConditions')).toBeUndefined();
	});

	it('no Decay spend: nothing spent, no card, stale conditions cleared', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env);
		await actor.setFlag(MODULE_ID, 'sporePendingConditions', ['poisoned']);
		cast(env);
		await run(env, m, actor);
		expect(poolNow(actor)).toBe(3);
		expect(env.ChatMessage.created).toHaveLength(0);
		expect(actor.getFlag(MODULE_ID, 'sporePendingConditions')).toBeUndefined();
	});

	it('cancel / close: nothing happens', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env);
		env.dialogs.answerWhen(/Cast Sporesphere/, 'cancel');
		expect(await run(env, m, actor)).toBeNull();
		expect(await run(env, m, actor)).toBeNull(); // unscripted → closed
		expect(poolNow(actor)).toBe(3);
		expect(env.activations).toHaveLength(0);
	});

	it.fails('BUG-class-automation-5: die-size bumps past d20 are not charged (Sporulation 2d8 + 5 bumps = 3 effective)', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env, { features: ['Sporesphere', 'Decay', 'Sporulation'], pool: direbeast(5, 5) });
		cast(env, { dieBumps: 5 });
		await run(env, m, actor);
		expect(env.activations.at(-1).options.rollFormula).toBe('2d20');
		expect(poolNow(actor)).toBe(2);
	});
});

describe('sporeAttack: stages and the 2.0.3 / no-pool path', () => {
	it.each([
		[['Sporesphere'], '1d4'],
		[['Sporesphere', 'Germination'], '1d6'],
		[['Sporesphere', 'Germination', 'Mycelium Growth'], '1d8'],
		[['Sporesphere', 'Germination', 'Mycelium Growth', 'Sporulation'], '2d8'],
	])('%j → %s', async (features, formula) => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env, { features });
		cast(env);
		await run(env, m, actor);
		expect(env.activations.at(-1).options.rollFormula).toBe(formula);
	});

	it.each([
		['setting off (2.0.3)', false, direbeast(3)],
		['setting on but no Direbeast pool', true, null],
	])('%s: Beastshift charges are tracked by hand — card only, no pool write, never blocked', async (_label, playtest, pool) => {
		const { env, m } = await world({ scripts: SCRIPTS, playtest });
		const actor = await stormshifter(env, { pool });
		cast(env, { dieBumps: 4, blinded: true, poisoned: true });
		await run(env, m, actor);
		expect(env.activations).toHaveLength(1);
		const card = env.ChatMessage.created.at(-1);
		expect(card.content).toContain('<strong>6</strong> Beastshift charges');
		if (pool) expect(poolNow(actor)).toBe(3);
		expect(actor.callsOf('update')).toHaveLength(0);
	});

	it('missing actor or item: error notification, nothing else', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		expect(await m['macros/spore-attack'].sporeAttack(null, null)).toBeNull();
		expect(env.notifications.messages('error')).toHaveLength(1);
		expect(env.dialogs.log).toHaveLength(0);
	});
});

describe('pending Blinded/Poisoned on nimble.useItem', () => {
	function target(statuses = []) {
		return { actor: { name: 'Goblin', statuses: new Set(statuses), toggleStatusEffect: vi.fn(async () => true) } };
	}

	it('applies each pending condition to every hit target that lacks it, once, then clears the flag', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env);
		await actor.setFlag(MODULE_ID, 'sporePendingConditions', ['blinded', 'poisoned']);
		const a = target();
		const b = target(['poisoned']);
		env.Hooks.callAll('nimble.useItem', itemNamed(actor, 'Sporesphere'), {}, { targets: [a, b], isMiss: false });
		await env.flush();
		expect(a.actor.toggleStatusEffect.mock.calls.map((c) => c[0])).toEqual(['blinded', 'poisoned']);
		expect(b.actor.toggleStatusEffect.mock.calls.map((c) => c[0])).toEqual(['blinded']);
		expect(actor.getFlag(MODULE_ID, 'sporePendingConditions')).toBeUndefined();
	});

	it('a miss clears the flag and applies nothing', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env);
		await actor.setFlag(MODULE_ID, 'sporePendingConditions', ['blinded']);
		const a = target();
		env.Hooks.callAll('nimble.useItem', itemNamed(actor, 'Sporesphere'), {}, { targets: [a], isMiss: true });
		await env.flush();
		expect(a.actor.toggleStatusEffect).not.toHaveBeenCalled();
		expect(actor.getFlag(MODULE_ID, 'sporePendingConditions')).toBeUndefined();
	});

	it('other items are ignored', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await stormshifter(env, { extra: [rawItem('Other Spores')] });
		await actor.setFlag(MODULE_ID, 'sporePendingConditions', ['blinded']);
		env.Hooks.callAll('nimble.useItem', itemNamed(actor, 'Other Spores'), {}, { targets: [target()] });
		await env.flush();
		expect(actor.getFlag(MODULE_ID, 'sporePendingConditions')).toEqual(['blinded']);
	});
});
