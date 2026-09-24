import { escape } from './html.mjs';
import { confirmDialog } from './dialog.mjs';

/**
 * Asking before an item is used from a one-click surface of ours (the tracker
 * rail's use counters, the Feats section's chat button).
 *
 * Using an item goes through `actor.activateItem`, the sheet's own path, which
 * already charges the action / reaction and runs any `chargeConsumer`. That is
 * right for a deliberate use and wrong for a stray click, so the surfaces that
 * trigger it from a small button confirm first. The label mirrors the system's
 * `formatActivationCostLabel` (src/utils/formatActivationCostLabel.ts), which is
 * not exported to modules.
 */

const QUANTIFIED = {
	action: ['Action', 'Actions'],
	minute: ['Minute', 'Minutes'],
	hour: ['Hour', 'Hours'],
};

function normalizeQuantity(quantity) {
	const n = Number(quantity);
	return Number.isFinite(n) && n > 0 ? n : 1;
}

/** Whether the item is used as a reaction (current `isReaction` shape, or the legacy `type: 'reaction'`). */
export function isReactionItem(item) {
	const cost = item?.system?.activation?.cost;
	if (cost?.type === 'reaction') return true;
	return cost?.isReaction === true && cost?.type === 'action';
}

/**
 * The item's activation cost as the system labels it — "Reaction",
 * "Free Reaction", "Reaction (2 Actions)", "1 Action", "2 Actions", "Free",
 * "10 Minutes" — or `null` for costs that carry none (`none`, `special`).
 */
export function activationLabel(item) {
	const cost = item?.system?.activation?.cost;
	if (!cost) return null;

	if (isReactionItem(item)) {
		if (cost.quantity === 0) return 'Free Reaction';
		const actions = normalizeQuantity(cost.quantity);
		return actions === 1 ? 'Reaction' : `Reaction (${actions} Actions)`;
	}

	const units = QUANTIFIED[cost.type];
	if (!units) return null;
	if (cost.type === 'action' && cost.quantity === 0) return 'Free';
	const quantity = normalizeQuantity(cost.quantity);
	return `${quantity} ${quantity > 1 ? units[1] : units[0]}`;
}

/**
 * "Use <Item> (<cost>)?" — `true` only on Yes; No and closing the window both
 * leave everything untouched.
 */
export async function confirmItemUse(item, { name } = {}) {
	const label = String(name ?? item?.name ?? 'this feature');
	const cost = activationLabel(item);
	const question = cost
		? `Use <strong>${escape(label)}</strong> (${escape(cost)})?`
		: `Use <strong>${escape(label)}</strong>?`;
	const confirmed = await confirmDialog({
		window: { title: `Use ${label}` },
		content: `<p>${question}</p>`,
		yes: { label: 'Use', icon: 'fa-solid fa-check' },
		no: { label: 'Cancel', icon: 'fa-solid fa-xmark' },
	});
	return confirmed === true;
}
