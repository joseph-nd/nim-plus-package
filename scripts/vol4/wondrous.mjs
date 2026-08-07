import { escape } from '../core/html.mjs';
import { actorKeyMod } from '../feats/mechanics/helpers.mjs';
import { vol4SpendCharge } from './charges.mjs';
import { vol4ConsumeOne } from './runes.mjs';

/** Battlemage Gloves — Infusion: mana-fueled unarmed strike. */
export async function vol4BattlemageInfusion(actor, item) {
	if (!actor || !item) return null;
	const mana = Number(actor.system?.resources?.mana?.current ?? 0);
	const highestTier = Number(actor.system?.resources?.highestUnlockedSpellTier ?? 0);
	const maxSpend = Math.max(0, Math.min(mana, highestTier));
	const key = actorKeyMod(actor);

	const spend = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Infusion` },
		content: `
			<form class="nim-plus-infusion">
				<p>Spend up to <strong>${maxSpend}</strong> mana (current ${mana}, highest tier ${highestTier}). Each point: +KEY (${key}) damage and one die step (1d4 &gt; 1d6 &gt; &hellip; &gt; 1d20).</p>
				<div class="form-group"><label>Mana to spend</label>
				<input type="number" name="mana" value="0" min="0" max="${maxSpend}" step="1"></div>
			</form>`,
		buttons: [
			{
				action: 'ok',
				label: 'Strike',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-infusion');
					return Number(form?.elements?.mana?.value ?? 0);
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);
	if (spend === null) return null;

	const spent = Math.max(0, Math.min(maxSpend, Math.floor(spend)));
	if (spent > 0) {
		await actor.update({ 'system.resources.mana.current': mana - spent });
	}

	const dieSteps = [4, 6, 8, 10, 12, 20];
	const die = dieSteps[Math.min(spent, dieSteps.length - 1)];
	const bonus = spent * key;
	const formula = `1d${die} + @arcana${bonus > 0 ? ` + ${bonus}` : ''}`;
	const roll = await new Roll(formula, actor.getRollData()).evaluate();
	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — Force${spent > 0 ? ` <em>(Infusion: ${spent} mana)</em>` : ''}`,
	});
}

/** Cloak of the Fold — Reality Fold: teleport, paying 1 HP per space. */
export async function vol4RealityFold(actor, item) {
	if (!actor || !item) return null;
	const hp = Number(actor.system?.attributes?.hp?.value ?? 0);
	const maxSpaces = Math.max(0, hp - 1);

	const spaces = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Reality Fold` },
		content: `
			<form class="nim-plus-fold">
				<p>Teleport to a space you can see, paying <strong>1 HP per space</strong> (up to ${maxSpaces}).</p>
				<div class="form-group"><label>Spaces</label>
				<input type="number" name="spaces" value="1" min="1" max="${maxSpaces}" step="1"></div>
			</form>`,
		buttons: [
			{
				action: 'ok',
				label: 'Fold',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-fold');
					return Number(form?.elements?.spaces?.value ?? 0);
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);
	if (!spaces || spaces < 1) return null;

	const cost = Math.min(maxSpaces, Math.floor(spaces));
	if (typeof actor.applyDamage === 'function') await actor.applyDamage(cost);
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)} — Reality Fold</strong>`,
		content: `<p>${escape(actor.name)} folds through reality, teleporting <strong>${cost}</strong> space${cost === 1 ? '' : 's'} (paid ${cost} HP). Move the token to the destination.</p>`,
	});
}

/** Duneguard's Brooch — auto-succeed a save; the brooch crumbles. */
export async function vol4DuneguardBrooch(actor, item) {
	if (!actor || !item) return null;
	const confirmed = await foundry.applications.api.DialogV2.confirm({
		window: { title: item.name },
		content: `<p>Succeed on the save you just failed? <strong>The brooch crumbles to dust.</strong></p>`,
		rejectClose: false,
		modal: false,
	}).catch(() => false);
	if (!confirmed) return null;

	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>${escape(actor.name)}'s failed save <strong>succeeds instead</strong>. The scarab brooch crumbles to dust.</p>`,
	});
	return item.delete();
}

/** Sight of the Blind Oracle — cast from an ally's position, self-Blind. */
export async function vol4BlindOracle(actor, item) {
	if (!actor || !item) return null;
	if (!(await vol4SpendCharge(item, 'blind-oracle'))) return null;
	await actor.toggleStatusEffect('blinded', { active: true });
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>${escape(actor.name)} casts their next spell from an ally's position, and is <strong>Blinded</strong> until the start of their next turn.</p>`,
	});
}

const VOL4_GUIDANCE = [
	['Fire', 'Points towards the riskiest path.'],
	['Air', 'Points towards the most direct path.'],
	['Water', 'Points towards the safest path.'],
	['Earth', 'Points towards the most consistent path.'],
];

/** Guidance of the Elements — roll 1d4 and post the guidance. */
export async function vol4ElementalGuidance(actor, item) {
	if (!actor || !item) return null;
	if (!(await vol4SpendCharge(item, 'elemental-guidance'))) return null;
	const roll = await new Roll('1d4').evaluate();
	const [element, meaning] = VOL4_GUIDANCE[roll.total - 1];
	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — <strong>${element}</strong>: ${meaning}`,
	});
}

const VOL4_JELLYBEANS = [
	['Green Bean', 'Spit onto any surface: grows into a stable, 1-space platform. Dissolves into green goo after 10 minutes.'],
	['Yellow Bean', 'Chew: Feather Fall for 1 minute. Afterwards you spit up yellow goo.'],
	['Blue Bean', 'Spit out: covers a 2×2 area with blue goo for 10 minutes — doubles jumping range and height when bounced on.'],
	['Orange Bean', 'Spit out: covers 6 spaces in a line with orange goo for 10 minutes — doubles movement speed.'],
	['Purple Bean', 'Chew: grow a size category for 1 minute (up to Large). Afterwards you spit up purple goo.'],
	['Pink Bean', 'Chew: shrink a size category for 1 minute (down to Tiny). Afterwards you spit up pink goo.'],
	['Black Bean', 'Spit onto any surface: grows into a climbable pillar up to 5 meters tall. Dissolves into black goo after 10 minutes.'],
	['White Bean', 'Chew: become adhesive for 1 minute, climbing most surfaces. Afterwards you spit up white goo.'],
];

/** Traveling Tom's Magic Jellybeans — bite one: 1d8 for the bean. */
export async function vol4Jellybean(actor, item) {
	if (!actor || !item) return null;
	if (!(await vol4SpendCharge(item, 'jellybeans'))) return null;
	const roll = await new Roll('1d8').evaluate();
	const [bean, effect] = VOL4_JELLYBEANS[roll.total - 1];
	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — <strong>${bean}</strong>: ${effect}`,
	});
}

/** Tear of a Unicorn — heal 20 HP, remove all wounds, cure all conditions. */
export async function vol4UnicornTear(actor, item) {
	if (!actor || !item) return null;
	if (typeof actor.applyHealing === 'function') await actor.applyHealing(20);
	if (Number(actor.system?.attributes?.wounds?.value ?? 0) > 0) {
		await actor.update({ 'system.attributes.wounds.value': 0 });
	}
	for (const statusId of Array.from(actor.statuses ?? [])) {
		await actor.toggleStatusEffect(statusId, { active: false }).catch(() => {});
	}
	await vol4ConsumeOne(item);
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>${escape(actor.name)} is healed for <strong>20 HP</strong>; all wounds and conditions are removed.</p>`,
	});
}

