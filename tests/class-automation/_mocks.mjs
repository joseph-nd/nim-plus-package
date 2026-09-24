/**
 * Local mocks for the class-automation tests (scripts/classes/**, scripts/macros/spore-attack.mjs).
 *
 * The shared harness does not roll dice, build rule maps or expose an object
 * `activate()`. These helpers add exactly that, inside this area only:
 *
 *   installDice(env)   deterministic Roll / DamageRoll + Die/NumericTerm/OperatorTerm
 *                      (env.dice.push(…faces) queues the next die results)
 *   installRules(env)  item.rules built from system.rules as plain rule objects,
 *                      CONFIG.NIMBLE.ruleDataModels, Item.documentClasses.*,
 *                      actor.prepareEmbeddedDocuments (re-prepares items), and an
 *                      `activate()` stub driven by env.onActivate
 *   world(opts)        installFoundry + installPacks + both mocks + importScripts + boot
 */
import { deepClone, importScripts, installFoundry, installPacks, MODULE_ID } from '../harness/index.mjs';

/* ───────────────────────────── dice ───────────────────────────── */

export function installDice(env) {
	const queue = [];
	const dice = {
		queue,
		rolled: [],
		/** Face used when the queue is empty. */
		fallback: (faces) => Math.ceil(faces / 2),
		push(...values) {
			queue.push(...values);
			return dice;
		},
	};
	env.dice = dice;
	const next = (faces) => {
		const value = queue.length ? queue.shift() : dice.fallback(faces);
		dice.rolled.push({ faces, value });
		return value;
	};

	class RollTerm {
		constructor({ options = {} } = {}) {
			this.options = { ...options };
			this._evaluated = false;
		}
		get flavor() {
			return this.options.flavor ?? '';
		}
		get flavorSuffix() {
			return this.flavor ? `[${this.flavor}]` : '';
		}
	}

	class OperatorTerm extends RollTerm {
		constructor({ operator = '+', options } = {}) {
			super({ options });
			this.operator = operator;
		}
		get formula() {
			return ` ${this.operator} `;
		}
		get total() {
			return this.operator;
		}
		async evaluate() {
			this._evaluated = true;
			return this;
		}
		evaluateSync() {
			this._evaluated = true;
			return this;
		}
	}

	class NumericTerm extends RollTerm {
		constructor({ number = 0, options } = {}) {
			super({ options });
			this.number = Number(number);
		}
		get formula() {
			return `${this.number}${this.flavorSuffix}`;
		}
		get total() {
			return this.number;
		}
		async evaluate() {
			this._evaluated = true;
			return this;
		}
		evaluateSync() {
			this._evaluated = true;
			return this;
		}
	}

	class Die extends RollTerm {
		constructor({ number = 1, faces = 6, modifiers = [], results = [], options } = {}) {
			super({ options });
			this.number = number;
			this.faces = faces;
			this.modifiers = modifiers;
			this.results = results;
		}
		get formula() {
			return `${this.number}d${this.faces}${this.modifiers.join('')}${this.flavorSuffix}`;
		}
		get total() {
			return this.results.filter((r) => r.active && !r.discarded).reduce((s, r) => s + r.result, 0);
		}
		get isMiss() {
			const kept = this.results.find((r) => r.active && !r.discarded);
			return kept ? kept.result === 1 : false;
		}
		evaluateSync() {
			if (this._evaluated) throw new Error('This term has already been evaluated');
			this.results = [];
			for (let i = 0; i < this.number; i += 1) this.results.push({ result: next(this.faces), active: true });
			for (const mod of this.modifiers) {
				const keep = /^k([hl])(\d*)$/.exec(mod);
				if (keep) {
					const n = Number(keep[2] || 1);
					const sorted = [...this.results].sort((a, b) => (keep[1] === 'h' ? b.result - a.result : a.result - b.result));
					sorted.slice(n).forEach((r) => {
						r.active = false;
						r.discarded = true;
					});
				}
				if (mod === 'x') {
					let last = this.results.find((r) => r.active)?.result;
					let guard = 0;
					while (last === this.faces && guard++ < 50) {
						this.results.at(-1).exploded = true;
						last = next(this.faces);
						this.results.push({ result: last, active: true });
					}
				}
			}
			this._evaluated = true;
			return this;
		}
		async evaluate() {
			return this.evaluateSync();
		}
	}

	const TOKEN = /\s*(?:(\d*)d(\d+)((?:kh\d*|kl\d*|x)*)|(\d+(?:\.\d+)?)|([+\-*/]))\s*(?:\[([^\]]*)\])?/y;
	function parse(formula) {
		const terms = [];
		const src = String(formula).trim();
		TOKEN.lastIndex = 0;
		while (TOKEN.lastIndex < src.length) {
			const at = TOKEN.lastIndex;
			const m = TOKEN.exec(src);
			if (!m || TOKEN.lastIndex === at) throw new Error(`mock Roll: cannot parse "${src}" at ${at}`);
			const options = m[6] ? { flavor: m[6] } : {};
			if (m[2]) {
				const modifiers = (m[3] ?? '').match(/kh\d*|kl\d*|x/g) ?? [];
				terms.push(new Die({ number: Number(m[1] || 1), faces: Number(m[2]), modifiers, options }));
			} else if (m[4] !== undefined) terms.push(new NumericTerm({ number: Number(m[4]), options }));
			else terms.push(new OperatorTerm({ operator: m[5], options }));
		}
		return terms;
	}

	function computeTotal(terms) {
		const expr = terms
			.map((t) => (t instanceof OperatorTerm ? t.operator : `(${Number(t.total) || 0})`))
			.join(' ')
			.trim();
		if (!expr) return 0;
		// eslint-disable-next-line no-new-func
		return Number(new Function(`return (${expr});`)());
	}

	class Roll {
		constructor(formula = '0', data = {}, options = {}) {
			this.data = data;
			this.options = { ...options };
			this.terms = parse(formula);
			this._formula = String(formula);
			this._total = undefined;
			this._evaluated = false;
		}
		get formula() {
			return this._formula;
		}
		get total() {
			return this._total;
		}
		get dice() {
			return this.terms.filter((t) => t instanceof Die);
		}
		resetFormula() {
			this._formula = this.terms.map((t) => t.formula).join('').trim();
			return this._formula;
		}
		_recalculateTotal() {
			this._total = computeTotal(this.terms);
			return this._total;
		}
		async _evaluate() {
			for (const term of this.terms) if (!term._evaluated) await term.evaluate();
			this._recalculateTotal();
			this._evaluated = true;
			return this;
		}
		async evaluate() {
			return this._evaluate();
		}
		evaluateSync() {
			for (const term of this.terms) if (!term._evaluated) term.evaluateSync();
			this._recalculateTotal();
			this._evaluated = true;
			return this;
		}
		static async create(formula, data, options) {
			return new this(formula, data, options);
		}
	}

	/** Nimble's DamageRoll shape: primary die, crit/miss, primaryDieAsDamage. */
	class DamageRoll extends Roll {
		constructor(formula, data = {}, options = {}) {
			super(formula, data, { canCrit: true, canMiss: true, explosionStyle: 'standard', ...options });
			this.isCritical = false;
			this.isMiss = false;
			this.critCount = 0;
		}
		get primaryDie() {
			return this.dice[0] ?? null;
		}
		async _evaluate() {
			for (const term of this.terms) if (!term._evaluated) await term.evaluate();
			this._recalculateTotal();
			const primary = this.primaryDie;
			const kept = primary?.results?.find((r) => r.active && !r.discarded);
			if (kept) {
				this.isCritical = !!this.options.canCrit && kept.result === primary.faces;
				this.isMiss = !!this.options.canMiss && kept.result === 1;
				this.critCount = this.isCritical ? 1 : 0;
				if (this.options.primaryDieAsDamage === false) {
					this.excludedPrimaryDieValue = kept.result;
					this._total -= kept.result;
				}
			}
			this._evaluated = true;
			return this;
		}
		_finalizeOutcome() {}
	}

	env.Roll = Roll;
	env.DamageRoll = DamageRoll;
	env.terms = { Die, NumericTerm, OperatorTerm };
	globalThis.Roll = Roll;
	globalThis.foundry.dice.terms = { Die, NumericTerm, OperatorTerm };
	globalThis.CONFIG.Dice.rolls = [Roll, DamageRoll];
	return dice;
}

/* ───────────────────────────── rules / documents ───────────────────────────── */

/**
 * A small subset of Nimble's Predicate: `level: {min,max}`, `$or: [...]`,
 * `subclass: '<id>'` and the charge-pool domain tag `self:<identifier>ChargePool: {min,max}`
 * (the current count of that pool on the rule's own item).
 */
export function testPredicate(predicate, item) {
	if (!predicate || typeof predicate !== 'object') return true;
	const actor = item?.parent ?? null;
	const level = Number(actor?.levels?.character ?? 0);
	const inRange = (value, range) =>
		(range?.min === undefined || value >= range.min) && (range?.max === undefined || value <= range.max);
	for (const [key, cond] of Object.entries(predicate)) {
		if (key === '$or') {
			if (!cond.some((sub) => testPredicate(sub, item))) return false;
		} else if (key === 'level') {
			if (!inRange(level, cond)) return false;
		} else if (key === 'subclass') {
			const ok = actor?.items?.some((i) => i.type === 'subclass' && i.name.slugify({ strict: true }) === cond);
			if (!ok) return false;
		} else if (key.startsWith('self:') && key.endsWith('ChargePool')) {
			const id = key.slice(5, -'ChargePool'.length);
			const sys = globalThis.game.system.id;
			const current = Number(item?.flags?.[sys]?.chargePools?.[id]?.current ?? 0);
			if (!inRange(current, cond)) return false;
		} else {
			throw new Error(`mock predicate: unsupported key ${key}`);
		}
	}
	return true;
}

export const RULE_TYPES = [
	'chargePool',
	'chargeConsumer',
	'dicePool',
	'diceConsumer',
	'modifyPool',
	'grantItem',
	'grantActivation',
	'actionDelta',
	'applyCondition',
	'note',
];

export function installRules(env) {
	class FakeRule {
		constructor(source = {}, { parent = null } = {}) {
			Object.assign(this, deepClone(source));
			this.disabled ??= false;
			Object.defineProperty(this, 'parent', { value: parent, enumerable: false });
		}
		/** NimbleBaseRule#appliesTo — disabled or predicate-false rules do not apply. */
		appliesTo() {
			if (this.disabled) return false;
			return testPredicate(this.predicate, this.parent);
		}
	}
	env.FakeRule = FakeRule;
	for (const type of RULE_TYPES) globalThis.CONFIG.NIMBLE.ruleDataModels[type] = FakeRule;

	const { Item, Actor } = env.classes;
	const originalBase = Item.prototype.prepareBaseData;
	Item.prototype.prepareBaseData = function prepareBaseDataWithRules(...args) {
		originalBase.apply(this, args);
		// NimbleBaseItem#prepareBaseData builds the rules map from the stored source.
		const rules = Array.isArray(this.system?.rules) ? this.system.rules : [];
		this.rules = new Map(rules.map((r, i) => [r?.id ?? `rule-${i}`, new FakeRule(r, { parent: this })]));
		this.initialized = true;
	};
	// Foundry prepares every embedded document after the parent's base data.
	Actor.prototype.prepareEmbeddedDocuments = function prepareEmbeddedDocuments() {
		for (const item of this.items ?? []) item.prepareData();
	};

	env.activations = [];
	env.onActivate = null;
	Item.prototype.activate = async function activate(options = {}) {
		env.activations.push({ item: this, options });
		return env.onActivate ? env.onActivate(this, options) : { id: 'card', rolls: [] };
	};

	globalThis.CONFIG.NIMBLE.Item.documentClasses = {
		feature: Item,
		ancestry: Item,
		object: Item,
		spell: Item,
		class: Item,
		subclass: Item,
	};
	return FakeRule;
}

/* ───────────────────────────── world ───────────────────────────── */

/**
 * @returns {Promise<{env: object, m: Record<string, object>}>}  `m` keyed by the path
 *          under scripts/ without extension, e.g. m['classes/berserker/death-blow'].
 */
export async function world({
	playtest = true,
	automation = true,
	isGM = true,
	scripts = [],
	boot = 'setup',
	settings = {},
	systemId,
} = {}) {
	const presets = { [`${MODULE_ID}.playtestCoreClasses`]: playtest, ...settings };
	if (automation !== undefined) presets[`${MODULE_ID}.enableClassAutomation`] = automation;
	const env = installFoundry({ isGM, systemId, settings: presets });
	await installPacks(env);
	installDice(env);
	installRules(env);
	const all = ['scripts/core/playtest-settings.mjs', 'scripts/classes/shared/settings.mjs', ...scripts];
	const mods = await importScripts(all);
	if (boot) await env.boot({ until: boot });
	const m = Object.fromEntries(all.map((p, i) => [p.replace(/^scripts\//, '').replace(/\.mjs$/, ''), mods[i]]));
	return { env, m };
}

/* ───────────────────────────── small builders ───────────────────────────── */

let seq = 0;
/** A raw owned-item source (world item, no compendium source). */
export function rawItem(name, type = 'feature', system = {}, extra = {}) {
	seq += 1;
	return { _id: `rawItem${String(seq).padStart(9, '0')}`, name, type, img: '', system: { rules: [], ...system }, flags: {}, _stats: {}, ...extra };
}

export function meleeWeapon(name = 'Longsword', extra = {}) {
	return rawItem(name, 'object', {
		objectType: 'weapon',
		activation: { targets: { attackType: 'reach' }, effects: [{ type: 'damage', formula: '1d8' }] },
		properties: { selected: [] },
	}, extra);
}

export function rangedWeapon(name = 'Longbow', extra = {}) {
	return rawItem(name, 'object', {
		objectType: 'weapon',
		activation: { targets: { attackType: 'range' }, effects: [{ type: 'damage', formula: '1d8' }] },
		properties: { selected: ['range'] },
	}, extra);
}

export function chargePool(identifier, current, max, extra = {}) {
	return { [identifier]: { identifier, label: identifier, current, max, dieSize: null, hidden: false, recoveries: [], ...extra } };
}

/** Evaluate a damage roll with forced die results, inside a fake activation. */
export async function rollDamage(env, formula, faces = [], options = {}) {
	env.dice.push(...faces);
	const roll = new env.DamageRoll(formula, {}, options);
	await roll.evaluate();
	return roll;
}

export function itemNamed(actor, name) {
	const hits = actor.items.filter((i) => i.name.toLowerCase() === name.toLowerCase());
	if (hits.length !== 1) throw new Error(`expected one "${name}" on ${actor.name}, found ${hits.length}`);
	return hits[0];
}

export function synthetic(item) {
	return [...(item.rules?.values() ?? [])].filter((r) => String(r.id ?? '').startsWith('nimPlus'));
}

export function combat(env, { round = 1, turn = 0, started = true, combatants = [] } = {}) {
	const c = { id: 'combat0000000001', round, turn, started, combatants };
	env.game.combat = c;
	return c;
}

/**
 * Just enough `document` for the style injectors (`ensureFeatStyles`,
 * `ensureCombatTacticStyles`) and simple element lookups. Not a DOM.
 */
export function installDocumentStub() {
	const byId = new Map();
	const makeEl = (tag) => {
		const el = {
			tagName: String(tag).toUpperCase(),
			id: '',
			textContent: '',
			children: [],
			dataset: {},
			classList: {
				set: new Set(),
				add(...c) { c.forEach((x) => this.set.add(x)); },
				remove(...c) { c.forEach((x) => this.set.delete(x)); },
				contains(c) { return this.set.has(c); },
				toggle(c, force) { const on = force ?? !this.set.has(c); if (on) this.set.add(c); else this.set.delete(c); return on; },
			},
			append(...nodes) {
				for (const n of nodes) {
					el.children.push(n);
					if (n?.id) byId.set(n.id, n);
				}
			},
			querySelector: () => null,
			querySelectorAll: () => [],
		};
		return el;
	};
	const doc = {
		head: makeEl('head'),
		body: makeEl('body'),
		createElement: makeEl,
		getElementById: (id) => byId.get(id) ?? null,
	};
	doc.head.append = (...nodes) => nodes.forEach((n) => n?.id && byId.set(n.id, n));
	globalThis.document = doc;
	return { doc, makeEl };
}
