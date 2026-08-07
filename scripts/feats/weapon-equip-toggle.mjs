import { MODULE_ID } from '../core/constants.mjs';

// ── Weapon equip toggle ──────────────────────────────────────────────────────
//
// Nimble's inventory only draws an equip control for objects that carry
// `system.rules` (armor/shields get the shield icon; rules-bearing objects get a
// hand icon — PlayerCharacterInventoryTab.svelte). A plain weapon has no rules,
// so it falls through to the quantity input with NO equip control at all — there's
// no way to see or set `system.equipped`, which is exactly what the Dual Wielder /
// Defensive Duelist feats read. We inject a hand-icon toggle into those weapon
// cards so the equipped state is visible and settable, mirroring the system's own
// non-armor equip glyph (solid hand = equipped, outline = not).

function weaponEquipIcon(equipped) {
	return equipped ? '<i class="fa-solid fa-hand"></i>' : '<i class="fa-regular fa-hand"></i>';
}

// Idempotent button-state writer. Guards on a `data-equipped` marker so repeated
// calls from the MutationObserver don't mutate the DOM (and so never re-trigger
// the observer into a loop) unless the equipped state actually changed.
function updateWeaponEquipButton(btn, equipped) {
	const want = equipped ? '1' : '0';
	if (btn.dataset.equipped === want) return;
	btn.dataset.equipped = want;
	btn.innerHTML = weaponEquipIcon(equipped);
	btn.setAttribute(
		'data-tooltip',
		equipped ? 'Equipped — click to unequip' : 'Unequipped — click to equip',
	);
	btn.setAttribute('aria-pressed', equipped ? 'true' : 'false');
}

function buildWeaponEquipButton(actor, item, equipped) {
	const btn = document.createElement('button');
	btn.className = 'nimble-button nim-plus-weapon-equip';
	btn.type = 'button';
	btn.setAttribute('data-button-variant', 'icon');
	// The inventory card is a CSS grid with named areas; an item without an
	// explicit placement falls to auto-placement in an implicit extra row (the
	// button ends up floating below the item image). Anchor it to the charges
	// cell — guaranteed empty here, since charge pools are rules and this button
	// is only injected on rules-less weapons.
	btn.style.gridArea = 'charges';
	btn.style.justifySelf = 'end';
	btn.setAttribute('aria-label', `Toggle equipped: ${item.name}`);
	updateWeaponEquipButton(btn, equipped);
	btn.addEventListener('click', async (event) => {
		event.preventDefault();
		event.stopPropagation(); // don't let the card's activate-on-click fire
		const current = actor.items?.get?.(item.id)?.system?.equipped === true;
		try {
			await actor.updateItem(item.id, { 'system.equipped': !current });
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to toggle weapon equipped state`, error);
		}
	});
	return btn;
}

/**
 * Inject / refresh a weapon equip toggle on the Inventory tab. Inventory cards
 * carry `.nimble-document-card--actor-inventory` and only mount on that tab, so an
 * empty result is a no-op on every other tab. We only touch weapon cards that show
 * the native quantity input (i.e. rules-less weapons with no equip control); cards
 * where the system already renders its own equip toggle are left untouched.
 */
export function syncWeaponEquipToggles(app) {
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;

	const cards = root.querySelectorAll('.nimble-document-card--actor-inventory[data-item-id]');
	for (const card of cards) {
		const header = card.querySelector(':scope > header');
		if (!header) continue;
		const existing = header.querySelector(':scope > .nim-plus-weapon-equip');

		const item = actor.items?.get?.(card.dataset.itemId);
		const isWeapon =
			item?.type === 'object' && item.system?.objectType === 'weapon';
		// Only weapons that lack a native equip control (shown by the quantity input).
		const quantityInput = header.querySelector(':scope > .nimble-document-card__quantity');

		if (!isWeapon || !quantityInput) {
			existing?.remove();
			continue;
		}

		const equipped = item.system?.equipped === true;
		if (existing) {
			updateWeaponEquipButton(existing, equipped);
			continue;
		}
		header.insertBefore(buildWeaponEquipButton(actor, item, equipped), quantityInput);
	}
}
