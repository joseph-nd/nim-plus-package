import { MODULE_ID } from '../core/constants.mjs';

/**
 * Mirror Nimble core's class-features compendium decorator: render the
 * `gainedAtLevels` of each entry as a small right-aligned badge and sort the
 * list by level. We reuse the system's existing CSS classes
 * (`nimble-compendium-entry-with-level`, `nimble-class-feature-name-flex`,
 * `nimble-compendium-entry-level`) so styling matches the core pack with no
 * extra stylesheet shipped by this module.
 */
const NIMPLUS_CLASS_FEATURES_PACK = `${MODULE_ID}.nim-plus-class-features`;
const NIMPLUS_SPELLS_PACK = `${MODULE_ID}.nim-plus-spells`;
const ENTRY_WITH_LEVEL_CLASS = 'nimble-compendium-entry-with-level';
const LEVEL_BADGE_CLASS = 'nimble-compendium-entry-level';
const LEVEL_NAME_FLEX_CLASS = 'nimble-class-feature-name-flex';

Hooks.on('renderCompendium', (application, element) => {
	const pack = application?.collection;
	if (!pack) return;

	const container = element instanceof HTMLElement ? element : element?.[0];
	if (!(container instanceof HTMLElement)) return;

	if (pack.collection === NIMPLUS_CLASS_FEATURES_PACK) {
		pack
			.getIndex({ fields: ['system.gainedAtLevel', 'system.gainedAtLevels'] })
			.then(() => {
				const entries = collectClassFeatureEntryData(pack, container);
				sortClassFeatureEntries(entries);
				applyClassFeatureLevelsToEntries(entries);
			})
			.catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply class feature level labels`, error);
			});
	} else if (pack.collection === NIMPLUS_SPELLS_PACK) {
		pack
			.getIndex({ fields: ['system.tier'] })
			.then(() => {
				applySpellTierBadges(pack, container);
			})
			.catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply spell tier badges`, error);
			});
	}
});

function applySpellTierBadges(pack, container) {
	for (const entryElement of container.querySelectorAll('[data-entry-id]')) {
		const entryId = entryElement.dataset.entryId;
		if (!entryId) continue;
		const indexEntry = pack.index.get(entryId);
		const tier = Number(foundry.utils.getProperty(indexEntry ?? {}, 'system.tier'));
		if (!Number.isFinite(tier)) continue;
		const nameElement =
			entryElement.querySelector('.entry-name') ?? entryElement.querySelector('a') ?? entryElement;
		nameElement.classList.add(LEVEL_NAME_FLEX_CLASS);
		nameElement.style.setProperty('display', 'flex', 'important');
		nameElement.style.setProperty('align-items', 'center', 'important');
		nameElement.style.setProperty('width', '100%', 'important');
		nameElement.style.setProperty('min-width', '0', 'important');

		let badge = nameElement.querySelector(`.${LEVEL_BADGE_CLASS}`);
		if (!badge) {
			badge = document.createElement('span');
			badge.classList.add(LEVEL_BADGE_CLASS);
			nameElement.append(badge);
		}
		badge.style.setProperty('margin-left', 'auto', 'important');
		badge.style.setProperty('margin-right', '6px', 'important');
		badge.style.setProperty('display', 'inline-block', 'important');
		badge.style.setProperty('white-space', 'nowrap', 'important');
		badge.textContent = tier === 0 ? 'C' : String(tier);
		entryElement.classList.add(ENTRY_WITH_LEVEL_CLASS);
	}
}

function toLevel(value) {
	if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}
	return null;
}

function toLevels(value) {
	const levels = new Set();
	const push = (candidate) => {
		const parsed = toLevel(candidate);
		if (parsed !== null) levels.add(parsed);
	};
	if (Array.isArray(value)) {
		for (const c of value) push(c);
	} else if (typeof value === 'string' && value.includes(',')) {
		for (const c of value.split(',')) push(c);
	} else if (typeof value === 'string') {
		const matches = value.match(/\d+/g);
		if (matches && matches.length > 1) for (const c of matches) push(c);
		else push(value);
	} else {
		push(value);
	}
	return [...levels].sort((a, b) => a - b);
}

function getFeatureLevels(indexEntry) {
	const safe = indexEntry ?? {};
	const multi = toLevels(foundry.utils.getProperty(safe, 'system.gainedAtLevels'));
	if (multi.length > 0) return multi;
	return toLevels(foundry.utils.getProperty(safe, 'system.gainedAtLevel'));
}

function collectClassFeatureEntryData(pack, element) {
	const entries = [];
	for (const entryElement of element.querySelectorAll('[data-entry-id]')) {
		const entryId = entryElement.dataset.entryId;
		if (!entryId || !entryElement.parentElement) continue;
		const nameElement =
			entryElement.querySelector('.entry-name') ?? entryElement.querySelector('a') ?? entryElement;
		const indexEntry = pack.index.get(entryId);
		const gainedAtLevels = getFeatureLevels(indexEntry);
		const title =
			(typeof indexEntry?.name === 'string' ? indexEntry.name : '') ||
			(nameElement.textContent?.trim() ?? '');
		entries.push({
			entryElement,
			gainedAtLevels,
			nameElement,
			parentElement: entryElement.parentElement,
			sortLevel: gainedAtLevels[0] ?? null,
			title,
		});
	}
	return entries;
}

function sortClassFeatureEntries(entries) {
	const grouped = new Map();
	for (const entry of entries) {
		const list = grouped.get(entry.parentElement) ?? [];
		list.push(entry);
		grouped.set(entry.parentElement, list);
	}
	for (const [parent, list] of grouped) {
		list.sort((a, b) => {
			const al = a.sortLevel ?? Number.MAX_SAFE_INTEGER;
			const bl = b.sortLevel ?? Number.MAX_SAFE_INTEGER;
			if (al !== bl) return al - bl;
			const aSingle = a.gainedAtLevels.length === 1;
			const bSingle = b.gainedAtLevels.length === 1;
			if (aSingle !== bSingle) return aSingle ? -1 : 1;
			return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
		});
		for (const entry of list) parent.append(entry.entryElement);
	}
}

function applyClassFeatureLevelsToEntries(entries) {
	for (const { entryElement, gainedAtLevels, nameElement } of entries) {
		if (gainedAtLevels.length < 1) {
			entryElement.classList.remove(ENTRY_WITH_LEVEL_CLASS);
			entryElement.querySelector(`.${LEVEL_NAME_FLEX_CLASS}`)?.classList.remove(LEVEL_NAME_FLEX_CLASS);
			entryElement.querySelector(`.${LEVEL_BADGE_CLASS}`)?.remove();
			continue;
		}
		nameElement.classList.add(LEVEL_NAME_FLEX_CLASS);
		nameElement.style.setProperty('display', 'flex', 'important');
		nameElement.style.setProperty('align-items', 'center', 'important');
		nameElement.style.setProperty('width', '100%', 'important');
		nameElement.style.setProperty('min-width', '0', 'important');

		let badge = nameElement.querySelector(`.${LEVEL_BADGE_CLASS}`);
		if (!badge) {
			badge = document.createElement('span');
			badge.classList.add(LEVEL_BADGE_CLASS);
			nameElement.append(badge);
		}
		badge.style.setProperty('margin-left', 'auto', 'important');
		badge.style.setProperty('margin-right', '6px', 'important');
		badge.style.setProperty('display', 'inline-block', 'important');
		badge.style.setProperty('white-space', 'nowrap', 'important');
		badge.textContent = gainedAtLevels.join(', ');
		entryElement.classList.add(ENTRY_WITH_LEVEL_CLASS);
	}
}

