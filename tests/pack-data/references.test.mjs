/**
 * Every Compendium.* UUID in any string of any Nim+ document (grantItem/grantSpells rules,
 * description @UUID[...] links, flags, macros) resolves to a document in the system packs (all of
 * them, read from ../FoundryVTT-Nimble/public/system.json) or in the Nim+ packs.
 */
import { describe, expect, it } from 'vitest';
import { allRules, allSystemUuids, checkUuidRefs, resolveUuid, UUID_RE } from './checks.mjs';
import { retiredUuids, supersedeDocs } from './checks-02.mjs';
import { canonicalUuid, MODULE_ID, nimDocs, walkStrings } from './lib.mjs';

const is02 = (doc) => {
	const f = doc.flags?.[MODULE_ID] ?? {};
	return f.playtest02 === true || (Array.isArray(f.supersedes) && f.supersedes.length > 0);
};

/** [{file, where, uuid, doc}] for every reference outside the supersedes flag. */
function references() {
	const out = [];
	for (const { doc, file } of nimDocs()) {
		for (const [where, s] of walkStrings(doc)) {
			if (where.includes('.supersedes')) continue;
			for (const m of s.matchAll(UUID_RE)) out.push({ file, where, uuid: m[0], doc });
		}
	}
	return out;
}

describe('pack-data: UUID references', () => {
	it('the resolver sees every system pack (not only the four the harness installs)', () => {
		const packs = new Set([...allSystemUuids().keys()].map((u) => u.split('.')[2]));
		expect([...packs]).toEqual(expect.arrayContaining(['nimble-items', 'nimble-monsters', 'nimble-boons', 'nimble-magic-items', 'nimble-spells']));
		expect(resolveUuid('Compendium.nimble.nimble-items.Item.AAAAAAAAAAAAAAAA')).toBeNull();
	});

	it('there are references to check', () => {
		expect(references().length).toBeGreaterThan(100);
	});

	it('every Compendium UUID in any Nim+ string resolves (system or Nim+ pack), no foreign packages, no malformed @UUID links', () => {
		expect(checkUuidRefs()).toEqual([]);
	});

	it('grantItem rules point at Items; grantSpells uuids point at spells', () => {
		const bad = [];
		for (const { rule, file, where } of allRules()) {
			if (rule.type === 'grantItem') {
				if (!/\.Item\.[A-Za-z0-9]{16}$/.test(rule.uuid ?? '')) bad.push(`${file} ${where}: grantItem uuid "${rule.uuid}" is not an Item uuid`);
				else if (!resolveUuid(rule.uuid)) bad.push(`${file} ${where}: grantItem ${rule.uuid} unresolved`);
			}
			if (rule.type === 'grantSpells') {
				for (const u of rule.uuids ?? []) {
					const t = resolveUuid(u);
					if (!t) bad.push(`${file} ${where}: grantSpells ${u} unresolved`);
					else if (t.type !== 'spell') bad.push(`${file} ${where}: grantSpells ${u} is a ${t.type}`);
				}
			}
		}
		expect(bad).toEqual([]);
	});

	it('no reference targets a superseded or retired system doc (0.2 would grant the hidden 2.0.3 version)', () => {
		const superseded = new Set();
		for (const { doc } of supersedeDocs()) for (const u of doc.flags[MODULE_ID].supersedes) superseded.add(canonicalUuid(u));
		const retired = new Set(retiredUuids().map(canonicalUuid));
		const bad = references()
			.filter(({ uuid }) => superseded.has(canonicalUuid(uuid)) || retired.has(canonicalUuid(uuid)))
			.map(({ file, where, uuid }) => `${file} ${where}: ${uuid} (${retired.has(canonicalUuid(uuid)) ? 'retired' : 'superseded'})`);
		expect(bad).toEqual([]);
	});

	it('no 2.0.3-era Nim+ doc references a 0.2-only Nim+ doc (hidden when the playtest setting is off)', () => {
		const byUuid = new Map(nimDocs().map((d) => [d.uuid, d]));
		const bad = references()
			.filter(({ doc }) => !is02(doc))
			.filter(({ uuid }) => {
				const t = byUuid.get(canonicalUuid(uuid));
				return t && is02(t.doc);
			})
			.map(({ file, where, uuid }) => `${file} ${where}: ${uuid}`);
		expect(bad).toEqual([]);
	});

	it('uuids carry the document type segment (the build IdBuilder only migrates Compendium.<pkg>.<pack>.<Type>.<id>)', () => {
		const bad = references()
			.filter(({ uuid }) => !/\.(Item|Actor|RollTable|JournalEntry)\.[A-Za-z0-9]{16}$/.test(uuid))
			.map(({ file, where, uuid }) => `${file} ${where}: ${uuid}`);
		expect(bad).toEqual([]);
	});
});
