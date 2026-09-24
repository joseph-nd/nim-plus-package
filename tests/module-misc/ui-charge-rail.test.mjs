/**
 * scripts/ui/{encounter,charge-rail,combat-dice-tracker}.mjs — the use-counter
 * pips mirrored onto the sheet's tracker rail during an encounter, and what
 * clicking them does to the pool (resource correctability).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCharacter, MODULE_ID, setupWorld } from '../harness/index.mjs';
import { el, installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

let env, encounter, rail;

beforeEach(async () => {
	installFakeDom();
	({ env, mods: [encounter, rail] } = await setupWorld({
		scripts: ['scripts/ui/encounter.mjs', 'scripts/ui/charge-rail.mjs', 'scripts/ui/combat-dice-tracker.mjs'],
		boot: 'setup',
	}));
	foundry.applications.instances = new Map();
});
afterEach(() => uninstallFakeDom());

function startEncounter(n = 1) {
	const combat = { id: 'c1', combatants: new Map(Array.from({ length: n }, (_, i) => [`k${i}`, {}])) };
	env.game.combats.set('c1', combat);
	return combat;
}

async function actorWithPools(pools, extraItems = []) {
	return makeCharacter(env, {
		items: [
			{ name: 'Coordinated Strike!', type: 'feature', img: 'cs.webp' },
			{ name: 'Orc', type: 'ancestry', img: 'orc.webp' },
			{ name: 'Wand', type: 'object' },
			...extraItems,
		],
		pools,
	});
}

/** Point each pool's sourceItemId at the item it lives on (as the system does). */
function linkSources(actor) {
	for (const item of actor.items) {
		const cp = item._source.flags?.nimble?.chargePools;
		if (!cp) continue;
		for (const pool of Object.values(cp)) pool.sourceItemId ??= item.id;
		item.prepareData();
	}
	return actor;
}

function sheet(actor) {
	const trackers = el('div', { class: 'nimble-sheet__left-trackers' });
	const root = el('div', { class: 'sheet' }, [trackers]);
	document.body.append(root);
	const app = { document: actor, element: root };
	foundry.applications.instances.set(actor.id, app);
	return { app, root, trackers };
}
const render = ({ app, root }) => env.Hooks.callAll('renderPlayerCharacterSheet', app, root);
const pips = (root) => root.querySelectorAll('.nim-plus-charge-rail__pip');
const groups = (root) => root.querySelectorAll('.nim-plus-charge-rail__group');
const current = (item, key) => item._source.flags.nimble.chargePools[key].current;

describe('ui/encounter', () => {
	it('is active only while a combat has combatants', () => {
		expect(encounter.encounterActive()).toBe(false);
		env.game.combats.set('empty', { combatants: new Map() });
		expect(encounter.encounterActive()).toBe(false);
		startEncounter();
		expect(encounter.encounterActive()).toBe(true);
	});
});

describe('ui/charge-rail featureChargePools', () => {
	it('keeps count-only, visible, multi-use (max>1) pools from features/ancestries; clamps; sorts by label', async () => {
		const actor = linkSources(
			await actorWithPools({
				'Coordinated Strike!': {
					chargePools: {
						uses: { label: 'Uses', current: 9, max: 3 },
						gate: { label: 'Gate', current: 1, max: 2, hidden: true },
						dice: { label: 'Dice', current: 1, max: 2, dieSize: 6 },
						zero: { label: 'Zero', current: 0, max: 0 },
						once: { label: 'Hold the Line!', current: 1, max: 1 },
					},
				},
				Orc: { chargePools: { relentless: { label: 'Relentless', current: -2, max: 2 }, stormstep: { label: 'Stormstep', current: 1, max: 1 } } },
				Wand: { chargePools: { charges: { label: 'Charges', current: 1, max: 3 } } },
			}),
		);
		const out = rail.featureChargePools(actor);
		expect(out.map((p) => [p.label, p.current, p.max])).toEqual([
			['Relentless', 0, 2],
			['Uses', 3, 3],
		]);
	});

	it('single-use pools (max ≤ 1) never reach the rail', async () => {
		const actor = linkSources(
			await actorWithPools({
				'Coordinated Strike!': { chargePools: { hold: { label: 'Hold the Line!', current: 1, max: 1 }, allday: { label: 'I Can Do This ALL DAY!', current: 0, max: 1 } } },
			}),
		);
		expect(rail.featureChargePools(actor)).toEqual([]);
	});

	it('a formula pool is judged on its evaluated max now: off at 1, on once it grows past 1', async () => {
		const actor = linkSources(
			await actorWithPools({ 'Coordinated Strike!': { chargePools: { int: { label: 'INT uses', current: 1, max: 1, maxFormula: '@abilities.intelligence.mod' } } } }),
		);
		expect(rail.featureChargePools(actor)).toEqual([]);
		const feature = actor.items.find((i) => i.name === 'Coordinated Strike!');
		await feature.update({ 'flags.nimble.chargePools.int.max': 2 });
		expect(rail.featureChargePools(actor).map((p) => [p.label, p.max])).toEqual([['INT uses', 2]]);
	});

	it("Coordinated Strike!'s encounter and INT pools are railed even at max 1", async () => {
		const actor = linkSources(
			await actorWithPools({
				'Coordinated Strike!': {
					chargePools: {
						'coordinated-strike-encounter': { label: '1/encounter', current: 1, max: 1 },
						'coordinated-strike-uses': { label: 'INT uses', current: 1, max: 1 },
						'coordinated-strike-round': { label: 'Round gate', current: 1, max: 1, hidden: true },
					},
				},
			}),
		);
		expect(rail.featureChargePools(actor).map((p) => [p.label, p.max])).toEqual([
			['1/encounter', 1],
			['INT uses', 1],
		]);
	});

	it('an always-railed pool at max 0 (INT 0, below L5) stays off', async () => {
		const actor = linkSources(
			await actorWithPools({ 'Coordinated Strike!': { chargePools: { 'coordinated-strike-uses': { label: 'INT uses', current: 0, max: 0 } } } }),
		);
		expect(rail.featureChargePools(actor)).toEqual([]);
	});

	it('a feature flag forces its pools on (single-use) or off (multi-use)', async () => {
		const actor = linkSources(
			await actorWithPools(
				{
					'Hold the Line!': { chargePools: { hold: { label: 'Hold the Line!', current: 1, max: 1 } } },
					'Big Pool': { chargePools: { big: { label: 'Big', current: 3, max: 3 } } },
				},
				[
					{ name: 'Hold the Line!', type: 'feature', flags: { 'nim-plus-package': { chargeRail: true } } },
					{ name: 'Big Pool', type: 'feature', flags: { 'nim-plus-package': { chargeRail: false } } },
				],
			),
		);
		expect(rail.featureChargePools(actor).map((p) => p.label)).toEqual(['Hold the Line!']);
	});

	it('skips a pool whose source item is gone', async () => {
		const actor = await actorWithPools({ 'Coordinated Strike!': { chargePools: { uses: { current: 1, max: 2, sourceItemId: 'missing' } } } });
		expect(rail.featureChargePools(actor)).toEqual([]);
	});
});

describe('ui/charge-rail injection', () => {
	async function setup(poolOverrides = {}, activation = { cost: { type: 'action', quantity: 1, isReaction: false } }) {
		const actor = linkSources(
			await actorWithPools({
				'Coordinated Strike!': { chargePools: { 'coordinated-strike': { identifier: 'coordinated-strike', label: 'Coordinated Strike!', current: 2, max: 3, ...poolOverrides } } },
			}),
		);
		const feature = actor.items.find((i) => i.name === 'Coordinated Strike!');
		feature.system.activation = activation;
		const view = sheet(actor);
		return { actor, view, feature };
	}

	it('draws nothing outside an encounter, and one pip per max inside one', async () => {
		const { view } = await setup();
		render(view);
		expect(groups(view.root)).toHaveLength(0);
		startEncounter();
		render(view);
		expect(pips(view.root)).toHaveLength(3);
		expect(pips(view.root).filter((p) => p.classList.contains('nim-plus-charge-rail__pip--available'))).toHaveLength(2);
	});

	it('a single-use feature gets no rail entry at all', async () => {
		startEncounter();
		const { view } = await setup({ current: 1, max: 1 });
		render(view);
		expect(groups(view.root)).toHaveLength(0);
	});

	it('re-rendering replaces the rail instead of stacking a second one', async () => {
		startEncounter();
		const { view } = await setup();
		render(view);
		render(view);
		expect(view.root.querySelectorAll('.nim-plus-charge-rail')).toHaveLength(1);
	});

	it('draws nothing when class automation is off, or for an npc', async () => {
		startEncounter();
		await env.settings.set(MODULE_ID, 'enableClassAutomation', false);
		const { view } = await setup();
		render(view);
		expect(groups(view.root)).toHaveLength(0);
	});

	it.each([
		[{ cost: { type: 'action', quantity: 1, isReaction: true } }, 'Reaction'],
		[{ cost: { type: 'reaction', quantity: 1 } }, 'Reaction'],
		[{ cost: { type: 'action', quantity: 0, isReaction: true } }, 'Free Reaction'],
		[{ cost: { type: 'action', quantity: 1, isReaction: false } }, '1 Action'],
		[{ cost: { type: 'action', quantity: 2, isReaction: false } }, '2 Actions'],
		[{ cost: { type: 'action', quantity: 0, isReaction: false } }, 'Free'],
	])('the confirm names the activation cost (%j → %s)', async (activation, label) => {
		startEncounter();
		const { actor, view } = await setup({}, activation);
		actor.activateItem = vi.fn(async () => ({ id: 'card' }));
		render(view);
		pips(view.root)[0].click();
		await env.flush();
		expect(env.dialogs.log.at(-1)).toMatchObject({ kind: 'confirm', title: 'Use Coordinated Strike!' });
		expect(env.dialogs.log.at(-1).content).toContain(`(${label})?`);
	});

	it('no activation cost → the confirm has no cost in brackets', async () => {
		startEncounter();
		const { actor, view } = await setup({}, { cost: { type: 'none', quantity: 1 } });
		actor.activateItem = vi.fn(async () => ({ id: 'card' }));
		render(view);
		pips(view.root)[0].click();
		await env.flush();
		expect(env.dialogs.log.at(-1).content).toBe('<p>Use <strong>Coordinated Strike!</strong>?</p>');
	});

	it('confirming USES the feature through the system activation, then spends one (no consumer)', async () => {
		startEncounter();
		const { actor, view, feature } = await setup();
		actor.activateItem = vi.fn(async () => ({ id: 'card' }));
		render(view);
		env.dialogs.answer(true);
		pips(view.root)[1].click();
		await env.flush();
		expect(actor.activateItem).toHaveBeenCalledWith(feature.id);
		expect(current(feature, 'coordinated-strike')).toBe(1);
	});

	it.each([
		['No', false],
		['closing the dialog', null],
	])('%s does nothing: no activation, count unchanged', async (_label, answer) => {
		startEncounter();
		const { actor, view, feature } = await setup();
		actor.activateItem = vi.fn(async () => ({ id: 'card' }));
		render(view);
		env.dialogs.answer(answer);
		pips(view.root)[1].click();
		await env.flush();
		expect(actor.activateItem).not.toHaveBeenCalled();
		expect(current(feature, 'coordinated-strike')).toBe(2);
	});

	it('a refused use (no card) costs nothing', async () => {
		startEncounter();
		const { actor, view, feature } = await setup();
		actor.activateItem = vi.fn(async () => null);
		render(view);
		env.dialogs.answer(true);
		pips(view.root)[1].click();
		await env.flush();
		expect(current(feature, 'coordinated-strike')).toBe(2);
	});

	it('a feature with its own chargeConsumer is not charged twice', async () => {
		startEncounter();
		const { actor, view, feature } = await setup();
		feature.rules = new Map([['c', { type: 'chargeConsumer', poolIdentifier: 'coordinated-strike' }]]);
		actor.activateItem = vi.fn(async () => ({ id: 'card' }));
		render(view);
		env.dialogs.answer(true);
		pips(view.root)[1].click();
		await env.flush();
		expect(actor.activateItem).toHaveBeenCalledTimes(1);
		expect(current(feature, 'coordinated-strike')).toBe(2);
	});

	it.each([0, 2])('pip %i (lower available / spent) no longer sets the count: it asks to use the feature', async (index) => {
		startEncounter();
		const { actor, view, feature } = await setup();
		actor.activateItem = vi.fn(async () => ({ id: 'card' }));
		render(view);
		env.dialogs.answer(false);
		pips(view.root)[index].click();
		await env.flush();
		expect(env.dialogs.log).toHaveLength(1);
		expect(actor.activateItem).not.toHaveBeenCalled();
		expect(current(feature, 'coordinated-strike')).toBe(2);
	});

	it('a pool whose stored current exceeds max is drawn and spent against the clamped value', async () => {
		startEncounter();
		const { actor, view, feature } = await setup({ current: 7 });
		actor.activateItem = vi.fn(async () => ({ id: 'card' }));
		render(view);
		expect(pips(view.root).filter((p) => p.classList.contains('nim-plus-charge-rail__pip--available'))).toHaveLength(3);
		env.dialogs.answer(true);
		pips(view.root)[2].click();
		await env.flush();
		expect(current(feature, 'coordinated-strike')).toBe(2);
	});

	it('the badge tooltip points hand corrections at the Features tab counter', async () => {
		startEncounter();
		const { view } = await setup();
		render(view);
		const badge = view.root.querySelector('.nim-plus-charge-rail__badge');
		expect(badge.dataset.tooltip).toContain('2/3 uses');
		expect(badge.dataset.tooltip).toContain('Features tab');
	});

	it('escapes the pool source image in the badge', async () => {
		startEncounter();
		const { actor, view } = await setup();
		actor.items.find((i) => i.name === 'Coordinated Strike!').img = '"><script>x</script>';
		render(view);
		const badge = view.root.querySelector('.nim-plus-charge-rail__badge');
		expect(badge.innerHTML).not.toContain('<script>');
	});

	it('updateItem with a chargePools change redraws the open sheet; unrelated updates do not', async () => {
		startEncounter();
		const { actor, view, feature } = await setup();
		render(view);
		await feature.update({ 'flags.nimble.chargePools.coordinated-strike.current': 0 });
		expect(pips(view.root).filter((p) => p.classList.contains('nim-plus-charge-rail__pip--available'))).toHaveLength(0);
		// unrelated update → rail left as is (we detect via a marker)
		view.root.querySelector('.nim-plus-charge-rail').dataset.marker = 'keep';
		await feature.update({ name: 'Coordinated Strike!' });
		expect(view.root.querySelector('.nim-plus-charge-rail').dataset.marker).toBe('keep');
		expect(actor.name).toBeTruthy();
	});

	it('the rail disappears when the encounter ends (deleteCombat edge)', async () => {
		startEncounter();
		const { view } = await setup();
		render(view);
		expect(groups(view.root)).toHaveLength(1);
		env.game.combats.delete('c1');
		env.Hooks.callAll('deleteCombat', {}, {}, 'u');
		expect(groups(view.root)).toHaveLength(0);
	});

	it('no trackers element → nothing is injected and nothing throws', async () => {
		startEncounter();
		const { actor } = await setup();
		const root = el('div');
		env.Hooks.callAll('renderPlayerCharacterSheet', { document: actor }, root);
		expect(root.children).toHaveLength(0);
		expect(env.Hooks.errors).toEqual([]);
	});
});

describe('ui/combat-dice-tracker', () => {
	const HIDDEN = 'nim-plus-combat-tactic__hidden';
	async function commanderSheet() {
		const actor = await makeCharacter(env, {
			items: [{ name: 'Combat Dice', type: 'feature' }],
			pools: { 'Combat Dice': { chargePools: { 'combat-dice': { identifier: 'combat-dice', label: 'Combat Dice', current: 0, max: 3, dieSize: 8 } } } },
		});
		const diceGroup = el('div', { class: 'dice-pool-tracker__group' }, [el('span', { 'data-tooltip': 'Combat Dice (d8)' })]);
		const otherGroup = el('div', { class: 'dice-pool-tracker__group' }, [el('span', { 'data-tooltip': 'Judgment Dice' })]);
		const tracker = el('div', { class: 'dice-pool-tracker' }, [diceGroup, otherGroup]);
		const root = el('div', {}, [tracker]);
		document.body.append(root);
		const app = { document: actor, element: root };
		foundry.applications.instances.set(actor.id, app);
		return { actor, app, root, tracker, diceGroup, otherGroup };
	}

	it('hides only the Combat Dice group outside an encounter and shows it (even at 0) inside one', async () => {
		const s = await commanderSheet();
		env.Hooks.callAll('renderPlayerCharacterSheet', s.app, s.root);
		expect(s.diceGroup.classList.contains(HIDDEN)).toBe(true);
		expect(s.otherGroup.classList.contains(HIDDEN)).toBe(false);
		expect(s.tracker.classList.contains(HIDDEN)).toBe(false);
		startEncounter();
		env.Hooks.callAll('createCombat', {}, {}, 'u');
		expect(s.diceGroup.classList.contains(HIDDEN)).toBe(false);
	});

	it('hides the whole tracker box when the only group is hidden', async () => {
		const s = await commanderSheet();
		s.otherGroup.remove();
		env.Hooks.callAll('renderPlayerCharacterSheet', s.app, s.root);
		expect(s.tracker.classList.contains(HIDDEN)).toBe(true);
	});

	it('shows everything when class automation is off', async () => {
		await env.settings.set(MODULE_ID, 'enableClassAutomation', false);
		const s = await commanderSheet();
		env.Hooks.callAll('renderPlayerCharacterSheet', s.app, s.root);
		expect(s.diceGroup.classList.contains(HIDDEN)).toBe(false);
	});
});
