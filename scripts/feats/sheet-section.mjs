import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { featsEnabled } from './settings.mjs';
import { chooseFeat, ownedFeats, pendingFeatCount } from './core.mjs';
import { ensureFeatStyles } from './styles.mjs';
import { syncWeaponEquipToggles } from './weapon-equip-toggle.mjs';
import { featsNeedingConfig } from '../feats/mechanics/config-status.mjs';
import { allocateAcademic } from '../feats/mechanics/academic.mjs';
import { chooseElementalSpecialist } from '../feats/mechanics/elemental-specialist.mjs';

// Signature of the feats UI state — used to skip re-rendering the section when
// nothing relevant changed (so the MutationObserver below never loops).
function featsSignature(actor) {
	const ids = ownedFeats(actor)
		.map((f) => f.id)
		.sort()
		.join(',');
	const cfg = featsNeedingConfig(actor)
		.map((c) => c.kind)
		.join(',');
	return `${ids}|${pendingFeatCount(actor)}|${cfg}`;
}

// The card markup deliberately uses module-owned classes: the system's
// `nimble-feature-card__*` styles are Svelte-scoped, so they never apply to
// DOM injected from outside the component (the icons would render at their
// natural 512px size). The `.nim-plus-feat-card` styles below replicate the
// system card's look from the same theme variables.
function featCardHTML(feat) {
	const img = escape(feat.img || 'icons/svg/upgrade.svg');
	const req = feat.getFlag?.(MODULE_ID, 'featReq');
	const reqTag = req ? `<span class="nim-plus-feat-card__req">${escape(req)}</span>` : '';
	const name = escape(feat.name);
	return `<li class="nim-plus-feat-card" data-feat-id="${escape(feat.id)}">
		<div class="nim-plus-feat-card__header" role="button" tabindex="0" data-nim-plus-open-feat="${escape(feat.id)}">
			<div class="nim-plus-feat-card__img-wrapper">
				<img class="nim-plus-feat-card__img" src="${img}" alt="">
				<button type="button" class="nim-plus-feat-card__img-activate" data-nim-plus-feat-chat="${escape(feat.id)}" aria-label="Send ${name} to chat"><i class="fa-solid fa-comment"></i></button>
			</div>
			<h4 class="nim-plus-feat-card__name nimble-heading" data-heading-variant="item">${name}</h4>
			${reqTag}
		</div>
	</li>`;
}

function renderFeatsSection(actor) {
	const chosen = ownedFeats(actor)
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name));
	const pending = pendingFeatCount(actor);
	const cards =
		chosen.map(featCardHTML).join('') ||
		`<li class="nim-plus-feats-section__empty">No feats chosen yet.</li>`;
	const chooseBtn =
		pending > 0
			? `<button type="button" class="nim-plus-feats-section__btn" data-nim-plus-feat="choose"><i class="fa-solid fa-star"></i> Choose Feat${pending > 1 ? ` (${pending})` : ''}</button>`
			: '';
	const configBtns = featsNeedingConfig(actor)
		.map(
			(c) =>
				`<button type="button" class="nim-plus-feats-section__btn" data-nim-plus-feat-config="${escape(c.kind)}"><i class="fa-solid fa-sliders"></i> ${escape(c.label)}</button>`,
		)
		.join('');
	const badge = pending > 0 ? `<span class="nim-plus-feats-section__badge">${pending} available</span>` : '';
	return `
		<div class="nim-plus-feats-section" data-actor-id="${escape(actor.id)}" data-sig="${escape(featsSignature(actor))}">
			<header class="nim-plus-feats-section__header">
				<h3 class="nimble-heading" data-heading-variant="section">Feats</h3>
				${badge}
				<div class="nim-plus-feats-section__actions">${chooseBtn}${configBtns}</div>
			</header>
			<ul class="nim-plus-feats-section__list">${cards}</ul>
		</div>`;
}

function wireFeatsSection(section, actor) {
	section.querySelectorAll('[data-nim-plus-open-feat]').forEach((el) => {
		el.addEventListener('click', (event) => {
			event.preventDefault();
			const feat = actor.items?.get?.(el.dataset.nimPlusOpenFeat);
			feat?.sheet?.render(true);
		});
	});
	// Send-to-chat overlay on the feat icon: posts the feat's description to chat
	// via the system's own item activation (mirrors the native feature card's
	// comment button). stopPropagation keeps the header's open-sheet click from
	// also firing.
	section.querySelectorAll('[data-nim-plus-feat-chat]').forEach((btn) => {
		btn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			actor.activateItem?.(btn.dataset.nimPlusFeatChat);
		});
	});
	section.querySelector('[data-nim-plus-feat="choose"]')?.addEventListener('click', async (event) => {
		event.preventDefault();
		await chooseFeat(actor);
		resyncFeatsForActor(actor);
	});
	section.querySelectorAll('[data-nim-plus-feat-config]').forEach((btn) => {
		btn.addEventListener('click', async (event) => {
			event.preventDefault();
			const kind = btn.dataset.nimPlusFeatConfig;
			if (kind === 'academic') await allocateAcademic(actor);
			else if (kind === 'elemental') await chooseElementalSpecialist(actor);
			resyncFeatsForActor(actor);
		});
	});
}

/**
 * Inject (or refresh) the Feats section into the Features tab body. Identifies
 * the Features tab via the active nav button's `fa-table-list` icon (only the
 * active tab's body is mounted at a time, and the Spells tab shares the body
 * class, so the icon is the reliable discriminator). Idempotent: re-renders only
 * when the feats signature changes, so the MutationObserver can call it freely.
 */
export function syncFeatsTabSection(app) {
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;

	const featuresActive = !!root.querySelector('[data-button-state="active"] i.fa-table-list');
	const body = root.querySelector('.nimble-sheet__body--player-character');
	const eligible = featsEnabled() && actor.items?.some?.((i) => i.type === 'class');

	if (!featuresActive || !body || !eligible) {
		root.querySelectorAll('.nim-plus-feats-section').forEach((el) => el.remove());
		return;
	}

	// The system's Features tab nests EVERY grouped feature under the class card
	// (it never checks that the group belongs to the class), so our
	// `group: "feats"` items would show up as class features too. Hide them
	// there — feats render in their own section below. This must run before the
	// signature early-return: Svelte recreates the cards on every re-render, so
	// they come back unhidden even when the feats signature is unchanged.
	const featIds = new Set(ownedFeats(actor).map((f) => f.id));
	for (const card of body.querySelectorAll(
		'.nimble-item-list--sublist .nimble-feature-card[data-item-id]',
	)) {
		if (featIds.has(card.dataset.itemId) && card.style.display !== 'none') {
			card.style.display = 'none';
		}
	}

	const current = body.querySelector(':scope > .nim-plus-feats-section');
	const sig = featsSignature(actor);
	if (current && current.dataset.sig === sig) return; // already up to date
	current?.remove();

	ensureFeatStyles();
	const wrapper = document.createElement('div');
	wrapper.innerHTML = renderFeatsSection(actor).trim();
	const section = wrapper.firstElementChild;
	if (!section) return;
	body.appendChild(section);
	wireFeatsSection(section, actor);
}

export function resyncFeatsForActor(actor) {
	for (const app of Object.values(actor.apps ?? {})) {
		try {
			syncFeatsTabSection(app);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to sync Feats section`, error);
		}
	}
}

// Watch the sheet for tab switches / reactive updates (which don't fire a
// Foundry render hook) and keep the Feats section in the Features tab in sync.
export function setupFeatsTabObserver(app) {
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;
	try {
		app.__nimPlusFeatsObserver?.disconnect();
	} catch (_error) {
		/* previous observer already gone */
	}
	const observer = new MutationObserver(() => {
		syncFeatsTabSection(app);
		syncWeaponEquipToggles(app);
	});
	observer.observe(root, { childList: true, subtree: true });
	app.__nimPlusFeatsObserver = observer;
	syncFeatsTabSection(app);
	syncWeaponEquipToggles(app);
}

// The sheet hooks that drive this live in `./sheet-hooks.mjs`, so that
// importing `resyncFeatsForActor` never drags a hook registration along with it.
