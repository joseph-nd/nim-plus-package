/**
 * Faithful ports of the Nimble system's spell-grant resolution, plus a
 * level-by-level simulator that feeds it a Shadowmancer's real features.
 *
 * Ported from ../FoundryVTT-Nimble/src (line-for-line in behaviour; TypeScript
 * types dropped, `localize` replaced by the fallback key):
 *
 *   - buildSpellIndex            src/utils/getSpells.ts
 *   - getSpellsFromIndex         src/utils/getSpellsFromIndex.ts
 *   - predicatePassesAtLevel, resolveSchools, collectKnownSchools,
 *     buildUuidLookup, collectSpellGrants
 *                                src/view/dialogs/spellGrantUtils.ts
 *   - processGrantSpellsRules    src/view/dialogs/characterCreation/utils/processGrantSpellsRules.ts
 *     (the character creator's L1 path — it ignores predicates)
 *   - levelUpSpellGrants         the rule gathering of
 *                                src/view/dialogs/CharacterLevelUpDialogState.svelte.ts
 *                                (the `$effect` that calls collectSpellGrants: rules of the
 *                                features gained at `levelingTo` + every owned feature with a
 *                                grantSpells rule; owned spells by `_stats.compendiumSource`)
 *   - getHighestSpellTier        src/utils/spell/getHighestSpellTier.ts
 *
 * The index is built from `game.packs` through `pack.getIndex({fields})`, so the
 * Nim+ supersede layer (scripts/core/supersede.mjs wraps getIndex) is exercised
 * exactly as in the client.
 */
import { loadPackData, progressionEntries, resolveDoc, subclassEntries, visibleDocs } from '../harness/index.mjs';

/* ─────────────── src/utils/getSpellsFromIndex.ts ─────────────── */

export function getSpellsFromIndex(index, schools, tiers, options = {}) {
	const { utilityOnly = false, forClass } = options;
	const results = [];
	for (const school of schools) {
		const tierMap = index.get(school);
		if (!tierMap) continue;
		for (const tier of tiers) {
			const spells = tierMap.get(tier);
			if (spells) {
				for (const spell of spells) {
					if (utilityOnly && !spell.isUtility) continue;
					if (!utilityOnly && spell.isUtility) continue;
					if (forClass && spell.classes.length > 0 && !spell.classes.includes(forClass)) continue;
					results.push(spell);
				}
			}
		}
	}
	results.sort((a, b) => a.name.localeCompare(b.name));
	return results;
}

/* ─────────────── src/utils/getSpells.ts (buildSpellIndex) ─────────────── */

export async function buildSpellIndex(options = {}) {
	const includeSecretSpells = options.includeSecretSpells ?? false;
	const index = new Map();
	const seen = new Set();
	const seenCompendiumSources = new Set();

	function addToIndex(entry) {
		if (seen.has(entry.uuid)) return false;
		seen.add(entry.uuid);
		const { school, tier } = entry;
		if (!index.has(school)) index.set(school, new Map());
		const tierMap = index.get(school);
		if (!tierMap.has(tier)) tierMap.set(tier, []);
		tierMap.get(tier).push(entry);
		return true;
	}

	for (const item of game.items ?? []) {
		if (item.type !== 'spell') continue;
		const system = item.system;
		if (!system.school) continue;
		const selected = system.properties?.selected ?? [];
		const isSecret = selected.includes('secretSpell');
		if (isSecret && !includeSecretSpells) continue;
		const added = addToIndex({
			uuid: item.uuid,
			name: item.name ?? 'Unknown Spell',
			img: item.img ?? 'icons/svg/item-bag.svg',
			school: system.school,
			tier: system.tier ?? 0,
			isUtility: selected.includes('utilitySpell'),
			isSecret,
			activationCost: system.activation?.cost ?? {},
			classes: system.classes ?? [],
		});
		if (added) {
			const compendiumSource = item._stats?.compendiumSource;
			if (compendiumSource) seenCompendiumSources.add(compendiumSource);
		}
	}

	const indexFields = ['system.school', 'system.tier', 'system.classes', 'system.activation.cost', 'system.properties.selected'];
	for (const pack of game.packs) {
		if (pack.documentName !== 'Item') continue;
		const packIndex = await pack.getIndex({ fields: indexFields });
		for (const packEntry of packIndex) {
			if (packEntry.type !== 'spell') continue;
			if (seenCompendiumSources.has(packEntry.uuid)) continue;
			const system = packEntry.system;
			if (!system?.school) continue;
			const selected = system.properties?.selected ?? [];
			const isSecret = selected.includes('secretSpell');
			if (isSecret && !includeSecretSpells) continue;
			addToIndex({
				uuid: packEntry.uuid,
				name: packEntry.name ?? 'Unknown Spell',
				img: packEntry.img ?? 'icons/svg/item-bag.svg',
				school: system.school,
				tier: system.tier ?? 0,
				isUtility: selected.includes('utilitySpell'),
				isSecret,
				activationCost: system.activation?.cost ?? {},
				classes: system.classes ?? [],
			});
		}
	}

	for (const tierMap of index.values()) {
		for (const spells of tierMap.values()) spells.sort((a, b) => a.name.localeCompare(b.name));
	}
	return index;
}

/* ─────────────── src/view/dialogs/spellGrantUtils.ts ─────────────── */

export function predicatePassesAtLevel(rule, level) {
	const predicate = rule.predicate;
	if (!predicate) return true;
	const levelPred = predicate.level;
	if (!levelPred || typeof levelPred !== 'object') return true;
	const { min, max } = levelPred;
	const mode = rule.mode ?? 'auto';
	if (mode === 'selectSchool' || mode === 'selectSpell') {
		if (min !== undefined && level !== min) return false;
	} else if (min !== undefined && level < min) return false;
	if (max !== undefined && level > max) return false;
	return true;
}

export function resolveSchools(schools, knownSchools) {
	if (!schools.includes('known')) return schools;
	return [...new Set([...schools.filter((s) => s !== 'known'), ...knownSchools])];
}

export function collectKnownSchools(rules, knownSchools) {
	for (const rule of rules) {
		if (rule.type !== 'grantSpells') continue;
		if (rule.mode !== 'auto' && rule.mode !== undefined) continue;
		const schools = rule.schools;
		if (schools) for (const school of schools) if (school !== 'known') knownSchools.add(school);
	}
}

function buildUuidLookup(spellIndex) {
	const lookup = new Map();
	for (const tierMap of spellIndex.values()) for (const spells of tierMap.values()) for (const spell of spells) lookup.set(spell.uuid, spell);
	return lookup;
}

export function collectSpellGrants(rulesArrays, spellIndex, classIdentifier, targetLevel, ownedSpellUuids, knownSchools) {
	const autoGrant = [];
	const schoolSelections = [];
	const spellSelections = [];
	const seenUuids = new Set();
	const seenSelectionKeys = new Set();
	const uuidLookup = buildUuidLookup(spellIndex);

	for (const rules of rulesArrays) {
		for (const rule of rules) {
			if (rule.type !== 'grantSpells') continue;
			if (!predicatePassesAtLevel(rule, targetLevel)) continue;
			const mode = rule.mode ?? 'auto';
			const tiers = rule.tiers ?? [0];
			const utilityOnly = rule.utilityOnly ?? false;
			const schools = Array.isArray(rule.schools) ? rule.schools : [];
			const resolvedSchools = resolveSchools(schools, knownSchools);

			if (mode === 'auto') {
				if (Array.isArray(rule.uuids) && rule.uuids.length > 0) {
					for (const uuid of rule.uuids) {
						if (seenUuids.has(uuid) || ownedSpellUuids.has(uuid)) continue;
						seenUuids.add(uuid);
						const spell = uuidLookup.get(uuid);
						if (spell) autoGrant.push(spell);
					}
				} else if (resolvedSchools.length > 0) {
					const spells = getSpellsFromIndex(spellIndex, resolvedSchools, tiers, { utilityOnly, forClass: classIdentifier });
					for (const spell of spells) {
						if (seenUuids.has(spell.uuid) || ownedSpellUuids.has(spell.uuid)) continue;
						seenUuids.add(spell.uuid);
						autoGrant.push(spell);
					}
				}
			} else if (mode === 'selectSchool' && resolvedSchools.length > 0) {
				const availableSchools = resolvedSchools.filter((school) =>
					getSpellsFromIndex(spellIndex, [school], tiers, { utilityOnly, forClass: classIdentifier }).some((s) => !ownedSpellUuids.has(s.uuid)),
				);
				const schoolRuleId = rule.id ?? '';
				if (availableSchools.length > 0 && !seenSelectionKeys.has(schoolRuleId)) {
					seenSelectionKeys.add(schoolRuleId);
					schoolSelections.push({
						ruleId: schoolRuleId,
						label: rule.label || 'NIMBLE.spellGrants.chooseSchoolsFallback',
						availableSchools,
						tiers,
						count: rule.count ?? 1,
						utilityOnly,
						forClass: classIdentifier,
						source: 'class',
					});
				}
			} else if (mode === 'selectSpell' && resolvedSchools.length > 0) {
				const ruleId = rule.id ?? '';
				const label = rule.label || 'NIMBLE.spellGrants.chooseSpellsFallback';
				const count = rule.count ?? 1;
				for (const school of resolvedSchools) {
					const availableSpells = getSpellsFromIndex(spellIndex, [school], tiers, { utilityOnly, forClass: classIdentifier }).filter(
						(s) => !ownedSpellUuids.has(s.uuid),
					);
					if (availableSpells.length > 0 && !seenSelectionKeys.has(`${ruleId}-${school}`)) {
						seenSelectionKeys.add(`${ruleId}-${school}`);
						spellSelections.push({ ruleId: `${ruleId}-${school}`, label, availableSpells, count, utilityOnly, forClass: classIdentifier, source: 'class' });
					}
				}
			}
		}
	}
	return { autoGrant, schoolSelections, spellSelections };
}

/* ─────── src/view/dialogs/characterCreation/utils/processGrantSpellsRules.ts ─────── */

export function processGrantSpellsRules(rules, spellIndex, classIdentifier, source, autoGrant, schoolSelections, spellSelections) {
	for (const rule of rules) {
		if (rule.type !== 'grantSpells') continue;
		const mode = rule.mode ?? 'auto';
		const tiers = rule.tiers ?? [0];
		const utilityOnly = rule.utilityOnly ?? false;
		if (mode === 'auto') {
			if (rule.uuids && rule.uuids.length > 0) {
				for (const uuid of rule.uuids) {
					for (const tierMap of spellIndex.values()) {
						for (const spells of tierMap.values()) {
							const spell = spells.find((s) => s.uuid === uuid);
							if (spell) autoGrant.push(spell);
						}
					}
				}
			} else if (rule.schools && rule.schools.length > 0) {
				autoGrant.push(...getSpellsFromIndex(spellIndex, rule.schools, tiers, { utilityOnly, forClass: classIdentifier }));
			}
		} else if (mode === 'selectSchool') {
			schoolSelections.push({
				ruleId: rule.id,
				label: rule.label || 'NIMBLE.spellGrants.chooseSchoolsFallback',
				availableSchools: rule.schools ?? [],
				tiers,
				count: rule.count ?? 1,
				utilityOnly,
				forClass: classIdentifier,
				source,
			});
		} else if (mode === 'selectSpell') {
			spellSelections.push({
				ruleId: rule.id,
				label: rule.label || 'NIMBLE.spellGrants.chooseSpellsFallback',
				availableSpells: getSpellsFromIndex(spellIndex, rule.schools ?? [], tiers, { utilityOnly, forClass: classIdentifier }),
				count: rule.count ?? 1,
				utilityOnly,
				forClass: classIdentifier,
				source,
			});
		}
	}
}

/* ─────────────── src/utils/spell/getHighestSpellTier.ts ─────────────── */

export function getHighestSpellTier(actor) {
	const level = actor.levels.character;
	const tiers = [1, 4, 6, 8, 10, 12, 14, 16, 18];
	for (let index = tiers.length - 1; index >= 0; index -= 1) if (level >= tiers[index]) return index + 1;
	return 0;
}

/* ─────────────── CharacterLevelUpDialogState.svelte.ts rule gathering ─────────────── */

/**
 * One level-up (`levelingTo` ≥ 2): rules of the features gained at this level
 * plus every owned feature carrying a grantSpells rule.
 */
export function levelUpSpellGrants({ newFeatures, ownedFeatures, ownedSpellUuids, spellIndex, classIdentifier, levelingTo }) {
	const knownSchools = new Set();
	const allRulesArrays = [];
	for (const feature of newFeatures) {
		const rules = feature.system?.rules ?? [];
		if (rules.length > 0) allRulesArrays.push(rules);
		collectKnownSchools(rules, knownSchools);
	}
	for (const item of ownedFeatures) {
		if (item.type !== 'feature') continue;
		const rules = item.system?.rules ?? [];
		if (rules.some((r) => r.type === 'grantSpells')) {
			allRulesArrays.push(rules);
			collectKnownSchools(rules, knownSchools);
		}
	}
	return collectSpellGrants(allRulesArrays, spellIndex, classIdentifier, levelingTo, ownedSpellUuids, knownSchools);
}

/* ─────────────────────────── the simulator ─────────────────────────── */

export const SHADOWMANCER_LADDER = [2, 5, 7, 10, 13, 16, 19];
export function ladderTier(level) {
	let tier = 0;
	SHADOWMANCER_LADDER.forEach((l, i) => {
		if (level >= l) tier = i + 1;
	});
	return tier;
}

function levelsOf(doc) {
	const s = doc.system ?? {};
	const l = new Set(Array.isArray(s.gainedAtLevels) ? s.gainedAtLevels : []);
	if (Number.isFinite(s.gainedAtLevel) && s.gainedAtLevel > 0) l.add(s.gainedAtLevel);
	return [...l];
}
export function minLevelOf(doc) {
	const l = levelsOf(doc);
	return l.length ? Math.min(...l) : Infinity;
}

/**
 * The Shadowmancer's features (auto progression + the subclass's) as pack docs,
 * each with the level it is first gained.
 */
export async function shadowmancerFeatures(version, subclass) {
	const { doc: classDoc } = (await visibleDocs(version))
		.filter((e) => e.doc.type === 'class' && e.doc.system?.identifier === 'shadowmancer')
		.sort((a, b) => a.tier - b.tier)[0];
	const out = (await progressionEntries(classDoc, 'shadowmancer', 20, version)).map((e) => ({ ...e, level: minLevelOf(e.doc) }));
	if (subclass) {
		const { doc: subDoc } = await resolveDoc(subclass, { version, type: 'subclass', classId: 'shadowmancer' });
		for (const e of await subclassEntries(subDoc, 'shadowmancer', 20, version)) out.push({ ...e, level: minLevelOf(e.doc) });
	}
	return out;
}

/**
 * Walk a Shadowmancer from creation to `toLevel` through the system's own grant
 * code. `spellIndex` must be built in the env whose playtest setting matches
 * `version`. Selection groups are answered with the first `count` spells
 * (alphabetical — the dialog's order).
 *
 * @returns {{byLevel: Map<number, {auto: object[], picked: object[], selections: object[], schoolSelections: object[]}>, owned: Map<string, object>}}
 *          `owned` maps spell uuid → index entry (+ `level` learned).
 */
export async function simulateShadowmancer({ version, subclass, toLevel = 20, spellIndex, features }) {
	const feats = features ?? (await shadowmancerFeatures(version, subclass));
	const owned = new Map();
	const byLevel = new Map();
	const learn = (entries, level) => {
		for (const e of entries) owned.set(e.uuid, { ...e, level });
	};

	// Level 1: the character creator (processGrantSpellsRules on the L1 auto-grant features).
	{
		const autoGrant = [];
		const schoolSelections = [];
		const spellSelections = [];
		for (const f of feats.filter((f) => f.level === 1)) {
			processGrantSpellsRules(f.doc.system?.rules ?? [], spellIndex, 'shadowmancer', 'class', autoGrant, schoolSelections, spellSelections);
		}
		const picked = spellSelections.flatMap((g) => g.availableSpells.slice(0, g.count));
		byLevel.set(1, { auto: autoGrant, picked, selections: spellSelections, schoolSelections });
		learn(autoGrant, 1);
		learn(picked, 1);
	}

	for (let L = 2; L <= toLevel; L += 1) {
		const newFeatures = feats.filter((f) => f.level === L).map((f) => f.doc);
		const ownedFeatures = feats.filter((f) => f.level < L).map((f) => ({ type: 'feature', ...f.doc }));
		const result = levelUpSpellGrants({
			newFeatures,
			ownedFeatures,
			ownedSpellUuids: new Set(owned.keys()),
			spellIndex,
			classIdentifier: 'shadowmancer',
			levelingTo: L,
		});
		const picked = result.spellSelections.flatMap((g) => g.availableSpells.slice(0, g.count));
		byLevel.set(L, { auto: result.autoGrant, picked, selections: result.spellSelections, schoolSelections: result.schoolSelections });
		learn(result.autoGrant, L);
		learn(picked, L);
	}
	return { byLevel, owned, features: feats };
}

/** Name of a pack doc by uuid (for messages). */
export function nameOf(uuid) {
	return loadPackData().byUuid.get(uuid)?.name ?? uuid;
}
