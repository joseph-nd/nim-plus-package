/**
 * Official subclasses (subclasses/{stormshifter,songweaver,shadowmancer,hunter}.mjs
 * via subclasses/restore-203.mjs, plus the generic pass and the subclass sync):
 *   Circle of Fang & Claw — Unleash the Beast 7→3, Windborne Protector 3→7,
 *     Friend of Beasts / Venomous Gaze retired;
 *   Herald of Courage — Fire in my Bones 11→7, Unfailing Courage retired,
 *     Unfailing Resolve new (11);
 *   Reaver — Martyr Spawn retired;
 *   Keeper of the Shadowpath — Pack Hunter retired, Dread Hunter new (11).
 * For every level both directions; to203 checks restore-203 re-adds exactly
 * the right features (and previews exactly those).
 */
import { describe, expect, it } from 'vitest';
import { itemsNamed } from '../harness/index.mjs';
import {
	FANG_AND_CLAW,
	LEVELS,
	NIM_FEATURES,
	SYS_FEATURES,
	buildChar,
	decode,
	previewLines,
	reloadFor,
	runMigration,
	snapshotItems,
	sourceOf,
	world,
} from './helpers.mjs';

const S = (id) => `${SYS_FEATURES}${id}`;
const N = (id) => `${NIM_FEATURES}${id}`;

/**
 * Per subclass: features to watch with their source per side and the level
 * each side grants them at (null = not on that side), and the 2.0.3 features
 * restore-203 must re-add (those 0.2 retired or grants later).
 */
const SUBCLASSES = [
	{
		classId: 'stormshifter',
		subclass: FANG_AND_CLAW,
		from: 3,
		features: {
			'Unleash the Beast': { sys: S('Vrg9rgHC5wCVSBB5'), nim: N('UWAWzq4Kg7oDDMA3'), 203: 7, '02': 3 },
			'Windborne Protector': { sys: S('RXTu7ntZOw8otv2t'), nim: N('oqv1Ktf6gnyr3zxO'), 203: 3, '02': 7 },
			'Friend of Beasts': { sys: S('tUbf5RfG5ywDTtdq'), nim: null, 203: 3, '02': null },
			'Venomous Gaze': { sys: S('xcmchy0Pn48UJoph'), nim: null, 203: 11, '02': null },
		},
		restored: (L) => [...(L >= 3 ? ['Friend of Beasts'] : []), ...(L >= 3 && L < 7 ? ['Windborne Protector'] : []), ...(L >= 11 ? ['Venomous Gaze'] : [])],
	},
	{
		classId: 'songweaver',
		subclass: 'Herald of Courage',
		from: 3,
		features: {
			'Fire in my Bones': { sys: S('x2yMiExkmLqN1Ge0'), nim: N('1SLDI2ntnES3ZdPc'), 203: 11, '02': 7 },
			'Unfailing Courage': { sys: S('KkWqpX2MaeXJAj6W'), nim: null, 203: 7, '02': null },
			'Unfailing Resolve': { sys: null, nim: N('9RnLUKJef0zG8552'), 203: null, '02': 11 },
		},
		restored: (L) => (L >= 7 ? ['Unfailing Courage'] : []),
	},
	{
		classId: 'shadowmancer',
		subclass: 'Reaver',
		from: 1,
		features: {
			'Martyr Spawn': { sys: S('sUvQUIIhVrs1KMlM'), nim: null, 203: 3, '02': null },
			'Shadow Exploit': { sys: S('1hazWtdoulp2xlp1'), nim: N('25rfAivDbpu6mSrj'), 203: 3, '02': 3 },
		},
		restored: (L) => (L >= 3 ? ['Martyr Spawn'] : []),
	},
	{
		classId: 'hunter',
		subclass: 'Keeper of the Shadowpath',
		from: 3,
		features: {
			'Pack Hunter': { sys: S('xfJbfDI18kunAZu9'), nim: null, 203: 11, '02': null },
			'Dread Hunter': { sys: null, nim: N('UwjV8lFfAr8j2oCR'), 203: null, '02': 11 },
		},
		restored: (L) => (L >= 11 ? ['Pack Hunter'] : []),
	},
];

const due = (at, L) => at !== null && at <= L;
const restoreLines = (preview) =>
	previewLines(preview?.content)
		.map(decode)
		.filter((t) => /2\.0\.3 feature, level/.test(t))
		.map((t) => /^Added: (.+) \(/.exec(t)?.[1])
		.sort();

describe.each(SUBCLASSES)('$subclass', (sc) => {
	const levels = LEVELS.filter((L) => L >= sc.from);

	it.each(levels)('to02 L%i: retired features removed, re-levelled ones moved, new ones added (after the subclass sync)', async (L) => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, sc.classId, L, { version: '2.0.3', subclass: sc.subclass });
		const ids = Object.fromEntries(Object.keys(sc.features).map((n) => [n, itemsNamed(actor, n)[0]?.id]));
		await runMigration(env, migration, actor, 'to02');
		for (const [name, f] of Object.entries(sc.features)) {
			const owned = itemsNamed(actor, name);
			if (due(f['02'], L)) {
				expect(owned.map(sourceOf), `${name} at L${L}`).toEqual([f.nim]);
				if (ids[name]) expect(owned[0].id, `${name} replaced in place`).toBe(ids[name]);
			} else {
				expect(owned, `${name} at L${L}`).toEqual([]);
			}
		}
	});

	it.each(levels)('to203 L%i: restore-203 re-adds exactly the due 2.0.3 features it previews', async (L) => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, sc.classId, L, { version: '0.2', subclass: sc.subclass });
		const { preview } = await runMigration(env, migration, actor, 'to203');
		expect(restoreLines(preview)).toEqual(sc.restored(L).sort());
		for (const [name, f] of Object.entries(sc.features)) {
			const owned = itemsNamed(actor, name);
			expect(owned.map(sourceOf), `${name} at L${L}`).toEqual(due(f[203], L) ? [f.sys] : []);
		}
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to203' })).toEqual([]);
	});
});

describe('restore-203 edge cases', () => {
	it('a hand-made (sourceless) copy of a retired feature is not restored twice', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'shadowmancer', 5, {
			version: '0.2',
			subclass: 'Reaver',
			items: [{ name: 'Martyr Spawn', type: 'feature', system: { class: 'shadowmancer', subclass: true, group: 'reaver' } }],
		});
		const { preview } = await runMigration(env, migration, actor, 'to203');
		expect(itemsNamed(actor, 'Martyr Spawn')).toHaveLength(1);
		expect(restoreLines(preview)).toEqual([]);
	});

	it('a partially migrated character that already owns the 2.0.3 feature gets no duplicate', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'hunter', 12, { version: '0.2', subclass: 'Keeper of the Shadowpath', features: [S('xfJbfDI18kunAZu9')] });
		await runMigration(env, migration, actor, 'to203');
		expect(itemsNamed(actor, 'Pack Hunter')).toHaveLength(1);
		expect(itemsNamed(actor, 'Dread Hunter')).toEqual([]);
	});

	it('a subclass whose source is in the legacy flags.core.sourceId is restored too', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'songweaver', 9, { version: '0.2', subclass: 'Herald of Courage', legacySourceId: true });
		await runMigration(env, migration, actor, 'to203');
		expect(itemsNamed(actor, 'Unfailing Courage').map(sourceOf)).toEqual([S('KkWqpX2MaeXJAj6W')]);
	});

	it('an unlisted official subclass (Circle of Sky & Storm) gets no restore step', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'stormshifter', 12, { version: '0.2', subclass: 'Circle of Sky & Storm' });
		const { preview } = await runMigration(env, migration, actor, 'to203');
		expect(restoreLines(preview)).toEqual([]);
	});

	it('a Nim+ subclass (Circle of Spores) gets no restore step and its features are kept', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'stormshifter', 12, { version: '0.2', subclass: 'Circle of Spores' });
		const spores = actor.items.filter((i) => i.system?.group === 'circle-of-spores').map((i) => i.toObject());
		expect(spores.length).toBeGreaterThan(0);
		const { preview } = await runMigration(env, migration, actor, 'to203');
		expect(restoreLines(preview)).toEqual([]);
		expect(actor.items.filter((i) => i.system?.group === 'circle-of-spores').map((i) => i.toObject())).toEqual(spores);
	});

	it('to203 against the setting (playtest still on) restores the same features', async () => {
		const { env, migration } = await world('to203', { playtest: true });
		const actor = await buildChar(env, 'stormshifter', 11, { version: '0.2', subclass: FANG_AND_CLAW });
		await runMigration(env, migration, actor, 'to203');
		for (const name of ['Friend of Beasts', 'Venomous Gaze', 'Windborne Protector', 'Unleash the Beast']) {
			expect(itemsNamed(actor, name).map(sourceOf), name).toHaveLength(1);
		}
	});

	it('a to203 dry run (apply: false) restores nothing', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'songweaver', 11, { version: '0.2', subclass: 'Herald of Courage' });
		const before = snapshotItems(actor);
		const run = await runMigration(env, migration, actor, 'to203', { apply: false });
		expect(run.result).toBe('previewed');
		expect(snapshotItems(actor)).toEqual(before);
	});

	it('0.2 → 2.0.3 → 0.2 (setting flipped each time): Fang & Claw L5 ends with its 0.2 features again', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'stormshifter', 5, { version: '0.2', subclass: FANG_AND_CLAW });
		await runMigration(env, migration, actor, 'to203');
		expect(itemsNamed(actor, 'Unleash the Beast')).toEqual([]);
		const back = await reloadFor('to02', actor);
		await runMigration(back.env, back.migration, back.actor, 'to02');
		expect(itemsNamed(back.actor, 'Unleash the Beast').map(sourceOf)).toEqual([N('UWAWzq4Kg7oDDMA3')]);
		expect(itemsNamed(back.actor, 'Friend of Beasts')).toEqual([]);
		expect(itemsNamed(back.actor, 'Windborne Protector')).toEqual([]);
	});
});

describe('new 0.2 subclass features when the subclass sync cannot run', () => {
	it('fixed BUG-migration-classes-b-3: a player migrating their own L5 Fang & Claw character to 0.2 gets Unleash the Beast (or is told to ask the GM)', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'stormshifter', 5, { version: '2.0.3', subclass: FANG_AND_CLAW });
		env.setUser({ isGM: false });
		const { result, preview } = await runMigration(env, migration, actor, 'to02');
		expect(result).toBe('applied');
		const told = /Unleash the Beast|subclass/i.test(decode(preview.content)) && /GM/i.test(decode(preview.content));
		expect(itemsNamed(actor, 'Unleash the Beast').length === 1 || told).toBe(true);
	});

	it('fixed BUG-migration-classes-b-4: to02 while the playtest setting is off still adds (or reports) the 0.2 subclass features due (Herald of Courage L12)', async () => {
		const { env, migration } = await world('to02', { playtest: false });
		const actor = await buildChar(env, 'songweaver', 12, { version: '2.0.3', subclass: 'Herald of Courage' });
		const { preview } = await runMigration(env, migration, actor, 'to02');
		const text = decode(preview.content);
		const reported = /Unfailing Resolve/.test(text);
		expect(itemsNamed(actor, 'Unfailing Resolve').length === 1 || reported).toBe(true);
	});
});
