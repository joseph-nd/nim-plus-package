/**
 * Nim+ → Nim+ supersede: the Nimble 0.2 sheet versions of Nim+'s own Shepherd
 * subclasses (Luminary of Protection, Luminary of the Forge) supersede the Nim+
 * originals, not a system document.
 *
 *   - scripts/core/supersede.mjs hides the originals in the Nim+ packs while the
 *     playtest setting is on, and the copies while it is off; third-party packs
 *     stay untouched;
 *   - the class migration moves a Protection / Forge character between the two
 *     at L3/7/11/15 in both directions, and the subclass sync neither re-adds
 *     the other side's features nor touches a character the migration has not
 *     reached.
 */
import { describe, expect, it } from 'vitest';
import {
	buildCharacterAtLevel,
	findDocs,
	importScripts,
	installFoundry,
	installPacks,
	MODULE_ID,
	setupWorld,
	sourceOf,
} from '../harness/index.mjs';

const SUBCLASSES = `${MODULE_ID}.nim-plus-subclasses`;
const FEATURES = `${MODULE_ID}.nim-plus-class-features`;
const SETTING = `${MODULE_ID}.playtestCoreClasses`;

const is02 = (doc) => doc.flags?.[MODULE_ID]?.playtest02 === true;
const idOf = (uuid) => uuid.split('.').pop();

/** The original and the 0.2 copy of a Nim+ document (by pack, name and group). */
function pair(pack, name, where = () => true) {
	const hits = findDocs({ pack, name }).filter((h) => where(h.doc));
	const original = hits.filter((h) => !is02(h.doc));
	const copy = hits.filter((h) => is02(h.doc));
	expect(original, `${name} original`).toHaveLength(1);
	expect(copy, `${name} 0.2 copy`).toHaveLength(1);
	return { original: original[0], copy: copy[0] };
}

function only(pack, name, where = () => true) {
	const hits = findDocs({ pack, name }).filter((h) => where(h.doc));
	expect(hits, name).toHaveLength(1);
	return hits[0];
}

const inGroup = (group) => (doc) => doc.system?.group === group;
const PROTECTION = 'luminary-of-protection';
const FORGE = 'luminary-of-the-forge';

const SUBCLASS = {
	[PROTECTION]: pair(SUBCLASSES, 'Luminary of Protection'),
	[FORGE]: pair(SUBCLASSES, 'Luminary of the Forge'),
};

/** Features 0.2 changes: [name, original name (renames), group]. */
const CHANGED = [
	['Guardian Spirit', 'Guardian Spirit', PROTECTION],
	['Shield of Light', 'Shield of Light', PROTECTION],
	['Flameworker', 'Flameworker', FORGE],
	['Seasoned Journeyman', 'Seasoned Journeyman', FORGE],
	['Lightforged', 'Lightforged', FORGE],
	['Living Ember', 'Living Ember', FORGE],
	['Masterwork', 'Master of the Hammer', FORGE],
	['Quench the Blaze', 'Quench the Blaze', FORGE],
];
const FEATURE_PAIRS = CHANGED.map(([name, from, group]) => {
	const copy = only(FEATURES, name, (d) => inGroup(group)(d) && is02(d));
	const original = only(FEATURES, from, (d) => inGroup(group)(d) && !is02(d));
	return { name, from, group, copy, original };
});
const UNCHANGED = [
	only(FEATURES, 'Ready For Danger', inGroup(PROTECTION)),
	only(FEATURES, 'Ever Vigilant', inGroup(PROTECTION)),
];

const ORIGINALS = [SUBCLASS[PROTECTION].original, SUBCLASS[FORGE].original, ...FEATURE_PAIRS.map((p) => p.original)];
const COPIES = [SUBCLASS[PROTECTION].copy, SUBCLASS[FORGE].copy, ...FEATURE_PAIRS.map((p) => p.copy)];

const collOf = (uuid) => uuid.split('.').slice(1, 3).join('.');

/* ───────────────────────────── content ───────────────────────────── */

describe('Protection / Forge 0.2 copies (content)', () => {
	it('every copy supersedes exactly its Nim+ original and carries playtest02', () => {
		for (const { copy, original } of [SUBCLASS[PROTECTION], SUBCLASS[FORGE], ...FEATURE_PAIRS]) {
			expect(copy.doc.flags[MODULE_ID].supersedes, copy.doc.name).toEqual([original.uuid]);
			expect(copy.doc.flags[MODULE_ID].playtest02).toBe(true);
		}
	});

	it('copies keep the original group key, class, subclass flag and level', () => {
		for (const { copy, original } of FEATURE_PAIRS) {
			const [c, o] = [copy.doc.system, original.doc.system];
			expect([c.class, c.group, c.subclass, c.gainedAtLevels], copy.doc.name).toEqual([o.class, o.group, o.subclass, o.gainedAtLevels]);
		}
		for (const { copy, original } of [SUBCLASS[PROTECTION], SUBCLASS[FORGE]]) {
			expect(copy.doc.name).toBe(original.doc.name);
			expect(copy.doc.system.identifier).toBe(original.doc.system.identifier);
			expect(copy.doc.system.parentClass).toBe('shepherd');
		}
	});

	it('Guardian Spirit (0.2) spends the actor-wide lifebindingMend pool', () => {
		const gs = FEATURE_PAIRS.find((p) => p.name === 'Guardian Spirit').copy.doc;
		expect(gs.system.rules).toEqual([
			expect.objectContaining({ type: 'chargeConsumer', poolIdentifier: 'lifebindingMend', poolScope: 'actor', cost: '1' }),
		]);
	});

	it('the originals no longer carry the interim "0.2 playtest rules" notes', () => {
		for (const { original } of FEATURE_PAIRS) expect(original.doc.system.description, original.doc.name).not.toMatch(/0\.2 playtest/i);
	});
});

/* ───────────────────────────── supersede layer ───────────────────────────── */

describe.each([true, false])('supersede layer — playtest %s', (playtest) => {
	const hidden = playtest ? ORIGINALS : COPIES;
	const shown = [...(playtest ? COPIES : ORIGINALS), ...UNCHANGED];

	it('hides exactly one side in the Nim+ packs, through setup purge, re-index and document loads', async () => {
		const { env, mods } = await setupWorld({ playtest });
		await env.flush();
		const check = (label) => {
			for (const h of hidden) expect(env.game.packs.get(collOf(h.uuid)).index.has(idOf(h.uuid)), `${label}: ${h.doc.name} hidden`).toBe(false);
			for (const s of shown) expect(env.game.packs.get(collOf(s.uuid)).index.has(idOf(s.uuid)), `${label}: ${s.doc.name} shown`).toBe(true);
		};
		check('setup');
		for (const coll of [SUBCLASSES, FEATURES]) await env.game.packs.get(coll).getIndex({ fields: ['system.description', 'system.rules'] });
		check('re-index');
		for (const h of hidden) await env.game.packs.get(collOf(h.uuid)).getDocument(idOf(h.uuid));
		check('getDocument');
		// fromUuid still resolves a hidden original (an owned item's source).
		for (const h of hidden) expect(await fromUuid(h.uuid)).toBeTruthy();

		const data = mods[1].supersedeDataSync();
		for (const { copy, original } of [SUBCLASS[PROTECTION], SUBCLASS[FORGE], ...FEATURE_PAIRS]) {
			expect(data.supersededBy.get(original.uuid)).toBe(copy.uuid);
			expect(data.supersedes.get(copy.uuid)).toEqual([original.uuid]);
			expect(mods[1].isHiddenUuid(original.uuid)).toBe(playtest);
			expect(mods[1].isHiddenUuid(copy.uuid)).toBe(!playtest);
		}
	});

	it('a character on the side the setting turned away from has a pending migration; one on the shown side has not', async () => {
		const { env, mods } = await setupWorld({ playtest });
		const away = await buildCharacterAtLevel(env, 'shepherd', 7, {
			version: playtest ? '2.0.3' : '0.2',
			subclass: SUBCLASS[FORGE][playtest ? 'original' : 'copy'].uuid,
		});
		const here = await buildCharacterAtLevel(env, 'shepherd', 7, {
			version: playtest ? '0.2' : '2.0.3',
			subclass: SUBCLASS[FORGE][playtest ? 'copy' : 'original'].uuid,
		});
		expect(mods[1].hasPendingClassMigration(away)).toBe(true);
		expect(mods[1].hasPendingClassMigration(here)).toBe(false);
	});
});

describe('supersede layer — targets outside nimble / Nim+', () => {
	it('a third-party UUID in supersedes is ignored: its pack stays whole after the purges and a re-index', async () => {
		const copy = SUBCLASS[PROTECTION].copy;
		const env = installFoundry({ settings: { [SETTING]: true } });
		await installPacks(env, {
			transform(doc) {
				if (doc._id === copy.doc._id) doc.flags[MODULE_ID].supersedes = [...doc.flags[MODULE_ID].supersedes, 'Compendium.other-mod.subclasses.Item.CCCCCCCCCCCCCCCC'];
				return doc;
			},
			extra: [{ collection: 'other-mod.subclasses', type: 'Item', docs: [{ _id: 'CCCCCCCCCCCCCCCC', name: 'Theirs', type: 'subclass', system: {} }] }],
		});
		const [, supersede] = await importScripts(['scripts/core/playtest-settings.mjs', 'scripts/core/supersede.mjs']);
		await env.boot({ until: 'ready' });
		await env.flush();
		const pack = env.game.packs.get('other-mod.subclasses');
		expect(pack.index.has('CCCCCCCCCCCCCCCC')).toBe(true);
		await pack.getIndex({ fields: ['system.description'] });
		expect(pack.index.has('CCCCCCCCCCCCCCCC')).toBe(true);
		expect(pack.treeInitializations).toBe(0);
		// The Nim+ target of the same doc is still honoured.
		expect(supersede.supersedeDataSync().supersedes.get(copy.uuid)).toEqual([SUBCLASS[PROTECTION].original.uuid]);
		expect(env.game.packs.get(SUBCLASSES).index.has(SUBCLASS[PROTECTION].original.doc._id)).toBe(false);
	});
});

/* ───────────────────────────── migration ───────────────────────────── */

/** Answer every prompt the migration can raise: preview → apply, choices → the first N offered. */
function script(env) {
	env.dialogs
		.answerWhen(/Migrate classes/, 'apply')
		.answerWhen(/Subclass update/, 'apply')
		.answerWhen(/Choose \d+:/, (config) => {
			const count = Number(/Choose (\d+):/.exec(config.content)[1]);
			const values = [...config.content.matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
			return values.slice(0, count);
		});
}

/** `type:source` of the subclass item and its features. */
function subclassState(actor, group) {
	return actor.items
		.filter((i) => i.type === 'subclass' || (i.type === 'feature' && i.system?.subclass && i.system?.group === group))
		.map((i) => `${i.type}:${i.name}:${sourceOf(i)}`)
		.sort();
}

const LEVELS = [3, 7, 11, 15];

describe.each([
	{ direction: 'to02', from: '2.0.3', to: '0.2', fromSide: 'original', toSide: 'copy' },
	{ direction: 'to203', from: '0.2', to: '2.0.3', fromSide: 'copy', toSide: 'original' },
])('class migration $direction', ({ direction, from, to, fromSide, toSide }) => {
	describe.each([PROTECTION, FORGE])('%s', (group) => {
		it.each(LEVELS)('L%i: ends like a fresh build on the target side, ids kept, nothing left for the sync', async (level) => {
			const playtest = direction === 'to02';
			const { env, mods } = await setupWorld({ playtest });
			const [, supersede, sync, migration] = mods;
			const actor = await buildCharacterAtLevel(env, 'shepherd', level, { version: from, subclass: SUBCLASS[group][fromSide].uuid });
			const fresh = await buildCharacterAtLevel(env, 'shepherd', level, { version: to, subclass: SUBCLASS[group][toSide].uuid });
			const idsBefore = new Map(actor.items.filter((i) => i.system?.subclass || i.type === 'subclass').map((i) => [i.name, i.id]));
			expect(supersede.hasPendingClassMigration(actor)).toBe(true);

			script(env);
			expect(await migration.migrateCoreClasses({ actors: [actor], direction })).toBe('applied');
			await env.flush();

			expect(subclassState(actor, group)).toEqual(subclassState(fresh, group));
			expect(supersede.hasPendingClassMigration(actor)).toBe(false);
			// Replaced in place: every subclass item that survived kept its _id (Master of the Hammer ⇄ Masterwork included).
			for (const p of FEATURE_PAIRS.filter((p) => p.group === group)) {
				const [was, now] = direction === 'to02' ? [p.from, p.name] : [p.name, p.from];
				if (!idsBefore.has(was)) continue;
				const owned = actor.items.filter((i) => i.name === now && i.system?.group === group);
				expect(owned.map((i) => i.id), now).toEqual([idsBefore.get(was)]);
			}
			// The sync (which ran after the migration) has nothing left to do and never re-adds the other side.
			expect(await sync.planSubclassSync([actor])).toEqual([]);
			const other = new Set(
				[SUBCLASS[group][fromSide], ...FEATURE_PAIRS.filter((p) => p.group === group).map((p) => p[fromSide])].map((d) => d.uuid),
			);
			expect(actor.items.filter((i) => other.has(sourceOf(i))).map((i) => i.name)).toEqual([]);
		});
	});
});

describe('class migration against the setting — the subclass sync stays out of the way', () => {
	it.each(LEVELS)('L%i: to203 while the setting is on — the sync skips the character (no 0.2 features re-added)', async (level) => {
		const { env, mods } = await setupWorld({ playtest: true });
		const [, supersede, sync, migration] = mods;
		const actor = await buildCharacterAtLevel(env, 'shepherd', level, { version: '0.2', subclass: SUBCLASS[FORGE].copy.uuid });
		script(env);
		await migration.migrateCoreClasses({ actors: [actor], direction: 'to203' });
		await env.flush();
		const state = subclassState(actor, FORGE);
		expect(supersede.hasPendingClassMigration(actor)).toBe(true);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
		await sync.syncSubclasses({ actors: [actor], apply: true, silent: true });
		expect(subclassState(actor, FORGE)).toEqual(state);
		expect(actor.items.some((i) => COPIES.some((c) => c.uuid === sourceOf(i)))).toBe(false);
	});

	it('source-less original Protection with the setting on is not hijacked into the 0.2 copy by the identifier fallback', async () => {
		const { env, mods } = await setupWorld({ playtest: true });
		const sync = mods[2];
		const actor = await buildCharacterAtLevel(env, 'shepherd', 7, { version: '2.0.3', subclass: SUBCLASS[PROTECTION].original.uuid });
		const updates = actor.items
			.filter((i) => i.type === 'subclass' || i.system?.subclass)
			.map((i) => ({ _id: i.id, '_stats.compendiumSource': null }));
		await actor.updateEmbeddedDocuments('Item', updates);
		expect(await sync.planSubclassSync([actor])).toEqual([]);
	});

	it('source-less original features with the setting off resolve to the originals (no duplicate added)', async () => {
		const { env, mods } = await setupWorld({ playtest: false });
		const sync = mods[2];
		const actor = await buildCharacterAtLevel(env, 'shepherd', 15, { version: '2.0.3', subclass: SUBCLASS[PROTECTION].original.uuid });
		const updates = actor.items
			.filter((i) => i.type === 'feature' && i.system?.subclass)
			.map((i) => ({ _id: i.id, '_stats.compendiumSource': null }));
		await actor.updateEmbeddedDocuments('Item', updates);
		const report = await sync.planSubclassSync([actor]);
		const additions = report.flatMap((r) => r.plans.flatMap((p) => p.featureAdditions.map((f) => f.name)));
		const removals = report.flatMap((r) => r.plans.flatMap((p) => p.featureRemovals.map((f) => f.name)));
		expect({ additions, removals }).toEqual({ additions: [], removals: [] });
	});
});

/* ───────────────────────────── Seasoned Journeyman ───────────────────────────── */

describe('Seasoned Journeyman macro — 0.2 rules', () => {
	async function run(extra, answer, rules = '0.2') {
		const env = installFoundry();
		const [mod] = await importScripts(['scripts/macros/seasoned-journeyman.mjs']);
		const actor = new env.classes.Actor({
			name: 'Smith',
			type: 'character',
			system: { abilities: { will: { mod: 3 }, strength: { mod: 2 } } },
			items: [{ name: 'Seasoned Journeyman', type: 'feature', system: {} }, ...extra.map((name) => ({ name, type: 'feature', system: {} }))],
		});
		env.game.actors.set(actor.id, actor);
		const item = actor.items.find((i) => i.name === 'Seasoned Journeyman');
		let buttons = null;
		env.dialogs.answer((config) => {
			buttons = config.buttons.map((b) => b.action);
			return answer;
		});
		await mod.seasonedJourneyman(actor, item, rules);
		return { actor, buttons, env };
	}

	it.each([
		[[], 'weapon', 2, ['weapon', 'armor', 'cancel']],
		[[], 'armor', 2, ['weapon', 'armor', 'cancel']],
		[['Masterwork'], 'both', 5, ['weapon', 'armor', 'both', 'cancel']],
		[['Master of the Hammer'], 'armor', 2, ['weapon', 'armor', 'cancel']],
	])('with %j, choosing %s → +%i (buttons %j)', async (extra, answer, bonus, expected) => {
		const { actor, buttons } = await run(extra, answer);
		expect(buttons).toEqual(expected);
		expect(actor.getFlag(MODULE_ID, 'journeymanChoice')).toBe(answer);
		expect(actor.getFlag(MODULE_ID, 'journeymanBonus')).toBe(bonus);
	});

	it('the original rules are unchanged: +WIL, +WIL+STR with Master of the Hammer, no Both', async () => {
		const plain = await run([], 'weapon', null);
		expect(plain.actor.getFlag(MODULE_ID, 'journeymanBonus')).toBe(3);
		const hammer = await run(['Master of the Hammer'], 'weapon', null);
		expect(hammer.actor.getFlag(MODULE_ID, 'journeymanBonus')).toBe(5);
		expect(hammer.buttons).not.toContain('both');
	});

	it('the 0.2 copy calls the macro with the 0.2 rules; the original without', () => {
		const sj = FEATURE_PAIRS.find((p) => p.name === 'Seasoned Journeyman');
		expect(sj.copy.doc.system.macro).toMatch(/seasonedJourneyman\(actor, item, '0\.2'\)/);
		expect(sj.original.doc.system.macro).toMatch(/seasonedJourneyman\(actor, item\)/);
	});
});
