/**
 * Level 1–20 × both directions matrix for one class, run through the real
 * orchestrator (`migrateCoreClasses`), with scripted dialogs.
 *
 * For every (level, direction):
 *   - dry plan writes nothing;
 *   - preview "Later"/closed → 'postponed', nothing written;
 *   - preview accepted, every class prompt cancelled → only the unprompted preview
 *     lines happen (generic plan + unprompted class lines);
 *   - preview + prompts accepted → the diff is exactly what the preview listed,
 *     every prompt shown was announced, the non-pick item set equals a fresh
 *     build of the target version, picks are at the target's legal count, and
 *     pool state (item + actor flags) is untouched.
 */
import { describe, expect, it } from 'vitest';
import { setupWorld, sourceOf } from '../harness/index.mjs';
import {
	build,
	CLASSES,
	classPrompts,
	expectedFromPlan,
	isPick,
	names,
	nonPickSources,
	picksByGroup,
	runMigration,
	snapshot,
} from './helpers.mjs';

export const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);
export const DIRECTIONS = [
	{ direction: 'to02', from: '2.0.3', to: '0.2', playtest: true },
	{ direction: 'to203', from: '0.2', to: '2.0.3', playtest: false },
];

const count = (lv, levels) => levels.filter((l) => l <= lv).length;

/** Legal number of picks per group (or group bundle) for a class at a level on one side. */
export const LEGAL = {
	commander(version, lv) {
		const extra = count(lv, [6, 8, 10, 12, 16]);
		const abilities =
			version === '2.0.3' ? (lv >= 2 ? 2 : 0) + (lv >= 4 ? 1 : 0) + extra : (lv >= 2 ? 1 : 0) + (lv >= 4 ? 2 : 0) + extra;
		return { 'commanders-orders+combat-tactics': abilities, 'weapon-mastery': count(lv, [6, 10, 14]) };
	},
	shepherd(version, lv) {
		const n = version === '0.2' ? (lv >= 13 ? 3 : lv >= 9 ? 2 : lv >= 4 ? 1 : 0) : lv >= 13 ? 4 : lv >= 9 ? 3 : lv >= 5 ? 2 : 0;
		return { 'sacred-grace': n };
	},
	berserker: (_v, lv) => ({ 'savage-arsenal': count(lv, [4, 6, 8, 10, 12, 14, 16]) }),
	hunter: (_v, lv) => ({ 'thrill-of-the-hunt': (lv >= 2 ? 1 : 0) + count(lv, [2, 4, 6, 8, 12, 14]) }),
	oathsworn: (_v, lv) => ({ 'sacred-decree': count(lv, [3, 6, 9, 12, 14, 16]) }),
	mage: (_v, lv) => ({ spellshaper: (lv >= 4 ? 1 : 0) + count(lv, [4, 9, 13]) }),
};

export function pickCounts(actor, classId) {
	const by = picksByGroup(actor);
	const out = {};
	for (const key of Object.keys(LEGAL[classId]('0.2', 20))) {
		out[key] = key.split('+').reduce((n, g) => n + (by[g]?.length ?? 0), 0);
	}
	return out;
}

/** The class's own flags as stored (pool state lives here). */
export function poolState(env, actor) {
	const sys = env.game.system.id;
	const items = {};
	for (const i of actor.items) {
		const f = i._source.flags?.[sys];
		if (f && Object.keys(f).length) items[i.id] = structuredClone(f);
	}
	return { items, actor: structuredClone(actor._source.flags?.[sys] ?? null) };
}

/**
 * Promised removals/additions vs the actual pre-sync diff.
 * `accepted`: prompts answered yes/first (true) or cancelled (false).
 */
export function checkAgainstPreview(exp, migrationDiff, { accepted }) {
	const removed = names(migrationDiff.removed);
	const added = names(migrationDiff.added);
	const promptedRemovals = accepted ? exp.askRemove.length + exp.askKeep : 0;
	const promptedAdds = accepted ? exp.askPick.reduce((n, p) => n + p.count, 0) : 0;

	// Every promised unprompted removal happened.
	for (const n of exp.removed) expect(removed, `promised removal of ${n}`).toContain(n);
	if (accepted) for (const n of exp.askRemove) expect(removed, `confirmed removal of ${n}`).toContain(n);
	// Nothing beyond what was promised.
	expect(removed.length, `removed ${JSON.stringify(removed)} vs promised ${JSON.stringify(exp)}`).toBe(
		exp.removed.length + exp.dropAll + promptedRemovals,
	);
	for (const n of exp.added) expect(added, `promised addition of ${n}`).toContain(n);
	expect(added.length, `added ${JSON.stringify(added)} vs promised ${JSON.stringify(exp)}`).toBe(
		exp.added.length + promptedAdds,
	);
	// Updates only on items the plan listed as replacements.
	for (const u of migrationDiff.updated) expect(exp.updatedIds, `unannounced update of ${u.before.name}`).toContain(u.id);
}

/**
 * @param {string} classId
 * @param {object} [opts]
 * @param {number[]} [opts.levels]
 * @param {Function} [opts.extra]  more assertions at the end of the accepted run
 * @param {{direction: string, levels: number[], label: string}[]} [opts.knownBugs]
 *        accepted-run cases that fail because of a logged bug (registered as it.fails)
 */
export function defineMatrix(classId, { levels = LEVELS, extra, knownBugs = [] } = {}) {
	describe.each(DIRECTIONS)(`${classId} $direction matrix`, ({ direction, from, to, playtest }) => {
		const bugs = knownBugs.filter((b) => b.direction === direction);
		const bugOf = (level) => bugs.find((b) => b.levels.includes(level));
		it.each(levels)(`L%i: dry plan writes nothing; preview Later/closed changes nothing`, async (level) => {
			const { env, mods } = await setupWorld({ playtest });
			const migration = mods[3];
			const actor = await build(env, classId, level, from);
			const before = snapshot(actor);
			await migration.planCoreClassMigration({ actors: [actor], direction });
			expect(actor.calls).toEqual([]);

			for (const preview of ['later', null]) {
				env.dialogs.reset();
				const r = await runMigration(env, migration, actor, direction, { preview });
				expect(['postponed', 'nothing']).toContain(r.result);
				expect(actor.calls).toEqual([]);
				expect(snapshot(actor)).toEqual(before);
				expect(classPrompts(env)).toEqual([]);
			}
		});

		it.each(levels)(`L%i: prompts cancelled → only the unprompted preview lines happen`, async (level) => {
			const { env, mods } = await setupWorld({ playtest });
			const migration = mods[3];
			const actor = await build(env, classId, level, from);
			const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction });
			if (!plan) return;
			const exp = expectedFromPlan(plan);
			expect(exp.unparsed).toEqual([]);
			const r = await runMigration(env, migration, actor, direction, { confirm: false, pick: 'cancel', sync: 'later' });
			expect(r.result).toBe('applied');
			checkAgainstPreview(exp, r.migrationDiff, { accepted: false });
		});

		const accepted = async (level) => {
			const { env, mods } = await setupWorld({ playtest });
			const migration = mods[3];
			const actor = await build(env, classId, level, from);
			const pools = poolState(env, actor);
			const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction });
			const exp = plan ? expectedFromPlan(plan) : null;
			if (exp) expect(exp.unparsed).toEqual([]);

			const r = await runMigration(env, migration, actor, direction);
			expect(r.result).toBe(plan ? 'applied' : 'nothing');
			if (exp) {
				checkAgainstPreview(exp, r.migrationDiff, { accepted: true });
				// Every class prompt shown was announced (and vice versa).
				const prompts = classPrompts(env);
				const confirms = prompts.filter((p) => p.kind === 'confirm').length;
				const choices = prompts.length - confirms;
				expect(confirms, 'confirm prompts').toBe(exp.askRemove.length ? 1 : 0);
				expect(choices, 'choice prompts').toBe(exp.askPick.length + (exp.askKeep ? 1 : 0));
			}

			// Same item set as a fresh build of the target version (picks aside).
			const fresh = await build(env, classId, level, to, { world: false, pools: false });
			expect(nonPickSources(actor)).toEqual(nonPickSources(fresh));
			// Every owned item's source is visible on the target side (nothing stale left behind).
			for (const i of actor.items) expect(sourceOf(i), i.name).toBeTruthy();
			// Picks at the target's legal count.
			expect(pickCounts(actor, classId)).toEqual(LEGAL[classId](to, level));
			// Pool state untouched on every surviving item and on the actor.
			const now = poolState(env, actor);
			for (const [id, flags] of Object.entries(pools.items)) {
				if (actor.items.has(id)) expect(now.items[id], `pools of ${actor.items.get(id).name}`).toEqual(flags);
			}
			expect(now.actor).toEqual(pools.actor);

			// Idempotent: a second run has nothing left to do.
			env.dialogs.reset();
			const again = await migration.planCoreClassMigration({ actors: [actor], direction });
			const lines = again.flatMap((p) => [
				...p.replacements.map((x) => `replace ${x.item.name}`),
				...p.removals.map((x) => `remove ${x.item.name}`),
				...p.additions.map((x) => `add ${x.doc.name}`),
				...p.classes.flatMap((c) => c.lines),
			]);
			expect(lines).toEqual([]);

			await extra?.({ env, migration, actor, level, direction, from, to, r, plan });
		};
		const okLevels = levels.filter((l) => !bugOf(l));
		if (okLevels.length) {
			it.each(okLevels)(`L%i: accepted → preview-exact diff, fresh-build item set, legal picks, pools kept`, accepted);
		}
		for (const level of levels.filter(bugOf)) {
			it.fails(`${bugOf(level).label} (L${level}, accepted run)`, () => accepted(level));
		}
	});
}

export { isPick };
export const CLASS_IDS = Object.keys(CLASSES);
