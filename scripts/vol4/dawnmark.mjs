import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { getCharacterLevel } from '../feats/core.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Nim+ Volume IV — magic item runtime
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Automation for the Vol IV item pack (`pack-sources/items/vol4/`). Most items
 * carry static `system.rules` (armorClass, grantMovement, chargePool, …) that
 * the system applies while the item is equipped; the helpers below cover what
 * the rules engine can't express:
 *
 * - **Dawnmark** (Blazing Dawn set): a stackable mark tracked as an integer
 *   flag on the *target* actor. On-hit appliers (The Dawnstar, The Solar
 *   Flare) are wired through `nimble.useItem` so the weapons keep their
 *   native attack flow; trigger-based appliers (Cuirass on Defend, Gauntlets
 *   on Grapple, Amulet when a ward is attacked) are click-to-use macros since
 *   Defend/Grapple aren't hookable. Consumption rolls the stack-scaled die
 *   (1d4 → 1d6 → … → 1d20) as Radiant damage.
 * - **Dverung Runes**: `vol4ApplyRune` melds a rune into an owned item —
 *   appending a damage node / rule / description rider to the target's
 *   *source* data — enforcing the zine's rarity capacity, then consumes the
 *   rune.
 * - **Macro items**: dialogs and rolls for Bloodseeker, Battlemage Gloves,
 *   Cloak of the Fold, and friends. Items that pair a macro with a charge
 *   pool decrement the pool manually (the macro path bypasses the system's
 *   charge consumption, which fires on the regular activation flow only).
 * - **Derived-data riders**: Strength-o-Maxer (weapon STR requirements −1)
 *   and Spellslinger's Prism (+KEY damage on cantrips) mirror the feats'
 *   prepareDerivedData / spell-activate patch techniques.
 */

const DAWNMARK_FLAG = 'dawnmark';
const DAWNMARK_DICE = [4, 6, 8, 10, 12, 20];

export function vol4ItemFlag(item, key) {
	return item?.flags?.[MODULE_ID]?.[key] ?? item?.getFlag?.(MODULE_ID, key);
}

export function vol4OwnedWithFlag(actor, key, { equippedOnly = false } = {}) {
	return (
		actor?.items?.filter?.(
			(i) =>
				i.type === 'object' &&
				vol4ItemFlag(i, key) !== undefined &&
				(!equippedOnly || i.system?.equipped === true),
		) ?? []
	);
}

function dawnmarkStacks(actor) {
	return Number(actor?.getFlag?.(MODULE_ID, DAWNMARK_FLAG) ?? 0);
}

async function dawnmarkAddStack(targetActor, sourceActor, sourceItem) {
	const next = dawnmarkStacks(targetActor) + 1;
	await targetActor.setFlag(MODULE_ID, DAWNMARK_FLAG, next);
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor: sourceActor }),
		flavor: `<strong>${escape(sourceItem?.name ?? 'Dawnmark')}</strong>`,
		content: `<p><strong>${escape(targetActor.name)}</strong> is Dawnmarked (${next} stack${next === 1 ? '' : 's'}). On attack, consume all stacks for bonus Radiant damage (1d4 &gt; 1d6 &gt; &hellip; &gt; 1d20).</p>`,
	});
}

/**
 * Consume all Dawnmark stacks on the targeted actor: roll the stack-scaled
 * die as Radiant damage, apply it, and clear the mark. `splash` (from the
 * consuming item's flag) is surfaced on the card — adjacent / line splash
 * needs table adjudication, so it isn't auto-applied to other tokens.
 */
export async function vol4DawnmarkConsume(actor, item, targetActor = null) {
	const target = targetActor ?? Array.from(game.user?.targets ?? [])[0]?.actor;
	if (!target) {
		ui.notifications?.warn('Target a Dawnmarked creature first.');
		return null;
	}
	const stacks = dawnmarkStacks(target);
	if (stacks < 1) {
		ui.notifications?.warn(`${target.name} has no Dawnmark stacks.`);
		return null;
	}

	const die = DAWNMARK_DICE[Math.min(stacks, DAWNMARK_DICE.length) - 1];
	const roll = await new Roll(`1d${die}`).evaluate();
	await target.unsetFlag(MODULE_ID, DAWNMARK_FLAG);
	if (typeof target.applyDamage === 'function') await target.applyDamage(roll.total);

	const splash = item ? vol4ItemFlag(item, 'vol4DawnmarkSplash') : null;
	const splashText =
		splash === 'adjacent'
			? ' The bonus Radiant damage also hits enemies adjacent to the target.'
			: splash === 'line'
				? ' The bonus Radiant damage also hits enemies in Line 3 behind the target.'
				: '';

	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Dawnmark consumed</strong> — ${escape(target.name)} (${stacks} stack${stacks === 1 ? '' : 's'}, 1d${die} Radiant).${splashText}`,
	});
}

/**
 * Click-to-use Dawnmark applier for the set pieces whose triggers (Defend,
 * Interpose, Grapple, ward-attacked) have no system hook. Applies one stack
 * to the current target.
 */
export async function vol4DawnmarkApply(actor, item) {
	const target = Array.from(game.user?.targets ?? [])[0]?.actor;
	if (!target) {
		ui.notifications?.warn('Target the creature to Dawnmark first.');
		return null;
	}
	return dawnmarkAddStack(target, actor, item);
}

// On-hit Dawnmark (The Dawnstar / The Solar Flare) + radiant-spell Dawnmark
// (Focus of the New Dawn): both ride the native activation flow.
Hooks.on('nimble.useItem', (item, _chatCard, context) => {
	const actor = item?.actor;
	if (!actor || context?.isMiss) return;

	let marks = false;
	if (item.type === 'object' && vol4ItemFlag(item, 'vol4Dawnmark') === 'onHit') {
		marks = true;
	} else if (item.type === 'spell') {
		const school = item.system?.school;
		const tier = Number(item.system?.tier ?? 0);
		if (school === 'radiant' && tier >= 1) {
			marks = vol4OwnedWithFlag(actor, 'vol4Dawnmark', { equippedOnly: true }).some(
				(i) => vol4ItemFlag(i, 'vol4Dawnmark') === 'radiantSpells',
			);
		}
	}
	if (!marks) return;

	const targets = Array.from(context?.targets ?? []);
	const targetActor = targets[0]?.actor;
	if (!targetActor) return;

	// Book: consuming and applying can share the same attack — consume first
	// (if the wielder's weapon can consume and stacks exist), then mark.
	const canConsume = item.type === 'object' && dawnmarkStacks(targetActor) > 0;
	const run = async () => {
		if (canConsume) {
			const consume = await foundry.applications.api.DialogV2.confirm({
				window: { title: 'Dawnmark' },
				content: `<p>Consume <strong>${dawnmarkStacks(targetActor)}</strong> Dawnmark stack(s) on ${escape(targetActor.name)} for bonus Radiant damage?</p>`,
				rejectClose: false,
				modal: false,
			}).catch(() => false);
			if (consume) await vol4DawnmarkConsume(actor, item, targetActor);
		}
		await dawnmarkAddStack(targetActor, actor, item);
	};
	run().catch((error) => console.error(`[${MODULE_ID}] Dawnmark on-hit failed`, error));
});

// The Dwarf's Delight — Cheers! On crit, allies within Reach 4 gain LVL temp
// HP (advantage on their next attack stays a reminder on the card).
Hooks.on('nimble.useItem', (item, _chatCard, context) => {
	if (item?.type !== 'object' || vol4ItemFlag(item, 'vol4DwarfsDelight') !== true) return;
	if (!context?.isCritical) return;
	const actor = item.actor;
	const actorToken = actor?.getActiveTokens?.(true, true)?.[0];
	if (!actor || !actorToken) return;

	const level = getCharacterLevel(actor) || 1;
	const gridSize = canvas?.dimensions?.distance ?? 1;
	const allies = (canvas?.tokens?.placeables ?? []).filter((t) => {
		const other = t.document;
		if (!other?.actor || other.actorId === actorToken.actorId) return false;
		if (other.disposition !== actorToken.disposition) return false;
		const dx = Math.abs(other.x - actorToken.x) / (canvas.grid?.sizeX ?? canvas.grid?.size ?? 100);
		const dy = Math.abs(other.y - actorToken.y) / (canvas.grid?.sizeY ?? canvas.grid?.size ?? 100);
		return Math.max(dx, dy) * gridSize <= 4 * gridSize;
	});

	const run = async () => {
		for (const token of allies) {
			const ally = token.actor;
			const currentTemp = Number(ally.system?.attributes?.hp?.temp ?? 0);
			if (level > currentTemp) {
				await ally.update({ 'system.attributes.hp.temp': level });
			}
		}
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>${escape(item.name)} — Cheers!</strong>`,
			content: `<p>All allies within Reach 4 gain <strong>${level} temp HP</strong> and advantage on their next attack.${allies.length ? '' : ' <em>(No allied tokens found within Reach 4 — apply manually.)</em>'}</p>`,
		});
	};
	run().catch((error) => console.error(`[${MODULE_ID}] Dwarf's Delight crit failed`, error));
});

// Regal Rest — LVL temp HP on any rest while the bedroll is in inventory.
Hooks.on('nimble.rest', (payload) => {
	const actor = payload?.actor;
	if (!actor) return;
	if (vol4OwnedWithFlag(actor, 'vol4RegalRest').length === 0) return;

	const level = getCharacterLevel(actor) || 1;
	const currentTemp = Number(actor.system?.attributes?.hp?.temp ?? 0);
	const run = async () => {
		if (level > currentTemp) await actor.update({ 'system.attributes.hp.temp': level });
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: '<strong>Regal Rest</strong>',
			content: `<p>${escape(actor.name)} rests in silken comfort and gains <strong>${level} temp HP</strong>.</p>`,
		});
	};
	run().catch((error) => console.error(`[${MODULE_ID}] Regal Rest failed`, error));
});

// Ladlor's Tenacity — once per combat, intercept the update that would drop
// the bearer to 0 HP: they stay at 1 HP instead (the empowerment rider goes to
// chat). Mirrors the module's other pre-update interceptions.
Hooks.on('preUpdateActor', (actor, changes) => {
	if (actor?.type !== 'character') return;
	const newHp = foundry.utils.getProperty(changes, 'system.attributes.hp.value');
	if (typeof newHp !== 'number' || newHp > 0) return;
	const currentHp = Number(actor.system?.attributes?.hp?.value ?? 0);
	if (currentHp <= 0) return;

	const ladle = vol4OwnedWithFlag(actor, 'vol4LadlorsTenacity')[0];
	if (!ladle) return;

	const combatId = game.combat?.id ?? null;
	if (!combatId) return; // "each encounter" — only intercept during combat
	if (actor.getFlag(MODULE_ID, 'ladlorUsedCombat') === combatId) return;

	foundry.utils.setProperty(changes, 'system.attributes.hp.value', 1);
	actor.setFlag(MODULE_ID, 'ladlorUsedCombat', combatId).catch(() => {});
	const level = getCharacterLevel(actor) || 1;
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(ladle.name)} — Ladlor's Tenacity</strong>`,
		content: `<p>${escape(actor.name)} refuses to fall! HP set to <strong>1</strong>. For 2 turns: <strong>+${level} damage</strong> (LVL), <strong>immunity to all damage</strong>, and <strong>ignore rushed attacks</strong>.</p>`,
	}).catch(() => {});
});

