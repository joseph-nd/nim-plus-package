import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { actorAbilityMod, equipmentFlag, equippedWithEquipment, findPrimaryDamageRoll } from './helpers.mjs';

// ── Parry note (nimble.useItem) ──────────────────────────────────────────────
//
// Nimble attacks have no separate to-hit roll: the primary damage die decides
// miss (natural 1) / crit (max face). A Parry weapon widens the defender's miss
// window by one — a primary die of 2, which would normally connect, is turned
// aside. There is no roll to cancel, so this posts an advisory reminder; the GM
// applies the miss. A primary die of 1 already misses, so nothing is posted.
Hooks.on('nimble.useItem', (item, _chatCard, context) => {
	try {
		if (!item || item.type !== 'object' || item.system?.objectType !== 'weapon') return;
		if (!context) return;
		const targets = Array.from(context.targets ?? []);
		if (targets.length === 0) return;

		const primary = findPrimaryDamageRoll(context.rolls);
		const dieValue = Number(primary?.primaryDieValue);
		if (!Number.isFinite(dieValue) || dieValue !== 2) return; // 1 already misses; >2 hits

		for (const token of targets) {
			const targetActor = token?.actor;
			if (!targetActor) continue;
			const parry = equippedWithEquipment(targetActor, (flag) => flag.parry === true);
			if (parry.length === 0) continue;
			ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ actor: targetActor }),
				flavor: `<strong>${escape(parry[0].name)}</strong> — Parry`,
				content: `<p>Parry — <strong>${escape(targetActor.name)}</strong> deflects the attack (primary die 2): the attack misses.</p>`,
			}).catch(() => {});
		}
	} catch (error) {
		console.error(`[${MODULE_ID}] Parry note failed`, error);
	}
});

// ── Requirement warnings (updateItem: equipped false→true) ────────────────────
//
// When gear that carries an ability requirement is equipped, warn (non-blocking)
// if the wearer's matching ability modifier falls short. Foundry's update diff
// only carries `system.equipped` when it actually changed, so `=== true` in the
// diff means a false→true transition. Gated by userId to fire once.
Hooks.on('updateItem', (item, changes, _options, userId) => {
	try {
		if (userId !== game.user?.id) return;
		if (foundry.utils.getProperty(changes, 'system.equipped') !== true) return;
		if (item?.type !== 'object') return;
		const actor = item.actor;
		if (!actor || actor.type !== 'character') return;

		const flag = equipmentFlag(item) ?? {};
		const checks = [
			['strength', Number(item.system?.properties?.strengthRequirement?.value), 'Strength'],
			['strength', Number(flag.oneHandedStrRequirement), 'Strength (one-handed)'],
			['dexterity', Number(flag.dexRequirement), 'Dexterity'],
			['intelligence', Number(flag.intRequirement), 'Intelligence'],
		];

		for (const [ability, required, label] of checks) {
			if (!Number.isFinite(required) || required <= 0) continue;
			const mod = actorAbilityMod(actor, ability);
			if (mod < required) {
				ui.notifications?.warn(
					`${actor.name} equips ${item.name} but has ${label} ${mod} (requires ${required}).`,
				);
			}
		}
	} catch (error) {
		console.error(`[${MODULE_ID}] Equipment requirement check failed`, error);
	}
});

