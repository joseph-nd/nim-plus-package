/**
 * The Nim+ 0.12 "Nimble 0.2 playtest" content contract (scratchpad/core02/BRIEF.md), checked on the
 * raw JSON: supersede targets, playtest02 flags, retired list, levels and selection counts.
 */
import { describe, expect, it } from 'vitest';
import { supersedeOracle } from '../harness/index.mjs';
import {
	checkChoiceGroupConsistency,
	checkLevels,
	checkPlaytestFlag,
	checkRetired,
	checkSupersedeTargets,
	duplicateVisible,
	retiredUuids,
	supersedeDocs,
	supersedeShapeChanges,
	sysByUuid,
} from './checks-02.mjs';
import { canonicalUuid, MODULE_ID, nimDocs, onlyBug, unexplained } from './lib.mjs';

const KNOWN = {
	// Bramble Mark (Hexbinder mystic mark) is gainedAtLevels [4] but its selectionCountByLevel (like every
	// other mark) lists 4/6/9/12/16 — it is missing from the level 6/9/12/16 pick lists.
	'BUG-pack-data-3': (v) => v.startsWith('pack-sources/classFeatures/hexbinder/hexbinder-mystic-marks/bramble-mark.json'),
};

/** Renames/regroupings the 0.2 sheets make on purpose (checked against scratchpad/core02/txt). */
const INTENTIONAL_SHAPE_CHANGES = new Set([
	'Inerrant Strike.', // system name has a stray trailing period
	'Coordinated Strike!', // 0.2: level 1 progression feature, no longer an Order
	'Firebrand', // → Spellforge
	'Withering Strike', // → Withering Presence
	'Commanding Presence', // combat-tactics → commanders-orders
	"I'm the Patron Now!", // → Sovereign One
	'Assist Me, My Friend!', // grace → base progression
	'Lifebinding Spirit', // → My Buddy!
	'Empowered Conduit', // → Lifebinder's Embrace
	'Conduit of Light', // → Searing Light
	'Windbag', // → I Know Just the Song
	'Master of Forms (2)', // → Chimeric Sovereign
	'Storm Wake', // → Stormstrider
	'Sunder Armor (Medium)', // merged → Sunder Armor
	'Sunder Armor (Heavy)',
]);

describe('pack-data: 0.2 supersede contract', () => {
	it('there are 0.2 replacement docs to check', () => {
		expect(supersedeDocs().length).toBeGreaterThan(150);
	});

	it('every supersedes target is a real, un-retired system doc, superseded by exactly one Nim+ doc', () => {
		expect(checkSupersedeTargets()).toEqual([]);
	});

	it('every supersedes doc also carries playtest02: true', () => {
		expect(checkPlaytestFlag()).toEqual([]);
	});

	it('every retired uuid (scripts/core/supersede-retired.mjs) is a system doc and no retired doc has a replacement', async () => {
		expect(retiredUuids().length).toBeGreaterThan(0);
		expect(checkRetired()).toEqual([]);
		const oracle = await supersedeOracle();
		for (const u of oracle.retired) expect(oracle.supersededBy.has(u)).toBe(false);
	});

	it('the pack-data view of supersedes agrees with the harness oracle', async () => {
		const oracle = await supersedeOracle();
		const mine = new Map();
		for (const { uuid, doc } of supersedeDocs()) mine.set(uuid, doc.flags[MODULE_ID].supersedes.map(canonicalUuid));
		expect(mine).toEqual(oracle.supersedes);
	});

	it('supersedes flags use the canonical "Compendium.nimble.<pack>.Item.<id>" spelling', () => {
		const bad = [];
		for (const { file, doc } of supersedeDocs()) {
			for (const u of doc.flags[MODULE_ID].supersedes) if (canonicalUuid(u) !== u) bad.push(`${file}: ${u}`);
		}
		expect(bad).toEqual([]);
	});

	it('superseding docs never change the document type', () => {
		expect(supersedeShapeChanges().filter((c) => c.type)).toEqual([]);
	});

	it('class/group/subclass/name changes against the superseded doc are all intentional 0.2 changes (info)', () => {
		const changes = supersedeShapeChanges();
		console.info(`[pack-data] 0.2 shape changes (info):\n  ${changes.map((c) => `${c.file}: ${c.diffs.join('; ')}`).join('\n  ')}`);
		expect(changes.filter((c) => !INTENTIONAL_SHAPE_CHANGES.has(c.target)).map((c) => `${c.file}: ${c.diffs.join('; ')}`)).toEqual([]);
	});

	it('superseding docs keep the system img (contract 2)', () => {
		const sys = sysByUuid();
		const bad = [];
		for (const { doc, file } of supersedeDocs()) {
			for (const u of doc.flags[MODULE_ID].supersedes) {
				const t = sys.get(canonicalUuid(u))?.doc;
				if (t && t.img !== doc.img) bad.push(`${file}: ${t.img} → ${doc.img}`);
			}
		}
		expect(bad).toEqual([]);
	});

	it('the Nim+ docs do not carry a stale system _id (the build must allocate a new one)', () => {
		const sysIds = new Set([...sysByUuid().keys()].map((u) => u.split('.').pop()));
		const clash = nimDocs().filter(({ doc }) => sysIds.has(doc._id)).map(({ file, doc }) => `${file}: ${doc._id}`);
		expect(clash).toEqual([]);
	});

	it('gainedAtLevel(s) are integers in 1..20, ascending, unique; selectionCountByLevel keys are gained levels with counts ≥ 1', () => {
		expect(unexplained(checkLevels(), KNOWN)).toEqual([]);
	});

	it.fails('BUG-pack-data-3: Bramble Mark is offered at every mystic-mark level its selectionCountByLevel lists', () => {
		expect(onlyBug(checkLevels(), KNOWN, 'BUG-pack-data-3')).toEqual([]);
	});

	it.each([[true], [false]])('playtest setting %s: options of one choice group agree on levels and per-level counts', (enabled) => {
		expect(unexplained(checkChoiceGroupConsistency(enabled), KNOWN)).toEqual([]);
	});

	it.each([[true], [false]])('playtest setting %s: no two visible docs for the same class/group/level/name', (enabled) => {
		expect(duplicateVisible(enabled)).toEqual([]);
	});
});
