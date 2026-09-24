import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { actorOwnsFeat } from '../feats/mechanics/helpers.mjs';
import { vol4SpendCharge } from '../vol4/charges.mjs';

/**
 * Toll the Hour (Luminary of Tidings, L3 — revised Vol 3).
 *   (WIL/Safe Rest) Action: Proclaim tidings of either:
 *   - Jubilation. Heal WIL d10 HP to an ally within Reach 4 and cleanse a
 *     harmful non-Wound condition or effect.
 *   - Calamity.   Inflict Dazed and WIL d10 Radiant damage to a Hampered,
 *     undead or Bloodied enemy within Reach 4.
 *   Spread the News (L11): affects ALL enemies or allies within Reach 4.
 *
 * Uses are tracked by the `toll-the-hour` chargePool rule on the item (max
 * WIL, refreshed on Safe Rest); the macro path bypasses chargeConsumer rules,
 * so the charge is spent here. Recipients: the user's current targets, or —
 * with Spread the News — every token of the right disposition within Reach 4.
 */
const REACH = 4;
const HAMPERING = ['hampered', 'dazed', 'grappled', 'prone', 'slowed', 'restrained'];

export async function tollTheHour(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] tollTheHour: missing actor or item.`);
		return null;
	}

	const spread = actorOwnsFeat(actor, 'spread-the-news');
	const wil = Math.max(1, Number(actor.system?.abilities?.will?.mod ?? 0));

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose a Tiding` },
		content: `<p>(WIL/Safe Rest) Action: Proclaim tidings of either:</p>
			<ul>
				<li><strong>Jubilation.</strong> Heal <strong>${wil}d10 HP</strong> to ${spread ? 'all allies' : 'an ally'} within Reach ${REACH} and cleanse a harmful non-Wound condition or effect.</li>
				<li><strong>Calamity.</strong> Inflict <strong>Dazed</strong> and <strong>${wil}d10 Radiant damage</strong> to ${spread ? 'all' : 'a'} Hampered, undead or Bloodied ${spread ? 'enemies' : 'enemy'} within Reach ${REACH}.</li>
			</ul>
			<p><em>${spread ? 'Spread the News: every eligible token within Reach is affected.' : 'Target the recipient first; with no target the nearest eligible token within Reach is used.'}</em></p>`,
		buttons: [
			{ action: 'jubilation', label: 'Jubilation', default: true, callback: () => 'jubilation' },
			{ action: 'calamity', label: 'Calamity', callback: () => 'calamity' },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);
	if (!choice) return null;

	const wantAllies = choice === 'jubilation';
	const recipients = pickRecipients(actor, wantAllies, spread);
	if (!recipients.length) {
		ui.notifications?.warn(
			`${item.name}: no ${wantAllies ? 'allied' : 'enemy'} token within Reach ${REACH}${spread ? '' : ' (target one first)'}.`,
		);
		return null;
	}

	if (!(await vol4SpendCharge(item, 'toll-the-hour'))) return null;

	const roll = await new Roll(`${wil}d10`, actor.getRollData()).evaluate();
	const amount = Math.max(0, Number(roll.total ?? 0));
	const lines = [];

	for (const target of recipients) {
		if (wantAllies) {
			if (typeof target.applyHealing === 'function') await target.applyHealing(amount);
			lines.push(`<li><strong>${escape(target.name)}</strong> heals ${amount} HP and may cleanse one harmful non-Wound condition or effect.</li>`);
		} else {
			const eligible = isCalamityEligible(target);
			if (typeof target.applyDamage === 'function') await target.applyDamage(amount, { damageType: 'radiant' });
			await Promise.resolve(target.toggleStatusEffect('dazed', { active: true })).catch((error) => {
				console.error(`[${MODULE_ID}] Toll the Hour: failed to apply Dazed to ${target.name}`, error);
			});
			lines.push(
				`<li><strong>${escape(target.name)}</strong> takes ${amount} Radiant damage and is <strong>Dazed</strong>${
					eligible ? '' : ' — <em>not Hampered, undead or Bloodied; GM call</em>'
				}.</li>`,
			);
		}
	}

	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — <em>${wantAllies ? 'Jubilation' : 'Calamity'}</em>${spread ? ' (Spread the News)' : ''}<ul>${lines.join('')}</ul>`,
	});
}

/** Allied/enemy actors within Reach, from the user's targets or (Spread the News) every token in Reach. */
function pickRecipients(actor, wantAllies, spread) {
	const self = actor.getActiveTokens?.(true, true)?.[0];
	if (!self) return [];
	const cell = canvas.grid?.sizeX ?? canvas.grid?.size ?? 100;
	const inReach = (doc) =>
		Math.max(Math.abs(doc.x - self.x), Math.abs(doc.y - self.y)) / cell <= REACH;
	const rightSide = (doc) => (doc.disposition === self.disposition) === wantAllies;

	const candidates = (canvas.tokens?.placeables ?? [])
		.map((t) => t.document)
		.filter((doc) => doc?.actor && doc.actorId !== self.actorId && rightSide(doc) && inReach(doc));

	if (spread) return candidates.map((doc) => doc.actor);

	const targeted = [...(game.user?.targets ?? [])].map((t) => t.document).filter((doc) => candidates.includes(doc));
	if (targeted.length) return [targeted[0].actor];
	candidates.sort(
		(a, b) => Math.hypot(a.x - self.x, a.y - self.y) - Math.hypot(b.x - self.x, b.y - self.y),
	);
	return candidates.length ? [candidates[0].actor] : [];
}

function isCalamityEligible(target) {
	const statuses = target.statuses ?? new Set();
	if (HAMPERING.some((s) => statuses.has(s))) return true;
	if (/undead/i.test(String(target.system?.details?.creatureType ?? ''))) return true;
	const hpMax = Number(target.system?.attributes?.hp?.max ?? 0);
	const hpVal = Number(target.system?.attributes?.hp?.value ?? 0);
	return target.tags?.has?.('self:bloodied') ?? (hpMax > 0 && hpVal > 0 && hpVal <= hpMax / 2);
}
