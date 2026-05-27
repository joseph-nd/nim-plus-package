/**
 * Nim+ Package — runtime API
 *
 * Exposes helpers that feature macros (the `system.macro` field on Nimble
 * items) can call. Every helper takes the `actor` and `item` that the macro
 * was invoked with so it can roll against the right actor and label the chat
 * output with the right item.
 *
 * Access patterns:
 *   game.modules.get('nim-plus-package').api.pickDamage(actor, item, options)
 *   nimPlus.pickDamage(actor, item, options)              // shortcut alias
 */

const MODULE_ID = 'nim-plus-package';

const api = {
	pickDamage,
	summonSpiritCompanion,
	tollTheHour,
	seasonedJourneyman,
	sporeAttack,
	mirageDispatch,
	psionicFieldAttack,
	strain: {
		gain: strainGain,
		lose: strainLose,
		clear: strainClear,
		roll: strainRoll,
		getDieSize: strainGetDieSize,
		show: strainShow,
	},
};

Hooks.once('init', () => {
	const mod = game.modules.get(MODULE_ID);
	if (mod) mod.api = api;
	globalThis.nimPlus = api;
});

Hooks.once('ready', () => {
	ensureStrainStyles();
});

/**
 * Mirror Nimble core's class-features compendium decorator: render the
 * `gainedAtLevels` of each entry as a small right-aligned badge and sort the
 * list by level. We reuse the system's existing CSS classes
 * (`nimble-compendium-entry-with-level`, `nimble-class-feature-name-flex`,
 * `nimble-compendium-entry-level`) so styling matches the core pack with no
 * extra stylesheet shipped by this module.
 */
const NIMPLUS_CLASS_FEATURES_PACK = `${MODULE_ID}.nim-plus-class-features`;
const NIMPLUS_SPELLS_PACK = `${MODULE_ID}.nim-plus-spells`;
const ENTRY_WITH_LEVEL_CLASS = 'nimble-compendium-entry-with-level';
const LEVEL_BADGE_CLASS = 'nimble-compendium-entry-level';
const LEVEL_NAME_FLEX_CLASS = 'nimble-class-feature-name-flex';

Hooks.on('renderCompendium', (application, element) => {
	const pack = application?.collection;
	if (!pack) return;

	const container = element instanceof HTMLElement ? element : element?.[0];
	if (!(container instanceof HTMLElement)) return;

	if (pack.collection === NIMPLUS_CLASS_FEATURES_PACK) {
		pack
			.getIndex({ fields: ['system.gainedAtLevel', 'system.gainedAtLevels'] })
			.then(() => {
				const entries = collectClassFeatureEntryData(pack, container);
				sortClassFeatureEntries(entries);
				applyClassFeatureLevelsToEntries(entries);
			})
			.catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply class feature level labels`, error);
			});
	} else if (pack.collection === NIMPLUS_SPELLS_PACK) {
		pack
			.getIndex({ fields: ['system.tier'] })
			.then(() => {
				applySpellTierBadges(pack, container);
			})
			.catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply spell tier badges`, error);
			});
	}
});

function applySpellTierBadges(pack, container) {
	for (const entryElement of container.querySelectorAll('[data-entry-id]')) {
		const entryId = entryElement.dataset.entryId;
		if (!entryId) continue;
		const indexEntry = pack.index.get(entryId);
		const tier = Number(foundry.utils.getProperty(indexEntry ?? {}, 'system.tier'));
		if (!Number.isFinite(tier)) continue;
		const nameElement =
			entryElement.querySelector('.entry-name') ?? entryElement.querySelector('a') ?? entryElement;
		nameElement.classList.add(LEVEL_NAME_FLEX_CLASS);
		nameElement.style.setProperty('display', 'flex', 'important');
		nameElement.style.setProperty('align-items', 'center', 'important');
		nameElement.style.setProperty('width', '100%', 'important');
		nameElement.style.setProperty('min-width', '0', 'important');

		let badge = nameElement.querySelector(`.${LEVEL_BADGE_CLASS}`);
		if (!badge) {
			badge = document.createElement('span');
			badge.classList.add(LEVEL_BADGE_CLASS);
			nameElement.append(badge);
		}
		badge.style.setProperty('margin-left', 'auto', 'important');
		badge.style.setProperty('margin-right', '6px', 'important');
		badge.style.setProperty('display', 'inline-block', 'important');
		badge.style.setProperty('white-space', 'nowrap', 'important');
		badge.textContent = tier === 0 ? 'C' : String(tier);
		entryElement.classList.add(ENTRY_WITH_LEVEL_CLASS);
	}
}

function toLevel(value) {
	if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
	}
	return null;
}

function toLevels(value) {
	const levels = new Set();
	const push = (candidate) => {
		const parsed = toLevel(candidate);
		if (parsed !== null) levels.add(parsed);
	};
	if (Array.isArray(value)) {
		for (const c of value) push(c);
	} else if (typeof value === 'string' && value.includes(',')) {
		for (const c of value.split(',')) push(c);
	} else if (typeof value === 'string') {
		const matches = value.match(/\d+/g);
		if (matches && matches.length > 1) for (const c of matches) push(c);
		else push(value);
	} else {
		push(value);
	}
	return [...levels].sort((a, b) => a - b);
}

function getFeatureLevels(indexEntry) {
	const safe = indexEntry ?? {};
	const multi = toLevels(foundry.utils.getProperty(safe, 'system.gainedAtLevels'));
	if (multi.length > 0) return multi;
	return toLevels(foundry.utils.getProperty(safe, 'system.gainedAtLevel'));
}

function collectClassFeatureEntryData(pack, element) {
	const entries = [];
	for (const entryElement of element.querySelectorAll('[data-entry-id]')) {
		const entryId = entryElement.dataset.entryId;
		if (!entryId || !entryElement.parentElement) continue;
		const nameElement =
			entryElement.querySelector('.entry-name') ?? entryElement.querySelector('a') ?? entryElement;
		const indexEntry = pack.index.get(entryId);
		const gainedAtLevels = getFeatureLevels(indexEntry);
		const title =
			(typeof indexEntry?.name === 'string' ? indexEntry.name : '') ||
			(nameElement.textContent?.trim() ?? '');
		entries.push({
			entryElement,
			gainedAtLevels,
			nameElement,
			parentElement: entryElement.parentElement,
			sortLevel: gainedAtLevels[0] ?? null,
			title,
		});
	}
	return entries;
}

function sortClassFeatureEntries(entries) {
	const grouped = new Map();
	for (const entry of entries) {
		const list = grouped.get(entry.parentElement) ?? [];
		list.push(entry);
		grouped.set(entry.parentElement, list);
	}
	for (const [parent, list] of grouped) {
		list.sort((a, b) => {
			const al = a.sortLevel ?? Number.MAX_SAFE_INTEGER;
			const bl = b.sortLevel ?? Number.MAX_SAFE_INTEGER;
			if (al !== bl) return al - bl;
			const aSingle = a.gainedAtLevels.length === 1;
			const bSingle = b.gainedAtLevels.length === 1;
			if (aSingle !== bSingle) return aSingle ? -1 : 1;
			return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
		});
		for (const entry of list) parent.append(entry.entryElement);
	}
}

function applyClassFeatureLevelsToEntries(entries) {
	for (const { entryElement, gainedAtLevels, nameElement } of entries) {
		if (gainedAtLevels.length < 1) {
			entryElement.classList.remove(ENTRY_WITH_LEVEL_CLASS);
			entryElement.querySelector(`.${LEVEL_NAME_FLEX_CLASS}`)?.classList.remove(LEVEL_NAME_FLEX_CLASS);
			entryElement.querySelector(`.${LEVEL_BADGE_CLASS}`)?.remove();
			continue;
		}
		nameElement.classList.add(LEVEL_NAME_FLEX_CLASS);
		nameElement.style.setProperty('display', 'flex', 'important');
		nameElement.style.setProperty('align-items', 'center', 'important');
		nameElement.style.setProperty('width', '100%', 'important');
		nameElement.style.setProperty('min-width', '0', 'important');

		let badge = nameElement.querySelector(`.${LEVEL_BADGE_CLASS}`);
		if (!badge) {
			badge = document.createElement('span');
			badge.classList.add(LEVEL_BADGE_CLASS);
			nameElement.append(badge);
		}
		badge.style.setProperty('margin-left', 'auto', 'important');
		badge.style.setProperty('margin-right', '6px', 'important');
		badge.style.setProperty('display', 'inline-block', 'important');
		badge.style.setProperty('white-space', 'nowrap', 'important');
		badge.textContent = gainedAtLevels.join(', ');
		entryElement.classList.add(ENTRY_WITH_LEVEL_CLASS);
	}
}

/**
 * Auto-manage Concentration when the player activates a feature whose rules
 * text demands it.
 *
 * - **Apodracosis** (Mage / Invoker of Majesty, L3) — apply once, no toggle.
 *   Re-activating the feature does not turn off Concentration.
 * - **Psionic Field** (Psion, L1) — toggle. The PDF reads "Concentration, up
 *   to 1 min. Action: Create a field…". Re-activating ends the field, which
 *   is the standard Nimble idiom for self-canceling aura concentrations.
 *
 * The visual aura (token light) is wired separately to the createActiveEffect
 * / deleteActiveEffect hooks below so it works regardless of how
 * Concentration was applied or removed (status button, Strain break, GM).
 */
Hooks.on('nimble.useItem', (item) => {
	if (!item || item.type !== 'feature') return;
	const identifier = item.system?.identifier;
	const actor = item.actor;
	if (!actor) return;

	if (identifier === 'psionic-field') {
		const isOn = actor.statuses?.has?.('concentration');
		Promise.resolve(actor.toggleStatusEffect('concentration', { active: !isOn })).catch(
			(error) => {
				console.error(`[${MODULE_ID}] Failed to toggle Concentration for Psionic Field`, error);
			},
		);
		return;
	}

	if (identifier === 'apodracosis') {
		if (actor.statuses?.has?.('concentration')) return;
		Promise.resolve(actor.toggleStatusEffect('concentration', { active: true })).catch((error) => {
			console.error(`[${MODULE_ID}] Failed to apply Concentration for Apodracosis`, error);
		});
		return;
	}
});

/**
 * Psionic Field aura visualization — when Concentration becomes active on a
 * Psion who owns `psionic-field`, set the actor's tokens to emit a low-alpha
 * teal-cyan dim light at radius 3 (matching the field's Reach). On
 * Concentration removal (re-activation, Strain break, manual toggle, GM),
 * restore the token's prior light config.
 *
 * Light state is stashed on a per-token flag so any prior light source the
 * player had configured (torch, ring of light, etc.) is preserved across the
 * toggle. Falls back to "no light" if nothing was stashed.
 */
const PSION_AURA_FLAG = 'psionicFieldPrevLight';
const PSION_FIELD_TEMPLATE_FLAG = 'psionicFieldTemplateId';
const PSION_FIELD_REACH = 3;
const PSION_AURA_LIGHT = {
	dim: 3,
	bright: 0,
	color: '#39d6c8',
	alpha: 0.35,
	luminosity: 0.5,
	angle: 360,
	// No animation — animated lights run shader passes per frame on the
	// canvas, which hits Firefox especially hard. The dim radius + color +
	// MeasuredTemplate boundary already convey the aura.
	animation: { type: 'none', speed: 1, intensity: 1, reverse: false },
};

function getTokenCenter(doc) {
	const scene = doc.parent;
	const gridSize = scene?.grid?.size ?? 100;
	return {
		x: doc.x + (doc.width * gridSize) / 2,
		y: doc.y + (doc.height * gridSize) / 2,
	};
}

async function createPsionicFieldTemplate(doc) {
	const scene = doc.parent;
	if (!scene) return;
	const existing = doc.getFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	if (existing && scene.templates?.get?.(existing)) return; // already there
	const gridDistance = scene.grid?.distance ?? 5;
	const { x, y } = getTokenCenter(doc);
	const [template] = await scene.createEmbeddedDocuments('MeasuredTemplate', [
		{
			t: 'circle',
			user: game.user.id,
			distance: PSION_FIELD_REACH * gridDistance,
			direction: 0,
			angle: 0,
			width: 0,
			x,
			y,
			fillColor: '#39d6c8',
			borderColor: '#0aa697',
			flags: {
				[MODULE_ID]: {
					psionicField: true,
					ownerTokenId: doc.id,
				},
			},
		},
	]);
	if (template) await doc.setFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG, template.id);
}

async function removePsionicFieldTemplate(doc) {
	const templateId = doc.getFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	if (templateId) {
		const scene = doc.parent;
		const template = scene?.templates?.get?.(templateId);
		if (template) await template.delete();
		await doc.unsetFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	}
}

async function setPsionicFieldAura(actor, on) {
	const tokens = actor.getActiveTokens?.(true) ?? [];
	for (const token of tokens) {
		const doc = token.document ?? token;
		try {
			if (on) {
				if (doc.getFlag(MODULE_ID, PSION_AURA_FLAG) === undefined) {
					const prev = doc.light?.toObject?.() ?? foundry.utils.deepClone(doc.light ?? {});
					await doc.setFlag(MODULE_ID, PSION_AURA_FLAG, prev);
				}
				await doc.update({ light: PSION_AURA_LIGHT });
				await createPsionicFieldTemplate(doc);
			} else {
				const prev = doc.getFlag(MODULE_ID, PSION_AURA_FLAG);
				await doc.update({ light: prev ?? { dim: 0, bright: 0, alpha: 0.5, color: null } });
				if (prev !== undefined) await doc.unsetFlag(MODULE_ID, PSION_AURA_FLAG);
				await removePsionicFieldTemplate(doc);
			}
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to ${on ? 'apply' : 'remove'} Psionic Field aura`, error);
		}
	}
}

// Gate by userId: createActiveEffect / deleteActiveEffect fire on every
// client, but only the triggering user should mutate the scene (templates,
// tokens) to avoid duplicate creates and race-y deletes.
Hooks.on('createActiveEffect', (effect, _options, userId) => {
	if (userId !== game.user.id) return;
	if (!effect?.statuses?.has?.('concentration')) return;
	const actor = effect.parent;
	if (!(actor instanceof Actor)) return;
	if (!actor.items?.some?.((i) => i.system?.identifier === 'psionic-field')) return;
	setPsionicFieldAura(actor, true).catch(() => {});
});

Hooks.on('deleteActiveEffect', (effect, _options, userId) => {
	if (userId !== game.user.id) return;
	if (!effect?.statuses?.has?.('concentration')) return;
	const actor = effect.parent;
	if (!(actor instanceof Actor)) return;
	if (!actor.items?.some?.((i) => i.system?.identifier === 'psionic-field')) return;
	setPsionicFieldAura(actor, false).catch(() => {});
});

// Follow-the-token: when a token with an active Psionic Field template moves,
// re-center the template on the new token position. Gated by userId so only
// the user who moved the token issues the template update.
Hooks.on('updateToken', (doc, changes, _options, userId) => {
	if (userId !== game.user.id) return;
	if (!('x' in changes || 'y' in changes)) return;
	const templateId = doc.getFlag(MODULE_ID, PSION_FIELD_TEMPLATE_FLAG);
	if (!templateId) return;
	const scene = doc.parent;
	const template = scene?.templates?.get?.(templateId);
	if (!template) return;
	const { x, y } = getTokenCenter(doc);
	template.update({ x, y }).catch((error) => {
		console.error(`[${MODULE_ID}] Failed to move Psionic Field template`, error);
	});
});

/**
 * Make features with `flags.nim-plus-package.showAsAttack === true` show up in
 * the character sheet's Heroic Actions → Attack panel. The panel filter checks
 * `system.actionType?.includes('attack')`, but `actionType` isn't part of the
 * feature schema, so it would be stripped from `_source` on load. We instead
 * inject it on the prepared-data side at runtime — it never persists, but it
 * satisfies the panel's reactive filter for the lifetime of the session.
 *
 * The feature still also needs `system.activation.cost.type === 'action'` for
 * the panel to include it.
 */
Hooks.once('setup', () => {
	const ItemClass = CONFIG.Item.documentClass;
	if (!ItemClass) return;

	const original = ItemClass.prototype.prepareDerivedData;
	ItemClass.prototype.prepareDerivedData = function patchedPrepareDerivedData() {
		original.call(this);
		if (this.type !== 'feature') return;
		if (this.getFlag(MODULE_ID, 'showAsAttack')) {
			this.system.actionType = 'attack';
		}
	};
});

/**
 * Show a dialog letting the player pick one of several damage formulas, then
 * roll the chosen formula against the actor's roll data and post a damage
 * chat card.
 *
 * @param {Actor} actor                  The actor rolling.
 * @param {Item}  item                   The item the macro is attached to.
 * @param {Array<{
 *   id: string,
 *   label: string,
 *   formula: string,
 *   damageType?: string,
 *   default?: boolean,
 * }>} options                           Damage variants to choose between.
 *                                       Provide at least one. Mark one as
 *                                       `default: true` to pre-select it.
 * @returns {Promise<ChatMessage|null>}  The posted chat message, or null if
 *                                       the dialog was dismissed.
 */
async function pickDamage(actor, item, options) {
	if (!actor || !item || !Array.isArray(options) || options.length === 0) {
		ui.notifications?.error(`[${MODULE_ID}] pickDamage: invalid arguments.`);
		return null;
	}

	const defaultOpt = options.find((o) => o.default) ?? options[0];

	const buttonRows = options
		.map((opt) => {
			const dmgTag = opt.damageType ? ` <em>${escape(opt.damageType)}</em>` : '';
			return `<li><strong>${escape(opt.label)}</strong> — <code>${escape(opt.formula)}</code>${dmgTag}</li>`;
		})
		.join('');

	const choiceId = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose Damage` },
		content: `<p>Pick a damage option for <strong>${escape(item.name)}</strong>:</p><ul>${buttonRows}</ul>`,
		buttons: options.map((opt) => ({
			action: opt.id,
			label: opt.label,
			default: opt === defaultOpt,
			callback: () => opt.id,
		})),
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choiceId) return null;

	const selected = options.find((o) => o.id === choiceId);
	if (!selected) return null;

	const rollData = actor.getRollData();
	const roll = await new Roll(selected.formula, rollData).evaluate();

	const flavor =
		`<strong>${escape(item.name)}</strong> — ${escape(selected.label)}` +
		(selected.damageType ? ` <em>(${escape(selected.damageType)})</em>` : '');

	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor,
	});
}

/**
 * Toll the Hour (Luminary of Tidings, L3) — proclaim a tiding of either
 * Jubilation (heal an ally + cleanse a non-Wound condition) or Calamity
 * (Dazed + radiant damage to a valid enemy). Pops a dialog, rolls WILd10,
 * and posts a chat card with the appropriate flavor.
 */
async function tollTheHour(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] tollTheHour: missing actor or item.`);
		return null;
	}

	const wil = Math.max(1, Number(actor.system?.abilities?.will?.mod ?? 1));
	const formula = `${wil}d10`;

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose a Tiding` },
		content: `<p>Proclaim tidings of:</p><ul><li><strong>Jubilation.</strong> Heal <code>${formula}</code> HP to an ally within Reach 4 and cleanse a harmful non-Wound condition or effect.</li><li><strong>Calamity.</strong> Inflict <em>Dazed</em> and <code>${formula}</code> Radiant damage to a Hampered, undead, or Bloodied enemy within Reach 4.</li></ul>`,
		buttons: [
			{ action: 'jubilation', label: 'Jubilation', default: true, callback: () => 'jubilation' },
			{ action: 'calamity', label: 'Calamity', callback: () => 'calamity' },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice) return null;

	const rollData = actor.getRollData();
	const roll = await new Roll(formula, rollData).evaluate();

	const flavor =
		choice === 'jubilation'
			? `<strong>${escape(item.name)}</strong> — <em>Jubilation</em> (Healing) — <em>cleanse one harmful non-Wound condition</em>`
			: `<strong>${escape(item.name)}</strong> — <em>Calamity</em> (Radiant) — <em>Inflict Dazed; valid targets: Hampered, undead, or Bloodied</em>`;

	return roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor,
	});
}

// Spirit Companion template lookup — imported once per world from the
// `nim-plus-companions` compendium and identified by a stable flag so
// subsequent summons reuse the imported actor.
const SPIRIT_COMPANION_PACK = 'nim-plus-package.nim-plus-companions';
const SPIRIT_COMPANION_TEMPLATE_FLAG = 'spirit-companion';

const SPIRIT_DIE_FACES = [4, 6, 8, 10, 12, 20];

const STRIKE_ITEM_NAME = 'Spirit Strike';
const HEAL_ITEM_NAME = 'Spirit Heal';

/**
 * Summon (or re-summon / dismiss) the caster's Spirit Companion.
 *
 * The companion is a damage-immune, marker-only actor that acts on the
 * Shepherd's turn. The dialog lets the caster pick a strike die and (once)
 * upload a token image; both choices and the spawned token's id are persisted
 * as actor flags on the caster so subsequent summons recall them.
 *
 * @param {Actor} actor   The Shepherd casting the spell.
 * @param {Item}  item    The spell item (used for chat-flavor labels only).
 * @returns {Promise<TokenDocument|null>}
 */
async function summonSpiritCompanion(actor, item) {
	if (!actor) {
		ui.notifications?.error(`[${MODULE_ID}] summonSpiritCompanion: missing actor.`);
		return null;
	}

	const wil = Number(actor.system?.abilities?.will?.mod ?? 0);

	const savedDie = Number(actor.getFlag(MODULE_ID, 'spiritDie')) || 6;
	const savedImage = actor.getFlag(MODULE_ID, 'spiritImage') || '';
	const savedName = actor.getFlag(MODULE_ID, 'spiritName') || `${actor.name}'s Spirit`;

	const choice = await openSpiritDialog({ actor, savedDie, savedImage, savedName, wil });
	if (!choice) return null;

	if (choice.action === 'dismiss') {
		const removed = await dismissSpiritToken(actor);
		if (removed) {
			ui.notifications?.info(`${actor.name}'s Spirit dismissed.`);
		} else {
			ui.notifications?.warn('No active Spirit to dismiss.');
		}
		return null;
	}

	await actor.setFlag(MODULE_ID, 'spiritDie', choice.die);
	await actor.setFlag(MODULE_ID, 'spiritImage', choice.image);
	await actor.setFlag(MODULE_ID, 'spiritName', choice.name);

	await dismissSpiritToken(actor);

	const scene = canvas?.scene;
	if (!scene) {
		ui.notifications?.error(`[${MODULE_ID}] No active scene to summon onto.`);
		return null;
	}

	const baseActor = await resolveSpiritBaseActor();
	if (!baseActor) {
		ui.notifications?.error(`[${MODULE_ID}] Could not resolve Spirit Companion template.`);
		return null;
	}

	const { x, y } = computeSpawnPosition(actor, scene);

	const tokenSrc = baseActor.prototypeToken.toObject();
	const tokenData = foundry.utils.mergeObject(
		tokenSrc,
		{
			name: choice.name,
			x,
			y,
			actorId: baseActor.id,
			actorLink: false,
			texture: { src: choice.image || tokenSrc.texture?.src },
			disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
			flags: {
				[MODULE_ID]: {
					summoner: actor.id,
					spiritDie: choice.die,
				},
			},
		},
		{ inplace: false },
	);
	delete tokenData._id;

	const [created] = await scene.createEmbeddedDocuments('Token', [tokenData]);
	if (!created) {
		ui.notifications?.error(`[${MODULE_ID}] Failed to spawn Spirit token.`);
		return null;
	}

	// Patch the unlinked token's synthetic-actor items with the per-summon
	// formulas. Doing this after creation (rather than via token.delta on
	// create) avoids fragile array-merge semantics in the create payload.
	const formula = `1d${choice.die} + ${wil}`;
	const synthActor = created.actor;
	if (synthActor) {
		const updates = [];
		const strike = synthActor.items.getName(STRIKE_ITEM_NAME);
		const heal = synthActor.items.getName(HEAL_ITEM_NAME);
		if (strike) {
			updates.push({
				_id: strike.id,
				system: {
					activation: {
						effects: [
							{
								id: 'spiritStrikeDmg1',
								type: 'damage',
								damageType: 'radiant',
								formula,
								parentContext: null,
								parentNode: null,
								canCrit: true,
								canMiss: true,
								on: {
									hit: [
										{
											id: 'spiritStrikeHit1',
											type: 'damageOutcome',
											outcome: 'fullDamage',
											parentContext: 'hit',
											parentNode: 'spiritStrikeDmg1',
										},
									],
								},
							},
						],
					},
				},
			});
		}
		if (heal) {
			updates.push({
				_id: heal.id,
				system: {
					activation: {
						effects: [
							{
								id: 'spiritHealEff1',
								type: 'healing',
								healingType: 'healing',
								formula,
								parentContext: null,
								parentNode: null,
							},
						],
					},
				},
			});
		}
		if (updates.length > 0) {
			await synthActor.updateEmbeddedDocuments('Item', updates);
		}
	}

	await actor.setFlag(MODULE_ID, 'spiritTokenId', created.id);
	await actor.setFlag(MODULE_ID, 'spiritSceneId', scene.id);

	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item?.name ?? 'Summon Spirit Companion')}</strong>`,
		content: `<p>${escape(actor.name)} summons <strong>${escape(choice.name)}</strong>.</p><p>Strike & Heal: <code>1d${choice.die} + ${wil}</code></p>`,
	});

	return created;
}

async function resolveSpiritBaseActor() {
	const existing = game.actors.find(
		(a) => a.getFlag(MODULE_ID, 'companionTemplate') === SPIRIT_COMPANION_TEMPLATE_FLAG,
	);
	if (existing) return existing;

	const pack = game.packs.get(SPIRIT_COMPANION_PACK);
	if (!pack) return null;

	const index = await pack.getIndex();
	const entry = index.find((e) => e.name === 'Spirit Companion');
	if (!entry) return null;

	const source = await pack.getDocument(entry._id);
	if (!source) return null;

	return Actor.implementation.create(source.toObject(), { keepId: false });
}

function computeSpawnPosition(actor, scene) {
	const ownToken = actor.getActiveTokens(true, true)[0];
	const grid = scene.grid?.size ?? 100;
	if (ownToken) {
		return {
			x: ownToken.x + grid,
			y: ownToken.y,
		};
	}
	return {
		x: Math.round((scene.dimensions?.sceneWidth ?? scene.width ?? 4000) / 2),
		y: Math.round((scene.dimensions?.sceneHeight ?? scene.height ?? 4000) / 2),
	};
}

async function dismissSpiritToken(actor) {
	const tokenId = actor.getFlag(MODULE_ID, 'spiritTokenId');
	const sceneId = actor.getFlag(MODULE_ID, 'spiritSceneId');
	if (!tokenId || !sceneId) return false;

	const scene = game.scenes.get(sceneId);
	const token = scene?.tokens.get(tokenId);
	if (token) await token.delete();

	await actor.unsetFlag(MODULE_ID, 'spiritTokenId');
	await actor.unsetFlag(MODULE_ID, 'spiritSceneId');
	return Boolean(token);
}

async function openSpiritDialog({ actor, savedDie, savedImage, savedName, wil }) {
	const dieOptions = SPIRIT_DIE_FACES.map(
		(faces) =>
			`<option value="${faces}"${faces === savedDie ? ' selected' : ''}>d${faces}</option>`,
	).join('');

	const previewSrc = savedImage || 'icons/svg/mystery-man.svg';

	const content = `
		<form class="nim-plus-spirit-dialog">
			<div class="form-group">
				<label>Companion Name</label>
				<input type="text" name="name" value="${escape(savedName)}" />
			</div>
			<div class="form-group">
				<label>Strike Die</label>
				<select name="die">${dieOptions}</select>
			</div>
			<div class="form-group">
				<label>Token Image</label>
				<div style="display:flex;gap:8px;align-items:center;">
					<img data-spirit-preview src="${escape(previewSrc)}" style="width:48px;height:48px;border-radius:50%;border:1px solid #888;object-fit:cover;background:rgba(0,0,0,0.2);" />
					<input type="text" name="image" value="${escape(savedImage)}" placeholder="modules/nim-plus-package/assets/companions/spirit-companion.webp" style="flex:1;" />
					<button type="button" data-spirit-pick><i class="fas fa-folder-open"></i> Pick…</button>
				</div>
			</div>
			<p style="opacity:0.7;font-size:0.85em;">WIL bonus: <strong>${wil >= 0 ? `+${wil}` : wil}</strong> (auto). Final formula: <code>1d{die} + ${wil}</code>.</p>
		</form>
	`;

	const DialogV2 = foundry.applications.api.DialogV2;

	return DialogV2.wait({
		window: { title: 'Summon Spirit Companion' },
		content,
		buttons: [
			{
				action: 'summon',
				label: 'Summon',
				default: true,
				callback: (_event, button, dialog) => readForm(dialog ?? button, 'summon'),
			},
			{
				action: 'dismiss',
				label: 'Dismiss Spirit',
				callback: () => ({ action: 'dismiss' }),
			},
			{
				action: 'cancel',
				label: 'Cancel',
				callback: () => null,
			},
		],
		render: (_event, dialog) => wireDialogPicker(dialog, actor),
		rejectClose: false,
		modal: false,
	}).catch(() => null);
}

function readForm(host, action) {
	const root = host?.element ?? host;
	const form = root?.querySelector?.('form.nim-plus-spirit-dialog');
	if (!form) return null;

	const name = form.elements.name?.value?.trim() || 'Spirit';
	const die = Number(form.elements.die?.value) || 6;
	const image = form.elements.image?.value?.trim() || '';

	return { action, name, die, image };
}

function wireDialogPicker(dialog, _actor) {
	const root = dialog?.element ?? dialog;
	if (!root) return;
	const form = root.querySelector('form.nim-plus-spirit-dialog');
	if (!form) return;

	const pickBtn = form.querySelector('[data-spirit-pick]');
	const preview = form.querySelector('[data-spirit-preview]');
	const input = form.elements.image;

	const sync = () => {
		if (!preview) return;
		preview.src = input.value || 'icons/svg/mystery-man.svg';
	};

	input?.addEventListener('input', sync);

	pickBtn?.addEventListener('click', () => {
		const FilePickerImpl =
			foundry.applications.apps.FilePicker?.implementation ?? globalThis.FilePicker;
		if (!FilePickerImpl) {
			ui.notifications?.error(`[${MODULE_ID}] FilePicker unavailable.`);
			return;
		}
		new FilePickerImpl({
			type: 'image',
			current: input.value || 'modules/nim-plus-package/assets/companions/',
			callback: (path) => {
				input.value = path;
				sync();
			},
		}).render(true);
	});
}

/**
 * Seasoned Journeyman (Shepherd / Luminary of the Forge, L3) — let the
 * Shepherd pick Weaponsmith or Armorsmith at Safe Rest. The bonus is +WIL,
 * upgraded to +WIL+STR if the actor also owns Master of the Hammer (L11).
 *
 * Persists the choice as an actor flag (`journeymanChoice` and
 * `journeymanBonus`) so the player can reference it during play. The flag is
 * cleared automatically on Safe Rest by the `nimble.rest` hook below.
 */
async function seasonedJourneyman(actor, item) {
	if (!actor) {
		ui.notifications?.error(`[${MODULE_ID}] seasonedJourneyman: missing actor.`);
		return null;
	}

	const wil = Number(actor.system?.abilities?.will?.mod ?? 0);
	const str = Number(actor.system?.abilities?.strength?.mod ?? 0);
	const hasHammer = actor.items?.some((i) => i.system?.identifier === 'master-of-the-hammer');
	const bonusValue = hasHammer ? wil + str : wil;
	const formulaLabel = hasHammer ? 'WIL + STR' : 'WIL';

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose Bonus` },
		content: `<p>Choose your Safe-Rest specialization:</p><ul><li><strong>Weaponsmith</strong> — your weapon gains <strong>+${bonusValue}</strong> damage (${formulaLabel}) until your next Safe Rest.</li><li><strong>Armorsmith</strong> — your armor gains <strong>+${bonusValue}</strong> defense (${formulaLabel}) until your next Safe Rest.</li></ul>`,
		buttons: [
			{ action: 'weapon', label: 'Weaponsmith', default: true, callback: () => 'weapon' },
			{ action: 'armor', label: 'Armorsmith', callback: () => 'armor' },
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice) return null;

	await actor.setFlag(MODULE_ID, 'journeymanChoice', choice);
	await actor.setFlag(MODULE_ID, 'journeymanBonus', bonusValue);

	const label = choice === 'weapon' ? 'Weaponsmith' : 'Armorsmith';
	const effect = choice === 'weapon' ? `+${bonusValue} damage` : `+${bonusValue} defense`;

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — ${escape(label)}`,
		content: `<p>${escape(actor.name)} chooses <strong>${escape(label)}</strong> (${escape(formulaLabel)} = <strong>${bonusValue}</strong>): <em>${escape(effect)}</em> until next Safe Rest.</p>`,
	});
}

/**
 * Sporesphere (Stormshifter / Circle of Spores) — pop a dialog letting the
 * player pick a Sporesphere damage formula and (optionally) Decay-fueled
 * upgrades, then run the standard activation flow with the chosen formula.
 *
 * Damage / reach scale automatically with owned features:
 *   - Sporulation (L15)        2d8 / Reach 6
 *   - Mycelium Growth (L11)    1d8 / Reach 4
 *   - Germination (L7)         1d6 / Reach 3
 *   - Sporesphere (L3, base)   1d4 / Reach 2
 *
 * With Decay (L7), the player may spend Beastshift charges to either bump
 * the die size by one step (d4→d6→d8→d10→d12→d20) or stack Blinded /
 * Poisoned conditions on top of the always-applied Dazed.
 *
 * Resource consumption (Beastshift charges) is the player's responsibility
 * — the macro records the spend in the chat card flavor only.
 *
 * Optional conditions (Blinded / Poisoned) are stashed on an actor flag and
 * re-applied by the `nimble.useItem` hook below if the activation lands
 * (i.e. is not a miss).
 */
async function sporeAttack(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] sporeAttack: missing actor or item.`);
		return null;
	}

	const has = (id) => actor.items?.some((i) => i.system?.identifier === id);
	const hasGermination = has('germination');
	const hasMycelium = has('mycelium-growth');
	const hasSporulation = has('sporulation');
	const hasDecay = has('decay');

	const dieSizes = [4, 6, 8, 10, 12, 20];
	let baseDieCount = 1;
	let baseDieSize = 4;
	let reach = 2;
	let stage = 'Sporesphere (base)';
	if (hasSporulation) {
		baseDieCount = 2;
		baseDieSize = 8;
		reach = 6;
		stage = 'Sporulation';
	} else if (hasMycelium) {
		baseDieCount = 1;
		baseDieSize = 8;
		reach = 4;
		stage = 'Mycelium Growth';
	} else if (hasGermination) {
		baseDieCount = 1;
		baseDieSize = 6;
		reach = 3;
		stage = 'Germination';
	}

	let dialogContent = `<form class="nim-plus-spore-dialog">
		<p><strong>${escape(stage)}</strong> — base damage <code>${baseDieCount}d${baseDieSize}</code> necrotic, Reach ${reach}. Target is Dazed on hit.</p>`;

	if (hasDecay) {
		dialogContent += `
		<hr>
		<p><strong>Decay (L7).</strong> Spend Beastshift charges. Each charge bumps the die size or applies a condition:</p>
		<div class="form-group"><label>Die-size bumps</label><input type="number" name="dieBumps" value="0" min="0" max="${dieSizes.length - 1}" /></div>
		<div class="form-group"><label><input type="checkbox" name="blinded"> Apply <strong>Blinded</strong> (1 charge)</label></div>
		<div class="form-group"><label><input type="checkbox" name="poisoned"> Apply <strong>Poisoned</strong> (1 charge)</label></div>
		<p style="opacity:0.75;font-size:0.85em;">Beastshift consumption is tracked manually — the chat card will note the spend.</p>`;
	}

	dialogContent += `</form>`;

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Cast Sporesphere` },
		content: dialogContent,
		buttons: [
			{
				action: 'cast',
				label: 'Cast',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-spore-dialog');
					if (!form) return { cast: true };
					const dieBumps = Number(form.elements.dieBumps?.value ?? 0) || 0;
					const blinded = !!form.elements.blinded?.checked;
					const poisoned = !!form.elements.poisoned?.checked;
					return { cast: true, dieBumps, blinded, poisoned };
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice?.cast) return null;

	const dieBumps = Math.max(0, Math.min(choice.dieBumps ?? 0, dieSizes.length - 1));
	let dieSize = baseDieSize;
	if (dieBumps > 0) {
		const baseIndex = dieSizes.indexOf(baseDieSize);
		const newIndex = Math.min(baseIndex + dieBumps, dieSizes.length - 1);
		dieSize = dieSizes[newIndex];
	}

	const finalFormula = `${baseDieCount}d${dieSize}`;
	const charges = dieBumps + (choice.blinded ? 1 : 0) + (choice.poisoned ? 1 : 0);

	const pendingConditions = [];
	if (choice.blinded) pendingConditions.push('blinded');
	if (choice.poisoned) pendingConditions.push('poisoned');

	if (pendingConditions.length > 0) {
		await actor.setFlag(MODULE_ID, 'sporePendingConditions', pendingConditions);
	} else {
		// Clear stale state from a prior cast.
		if (actor.getFlag(MODULE_ID, 'sporePendingConditions') !== undefined) {
			await actor.unsetFlag(MODULE_ID, 'sporePendingConditions');
		}
	}

	if (charges > 0) {
		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>${escape(item.name)}</strong> — ${escape(stage)} (Decay)`,
			content: `<p>${escape(actor.name)} expends <strong>${charges}</strong> Beastshift charge${charges === 1 ? '' : 's'} on Sporesphere — final damage <code>${escape(finalFormula)}</code>${pendingConditions.length > 0 ? `, +${pendingConditions.map((c) => c[0].toUpperCase() + c.slice(1)).join(', ')} on hit` : ''}.</p>`,
		});
	}

	return item.activate({ executeMacro: false, fastForward: true, rollFormula: finalFormula });
}

/**
 * After Sporesphere lands (any non-miss outcome), apply any optional
 * conditions the player picked in the dialog (Blinded / Poisoned). Dazed is
 * handled by the activation rules on the item itself.
 */
Hooks.on('nimble.useItem', (item, _chatCard, context) => {
	if (!item || item.type !== 'feature') return;
	if (item.system?.identifier !== 'sporesphere') return;
	const actor = item.actor;
	if (!actor) return;

	const pending = actor.getFlag?.(MODULE_ID, 'sporePendingConditions');
	if (!Array.isArray(pending) || pending.length === 0) return;

	// Clear the flag immediately — it's a one-shot per cast regardless of outcome.
	actor.unsetFlag(MODULE_ID, 'sporePendingConditions').catch(() => {});

	if (context?.isMiss) return;

	const targets = Array.from(context?.targets ?? []);
	if (targets.length === 0) return;

	for (const target of targets) {
		const targetActor = target?.actor;
		if (!targetActor) continue;
		for (const conditionId of pending) {
			if (targetActor.statuses?.has(conditionId)) continue;
			Promise.resolve(
				targetActor.toggleStatusEffect(conditionId, { active: true }),
			).catch((error) => {
				console.error(
					`[${MODULE_ID}] Failed to apply ${conditionId} to ${targetActor.name}`,
					error,
				);
			});
		}
	}
});

/**
 * Clear Seasoned Journeyman state on Safe Rest. The Shepherd reselects on
 * each Safe Rest, so the flag is wiped here and re-set when they activate
 * the feature again.
 */
Hooks.on('nimble.rest', (payload) => {
	if (payload?.restType !== 'safe') return;
	const actor = payload.actor;
	if (!actor) return;
	if (actor.getFlag?.(MODULE_ID, 'journeymanChoice') === undefined) return;
	Promise.all([
		actor.unsetFlag(MODULE_ID, 'journeymanChoice'),
		actor.unsetFlag(MODULE_ID, 'journeymanBonus'),
	]).catch((error) => {
		console.error(`[${MODULE_ID}] Failed to clear Seasoned Journeyman flags on Safe Rest`, error);
	});
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Psion — Strain Dice runtime
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The Psion's Strain Dice is a pool of dice (d6 → d8@L5 → d10@L10 → d12@L17)
 * accumulated by using Psionic Abilities. At end of turn the pool is rolled;
 * any die showing a 1 breaks Concentration, deals the sum of all dice as
 * psychic damage to the Psion, and Incapacitates them until next turn.
 *
 * State is stored as an integer flag — `flags['nim-plus-package'].psion.strainDice`.
 */

const STRAIN_FLAG = 'psion.strainDice';

function strainGetDieSize(actor) {
	if (!actor) return 6;
	const psion = actor.items?.find?.((i) => i.type === 'class' && i.system?.identifier === 'psion');
	const level = Number(psion?.system?.classLevel ?? 0);
	if (level >= 17) return 12;
	if (level >= 10) return 10;
	if (level >= 5) return 8;
	return 6;
}

async function strainGain(actor, n = 1) {
	if (!actor) return 0;
	const count = Math.max(0, Math.floor(Number(n) || 0));
	if (count === 0) return Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const current = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const next = current + count;
	const size = strainGetDieSize(actor);
	await actor.setFlag(MODULE_ID, STRAIN_FLAG, next);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain +${count}</strong>`,
		content: `<p>${escape(actor.name)}: <strong>${next}</strong> Strain Die${next === 1 ? '' : 's'} (d${size}).</p>`,
	});
	return next;
}

async function strainLose(actor, n = 1) {
	if (!actor) return 0;
	const count = Math.max(0, Math.floor(Number(n) || 0));
	const current = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	if (current === 0 || count === 0) return current;
	const next = Math.max(0, current - count);
	const size = strainGetDieSize(actor);
	await actor.setFlag(MODULE_ID, STRAIN_FLAG, next);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain −${current - next}</strong>`,
		content: `<p>${escape(actor.name)}: <strong>${next}</strong> Strain Die${next === 1 ? '' : 's'} (d${size}).</p>`,
	});
	return next;
}

async function strainClear(actor) {
	if (!actor) return;
	if (actor.getFlag(MODULE_ID, STRAIN_FLAG) === undefined) return;
	await actor.unsetFlag(MODULE_ID, STRAIN_FLAG);
}

/**
 * Inject a persistent Strain Dice widget into the Psion's character sheet.
 * Renders only when the actor has the Psion class. Sits inside the defense
 * section (where Mana would go if the class had mana), with +/− buttons and
 * a "Roll" button wired to the strain helpers.
 *
 * Re-renders on `updateActor` when the strainDice flag changes — patches the
 * existing widget in-place rather than calling sheet.render(), to avoid
 * blowing away other in-flight sheet state.
 */
const STRAIN_WIDGET_CLASS = 'nim-plus-strain';
const STRAIN_STYLE_ID = 'nim-plus-strain-styles';

const STRAIN_WIDGET_CSS = `
	.nim-plus-strain {
		--strain-accent: #39d6c8;
		--strain-accent-warm: #9b6dff;
		display: block;
		width: 100%;
		box-sizing: border-box;
		/* Span all columns/rows whether the parent is CSS grid or flex */
		grid-column: 1 / -1;
		flex: 1 1 100%;
		margin: 0.5rem 0;
		padding: 0.55rem 0.7rem 0.6rem;
		background:
			linear-gradient(135deg, rgba(57, 214, 200, 0.08), rgba(155, 109, 255, 0.08)),
			var(--color-bg, transparent);
		border: 1px solid rgba(57, 214, 200, 0.35);
		border-radius: 6px;
		box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.15);
	}
	.nim-plus-strain__header {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.45rem;
		font-size: 1em;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-primary, inherit);
	}
	.nim-plus-strain__icon {
		color: var(--strain-accent-warm);
		opacity: 0.9;
	}
	.nim-plus-strain__die {
		margin-left: auto;
		font-size: 0.7em;
		font-weight: 600;
		letter-spacing: 0.08em;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(57, 214, 200, 0.18);
		color: var(--color-text-primary, inherit);
		border: 1px solid rgba(57, 214, 200, 0.3);
	}
	.nim-plus-strain__row {
		display: flex;
		align-items: stretch;
		gap: 0.45rem;
	}
	.nim-plus-strain__btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 38px;
		padding: 0;
		border: 1px solid var(--color-border-light-2, rgba(0,0,0,0.2));
		background: var(--color-bg-button, rgba(255,255,255,0.06));
		color: var(--color-text-primary, inherit);
		border-radius: 6px;
		cursor: pointer;
		font-size: 1em;
		font-weight: 600;
		line-height: 1;
		transition: background 0.15s, border-color 0.15s, transform 0.08s;
	}
	.nim-plus-strain__btn:hover {
		background: rgba(57, 214, 200, 0.22);
		border-color: var(--strain-accent);
	}
	.nim-plus-strain__btn:active {
		transform: translateY(1px);
	}
	.nim-plus-strain__btn--roll {
		flex: 1 1 auto;
		gap: 0.4rem;
		width: auto;
		padding: 0 0.8rem;
		background: linear-gradient(180deg, rgba(57, 214, 200, 0.2), rgba(155, 109, 255, 0.18));
		border-color: rgba(57, 214, 200, 0.5);
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.nim-plus-strain__btn--roll:hover {
		background: linear-gradient(180deg, rgba(57, 214, 200, 0.35), rgba(155, 109, 255, 0.3));
	}
	.nim-plus-strain__count {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 3rem;
		padding: 0 0.6rem;
		font-size: 1.8em;
		font-weight: 900;
		line-height: 1;
		color: var(--color-text-primary, inherit);
		background: rgba(0,0,0,0.18);
		border: 1px solid rgba(57, 214, 200, 0.4);
		border-radius: 6px;
		text-shadow: 0 1px 2px rgba(0,0,0,0.4);
		font-variant-numeric: tabular-nums;
		transition: color 0.2s, border-color 0.2s, background 0.2s;
	}
	.nim-plus-strain[data-state="empty"] .nim-plus-strain__count {
		opacity: 0.45;
	}
	.nim-plus-strain[data-state="risky"] .nim-plus-strain__count {
		color: #f9d27a;
		border-color: rgba(249, 210, 122, 0.55);
		background: rgba(249, 210, 122, 0.08);
	}
	.nim-plus-strain[data-state="danger"] .nim-plus-strain__count {
		color: #ff8c6e;
		border-color: rgba(255, 140, 110, 0.7);
		background: rgba(255, 140, 110, 0.1);
		/* No keyframe animation — animating box-shadow forces full repaints
		   every frame in Firefox. Color shift alone is sufficient warning. */
	}
`;

function ensureStrainStyles() {
	if (document.getElementById(STRAIN_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STRAIN_STYLE_ID;
	style.textContent = STRAIN_WIDGET_CSS;
	document.head.append(style);
}

function strainState(count) {
	if (count <= 0) return 'empty';
	if (count <= 2) return 'active';
	if (count <= 4) return 'risky';
	return 'danger';
}

function actorIsPsion(actor) {
	return !!actor?.items?.some?.((i) => i.type === 'class' && i.system?.identifier === 'psion');
}

function renderStrainWidget(actor) {
	const count = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const size = strainGetDieSize(actor);
	const state = strainState(count);
	return `
		<section class="${STRAIN_WIDGET_CLASS}" data-actor-id="${escape(actor.id)}" data-state="${state}">
			<h3 class="${STRAIN_WIDGET_CLASS}__header">
				<i class="fa-solid fa-brain ${STRAIN_WIDGET_CLASS}__icon"></i>
				<span>Strain</span>
				<span class="${STRAIN_WIDGET_CLASS}__die">d${size}</span>
			</h3>
			<div class="${STRAIN_WIDGET_CLASS}__row">
				<button type="button" class="${STRAIN_WIDGET_CLASS}__btn" data-nim-plus-strain="lose" aria-label="Lose 1 Strain Die" data-tooltip="Lose 1 Strain Die">
					<i class="fa-solid fa-minus"></i>
				</button>
				<div class="${STRAIN_WIDGET_CLASS}__count" data-count="${count}">${count}</div>
				<button type="button" class="${STRAIN_WIDGET_CLASS}__btn" data-nim-plus-strain="gain" aria-label="Gain 1 Strain Die" data-tooltip="Gain 1 Strain Die">
					<i class="fa-solid fa-plus"></i>
				</button>
				<button type="button" class="${STRAIN_WIDGET_CLASS}__btn ${STRAIN_WIDGET_CLASS}__btn--roll" data-nim-plus-strain="roll" aria-label="Roll all Strain Dice" data-tooltip="Roll all Strain Dice (any 1 breaks Concentration)">
					<i class="fa-solid fa-dice"></i> Roll
				</button>
			</div>
		</section>
	`;
}

function wireStrainWidget(widgetEl, actor) {
	widgetEl.querySelectorAll('[data-nim-plus-strain]').forEach((btn) => {
		btn.addEventListener('click', async (event) => {
			event.preventDefault();
			const action = btn.dataset.nimPlusStrain;
			if (action === 'gain') await strainGain(actor, 1);
			else if (action === 'lose') await strainLose(actor, 1);
			else if (action === 'roll') await strainRoll(actor);
		});
	});
}

function injectStrainWidget(app, html) {
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor)) return;
	if (!actorIsPsion(actor)) return;

	const root = html instanceof HTMLElement ? html : html?.[0];
	if (!root) return;

	// Remove any prior widget (re-render case) before re-injecting.
	root.querySelectorAll(`.${STRAIN_WIDGET_CLASS}`).forEach((el) => el.remove());

	const anchor =
		root.querySelector('.nimble-character-sheet-section--defense') ??
		root.querySelector('.nimble-sheet__header') ??
		root.querySelector('section');
	if (!anchor) return;

	const wrapper = document.createElement('div');
	wrapper.innerHTML = renderStrainWidget(actor).trim();
	const widget = wrapper.firstElementChild;
	if (!widget) return;
	anchor.append(widget);
	wireStrainWidget(widget, actor);
}

Hooks.on('renderPlayerCharacterSheet', (app, html) => {
	injectStrainWidget(app, html);
});

// Live-update the widget when the strain flag changes (gain/lose/roll/clear).
// Catches both set-and-unset paths: setFlag writes `flags.<id>.psion.strainDice`,
// while unsetFlag writes `flags.<id>.psion.-=strainDice` (Foundry's deletion
// marker). Either pattern (or any change under `flags.<id>.psion`) triggers
// the patch — the widget always re-reads the current value, so no-op updates
// are cheap.
Hooks.on('updateActor', (actor, changes) => {
	if (!actorIsPsion(actor)) return;
	const ourFlagChange = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.psion`);
	const ourFlagDeletion = foundry.utils.getProperty(changes, `flags.${MODULE_ID}.-=psion`);
	if (ourFlagChange === undefined && ourFlagDeletion === undefined) return;
	for (const app of Object.values(actor.apps ?? {})) {
		if (!app?.element) continue;
		const root = app.element instanceof HTMLElement ? app.element : app.element?.[0];
		const widget = root?.querySelector?.(`.${STRAIN_WIDGET_CLASS}[data-actor-id="${actor.id}"]`);
		if (!widget) {
			// Widget hasn't been rendered yet for this app — inject fresh.
			injectStrainWidget(app, root);
			continue;
		}
		const count = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
		const size = strainGetDieSize(actor);
		const countEl = widget.querySelector(`.${STRAIN_WIDGET_CLASS}__count`);
		const dieEl = widget.querySelector(`.${STRAIN_WIDGET_CLASS}__die`);
		if (countEl) {
			countEl.textContent = String(count);
			countEl.dataset.count = String(count);
		}
		if (dieEl) dieEl.textContent = `d${size}`;
		widget.dataset.state = strainState(count);
	}
});

/**
 * Post the actor's current Strain Dice pool to chat. Useful as a console
 * helper for players to check their count at any time:
 *     nimPlus.strain.show(actor)
 */
function strainShow(actor) {
	if (!actor) return null;
	const count = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const size = strainGetDieSize(actor);
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain</strong>`,
		content: `<p>${escape(actor.name)}: <strong>${count}</strong> Strain Die${count === 1 ? '' : 's'} (d${size}).</p>`,
	});
	return { count, size };
}

/**
 * Roll all active Strain Dice. Returns `{ rolled, broken }` where `rolled` is
 * an array of integers and `broken` is true iff any die rolled a 1.
 *
 * Side effects: posts a chat card with the roll, and if any die rolls a 1
 * AND the Psion does NOT own `new-core-ability` (or rolled more than one 1),
 * toggles off the Concentration status — which fires the deleteActiveEffect
 * handler below to apply the break consequences.
 */
async function strainRoll(actor) {
	if (!actor) return { rolled: [], broken: false };
	const count = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	if (count === 0) return { rolled: [], broken: false };

	const size = strainGetDieSize(actor);
	const formula = `${count}d${size}`;
	const roll = await new Roll(formula).evaluate();
	const rolled = roll.dice[0]?.results?.map((r) => r.result) ?? [];
	const onesCount = rolled.filter((v) => v === 1).length;

	const hasNewCore = actor.items?.some?.((i) => i.system?.identifier === 'new-core-ability');
	// New Core Ability ignores exactly 1 die rolled a 1. With one 1 it absorbs
	// the break; with two or more, one is ignored and the rest still break.
	const broken = hasNewCore ? onesCount > 1 : onesCount >= 1;

	const display = rolled
		.map((v) => (v === 1 ? `<strong style="color:#a32;">${v}</strong>` : String(v)))
		.join(', ');

	await roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Strain Roll</strong> — ${count}d${size}${hasNewCore && onesCount === 1 ? ' · <em>New Core Ability absorbs the 1</em>' : ''}`,
		content: `<p>Results: ${display}. Sum: <strong>${roll.total}</strong>.</p>`,
	});

	if (broken && actor.statuses?.has('concentration')) {
		// Stash the already-rolled dice so the deleteActiveEffect handler can
		// re-use them as the psychic-damage roll — per PDF, the break and the
		// damage come from the *same* roll, not two separate rolls.
		await actor.setFlag(MODULE_ID, 'psion.strainBreakInflight', {
			rolled,
			sum: roll.total,
		});
		await actor.toggleStatusEffect('concentration', { active: false });
	}

	return { rolled, broken };
}

/**
 * End-of-turn auto-roll for the Psion. Fires on the system-emitted
 * `nimbleCombatTurnEnd` (combat.svelte.ts:692). Only acts when the actor has
 * an active Psionic Field. If they also own `i-can-hold`, sheds 1 Strain Die
 * BEFORE the roll (player-friendly ordering — losing first reduces both the
 * sum and the chance of a 1).
 */
Hooks.on('nimbleCombatTurnEnd', async (combatant) => {
	const actor = combatant?.actor;
	if (!actor) return;
	const has = (id) => actor.items?.some?.((i) => i.system?.identifier === id);
	if (!has('psionic-field')) return;
	if (has('i-can-hold')) await strainLose(actor, 1);
	await strainRoll(actor);
});

/**
 * Concentration-break handler — the system has no `nimble.conditionRemoved`
 * hook, so we listen to Foundry core's `deleteActiveEffect` and filter for
 * concentration on a combatant actor. When concentration ends mid-combat
 * with any Strain Dice on the pool, roll them as psychic damage, Incapacitate
 * the Psion, and fire a downstream hook for subclass reactors.
 *
 * The roll here is separate from `strainRoll` — that one fires every turn
 * and only breaks on a 1; this one fires the consequence regardless of how
 * the break happened (an enemy disrupted the field, the player ended it, the
 * turn-end roller rolled a 1).
 */
Hooks.on('deleteActiveEffect', (effect, _options, userId) => {
	if (userId !== game.user.id) return; // run once per concentration end
	if (!effect?.statuses?.has?.('concentration')) return;
	const actor = effect.parent;
	if (!(actor instanceof Actor)) return;
	if (actor.items?.some?.((i) => i.system?.identifier === 'psionic-field') !== true) return;
	if (!game.combat?.combatants?.some?.((c) => c.actorId === actor.id)) return;

	const strainCount = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const inflight = actor.getFlag(MODULE_ID, 'psion.strainBreakInflight');
	const isInvoluntaryBreak = !!inflight;

	// Always clear strain when Concentration ends — per the PDF, "all Psionic
	// effects cease" when the field drops, so the Strain Dice pool resets
	// regardless of whether the break was voluntary (player toggle) or
	// involuntary (a 1 rolled). Break consequences (psychic damage,
	// Incapacitated, subclass reactor hook) only fire on involuntary breaks.
	(async () => {
		try {
			if (!isInvoluntaryBreak) {
				// Voluntary end of the field — just clear strain silently.
				if (strainCount > 0) await strainClear(actor);
				return;
			}

			const size = strainGetDieSize(actor);
			const rolled =
				inflight && Array.isArray(inflight.rolled) && inflight.rolled.length > 0
					? inflight.rolled
					: null;
			await actor.unsetFlag(MODULE_ID, 'psion.strainBreakInflight');

			let resolvedRolled = rolled;
			let chatRoll = null;
			if (!resolvedRolled) {
				const freshRoll = await new Roll(`${strainCount}d${size}`).evaluate();
				resolvedRolled = freshRoll.dice[0]?.results?.map((r) => r.result) ?? [];
				chatRoll = freshRoll;
			}

			let sum = resolvedRolled.reduce((acc, v) => acc + v, 0);
			const hasMOM2 = actor.items?.some?.((i) => i.system?.identifier === 'mind-over-matter-2');
			let droppedNote = '';
			if (hasMOM2 && resolvedRolled.length > 0) {
				const sorted = [...resolvedRolled].sort((a, b) => b - a);
				const dropped = sorted[0];
				sum = sum - dropped;
				droppedNote = ` · <em>Mind Over Matter (2) ignores highest die (${dropped})</em>`;
			}

			const messagePayload = {
				speaker: ChatMessage.getSpeaker({ actor }),
				flavor: `<strong>Concentration Breaks</strong> — ${strainCount}d${size}${droppedNote}`,
				content: `<p>Results: ${resolvedRolled.join(', ')}. Psychic damage to ${escape(actor.name)}: <strong>${sum}</strong>.</p><p><em>Apply damage and Incapacitate until the start of ${escape(actor.name)}'s next turn.</em></p>`,
			};
			if (chatRoll) {
				await chatRoll.toMessage(messagePayload);
			} else {
				await ChatMessage.create(messagePayload);
			}

			await actor.toggleStatusEffect('incapacitated', { active: true });
			Hooks.callAll('nim-plus-package.concentration-broken', {
				actor,
				strainSum: sum,
				strainCount,
				rolled: resolvedRolled,
			});
			await strainClear(actor);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to resolve concentration break`, error);
		}
	})();
});

/**
 * Subclass reactors — Mind Collapse / Reverberating Mind / Mind Shield / Big
 * Mind. Single listener inspects what the broken Psion owns and posts the
 * appropriate prompts/auto-applications.
 */
Hooks.on('nim-plus-package.concentration-broken', ({ actor, strainSum }) => {
	const has = (id) => actor.items?.some?.((i) => i.system?.identifier === id);

	if (has('mind-collapse')) {
		const hasBig = has('big-mind');
		const hasReverb = has('reverberating-mind');
		const reach = hasBig ? 12 : hasReverb ? 6 : 3;
		const diceToRedirect = hasBig ? 3 : 2;
		const extraTargets = hasBig ? 1 : 0;
		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>Mind Collapse</strong>`,
			content: `<p>Choose up to <strong>${diceToRedirect}</strong> Strain Dice from the break roll. Redirect that damage to an enemy within Reach <strong>${reach}</strong>${extraTargets > 0 ? ` (plus 1 additional enemy)` : ''}. If no enemy is in range, ${escape(actor.name)} takes the full damage as normal.</p>`,
		});
	}

	if (has('mind-shield')) {
		const hasBig = has('big-mind');
		const reach = hasBig ? 12 : 6;
		const wil = Math.max(1, Number(actor.system?.abilities?.will?.mod ?? 1));
		const targets = Array.from(game.user?.targets ?? []);
		const taunted = [];
		for (const t of targets.slice(0, wil)) {
			const target = t?.actor;
			if (!target) continue;
			if (target.statuses?.has?.('taunted')) continue;
			Promise.resolve(target.toggleStatusEffect('taunted', { active: true })).catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply Taunted via Mind Shield`, error);
			});
			taunted.push(target.name);
		}
		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>Mind Shield</strong>`,
			content: `<p>Taunt up to <strong>${wil}</strong> creatures within Reach <strong>${reach}</strong> for 1 round. ${taunted.length > 0 ? `Auto-applied to: <em>${taunted.map(escape).join(', ')}</em>.` : '<em>Select targets first to auto-apply Taunted; otherwise apply manually.</em>'} You may Defend for free while Incapacitated; the first attacker takes <strong>${strainSum}</strong> psychic damage.</p>`,
		});
	}
});

/**
 * End-of-encounter cleanup — wipe any lingering Strain Dice flag when combat
 * ends so the next encounter starts fresh.
 */
Hooks.on('deleteCombat', (combat) => {
	for (const c of combat.combatants ?? []) {
		const actor = c.actor;
		if (actor?.getFlag?.(MODULE_ID, STRAIN_FLAG) !== undefined) {
			strainClear(actor).catch(() => {});
		}
	}
});

/**
 * Mirage (2) dispatcher — Adept of Illusions L11. Pop a dialog letting the
 * player pick Disguise (enemy gets Blinded/Taunted/Prone) or Distortion
 * (ally gets Full Cover / Invisible / Fear-source), then apply the chosen
 * status to currently-targeted tokens.
 *
 * Foundry/Nimble status IDs used: blinded, taunted, prone, invisible.
 * "Full Cover" and "Fear-source" don't have native status IDs — they're
 * applied narratively and noted in the chat card.
 */
async function mirageDispatch(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] mirageDispatch: missing actor or item.`);
		return null;
	}

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Choose an Effect` },
		content: `
			<form class="nim-plus-mirage-dialog">
				<p>Mirage (2): choose one effect to apply to your selected targets.</p>
				<fieldset>
					<legend><strong>Disguise</strong> (lower-level enemy; same/higher level WIL save)</legend>
					<label><input type="radio" name="effect" value="blinded" checked> Blinded</label>
					<label><input type="radio" name="effect" value="taunted"> Taunted</label>
					<label><input type="radio" name="effect" value="prone"> Prone</label>
				</fieldset>
				<fieldset>
					<legend><strong>Distortion</strong> (willing ally)</legend>
					<label><input type="radio" name="effect" value="cover"> Full Cover</label>
					<label><input type="radio" name="effect" value="invisible"> Invisible</label>
					<label><input type="radio" name="effect" value="fear"> Source of Fear</label>
				</fieldset>
			</form>
		`,
		buttons: [
			{
				action: 'apply',
				label: 'Apply',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-mirage-dialog');
					if (!form) return null;
					const checked = form.querySelector('input[name="effect"]:checked');
					return checked?.value ?? null;
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice) return null;

	const targets = Array.from(game.user?.targets ?? []);
	const statusForEffect = { blinded: 'blinded', taunted: 'taunted', prone: 'prone', invisible: 'invisible' };
	const statusId = statusForEffect[choice];
	const applied = [];

	if (statusId) {
		for (const t of targets) {
			const target = t?.actor;
			if (!target) continue;
			if (target.statuses?.has?.(statusId)) continue;
			Promise.resolve(target.toggleStatusEffect(statusId, { active: true })).catch((error) => {
				console.error(`[${MODULE_ID}] Failed to apply ${statusId} via Mirage (2)`, error);
			});
			applied.push(target.name);
		}
	}

	const effectLabels = {
		blinded: 'Disguise — Blinded',
		taunted: 'Disguise — Taunted',
		prone: 'Disguise — Prone',
		cover: 'Distortion — Full Cover',
		invisible: 'Distortion — Invisible',
		fear: 'Distortion — Source of Fear',
	};
	const label = effectLabels[choice] ?? choice;

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — ${escape(label)}`,
		content: `<p>${applied.length > 0 ? `Auto-applied to: <em>${applied.map(escape).join(', ')}</em>.` : '<em>No status applied automatically — target the affected tokens before activating, or apply manually for Full Cover / Source of Fear.</em>'}</p>`,
	});
}

/**
 * Psionic Field Attack (Psion, L1) — telekinetic attack with an unheld light
 * weapon or object within the Psion's Psionic Field. Per the PDF, the Psion
 * is proficient with these attacks and they deal +WIL damage on top of the
 * weapon's normal damage. If the Psion has also learned **Psionic Strike**,
 * +1 damage per current Strain Die is added automatically (the per-die rider
 * from Psionic Strike's text).
 *
 * Pops a dialog listing the actor's weapon-objects (any owned Item of type
 * `object`/`weapon` with an activation effect that has a `formula`) plus a
 * free-text "improvised" row for objects you haven't cataloged.
 *
 * Warns (but does not block) if Concentration isn't active — sometimes the
 * GM will run a scene where the field is active but the status hasn't been
 * applied yet.
 *
 * Form-parse uses `button.form.elements` (Foundry's documented DialogV2
 * pattern) rather than nested-form querySelector — DialogV2 wraps `content`
 * in its own form alongside the buttons, so the buttons share that form.
 */
async function psionicFieldAttack(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] psionicFieldAttack: missing actor or item.`);
		return null;
	}

	if (!actor.statuses?.has?.('concentration')) {
		ui.notifications?.warn(
			`[${MODULE_ID}] Psionic Field isn't active — the +WIL damage assumes Concentration is up.`,
		);
	}

	const wil = Number(actor.system?.abilities?.will?.mod ?? 0);
	const wilLabel = wil >= 0 ? `+${wil}` : String(wil);

	// Psionic Strike rider — +1 dmg per Strain Die when the ability is owned.
	const hasStrike = actor.items?.some?.((i) => i.system?.identifier === 'psionic-strike');
	const strainCount = Number(actor.getFlag(MODULE_ID, STRAIN_FLAG) ?? 0);
	const strikeBonus = hasStrike ? strainCount : 0;

	// Collect owned items with a damage-formula effect (objects or weapons).
	const items = actor.items?.contents ?? Array.from(actor.items ?? []);
	const weaponData = [];
	for (const i of items) {
		if (i.type !== 'object' && i.type !== 'weapon') continue;
		const effects = i.system?.activation?.effects;
		if (!Array.isArray(effects)) continue;
		const eff = effects.find((e) => e && e.formula);
		if (!eff) continue;
		weaponData.push({
			name: i.name,
			formula: eff.formula,
			damageType: eff.damageType ?? '',
		});
	}

	const rows = weaponData
		.map((w, idx) => {
			const dmgType = w.damageType ? ` <em style="opacity:0.7;">${escape(w.damageType)}</em>` : '';
			return `<label style="display:block;padding:4px 0;"><input type="radio" name="weapon" value="${idx}"${idx === 0 ? ' checked' : ''}> <strong>${escape(w.name)}</strong> — <code>${escape(w.formula)}</code>${dmgType}</label>`;
		})
		.join('');

	const manualRowChecked = weaponData.length === 0 ? ' checked' : '';

	const strikeNote = hasStrike
		? `<p style="opacity:0.75;font-size:0.9em;"><em>Psionic Strike</em> active — adds <strong>+${strikeBonus}</strong> damage (1 per Strain Die; current pool: ${strainCount}).</p>`
		: '';

	const strikeAdvantageRow = hasStrike
		? `<label style="display:block;padding:4px 0;border-top:1px solid #aaa;margin-top:6px;padding-top:8px;"><input type="checkbox" name="strikeAdvantage"> <strong>Spend 1 Strain → roll with Advantage</strong> <em style="opacity:0.7;font-size:0.85em;">(Psionic Strike — also +1 damage from the new die)</em></label>`
		: '';

	// Note: NO outer <form> — Foundry's DialogV2 wraps the content + buttons
	// in its own form, so `button.form` resolves to that wrapper, and any
	// inner <form> would be flattened by the browser anyway.
	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `${item.name} — Field Attack` },
		content: `
			<div class="nim-plus-psion-field-attack">
				<p>Pick an unheld light weapon or object in your field. The roll adds <strong>${wilLabel} WIL</strong> damage.</p>
				${rows}
				<label style="display:block;padding:4px 0;border-top:1px solid #aaa;margin-top:6px;padding-top:8px;"><input type="radio" name="weapon" value="__manual"${manualRowChecked}> <strong>Other / improvised</strong> — formula: <input type="text" name="manualFormula" value="1d4" style="width:120px;"> damage type: <input type="text" name="manualType" value="bludgeoning" style="width:100px;"></label>
				${strikeNote}
				${strikeAdvantageRow}
			</div>
		`,
		buttons: [
			{
				action: 'roll',
				label: 'Roll',
				default: true,
				callback: (_event, button) => {
					const form = button?.form;
					if (!form) return { error: 'no-form' };
					const value = form.elements.weapon?.value;
					if (!value) return { error: 'no-weapon-selected' };
					const strikeAdvantage = !!form.elements.strikeAdvantage?.checked;
					if (value === '__manual') {
						return {
							manual: true,
							formula: form.elements.manualFormula?.value?.trim() || '1d4',
							damageType: form.elements.manualType?.value?.trim() || '',
							strikeAdvantage,
						};
					}
					return { manual: false, idx: Number(value), strikeAdvantage };
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => ({ cancelled: true }) },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice || choice.cancelled) return null;
	if (choice.error) {
		ui.notifications?.error(`[${MODULE_ID}] Field Attack dialog: ${choice.error}.`);
		return null;
	}

	let formula;
	let damageType = '';
	let weaponLabel;
	if (choice.manual) {
		formula = choice.formula;
		damageType = choice.damageType;
		weaponLabel = 'Improvised';
	} else {
		const w = weaponData[choice.idx];
		if (!w) {
			ui.notifications?.error(`[${MODULE_ID}] No weapon at index ${choice.idx}.`);
			return null;
		}
		formula = w.formula;
		damageType = w.damageType;
		weaponLabel = w.name;
	}

	// Psionic Strike's "spend 1 Strain → advantage" rider. Gaining the strain
	// FIRST means the new die is included in the +1/die damage bonus for
	// this attack (player-friendly reading of the PDF's ordering).
	let effectiveStrikeBonus = strikeBonus;
	let rollMode = 0;
	if (choice.strikeAdvantage && hasStrike) {
		await strainGain(actor, 1);
		effectiveStrikeBonus = strikeBonus + 1;
		rollMode = 1;
	}

	const combinedFormula =
		effectiveStrikeBonus > 0
			? `${formula} + @abilities.will.mod + ${effectiveStrikeBonus}`
			: `${formula} + @abilities.will.mod`;

	// Inject a damage effect with the correct damageType into the item's
	// prepared activation data — IN-MEMORY ONLY, not via item.update(). The
	// activation manager (Nimble: ItemActivationManager constructor) does a
	// deepClone of `item.system.activation` at construction time, so this
	// mutation is captured per-cast. Using item.update() here would race
	// with Foundry's data-preparation pipeline and cause the first cast for
	// each new weapon to land with empty / stale effects (no dice rolled).
	// Non-persistent: next sheet render restores the placeholder from
	// _source, but every cast re-injects this anyway.
	const targetDamageType = damageType || 'bludgeoning';
	if (item.system?.activation) {
		item.system.activation.effects = [
			{
				id: 'psionFieldAtkDmg1',
				type: 'damage',
				damageType: targetDamageType,
				formula: '1d4 + @abilities.will.mod',
				parentContext: null,
				parentNode: null,
				on: {
					hit: [
						{
							id: 'psionFieldAtkHit1',
							type: 'damageOutcome',
							outcome: 'fullDamage',
							parentContext: 'hit',
							parentNode: 'psionFieldAtkDmg1',
						},
					],
				},
				canCrit: true,
				canMiss: true,
			},
		];
	}

	// Announce the weapon used in chat before the activation card lands, so
	// every Psionic Field Attack roll is clearly labeled with WHICH weapon
	// (and any modifiers) — the activation card on its own just says the
	// feature name, which doesn't surface the per-cast choice.
	const announcementBits = [`<em>${escape(weaponLabel)}</em>${damageType ? ` (${escape(damageType)})` : ''}`];
	announcementBits.push(`<span style="opacity:0.8;">+ ${wilLabel} WIL</span>`);
	if (effectiveStrikeBonus > 0) {
		announcementBits.push(`<span style="opacity:0.8;">+ ${effectiveStrikeBonus} Psionic Strike</span>`);
	}
	if (rollMode === 1) {
		announcementBits.push(`<span style="opacity:0.8;color:#39d6c8;">Advantage (Strain spent)</span>`);
	}
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>${escape(actor.name)} hurls ${announcementBits.join(' · ')}.</p>`,
	});

	// Hand off to Nimble's activation flow so the player can target a token,
	// the damage roll lands in the standard chat card, and the GM/player can
	// click "Apply Damage" on the card. `executeMacro: false` prevents
	// re-entering this macro; `rollFormula` overrides the feature's
	// placeholder damage with our weapon+WIL+Strike formula; `rollMode: 1`
	// pipes advantage into both the attack roll and the damage roll.
	return item.activate({
		executeMacro: false,
		fastForward: true,
		rollFormula: combinedFormula,
		rollMode,
	});
}

function escape(str) {
	return String(str ?? '').replace(/[&<>"']/g, (ch) => {
		switch (ch) {
			case '&':
				return '&amp;';
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '"':
				return '&quot;';
			case "'":
				return '&#39;';
			default:
				return ch;
		}
	});
}
