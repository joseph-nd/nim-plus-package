/**
 * Local helpers for the migration-core tests (not a test file).
 */
import { CORE_SCRIPTS, setupWorld, sourceOf } from '../harness/index.mjs';

export const MODULE_ID = 'nim-plus-package';
export const NIM_FEATURES = 'nim-plus-package.nim-plus-class-features';
export const SYS_FEATURES = 'nimble.nimble-class-features';

export const CLASSES = [
	'berserker',
	'commander',
	'hunter',
	'mage',
	'oathsworn',
	'shadowmancer',
	'shepherd',
	'songweaver',
	'stormshifter',
	'the-cheat',
	'zephyr',
];
export const LEVELS = [1, 2, 3, 4, 5, 7, 10, 11, 15, 18, 20];

/**
 * setupWorld + the generic module from the SAME registry as index.mjs.
 * @returns {Promise<{env, settings, supersede, sync, migration, generic}>}
 */
export async function world(opts = {}) {
	const { env, mods } = await setupWorld({
		...opts,
		scripts: [...CORE_SCRIPTS, 'scripts/core/class-migration/generic.mjs', 'scripts/core/startup-queue.mjs'],
	});
	const [settings, supersede, sync, migration, generic, queue] = mods;
	return { env, settings, supersede, sync, migration, generic, queue };
}

/** A dialog answer that accepts everything: confirms → yes, pickers → the first N options (an "apply" button, if any, is pressed). */
export function acceptAll(config) {
	const content = String(config?.content ?? '');
	if (content.includes('nimPlusChoice')) {
		const values = [...content.matchAll(/name="nimPlusChoice" value="([^"]*)"/g)].map((m) => m[1]);
		const count = Number(/Choose (\d+):/.exec(content)?.[1] ?? 1);
		return values.slice(0, count);
	}
	const apply = (config?.buttons ?? []).find((b) => b.action === 'apply');
	if (apply) return apply.callback();
	return true;
}

/** Queue `n` accept-all answers (every dialog consumes one). */
export function acceptEverything(env, n = 40) {
	for (let i = 0; i < n; i += 1) env.dialogs.answer(acceptAll);
}

/** `type:name|source` lines, sorted. */
export function fingerprint(actor) {
	return actor.items.map((i) => `${i.type}:${i.name}|${sourceOf(i)}`).sort();
}

export function diff(a, b) {
	return { missing: a.filter((x) => !b.includes(x)), extra: b.filter((x) => !a.includes(x)) };
}

export function duplicates(list) {
	return [...new Set(list.filter((n, i) => list.indexOf(n) !== i))];
}

/** Every owned item gets a pool value keyed by its id: {[itemId]: current}. */
export function seedPools(env, actor) {
	const sys = env.game.system.id;
	const seeded = {};
	actor.items.forEach((item, idx) => {
		const current = (idx % 5) + 1;
		item._source.flags ??= {};
		item._source.flags[sys] ??= {};
		item._source.flags[sys].chargePools = {
			...(item._source.flags[sys].chargePools ?? {}),
			'test-pool': { current, max: 9, recoveries: [] },
		};
		item._source.flags[sys].dicePools = { 'test-dice': { current: [current], max: 3 } };
		item.prepareData();
		seeded[item.id] = current;
	});
	return seeded;
}

/** Plan + apply one direction for one actor; returns the plan (or null). */
export async function migrate(migration, actor, direction) {
	const [plan] = await migration.planCoreClassMigration({ actors: [actor], direction });
	if (plan) await migration.applyCoreClassMigration([plan], direction);
	return plan ?? null;
}

/** A plan's generic part as plain names. */
export function planSummary(plan) {
	if (!plan) return null;
	return {
		replacements: plan.replacements.map((r) => `${r.item.name} -> ${r.target.name}`),
		removals: plan.removals.map((r) => `${r.item.name} (${r.reason})`),
		additions: plan.additions.map((a) => a.doc.name),
		manual: plan.manual,
		lines: plan.classes.flatMap((c) => c.lines),
	};
}
