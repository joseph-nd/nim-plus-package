/**
 * The Cheat (classes/the-cheat.mjs + the generic pass): Sunder Armor (Medium)
 * + (Heavy) merge into one 0.2 Sunder Armor (one, both, neither owned), the
 * replacement Underhanded Ability prompt, the reverse direction, and the
 * Nim+ Honorseeker documents staying untouched.
 */
import { describe, expect, it } from 'vitest';
import { itemsNamed, makeCharacter } from '../harness/index.mjs';
import { NIM_FEATURES, SYS_FEATURES, buildChar, decode, previewLines, reloadFor, runMigration, snapshotItems, sourceOf, world } from './helpers.mjs';

const MEDIUM = `${SYS_FEATURES}TrR4gkjE1SStGF4G`;
const HEAVY = `${SYS_FEATURES}kQGzBvAflQsAVCnk`;
const SUNDER = `${NIM_FEATURES}vPPXQGg94sPR4ezu`;
const TANGLING_WIRE = `${NIM_FEATURES}9dgA6cchaJ0pa4SF`;
const THE_SETUP = `${NIM_FEATURES}I0bwYRtroyePlVsX`;
const MISDIRECTION = `${SYS_FEATURES}uvhLoC3NA38uZF9h`;
const TRICKSHOT = { sys: `${SYS_FEATURES}gCkxDNXKLhgO3EU8`, nim: `${NIM_FEATURES}mqDBXAMM5mm327IC` };
const PROMPT = /Replace Sunder Armor/;

const optionValues = (content) => [...String(content).matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
const sunders = (actor) => actor.items.filter((i) => /^Sunder Armor/.test(i.name));

async function cheat(env, picks, L = 8) {
	return buildChar(env, 'the-cheat', L, { version: '2.0.3', picks, pools: Object.fromEntries(picks.map((p) => [p, { chargePools: { probe: { current: 3, max: 5, recoveries: [] } } }])) });
}

describe('Sunder Armor merge (to02)', () => {
	it.each([
		['Medium, then Heavy', ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)']],
		['Heavy, then Medium', ['Sunder Armor (Heavy)', 'Sunder Armor (Medium)']],
	])('both owned (%s): one Sunder Armor in place of the first, the other removed as merged, one pick prompted', async (_l, picks) => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, [...picks, 'Trickshot']);
		const first = itemsNamed(actor, picks[0])[0];
		const second = itemsNamed(actor, picks[1])[0];
		const { preview, log } = await runMigration(env, migration, actor, 'to02', { answers: [[PROMPT, { action: 'ok', checked: [TANGLING_WIRE] }]] });

		const text = previewLines(preview.content).map(decode);
		expect(text).toContain(`Replaced: ${picks[0]} → Sunder Armor`);
		expect(text).toContain(`Removed: ${picks[1]} (merged into Sunder Armor)`);
		expect(text).toContain('Sunder Armor (Medium) and (Heavy) merge into one Sunder Armor — you will be asked to choose a replacement Underhanded Ability');

		expect(sunders(actor).map((i) => [i.id, sourceOf(i)])).toEqual([[first.id, SUNDER]]);
		expect(actor.items.has(second.id)).toBe(false);
		expect(actor.items.get(first.id).flags.nimble.chargePools.probe.current).toBe(3); // pool kept
		expect(log.filter((d) => PROMPT.test(d.title))).toHaveLength(1);
		expect(itemsNamed(actor, 'Tangling Wire').map(sourceOf)).toEqual([TANGLING_WIRE]);
		// Idempotent.
		const again = await runMigration(env, migration, actor, 'to02');
		expect(again.result).toBe('nothing');
	});

	it.each([['Sunder Armor (Medium)'], ['Sunder Armor (Heavy)']])('only %s owned: replaced in place, no prompt, no merge line', async (pick) => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, [pick]);
		const [item] = itemsNamed(actor, pick);
		const { preview, log } = await runMigration(env, migration, actor, 'to02');
		expect(sunders(actor).map((i) => [i.id, sourceOf(i)])).toEqual([[item.id, SUNDER]]);
		expect(log.filter((d) => PROMPT.test(d.title))).toEqual([]);
		expect(previewLines(preview.content).map(decode).join('\n')).not.toMatch(/merge/);
	});

	it('neither owned: no Sunder Armor, no prompt', async () => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, ['Trickshot', 'Misdirection']);
		const { log } = await runMigration(env, migration, actor, 'to02');
		expect(sunders(actor)).toEqual([]);
		expect(log.filter((d) => PROMPT.test(d.title))).toEqual([]);
	});

	it('the prompt offers 0.2 Underhanded Abilities not owned (incl. 0.2-only ones), never the superseded or owned ones', async () => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)', 'Trickshot']);
		const { log } = await runMigration(env, migration, actor, 'to02', { answers: [[PROMPT, null]] });
		const [prompt] = log.filter((d) => PROMPT.test(d.title));
		const values = optionValues(prompt.content);
		expect(values).toEqual(expect.arrayContaining([TANGLING_WIRE, THE_SETUP, MISDIRECTION]));
		for (const excluded of [MEDIUM, HEAVY, SUNDER, TRICKSHOT.sys, TRICKSHOT.nim]) expect(values).not.toContain(excluded);
	});

	it.each([
		['Cancel', 'cancel'],
		['closing it', null],
	])('%s on the prompt: only the merge happens, and the user is told to pick by hand', async (_l, answer) => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)']);
		const count = actor.items.size;
		await runMigration(env, migration, actor, 'to02', { answers: [[PROMPT, answer]] });
		expect(actor.items.size).toBe(count - 1);
		expect(sunders(actor).map(sourceOf)).toEqual([SUNDER]);
		expect(env.notifications.messages('info').join('\n')).toMatch(/no Underhanded Ability picked/);
	});

	it('a dry run (apply: false) changes nothing (no merge, no prompt)', async () => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)']);
		const before = snapshotItems(actor);
		const { log, result } = await runMigration(env, migration, actor, 'to02', { apply: false });
		expect(result).toBe('previewed');
		expect(log).toEqual([]);
		expect(snapshotItems(actor)).toEqual(before);
	});

	it('startup (non-interactive): the merge happens, the replacement pick is deferred, and the sheet run asks it', async () => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)']);
		const count = actor.items.size;
		env.dialogs.fallback = 'throw';
		const first = await runMigration(env, migration, actor, 'to02', { interactive: false });
		expect(first.log).toEqual([]);
		expect(sunders(actor).map(sourceOf)).toEqual([SUNDER]);
		expect(actor.items.size).toBe(count - 1);
		expect(migration.pendingChoices(actor, 'to02')).toEqual({ 'the-cheat': { 'sunder-armor': { title: 'Replace Sunder Armor (Heavy)', count: 1 } } });
		expect(env.notifications.messages('info').join('\n')).not.toMatch(/no Underhanded Ability picked/);

		env.dialogs.fallback = 'close';
		const sheet = await runMigration(env, migration, actor, 'to02', { answers: [[PROMPT, { action: 'ok', checked: [MISDIRECTION] }]] });
		expect(sheet.log.filter((d) => PROMPT.test(d.title))).toHaveLength(1);
		expect(itemsNamed(actor, 'Misdirection')).toHaveLength(1);
		expect(migration.pendingChoices(actor, 'to02')).toEqual({});
	});

	it('legacy flags.core.sourceId copies merge and prompt the same way', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'the-cheat', 8, { version: '2.0.3', picks: ['Sunder Armor (Medium)', 'Sunder Armor (Heavy)'], legacySourceId: true });
		const { log } = await runMigration(env, migration, actor, 'to02', { answers: [[PROMPT, { action: 'ok', checked: [MISDIRECTION] }]] });
		expect(sunders(actor).map(sourceOf)).toEqual([SUNDER]);
		expect(log.filter((d) => PROMPT.test(d.title))).toHaveLength(1);
		expect(itemsNamed(actor, 'Misdirection')).toHaveLength(1);
	});
});

describe('Sunder Armor back to 2.0.3 (to203)', () => {
	it('Sunder Armor becomes (Medium) in place and the preview says (Heavy) must be re-added by hand', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'the-cheat', 8, { version: '0.2', picks: ['Sunder Armor', 'Tangling Wire'] });
		const [s] = itemsNamed(actor, 'Sunder Armor');
		const { preview, log } = await runMigration(env, migration, actor, 'to203');
		expect(sourceOf(actor.items.get(s.id))).toBe(MEDIUM);
		expect(actor.items.get(s.id).name).toBe('Sunder Armor (Medium)');
		const text = previewLines(preview.content).map(decode).join('\n');
		expect(text).toMatch(/Sunder Armor replaces 2 2\.0\.3 documents; only the first is restored/);
		// Tangling Wire is 0.2-only: removed with a "choose a replacement" note, no prompt.
		expect(itemsNamed(actor, 'Tangling Wire')).toEqual([]);
		expect(text).toMatch(/Tangling Wire was a 0\.2 pick — choose a 2\.0\.3 replacement by hand/);
		expect(log.filter((d) => /Replace/.test(d.title))).toEqual([]);
	});
});

describe('Sunder Armor round trip', () => {
	it.fails('BUG-migration-classes-b-5: 2.0.3 → 0.2 → 2.0.3 with only Sunder Armor (Heavy) gives Heavy back, not Medium', async () => {
		const { env, migration } = await world('to02');
		const actor = await cheat(env, ['Sunder Armor (Heavy)']);
		const [heavy] = itemsNamed(actor, 'Sunder Armor (Heavy)');
		await runMigration(env, migration, actor, 'to02');
		const back = await reloadFor('to203', actor);
		await runMigration(back.env, back.migration, back.actor, 'to203');
		expect(sourceOf(back.actor.items.get(heavy.id))).toBe(HEAVY);
	});
});

describe('The Honorseeker (Nim+, not a 0.2 document) is untouched', () => {
	const HONOR = 'Compendium.nim-plus-package.nim-plus-subclasses.Item.0lIzkFevpil62SAg';
	const HONOR_FEATURES = [
		`${NIM_FEATURES}LNf14CkymHw7pb6p`, // Prove Your Worth! (3)
		`${NIM_FEATURES}FfR8n8osGGwXItGU`, // Worthy Underdog (3)
		`${NIM_FEATURES}nqYipMDlO2nTQgxz`, // Old Habits… (7)
		`${NIM_FEATURES}8FLpHHN3mg4ex2rh`, // Right Where I Want You (11)
		`${NIM_FEATURES}gnw6RbeczOpRibPz`, // Guard Breaker (15)
		`${NIM_FEATURES}dgOf8wtGA8UINjjX`, // Conqueror's Confidence (option, the-cheat-progression, no level)
		`${NIM_FEATURES}0OJ5ZU571ERf4YKO`, // Redemption Arc (option)
	];

	it.each([
		['to02', '2.0.3'],
		['to203', '0.2'],
	])('%s: the Honorseeker subclass and its features keep their exact data and are not in the preview', async (direction, version) => {
		const { env, migration } = await world(direction);
		const actor = await buildChar(env, 'the-cheat', 16, { version, subclass: HONOR, features: HONOR_FEATURES });
		const honor = actor.items.filter((i) => [HONOR, ...HONOR_FEATURES].includes(sourceOf(i)));
		expect(honor).toHaveLength(8);
		const before = honor.map((i) => i.toObject());
		const { preview } = await runMigration(env, migration, actor, direction);
		expect(honor.map((i) => actor.items.get(i.id)?.toObject())).toEqual(before);
		const text = decode(preview?.content ?? '');
		for (const i of honor) expect(text).not.toContain(i.name);
		// And the subclass sync has nothing to do for it either.
		const again = await runMigration(env, migration, actor, direction);
		expect(again.result).toBe('nothing');
	});

	it('an L1 Cheat (nothing superseded at level 1) gets no preview at all in either direction', async () => {
		for (const [direction, version] of [['to02', '2.0.3'], ['to203', '0.2']]) {
			const { env, migration } = await world(direction);
			const actor = await makeCharacter(env, { classId: 'the-cheat', level: 1, version, progression: true });
			const run = await runMigration(env, migration, actor, direction);
			expect(run.result).toBe('nothing');
			expect(run.log).toEqual([]);
		}
	});
});
