import { MODULE_ID } from './constants.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Nimble 0.2 playtest core classes — the switch
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Nim+ ships 0.2 playtest copies of the system's core class documents (class
 * items, class and subclass features, class spells). Each copy names the system
 * document it replaces in `flags.nim-plus-package.supersedes`; documents that
 * are new in 0.2 carry `flags.nim-plus-package.playtest02 = true`.
 *
 * This one world setting picks which rules the table plays:
 *
 *   on  (default) — the superseded and retired system documents are taken out of
 *                   the `nimble.*` pack indexes, so the character creator, the
 *                   level-up window and the spell pickers only see the 0.2 copies
 *                   (`./supersede.mjs`);
 *   off           — the Nim+ 0.2 copies are taken out of the Nim+ pack indexes
 *                   instead, which is pure Heroes 2.0.3 again.
 *
 * Existing characters are moved between the two with the class migration
 * (`./class-migration/index.mjs`). The index filter is installed once per page
 * load, so a change only takes effect after a reload.
 */
export const PLAYTEST_CORE_CLASSES_SETTING = 'playtestCoreClasses';

export function playtestCoreClassesEnabled() {
	try {
		return game.settings?.get?.(MODULE_ID, PLAYTEST_CORE_CLASSES_SETTING) !== false;
	} catch (_error) {
		// Not registered yet — the default.
		return true;
	}
}

Hooks.once('init', () => {
	game.settings.register(MODULE_ID, PLAYTEST_CORE_CLASSES_SETTING, {
		name: 'Use Nimble 0.2 playtest core classes',
		hint: 'Replaces the core classes, their official subclasses and class spells with the Nimble 0.2 playtest rules (Zephyr stays at 0.1). Turn off for pure Heroes 2.0.3. Existing characters are converted with the "Migrate class" button on their sheet header, which a GM is offered after reloading.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		requiresReload: true,
	});
});
