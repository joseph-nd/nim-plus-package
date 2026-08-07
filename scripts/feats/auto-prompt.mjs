import { MODULE_ID } from '../core/constants.mjs';
import { featsEnabled } from './settings.mjs';
import { chooseFeat, getCharacterLevel, pendingFeatCount } from './core.mjs';
import { resyncFeatsForActor } from './sheet-section.mjs';

/**
 * Auto-prompt the feat picker when a character is owed a feat.
 *
 * Nimble's native level-up dialog and character-creator only surface features
 * keyed by the *class identifier* — they call `getClassFeaturesFromIndex` without
 * the `groupIdentifiers` argument, so our class-less `group: "feats"` pool can
 * never appear there (an architectural limit of the system, not a setting).
 * Instead we drive selection ourselves: whenever an owed character's sheet
 * renders, open the picker. The prompt is "armed" once per character and re-armed
 * on every class-level change, so it fires at levels 1/4/8/12/16 (and as back-fill
 * when the setting is switched on mid-campaign). The manual "Choose Feat" button
 * in the Feats panel remains as a fallback.
 */
export const autoFeatPromptArmed = new Set(); // actor ids already prompted this cycle
const featPromptBusy = new Set(); // actor ids with an open prompt loop

async function promptFeatsLoop(actor) {
	if (featPromptBusy.has(actor.id)) return;
	featPromptBusy.add(actor.id);
	try {
		while (featsEnabled() && pendingFeatCount(actor) > 0) {
			const granted = await chooseFeat(actor);
			resyncFeatsForActor(actor);
			if (!granted) break; // dismissed — stop nagging; the panel button remains
		}
	} finally {
		featPromptBusy.delete(actor.id);
	}
}

export function maybeAutoPromptFeats(app) {
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	if (!featsEnabled() || !actor.isOwner) return;
	// Levels 4/8/12/16 are chosen inside the level-up window (see the
	// renderGenericDialog injection below); the only milestone with no level-up
	// flow is level 1 (character creation), so the auto-prompt is scoped to it.
	// Higher-level back-fill (enabling the setting mid-campaign) uses the Feats
	// section's "Choose Feat" button on the Features tab.
	if (getCharacterLevel(actor) !== 1) return;
	// A GM is auto-prompted only for their own assigned character, not when
	// peeking at a player's sheet.
	if (game.user?.isGM && game.user?.character?.id !== actor.id) return;
	if (autoFeatPromptArmed.has(actor.id)) return; // already prompted this cycle
	if (pendingFeatCount(actor) <= 0) return;
	autoFeatPromptArmed.add(actor.id);
	promptFeatsLoop(actor).catch((error) =>
		console.error(`[${MODULE_ID}] Feat auto-prompt failed`, error),
	);
}
