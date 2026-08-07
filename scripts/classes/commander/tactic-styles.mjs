import { escape } from '../../core/html.mjs';
import {
	COMBAT_TACTIC_FIELD_CLASS,
	COMBAT_TACTIC_STYLE_ID,
	combatDieLabel,
} from './combat-dice.mjs';

export function ensureCombatTacticStyles() {
	if (document.getElementById(COMBAT_TACTIC_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = COMBAT_TACTIC_STYLE_ID;
	style.textContent = `
		.${COMBAT_TACTIC_FIELD_CLASS}__select {
			flex: 1;
			min-width: 0;
			padding: 0.375rem 0.5rem;
			border: 1px solid var(--nimble-border-color, currentColor);
			border-radius: var(--nimble-border-radius, 4px);
		}
		.${COMBAT_TACTIC_FIELD_CLASS}__note {
			margin: 0.375rem 0 0;
			font-size: 0.8125rem;
			line-height: 1.35;
			opacity: 0.8;
		}
		.${COMBAT_TACTIC_FIELD_CLASS}__note--empty { opacity: 0.6; font-style: italic; }
		.${COMBAT_TACTIC_FIELD_CLASS}__hidden { display: none !important; }
	`;
	document.head.append(style);
}

/** Font Awesome's die icon for a die size, matching the system's own mapping. */
export function dieFaceIcon(dieSize) {
	const known = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'];
	return known.includes(String(dieSize)) ? `fa-dice-${dieSize}` : 'fa-dice-d6';
}

/**
 * Take over the dialog's **Spend Pool Dice** row for the Combat Dice pool.
 *
 * The system draws every roll-on-spend charge pool as a stepper that adds
 * `+Nd6[Combat Dice]` to the damage and decrements the pool. For Combat Dice
 * that control is wrong on its own terms: a Combat Die is only ever spent *as* a
 * Combat Tactic, so a stepper offering to spend two of them on an attack that
 * may take none is an invitation to break the rule the dice exist for. Wherever
 * the tactic picker renders, the stepper is replaced.
 *
 * What replaces it is the same row, read-only: the pool's own die icon and
 * label, then what the chosen tactic will actually roll, in place of the
 * stepper's count. The row appears only once a tactic is selected, so an attack
 * with no tactic shows no Combat Dice at all — and the section's heading and
 * border go with it if that was the only pool on offer.
 *
 * Every anchor is optional and every class name is the system's own, so if the
 * markup moves in a future version the worst case is that the native stepper
 * stays and no row of ours appears.
 */
export function syncCombatDiceSpendRow(root, actor, pool, tactic, scopedClass) {
	const section = root.querySelector('.nimble-pool-spend');
	if (!section) return;

	const hiddenClass = `${COMBAT_TACTIC_FIELD_CLASS}__hidden`;
	const wanted = pool.label.trim().toLowerCase();

	// The native row for this pool, always hidden — never toggled back, because
	// the picker is now the only way this pool is spent.
	let anchor = null;
	for (const row of section.querySelectorAll('.nimble-pool-spend__row')) {
		if (row.dataset.nimPlusTacticRow) continue;
		const label = row.querySelector('.nimble-pool-spend__label')?.textContent?.trim().toLowerCase();
		if (label !== wanted) continue;
		row.classList.add(hiddenClass);
		anchor = row;
	}

	section.querySelectorAll('[data-nim-plus-tactic-row]').forEach((row) => row.remove());

	if (tactic) {
		// `2 × 1d6` for Lunging Strike, `1d6` for the tactics that add one die, and
		// a plain count for Sweeping Strike, which spends a die without rolling it.
		const spend =
			tactic.dieMultiplier > 0 ? combatDieLabel(actor, pool, tactic.dieMultiplier) : '1 die';

		const row = document.createElement('div');
		row.className = `nimble-pool-spend__row ${COMBAT_TACTIC_FIELD_CLASS} ${scopedClass}`.trim();
		row.dataset.nimPlusTacticRow = '1';
		row.innerHTML = `
			<span class="nimble-pool-spend__label ${scopedClass}">
				<i class="fa-solid ${dieFaceIcon(pool.dieSize)} ${scopedClass}"></i>
				${escape(pool.label)}
			</span>
			<div class="nimble-pool-spend__stepper ${scopedClass}">
				<span class="nimble-pool-spend__stepper-value ${scopedClass}">
					<strong class="${scopedClass}">${escape(spend)}</strong>
					<span class="nimble-pool-spend__stepper-available ${scopedClass}">/ ${pool.current}</span>
				</span>
			</div>
		`;

		// Back where the stepper was, so the panel does not reshuffle as tactics
		// are tried on and off.
		if (anchor) anchor.after(row);
		else section.append(row);
	}

	// If Combat Dice were the only pool on offer, the leftover heading is noise.
	const stillVisible = Array.from(section.querySelectorAll('.nimble-pool-spend__row')).some(
		(row) => !row.classList.contains(hiddenClass),
	);
	const container = section.closest('.nimble-roll-modifiers-container') ?? section;
	container.classList.toggle(hiddenClass, !stillVisible);
}
