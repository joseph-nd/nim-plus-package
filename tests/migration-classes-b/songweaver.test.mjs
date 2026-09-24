/**
 * Songweaver (classes/songweaver.mjs + the generic pass): the "Windbag" naming
 * collision (2.0.3 L3 Windbag → 0.2 "I Know Just the Song"; 0.2 adds a new L1
 * "Windbag"), "Wind Spellcasting and…" moving L1 → L2 with the extra school's
 * cantrips, and the reverse direction.
 */
import { describe, expect, it } from 'vitest';
import { itemsNamed } from '../harness/index.mjs';
import { LEVELS, NIM_FEATURES, SYS_FEATURES, buildChar, decode, previewLines, runMigration, sourceOf, world } from './helpers.mjs';

const WINDBAG_L1 = `${NIM_FEATURES}pNFFZrY8J15qC8gX`;
const WINDBAG_203 = `${SYS_FEATURES}fg1cWHw1YLF2Mcc0`;
const IKJTS = `${NIM_FEATURES}js6ZLzOvBkXUvPmh`;
const WIND_SC = { sys: `${SYS_FEATURES}4jKHYa0ZPYXjliJo`, nim: `${NIM_FEATURES}LtNrTmVxBI3tesy8` };
const SCHOOL_PROMPT = /Songweaver: additional school/;

const windbagLines = (preview) => previewLines(preview?.content).map(decode).filter((t) => /Windbag/.test(t) && /add/i.test(t));

describe('Windbag naming collision', () => {
	it.each(LEVELS)('to02 L%i: one Windbag (the 0.2 level-1 one); the 2.0.3 Windbag becomes I Know Just the Song in place', async (L) => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', L, { version: '2.0.3' });
		const old = itemsNamed(actor, 'Windbag');
		expect(old.map(sourceOf)).toEqual(L >= 3 ? [WINDBAG_203] : []);
		const { preview } = await runMigration(env, migration, actor, 'to02', { answers: [[SCHOOL_PROMPT, false]] });

		const windbags = itemsNamed(actor, 'Windbag');
		expect(windbags.map(sourceOf)).toEqual([WINDBAG_L1]);
		const ikjts = itemsNamed(actor, 'I Know Just the Song');
		expect(ikjts.map(sourceOf)).toEqual(L >= 3 ? [IKJTS] : []);
		if (L >= 3) expect(ikjts[0].id).toBe(old[0].id);
		// Announced exactly once: by the generic pass below 3, by the class module from 3.
		expect(windbagLines(preview)).toEqual(
			L >= 3 ? ['Add the level-1 Windbag feature (Wind cantrips and Vicious Mockery)'] : ['Added: Windbag (level 1)'],
		);
	});

	it.each(LEVELS)('to203 L%i: the 0.2 Windbag is removed; I Know Just the Song becomes the 2.0.3 Windbag in place', async (L) => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'songweaver', L, { version: '0.2' });
		const song = itemsNamed(actor, 'I Know Just the Song');
		await runMigration(env, migration, actor, 'to203');
		const windbags = itemsNamed(actor, 'Windbag');
		expect(windbags.map(sourceOf)).toEqual(L >= 3 ? [WINDBAG_203] : []);
		if (L >= 3) expect(windbags[0].id).toBe(song[0].id);
		expect(itemsNamed(actor, 'I Know Just the Song')).toEqual([]);
		expect(actor.items.filter((i) => sourceOf(i) === WIND_SC.sys)).toHaveLength(1);
	});

	it('to02 on a partially migrated L5 character that already owns the 0.2 Windbag adds no second copy', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', 5, { version: '2.0.3', features: [WINDBAG_L1] });
		const { preview } = await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'Windbag').map(sourceOf)).toEqual([WINDBAG_L1]);
		expect(itemsNamed(actor, 'I Know Just the Song')).toHaveLength(1);
		expect(windbagLines(preview)).toEqual([]);
	});

	it('to02 on an L5 character missing its 2.0.3 Windbag adds both 0.2 features once', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', 5, { version: '2.0.3' });
		actor.items.delete(itemsNamed(actor, 'Windbag')[0].id);
		await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'Windbag').map(sourceOf)).toEqual([WINDBAG_L1]);
		expect(itemsNamed(actor, 'I Know Just the Song').map(sourceOf)).toEqual([IKJTS]);
	});
});

describe('Wind Spellcasting and… (level 1 → 2) and the extra school cantrips', () => {
	const SPELLS = ['Razor Wind', 'Vicious Mockery', 'Helpful Gust', 'Flame Dart', "Heart's Fire", 'Blustery Gale'];

	it('to02 L1: the feature is removed and the confirm lists only the non-Wind cantrips; Yes removes exactly them', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', 1, { version: '2.0.3', spells: SPELLS });
		const { preview, log } = await runMigration(env, migration, actor, 'to02', { answers: [[SCHOOL_PROMPT, true]] });
		const text = previewLines(preview.content).map(decode);
		expect(text).toContain('Removed: Wind Spellcasting and... (now gained at level 2)');
		expect(text).toContain('0.2 grants the additional spell school at level 2 — you will be asked whether to remove Flame Dart, Heart\'s Fire');
		const [confirm] = log.filter((d) => SCHOOL_PROMPT.test(d.title));
		expect(confirm.kind).toBe('confirm');
		expect(decode(confirm.content)).toMatch(/Flame DartHeart's Fire$/);
		expect(actor.items.filter((i) => i.type === 'spell').map((i) => i.name).sort()).toEqual(
			['Blustery Gale', 'Helpful Gust', 'Razor Wind', 'Vicious Mockery'],
		);
		expect(actor.items.filter((i) => sourceOf(i) === WIND_SC.sys || sourceOf(i) === WIND_SC.nim)).toEqual([]);
	});

	it.each([
		['No', false],
		['closing it', null],
	])('to02 L1: answering %s keeps the cantrips', async (_l, answer) => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', 1, { version: '2.0.3', spells: SPELLS });
		await runMigration(env, migration, actor, 'to02', { answers: [[SCHOOL_PROMPT, answer]] });
		expect(itemsNamed(actor, 'Flame Dart')).toHaveLength(1);
		expect(itemsNamed(actor, "Heart's Fire")).toHaveLength(1);
	});

	it.each([2, 3, 20])('to02 L%i: the feature is replaced in place (level 2 in 0.2) and nothing is asked', async (L) => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', L, { version: '2.0.3', spells: SPELLS });
		const [ws] = actor.items.filter((i) => sourceOf(i) === WIND_SC.sys);
		const { log } = await runMigration(env, migration, actor, 'to02');
		expect(log.filter((d) => SCHOOL_PROMPT.test(d.title))).toEqual([]);
		expect(sourceOf(actor.items.get(ws.id))).toBe(WIND_SC.nim);
		expect(itemsNamed(actor, 'Flame Dart')).toHaveLength(1);
	});

	it('to02 L1 with only Wind cantrips asks nothing', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', 1, { version: '2.0.3', spells: ['Razor Wind', 'Vicious Mockery'] });
		const { preview, log } = await runMigration(env, migration, actor, 'to02');
		expect(log.filter((d) => SCHOOL_PROMPT.test(d.title))).toEqual([]);
		expect(previewLines(preview.content).map(decode).join('\n')).not.toMatch(/asked whether to remove/);
	});

	it.fails('BUG-migration-classes-b-2: to02 L1 does not offer non-Wind UTILITY spells (not cantrips) for removal', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'songweaver', 1, { version: '2.0.3', spells: ['Flame Dart', 'Beautify'] });
		const { log } = await runMigration(env, migration, actor, 'to02', { answers: [[SCHOOL_PROMPT, true]] });
		const [confirm] = log.filter((d) => SCHOOL_PROMPT.test(d.title));
		expect(decode(confirm.content)).not.toMatch(/Beautify/);
		expect(itemsNamed(actor, 'Beautify')).toHaveLength(1);
	});

	it('to203 L1: the 2.0.3 feature is added back and the player is told to pick the school by hand', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'songweaver', 1, { version: '0.2', spells: ['Razor Wind', 'Vicious Mockery'] });
		const { preview, log } = await runMigration(env, migration, actor, 'to203');
		const text = previewLines(preview.content).map(decode);
		expect(text).toContain('Added: Wind Spellcasting and... (level 1)');
		expect(text).toContain('2.0.3 grants Wind Spellcasting and… at level 1 — choose the additional school and add its cantrips by hand');
		expect(log.filter((d) => SCHOOL_PROMPT.test(d.title))).toEqual([]);
		expect(actor.items.filter((i) => sourceOf(i) === WIND_SC.sys)).toHaveLength(1);
	});

	it.each([2, 5])('to203 L%i: replaced in place, no "choose the school" note', async (L) => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'songweaver', L, { version: '0.2' });
		const [ws] = actor.items.filter((i) => sourceOf(i) === WIND_SC.nim);
		const { preview } = await runMigration(env, migration, actor, 'to203');
		expect(sourceOf(actor.items.get(ws.id))).toBe(WIND_SC.sys);
		expect(previewLines(preview.content).map(decode).join('\n')).not.toMatch(/choose the additional school/);
	});
});
