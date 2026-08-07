/**
 * Minimal Foundry VTT globals — just enough for the module's top-level code to
 * evaluate under Node, so `build/smoke.mjs` can prove the whole `scripts/` tree
 * loads. Every hook registration is recorded in order.
 *
 * Nothing here pretends to be Foundry. Stubs exist only where module top-level
 * code touches a global; anything a *hook handler* reaches for at runtime is
 * deliberately absent, because the smoke test never runs handlers.
 */
export const hookLog = [];

class FakeCollection extends Map {
	get contents() {
		return [...this.values()];
	}
	find(fn) {
		return this.contents.find(fn);
	}
	filter(fn) {
		return this.contents.filter(fn);
	}
	getName() {
		return null;
	}
}

export function installFoundryStubs() {
	const noop = () => {};
	const asyncNoop = async () => null;

	globalThis.Hooks = {
		on: (name) => {
			hookLog.push(`on:${name}`);
			return hookLog.length;
		},
		once: (name) => {
			hookLog.push(`once:${name}`);
			return hookLog.length;
		},
		off: noop,
		call: noop,
		callAll: noop,
	};

	globalThis.game = {
		system: { id: 'nimble' },
		user: { id: 'u1', isGM: true },
		users: new FakeCollection(),
		actors: new FakeCollection(),
		combats: new FakeCollection(),
		items: new FakeCollection(),
		packs: new FakeCollection(),
		messages: new FakeCollection(),
		i18n: { localize: (k) => k, format: (k) => k },
		settings: { register: noop, get: () => false, set: asyncNoop },
		modules: new FakeCollection(),
		combat: null,
	};

	globalThis.CONFIG = {
		Item: { documentClass: class {} },
		Actor: { documentClass: class {} },
		Dice: { rolls: [] },
		NIMBLE: { Item: { documentClasses: {} }, Actor: { documentClasses: {} }, ruleDataModels: {} },
	};

	globalThis.ui = { notifications: { info: noop, warn: noop, error: noop } };
	globalThis.canvas = { scene: null, tokens: { placeables: [] }, grid: { size: 100 } };
	globalThis.foundry = {
		utils: {
			deepClone: (v) => structuredClone(v),
			mergeObject: (a, b) => Object.assign({}, a, b),
			randomID: () => 'stubid00000',
			getProperty: () => undefined,
			setProperty: () => false,
			expandObject: (v) => v,
			duplicate: (v) => structuredClone(v),
		},
		applications: {
			api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (B) => B, DialogV2: class {} },
			ux: { TextEditor: { implementation: { enrichHTML: async (v) => v } } },
		},
		documents: { collections: {} },
		abstract: { DataModel: class {} },
	};

	globalThis.Roll = class {
		constructor(formula) {
			this.formula = formula;
			this.terms = [];
			this.total = 0;
		}
		async evaluate() {
			return this;
		}
		static async create(formula) {
			return new globalThis.Roll(formula);
		}
	};
	globalThis.ChatMessage = class {
		static async create() {
			return null;
		}
		static getSpeaker() {
			return {};
		}
	};
	globalThis.Actor = class {};
	globalThis.Item = class {};
	globalThis.Dialog = class {};
	globalThis.Token = class {};
	globalThis.TokenDocument = class {};
	globalThis.MeasuredTemplateDocument = class {};
	globalThis.Hooks.events = {};
	globalThis.fromUuid = asyncNoop;
	globalThis.fromUuidSync = () => null;
	globalThis.renderTemplate = async () => '';
	globalThis.loadTemplates = asyncNoop;
	globalThis.Handlebars = { registerHelper: noop };
	globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 }, GRID_TYPES: { SQUARE: 1 } };
}
