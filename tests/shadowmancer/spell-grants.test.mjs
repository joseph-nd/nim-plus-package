/**
 * What a Shadowmancer LEARNS at each level, resolved by a port of the system's
 * own grant code (see ./grant-port.mjs for the cited source files) over the
 * real pack data, in both versions:
 *   2.0.3 = playtest setting off (system docs; Nim+ 0.2 copies hidden by scripts/core/supersede.mjs)
 *   0.2   = playtest setting on  (Nim+ copies; superseded/retired system docs hidden)
 *
 * Rules text asserted against:
 *   0.2  (Shadowmancer-0.2.txt)
 *     "LEVEL 1     Conduit of Shadow. Learn the Shadowmancer cantrips."
 *       — the cantrip page: "SHADOWMANCER ONLY, CANTRIP  Summon Shadow … Command Shadows … Shadow Blast"
 *     "LEVEL 2     Master of Darkness. Learn all Necrotic cantrips and tier 1 Necrotic spells."
 *     "LEVEL 5     Tier 2 Spells. You may now cast tier 2 spells; all of your spells are cast at this tier."
 *     (… tier 3 L7, tier 4 L10, tier 5 L13, tier 6 L16, tier 7 L19 — see spell-cap.test.mjs)
 *     "LEVEL 6     … Shadowmastery. Choose 1 Necrotic Utility Spell."
 *     "LEVEL 8     … Shadowmastery (2). Choose a 2nd Necrotic Utility Spell."
 *     "LEVEL 14 … Shadowmastery (3). You know all Necrotic Utility Spells."
 *     "LEVEL 3    Draconic Crimson Rite. Your Patron grants you knowledge of Fire spells."
 *     "LEVEL 3    Master of Nightfrost. Your Patron grants you knowledge of Ice spells."
 *   2.0.3 (Heroes-2.0.3-1stPrinting.txt)
 *     "LEVEL 1    Conduit of Shadow. Your Patron grants you knowledge of:"
 *       "Shadow Blast. (Necrotic cantrip) …"  "Summon Shadows. (Necrotic cantrip) …"
 *     "LEVEL 2     Master of Darkness. Your Patron grants you knowledge of Necrotic cantrips and tier 1 spells."
 *     "LEVEL 6     … Shadowmastery. Choose 1 Necrotic Utility Spell."
 *     "LEVEL 9 … Shadowmastery (2). Choose a 2nd Necrotic Utility Spell."   ← see the upstream note below
 *     "LEVEL 14 … Shadowmastery (3). You know all Necrotic Utility Spells."
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { findDocs, loadPackData, MODULE_ID } from '../harness/index.mjs';
import { buildSpellIndex, getSpellsFromIndex, ladderTier, SHADOWMANCER_LADDER, simulateShadowmancer } from './grant-port.mjs';
import { versionWorld } from './world.mjs';

const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const SUBCLASSES = {
	none: null,
	abyssal: 'Pact of the Abyssal Depths',
	dragon: 'Pact of the Red Dragon',
};
const SUB_SCHOOL = { abyssal: 'ice', dragon: 'fire' };

/* Expected, written out from the tables (names from the system spell packs). */
const CONDUIT = {
	'2.0.3': { names: ['Shadow Blast', 'Summon Shadow'], pkg: 'nimble' },
	'0.2': { names: ['Command Shadows', 'Shadow Blast', 'Summon Shadow'], pkg: MODULE_ID },
};
const NECROTIC = {
	2: ['Entice', 'Shadow Trap', 'Withering Touch'], // all necrotic cantrips + tier 1
	5: ['Dread Visage'],
	7: ['Vampiric Greed'],
	10: ['Greater Shadow'],
	13: ['Gangrenous Burst'],
	16: ['Unspeakable Word'],
	19: ['Creeping Death'],
};
/** Shadowmastery: the harness answers each "choose 1" with the first option (alphabetical). */
const UTILITY = { 6: ['False Face'], 8: ['Gravecraft'], 14: ['Thought Leech'] };
const SCHOOL = {
	ice: { 3: ['Frost Shield', 'Ice Lance', 'Snowblind'], 5: ['Shatter'], 7: ['Cryosleep'], 10: ['Rimeblades'], 13: ['Arctic Blast'] },
	fire: { 3: ['Flame Dart', "Heart's Fire", 'Ignite'], 5: ['Enchant Weapon'], 7: ['Flame Barrier'], 10: ['Pyroclasm'], 13: ['Fiery Embrace'], 19: ['Living Inferno'] },
};

function expectedAt(version, sub, L) {
	const names = [];
	if (L === 1) names.push(...CONDUIT[version].names);
	names.push(...(NECROTIC[L] ?? []), ...(UTILITY[L] ?? []));
	if (SUB_SCHOOL[sub]) names.push(...(SCHOOL[SUB_SCHOOL[sub]][L] ?? []));
	return names.sort();
}

/** Plain-data results, computed once per (version, subclass) in a world whose setting matches. */
const SIMS = {};
/** Index facts per version. */
const INDEX = {};

beforeAll(async () => {
	for (const version of ['2.0.3', '0.2']) {
		await versionWorld(version);
		const spellIndex = await buildSpellIndex();
		INDEX[version] = {
			necroticCantrips: getSpellsFromIndex(spellIndex, ['necrotic'], [0], { forClass: 'shadowmancer' }).map((s) => ({ name: s.name, uuid: s.uuid })),
			allNecroticForOthers: getSpellsFromIndex(spellIndex, ['necrotic'], [0], { forClass: 'mage' }).map((s) => s.name),
		};
		SIMS[version] = {};
		for (const [key, sub] of Object.entries(SUBCLASSES)) {
			const sim = await simulateShadowmancer({ version, subclass: sub, spellIndex });
			SIMS[version][key] = {
				byLevel: new Map(
					[...sim.byLevel].map(([L, r]) => [
						L,
						{
							learned: [...r.auto, ...r.picked].map(({ uuid, name, tier, school, isUtility }) => ({ uuid, name, tier, school, isUtility, level: L })),
							selections: r.selections.map((g) => ({ ruleId: g.ruleId, count: g.count, options: g.availableSpells.map((s) => s.name) })),
							schoolSelections: r.schoolSelections.length,
						},
					]),
				),
				features: sim.features.map((f) => ({ name: f.doc.name, uuid: f.uuid, level: f.level })),
			};
		}
	}
});

const learnedAt = (version, sub, L) => SIMS[version][sub].byLevel.get(L).learned;
const allLearned = (version, sub, upTo = 20) => LEVELS.filter((L) => L <= upTo).flatMap((L) => learnedAt(version, sub, L));
const names = (list) => list.map((s) => s.name).sort();

describe.each(['2.0.3', '0.2'])('Shadowmancer spell grants — %s', (version) => {
	describe.each(Object.keys(SUBCLASSES))('subclass: %s', (sub) => {
		it.each(LEVELS)('L%i: exactly the spells the table grants at this level', (L) => {
			expect(names(learnedAt(version, sub, L))).toEqual(expectedAt(version, sub, L));
		});

		it.each(LEVELS)('L%i: nothing known above the ladder cap', (L) => {
			const cap = ladderTier(L);
			for (const s of allLearned(version, sub, L)) expect(s.tier, `${s.name} (tier ${s.tier}) at L${L}`).toBeLessThanOrEqual(cap);
		});

		it('each tier first appears exactly on the ladder (tier 2 at L5, never L4), never above tier 7', () => {
			const first = new Map();
			for (const s of allLearned(version, sub)) if (s.tier > 0 && !first.has(s.tier)) first.set(s.tier, s.level);
			expect([...first.keys()].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
			for (const [tier, level] of first) expect(level, `tier ${tier}`).toBe(SHADOWMANCER_LADDER[tier - 1]);
			expect(allLearned(version, sub, 4).filter((s) => s.tier >= 2)).toEqual([]);
			expect(learnedAt(version, sub, 5).some((s) => s.tier === 2)).toBe(true);
		});

		it('cantrips at L1 come from Conduit of Shadow only, from the right side of the supersede', () => {
			const l1 = learnedAt(version, sub, 1);
			expect(names(l1)).toEqual(CONDUIT[version].names);
			for (const s of l1) {
				expect(s.tier).toBe(0);
				expect(s.uuid.startsWith(`Compendium.${CONDUIT[version].pkg}.`), s.uuid).toBe(true);
			}
		});

		it('nothing is learned twice — by uuid or by name — across L1-20', () => {
			const all = allLearned(version, sub);
			expect(new Set(all.map((s) => s.uuid)).size).toBe(all.length);
			expect(new Set(all.map((s) => s.name)).size).toBe(all.length);
		});

		it('only the Shadowmancer schools are ever learned', () => {
			const schools = new Set(allLearned(version, sub).map((s) => s.school));
			expect([...schools].sort()).toEqual(['necrotic', ...(SUB_SCHOOL[sub] ? [SUB_SCHOOL[sub]] : [])].sort());
		});

		it('Shadowmastery: one utility choice at L6 and L8 (exact level only), all the rest at L14', () => {
			const withChoices = LEVELS.filter((L) => SIMS[version][sub].byLevel.get(L).selections.length);
			expect(withChoices).toEqual([6, 8]);
			expect(SIMS[version][sub].byLevel.get(6).selections).toEqual([
				{ ruleId: 'shadowmastery-l6-necrotic', count: 1, options: ['False Face', 'Gravecraft', 'Thought Leech'] },
			]);
			expect(SIMS[version][sub].byLevel.get(8).selections[0].options).toEqual(['Gravecraft', 'Thought Leech']);
			const utility = allLearned(version, sub).filter((s) => s.isUtility);
			expect(utility.every((s) => s.school === 'necrotic' && s.tier === 0)).toBe(true);
			expect(names(utility)).toEqual(['False Face', 'Gravecraft', 'Thought Leech']);
			for (const L of LEVELS) expect(SIMS[version][sub].byLevel.get(L).schoolSelections).toBe(0);
		});

		if (SUB_SCHOOL[sub]) {
			it(`${sub}: the ${SUB_SCHOOL[sub]} grants ride the same ladder (from L3), capped at tier 7`, () => {
				const school = allLearned(version, sub).filter((s) => s.school === SUB_SCHOOL[sub]);
				for (const s of school) {
					expect(s.level, s.name).toBe(Math.max(3, s.tier === 0 ? 3 : SHADOWMANCER_LADDER[s.tier - 1]));
					expect(s.tier).toBeLessThanOrEqual(7);
				}
				// Every non-utility spell of the school at tier ≤ 7 is eventually known; nothing above.
				const pool = findDocs({ pack: 'nimble.nimble-spells', type: 'spell' })
					.map((e) => e.doc)
					.filter((d) => d.system.school === SUB_SCHOOL[sub] && !(d.system.properties?.selected ?? []).includes('utilitySpell'));
				expect(names(school)).toEqual(pool.filter((d) => d.system.tier <= 7).map((d) => d.name).sort());
				expect(pool.some((d) => d.system.tier > 7)).toBe(true); // tiers 8/9 exist and stay out
			});
		}
	});

	it('the spell index offers the Shadowmancer-only cantrips to the Shadowmancer only, one copy each', () => {
		const idx = INDEX[version];
		expect(names(idx.necroticCantrips)).toEqual([...CONDUIT[version].names, 'Entice', 'Withering Touch'].sort());
		for (const n of CONDUIT[version].names) expect(idx.allNecroticForOthers).not.toContain(n);
	});

	it('the class feature walk the simulator uses is the one each version shows', () => {
		const feats = SIMS[version].none.features;
		const pick = (n) => feats.filter((f) => f.name === n);
		expect(pick('Conduit of Shadow')).toHaveLength(1);
		expect(pick('Conduit of Shadow')[0].uuid.includes(MODULE_ID)).toBe(version === '0.2');
		for (const n of ['Master of Darkness', 'Pilfered Power', 'Shadowmastery']) {
			// No Nim+ copy exists: the system document is used in both versions — and must stay visible in 0.2.
			expect(pick(n), n).toHaveLength(1);
			expect(pick(n)[0].uuid.startsWith('Compendium.nimble.'), n).toBe(true);
		}
		expect(pick('Master of Darkness')[0].level).toBe(2);
		expect(pick('Pilfered Power')[0].level).toBe(2);
		expect(pick('Shadowmastery')[0].level).toBe(6);
	});
});

describe('upstream data note (not a Nim+ bug)', () => {
	it('system Shadowmastery (2) fires at L8 — matches 0.2 ("LEVEL 8 … Shadowmastery (2)"), while the 2.0.3 printing lists it at L9', () => {
		const doc = loadPackData().byUuid.get('Compendium.nimble.nimble-class-features.Item.6nAimxYeKDOthVnI');
		const l2 = doc.system.rules.find((r) => r.id === 'shadowmastery-l8');
		expect(l2.predicate.level.min).toBe(8);
		expect(doc.system.gainedAtLevels).toEqual([6, 8, 14]);
		// Nothing in Nim+ supersedes Shadowmastery, so with the setting off (2.0.3) the choice still comes at L8.
		expect(findDocs({ pack: `${MODULE_ID}.nim-plus-class-features`, name: 'Shadowmastery' })).toEqual([]);
	});
});
