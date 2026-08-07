import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { sysHook } from '../../core/system.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { findCombatDicePool, isCommandingPresence, spendCombatDie } from './combat-dice.mjs';

/**
 * Commanding Presence costs a Combat Die like every other Combat Tactic, but it
 * is an Action rather than an attack rider — there is no attack roll to hang a
 * picker on, and its die is never rolled at all, because the save DC is 10+STR
 * and the die's value is never read. So it is handled without a prompt: blocked
 * when the pool is empty, and one die spent on use.
 *
 * Driven off the system's own use hooks rather than another prototype patch, so
 * there is one less method wrapped.
 */
function blockCommandingPresenceWithoutDice(item) {
	if (!classQoLEnabled()) return true;
	if (!isCommandingPresence(item)) return true;

	const pool = findCombatDicePool(item.actor);
	// Not a Commander with the pool at all — leave the feature alone.
	if (!pool || pool.max < 1) return true;
	if (pool.current > 0) return true;

	ui.notifications?.warn(
		`${item.name} costs a Combat Die, and ${item.actor?.name ?? 'this character'} has none.`,
	);
	return false;
}

async function spendCommandingPresenceDie(item) {
	if (!classQoLEnabled()) return;
	if (!isCommandingPresence(item)) return;

	const actor = item.actor;
	const pool = findCombatDicePool(actor);
	if (!pool || pool.current < 1) return;

	const spent = await spendCombatDie(actor, pool);
	if (!spent) return;

	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content:
			`<p><em>Combat Die spent — ${
				spent.remaining > 0 ? `${spent.remaining} of ${pool.max} left` : 'none left'
			}.</em></p>`,
	});
}

// Registered at setup, not at load: `sysHook` needs `game.system` to exist.
Hooks.once('setup', () => {
	Hooks.on(sysHook('preUseItem'), (item) => {
		try {
			return blockCommandingPresenceWithoutDice(item);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to check Commanding Presence's cost`, error);
			return true;
		}
	});

	Hooks.on(sysHook('useItem'), (item) => {
		spendCommandingPresenceDie(item).catch((error) =>
			console.error(`[${MODULE_ID}] Failed to spend Commanding Presence's Combat Die`, error),
		);
	});
});
