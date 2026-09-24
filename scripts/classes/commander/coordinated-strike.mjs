import { hasActiveRule, addSyntheticRule } from '../../core/rules.mjs';

/* ── Commander — Coordinated Strike! ─────────────────────────────────────────
 *
 * "(1/round) Free action: you and an ally within 6 spaces both immediately make
 *  a weapon attack or cast a cantrip for free. You can do this INT times/Safe
 *  Rest."
 *
 * That last sentence lives only in the prose — the shipped feature carries no
 * rule, so the count is the player's to remember. The charge subsystem models
 * this shape exactly, so supplying the pair of rules it expects is the whole
 * job: the sheet draws the counter on the feature card, activating the order
 * spends a charge, the order is blocked at zero, and a Safe Rest refills it.
 *
 * Nimble 0.2 makes it a level 1 feature of its own, 1/encounter, with the INT
 * Safe Rest pool arriving at level 5 through Master Commander. The module's 0.2
 * copy declares all of that as native pools, so the fallback below never fires
 * for it.
 */

export const COORDINATED_STRIKE_IDENTIFIER = 'coordinated-strike';

export function ensureCoordinatedStrikeCounter(item) {
	if (item?.system?.identifier !== COORDINATED_STRIKE_IDENTIFIER) return;
	// Any charge pool at all means this is already metered — by a future system
	// update, or by a homebrew edit that deserves to win over ours.
	if (hasActiveRule(item, (rule) => rule.type === 'chargePool')) return;

	addSyntheticRule(item, {
		id: 'nimPlusCoordStrikePool',
		type: 'chargePool',
		identifier: COORDINATED_STRIKE_IDENTIFIER,
		label: 'Coordinated Strike!',
		scope: 'item',
		max: '@intelligence',
		dieSize: null,
		initial: 'max',
		recoveries: [{ trigger: 'safeRest', mode: 'refresh', value: '1' }],
	});

	addSyntheticRule(item, {
		id: 'nimPlusCoordStrikeUse',
		type: 'chargeConsumer',
		label: 'Coordinated Strike!',
		poolIdentifier: COORDINATED_STRIKE_IDENTIFIER,
		poolScope: 'item',
		cost: '1',
	});
}
