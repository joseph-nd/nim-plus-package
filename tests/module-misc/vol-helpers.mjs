/**
 * Local helpers for the Vol I / Vol IV tests (module-misc area).
 *
 * - bootVol4(opts): fresh Foundry globals + every vol4 script imported in one
 *   registry (so dawnmark's hooks register once) + init/setup.
 * - vol4Actor(env, {...}): mock character with the Nimble methods the vol4
 *   macros call (applyDamage/applyHealing mirroring Nimble's HP math,
 *   toggleStatusEffect, statuses, getActiveTokens).
 * - idealWait(action, values): a DialogV2 answer where the callback's
 *   `querySelector('form.<x>')` finds a form carrying `values` — i.e. what the
 *   macros ASSUME the browser gives them. Used to test the logic downstream of
 *   the dialog.
 * - Realistic dialog answers (Foundry v14 `(await callback()) ?? action`, and
 *   the nested-<form> the HTML parser drops) come from ./psion-helpers.mjs.
 * - realItem(name, where?): a clean copy of a real pack document (no _id).
 */
import { findDocs, importScripts, installFoundry, MODULE_ID } from '../harness/index.mjs';
import { installScriptedRoll } from './psion-helpers.mjs';

export const VOL4_SCRIPTS = [
	'scripts/vol4/charges.mjs',
	'scripts/vol4/dawnmark.mjs',
	'scripts/vol4/runes.mjs',
	'scripts/vol4/weapons.mjs',
	'scripts/vol4/wondrous.mjs',
	'scripts/vol4/derived.mjs',
];

export async function bootVol4({ isGM = true, systemId, before } = {}) {
	const env = installFoundry({ isGM, systemId });
	installScriptedRoll(env);
	before?.(env);
	const mods = await importScripts(VOL4_SCRIPTS);
	await env.boot({ until: 'setup' });
	const [charges, dawnmark, runes, weapons, wondrous, derived] = mods;
	return { env, charges, dawnmark, runes, weapons, wondrous, derived };
}

export function vol4Actor(
	env,
	{ name = 'Hero', type = 'character', items = [], flags = {}, hp = 20, temp = 0, key = 3, level = 5, system = {}, owner = true, statuses = [] } = {},
) {
	const actor = new env.classes.Actor({
		name,
		type,
		system: {
			key,
			attributes: { hp: { value: hp, max: Math.max(hp, 20), temp }, wounds: { value: 0 } },
			classData: { levels: Array.from({ length: level }, () => 'hero') },
			...system,
		},
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
	actor.damaged = [];
	actor.healed = [];
	// Nimble's NimbleBaseActor#applyDamage: floor(abs), temp first, clamp at 0, one update.
	actor.applyDamage = async (damage) => {
		actor.damaged.push(damage);
		const amount = Math.floor(Math.abs(Number(damage)));
		if (!Number.isFinite(amount) || amount <= 0) return;
		const { value, temp: t } = actor.system.attributes.hp;
		const absorbed = Math.min(t ?? 0, amount);
		const next = Math.max(value - (amount - absorbed), 0);
		const updates = {};
		if (absorbed) updates['system.attributes.hp.temp'] = (t ?? 0) - absorbed;
		if (next !== value) updates['system.attributes.hp.value'] = next;
		if (Object.keys(updates).length) await actor.update(foundry.utils.expandObject(updates));
	};
	actor.applyHealing = async (n) => {
		actor.healed.push(n);
		const { value, max } = actor.system.attributes.hp;
		await actor.update({ system: { attributes: { hp: { value: Math.min(max, value + n) } } } });
	};
	return actor;
}

/** Make world-actor updates enforce ownership like Foundry (non-owner → rejected). */
export function enforceOwnership(env, actor) {
	const original = actor.update.bind(actor);
	actor.update = async (changes, options) => {
		if (!env.game.user.isGM && !actor.isOwner) {
			throw new Error(`User ${env.game.user.name} lacks permission to update Actor ${actor.name}`);
		}
		return original(changes, options);
	};
	return actor;
}

/** DialogV2 answer where `form.<custom>` resolves to a form with `values` as elements. */
export function idealWait(action, values = {}) {
	return async (config) => {
		const b = (config.buttons ?? []).find((x) => x.action === action);
		if (!b) throw new Error(`no button ${action}`);
		const elements = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }]));
		const form = { elements };
		const dialog = { element: { querySelector: () => form, querySelectorAll: () => [] } };
		const result = await b.callback?.({}, { form, dataset: { action } }, dialog);
		return result ?? b.action;
	};
}

export function realItem(name, where) {
	const hits = findDocs({ name, where });
	if (!hits.length) throw new Error(`realItem: no doc named ${name}`);
	const src = structuredClone(hits[0].doc);
	delete src._id;
	src._stats = { ...(src._stats ?? {}), compendiumSource: hits[0].uuid };
	return src;
}

export function weapon(name = 'Test Blade', { damage = '1d6+@strength', equipped = true, description = '', extra = {} } = {}) {
	return {
		name,
		type: 'object',
		system: {
			objectType: 'weapon',
			equipped,
			quantity: 1,
			description: { public: description, unidentified: '', secret: '' },
			activation: { effects: damage ? [{ id: 'dmg0000000000000', type: 'damage', damageType: 'slashing', formula: damage, on: { hit: [], criticalHit: [], miss: [] } }] : [] },
			rules: [],
			...extra,
		},
	};
}

export function armor(name = 'Test Mail', { equipped = true, description = '', objectType = 'armor' } = {}) {
	return {
		name,
		type: 'object',
		system: { objectType, equipped, quantity: 1, description: { public: description, unidentified: '', secret: '' }, activation: { effects: [] }, rules: [] },
	};
}

export function flagged(name, flags, { type = 'object', objectType = 'misc', equipped = true, system = {} } = {}) {
	return { name, type, system: { objectType, equipped, quantity: 1, rules: [], ...system }, flags: { [MODULE_ID]: flags } };
}

export const itemByName = (actor, name) => actor.items.find((i) => i.name === name);
