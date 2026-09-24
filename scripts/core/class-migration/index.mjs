/**
 * Nim+ Package — core class migration (Heroes 2.0.3 ⇄ Nimble 0.2 playtest)
 *
 * The `playtestCoreClasses` setting decides which rules the *packs* offer
 * (`../supersede.mjs`). A character created before the switch still owns copies
 * of the other side's documents, and this module moves them across — at any
 * level, in either direction:
 *
 *   'to02'  — 2.0.3 → 0.2 (the default while the setting is on);
 *   'to203' — 0.2 → 2.0.3 (the default while it is off).
 *
 * ── The generic pass (this file + `./generic.mjs`) ─────────────────────────
 * For each character, from `flags.nim-plus-package.supersedes` on the Nim+ docs
 * and the list in `../supersede-retired.mjs`:
 *
 *   1. Replace in place — an owned item whose compendium source is superseded
 *      (to02) / is a Nim+ replacement (to203) is rewritten from the other side's
 *      document: name, img and `system` change; `_id`, flags (charge/dice pool
 *      state included) and actor-state fields (class level, rolled HP, stat
 *      picks, `grantedById`) are kept. When 0.2 merges several documents into
 *      one, the first owned copy is replaced and the rest removed.
 *   2. Remove — retired items (to02); 0.2-only items (to203). An auto-granted
 *      feature whose new version comes at a higher level than the character's
 *      is removed too; the level-up window grants it again when it is due.
 *   3. Add — auto-grant class features (a `<class>-progression` group or no
 *      group, not a subclass feature) of the character's class, gained at or
 *      below its class level, that it lacks: 0.2 documents (to02) or 2.0.3
 *      documents (to203).
 *   4. Report — picks in choice groups (Orders, Graces, Savage Arsenal, …) are
 *      never added or dropped by the generic pass; the preview lists them as
 *      "check by hand" unless a class module handles them.
 *
 * Subclass features the new side adds are left to the subclass sync
 * (`../subclass-sync.mjs`), which is run for the migrated characters right
 * after (with its own preview; "Later" there re-arms the sync's startup preview).
 * Where that sync cannot run — a player migrating their own character, or a
 * to02 run while the playtest setting is off — the migration adds the due 0.2
 * subclass features itself (step 5), listed in its own preview. The subclass sync's startup preview is also
 * started from here, after the migration's, and it skips any character whose
 * migration is still pending. Class migration moves a subclass item's source
 * onto the Nim+ copy, which is what makes the subclass sync take it on; the two
 * never touch the same item in the same pass — subclass sync only looks at items
 * sourced from the Nim+ subclass/feature packs, and class migration only at
 * items whose source is superseded, retired or a 0.2 document.
 *
 * ── Class modules (the part content work fills in) ─────────────────────────
 * What the generic pass cannot know lives in one module per core class:
 *
 *   ./classes/<classId>.mjs      — the class's own rules
 *   ./subclasses/<classId>.mjs   — that class's official subclasses (run after)
 *
 * `<classId>` is the class item's identifier: berserker, commander, hunter,
 * mage, oathsworn, shadowmancer, shepherd, songweaver, stormshifter, the-cheat,
 * zephyr. Each is optional (a missing file is skipped) and default-exports:
 *
 *   export default {
 *     classId: 'shepherd',
 *     // Preview lines (HTML; escape names with ctx.helpers.escape). Return a
 *     // line for EVERY change `migrate` would make — the preview is the GM's
 *     // only chance to see it. May be async.
 *     describe(actor, ctx) { return []; },
 *     // Runs after the generic pass has been applied to this actor, only if the
 *     // GM/owner confirmed a preview that contained this actor. May prompt
 *     // (ctx.helpers.promptChoice) — e.g. which grace to drop.
 *     async migrate(actor, ctx) {},
 *   };
 *
 * `ctx` (the same object is passed to describe and migrate for one class):
 *   direction   'to02' | 'to203'
 *   classId     the class identifier
 *   classItem   the owned class item
 *   level       the character's level in this class
 *   subclass    the owned subclass item of this class, or null
 *   data        the supersede data (`supersededBy`, `supersedes`, `playtestOnly`,
 *               `retired` — canonical UUIDs; see `../supersede.mjs`)
 *   plan        this actor's generic plan: { replacements: [{item, target}],
 *               removals: [{item, reason}], additions: [{doc}], manual: [html] }
 *               — read it to avoid doing the same thing twice; in `migrate` the
 *               generic steps have already been applied (replaced items keep
 *               their `_id`, so `actor.items.get(item.id)` is the new version)
 *   helpers     everything `./generic.mjs` exports (findOwnedBySource,
 *               findOwnedByName, loadDoc, replaceInPlace, addFeature,
 *               removeItems, promptChoice, classLevel, minLevel, escape, …)
 *
 * Note that a replacement does not re-run `grantItem` rules (they fire on
 * creation), and a pool whose identifier changed starts from its initial value;
 * a class module that renames a pool can carry the value across.
 *
 * ── Entry points ───────────────────────────────────────────────────────────
 *   await nimPlus.migrateCoreClasses();                       // preview, all characters
 *   await nimPlus.migrateCoreClasses({ actors: [actor] });
 *   await nimPlus.migrateCoreClasses({ classes: ['shepherd'], direction: 'to203' });
 *   await nimPlus.migrateCoreClasses({ apply: true });        // no preview
 *   nimPlus.syncCoreClasses                                   // alias
 *
 * On `ready` the GM gets the preview once per module version and direction; a
 * "Migrate class to 0.2 rules" (or "… to 2.0.3 rules") control in the character
 * sheet header runs it for that character, for the GM or the sheet's owner.
 * Nothing is written without that preview being confirmed (or `apply: true`).
 * Only world actors are covered — unlinked tokens keep their own copies.
 */
import { MODULE_ID } from '../constants.mjs';
import { sysId } from '../system.mjs';
import { playtestCoreClassesEnabled } from '../playtest-settings.mjs';
import { supersedeData } from '../supersede.mjs';
import { queueStartupPrompt } from '../startup-queue.mjs';
import { resetSubclassSyncStamp, runSubclassSyncStartup, syncSubclasses } from '../subclass-sync.mjs';
import * as generic from './generic.mjs';

const {
	FEATURE_INDEX_FIELDS,
	canonicalUuid,
	classItems,
	classLevel,
	escape,
	isAutoGrantGroup,
	itemSourceUuid,
	loadDoc,
	minLevel,
	readUnfilteredIndex,
	replacementUpdate,
	creationData,
} = generic;

export const CORE_CLASS_IDS = [
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

const VERSION_SETTING = 'classMigrationVersion';
const NIM_FEATURE_PACK = `${MODULE_ID}.nim-plus-class-features`;
const SYSTEM_FEATURE_PACK = 'nimble-class-features';

const DIRECTION_LABEL = { to02: 'Nimble 0.2 playtest', to203: 'Heroes 2.0.3' };

export function defaultDirection() {
	return playtestCoreClassesEnabled() ? 'to02' : 'to203';
}

/* ───────────────────────────── class modules ───────────────────────────── */

const moduleCache = new Map();

/** `./<kind>/<classId>.mjs`'s default export, or null if there is none. */
async function loadClassModule(kind, classId) {
	const key = `${kind}/${classId}`;
	if (moduleCache.has(key)) return moduleCache.get(key);
	let mod = null;
	if (CORE_CLASS_IDS.includes(classId)) {
		try {
			mod = (await import(`./${kind}/${classId}.mjs`)).default ?? null;
		} catch (error) {
			console.warn(`${MODULE_ID} | class migration: no ${key}.mjs (skipped)`, error);
		}
	}
	moduleCache.set(key, mod);
	return mod;
}

async function describeWith(mod, actor, ctx) {
	if (typeof mod?.describe !== 'function') return [];
	try {
		const lines = await mod.describe(actor, ctx);
		return Array.isArray(lines) ? lines.filter(Boolean).map(String) : [];
	} catch (error) {
		console.error(`${MODULE_ID} | class migration: ${mod.classId ?? '?'} describe failed`, error);
		return [`<em>Class-specific step failed to preview — see the console.</em>`];
	}
}

/* ───────────────────────────── planning ───────────────────────────── */

/**
 * The auto-grant class features of the side being migrated to, per class.
 * Read unfiltered: the migration may run against the setting's direction, and
 * the index the players see is filtered.
 */
async function loadProgression(direction) {
	const collection = direction === 'to02' ? NIM_FEATURE_PACK : `${sysId()}.${SYSTEM_FEATURE_PACK}`;
	const pack = game.packs.get(collection);
	const progression = new Map();
	const choiceGroups = new Map();
	if (!pack) return { progression, choiceGroups };

	const entries = await readUnfilteredIndex(pack, FEATURE_INDEX_FIELDS);
	for (const entry of entries) {
		if (entry.type !== 'feature' || entry.system?.subclass) continue;
		const cls = entry.system?.class;
		if (!cls) continue;
		if (direction === 'to02') {
			const flags = entry.flags?.[MODULE_ID] ?? {};
			const is02 = flags.playtest02 === true || (Array.isArray(flags.supersedes) && flags.supersedes.length > 0);
			if (!is02) continue;
			if (!isAutoGrantGroup(entry.system.group)) {
				if (!choiceGroups.has(cls)) choiceGroups.set(cls, new Map());
				const groups = choiceGroups.get(cls);
				groups.set(entry.system.group, Math.min(groups.get(entry.system.group) ?? Infinity, minLevel(entry)));
				continue;
			}
		} else if (!isAutoGrantGroup(entry.system?.group)) {
			continue;
		}
		if (!progression.has(cls)) progression.set(cls, []);
		progression.get(cls).push(entry);
	}
	return { progression, choiceGroups };
}

/**
 * Does the follow-up subclass sync (run after an applied migration) add the
 * subclass features the new side brings? Only for a GM (the sync writes for
 * GMs only) and only on the setting's own side (while the setting is off, a
 * character that owns 0.2 documents is "pending" and the sync skips it, and
 * the 0.2 features are hidden from it anyway). `to203` never needs it: the
 * subclass item goes back to the system pack, which the sync leaves alone, and
 * `./subclasses/restore-203.mjs` re-adds 2.0.3 features.
 */
function subclassSyncCovers(direction) {
	if (direction !== 'to02') return true;
	return Boolean(game.user?.isGM) && playtestCoreClassesEnabled();
}

/** Subclass-feature entries of the Nim+ feature pack, unfiltered (the step may run against the setting). */
async function loadSubclassFeatureIndex() {
	const pack = game.packs.get(NIM_FEATURE_PACK);
	if (!pack) return [];
	const entries = await readUnfilteredIndex(pack, [...FEATURE_INDEX_FIELDS, 'system.identifier']);
	return entries.filter((e) => e.type === 'feature' && e.system?.subclass && e.system?.group && e.system?.class);
}

async function buildContext(direction) {
	const data = await supersedeData();
	const { progression, choiceGroups } = await loadProgression(direction);
	const subclassStep = !subclassSyncCovers(direction);
	const subclassFeatures = subclassStep ? await loadSubclassFeatureIndex() : [];
	return { direction, data, progression, choiceGroups, subclassStep, subclassFeatures, docs: new Map() };
}

async function cachedDoc(base, uuid) {
	if (!base.docs.has(uuid)) base.docs.set(uuid, await loadDoc(uuid));
	return base.docs.get(uuid);
}

function groupLabel(group) {
	return String(group ?? '').replace(/-/g, ' ');
}

/** Auto-granted: a subclass feature, or a class feature in a progression group. */
function isAutoGranted(doc) {
	return doc?.type === 'feature' && (doc.system?.subclass || isAutoGrantGroup(doc.system?.group));
}

/**
 * @typedef {object} ActorPlan
 * @property {Actor} actor
 * @property {{item: Item, target: Item}[]} replacements
 * @property {{item: Item, reason: string}[]} removals
 * @property {{doc: Item, reason: string}[]} additions
 * @property {string[]} manual           "check by hand" lines (HTML)
 * @property {{ctx: object, modules: object[], lines: string[], name: string}[]} classes
 */

/**
 * `(entry, classId) → boolean`: will the actor, once steps 1–2 of `plan` are
 * applied, own a copy of the progression feature `entry` that it did not get
 * from the pack (hand-made, or sourced elsewhere)? Removed items do not count;
 * a replaced item counts under its current name or its target's; and only
 * features of the same scope count: a class feature of this class (or of no
 * class) in the same group, never a subclass feature that shares the name (the
 * 0.2 Mercy L7 "Searing Light" is not the Shepherd's L1 Searing Light).
 */
function ownedCopyCheck(actor, plan) {
	const removed = new Set(plan.removals.map((r) => r.item.id));
	const replacedBy = new Map(plan.replacements.map((r) => [r.item.id, r.target]));
	const norm = (name) => String(name ?? '').trim().toLowerCase();
	return (entry, classId) => {
		const name = norm(entry.name);
		const group = entry.system?.group || null;
		const matches = (doc) => {
			if (!doc || doc.type !== 'feature' || doc.system?.subclass) return false;
			if (doc.system?.class && doc.system.class !== classId) return false;
			if (group && doc.system?.group && doc.system.group !== group) return false;
			return norm(doc.name) === name;
		};
		// An item being replaced still counts under its current name: a class
		// module may be handling that feature itself (the 2.0.3 Windbag).
		return actor.items.some((item) => !removed.has(item.id) && (matches(item) || matches(replacedBy.get(item.id))));
	};
}

/**
 * Step 5 (to02, only when the follow-up subclass sync will not — see
 * `subclassSyncCovers`): the 0.2 subclass features the character is due that
 * it will not own once the plan is applied. Mirrors what the sync would add: for
 * each owned subclass that ends up a Nim+ 0.2 document, every feature of its
 * group in the Nim+ feature pack gained at or below the class level, except
 * documents 0.2 supersedes or retires; "owned" is by compendium source (as the
 * plan leaves it), or by identifier for a source-less copy.
 */
async function planSubclassAdditions(actor, base, plan, inScope, ownedClassIds) {
	const { data } = base;
	const removed = new Set(plan.removals.map((r) => r.item.id));
	const replacedBy = new Map(plan.replacements.map((r) => [r.item.id, r.target]));
	const out = [];
	for (const item of actor.items) {
		if (item.type !== 'subclass' || removed.has(item.id)) continue;
		const doc = replacedBy.get(item.id) ?? item;
		const cls = doc.system?.parentClass;
		if (!cls || !inScope(cls) || !ownedClassIds.has(cls)) continue;
		const src = replacedBy.has(item.id) ? canonicalUuid(doc.uuid) : itemSourceUuid(item);
		if (!src || !(data.supersedes.has(src) || data.playtestOnly.has(src))) continue;
		const group = doc.system?.identifier;
		if (!group) continue;
		const level = classLevel(actor, cls);
		const wanted = base.subclassFeatures.filter((e) => {
			if (e.system.class !== cls || e.system.group !== group || minLevel(e) > level) return false;
			const uuid = canonicalUuid(e.uuid);
			return uuid && !data.supersededBy.has(uuid) && !data.retired.has(uuid);
		});
		if (!wanted.length) continue;
		const { sources, identifiers } = subclassFeaturesAfterPlan(actor, cls, [group, item.system?.identifier], plan);
		for (const entry of wanted) {
			const uuid = canonicalUuid(entry.uuid);
			if (sources.has(uuid) || identifiers.has(entry.system?.identifier)) continue;
			const feature = await cachedDoc(base, uuid);
			if (feature) out.push({ doc: feature, subclass: doc.name, group, cls });
		}
	}
	return out;
}

/**
 * The subclass features of `cls` the actor owns once `plan` (or nothing, with
 * `plan` null) is applied: their compendium sources, and the identifiers of
 * source-less copies in one of `groups`.
 */
function subclassFeaturesAfterPlan(actor, cls, groups, plan) {
	const removed = new Set((plan?.removals ?? []).map((r) => r.item.id));
	const replacedBy = new Map((plan?.replacements ?? []).map((r) => [r.item.id, r.target]));
	const sources = new Set((plan?.additions ?? []).map((a) => canonicalUuid(a.doc.uuid)).filter(Boolean));
	const identifiers = new Set();
	for (const item of actor.items) {
		if (removed.has(item.id)) continue;
		const target = replacedBy.get(item.id);
		const src = target ? canonicalUuid(target.uuid) : itemSourceUuid(item);
		if (src) {
			sources.add(src);
			continue;
		}
		const sys = item.system ?? {};
		if (item.type === 'feature' && sys.subclass && sys.class === cls && groups.includes(sys.group) && sys.identifier) {
			identifiers.add(sys.identifier);
		}
	}
	return { sources, identifiers };
}

async function planActor(actor, base, classFilter) {
	const { direction, data } = base;
	const plan = { actor, replacements: [], removals: [], additions: [], manual: [], classes: [] };
	const owned = classItems(actor).filter((c) => CORE_CLASS_IDS.includes(c.system?.identifier));
	const ownedClassIds = new Set(owned.map((c) => c.system.identifier));
	const inScope = (cls) => !classFilter || !cls || classFilter.has(cls);
	const claimed = new Set();
	const manualGroups = new Map(); // class → Set<group>

	// Steps 1 and 2 — every owned item whose source the other side replaces or drops.
	for (const item of actor.items) {
		const src = itemSourceUuid(item);
		if (!src) continue;
		const cls =
			item.type === 'class'
				? item.system?.identifier
				: item.type === 'subclass'
					? item.system?.parentClass
					: item.system?.class || null;
		if (!inScope(cls)) continue;

		let targetUuid = null;
		if (direction === 'to02') {
			if (data.retired.has(src)) {
				plan.removals.push({ item, reason: 'retired in 0.2' });
				continue;
			}
			targetUuid = data.supersededBy.get(src) ?? null;
		} else {
			const replaced = data.supersedes.get(src);
			if (replaced?.length) {
				targetUuid = replaced[0];
				if (replaced.length > 1) {
					plan.manual.push(
						`${escape(item.name)} replaces ${replaced.length} 2.0.3 documents; only the first is restored — add the others by hand if the character had them`,
					);
				}
			} else if (data.playtestOnly.has(src)) {
				plan.removals.push({ item, reason: 'not in 2.0.3' });
				if (item.type === 'feature' && !isAutoGranted(item)) {
					plan.manual.push(`${escape(item.name)} was a 0.2 pick — choose a 2.0.3 replacement by hand`);
				}
				continue;
			}
		}
		if (!targetUuid) continue;

		if (claimed.has(targetUuid)) {
			const merged = await cachedDoc(base, targetUuid);
			plan.removals.push({ item, reason: `merged into ${merged?.name ?? 'another feature'}` });
			continue;
		}
		const target = await cachedDoc(base, targetUuid);
		if (!target) {
			plan.manual.push(`${escape(item.name)}: its replacement (${escape(targetUuid)}) could not be loaded`);
			continue;
		}
		claimed.add(targetUuid);

		// A feature the new rules grant later than this character's level.
		const tcls = target.system?.class;
		if (target.type === 'feature' && tcls && ownedClassIds.has(tcls)) {
			const level = classLevel(actor, tcls);
			const gained = minLevel(target);
			if (gained > level) {
				if (isAutoGranted(target)) {
					plan.removals.push({ item, reason: `now gained at level ${gained}` });
					continue;
				}
				if (!manualGroups.has(tcls)) manualGroups.set(tcls, new Set());
				manualGroups.get(tcls).add(target.system.group);
				plan.manual.push(
					`${escape(item.name)} is now chosen at level ${gained} (character is ${level}) — check by hand`,
				);
			}
		}
		plan.replacements.push({ item, target });
	}

	// Step 3 — missing auto-grants of each owned class.
	const ownsCopy = ownedCopyCheck(actor, plan);
	for (const classItem of owned) {
		const classId = classItem.system.identifier;
		if (!inScope(classId)) continue;
		const level = classLevel(actor, classId);
		for (const entry of base.progression.get(classId) ?? []) {
			if (minLevel(entry) > level) continue;
			const uuid = canonicalUuid(entry.uuid);
			if (!uuid || claimed.has(uuid)) continue;
			if (generic.findOwnedBySource(actor, [uuid]).length) continue;
			// A hand-made or otherwise-sourced copy of the same feature.
			if (ownsCopy(entry, classId)) continue;
			const doc = await cachedDoc(base, uuid);
			if (!doc) continue;
			claimed.add(uuid);
			plan.additions.push({ doc, reason: `level ${minLevel(entry)}` });
		}

		// Step 4 — choice groups that 0.2 changed, reported only.
		const groups = new Set(manualGroups.get(classId) ?? []);
		if (direction === 'to02') {
			for (const [group, from] of base.choiceGroups.get(classId) ?? []) if (from <= level) groups.add(group);
		}
		if (groups.size) {
			plan.manual.push(
				`${escape(classItem.name)}: 0.2 changed ${[...groups].map((g) => `<em>${escape(groupLabel(g))}</em>`).join(', ')} — check the character's picks by hand`,
			);
		}
	}

	// Step 5 — 0.2 subclass features the follow-up subclass sync will not add.
	plan.subclassAdditions = base.subclassStep
		? await planSubclassAdditions(actor, base, plan, inScope, ownedClassIds)
		: [];

	// Class modules.
	for (const classItem of owned) {
		const classId = classItem.system.identifier;
		if (!inScope(classId)) continue;
		const subclass =
			actor.items.find((i) => i.type === 'subclass' && i.system?.parentClass === classId) ?? null;
		const ctx = {
			direction,
			classId,
			classItem,
			level: classLevel(actor, classId),
			subclass,
			data,
			plan,
			helpers: generic,
		};
		const modules = [await loadClassModule('classes', classId), await loadClassModule('subclasses', classId)].filter(Boolean);
		const lines = [];
		for (const mod of modules) lines.push(...(await describeWith(mod, actor, ctx)));
		plan.classes.push({ ctx, modules, lines, name: classItem.name });
	}

	const changes =
		plan.replacements.length ||
		plan.removals.length ||
		plan.additions.length ||
		plan.subclassAdditions.length ||
		plan.classes.some((c) => c.lines.length);
	return changes ? plan : null;
}

/** @returns {Promise<ActorPlan[]>} */
export async function planCoreClassMigration({ actors, classes, direction = defaultDirection() } = {}) {
	const base = await buildContext(direction);
	const classFilter = classes?.length ? new Set(classes) : null;
	const list = actors ?? game.actors.filter((a) => a.type === 'character');
	const out = [];
	for (const actor of list) {
		if (actor?.type !== 'character') continue;
		try {
			const plan = await planActor(actor, base, classFilter);
			if (plan) out.push(plan);
		} catch (error) {
			console.error(`${MODULE_ID} | class migration: could not plan ${actor.name}`, error);
		}
	}
	return out;
}

/* ───────────────────────────── applying ───────────────────────────── */

export async function applyCoreClassMigration(report, direction) {
	const touched = [];
	for (const plan of report) {
		const { actor } = plan;
		try {
			const removals = plan.removals.map((r) => r.item.id).filter((id) => actor.items.has(id));
			const updates = plan.replacements
				.filter((r) => actor.items.has(r.item.id))
				.map((r) => replacementUpdate(r.item, r.target));
			const creations = plan.additions.map((a) => creationData(a.doc));
			if (removals.length) await actor.deleteEmbeddedDocuments('Item', removals);
			if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
			if (creations.length) await actor.createEmbeddedDocuments('Item', creations);

			for (const { ctx, modules } of plan.classes) {
				for (const mod of modules) {
					if (typeof mod.migrate !== 'function') continue;
					try {
						await mod.migrate(actor, ctx);
					} catch (error) {
						console.error(`${MODULE_ID} | class migration: ${mod.classId ?? ctx.classId} step failed on ${actor.name}`, error);
						ui.notifications?.error(
							`Nim+ | ${actor.name}: the ${ctx.classId} migration step failed — see the console.`,
						);
					}
				}
			}
			// Step 5 — previewed 0.2 subclass features, re-checked against the actor as
			// it now is (a class module may have added one already).
			let subclassAdded = 0;
			if (plan.subclassAdditions?.length) {
				const docs = plan.subclassAdditions
					.filter(({ doc, cls, group }) => {
						const { sources, identifiers } = subclassFeaturesAfterPlan(actor, cls, [group], null);
						return !sources.has(canonicalUuid(doc.uuid)) && !identifiers.has(doc.system?.identifier);
					})
					.map((a) => a.doc);
				if (docs.length) subclassAdded = (await generic.addFeature(actor, docs)).length;
			}

			touched.push(actor);
			console.log(
				`${MODULE_ID} | ${actor.name}: class migration (${direction}) — ` +
					`${updates.length} replaced, ${removals.length} removed, ${creations.length + subclassAdded} added`,
			);
		} catch (error) {
			console.error(`${MODULE_ID} | class migration failed on ${actor.name}`, error);
			ui.notifications?.error(`Nim+ | Class migration failed on ${actor.name} — see the console.`);
		}
	}
	return touched;
}

/* ───────────────────────────── UI ───────────────────────────── */

function renderReport(report, direction) {
	const parts = [];
	for (const plan of report) {
		const lines = [];
		for (const { item, target } of plan.replacements) {
			lines.push(
				item.name !== target.name
					? `Replaced: ${escape(item.name)} → <strong>${escape(target.name)}</strong>`
					: `Updated: ${escape(item.name)}`,
			);
		}
		for (const { item, reason } of plan.removals) {
			lines.push(`Removed: <s>${escape(item.name)}</s> <em>(${escape(reason)})</em>`);
		}
		for (const { doc, reason } of plan.additions) {
			lines.push(`Added: <strong>${escape(doc.name)}</strong> <em>(${escape(reason)})</em>`);
		}
		for (const { doc, subclass } of plan.subclassAdditions ?? []) {
			lines.push(
				`Added: <strong>${escape(doc.name)}</strong> <em>(${escape(subclass)} 0.2 feature, level ${minLevel(doc)})</em>`,
			);
		}
		for (const { lines: extra } of plan.classes) lines.push(...extra);
		for (const note of plan.manual) lines.push(`<i class="fa-solid fa-hand"></i> ${note}`);

		const heading = plan.classes.map((c) => `${escape(c.name)} ${c.ctx.level}`).join(' / ');
		parts.push(
			`<h4 style="margin:.5em 0 .2em">${escape(plan.actor.name)}${heading ? ` — ${heading}` : ''}</h4>` +
				`<ul style="margin:0 0 .4em 1.2em">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`,
		);
	}
	return (
		`<p>Converts these characters to the <strong>${DIRECTION_LABEL[direction]}</strong> class rules. ` +
		`Items are rewritten in place: their ids, flags and charge/dice pool values are kept, and the sheet's +/- ` +
		`still corrects any pool afterwards. Lines marked <i class="fa-solid fa-hand"></i> are left for you to check.</p>` +
		`<div style="max-height:60vh;overflow:auto">${parts.join('')}</div>`
	);
}

/**
 * Preview and (optionally) apply the core class migration.
 * @param {object} [options]
 * @param {Actor[]} [options.actors]     restrict to these actors (default: all world characters)
 * @param {string[]} [options.classes]   restrict to these class identifiers
 * @param {'to02'|'to203'} [options.direction]  default: from the playtest setting
 * @param {boolean} [options.apply]      apply without a preview dialog
 * @param {boolean} [options.silent]     no "nothing to do" notification
 * @returns {Promise<'applied'|'postponed'|'nothing'>}
 */
export async function migrateCoreClasses({
	actors,
	classes,
	direction = defaultDirection(),
	apply = false,
	silent = false,
} = {}) {
	if (direction !== 'to02' && direction !== 'to203') {
		ui.notifications?.error(`Nim+ | Unknown migration direction "${direction}" (use 'to02' or 'to203').`);
		return 'nothing';
	}
	let list = actors;
	if (!game.user?.isGM) {
		list = (actors ?? []).filter((a) => a?.isOwner);
		if (!list.length) {
			ui.notifications?.warn('Nim+ | You can only migrate characters you own.');
			return 'nothing';
		}
	}

	const report = await planCoreClassMigration({ actors: list, classes, direction });
	if (!report.length) {
		if (!silent) ui.notifications?.info(`Nim+ | Already on the ${DIRECTION_LABEL[direction]} class rules.`);
		return 'nothing';
	}

	let go = apply;
	if (!go) {
		go = await foundry.applications.api.DialogV2.wait({
			window: {
				title: `Nim+ | Migrate classes to ${DIRECTION_LABEL[direction]}`,
				icon: 'fa-solid fa-arrows-rotate',
			},
			position: { width: 600 },
			content: renderReport(report, direction),
			buttons: [
				{ action: 'apply', label: 'Apply', icon: 'fa-solid fa-check', default: true, callback: () => true },
				{ action: 'later', label: 'Later', icon: 'fa-solid fa-clock', callback: () => false },
			],
			rejectClose: false,
		});
	}
	if (!go) return 'postponed';

	const touched = await applyCoreClassMigration(report, direction);
	ui.notifications?.info(
		`Nim+ | Classes migrated to ${DIRECTION_LABEL[direction]} on ${touched.length} character${touched.length === 1 ? '' : 's'}.`,
	);

	// Subclass features the new side adds (see the header). A player's migration
	// (and a to02 run against the setting) added them itself, in step 5.
	if (touched.length && game.user?.isGM) {
		try {
			const synced = await syncSubclasses({ actors: touched, silent: true });
			// Postponed: make the next startup sync offer it again.
			if (synced === 'postponed') await resetSubclassSyncStamp();
		} catch (error) {
			console.error(`${MODULE_ID} | subclass sync after class migration failed`, error);
		}
	}
	return 'applied';
}

/* ───────────────────────────── sheet header ───────────────────────────── */

Hooks.on('getHeaderControlsActorSheetV2', (app, controls) => {
	try {
		const actor = app?.document;
		if (!(actor instanceof Actor) || actor.type !== 'character') return;
		if (!(game.user?.isGM || actor.isOwner)) return;
		if (!classItems(actor).some((c) => CORE_CLASS_IDS.includes(c.system?.identifier))) return;
		const direction = defaultDirection();
		controls.push({
			action: 'nimPlusMigrateClass',
			icon: 'fa-solid fa-arrows-rotate',
			label: direction === 'to02' ? 'Migrate class to 0.2 rules' : 'Migrate class to 2.0.3 rules',
			visible: true,
			onClick: () =>
				migrateCoreClasses({ actors: [actor], direction }).catch((error) =>
					console.error(`${MODULE_ID} | class migration failed`, error),
				),
		});
	} catch (error) {
		console.error(`${MODULE_ID} | could not add the class migration control`, error);
	}
});

/* ───────────────────────────── startup ───────────────────────────── */

Hooks.once('init', () => {
	game.settings.register(MODULE_ID, VERSION_SETTING, {
		scope: 'world',
		config: false,
		type: String,
		default: '',
	});
});

// The migration preview first, then the subclass sync's own startup preview —
// in that order, so the sync never plans against un-migrated characters.
Hooks.once('ready', () => {
	if (!game.user?.isGM) return;
	const direction = defaultDirection();
	const stamp = `${game.modules.get(MODULE_ID)?.version ?? ''}|${direction}`;
	queueStartupPrompt(async () => {
		if (game.settings.get(MODULE_ID, VERSION_SETTING) === stamp) return;
		try {
			const result = await migrateCoreClasses({ direction, silent: true });
			if (result !== 'postponed') await game.settings.set(MODULE_ID, VERSION_SETTING, stamp);
		} catch (error) {
			console.error(`${MODULE_ID} | class migration failed`, error);
		}
	});
	queueStartupPrompt(runSubclassSyncStartup);
});

export const syncCoreClasses = migrateCoreClasses;
