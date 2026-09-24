/**
 * Feats — the "Feats (Choose one)" section injected into Nimble's level-up
 * window (scripts/feats/levelup.mjs + scripts/core/level-up.mjs matching).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { character, FakeMutationObserver, featItem, featsWorld, mount } from './feats-helpers.mjs';

const OWNED = ['Alert', 'Tough', 'Lucky', 'Swift', 'Durable', 'Brutal'];

function levelUpApp(actor, { uniqueId = `${actor.id}-level-up`, title } = {}) {
	const element = mount(`<div class="app">
		<div class="nimble-sheet__body"><section class="native">choices</section></div>
		<footer class="nimble-sheet__footer"><button class="nimble-button">Confirm</button></footer>
	</div>`);
	return { data: { document: actor }, options: { uniqueId, window: { title } }, element };
}

function clickEvent() {
	return { type: 'click', preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn() };
}

async function render(env, app) {
	env.Hooks.callAll('renderGenericDialog', app);
	await env.flush();
	await new Promise((r) => setTimeout(r, 5));
	await env.flush();
}

const section = (app) => app.element.querySelector('.nim-plus-levelup-feats');
const confirmBtn = (app) => app.element.querySelector('.nimble-sheet__footer .nimble-button');
const tick = (app, id) => {
	const input = section(app).querySelectorAll('input').find((i) => i.value === id);
	input.checked = true;
	return input;
};

describe('feats level-up window injection', () => {
	let env;
	beforeEach(async () => {
		({ env } = await featsWorld({ isGM: false }));
	});

	it.each([
		[3, 1, true],
		[3, 0, true], // setting enabled mid-campaign, nothing taken yet
		[3, 2, false], // already took the level-4 feat early (back-fill button)
		[4, 2, false], // 5 is not a milestone
		[6, 2, false],
		[7, 2, true],
		[11, 3, true],
		[15, 4, true],
		[16, 5, false],
		[19, 5, false],
	])('leveling up from %i with %i feats owned → injects=%s', async (level, owned, injects) => {
		const actor = await character(env, { level, items: OWNED.slice(0, owned).map((n) => featItem(n)) });
		const app = levelUpApp(actor);
		await render(env, app);
		expect(!!section(app)).toBe(injects);
	});

	it('owned feats are not offered; unmet prerequisites are disabled', async () => {
		const actor = await character(env, { level: 3, items: [featItem('Alert')], system: { abilities: { strength: { mod: 0 } } } });
		const app = levelUpApp(actor);
		await render(env, app);
		const values = section(app).querySelectorAll('input').map((i) => i.value);
		expect(values).not.toContain('alert');
		expect(values).toContain('tough');
		expect(section(app).querySelectorAll('input').find((i) => i.value === 'bulwark').disabled).toBe(true);
	});

	it('confirm with no feat selected blocks the level-up and warns', async () => {
		const actor = await character(env, { level: 3, items: [featItem('Alert')] });
		const app = levelUpApp(actor);
		await render(env, app);
		const ev = clickEvent();
		confirmBtn(app).dispatchEvent(ev);
		expect(ev.preventDefault).toHaveBeenCalled();
		expect(ev.stopImmediatePropagation).toHaveBeenCalled();
		expect(env.notifications.messages('warn')).toContain('Choose a feat to finish your level-up.');
		expect(actor.callsOf('create')).toHaveLength(0);
	});

	it('confirm with a feat selected grants it exactly once, even on a double click', async () => {
		const actor = await character(env, { level: 3, items: [featItem('Alert')] });
		const app = levelUpApp(actor);
		await render(env, app);
		tick(app, 'tough');
		const ev = clickEvent();
		confirmBtn(app).dispatchEvent(ev);
		confirmBtn(app).dispatchEvent(clickEvent());
		await env.flush();
		expect(ev.preventDefault).not.toHaveBeenCalled();
		expect(actor.items.filter((i) => i.name === 'Tough')).toHaveLength(1);
	});

	it('re-rendering the dialog does not inject a second section or hook confirm twice', async () => {
		const actor = await character(env, { level: 3, items: [featItem('Alert')] });
		const app = levelUpApp(actor);
		await render(env, app);
		await render(env, app);
		expect(app.element.querySelectorAll('.nim-plus-levelup-feats')).toHaveLength(1);
		const btn = confirmBtn(app);
		expect(btn.listeners.get('click')).toHaveLength(1);
	});

	it('self-heals after a reactive re-render replaces the body, keeping the choice', async () => {
		const actor = await character(env, { level: 3, items: [featItem('Alert')] });
		const app = levelUpApp(actor);
		await render(env, app);
		const s = section(app);
		tick(app, 'lucky');
		// Svelte swaps the body out.
		const body = app.element.querySelector('.nimble-sheet__body');
		body.remove();
		const fresh = document.createElement('div');
		fresh.className = 'nimble-sheet__body';
		app.element.insertBefore(fresh, app.element.children[0]);
		expect(s.isConnected).toBe(false);
		FakeMutationObserver.instances.at(-1).trigger();
		expect(section(app)).toBe(s);
		expect(s.parentElement).toBe(fresh);
		confirmBtn(app).dispatchEvent(clickEvent());
		await env.flush();
		expect(actor.items.some((i) => i.name === 'Lucky')).toBe(true);
	});

	it('closeGenericDialog disconnects the observer', async () => {
		const actor = await character(env, { level: 3, items: [featItem('Alert')] });
		const app = levelUpApp(actor);
		await render(env, app);
		const obs = app.__nimPlusFeatObserver;
		expect(obs).toBeTruthy();
		env.Hooks.callAll('closeGenericDialog', app);
		expect(obs.disconnected).toBe(true);
	});

	it.each([
		['setting off', { enabled: false }],
		['a non-owner player', { ownedByPlayer: false }],
		['the level-down window', { title: 'X: Level Down (4 → 3)', uniqueId: '99' }],
		['an unrelated generic dialog', { title: 'Character Creator', uniqueId: '42' }],
	])('does nothing for %s', async (_label, opts) => {
		if (opts.enabled === false) ({ env } = await featsWorld({ isGM: false, enabled: false }));
		const actor = await character(env, { level: 3, items: [featItem('Alert')], ownedByPlayer: opts.ownedByPlayer ?? true });
		const app = levelUpApp(actor, { uniqueId: opts.uniqueId, title: opts.title });
		await render(env, app);
		expect(section(app)).toBeNull();
	});

	it('v14: matches through the system singleton registry when uniqueId is Foundry\'s counter', async () => {
		const actor = await character(env, { level: 3, items: [featItem('Alert')] });
		const app = levelUpApp(actor, { uniqueId: '61' });
		app.constructor = { getOpen: (id) => (id === `${actor.id}-level-up` ? app : null) };
		await render(env, app);
		expect(section(app)).not.toBeNull();
	});

});
