import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { actorOwnsFeat, actorKeyMod } from '../feats/mechanics/helpers.mjs';

/**
 * Toll the Hour (Luminary of Tidings, L7) — proclaim a tiding of either:
 *   - Calamity.  (Reach 6) Enemies within Reach must make a WIL save
 *     (DC 10+KEY) or become Dazed. Bloodied creatures always fail.
 *   - Jubilation. (Reach 6) All allies within Reach gain WIL Temp HP and may
 *     cleanse a condition or harmful effect.
 *
 * With Crier's Vigilance (L15) the caster gets an extra use per encounter and
 * may choose both tidings at once — offered as a third dialog option when the
 * actor owns that feature.
 *
 * Usage (1/encounter, 2/encounter with Crier's Vigilance) is not tracked at
 * runtime — this module has no per-encounter charge tracker for subclass
 * features (see `cost.details` on the item), so enforcement is left to the
 * player/GM, matching every other 1/encounter feature in this file.
 */
export async function tollTheHour(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] tollTheHour: missing actor or item.`);
		return null;
	}

	const REACH = 6;
	const hasVigilance = actorOwnsFeat(actor, 'criers-vigilance');
	const wil = Math.max(0, Number(actor.system?.abilities?.will?.mod ?? 0));
	const dc = 10 + actorKeyMod(actor);

	const buttons = [
		{ action: 'calamity', label: 'Calamity', default: true, callback: () => 'calamity' },
		{ action: 'jubilation', label: 'Jubilation', callback: () => 'jubilation' },
	];
	if (hasVigilance) {
		buttons.push({ action: 'both', label: "Both (Crier's Vigilance)", callback: () => 'both' });
	}

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose a Tiding` },
		content: `<p>Proclaim tidings of (1/encounter${hasVigilance ? ", 2/encounter with Crier's Vigilance" : ''}):</p>
			<ul>
				<li><strong>Calamity.</strong> (Reach ${REACH}) Enemies within Reach must make a <strong>WIL save</strong> (DC ${dc}) or become <strong>Dazed</strong>. Bloodied creatures always fail.</li>
				<li><strong>Jubilation.</strong> (Reach ${REACH}) All allies within Reach gain <strong>${wil} Temp HP</strong> and may cleanse a condition or harmful effect.</li>
			</ul>
			${hasVigilance ? `<p><em>Crier's Vigilance:</em> you may proclaim both tidings in one use.</p>` : ''}`,
		buttons,
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice) return null;

	const doCalamity = choice === 'calamity' || choice === 'both';
	const doJubilation = choice === 'jubilation' || choice === 'both';

	const actorToken = actor.getActiveTokens?.(true, true)?.[0];
	const gridSize = canvas?.dimensions?.distance ?? 1;

	// Mirrors the Reach-based ally filter used elsewhere in this file (e.g.
	// The Dwarf's Delight's Cheers! aura) — Chebyshev grid distance, gated by
	// token disposition. `wantAllies` flips the disposition comparison so the
	// same helper serves both Calamity (enemies) and Jubilation (allies).
	const tokensInReach = (wantAllies) => {
		if (!actorToken) return [];
		return (canvas?.tokens?.placeables ?? []).filter((t) => {
			const other = t.document;
			if (!other?.actor || other.actorId === actorToken.actorId) return false;
			const isAllied = other.disposition === actorToken.disposition;
			if (isAllied !== wantAllies) return false;
			const dx = Math.abs(other.x - actorToken.x) / (canvas.grid?.sizeX ?? canvas.grid?.size ?? 100);
			const dy = Math.abs(other.y - actorToken.y) / (canvas.grid?.sizeY ?? canvas.grid?.size ?? 100);
			return Math.max(dx, dy) * gridSize <= REACH * gridSize;
		});
	};

	const sections = [];

	if (doCalamity) {
		const dazed = [];
		const saved = [];
		const manual = [];

		for (const token of tokensInReach(false)) {
			const enemy = token.actor;

			// Bloodied detection: prefer the system's own derived tag (accounts
			// for the "bloodied" status AND the HP<=50% failsafe, and excludes
			// dying/last-stand edge cases — see populateDerivedTags in the
			// Nimble system source). Fall back to a raw HP check only if the
			// tag isn't present for some reason.
			const hpMax = Number(enemy.system?.attributes?.hp?.max ?? 0);
			const hpVal = Number(enemy.system?.attributes?.hp?.value ?? 0);
			const isBloodied =
				enemy.tags?.has?.('self:bloodied') ?? (hpMax > 0 && hpVal > 0 && hpVal <= hpMax / 2);

			let failed = isBloodied;
			if (!isBloodied) {
				try {
					const { roll } = (await enemy.rollSavingThrow?.('will', { skipRollDialog: true })) ?? {};
					if (!roll) {
						manual.push(enemy.name);
						continue;
					}
					failed = Number(roll.total ?? 0) < dc;
				} catch (error) {
					console.error(`[${MODULE_ID}] Toll the Hour: failed to roll ${enemy.name}'s WIL save`, error);
					manual.push(enemy.name);
					continue;
				}
			}

			if (failed) {
				await Promise.resolve(enemy.toggleStatusEffect('dazed', { active: true })).catch((error) => {
					console.error(`[${MODULE_ID}] Toll the Hour: failed to apply Dazed to ${enemy.name}`, error);
				});
				dazed.push(`${enemy.name}${isBloodied ? ' (Bloodied — auto-fail)' : ''}`);
			} else {
				saved.push(enemy.name);
			}
		}

		const noEnemiesFound = dazed.length === 0 && saved.length === 0 && manual.length === 0;
		sections.push(`<p><strong>Calamity</strong> — WIL save DC ${dc}, Reach ${REACH}:</p>
			<ul>
				${dazed.length ? `<li><strong>Dazed:</strong> ${dazed.map(escape).join(', ')}</li>` : ''}
				${saved.length ? `<li>Saved: ${saved.map(escape).join(', ')}</li>` : ''}
				${manual.length ? `<li><em>Could not auto-roll a save for:</em> ${manual.map(escape).join(', ')} — resolve manually.</li>` : ''}
				${noEnemiesFound ? `<li><em>No enemy tokens found within Reach ${REACH} — resolve manually.</em></li>` : ''}
			</ul>`);
	}

	if (doJubilation) {
		const healed = [];
		for (const token of tokensInReach(true)) {
			const ally = token.actor;
			const currentTemp = Number(ally.system?.attributes?.hp?.temp ?? 0);
			if (wil > currentTemp) {
				await ally.update({ 'system.attributes.hp.temp': wil });
			}
			healed.push(ally.name);
		}

		sections.push(`<p><strong>Jubilation</strong> — Reach ${REACH}:</p>
			<ul>
				${
					healed.length
						? `<li>Gain <strong>${wil} Temp HP</strong>: ${healed.map(escape).join(', ')}</li>`
						: `<li><em>No allied tokens found within Reach ${REACH} — apply ${wil} Temp HP manually.</em></li>`
				}
				<li><em>Each affected ally may also cleanse one harmful condition or effect (apply manually).</em></li>
			</ul>`);
	}

	const flavorLabel =
		choice === 'both' ? "Calamity &amp; Jubilation (Crier's Vigilance)" : choice[0].toUpperCase() + choice.slice(1);

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — <em>${flavorLabel}</em>`,
		content: sections.join(''),
	});
}

