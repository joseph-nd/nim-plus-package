/**
 * Shadowmancer spell-tier ladder (same in 2.0.3 and 0.2: tiers at 2/5/7/10/13/16/19)
 * and the Cheat: Sneak Attack dice by level, 1/turn metering; Vicious Opportunist.
 */
import { describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, makeCharacter, MODULE_ID } from '../harness/index.mjs';
import { combat, itemNamed, meleeWeapon, rangedWeapon, rawItem, rollDamage, world } from './_mocks.mjs';

/* ───────────────────────── Shadowmancer ───────────────────────── */

const TIER_BY_LEVEL = [0, 1, 1, 1, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7];

describe('Shadowmancer spell tiers', () => {
	const SCRIPTS = ['scripts/classes/shadowmancer/spell-tiers.mjs'];

	it.each(TIER_BY_LEVEL.map((tier, i) => [i + 1, tier]))('shadowmancerHighestTier(%i) = %i', async (level, tier) => {
		const { m } = await world({ scripts: SCRIPTS });
		expect(m['classes/shadowmancer/spell-tiers'].shadowmancerHighestTier(level)).toBe(tier);
	});

	it.each([0, -3, 'x', null, 25])('degenerate level %j is safe', async (level) => {
		const { m } = await world({ scripts: SCRIPTS });
		expect(m['classes/shadowmancer/spell-tiers'].shadowmancerHighestTier(level)).toBe(level === 25 ? 7 : 0);
	});

	async function caster(env, { classId = 'shadowmancer', level = 4, mana = 3, generic = 2 } = {}) {
		const actor = await makeCharacter(env, { classId, level });
		actor._source.system.resources = { mana: { max: mana, current: mana }, highestUnlockedSpellTier: generic };
		actor.prepareData();
		return actor;
	}

	it.each([
		[true, 4, 1],
		[false, 4, 1],
		[true, 20, 7],
		[false, 19, 7],
		[true, 1, 0],
	])('playtest=%s level %i Shadowmancer → tier %i, overriding the generic cap', async (playtest, level, tier) => {
		const { env } = await world({ scripts: SCRIPTS, playtest });
		const actor = await caster(env, { level, generic: 9 });
		expect(actor.system.resources.highestUnlockedSpellTier).toBe(tier);
		// Derived only: the stored value is untouched.
		expect(actor._source.system.resources.highestUnlockedSpellTier).toBe(9);
	});

	it('left alone: other classes, no mana, automation off', async () => {
		const a = await world({ scripts: SCRIPTS });
		expect((await caster(a.env, { classId: 'mage', generic: 3 })).system.resources.highestUnlockedSpellTier).toBe(3);
		expect((await caster(a.env, { mana: 0, generic: 3 })).system.resources.highestUnlockedSpellTier).toBe(3);
		const b = await world({ scripts: SCRIPTS, automation: false });
		expect((await caster(b.env, { generic: 3 })).system.resources.highestUnlockedSpellTier).toBe(3);
	});

	it('the patch is installed once; ready re-prepares Shadowmancers', async () => {
		const { env } = await world({ scripts: SCRIPTS });
		expect(env.classes.Actor.prototype.__nimPlusShadowmancerTierPatched).toBe(true);
		const actor = await caster(env);
		let prepared = 0;
		const original = actor.prepareData.bind(actor);
		actor.prepareData = () => {
			prepared += 1;
			return original();
		};
		env.game.ready = true;
		await env.Hooks.callAllAsync('ready');
		expect(prepared).toBe(1);
	});
});

/* ───────────────────────── Cheat ───────────────────────── */

const CHEAT_SCRIPTS = [
	'scripts/classes/shared/activation.mjs',
	'scripts/classes/cheat/sneak-attack.mjs',
	'scripts/classes/cheat/vicious-opportunist.mjs',
	'scripts/classes/activation-lifecycle.mjs',
];

const SNEAK = [
	[1, '1d6'], [2, '1d6'], [3, '1d8'], [4, '1d8'], [6, '1d8'], [7, '2d8'], [8, '2d8'], [9, '2d10'], [10, '2d10'],
	[11, '2d12'], [14, '2d12'], [15, '2d20'], [16, '2d20'], [17, '3d20'], [20, '3d20'],
];

async function attack(env, actor, weapon, faces, { arm = null, card = true } = {}) {
	let roll;
	env.onActivate = async (item) => {
		if (arm) arm(item);
		roll = await rollDamage(env, '1d8', faces);
		return card ? { id: 'card', rolls: [roll] } : null;
	};
	await itemNamed(actor, weapon).activate({});
	await env.flush();
	return roll;
}

describe('Sneak Attack', () => {
	it.each(SNEAK)('level %i → %s (from the feature text)', async (level, formula) => {
		const { env } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'the-cheat', level, { version: '0.2', items: [meleeWeapon('Dagger')] });
		let offered = null;
		env.dialogs.answerWhen('Sneak Attack', (config) => {
			offered = /<code>([^<]+)<\/code>/.exec(config.content)?.[1];
			return false;
		});
		await attack(env, actor, 'Dagger', [8]);
		expect(offered).toBe(formula);
	});

	it.each(SNEAK)('level %i → %s (fallback table when the text has none)', async (level, formula) => {
		const { env } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await makeCharacter(env, { classId: 'the-cheat', level, items: [meleeWeapon('Dagger'), rawItem('Sneak Attack', 'feature', { description: '<p>(1/turn) When you crit, deal +1d6 damage.</p>' })] });
		let offered = null;
		env.dialogs.answerWhen('Sneak Attack', (config) => {
			offered = /<code>([^<]+)<\/code>/.exec(config.content)?.[1];
			return false;
		});
		await attack(env, actor, 'Dagger', [8]);
		expect(offered).toBe(formula);
	});

	it('accepted: dice land on the crit roll, a card announces it, the 1/turn marker is set', async () => {
		const { env } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'the-cheat', 3, { version: '0.2', items: [meleeWeapon('Dagger')] });
		const c = combat(env, { round: 2, turn: 1 });
		env.dialogs.answerWhen('Sneak Attack', true);
		const roll = await attack(env, actor, 'Dagger', [8, 5]);
		expect(roll.total).toBe(13);
		expect(roll.formula).toContain('[Sneak Attack]');
		expect(env.ChatMessage.created.at(-1).content).toContain('+5');
		expect(actor.getFlag(MODULE_ID, 'cheat.sneakUsedAt')).toBe(`${c.id}:2:1`);
		// Same turn: not offered again. Next turn: offered.
		await attack(env, actor, 'Dagger', [8]);
		expect(env.dialogs.log.filter((d) => d.title === 'Sneak Attack')).toHaveLength(1);
		c.turn = 2;
		await attack(env, actor, 'Dagger', [8]);
		expect(env.dialogs.log.filter((d) => d.title === 'Sneak Attack')).toHaveLength(2);
	});

	it('declined keeps the use; a non-crit or a cancelled attack offers nothing and marks nothing', async () => {
		const { env } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'the-cheat', 3, { version: '0.2', items: [meleeWeapon('Dagger')] });
		combat(env);
		env.dialogs.answerWhen('Sneak Attack', false);
		await attack(env, actor, 'Dagger', [8]);
		expect(actor.getFlag(MODULE_ID, 'cheat.sneakUsedAt')).toBeUndefined();
		await attack(env, actor, 'Dagger', [5]);
		env.dialogs.answerWhen('Sneak Attack', true);
		await attack(env, actor, 'Dagger', [8, 4], { card: false });
		expect(actor.getFlag(MODULE_ID, 'cheat.sneakUsedAt')).toBeUndefined();
		expect(env.dialogs.log.filter((d) => d.title === 'Sneak Attack')).toHaveLength(2);
	});

	it('deleteCombat clears the per-turn markers', async () => {
		const { env } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await buildCharacterAtLevel(env, 'the-cheat', 3, { version: '0.2' });
		await actor.setFlag(MODULE_ID, 'cheat.sneakUsedAt', 'x:1:1');
		await actor.setFlag(MODULE_ID, 'cheat.viciousUsedAt', 'x:1:1');
		env.Hooks.callAll('deleteCombat', { combatants: [{ actor }] });
		await env.flush();
		expect(actor.getFlag(MODULE_ID, 'cheat.sneakUsedAt')).toBeUndefined();
		expect(actor.getFlag(MODULE_ID, 'cheat.viciousUsedAt')).toBeUndefined();
	});
});

describe('Vicious Opportunist', () => {
	async function cheat(env) {
		return buildCharacterAtLevel(env, 'the-cheat', 1, { version: '0.2', items: [meleeWeapon('Dagger'), rangedWeapon('Sling')] });
	}
	const armVicious = (m) => (item) => m['classes/cheat/vicious-opportunist'].setViciousArm({ actorId: item.actor.id, itemId: item.id });

	it('eligible on melee weapons only', async () => {
		const { env, m } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await cheat(env);
		const { viciousEligible } = m['classes/cheat/vicious-opportunist'];
		expect(viciousEligible(actor, itemNamed(actor, 'Dagger'))).toBe(true);
		expect(viciousEligible(actor, itemNamed(actor, 'Sling'))).toBe(false);
	});

	it('a hit is raised to a crit (with explosion) and the 1/turn use is marked', async () => {
		const { env, m } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await cheat(env);
		combat(env);
		env.dialogs.answerWhen('Sneak Attack', false);
		// Primary 4 → raised to 8, explosion 3.
		const roll = await attack(env, actor, 'Dagger', [4, 3], { arm: armVicious(m) });
		expect(roll.isCritical).toBe(true);
		expect(roll.total).toBe(11);
		expect(actor.getFlag(MODULE_ID, 'cheat.viciousUsedAt')).toBeTruthy();
		expect(env.ChatMessage.created.at(-1).content).toContain('changed from <strong>4</strong> to <strong>8</strong>');
		// Sneak Attack is offered on the upgraded crit.
		expect(env.dialogs.log.some((d) => d.title === 'Sneak Attack')).toBe(true);
	});

	it.each([
		['a miss', [1]],
		['a natural crit', [8]],
	])('%s spends nothing', async (_label, faces) => {
		const { env, m } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await cheat(env);
		combat(env);
		await attack(env, actor, 'Dagger', faces, { arm: armVicious(m) });
		expect(actor.getFlag(MODULE_ID, 'cheat.viciousUsedAt')).toBeUndefined();
	});

	it('an armed ranged attack is not upgraded', async () => {
		const { env, m } = await world({ scripts: CHEAT_SCRIPTS });
		const actor = await cheat(env);
		const roll = await attack(env, actor, 'Sling', [4], { arm: armVicious(m) });
		expect(roll.isCritical).toBe(false);
	});
});
