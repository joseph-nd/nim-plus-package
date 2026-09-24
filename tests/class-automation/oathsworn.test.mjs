/**
 * Oathsworn — Radiant Judgement: which attacks spend the Judgment Dice (2.0.3
 * melee only, 0.2 any attack incl. ranged and spells), the "honest signal" tag
 * check, the announcement on a roll (GM only) and Reliable Justice.
 */
import { describe, expect, it } from 'vitest';
import { makeCharacter, MODULE_ID, setPool } from '../harness/index.mjs';
import { itemNamed, meleeWeapon, rangedWeapon, rawItem, world } from './_mocks.mjs';

const SCRIPTS = [
	'scripts/classes/shared/activation.mjs',
	'scripts/classes/oathsworn/judgment-rules.mjs',
	'scripts/classes/oathsworn/judgment.mjs',
	'scripts/classes/rule-injection.mjs',
	'scripts/classes/activation-lifecycle.mjs',
];

const JUDGMENT = (faces) => ({
	'Radiant Judgement': {
		dicePools: {
			judgment: {
				identifier: 'judgment',
				label: 'Judgment Dice',
				dieSize: 'd6',
				faces,
				refills: [{ trigger: 'onAttacked', mode: 'setIfEmpty', value: '@poolMax' }, { trigger: 'encounterEnd', mode: 'clear', value: '0' }],
			},
		},
	},
});

async function oathsworn(env, { version = '0.2', faces = [3, 4], extra = [], features = [] } = {}) {
	return makeCharacter(env, {
		classId: 'oathsworn',
		level: 2,
		version,
		features: ['Radiant Judgement', ...features],
		items: [meleeWeapon('Mace'), rangedWeapon('Javelin'), ...extra],
		pools: JUDGMENT(faces),
	});
}
const facesOf = (actor) => itemNamed(actor, 'Radiant Judgement').flags.nimble.dicePools.judgment.faces;

/** A weapon swing whose card carries (or not) the pool tag the system adds. */
async function swing(env, actor, weapon, { tagged = true, card = true } = {}) {
	env.onActivate = async () => (card ? { id: 'card', rolls: [{ formula: `1d8${tagged ? ' + 3[Judgment Dice] + 4[Judgment Dice]' : ''}` }] } : null);
	await itemNamed(actor, weapon).activate({});
	await env.flush();
}

function chatCard(env, actor, { type = 'spell', tagged = true, author = env.game.user.id, effects } = {}) {
	return {
		type,
		author: { id: author },
		speaker: { actor: actor.id },
		rolls: [{ formula: `2d6${tagged ? ' + 3[Judgment Dice] + 4[Judgment Dice]' : ''}` }],
		system: { activation: { effects: effects ?? [{ type: 'damage', formula: '2d6' }] } },
	};
}

describe('snapshot / expend on weapon attacks', () => {
	it.each([
		['2.0.3', 'Mace', true],
		['2.0.3', 'Javelin', false],
		['0.2', 'Mace', true],
		['0.2', 'Javelin', true],
	])('%s: a %s attack whose card carries the tag spends the dice → %s', async (version, weapon, spent) => {
		const { env } = await world({ scripts: SCRIPTS, playtest: version === '0.2' });
		const actor = await oathsworn(env, { version });
		await swing(env, actor, weapon);
		expect(facesOf(actor)).toEqual(spent ? [] : [3, 4]);
		const announced = env.ChatMessage.created.filter((c) => /Radiant Judgement/.test(c.flavor));
		expect(announced).toHaveLength(spent ? 1 : 0);
		if (spent) expect(announced[0].content).toContain('<strong>7 radiant damage</strong> (3 + 4)');
	});

	it('an untagged card (fast-forwarded dialog) spends nothing', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		await swing(env, actor, 'Mace', { tagged: false });
		expect(facesOf(actor)).toEqual([3, 4]);
	});

	it('a cancelled activation spends nothing', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		await swing(env, actor, 'Mace', { card: false });
		expect(facesOf(actor)).toEqual([3, 4]);
	});

	it('no dice rolled: nothing to spend and no card', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env, { faces: [] });
		await swing(env, actor, 'Mace');
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('the clear is flagged so the system sync leaves it alone', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		await swing(env, actor, 'Mace');
		const update = actor.callsOf('update').at(-1);
		expect(update.options).toMatchObject({ nimble: { skipDicePoolSync: true } });
	});

	it('automation off: nothing is spent', async () => {
		const { env } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await oathsworn(env);
		await swing(env, actor, 'Mace');
		expect(facesOf(actor)).toEqual([3, 4]);
	});
});

describe('0.2 "any attack": spell and feature cards (createChatMessage)', () => {
	it.each([
		['spell', true],
		['feature', true],
		['object', false],
	])('0.2: a tagged %s card by this user spends the dice → %s', async (type, spent) => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		env.Hooks.callAll('createChatMessage', chatCard(env, actor, { type }));
		await env.flush();
		expect(facesOf(actor)).toEqual(spent ? [] : [3, 4]);
	});

	it('2.0.3 (melee only): a spell card never spends them', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await oathsworn(env, { version: '2.0.3' });
		env.Hooks.callAll('createChatMessage', chatCard(env, actor));
		await env.flush();
		expect(facesOf(actor)).toEqual([3, 4]);
	});

	it('another user\'s card, or an untagged one, spends nothing', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		env.Hooks.callAll('createChatMessage', chatCard(env, actor, { author: env.users.player.id }));
		env.Hooks.callAll('createChatMessage', chatCard(env, actor, { tagged: false }));
		await env.flush();
		expect(facesOf(actor)).toEqual([3, 4]);
	});

	it.fails('BUG-class-automation-4: a healing spell (not an attack) does not spend the Judgment Dice', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		// The system's "any" autoBonus filter matches activations with no attack
		// delivery at all, so a healing roll carries the Judgment tag too.
		env.Hooks.callAll('createChatMessage', chatCard(env, actor, { effects: [{ type: 'healing', formula: '2d6' }] }));
		await env.flush();
		expect(facesOf(actor)).toEqual([3, 4]);
	});
});

describe('Judgment Dice rolled: announcement and Reliable Justice (preUpdate)', () => {
	const roll = (actor, faces) =>
		itemNamed(actor, 'Radiant Judgement').update({ flags: { nimble: { dicePools: { judgment: { faces } } } } });

	it.each(['0.2', '2.0.3'])('%s: empty → rolled announces once, naming the right target', async (version) => {
		const { env } = await world({ scripts: SCRIPTS, playtest: version === '0.2' });
		const actor = await oathsworn(env, { version, faces: [] });
		await roll(actor, [2, 5]);
		const [card] = env.ChatMessage.created;
		expect(card.content).toContain('<strong>7</strong>');
		expect(card.content).toContain(version === '0.2' ? 'next attack' : 'next melee attack');
		expect(facesOf(actor)).toEqual([2, 5]);
	});

	it('a rewrite of an already-rolled pool is not announced', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env, { faces: [1, 1] });
		await roll(actor, [2, 5]);
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('only the GM client announces', async () => {
		const { env } = await world({ scripts: SCRIPTS, isGM: false });
		const actor = await oathsworn(env, { faces: [] });
		await roll(actor, [2, 5]);
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('a pool that does not refill on being attacked (Fury Dice) is ignored', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env, { faces: [] });
		const rj = itemNamed(actor, 'Radiant Judgement');
		setPool(env, rj, 'dicePools', 'fury', { identifier: 'fury', label: 'Fury Dice', faces: [], refills: [] });
		await rj.update({ flags: { nimble: { dicePools: { fury: { faces: [4] } } } } });
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('Reliable Justice rolls one extra die and drops the lowest, in the same write', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env, { faces: [], extra: [rawItem('Reliable Justice')] });
		env.dice.push(6);
		await roll(actor, [2, 5]);
		expect(facesOf(actor)).toEqual([5, 6]);
		expect(actor.callsOf('update')).toHaveLength(1);
		expect(env.ChatMessage.created[0].content).toContain('dropped the lowest (2)');
	});

	it('automation off: no announcement, no Reliable Justice', async () => {
		const { env } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await oathsworn(env, { faces: [], extra: [rawItem('Reliable Justice')] });
		await roll(actor, [2, 5]);
		expect(facesOf(actor)).toEqual([2, 5]);
		expect(env.ChatMessage.created).toHaveLength(0);
	});
});

describe('findJudgmentPool', () => {
	it('matches either spelling but requires the onAttacked refill', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const { findJudgmentPool } = m['classes/oathsworn/judgment-rules'];
		const actor = await makeCharacter(env, {
			classId: 'oathsworn',
			items: [rawItem('X')],
			pools: { X: { dicePools: { judgement: { identifier: 'judgement', faces: [1], refills: [] } } } },
		});
		expect(findJudgmentPool(actor)).toBeNull();
		setPool(env, itemNamed(actor, 'X'), 'dicePools', 'judgement', { identifier: 'judgement', faces: [1], refills: [{ trigger: 'onAttacked' }] });
		expect(findJudgmentPool(actor)?.key).toBe('judgement');
		expect(itemNamed(actor, 'X').getFlag(MODULE_ID, 'playtest02')).toBeUndefined();
	});
});
