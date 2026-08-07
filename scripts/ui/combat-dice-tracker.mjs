import { MODULE_ID } from '../core/constants.mjs';
import { sysId, sysHook } from '../core/system.mjs';
import { classQoLEnabled } from '../classes/shared/settings.mjs';
import { COMBAT_TACTIC_FIELD_CLASS, findCombatDicePool } from '../classes/commander/combat-dice.mjs';
import { ensureCombatTacticStyles } from '../classes/commander/tactic-styles.mjs';
import { encounterActive, ENCOUNTER_EDGE_HOOKS } from './encounter.mjs';

/**
 * Take the Combat Dice group off the sheet's tracker rail while there is no
 * encounter.
 *
 * The system rails every roll-on-spend charge pool as one pip per die, and shows
 * the rail whenever the pool has capacity — right for a resource you carry
 * around, wrong for one that only exists inside a fight. Out of combat a
 * Commander has no Combat Dice at all, and a row of permanently spent pips is a
 * reminder of a resource you cannot have. Inside a fight it stays visible even at
 * zero, because "none left" is worth knowing.
 *
 * The group is matched by the pool's own label appearing in the badge tooltip and
 * toggled rather than hidden once, because the tracker is Svelte-rendered and
 * reuses its nodes across state changes.
 */
function syncCombatDiceTrackerVisibility(root, actor) {
	const pool = findCombatDicePool(actor);
	if (!pool) return;

	const label = pool.label.trim().toLowerCase();
	if (label.length < 1) return;

	ensureCombatTacticStyles();
	const hidden = `${COMBAT_TACTIC_FIELD_CLASS}__hidden`;
	const hide = classQoLEnabled() && !encounterActive();

	const tracker = root.querySelector('.dice-pool-tracker');
	if (!tracker) return;

	for (const group of tracker.querySelectorAll('.dice-pool-tracker__group')) {
		const tooltip = String(
			group.querySelector('[data-tooltip]')?.getAttribute('data-tooltip') ?? '',
		).toLowerCase();
		if (!tooltip.includes(label)) continue;
		group.classList.toggle(hidden, hide);
	}

	// An all-hidden rail would otherwise leave an empty bordered box behind.
	const anyVisible = Array.from(tracker.querySelectorAll('.dice-pool-tracker__group')).some(
		(group) => !group.classList.contains(hidden),
	);
	tracker.classList.toggle(hidden, !anyVisible);
}

/** Re-apply the above on every open character sheet. */
function refreshCombatDiceTrackers(actorId = null) {
	const apps = foundry.applications?.instances?.values?.() ?? [];
	for (const app of apps) {
		const actor = app?.document ?? app?.actor;
		if (!(actor instanceof Actor) || actor.type !== 'character') continue;
		if (actorId && actor.id !== actorId) continue;
		const root = app.element instanceof HTMLElement ? app.element : null;
		if (!root) continue;
		try {
			syncCombatDiceTrackerVisibility(root, actor);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to update the Combat Dice tracker`, error);
		}
	}
}

Hooks.on('renderPlayerCharacterSheet', (app, html) => {
	const root = html instanceof HTMLElement ? html : html?.[0];
	const actor = app?.document ?? app?.actor;
	if (!root || !(actor instanceof Actor)) return;
	try {
		syncCombatDiceTrackerVisibility(root, actor);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to update the Combat Dice tracker`, error);
	}
});

for (const hook of ['updateItem', 'updateActor']) {
	Hooks.on(hook, (document, changed) => {
		if (!changed?.flags?.[sysId()]?.chargePools) return;
		const actor = document instanceof Actor ? document : (document?.actor ?? null);
		if (actor?.type !== 'character') return;
		refreshCombatDiceTrackers(actor.id);
	});
}

// The rail's visibility follows the encounter, so every edge of one redraws it —
// including the combatants arriving and leaving, since a staged fight counts.
for (const hook of ENCOUNTER_EDGE_HOOKS) {
	Hooks.on(hook, () => refreshCombatDiceTrackers());
}

Hooks.once('setup', () => {
	for (const hook of ['chargePool.changed', 'chargePool.recovered']) {
		Hooks.on(sysHook(hook), () => refreshCombatDiceTrackers());
	}
});
