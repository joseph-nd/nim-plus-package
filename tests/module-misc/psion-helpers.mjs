/**
 * Local helpers for the psion / hexbinder / macros tests (module-misc area).
 *
 * - installScriptedRoll(env): replaces globalThis.Roll with a roll whose dice
 *   results come from a queue (`env.rollQueue.push([1, 4, 6])`), falling back
 *   to max-face results; records every evaluated roll + toMessage payload.
 * - makeActor(env, {...}): a bare mock actor with the given feature/class
 *   items, plus the canvas-ish methods the psion scripts call
 *   (toggleStatusEffect, statuses, getActiveTokens, applyHealing/applyDamage).
 * - foundryWait(buttonAction, {dialog, form}): a dialog answer that reproduces
 *   Foundry v14 DialogV2#_onSubmit exactly: `(await callback(event, button,
 *   dialog)) ?? button.action` (client/applications/api/dialog.mjs).
 */
import { MODULE_ID } from '../harness/index.mjs';

export function installScriptedRoll(env) {
	env.rollQueue = [];
	env.rolls = [];
	class ScriptedRoll {
		constructor(formula, data = {}) {
			this.formula = String(formula);
			this.data = data;
			this.dice = [];
			this.total = 0;
		}
		async evaluate() {
			const m = /^\s*(\d+)d(\d+)/.exec(this.formula);
			if (m) {
				const n = Number(m[1]);
				const faces = Number(m[2]);
				const queued = env.rollQueue.shift();
				const results = queued ?? Array.from({ length: n }, () => faces);
				this.dice = [{ faces, number: n, results: results.map((result) => ({ result })) }];
				this.total = results.reduce((a, b) => a + b, 0);
			} else {
				this.total = Number(this.formula) || 0;
			}
			env.rolls.push(this);
			return this;
		}
		async toMessage(data = {}) {
			this.message = data;
			env.ChatMessage.created.push({ ...data, roll: this.formula, total: this.total });
			return { id: 'msg', ...data };
		}
	}
	globalThis.Roll = ScriptedRoll;
	return ScriptedRoll;
}

/** Identifier-carrying item data (prepared identifier = name slug in the harness). */
export function feature(name, extra = {}) {
	return { name, type: 'feature', system: { ...(extra.system ?? {}) }, flags: extra.flags ?? {} };
}

export function psionClass(level) {
	return { name: 'Psion', type: 'class', system: { classLevel: level } };
}

export function makeActor(env, { name = 'Hero', items = [], flags = {}, system = {}, statuses = [], owner = true } = {}) {
	const actor = new env.classes.Actor({
		name,
		type: 'character',
		system: { abilities: { will: { mod: 3 }, strength: { mod: 2 } }, ...system },
		flags,
		ownership: owner ? { default: 3 } : { default: 0 },
		items,
	});
	env.game.actors.set(actor.id, actor);
	actor.statuses = new Set(statuses);
	actor.statusToggles = [];
	actor.toggleStatusEffect = async (id, { active } = {}) => {
		actor.statusToggles.push({ id, active });
		const on = active ?? !actor.statuses.has(id);
		if (on) actor.statuses.add(id);
		else actor.statuses.delete(id);
		return true;
	};
	actor.tokens = [];
	actor.getActiveTokens = () => actor.tokens;
	actor.healed = [];
	actor.damaged = [];
	actor.applyHealing = async (n) => void actor.healed.push(n);
	actor.applyDamage = async (n, opts) => void actor.damaged.push({ n, opts });
	return actor;
}

export function strainOf(actor) {
	return actor.getFlag(MODULE_ID, 'psion.strainDice');
}

/**
 * Dialog answer reproducing DialogV2#_onSubmit: callback result, or the
 * button's action when the callback returns null/undefined.
 */
export function foundryWait(action, { dialog = null, button = null } = {}) {
	return async (config) => {
		const b = (config.buttons ?? []).find((x) => x.action === action);
		if (!b) throw new Error(`no button ${action}`);
		const dlg = dialog ?? { element: fakeDialogElement() };
		// Real v14: every DialogV2 button sits inside DialogV2's own <form>, so
		// `button.form` IS that wrapper form (the one holding the content fields).
		const btn = button ?? { form: dlg.element?.querySelector?.('form') ?? { elements: {} }, dataset: { action } };
		const result = await b.callback?.({}, btn, dlg);
		return result ?? b.action;
	};
}

/**
 * The dialog element as the browser builds it: DialogV2 renders
 * `form.innerHTML = '<div class="dialog-content">' + content + '</div>'`, and
 * HTML fragment parsing with a <form> context drops any nested <form> start
 * tag, so `querySelector('form.<custom>')` finds nothing.
 */
export function fakeDialogElement(formElements = {}) {
	const wrapper = { tagName: 'FORM', className: 'dialog-form standard-form', elements: formElements };
	return {
		querySelector(sel) {
			if (sel === 'form' || sel === 'form.dialog-form') return wrapper;
			if (/^form\.[\w-]+$/.test(sel)) return null; // nested custom form was dropped by the parser
			return null;
		},
		querySelectorAll: () => [],
	};
}

export function token(actor, { x = 0, y = 0, disposition = 1, actorId } = {}) {
	const doc = { x, y, disposition, actor, actorId: actorId ?? actor?.id, id: `tok${Math.random().toString(36).slice(2, 8)}` };
	return { document: doc, actor, x, y };
}
