import { escape } from '../../core/html.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { COMBAT_TACTIC_FIELD_CLASS, findCombatDicePool, isCommandingPresence } from './combat-dice.mjs';
import { ensureCombatTacticStyles, syncCombatDiceSpendRow } from './tactic-styles.mjs';


/**
 * The tactics that ride on an attack, in the order they are offered.
 *
 * `dieMultiplier` is how many times the rolled die is added to the damage —
 * Lunging Strike deals "2× a roll of your Combat Die", which is one die doubled,
 * not two dice; Sweeping Strike adds no damage at all and only needs a die to
 * have been spent. `requiresHit` marks the tactics whose text is conditional on
 * connecting, and those alone leave the die unspent on a miss. `delivery`
 * filters the picker to the weapons the tactic can be used with.
 */
export const COMBAT_TACTICS = [
	{
		key: 'heavy-strike',
		name: 'Heavy Strike',
		match: /heavy\s*strike/i,
		delivery: 'any',
		dieMultiplier: 1,
		requiresHit: true,
		short: 'push + a Combat Die of damage',
		rider:
			'Push a Medium creature <strong>STR spaces</strong> — a Small creature twice as far, a Large creature half as far (round down).',
	},
	{
		key: 'lunging-strike',
		name: 'Lunging Strike',
		match: /lunging\s*strike/i,
		delivery: 'melee',
		dieMultiplier: 2,
		requiresHit: false,
		short: '+1 Reach, twice a Combat Die of damage',
		rider: 'This attack was made with <strong>+1 Reach</strong>.',
	},
	{
		key: 'sweeping-strike',
		name: 'Sweeping Strike',
		match: /sweeping\s*strike/i,
		delivery: 'melee',
		dieMultiplier: 0,
		requiresHit: false,
		cannotMiss: true,
		short: 'area attack, cannot miss on a 1 (2 actions, no bonus damage)',
		rider:
			'Damage <strong>every target</strong> in a contiguous area within your weapon’s Reach. Costs <strong>2 actions</strong> — deduct the second one by hand.',
	},
];

/**
 * Not in the list above because it is not declarable: Inerrant Strike is the
 * answer to a miss, so it is offered after the dice land.
 */
export const INERRANT_STRIKE = {
	key: 'inerrant-strike',
	name: 'Inerrant Strike',
	match: /inerrant\s*strike/i,
	dieMultiplier: 1,
	rider: 'The attack was rerolled and the Primary Die raised by 1.',
};

/** Set when an activation dialog was submitted with a tactic chosen. */
export let tacticArm = null;

/** Outcome recorded by the roll patch, resolved once the activation lands. */
export let tacticOutcome = null;

export function setTacticArm(value) {
	tacticArm = value;
}

export function setTacticOutcome(value) {
	tacticOutcome = value;
}

/** True when this Commander has taken the given tactic. */
export function ownsCombatTactic(actor, tactic) {
	for (const item of actor?.items ?? []) {
		if (item.type !== 'feature') continue;
		if (tactic.match.test(String(item.system?.identifier ?? ''))) return true;
		if (tactic.match.test(String(item.name ?? ''))) return true;
	}
	return false;
}

/**
 * 'melee' / 'ranged' for a weapon that makes an attack, null for anything else.
 * Mirrors the system's own reading of `activation.targets.attackType`, with the
 * `range` property as the secondary marker it also honours.
 */
export function weaponAttackDelivery(item) {
	if (!item || item.type !== 'object') return null;
	if (item.system?.objectType !== 'weapon') return null;
	if (item.system?.activation?.targets?.attackType === 'range') return 'ranged';
	const properties = item.system?.properties?.selected;
	if (Array.isArray(properties) && properties.includes('range')) return 'ranged';
	return 'melee';
}

/** The declarable tactics this Commander can use with this weapon. */
export function availableCombatTactics(actor, item) {
	const delivery = weaponAttackDelivery(item);
	if (!delivery) return [];
	return COMBAT_TACTICS.filter(
		(tactic) =>
			(tactic.delivery === 'any' || tactic.delivery === delivery) &&
			ownsCombatTactic(actor, tactic),
	);
}

/**
 * Add the tactic picker to the activation dialog. Placement follows the same two
 * rules as the Vicious Opportunist checkbox: appended as the LAST child of the
 * dialog body, past every Svelte-managed node, and carrying the `svelte-*` hash
 * class borrowed off a native sibling so the dialog's component-scoped styles
 * reach it.
 */
export function injectCombatTacticPicker(app, root) {
	if (!classQoLEnabled()) return;

	const actor = app?.actor;
	const item = app?.item;
	if (!actor || actor.type !== 'character') return;

	root.querySelectorAll(`.${COMBAT_TACTIC_FIELD_CLASS}`).forEach((el) => el.remove());

	const pool = findCombatDicePool(actor);
	// A pool sized to a non-positive STR is not a resource to offer a choice over.
	if (!pool || pool.max < 1) return;

	ensureCombatTacticStyles();

	const sibling = root.querySelector('.nimble-roll-modifiers-container');
	const body = sibling?.parentElement ?? root.querySelector('.nimble-sheet__body');
	if (!body) return;

	const scopedClass =
		Array.from(sibling?.classList ?? []).find((name) => name.startsWith('svelte-')) ?? '';

	// Commanding Presence spends a die on its own, so its dialog must not also
	// offer the stepper — that would be two spends for one use. The cost is shown
	// in its place, since it is not otherwise visible anywhere in the dialog.
	if (isCommandingPresence(item)) {
		syncCombatDiceSpendRow(root, actor, pool, { dieMultiplier: 0 }, scopedClass);
		return;
	}

	const tactics = availableCombatTactics(actor, item);
	if (tactics.length === 0) {
		// Nothing here can spend a Combat Die — the dice are only ever spent as a
		// Combat Tactic on an attack, or by Commanding Presence above — so the
		// native stepper is offering a spend that has nowhere to go. Coordinated
		// Strike! is the obvious case: a free action that grants attacks rather
		// than making one.
		syncCombatDiceSpendRow(root, actor, pool, null, scopedClass);
		return;
	}

	const empty = pool.current < 1;
	const options = [
		'<option value="">— No tactic —</option>',
		...tactics.map(
			(tactic) =>
				`<option value="${tactic.key}">${escape(tactic.name)} — ${escape(tactic.short)}</option>`,
		),
	].join('');

	const container = document.createElement('div');
	container.className =
		`nimble-roll-modifiers-container ${COMBAT_TACTIC_FIELD_CLASS} ${scopedClass}`.trim();
	container.innerHTML = `
		<div class="nimble-roll-modifiers ${scopedClass}">
			<label class="${scopedClass}">
				Combat Tactic:
				<select
					class="${COMBAT_TACTIC_FIELD_CLASS}__select ${scopedClass}"
					data-nim-plus-tactic="1"
					${empty ? 'disabled' : ''}
				>${options}</select>
			</label>
			<p class="${COMBAT_TACTIC_FIELD_CLASS}__note ${COMBAT_TACTIC_FIELD_CLASS}__note--empty"></p>
		</div>
	`;

	const select = container.querySelector('select');
	const note = container.querySelector(`.${COMBAT_TACTIC_FIELD_CLASS}__note`);

	const idle = empty
		? 'No Combat Dice left — you gain STR of them when you roll Initiative.'
		: `${pool.current} of ${pool.max} Combat Dice (${pool.dieSize}) left. One tactic per attack.`;

	function describe() {
		const tactic = tactics.find((entry) => entry.key === select.value);
		// The Spend Pool Dice row above now carries what will be rolled, so the
		// note only has to say what the tactic does and what it costs.
		syncCombatDiceSpendRow(root, actor, pool, tactic, scopedClass);

		if (!tactic) {
			note.className =
				`${COMBAT_TACTIC_FIELD_CLASS}__note ${COMBAT_TACTIC_FIELD_CLASS}__note--empty ${scopedClass}`.trim();
			note.textContent = idle;
			return;
		}

		const damage = tactic.dieMultiplier > 0 ? "Rolled into this attack's damage. " : '';
		const cost = tactic.requiresHit
			? 'Spends a Combat Die on a hit; a miss costs nothing.'
			: 'Spends a Combat Die.';
		note.className = `${COMBAT_TACTIC_FIELD_CLASS}__note ${scopedClass}`.trim();
		note.innerHTML = `${damage}${tactic.rider} ${cost}`;
	}

	select.addEventListener('change', describe);
	describe();

	body.append(container);
}
