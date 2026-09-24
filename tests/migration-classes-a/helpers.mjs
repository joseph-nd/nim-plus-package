/**
 * Local helpers for tests/migration-classes-a (not part of the shared harness).
 *
 * - `CLASSES`   per-class build recipes (picks per version/level, a subclass with a
 *               Nim+ 0.2 copy, the pick groups and their legal counts per version).
 * - `script()`  a persistent dialog auto-responder for the class-module prompts
 *               (confirms, choice prompts) — the migration itself has no preview dialog.
 * - `runMigration()` runs the orchestrator and snapshots the actor when the class
 *               migration's chat card is posted (before the follow-up subclass sync), so
 *               the class migration's own diff can be isolated.
 * - `diff()`    before/after item diff (removed / added / updated).
 * - `expectedFromPlan()` what the preview promised, parsed from the plan's lines.
 * - `nonPickSources()` the multiset of compendium sources an actor owns, choice picks
 *               excluded — compared against a fresh build of the target version.
 */
import { buildCharacterAtLevel, sourceOf } from '../harness/index.mjs';

export const SUBCLASS_LEVEL = 3;

const upTo = (level, table) =>
	Object.entries(table)
		.filter(([lv]) => Number(lv) <= level)
		.flatMap(([, names]) => names);

/** Per class: picks per version (level → names gained at that level). */
export const CLASSES = {
	commander: {
		subclass: 'Champion of the Vanguard',
		groups: ['commanders-orders', 'combat-tactics', 'weapon-mastery'],
		picks: {
			'2.0.3': {
				2: ['Face Me!', 'Hold the Line!'],
				4: ['Heavy Strike'],
				6: ['Lunging Strike', 'Bludgeoning'],
				8: ['Reposition!'],
				10: ['Sweeping Strike', 'Piercing'],
				12: ['Move it! Move it!'],
				14: ['Slashing'],
				16: ['Inerrant Strike.'],
			},
			'0.2': {
				2: ['Heavy Strike'],
				4: ['Face Me!', 'Hold the Line!'],
				6: ['Lunging Strike', 'Bludgeoning'],
				8: ['Reposition!'],
				10: ['Sweeping Strike', 'Piercing'],
				12: ['Move it! Move it!'],
				14: ['Slashing'],
				16: ['Inerrant Strike'],
			},
		},
		pools: {
			'Coordinated Strike!': {
				chargePools: {
					'coordinated-strike-uses': { current: 1, max: 3, recoveries: [] },
					'coordinated-strike-round': { current: 0, max: 1, recoveries: [] },
				},
			},
		},
	},
	shepherd: {
		subclass: 'Luminary of Mercy',
		groups: ['sacred-grace'],
		picks: {
			'2.0.3': { 5: ['Light Bearer', 'Hasty Companion'], 9: ['Guiding Spirit'], 13: ['Illuminate Soul'] },
			'0.2': { 4: ['Light Bearer'], 9: ['Hasty Companion'], 13: ['Guiding Spirit'] },
		},
		spells: { '2.0.3': (level) => (level >= 2 ? ['Lifebinding Spirit'] : []), '0.2': () => ['Lifebinding Spirit'] },
		pools: { '@actor': { chargePools: { lifebindingMend: { current: 1, max: 3, recoveries: [] } } } },
	},
	berserker: {
		subclass: 'Path of the Red Mist',
		groups: ['savage-arsenal'],
		picks: {
			both: {
				4: ['Death Blow'],
				6: ['Deathless Rage'],
				8: ['Into the Fray'],
				10: ['MORE BLOOD!'],
				12: ['Swift Fury'],
				14: ['Unstoppable Force'],
				16: ['Rampage'],
			},
		},
		pools: (level) => ({
			Rage: { dicePools: { fury: { current: [3, 5], max: 2, recoveries: [] } } },
			...(level >= 6 ? { 'Deathless Rage': { chargePools: { deathlessRageUse: { current: 0, max: 1, recoveries: [] } } } } : {}),
		}),
	},
	hunter: {
		subclass: 'Keeper of the Shadowpath',
		groups: ['thrill-of-the-hunt'],
		picks: {
			both: {
				2: ['Heavy Shot', 'Fleet Feet'],
				4: ['Hail of Arrows'],
				6: ['Pinning Shot'],
				8: ['Multishot'],
				12: ['Decoy'],
				14: ['Vital Shot'],
			},
		},
	},
	oathsworn: {
		subclass: 'Oath of Refuge',
		groups: ['sacred-decree'],
		picks: {
			both: {
				3: ['Explosive Judgment'],
				6: ['Radiant Aura'],
				9: ['Shining Mandate'],
				12: ['Unstoppable Protector'],
				14: ['Courage!'],
				16: ['Well Armored'],
			},
		},
		pools: { 'Radiant Judgement': { dicePools: { judgment: { current: [4, 2], max: 2, recoveries: [] } } } },
	},
	mage: {
		subclass: 'Invoker of Chaos',
		groups: ['spellshaper'],
		picks: {
			both: { 4: ['Echo Casting', 'Precise Casting'], 9: ['Stretch Time'], 13: ['Dimensional Compression'] },
		},
	},
};

export function picksFor(classId, version, level) {
	const table = CLASSES[classId].picks[version] ?? CLASSES[classId].picks.both;
	return upTo(level, table);
}

export function spellsFor(classId, version, level) {
	return CLASSES[classId].spells?.[version]?.(level) ?? [];
}

export function poolsFor(classId, level) {
	const p = CLASSES[classId].pools;
	return typeof p === 'function' ? p(level) : (p ?? {});
}

/** Build a character of `version` at `level` with this file's default picks/spells/subclass. */
export async function build(env, classId, level, version, { subclass = true, pools = true, ...rest } = {}) {
	return buildCharacterAtLevel(env, classId, level, {
		version,
		subclass: subclass && level >= SUBCLASS_LEVEL ? CLASSES[classId].subclass : undefined,
		picks: picksFor(classId, version, level),
		spells: spellsFor(classId, version, level),
		pools: pools === true ? poolsFor(classId, level) : pools || undefined,
		...rest,
	});
}

/* ───────────────────────────── inspection ───────────────────────────── */

export function isAutoGroup(group) {
	const g = String(group ?? '');
	return g === '' || g.endsWith('-progression');
}

/** A choice-group pick (Orders, Tactics, graces, arsenal, …). */
export function isPick(item) {
	// The 2.0.3 Coordinated Strike! is filed under the Orders group but granted, not picked.
	if (/coordinated\s*strike/i.test(item.name ?? '')) return false;
	return item.type === 'feature' && !item.system?.subclass && !isAutoGroup(item.system?.group);
}

/** Sorted multiset of sources of everything except choice picks (the "fresh build" comparison). */
export function nonPickSources(actor) {
	return actor.items
		.filter((i) => !isPick(i))
		.map((i) => `${i.type}:${sourceOf(i)}`)
		.sort();
}

/** Names of owned picks per group. */
export function picksByGroup(actor) {
	const out = {};
	for (const i of actor.items.filter(isPick)) (out[i.system.group] ??= []).push(i.name);
	for (const k of Object.keys(out)) out[k].sort();
	return out;
}

export function snapshot(actor) {
	return new Map(actor.items.map((i) => [i.id, { name: i.name, type: i.type, source: sourceOf(i), obj: i.toObject() }]));
}

/** Diff two snapshots. */
export function diff(before, after) {
	const removed = [...before.keys()].filter((id) => !after.has(id)).map((id) => before.get(id));
	const added = [...after.keys()].filter((id) => !before.has(id)).map((id) => after.get(id));
	const updated = [...after.keys()]
		.filter((id) => before.has(id) && JSON.stringify(before.get(id).obj) !== JSON.stringify(after.get(id).obj))
		.map((id) => ({ id, before: before.get(id), after: after.get(id) }));
	return { removed, added, updated };
}

const names = (list) => list.map((x) => x.name).sort();
export { names };

/* ───────────────────────────── preview lines ───────────────────────────── */

const unescape = (s) =>
	String(s).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * What a plan's preview promises, as counts/names:
 *   removed: names that WILL be removed (generic removals + "Removed:" lines)
 *   added:   names that WILL be added (generic additions + "Added:" lines)
 *   askRemove: names the GM will be asked whether to remove (commander confirm)
 *   askPick: [{group, count}] prompts to pick new items
 *   askKeep: {drop} shepherd "keep which" / commander "which to drop" prompts (drop count)
 *   dropAll: shepherd "all N removed" (unprompted)
 */
export function expectedFromPlan(plan) {
	const out = { removed: [], added: [], askRemove: [], askPick: [], askKeep: 0, dropAll: 0, updatedIds: [], unparsed: [] };
	for (const r of plan.removals) out.removed.push(r.item.name);
	for (const a of plan.additions) out.added.push(a.doc.name);
	for (const r of plan.replacements) out.updatedIds.push(r.item.id);
	for (const line of plan.classes.flatMap((c) => c.lines)) {
		let m;
		if ((m = /^Removed: <s>(.*?)<\/s>/.exec(line))) out.removed.push(unescape(m[1]));
		else if ((m = /^Added: <strong>(.*?)<\/strong>/.exec(line))) out.added.push(unescape(m[1]));
		else if ((m = /you will be asked whether to remove (.*)$/.exec(line)))
			out.askRemove.push(...[...m[1].matchAll(/<em>(.*?)<\/em>/g)].map((x) => unescape(x[1])));
		else if (/brings a Combat Tactic: you will be asked to choose one/.test(line)) out.askPick.push({ group: 'combat-tactics', count: 1 });
		else if ((m = /Commander's Orders are chosen at level 2 in 2\.0\.3: you will be asked to choose (\d+)/.exec(line)))
			out.askPick.push({ group: 'commanders-orders', count: Number(m[1]) });
		else if ((m = /Combat Abilities: .* you will be asked which (\d+) to drop$/.exec(line))) out.askKeep += Number(m[1]);
		else if ((m = /Sacred Graces: .* grants none before level \d+ — all (\d+) removed/.exec(line))) out.dropAll += Number(m[1]);
		else if ((m = /Sacred Graces: (\d+) owned, .* you choose which (\d+) to keep; the other (\d+)/.exec(line))) out.askKeep += Number(m[3]);
		else if ((m = /Sacred Graces: (\d+) owned, .* you pick (\d+) new grace/.exec(line)))
			out.askPick.push({ group: 'sacred-grace', count: Number(m[2]) });
		else out.unparsed.push(line);
	}
	out.removed.sort();
	out.added.sort();
	out.askRemove.sort();
	return out;
}

/* ───────────────────────────── dialogs ───────────────────────────── */

const titleOf = (c) => c?.window?.title ?? c?.title ?? '';

/** Values of the choice inputs in a promptChoice dialog, and its "Choose N". */
export function choiceOptions(config) {
	const content = String(config?.content ?? '');
	const values = [...content.matchAll(/<input[^>]*name="nimPlusChoice"[^>]*value="([^"]*)"/g)].map((m) => unescape(m[1]));
	const labels = [...content.matchAll(/<strong>([^<]*)<\/strong>/g)].map((m) => unescape(m[1]));
	const count = Number(/Choose (\d+):/.exec(content)?.[1] ?? 1);
	return { values, labels, count };
}

/**
 * A persistent responder for the class-module prompts (the migration and the
 * subclass sync apply without a preview dialog now). Options:
 *   confirm: true | false | null
 *   pick:    'first' | 'last' | 'cancel' | 'wrong-count' | fn({values, labels, count, title}) → values|null
 */
export function script(env, { confirm = true, pick = 'first' } = {}) {
	const d = env.dialogs;
	const N = 40;
	for (let i = 0; i < N; i += 1) {
		d.answerWhen((c) => !!c?.yes && !!c?.no, confirm === null ? null : confirm);
		d.answerWhen(
			(c) => /nimPlusChoice/.test(String(c?.content ?? '')),
			(config) => {
				const o = choiceOptions(config);
				const title = titleOf(config);
				if (typeof pick === 'function') return pick({ ...o, title });
				if (pick === 'cancel') return null;
				if (pick === 'wrong-count') return o.values.slice(0, o.count + 1);
				if (pick === 'last') return o.values.slice(-o.count);
				return o.values.slice(0, o.count);
			},
		);
	}
	return d;
}

/** Dialog log entries of the class-module prompts (confirm + choice). */
export function classPrompts(env) {
	return env.dialogs.log.filter((l) => l.kind === 'confirm' || /nimPlusChoice/.test(String(l.content)));
}

/** Chat cards posted since `from` (the class migration's and the subclass sync's reports). */
export function reportCards(env, from = 0) {
	return env.ChatMessage.created.slice(from);
}

/**
 * Call `fn` with every chat card as it is posted, before it is recorded. The
 * class migration posts its card after its own changes and before the
 * follow-up subclass sync, so a snapshot taken there isolates its diff.
 * Returns a restore function.
 */
export function onCard(env, fn) {
	const original = env.ChatMessage.create;
	env.ChatMessage.create = async (data) => {
		fn(data);
		return original.call(env.ChatMessage, data);
	};
	return () => {
		env.ChatMessage.create = original;
	};
}

/** The `<li>` lines of a report card (raw HTML). */
export function cardLines(card) {
	return [...String(card?.content ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
}

/**
 * Run the full orchestrator for one actor, returning the class-migration diff
 * (before the follow-up subclass sync) and the final diff, plus the class
 * migration's chat card. `interactive: false` is the startup pass.
 */
export async function runMigration(env, migration, actor, direction, { interactive, ...answers } = {}) {
	const before = snapshot(actor);
	let preSync = null;
	let card = null;
	const from = env.ChatMessage.created.length;
	const restore = onCard(env, (data) => {
		if (/Class migration/.test(String(data?.content)) && !card) {
			card = data;
			preSync = snapshot(actor);
		}
	});
	script(env, answers);
	try {
		const result = await migration.migrateCoreClasses({ actors: [actor], direction, ...(interactive === undefined ? {} : { interactive }) });
		await env.flush?.();
		const after = snapshot(actor);
		return {
			result,
			card,
			cards: reportCards(env, from),
			before,
			after,
			migrationDiff: diff(before, preSync ?? after),
			finalDiff: diff(before, after),
		};
	} finally {
		restore();
	}
}
