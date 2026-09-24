/**
 * Example: the whole scripts/ tree loads under the harness globals, registers
 * its hooks, and survives the init → setup → ready sequence.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { importScripts, installFoundry, installPacks, MODULE_ID } from '../harness/index.mjs';

describe('harness: loading scripts', () => {
	let env;
	beforeEach(async () => {
		env = installFoundry();
		await installPacks(env);
	});

	it('imports scripts/main.mjs and registers the startup hooks', async () => {
		await importScripts('scripts/main.mjs');
		expect(env.Hooks.count('init')).toBeGreaterThan(0);
		expect(env.Hooks.count('setup')).toBeGreaterThan(0);
		expect(env.Hooks.count('ready')).toBeGreaterThan(0);
		// Document-level automation hooks the class scripts rely on.
		expect(env.Hooks.names()).toEqual(expect.arrayContaining(['createItem', 'preCreateItem']));
	});

	it('boots through init and setup: settings registered, api exposed', async () => {
		await importScripts('scripts/main.mjs');
		await env.boot({ until: 'setup' });
		expect(env.settings.registered.has(`${MODULE_ID}.playtestCoreClasses`)).toBe(true);
		expect(env.settings.registered.has(`${MODULE_ID}.classMigrationVersion`)).toBe(true);
		const api = env.game.modules.get(MODULE_ID).api;
		expect(typeof api?.migrateCoreClasses).toBe('function');
		expect(typeof api?.syncSubclasses).toBe('function');
		expect(env.Hooks.errors).toEqual([]);
	});

	it('each importScripts call starts from a fresh module registry', async () => {
		const a = await importScripts('scripts/core/supersede.mjs');
		const b = await importScripts('scripts/core/supersede.mjs');
		expect(a).not.toBe(b);
		const c = await importScripts('scripts/core/supersede.mjs', { reset: false });
		expect(c).toBe(b);
	});
});
