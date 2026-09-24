/**
 * Example: planning (dry run) and applying the core class migration with
 * scripted dialog answers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	buildCharacterAtLevel,
	findDoc,
	itemNames,
	itemsNamed,
	setupWorld,
	snapshotItems,
	sourceOf,
} from '../harness/index.mjs';

const NIM = 'nim-plus-package.nim-plus-class-features';

describe('harness: class migration', () => {
	let env;
	let migration;
	beforeEach(async () => {
		({ env, mods: [, , , migration] } = await setupWorld({ playtest: true }));
	});

	it('dry run: plans an L3 2.0.3 Commander → 0.2 without writing anything', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3, {
			version: '2.0.3',
			subclass: 'Champion of the Bulwark',
			picks: ['Face Me!', 'Hold the Line!'],
		});
		const before = snapshotItems(actor);

		const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction: 'to02' });

		// Replacements point at the Nim+ 0.2 documents.
		const replaced = Object.fromEntries(plan.replacements.map((r) => [r.item.name, r.target.uuid]));
		expect(replaced['Face Me!']).toBe(findDoc({ pack: NIM, name: 'Face Me!' }).uuid);
		expect(replaced.Commander).toMatch(/^Compendium\.nim-plus-package\.nim-plus-classes\./);

		// 0.2 grants Commander's Orders at 4: removed for an L3 character; Fit for Any Battlefield moves to 2.
		expect(plan.removals.map((r) => [r.item.name, r.reason])).toContainEqual(["Commander's Orders", 'now gained at level 4']);
		expect(plan.additions.map((a) => a.doc.name)).toContain('Fit for Any Battlefield');

		// The class module's preview lines are part of the plan.
		const lines = plan.classes.flatMap((c) => c.lines).join('\n');
		expect(lines).toMatch(/Commander's Orders now come at level 4/);
		expect(lines).toMatch(/choose one/);

		// Nothing written.
		expect(actor.calls).toEqual([]);
		expect(snapshotItems(actor)).toEqual(before);
	});

	it('apply: no preview popup, class-module prompts answered, pools and ids kept, toast + chat card', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 3, {
			version: '2.0.3',
			picks: ['Face Me!', 'Hold the Line!'],
			pools: { 'Coordinated Strike!': { chargePools: { 'coordinated-strike': { current: 1, max: 1, recoveries: [] } } } },
		});
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		const heavy = findDoc({ pack: NIM, name: 'Heavy Strike' });

		// No preview: the migration applies at once. Only the player-choice prompts ask.
		env.dialogs
			.answerWhen(/Remove/, true) // commander.mjs confirmRemoval (generic confirmChoice → DialogV2.confirm)
			.answerWhen(/Combat Tactic/, { action: 'ok', checked: [heavy.uuid] }); // promptChoice

		const result = await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' });
		expect(result).toBe('applied');

		// Replaced in place: same _id, new source, flags (pool state) untouched.
		const after = actor.items.get(strike.id);
		expect(sourceOf(after)).toBe(findDoc({ pack: NIM, name: 'Coordinated Strike!' }).uuid);
		expect(after.flags.nimble.chargePools['coordinated-strike'].current).toBe(1);

		// Orders removed on confirmation, the scripted tactic added.
		expect(itemNames(actor)).not.toContain('Face Me!');
		expect(itemNames(actor)).toContain('Heavy Strike');
		expect(env.notifications.messages('info').join('\n')).toMatch(/Nim\+ migrated 1 character to the 0\.2 rules/);
		// The full report is a GM-whispered chat card.
		expect(env.ChatMessage.created.some((c) => /Class migration/.test(c.content))).toBe(true);

		// Every dialog the run opened is in the log, with the answer it got.
		expect(env.dialogs.log.map((d) => d.kind)).toEqual(expect.arrayContaining(['wait', 'confirm']));
		expect(env.dialogs.log.some((d) => /Migrate classes/.test(d.title))).toBe(false);
	});

	it('non-GM players can only migrate characters they own', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 2, { ownedByPlayer: false });
		env.setUser({ isGM: false });
		const result = await migration.migrateCoreClasses({ actors: [actor], direction: 'to02' });
		expect(result).toBe('nothing');
		expect(env.notifications.warn).toHaveBeenCalledWith(expect.stringMatching(/only migrate characters you own/));
	});
});
