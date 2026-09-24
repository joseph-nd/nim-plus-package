/**
 * Shadowmancer (classes/shadowmancer.mjs): the Command Shadows cantrip (to02
 * add, to203 remove), Vengeful Blast retired + the replacement Greater
 * Invocation prompt, and the invocation picks.
 */
import { describe, expect, it } from 'vitest';
import { itemsNamed, makeCharacter } from '../harness/index.mjs';
import { NIM_FEATURES, NIM_SPELLS, SYS_FEATURES, buildChar, decode, previewLines, runMigration, snapshotItems, sourceOf, world } from './helpers.mjs';

const COMMAND_SHADOWS = `${NIM_SPELLS}uHirzuVSdqt7jVPU`;
const VENGEFUL_BLAST = `${SYS_FEATURES}smUoANfxnZS95YVz`;
const ARMOR_OF_SHADOWS = `${SYS_FEATURES}0ovTUb8axKSScua0`;
const FIENDISH_BOON = `${SYS_FEATURES}YkmdeKqEaGwhcKz1`;
const HUNGERING = { sys: `${SYS_FEATURES}T7KsQHWjvoBZ2mpk`, nim: `${NIM_FEATURES}Zler4MVOJ4a713It` };
const ONE_WITH_SHADOWS = { sys: `${SYS_FEATURES}Wu73NvD9E7YKqAGG`, nim: `${NIM_FEATURES}UfKtNpL3AIEBs9RG` };

const optionValues = (content) => [...String(content).matchAll(/value="([^"]+)"/g)].map((m) => m[1]);

async function vengefulActor(env, extra = {}) {
	return buildChar(env, 'shadowmancer', 4, {
		version: '2.0.3',
		picks: ['Beguiling Influence', 'Vengeful Blast', 'Hungering Shadows'],
		spells: ['Shadow Blast', 'Summon Shadow'],
		...extra,
	});
}

describe('Command Shadows', () => {
	it.each([1, 2, 4, 17, 20])('to02 L%i: added once, announced, and not re-added on a second run', async (L) => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'shadowmancer', L, { version: '2.0.3', spells: ['Summon Shadow'] });
		const answers = L >= 4 ? [] : [];
		const { preview } = await runMigration(env, migration, actor, 'to02', { answers });
		const copies = itemsNamed(actor, 'Command Shadows');
		expect(copies).toHaveLength(1);
		expect(copies[0].type).toBe('spell');
		expect(sourceOf(copies[0])).toBe(COMMAND_SHADOWS);
		expect(previewLines(preview.content).map(decode)).toContain('Add the Command Shadows cantrip (0.2 Conduit of Shadow)');
		const again = await runMigration(env, migration, actor, 'to02');
		expect(again.result).toBe('nothing');
		expect(itemsNamed(actor, 'Command Shadows')).toHaveLength(1);
	});

	it('to02: a hand-made Command Shadows (no source) counts — no second copy, no preview line', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'shadowmancer', 2, {
			version: '2.0.3',
			items: [{ name: 'Command Shadows', type: 'spell', system: { school: 'necrotic', tier: 0 } }],
		});
		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(plan.classes.flatMap((c) => c.lines).join('\n')).not.toMatch(/Command Shadows/);
		await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'Command Shadows')).toHaveLength(1);
	});

	it('to203: Command Shadows (0.2-only spell) is removed with a preview line and no "choose a replacement" note', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'shadowmancer', 3, { version: '0.2', spells: ['Summon Shadow', 'Command Shadows'] });
		const { preview } = await runMigration(env, migration, actor, 'to203');
		expect(itemsNamed(actor, 'Command Shadows')).toEqual([]);
		const text = previewLines(preview.content).map(decode);
		expect(text).toContain('Removed: Command Shadows (not in 2.0.3)');
		expect(text.join('\n')).not.toMatch(/Command Shadows was a 0\.2 pick/);
	});

	it('to02 on a non-Shadowmancer never adds Command Shadows', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'mage', 5, { version: '2.0.3', spells: ['Shadow Blast'] });
		await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'Command Shadows')).toEqual([]);
	});
});

describe('Vengeful Blast → replacement Greater Invocation', () => {
	it('the prompt offers the 0.2 Greater Invocations the character does not own', async () => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env);
		const { log, preview } = await runMigration(env, migration, actor, 'to02', { answers: [[/Replace Vengeful Blast/, null]] });
		expect(previewLines(preview.content).map(decode)).toContain('Vengeful Blast is retired — you will be asked to choose a replacement Greater Invocation');
		expect(previewLines(preview.content).map(decode)).toContain('Removed: Vengeful Blast (retired in 0.2)');
		const prompts = log.filter((d) => /Replace Vengeful Blast/.test(d.title));
		expect(prompts).toHaveLength(1);
		const values = optionValues(prompts[0].content);
		expect(values).toEqual(expect.arrayContaining([ARMOR_OF_SHADOWS, FIENDISH_BOON, ONE_WITH_SHADOWS.nim]));
		for (const excluded of [VENGEFUL_BLAST, HUNGERING.sys, HUNGERING.nim, ONE_WITH_SHADOWS.sys]) expect(values).not.toContain(excluded);
		expect(prompts[0].content).toMatch(/type="radio"/);
	});

	it.each([
		['an unchanged system invocation', FIENDISH_BOON, 'Fiendish Boon'],
		['a Nim+ 0.2 copy', ONE_WITH_SHADOWS.nim, 'One with Shadows'],
	])('picking %s adds exactly it', async (_label, uuid, name) => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env);
		const before = new Set(actor.items.map((i) => i.id));
		await runMigration(env, migration, actor, 'to02', { answers: [[/Replace Vengeful Blast/, { action: 'ok', checked: [uuid] }]] });
		const [picked] = itemsNamed(actor, name);
		expect(sourceOf(picked)).toBe(uuid);
		expect(before.has(picked.id)).toBe(false);
		expect(itemsNamed(actor, 'Vengeful Blast')).toEqual([]);
		// Idempotent: no second prompt.
		const again = await runMigration(env, migration, actor, 'to02');
		expect(again.log.filter((d) => /Replace Vengeful Blast/.test(d.title))).toEqual([]);
	});

	it.each([
		['Cancel', 'cancel'],
		['closing the prompt', null],
	])('%s adds nothing and tells the user to choose by hand', async (_label, answer) => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env);
		const { preview } = await runMigration(env, migration, actor, 'to02', { answers: [[/Replace Vengeful Blast/, answer]], sync: 'later' });
		expect(preview).toBeTruthy();
		const greater = actor.items.filter((i) => i.system?.group === 'greater-invocations').map((i) => i.name);
		expect(greater).toEqual(['Hungering Shadows']);
		expect(env.notifications.messages('info').join('\n')).toMatch(/no Greater Invocation picked/);
	});

	it('picking the wrong number re-prompts with a warning', async () => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env);
		const { log } = await runMigration(env, migration, actor, 'to02', {
			answers: [
				[/Replace Vengeful Blast/, { action: 'ok', checked: [FIENDISH_BOON, ARMOR_OF_SHADOWS] }],
				[/Replace Vengeful Blast/, { action: 'ok', checked: [ARMOR_OF_SHADOWS] }],
			],
		});
		expect(log.filter((d) => /Replace Vengeful Blast/.test(d.title))).toHaveLength(2);
		expect(env.notifications.messages('warn').join('\n')).toMatch(/Choose exactly 1/);
		expect(itemsNamed(actor, 'Armor of Shadows')).toHaveLength(1);
		expect(itemsNamed(actor, 'Fiendish Boon')).toEqual([]);
	});

	it('a Vengeful Blast known only through the legacy flags.core.sourceId still prompts', async () => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env, { legacySourceId: true });
		const { log } = await runMigration(env, migration, actor, 'to02', { answers: [[/Replace Vengeful Blast/, { action: 'ok', checked: [ARMOR_OF_SHADOWS] }]] });
		expect(log.filter((d) => /Replace Vengeful Blast/.test(d.title))).toHaveLength(1);
		expect(itemsNamed(actor, 'Vengeful Blast')).toEqual([]);
	});

	it('a hand-made Vengeful Blast (no source) is left alone and nothing is prompted', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'shadowmancer', 4, {
			version: '2.0.3',
			items: [{ name: 'Vengeful Blast', type: 'feature', system: { class: 'shadowmancer', group: 'greater-invocations' } }],
		});
		const { log } = await runMigration(env, migration, actor, 'to02');
		expect(log.filter((d) => /Replace Vengeful Blast/.test(d.title))).toEqual([]);
		expect(itemsNamed(actor, 'Vengeful Blast')).toHaveLength(1);
	});

	it('to203 does not prompt and restores a picked Nim+ invocation to its 2.0.3 original in place', async () => {
		const { env, migration } = await world('to203');
		const actor = await buildChar(env, 'shadowmancer', 4, { version: '0.2', picks: ['Hungering Shadows', 'One with Shadows'] });
		const [one] = itemsNamed(actor, 'One with Shadows');
		const { log } = await runMigration(env, migration, actor, 'to203');
		expect(log.filter((d) => /Replace/.test(d.title))).toEqual([]);
		expect(sourceOf(actor.items.get(one.id))).toBe(ONE_WITH_SHADOWS.sys);
	});
});

describe('invocations', () => {
	it('to02 L4: superseded invocations are replaced in place and the changed choice groups are reported', async () => {
		const { env, migration } = await world('to02');
		const actor = await buildChar(env, 'shadowmancer', 4, { version: '2.0.3', picks: ['Beguiling Influence', 'Hungering Shadows'] });
		const [h] = itemsNamed(actor, 'Hungering Shadows');
		const { preview } = await runMigration(env, migration, actor, 'to02');
		expect(sourceOf(actor.items.get(h.id))).toBe(HUNGERING.nim);
		const text = previewLines(preview.content).map(decode).join('\n');
		expect(text).toMatch(/0\.2 changed .*greater invocations/);
		expect(text).toMatch(/lesser invocations/);
	});

	it('a dry run (apply: false) on a Vengeful Blast character changes nothing and shows no pick prompt', async () => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env);
		const before = snapshotItems(actor);
		const { result, log } = await runMigration(env, migration, actor, 'to02', { apply: false });
		expect(result).toBe('previewed');
		expect(log).toEqual([]);
		expect(snapshotItems(actor)).toEqual(before);
	});

	it('startup (non-interactive): Vengeful Blast is removed, the pick is deferred without a prompt, and the sheet run asks for it', async () => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env);
		env.dialogs.fallback = 'throw';
		const first = await runMigration(env, migration, actor, 'to02', { interactive: false });
		expect(first.result).toBe('applied');
		expect(first.log).toEqual([]);
		expect(itemsNamed(actor, 'Vengeful Blast')).toEqual([]);
		expect(actor.items.filter((i) => i.system?.group === 'greater-invocations').map((i) => i.name)).toEqual(['Hungering Shadows']);
		// Remembered on the actor, reported in the card and the toast.
		expect(migration.pendingChoices(actor, 'to02')).toEqual({ shadowmancer: { 'vengeful-blast': { title: 'Replace Vengeful Blast', count: 1 } } });
		const skipped = previewLines(first.card.content).map(decode).filter((t) => /skipped: needs a choice/.test(t));
		expect(skipped).toEqual([expect.stringMatching(/Vengeful Blast is retired/)]);
		expect(first.card.content).toMatch(/1 character needs a choice/);
		const warn = env.notifications.messages('warn').join('\n');
		expect(warn).toContain(actor.name);
		expect(warn).toContain('open their sheet → Migrate class to 0.2 rules');
		// The planner still reports it (the generic removal is gone), so the sheet control has it to do.
		const [again] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });
		expect(again.pendingChoice).toBe(true);
		expect(again.removals).toEqual([]);

		env.dialogs.fallback = 'close';
		const sheet = await runMigration(env, migration, actor, 'to02', {
			answers: [[/Replace Vengeful Blast/, { action: 'ok', checked: [FIENDISH_BOON] }]],
		});
		expect(sheet.log.filter((d) => /Replace Vengeful Blast/.test(d.title))).toHaveLength(1);
		expect(itemsNamed(actor, 'Fiendish Boon').map(sourceOf)).toEqual([FIENDISH_BOON]);
		expect(migration.pendingChoices(actor, 'to02')).toEqual({});
		expect(await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' })).toEqual([]);
	});

	it('a deferred Vengeful Blast pick cancelled on the sheet is forgotten (no prompt on the next run)', async () => {
		const { env, migration } = await world('to02');
		const actor = await vengefulActor(env);
		await runMigration(env, migration, actor, 'to02', { interactive: false });
		const sheet = await runMigration(env, migration, actor, 'to02', { answers: [[/Replace Vengeful Blast/, 'cancel']] });
		expect(sheet.log.filter((d) => /Replace Vengeful Blast/.test(d.title))).toHaveLength(1);
		expect(env.notifications.messages('info').join('\n')).toMatch(/no Greater Invocation picked/);
		expect(migration.pendingChoices(actor, 'to02')).toEqual({});
		const next = await runMigration(env, migration, actor, 'to02');
		expect(next.result).toBe('nothing');
		expect(next.log).toEqual([]);
	});

	it('an actor with no class but a Summon Shadow spell is not given Command Shadows', async () => {
		const { env, migration } = await world('to02');
		const actor = await makeCharacter(env, { spells: ['Summon Shadow'] });
		await runMigration(env, migration, actor, 'to02');
		expect(itemsNamed(actor, 'Command Shadows')).toEqual([]);
	});
});
