/**
 * Document shape over every Nim+ pack document: type valid for its pack, name, img present and on
 * disk, an ids.json entry, and the pack-sources path conventions from CONTRIBUTING.md.
 */
import { describe, expect, it } from 'vitest';
import { loadPackData } from '../harness/index.mjs';
import { checkIds, checkImages, checkNames, checkPaths, checkTypes, PACK_TYPES, staleIds } from './checks.mjs';
import { nimDocs, onlyBug, readModuleJson, unexplained } from './lib.mjs';
import { supersededNimDocs } from './checks-02.mjs';

const KNOWN = {
	// 26 subclass-feature icons referenced by pack-sources but never added to assets/.
	'BUG-pack-data-2': (v) => / img: img "modules\/nim-plus-package\/assets\/features\/.*" does not exist/.test(v),
};

describe('pack-data: document shape', () => {
	it('the harness loads every pack without warnings (parse errors, missing ids, id clashes)', () => {
		expect(loadPackData().warnings).toEqual([]);
	});

	describe.each(readModuleJson().packs.map((p) => [p.name]))('%s', (name) => {
		const docs = nimDocs().filter((d) => d.pack.name === name);

		it('is not empty', () => {
			expect(docs.length).toBeGreaterThan(0);
		});

		it(`only holds ${(PACK_TYPES[name] ?? []).join('/')} documents`, () => {
			expect(checkTypes().filter((v) => docs.some((d) => v.startsWith(`${d.file}:`)))).toEqual([]);
		});
	});

	it('every document has a trimmed, non-empty name', () => {
		expect(checkNames()).toEqual([]);
	});

	it('every img is set and resolves to a file (module assets, system assets, Foundry core icons)', () => {
		expect(unexplained(checkImages(), KNOWN)).toEqual([]);
	});

	it.fails('BUG-pack-data-2: subclass-feature icons referenced by pack-sources exist in assets/', () => {
		expect(onlyBug(checkImages(), KNOWN, 'BUG-pack-data-2')).toEqual([]);
	});

	it('every source file has a well-formed ids.json entry matching its _id, unique per pack', () => {
		expect(checkIds()).toEqual([]);
	});

	it('names are unique per book/type/class/group/school within a pack of the same class/group (no accidental duplicate copies)', () => {
		const seen = new Map();
		const dups = [];
		// A 0.2 copy of a Nim+ original shares its name on purpose (the supersede layer shows one at a time).
		const originals = supersededNimDocs();
		for (const { doc, file, pack, uuid } of nimDocs()) {
			if (originals.has(uuid)) continue;
			const s = doc.system ?? {};
			const book = file.split('/').slice(0, 3).join('/'); // items/vol4 vs items/equipment are separate books
			const key = `${book}|${pack.name}|${doc.type}|${s.class ?? ''}|${s.group ?? ''}|${s.parentClass ?? ''}|${s.school ?? ''}|${doc.name.toLowerCase()}`;
			if (seen.has(key)) dups.push(`${file} duplicates ${seen.get(key)}`);
			else seen.set(key, file);
		}
		expect(dups).toEqual([]);
	});

	it('info: stale ids.json entries (IdBuilder is append-only, so these are expected, not bugs)', () => {
		const stale = staleIds();
		// Only report; a stale id keeps a returning file's id stable.
		if (stale.length) console.info(`[pack-data] ${stale.length} stale ids.json entries:\n  ${stale.join('\n  ')}`);
		expect(Array.isArray(stale)).toBe(true);
	});

	it('pack-sources paths follow the CONTRIBUTING.md layout (class/group dirs, subclass dirs, spell schools, flat feats/backgrounds)', () => {
		expect(checkPaths()).toEqual([]);
	});
});
