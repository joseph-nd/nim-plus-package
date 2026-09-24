/**
 * scripts/core/supersede.mjs — living next to other modules that patch the same
 * CompendiumCollection methods (Babele, via libWrapper).
 *
 * Regression: Babele's `indexDocument` wrapper (`preserveIndexFlags`) merges
 * into the index entry right after the wrapped call returns. The supersede layer
 * used to delete a hidden entry inline, so Babele's mergeObject got `undefined`
 * and threw ("One of original or other are not Objects!"), which killed the
 * startup subclass sync that loads the Nim+ packs with getDocuments().
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setupWorld, supersedeOracle } from '../harness/index.mjs';

const idOf = (uuid) => uuid.split('.').pop();
const collOf = (uuid) => uuid.split('.').slice(1, 3).join('.');

/** One hidden (collection, id) pair with the playtest setting on. */
async function aHiddenDoc() {
	const oracle = await supersedeOracle();
	const uuid = [...oracle.hiddenWhen(true)].find((u) => u.startsWith('Compendium.nimble.'));
	return { coll: collOf(uuid), id: idOf(uuid) };
}

function compendiumProto() {
	return (foundry?.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection).prototype;
}

/** A Babele-style outer wrapper: reads (merges into) the entry the wrapped call indexed. */
function wrapLikeBabele() {
	const proto = compendiumProto();
	const inner = proto.indexDocument;
	const seen = [];
	proto.indexDocument = function babeleLike(document, ...rest) {
		const result = inner.call(this, document, ...rest);
		const entry = this.index.get(document.id);
		if (!entry || typeof entry !== 'object') throw new Error('One of original or other are not Objects!');
		seen.push(document.id);
		return result;
	};
	return seen;
}

/** Minimal libWrapper: resolves the dotted target and chains WRAPPER-type wrappers. */
function installFakeLibWrapper() {
	const calls = [];
	globalThis.libWrapper = {
		register(module, target, fn, type) {
			calls.push({ module, target, type });
			const path = target.split('.');
			const name = path.pop();
			let owner = globalThis;
			for (const key of path) owner = owner?.[key];
			if (!owner && path.at(-1) === 'prototype') owner = compendiumProto();
			const wrappedFn = owner[name];
			owner[name] = function libWrapped(...args) {
				return fn.call(this, wrappedFn.bind(this), ...args);
			};
		},
	};
	return calls;
}

afterEach(() => {
	delete globalThis.libWrapper;
});

describe('supersede interop with other CompendiumCollection wrappers', () => {
	it('an outer Babele-style indexDocument wrapper sees the entry, then it is hidden', async () => {
		const { env } = await setupWorld({ playtest: true });
		await env.flush();
		const seen = wrapLikeBabele();
		const { coll, id } = await aHiddenDoc();
		const pack = env.game.packs.get(coll);

		const doc = await pack.getDocument(id);
		expect(doc?.id).toBe(id);
		expect(seen).toContain(id);
		expect(pack.index.has(id)).toBe(false);

		// Bulk loads (the subclass sync's path) survive the same wrapper.
		await expect(pack.getDocuments()).resolves.toBeInstanceOf(Array);
		expect(pack.index.has(id)).toBe(false);
	});

	it('registers both wrappers through libWrapper when it is active, and still filters', async () => {
		const calls = installFakeLibWrapper();
		const { env } = await setupWorld({ playtest: true });
		await env.flush();
		const targets = calls.filter((c) => c.module === 'nim-plus-package').map((c) => [c.target.split('.').pop(), c.type]);
		expect(targets).toEqual([
			['getIndex', 'WRAPPER'],
			['indexDocument', 'WRAPPER'],
		]);

		const { coll, id } = await aHiddenDoc();
		const pack = env.game.packs.get(coll);
		expect(pack.index.has(id)).toBe(false);
		await pack.getIndex({ fields: ['system.rules'] });
		expect(pack.index.has(id)).toBe(false);
		await pack.getDocument(id);
		await env.flush();
		expect(pack.index.has(id)).toBe(false);
	});
});
