/**
 * Local helpers for the feats-* tests (module-misc area).
 *
 *  - installFeatsDom(): the shared fake DOM (./fake-dom.mjs) extended with what
 *    the feats scripts need: a real (small) HTML parser for innerHTML,
 *    `:scope >` and `:checked` selectors, insertBefore, firstElementChild,
 *    input `checked`/`value`, and a manually-triggered MutationObserver.
 *  - featsWorld(): harness world with the feats scripts imported and booted.
 *  - featItem(name): an owned-item source for a Nim+ feat (as fromCompendium).
 *  - weaponItem(name): an owned-item source for a Nimble core weapon.
 */
import { vi } from 'vitest';
import { FakeElement, installFakeDom } from './fake-dom.mjs';
import { deepClone, findDoc, importScripts, installFoundry, installPacks, makeCharacter, MODULE_ID, randomID } from '../harness/index.mjs';

export const FEATS_PACK = `${MODULE_ID}.nim-plus-feats`;

const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link', 'source']);

class FeatsElement extends FakeElement {
	constructor(tag, doc) {
		super(tag, doc);
		this.checked = false;
		this.disabled = false;
	}
	get firstElementChild() {
		return this.children[0] ?? null;
	}
	get value() {
		return this.attributes.get('value') ?? '';
	}
	set value(v) {
		this.attributes.set('value', String(v));
	}
	get innerHTML() {
		return this._html;
	}
	set innerHTML(v) {
		for (const c of this.children) c.parentElement = null;
		this.children = [];
		this._text = '';
		this._html = String(v ?? '');
		parseInto(this, this._html);
	}
	insertBefore(node, ref) {
		if (node.parentElement) node.remove();
		node.parentElement = this;
		const i = ref ? this.children.indexOf(ref) : -1;
		if (i < 0) this.children.push(node);
		else this.children.splice(i, 0, node);
		return node;
	}
	matches(selector) {
		return String(selector)
			.split(',')
			.some((s) => chainMatch(this, tokenize(s.trim()), null));
	}
	querySelectorAll(selector) {
		const out = [];
		for (const part of String(selector).split(',')) {
			const tokens = tokenize(part.trim());
			for (const el of this.descendants()) if (chainMatch(el, tokens, this) && !out.includes(el)) out.push(el);
		}
		return out;
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
}

/** ['compound', '>', 'compound', ...] (space = descendant). */
function tokenize(sel) {
	return sel.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
}

function compoundMatch(el, compound, scope) {
	if (compound === ':scope') return el === scope;
	let rest = compound;
	if (rest.endsWith(':checked')) {
		if (!el.checked) return false;
		rest = rest.slice(0, -':checked'.length);
	}
	if (!rest) return true;
	const re = /([#.]?)([\w-]+)|\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g;
	let m;
	let consumed = 0;
	while ((m = re.exec(rest))) {
		consumed += m[0].length;
		if (m[3]) {
			const v = el.getAttribute(m[3]);
			if (v === null || v === undefined) return false;
			if (m[4] !== undefined && v !== m[4]) return false;
		} else if (m[1] === '.') {
			if (!el.classList.contains(m[2])) return false;
		} else if (m[1] === '#') {
			if (el.id !== m[2]) return false;
		} else if (m[2] !== '*' && el.tagName !== m[2].toUpperCase()) return false;
	}
	return consumed > 0;
}

function chainMatch(el, tokens, scope) {
	if (!tokens.length) return true;
	const last = tokens[tokens.length - 1];
	if (!compoundMatch(el, last, scope)) return false;
	if (tokens.length === 1) return true;
	const comb = tokens[tokens.length - 2];
	if (comb === '>') {
		const rest = tokens.slice(0, -2);
		return !!el.parentElement && chainMatch(el.parentElement, rest, scope);
	}
	const rest = tokens.slice(0, -1);
	let anc = el.parentElement;
	while (anc) {
		if (chainMatch(anc, rest, scope)) return true;
		anc = anc.parentElement;
	}
	return false;
}

function parseInto(parent, html) {
	const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
	const stack = [parent];
	let m;
	while ((m = re.exec(html))) {
		const top = stack[stack.length - 1];
		if (m[1]) {
			const tag = m[1].toUpperCase();
			const i = stack.map((e) => e.tagName).lastIndexOf(tag);
			if (i > 0) stack.length = i;
		} else if (m[2]) {
			const child = new FeatsElement(m[2], parent.ownerDocument);
			for (const a of (m[3] ?? '').matchAll(/([^\s=>]+)(?:="([^"]*)")?/g)) {
				const val = a[2] === undefined ? '' : a[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
				child.setAttribute(a[1], val);
				if (a[1] === 'checked') child.checked = true;
				if (a[1] === 'disabled') child.disabled = true;
			}
			top.appendChild(child);
			if (!VOID.has(m[2].toLowerCase())) stack.push(child);
		} else if (m[4]) {
			top._text += m[4];
		}
	}
}

export class FakeMutationObserver {
	static instances = [];
	constructor(cb) {
		this.cb = cb;
		this.targets = [];
		this.disconnected = false;
		FakeMutationObserver.instances.push(this);
	}
	observe(target) {
		this.targets.push(target);
	}
	disconnect() {
		this.disconnected = true;
	}
	/** Test-only: fire the callback as if the DOM mutated. */
	trigger() {
		if (!this.disconnected) this.cb([], this);
	}
}

/** Install the fake DOM (after installFoundry, which does not touch these globals). */
export function installFeatsDom() {
	const doc = installFakeDom();
	doc.createElement = (tag) => new FeatsElement(tag, doc);
	// Rebuild the root with FeatsElements.
	doc.documentElement = new FeatsElement('html', doc);
	doc.head = doc.createElement('head');
	doc.body = doc.createElement('body');
	doc.documentElement.append(doc.head, doc.body);
	doc.getElementById = (id) => doc.documentElement.querySelector(`#${id}`);
	globalThis.HTMLElement = FeatsElement;
	globalThis.Element = FeatsElement;
	FakeMutationObserver.instances = [];
	globalThis.MutationObserver = FakeMutationObserver;
	return doc;
}

/** Build a FeatsElement tree from an HTML string, attached to document.body. */
export function mount(html) {
	const wrapper = document.createElement('div');
	wrapper.innerHTML = html;
	const root = wrapper.firstElementChild;
	document.body.appendChild(root);
	return root;
}

export const FEATS_SCRIPTS = [
	'scripts/feats/settings.mjs',
	'scripts/feats/core.mjs',
	'scripts/feats/auto-prompt.mjs',
	'scripts/feats/sheet-section.mjs',
	'scripts/feats/sheet-hooks.mjs',
	'scripts/feats/levelup.mjs',
	'scripts/feats/weapon-equip-toggle.mjs',
	'scripts/feats/mechanics/helpers.mjs',
	'scripts/feats/mechanics/armor.mjs',
	'scripts/feats/mechanics/bulwark-hooks.mjs',
	'scripts/feats/mechanics/academic.mjs',
	'scripts/feats/mechanics/elemental-specialist.mjs',
	'scripts/feats/mechanics/healer-second-wind.mjs',
	'scripts/feats/mechanics/config-status.mjs',
	'scripts/core/document-patches.mjs',
];

/**
 * @returns {Promise<{env, m: Record<string, object>}>} m keyed by basename
 * (settings, core, autoPrompt, sheetSection, levelup, weaponToggle, helpers,
 * armor, academic, elemental, healer, configStatus, patches).
 */
export async function featsWorld({ enabled = true, isGM = true, boot = 'setup', beforeImport, dom = true, systemPacks } = {}) {
	const env = installFoundry({ isGM, settings: { [`${MODULE_ID}.enableFeats`]: enabled } });
	await installPacks(env, systemPacks ? { system: systemPacks } : {});
	if (dom) installFeatsDom();
	installRoll(env);
	beforeImport?.(env);
	const mods = await importScripts(FEATS_SCRIPTS);
	const keys = ['settings', 'core', 'autoPrompt', 'sheetSection', 'sheetHooks', 'levelup', 'weaponToggle', 'helpers', 'armor', 'bulwarkHooks', 'academic', 'elemental', 'healer', 'configStatus', 'patches'];
	const m = Object.fromEntries(keys.map((k, i) => [k, mods[i]]));
	if (boot) await env.boot({ until: boot });
	return { env, m };
}

/** A Roll with a scripted total and toMessage (harness Roll has neither). */
export function installRoll(env, total = 4) {
	const created = [];
	class TestRoll {
		static nextTotal = total;
		static created = created;
		constructor(formula, data = {}) {
			this.formula = String(formula);
			this.data = data;
			this.total = 0;
			created.push(this);
		}
		async evaluate() {
			this.total = TestRoll.nextTotal;
			return this;
		}
		async toMessage(data) {
			this.message = data;
			env.ChatMessage.created.push({ roll: this, ...data });
			return data;
		}
	}
	globalThis.Roll = TestRoll;
	env.Roll = TestRoll;
	return TestRoll;
}

/** Owned-item source for a feat in the Nim+ feats pack. */
export function featItem(name, extra = {}) {
	const { uuid, doc } = findDoc({ pack: FEATS_PACK, name });
	const src = deepClone(doc);
	src._id = randomID();
	delete src.folder;
	delete src.sort;
	delete src.ownership;
	src._stats = { compendiumSource: uuid };
	return foundry.utils.mergeObject(src, extra, { inplace: false });
}

/** Owned-item source for a Nimble core weapon (items pack JSON). */
export function weaponItem(name, { equipped = true, ...extra } = {}) {
	const { uuid, doc } = findDoc({ pack: 'nimble.nimble-items', name, type: 'object' });
	const src = deepClone(doc);
	src._id = randomID();
	delete src.folder;
	delete src.sort;
	delete src.ownership;
	src._stats = { compendiumSource: uuid };
	src.system.equipped = equipped;
	return foundry.utils.mergeObject(src, extra, { inplace: false });
}

export function shieldItem({ equipped = true } = {}) {
	return {
		_id: randomID(),
		name: 'Test Shield',
		type: 'object',
		system: { objectType: 'shield', equipped, rules: [] },
		flags: {},
		_stats: {},
	};
}

/**
 * A character at `level` (class berserker unless given) with `items`, plus
 * scripted `system` fields (merged into source) and roll data / healing stubs.
 */
export async function character(env, { level = 1, classId = 'berserker', items = [], system = {}, key = 2, name, ownedByPlayer = true } = {}) {
	const actor = await makeCharacter(env, { classId, level, items, name, ownedByPlayer });
	if (Object.keys(system).length) actor._applyUpdate({ system });
	actor.getRollData = () => ({ ...deepClone(actor.system ?? {}), key });
	actor.applyHealing = vi.fn(async () => actor);
	return actor;
}

export { vi };
