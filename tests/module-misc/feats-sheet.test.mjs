/**
 * Feats — character-sheet integration: the Feats section on the Features tab
 * (scripts/feats/sheet-section.mjs, sheet-hooks.mjs, styles.mjs) and the weapon
 * equip toggle on the Inventory tab (scripts/feats/weapon-equip-toggle.mjs).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MODULE_ID, randomID } from '../harness/index.mjs';
import { character, featItem, featsWorld, FakeMutationObserver, mount, weaponItem } from './feats-helpers.mjs';

function sheetRoot({ tab = 'features', sublistIds = [] } = {}) {
	const icon = tab === 'features' ? 'fa-table-list' : 'fa-book';
	return mount(`<div class="sheet">
		<nav><button data-button-state="active"><i class="fa-solid ${icon}"></i></button></nav>
		<div class="nimble-sheet__body nimble-sheet__body--player-character">
			<ul class="nimble-item-list--sublist">${sublistIds.map((id) => `<li class="nimble-feature-card" data-item-id="${id}">x</li>`).join('')}</ul>
		</div>
	</div>`);
}

const sectionOf = (root) => root.querySelector('.nim-plus-feats-section');

describe('Feats section on the Features tab', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld({ systemPacks: ['classes'] }));
	});

	async function sheet(spec = {}, rootOpts = {}) {
		const actor = await character(env, spec);
		const root = sheetRoot(rootOpts);
		const app = { document: actor, element: root };
		actor.apps = { sheet: app };
		return { actor, root, app };
	}

	it('lists owned feats (sorted), shows Choose Feat (n) + badge when owed', async () => {
		const { root, app } = await sheet({ level: 8, items: [featItem('Tough'), featItem('Alert')] });
		m.sheetSection.syncFeatsTabSection(app);
		const s = sectionOf(root);
		expect(s).not.toBeNull();
		expect(s.querySelectorAll('.nim-plus-feat-card__name').map((e) => e.textContent)).toEqual(['Alert', 'Tough']);
		expect(s.querySelector('[data-nim-plus-feat="choose"]').textContent.trim()).toBe('Choose Feat');
		expect(s.querySelector('.nim-plus-feats-section__badge').textContent).toBe('1 available');
		// Styles injected once.
		expect(document.querySelectorAll('#nim-plus-feats-styles')).toHaveLength(1);
	});

	it('no Choose button when nothing is owed; empty-state text with no feats', async () => {
		const { root, app } = await sheet({ level: 1, items: [featItem('Alert')] });
		m.sheetSection.syncFeatsTabSection(app);
		expect(sectionOf(root).querySelector('[data-nim-plus-feat="choose"]')).toBeNull();
		const { root: r2, app: a2 } = await sheet({ level: 3 });
		m.sheetSection.syncFeatsTabSection(a2);
		expect(sectionOf(r2).querySelector('.nim-plus-feats-section__empty')).not.toBeNull();
	});

	it('hides feat cards the system nests under the class card, leaves others alone', async () => {
		const alert = featItem('Alert');
		const { root, app } = await sheet({ level: 1, items: [alert] }, { sublistIds: [alert._id, 'otherFeature0001'] });
		m.sheetSection.syncFeatsTabSection(app);
		const cards = root.querySelectorAll('.nimble-feature-card');
		expect(cards.find((c) => c.dataset.itemId === alert._id).style.display).toBe('none');
		expect(cards.find((c) => c.dataset.itemId === 'otherFeature0001').style.display).toBeUndefined();
	});

	it('is idempotent: same signature keeps the same node; a new feat re-renders', async () => {
		const { root, app, actor } = await sheet({ level: 4, items: [featItem('Alert')] });
		m.sheetSection.syncFeatsTabSection(app);
		const first = sectionOf(root);
		m.sheetSection.syncFeatsTabSection(app);
		expect(sectionOf(root)).toBe(first);
		expect(root.querySelectorAll('.nim-plus-feats-section')).toHaveLength(1);
		await actor.createEmbeddedDocuments('Item', [featItem('Tough')]);
		m.sheetSection.syncFeatsTabSection(app);
		expect(sectionOf(root)).not.toBe(first);
		expect(root.querySelectorAll('.nim-plus-feats-section')).toHaveLength(1);
	});

	it.each([
		['another tab is active', { rootOpts: { tab: 'spells' } }],
		['the character has no class', { spec: { classId: null } }],
	])('removes / never adds the section when %s', async (_l, { rootOpts = {}, spec = {} }) => {
		const { root, app } = await sheet({ level: 4, ...spec }, rootOpts);
		m.sheetSection.syncFeatsTabSection(app);
		expect(sectionOf(root)).toBeNull();
	});

	it('removes the section when the setting is switched off', async () => {
		const { root, app } = await sheet({ level: 4 });
		m.sheetSection.syncFeatsTabSection(app);
		expect(sectionOf(root)).not.toBeNull();
		await env.settings.set(MODULE_ID, 'enableFeats', false);
		m.sheetSection.syncFeatsTabSection(app);
		expect(sectionOf(root)).toBeNull();
	});

	it('Choose Feat button opens the picker, grants, and refreshes the section', async () => {
		const { root, app, actor } = await sheet({ level: 1 });
		m.sheetSection.syncFeatsTabSection(app);
		env.dialogs.answer((config) => {
			const r = document.createElement('div');
			r.innerHTML = config.content;
			r.querySelectorAll('input').find((i) => i.value === 'alert').checked = true;
			return config.buttons[0].callback({}, { form: r }, { element: r }); // v14: button.form wraps the content
		});
		sectionOf(root).querySelector('[data-nim-plus-feat="choose"]').click();
		await env.flush();
		expect(actor.items.some((i) => i.name === 'Alert')).toBe(true);
		expect(sectionOf(root).querySelector('[data-nim-plus-feat="choose"]')).toBeNull();
	});

	it('configure buttons appear for an unallocated Academic / unchosen Elemental Specialist and open their dialogs', async () => {
		const { root, app } = await sheet({ level: 4, items: [featItem('Academic'), featItem('Elemental Specialist')] });
		m.sheetSection.syncFeatsTabSection(app);
		const kinds = sectionOf(root).querySelectorAll('[data-nim-plus-feat-config]').map((b) => b.dataset.nimPlusFeatConfig);
		expect(kinds).toEqual(['academic', 'elemental']);
		sectionOf(root).querySelector('[data-nim-plus-feat-config="academic"]').click();
		await env.flush();
		expect(env.dialogs.log.at(-1).title).toMatch(/Academic/);
	});

	it('card header opens the feat sheet; icon overlay sends it to chat', async () => {
		const alert = featItem('Alert');
		const { root, app, actor } = await sheet({ level: 1, items: [alert] });
		actor.activateItem = vi.fn();
		const feat = actor.items.get(alert._id);
		const render = vi.fn();
		Object.defineProperty(feat, 'sheet', { value: { render } });
		m.sheetSection.syncFeatsTabSection(app);
		sectionOf(root).querySelector(`[data-nim-plus-open-feat="${alert._id}"]`).click();
		expect(render).toHaveBeenCalledWith(true);
		sectionOf(root).querySelector(`[data-nim-plus-feat-chat="${alert._id}"]`).click();
		expect(actor.activateItem).toHaveBeenCalledWith(alert._id);
	});

	it('escapes feat names and prerequisites (world-authored feats)', async () => {
		const evil = { _id: randomID(), name: '<img src=x onerror=alert(1)>', type: 'feature', img: '"><script>', system: { group: 'feats' }, flags: { [MODULE_ID]: { feat: true, featReq: '<b>x</b>' } } };
		const { root, app } = await sheet({ level: 1, items: [evil] });
		m.sheetSection.syncFeatsTabSection(app);
		const s = sectionOf(root);
		// (the fake DOM keeps entities undecoded in text, so escaped text proves no markup was injected)
		expect(s.querySelector('.nim-plus-feat-card__name').textContent).toBe('&lt;img src=x onerror=alert(1)&gt;');
		expect(s.querySelector('.nim-plus-feat-card__req').textContent).toBe('&lt;b&gt;x&lt;/b&gt;');
		expect(s.querySelectorAll('img').map((i) => i.getAttribute('src'))).toEqual(['"><script>']);
		expect(s.querySelectorAll('script, b')).toHaveLength(0);
	});

	it('render hook sets up a MutationObserver; close hook disconnects it', async () => {
		const { root, app } = await sheet({ level: 2, items: [featItem('Alert')] });
		env.Hooks.callAll('renderPlayerCharacterSheet', app, root);
		expect(sectionOf(root)).not.toBeNull();
		const obs = app.__nimPlusFeatsObserver;
		expect(obs).toBeInstanceOf(FakeMutationObserver);
		env.Hooks.callAll('renderPlayerCharacterSheet', app, root);
		expect(obs.disconnected).toBe(true); // replaced, not stacked
		const second = app.__nimPlusFeatsObserver;
		env.Hooks.callAll('closePlayerCharacterSheet', app);
		expect(second.disconnected).toBe(true);
	});
});

describe('weapon equip toggle', () => {
	let env, m;
	beforeEach(async () => {
		({ env, m } = await featsWorld({ systemPacks: ['classes'] }));
	});

	async function inventory(items, { quantity = true } = {}) {
		const actor = await character(env, { items });
		actor.updateItem = vi.fn((id, data) => actor.items.get(id).update(data));
		const cards = items
			.map(
				(i) => `<li class="nimble-document-card--actor-inventory" data-item-id="${i._id}"><header><span class="name">${i.name}</span>${quantity ? '<input class="nimble-document-card__quantity" value="1">' : ''}</header></li>`,
			)
			.join('');
		const root = mount(`<div class="sheet"><ul>${cards}</ul></div>`);
		return { actor, root, app: { document: actor, element: root } };
	}
	const btnOf = (root, id) => root.querySelector(`[data-item-id="${id}"] .nim-plus-weapon-equip`);

	it('adds one toggle per rules-less weapon, before the quantity input, reflecting equipped', async () => {
		const dagger = weaponItem('Dagger', { equipped: true });
		const rapier = weaponItem('Rapier', { equipped: false });
		const { root, app } = await inventory([dagger, rapier]);
		m.weaponToggle.syncWeaponEquipToggles(app);
		m.weaponToggle.syncWeaponEquipToggles(app);
		const header = root.querySelector(`[data-item-id="${dagger._id}"] header`);
		expect(header.querySelectorAll('.nim-plus-weapon-equip')).toHaveLength(1);
		expect(header.children.map((c) => c.className)).toEqual(['name', 'nimble-button nim-plus-weapon-equip', 'nimble-document-card__quantity']);
		expect(btnOf(root, dagger._id).getAttribute('aria-pressed')).toBe('true');
		expect(btnOf(root, rapier._id).getAttribute('aria-pressed')).toBe('false');
	});

	it('clicking toggles system.equipped and the next sync updates the icon', async () => {
		const dagger = weaponItem('Dagger', { equipped: false });
		const { root, app, actor } = await inventory([dagger]);
		m.weaponToggle.syncWeaponEquipToggles(app);
		btnOf(root, dagger._id).click();
		await env.flush();
		expect(actor.updateItem).toHaveBeenCalledWith(dagger._id, { 'system.equipped': true });
		expect(actor.items.get(dagger._id).system.equipped).toBe(true);
		m.weaponToggle.syncWeaponEquipToggles(app);
		expect(btnOf(root, dagger._id).getAttribute('aria-pressed')).toBe('true');
		btnOf(root, dagger._id).click();
		await env.flush();
		expect(actor.items.get(dagger._id).system.equipped).toBe(false);
	});

	it('no toggle for non-weapons or weapons the system already gives an equip control', async () => {
		const shield = { _id: randomID(), name: 'Shield', type: 'object', system: { objectType: 'shield' }, flags: {} };
		const { root, app } = await inventory([shield]);
		m.weaponToggle.syncWeaponEquipToggles(app);
		expect(btnOf(root, shield._id)).toBeNull();
		const dagger = weaponItem('Dagger');
		const r2 = await inventory([dagger], { quantity: false });
		m.weaponToggle.syncWeaponEquipToggles(r2.app);
		expect(btnOf(r2.root, dagger._id)).toBeNull();
	});

	it('a failing update is logged, not thrown', async () => {
		const dagger = weaponItem('Dagger');
		const { root, app, actor } = await inventory([dagger]);
		actor.updateItem = vi.fn(async () => {
			throw new Error('nope');
		});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		m.weaponToggle.syncWeaponEquipToggles(app);
		btnOf(root, dagger._id).click();
		await env.flush();
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});
});
