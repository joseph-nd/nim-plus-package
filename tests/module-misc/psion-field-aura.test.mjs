import { beforeEach, describe, expect, it } from 'vitest';
import { Collection, getProperty, importScripts, installFoundry, MODULE_ID, setProperty } from '../harness/index.mjs';
import { feature, makeActor, psionClass } from './psion-helpers.mjs';

/** Minimal scene + token document with flags, regions and update log. */
function makeScene() {
	const scene = {
		id: 'scene1',
		grid: { size: 100 },
		regions: new Collection(),
		created: [],
		async createEmbeddedDocuments(type, data) {
			const out = data.map((d, i) => {
				const region = {
					id: `region${scene.created.length + i}`,
					...d,
					updates: [],
					async update(c) {
						region.updates.push(c);
						return region;
					},
					async delete() {
						scene.regions.delete(region.id);
						region.deleted = true;
					},
				};
				scene.regions.set(region.id, region);
				return region;
			});
			scene.created.push(...out);
			return out;
		},
	};
	return scene;
}

function makeTokenDoc(scene, { light = { dim: 10, bright: 5, color: '#ff0000' }, x = 200, y = 300 } = {}) {
	const doc = {
		id: 'tok1',
		parent: scene,
		x,
		y,
		width: 1,
		height: 1,
		light: { ...light },
		flags: {},
		updates: [],
		getFlag(scope, key) {
			return getProperty(this.flags?.[scope] ?? {}, key);
		},
		async setFlag(scope, key, value) {
			this.flags[scope] ??= {};
			setProperty(this.flags[scope], key, value);
		},
		async unsetFlag(scope, key) {
			delete this.flags?.[scope]?.[key];
		},
		async update(c) {
			this.updates.push(c);
			if (c.light) this.light = { ...c.light };
		},
	};
	return doc;
}

describe('psion field aura (scripts/psion/field-aura.mjs)', () => {
	let env, actor, scene, doc;
	beforeEach(async () => {
		env = installFoundry();
		globalThis.CONST.REGION_VISIBILITY = { LAYER: 0, GAMEMASTER: 1, ALWAYS: 2 }; // not in the harness CONST
		await importScripts('scripts/psion/field-aura.mjs');
		actor = makeActor(env, { items: [psionClass(1), feature('Psionic Field')] });
		scene = makeScene();
		doc = makeTokenDoc(scene);
		actor.tokens = [{ document: doc }];
	});

	const effect = () => ({ statuses: new Set(['concentration']), parent: actor });

	describe('nimble.useItem toggle', () => {
		it('activating Psionic Field toggles concentration on, then off', async () => {
			const item = actor.items.find((i) => i.name === 'Psionic Field');
			env.Hooks.callAll('nimble.useItem', item);
			await env.flush();
			expect(actor.statusToggles.at(-1)).toEqual({ id: 'concentration', active: true });
			env.Hooks.callAll('nimble.useItem', item);
			await env.flush();
			expect(actor.statusToggles.at(-1)).toEqual({ id: 'concentration', active: false });
		});

		it('other features, non-features and unowned items do nothing', async () => {
			actor = makeActor(env, { items: [feature('Psionic Strike'), { name: 'Psionic Field', type: 'object', system: {} }] });
			for (const item of actor.items) env.Hooks.callAll('nimble.useItem', item);
			env.Hooks.callAll('nimble.useItem', null);
			const loose = new env.classes.Item({ name: 'Psionic Field', type: 'feature', system: {} });
			env.Hooks.callAll('nimble.useItem', loose);
			await env.flush();
			expect(actor.statusToggles).toEqual([]);
			expect(env.Hooks.errors).toEqual([]);
		});
	});

	describe('aura on/off', () => {
		it('on: stashes the prior light, applies the aura light, creates one region', async () => {
			env.Hooks.callAll('createActiveEffect', effect(), {}, env.game.user.id);
			await env.flush();
			expect(doc.getFlag(MODULE_ID, 'psionicFieldPrevLight')).toEqual({ dim: 10, bright: 5, color: '#ff0000' });
			expect(doc.light.dim).toBe(3);
			expect(scene.created).toHaveLength(1);
			expect(scene.created[0].shapes[0]).toMatchObject({ type: 'circle', x: 250, y: 350, radius: 300 });
			expect(doc.getFlag(MODULE_ID, 'psionicFieldRegionId')).toBe(scene.created[0].id);
		});

		it('on twice: does not overwrite the stash with the aura light, does not duplicate the region', async () => {
			for (let i = 0; i < 2; i += 1) {
				env.Hooks.callAll('createActiveEffect', effect(), {}, env.game.user.id);
				await env.flush();
			}
			expect(doc.getFlag(MODULE_ID, 'psionicFieldPrevLight').dim).toBe(10);
			expect(scene.regions.size).toBe(1);
		});

		it('off: restores the stashed light and removes region + flags', async () => {
			env.Hooks.callAll('createActiveEffect', effect(), {}, env.game.user.id);
			await env.flush();
			env.Hooks.callAll('deleteActiveEffect', effect(), {}, env.game.user.id);
			await env.flush();
			expect(doc.light).toEqual({ dim: 10, bright: 5, color: '#ff0000' });
			expect(scene.regions.size).toBe(0);
			expect(doc.getFlag(MODULE_ID, 'psionicFieldPrevLight')).toBeUndefined();
			expect(doc.getFlag(MODULE_ID, 'psionicFieldRegionId')).toBeUndefined();
		});

		it('off without a stash falls back to no light', async () => {
			env.Hooks.callAll('deleteActiveEffect', effect(), {}, env.game.user.id);
			await env.flush();
			expect(doc.light.dim).toBe(0);
		});

		it('off removes a legacy v13 template region', async () => {
			await scene.createEmbeddedDocuments('Region', [{ name: 'legacy' }]);
			const legacyId = scene.created[0].id;
			await doc.setFlag(MODULE_ID, 'psionicFieldTemplateId', legacyId);
			env.Hooks.callAll('deleteActiveEffect', effect(), {}, env.game.user.id);
			await env.flush();
			expect(scene.regions.has(legacyId)).toBe(false);
			expect(doc.getFlag(MODULE_ID, 'psionicFieldTemplateId')).toBeUndefined();
		});

		it('other users and non-psions are ignored', async () => {
			env.Hooks.callAll('createActiveEffect', effect(), {}, 'otherUser0000000');
			const plain = makeActor(env);
			plain.tokens = [{ document: doc }];
			env.Hooks.callAll('createActiveEffect', { statuses: new Set(['concentration']), parent: plain }, {}, env.game.user.id);
			env.Hooks.callAll('createActiveEffect', { statuses: new Set(['blinded']), parent: actor }, {}, env.game.user.id);
			await env.flush();
			expect(doc.updates).toEqual([]);
			expect(scene.created).toEqual([]);
		});
	});

	describe('follow the token', () => {
		it('re-centres the region on the destination from the update payload', async () => {
			env.Hooks.callAll('createActiveEffect', effect(), {}, env.game.user.id);
			await env.flush();
			env.Hooks.callAll('updateToken', doc, { x: 500 }, {}, env.game.user.id);
			await env.flush();
			const region = scene.created[0];
			expect(region.updates.at(-1).shapes[0]).toMatchObject({ x: 550, y: 350 });
		});

		it('non-movement updates, other users, and tokens without a field are ignored', async () => {
			env.Hooks.callAll('updateToken', doc, { x: 1 }, {}, env.game.user.id); // no region yet
			env.Hooks.callAll('createActiveEffect', effect(), {}, env.game.user.id);
			await env.flush();
			env.Hooks.callAll('updateToken', doc, { name: 'x' }, {}, env.game.user.id);
			env.Hooks.callAll('updateToken', doc, { x: 1 }, {}, 'otherUser0000000');
			await env.flush();
			expect(scene.created[0].updates).toEqual([]);
			expect(env.Hooks.errors).toEqual([]);
		});
	});
});
