/**
 * Class and subclass structure, in both playtest modes (setting on = 0.2 view, off = 2.0.3 view):
 * class groupIdentifiers resolve to features, every Nim+ feature group is listed by its class,
 * subclass parentClass is a real class and its features' group is the Foundry name slug
 * (FoundryVTT-Nimble/src/utils/buildSubclassFeatureIndex.ts keys by system.group, and the level-up
 * dialog looks subclasses up by `name.slugify({strict: true})`).
 */
import { describe, expect, it } from 'vitest';
import { slugify } from '../harness/index.mjs';
import { checkFeatureGroupsListed, checkGroupIdentifiers, checkSubclasses, classDocs, visibleDocs } from './checks-02.mjs';
import { foundrySlugify, MODULE_ID, nimDocs, onlyBug, unexplained } from './lib.mjs';

const KNOWN = {
	// artificer.json lists "artificer-subclasses/forge-of-the-*" in groupIdentifiers; the subclass features use
	// group "forge-of-the-*" (subclass: true), so these three class groups match nothing.
	'BUG-pack-data-4': (v) => v.startsWith('pack-sources/classes/artificer.json: groupIdentifier "artificer-subclasses/'),
};

const isSystem = (v) => v.startsWith('../FoundryVTT-Nimble/');

describe('pack-data: exact Foundry slugify', () => {
	it('matches Foundry v14 String#slugify for names with "&" and curly quotes', () => {
		expect(foundrySlugify('Circle of Fang & Claw', { strict: true })).toBe('circle-of-fang-and-claw');
		expect(foundrySlugify('I’m the Patron Now!', { strict: true })).toBe('im-the-patron-now');
		expect(foundrySlugify('  Pact of the Red Dragon ', { strict: true })).toBe('pact-of-the-red-dragon');
	});

	it('info: the harness slugify diverges from Foundry on "&" (harness gap, not a module bug)', () => {
		// tests/harness/foundry-utils.mjs approximates CHAR_MAP with NFD; "&" is dropped instead of → "and".
		// buildCharacterAtLevel therefore cannot find features of "… & …" subclasses by name slug.
		const harness = slugify('Circle of Sky & Storm', { strict: true });
		console.info(`[pack-data] harness slugify("Circle of Sky & Storm") = "${harness}", Foundry = "circle-of-sky-and-storm"`);
		expect(typeof harness).toBe('string');
	});
});

describe.each([
	['0.2 (setting on)', true],
	['2.0.3 (setting off)', false],
])('pack-data: classes & subclasses — %s', (_label, enabled) => {
	it('every visible class has groupIdentifiers', () => {
		for (const { doc } of classDocs(visibleDocs(enabled))) expect(doc.system.groupIdentifiers?.length ?? 0).toBeGreaterThan(0);
	});

	it('every groupIdentifier of a Nim+ class resolves to at least one visible feature', () => {
		const v = checkGroupIdentifiers(enabled).filter((x) => !isSystem(x));
		expect(unexplained(v, KNOWN)).toEqual([]);
	});

	it('info: system-class groupIdentifiers with no feature (system data, not Nim+)', () => {
		const v = checkGroupIdentifiers(enabled).filter(isSystem);
		if (v.length) console.info(`[pack-data] ${enabled ? '0.2' : '2.0.3'} system class groups without features:\n  ${v.join('\n  ')}`);
		expect(Array.isArray(v)).toBe(true);
	});

	it('every Nim+ non-subclass class feature group is listed in its class groupIdentifiers', () => {
		expect(checkFeatureGroupsListed(enabled)).toEqual([]);
	});

	it('every Nim+ subclass has a real parentClass and features grouped under its Foundry name slug; every subclass feature group matches a subclass', () => {
		expect(checkSubclasses(enabled)).toEqual([]);
	});
});

it.fails('BUG-pack-data-4: artificer groupIdentifiers only list groups that exist as class features', () => {
	expect(onlyBug(checkGroupIdentifiers(true), KNOWN, 'BUG-pack-data-4')).toEqual([]);
});

describe('pack-data: per-class 0.2 progression', () => {
	const classes = classDocs(visibleDocs(true)).map((d) => [d.doc.name, d]);

	it.each(classes)('%s: at least one feature at level 1 and every level-up feature is gained within 1..20', (_name, { doc }) => {
		const cls = doc.system.identifier || foundrySlugify(doc.name, { strict: true });
		const feats = visibleDocs(true).filter((d) => d.doc.type === 'feature' && d.doc.system.class === cls && !d.doc.system.subclass);
		expect(feats.length).toBeGreaterThan(0);
		const lv = feats.flatMap((d) => d.doc.system.gainedAtLevels ?? [d.doc.system.gainedAtLevel]);
		expect(lv).toContain(1);
		for (const l of lv) expect(l >= 1 && l <= 20).toBe(true);
	});

	it.each(classes)('%s: the class item identifier matches the name slug the system derives', (_name, { doc }) => {
		if (doc.system.identifier) expect(doc.system.identifier).toBe(foundrySlugify(doc.name, { strict: true }));
	});

	it('every 0.2 Nim+ subclass has features at the subclass levels its class uses (3 and later)', () => {
		const bad = [];
		const docs = visibleDocs(true);
		for (const { doc, file, pack } of docs) {
			if (doc.type !== 'subclass' || pack.pkg !== MODULE_ID || !doc.flags?.[MODULE_ID]?.playtest02) continue;
			const slug = foundrySlugify(doc.name, { strict: true });
			const feats = docs.filter((d) => d.doc.type === 'feature' && d.doc.system.subclass && d.doc.system.class === doc.system.parentClass && d.doc.system.group === slug);
			const lv = new Set(feats.flatMap((d) => d.doc.system.gainedAtLevels ?? [d.doc.system.gainedAtLevel]));
			if (!lv.has(3)) bad.push(`${file}: no level 3 feature (levels ${[...lv].sort((a, b) => a - b)})`);
		}
		expect(bad).toEqual([]);
	});
});

it('sanity: the Nim+ packs hold class items for every class a Nim+ feature names', () => {
	const classIds = new Set(classDocs(visibleDocs(true)).map((d) => d.doc.system.identifier || foundrySlugify(d.doc.name, { strict: true })));
	const missing = [...new Set(nimDocs().filter((d) => d.doc.type === 'feature' && d.doc.system?.class).map((d) => d.doc.system.class))].filter((c) => !classIds.has(c));
	expect(missing).toEqual([]);
});
