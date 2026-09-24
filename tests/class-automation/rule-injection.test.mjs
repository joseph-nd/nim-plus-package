/**
 * scripts/classes/rule-injection.mjs and the ensure* injectors it drives:
 * matched by name/identifier (so Nim+ 0.2 copies with new ids are recognised),
 * stepping aside when the content already carries the rule, gated by the
 * automation setting, idempotent across re-preparation.
 */
import { describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, makeCharacter, MODULE_ID, setPool } from '../harness/index.mjs';
import { itemNamed, rawItem, synthetic, world } from './_mocks.mjs';

const SCRIPTS = ['scripts/classes/rule-injection.mjs', 'scripts/classes/commander/master-commander.mjs'];

const rulesOf = (item) => [...item.rules.values()];
const poolRule = (item, identifier) => rulesOf(item).find((r) => r.type === 'chargePool' && r.identifier === identifier);

describe('rule injection wiring', () => {
	it('patches the feature and ancestry prototypes at init, once', async () => {
		const { env, m } = await world({ scripts: SCRIPTS, boot: 'init' });
		const proto = env.classes.Item.prototype;
		expect(proto.__nimPlusRulesPatched).toBe(true);
		expect(proto.__nimPlusAncestryRulesPatched).toBe(true);
		// Idempotent: a second call reports "already patched".
		expect(m['classes/rule-injection'].patchFeatureRulePreparation()).toBe(false);
		expect(m['classes/rule-injection'].patchAncestryRulePreparation()).toBe(false);
	});

	it('does not inject anything with class automation switched off', async () => {
		const { env } = await world({ scripts: SCRIPTS, automation: false });
		const actor = await buildCharacterAtLevel(env, 'commander', 4, { version: '2.0.3', picks: ['Coordinated Strike!'] });
		for (const item of actor.items) expect(synthetic(item)).toEqual([]);
		const ffab = itemNamed(actor, 'Fit for Any Battlefield');
		expect(poolRule(ffab, 'combat-dice').recoveries.some((r) => r.trigger === 'encounterEnd')).toBe(false);
	});

	it('reprepareInjectedRules re-runs preparation only for character feature/ancestry items', async () => {
		const { env, m } = await world({ scripts: SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'commander', 4, { version: '2.0.3' });
		const npc = await makeCharacter(env, { items: [rawItem('Coordinated Strike!')] });
		npc._source.type = 'npc';
		npc.prepareData();
		for (const item of [...actor.items, ...npc.items]) item.initialized = true;
		m['classes/rule-injection'].reprepareInjectedRules();
		// The mock re-marks every prepared item initialized; a feature that was
		// re-prepared has a fresh rules map instance.
		expect(actor.items.filter((i) => i.type === 'feature').every((i) => i.initialized === true)).toBe(true);
		expect(env.Hooks.errors).toEqual([]);
	});
});

describe('Coordinated Strike! counter', () => {
	it('slugifies "Coordinated Strike!" to the identifier the injector matches', async () => {
		const { m } = await world({ scripts: [...SCRIPTS, 'scripts/classes/commander/coordinated-strike.mjs'] });
		expect('Coordinated Strike!'.slugify({ strict: true })).toBe(m['classes/commander/coordinated-strike'].COORDINATED_STRIKE_IDENTIFIER);
	});

	it('supplies an INT/Safe Rest pool + consumer to a legacy copy with no rules', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await makeCharacter(env, { classId: 'commander', level: 3, items: [rawItem('Coordinated Strike!')] });
		const cs = itemNamed(actor, 'Coordinated Strike!');
		const ids = synthetic(cs).map((r) => r.id).sort();
		expect(ids).toEqual(['nimPlusCoordStrikePool', 'nimPlusCoordStrikeUse']);
		const pool = cs.rules.get('nimPlusCoordStrikePool');
		expect(pool).toMatchObject({ type: 'chargePool', max: '@intelligence', scope: 'item' });
		expect(pool.recoveries).toEqual([{ trigger: 'safeRest', mode: 'refresh', value: '1' }]);
	});

	it.each([
		['2.0.3', 'system copy (already metered)'],
		['0.2', 'Nim+ 0.2 copy (native pools)'],
	])('leaves the %s %s alone', async (version) => {
		const { env } = await world({ scripts: SCRIPTS, playtest: version === '0.2' });
		const opts = version === '0.2' ? {} : { picks: ['Coordinated Strike!'] };
		const actor = await buildCharacterAtLevel(env, 'commander', 3, { version, ...opts });
		const cs = itemNamed(actor, 'Coordinated Strike!');
		expect(synthetic(cs)).toEqual([]);
		if (version === '0.2') expect(cs.getFlag(MODULE_ID, 'playtest02')).toBe(true);
	});

	it('is idempotent across repeated preparation', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await makeCharacter(env, { classId: 'commander', level: 3, items: [rawItem('Coordinated Strike!')] });
		const cs = itemNamed(actor, 'Coordinated Strike!');
		cs.prepareData();
		cs.prepareData();
		expect(rulesOf(cs).filter((r) => r.type === 'chargePool')).toHaveLength(1);
	});
});

describe('Combat Dice: encounter-end discard', () => {
	it('adds one encounterEnd set-0 recovery to the 2.0.3 pool', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await buildCharacterAtLevel(env, 'commander', 4, { version: '2.0.3' });
		const pool = poolRule(itemNamed(actor, 'Fit for Any Battlefield'), 'combat-dice');
		expect(pool.recoveries.filter((r) => r.trigger === 'encounterEnd')).toEqual([{ trigger: 'encounterEnd', mode: 'set', value: '0' }]);
		// The Initiative refill the content ships is kept.
		expect(pool.recoveries.some((r) => r.trigger === 'onInitiativeRolled')).toBe(true);
	});

	it('does not add a second one to the 0.2 copy, which ships its own', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'commander', 2, { version: '0.2' });
		const ffab = itemNamed(actor, 'Fit for Any Battlefield');
		ffab.prepareData();
		expect(poolRule(ffab, 'combat-dice').recoveries.filter((r) => r.trigger === 'encounterEnd')).toHaveLength(1);
	});

	it('never mutates the stored rule source', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await buildCharacterAtLevel(env, 'commander', 4, { version: '2.0.3' });
		const ffab = itemNamed(actor, 'Fit for Any Battlefield');
		const stored = ffab._source.system.rules.find((r) => r.identifier === 'combat-dice');
		expect(stored.recoveries.some((r) => r.trigger === 'encounterEnd')).toBe(false);
	});
});

describe('Combat Dice pool bonuses (Seasoned Combatant / Relentless Assault / Single-minded Fighter)', () => {
	it.each([
		['Seasoned Combatant', 1],
		['Relentless Assault', 1],
		['Single-minded Fighter', 6],
	])('a legacy %s copy with no rules gets %i synthetic modifyPool step(s)', async (name, count) => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await makeCharacter(env, { classId: 'commander', level: 16, items: [rawItem(name)] });
		const steps = synthetic(itemNamed(actor, name));
		expect(steps).toHaveLength(count);
		expect(steps.every((r) => r.type === 'modifyPool' && r.poolIdentifier === 'combat-dice')).toBe(true);
	});

	it.each(['Seasoned Combatant', 'Relentless Assault', 'Single-minded Fighter'])(
		'the pack copy of %s carries its own modifyPool, so nothing is added',
		async (name) => {
			const { env } = await world({ scripts: SCRIPTS, playtest: false });
			const actor = await makeCharacter(env, { classId: 'commander', level: 16, features: [name] });
			expect(synthetic(itemNamed(actor, name))).toEqual([]);
		},
	);
});

describe('Single-minded Fighter: first step moves to level 4 under 0.2', () => {
	it.each([
		[true, { level: { min: 4 } }],
		[false, {}],
	])('playtest=%s → first-step predicate %j', async (playtest, predicate) => {
		const { env } = await world({ scripts: SCRIPTS, playtest });
		const actor = await makeCharacter(env, { classId: 'commander', level: 3, features: ['Single-minded Fighter'] });
		const rule = itemNamed(actor, 'Single-minded Fighter').rules.get('single-minded-max-l2');
		expect(rule.predicate).toEqual(predicate);
		expect(rule.maxDelta).toBe('+2');
	});

	it('leaves the later steps (levels 6-16) untouched', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: true });
		const actor = await makeCharacter(env, { classId: 'commander', level: 3, features: ['Single-minded Fighter'] });
		const item = itemNamed(actor, 'Single-minded Fighter');
		expect(item.rules.get('single-minded-max-l6').predicate).toEqual({ level: { min: 6 } });
		expect(item.rules.size).toBe(6);
	});
});

describe('Radiant Judgement consumer', () => {
	it('2.0.3 system copy gets a melee-only autoBonus consumer', async () => {
		const { env, m } = await world({ scripts: [...SCRIPTS, 'scripts/classes/oathsworn/judgment-rules.mjs'], playtest: false });
		const actor = await buildCharacterAtLevel(env, 'oathsworn', 1, { version: '2.0.3' });
		const rj = itemNamed(actor, 'Radiant Judgement');
		const consumer = rj.rules.get('nimPlusJudgmentConsumer');
		expect(consumer).toMatchObject({ type: 'diceConsumer', mode: 'autoBonus', bonusOnAttackDelivery: 'melee', poolIdentifier: 'judgment' });
		const entry = { document: rj, key: 'judgment', scope: 'item', pool: { identifier: 'judgment' } };
		expect(m['classes/oathsworn/judgment-rules'].judgmentAppliesToAnyAttack(entry)).toBe(false);
	});

	it('0.2 Nim+ copy keeps its own "any" consumer and gets no synthetic one', async () => {
		const { env, m } = await world({ scripts: [...SCRIPTS, 'scripts/classes/oathsworn/judgment-rules.mjs'] });
		const actor = await buildCharacterAtLevel(env, 'oathsworn', 1, { version: '0.2' });
		const rj = itemNamed(actor, 'Radiant Judgement');
		expect(rj.getFlag(MODULE_ID, 'playtest02')).toBe(true);
		expect(synthetic(rj)).toEqual([]);
		const entry = { document: rj, key: 'judgment', scope: 'item', pool: { identifier: 'judgment' } };
		expect(m['classes/oathsworn/judgment-rules'].judgmentAppliesToAnyAttack(entry)).toBe(true);
	});

	it('Aura of Zeal (system copy, no rules) gets +1 Judgment die', async () => {
		const { env } = await world({ scripts: SCRIPTS, playtest: false });
		const actor = await makeCharacter(env, { classId: 'oathsworn', level: 7, features: ['Aura of Zeal'] });
		const rule = itemNamed(actor, 'Aura of Zeal').rules.get('nimPlusZealJudgmentDice');
		expect(rule).toMatchObject({ type: 'modifyPool', poolType: 'dice', poolIdentifier: 'judgment', maxDelta: '+1' });
	});
});

async function ready(env) {
	env.game.ready = true;
	await env.Hooks.callAllAsync('ready');
	await env.flush();
}

describe('stale charge-pool resync on ready', () => {
	/** State for every chargePool the system would track (predicate holds). */
	function syncedPools(env, actor) {
		for (const item of actor.items) {
			for (const rule of item.rules.values()) {
				if (rule.type !== 'chargePool' || !rule.appliesTo()) continue;
				setPool(env, item, 'chargePools', rule.identifier, { identifier: rule.identifier, label: rule.label, current: 0, max: 1, hidden: !!rule.hidden });
			}
		}
	}

	async function setup({ isGM = true, synced = false, version = '2.0.3', level = 4 } = {}) {
		const { env } = await world({ scripts: SCRIPTS, isGM, playtest: version === '0.2' });
		const actor = await buildCharacterAtLevel(env, 'commander', level, { version });
		if (synced) syncedPools(env, actor);
		return { env, actor };
	}

	it('GM nudges an actor whose declared pool has no stored state', async () => {
		const { env, actor } = await setup();
		await ready(env);
		expect(actor.getFlag(MODULE_ID, 'chargePoolResync')).toBe(1);
	});

	it('a player client never writes', async () => {
		const { env, actor } = await setup({ isGM: false });
		await ready(env);
		expect(actor.getFlag(MODULE_ID, 'chargePoolResync')).toBeUndefined();
	});

	it('writes nothing when every pool without a level gate has state (level 20: all apply)', async () => {
		const { env, actor } = await setup({ synced: true, level: 20 });
		await ready(env);
		expect(actor.getFlag(MODULE_ID, 'chargePoolResync')).toBeUndefined();
	});

	it.fails.each([
		['2.0.3', 4, 'Coordinated Strike encounter pool, level 18+'],
		['0.2', 3, 'Coordinated Strike uses pool, level 5+'],
	])(
		'BUG-class-automation-1: a %s level-%i Commander with every live pool synced is not rewritten on every load (%s is predicate-gated)',
		async (version, level) => {
			const { env, actor } = await setup({ synced: true, version, level });
			await ready(env);
			expect(actor.getFlag(MODULE_ID, 'chargePoolResync')).toBeUndefined();
		},
	);
});
