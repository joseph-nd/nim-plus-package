/**
 * Mirage (2), Psionic Field Attack and Summon Spirit Companion — the psion /
 * shepherd macros that drive a DialogV2.
 *
 * Two answer styles are used:
 *  - plain functions returning a value = "the dialog produced X" (tests the
 *    logic after the dialog);
 *  - foundryWait(action, …) = Foundry v14 DialogV2#_onSubmit semantics, where
 *    a callback returning null/undefined yields the button's action string,
 *    and the dialog element is what the browser builds (nested <form> dropped).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Collection, importScripts, installFoundry, MODULE_ID } from '../harness/index.mjs';
import { fakeDialogElement, feature, foundryWait, installScriptedRoll, makeActor, psionClass, strainOf } from './psion-helpers.mjs';

describe('Mirage (2) — mirageDispatch', () => {
	let env, mirage, actor, item, targets;
	beforeEach(async () => {
		env = installFoundry();
		mirage = await importScripts('scripts/psion/mirage.mjs');
		actor = makeActor(env, { items: [psionClass(11), feature('Mirage (2)')] });
		item = actor.items.find((i) => i.name === 'Mirage (2)');
		targets = ['A', 'B'].map((n) => ({ actor: makeActor(env, { name: n }) }));
		targets[1].actor.statuses.add('taunted');
		env.game.user.targets = new Set(targets);
	});

	/**
	 * Real v14 model: the radio group lives in DialogV2's own <form>, which is
	 * `button.form` (form.elements.effect is the RadioNodeList, `.value` = checked).
	 */
	const pick = (value) => async (config) => {
		const button = { form: { elements: { effect: { value } } }, dataset: { action: 'apply' } };
		return config.buttons.find((b) => b.action === 'apply').callback({}, button, { element: fakeDialogElement() });
	};

	it('missing actor or item → error, no dialog', async () => {
		expect(await mirage.mirageDispatch(null, item)).toBeNull();
		expect(await mirage.mirageDispatch(actor, null)).toBeNull();
		expect(env.notifications.error).toHaveBeenCalledTimes(2);
		expect(env.dialogs.log).toHaveLength(0);
	});

	it.each(['blinded', 'taunted', 'prone', 'invisible'])('%s is applied to targets that lack it', async (status) => {
		env.dialogs.answer(pick(status));
		await mirage.mirageDispatch(actor, item);
		expect(targets[0].actor.statusToggles).toEqual([{ id: status, active: true }]);
		const expectB = status === 'taunted' ? [] : [{ id: status, active: true }];
		expect(targets[1].actor.statusToggles).toEqual(expectB);
		expect(env.ChatMessage.created).toHaveLength(1);
	});

	it.each(['cover', 'fear'])('%s (no native status) only posts a card', async (effect) => {
		env.dialogs.answer(pick(effect));
		await mirage.mirageDispatch(actor, item);
		expect(targets[0].actor.statusToggles).toEqual([]);
		expect(env.ChatMessage.created[0].content).toContain('No status applied');
	});

	it('closing the dialog does nothing', async () => {
		env.dialogs.answer(null);
		expect(await mirage.mirageDispatch(actor, item)).toBeNull();
		expect(env.ChatMessage.created).toHaveLength(0);
	});

	it('fixed BUG-module-misc-202: Apply reads the chosen effect from the real DialogV2 form (nested <form> is dropped by the browser)', async () => {
		const button = { form: { elements: { effect: { value: 'taunted' } } }, dataset: { action: 'apply' } };
		env.dialogs.answer(foundryWait('apply', { button, dialog: { element: fakeDialogElement() } }));
		await mirage.mirageDispatch(actor, item);
		expect(targets[0].actor.statusToggles).toEqual([{ id: 'taunted', active: true }]);
	});

	it('fixed BUG-module-misc-203: Cancel (callback → null → Foundry returns "cancel") posts nothing', async () => {
		env.dialogs.answer(foundryWait('cancel'));
		const result = await mirage.mirageDispatch(actor, item);
		expect(result).toBeNull();
		expect(env.ChatMessage.created).toHaveLength(0);
	});
});

describe('Psionic Field Attack — psionicFieldAttack', () => {
	let env, pfa, actor, item;
	const setup = ({ strike = false, strain = 0, concentration = true, weapons = true } = {}) => {
		const items = [psionClass(3), feature('Psionic Field Attack', {
			system: { activation: { effects: [{ id: 'psionFieldAtkDmg1', type: 'damage', formula: '1d4 + @abilities.will.mod' }] } },
		})];
		if (strike) items.push(feature('Psionic Strike'));
		if (weapons) {
			items.push({ name: 'Dagger', type: 'object', system: { activation: { effects: [{ type: 'damage', formula: '1d4', damageType: 'piercing' }] } } });
			items.push({ name: 'Rock', type: 'object', system: { activation: { effects: [] } } });
			items.push({ name: 'Maul', type: 'object', system: { activation: { effects: [{ type: 'damage', formula: '1d10', damageType: 'bludgeoning' }] } } });
		}
		actor = makeActor(env, {
			items,
			flags: { [MODULE_ID]: { psion: { strainDice: strain } } },
			statuses: concentration ? ['concentration'] : [],
		});
		item = actor.items.find((i) => i.name === 'Psionic Field Attack');
		item.activate = vi.fn(async (opts) => ({ activated: opts }));
	};
	const roll = (elements) => async (config) =>
		config.buttons.find((b) => b.action === 'roll').callback({}, { form: { elements } });

	beforeEach(async () => {
		env = installFoundry();
		[, pfa] = await importScripts(['scripts/psion/strain.mjs', 'scripts/psion/psionic-field-attack.mjs']);
	});

	it('lists only owned items with a damage formula', async () => {
		setup();
		env.dialogs.answer(null);
		await pfa.psionicFieldAttack(actor, item);
		const content = env.dialogs.log[0].content;
		expect(content).toContain('Dagger');
		expect(content).toContain('Maul');
		expect(content).not.toContain('Rock');
	});

	it('picked weapon: formula + WIL, fast-forwarded activation, not persisted', async () => {
		setup();
		env.dialogs.answer(roll({ weapon: { value: '1' } }));
		await pfa.psionicFieldAttack(actor, item);
		expect(item.activate).toHaveBeenCalledWith({ executeMacro: false, fastForward: true, rollFormula: '1d10 + @abilities.will.mod', rollMode: 0 });
		expect(item.system.activation.effects[0].damageType).toBe('bludgeoning');
		expect(item._source.system.activation.effects[0].damageType).toBeUndefined();
	});

	it('repeated casts never accumulate the bonus', async () => {
		setup({ strike: true, strain: 2 });
		env.dialogs.answer(roll({ weapon: { value: '0' } }), roll({ weapon: { value: '0' } }));
		await pfa.psionicFieldAttack(actor, item);
		await pfa.psionicFieldAttack(actor, item);
		const formulas = item.activate.mock.calls.map(([o]) => o.rollFormula);
		expect(formulas).toEqual(['1d4 + @abilities.will.mod + 2', '1d4 + @abilities.will.mod + 2']);
		expect(item.system.activation.effects).toHaveLength(1);
	});

	it('Psionic Strike advantage spends (gains) exactly one strain and counts the new die', async () => {
		setup({ strike: true, strain: 2 });
		env.dialogs.answer(roll({ weapon: { value: '0' }, strikeAdvantage: { checked: true } }));
		await pfa.psionicFieldAttack(actor, item);
		expect(strainOf(actor)).toBe(3);
		expect(item.activate.mock.calls[0][0]).toMatchObject({ rollFormula: '1d4 + @abilities.will.mod + 3', rollMode: 1 });
	});

	it('advantage checkbox without Psionic Strike is ignored', async () => {
		setup({ strike: false, strain: 2 });
		env.dialogs.answer(roll({ weapon: { value: '0' }, strikeAdvantage: { checked: true } }));
		await pfa.psionicFieldAttack(actor, item);
		expect(strainOf(actor)).toBe(2);
		expect(item.activate.mock.calls[0][0].rollMode).toBe(0);
	});

	it('manual row: typed formula and type, blank falls back to 1d4', async () => {
		setup({ weapons: false });
		env.dialogs.answer(roll({ weapon: { value: '__manual' }, manualFormula: { value: '  ' }, manualType: { value: 'fire' } }));
		await pfa.psionicFieldAttack(actor, item);
		expect(item.activate.mock.calls[0][0].rollFormula).toBe('1d4 + @abilities.will.mod');
		expect(item.system.activation.effects[0].damageType).toBe('fire');
	});

	it.each([
		['closed', null],
		['cancel', async (c) => c.buttons.find((b) => b.action === 'cancel').callback()],
		['cancel (Foundry semantics)', foundryWait('cancel')],
	])('%s → no strain, no activation', async (_label, answer) => {
		setup({ strike: true, strain: 1 });
		env.dialogs.answer(answer);
		expect(await pfa.psionicFieldAttack(actor, item)).toBeNull();
		expect(item.activate).not.toHaveBeenCalled();
		expect(strainOf(actor)).toBe(1);
	});

	it('bad weapon index → error, no activation, no strain', async () => {
		setup({ strike: true, strain: 1 });
		env.dialogs.answer(roll({ weapon: { value: '9' }, strikeAdvantage: { checked: true } }));
		expect(await pfa.psionicFieldAttack(actor, item)).toBeNull();
		expect(item.activate).not.toHaveBeenCalled();
		expect(strainOf(actor)).toBe(1);
	});

	it('no concentration → warns but still attacks', async () => {
		setup({ concentration: false });
		env.dialogs.answer(roll({ weapon: { value: '0' } }));
		await pfa.psionicFieldAttack(actor, item);
		expect(env.notifications.warn).toHaveBeenCalled();
		expect(item.activate).toHaveBeenCalled();
	});

	it('missing actor/item → error', async () => {
		expect(await pfa.psionicFieldAttack(null, null)).toBeNull();
		expect(env.notifications.error).toHaveBeenCalled();
	});
});

describe('Summon Spirit Companion — summonSpiritCompanion', () => {
	let env, spirit, actor, scene, template;

	const makeSynthActor = () => {
		const items = new Collection(
			['Spirit Strike', 'Spirit Heal'].map((name, i) => [`sp${i}`, { id: `sp${i}`, name }]),
		);
		items.getName = (n) => items.find((i) => i.name === n);
		return { items, updates: [], async updateEmbeddedDocuments(_t, u) { this.updates.push(...u); } };
	};

	beforeEach(async () => {
		env = installFoundry();
		globalThis.CONST.TOKEN_DISPOSITIONS = { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
		spirit = await importScripts('scripts/psion/spirit-companion.mjs');
		actor = makeActor(env, { name: 'Shep', items: [{ name: 'Shepherd', type: 'class', system: { classLevel: 5 } }] });
		template = makeActor(env, { name: 'Spirit Companion', flags: { [MODULE_ID]: { companionTemplate: 'spirit-companion' } } });
		template.prototypeToken = { toObject: () => ({ _id: 'x', name: 'Spirit Companion', texture: { src: 'spirit.webp' } }) };
		scene = {
			id: 'scene1',
			grid: { size: 100 },
			dimensions: { sceneWidth: 1000, sceneHeight: 800 },
			tokens: new Collection(),
			async createEmbeddedDocuments(_t, data) {
				return data.map((d) => {
					const tok = { id: `tok${scene.tokens.size}`, ...d, actor: makeSynthActor() };
					tok.delete = async () => void scene.tokens.delete(tok.id);
					scene.tokens.set(tok.id, tok);
					return tok;
				});
			},
		};
		env.game.scenes.set(scene.id, scene);
		globalThis.canvas.scene = scene;
	});

	const summon = (die = 8, name = 'Wisp', image = '') => () => ({ action: 'summon', name, die, image });

	it('summons a token with per-summon Strike/Heal formulas and persists the choice', async () => {
		env.dialogs.answer(summon(8));
		const tok = await spirit.summonSpiritCompanion(actor, { name: 'Summon Spirit Companion' });
		expect(tok).toBeTruthy();
		expect(tok).toMatchObject({ name: 'Wisp', x: 500, y: 400, actorLink: false, actorId: template.id });
		expect(tok.flags[MODULE_ID]).toEqual({ summoner: actor.id, spiritDie: 8 });
		expect(tok.texture.src).toBe('spirit.webp');
		const formulas = tok.actor.updates.map((u) => u.system.activation.effects[0].formula);
		expect(formulas).toEqual(['1d8 + 3', '1d8 + 3']);
		expect(actor.getFlag(MODULE_ID, 'spiritDie')).toBe(8);
		expect(actor.getFlag(MODULE_ID, 'spiritTokenId')).toBe(tok.id);
	});

	it('re-summoning replaces the previous spirit (never two)', async () => {
		env.dialogs.answer(summon(6), summon(10));
		await spirit.summonSpiritCompanion(actor, null);
		await spirit.summonSpiritCompanion(actor, null);
		expect(scene.tokens.size).toBe(1);
		expect([...scene.tokens.values()][0].flags[MODULE_ID].spiritDie).toBe(10);
	});

	it('dismiss removes the token and flags; dismiss with none warns', async () => {
		env.dialogs.answer(summon(6), () => ({ action: 'dismiss' }), () => ({ action: 'dismiss' }));
		await spirit.summonSpiritCompanion(actor, null);
		await spirit.summonSpiritCompanion(actor, null);
		expect(scene.tokens.size).toBe(0);
		expect(actor.getFlag(MODULE_ID, 'spiritTokenId')).toBeUndefined();
		await spirit.summonSpiritCompanion(actor, null);
		expect(env.notifications.warn).toHaveBeenCalledWith('No active Spirit to dismiss.');
	});

	it('closing the dialog changes nothing', async () => {
		env.dialogs.answer(summon(6), null);
		await spirit.summonSpiritCompanion(actor, null);
		const before = JSON.stringify(actor._source.flags);
		await spirit.summonSpiritCompanion(actor, null);
		expect(JSON.stringify(actor._source.flags)).toBe(before);
		expect(scene.tokens.size).toBe(1);
	});

	it('pre-fills the dialog with the saved die/name and escapes them', async () => {
		await actor.setFlag(MODULE_ID, 'spiritName', '"><script>');
		await actor.setFlag(MODULE_ID, 'spiritDie', 12);
		env.dialogs.answer(null);
		await spirit.summonSpiritCompanion(actor, null);
		const { content } = env.dialogs.log[0];
		expect(content).toContain('<option value="12" selected>');
		expect(content).not.toContain('"><script>');
	});

	it('missing actor → error', async () => {
		expect(await spirit.summonSpiritCompanion(null, null)).toBeNull();
		expect(env.notifications.error).toHaveBeenCalled();
	});

	it('fixed BUG-module-misc-204: pressing Cancel (Foundry returns "cancel") keeps the existing spirit and flags untouched', async () => {
		env.dialogs.answer(summon(8));
		await spirit.summonSpiritCompanion(actor, null);
		const before = JSON.stringify(actor._source.flags);
		const tokenId = actor.getFlag(MODULE_ID, 'spiritTokenId');
		env.dialogs.answer(foundryWait('cancel'));
		const result = await spirit.summonSpiritCompanion(actor, null);
		expect(result).toBeNull();
		expect(scene.tokens.has(tokenId)).toBe(true);
		expect(JSON.stringify(actor._source.flags)).toBe(before);
	});

	it('fixed BUG-module-misc-205: Summon reads name/die from the real DialogV2 form (nested <form> dropped)', async () => {
		const elements = { name: { value: 'Wisp' }, die: { value: '8' }, image: { value: '' } };
		const button = { form: { elements }, dataset: { action: 'summon' } };
		env.dialogs.answer(foundryWait('summon', { button, dialog: { element: fakeDialogElement(elements) } }));
		const tok = await spirit.summonSpiritCompanion(actor, null);
		expect(tok?.name).toBe('Wisp');
		expect(actor.getFlag(MODULE_ID, 'spiritDie')).toBe(8);
		expect(tok.actor.updates[0].system.activation.effects[0].formula).toBe('1d8 + 3');
	});
});
