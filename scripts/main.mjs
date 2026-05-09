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
};

Hooks.once('init', () => {
	const mod = game.modules.get(MODULE_ID);
	if (mod) mod.api = api;
	globalThis.nimPlus = api;
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
 * Apodracosis (Mage / Invoker of Majesty, L3) — auto-apply Concentration when
 * the player activates the feature. The activation flow itself rolls the
 * temp-HP healing effect; this hook just toggles the status effect on the
 * acting actor so they don't have to remember to set it manually.
 */
Hooks.on('nimble.useItem', (item) => {
	if (!item || item.type !== 'feature') return;
	if (item.system?.identifier !== 'apodracosis') return;
	const actor = item.actor;
	if (!actor) return;
	if (actor.statuses?.has('concentration')) return;
	Promise.resolve(actor.toggleStatusEffect('concentration', { active: true })).catch((error) => {
		console.error(`[${MODULE_ID}] Failed to apply Concentration for Apodracosis`, error);
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
