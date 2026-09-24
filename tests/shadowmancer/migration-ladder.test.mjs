/**
 * A Shadowmancer built at each level with the spells the system's grant code
 * gives it (see spell-grants.test.mjs), migrated to the other version by the
 * class migration (scripts/core/class-migration), must end with the spell set
 * the target version grants at that level — right side of the supersede, no
 * duplicates, nothing above the ladder — and its next level-up (the system's
 * grant code, run on the migrated items) must neither re-teach a known spell
 * nor skip one.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { buildCharacterAtLevel, MODULE_ID, setupWorld, sourceOf } from '../harness/index.mjs';
import { buildSpellIndex, ladderTier, levelUpSpellGrants, shadowmancerFeatures, simulateShadowmancer } from './grant-port.mjs';

const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
const SUBS = { none: null, abyssal: 'Pact of the Abyssal Depths' };
const DIRECTIONS = [
	['to02', '2.0.3', '0.2'],
	['to203', '0.2', '2.0.3'],
];

/** version → sub → level → [{uuid, name, tier}] known at that level (cumulative). */
const KNOWN = {};
/** version → sub → level → names newly learned at that level. */
const NEW_AT = {};

beforeAll(async () => {
	for (const version of ['2.0.3', '0.2']) {
		await setupWorld({ playtest: version === '0.2' });
		const spellIndex = await buildSpellIndex();
		KNOWN[version] = {};
		NEW_AT[version] = {};
		for (const [key, sub] of Object.entries(SUBS)) {
			const sim = await simulateShadowmancer({ version, subclass: sub, spellIndex });
			KNOWN[version][key] = {};
			NEW_AT[version][key] = {};
			let acc = [];
			for (const L of LEVELS) {
				const r = sim.byLevel.get(L);
				const learned = [...r.auto, ...r.picked].map(({ uuid, name, tier }) => ({ uuid, name, tier }));
				acc = [...acc, ...learned];
				KNOWN[version][key][L] = acc;
				NEW_AT[version][key][L] = learned.map((s) => s.name).sort();
			}
		}
	}
});

async function migrate(env, migration, actor, direction) {
	env.dialogs.answerWhen(/Subclass update/, 'apply');
	return migration.migrateCoreClasses({ actors: [actor], direction, apply: true });
}

const spellsOf = (actor) => actor.items.filter((i) => i.type === 'spell');

describe.each(DIRECTIONS)('%s: %s → %s', (direction, from, to) => {
	describe.each(Object.keys(SUBS))('subclass: %s', (sub) => {
		it.each(LEVELS)('L%i: the migrated spell set is the target version\'s ladder set', async (L) => {
			const { env, mods } = await setupWorld({ playtest: to === '0.2' });
			const migration = mods[3];
			const actor = await buildCharacterAtLevel(env, 'shadowmancer', L, {
				version: from,
				subclass: L >= 3 ? SUBS[sub] ?? undefined : undefined,
				spells: KNOWN[from][sub][L].map((s) => s.uuid),
			});
			expect(spellsOf(actor).map((s) => s.name).sort()).toEqual(KNOWN[from][sub][L].map((s) => s.name).sort());

			await migrate(env, migration, actor, direction);

			const spells = spellsOf(actor);
			const want = KNOWN[to][sub][L];
			// Same names, same sources as a native character of the target version.
			expect(spells.map((s) => s.name).sort()).toEqual(want.map((s) => s.name).sort());
			expect(spells.map((s) => sourceOf(s)).sort()).toEqual(want.map((s) => s.uuid).sort());
			// No duplicates, nothing above the ladder.
			expect(new Set(spells.map((s) => s.name)).size).toBe(spells.length);
			for (const s of spells) expect(s.system.tier, s.name).toBeLessThanOrEqual(ladderTier(L));
			// The 0.2-only cantrip follows the version.
			expect(spells.some((s) => s.name === 'Command Shadows')).toBe(to === '0.2');
			// Cantrips come from the target side.
			for (const n of ['Shadow Blast', 'Summon Shadow']) {
				const src = sourceOf(spells.find((s) => s.name === n));
				expect(src.startsWith(to === '0.2' ? `Compendium.${MODULE_ID}.` : 'Compendium.nimble.'), `${n} ${src}`).toBe(true);
			}

			// The next level-up, in the target world, from the migrated items.
			if (L < 20) {
				const spellIndex = await buildSpellIndex();
				const feats = await shadowmancerFeatures(to, SUBS[sub]);
				const next = L + 1;
				const newFeatures = feats.filter((f) => f.level === next && (L + 1 >= 3 || !f.doc.system.subclass)).map((f) => f.doc);
				const result = levelUpSpellGrants({
					newFeatures,
					ownedFeatures: actor.items.filter((i) => i.type === 'feature'),
					ownedSpellUuids: new Set(spells.map((s) => s._stats?.compendiumSource).filter(Boolean)),
					spellIndex,
					classIdentifier: 'shadowmancer',
					levelingTo: next,
				});
				const learned = [...result.autoGrant, ...result.spellSelections.flatMap((g) => g.availableSpells.slice(0, g.count))];
				const known = new Set(spells.map((s) => s.name));
				expect(learned.filter((s) => known.has(s.name)).map((s) => s.name)).toEqual([]);
				expect(learned.map((s) => s.name).sort()).toEqual(NEW_AT[to][sub][next]);
			}
		});
	});
});
