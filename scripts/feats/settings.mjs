import { MODULE_ID } from '../core/constants.mjs';

// ── Feats (optional) ────────────────────────────────────────────────────────
// The Feats system is class-agnostic: a character may gain a feat at levels 1,
// 4, 8, 12, and 16. It is opt-in via the `enableFeats` world setting.
//
// Levels 4/8/12/16 are surfaced inside the system's native level-up dialog by
// injecting the `feats` group into the leveling class item's `groupIdentifiers`
// (see the `setup` prepareDerivedData patch). The dialog indexes any feature
// whose `system.group` matches an entry of the class's `groupIdentifiers`
// (keyed by `class || group`), so our class-less, `group: "feats"` features
// appear as a "Feats (Choose one)" section with native selection, ownership
// exclusion, granting, and level-down reversal — no custom code on that path.
//
// Level 1 is NOT covered by that dialog (the initial class drop doesn't run a
// level-up flow), and a setting toggled mid-campaign needs back-fill, so a
// lightweight sheet picker handles those cases.
export const FEATS_SETTING = 'enableFeats';
export const FEATS_GROUP = 'feats';
export const FEATS_PACK = `${MODULE_ID}.nim-plus-feats`;
export const FEAT_MILESTONE_LEVELS = [1, 4, 8, 12, 16];

export function featsEnabled() {
	try {
		return !!game.settings?.get?.(MODULE_ID, FEATS_SETTING);
	} catch {
		return false;
	}
}

Hooks.once('init', () => {
	game.settings.register(MODULE_ID, FEATS_SETTING, {
		name: 'Enable Feats',
		hint: 'Adds the optional class-agnostic Feats system. Characters may choose a feat at levels 1, 4, 8, 12, and 16 — offered in the level-up window (levels 4/8/12/16) and via a "Choose Feat" button on the character sheet.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		onChange: () => {
			// Re-prepare so the class-item groupIdentifiers patch (de)activates,
			// then re-render any open sheets so the Feats section appears/clears.
			for (const actor of game.actors ?? []) {
				try {
					actor.prepareData?.();
				} catch (error) {
					console.error(`[${MODULE_ID}] Failed to re-prepare actor on Feats toggle`, error);
				}
				for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
			}
		},
	});
});
