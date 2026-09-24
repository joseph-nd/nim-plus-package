/**
 * scripts/core/startup-queue.mjs — one GM prompt at a time.
 */
import { describe, expect, it, vi } from 'vitest';
import { importScripts, installFoundry } from '../harness/index.mjs';

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function load() {
	installFoundry();
	return importScripts('scripts/core/startup-queue.mjs');
}

describe('startup queue', () => {
	it('runs tasks one after another, in queue order', async () => {
		const { queueStartupPrompt } = await load();
		const events = [];
		const a = deferred();
		const b = deferred();
		const pa = queueStartupPrompt(async () => {
			events.push('a:start');
			await a.promise;
			events.push('a:end');
			return 'A';
		});
		const pb = queueStartupPrompt(async () => {
			events.push('b:start');
			await b.promise;
			events.push('b:end');
			return 'B';
		});
		const pc = queueStartupPrompt(() => {
			events.push('c');
			return 'C';
		});
		await new Promise((r) => setImmediate(r));
		expect(events).toEqual(['a:start']);
		b.resolve(); // b finishing early changes nothing — it has not started
		await new Promise((r) => setImmediate(r));
		expect(events).toEqual(['a:start']);
		a.resolve();
		expect(await pa).toBe('A');
		expect(await pb).toBe('B');
		expect(await pc).toBe('C');
		expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c']);
	});

	it('a task that throws (sync or async) does not block the next; its caller sees the error', async () => {
		const { queueStartupPrompt } = await load();
		const ran = [];
		const p1 = queueStartupPrompt(() => {
			throw new Error('sync boom');
		});
		const p2 = queueStartupPrompt(async () => {
			throw new Error('async boom');
		});
		const p3 = queueStartupPrompt(async () => {
			ran.push(3);
			return 3;
		});
		await expect(p1).rejects.toThrow('sync boom');
		await expect(p2).rejects.toThrow('async boom');
		expect(await p3).toBe(3);
		expect(ran).toEqual([3]);
	});

	it('an unhandled rejection of a queued task does not leak as unhandled from the chain', async () => {
		const { queueStartupPrompt } = await load();
		const onUnhandled = vi.fn();
		process.on('unhandledRejection', onUnhandled);
		try {
			// The caller handles its own promise (as class-migration's handler does via try/catch inside the task).
			queueStartupPrompt(async () => {
				throw new Error('x');
			}).catch(() => {});
			await queueStartupPrompt(() => 'next');
			await new Promise((r) => setTimeout(r, 10));
			expect(onUnhandled).not.toHaveBeenCalled();
		} finally {
			process.off('unhandledRejection', onUnhandled);
		}
	});

	it('a task queued from inside a running task runs after it (no deadlock)', async () => {
		const { queueStartupPrompt } = await load();
		const events = [];
		let inner;
		await queueStartupPrompt(async () => {
			events.push('outer');
			inner = queueStartupPrompt(() => events.push('inner'));
		});
		await inner;
		expect(events).toEqual(['outer', 'inner']);
	});

	it('the ready handlers of class-migration queue migration then subclass sync, and a migration crash still lets the sync run', async () => {
		const env = installFoundry();
		const { installPacks } = await import('../harness/index.mjs');
		await installPacks(env);
		const mods = await importScripts([
			'scripts/core/playtest-settings.mjs',
			'scripts/core/supersede.mjs',
			'scripts/core/subclass-sync.mjs',
			'scripts/core/class-migration/index.mjs',
		]);
		await env.boot({ until: 'setup' });
		// Make the migration's planning throw for every actor list read.
		const actors = env.game.actors;
		Object.defineProperty(env.game, 'actors', {
			configurable: true,
			get() {
				return {
					filter() {
						throw new Error('actors exploded');
					},
				};
			},
		});
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await env.boot({ until: 'ready' });
		for (let i = 0; i < 50; i += 1) {
			await env.flush();
			await new Promise((r) => setTimeout(r, 10));
			if (err.mock.calls.length >= 2) break;
		}
		const messages = err.mock.calls.map((c) => String(c[0]));
		expect(messages.some((m) => /class migration failed/.test(m))).toBe(true);
		expect(messages.some((m) => /subclass sync failed/.test(m))).toBe(true);
		err.mockRestore();
		Object.defineProperty(env.game, 'actors', { configurable: true, value: actors });
		expect(mods).toHaveLength(4);
	});
});

describe('playtest-settings', () => {
	it('registers a world, reload-required boolean defaulting to true', async () => {
		const env = installFoundry();
		const mod = await importScripts('scripts/core/playtest-settings.mjs');
		// Before init: unregistered → counts as on.
		expect(mod.playtestCoreClassesEnabled()).toBe(true);
		await env.boot({ until: 'init' });
		const reg = env.settings.registered.get(`nim-plus-package.${mod.PLAYTEST_CORE_CLASSES_SETTING}`);
		expect(reg).toMatchObject({ scope: 'world', config: true, type: Boolean, default: true, requiresReload: true });
	});

	it.each([
		[true, true],
		[false, false],
		[undefined, true],
		[null, true],
		['false', true],
		[0, true],
	])('stored value %s → enabled %s (only a literal false turns it off)', async (value, enabled) => {
		const env = installFoundry({ settings: { 'nim-plus-package.playtestCoreClasses': value } });
		const mod = await importScripts('scripts/core/playtest-settings.mjs');
		await env.boot({ until: 'init' });
		expect(mod.playtestCoreClassesEnabled()).toBe(enabled);
	});
});
