/**
 * The Shadowmancer casting cap: `system.resources.highestUnlockedSpellTier`
 * as scripts/classes/shadowmancer/spell-tiers.mjs overrides it.
 *
 * Rules text (both printings agree on the ladder):
 *   Heroes 2.0.3 (Heroes-2.0.3-1stPrinting.txt) and Shadowmancer 0.2 (Shadowmancer-0.2.txt):
 *     "LEVEL 2     Master of Darkness. … Necrotic cantrips and tier 1 …"
 *     "LEVEL 5     Tier 2 Spells. You may now cast tier 2 spells; all of your spells are cast at this tier."
 *     "LEVEL 7     … Tier 3 Spells. You may now cast tier 3 spells; all of your spells are cast at this tier."
 *     "LEVEL 10 Tier 4 Spells. You may now cast tier 4 spells; all of your spells are cast at this tier."
 *     "LEVEL 13 Tier 5 Spells. You may now cast tier 5 spells; all of your spells are cast at this tier."
 *     "LEVEL 16 Tier 6 Spells. You may now cast tier 6 spells; all of your spells are cast at this tier."
 *     "LEVEL 19 … Tier 7 Spells. You may now cast tier 7 spells; all of your spells are cast at this tier."
 *   Pilfered Power (0.2): "You can steal power from your patron to cast tiered spells (DEX times
 *     before they notice)." — the class's mana formula `(max(@dexterity, 0))`.
 *
 * The system (character.ts) assigns `highestUnlockedSpellTier ??= …` from the
 * generic ladder [1,4,6,8,10,12,14,16,18] only for a caster (mana.max > 0) and
 * never over a stored value; the module re-assigns after it, for mana > 0 only,
 * ignoring the stored value, and only while `enableClassAutomation` is on.
 */
import { describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, findDoc, MODULE_ID } from '../harness/index.mjs';
import { ladderTier } from './grant-port.mjs';
import { arrange, casterWorld, evalManaFormula } from './world.mjs';

const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const GENERIC = (L) => [1, 4, 6, 8, 10, 12, 14, 16, 18].filter((l) => L >= l).length;
/** Expected ladder, written out from the table above (not derived from the code under test). */
const LADDER = { 1: 0, 2: 1, 3: 1, 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4, 11: 4, 12: 4, 13: 5, 14: 5, 15: 5, 16: 6, 17: 6, 18: 6, 19: 7, 20: 7 };
const VERSIONS = [
	['2.0.3', false],
	['0.2', true],
];

async function shadowmancer(env, version, level, arrangeOpts) {
	const actor = await buildCharacterAtLevel(env, 'shadowmancer', level, { version });
	return arrange(actor, arrangeOpts);
}

describe('ladder oracle', () => {
	it('the written-out table matches the ladder helper and tops out at 7', () => {
		for (const L of LEVELS) expect(ladderTier(L)).toBe(LADDER[L]);
		expect(Math.max(...Object.values(LADDER))).toBe(7);
	});

	it('Pilfered Power is the class mana: DEX, never negative, same class doc in both versions', () => {
		const { doc } = findDoc({ pack: 'nimble.nimble-classes', type: 'class', where: (d) => d.system?.identifier === 'shadowmancer' });
		expect(doc.system.mana.formula.replace(/\s/g, '')).toBe('(max(@dexterity,0))');
		expect(doc.system.mana.recovery).toBe('safeRest');
		expect(evalManaFormula(doc.system.mana.formula, { dexterity: { mod: 4 } })).toBe(4);
		expect(evalManaFormula(doc.system.mana.formula, { dexterity: { mod: -2 } })).toBe(0);
	});
});

describe.each(VERSIONS)('highestUnlockedSpellTier — %s (playtest %s)', (version, playtest) => {
	describe('automation on', () => {
		it.each(LEVELS)('L%i with DEX 3: the Shadowmancer ladder (mana > 0 from L2)', async (L) => {
			const { env } = await casterWorld({ playtest });
			const actor = await shadowmancer(env, version, L, { dex: 3 });
			expect(actor.system.resources.mana.max).toBe(L === 1 ? 0 : 3);
			// L1: no mana → the module leaves it to the system, which says "not a caster" (null).
			expect(actor.system.resources.highestUnlockedSpellTier).toBe(L === 1 ? null : LADDER[L]);
		});

		it.each(LEVELS)('L%i: a stored (manual) cap of 9 is ignored and never rewritten', async (L) => {
			const { env } = await casterWorld({ playtest });
			const actor = await shadowmancer(env, version, L, { dex: 3, stored: 9 });
			expect(actor.system.resources.highestUnlockedSpellTier).toBe(L === 1 ? 9 : LADDER[L]);
			expect(actor._source.system.resources.highestUnlockedSpellTier).toBe(9);
			expect(actor.callsOf('update')).toEqual([]);
		});

		it.each([2, 5, 10, 19, 20])('L%i with DEX 0 (no Pilfered Power): left to the system', async (L) => {
			const { env } = await casterWorld({ playtest });
			const none = await shadowmancer(env, version, L, { dex: 0 });
			expect(none.system.resources.mana.max).toBe(0);
			expect(none.system.resources.highestUnlockedSpellTier).toBeNull();
			const stored = await shadowmancer(env, version, L, { dex: -1, stored: 4 });
			expect(stored.system.resources.highestUnlockedSpellTier).toBe(4);
		});

		it('never above 7, and tier 2 is first reached at L5 (not L4)', async () => {
			const { env } = await casterWorld({ playtest });
			const caps = [];
			for (const L of LEVELS) caps.push((await shadowmancer(env, version, L, { dex: 2 })).system.resources.highestUnlockedSpellTier ?? 0);
			expect(Math.max(...caps)).toBe(7);
			expect(caps[3]).toBe(1);
			expect(caps[4]).toBe(2);
			expect(caps.findIndex((c) => c === 2) + 1).toBe(5);
		});

		it('turning the setting off at runtime restores the system value on the next preparation', async () => {
			const { env } = await casterWorld({ playtest });
			const actor = await shadowmancer(env, version, 4, { dex: 3 });
			expect(actor.system.resources.highestUnlockedSpellTier).toBe(1);
			await env.game.settings.set(MODULE_ID, 'enableClassAutomation', false);
			actor.prepareData();
			expect(actor.system.resources.highestUnlockedSpellTier).toBe(2);
		});
	});

	describe('automation off → system behaviour', () => {
		it.each(LEVELS)('L%i: the generic caster ladder', async (L) => {
			const { env } = await casterWorld({ playtest, automation: false });
			const actor = await shadowmancer(env, version, L, { dex: 3 });
			expect(actor.system.resources.highestUnlockedSpellTier).toBe(L === 1 ? null : GENERIC(L));
		});

		it.each([1, 4, 20])('L%i: a stored cap wins, as in the system', async (L) => {
			const { env } = await casterWorld({ playtest, automation: false });
			const actor = await shadowmancer(env, version, L, { dex: 3, stored: 3 });
			expect(actor.system.resources.highestUnlockedSpellTier).toBe(3);
		});
	});

	it('other casters keep the generic ladder with automation on', async () => {
		const { env } = await casterWorld({ playtest });
		const mage = arrange(await buildCharacterAtLevel(env, 'mage', 4, { version }), { dex: 3, baseMax: 3 });
		expect(mage.system.resources.highestUnlockedSpellTier).toBe(GENERIC(4));
	});
});
