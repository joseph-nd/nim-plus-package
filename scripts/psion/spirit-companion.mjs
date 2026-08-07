import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';

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
export async function summonSpiritCompanion(actor, item) {
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

