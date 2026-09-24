import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { importScripts, installFoundry, REPO_ROOT } from '../harness/index.mjs';
import { feature, foundryWait, installScriptedRoll, makeActor } from './psion-helpers.mjs';

const TOLL_JSON = JSON.parse(
	fs.readFileSync(
		path.join(REPO_ROOT, 'pack-sources/classFeatures/shepherd/shepherd-subclasses/luminary-of-tidings/toll-the-hour.json'),
		'utf-8',
	),
);

describe('Toll the Hour (scripts/hexbinder/toll-the-hour.mjs)', () => {
	let env, mod, actor, item, placeables;

	const tokenDoc = (a, { x, y, disposition }) => ({ x, y, disposition, actor: a, actorId: a.id });
	const place = (a, opts) => {
		const doc = tokenDoc(a, opts);
		placeables.push({ document: doc });
		return { document: doc };
	};

	const setup = ({ pool = { current: 2, max: 3 }, spread = false, will = 3 } = {}) => {
		const tollSrc = {
			name: TOLL_JSON.name,
			type: 'feature',
			system: { rules: TOLL_JSON.system.rules },
			flags: pool ? { nimble: { chargePools: { 'toll-the-hour': { identifier: 'toll-the-hour', scope: 'item', ...pool } } } } : {},
		};
		actor = makeActor(env, {
			name: 'Shep',
			items: [tollSrc, ...(spread ? [feature('Spread the News')] : [])],
			system: { abilities: { will: { mod: will } } },
		});
		item = [...actor.items.values()].find((i) => i.name === 'Toll the Hour');
		const self = tokenDoc(actor, { x: 0, y: 0, disposition: 1 });
		actor.tokens = [self];
		placeables.push({ document: self });
	};
	const poolOf = () => item.flags.nimble?.chargePools?.['toll-the-hour'];

	beforeEach(async () => {
		env = installFoundry();
		installScriptedRoll(env);
		placeables = [];
		globalThis.canvas.tokens = { placeables };
		globalThis.canvas.grid = { size: 100 };
		env.game.user.targets = new Set();
		mod = await importScripts('scripts/hexbinder/toll-the-hour.mjs');
	});

	it('pack JSON wires the macro to this function', () => {
		expect(TOLL_JSON.system.macro).toContain('nimPlus.tollTheHour(actor, item)');
	});

	it('missing actor/item → error', async () => {
		expect(await mod.tollTheHour(null, null)).toBeNull();
		expect(env.notifications.error).toHaveBeenCalled();
	});

	it('Jubilation heals the targeted ally WIL d10 and spends exactly one charge', async () => {
		setup();
		const ally = makeActor(env, { name: 'Ally' });
		const far = makeActor(env, { name: 'Near ally' });
		const t = place(ally, { x: 300, y: 0, disposition: 1 });
		place(far, { x: 100, y: 0, disposition: 1 });
		env.game.user.targets = new Set([t]);
		env.dialogs.answer(foundryWait('jubilation'));
		await mod.tollTheHour(actor, item);
		expect(env.rolls.map((r) => r.formula)).toEqual(['3d10']);
		expect(ally.healed).toEqual([30]);
		expect(far.healed).toEqual([]);
		expect(poolOf().current).toBe(1);
	});

	it('no target → nearest ally in Reach 4; self excluded', async () => {
		setup();
		const a = makeActor(env, { name: 'A' });
		const b = makeActor(env, { name: 'B' });
		place(a, { x: 400, y: 0, disposition: 1 });
		place(b, { x: 200, y: 100, disposition: 1 });
		env.dialogs.answer(foundryWait('jubilation'));
		await mod.tollTheHour(actor, item);
		expect(b.healed).toHaveLength(1);
		expect(a.healed).toHaveLength(0);
		expect(actor.healed).toHaveLength(0);
	});

	it('Calamity damages (radiant) and dazes an enemy; flags ineligible targets for the GM', async () => {
		setup();
		const foe = makeActor(env, { name: 'Foe', system: { attributes: { hp: { value: 10, max: 10 } } } });
		place(foe, { x: 100, y: 0, disposition: -1 });
		env.dialogs.answer(foundryWait('calamity'));
		await mod.tollTheHour(actor, item);
		expect(foe.damaged).toEqual([{ n: 30, opts: { damageType: 'radiant' } }]);
		expect(foe.statusToggles).toEqual([{ id: 'dazed', active: true }]);
		expect(env.ChatMessage.created[0].flavor).toContain('GM call');
	});

	it.each([
		['hampered status', { statuses: ['prone'] }],
		['undead', { system: { details: { creatureType: 'Undead' } } }],
		['bloodied', { system: { attributes: { hp: { value: 4, max: 10 } } } }],
	])('Calamity eligibility: %s', async (_l, spec) => {
		setup();
		const foe = makeActor(env, { name: 'Foe', ...spec });
		place(foe, { x: 100, y: 0, disposition: -1 });
		env.dialogs.answer(foundryWait('calamity'));
		await mod.tollTheHour(actor, item);
		expect(env.ChatMessage.created[0].flavor).not.toContain('GM call');
	});

	it('Spread the News hits every eligible-side token within Reach 4, not beyond', async () => {
		setup({ spread: true });
		const allies = [0, 1].map((i) => makeActor(env, { name: `A${i}` }));
		place(allies[0], { x: 100, y: 0, disposition: 1 });
		place(allies[1], { x: 0, y: 400, disposition: 1 });
		const outside = makeActor(env, { name: 'Out' });
		place(outside, { x: 500, y: 0, disposition: 1 });
		env.dialogs.answer(foundryWait('jubilation'));
		await mod.tollTheHour(actor, item);
		expect(allies.map((a) => a.healed.length)).toEqual([1, 1]);
		expect(outside.healed).toEqual([]);
		expect(poolOf().current).toBe(1);
	});

	it('WIL ≤ 0 still rolls 1d10', async () => {
		setup({ will: -1 });
		place(makeActor(env), { x: 100, y: 0, disposition: 1 });
		env.dialogs.answer(foundryWait('jubilation'));
		await mod.tollTheHour(actor, item);
		expect(env.rolls[0].formula).toBe('1d10');
	});

	it('no charges left → warning, no roll, no healing, pool untouched', async () => {
		setup({ pool: { current: 0, max: 3 } });
		const ally = makeActor(env);
		place(ally, { x: 100, y: 0, disposition: 1 });
		env.dialogs.answer(foundryWait('jubilation'));
		expect(await mod.tollTheHour(actor, item)).toBeNull();
		expect(env.rolls).toHaveLength(0);
		expect(ally.healed).toEqual([]);
		expect(poolOf().current).toBe(0);
	});

	it('no recipient → warning and the charge is NOT spent', async () => {
		setup();
		env.dialogs.answer(foundryWait('calamity'));
		expect(await mod.tollTheHour(actor, item)).toBeNull();
		expect(env.notifications.warn).toHaveBeenCalled();
		expect(poolOf().current).toBe(2);
	});

	it('no own token on the canvas → no recipient, no charge', async () => {
		setup();
		actor.tokens = [];
		env.dialogs.answer(foundryWait('jubilation'));
		await mod.tollTheHour(actor, item);
		expect(poolOf().current).toBe(2);
	});

	it('closing the dialog spends nothing', async () => {
		setup();
		place(makeActor(env), { x: 100, y: 0, disposition: 1 });
		env.dialogs.answer(null);
		expect(await mod.tollTheHour(actor, item)).toBeNull();
		expect(poolOf().current).toBe(2);
	});

	it('the spent charge can be restored by hand (plain flag write)', async () => {
		setup();
		place(makeActor(env), { x: 100, y: 0, disposition: 1 });
		env.dialogs.answer(foundryWait('jubilation'));
		await mod.tollTheHour(actor, item);
		await item.update({ 'flags.nimble.chargePools.toll-the-hour.current': 2 });
		expect(poolOf()).toMatchObject({ current: 2, max: 3 });
	});

	it.fails('BUG-module-misc-208: Calamity never auto-targets a NEUTRAL token (only hostile ones are enemies)', async () => {
		setup();
		const bystander = makeActor(env, { name: 'Shopkeeper' });
		place(bystander, { x: 100, y: 0, disposition: 0 });
		env.dialogs.answer(foundryWait('calamity'));
		await mod.tollTheHour(actor, item);
		expect(bystander.damaged).toEqual([]);
	});

	it.fails('BUG-module-misc-209: a target out of Reach is not silently swapped for a different token', async () => {
		setup();
		const wanted = makeActor(env, { name: 'Wanted' });
		const other = makeActor(env, { name: 'Other' });
		const t = place(wanted, { x: 900, y: 0, disposition: -1 });
		place(other, { x: 100, y: 0, disposition: -1 });
		env.game.user.targets = new Set([t]);
		env.dialogs.answer(foundryWait('calamity'));
		await mod.tollTheHour(actor, item);
		expect(other.damaged).toEqual([]);
		expect(poolOf().current).toBe(2);
	});

	it.fails('BUG-module-misc-210: spending with no initialised pool flag never writes a NaN charge count', async () => {
		setup({ pool: null });
		place(makeActor(env), { x: 100, y: 0, disposition: 1 });
		env.dialogs.answer(foundryWait('jubilation'));
		await mod.tollTheHour(actor, item);
		const current = poolOf()?.current;
		expect(current === undefined || Number.isFinite(current)).toBe(true);
	});
});
