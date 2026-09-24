/**
 * Vol I — kits.mjs: the variant starting kits in the character creator.
 *
 * Covered: the submit wrapper (kit ↔ class matching, the sentinel
 * startingEquipmentChoice, capturing the created actor, granting contents:
 * per-unit weapons, quantities, placeholders for dead UUIDs), idempotent
 * wrapping, kit-index loading/caching, and a data sweep over all 22 real kits.
 * NOT covered (see report): the DOM card injection (`syncKitOptions`), which
 * needs `[id$=…]`/`:not()` selectors and a MutationObserver-driven Svelte DOM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findDocs, importScripts, installFoundry, installPacks, MODULE_ID, slugify } from '../harness/index.mjs';
import { installFakeDom } from './fake-dom.mjs';

let env;
let createdActors;

class StubObserver {
	observe() {}
	disconnect() {
		this.disconnected = true;
	}
}

beforeEach(async () => {
	env = installFoundry();
	installFakeDom();
	globalThis.MutationObserver = StubObserver;
	await installPacks(env, { system: ['classes', 'classFeatures', 'subclasses', 'spells', 'items'], module: true });
	await importScripts('scripts/vol1/kits.mjs');
	await env.boot({ until: 'setup' });
	createdActors = [];
});

function makeApp({ throwBeforeCreate = false, extraCreates = [] } = {}) {
	const original = vi.fn(async (results) => {
		if (throwBeforeCreate) throw new Error('creator failed');
		for (const { userId, type } of extraCreates) {
			const other = new env.classes.Actor({ name: 'Other', type });
			env.Hooks.callAll('createActor', other, {}, userId);
		}
		const actor = new env.classes.Actor({ name: results?.name ?? 'New Character', type: 'character' });
		env.game.actors.set(actor.id, actor);
		createdActors.push(actor);
		env.Hooks.callAll('createActor', actor, {}, env.game.user.id);
		return 'closed';
	});
	const app = { element: document.createElement('div'), submitCharacterCreation: original };
	return { app, original };
}

const itemsPack = () => env.game.packs.get(`${MODULE_ID}.nim-plus-items`);

async function kitDocs() {
	const index = await itemsPack().getIndex({ fields: ['system.identifier', 'system.rules', 'flags'] });
	return index
		.filter((e) => e.flags?.[MODULE_ID]?.vol1Kit === true)
		.map((e) => ({ id: e._id, uuid: e.uuid, name: e.name, img: e.img, system: { identifier: e.system?.identifier ?? '', rules: e.system?.rules ?? [] } }));
}

const kitPrefix = (kit) => kit.system.identifier.replace(/-kit-\d+$/, '');

function classUuidFor(prefix) {
	const hit = findDocs({ pack: 'nimble.nimble-classes', where: (d) => slugify(d.name, { strict: true }) === prefix })[0];
	return hit ? `Compendium.${env.game.system.id}.nimble-classes.Item.${hit.doc._id}` : null;
}

async function render(app) {
	env.Hooks.callAll('renderCharacterCreationDialog', app);
	await env.flush();
}

async function submitWithKit(kit, { classUuid = classUuidFor(kitPrefix(kit)), app, original } = {}) {
	if (!app) ({ app, original } = makeApp());
	await render(app);
	app.__nimPlusSelectedKit = kit;
	const result = await app.submitCharacterCreation({ name: 'Kitted', origins: { characterClass: { uuid: classUuid } }, startingEquipmentChoice: 'gold' });
	return { app, original, result, actor: createdActors.at(-1) };
}

const isPlaceholder = (i) => /could not be found/.test(i.system?.description?.public ?? '');

describe('kit data sweep (all real kits)', () => {
	it('there are 22 kits, two per class, each pointing at an existing Nimble class', async () => {
		const kits = await kitDocs();
		expect(kits).toHaveLength(22);
		const byClass = new Map();
		for (const k of kits) byClass.set(kitPrefix(k), (byClass.get(kitPrefix(k)) ?? 0) + 1);
		for (const [prefix, n] of byClass) {
			expect(n, prefix).toBe(2);
			expect(classUuidFor(prefix), prefix).not.toBeNull();
		}
	});

	it('every kit grant resolves and the whole kit lands on the new character (no placeholders)', async () => {
		for (const kit of await kitDocs()) {
			createdActors = [];
			const { actor, original } = await submitWithKit(kit);
			const grants = kit.system.rules.filter((r) => r.type === 'grantItem' && !r.disabled);
			const expected = grants.reduce((n, r) => n + (Number(r.quantity) > 1 ? Number(r.quantity) : 1), 0);
			expect(original.mock.calls[0][0].startingEquipmentChoice, kit.name).toBe('nim-plus-kit');
			const objects = actor.items.filter((i) => i.type === 'object');
			expect(objects.filter(isPlaceholder).map((i) => i.name), kit.name).toEqual([]);
			expect(objects.length, kit.name).toBeGreaterThanOrEqual(grants.length);
			expect(objects.length, kit.name).toBeLessThanOrEqual(expected);
			for (const i of objects) expect(i._stats.compendiumSource, `${kit.name} › ${i.name}`).toMatch(/^Compendium\./);
		}
	});
});

describe('submit wrapper', () => {
	it('no kit selected → the native submit gets the results untouched', async () => {
		const { app, original } = makeApp();
		await render(app);
		const results = { name: 'Plain', startingEquipmentChoice: 'equipment' };
		await app.submitCharacterCreation(results);
		expect(original).toHaveBeenCalledWith(results);
		expect(createdActors[0].items.size).toBe(0);
	});

	it('a kit for another class (user went back and switched class) is ignored', async () => {
		const kit = (await kitDocs()).find((k) => kitPrefix(k) === 'berserker');
		const { original, actor } = await submitWithKit(kit, { classUuid: classUuidFor('mage') });
		expect(original.mock.calls[0][0].startingEquipmentChoice).toBe('gold');
		expect(actor.items.size).toBe(0);
	});

	it('an unresolvable class uuid drops the kit', async () => {
		const kit = (await kitDocs())[0];
		const { original, actor } = await submitWithKit(kit, { classUuid: 'Compendium.nimble.nimble-classes.Item.doesNotExist0000' });
		expect(original.mock.calls[0][0].startingEquipmentChoice).toBe('gold');
		expect(actor.items.size).toBe(0);
	});

	it('the kit is honoured for a Nim+ 0.2 copy of the class too', async () => {
		const kit = (await kitDocs()).find((k) => kitPrefix(k) === 'commander');
		const nimClass = findDocs({ pack: `${MODULE_ID}.nim-plus-classes`, name: 'Commander' })[0];
		expect(nimClass).toBeTruthy();
		const { actor } = await submitWithKit(kit, { classUuid: nimClass.uuid });
		expect(actor.items.size).toBeGreaterThan(0);
	});

	it('rendering twice wraps once — the kit is granted exactly once', async () => {
		const kit = (await kitDocs()).find((k) => kitPrefix(k) === 'the-cheat');
		const { app, original } = makeApp();
		await render(app);
		await render(app);
		const { actor } = await submitWithKit(kit, { app, original });
		expect(original).toHaveBeenCalledTimes(1);
		expect(actor.items.map((i) => i.name).sort()).toEqual(['Crowbar', 'Rapier', 'Shortbow']);
	});

	it('a player creating their own character gets the kit', async () => {
		env.setUser({ isGM: false });
		const kit = (await kitDocs()).find((k) => kitPrefix(k) === 'the-cheat');
		const { actor } = await submitWithKit(kit);
		expect(actor.items.size).toBe(3);
	});

	it("another user's createActor during the submit is not mistaken for ours", async () => {
		const kit = (await kitDocs()).find((k) => kitPrefix(k) === 'the-cheat');
		const { app, original } = makeApp({ extraCreates: [{ userId: 'someoneElse00000', type: 'character' }, { userId: env.game.user.id, type: 'npc' }] });
		const { actor } = await submitWithKit(kit, { app, original });
		expect(actor.items.size).toBe(3);
	});

	it('the createActor listener is removed after the submit', async () => {
		const kit = (await kitDocs())[0];
		const before = env.Hooks.count('createActor');
		await submitWithKit(kit);
		expect(env.Hooks.count('createActor')).toBe(before);
	});

	it('creator failure before the actor exists → warning, error propagates, listener removed', async () => {
		const kit = (await kitDocs()).find((k) => kitPrefix(k) === 'the-cheat');
		const { app, original } = makeApp({ throwBeforeCreate: true });
		await expect(submitWithKit(kit, { app, original })).rejects.toThrow('creator failed');
		expect(env.notifications.messages('warn').at(-1)).toMatch(/Could not find the new character/);
		expect(env.Hooks.count('createActor')).toBe(0);
	});
});

describe('granting contents', () => {
	const daggerUuid = () => findDocs({ pack: 'nimble.nimble-items', name: 'Dagger' })[0].uuid.replace('Compendium.nimble.', `Compendium.${env.game.system.id}.`);
	const gearUuid = () =>
		findDocs({ pack: 'nimble.nimble-items', where: (d) => d.type === 'object' && d.system?.objectType !== 'weapon' })[0];
	const synthetic = (rules) => ({ id: 'kitSynthetic0000', name: 'Test Kit', img: '', system: { identifier: 'the-cheat-kit-9', rules } });
	const grant = (uuid, extra = {}) => ({ type: 'grantItem', disabled: false, uuid, label: 'Starting Gear - Thing', ...extra });

	it('a weapon with quantity 3 becomes three separate qty-1 documents', async () => {
		const { actor } = await submitWithKit(synthetic([grant(daggerUuid(), { quantity: 3 })]), { classUuid: classUuidFor('the-cheat') });
		const daggers = actor.items.filter((i) => i.name === 'Dagger');
		expect(daggers).toHaveLength(3);
		expect(daggers.every((d) => d.system.quantity === 1)).toBe(true);
		expect(new Set(daggers.map((d) => d.id)).size).toBe(3);
	});

	it('non-weapons carry the kit quantity', async () => {
		const gear = gearUuid();
		const uuid = gear.uuid.replace('Compendium.nimble.', `Compendium.${env.game.system.id}.`);
		const { actor } = await submitWithKit(synthetic([grant(uuid, { quantity: 4 })]), { classUuid: classUuidFor('the-cheat') });
		expect(actor.items.contents[0].name).toBe(gear.doc.name);
		expect(actor.items.contents[0].system.quantity).toBe(4);
	});

	it('a dead UUID becomes a labelled placeholder with the quantity (nothing silently lost)', async () => {
		const { actor } = await submitWithKit(
			synthetic([grant('Compendium.nimble.nimble-items.Item.gone000000000000', { label: 'Starting Gear — Lucky Coin', quantity: 2 }), grant('', { label: '' })]),
			{ classUuid: classUuidFor('the-cheat') },
		);
		const names = actor.items.map((i) => i.name).sort();
		expect(names).toEqual(['Adventuring Gear', 'Lucky Coin']);
		expect(actor.items.find((i) => i.name === 'Lucky Coin').system.quantity).toBe(2);
		expect(actor.items.every(isPlaceholder)).toBe(true);
	});

	it('disabled and non-grant rules are skipped; an empty kit creates nothing', async () => {
		const { actor } = await submitWithKit(
			synthetic([grant(daggerUuid(), { disabled: true }), { type: 'note', uuid: daggerUuid() }]),
			{ classUuid: classUuidFor('the-cheat') },
		);
		expect(actor.items.size).toBe(0);
		expect(actor.callsOf('create')).toHaveLength(0);
	});
});

describe('kit index loading', () => {
	it('loads the index once per session with the needed fields, whatever the number of renders', async () => {
		const pack = itemsPack();
		const before = pack.calls.filter((c) => c.method === 'getIndex').length;
		await render(makeApp().app);
		await render(makeApp().app);
		const calls = pack.calls.filter((c) => c.method === 'getIndex').slice(before);
		expect(calls).toHaveLength(1);
		expect(calls[0].fields).toEqual(expect.arrayContaining(['system.identifier', 'system.rules', 'flags']));
		expect(env.Hooks.errors).toEqual([]);
	});

	it('a failed load is retried on the next render', async () => {
		const pack = itemsPack();
		const real = pack.getIndex.bind(pack);
		let n = 0;
		pack.getIndex = async (...a) => {
			n += 1;
			if (n === 1) throw new Error('index down');
			return real(...a);
		};
		await render(makeApp().app);
		await render(makeApp().app);
		expect(n).toBe(2);
	});

	it('closing the dialog disconnects its observer', async () => {
		const { app } = makeApp();
		await render(app);
		env.Hooks.callAll('closeCharacterCreationDialog', app);
		expect(app.__nimPlusKitObserver.disconnected).toBe(true);
	});

	it('a dialog without an element (not rendered yet) is still wrapped and never throws', async () => {
		const app = { element: null, submitCharacterCreation: async () => 'x' };
		await render(app);
		expect(app.__nimPlusKitSubmitWrapped).toBe(true);
		expect(env.Hooks.errors).toEqual([]);
	});
});
