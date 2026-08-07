import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { SUPERSEDED_CORE_FEATURES } from './superseded-list.mjs';

/* ── Commander — foregoing a whole feature group ─────────────────────────────
 *
 * Champion of the Arena's *Single-Minded Fighter* reads "You forego all
 * Commander's Orders. Whenever you would choose one, you gain +1 max Combat Die
 * instead." The second half is a ladder of `modifyPool` rules on the feature —
 * two dice for the pair chosen at level 2, one more at each of 6, 8, 10, 12 and
 * 16. The first half has to stop the choice from being offered at all.
 *
 * The level-up window cannot be told this from data: it requires one pick per
 * selection group before it will submit, and that check reads Svelte state
 * nothing outside the component can reach. So it is handled from both ends —
 * the group is taken out of the window, and the item is refused at creation.
 * The refusal is the half that actually matters: it holds for every route an
 * Order could arrive by, including a drag onto the sheet, so the DOM half is
 * only there to stop the window offering a choice that would be thrown away.
 *
 * Driven by a `foregoesFeatureGroup` module flag naming the group, so this is
 * not specific to Orders or to this subclass.
 */

/** Take the superseded core cards out of the group they were published in. */
function hideSupersededLevelUpCards(root) {
	for (const superseded of SUPERSEDED_CORE_FEATURES) {
		const wantedGroup = superseded.group.replace(/[^a-z0-9]/gi, '').toLowerCase();
		const wantedName = superseded.name.trim().toLowerCase();

		for (const section of root.querySelectorAll('.feature-group')) {
			const heading = section.querySelector('h4')?.textContent ?? '';
			if (heading.replace(/[^a-z0-9]/gi, '').toLowerCase() !== wantedGroup) continue;

			for (const card of section.querySelectorAll('.feature-item')) {
				const name = card.querySelector('.feature-row__name')?.textContent?.trim().toLowerCase();
				if (name !== wantedName) continue;
				card.style.display = 'none';
			}
		}
	}
}

/** The feature groups this character has given up, from their own features. */
function foregoneFeatureGroups(actor) {
	const groups = new Set();
	for (const item of actor?.items ?? []) {
		const group = item.getFlag?.(MODULE_ID, 'foregoesFeatureGroup');
		if (typeof group === 'string' && group.length > 0) groups.add(group);
	}
	return groups;
}

Hooks.on('preCreateItem', (item, source) => {
	try {
		if (!classQoLEnabled()) return true;
		const actor = item?.parent;
		if (!(actor instanceof Actor)) return true;
		if (source?.type !== 'feature') return true;

		const group = String(source?.system?.group ?? '');
		if (group.length < 1) return true;
		if (!foregoneFeatureGroups(actor).has(group)) return true;

		ui.notifications?.info(
			`${actor.name} has foregone ${group.replace(/-/g, ' ')} — ${source.name} was not added.`,
		);
		return false;
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to check a foregone feature group`, error);
		return true;
	}
});

/**
 * Take a foregone group out of the level-up window.
 *
 * The window refuses to submit until each selection group has its picks, so the
 * group cannot simply be hidden — a pick is made on the player's behalf first,
 * purely to satisfy that check, and the `preCreateItem` guard above discards
 * whatever was picked. Selecting through the card's own button rather than by
 * writing state keeps this on the component's supported path.
 */
function stripForegoneLevelUpGroups(app) {
	if (!classQoLEnabled()) return;

	const actor = app?.data?.document;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	const groups = foregoneFeatureGroups(actor);
	if (groups.size < 1) return;

	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;

	const wanted = new Set([...groups].map((group) => group.replace(/[^a-z0-9]/gi, '').toLowerCase()));

	for (const section of root.querySelectorAll('.feature-group')) {
		const heading = section.querySelector('h4')?.textContent ?? '';
		if (!wanted.has(heading.replace(/[^a-z0-9]/gi, '').toLowerCase())) continue;
		if (section.dataset.nimPlusForegone) continue;
		section.dataset.nimPlusForegone = 'true';

		// Satisfy the window's completion check. Clicking every card once is safe
		// and needs no reading of the group's state: a click adds that feature,
		// and once the group is at its cap the rest are ignored outright. A group
		// with no buttons is one the window grants outright — nothing to satisfy.
		for (const button of section.querySelectorAll('.feature-row__actions button')) {
			button.click();
		}

		section.style.display = 'none';
	}
}

Hooks.on('renderGenericDialog', (app) => {
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;

	// The class-feature groups are fetched from the packs after the window opens,
	// so there is nothing to strip on this frame — and the window re-renders as
	// selections change. An observer covers both; the per-section marker inside
	// makes every pass after the first a no-op.
	const run = () => {
		try {
			hideSupersededLevelUpCards(root);
			stripForegoneLevelUpGroups(app);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to adjust the level-up window's feature groups`, error);
		}
	};

	run();
	try {
		app.__nimPlusForegoneObserver?.disconnect();
	} catch (_error) {
		/* no previous observer */
	}
	const observer = new MutationObserver(run);
	observer.observe(root, { childList: true, subtree: true });
	app.__nimPlusForegoneObserver = observer;
});

Hooks.on('closeGenericDialog', (app) => {
	try {
		app.__nimPlusForegoneObserver?.disconnect();
	} catch (_error) {
		/* nothing to disconnect */
	}
});

/**
 * When the feature that foregoes a group is gained, the members already on the
 * sheet are the ones its text gives up ("you forego **all** Commander's
 * Orders"), and the extra Combat Dice are the compensation for exactly those.
 * Offered rather than done: deleting a player's features silently is not this
 * module's call, and a table may well have ruled otherwise.
 */
Hooks.on('createItem', (item) => {
	try {
		if (!classQoLEnabled()) return;
		const group = item?.getFlag?.(MODULE_ID, 'foregoesFeatureGroup');
		if (typeof group !== 'string' || group.length < 1) return;

		const actor = item.parent;
		if (!(actor instanceof Actor) || !actor.isOwner) return;

		const owned = actor.items.filter(
			(entry) => entry.type === 'feature' && entry.system?.group === group,
		);
		if (owned.length < 1) return;

		const names = owned.map((entry) => entry.name).join(', ');
		foundry.applications.api.DialogV2.confirm({
			window: { title: item.name },
			content:
				`<p><strong>${escape(item.name)}</strong> foregoes all ${escape(group.replace(/-/g, ' '))}, and its extra Combat Dice are the compensation for them.</p>` +
				`<p>Remove the ${owned.length} already on the sheet?</p><p><em>${escape(names)}</em></p>`,
			yes: { label: 'Remove them' },
			no: { label: 'Keep them' },
			modal: false,
			rejectClose: false,
		})
			.then((confirmed) => {
				if (!confirmed) return null;
				return actor.deleteEmbeddedDocuments(
					'Item',
					owned.map((entry) => entry.id),
				);
			})
			.catch((error) => console.error(`[${MODULE_ID}] Failed to remove foregone features`, error));
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to offer removal of foregone features`, error);
	}
});
