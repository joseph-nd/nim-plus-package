/**
 * Commander automation: Combat Dice (pool, spend, formula), Combat Tactics resolved
 * on the attack roll, Inerrant Strike on a miss, Master Commander's Initiative
 * regain (2.0.3 only), the 0.2 Coordinated Strike pools, Single-minded Fighter's
 * foregone Orders and the owed Combat Tactic prompt.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, makeCharacter, MODULE_ID, setPool } from '../harness/index.mjs';
import {
	installDocumentStub,
	itemNamed,
	meleeWeapon,
	rangedWeapon,
	rawItem,
	rollDamage,
	testPredicate,
	world,
} from './_mocks.mjs';

const SCRIPTS = [
	'scripts/classes/shared/activation.mjs',
	'scripts/classes/commander/combat-dice.mjs',
	'scripts/classes/commander/tactics.mjs',
	'scripts/classes/commander/tactic-resolution.mjs',
	'scripts/classes/commander/master-commander.mjs',
	'scripts/classes/commander/superseded-features.mjs',
	'scripts/classes/rule-injection.mjs',
	'scripts/classes/activation-lifecycle.mjs',
];

const TACTICS = ['Heavy Strike', 'Lunging Strike', 'Sweeping Strike', 'Inerrant Strike'];

function dicePool(current, max = 3, dieSize = 'd8') {
	return { 'Fit for Any Battlefield': { chargePools: { 'combat-dice': { identifier: 'combat-dice', label: 'Combat Dice', current, max, dieSize, hidden: false } } } };
}

async function commander(env, { version = '0.2', level = 5, current = 2, max = 3, features = TACTICS, extra = [] } = {}) {
	const actor = await makeCharacter(env, {
		classId: 'commander',
		level,
		version,
		features: ['Fit for Any Battlefield', ...features],
		items: [meleeWeapon('Longsword'), rangedWeapon('Longbow'), ...extra],
		pools: dicePool(current, max),
	});
	return actor;
}

const combatDice = (actor) => itemNamed(actor, 'Fit for Any Battlefield').flags.nimble.chargePools['combat-dice'].current;
const cards = (env) => env.ChatMessage.created;

/** One weapon activation: the dialog arms `tactic`, then the damage roll lands. */
async function swing(env, m, actor, weaponName, { tactic = null, faces = [], formula = '1d8', options = {}, card = true, rolls = 1 } = {}) {
	const weapon = itemNamed(actor, weaponName);
	const made = [];
	env.onActivate = async (item) => {
		if (tactic) m['classes/commander/tactics'].setTacticArm({ actorId: actor.id, itemId: item.id, key: tactic });
		for (let i = 0; i < rolls; i += 1) made.push(await rollDamage(env, formula, i === 0 ? faces : [], options));
		return card ? { id: 'card', rolls: made } : null;
	};
	const result = await weapon.activate({});
	await env.flush();
	return { result, roll: made[0], rolls: made };
}

describe('Combat Dice arrive with Fit for Any Battlefield: level 2 in 0.2, level 4 in 2.0.3', () => {
	it.each([
		['0.2', 1, false],
		['0.2', 2, true],
		['0.2', 3, true],
		['2.0.3', 3, false],
		['2.0.3', 4, true],
		['2.0.3', 5, true],
	])('%s level %i → has the pool rule: %s', async (version, level, expected) => {
		const { env } = await world({ scripts: SCRIPTS, playtest: version === '0.2' });
		const actor = await buildCharacterAtLevel(env, 'commander', level, { version });
		const has = actor.items.some((i) => [...i.rules.values()].some((r) => r.type === 'chargePool' && r.identifier === 'combat-dice'));
		expect(has).toBe(expected);
	});
});

describe('findCombatDicePool / spendCombatDie / formulas', () => {
	it('finds the pool by identifier or label, needs a die size, skips hidden and clamps', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const { findCombatDicePool } = m['classes/commander/combat-dice'];
		const actor = await commander(env, { current: 9, max: 3 });
		expect(findCombatDicePool(actor)).toMatchObject({ key: 'combat-dice', current: 3, max: 3, dieSize: 'd8', scope: 'item' });

		const ffab = itemNamed(actor, 'Fit for Any Battlefield');
		setPool(env, ffab, 'chargePools', 'combat-dice', { identifier: 'combat-dice', current: 2, max: 3, dieSize: null });
		expect(findCombatDicePool(actor)).toBeNull();
		setPool(env, ffab, 'chargePools', 'combat-dice', { identifier: 'combat-dice', current: 2, max: 3, dieSize: 'd6', hidden: true });
		expect(findCombatDicePool(actor)).toBeNull();
		setPool(env, ffab, 'chargePools', 'renamed', { identifier: 'renamed', label: 'Combat Dice', current: 1, max: 2, dieSize: 'd6' });
		expect(findCombatDicePool(actor)).toMatchObject({ key: 'renamed', current: 1 });
		expect(findCombatDicePool(null)).toBeNull();
	});

	it('spending decrements the visible pool and announces it through the system hook', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const { findCombatDicePool, spendCombatDie } = m['classes/commander/combat-dice'];
		const actor = await commander(env, { current: 1 });
		expect(await spendCombatDie(actor, findCombatDicePool(actor))).toEqual({ remaining: 0 });
		expect(combatDice(actor)).toBe(0);
		const changed = env.Hooks.log.filter((e) => e.name === 'nimble.chargePool.changed');
		expect(changed).toHaveLength(1);
		expect(changed[0].args[0]).toMatchObject({ previousValue: 1, newValue: 0, reason: 'consume' });
		// Empty: nothing to spend.
		expect(await spendCombatDie(actor, findCombatDicePool(actor))).toBeNull();
		expect(combatDice(actor)).toBe(0);
	});

	it.each([
		[[], 1, '1d8', '1d8'],
		[[], 2, '2 * 1d8', '2 × 1d8'],
		[['Master at Arms'], 1, '2d8kh1', '1d8 adv'],
		[['Relentless Assault'], 2, '2 * 2d8kh1', '2 × 1d8 adv'],
	])('advantage features %j, multiplier %i → %s / %s', async (features, mult, formula, label) => {
		const { env, m } = await world({ scripts: SCRIPTS, playtest: false });
		const { combatDieFormula, combatDieLabel, findCombatDicePool } = m['classes/commander/combat-dice'];
		const actor = await commander(env, { version: '2.0.3', features: [], extra: features.map((n) => rawItem(n)) });
		const pool = findCombatDicePool(actor);
		expect(combatDieFormula(actor, pool, mult)).toBe(formula);
		expect(combatDieLabel(actor, pool, mult)).toBe(label);
	});

	it('the combatDiceAdvantage module flag works on any feature name', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { extra: [rawItem('Homebrew Edge', 'feature', {}, { flags: { [MODULE_ID]: { combatDiceAdvantage: true } } })] });
		expect(m['classes/commander/combat-dice'].combatDiceAdvantage(actor)).toBe(true);
	});
});

describe('availableCombatTactics / resolveCombatTactic', () => {
	it('melee weapons offer every owned tactic; ranged only the "any" ones', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const { availableCombatTactics } = m['classes/commander/tactics'];
		const actor = await commander(env);
		expect(availableCombatTactics(actor, itemNamed(actor, 'Longsword')).map((t) => t.key)).toEqual(['heavy-strike', 'lunging-strike', 'sweeping-strike']);
		expect(availableCombatTactics(actor, itemNamed(actor, 'Longbow')).map((t) => t.key)).toEqual(['heavy-strike']);
		// Not a weapon: nothing.
		expect(availableCombatTactics(actor, itemNamed(actor, 'Heavy Strike'))).toEqual([]);
	});

	it('only tactics the Commander owns are offered', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { features: ['Lunging Strike'] });
		expect(m['classes/commander/tactics'].availableCombatTactics(actor, itemNamed(actor, 'Longsword')).map((t) => t.key)).toEqual(['lunging-strike']);
	});

	it.each([
		['0.2', 'Knock the target back', true],
		['2.0.3', 'Push a Medium creature', undefined],
	])('%s copy of the tactics: Heavy Strike rider "%s", Sweeping cannotCrit=%s', async (version, rider, cannotCrit) => {
		const { env, m } = await world({ scripts: SCRIPTS, playtest: version === '0.2' });
		const { availableCombatTactics } = m['classes/commander/tactics'];
		const features = version === '0.2' ? TACTICS : ['Heavy Strike', 'Lunging Strike', 'Sweeping Strike'];
		const actor = await commander(env, { version, features });
		const byKey = Object.fromEntries(availableCombatTactics(actor, itemNamed(actor, 'Longsword')).map((t) => [t.key, t]));
		expect(byKey['heavy-strike'].rider).toContain(rider);
		expect(byKey['sweeping-strike'].cannotCrit).toBe(cannotCrit);
	});
});

describe('Combat Tactic resolved on the attack (activation lifecycle + DamageRoll patch)', () => {
	it('Heavy Strike on a hit: one Combat Die rolled into the damage, spent once the card exists, reported on a card', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 2 });
		// Primary 5 (hit, no crit), then the Combat Die rolls 6.
		const { roll } = await swing(env, m, actor, 'Longsword', { tactic: 'heavy-strike', faces: [5, 6] });
		expect(roll.total).toBe(11);
		expect(roll.formula).toContain('[Heavy Strike]');
		expect(combatDice(actor)).toBe(1);
		const card = cards(env).at(-1);
		expect(card.flavor).toContain('Heavy Strike');
		expect(card.content).toContain('+6');
		expect(card.content).toContain('1 of 3 left');
	});

	it('Heavy Strike on a miss: nothing rolled, nothing spent, and the card says so', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 2, features: ['Heavy Strike'] });
		const { roll } = await swing(env, m, actor, 'Longsword', { tactic: 'heavy-strike', faces: [1] });
		expect(roll.isMiss).toBe(true);
		expect(roll.formula).not.toContain('Heavy Strike');
		expect(combatDice(actor)).toBe(2);
		expect(cards(env).at(-1).content).toContain('no Combat Die spent');
	});

	it('an empty pool resolves the attack without the tactic', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 0 });
		const { roll } = await swing(env, m, actor, 'Longsword', { tactic: 'heavy-strike', faces: [5] });
		expect(roll.total).toBe(5);
		expect(combatDice(actor)).toBe(0);
		expect(cards(env).at(-1).content).toContain('No Combat Dice left');
	});

	it('Lunging Strike doubles one die (2 × face); it does not require a hit, so a miss spends it too', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 3 });
		const { roll } = await swing(env, m, actor, 'Longsword', { tactic: 'lunging-strike', faces: [4, 3] });
		expect(roll.total).toBe(4 + 6);
		expect(combatDice(actor)).toBe(2);
		expect(cards(env).at(-1).content).toContain('doubled');
		await swing(env, m, actor, 'Longsword', { tactic: 'lunging-strike', faces: [1, 3] });
		expect(combatDice(actor)).toBe(1);
		// The die was spent by the declared tactic, so Inerrant Strike is not offered on top.
		expect(env.dialogs.log.filter((d) => d.title === 'Inerrant Strike')).toHaveLength(0);
	});

	it('0.2 Sweeping Strike: a max primary die is not a crit, a 1 is not a miss', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 3 });
		const crit = (await swing(env, m, actor, 'Longsword', { tactic: 'sweeping-strike', faces: [8, 5] })).roll;
		expect(crit.isCritical).toBe(false);
		expect(crit.total).toBe(8);
		const one = (await swing(env, m, actor, 'Longsword', { tactic: 'sweeping-strike', faces: [1] })).roll;
		expect(one.isMiss).toBe(false);
		expect(combatDice(actor)).toBe(1);
	});

	it('2.0.3 Sweeping Strike keeps a natural crit', async () => {
		const { env, m } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await commander(env, { version: '2.0.3', features: ['Sweeping Strike'] });
		const { roll } = await swing(env, m, actor, 'Longsword', { tactic: 'sweeping-strike', faces: [8] });
		expect(roll.isCritical).toBe(true);
	});

	it('a cancelled activation (no card) spends nothing even though the roll was modified', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 2 });
		await swing(env, m, actor, 'Longsword', { tactic: 'heavy-strike', faces: [5, 6], card: false });
		expect(combatDice(actor)).toBe(2);
		expect(cards(env)).toHaveLength(0);
	});

	it('a tactic armed for another item is not applied', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 2 });
		const weapon = itemNamed(actor, 'Longsword');
		env.onActivate = async () => {
			m['classes/commander/tactics'].setTacticArm({ actorId: actor.id, itemId: 'someOtherItem000', key: 'heavy-strike' });
			return { id: 'card', rolls: [await rollDamage(env, '1d8', [5])] };
		};
		await weapon.activate({});
		expect(combatDice(actor)).toBe(2);
	});

	it('one tactic per activation, however many damage rolls it makes', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 3 });
		env.dice.push(5, 6, 5, 6);
		const { rolls } = await swing(env, m, actor, 'Longsword', { tactic: 'heavy-strike', rolls: 2 });
		expect(rolls[0].formula).toContain('Heavy Strike');
		expect(rolls[1].formula).not.toContain('Heavy Strike');
		expect(combatDice(actor)).toBe(2);
	});

	it('automation off: the attack rolls plain and nothing is spent', async () => {
		const { env, m } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await commander(env, { current: 2 });
		const { roll } = await swing(env, m, actor, 'Longsword', { tactic: 'heavy-strike', faces: [5, 6] });
		expect(roll.total).toBe(5);
		expect(combatDice(actor)).toBe(2);
	});
});

describe('Inerrant Strike on a miss', () => {
	it('declined: the miss stands and nothing is spent', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 2 });
		env.dialogs.answerWhen('Inerrant Strike', false);
		const { roll } = await swing(env, m, actor, 'Longsword', { faces: [1] });
		expect(env.dialogs.pending()).toBe(0);
		expect(roll.isMiss).toBe(true);
		expect(combatDice(actor)).toBe(2);
	});

	it('accepted: rerolled, primary +1, Combat Die added, spent and reported', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 2 });
		env.dialogs.answerWhen('Inerrant Strike', true);
		// Miss (1) → reroll 4 → raised to 5; Combat Die 3.
		const { roll } = await swing(env, m, actor, 'Longsword', { faces: [1, 4, 3] });
		expect(roll.isMiss).toBe(false);
		expect(roll.primaryDie.results.find((r) => r.active).result).toBe(5);
		expect(roll.total).toBe(8);
		expect(combatDice(actor)).toBe(1);
		expect(cards(env).at(-1).content).toMatch(/Primary Die <strong>4<\/strong> \+ 1 → <strong>5<\/strong>/);
	});

	it('a reroll raised into the max face is a crit and explodes', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 2 });
		env.dialogs.answerWhen('Inerrant Strike', true);
		// Miss → reroll 7 → raised 8 (crit) → explosion 2 → Combat Die 3.
		const { roll } = await swing(env, m, actor, 'Longsword', { faces: [1, 7, 2, 3] });
		expect(roll.isCritical).toBe(true);
		expect(roll.total).toBe(8 + 2 + 3);
	});

	it('also claims the die a missed Heavy Strike left unspent', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { current: 1 });
		env.dialogs.answerWhen('Inerrant Strike', true);
		await swing(env, m, actor, 'Longsword', { tactic: 'heavy-strike', faces: [1, 4, 3] });
		expect(combatDice(actor)).toBe(0);
	});

	it('not offered without the tactic, with an empty pool, or off a weapon', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const without = await commander(env, { current: 2, features: ['Heavy Strike'] });
		await swing(env, m, without, 'Longsword', { faces: [1] });
		const empty = await commander(env, { current: 0 });
		await swing(env, m, empty, 'Longsword', { faces: [1] });
		expect(env.dialogs.log.filter((d) => d.title === 'Inerrant Strike')).toHaveLength(0);
	});
});

describe('Master Commander (2.0.3): Initiative regain, lost if unspent', () => {
	async function mc(env, { withMC = true, uses = 1, max = 3 } = {}) {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version: '2.0.3', picks: [] });
		if (!withMC) await actor.deleteEmbeddedDocuments('Item', [itemNamed(actor, 'Master Commander').id]);
		setPool(env, itemNamed(actor, 'Coordinated Strike!'), 'chargePools', 'coordinated-strike-uses', { identifier: 'coordinated-strike-uses', label: 'Coordinated Strike uses', current: uses, max, hidden: false });
		setPool(env, itemNamed(actor, 'Coordinated Strike!'), 'chargePools', 'coordinated-strike-round', { identifier: 'coordinated-strike-round', current: 1, max: 1, hidden: true });
		return actor;
	}
	const usesRule = (actor) => itemNamed(actor, 'Coordinated Strike!').rules.get('coordinated-strike-uses-pool');
	const usesNow = (actor) => itemNamed(actor, 'Coordinated Strike!').flags.nimble.chargePools['coordinated-strike-uses'].current;

	it('adds an onInitiativeRolled add-1 recovery to the visible uses pool only', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await mc(env);
		const cs = itemNamed(actor, 'Coordinated Strike!');
		expect(usesRule(actor).recoveries).toContainEqual({ trigger: 'onInitiativeRolled', mode: 'add', value: '1' });
		for (const id of ['coordinated-strike-round-pool', 'coordinated-strike-encounter-pool']) {
			expect(cs.rules.get(id).recoveries.some((r) => r.trigger === 'onInitiativeRolled')).toBe(false);
		}
	});

	it('nothing without Master Commander on the sheet', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await mc(env, { withMC: false });
		expect(usesRule(actor).recoveries.some((r) => r.trigger === 'onInitiativeRolled')).toBe(false);
	});

	it.fails('BUG-class-automation-2: the uses pool regains at most one use per encounter (the system Master Commander already ships an encounterStart add-1)', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await mc(env);
		const PER_ENCOUNTER = new Set(['onInitiativeRolled', 'encounterStart']);
		const regains = [...usesRule(actor).recoveries.filter((r) => PER_ENCOUNTER.has(r.trigger) && r.mode === 'add')];
		for (const item of actor.items) {
			for (const rule of item.rules.values()) {
				if (rule.type !== 'modifyPool' || rule.poolIdentifier !== 'coordinated-strike-uses' || !rule.appliesTo()) continue;
				regains.push(...(rule.addRefills ?? []).filter((r) => PER_ENCOUNTER.has(r.trigger) && r.mode === 'add'));
			}
		}
		expect(regains).toHaveLength(1);
	});

	it('a regained use is taken back at combat end when it was not spent', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await mc(env, { uses: 2 });
		env.Hooks.callAll('nimble.chargePool.recovered', {
			trigger: 'onInitiativeRolled',
			actor,
			recovery: [{ poolId: 'coordinated-strike-uses', recoveredAmount: 1, newValue: 2 }],
		});
		await env.flush();
		expect(actor.getFlag(MODULE_ID, 'coordinatedStrikeTempUse')).toBe(2);
		env.Hooks.callAll('deleteCombat', { combatants: [] });
		await env.flush();
		expect(usesNow(actor)).toBe(1);
		expect(actor.getFlag(MODULE_ID, 'coordinatedStrikeTempUse')).toBeUndefined();
		// The module-performed spend is on a visible (correctable) pool.
		expect(itemNamed(actor, 'Coordinated Strike!').flags.nimble.chargePools['coordinated-strike-uses'].hidden).toBe(false);
	});

	it('a use spent during the fight is the regained one: nothing is taken back', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await mc(env, { uses: 1 });
		await actor.setFlag(MODULE_ID, 'coordinatedStrikeTempUse', 2);
		env.Hooks.callAll('deleteCombat', { combatants: [] });
		await env.flush();
		expect(usesNow(actor)).toBe(1);
	});

	it('a player client never expires the use (GM only), and a recovery that moved nothing is not noted', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await mc(env, { uses: 3 });
		env.Hooks.callAll('nimble.chargePool.recovered', {
			trigger: 'onInitiativeRolled',
			actor,
			recovery: [{ poolId: 'coordinated-strike-uses', recoveredAmount: 0, newValue: 3 }],
		});
		await env.flush();
		expect(actor.getFlag(MODULE_ID, 'coordinatedStrikeTempUse')).toBeUndefined();
		await actor.setFlag(MODULE_ID, 'coordinatedStrikeTempUse', 3);
		env.setUser({ isGM: false });
		env.Hooks.callAll('deleteCombat', { combatants: [] });
		await env.flush();
		expect(usesNow(actor)).toBe(3);
	});
});

describe('Coordinated Strike! under 0.2: no Initiative regain, encounter use spent before the Safe Rest pool', () => {
	it.each([5, 9, 17])('level %i: no onInitiativeRolled recovery anywhere on the item', async (level) => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'commander', level, { version: '0.2' });
		const cs = itemNamed(actor, 'Coordinated Strike!');
		expect(cs.getFlag(MODULE_ID, 'playtest02')).toBe(true);
		for (const rule of cs.rules.values()) {
			expect((rule.recoveries ?? []).some((r) => r.trigger === 'onInitiativeRolled')).toBe(false);
		}
		for (const item of actor.items) {
			for (const rule of item.rules.values()) {
				expect((rule.addRefills ?? []).some((r) => r.trigger === 'onInitiativeRolled')).toBe(false);
			}
		}
	});

	it('the Initiative note never fires for a 0.2 Coordinated Strike', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version: '0.2' });
		const cs = itemNamed(actor, 'Coordinated Strike!');
		setPool(env, cs, 'chargePools', 'coordinated-strike-uses', { identifier: 'coordinated-strike-uses', current: 1, max: 3 });
		env.Hooks.callAll('nimble.chargePool.recovered', { trigger: 'encounterStart', actor, recovery: [{ poolId: 'coordinated-strike-encounter', recoveredAmount: 1, newValue: 1 }] });
		await env.flush();
		expect(actor.getFlag(MODULE_ID, 'coordinatedStrikeTempUse')).toBeUndefined();
	});

	const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
	it.each(LEVELS)('level %i: exactly one pool pays for a use, the encounter one first', async (level) => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'commander', level, { version: '0.2' });
		const cs = itemNamed(actor, 'Coordinated Strike!');
		const payers = (encounter) => {
			setPool(env, cs, 'chargePools', 'coordinated-strike-encounter', { identifier: 'coordinated-strike-encounter', current: encounter, max: 1 });
			return [...cs.rules.values()]
				.filter((r) => r.type === 'chargeConsumer' && r.poolIdentifier !== 'coordinated-strike-round' && testPredicate(r.predicate, cs))
				.map((r) => r.poolIdentifier);
		};
		expect(payers(1)).toEqual(['coordinated-strike-encounter']);
		// Encounter use gone: from level 5 the Safe Rest pool pays; before that the
		// (empty) encounter pool still gates it, so the use is refused.
		expect(payers(0)).toEqual([level >= 5 ? 'coordinated-strike-uses' : 'coordinated-strike-encounter']);
		// The uses pool exists only from level 5.
		expect(testPredicate(cs.rules.get('coordinated-strike-uses-pool').predicate, cs)).toBe(level >= 5);
	});
});

describe('Single-minded Fighter foregoes Commander\'s Orders', () => {
	it('refuses an Order created on the sheet, allows other features, and tells the user', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await makeCharacter(env, { classId: 'commander', level: 4, version: '0.2', features: ['Single-minded Fighter'] });
		const [order] = await actor.createEmbeddedDocuments('Item', [rawItem('Face Me!', 'feature', { group: 'commanders-orders' })]);
		expect(order).toBeUndefined();
		expect(env.notifications.messages('info').join()).toContain('foregone commanders orders');
		const [other] = await actor.createEmbeddedDocuments('Item', [rawItem('Heavy Strike', 'feature', { group: 'combat-tactics' })]);
		expect(other?.name).toBe('Heavy Strike');
	});

	it('with automation off, an Order is created normally', async () => {
		const { env } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await makeCharacter(env, { classId: 'commander', level: 4, version: '0.2', features: ['Single-minded Fighter'] });
		const [order] = await actor.createEmbeddedDocuments('Item', [rawItem('Face Me!', 'feature', { group: 'commanders-orders' })]);
		expect(order?.name).toBe('Face Me!');
	});

	it.each([
		[true, 0],
		[false, 2],
	])('gaining it offers to remove the Orders already owned (answer %s → %i left)', async (answer, left) => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await makeCharacter(env, { classId: 'commander', level: 4, version: '0.2', features: ['Face Me!', 'Reposition!'] });
		env.dialogs.answerWhen('Single-minded Fighter', answer);
		await actor.createEmbeddedDocuments('Item', [rawItem('Single-minded Fighter', 'feature', { group: 'champion-of-the-arena' }, { flags: { [MODULE_ID]: { foregoesFeatureGroup: 'commanders-orders' } } })]);
		await env.flush();
		expect(env.dialogs.pending()).toBe(0);
		expect(actor.items.filter((i) => i.system.group === 'commanders-orders')).toHaveLength(left);
	});

	it.fails('BUG-class-automation-3: on a 2.0.3 Commander the removal offer leaves Coordinated Strike! (a granted feature, not a chosen Order) alone', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await buildCharacterAtLevel(env, 'commander', 2, { version: '2.0.3', picks: ['Face Me!', 'Reposition!'] });
		expect(itemNamed(actor, 'Coordinated Strike!').system.group).toBe('commanders-orders');
		env.dialogs.answerWhen('Single-minded Fighter', true);
		await actor.createEmbeddedDocuments('Item', [rawItem('Single-minded Fighter', 'feature', { group: 'champion-of-the-arena' }, { flags: { [MODULE_ID]: { foregoesFeatureGroup: 'commanders-orders' } } })]);
		await env.flush();
		expect(actor.items.some((i) => i.name === 'Coordinated Strike!')).toBe(true);
	});
});

describe('owed Combat Tactic prompt (Seasoned Combatant)', () => {
	const LEVELUP = [...SCRIPTS, 'scripts/core/supersede.mjs', 'scripts/classes/commander/tactic-levelup.mjs'];
	afterEach(() => {
		delete globalThis.document;
	});

	async function pit(env, level, version) {
		return buildCharacterAtLevel(env, 'commander', level, { version, subclass: 'Champion of the Pit', picks: ['Heavy Strike'] });
	}

	it.each([
		['0.2', true],
		['2.0.3', false],
	])('%s: offered once, grants the chosen tactic stamped as ours, no duplicates or retired tactics on offer', async (version, playtest) => {
		const { env } = await world({ scripts: LEVELUP, playtest });
		installDocumentStub();
		const actor = await pit(env, 7, version);
		expect(itemNamed(actor, 'Seasoned Combatant').getFlag(MODULE_ID, 'grantsCombatTactic')).toBe(true);
		let offered = [];
		env.dialogs.answerWhen(/Choose a Combat Tactic/, (config) => {
			offered = [...config.content.matchAll(/value="([^"]+)"/g)].map((mm) => mm[1]);
			return offered.find((uuid) => uuid.includes('nim-plus') === playtest && !/Heavy/.test(uuid)) ?? offered[0];
		});
		env.Hooks.callAll('renderPlayerCharacterSheet', { document: actor });
		await env.flush();
		expect(env.dialogs.pending()).toBe(0);
		const names = [...(await Promise.all(offered.map((u) => fromUuid(u))))].map((d) => d.name);
		expect(new Set(names).size).toBe(names.length);
		expect(names).not.toContain('Heavy Strike');
		if (playtest) expect(names).not.toContain('Commanding Presence');
		const granted = actor.items.filter((i) => i.getFlag(MODULE_ID, 'fromCombatTacticGrant') === true);
		expect(granted).toHaveLength(1);
		expect(granted[0].sourceId).toBeTruthy();
		// Re-render: nothing more is owed.
		env.Hooks.callAll('renderPlayerCharacterSheet', { document: actor });
		await env.flush();
		expect(env.dialogs.log.filter((d) => /Choose a Combat Tactic/.test(d.title))).toHaveLength(1);
	});

	it('nothing is owed below the feature level', async () => {
		const { env } = await world({ scripts: LEVELUP });
		installDocumentStub();
		const actor = await makeCharacter(env, { classId: 'commander', level: 6, version: '0.2', items: [rawItem('Seasoned Combatant', 'feature', { gainedAtLevels: [7] }, { flags: { [MODULE_ID]: { grantsCombatTactic: true } } })] });
		env.Hooks.callAll('renderPlayerCharacterSheet', { document: actor });
		await env.flush();
		expect(env.dialogs.log).toHaveLength(0);
	});
});

describe('Commanding Presence (2.0.3 Combat Tactic) costs a Combat Die', () => {
	it.fails('BUG-class-automation-6: the 2.0.3 system copy is metered against the Combat Dice pool (blocked at 0, spends 1)', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await commander(env, { version: '2.0.3', features: ['Commanding Presence'], current: 0 });
		const cp = itemNamed(actor, 'Commanding Presence');
		expect(cp.system.group).toBe('combat-tactics');
		const consumers = [...cp.rules.values()].filter((r) => r.type === 'chargeConsumer' && r.poolIdentifier === 'combat-dice');
		expect(consumers).toHaveLength(1);
	});

	it('the 0.2 copy is an Order and needs no Combat Die', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await commander(env, { features: ['Commanding Presence'] });
		const cp = itemNamed(actor, 'Commanding Presence');
		expect(cp.system.group).toBe('commanders-orders');
		expect([...cp.rules.values()].some((r) => r.poolIdentifier === 'combat-dice')).toBe(false);
	});
});

describe('Single-minded Fighter removal offer: one prompt, on the creating client', () => {
	it.fails('BUG-class-automation-7: a GM client does not also prompt when a player creates the feature', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await makeCharacter(env, { classId: 'commander', level: 4, version: '0.2', features: ['Face Me!'] });
		const smf = new env.classes.Item(
			rawItem('Single-minded Fighter', 'feature', { group: 'champion-of-the-arena' }, { flags: { [MODULE_ID]: { foregoesFeatureGroup: 'commanders-orders' } } }),
			{ parent: actor },
		);
		actor.items.set(smf.id, smf);
		// createItem fires on every connected client; this one (the GM) did not create it.
		env.Hooks.callAll('createItem', smf, {}, env.users.player.id);
		await env.flush();
		expect(env.dialogs.log).toHaveLength(0);
	});
});
