/**
 * Local helpers for the migration-classes-b area (stormshifter, shadowmancer,
 * songweaver, the-cheat, zephyr + their official subclasses, restore-203).
 *
 * Harness workaround (see the bug file's "Gaps"): the harness `slugify` does
 * not apply Foundry's CHAR_MAP, so "Circle of Fang & Claw" slugs to
 * "circle-of-fang--claw" instead of Foundry's "circle-of-fang-and-claw". That
 * breaks three things for that one subclass in the harness only: the builder
 * never finds its features, restore-203's `name.slugify()` misses its group,
 * and the subclass sync's (prepared) identifier misses its group. We
 *   - patch `String.prototype.slugify` with Foundry's real algorithm (CHAR_MAP
 *     for the characters our names use),
 *   - rename the subclass in the INSTALLED packs to "Circle of Fang and Claw"
 *     (whose harness slug equals Foundry's slug of the real name), so the
 *     harness-prepared `system.identifier` the subclass sync reads matches;
 *   - build characters' subclass features ourselves with the real slug.
 */
import {
	buildCharacterAtLevel,
	loadPackData,
	setupWorld,
	snapshotItems,
	sourceOf,
	supersedeOracle,
	visibleDocs,
} from '../harness/index.mjs';

export const NIM_FEATURES = 'Compendium.nim-plus-package.nim-plus-class-features.Item.';
export const SYS_FEATURES = 'Compendium.nimble.nimble-class-features.Item.';
export const NIM_SPELLS = 'Compendium.nim-plus-package.nim-plus-spells.Item.';
export const SYS_SPELLS = 'Compendium.nimble.nimble-spells.Item.';

export const LEVELS = Array.from({ length: 20 }, (_, i) => i + 1);

const CHAR_MAP = { '&': 'and', $: 'dollar', '%': 'percent', '<': 'less', '>': 'greater', '|': 'or' };

/** Foundry v13/v14 `String.prototype.slugify` (common/primitives/string.mjs), CHAR_MAP subset. */
export function foundrySlugify(str, { replacement = '-', strict = false, lowercase = true } = {}) {
	let slug = String(str)
		.split('')
		.reduce((r, c) => r + (CHAR_MAP[c] || c), '')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim();
	if (lowercase) slug = slug.toLowerCase();
	slug = slug.replace(new RegExp(`[\\s${replacement}]+`, 'g'), replacement);
	if (strict) slug = slug.replace(new RegExp(`[^a-zA-Z0-9${replacement}]`, 'g'), '');
	return slug;
}

export const FANG_AND_CLAW = 'Circle of Fang & Claw';

function fixFangAndClaw(doc) {
	if (doc.type === 'subclass' && doc.name === FANG_AND_CLAW) doc.name = 'Circle of Fang and Claw';
	return doc;
}

/**
 * A world. `playtest` defaults to the direction (so the subclass sync runs as
 * it does in play); pass it explicitly for "against the setting" runs.
 */
export async function world(direction = 'to02', { playtest, ...opts } = {}) {
	const { env, mods } = await setupWorld({
		playtest: playtest ?? direction === 'to02',
		packs: { transform: fixFangAndClaw },
		...opts,
	});
	Object.defineProperty(String.prototype, 'slugify', {
		value: function slugify(o) {
			return foundrySlugify(this, o);
		},
		configurable: true,
		writable: true,
	});
	return { env, migration: mods[3], sync: mods[2], supersede: mods[1] };
}

/**
 * "Reload" into a world whose playtest setting matches `direction` (the setting
 * requires a reload): a fresh environment with the actor re-created from its
 * persisted data, as Foundry would load it.
 */
export async function reloadFor(direction, actor, opts = {}) {
	const w = await world(direction, opts);
	const copy = new w.env.classes.Actor(actor.toObject());
	w.env.game.actors.set(copy.id, copy);
	return { ...w, actor: copy };
}

export function sourceVersion(direction) {
	return direction === 'to02' ? '2.0.3' : '0.2';
}
export function targetVersion(direction) {
	return direction === 'to02' ? '0.2' : '2.0.3';
}
export function other(direction) {
	return direction === 'to02' ? 'to203' : 'to02';
}

function minLevelOf(doc) {
	const s = doc.system ?? {};
	const l =
		Array.isArray(s.gainedAtLevels) && s.gainedAtLevels.length
			? s.gainedAtLevels
			: Number.isFinite(s.gainedAtLevel)
				? [s.gainedAtLevel]
				: [];
	return l.length ? Math.min(...l) : Infinity;
}

/** Subclass features of `subclassName` for `version` at `level`, grouped by Foundry's real slug. */
export async function subclassFeatureUuids(classId, subclassName, level, version) {
	const group = foundrySlugify(subclassName, { strict: true });
	const out = [];
	for (const e of await visibleDocs(version)) {
		const s = e.doc.system ?? {};
		if (e.doc.type !== 'feature' || !s.subclass || s.class !== classId || s.group !== group) continue;
		if (minLevelOf(e.doc) > level) continue;
		out.push(e.uuid);
	}
	return out;
}

/** buildCharacterAtLevel + subclass features found with Foundry's slug. */
export async function buildChar(env, classId, level, opts = {}) {
	const features = [...(opts.features ?? [])];
	if (opts.subclass) features.push(...(await subclassFeatureUuids(classId, opts.subclass, level, opts.version ?? '2.0.3')));
	return buildCharacterAtLevel(env, classId, level, { ...opts, features });
}

/** A dialog matcher on the window title only (content may mention anything). */
export function title(re) {
	return (config) => re.test(config?.window?.title ?? config?.title ?? '');
}

/**
 * Run the orchestrator with scripted answers (the class-module prompts; the
 * migration and the subclass sync no longer show a preview dialog). `answers`
 * are [titleRegExp, answer] pairs. `interactive: false` is the startup pass;
 * `apply: false` a dry run.
 *
 * Returns the class migration's chat card as `card` (and as `preview`, whose
 * `content` the preview checks read), the item snapshot taken when that card
 * was posted — after the class migration, before the follow-up subclass sync —
 * as `preSync`, and the dialog log of the run.
 */
export async function runMigration(env, migration, actor, direction, { answers = [], classes, interactive, apply } = {}) {
	for (const [m, a] of answers) env.dialogs.answerWhen(m instanceof RegExp ? title(m) : m, a);
	const mine = answers.length ? env.dialogs.queue.slice(-answers.length) : [];
	const logFrom = env.dialogs.log.length;
	let card = null;
	let preSync = null;
	const original = env.ChatMessage.create;
	env.ChatMessage.create = async (data) => {
		if (!card && /Class migration/.test(String(data?.content))) {
			card = data;
			preSync = snapshotItems(actor);
		}
		return original.call(env.ChatMessage, data);
	};
	let result;
	try {
		result = await migration.migrateCoreClasses({
			actors: [actor],
			direction,
			classes,
			...(interactive === undefined ? {} : { interactive }),
			...(apply === undefined ? {} : { apply }),
		});
	} finally {
		env.ChatMessage.create = original;
	}
	const log = env.dialogs.log.slice(logFrom);
	const unused = mine.filter((e) => env.dialogs.queue.includes(e)).length;
	env.dialogs.queue.splice(0);
	return { result, log, unused, card, preview: card, preSync };
}

/** Sorted list of "type|source-or-name" for every owned item. */
export function state(actor, { exclude } = {}) {
	return actor.items
		.filter((i) => !exclude || !exclude(i))
		.map((i) => `${i.type}|${sourceOf(i) ?? `name:${i.name}`}`)
		.sort();
}

/** Human-readable version of `state`, for failure messages. */
export function label(key) {
	const [type, src] = key.split('|');
	const doc = loadPackData().byUuid.get(src);
	return `${type}:${doc?.name ?? src}${src?.includes('nim-plus') ? '[N]' : src?.startsWith('name:') ? '' : '[S]'}`;
}

export function namesOf(actor, filter = () => true) {
	return actor.items.filter(filter).map((i) => i.name).sort();
}

/** Multiset difference of two state lists, labelled. */
export function diff(a, b) {
	const count = (l) => l.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
	const ca = count(a);
	const cb = count(b);
	const onlyA = [];
	const onlyB = [];
	for (const [k, n] of ca) for (let i = 0; i < n - (cb.get(k) ?? 0); i++) onlyA.push(label(k));
	for (const [k, n] of cb) for (let i = 0; i < n - (ca.get(k) ?? 0); i++) onlyB.push(label(k));
	return { extra: onlyA.sort(), missing: onlyB.sort() };
}

/* ───────────────────────────── preview vs effects ───────────────────────────── */

export function decode(html) {
	return String(html)
		.replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.trim();
}

/** The `<li>` lines of a report card's (or preview's) content (raw HTML). */
export function previewLines(content) {
	return [...String(content ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
}

/** What a run did to an actor's items, by id (`actor` may be an actor or a `snapshotItems` map). */
export function effects(before, actor) {
	const after = actor?.items ? Object.fromEntries(actor.items.map((i) => [i.id, i.toObject()])) : actor;
	const src = (o) => o?._stats?.compendiumSource ?? o?.flags?.core?.sourceId ?? null;
	const added = [];
	const removed = [];
	const replaced = [];
	for (const [id, o] of Object.entries(after)) {
		if (!before[id]) added.push(o.name);
		else if (src(before[id]) !== src(o) || before[id].name !== o.name) replaced.push({ from: before[id].name, to: o.name });
	}
	for (const [id, o] of Object.entries(before)) if (!after[id]) removed.push(o.name);
	return { added: added.sort(), removed: removed.sort(), replaced };
}

/**
 * Cross-check a preview against what happened. Returns a list of problems
 * (empty = consistent). `picked` = names added through a pick prompt (they are
 * announced as "you will be asked…", not by name).
 */
export function checkPreview(content, fx, { picked = [] } = {}) {
	const text = previewLines(content).map(decode);
	const problems = [];
	const mentions = (name, re) => text.some((t) => t.includes(name) && re.test(t));

	// Every effect is announced.
	for (const name of fx.removed) {
		if (!mentions(name, /remov|retired|merge/i)) problems.push(`removed without a preview line: ${name}`);
	}
	const pickedLeft = [...picked];
	for (const name of fx.added) {
		const i = pickedLeft.indexOf(name);
		if (i >= 0) {
			pickedLeft.splice(i, 1);
			if (!text.some((t) => /asked to choose/i.test(t))) problems.push(`prompt pick without an announcement: ${name}`);
			continue;
		}
		if (!mentions(name, /add/i)) problems.push(`added without a preview line: ${name}`);
	}
	for (const { from, to } of fx.replaced) {
		const ok = text.some((t) => (from === to ? t === `Updated: ${from}` : t === `Replaced: ${from} → ${to}`));
		if (!ok) problems.push(`replaced without a preview line: ${from} → ${to}`);
	}

	// Every announced Added/Removed/Replaced/Updated happened.
	const addedLeft = [...fx.added];
	const removedLeft = [...fx.removed];
	for (const t of text) {
		let m;
		if ((m = /^Added: (.+) \([^()]+\)$/.exec(t))) {
			const i = addedLeft.indexOf(m[1]);
			if (i < 0) problems.push(`preview says added but not added: ${m[1]}`);
			else addedLeft.splice(i, 1);
		} else if ((m = /^Removed: (.+) \([^()]+\)$/.exec(t))) {
			const i = removedLeft.indexOf(m[1]);
			if (i < 0) problems.push(`preview says removed but not removed: ${m[1]}`);
			else removedLeft.splice(i, 1);
		} else if ((m = /^Replaced: (.+?) → (.+)$/.exec(t))) {
			if (!fx.replaced.some((r) => r.from === m[1] && r.to === m[2])) problems.push(`preview says replaced but was not: ${m[1]} → ${m[2]}`);
		} else if ((m = /^Updated: (.+)$/.exec(t))) {
			if (!fx.replaced.some((r) => r.from === m[1] && r.to === m[1])) problems.push(`preview says updated but was not: ${m[1]}`);
		}
	}
	return problems;
}

export { buildCharacterAtLevel, loadPackData, snapshotItems, sourceOf, supersedeOracle };
