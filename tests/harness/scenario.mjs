/**
 * One-call world setup for the common case.
 *
 *   const { env, mods } = await setupWorld({ playtest: true });
 *   const [settings, supersede, migration, sync] = mods;
 *
 * = installFoundry() + installPacks() + importScripts(CORE_SCRIPTS) + boot().
 */
import { importScripts, installFoundry, MODULE_ID } from './foundry.mjs';
import { installPacks } from './packs.mjs';

/** The core scripts, in main.mjs order (settings before supersede before the syncs). */
export const CORE_SCRIPTS = [
	'scripts/core/playtest-settings.mjs',
	'scripts/core/supersede.mjs',
	'scripts/core/subclass-sync.mjs',
	'scripts/core/class-migration/index.mjs',
];

/**
 * @param {object} [opts]
 * @param {boolean} [opts.playtest=true]        the `playtestCoreClasses` world setting
 * @param {boolean} [opts.isGM=true]
 * @param {string[]} [opts.scripts=CORE_SCRIPTS] repo-relative scripts to import (fresh registry)
 * @param {object} [opts.packs]                  options for installPacks
 * @param {'init'|'setup'|'ready'|false} [opts.boot='setup']  how far to run the startup hooks
 *        ('setup' is the default so the `ready` migration/sync prompts don't fire unless asked)
 * @param {object} [opts.settings]               extra setting presets ("ns.key" → value)
 * @param {string} [opts.systemId]
 * @param {'close'|'throw'} [opts.dialogFallback]
 * @returns {Promise<{env: object, mods: object[]}>}
 */
export async function setupWorld({
	playtest = true,
	isGM = true,
	scripts = CORE_SCRIPTS,
	packs = {},
	boot = 'setup',
	settings = {},
	systemId,
	dialogFallback,
} = {}) {
	const env = installFoundry({
		isGM,
		systemId,
		dialogFallback,
		settings: { [`${MODULE_ID}.playtestCoreClasses`]: playtest, ...settings },
	});
	await installPacks(env, packs);
	const mods = await importScripts(scripts);
	if (boot) await env.boot({ until: boot });
	return { env, mods };
}
