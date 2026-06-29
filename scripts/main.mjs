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

// ── Feats (optional) ────────────────────────────────────────────────────────
// The Feats system is class-agnostic: a character may gain a feat at levels 1,
// 4, 8, 12, and 16. It is opt-in via the `enableFeats` world setting.
//
// Levels 4/8/12/16 are surfaced inside the system's native level-up dialog by
// injecting the `feats` group into the leveling class item's `groupIdentifiers`
// (see the `setup` prepareDerivedData patch). The dialog indexes any feature
// whose `system.group` matches an entry of the class's `groupIdentifiers`
// (keyed by `class || group`), so our class-less, `group: "feats"` features
// appear as a "Feats (Choose one)" section with native selection, ownership
// exclusion, granting, and level-down reversal — no custom code on that path.
//
// Level 1 is NOT covered by that dialog (the initial class drop doesn't run a
// level-up flow), and a setting toggled mid-campaign needs back-fill, so a
// lightweight sheet picker handles those cases.
const FEATS_SETTING = 'enableFeats';
const FEATS_GROUP = 'feats';
const FEATS_PACK = `${MODULE_ID}.nim-plus-feats`;
const FEAT_MILESTONE_LEVELS = [1, 4, 8, 12, 16];

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
	feats: {
		choose: chooseFeat,
		pending: pendingFeatCount,
		owned: ownedFeats,
		characterLevel: getCharacterLevel,
		// Activatable feat macros (wired via each feat's `system.macro`).
		healerHeal,
		secondWind,
		// Grant-time configurators (also re-openable from the sheet Feats panel).
		allocateAcademic,
		chooseElementalSpecialist,
	},
};

Hooks.once('init', () => {
	const mod = game.modules.get(MODULE_ID);
	if (mod) mod.api = api;
	globalThis.nimPlus = api;

	game.settings.register(MODULE_ID, FEATS_SETTING, {
		name: 'Enable Feats',
		hint: 'Adds the optional class-agnostic Feats system. Characters may choose a feat at levels 1, 4, 8, 12, and 16 — offered in the level-up window (levels 4/8/12/16) and via a "Choose Feat" button on the character sheet.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		onChange: () => {
			// Re-prepare so the class-item groupIdentifiers patch (de)activates,
			// then re-render any open sheets so the Feats section appears/clears.
			for (const actor of game.actors ?? []) {
				try {
					actor.prepareData?.();
				} catch (error) {
					console.error(`[${MODULE_ID}] Failed to re-prepare actor on Feats toggle`, error);
				}
				for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
			}
		},
	});
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

		// When Feats are enabled, advertise the `feats` group on every class item
		// so the native level-up dialog renders our class-less feat pool at the
		// feat levels (4/8/12/16). Mutates derived data only — never `_source` —
		// so it self-clears when the setting is turned off and the item is
		// re-prepared. Guarded because data prep can run before settings register.
		if (this.type === 'class') {
			try {
				if (game.settings?.get?.(MODULE_ID, FEATS_SETTING)) {
					const groups = this.system?.groupIdentifiers;
					if (Array.isArray(groups) && !groups.includes(FEATS_GROUP)) groups.push(FEATS_GROUP);
				}
			} catch (_error) {
				/* settings not ready yet — nothing to inject */
			}
			return;
		}

		if (this.type !== 'feature') return;
		if (this.getFlag(MODULE_ID, 'showAsAttack')) {
			this.system.actionType = 'attack';
		}
	};

	// Patch the character document's prepareDerivedData to apply conditional feat
	// armor bonuses (Defensive Duelist, Dual Wielder) and the Bulwark aura. These
	// can't be expressed as static `armorClass` rules because the system's
	// predicate domain has no tag for "wielding a DEX weapon", "dual wielding", or
	// "an ally with Bulwark is adjacent". We compute them off live item/canvas
	// state AFTER the system finishes its own AC math, adding to the final
	// `system.attributes.armor.value`. This mutates derived data only — it is
	// recomputed every prepare, so the bonus is inherently applied exactly once and
	// self-clears when the feat/condition goes away or the setting is disabled.
	//
	// The real character class lives behind Nimble's ActorProxy at
	// CONFIG.NIMBLE.Actor.documentClasses.character and overrides prepareDerivedData,
	// so that is the prototype we must wrap (patching CONFIG.Actor.documentClass —
	// the proxy — would never intercept the subclass override).
	const CharacterClass = CONFIG?.NIMBLE?.Actor?.documentClasses?.character;
	if (CharacterClass?.prototype?.prepareDerivedData && !CharacterClass.prototype.__nimPlusFeatACPatched) {
		const originalActorPrep = CharacterClass.prototype.prepareDerivedData;
		CharacterClass.prototype.prepareDerivedData = function patchedActorPrepareDerivedData() {
			originalActorPrep.call(this);
			try {
				applyFeatArmorAdjustments(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply feat armor adjustments`, error);
			}
		};
		CharacterClass.prototype.__nimPlusFeatACPatched = true;
	}

	// Patch the spell document's `activate` to implement Elemental Specialist.
	// The feat grants "+KEY damage to Tiered Spells of one chosen school". The
	// rules engine cannot scope a damageBonus by spell *school* (only by damage
	// type / source / delivery), and many spell damage effects carry no explicit
	// damage type, so we instead append `+ KEY` to the cast spell's primary damage
	// formula in-memory right before the activation manager clones it — the same
	// proven technique used by Psionic Field Attack. The original formula is
	// restored immediately after so repeated casts never accumulate the bonus.
	const SpellClass = CONFIG?.NIMBLE?.Item?.documentClasses?.spell;
	if (SpellClass?.prototype?.activate && !SpellClass.prototype.__nimPlusElementalPatched) {
		const originalSpellActivate = SpellClass.prototype.activate;
		SpellClass.prototype.activate = async function patchedSpellActivate(options = {}) {
			let restore = null;
			try {
				if (!options?.executeMacro) restore = applyElementalSpecialistBonus(this);
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to apply Elemental Specialist bonus`, error);
			}
			try {
				return await originalSpellActivate.call(this, options);
			} finally {
				try {
					restore?.();
				} catch (error) {
					console.error(`[${MODULE_ID}] Failed to restore spell formula after Elemental Specialist`, error);
				}
			}
		};
		SpellClass.prototype.__nimPlusElementalPatched = true;
	}
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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Feats (optional) — sheet picker + back-fill
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The native level-up dialog covers feat selection at levels 4/8/12/16 (via the
 * groupIdentifiers injection in the `setup` hook). This section provides the
 * complementary character-sheet UI: a "Feats" panel that lists the feats a
 * character has taken and offers a "Choose Feat" button whenever they're owed
 * one — covering level 1 (which the level-up dialog never prompts for) and any
 * back-fill when the setting is enabled mid-campaign. The button is manual, so
 * it never races or double-grants against the native dialog: it counts owned
 * feats against milestones reached and only offers the shortfall.
 */

function featsEnabled() {
	try {
		return !!game.settings?.get?.(MODULE_ID, FEATS_SETTING);
	} catch {
		return false;
	}
}

function getCharacterLevel(actor) {
	if (!actor) return 0;
	const fromGetter = Number(actor.levels?.character);
	if (Number.isFinite(fromGetter) && fromGetter > 0) return fromGetter;
	let total = 0;
	for (const item of actor.items ?? []) {
		if (item.type === 'class') total += Number(item.system?.classLevel ?? 0) || 0;
	}
	return total;
}

function milestonesReached(level) {
	return FEAT_MILESTONE_LEVELS.filter((m) => m <= level).length;
}

function ownedFeats(actor) {
	if (!actor) return [];
	const items = actor.items?.contents ?? Array.from(actor.items ?? []);
	return items.filter(
		(i) =>
			i.type === 'feature' &&
			(i.getFlag?.(MODULE_ID, 'feat') === true || i.system?.group === FEATS_GROUP),
	);
}

function pendingFeatCount(actor) {
	if (!actor) return 0;
	const reached = milestonesReached(getCharacterLevel(actor));
	const owned = ownedFeats(actor).length;
	return Math.max(0, reached - owned);
}

// Map prerequisite ability codes to Nimble ability keys.
const FEAT_ABILITY_KEYS = { STR: 'strength', DEX: 'dexterity', INT: 'intelligence', WIL: 'will' };

/**
 * Evaluate a feat's prerequisite string against an actor. Only ability-score
 * requirements ("3 STR") are machine-checkable; everything else ("Plate Armor
 * Prof.", "Can cast spells") is surfaced as text but never blocks selection.
 *
 * @returns {{ met: boolean, checkable: boolean, reason: string }}
 */
function evaluateFeatPrereq(actor, req) {
	if (!req) return { met: true, checkable: true, reason: '' };
	const match = /^\s*(\d+)\s+(STR|DEX|INT|WIL)\b/i.exec(req);
	if (!match) return { met: true, checkable: false, reason: req };
	const needed = Number(match[1]);
	const code = match[2].toUpperCase();
	const have = Number(actor?.system?.abilities?.[FEAT_ABILITY_KEYS[code]]?.mod ?? 0);
	return { met: have >= needed, checkable: true, reason: `Requires ${needed} ${code} (you have ${have})` };
}

let featPackDocsCache = null;
async function loadFeatDocs() {
	if (featPackDocsCache) return featPackDocsCache;
	const pack = game.packs.get(FEATS_PACK);
	if (!pack) return [];
	const docs = await pack.getDocuments();
	featPackDocsCache = docs
		.filter((d) => d.type === 'feature')
		.sort((a, b) => a.name.localeCompare(b.name));
	return featPackDocsCache;
}

/**
 * Open the feat picker for an actor and grant the chosen feat. Excludes feats
 * already owned and disables (with a reason) any whose ability-score
 * prerequisite isn't met.
 */
async function chooseFeat(actor) {
	if (!actor) {
		ui.notifications?.error(`[${MODULE_ID}] chooseFeat: missing actor.`);
		return null;
	}
	const docs = await loadFeatDocs();
	if (docs.length === 0) {
		ui.notifications?.error(`[${MODULE_ID}] No feats found in the ${FEATS_PACK} compendium.`);
		return null;
	}

	const ownedIds = new Set(ownedFeats(actor).map((i) => i.system?.identifier));
	const available = docs.filter((d) => !ownedIds.has(d.system?.identifier));
	if (available.length === 0) {
		ui.notifications?.info('All feats have already been taken.');
		return null;
	}

	const level = getCharacterLevel(actor);
	const pending = pendingFeatCount(actor);

	const rows = available
		.map((doc) => {
			const req = doc.getFlag(MODULE_ID, 'featReq') || '';
			const verdict = evaluateFeatPrereq(actor, req);
			const blocked = verdict.checkable && !verdict.met;
			const reqTag = req
				? `<span class="nim-plus-feat-pick__req${blocked ? ' is-unmet' : ''}">${escape(verdict.checkable ? verdict.reason : `Prereq: ${req}`)}</span>`
				: '';
			const body = String(doc.system?.description ?? '')
				.replace(/<p class="nim-plus-feat-req">[\s\S]*?<\/p>/i, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return `
				<label class="nim-plus-feat-pick__row${blocked ? ' is-disabled' : ''}">
					<input type="radio" name="feat" value="${escape(doc.system?.identifier)}"${blocked ? ' disabled' : ''}>
					<span class="nim-plus-feat-pick__main">
						<span class="nim-plus-feat-pick__name">${escape(doc.name)} ${reqTag}</span>
						<span class="nim-plus-feat-pick__desc">${escape(body)}</span>
					</span>
				</label>`;
		})
		.join('');

	const choiceId = await foundry.applications.api.DialogV2.wait({
		window: { title: `Choose a Feat — ${actor.name}` },
		content: `
			<div class="nim-plus-feat-pick">
				<p class="nim-plus-feat-pick__intro">Level ${level}. ${pending > 1 ? `You have <strong>${pending}</strong> feats to choose.` : 'Choose a feat.'} Greyed-out feats don't meet an ability-score prerequisite.</p>
				<div class="nim-plus-feat-pick__list">${rows}</div>
			</div>
		`,
		buttons: [
			{
				action: 'grant',
				label: 'Gain Feat',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('.nim-plus-feat-pick');
					const checked = form?.querySelector?.('input[name="feat"]:checked');
					return checked?.value ?? null;
				},
			},
			{ action: 'cancel', label: 'Cancel', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choiceId) return null;
	return grantFeatByIdentifier(actor, choiceId);
}

/**
 * Grant a feat to an actor by its identifier (headless — no dialog). Used by the
 * sheet picker and by the level-up window injection. Stamps `compendiumSource`
 * so the system treats it as an owned compendium feature (ownership exclusion,
 * level-down reversal, etc.).
 */
async function grantFeatByIdentifier(actor, identifier) {
	const docs = await loadFeatDocs();
	const chosen = docs.find((d) => d.system?.identifier === identifier);
	if (!chosen) return null;
	const obj = chosen.toObject();
	delete obj._id;
	obj._stats = obj._stats ?? {};
	obj._stats.compendiumSource = chosen.uuid;
	const [created] = await actor.createEmbeddedDocuments('Item', [obj]);
	ui.notifications?.info(`${actor.name} gained the ${chosen.name} feat.`);
	return created ?? null;
}

const FEATS_WIDGET_CLASS = 'nim-plus-feats';
const FEATS_STYLE_ID = 'nim-plus-feats-styles';

const FEATS_WIDGET_CSS = `
	.nim-plus-feats {
		--feat-accent: #d9b15a;
		display: block;
		width: 100%;
		box-sizing: border-box;
		grid-column: 1 / -1;
		flex: 1 1 100%;
		margin: 0.5rem 0;
		padding: 0.55rem 0.7rem 0.6rem;
		background:
			linear-gradient(135deg, rgba(217, 177, 90, 0.10), rgba(217, 177, 90, 0.03)),
			var(--color-bg, transparent);
		border: 1px solid rgba(217, 177, 90, 0.4);
		border-radius: 6px;
		box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.15);
	}
	.nim-plus-feats__header {
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
	.nim-plus-feats__icon { color: var(--feat-accent); opacity: 0.95; }
	.nim-plus-feats__badge {
		margin-left: auto;
		font-size: 0.7em;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(217, 177, 90, 0.2);
		border: 1px solid rgba(217, 177, 90, 0.45);
		color: var(--color-text-primary, inherit);
	}
	.nim-plus-feats__list {
		list-style: none;
		margin: 0 0 0.5rem;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.nim-plus-feats__item {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.95em;
	}
	.nim-plus-feats__item img {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		border: 1px solid rgba(0,0,0,0.25);
		object-fit: cover;
		flex: 0 0 auto;
	}
	.nim-plus-feats__empty { opacity: 0.6; font-style: italic; font-size: 0.9em; }
	.nim-plus-feats__btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		width: 100%;
		padding: 0.4rem 0.8rem;
		border: 1px solid rgba(217, 177, 90, 0.5);
		background: linear-gradient(180deg, rgba(217, 177, 90, 0.22), rgba(217, 177, 90, 0.12));
		color: var(--color-text-primary, inherit);
		border-radius: 6px;
		cursor: pointer;
		font-weight: 700;
		letter-spacing: 0.03em;
		transition: background 0.15s, border-color 0.15s;
	}
	.nim-plus-feats__btn:hover {
		background: linear-gradient(180deg, rgba(217, 177, 90, 0.34), rgba(217, 177, 90, 0.2));
		border-color: var(--feat-accent);
	}
	.nim-plus-feat-pick__intro { margin: 0 0 0.5rem; opacity: 0.85; }
	.nim-plus-feat-pick__list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		max-height: 50vh;
		overflow-y: auto;
		padding-right: 4px;
	}
	.nim-plus-feat-pick__row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.4rem 0.5rem;
		border: 1px solid transparent;
		border-radius: 5px;
		cursor: pointer;
	}
	.nim-plus-feat-pick__row:hover { background: rgba(217, 177, 90, 0.08); }
	.nim-plus-feat-pick__row.is-disabled { opacity: 0.45; cursor: not-allowed; }
	.nim-plus-feat-pick__row input { margin-top: 0.25rem; }
	.nim-plus-feat-pick__main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
	.nim-plus-feat-pick__name { font-weight: 700; }
	.nim-plus-feat-pick__req {
		font-weight: 600;
		font-size: 0.78em;
		opacity: 0.8;
		margin-left: 0.35rem;
	}
	.nim-plus-feat-pick__req.is-unmet { color: #d2603f; opacity: 1; }
	.nim-plus-feat-pick__desc { font-size: 0.85em; opacity: 0.8; }

	/* Feats section injected into the Features tab — styled to sit alongside the
	   system's own feature category sections. */
	.nim-plus-feats-section { margin-top: 0.75rem; }
	.nim-plus-feats-section__header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
	.nim-plus-feats-section__header .nimble-heading { margin: 0; }
	.nim-plus-feats-section__badge {
		font-size: 0.7em;
		font-weight: 700;
		letter-spacing: 0.04em;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(217, 177, 90, 0.2);
		border: 1px solid rgba(217, 177, 90, 0.45);
		color: var(--color-text-primary, inherit);
	}
	.nim-plus-feats-section__actions { margin-left: auto; display: flex; gap: 0.4rem; flex-wrap: wrap; }
	.nim-plus-feats-section__btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.3rem 0.7rem;
		border: 1px solid rgba(217, 177, 90, 0.5);
		background: linear-gradient(180deg, rgba(217, 177, 90, 0.22), rgba(217, 177, 90, 0.12));
		color: var(--color-text-primary, inherit);
		border-radius: 6px;
		cursor: pointer;
		font-weight: 600;
		font-size: 0.85em;
		white-space: nowrap;
	}
	.nim-plus-feats-section__btn:hover { background: linear-gradient(180deg, rgba(217, 177, 90, 0.34), rgba(217, 177, 90, 0.2)); }
	.nim-plus-feats-section .nimble-feature-card__header { cursor: pointer; }
	.nim-plus-feats-section__empty { opacity: 0.6; font-style: italic; font-size: 0.9em; padding: 0.4rem 0; }

	/* Feats (Choose one) section injected into the native level-up window. */
	.nim-plus-levelup-feats { margin-top: 0.75rem; }
	.nim-plus-levelup-feats__header { margin-bottom: 0.35rem; }
	.nim-plus-levelup-feats__header .nimble-heading { margin: 0; }
`;

function ensureFeatStyles() {
	if (document.getElementById(FEATS_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = FEATS_STYLE_ID;
	style.textContent = FEATS_WIDGET_CSS;
	document.head.append(style);
}

// Signature of the feats UI state — used to skip re-rendering the section when
// nothing relevant changed (so the MutationObserver below never loops).
function featsSignature(actor) {
	const ids = ownedFeats(actor)
		.map((f) => f.id)
		.sort()
		.join(',');
	const cfg = featsNeedingConfig(actor)
		.map((c) => c.kind)
		.join(',');
	return `${ids}|${pendingFeatCount(actor)}|${cfg}`;
}

function featCardHTML(feat) {
	const img = escape(feat.img || 'icons/svg/upgrade.svg');
	const req = feat.getFlag?.(MODULE_ID, 'featReq');
	const reqTag = req ? `<span class="nimble-feature-card__level">${escape(req)}</span>` : '';
	return `<li>
		<div class="nimble-feature-card" data-feat-id="${escape(feat.id)}">
			<div class="nimble-feature-card__header" role="button" tabindex="0" data-nim-plus-open-feat="${escape(feat.id)}">
				<div class="nimble-feature-card__img-wrapper"><img class="nimble-feature-card__img" src="${img}" alt=""></div>
				<h4 class="nimble-feature-card__name nimble-heading" data-heading-variant="item">${escape(feat.name)}</h4>
				${reqTag}
			</div>
		</div>
	</li>`;
}

function renderFeatsSection(actor) {
	const chosen = ownedFeats(actor)
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name));
	const pending = pendingFeatCount(actor);
	const cards =
		chosen.map(featCardHTML).join('') ||
		`<li class="nim-plus-feats-section__empty">No feats chosen yet.</li>`;
	const chooseBtn =
		pending > 0
			? `<button type="button" class="nim-plus-feats-section__btn" data-nim-plus-feat="choose"><i class="fa-solid fa-star"></i> Choose Feat${pending > 1 ? ` (${pending})` : ''}</button>`
			: '';
	const configBtns = featsNeedingConfig(actor)
		.map(
			(c) =>
				`<button type="button" class="nim-plus-feats-section__btn" data-nim-plus-feat-config="${escape(c.kind)}"><i class="fa-solid fa-sliders"></i> ${escape(c.label)}</button>`,
		)
		.join('');
	const badge = pending > 0 ? `<span class="nim-plus-feats-section__badge">${pending} available</span>` : '';
	return `
		<div class="nim-plus-feats-section" data-actor-id="${escape(actor.id)}" data-sig="${escape(featsSignature(actor))}">
			<header class="nim-plus-feats-section__header">
				<h3 class="nimble-heading" data-heading-variant="section">Feats</h3>
				${badge}
				<div class="nim-plus-feats-section__actions">${chooseBtn}${configBtns}</div>
			</header>
			<ul class="nimble-item-list">${cards}</ul>
		</div>`;
}

function wireFeatsSection(section, actor) {
	section.querySelectorAll('[data-nim-plus-open-feat]').forEach((el) => {
		el.addEventListener('click', (event) => {
			event.preventDefault();
			const feat = actor.items?.get?.(el.dataset.nimPlusOpenFeat);
			feat?.sheet?.render(true);
		});
	});
	section.querySelector('[data-nim-plus-feat="choose"]')?.addEventListener('click', async (event) => {
		event.preventDefault();
		await chooseFeat(actor);
		resyncFeatsForActor(actor);
	});
	section.querySelectorAll('[data-nim-plus-feat-config]').forEach((btn) => {
		btn.addEventListener('click', async (event) => {
			event.preventDefault();
			const kind = btn.dataset.nimPlusFeatConfig;
			if (kind === 'academic') await allocateAcademic(actor);
			else if (kind === 'elemental') await chooseElementalSpecialist(actor);
			resyncFeatsForActor(actor);
		});
	});
}

/**
 * Inject (or refresh) the Feats section into the Features tab body. Identifies
 * the Features tab via the active nav button's `fa-table-list` icon (only the
 * active tab's body is mounted at a time, and the Spells tab shares the body
 * class, so the icon is the reliable discriminator). Idempotent: re-renders only
 * when the feats signature changes, so the MutationObserver can call it freely.
 */
function syncFeatsTabSection(app) {
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;

	const featuresActive = !!root.querySelector('[data-button-state="active"] i.fa-table-list');
	const body = root.querySelector('.nimble-sheet__body--player-character');
	const eligible = featsEnabled() && actor.items?.some?.((i) => i.type === 'class');

	if (!featuresActive || !body || !eligible) {
		root.querySelectorAll('.nim-plus-feats-section').forEach((el) => el.remove());
		return;
	}

	const current = body.querySelector(':scope > .nim-plus-feats-section');
	const sig = featsSignature(actor);
	if (current && current.dataset.sig === sig) return; // already up to date
	current?.remove();

	ensureFeatStyles();
	const wrapper = document.createElement('div');
	wrapper.innerHTML = renderFeatsSection(actor).trim();
	const section = wrapper.firstElementChild;
	if (!section) return;
	body.appendChild(section);
	wireFeatsSection(section, actor);
}

function resyncFeatsForActor(actor) {
	for (const app of Object.values(actor.apps ?? {})) {
		try {
			syncFeatsTabSection(app);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to sync Feats section`, error);
		}
	}
}

// Watch the sheet for tab switches / reactive updates (which don't fire a
// Foundry render hook) and keep the Feats section in the Features tab in sync.
function setupFeatsTabObserver(app) {
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;
	try {
		app.__nimPlusFeatsObserver?.disconnect();
	} catch (_error) {
		/* previous observer already gone */
	}
	const observer = new MutationObserver(() => syncFeatsTabSection(app));
	observer.observe(root, { childList: true, subtree: true });
	app.__nimPlusFeatsObserver = observer;
	syncFeatsTabSection(app);
}

Hooks.on('renderPlayerCharacterSheet', (app, _html) => {
	setupFeatsTabObserver(app);
	maybeAutoPromptFeats(app);
});

Hooks.on('closePlayerCharacterSheet', (app) => {
	try {
		app.__nimPlusFeatsObserver?.disconnect();
	} catch (_error) {
		/* nothing to disconnect */
	}
});

/**
 * Auto-prompt the feat picker when a character is owed a feat.
 *
 * Nimble's native level-up dialog and character-creator only surface features
 * keyed by the *class identifier* — they call `getClassFeaturesFromIndex` without
 * the `groupIdentifiers` argument, so our class-less `group: "feats"` pool can
 * never appear there (an architectural limit of the system, not a setting).
 * Instead we drive selection ourselves: whenever an owed character's sheet
 * renders, open the picker. The prompt is "armed" once per character and re-armed
 * on every class-level change, so it fires at levels 1/4/8/12/16 (and as back-fill
 * when the setting is switched on mid-campaign). The manual "Choose Feat" button
 * in the Feats panel remains as a fallback.
 */
const autoFeatPromptArmed = new Set(); // actor ids already prompted this cycle
const featPromptBusy = new Set(); // actor ids with an open prompt loop

async function promptFeatsLoop(actor) {
	if (featPromptBusy.has(actor.id)) return;
	featPromptBusy.add(actor.id);
	try {
		while (featsEnabled() && pendingFeatCount(actor) > 0) {
			const granted = await chooseFeat(actor);
			resyncFeatsForActor(actor);
			if (!granted) break; // dismissed — stop nagging; the panel button remains
		}
	} finally {
		featPromptBusy.delete(actor.id);
	}
}

function maybeAutoPromptFeats(app) {
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	if (!featsEnabled() || !actor.isOwner) return;
	// Levels 4/8/12/16 are chosen inside the level-up window (see the
	// renderGenericDialog injection below); the only milestone with no level-up
	// flow is level 1 (character creation), so the auto-prompt is scoped to it.
	// Higher-level back-fill (enabling the setting mid-campaign) uses the Feats
	// section's "Choose Feat" button on the Features tab.
	if (getCharacterLevel(actor) !== 1) return;
	// A GM is auto-prompted only for their own assigned character, not when
	// peeking at a player's sheet.
	if (game.user?.isGM && game.user?.character?.id !== actor.id) return;
	if (autoFeatPromptArmed.has(actor.id)) return; // already prompted this cycle
	if (pendingFeatCount(actor) <= 0) return;
	autoFeatPromptArmed.add(actor.id);
	promptFeatsLoop(actor).catch((error) =>
		console.error(`[${MODULE_ID}] Feat auto-prompt failed`, error),
	);
}

// ── Level-up window integration ─────────────────────────────────────────────
// Inject a "Feats (Choose one)" section into Nimble's native level-up dialog
// at feat milestone levels (4/8/12/16) and grant the chosen feat when the user
// confirms the level-up. The dialog can't surface class-agnostic feats on its
// own (its feature lookup is keyed by class identifier and never receives our
// `feats` group), so we add the selection UI to its DOM and hook its confirm
// button. Level 1 has no level-up dialog and is handled by the auto-prompt above.
const FEAT_MILESTONE_SET = new Set(FEAT_MILESTONE_LEVELS);

Hooks.on('renderGenericDialog', (app) => {
	injectLevelUpFeatSection(app).catch((error) =>
		console.error(`[${MODULE_ID}] Failed to inject feats into level-up window`, error),
	);
});

// Poll (via animation frames) for the level-up dialog's body/footer to mount.
function waitForLevelUpAnchors(root, tries = 30) {
	return new Promise((resolve) => {
		const check = (n) => {
			if (!root.isConnected) return resolve({});
			const body = root.querySelector('.nimble-sheet__body');
			const footer = root.querySelector('.nimble-sheet__footer');
			if ((body && footer) || n <= 0) return resolve({ body, footer });
			requestAnimationFrame(() => check(n - 1));
		};
		check(tries);
	});
}

async function injectLevelUpFeatSection(app) {
	if (!featsEnabled()) return;
	// The level-up dialog is a GenericDialog created with `{ document, classIdentifier }`.
	const actor = app?.data?.document;
	const classIdentifier = app?.data?.classIdentifier;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	if (typeof classIdentifier !== 'string' || classIdentifier.length === 0) return;
	if (!actor.isOwner) return;

	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;
	// The Svelte body/footer may mount a frame or two after the render hook fires.
	const { body, footer } = await waitForLevelUpAnchors(root);
	if (!body || !footer) return;
	if (root.querySelector('.nim-plus-levelup-feats')) return; // already injected

	// Offer a feat only when the level being gained is a milestone the character
	// is actually owed a feat for.
	const newLevel = (Number(getCharacterLevel(actor)) || 0) + 1;
	if (!FEAT_MILESTONE_SET.has(newLevel)) return;
	if (milestonesReached(newLevel) - ownedFeats(actor).length <= 0) return;

	const docs = await loadFeatDocs();
	const ownedIds = new Set(ownedFeats(actor).map((i) => i.system?.identifier));
	const available = docs.filter((d) => !ownedIds.has(d.system?.identifier));
	if (available.length === 0) return;

	// Re-check after the await — the dialog may have closed or another render
	// could have injected in the meantime.
	if (!root.isConnected || root.querySelector('.nim-plus-levelup-feats')) return;

	const rows = available
		.map((doc) => {
			const req = doc.getFlag(MODULE_ID, 'featReq') || '';
			const verdict = evaluateFeatPrereq(actor, req);
			const blocked = verdict.checkable && !verdict.met;
			const reqTag = req
				? `<span class="nim-plus-feat-pick__req${blocked ? ' is-unmet' : ''}">${escape(verdict.checkable ? verdict.reason : `Prereq: ${req}`)}</span>`
				: '';
			const desc = String(doc.system?.description ?? '')
				.replace(/<p class="nim-plus-feat-req">[\s\S]*?<\/p>/i, '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return `
				<label class="nim-plus-feat-pick__row${blocked ? ' is-disabled' : ''}">
					<input type="radio" name="nim-plus-levelup-feat" value="${escape(doc.system?.identifier)}"${blocked ? ' disabled' : ''}>
					<span class="nim-plus-feat-pick__main">
						<span class="nim-plus-feat-pick__name">${escape(doc.name)} ${reqTag}</span>
						<span class="nim-plus-feat-pick__desc">${escape(desc)}</span>
					</span>
				</label>`;
		})
		.join('');

	ensureFeatStyles();
	const section = document.createElement('section');
	section.className = 'nim-plus-levelup-feats';
	section.innerHTML = `
		<header class="nim-plus-levelup-feats__header">
			<h3 class="nimble-heading" data-heading-variant="section">Feats (Choose one)</h3>
		</header>
		<div class="nim-plus-feat-pick__list">${rows}</div>`;

	// Grant the selected feat when the user confirms the level-up. Registered in
	// the capture phase so it runs before the dialog's own submit: with no feat
	// chosen it blocks submission (the feat is required at this level); otherwise
	// it grants the feat and lets the level-up proceed.
	const confirmHandler = (event) => {
		const selected = section.querySelector('input[name="nim-plus-levelup-feat"]:checked');
		if (!selected) {
			event.preventDefault();
			event.stopImmediatePropagation();
			ui.notifications?.warn('Choose a feat to finish your level-up.');
			return;
		}
		if (section.dataset.granted) return;
		section.dataset.granted = 'true';
		grantFeatByIdentifier(actor, selected.value).catch((error) =>
			console.error(`[${MODULE_ID}] Failed to grant feat from level-up window`, error),
		);
	};

	// Keep the section attached and the confirm button hooked across the dialog's
	// reactive re-renders. Re-appending the same detached node preserves the radio
	// choice, so the observer is a safe self-heal.
	const ensure = () => {
		const r = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
		if (!r || !r.isConnected) return;
		const liveBody = r.querySelector('.nimble-sheet__body');
		if (liveBody && !section.isConnected) liveBody.appendChild(section);
		const confirmBtn = r.querySelector('.nimble-sheet__footer .nimble-button');
		if (confirmBtn && !confirmBtn.dataset.nimPlusFeatHooked) {
			confirmBtn.dataset.nimPlusFeatHooked = 'true';
			confirmBtn.addEventListener('click', confirmHandler, true);
		}
	};

	ensure();
	try {
		app.__nimPlusFeatObserver?.disconnect();
	} catch (_error) {
		/* no previous observer */
	}
	const observer = new MutationObserver(() => ensure());
	observer.observe(root, { childList: true, subtree: true });
	app.__nimPlusFeatObserver = observer;
}

Hooks.on('closeGenericDialog', (app) => {
	try {
		app.__nimPlusFeatObserver?.disconnect();
	} catch (_error) {
		/* nothing to disconnect */
	}
});

// Re-arm the auto-prompt whenever a class level changes (level-up / level-down),
// so the next sheet render offers any newly-owed feat.
Hooks.on('updateItem', (item, changes) => {
	if (item?.type !== 'class') return;
	if (foundry.utils.getProperty(changes, 'system.classLevel') === undefined) return;
	const actor = item.actor;
	if (actor) autoFeatPromptArmed.delete(actor.id);
});

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Feats — mechanical automation (the eight feats with non-trivial effects)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Vigilant (+KEY initiative) ships as a declarative `initiativeBonus` rule in
 * its JSON, so it needs no code here. The rest are implemented below:
 *
 *   • Academic            — grant-time dialog distributing 3 skill points.
 *   • Bulwark             — token-aura: +2 Armor to adjacent allies.
 *   • Defensive Duelist   — +2 Armor while wielding a DEX melee weapon, no shield.
 *   • Dual Wielder        — +1 Armor while two weapons are equipped.
 *   • Elemental Specialist— +KEY damage to tiered spells of a chosen school.
 *   • Healer              — targetable KEY-HP heal, once per Safe Rest.
 *   • Second Wind         — spend a Hit Die to heal its result +KEY, once per day.
 *
 * The three Armor feats can't be static `armorClass` rules (the predicate domain
 * has no tag for weapon-wielding state or aura adjacency), so they're computed in
 * the patched character `prepareDerivedData` (see the `setup` hook). Healer /
 * Second Wind are activatable via each feat's `system.macro`. Academic / Elemental
 * Specialist are configured at grant time (and re-configurable from the sheet).
 */

const NIM_SKILLS = [
	['arcana', 'Arcana'],
	['examination', 'Examination'],
	['finesse', 'Finesse'],
	['influence', 'Influence'],
	['insight', 'Insight'],
	['lore', 'Lore'],
	['might', 'Might'],
	['naturecraft', 'Naturecraft'],
	['perception', 'Perception'],
	['stealth', 'Stealth'],
];

const ELEM_SCHOOLS = [
	['fire', 'Fire'],
	['ice', 'Ice'],
	['lightning', 'Lightning'],
	['necrotic', 'Necrotic'],
	['radiant', 'Radiant'],
	['wind', 'Wind'],
];

const ELEM_KEY_ABILITIES = [
	['key', 'Key (highest)'],
	['strength', 'Strength'],
	['dexterity', 'Dexterity'],
	['intelligence', 'Intelligence'],
	['will', 'Will'],
];

// ── Shared helpers ──────────────────────────────────────────────────────────

function actorOwnsFeat(actor, identifier) {
	return !!actor?.items?.some?.((i) => i.type === 'feature' && i.system?.identifier === identifier);
}

/** The actor's KEY ability modifier (highest of its class key abilities). */
function actorKeyMod(actor) {
	try {
		return Math.floor(Number(actor?.getRollData?.()?.key ?? 0)) || 0;
	} catch {
		return 0;
	}
}

function equippedWeapons(actor) {
	const items = actor?.items?.contents ?? Array.from(actor?.items ?? []);
	return items.filter(
		(i) => i.type === 'object' && i.system?.objectType === 'weapon' && i.system?.equipped === true,
	);
}

function hasEquippedShield(actor) {
	const items = actor?.items?.contents ?? Array.from(actor?.items ?? []);
	return items.some(
		(i) => i.type === 'object' && i.system?.objectType === 'shield' && i.system?.equipped === true,
	);
}

function weaponIsRanged(weapon) {
	if (weapon.system?.activation?.targets?.attackType === 'range') return true;
	const selected = weapon.system?.properties?.selected;
	return Array.isArray(selected) && selected.includes('range');
}

// A weapon "uses DEX" when any of its damage formulas reference `@dexterity`
// (the token Nimble weapons use, e.g. dagger "1d4 + @dexterity").
function weaponUsesDex(weapon) {
	const effects = weapon.system?.activation?.effects;
	if (!Array.isArray(effects)) return false;
	try {
		return JSON.stringify(effects).includes('@dexterity');
	} catch {
		return false;
	}
}

function hasDexMeleeWeapon(actor) {
	if (hasEquippedShield(actor)) return false; // feat: no benefit while wielding a shield
	return equippedWeapons(actor).some((w) => !weaponIsRanged(w) && weaponUsesDex(w));
}

function isDualWielding(actor) {
	return equippedWeapons(actor).length >= 2;
}

// ── Armor feats: Defensive Duelist, Dual Wielder, Bulwark aura ───────────────

function sceneGridSize(scene) {
	return scene?.grid?.size ?? scene?.dimensions?.size ?? 100;
}

/**
 * True when token docs `a` and `b` occupy directly-adjacent (incl. diagonal)
 * cells. Each token's cell box is derived from its top-left position and width/
 * height; `a`'s box is expanded by one cell and tested for overlap with `b`'s.
 * Handles multi-cell tokens and treats overlapping tokens as adjacent.
 */
function tokenDocsAdjacent(a, b, size) {
	const ax = Math.floor(a.x / size);
	const ay = Math.floor(a.y / size);
	const bx = Math.floor(b.x / size);
	const by = Math.floor(b.y / size);
	const aw = Math.max(1, Math.round(a.width ?? 1));
	const ah = Math.max(1, Math.round(a.height ?? 1));
	const bw = Math.max(1, Math.round(b.width ?? 1));
	const bh = Math.max(1, Math.round(b.height ?? 1));
	const aMinX = ax - 1;
	const aMaxX = ax + aw;
	const aMinY = ay - 1;
	const aMaxY = ay + ah;
	const bMinX = bx;
	const bMaxX = bx + bw - 1;
	const bMinY = by;
	const bMaxY = by + bh - 1;
	return aMinX <= bMaxX && bMinX <= aMaxX && aMinY <= bMaxY && bMinY <= aMaxY;
}

/**
 * +2 Armor for each allied Bulwark owner whose token is adjacent to one of this
 * actor's tokens on the active scene. Allies are tokens sharing this actor's
 * disposition. Requires a ready canvas; returns 0 during load (the aura is
 * recomputed on canvasReady and on any token move — see the hooks below).
 */
function bulwarkAuraBonus(actor) {
	if (!canvas?.ready) return 0;
	const scene = canvas.scene;
	if (!scene) return 0;
	const all = scene.tokens?.contents ?? Array.from(scene.tokens ?? []);
	const mine = all.filter((t) => t.actorId === actor.id);
	if (!mine.length) return 0;
	const size = sceneGridSize(scene);
	let total = 0;
	for (const other of all) {
		const oa = other.actor;
		if (!oa || oa.id === actor.id) continue;
		if (oa.type !== 'character') continue; // PC-owned Bulwark only — never NPCs/monsters/minions
		if (!actorOwnsFeat(oa, 'bulwark')) continue;
		if (other.disposition !== mine[0].disposition) continue; // allies share disposition
		if (mine.some((m) => tokenDocsAdjacent(other, m, size))) total += 2;
	}
	return total;
}

/**
 * Apply conditional feat Armor bonuses to the already-computed AC. Called from
 * the patched character `prepareDerivedData` (see the `setup` hook), so it runs
 * after the system has finished its own AC math. Derived-only: re-evaluated each
 * prepare, so a bonus is applied exactly once and self-clears with its condition.
 */
function applyFeatArmorAdjustments(actor) {
	if (actor?.type !== 'character') return;
	if (!featsEnabled()) return;
	const armor = actor.system?.attributes?.armor;
	if (!armor || typeof armor.value !== 'number') return;

	let bonus = 0;
	const parts = [];
	if (actorOwnsFeat(actor, 'defensive-duelist') && hasDexMeleeWeapon(actor)) {
		bonus += 2;
		parts.push('Defensive Duelist');
	}
	if (actorOwnsFeat(actor, 'dual-wielder') && isDualWielding(actor)) {
		bonus += 1;
		parts.push('Dual Wielder');
	}
	const aura = bulwarkAuraBonus(actor);
	if (aura > 0) {
		bonus += aura;
		parts.push(aura > 2 ? `Bulwark ×${aura / 2}` : 'Bulwark');
	}

	if (bonus !== 0) {
		armor.value += bonus;
		armor.hint = `${armor.hint ?? ''} + ${parts.join(' + ')}`.trim();
	}
}

/**
 * Re-prepare every character with a token on `scene` so Bulwark auras refresh
 * after movement / token changes. No-op unless the Feats setting is on and at
 * least one token on the scene owns Bulwark, keeping the common case cheap.
 */
function refreshBulwarkAuras(scene) {
	if (!featsEnabled() || !canvas?.ready) return;
	const sc = scene ?? canvas.scene;
	if (!sc) return;
	const tokens = sc.tokens?.contents ?? Array.from(sc.tokens ?? []);
	if (!tokens.some((t) => t.actor && actorOwnsFeat(t.actor, 'bulwark'))) return;
	const seen = new Set();
	for (const t of tokens) {
		const a = t.actor;
		if (!a || a.type !== 'character' || seen.has(a.id)) continue;
		seen.add(a.id);
		try {
			a.prepareData();
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to re-prepare actor for Bulwark aura`, error);
		}
		for (const app of Object.values(a.apps ?? {})) app?.render?.(false);
	}
}

// Only player-character token changes can alter a Bulwark aura (both the owner
// and the beneficiary are always PCs), so NPC/monster/minion movement is ignored.
const isPlayerCharacterToken = (doc) => doc?.actor?.type === 'character';
Hooks.on('updateToken', (doc, changes) => {
	if (!('x' in changes || 'y' in changes)) return;
	if (!isPlayerCharacterToken(doc)) return;
	refreshBulwarkAuras(doc.parent);
});
Hooks.on('createToken', (doc) => {
	if (isPlayerCharacterToken(doc)) refreshBulwarkAuras(doc.parent);
});
Hooks.on('deleteToken', (doc) => {
	if (isPlayerCharacterToken(doc)) refreshBulwarkAuras(doc.parent);
});
Hooks.on('canvasReady', () => refreshBulwarkAuras(canvas?.scene));

// ── Elemental Specialist: +KEY damage to a chosen school's tiered spells ─────

function elementalKeyValue(actor, ability) {
	if (!ability || ability === 'key') return actorKeyMod(actor);
	return Math.floor(Number(actor?.system?.abilities?.[ability]?.mod ?? 0)) || 0;
}

/** Depth-first search for the first `type:'damage'` node carrying a formula. */
function findFirstDamageNode(effects) {
	if (!Array.isArray(effects)) return null;
	for (const node of effects) {
		if (!node || typeof node !== 'object') continue;
		if (node.type === 'damage' && typeof node.formula === 'string' && node.formula.trim()) return node;
		for (const value of Object.values(node)) {
			if (Array.isArray(value)) {
				const found = findFirstDamageNode(value);
				if (found) return found;
			} else if (value && typeof value === 'object') {
				const found = findFirstDamageNode([value]);
				if (found) return found;
			}
		}
	}
	return null;
}

/**
 * If `spell` is a tiered spell of the Elemental Specialist's chosen school,
 * append `+ KEY` to its primary damage formula in-memory and return a restore
 * thunk. Returns null when it doesn't apply.
 */
function applyElementalSpecialistBonus(spell) {
	if (spell?.type !== 'spell') return null;
	const actor = spell.actor;
	if (!actor || !featsEnabled()) return null;
	const feat = actor.items?.find?.((i) => i.system?.identifier === 'elemental-specialist');
	const chosen = feat?.getFlag?.(MODULE_ID, 'elementalChosen');
	if (!chosen?.school) return null;
	if (spell.system?.school !== chosen.school) return null;
	if (Number(spell.system?.tier ?? 0) < 1) return null; // tiered spells only (no cantrips)

	const key = elementalKeyValue(actor, chosen.ability);
	if (!Number.isFinite(key) || key <= 0) return null;

	const node = findFirstDamageNode(spell.system?.activation?.effects);
	if (!node) return null;
	const original = node.formula;
	node.formula = `${original} + ${key}`;
	return () => {
		node.formula = original;
	};
}

/** Open the school + key picker for Elemental Specialist and store the choice. */
async function chooseElementalSpecialist(actor, item) {
	const feat = item ?? actor?.items?.find?.((i) => i.system?.identifier === 'elemental-specialist');
	if (!actor || !feat) {
		ui.notifications?.warn(`[${MODULE_ID}] No Elemental Specialist feat on this character.`);
		return null;
	}
	const schoolOpts = ELEM_SCHOOLS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
	const keyOpts = ELEM_KEY_ABILITIES.map(
		([k, l]) => `<option value="${k}"${k === 'key' ? ' selected' : ''}>${l}</option>`,
	).join('');

	const choice = await foundry.applications.api.DialogV2.wait({
		window: { title: `Elemental Specialist — ${actor.name}` },
		content: `
			<form class="nim-plus-elemental">
				<p>Choose <strong>one spell school you know</strong>. Its <em>tiered</em> spells gain bonus damage equal to the selected key stat.</p>
				<div class="form-group"><label>Spell School</label><select name="school">${schoolOpts}</select></div>
				<div class="form-group"><label>Damage Key Stat</label><select name="ability">${keyOpts}</select></div>
			</form>`,
		buttons: [
			{
				action: 'ok',
				label: 'Confirm',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-elemental');
					if (!form) return null;
					return { school: form.elements.school?.value, ability: form.elements.ability?.value };
				},
			},
			{ action: 'cancel', label: 'Later', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!choice?.school) {
		ui.notifications?.info('Elemental Specialist can be configured later from the Feats panel.');
		return null;
	}

	await feat.setFlag(MODULE_ID, 'elementalChosen', { school: choice.school, ability: choice.ability });
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
	resyncFeatsForActor(actor);

	const schoolLabel = ELEM_SCHOOLS.find((s) => s[0] === choice.school)?.[1] ?? choice.school;
	const keyLabel = ELEM_KEY_ABILITIES.find((a) => a[0] === choice.ability)?.[1] ?? choice.ability;
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Elemental Specialist</strong>`,
		content: `<p>${escape(actor.name)} specializes in the <strong>${escape(schoolLabel)}</strong> school — its tiered spells now deal <strong>+${escape(keyLabel)}</strong> damage.</p>`,
	});
}

// ── Academic: distribute 3 skill points ─────────────────────────────────────

/**
 * Distribute Academic's 3 skill points. The system's level-up dialog hardcodes
 * "1 point per level" in compiled Svelte that an external module can't safely
 * patch, so we grant the 3 extra points the same way the level-up flow does —
 * by writing `system.skills.<key>.points` directly — through a dedicated dialog
 * shown when the feat is gained (and re-openable from the Feats panel).
 */
async function allocateAcademic(actor, item) {
	const feat = item ?? actor?.items?.find?.((i) => i.system?.identifier === 'academic');
	if (!actor || !feat) {
		ui.notifications?.warn(`[${MODULE_ID}] No Academic feat on this character.`);
		return null;
	}
	if (feat.getFlag(MODULE_ID, 'academicAllocated') === true) {
		ui.notifications?.info('Academic skill points have already been allocated.');
		return null;
	}

	const options = NIM_SKILLS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
	const selectRow = (n) =>
		`<div class="form-group"><label>Point ${n}</label><select name="s${n}">${options}</select></div>`;

	const picks = await foundry.applications.api.DialogV2.wait({
		window: { title: `Academic — Allocate 3 Skill Points — ${actor.name}` },
		content: `
			<form class="nim-plus-academic">
				<p>Academic grants <strong>3 skill points</strong> to distribute (stack them on one skill or spread them out) plus <strong>3 extra languages</strong> (track those on your sheet notes).</p>
				${selectRow(1)}${selectRow(2)}${selectRow(3)}
			</form>`,
		buttons: [
			{
				action: 'ok',
				label: 'Allocate',
				default: true,
				callback: (_event, button, dialog) => {
					const root = dialog?.element ?? button;
					const form = root?.querySelector?.('form.nim-plus-academic');
					if (!form) return null;
					return [form.elements.s1?.value, form.elements.s2?.value, form.elements.s3?.value];
				},
			},
			{ action: 'cancel', label: 'Later', callback: () => null },
		],
		rejectClose: false,
		modal: false,
	}).catch(() => null);

	if (!Array.isArray(picks) || picks.some((p) => !p)) {
		ui.notifications?.info('Academic points can be allocated later from the Feats panel.');
		return null;
	}

	const tally = {};
	for (const key of picks) tally[key] = (tally[key] ?? 0) + 1;

	const updates = {};
	for (const [key, n] of Object.entries(tally)) {
		const current = Number(actor.system?.skills?.[key]?.points ?? 0);
		updates[`system.skills.${key}.points`] = current + n;
	}
	await actor.update(updates);
	await feat.setFlag(MODULE_ID, 'academicAllocated', true);
	await feat.setFlag(MODULE_ID, 'academicAllocation', tally);
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
	resyncFeatsForActor(actor);

	const summary = Object.entries(tally)
		.map(([k, n]) => `+${n} ${NIM_SKILLS.find((s) => s[0] === k)?.[1] ?? k}`)
		.join(', ');
	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>Academic</strong>`,
		content: `<p>${escape(actor.name)} allocates 3 skill points: <strong>${escape(summary)}</strong>. <em>(Also learns 3 extra languages.)</em></p>`,
	});
}

// ── Healer: targetable KEY-HP heal, once per Safe Rest ───────────────────────

async function healerHeal(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] healerHeal: missing actor or item.`);
		return null;
	}
	if (item.getFlag(MODULE_ID, 'healerUsed') === true) {
		ui.notifications?.warn(`${item.name} has already been used — available again after a Safe Rest.`);
		return null;
	}

	const key = Math.max(1, actorKeyMod(actor) || 1);
	const targets = Array.from(game.user?.targets ?? []);
	const targetActor = targets[0]?.actor;
	if (!targetActor) {
		ui.notifications?.warn('Target a creature first (set it as your token target), then use Healer.');
		return null;
	}
	if (typeof targetActor.applyHealing !== 'function') {
		ui.notifications?.error(`[${MODULE_ID}] Target cannot receive healing.`);
		return null;
	}

	await targetActor.applyHealing(key);
	await item.setFlag(MODULE_ID, 'healerUsed', true);
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);

	return ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong>`,
		content: `<p>${escape(actor.name)} touches <strong>${escape(targetActor.name)}</strong>, healing <strong>${key}</strong> HP (KEY). <em>Usable again after a Safe Rest.</em></p>`,
	});
}

// ── Second Wind: spend a Hit Die to heal its result +KEY, once per day ───────

async function secondWind(actor, item) {
	if (!actor || !item) {
		ui.notifications?.error(`[${MODULE_ID}] secondWind: missing actor or item.`);
		return null;
	}
	if (item.getFlag(MODULE_ID, 'secondWindUsed') === true) {
		ui.notifications?.warn(`${item.name} has already been used — available again after a Safe Rest.`);
		return null;
	}

	const pool = actor.system?.attributes?.hitDice ?? {};
	const available = Object.keys(pool)
		.filter((s) => Number(pool[s]?.current ?? 0) > 0)
		.map((s) => Number(s))
		.filter((s) => Number.isFinite(s) && s > 0)
		.sort((a, b) => b - a);

	if (available.length === 0) {
		ui.notifications?.warn('No Hit Dice available to spend on Second Wind.');
		return null;
	}

	let size = available[0];
	if (available.length > 1) {
		const opts = available
			.map((s) => `<option value="${s}">d${s} (${pool[String(s)].current} available)</option>`)
			.join('');
		const picked = await foundry.applications.api.DialogV2.wait({
			window: { title: `${item.name} — Spend a Hit Die` },
			content: `<form class="nim-plus-second-wind"><div class="form-group"><label>Hit Die to spend</label><select name="size">${opts}</select></div></form>`,
			buttons: [
				{
					action: 'ok',
					label: 'Spend',
					default: true,
					callback: (_event, button, dialog) => {
						const root = dialog?.element ?? button;
						const form = root?.querySelector?.('form.nim-plus-second-wind');
						return form?.elements?.size?.value ?? null;
					},
				},
				{ action: 'cancel', label: 'Cancel', callback: () => null },
			],
			rejectClose: false,
			modal: false,
		}).catch(() => null);
		if (picked === null) return null;
		size = Number(picked) || size;
	}

	const current = Number(pool[String(size)]?.current ?? 0);
	if (current <= 0) {
		ui.notifications?.warn(`No d${size} Hit Dice remain.`);
		return null;
	}

	await actor.update({ [`system.attributes.hitDice.${size}.current`]: current - 1 });

	const key = actorKeyMod(actor);
	const formula = key !== 0 ? `1d${size} + ${key}` : `1d${size}`;
	const roll = await new Roll(formula, actor.getRollData()).evaluate();
	const healAmount = Math.max(0, roll.total);
	if (typeof actor.applyHealing === 'function') await actor.applyHealing(healAmount);
	await item.setFlag(MODULE_ID, 'secondWindUsed', true);
	for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);

	await roll.toMessage({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `<strong>${escape(item.name)}</strong> — spent a d${size} Hit Die${key !== 0 ? ` + ${key} KEY` : ''}`,
		content: `<p>${escape(actor.name)} heals <strong>${healAmount}</strong> HP. Remaining d${size} Hit Dice: <strong>${current - 1}</strong>. <em>Available again after a Safe Rest.</em></p>`,
	});
	return roll;
}

// ── Grant-time configuration + per-rest usage reset ─────────────────────────

// When a feat that needs configuration is gained (via the native level-up
// dialog or our sheet picker), prompt for it. Gated by userId so only the
// granting client opens the dialog; guarded by the stored flag so it never
// re-prompts once configured.
Hooks.on('createItem', (item, _options, userId) => {
	if (userId !== game.user?.id) return;
	if (!featsEnabled()) return;
	const actor = item?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;
	if (item.type !== 'feature') return;
	const identifier = item.system?.identifier;
	if (identifier === 'academic') {
		if (item.getFlag(MODULE_ID, 'academicAllocated') !== true) {
			allocateAcademic(actor, item).catch((error) =>
				console.error(`[${MODULE_ID}] Academic allocation failed`, error),
			);
		}
	} else if (identifier === 'elemental-specialist') {
		if (!item.getFlag(MODULE_ID, 'elementalChosen')) {
			chooseElementalSpecialist(actor, item).catch((error) =>
				console.error(`[${MODULE_ID}] Elemental Specialist setup failed`, error),
			);
		}
	}
});

// Reset once-per-Safe-Rest feat usages (Healer, Second Wind) when the actor
// completes a Safe Rest. Uses the system's `nimble.rest` hook (payload
// `{ actor, restType }`), the same one the Seasoned Journeyman handler listens to.
Hooks.on('nimble.rest', (payload) => {
	if (payload?.restType !== 'safe') return;
	const actor = payload.actor;
	if (!actor) return;
	const resets = [];
	for (const it of actor.items ?? []) {
		if (it.type !== 'feature') continue;
		const id = it.system?.identifier;
		if (id === 'healer' && it.getFlag(MODULE_ID, 'healerUsed')) {
			resets.push(it.setFlag(MODULE_ID, 'healerUsed', false));
		}
		if (id === 'second-wind' && it.getFlag(MODULE_ID, 'secondWindUsed')) {
			resets.push(it.setFlag(MODULE_ID, 'secondWindUsed', false));
		}
	}
	if (resets.length === 0) return;
	Promise.all(resets)
		.then(() => {
			for (const app of Object.values(actor.apps ?? {})) app?.render?.(false);
		})
		.catch((error) => console.error(`[${MODULE_ID}] Failed to reset feat usages on Safe Rest`, error));
});

// Feats owned but not yet configured — surfaced as buttons in the sheet panel.
function featsNeedingConfig(actor) {
	const out = [];
	const academic = actor?.items?.find?.((i) => i.system?.identifier === 'academic');
	if (academic && academic.getFlag(MODULE_ID, 'academicAllocated') !== true) {
		out.push({ kind: 'academic', label: 'Allocate Academic points' });
	}
	const elemental = actor?.items?.find?.((i) => i.system?.identifier === 'elemental-specialist');
	if (elemental && !elemental.getFlag(MODULE_ID, 'elementalChosen')) {
		out.push({ kind: 'elemental', label: 'Choose Elemental school' });
	}
	return out;
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
