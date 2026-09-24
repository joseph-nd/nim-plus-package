/**
 * Oathsworn — Radiant Judgement: which attacks carry and spend the Judgment Dice
 * (Nim+ ruling: weapon and unarmed attacks only — 2.0.3 melee weapons, 0.2 melee
 * and ranged weapons, unarmed strikes in both; never spells or other features),
 * the "honest signal" tag check, the announcement on a roll (GM only) and
 * Reliable Justice.
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

const shieldBash = () => rawItem('Shield Bash', 'feature', { activation: { targets: { attackType: 'reach' }, effects: [{ type: 'damage', formula: '1d6' }] } });
const layOnHands = () => rawItem('Lay on Hands', 'feature', { activation: { effects: [{ type: 'healing', formula: '2d6' }] } });
const flameBolt = () => rawItem('Flame Bolt', 'spell', { activation: { targets: { attackType: 'range' }, effects: [{ type: 'damage', formula: '2d6' }] } });
const potion = () => rawItem('Alchemist Fire', 'object', { objectType: 'consumable', activation: { targets: { attackType: 'range' }, effects: [{ type: 'damage', formula: '1d6' }] } });

/**
 * What the system's activation dialog does when its component mounts
 * (`itemActivationConfigDialogState`): fold an autoBonus pool in when
 * `matchesAttackDelivery(filter, delivery)` — `any`/null match everything.
 */
function systemFoldsJudgment(actor, item) {
	const attackType = item?.system?.activation?.targets?.attackType;
	const delivery = attackType === 'reach' ? 'melee' : attackType === 'range' ? 'ranged' : null;
	return actor.items.some((i) =>
		[...(i.rules?.values() ?? [])].some((rule) => {
			if (rule.type !== 'diceConsumer' || rule.disabled || rule.mode !== 'autoBonus') return false;
			if (rule.poolIdentifier !== 'judgment') return false;
			const filter = rule.bonusOnAttackDelivery;
			return filter == null || filter === 'any' || filter === delivery;
		}),
	);
}

const judgmentFilters = (actor) =>
	[...actor.items].flatMap((i) => [...(i.rules?.values() ?? [])].filter((r) => r.type === 'diceConsumer' && r.poolIdentifier === 'judgment').map((r) => r.bonusOnAttackDelivery));

/** Render a fake ItemActivationConfigDialog for `item`; returns whether the system would fold the dice in. */
function openDialog(env, actor, item) {
	let folded = null;
	const app = {
		actor,
		item,
		_replaceHTML() {
			folded = systemFoldsJudgment(actor, item);
		},
	};
	env.Hooks.callAll('preRenderItemActivationConfigDialog', app, {}, { isFirstRender: true });
	app._replaceHTML({}, {}, { isFirstRender: true });
	return folded;
}

/** A system unarmed-strike card (AttackActionPanel / heroic macro / opportunity attack shape). */
function unarmedCard(env, actor, { author = env.game.user.id } = {}) {
	const roll = {
		class: 'DamageRoll',
		formula: '1d4',
		terms: [{ class: 'Die', number: 1, faces: 4, results: [{ result: 3, active: true }], evaluated: true, options: {} }],
		total: 3,
		evaluated: true,
		isCritical: false,
		isMiss: false,
	};
	const source = {
		rolls: [JSON.stringify(roll)],
		system: {
			name: 'Unarmed Strike',
			activation: {
				effects: [
					{
						id: 'unarmed-damage',
						type: 'damage',
						formula: '1d4',
						damageType: 'bludgeoning',
						roll,
						on: { hit: [{ id: 'unarmed-damage-hit', type: 'damageOutcome' }] },
					},
				],
				targets: { count: 1, attackType: 'reach', distance: 1 },
			},
		},
	};
	return {
		type: 'feature',
		author: { id: author },
		speaker: { actor: actor.id },
		_source: source,
		get system() {
			return source.system;
		},
		// Foundry rebuilds the message's Roll objects from the stored JSON.
		get rolls() {
			return source.rolls.map((r) => JSON.parse(r));
		},
		updateSource(changes) {
			if (changes.rolls) source.rolls = changes.rolls;
			if (changes.system) source.system = { ...source.system, ...changes.system };
		},
	};
}

async function unarmedStrike(env, actor, opts) {
	const card = unarmedCard(env, actor, opts);
	env.Hooks.callAll('preCreateChatMessage', card, {}, {}, env.game.user.id);
	env.Hooks.callAll('createChatMessage', card, {}, env.game.user.id);
	await env.flush();
	return card;
}

describe('Nim+ ruling: weapon and unarmed attacks only — the activation dialog', () => {
	it.each([
		['0.2', 'Mace', true],
		['0.2', 'Javelin', true],
		['0.2', 'Shield Bash', false],
		['0.2', 'Lay on Hands', false],
		['0.2', 'Flame Bolt', false],
		['0.2', 'Alchemist Fire', false],
		['2.0.3', 'Mace', true],
		['2.0.3', 'Javelin', false],
		['2.0.3', 'Shield Bash', false],
	])('%s: the dialog for %s folds the Judgment Dice in → %s', async (version, name, folded) => {
		const { env } = await world({ scripts: SCRIPTS, playtest: version === '0.2' });
		const actor = await oathsworn(env, { version, extra: [shieldBash(), layOnHands(), flameBolt(), potion()] });
		const before = judgmentFilters(actor);
		expect(openDialog(env, actor, itemNamed(actor, name))).toBe(folded);
		// In-memory only, and put back the moment the dialog has mounted.
		expect(judgmentFilters(actor)).toEqual(before);
	});

	it('an unarmed strike (a plain object, not an Item) is left to the system', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		const pseudo = { name: 'Unarmed Strike', img: 'icons/skills/melee/unarmed-punch-fist.webp', system: { activation: { effects: [{ type: 'damage', formula: '1d4' }] } } };
		expect(openDialog(env, actor, pseudo)).toBe(true);
	});

	it('automation off: the dialog is untouched', async () => {
		const { env } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await oathsworn(env, { extra: [shieldBash()] });
		expect(openDialog(env, actor, itemNamed(actor, 'Shield Bash'))).toBe(true);
	});
});

describe('Nim+ ruling: weapon and unarmed attacks only — spending', () => {
	it('a non-weapon object (consumable) never spends them, even with a tagged card', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env, { extra: [potion()] });
		await swing(env, actor, 'Alchemist Fire');
		expect(facesOf(actor)).toEqual([3, 4]);
	});

	it.each([
		['a damage spell', 'spell', [{ type: 'damage', formula: '2d6' }]],
		['a heal', 'spell', [{ type: 'healing', formula: '2d6' }]],
		['a feature attack', 'feature', [{ type: 'damage', formula: '1d6' }]],
		['a saving-throw spell with nested damage', 'spell', [{ type: 'savingThrow', on: { failedSave: [{ type: 'damage', formula: '2d6' }] } }]],
	])('0.2: %s card never spends the dice, even tagged', async (_label, type, effects) => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		env.Hooks.callAll('createChatMessage', chatCard(env, actor, { type, effects }));
		await env.flush();
		expect(facesOf(actor)).toEqual([3, 4]);
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('fixed NP-016 (BUG-class-automation-4): a healing spell does not spend the Judgment Dice', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		env.Hooks.callAll('createChatMessage', chatCard(env, actor, { effects: [{ type: 'healing', formula: '2d6' }] }));
		await env.flush();
		expect(facesOf(actor)).toEqual([3, 4]);
	});

	it('2.0.3: a spell card never spends them', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await oathsworn(env, { version: '2.0.3' });
		env.Hooks.callAll('createChatMessage', chatCard(env, actor));
		await env.flush();
		expect(facesOf(actor)).toEqual([3, 4]);
	});
});

describe('Nim+ ruling: unarmed strikes carry and spend the Judgment Dice', () => {
	it.each(['0.2', '2.0.3'])('%s: the dice are folded into the unarmed damage roll and expended', async (version) => {
		const { env } = await world({ scripts: SCRIPTS, playtest: version === '0.2' });
		const actor = await oathsworn(env, { version });
		const card = await unarmedStrike(env, actor);

		const [stored] = card._source.rolls.map((r) => JSON.parse(r));
		const node = card.system.activation.effects[0].roll;
		for (const roll of [stored, node]) {
			expect(roll.total).toBe(10);
			expect(roll.formula).toBe('1d4 + 3[Judgment Dice] + 4[Judgment Dice]');
			expect(roll.terms.slice(1)).toEqual([
				{ class: 'OperatorTerm', operator: '+', evaluated: true, options: {} },
				{ class: 'NumericTerm', number: 3, evaluated: true, options: { flavor: 'Judgment Dice' } },
				{ class: 'OperatorTerm', operator: '+', evaluated: true, options: {} },
				{ class: 'NumericTerm', number: 4, evaluated: true, options: { flavor: 'Judgment Dice' } },
			]);
		}
		expect(facesOf(actor)).toEqual([]);
		const announced = env.ChatMessage.created.filter((c) => /Radiant Judgement/.test(c.flavor));
		expect(announced).toHaveLength(1);
		expect(announced[0].content).toContain('<strong>7 radiant damage</strong> (3 + 4)');
	});

	it('no dice rolled: the card is untouched and nothing is announced', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env, { faces: [] });
		const card = await unarmedStrike(env, actor);
		expect(JSON.parse(card._source.rolls[0]).total).toBe(3);
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('another user\'s unarmed card spends nothing', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await oathsworn(env);
		const card = unarmedCard(env, actor, { author: env.users.player.id });
		env.Hooks.callAll('createChatMessage', card, {}, env.users.player.id);
		await env.flush();
		expect(facesOf(actor)).toEqual([3, 4]);
	});

	it('automation off: no fold, no spend', async () => {
		const { env } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await oathsworn(env);
		const card = await unarmedStrike(env, actor);
		expect(JSON.parse(card._source.rolls[0]).total).toBe(3);
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
		expect(card.content).toContain(version === '0.2' ? 'next weapon or unarmed attack' : 'next melee attack');
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
