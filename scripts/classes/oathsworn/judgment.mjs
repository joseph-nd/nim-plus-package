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

/** Snapshot the live Judgment Dice before a melee swing that may consume them. */
export function snapshotJudgment(weapon) {
	if (!classQoLEnabled()) return null;
	const actor = weapon?.actor;
	if (!actor || actor.type !== 'character') return null;
	if (!isMeleeWeapon(weapon)) return null;

	const entry = findJudgmentPool(actor);
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

/** "The dice are expended whether you hit or miss." */
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
		const advantageNote = advantage
			? `<p><em>Reliable Justice — rolled an extra ${escape(live.pool.dieSize ?? 'die')} (${advantage.extra}) and dropped the lowest (${advantage.dropped}).</em></p>`
			: '';

		ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor }),
			flavor: `<strong>${escape(label)}</strong>`,
			content:
				`<p>Rolled <strong>${faces.join(', ')}</strong> — <strong>${total}</strong> extra radiant damage on the next melee attack this encounter.</p>` +
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

