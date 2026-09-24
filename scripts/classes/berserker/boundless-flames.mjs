import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';

/* ── Berserker — Path of the Burning Rage, Boundless Flames (L20) ────────────
 *
 * "Replaces Boundless Rage."
 *
 * Both features arrive at level 20, one from the class progression and one from
 * the subclass, so the level-up window grants both. When the character ends up
 * owning Boundless Flames and a Boundless Rage (the system's 2.0.3 feature or
 * the module's 0.2 copy, matched by name), the user who added the item is asked
 * whether to remove Boundless Rage. Nothing is deleted without that yes, and a
 * removed feature can be dragged back from the compendium.
 *
 * Either creation can come first (a level-up creates them in one batch, in
 * whatever order), so both trigger the check, and the check runs once per actor
 * after the batch has settled.
 */

const FLAMES_MATCH = /^boundless\s*flames$/i;
const RAGE_MATCH = /^boundless\s*rage$/i;
const SETTLE_MS = 250;

const pending = new Set();

function matches(item, pattern) {
	return item?.type === 'feature' && pattern.test(String(item.name ?? '').trim());
}

async function offerRemoval(actor) {
	if (!actor?.items?.some((item) => matches(item, FLAMES_MATCH))) return;
	const rages = actor.items.filter((item) => matches(item, RAGE_MATCH));
	if (rages.length === 0) return;

	const confirmed = await foundry.applications.api.DialogV2.confirm({
		window: { title: 'Boundless Flames' },
		content: `<p><strong>Boundless Flames</strong> replaces <strong>Boundless Rage</strong>.</p><p>Remove Boundless Rage from ${escape(actor.name)}? You can drag it back from the compendium if needed.</p>`,
		rejectClose: false,
		modal: true,
	}).catch(() => false);
	if (!confirmed) return;

	// Re-read: the sheet may have changed while the dialog was open.
	const ids = rages.map((item) => item.id).filter((id) => actor.items.has(id));
	if (ids.length === 0) return;
	await actor.deleteEmbeddedDocuments('Item', ids);
	ui.notifications?.info(`Removed Boundless Rage from ${actor.name}.`);
}

Hooks.on('createItem', (item, _options, userId) => {
	if (userId !== game.user?.id || !classQoLEnabled()) return;
	if (!matches(item, FLAMES_MATCH) && !matches(item, RAGE_MATCH)) return;
	const actor = item.parent;
	if (actor?.documentName !== 'Actor' || actor.type !== 'character') return;
	if (!actor.isOwner && !game.user.isGM) return;
	if (pending.has(actor.uuid)) return;

	pending.add(actor.uuid);
	setTimeout(() => {
		pending.delete(actor.uuid);
		offerRemoval(actor).catch((error) =>
			console.error(`[${MODULE_ID}] Could not offer to remove Boundless Rage`, error),
		);
	}, SETTLE_MS);
});
