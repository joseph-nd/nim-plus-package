import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { FEAT_MILESTONE_LEVELS, featsEnabled } from './settings.mjs';
import {
	evaluateFeatPrereq,
	getCharacterLevel,
	grantFeatByIdentifier,
	loadFeatDocs,
	milestonesReached,
	ownedFeats,
} from './core.mjs';
import { ensureFeatStyles } from './styles.mjs';
import { autoFeatPromptArmed } from './auto-prompt.mjs';
import { levelUpDialogActor, waitForLevelUpAnchors } from '../core/level-up.mjs';

// ── Level-up window integration ─────────────────────────────────────────────
// Inject a "Feats (Choose one)" section into Nimble's native level-up dialog
// at feat milestone levels (4/8/12/16) and grant the chosen feat when the user
// confirms the level-up. The dialog can't surface class-agnostic feats on its
// own (its feature lookup is keyed by class identifier and never receives our
// `feats` group), so we add the selection UI to its DOM and hook its confirm
// button. Level 1 has no level-up dialog and is handled by the auto-prompt above.
const FEAT_MILESTONE_SET = new Set(FEAT_MILESTONE_LEVELS);

Hooks.on('renderGenericDialog', (app) => {
	injectLevelUpFeatSection(app).catch((error) =>
		console.error(`[${MODULE_ID}] Failed to inject feats into level-up window`, error),
	);
});

async function injectLevelUpFeatSection(app) {
	if (!featsEnabled()) return;
	const actor = levelUpDialogActor(app);
	if (!actor) return;

	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;
	// The Svelte body/footer may mount a frame or two after the render hook fires.
	const { body, footer } = await waitForLevelUpAnchors(root);
	if (!body || !footer) return;
	if (root.querySelector('.nim-plus-levelup-feats')) return; // already injected

	// Offer a feat only when the level being gained is a milestone the character
	// is actually owed a feat for.
	const newLevel = (Number(getCharacterLevel(actor)) || 0) + 1;
	if (!FEAT_MILESTONE_SET.has(newLevel)) return;
	if (milestonesReached(newLevel) - ownedFeats(actor).length <= 0) return;

	const docs = await loadFeatDocs();
	const ownedIds = new Set(ownedFeats(actor).map((i) => i.system?.identifier));
	const available = docs.filter((d) => !ownedIds.has(d.system?.identifier));
	if (available.length === 0) return;

	// Re-check after the await — the dialog may have closed or another render
	// could have injected in the meantime.
	if (!root.isConnected || root.querySelector('.nim-plus-levelup-feats')) return;

	const rows = available
		.map((doc) => {
			const req = doc.getFlag(MODULE_ID, 'featReq') || '';
			const verdict = evaluateFeatPrereq(actor, req);
			const blocked = verdict.checkable && !verdict.met;
			const reqTag = req
				? `<span class="nim-plus-feat-pick__req${blocked ? ' is-unmet' : ''}">${escape(verdict.checkable ? verdict.reason : `Prereq: ${req}`)}</span>`
				: '';
			const desc = String(doc.system?.description ?? '')
				.replace(/<p class="nim-plus-feat-req">[\s\S]*?<\/p>/i, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return `
				<label class="nim-plus-feat-pick__row${blocked ? ' is-disabled' : ''}">
					<input type="radio" name="nim-plus-levelup-feat" value="${escape(doc.system?.identifier)}"${blocked ? ' disabled' : ''}>
					<span class="nim-plus-feat-pick__main">
						<span class="nim-plus-feat-pick__name">${escape(doc.name)} ${reqTag}</span>
						<span class="nim-plus-feat-pick__desc">${escape(desc)}</span>
					</span>
				</label>`;
		})
		.join('');

	ensureFeatStyles();
	const section = document.createElement('section');
	section.className = 'nim-plus-levelup-feats';
	section.innerHTML = `
		<header class="nim-plus-levelup-feats__header">
			<h3 class="nimble-heading" data-heading-variant="section">Feats (Choose one)</h3>
		</header>
		<div class="nim-plus-feat-pick__list">${rows}</div>`;

	// Grant the selected feat when the user confirms the level-up. Registered in
	// the capture phase so it runs before the dialog's own submit: with no feat
	// chosen it blocks submission (the feat is required at this level); otherwise
	// it grants the feat and lets the level-up proceed.
	const confirmHandler = (event) => {
		const selected = section.querySelector('input[name="nim-plus-levelup-feat"]:checked');
		if (!selected) {
			event.preventDefault();
			event.stopImmediatePropagation();
			ui.notifications?.warn('Choose a feat to finish your level-up.');
			return;
		}
		if (section.dataset.granted) return;
		section.dataset.granted = 'true';
		grantFeatByIdentifier(actor, selected.value).catch((error) =>
			console.error(`[${MODULE_ID}] Failed to grant feat from level-up window`, error),
		);
	};

	// Keep the section attached and the confirm button hooked across the dialog's
	// reactive re-renders. Re-appending the same detached node preserves the radio
	// choice, so the observer is a safe self-heal.
	const ensure = () => {
		const r = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
		if (!r || !r.isConnected) return;
		const liveBody = r.querySelector('.nimble-sheet__body');
		if (liveBody && !section.isConnected) liveBody.appendChild(section);
		const confirmBtn = r.querySelector('.nimble-sheet__footer .nimble-button');
		if (confirmBtn && !confirmBtn.dataset.nimPlusFeatHooked) {
			confirmBtn.dataset.nimPlusFeatHooked = 'true';
			confirmBtn.addEventListener('click', confirmHandler, true);
		}
	};

	ensure();
	try {
		app.__nimPlusFeatObserver?.disconnect();
	} catch (_error) {
		/* no previous observer */
	}
	const observer = new MutationObserver(() => ensure());
	observer.observe(root, { childList: true, subtree: true });
	app.__nimPlusFeatObserver = observer;
}

Hooks.on('closeGenericDialog', (app) => {
	try {
		app.__nimPlusFeatObserver?.disconnect();
	} catch (_error) {
		/* nothing to disconnect */
	}
});

// Re-arm the auto-prompt whenever a class level changes (level-up / level-down),
// so the next sheet render offers any newly-owed feat.
Hooks.on('updateItem', (item, changes) => {
	if (item?.type !== 'class') return;
	if (foundry.utils.getProperty(changes, 'system.classLevel') === undefined) return;
	const actor = item.actor;
	if (actor) autoFeatPromptArmed.delete(actor.id);
});
