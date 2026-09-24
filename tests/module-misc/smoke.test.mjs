/**
 * Smoke: scripts/main.mjs loads, every hook registers and boots without
 * throwing, the public API surface matches a snapshot, and every non-startup
 * hook survives being fired with realistic Foundry-shaped arguments.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importScripts, installFoundry, installPacks, makeCharacter, MODULE_ID } from '../harness/index.mjs';
import { installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

const API_SHAPE = {
	pickDamage: 'function',
	syncSubclasses: 'function',
	migrateCoreClasses: 'function',
	syncCoreClasses: 'function',
	supersede: { data: 'function', isHidden: 'function' },
	summonSpiritCompanion: 'function',
	tollTheHour: 'function',
	seasonedJourneyman: 'function',
	sporeAttack: 'function',
	mirageDispatch: 'function',
	psionicFieldAttack: 'function',
	strain: { gain: 'function', lose: 'function', clear: 'function', roll: 'function', getDieSize: 'function', show: 'function' },
	feats: {
		choose: 'function',
		pending: 'function',
		owned: 'function',
		characterLevel: 'function',
		healerHeal: 'function',
		secondWind: 'function',
		allocateAcademic: 'function',
		chooseElementalSpecialist: 'function',
	},
	vol4: {
		bloodseeker: 'function',
		elementalWeapon: 'function',
		applyRune: 'function',
		dawnmarkApply: 'function',
		dawnmarkConsume: 'function',
		battlemageInfusion: 'function',
		realityFold: 'function',
		duneguardBrooch: 'function',
		blindOracle: 'function',
		elementalGuidance: 'function',
		jellybean: 'function',
		unicornTear: 'function',
	},
	equipment: { toggleGrip: 'function', spendBrittle: 'function', repairBrittle: 'function' },
};

/** Registrations made at import time (before any startup hook fires). */
const IMPORT_REGISTRATIONS = {
	'once:init': 8,
	'once:setup': 9,
	'once:ready': 5,
	'on:renderCompendium': 1,
	'on:getHeaderControlsActorSheetV2': 1,
	'on:createItem': 4,
	'on:nimble.useItem': 5,
	'on:createActiveEffect': 1,
	'on:deleteActiveEffect': 2,
	'on:updateToken': 2,
	'on:renderPlayerCharacterSheet': 5,
	'on:updateActor': 3,
	'on:nimbleCombatTurnEnd': 1,
	'on:nim-plus-package.concentration-broken': 1,
	'on:deleteCombat': 5,
	'on:nimble.rest': 3,
	'on:closePlayerCharacterSheet': 1,
	'on:renderGenericDialog': 3,
	'on:closeGenericDialog': 3,
	'on:updateItem': 4,
	'on:createToken': 1,
	'on:deleteToken': 1,
	'on:canvasReady': 1,
	'on:renderCharacterCreationDialog': 1,
	'on:closeCharacterCreationDialog': 1,
	'on:preUpdateActor': 2,
	'on:nimble.damageApplied': 1,
	'on:renderItemActivationConfigDialog': 1,
	'on:preCreateItem': 1,
	'on:createCombat': 2,
	'on:updateCombat': 2,
	'on:combatStart': 2,
	'on:createCombatant': 2,
	'on:deleteCombatant': 2,
	'on:preUpdateItem': 1,
	'on:createChatMessage': 1,
	'on:preRenderItemActivationConfigDialog': 1,
	'on:preCreateChatMessage': 1,
};

const shape = (o) =>
	Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'function' ? 'function' : shape(v)]));

function registrationCounts(env) {
	const counts = {};
	for (const l of env.Hooks.log) {
		if (l.kind !== 'on' && l.kind !== 'once') continue;
		const k = `${l.kind}:${l.name}`;
		counts[k] = (counts[k] ?? 0) + 1;
	}
	return counts;
}

describe('module-misc smoke: main.mjs', () => {
	let env;
	let rejections;
	const onRejection = (r) => rejections.push(r);

	beforeEach(async () => {
		env = installFoundry();
		installFakeDom();
		await installPacks(env);
		rejections = [];
		process.on('unhandledRejection', onRejection);
	});
	afterEach(() => {
		process.off('unhandledRejection', onRejection);
		uninstallFakeDom();
	});

	it('imports main.mjs and registers exactly the expected hooks at load time', async () => {
		await importScripts('scripts/main.mjs');
		expect(registrationCounts(env)).toEqual(IMPORT_REGISTRATIONS);
	});

	it('boots init → ready with no hook errors (with a DOM available)', async () => {
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'ready' });
		expect(env.Hooks.errors).toEqual([]);
		expect(rejections).toEqual([]);
	});

	it('registers the expected world settings', async () => {
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'ready' });
		expect([...env.settings.registered.keys()].sort()).toEqual(
			[
				'nim-plus-package.playtestCoreClasses',
				'nim-plus-package.enableFeats',
				'nim-plus-package.subclassSyncVersion',
				'nim-plus-package.classMigrationVersion',
				'nim-plus-package.enableClassAutomation',
			].sort(),
		);
	});

	it('exposes the api on the module and as globalThis.nimPlus (same object, snapshot shape)', async () => {
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'init' });
		const api = env.game.modules.get(MODULE_ID).api;
		expect(api).toBeDefined();
		expect(globalThis.nimPlus).toBe(api);
		expect(shape(api)).toEqual(API_SHAPE);
		expect(api.syncCoreClasses).toBe(api.migrateCoreClasses);
	});

	it('the api module does not throw when the module entry is missing from game.modules', async () => {
		env.game.modules.delete(MODULE_ID);
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'init' });
		expect(env.Hooks.errors.filter((e) => e.name === 'init')).toEqual([]);
		expect(typeof globalThis.nimPlus?.pickDamage).toBe('function');
	});

	it('boots as a player without hook errors', async () => {
		env.setUser({ isGM: false });
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'ready' });
		expect(env.Hooks.errors).toEqual([]);
	});

	it("boots under the 'nimble-dev' system id without hook errors", async () => {
		env = installFoundry({ systemId: 'nimble-dev' });
		installFakeDom();
		await installPacks(env);
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'ready' });
		expect(env.Hooks.errors).toEqual([]);
	});

	it('survives firing document/combat hooks with realistic arguments (no throws, no unhandled rejections)', async () => {
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'ready' });
		const actor = await makeCharacter(env, {
			classId: 'berserker',
			level: 3,
			items: [
				{ name: 'Dagger', type: 'object', system: { objectType: 'weapon', equipped: true, quantity: 1 } },
				{ name: 'Rope', type: 'object', system: { objectType: 'misc', quantity: 1 } },
			],
		});
		const dagger = actor.items.find((i) => i.name === 'Dagger');
		const user = env.game.user.id;
		const combat = { id: 'combat0000000001', combatants: new Map(), round: 1, turns: [] };
		const calls = [
			['createItem', dagger, {}, user],
			['preCreateItem', dagger, dagger.toObject(), {}, user],
			['updateItem', dagger, { system: { equipped: true } }, {}, user],
			['preUpdateItem', dagger, { system: { equipped: false } }, {}, user],
			['updateActor', actor, { system: {} }, {}, user],
			['preUpdateActor', actor, { system: {} }, {}, user],
			['createCombat', combat, {}, user],
			['updateCombat', combat, { round: 2 }, {}, user],
			['combatStart', combat, { round: 1, turn: 0 }],
			['deleteCombat', combat, {}, user],
			['nimble.rest', { actor, restType: 'safe' }],
			['nimble.useItem', dagger, {}, { targets: [], rolls: [] }],
			['nimble.damageApplied', { card: { id: 'c1' }, targetActor: actor, sourceActor: actor, sourceItem: dagger }],
			['nimbleCombatTurnEnd', combat, {}],
		];
		for (const [name, ...args] of calls) env.Hooks.callAll(name, ...args);
		await env.flush();
		expect(env.Hooks.errors.map((e) => `${e.name}: ${e.error?.message}`)).toEqual([]);
		expect(rejections.map(String)).toEqual([]);
	});
});
