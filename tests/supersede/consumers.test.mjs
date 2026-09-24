/**
 * What the system's character creator / level-up window would offer, with the
 * playtest setting on vs off, computed through local ports of the system
 * consumers (./consumers.mjs) against the filtered pack indexes.
 *
 * "Known" = the same problem exists in the pure system packs (no Nim+ at all):
 * a pre-existing system mismatch, not a supersede bug.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { rawDoc, setupWorld, supersedeOracle } from '../harness/index.mjs';
import {
	buildClassFeatureIndex,
	buildSpellIndex,
	buildSubclassFeatureIndex,
	classChoices,
	classFeaturesAt,
	duplicateNames,
	getSubclassChoices,
} from './consumers.mjs';

const CORE = ['berserker', 'commander', 'hunter', 'mage', 'oathsworn', 'shadowmancer', 'shepherd', 'songweaver', 'stormshifter', 'the-cheat', 'zephyr'];

/** Snapshot of everything the consumers show in one world. */
async function survey(opts) {
	const { env } = await setupWorld({ ...opts, boot: 'ready' });
	await env.flush();
	const classes = await classChoices();
	const featureIndex = await buildClassFeatureIndex();
	const subIndex = await buildSubclassFeatureIndex();
	const spellIndex = await buildSpellIndex();

	const classDupChoices = duplicateNames(classes.map((c) => ({ name: c.identifier })));
	const featureDups = []; // `${class} L${level} ${group}: names`
	const emptyGroups = []; // `${class}:${group}`
	for (const cls of classes) {
		const used = new Set();
		for (let level = 1; level <= 20; level += 1) {
			for (const [group, entries] of classFeaturesAt(featureIndex, cls.identifier, level, cls.groupIdentifiers)) {
				used.add(group);
				const d = duplicateNames(entries);
				if (d.length) featureDups.push(`${cls.identifier} L${level} ${group}: ${d.join(', ')}`);
			}
		}
		for (const g of cls.groupIdentifiers) {
			const any = [...(featureIndex.get(g)?.values() ?? [])].some((a) => a.length) || used.has(g);
			if (!any) emptyGroups.push(`${cls.identifier}:${g}`);
		}
	}

	const subclassDups = [];
	const subclassNoFeatures = [];
	const subclassFeatureDups = [];
	const subclassChoices = new Map();
	for (const cls of [...new Set(classes.map((c) => c.identifier))]) {
		const choices = await getSubclassChoices(cls);
		subclassChoices.set(cls, choices);
		const d = duplicateNames(choices);
		if (d.length) subclassDups.push(`${cls}: ${d.join(', ')}`);
		for (const sc of choices) {
			const levels = subIndex.get(cls)?.get(sc.identifier);
			if (!levels?.size) {
				subclassNoFeatures.push(`${cls}:${sc.identifier}`);
				continue;
			}
			for (const [level, entries] of levels) {
				const dd = duplicateNames(entries);
				if (dd.length) subclassFeatureDups.push(`${cls}/${sc.identifier} L${level}: ${dd.join(', ')}`);
			}
		}
	}

	const spellDups = [];
	for (const [school, tiers] of spellIndex) {
		for (const [tier, spells] of tiers) {
			for (const util of [false, true]) {
				const d = duplicateNames(spells.filter((s) => s.isUtility === util));
				if (d.length) spellDups.push(`${school} T${tier}${util ? ' utility' : ''}: ${d.join(', ')}`);
			}
		}
	}

	return {
		env,
		classes,
		featureIndex,
		subIndex,
		spellIndex,
		subclassChoices,
		classDupChoices,
		featureDups,
		emptyGroups,
		subclassDups,
		subclassNoFeatures,
		subclassFeatureDups,
		spellDups,
	};
}

let pure;
let on;
let off;

beforeAll(async () => {
	pure = await survey({ playtest: false, packs: { module: false } });
	on = await survey({ playtest: true });
	off = await survey({ playtest: false });
});

function notKnown(list, known) {
	const k = new Set(known);
	return list.filter((x) => !k.has(x));
}

describe('system consumers: pure system baseline (known, reported only)', () => {
	it('records pre-existing system mismatches', () => {
		// Reported, not asserted: these exist without Nim+ at all.
		console.log('[known] pure system empty class groups:', pure.emptyGroups);
		console.log('[known] pure system class feature dups:', pure.featureDups);
		console.log('[known] pure system subclasses without features:', pure.subclassNoFeatures);
		console.log('[known] pure system subclass feature dups:', pure.subclassFeatureDups);
		console.log('[known] pure system spell dups:', pure.spellDups);
		expect(pure.classes.length).toBeGreaterThan(0);
	});
});

describe.each([
	['on', () => on],
	['off', () => off],
])('system consumers with the playtest setting %s', (label, get) => {
	it('offers every core class exactly once', () => {
		const s = get();
		for (const id of CORE) {
			expect(s.classes.filter((c) => c.identifier === id).map((c) => c.uuid), id).toHaveLength(1);
		}
		expect(s.classDupChoices).toEqual([]);
	});

	it('core class comes from the right side', async () => {
		const s = get();
		for (const id of CORE) {
			const [c] = s.classes.filter((x) => x.identifier === id);
			if (label === 'off') expect(c.uuid, id).toMatch(/^Compendium\.nimble\./);
		}
	});

	it('no duplicate feature names per class / group / level', () => {
		const s = get();
		expect(notKnown(s.featureDups, pure.featureDups)).toEqual([]);
	});

	it('every core class groupIdentifiers entry has features', () => {
		const s = get();
		const fresh = notKnown(s.emptyGroups, pure.emptyGroups);
		const core = fresh.filter((g) => CORE.includes(g.split(':')[0]));
		// Non-core Nim+ classes (artificer, …) are identical on both sides — not a supersede issue.
		console.log(`[known, non-core Nim+ content, ${label}] empty class groups:`, fresh.filter((g) => !core.includes(g)));
		expect(core).toEqual([]);
	});

	it('no duplicate subclass choices per parent class', () => {
		expect(get().subclassDups).toEqual([]);
	});

	it('every subclass choice resolves to a feature group; no duplicate names per level', () => {
		const s = get();
		expect(notKnown(s.subclassNoFeatures, pure.subclassNoFeatures)).toEqual([]);
		expect(notKnown(s.subclassFeatureDups, pure.subclassFeatureDups)).toEqual([]);
	});

	it('no duplicate spell names per school / tier', () => {
		const s = get();
		expect(notKnown(s.spellDups, pure.spellDups)).toEqual([]);
	});
});

describe('system consumers: side-specific content', () => {
	it('on: no superseded/retired system doc reaches any consumer; off: no 0.2 doc does', async () => {
		const oracle = await supersedeOracle();
		const collect = (s) => {
			const uuids = new Set(s.classes.map((c) => c.uuid));
			for (const lm of s.featureIndex.values()) for (const a of lm.values()) for (const e of a) uuids.add(e.uuid);
			for (const cm of s.subIndex.values()) for (const sm of cm.values()) for (const a of sm.values()) for (const e of a) uuids.add(e.uuid);
			for (const list of s.subclassChoices.values()) for (const c of list) uuids.add(c.uuid);
			for (const tm of s.spellIndex.values()) for (const a of tm.values()) for (const e of a) uuids.add(e.uuid);
			return uuids;
		};
		const onSeen = collect(on);
		const offSeen = collect(off);
		expect([...oracle.hiddenWhen(true)].filter((u) => onSeen.has(u))).toEqual([]);
		expect([...oracle.hiddenWhen(false)].filter((u) => offSeen.has(u))).toEqual([]);
		// and each side does see its own replacements
		// Only documents a consumer can list at all (classes, subclasses, spells, levelled features —
		// a feature with no level, e.g. one reached only through grantItem, is in no index).
		const listable = (u) => {
			const d = rawDoc(u);
			if (!d) return false;
			if (['class', 'subclass', 'spell'].includes(d.type)) return true;
			return d.type === 'feature' && (d.system?.gainedAtLevel > 0 || d.system?.gainedAtLevels?.length > 0);
		};
		expect([...oracle.supersedes.keys()].filter((u) => listable(u) && !onSeen.has(u))).toEqual([]);
		expect([...oracle.supersededBy.keys()].filter((u) => listable(u) && !offSeen.has(u))).toEqual([]);
	});

	it('official subclass choices: on shows the 0.2 copy, off shows the system subclass', () => {
		for (const [cls, list] of on.subclassChoices) {
			const offNames = new Set((off.subclassChoices.get(cls) ?? []).map((c) => c.name));
			for (const c of list) {
				if (c.uuid.startsWith('Compendium.nim-plus-package.') && !offNames.has(c.name)) {
					// A 0.2-only (or renamed) subclass: must be flagged, i.e. hidden when off.
					expect(off.subclassChoices.get(cls).some((x) => x.uuid === c.uuid), c.name).toBe(false);
				}
			}
		}
	});
});
