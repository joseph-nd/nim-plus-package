import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { getDialogForm, readField, waitDialog } from '../core/dialog.mjs';
import { FEATS_GROUP, FEATS_PACK, FEAT_MILESTONE_LEVELS } from './settings.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Feats (optional) — sheet picker + back-fill
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The native level-up dialog covers feat selection at levels 4/8/12/16 (via the
 * groupIdentifiers injection in the `setup` hook). This section provides the
 * complementary character-sheet UI: a "Feats" panel that lists the feats a
 * character has taken and offers a "Choose Feat" button whenever they're owed
 * one — covering level 1 (which the level-up dialog never prompts for) and any
 * back-fill when the setting is enabled mid-campaign. The button is manual, so
 * it never races or double-grants against the native dialog: it counts owned
 * feats against milestones reached and only offers the shortfall.
 */

export function getCharacterLevel(actor) {
	if (!actor) return 0;
	const fromGetter = Number(actor.levels?.character);
	if (Number.isFinite(fromGetter) && fromGetter > 0) return fromGetter;
	let total = 0;
	for (const item of actor.items ?? []) {
		if (item.type === 'class') total += Number(item.system?.classLevel ?? 0) || 0;
	}
	return total;
}

export function milestonesReached(level) {
	return FEAT_MILESTONE_LEVELS.filter((m) => m <= level).length;
}

export function ownedFeats(actor) {
	if (!actor) return [];
	const items = actor.items?.contents ?? Array.from(actor.items ?? []);
	return items.filter(
		(i) =>
			i.type === 'feature' &&
			(i.getFlag?.(MODULE_ID, 'feat') === true || i.system?.group === FEATS_GROUP),
	);
}

export function pendingFeatCount(actor) {
	if (!actor) return 0;
	const reached = milestonesReached(getCharacterLevel(actor));
	const owned = ownedFeats(actor).length;
	return Math.max(0, reached - owned);
}

// Map prerequisite ability codes to Nimble ability keys.
const FEAT_ABILITY_KEYS = { STR: 'strength', DEX: 'dexterity', INT: 'intelligence', WIL: 'will' };

/**
 * Evaluate a feat's prerequisite string against an actor. Only ability-score
 * requirements ("3 STR") are machine-checkable; everything else ("Plate Armor
 * Prof.", "Can cast spells") is surfaced as text but never blocks selection.
 *
 * @returns {{ met: boolean, checkable: boolean, reason: string }}
 */
export function evaluateFeatPrereq(actor, req) {
	if (!req) return { met: true, checkable: true, reason: '' };
	const match = /^\s*(\d+)\s+(STR|DEX|INT|WIL)\b/i.exec(req);
	if (!match) return { met: true, checkable: false, reason: req };
	const needed = Number(match[1]);
	const code = match[2].toUpperCase();
	const have = Number(actor?.system?.abilities?.[FEAT_ABILITY_KEYS[code]]?.mod ?? 0);
	return { met: have >= needed, checkable: true, reason: `Requires ${needed} ${code} (you have ${have})` };
}

let featPackDocsCache = null;
export async function loadFeatDocs() {
	if (featPackDocsCache) return featPackDocsCache;
	const pack = game.packs.get(FEATS_PACK);
	if (!pack) return [];
	const docs = await pack.getDocuments();
	featPackDocsCache = docs
		.filter((d) => d.type === 'feature')
		.sort((a, b) => a.name.localeCompare(b.name));
	return featPackDocsCache;
}

/**
 * Open the feat picker for an actor and grant the chosen feat. Excludes feats
 * already owned and disables (with a reason) any whose ability-score
 * prerequisite isn't met.
 */
export async function chooseFeat(actor) {
	if (!actor) {
		ui.notifications?.error(`[${MODULE_ID}] chooseFeat: missing actor.`);
		return null;
	}
	const docs = await loadFeatDocs();
	if (docs.length === 0) {
		ui.notifications?.error(`[${MODULE_ID}] No feats found in the ${FEATS_PACK} compendium.`);
		return null;
	}

	const ownedIds = new Set(ownedFeats(actor).map((i) => i.system?.identifier));
	const available = docs.filter((d) => !ownedIds.has(d.system?.identifier));
	if (available.length === 0) {
		ui.notifications?.info('All feats have already been taken.');
		return null;
	}

	const level = getCharacterLevel(actor);
	const pending = pendingFeatCount(actor);

	const rows = available
		.map((doc) => {
			const req = doc.getFlag(MODULE_ID, 'featReq') || '';
			const verdict = evaluateFeatPrereq(actor, req);
			const blocked = verdict.checkable && !verdict.met;
			const reqTag = req
				? `<span class="nim-plus-feat-pick__req${blocked ? ' is-unmet' : ''}">${escape(verdict.checkable ? verdict.reason : `Prereq: ${req}`)}</span>`
				: '';
			const body = String(doc.system?.description ?? '')
				.replace(/<p class="nim-plus-feat-req">[\s\S]*?<\/p>/i, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return `
				<label class="nim-plus-feat-pick__row${blocked ? ' is-disabled' : ''}">
					<input type="radio" name="feat" value="${escape(doc.system?.identifier)}"${blocked ? ' disabled' : ''}>
					<span class="nim-plus-feat-pick__main">
						<span class="nim-plus-feat-pick__name">${escape(doc.name)} ${reqTag}</span>
						<span class="nim-plus-feat-pick__desc">${escape(body)}</span>
					</span>
				</label>`;
		})
		.join('');

	const choiceId = await waitDialog({
		window: { title: `Choose a Feat — ${actor.name}` },
		content: `
			<div class="nim-plus-feat-pick">
				<p class="nim-plus-feat-pick__intro">Level ${level}. ${pending > 1 ? `You have <strong>${pending}</strong> feats to choose.` : 'Choose a feat.'} Greyed-out feats don't meet an ability-score prerequisite.</p>
				<div class="nim-plus-feat-pick__list">${rows}</div>
			</div>
		`,
		buttons: [
			{
				action: 'grant',
				label: 'Gain Feat',
				default: true,
				callback: (_event, button, dialog) => readField(getDialogForm(button, dialog), 'feat') || null,
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	});

	if (typeof choiceId !== 'string' || !choiceId) return null;
	return grantFeatByIdentifier(actor, choiceId);
}

/**
 * Grant a feat to an actor by its identifier (headless — no dialog). Used by the
 * sheet picker and by the level-up window injection. Stamps `compendiumSource`
 * so the system treats it as an owned compendium feature (ownership exclusion,
 * level-down reversal, etc.).
 */
export async function grantFeatByIdentifier(actor, identifier) {
	const docs = await loadFeatDocs();
	const chosen = docs.find((d) => d.system?.identifier === identifier);
	if (!chosen) return null;
	const obj = chosen.toObject();
	delete obj._id;
	obj._stats = obj._stats ?? {};
	obj._stats.compendiumSource = chosen.uuid;
	const [created] = await actor.createEmbeddedDocuments('Item', [obj]);
	ui.notifications?.info(`${actor.name} gained the ${chosen.name} feat.`);
	return created ?? null;
}
