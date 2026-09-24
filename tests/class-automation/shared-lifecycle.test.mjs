/**
 * scripts/classes/shared/* and activation-lifecycle.mjs: the setting gate, the
 * DamageRoll patch, the object-activate wrapper (stack, arms, cancel, bypass),
 * the activation-dialog submit patch and the diceless-activation tidy-up.
 */
import { describe, expect, it } from 'vitest';
import { importScripts, installFoundry, makeCharacter, MODULE_ID } from '../harness/index.mjs';
import { combat, installDocumentStub, itemNamed, meleeWeapon, rangedWeapon, rawItem, rollDamage, world } from './_mocks.mjs';

const LIFECYCLE = [
	'scripts/classes/shared/activation.mjs',
	'scripts/classes/shared/combat.mjs',
	'scripts/classes/shared/damage-roll-patch.mjs',
	'scripts/classes/shared/activation-dialog.mjs',
	'scripts/classes/cheat/vicious-opportunist.mjs',
	'scripts/classes/commander/tactics.mjs',
	'scripts/classes/activation-lifecycle.mjs',
];

describe('enableClassAutomation setting', () => {
	it('is inert before registration, registered at init defaulting to true, and switchable', async () => {
		const env = installFoundry();
		const [settings] = await importScripts(['scripts/classes/shared/settings.mjs']);
		expect(settings.classQoLEnabled()).toBe(false);
		await env.boot({ until: 'init' });
		const reg = env.settings.registered.get(`${MODULE_ID}.enableClassAutomation`);
		expect(reg).toMatchObject({ scope: 'world', config: true, default: true, type: Boolean });
		expect(settings.classQoLEnabled()).toBe(true);
		await env.settings.set(MODULE_ID, 'enableClassAutomation', false);
		expect(settings.classQoLEnabled()).toBe(false);
	});
});

describe('shared/combat', () => {
	it('currentTurnKey is null outside a started combat and stable per turn', async () => {
		const { env, m } = await world({ scripts: LIFECYCLE });
		const { currentTurnKey } = m['classes/shared/combat'];
		expect(currentTurnKey()).toBeNull();
		combat(env, { started: false });
		expect(currentTurnKey()).toBeNull();
		const c = combat(env, { round: 3, turn: 2 });
		expect(currentTurnKey()).toBe(`${c.id}:3:2`);
	});

	it.each([
		['melee (reach)', meleeWeapon(), true],
		['ranged attackType', rangedWeapon(), false],
		['range property only', rawItem('Sling', 'object', { objectType: 'weapon', activation: { targets: { attackType: '' } }, properties: { selected: ['range'] } }), false],
		['no attack type', rawItem('Club', 'object', { objectType: 'weapon', activation: { targets: {} } }), true],
		['armor', rawItem('Mail', 'object', { objectType: 'armor' }), false],
		['a feature', rawItem('Strike'), false],
	])('isMeleeWeapon: %s → %s', async (_label, source, expected) => {
		const { env, m } = await world({ scripts: LIFECYCLE });
		const item = new env.classes.Item(source);
		expect(m['classes/shared/combat'].isMeleeWeapon(item)).toBe(expected);
		expect(m['classes/commander/tactics'].weaponAttackDelivery(item)).toBe(
			source.type !== 'object' || source.system.objectType !== 'weapon' ? null : expected ? 'melee' : 'ranged',
		);
	});
});

describe('shared/activation-dialog', () => {
	it.each([
		['no effects', { effects: [] }, false],
		['only fixed numbers', { effects: [{ type: 'damage', formula: '5' }] }, true],
		['a die in a nested branch', { effects: [{ type: 'damage', formula: '5', on: { hit: [{ formula: '1d6' }] } }] }, false],
		['no formulas at all', { effects: [{ type: 'condition' }] }, false],
		['a die at the top', { effects: [{ formula: '2d8+1' }] }, false],
	])('activationHasNoDice: %s → %s', async (_label, activation, expected) => {
		const { m } = await world({ scripts: LIFECYCLE });
		expect(m['classes/shared/activation-dialog'].activationHasNoDice({ system: { activation } })).toBe(expected);
	});

	it('hides the roll-mode slider on a diceless activation, only with automation on', async () => {
		for (const automation of [true, false]) {
			const { m } = await world({ scripts: LIFECYCLE, automation });
			const { makeEl } = installDocumentStub();
			const slider = makeEl('div');
			const root = { querySelector: (sel) => (sel === '.nimble-roll-mode-config' ? slider : null) };
			m['classes/shared/activation-dialog'].hideRollModeForDicelessActivation(
				{ item: { system: { activation: { effects: [{ formula: '3' }] } } } },
				root,
			);
			expect(slider.classList.contains('nim-plus-combat-tactic__hidden')).toBe(automation);
			delete globalThis.document;
		}
	});

	function fakeDialog({ vicious, tactic } = {}) {
		const calls = [];
		class Dialog {
			submitActivation(results) {
				calls.push(results);
				return 'submitted';
			}
		}
		const app = new Dialog();
		app.actor = { id: 'actor00000000001' };
		app.item = { id: 'item000000000001' };
		// Foundry hands the root as an HTMLElement; a bare stub class stands in.
		globalThis.HTMLElement ??= class HTMLElement {};
		app.element = Object.assign(new globalThis.HTMLElement(), {
			querySelector: (sel) => {
				if (sel === '[data-nim-plus-vicious]') return vicious ?? null;
				if (sel === '[data-nim-plus-tactic]') return tactic ?? null;
				return null;
			},
		});
		return { app, calls, Dialog };
	}

	it('the submit patch arms Vicious Opportunist and the chosen tactic, then calls the original once', async () => {
		const { m } = await world({ scripts: LIFECYCLE });
		const { app, calls, Dialog } = fakeDialog({ vicious: { checked: true, disabled: false }, tactic: { value: 'heavy-strike', disabled: false } });
		const { ensureActivationDialogPatched } = m['classes/shared/activation-dialog'];
		ensureActivationDialogPatched(app);
		ensureActivationDialogPatched(app);
		expect(app.submitActivation({ a: 1 })).toBe('submitted');
		expect(calls).toEqual([{ a: 1 }]);
		expect(Dialog.prototype.__nimPlusActivationDialogPatched).toBe(true);
		expect(m['classes/cheat/vicious-opportunist'].viciousArm).toEqual({ actorId: app.actor.id, itemId: app.item.id });
		expect(m['classes/commander/tactics'].tacticArm).toEqual({ actorId: app.actor.id, itemId: app.item.id, key: 'heavy-strike' });
	});

	it.each([
		['unticked checkbox / empty tactic', { checked: false, disabled: false }, { value: '', disabled: false }],
		['disabled controls', { checked: true, disabled: true }, { value: 'heavy-strike', disabled: true }],
		['no controls', undefined, undefined],
	])('%s arm nothing', async (_label, vicious, tactic) => {
		const { m } = await world({ scripts: LIFECYCLE });
		m['classes/cheat/vicious-opportunist'].setViciousArm({ stale: true });
		m['classes/commander/tactics'].setTacticArm({ stale: true });
		const { app } = fakeDialog({ vicious, tactic });
		m['classes/shared/activation-dialog'].ensureActivationDialogPatched(app);
		app.submitActivation({});
		expect(m['classes/cheat/vicious-opportunist'].viciousArm).toBeNull();
		expect(m['classes/commander/tactics'].tacticArm).toBeNull();
	});
});

describe('shared/damage-roll-patch', () => {
	it('patches the capability-matched DamageRoll class once, at setup', async () => {
		const { env, m } = await world({ scripts: LIFECYCLE });
		expect(env.DamageRoll.prototype.__nimPlusDamageRollPatched).toBe(true);
		expect(env.Roll.prototype.__nimPlusDamageRollPatched).toBeUndefined();
		const before = env.DamageRoll.prototype._evaluate;
		m['classes/shared/damage-roll-patch'].patchDamageRollForClassQoL();
		expect(env.DamageRoll.prototype._evaluate).toBe(before);
	});

	it.each([
		['a mid roll', [5, 2], {}, { from: 5, to: 8 }, 10],
		['modifier mode', [5], { modifierMode: true }, null, 5],
		['brutal primary', [5], { brutalPrimary: true }, null, 5],
		['cannot crit', [5], { canCrit: false }, null, 5],
		['already max', [8], {}, null, 8],
		['a miss', [1], {}, null, 1],
		['primary die not damage', [5, 2], { primaryDieAsDamage: false }, { from: 5, to: 8 }, 2],
		['explosion style none', [5], { explosionStyle: 'none' }, { from: 5, to: 8 }, 8],
	])('upgradePrimaryDieToCrit on %s', async (_label, faces, opts, change, total) => {
		const { env, m } = await world({ scripts: LIFECYCLE });
		const { modifierMode, ...options } = opts;
		const roll = await rollDamage(env, '1d8', faces.slice(0, 1), options);
		if (modifierMode) roll.modifierMode = true;
		env.dice.push(...faces.slice(1));
		expect(await m['classes/shared/damage-roll-patch'].upgradePrimaryDieToCrit(roll)).toEqual(change);
		expect(roll.total).toBe(total);
		if (change) expect(roll.isCritical).toBe(true);
	});
});

describe('activation lifecycle (object activate wrapper)', () => {
	async function setup(opts = {}) {
		const { env, m } = await world({ scripts: LIFECYCLE, ...opts });
		const actor = await makeCharacter(env, { classId: 'the-cheat', level: 1, items: [meleeWeapon('Dagger')] });
		return { env, m, actor, weapon: itemNamed(actor, 'Dagger') };
	}

	it('pushes the activation for the duration of the original call and pops it after', async () => {
		const { env, m, weapon } = await setup();
		const stack = m['classes/shared/activation'].activationStack;
		let seen = null;
		env.onActivate = async () => {
			seen = stack.at(-1);
			return { id: 'card' };
		};
		await weapon.activate({});
		expect(seen).toMatchObject({ item: weapon, actor: weapon.actor });
		expect(stack).toHaveLength(0);
	});

	it('pops and clears the arms even when the original activate throws', async () => {
		const { env, m, weapon } = await setup();
		env.onActivate = async () => {
			m['classes/commander/tactics'].setTacticArm({ key: 'heavy-strike' });
			throw new Error('boom');
		};
		await expect(weapon.activate({})).rejects.toThrow('boom');
		expect(m['classes/shared/activation'].activationStack).toHaveLength(0);
		expect(m['classes/commander/tactics'].tacticArm).toBeNull();
	});

	it.each([
		['executeMacro', { executeMacro: true }, true],
		['automation off', {}, false],
	])('%s bypasses the wrapper entirely', async (_label, options, automation) => {
		const { env, m, weapon } = await setup({ automation });
		const stack = m['classes/shared/activation'].activationStack;
		let depth = -1;
		env.onActivate = async () => {
			depth = stack.length;
			return { id: 'card' };
		};
		await weapon.activate(options);
		expect(depth).toBe(0);
	});

	it('a damage roll outside any activation drops a stale tactic arm', async () => {
		const { env, m } = await setup();
		m['classes/commander/tactics'].setTacticArm({ key: 'heavy-strike' });
		await rollDamage(env, '1d8', [4]);
		expect(m['classes/commander/tactics'].tacticArm).toBeNull();
	});

	it('the wrapper is installed once and never throws into Hooks', async () => {
		const { env } = await setup();
		expect(env.classes.Item.prototype.__nimPlusClassQoLPatched).toBe(true);
		expect(env.Hooks.errors).toEqual([]);
	});
});
