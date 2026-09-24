/**
 * Example: building characters from the real pack data.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
	buildCharacterAtLevel,
	findDoc,
	installFoundry,
	installPacks,
	itemNames,
	itemsNamed,
	loadPackData,
	sourceOf,
} from '../harness/index.mjs';

describe('harness: buildCharacterAtLevel', () => {
	let env;
	beforeEach(async () => {
		env = installFoundry();
		await installPacks(env);
	});

	it('pack data loads without id problems', () => {
		expect(loadPackData().warnings).toEqual([]);
	});

	it('builds an L5 2.0.3 Commander with its progression, subclass and picks', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, {
			version: '2.0.3',
			subclass: 'Champion of the Bulwark',
			picks: ['Face Me!', 'Hold the Line!', 'Heavy Strike'],
			pools: { 'Fit for Any Battlefield': { chargePools: { 'combat-dice': { current: 2, max: 4, recoveries: [] } } } },
		});

		// Level data, derived like Nimble's _prepareLevelData.
		expect(actor.levels).toEqual({ character: 5, classes: { commander: 5 } });

		const [cls] = actor.items.filter((i) => i.type === 'class');
		expect(cls.system.classLevel).toBe(5);
		expect(sourceOf(cls)).toBe(findDoc({ pack: 'nimble.nimble-classes', name: 'Commander' }).uuid);
		// Prepared identifier is the name slug (NimbleBaseItem#prepareBaseData).
		expect(cls.system.identifier).toBe('commander');

		// Auto-grants at or below 5 — all from the system pack in 2.0.3.
		expect(itemNames(actor, 'feature')).toEqual(
			expect.arrayContaining([
				"Commander's Orders",
				'Coordinated Strike!', // granted by Commander's Orders' grantItem rule
				'Field Medic',
				'Fit for Any Battlefield', // option feature, granted at 4
				'Master Commander',
				'Face Me!',
				'Hold the Line!',
				'Heavy Strike',
			]),
		);
		for (const item of actor.items) expect(sourceOf(item)).toMatch(/^Compendium\.nimble\./);

		// grantItem provenance is recorded like the system does.
		const [orders] = itemsNamed(actor, "Commander's Orders");
		const [strike] = itemsNamed(actor, 'Coordinated Strike!');
		expect(strike.system.grantedById).toBe(orders.id);

		// Subclass item (features only at 3+; Bulwark's first comes at 3).
		expect(actor.items.find((i) => i.type === 'subclass')?.name).toBe('Champion of the Bulwark');

		// Pools live in flags.<systemId>.chargePools, keyed by identifier.
		const [fit] = itemsNamed(actor, 'Fit for Any Battlefield');
		expect(fit.flags.nimble.chargePools['combat-dice'].current).toBe(2);
	});

	it('builds the same character on the 0.2 side from the Nim+ copies', async () => {
		const actor = await buildCharacterAtLevel(env, 'commander', 5, { version: '0.2' });
		const sources = actor.items.map(sourceOf);
		expect(sources.some((s) => s.startsWith('Compendium.nim-plus-package.'))).toBe(true);
		// The retired 2.0.3 die-size card is not part of a 0.2 character.
		expect(itemNames(actor)).not.toContain('Combat Tactics');
	});

	it('applies updates with Foundry v14 merge + operator semantics', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 1);
		const [item] = actor.items.filter((i) => i.type === 'feature');
		await item.update({ 'flags.nimble.chargePools.x': { current: 3 }, 'system.extra': { a: 1, b: 2 } });
		await item.update({ 'system.extra': { a: 5 } }); // merge: b survives
		expect(item.system.extra).toEqual({ a: 5, b: 2 });
		await item.update({ system: _replace({ description: 'only this' }) }); // ForcedReplacement
		expect(item._source.system).toEqual({ description: 'only this' });
		expect(item.flags.nimble.chargePools.x.current).toBe(3); // flags untouched
		await item.update({ 'flags.nimble.-=chargePools': null }); // legacy deletion key
		expect(item.flags.nimble.chargePools).toBeUndefined();
	});

	it('records every embedded write for assertions', async () => {
		const actor = await buildCharacterAtLevel(env, 'mage', 1);
		const [first] = actor.items.filter((i) => i.type === 'feature');
		await first.update({ 'system.description': 'changed' });
		await actor.deleteEmbeddedDocuments('Item', [first.id]);
		expect(actor.callsOf('update')).toHaveLength(1);
		expect(actor.callsOf('update')[0].updates[0]).toMatchObject({ _id: first.id, 'system.description': 'changed' });
		expect(actor.callsOf('delete')[0].ids).toEqual([first.id]);
		await expect(actor.deleteEmbeddedDocuments('Item', [first.id])).rejects.toThrow(/does not exist/);
	});
});
