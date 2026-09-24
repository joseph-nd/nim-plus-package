/**
 * scripts/compendium/entry-levels.mjs — level badges + level sort on the Nim+
 * class-features pack, tier badges on the Nim+ spells pack.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MODULE_ID, setupWorld } from '../harness/index.mjs';
import { el, installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

let env;
beforeEach(async () => {
	installFakeDom();
	({ env } = await setupWorld({ scripts: ['scripts/compendium/entry-levels.mjs'], boot: 'setup' }));
});
afterEach(() => uninstallFakeDom());

function directory(entries) {
	const list = el('ol', { class: 'directory-list' });
	for (const { id, name } of entries) {
		list.append(el('li', { 'data-entry-id': id }, [el('a', { class: 'entry-name', text: name })]));
	}
	return el('section', {}, [list]);
}
const badgeText = (li) => li.querySelector('.nimble-compendium-entry-level')?.textContent ?? null;

async function renderPack(collection, pickEntries) {
	const pack = env.game.packs.get(collection);
	const entries = pickEntries([...pack.index.values()]);
	const root = directory(entries.map((e) => ({ id: e._id, name: e.name })));
	env.Hooks.callAll('renderCompendium', { collection: pack }, root);
	await env.flush();
	return { pack, root, list: root.querySelector('ol') };
}

describe('class-features pack', () => {
	it('adds level badges and sorts every entry by its first level (unlevelled last)', async () => {
		const { pack, list } = await renderPack(`${MODULE_ID}.nim-plus-class-features`, (all) => all.slice().reverse());
		await pack.getIndex({ fields: ['system.gainedAtLevel', 'system.gainedAtLevels'] });
		const levelOf = (id) => {
			const e = pack.index.get(id);
			const multi = e.system?.gainedAtLevels ?? [];
			const lv = [...(Array.isArray(multi) ? multi : []), e.system?.gainedAtLevel].map(Number).filter((n) => n > 0);
			return lv.length ? Math.min(...lv) : Infinity;
		};
		const order = list.children.map((li) => levelOf(li.dataset.entryId));
		const sorted = [...order].sort((a, b) => a - b);
		expect(order).toEqual(sorted);
		expect(list.children.length).toBe(pack.index.size);
		const withLevel = list.children.filter((li) => levelOf(li.dataset.entryId) !== Infinity);
		expect(withLevel.length).toBeGreaterThan(10);
		for (const li of withLevel) {
			expect(li.classList.contains('nimble-compendium-entry-with-level')).toBe(true);
			expect(badgeText(li)).toMatch(/^\d+(, \d+)*$/);
		}
	});

	it('re-rendering does not duplicate badges', async () => {
		const pack = env.game.packs.get(`${MODULE_ID}.nim-plus-class-features`);
		const first = [...pack.index.values()].slice(0, 5);
		const root = directory(first.map((e) => ({ id: e._id, name: e.name })));
		env.Hooks.callAll('renderCompendium', { collection: pack }, root);
		await env.flush();
		env.Hooks.callAll('renderCompendium', { collection: pack }, root);
		await env.flush();
		for (const li of root.querySelector('ol').children) {
			expect(li.querySelectorAll('.nimble-compendium-entry-level').length).toBeLessThanOrEqual(1);
		}
	});

	it('unknown entry ids (not in the index) are left unbadged and sorted last', async () => {
		const pack = env.game.packs.get(`${MODULE_ID}.nim-plus-class-features`);
		const known = [...pack.index.values()][0];
		const root = directory([
			{ id: 'zzzzzzzzzzzzzzzz', name: 'Ghost' },
			{ id: known._id, name: known.name },
		]);
		env.Hooks.callAll('renderCompendium', { collection: pack }, root);
		await env.flush();
		const lis = root.querySelector('ol').children;
		expect(lis.at(-1).dataset.entryId).toBe('zzzzzzzzzzzzzzzz');
		expect(badgeText(lis.at(-1))).toBeNull();
		expect(env.Hooks.errors).toEqual([]);
	});
});

describe('spells pack', () => {
	it('adds a tier badge to every spell ("C" for cantrips), without reordering', async () => {
		const { pack, list } = await renderPack(`${MODULE_ID}.nim-plus-spells`, (all) => all);
		await pack.getIndex({ fields: ['system.tier'] });
		for (const li of list.children) {
			const tier = Number(pack.index.get(li.dataset.entryId).system?.tier);
			if (!Number.isFinite(tier)) continue;
			expect(badgeText(li)).toBe(tier === 0 ? 'C' : String(tier));
		}
		expect(list.children.some((li) => badgeText(li) === 'C')).toBe(true);
	});
});

describe('other packs / bad input', () => {
	it('ignores other packs, missing collection, non-element roots', async () => {
		const pack = env.game.packs.get('nimble.nimble-class-features');
		const entry = [...pack.index.values()][0];
		const root = directory([{ id: entry._id, name: entry.name }]);
		env.Hooks.callAll('renderCompendium', { collection: pack }, root);
		env.Hooks.callAll('renderCompendium', {}, root);
		env.Hooks.callAll('renderCompendium', { collection: env.game.packs.get(`${MODULE_ID}.nim-plus-spells`) }, '<div>');
		await env.flush();
		expect(badgeText(root.querySelector('li'))).toBeNull();
		expect(env.Hooks.errors).toEqual([]);
	});
});
