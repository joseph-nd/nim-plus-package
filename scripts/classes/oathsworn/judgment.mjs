import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { sysId } from '../../core/system.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';
import { isMeleeWeapon } from '../shared/combat.mjs';
import { actorOwnsFeat } from '../../feats/mechanics/helpers.mjs';
import { iterateDicePools } from '../../core/pools.mjs';
import {
	RELIABLE_JUSTICE_IDENTIFIER,
	clearJudgmentPool,
	findJudgmentPool,
	isWeaponItem,
	judgmentAppliesToAnyAttack,
	judgmentAutoBonusConsumers,
	judgmentFaces,
	poolRefillsOn,
} from './judgment-rules.mjs';

/**
 * The label the system tags each auto-applied face with, as
 * `+<face>[<label>]` — see `buildAutoBonusFormula`. Reproduced here because it
 * is the one honest signal that the bonus made it onto a roll.
 */
function judgmentPoolLabel(entry) {
	const label = String(entry?.pool?.label ?? '').trim();
	return label.length > 0 ? label : null;
}

/**
 * Snapshot the live Judgment Dice before a swing that may consume them. Weapons
 * only (Nim+ ruling: weapon and unarmed attacks, never a gear or consumable
 * activation). The 2.0.3 feature pays out on melee weapons only; the 0.2 copy
 * on ranged weapons too.
 */
export function snapshotJudgment(weapon) {
	if (!classQoLEnabled()) return null;
	if (!isWeaponItem(weapon)) return null;
	const actor = weapon?.actor;
	if (!actor || actor.type !== 'character') return null;

	const entry = findJudgmentPool(actor);
	if (!isMeleeWeapon(weapon) && !judgmentAppliesToAnyAttack(entry)) return null;
	const faces = judgmentFaces(entry);
	if (faces.length === 0) return null;

	const label = judgmentPoolLabel(entry);
	if (!label) return null;

	return { entry, faces, label, total: faces.reduce((sum, face) => sum + face, 0) };
}

/**
 * Whether a roll on the finished card is tagged with the pool's label — i.e.
 * whether the system actually folded the dice into the damage. Holding Alt skips
 * the activation dialog, and the auto-bonus formula is assembled *by* that
 * dialog, so a fast-forwarded swing carries no bonus. Checking rather than
 * assuming means those dice are never burned for nothing.
 */
function cardCarriesJudgment(card, label) {
	const tag = `[${label}]`;
	for (const roll of card?.rolls ?? []) {
		const formula = roll?.formula ?? roll?._formula;
		if (typeof formula === 'string' && formula.includes(tag)) return true;
	}
	return false;
}

/** "The dice are expended whether you hit or miss" (0.2: "they are lost on a miss"). */
export async function expendJudgment(actor, card, snapshot) {
	if (!snapshot) return;
	if (!cardCarriesJudgment(card, snapshot.label)) return;

	try {
		await clearJudgmentPool(snapshot.entry);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to expend the Judgment Dice`, error);
		return;
	}

	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: '<strong>Radiant Judgement</strong>',
		content:
			`<p><strong>${snapshot.total} radiant damage</strong> (${snapshot.faces.join(' + ')}) added to the attack — applied on a hit only.</p>` +
			'<p><em>Judgment Dice expended.</em></p>',
	});
}

/** `"d8"` → `8`. Null for anything that is not a die size. */
function dieSizeFaces(dieSize) {
	const match = /^d(\d+)$/i.exec(String(dieSize ?? '').trim());
	const faces = match ? Number.parseInt(match[1], 10) : Number.NaN;
	return Number.isFinite(faces) && faces > 1 ? faces : null;
}

/**
 * Sacred Decree — **Reliable Justice**: "Whenever you roll Judgment Dice, roll
 * with advantage (roll one extra and drop the lowest)."
 *
 * Applied to the freshly rolled faces before they are written, so the pool never
 * momentarily holds the un-advantaged set and the announcement below reports what
 * the player actually keeps. The extra die is rolled *synchronously* because a
 * `preUpdate` hook cannot await — if that is unavailable (Foundry's manual dice
 * fulfillment turns every roll into an async prompt) the decree is skipped for
 * that roll rather than producing a half-applied result.
 */
function applyReliableJustice(actor, entry, faces) {
	if (!actorOwnsFeat(actor, RELIABLE_JUSTICE_IDENTIFIER)) return null;

	const size = dieSizeFaces(entry?.pool?.dieSize);
	if (!size) return null;

	let extra;
	try {
		extra = Number(new Roll(`1d${size}`).evaluateSync().total);
	} catch (error) {
		console.warn(
			`[${MODULE_ID}] Reliable Justice needs a synchronous roll and could not make one`,
			error,
		);
		return null;
	}
	if (!Number.isFinite(extra)) return null;

	const kept = [...faces, extra].sort((a, b) => a - b);
	const dropped = kept.shift();
	return { faces: kept, extra, dropped };
}

/**
 * Handle the pool going from empty to rolled, whichever path filled it: the
 * trigger below on an incoming attack, or the system's own `onAttacked` refill
 * when the GM applies damage. Watching the resulting flag write rather than the
 * trigger means one announcement per roll, no matter who caused it.
 *
 * Runs *before* the write, for two reasons: the pool's previous contents are
 * still readable (the state is rewritten wholesale for reasons that have nothing
 * to do with rolling — a die size changing at level-up, this module adding its
 * consumer — and empty-to-rolled is the only transition worth reacting to), and
 * mutating `changed` here lets Reliable Justice adjust the dice in the same
 * write.
 *
 * GM-only: every path that rolls this pool runs on the GM's client — the trigger
 * below, and the system's own refill when the GM applies damage — so restricting
 * it there guarantees exactly one card and one adjustment per roll.
 */
function announceJudgmentRoll(document, changed) {
	if (!classQoLEnabled()) return;
	if (!game.user?.isGM) return;

	const scope = sysId();
	const changedPools = changed?.flags?.[scope]?.dicePools;
	if (!changedPools || typeof changedPools !== 'object') return;

	const actor = document instanceof Actor ? document : (document?.actor ?? null);
	if (!actor || actor.type !== 'character') return;

	for (const [key, delta] of Object.entries(changedPools)) {
		let faces = delta?.faces;
		if (!Array.isArray(faces) || faces.length === 0) continue;

		const previous = foundry.utils.getProperty(
			document,
			`flags.${scope}.dicePools.${key}.faces`,
		);
		if (Array.isArray(previous) && previous.length > 0) continue;

		// Only pools that roll in response to being attacked — a Fury Dice write
		// or any other pool's bookkeeping is none of our business.
		const live = Array.from(iterateDicePools(actor)).find((entry) => entry.key === key);
		if (!live || !poolRefillsOn(live.pool, 'onAttacked')) continue;

		const advantage = applyReliableJustice(actor, live, faces);
		if (advantage) {
			// Mutating the pending update is what makes this one write, not two.
			delta.faces = advantage.faces;
			faces = advantage.faces;
		}

		const total = faces.reduce((sum, face) => sum + face, 0);
		const label = judgmentPoolLabel(live) ?? 'Judgment Dice';
		const target = judgmentAppliesToAnyAttack(live)
			? 'next weapon or unarmed attack'
			: 'next melee attack';
		const advantageNote = advantage
			? `<p><em>Reliable Justice — rolled an extra ${escape(live.pool.dieSize ?? 'die')} (${advantage.extra}) and dropped the lowest (${advantage.dropped}).</em></p>`
			: '';

		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>${escape(label)}</strong>`,
			content:
				`<p>Rolled <strong>${faces.join(', ')}</strong> — <strong>${total}</strong> extra radiant damage on the ${target} this encounter.</p>` +
				advantageNote,
		});
	}
}

for (const hook of ['preUpdateItem', 'preUpdateActor']) {
	Hooks.on(hook, (document, changed) => {
		try {
			announceJudgmentRoll(document, changed);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to announce a Judgment Dice roll`, error);
		}
		// Never veto the write: this hook only observes.
		return undefined;
	});
}

/* ── Nim+ ruling: weapon and unarmed attacks only ────────────────────────────
 *
 * The Judgment Dice ride on physical attacks only: weapon attacks (melee or
 * ranged) and unarmed strikes. Never a spell, never a feature or ability that is
 * not a weapon or unarmed attack. The system cannot say that on its own: a
 * `diceConsumer`'s `bonusOnAttackDelivery` knows only `melee` / `ranged` / `any`,
 * and `any` means *no filter at all*, so the activation dialog folds an
 * `autoBonus` pool into every roll it builds — a feature's damage or healing,
 * a consumable's, a weapon's alike. (Spells never see it: they get the upcast
 * dialog, which applies no pool bonuses.) Narrowing the filter to `melee` would
 * lose ranged weapons; there is no "weapons" value.
 *
 * So the data stays as it is and two narrow runtime seams enforce the ruling:
 *
 *   1. The activation dialog: for an Item that is not a weapon, the Judgment
 *      consumers' filter is pointed away from the item's own delivery for the
 *      instant the dialog builds its state (synchronously, inside
 *      `_replaceHTML`), then restored. The dialog then leaves the dice out
 *      exactly as it does for a 2.0.3 ranged swing: no summary row, no bonus,
 *      no tag on the card — so nothing downstream can spend them either.
 *
 *   2. Unarmed strikes: the system builds them without an Item and rolls its own
 *      formula, ignoring the dialog's, so the dice never reach them natively. The
 *      card is recognised by its `unarmed-damage` node, the dice are folded into
 *      its damage roll before it is created (the same flavored-term shape the
 *      dialog uses, so the `[label]` tag is the honest signal as everywhere
 *      else), and the pool is expended once it exists.
 */

/** The system's attack delivery for an activation (`attackDeliveryFromAttackType`). */
function attackDeliveryOf(item) {
	const attackType = item?.system?.activation?.targets?.attackType;
	if (attackType === 'reach') return 'melee';
	if (attackType === 'range') return 'ranged';
	return null;
}

/**
 * Point every Judgment `autoBonus` consumer's delivery filter at a delivery the
 * activation does not have, so the system's `matchesAttackDelivery` rejects it.
 * In-memory only, never written; returns the function that puts it back.
 */
function suppressJudgmentBonus(actor, delivery) {
	const entry = findJudgmentPool(actor);
	if (!entry || judgmentFaces(entry).length === 0) return () => {};
	const mismatch = delivery === 'melee' ? 'ranged' : 'melee';
	const saved = [];
	for (const rule of judgmentAutoBonusConsumers(actor, entry)) {
		saved.push([rule, rule.bonusOnAttackDelivery]);
		rule.bonusOnAttackDelivery = mismatch;
	}
	return () => {
		for (const [rule, value] of saved) rule.bonusOnAttackDelivery = value;
	};
}

/**
 * Seam 1. The dialog snapshots the pools when its Svelte component mounts, which
 * happens synchronously inside `_replaceHTML`; wrapping that one call on this
 * instance is the narrowest window there is — nothing else can observe the
 * suppressed filter. Unarmed strikes arrive here as a plain object, not an Item,
 * and are left alone: the system ignores the dialog's formula for them (seam 2
 * adds the dice instead).
 */
export function guardJudgmentInDialog(app) {
	if (!app || app.__nimPlusJudgmentGuard) return false;
	if (!classQoLEnabled()) return false;

	const item = app.item;
	const ItemClass = globalThis.Item;
	const isItemDocument = (ItemClass && item instanceof ItemClass) || item?.documentName === 'Item';
	if (!isItemDocument) return false;
	if (isWeaponItem(item)) return false;

	const actor = app.actor ?? item.actor;
	if (!actor || actor.type !== 'character') return false;
	if (!findJudgmentPool(actor)) return false;

	const original = app._replaceHTML;
	if (typeof original !== 'function') return false;
	const delivery = attackDeliveryOf(item);
	app._replaceHTML = function replaceHTMLWithoutJudgment(...args) {
		const restore = suppressJudgmentBonus(actor, delivery);
		try {
			return original.apply(this, args);
		} finally {
			restore();
		}
	};
	app.__nimPlusJudgmentGuard = true;
	return true;
}

Hooks.on('preRenderItemActivationConfigDialog', (app) => {
	try {
		guardJudgmentInDialog(app);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to keep the Judgment Dice off a non-weapon roll`, error);
	}
});

/** The id every system unarmed-strike card (sheet, heroic macro, opportunity) gives its damage node. */
const UNARMED_DAMAGE_NODE_ID = 'unarmed-damage';

function unarmedDamageNode(effects) {
	if (!Array.isArray(effects)) return null;
	return effects.find((effect) => effect?.id === UNARMED_DAMAGE_NODE_ID && effect?.type === 'damage') ?? null;
}

/** Whether a chat card is one of the system's unarmed strikes. */
export function isUnarmedStrikeCard(message) {
	if (message?.type !== 'feature') return false;
	return unarmedDamageNode(message?.system?.activation?.effects) !== null;
}

/** The live Judgment Dice an unarmed strike by this actor would carry, or null. */
function unarmedJudgmentSnapshot(actor) {
	if (!actor || actor.type !== 'character' || !actor.isOwner) return null;
	const entry = findJudgmentPool(actor);
	const faces = judgmentFaces(entry);
	const label = judgmentPoolLabel(entry);
	if (faces.length === 0 || !label) return null;
	return { entry, faces, label, total: faces.reduce((sum, face) => sum + face, 0) };
}

/**
 * Append one `+face[label]` term per die to a serialized, evaluated roll — the
 * shape the dialog's `buildAutoBonusFormula` gives weapon swings. `total` is
 * patched directly (the system's `appendFlavoredBonusToRoll` does the same) so
 * crit and primary-die state survive reconstruction.
 */
function appendJudgmentTerms(serialized, snapshot) {
	const roll = { ...serialized };
	const terms = Array.isArray(roll.terms) ? [...roll.terms] : [];
	for (const face of snapshot.faces) {
		terms.push(
			{ class: 'OperatorTerm', operator: '+', evaluated: true, options: {} },
			{ class: 'NumericTerm', number: face, evaluated: true, options: { flavor: snapshot.label } },
		);
	}
	roll.terms = terms;
	roll.total = Number(roll.total ?? 0) + snapshot.total;
	if (typeof roll.formula === 'string') {
		roll.formula += snapshot.faces.map((face) => ` + ${face}[${snapshot.label}]`).join('');
	}
	return roll;
}

function parseRollSource(entry) {
	if (typeof entry === 'string') {
		try {
			return JSON.parse(entry);
		} catch {
			return null;
		}
	}
	if (entry && typeof entry.toJSON === 'function') return entry.toJSON();
	return entry && typeof entry === 'object' ? entry : null;
}

/**
 * Seam 2, before creation: fold the dice into the unarmed strike's damage roll —
 * both the node's roll and the message's `rolls` entry, which must move together.
 * Returns whether the card was changed.
 */
export function foldJudgmentIntoUnarmedCard(message) {
	if (!classQoLEnabled()) return false;
	if (!isUnarmedStrikeCard(message)) return false;

	const actor = ChatMessage.getSpeakerActor?.(message.speaker) ?? null;
	const snapshot = unarmedJudgmentSnapshot(actor);
	if (!snapshot) return false;

	const source = message._source ?? message;
	const activation = foundry.utils.deepClone(source.system?.activation ?? message.system?.activation);
	const node = unarmedDamageNode(activation?.effects);
	const nodeRoll = parseRollSource(node?.roll);
	if (!node || !nodeRoll) return false;

	const patched = appendJudgmentTerms(nodeRoll, snapshot);
	node.roll = patched;

	const rolls = [...(source.rolls ?? message.rolls ?? [])];
	const index = rolls.findIndex((entry) => parseRollSource(entry)?.class === 'DamageRoll');
	const stringified = JSON.stringify(patched);
	if (index >= 0) rolls[index] = stringified;
	else rolls.push(stringified);

	message.updateSource({ rolls, system: { activation } });
	return true;
}

Hooks.on('preCreateChatMessage', (message) => {
	try {
		foldJudgmentIntoUnarmedCard(message);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to add the Judgment Dice to an unarmed strike`, error);
	}
});

/**
 * Seam 2, after creation: expend the dice an unarmed strike carried (hit or
 * miss, as for a weapon). Weapon swings are spent by the object-activation
 * wrapper (`activation-lifecycle.mjs`); a spell or any other feature card is
 * never a Judgment attack and is ignored. Runs on the author's client only, so
 * one card clears the pool once; `expendJudgment` still checks the card carries
 * the `[label]` tag.
 */
Hooks.on('createChatMessage', (message) => {
	try {
		if (!classQoLEnabled()) return;
		if (!isUnarmedStrikeCard(message)) return;
		const authorId = message.author?.id ?? message.user?.id ?? message.author;
		if (authorId !== game.user?.id) return;

		const actor = ChatMessage.getSpeakerActor?.(message.speaker) ?? null;
		const snapshot = unarmedJudgmentSnapshot(actor);
		if (!snapshot) return;

		expendJudgment(actor, message, snapshot).catch((error) =>
			console.error(`[${MODULE_ID}] Failed to expend the Judgment Dice`, error),
		);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to resolve Judgment Dice on an unarmed strike`, error);
	}
});
