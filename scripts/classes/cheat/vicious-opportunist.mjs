import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { actorOwnsFeat } from '../../feats/mechanics/helpers.mjs';
import { currentActivation } from '../shared/activation.mjs';
import { currentTurnKey, isMeleeWeapon } from '../shared/combat.mjs';
import { upgradePrimaryDieToCrit } from '../shared/damage-roll-patch.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';

/* ── Cheat — Vicious Opportunist ─────────────────────────────────────────────
 *
 * "(1/turn) When you hit a Distracted target with a melee attack, you may change
 *  the Primary Die roll to whatever you like (changing it to the max value
 *  counts as a crit)."
 *
 * Optimal play is always "change it to max", so the only decision the player
 * actually makes is *whether the target is Distracted* — which is why the opt-in
 * is a checkbox on the activation dialog rather than a second prompt after the
 * roll. Once ticked:
 *
 *   primary die = 1        → the attack missed; VO needs a hit, so nothing is
 *                            spent and the miss stands.
 *   primary die = max      → already a crit; announced, nothing spent.
 *   anything in between    → the kept primary die is raised to max in place,
 *                            the crit explosion is rolled, and the 1/turn use
 *                            is marked spent.
 *
 * The upgrade mutates the *existing* roll rather than re-rolling it, so the
 * damage dice the player already saw are the damage dice that land, and only the
 * primary die changes — exactly what the feature says it does.
 */

const VICIOUS_IDENTIFIER = 'vicious-opportunist';
export const VICIOUS_USED_FLAG = 'cheat.viciousUsedAt';
const VICIOUS_FIELD_CLASS = 'nim-plus-vicious';

/**
 * Set while an activation dialog that offered the checkbox was submitted with it
 * ticked. Consumed by the first eligible DamageRoll of that activation.
 */
export let viciousArm = null;

export function setViciousArm(value) {
	viciousArm = value;
}

/** Outcome recorded by the roll patch, announced once the activation resolves. */
export let viciousOutcome = null;

export function setViciousOutcome(value) {
	viciousOutcome = value;
}

function viciousUseAvailable(actor) {
	if (!actor) return false;
	const turnKey = currentTurnKey();
	// Outside combat there is no turn structure to meter against, so the feature
	// is always offered and adjudicated at the table.
	if (turnKey === null) return true;
	return actor.getFlag?.(MODULE_ID, VICIOUS_USED_FLAG) !== turnKey;
}

export async function markViciousUsed(actor) {
	const turnKey = currentTurnKey();
	// Out of combat, store a value that can never equal a real turn key so the
	// next attack is offered again.
	await actor.setFlag(MODULE_ID, VICIOUS_USED_FLAG, turnKey ?? `untracked:${foundry.utils.randomID()}`);
}

export function viciousEligible(actor, item) {
	if (!classQoLEnabled()) return false;
	if (!actor || actor.type !== 'character') return false;
	if (!actorOwnsFeat(actor, VICIOUS_IDENTIFIER)) return false;
	return isMeleeWeapon(item);
}

/**
 * Add the opt-in checkbox to the system's activation dialog. The dialog is a
 * Svelte-rendered ApplicationV2, so its internals are off-limits, but Foundry
 * still fires `render<ClassName>` with the root element and the app exposes the
 * `actor`/`item` it was opened for.
 *
 * Two placement rules keep this stable across re-renders and system updates:
 * the control is appended as the LAST child of the dialog body (past every
 * Svelte-managed node, so Svelte's anchor-based updates can never shuffle it),
 * and it borrows the `svelte-*` hash class off a native sibling — the dialog's
 * `.nimble-roll-modifiers*` rules are component-scoped and would otherwise not
 * apply to markup we injected. If either anchor disappears the checkbox simply
 * never renders and the weapon rolls exactly as it does today.
 */
export function injectViciousCheckbox(app, root) {
	const actor = app?.actor;
	const item = app?.item;
	if (!viciousEligible(actor, item)) return;

	root.querySelectorAll(`.${VICIOUS_FIELD_CLASS}`).forEach((el) => el.remove());

	const sibling = root.querySelector('.nimble-roll-modifiers-container');
	const body = sibling?.parentElement ?? root.querySelector('.nimble-sheet__body');
	if (!body) return;

	const scopedClass =
		Array.from(sibling?.classList ?? []).find((name) => name.startsWith('svelte-')) ?? '';

	const available = viciousUseAvailable(actor);
	const tooltip = available
		? 'Target is Distracted — if this attack hits without critting, the Primary Die is raised to its max value (a crit). Spends the 1/turn use; a natural crit or a miss spends nothing.'
		: 'Vicious Opportunist has already been used this turn.';

	// Mirrors the dialog's own "Hide From Players?" row exactly: a bare label
	// directly inside the container, label text first, checkbox last. The inner
	// `.nimble-roll-modifiers` wrapper is deliberately absent — its `label input`
	// rule sets `flex: 1` plus padding and a border, which is right for the text
	// inputs it was written for and stretches a checkbox into a wide empty box.
	const container = document.createElement('div');
	container.className =
		`nimble-roll-modifiers-container ${VICIOUS_FIELD_CLASS} ${scopedClass}`.trim();
	container.innerHTML = `
		<label class="${scopedClass}" data-tooltip="${escape(tooltip)}">
			Vicious Opportunist?${available ? '' : ' <em>(used this turn)</em>'}
			<input
				type="checkbox"
				class="modifier-item__checkbox ${scopedClass}"
				data-nim-plus-vicious="1"
				${available ? '' : 'disabled'}
			/>
		</label>
	`;
	body.append(container);
}

export async function applyViciousOpportunist(roll) {
	if (!viciousArm) return;

	const activation = currentActivation();
	if (!activation?.vicious) return;
	if (viciousArm.itemId && activation.item?.id && viciousArm.itemId !== activation.item.id) return;

	// One activation gets at most one upgrade attempt, whatever happens next.
	viciousArm = null;

	if (roll.isMiss) {
		viciousOutcome = { kind: 'miss' };
		return;
	}
	if (roll.isCritical) {
		viciousOutcome = { kind: 'natural-crit' };
		return;
	}

	const change = await upgradePrimaryDieToCrit(roll);
	viciousOutcome = change ? { kind: 'upgraded', ...change } : { kind: 'unavailable' };
}

export function announceViciousOutcome(actor, item, outcome) {
	if (!outcome) return;
	const speaker = ChatMessage.getSpeaker({ actor });
	const name = escape(item?.name ?? 'the attack');

	if (outcome.kind === 'natural-crit') {
		ChatMessage.create({
			speaker,
			flavor: '<strong>Vicious Opportunist</strong>',
			content: `<p>${name} <strong>crit on its own</strong> — Vicious Opportunist was not needed, and the use is still available this turn.</p>`,
		});
		return;
	}

	if (outcome.kind === 'miss') {
		ChatMessage.create({
			speaker,
			flavor: '<strong>Vicious Opportunist</strong>',
			content: `<p>${name} <strong>missed</strong>. Vicious Opportunist only triggers on a hit, so the use is still available this turn.</p>`,
		});
		return;
	}

	// The roll had no Primary Die to raise — an area attack, or an attack made
	// without proficiency, both of which the system flags as unable to crit.
	if (outcome.kind === 'unavailable') {
		ChatMessage.create({
			speaker,
			flavor: '<strong>Vicious Opportunist</strong>',
			content: `<p>${name} cannot crit, so Vicious Opportunist had nothing to change. The use is still available this turn.</p>`,
		});
		return;
	}

	ChatMessage.create({
		speaker,
		flavor: '<strong>Vicious Opportunist</strong>',
		content: `<p>Primary Die changed from <strong>${outcome.from}</strong> to <strong>${outcome.to}</strong> — <strong>critical hit!</strong></p><p><em>Used for this turn.</em></p>`,
	});
}

