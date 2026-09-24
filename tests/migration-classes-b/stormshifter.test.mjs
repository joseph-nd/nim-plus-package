/**
 * Stormshifter (classes/stormshifter.mjs + the generic pass): Direbeast forms
 * re-levelled [2,3,5] → [1,2,5], Expert Shifter retired, Beastshift has no
 * charges on either side, the new actor-scope `direbeast-form` pool, and the
 * lightning/wind spell swap on every actor (Mage, Songweaver, no class).
 */
import { describe, expect, it } from 'vitest';
import { itemsNamed, makeCharacter, setPool } from '../harness/index.mjs';
import {
	NIM_FEATURES,
	NIM_SPELLS,
	SYS_FEATURES,
	SYS_SPELLS,
	buildChar,
	decode,
	previewLines,
	runMigration,
	sourceOf,
	world,
} from './helpers.mjs';

const FORM = {
	'Fearsome Beast': { sys: `${SYS_FEATURES}tZkAluN0peHdleIx`, nim: `${NIM_FEATURES}f3DmKKkUjO2MeNuJ`, to203: 2, to02: 1 },
	'Beast of the Pack': { sys: `${SYS_FEATURES}bQW0Iy4BSeXNRD2x`, nim: `${NIM_FEATURES}VSJF1DJmMlGFmOqm`, to203: 3, to02: 2 },
	'Beast of Nightmares': { sys: `${SYS_FEATURES}qFGSdrw0ZItRK00x`, nim: `${NIM_FEATURES}vEFcEzVIltLXIw94`, to203: 5, to02: 5 },
};
const DIREBEAST = { sys: `${SYS_FEATURES}17oeqF1srUpTPYKr`, nim: `${NIM_FEATURES}7KIkTFfnqTjFSU5S` };
const BEASTSHIFT = { sys: `${SYS_FEATURES}lerWY2A6JkebdDFf`, nim: `${NIM_FEATURES}fVbnH7VGXUILGdvC` };
const EXPERT_SHIFTER = `${SYS_FEATURES}iM4BY2Pp3mU0L7ka`;
const SPELLS = {
	Zap: { sys: `${SYS_SPELLS}r434oYTu9Y2MoMXg`, nim: `${NIM_SPELLS}67ZmbSLwDwnipaqo` },
	'Arc Lightning': { sys: `${SYS_SPELLS}pLUyI3NQBJ6FV1mq`, nim: `${NIM_SPELLS}WQgjwyPyFyrQ8pJY` },
	'Razor Wind': { sys: `${SYS_SPELLS}N9DAEOBnY6QyW7VM`, nim: `${NIM_SPELLS}5cU0RSmuOR8fLU1W` },
	Fly: { sys: `${SYS_SPELLS}DHEl4NDcNMu2ZAj0`, nim: `${NIM_SPELLS}622RStlP0GuOPSSN` },
	'Vicious Mockery': { sys: `${SYS_SPELLS}kTJSEElZSzeOMXBO`, nim: `${NIM_SPELLS}Vtree36ux8igg8qB` },
};

const formsAt = (side, L) => Object.entries(FORM).filter(([, f]) => f[side] <= L).map(([n]) => n);
const formItems = (actor) => actor.items.filter((i) => i.system?.group === 'direbeast-form');

describe('Direbeast forms re-levelled', () => {
	describe.each(Array.from({ length: 8 }, (_, i) => i + 1))('level %i', (L) => {
		it('to02: 2.0.3 forms are replaced in place and the forms 0.2 grants by now are added', async () => {
			const { env, migration } = await world('to02');
			const actor = await buildChar(env, 'stormshifter', L, { version: '2.0.3', picks: formsAt('to203', L) });
			const ids = Object.fromEntries(formItems(actor).map((i) => [i.name, i.id]));
			const { preview } = await runMigration(env, migration, actor, 'to02');
			const after = formItems(actor);
			expect(after.map((i) => i.name).sort()).toEqual(formsAt('to02', L).sort());
			for (const item of after) {
				expect(sourceOf(item)).toBe(FORM[item.name].nim);
				if (ids[item.name]) expect(item.id).toBe(ids[item.name]); // replaced in place
			}
			const text = previewLines(preview?.content).map(decode);
			for (const name of formsAt('to02', L).filter((n) => !ids[n])) {
				expect(text).toContain(`Added: ${name} (Direbeast form, level ${FORM[name].to02} in 0.2)`);
			}
		});

		it('to203: 0.2 forms not yet due under 2.0.3 are removed, the others restored in place', async () => {
			const { env, migration } = await world('to203');
			const actor = await buildChar(env, 'stormshifter', L, { version: '0.2', picks: formsAt('to02', L) });
			const ids = Object.fromEntries(formItems(actor).map((i) => [i.name, i.id]));
			await runMigration(env, migration, actor, 'to203');
			const after = formItems(actor);
			expect(after.map((i) => i.name).sort()).toEqual(formsAt('to203', L).sort());
			for (const item of after) {
				expect(sourceOf(item)).toBe(FORM[item.name].sys);
				expect(item.id).toBe(ids[item.name]);
			}
		});
	});

	it('to02 with a duplicated form keeps one copy (the second is removed as merged)', async () => {
		const { env, migration } = await world('to02');
		const actor = await makeCharacter(env, {
			classId: 'stormshifter',
			level: 3,
			version: '2.0.3',
			features: [FORM['Fearsome Beast'].sys, FORM['Beast of the Pack'].sys],
			items: [{ ...structuredClone(actor0Item(FORM['Fearsome Beast'].sys)) }],
		});
		await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'Fearsome Beast')).toHaveLength(1);
		expect(sourceOf(itemsNamed(actor, 'Fearsome Beast')[0])).toBe(FORM['Fearsome Beast'].nim);
	});

	it('to02 does not add a 0.2 form next to a hand-made (sourceless) copy of it', async () => {
		const { env, migration } = await world('to02');
		const actor = await makeCharacter(env, {
			classId: 'stormshifter',
			level: 2,
			version: '2.0.3',
			items: [{ name: 'Fearsome Beast', type: 'feature', system: { class: 'stormshifter', group: 'direbeast-form' } }],
		});
		await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'Fearsome Beast')).toHaveLength(1);
		expect(itemsNamed(actor, 'Beast of the Pack')).toHaveLength(1);
	});
});

/** A raw owned copy of a pack doc for `items` (a second copy of something already owned). */
function actor0Item(uuid) {
	return { name: 'Fearsome Beast', type: 'feature', system: { class: 'stormshifter', group: 'direbeast-form', gainedAtLevels: [2] }, _stats: { compendiumSource: uuid } };
}

describe('Expert Shifter, Beastshift and the direbeast-form pool', () => {
	it.each([5, 6, 9, 12, 20])('to02 L%i: Expert Shifter is removed as retired (only from 6)', async (L) => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'stormshifter', L, { version: '2.0.3' });
		expect(actor.items.some((i) => sourceOf(i) === EXPERT_SHIFTER)).toBe(L >= 6);
		const { preview } = await runMigration(env, migration, actor, 'to02');
		expect(actor.items.some((i) => i.name === 'Expert Shifter')).toBe(false);
		if (L >= 6) expect(previewLines(preview.content).map(decode)).toContain('Removed: Expert Shifter (retired in 0.2)');
	});

	it.each([5, 6, 20])('to203 L%i: Expert Shifter is granted again from 6', async (L) => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'stormshifter', L, { version: '0.2' });
		await runMigration(env, migration, actor, 'to203');
		expect(actor.items.filter((i) => sourceOf(i) === EXPERT_SHIFTER)).toHaveLength(L >= 6 ? 1 : 0);
	});

	it('to02: Direbeast Form gets the actor-scope direbeast-form pool; Beastshift has no charge pool on either side', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'stormshifter', 5, {
			version: '2.0.3',
			pools: { Beastshift: { chargePools: { legacy: { current: 1, max: 2, recoveries: [] } } } },
		});
		const [direbeast] = itemsNamed(actor, 'Direbeast Form');
		const [beastshift] = itemsNamed(actor, 'Beastshift');
		expect(direbeast.system.rules ?? []).toEqual([]);
		await runMigration(env, migration, actor, 'to02');

		const d = actor.items.get(direbeast.id);
		expect(sourceOf(d)).toBe(DIREBEAST.nim);
		const pools = d.system.rules.filter((r) => r.type === 'chargePool');
		expect(pools).toHaveLength(1);
		expect(pools[0]).toMatchObject({ identifier: 'direbeast-form', scope: 'actor' });
		expect(d.system.gainedAtLevels).toEqual([1, 2, 5]);

		const b = actor.items.get(beastshift.id);
		expect(sourceOf(b)).toBe(BEASTSHIFT.nim);
		expect((b.system.rules ?? []).filter((r) => r.type === 'chargePool')).toEqual([]);
		// Flags are the actor's: a hand-set pool value survives the replacement untouched.
		expect(b.flags.nimble.chargePools.legacy.current).toBe(1);
	});

	it('to203: the direbeast-form pool rule is gone; the actor-scope pool value is left in the actor flags', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'stormshifter', 5, {
			version: '0.2',
			pools: { '@actor': { chargePools: { 'direbeast-form': { current: 1, max: 3, recoveries: [] } } } },
		});
		await runMigration(env, migration, actor, 'to203');
		const [d] = itemsNamed(actor, 'Direbeast Form');
		expect(sourceOf(d)).toBe(DIREBEAST.sys);
		expect(d.system.rules ?? []).toEqual([]);
		expect(actor.flags.nimble.chargePools['direbeast-form'].current).toBe(1);
	});

	it('to203 L1: Direbeast Form (0.2 level 1) is removed until 2.0.3 level 2', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'stormshifter', 1, { version: '0.2', picks: ['Fearsome Beast'] });
		const { preview } = await runMigration(env, migration, actor, 'to203');
		expect(itemsNamed(actor, 'Direbeast Form')).toEqual([]);
		expect(itemsNamed(actor, 'Fearsome Beast')).toEqual([]);
		expect(previewLines(preview.content).map(decode)).toContain('Removed: Direbeast Form (now gained at level 2)');
	});
});

describe('lightning / wind spell copies on any actor', () => {
	it.each([
		['mage', ['Zap', 'Arc Lightning', 'Razor Wind', 'Fly']],
		['songweaver', ['Razor Wind', 'Vicious Mockery', 'Fly']],
		['stormshifter', ['Zap', 'Fly']],
	])('%s: to02 replaces the system copies in place (ids and flags kept), to203 restores them', async (classId, names) => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, classId, 5, { version: '2.0.3', spells: names });
		const spells = names.map((n) => itemsNamed(actor, n)[0]);
		for (const s of spells) setPool(env, s, 'chargePools', 'probe', { current: 7, max: 9, recoveries: [] });
		const { preview } = await runMigration(env, migration, actor, 'to02');
		const text = previewLines(preview.content).map(decode);
		for (const s of spells) {
			const after = actor.items.get(s.id);
			expect(sourceOf(after)).toBe(SPELLS[s.name].nim);
			expect(after.flags.nimble.chargePools.probe.current).toBe(7);
			expect(text).toContain(`Updated: ${s.name}`);
		}
		// And back (after a reload with the setting off).
		const { env: env2, migration: m2 } = await world('to203');
		const copy = new env2.classes.Actor(actor.toObject());
		env2.game.actors.set(copy.id, copy);
		await runMigration(env2, m2, copy, 'to203');
		for (const s of spells) expect(sourceOf(copy.items.get(s.id))).toBe(SPELLS[s.name].sys);
	});

	it('a class filter does not exclude spells (they have no class): a Mage is migrated by classes: ["stormshifter"]', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'mage', 3, { version: '2.0.3', spells: ['Zap'] });
		await runMigration(env, migration, actor, 'to02', { classes: ['stormshifter'] });
		expect(sourceOf(itemsNamed(actor, 'Zap')[0])).toBe(SPELLS.Zap.nim);
	});

	it('an actor with no class still has its lightning spells migrated', async () => {
		const { env, migration } = await world('to02');
		const actor = await makeCharacter(env, { spells: ['Zap'] });
		const result = await runMigration(env, migration, actor, 'to02');
		expect(result.result).toBe('applied');
		expect(sourceOf(itemsNamed(actor, 'Zap')[0])).toBe(SPELLS.Zap.nim);
	});

	it('a spell whose source is only in the legacy flags.core.sourceId is migrated, and a re-run is a no-op', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'mage', 3, { version: '2.0.3', spells: ['Zap'], legacySourceId: true });
		await runMigration(env, migration, actor, 'to02');
		const [zap] = itemsNamed(actor, 'Zap');
		expect(sourceOf(zap)).toBe(SPELLS.Zap.nim);
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' })).toEqual([]);
	});

	it('a world spell (no compendium source) named Zap is left alone', async () => {
		const { env, migration } = await world('to02');
		const actor = await makeCharacter(env, { classId: 'mage', level: 2, items: [{ name: 'Zap', type: 'spell', system: { school: 'lightning', tier: 0 } }] });
		const [zap] = itemsNamed(actor, 'Zap');
		const before = zap.toObject();
		await runMigration(env, migration, actor, 'to02');
		expect(actor.items.get(zap.id).toObject()).toEqual(before);
	});
});
