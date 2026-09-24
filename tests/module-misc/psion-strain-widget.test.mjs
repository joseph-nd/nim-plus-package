import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { importScripts, installFoundry, MODULE_ID } from '../harness/index.mjs';
import { installFakeDom, uninstallFakeDom, el } from './fake-dom.mjs';
import { makeActor, psionClass } from './psion-helpers.mjs';

describe('psion strain widget hooks (scripts/psion/strain-widget.mjs)', () => {
	let env, widget;
	beforeEach(async () => {
		env = installFoundry();
		installFakeDom();
		widget = await importScripts('scripts/psion/strain-widget.mjs');
	});
	afterEach(() => uninstallFakeDom());

	it('ready injects the stylesheet exactly once', async () => {
		await env.boot({ until: 'ready' });
		widget.ensureStrainStyles();
		expect(document.head.querySelectorAll('#nim-plus-strain-styles')).toHaveLength(1);
		expect(env.Hooks.errors).toEqual([]);
	});

	it('updateActor: non-psions, unrelated changes and apps without an element are ignored', () => {
		const plain = makeActor(env);
		const psion = makeActor(env, { items: [psionClass(1)] });
		psion.apps = { a: {}, b: { element: null } };
		env.Hooks.callAll('updateActor', plain, { flags: { [MODULE_ID]: { psion: { strainDice: 1 } } } });
		env.Hooks.callAll('updateActor', psion, { name: 'x' });
		env.Hooks.callAll('updateActor', psion, { flags: { [MODULE_ID]: { psion: { strainDice: 1 } } } });
		expect(env.Hooks.errors).toEqual([]);
	});

	it('updateActor patches an existing widget in place (count, die, state)', async () => {
		const psion = makeActor(env, { items: [psionClass(10)], flags: { [MODULE_ID]: { psion: { strainDice: 5 } } } });
		const count = el('div', { class: 'nim-plus-strain__count' });
		const die = el('span', { class: 'nim-plus-strain__die' });
		const w = el('section', { class: 'nim-plus-strain', 'data-actor-id': psion.id }, [die, count]);
		const root = el('div', {}, [w]);
		psion.apps = { sheet: { element: root } };
		env.Hooks.callAll('updateActor', psion, { flags: { [MODULE_ID]: { psion: { '-=strainDice': null } } } });
		expect(count.textContent).toBe('5');
		expect(die.textContent).toBe('d10');
		expect(w.dataset.state).toBe('danger');
	});
});
