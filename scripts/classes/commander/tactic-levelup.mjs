import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { getCharacterLevel } from '../../feats/core.mjs';
import { ensureFeatStyles } from '../../feats/styles.mjs';
import { levelUpDialogActor, waitForLevelUpAnchors } from '../../core/level-up.mjs';
import { SUPERSEDED_CORE_FEATURES } from './superseded-list.mjs';

/* ── Commander — an extra Combat Tactic at a subclass level ──────────────────
 *
 * Champion of the Pit's *Seasoned Combatant* reads "Choose a Combat Tactic and
 * gain +1 max Combat Dice". The pool half is a `modifyPool` rule on the feature;
 * the choice half has nowhere to live.
 *
 * The level-up window builds its selection groups from an index keyed by class
 * identifier and level: the core tactics are registered under `commander` at
 * levels 4/6/8/10/12/16, and a subclass cannot add itself to that list — the
 * whole path runs inside the dialog's own state, with no hook and no registry to
 * extend. Subclass features are always auto-granted, never offered as a choice.
 *
 * So the section is added to the dialog's DOM and the confirm button hooked, the
 * same way the Feats section already is. What is offered is the *real* tactic
 * documents from whichever pack ships them, found by their own class/group
 * fields rather than by name, so a homebrew tactic in another pack appears here
 * too — and the trigger is a module flag on the granting feature, so a subclass
 * added later needs no change here.
 */

const TACTIC_LEVELUP_CLASS = 'nim-plus-levelup-tactic';
const TACTIC_GROUP = 'combat-tactics';
const GRANTS_TACTIC_FLAG = 'grantsCombatTactic';
/** Stamped on the tactic we hand out, so what is still owed can be derived. */
const FROM_TACTIC_GRANT_FLAG = 'fromCombatTacticGrant';

/**
 * The group key a subclass's features are filed under.
 *
 * Derived exactly the way the level-up window derives it — the subclass item's
 * **name**, slugified — rather than from `system.identifier`, which is not what
 * the system matches on and is not always populated.
 */
function actorSubclassGroup(actor) {
	const parentClass = actor?.items?.find?.((item) => item.type === 'class')?.system?.identifier;
	const subclass =
		actor?.items?.find?.(
			(item) => item.type === 'subclass' && (!parentClass || item.system?.parentClass === parentClass),
		) ?? actor?.items?.find?.((item) => item.type === 'subclass');
	const name = String(subclass?.name ?? '');
	if (name.length < 1) return null;
	return name.slugify({ strict: true });
}

/** Every Combat Tactic document in the world's packs, whatever ships them. */
let combatTacticDocsCache = null;
async function loadCombatTacticDocs() {
	if (combatTacticDocsCache) return combatTacticDocsCache;

	const docs = [];
	for (const pack of game.packs ?? []) {
		if (pack.documentName !== 'Item') continue;
		let index;
		try {
			index = await pack.getIndex({ fields: ['type', 'system.class', 'system.group'] });
		} catch (_error) {
			continue; // A pack we cannot read is a pack we skip.
		}
		for (const entry of index) {
			if (entry.type !== 'feature') continue;
			if (entry.system?.group !== TACTIC_GROUP) continue;
			// Republished elsewhere — offering it here would put the same feature in
			// two groups at once.
			if (SUPERSEDED_CORE_FEATURES.some((sup) => sup.name === entry.name)) continue;
			const doc = await pack.getDocument(entry._id).catch(() => null);
			if (doc) docs.push(doc);
		}
	}

	combatTacticDocsCache = docs.sort((a, b) => a.name.localeCompare(b.name));
	return combatTacticDocsCache;
}

/**
 * True when the level being gained brings a feature that grants a Combat Tactic
 * choice. Read from the module flag rather than from a hardcoded subclass/level
 * pair, so this follows the content.
 */
async function levelGrantsCombatTactic(actor, level) {
	const group = actorSubclassGroup(actor);
	if (!group) return false;

	for (const pack of game.packs ?? []) {
		if (pack.documentName !== 'Item') continue;
		let index;
		try {
			index = await pack.getIndex({ fields: ['type', 'system.group', 'system.gainedAtLevels'] });
		} catch (_error) {
			continue;
		}
		for (const entry of index) {
			if (entry.type !== 'feature') continue;
			if (entry.system?.group !== group) continue;
			const levels = entry.system?.gainedAtLevels;
			if (!Array.isArray(levels) || !levels.includes(level)) continue;

			// The flag is read off the document rather than the index: a compendium
			// index only carries the fields it was asked for, and module flags are
			// not among the ones the system registers.
			const doc = await pack.getDocument(entry._id).catch(() => null);
			if (doc?.getFlag?.(MODULE_ID, GRANTS_TACTIC_FLAG) === true) return true;
		}
	}

	return false;
}

/** Grant a chosen tactic, carrying its compendium source like the feat path. */
async function grantCombatTactic(actor, uuid) {
	const docs = await loadCombatTacticDocs();
	const chosen = docs.find((doc) => doc.uuid === uuid);
	if (!chosen) return null;

	const source = chosen.toObject();
	delete source._id;
	source._stats = source._stats ?? {};
	source._stats.compendiumSource = chosen.uuid;
	// The stamp is what makes "already claimed" derivable from the sheet itself:
	// a tactic chosen through the class's own levels carries none, and a
	// level-down that removes this item makes the choice owed again with no
	// ledger to keep in step.
	source.flags = {
		...(source.flags ?? {}),
		[MODULE_ID]: { ...(source.flags?.[MODULE_ID] ?? {}), [FROM_TACTIC_GRANT_FLAG]: true },
	};
	const [created] = await actor.createEmbeddedDocuments('Item', [source]);
	ui.notifications?.info(`${actor.name} gained the ${chosen.name} Combat Tactic.`);
	return created ?? null;
}

/* ── Claiming a tactic the character is already owed ─────────────────────────
 *
 * The level-up window is the right place to choose, but it is only offered once
 * and only to a character crossing that level. A Commander who reached the level
 * before this existed — or who was set to it directly rather than levelled — is
 * owed a tactic with nowhere to claim it, so the sheet offers it as well.
 *
 * How many are owed is derived, never recorded: one for each owned feature that
 * grants a tactic and whose level has been reached, less the tactics we have
 * already stamped as ours.
 */

/** Features on the sheet that promise a Combat Tactic at a level already reached. */
function tacticGrantingFeatures(actor) {
	const level = Number(getCharacterLevel(actor)) || 0;
	const features = [];
	for (const item of actor?.items ?? []) {
		if (item.type !== 'feature') continue;
		if (item.getFlag?.(MODULE_ID, GRANTS_TACTIC_FLAG) !== true) continue;
		const explicit = item.system?.gainedAtLevel;
		const levels = item.system?.gainedAtLevels;
		const gainedAt = Number.isFinite(explicit)
			? Number(explicit)
			: Array.isArray(levels) && levels.length > 0
				? Math.min(...levels.map(Number).filter(Number.isFinite))
				: null;
		if (gainedAt === null || level < gainedAt) continue;
		features.push(item);
	}
	return features;
}

/** Tactics this module has already handed out on that promise. */
function grantedTactics(actor) {
	return (actor?.items ?? []).filter(
		(item) => item.getFlag?.(MODULE_ID, FROM_TACTIC_GRANT_FLAG) === true,
	);
}

function pendingTacticCount(actor) {
	return tacticGrantingFeatures(actor).length - grantedTactics(actor).length;
}

/** The sheet-side picker, for a tactic that was never claimed at level-up. */
async function chooseCombatTactic(actor) {
	const owned = new Set(
		(actor.items ?? [])
			.filter((item) => item.type === 'feature')
			.map((item) => String(item.name ?? '').toLowerCase()),
	);
	const available = (await loadCombatTacticDocs()).filter(
		(doc) => !owned.has(String(doc.name ?? '').toLowerCase()),
	);
	if (available.length === 0) {
		ui.notifications?.info('Every Combat Tactic has already been taken.');
		return null;
	}

	ensureFeatStyles();
	const rows = available
		.map((doc) => {
			const desc = String(doc.system?.description ?? '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return `
				<label class="nim-plus-feat-pick__row">
					<input type="radio" name="tactic" value="${escape(doc.uuid)}">
					<span class="nim-plus-feat-pick__main">
						<span class="nim-plus-feat-pick__name">${escape(doc.name)}</span>
						<span class="nim-plus-feat-pick__desc">${escape(desc)}</span>
					</span>
				</label>`;
		})
		.join('');

	const source = tacticGrantingFeatures(actor)[0];
	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `Choose a Combat Tactic — ${actor.name}` },
		content: `
			<div class="nim-plus-feat-pick">
				<p class="nim-plus-feat-pick__intro">${escape(source?.name ?? 'A feature')} grants a Combat Tactic.</p>
				<div class="nim-plus-feat-pick__list">${rows}</div>
			</div>
		`,
		buttons: [
			{
				action: 'grant',
				label: 'Gain Combat Tactic',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const checked = root?.querySelector?.('input[name="tactic"]:checked');
					return checked?.value ?? null;
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice) return null;
	return grantCombatTactic(actor, choice);
}

// Prompted once per character per session: dismissing it is an answer, and the
// prompt returns on the next reload if the tactic is still unclaimed.
const tacticPromptArmed = new Set();
const tacticPromptBusy = new Set();

function maybePromptOwedCombatTactic(app) {
	if (!classQoLEnabled()) return;
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character' || !actor.isOwner) return;
	if (tacticPromptArmed.has(actor.id) || tacticPromptBusy.has(actor.id)) return;
	if (pendingTacticCount(actor) < 1) return;

	tacticPromptArmed.add(actor.id);
	tacticPromptBusy.add(actor.id);
	chooseCombatTactic(actor)
		.catch((error) => console.error(`[${MODULE_ID}] Combat Tactic prompt failed`, error))
		.finally(() => tacticPromptBusy.delete(actor.id));
}

async function injectLevelUpCombatTacticSection(app) {
	if (!classQoLEnabled()) return;

	const actor = levelUpDialogActor(app);
	if (!actor) return;

	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;
	const { body, footer } = await waitForLevelUpAnchors(root);
	if (!body || !footer) return;
	if (root.querySelector(`.${TACTIC_LEVELUP_CLASS}`)) return;

	const newLevel = (Number(getCharacterLevel(actor)) || 0) + 1;
	if (!(await levelGrantsCombatTactic(actor, newLevel))) return;

	// Tactics already taken are not on offer again.
	const owned = new Set(
		(actor.items ?? [])
			.filter((item) => item.type === 'feature')
			.map((item) => String(item.name ?? '').toLowerCase()),
	);
	const available = (await loadCombatTacticDocs()).filter(
		(doc) => !owned.has(String(doc.name ?? '').toLowerCase()),
	);
	if (available.length === 0) return;

	// Re-check after the awaits: the dialog may have closed, or another render
	// could have injected in the meantime.
	if (!root.isConnected || root.querySelector(`.${TACTIC_LEVELUP_CLASS}`)) return;

	ensureFeatStyles();
	const rows = available
		.map((doc) => {
			const desc = String(doc.system?.description ?? '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return `
				<label class="nim-plus-feat-pick__row">
					<input type="radio" name="nim-plus-levelup-tactic" value="${escape(doc.uuid)}">
					<span class="nim-plus-feat-pick__main">
						<span class="nim-plus-feat-pick__name">${escape(doc.name)}</span>
						<span class="nim-plus-feat-pick__desc">${escape(desc)}</span>
					</span>
				</label>`;
		})
		.join('');

	const section = document.createElement('section');
	section.className = TACTIC_LEVELUP_CLASS;
	section.innerHTML = `
		<header>
			<h3 class="nimble-heading" data-heading-variant="section">Combat Tactic (Choose one)</h3>
		</header>
		<div class="nim-plus-feat-pick__list">${rows}</div>`;

	// Capture phase, so this runs before the dialog's own submit: with nothing
	// chosen the level-up is blocked, because the tactic is owed at this level.
	const confirmHandler = (event) => {
		const selected = section.querySelector('input[name="nim-plus-levelup-tactic"]:checked');
		if (!selected) {
			event.preventDefault();
			event.stopImmediatePropagation();
			ui.notifications?.warn('Choose a Combat Tactic to finish your level-up.');
			return;
		}
		if (section.dataset.granted) return;
		section.dataset.granted = 'true';
		// Chosen here, so the sheet must not also ask: the granting feature and the
		// tactic are created by two different flows and the sheet can render while
		// only one of them has landed.
		tacticPromptArmed.add(actor.id);
		grantCombatTactic(actor, selected.value).catch((error) =>
			console.error(`[${MODULE_ID}] Failed to grant a Combat Tactic from the level-up window`, error),
		);
	};

	// Keep the section attached and the button hooked across the dialog's own
	// reactive re-renders; re-appending the same detached node preserves the
	// radio choice, so the observer is a safe self-heal.
	const ensure = () => {
		const live = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
		if (!live?.isConnected) return;
		const liveBody = live.querySelector('.nimble-sheet__body');
		if (liveBody && !section.isConnected) liveBody.appendChild(section);
		const confirmBtn = live.querySelector('.nimble-sheet__footer .nimble-button');
		if (confirmBtn && !confirmBtn.dataset.nimPlusTacticHooked) {
			confirmBtn.dataset.nimPlusTacticHooked = 'true';
			confirmBtn.addEventListener('click', confirmHandler, true);
		}
	};

	ensure();
	try {
		app.__nimPlusTacticObserver?.disconnect();
	} catch (_error) {
		/* no previous observer */
	}
	const observer = new MutationObserver(() => ensure());
	observer.observe(root, { childList: true, subtree: true });
	app.__nimPlusTacticObserver = observer;
}

Hooks.on('renderGenericDialog', (app) => {
	injectLevelUpCombatTacticSection(app).catch((error) =>
		console.error(`[${MODULE_ID}] Failed to add the Combat Tactic choice to the level-up window`, error),
	);
});

Hooks.on('closeGenericDialog', (app) => {
	try {
		app.__nimPlusTacticObserver?.disconnect();
	} catch (_error) {
		/* nothing to disconnect */
	}
});

Hooks.on('renderPlayerCharacterSheet', (app) => {
	try {
		maybePromptOwedCombatTactic(app);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to check for an owed Combat Tactic`, error);
	}
});
