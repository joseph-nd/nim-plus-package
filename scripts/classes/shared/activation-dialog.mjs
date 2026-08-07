import { MODULE_ID } from '../../core/constants.mjs';
import { injectViciousCheckbox, setViciousArm } from '../cheat/vicious-opportunist.mjs';
import { COMBAT_TACTIC_FIELD_CLASS } from '../commander/combat-dice.mjs';
import { ensureCombatTacticStyles } from '../commander/tactic-styles.mjs';
import { injectCombatTacticPicker, setTacticArm } from '../commander/tactics.mjs';
import { classQoLEnabled } from './settings.mjs';

/**
 * Wrap the dialog's `submitActivation` once, so the controls this module injects
 * arm the next roll. Patched lazily off a live instance because the class is not
 * exported anywhere reachable from a module.
 */
export function ensureActivationDialogPatched(app) {
	const proto = app?.constructor?.prototype;
	if (!proto || proto.__nimPlusActivationDialogPatched) return;
	const originalSubmit = proto.submitActivation;
	if (typeof originalSubmit !== 'function') return;

	proto.submitActivation = function patchedSubmitActivation(results) {
		const root = this.element instanceof HTMLElement ? this.element : this.element?.[0];

		try {
			const checkbox = root?.querySelector?.('[data-nim-plus-vicious]');
			setViciousArm(
				checkbox?.checked && !checkbox.disabled
					? { actorId: this.actor?.id ?? null, itemId: this.item?.id ?? null }
					: null,
			);
		} catch (error) {
			setViciousArm(null);
			console.error(`[${MODULE_ID}] Failed to read the Vicious Opportunist checkbox`, error);
		}

		try {
			const select = root?.querySelector?.('[data-nim-plus-tactic]');
			const key = select && !select.disabled ? String(select.value ?? '') : '';
			setTacticArm(
				key
					? { actorId: this.actor?.id ?? null, itemId: this.item?.id ?? null, key }
					: null,
			);
		} catch (error) {
			setTacticArm(null);
			console.error(`[${MODULE_ID}] Failed to read the Combat Tactic picker`, error);
		}

		return originalSubmit.call(this, results);
	};
	proto.__nimPlusActivationDialogPatched = true;
}

Hooks.on('renderItemActivationConfigDialog', (app, element) => {
	const root = element instanceof HTMLElement ? element : element?.[0] ?? app?.element;
	if (!root) return;

	try {
		ensureActivationDialogPatched(app);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to patch the activation dialog`, error);
	}

	try {
		injectViciousCheckbox(app, root);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to render the Vicious Opportunist control`, error);
	}

	try {
		injectCombatTacticPicker(app, root);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to render the Combat Tactic picker`, error);
	}

	try {
		hideRollModeForDicelessActivation(app, root);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to tidy the activation dialog`, error);
	}
});

/**
 * True when this activation has damage or healing to state but no dice anywhere
 * in it — a card that reports a fixed number, or none at all.
 *
 * Deliberately conservative: an activation whose effects declare no formula at
 * all could still be rolling through some path we cannot see from here, so only
 * a positive "there are formulas, and not one of them has a die in it" counts.
 */
export function activationHasNoDice(item) {
	const effects = item?.system?.activation?.effects;
	if (!Array.isArray(effects) || effects.length < 1) return false;

	let sawFormula = false;
	const hasDie = /\d*d\d+/i;

	const visit = (nodes) => {
		for (const node of nodes ?? []) {
			if (typeof node?.formula === 'string' && node.formula.trim().length > 0) {
				sawFormula = true;
				if (hasDie.test(node.formula)) return true;
			}
			for (const branch of Object.values(node?.on ?? {})) {
				if (visit(branch)) return true;
			}
		}
		return false;
	};

	if (visit(effects)) return false;
	return sawFormula;
}

/**
 * Take the advantage/disadvantage slider off an activation that rolls nothing.
 *
 * Coordinated Strike! is the case in hand: a free action that grants you and an
 * ally an attack each. Those attacks are rolled on their own, with their own
 * dialogs and their own advantage — so a slider here reads as though it will
 * change them, and changes nothing at all.
 *
 * Only the slider goes. Situational Modifiers and the primary-die fields are
 * just as inert on a card like this, but they at least alter the number it
 * prints, and the slider is the one that looks like it means something.
 */
export function hideRollModeForDicelessActivation(app, root) {
	if (!classQoLEnabled()) return;
	if (!activationHasNoDice(app?.item)) return;

	ensureCombatTacticStyles();
	root
		.querySelector('.nimble-roll-mode-config')
		?.classList.add(`${COMBAT_TACTIC_FIELD_CLASS}__hidden`);
}

