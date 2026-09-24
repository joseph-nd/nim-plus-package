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
 *      never added or dropped by the generic pass; the report lists them as
 *      "check by hand" unless a class module handles them.
 *
 * Subclass features the new side adds are left to the subclass sync
 * (`../subclass-sync.mjs`), which is run for the migrated characters right
 * after (applied straight away, with its own toast and chat card).
 * Where that sync cannot run — a player migrating their own character, or a
 * to02 run while the playtest setting is off — the migration adds the due 0.2
 * subclass features itself (step 5), listed in its own report. The subclass sync's startup pass is also
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
 *     // Report lines (HTML; escape names with ctx.helpers.escape). Return a line
 *     // for EVERY change `migrate` would make — they are the audit trail in the
 *     // GM-whispered chat card. A step that needs the player's decision gets its
 *     // line from ctx.helpers.choiceLine(html, key). May be async.
 *     describe(actor, ctx) { return []; },
 *     // Runs after the generic pass has been applied to this actor. Asks only
 *     // through ctx.helpers.promptChoice / confirmChoice (with the step's `key`),
 *     // which return CHOICE_DEFERRED (ctx.helpers.isDeferred) instead of asking
 *     // when ctx.interactive is false: skip exactly that step then.
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
 *   interactive false while the startup pass runs (set just before `migrate`):
 *               choice steps are deferred, not asked
 *   pendingChoice(key)
 *               the record ({title, count}) of a choice step of this class that
 *               an earlier non-interactive run deferred, or null. A step whose
 *               trigger is a generic-plan entry (Vengeful Blast retired, Sunder
 *               Armor merged) must check it: once the generic step is applied the
 *               plan no longer shows the trigger, and the choice is still owed.
 *   helpers     everything `./generic.mjs` exports (findOwnedBySource,
 *               findOwnedByName, loadDoc, replaceInPlace, addFeature,
 *               removeItems, promptChoice, confirmChoice, choiceLine, isDeferred,
 *               classLevel, minLevel, escape, …) — the writers and the prompts
 *               wrapped for this run (counted for the summary; deferred when
 *               non-interactive)
 *
 * Note that a replacement does not re-run `grantItem` rules (they fire on
 * creation), and a pool whose identifier changed starts from its initial value;
 * a class module that renames a pool can carry the value across.
 *
 * ── Entry points and what they ask ─────────────────────────────────────────
 * No confirmation popup: every run applies straight away, then shows a toast
 * ("Nim+ migrated 4 characters to the 0.2 rules (12 items updated, 2 added,
 * 1 removed)"), whispers the full per-actor report to the GMs (and the player
 * who ran it) as a chat card, and logs it with console.info. The deterministic
 * steps — replace in place (id, flags and pools kept), remove retired items,
 * add auto-grants, the class modules' fixed changes, the follow-up subclass sync
 * — are the audit trail in that card, and stay correctable by hand: the sheet's
 * +/- for pools, and "Migrate class" in the other direction.
 *
 *   await nimPlus.migrateCoreClasses();                       // all characters, asks for choices
 *   await nimPlus.migrateCoreClasses({ actors: [actor] });
 *   await nimPlus.migrateCoreClasses({ classes: ['shepherd'], direction: 'to203' });
 *   await nimPlus.migrateCoreClasses({ interactive: false }); // choices left pending
 *   await nimPlus.migrateCoreClasses({ apply: false });       // dry run: card only, nothing written
 *   nimPlus.syncCoreClasses                                   // alias
 *
 * Options: `interactive` (default true) — when false, steps that need a
 * player's choice (Shepherd graces, Commander Orders/Tactic, Shadowmancer and
 * Cheat replacement picks, the Songweaver cantrip removal) are skipped, the
 * items left as they are, and the character is reported as needing a choice;
 * `apply` (default true) — false posts the report as a dry run and writes
 * nothing; `silent` — no "nothing to do" toast.
 *
 * On `ready` the active GM runs it once per module version and direction,
 * non-interactively (no dialog at startup). A deferred step is remembered on the
 * actor (`flags.nim-plus-package.classMigrationChoices`), so the planner keeps
 * reporting it ("pending choice") and the "Migrate class to 0.2 rules" (or
 * "… to 2.0.3 rules") control in the character sheet header — for the GM or the
 * sheet's owner — runs it interactively: the choice prompts appear there, and
 * cancelling one skips only that step (and forgets it). Characters with pending
 * choices do not hold back the version stamp. Only world actors are covered —
 * unlinked tokens keep their own copies.
 */
import { MODULE_ID } from '../constants.mjs';
import { sysId } from '../system.mjs';
import { playtestCoreClassesEnabled } from '../playtest-settings.mjs';
import { supersedeData } from '../supersede.mjs';
import { queueStartupPrompt } from '../startup-queue.mjs';
import { plural, whisperReport } from '../migration-report.mjs';
import { runSubclassSyncStartup, syncSubclasses } from '../subclass-sync.mjs';
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
	choiceKeyOf,
	choiceIsForced,
	CHOICE_DEFERRED,
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
const RULES_LABEL = { to02: '0.2', to203: '2.0.3' };
/** Actor flag: choice steps a non-interactive run deferred — `{direction, steps: {classId: {key: {title, count}}}}`. */
export const PENDING_FLAG = 'classMigrationChoices';

/** The sheet header control's label for a direction. */
export function migrateControlLabel(direction) {
	return `Migrate class to ${RULES_LABEL[direction]} rules`;
}

/** The deferred choice steps stored on the actor for `direction`: `{classId: {key: {title, count}}}`. */
export function pendingChoices(actor, direction = defaultDirection()) {
	const stored = actor?.flags?.[MODULE_ID]?.[PENDING_FLAG];
	if (!stored || typeof stored !== 'object' || stored.direction !== direction) return {};
	const steps = stored.steps && typeof stored.steps === 'object' ? stored.steps : {};
	const out = {};
	for (const [classId, rec] of Object.entries(steps)) {
		if (rec && typeof rec === 'object' && Object.keys(rec).length) out[classId] = rec;
	}
	return out;
}

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
	const pending = pendingChoices(actor, direction);
	// Sources the actor already owns: an item whose replacement is one of them
	// (both the old and the new copy owned) merges into that copy instead of
	// becoming a second one.
	const ownedSources = new Set(actor.items.map((item) => itemSourceUuid(item)).filter(Boolean));

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

		if (claimed.has(targetUuid) || (canonicalUuid(targetUuid) !== src && ownedSources.has(canonicalUuid(targetUuid)))) {
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
		const stored = pending[classId] ?? {};
		const ctx = {
			direction,
			classId,
			classItem,
			level: classLevel(actor, classId),
			subclass,
			data,
			plan,
			interactive: true,
			pendingChoice: (key) => stored[key] ?? null,
			run: null,
		};
		ctx.helpers = scopedHelpers(ctx);
		const modules = [await loadClassModule('classes', classId), await loadClassModule('subclasses', classId)].filter(Boolean);
		const lines = [];
		for (const mod of modules) lines.push(...(await describeWith(mod, actor, ctx)));
		plan.classes.push({ ctx, modules, lines, name: classItem.name });
	}

	// "Pending choice": a step that asks the player — predicted by the class
	// modules' choice lines, or deferred by an earlier non-interactive run.
	plan.pendingStored = Object.entries(pending)
		.filter(([classId]) => inScope(classId) && ownedClassIds.has(classId))
		.flatMap(([classId, rec]) => Object.entries(rec).map(([key, r]) => ({ classId, key, title: r?.title ?? key })));
	plan.choiceSteps = plan.classes.flatMap((c) =>
		c.lines.map(choiceKeyOf).filter((k) => k !== null).map((key) => ({ classId: c.ctx.classId, key })),
	);
	plan.pendingChoice = plan.choiceSteps.length > 0 || plan.pendingStored.length > 0;

	const changes =
		plan.replacements.length ||
		plan.removals.length ||
		plan.additions.length ||
		plan.subclassAdditions.length ||
		plan.classes.some((c) => c.lines.length) ||
		plan.pendingStored.length;
	if (!changes) return null;
	// The report reads item names, which the apply changes: capture it now.
	plan.previewLines = previewLines(plan);
	plan.previewHeading = planHeading(plan);
	return plan;
}

/**
 * `ctx.helpers`: `./generic.mjs` with the writers counted into `ctx.run` (for
 * the summary) and the prompts deferred when the run is non-interactive. A
 * forced choice (nothing to pick, or every option taken) resolves as usual.
 */
function scopedHelpers(ctx) {
	const defer = (spec, fallbackKey) => {
		const key = String(spec?.key ?? fallbackKey ?? spec?.title ?? 'choice');
		ctx.run?.deferred.push({ classId: ctx.classId, key, title: spec?.title ?? key, count: spec?.count });
		return CHOICE_DEFERRED;
	};
	const nonInteractive = () => ctx.run ? !ctx.run.interactive : ctx.interactive === false;
	const tally = (field, n) => {
		if (ctx.run) ctx.run[field] += n;
	};
	return {
		...generic,
		async promptChoice(actor, spec = {}) {
			if (nonInteractive() && !choiceIsForced(spec.options ?? [], spec.count ?? 1)) return defer(spec);
			return generic.promptChoice(actor, spec);
		},
		async confirmChoice(actor, spec = {}) {
			if (nonInteractive()) return defer(spec);
			return generic.confirmChoice(actor, spec);
		},
		async addFeature(actor, docs) {
			const out = await generic.addFeature(actor, docs);
			tally('added', out?.length ?? 0);
			return out;
		},
		async removeItems(actor, items) {
			const out = await generic.removeItems(actor, items);
			tally('removed', out?.length ?? 0);
			return out;
		},
		async replaceInPlace(actor, item, target) {
			const out = await generic.replaceInPlace(actor, item, target);
			if (out) tally('updated', 1);
			return out;
		},
	};
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

/**
 * Apply planned migrations. Deterministic steps are written straight away;
 * class-module steps that need a choice ask the current user when `interactive`
 * and are deferred (left as they are, remembered on the actor) when not.
 *
 * Each plan gets `plan.result = {updated, added, removed, deferred}` — the
 * counts of what was written and the deferred choice steps.
 *
 * @param {ActorPlan[]} report
 * @param {'to02'|'to203'} direction
 * @param {object} [options]
 * @param {boolean} [options.interactive=true]
 * @returns {Promise<Actor[]>} the actors the pass ran on
 */
export async function applyCoreClassMigration(report, direction, { interactive = true } = {}) {
	const touched = [];
	for (const plan of report) {
		const { actor } = plan;
		const result = { updated: 0, added: 0, removed: 0, deferred: [] };
		plan.result = result;
		try {
			const removals = plan.removals.map((r) => r.item.id).filter((id) => actor.items.has(id));
			const updates = plan.replacements
				.filter((r) => actor.items.has(r.item.id))
				.map((r) => replacementUpdate(r.item, r.target));
			const creations = plan.additions.map((a) => creationData(a.doc));
			if (removals.length) await actor.deleteEmbeddedDocuments('Item', removals);
			if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
			if (creations.length) await actor.createEmbeddedDocuments('Item', creations);
			result.updated += updates.length;
			result.removed += removals.length;
			result.added += creations.length;

			for (const { ctx, modules } of plan.classes) {
				ctx.interactive = interactive;
				ctx.run = { interactive, updated: 0, added: 0, removed: 0, deferred: [] };
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
				result.updated += ctx.run.updated;
				result.added += ctx.run.added;
				result.removed += ctx.run.removed;
				result.deferred.push(...ctx.run.deferred);
			}
			// Step 5 — reported 0.2 subclass features, re-checked against the actor as
			// it now is (a class module may have added one already).
			if (plan.subclassAdditions?.length) {
				const docs = plan.subclassAdditions
					.filter(({ doc, cls, group }) => {
						const { sources, identifiers } = subclassFeaturesAfterPlan(actor, cls, [group], null);
						return !sources.has(canonicalUuid(doc.uuid)) && !identifiers.has(doc.system?.identifier);
					})
					.map((a) => a.doc);
				if (docs.length) result.added += (await generic.addFeature(actor, docs)).length;
			}

			await storePendingChoices(actor, direction, plan, result.deferred);

			touched.push(actor);
			console.log(
				`${MODULE_ID} | ${actor.name}: class migration (${direction}) — ` +
					`${result.updated} replaced, ${result.removed} removed, ${result.added} added` +
					(result.deferred.length ? `, ${result.deferred.length} choice(s) left for the sheet` : ''),
			);
		} catch (error) {
			console.error(`${MODULE_ID} | class migration failed on ${actor.name}`, error);
			ui.notifications?.error(`Nim+ | Class migration failed on ${actor.name} — see the console.`);
		}
	}
	return touched;
}

/**
 * Remember the choice steps this run deferred (and forget the ones it asked or
 * no longer needs): the classes that ran are rewritten from `deferred`, others
 * keep their records. Written only when it changes.
 */
async function storePendingChoices(actor, direction, plan, deferred) {
	const ran = new Set(plan.classes.map((c) => c.ctx.classId));
	const owned = new Set(classItems(actor).map((c) => c.system?.identifier));
	const steps = {};
	// Records of classes this run did not reach (a `classes` filter) are kept; a
	// class the character no longer has drops its records.
	for (const [classId, rec] of Object.entries(pendingChoices(actor, direction))) {
		if (!ran.has(classId) && owned.has(classId)) steps[classId] = rec;
	}
	for (const { classId, key, title, count } of deferred) {
		(steps[classId] ??= {})[key] = { title, ...(Number.isFinite(count) ? { count } : {}) };
	}
	const next = Object.keys(steps).length ? { direction, steps } : null;
	const current = actor.flags?.[MODULE_ID]?.[PENDING_FLAG] ?? null;
	if (JSON.stringify(next) === JSON.stringify(current)) return;
	try {
		if (current !== null) await actor.unsetFlag(MODULE_ID, PENDING_FLAG);
		if (next) await actor.setFlag(MODULE_ID, PENDING_FLAG, next);
	} catch (error) {
		console.error(`${MODULE_ID} | could not store the pending class-migration choices of ${actor.name}`, error);
	}
}

/* ───────────────────────────── reporting ───────────────────────────── */

const SKIPPED = ' <em>— skipped: needs a choice</em>';

/**
 * The report lines of one plan (HTML). Captured when the plan is made (the
 * items it names are renamed by the apply); once applied, choice lines whose
 * step was deferred are marked as skipped, and a deferred step no line
 * described gets a line of its own.
 */
export function planLines(plan) {
	const base = plan.previewLines ?? previewLines(plan);
	const out = [];
	let i = base.length - plan.manual.length - plan.classes.reduce((n, c) => n + c.lines.length, 0);
	out.push(...base.slice(0, i));
	for (const { ctx, lines: extra } of plan.classes) {
		const deferred = ctx.run?.deferred ?? [];
		const keys = new Set(deferred.map((d) => d.key));
		const described = new Set();
		for (const line of base.slice(i, i + extra.length)) {
			const key = choiceKeyOf(line);
			if (key !== null && keys.has(key)) {
				described.add(key);
				out.push(line + SKIPPED);
			} else out.push(line);
		}
		i += extra.length;
		for (const d of deferred) {
			if (!described.has(d.key)) out.push(`${generic.choiceLine(escape(d.title), d.key)}${SKIPPED}`);
		}
	}
	out.push(...base.slice(i));
	return out;
}

/** The plan's lines as they read before anything is applied. */
function previewLines(plan) {
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
	return lines;
}

function planHeading(plan) {
	if (plan.previewHeading) return plan.previewHeading;
	const heading = plan.classes.map((c) => `${escape(c.name)} ${c.ctx.level}`).join(' / ');
	return `${escape(plan.actor.name)}${heading ? ` — ${heading}` : ''}`;
}

/** Whisper the report card; `applied` false = a dry run. */
async function postReport(report, direction, { applied, pendingActors = [] }) {
	const intro = applied
		? `Converted to the <strong>${DIRECTION_LABEL[direction]}</strong> class rules. Items were rewritten in place: ` +
			`their ids, flags and charge/dice pool values are kept, and the sheet's +/- still corrects any pool. ` +
			`"${migrateControlLabel(direction === 'to02' ? 'to203' : 'to02')}" on a sheet moves a character back. ` +
			`Lines marked <i class="fa-solid fa-hand"></i> are left for you to check.`
		: `Dry run — nothing was written. Migrating to the <strong>${DIRECTION_LABEL[direction]}</strong> class rules would make these changes. ` +
			`Lines marked <i class="fa-solid fa-list-check"></i> ask the player; <i class="fa-solid fa-hand"></i> are left for you to check.`;
	const footer = pendingActors.length
		? `<strong>${plural(pendingActors.length, 'character')} need${pendingActors.length === 1 ? 's' : ''} a choice</strong> ` +
			`(${pendingActors.map((a) => escape(a.name)).join(', ')}): open their sheet → <em>${migrateControlLabel(direction)}</em>.`
		: '';
	return whisperReport({
		title: `Nim+ | Class migration → ${DIRECTION_LABEL[direction]}${applied ? '' : ' (dry run)'}`,
		intro,
		sections: report.map((plan) => ({ heading: planHeading(plan), lines: planLines(plan) })),
		footer,
	});
}

/**
 * Plan and apply the core class migration — no confirmation popup; see the
 * header for what is asked and what is reported.
 * @param {object} [options]
 * @param {Actor[]} [options.actors]     restrict to these actors (default: all world characters)
 * @param {string[]} [options.classes]   restrict to these class identifiers
 * @param {'to02'|'to203'} [options.direction]  default: from the playtest setting
 * @param {boolean} [options.interactive=true]  false: defer the steps that need a choice (startup)
 * @param {boolean} [options.apply=true]        false: dry run — post the report card, write nothing
 * @param {boolean} [options.silent]     no "nothing to do" notification
 * @returns {Promise<'applied'|'previewed'|'nothing'>}
 */
export async function migrateCoreClasses({
	actors,
	classes,
	direction = defaultDirection(),
	interactive = true,
	apply = true,
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

	if (apply === false) {
		await postReport(report, direction, { applied: false });
		ui.notifications?.info(
			`Nim+ | Class migration dry run: ${plural(report.length, 'character')} would change — see the chat card.`,
		);
		return 'previewed';
	}

	const touched = await applyCoreClassMigration(report, direction, { interactive });
	const done = report.filter((p) => touched.includes(p.actor));
	const migrated = done.filter((p) => p.result.updated + p.result.added + p.result.removed > 0);
	const pendingActors = done.filter((p) => p.result.deferred.length).map((p) => p.actor);
	const sum = (field) => done.reduce((n, p) => n + p.result[field], 0);

	await postReport(done, direction, { applied: true, pendingActors });
	if (migrated.length || !pendingActors.length) {
		ui.notifications?.info(
			`Nim+ migrated ${plural(migrated.length, 'character')} to the ${RULES_LABEL[direction]} rules ` +
				`(${plural(sum('updated'), 'item')} updated, ${sum('added')} added, ${sum('removed')} removed).`,
		);
	}
	if (pendingActors.length) {
		ui.notifications?.warn(
			`Nim+ | ${plural(pendingActors.length, 'character')} need${pendingActors.length === 1 ? 's' : ''} a choice ` +
				`(${pendingActors.map((a) => a.name).join(', ')}): open their sheet → ${migrateControlLabel(direction)}.`,
		);
	}

	// Subclass features the new side adds (see the header). A player's migration
	// (and a to02 run against the setting) added them itself, in step 5.
	if (touched.length && game.user?.isGM) {
		try {
			await syncSubclasses({ actors: touched, silent: true });
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
		// A choice the startup pass left for this sheet: say so on the control.
		const pending = Object.keys(pendingChoices(actor, direction)).length > 0;
		controls.push({
			action: 'nimPlusMigrateClass',
			icon: pending ? 'fa-solid fa-list-check' : 'fa-solid fa-arrows-rotate',
			label: pending ? `${migrateControlLabel(direction)} (choice needed)` : migrateControlLabel(direction),
			visible: true,
			onClick: () =>
				migrateCoreClasses({ actors: [actor], direction, interactive: true }).catch((error) =>
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

// The migration first, then the subclass sync's own startup pass — in that
// order, so the sync never plans against un-migrated characters. Both apply
// without a dialog; steps that need a player's choice are left for the sheet.
Hooks.once('ready', () => {
	if (!isActiveGM()) return;
	const direction = defaultDirection();
	const stamp = `${game.modules.get(MODULE_ID)?.version ?? ''}|${direction}`;
	queueStartupPrompt(async () => {
		if (game.settings.get(MODULE_ID, VERSION_SETTING) === stamp) return;
		try {
			await migrateCoreClasses({ direction, silent: true, interactive: false });
			// Pending choices do not hold the stamp back: they live on the actors.
			await game.settings.set(MODULE_ID, VERSION_SETTING, stamp);
		} catch (error) {
			console.error(`${MODULE_ID} | class migration failed`, error);
		}
	});
	queueStartupPrompt(runSubclassSyncStartup);
});

/** The one GM that runs the startup pass (the active GM when Foundry names one). */
export function isActiveGM() {
	if (!game.user?.isGM) return false;
	const active = game.users?.activeGM;
	return !active || active.id === game.user.id;
}

export const syncCoreClasses = migrateCoreClasses;
