import { MODULE_ID } from '../../core/constants.mjs';
import { escape } from '../../core/html.mjs';
import { currentActivation } from '../shared/activation.mjs';
import { currentTurnKey } from '../shared/combat.mjs';
import { classQoLEnabled } from '../shared/settings.mjs';

/* ── Cheat — Sneak Attack ────────────────────────────────────────────────────
 *
 * "(1/turn) When you crit, deal additional damage."
 *  Level 1: 1d6 · 3: 1d8 · 7: 2d8 · 9: 2d10 · 11: 2d12 · 15: 2d20 · 17: 3d20
 *
 * Unlike Vicious Opportunist, the trigger here is not knowable in advance — you
 * find out you crit when the dice land. So this is a prompt rather than a
 * checkbox, and it only ever appears on a crit the player can still spend a use
 * on. The extra dice are appended to the attack's own damage roll, so they show
 * up on the same card, in the same roll tooltip, under the same single Apply
 * Damage button. A Vicious Opportunist upgrade counts: it produces a real crit,
 * and Sneak Attack is offered on it exactly as on a natural one.
 *
 * The scaling table is read out of the feature's own description rather than
 * hard-coded, so an upstream rebalance — or a homebrew edit on the actor's own
 * copy — is followed automatically. The printed table is the fallback.
 */

const SNEAK_IDENTIFIER = 'sneak-attack';
export const SNEAK_USED_FLAG = 'cheat.sneakUsedAt';
const SNEAK_FALLBACK_TABLE = [
	[1, '1d6'],
	[3, '1d8'],
	[7, '2d8'],
	[9, '2d10'],
	[11, '2d12'],
	[15, '2d20'],
	[17, '3d20'],
];

/** Set by the roll patch when dice were added; announced once the card exists. */
export let sneakOutcome = null;

export function setSneakOutcome(value) {
	sneakOutcome = value;
}

function sneakUseAvailable(actor) {
	if (!actor) return false;
	const turnKey = currentTurnKey();
	// Outside combat there is no turn structure to meter against.
	if (turnKey === null) return true;
	return actor.getFlag?.(MODULE_ID, SNEAK_USED_FLAG) !== turnKey;
}

export async function markSneakUsed(actor) {
	const turnKey = currentTurnKey();
	await actor.setFlag(
		MODULE_ID,
		SNEAK_USED_FLAG,
		turnKey ?? `untracked:${foundry.utils.randomID()}`,
	);
}

function actorFeature(actor, identifier) {
	return (
		actor?.items?.find?.((item) => item.type === 'feature' && item.system?.identifier === identifier) ??
		null
	);
}

function actorLevel(actor) {
	const fromLevels = Number(actor?.levels?.character);
	if (Number.isFinite(fromLevels) && fromLevels > 0) return fromLevels;
	try {
		const fromRollData = Number(actor?.getRollData?.()?.level);
		if (Number.isFinite(fromRollData) && fromRollData > 0) return fromRollData;
	} catch (_error) {
		// Fall through to the floor below.
	}
	return 1;
}

/** Pull "Level 7: 2d8" pairs out of the feature text. */
function parseScalingTable(feature) {
	const plain = String(feature?.system?.description ?? '').replace(/<[^>]+>/g, ' ');
	const table = [];
	for (const match of plain.matchAll(/level\s*(\d+)\s*:\s*(\d*d\d+)/gi)) {
		const level = Number.parseInt(match[1], 10);
		if (Number.isFinite(level)) table.push([level, match[2]]);
	}
	return table;
}

/** The highest table entry the actor's level has reached. */
function sneakAttackFormula(actor, feature) {
	const parsed = parseScalingTable(feature);
	const table = parsed.length > 0 ? parsed : SNEAK_FALLBACK_TABLE;
	const level = actorLevel(actor);

	let best = null;
	for (const [threshold, formula] of table) {
		if (threshold > level) continue;
		if (!best || threshold >= best[0]) best = [threshold, formula];
	}
	return best?.[1] ?? null;
}

/**
 * Append extra damage to an already-evaluated roll, so it lands on the attack's
 * own card instead of a second one. The terms are pushed onto the roll and the
 * total adjusted directly rather than via `_recalculateTotal`, which would undo
 * the system's "primary die does not count as damage" adjustment.
 */
export async function appendDamageToRoll(roll, formula, flavor) {
	const bonus = await new Roll(formula).evaluate();
	const total = Number(bonus.total);
	if (!Number.isFinite(total)) return null;

	const faces =
		bonus.dice?.flatMap((die) =>
			die.results.filter((result) => result.active && !result.discarded).map((r) => r.result),
		) ?? [];

	const OperatorTerm = foundry.dice?.terms?.OperatorTerm;
	if (OperatorTerm) {
		const operator = new OperatorTerm({ operator: '+' });
		// Terms carried by an evaluated roll must themselves read as evaluated, or
		// the card fails to rebuild the roll on other clients.
		operator._evaluated = true;
		for (const term of bonus.terms) {
			// Never on an operator: a term's formula is `expression[flavor]`, so a
			// flavoured `*` would serialise as `*[Lunging Strike]` and the roll would
			// no longer parse when another client rebuilds the card.
			if (term instanceof OperatorTerm) continue;
			if (term?.options && !term.options.flavor) term.options.flavor = flavor;
		}
		roll.terms.push(operator, ...bonus.terms);
		roll._total = (roll._total ?? 0) + total;
		roll.resetFormula();
	} else {
		// No term class to splice with: the damage still lands, just without a
		// breakdown in the tooltip.
		roll._total = (roll._total ?? 0) + total;
	}

	return { total, faces };
}

/**
 * Offer Sneak Attack on a crit. Runs inside the damage roll's own evaluation, so
 * everything downstream — the crit branch of the effect tree, the chat card, the
 * damage the GM applies — sees one coherent roll.
 */
export async function offerSneakAttack(roll) {
	if (!classQoLEnabled()) return;
	if (roll?.isCritical !== true) return;

	const activation = currentActivation();
	// One offer per activation, however many damage rolls it produces.
	if (!activation || activation.sneakHandled) return;

	const actor = activation.actor;
	if (!actor || actor.type !== 'character') return;

	const feature = actorFeature(actor, SNEAK_IDENTIFIER);
	if (!feature) return;

	activation.sneakHandled = true;
	if (!sneakUseAvailable(actor)) return;

	const formula = sneakAttackFormula(actor, feature);
	if (!formula) return;

	const confirmed = await foundry.applications.api.DialogV2.confirm({
		window: { title: 'Sneak Attack' },
		content:
			`<p><strong>Critical hit!</strong> Add Sneak Attack damage (<code>${escape(formula)}</code>)?</p>` +
			'<p><em>Once per turn — declining keeps the use.</em></p>',
		yes: { label: 'Sneak Attack', icon: 'fa-solid fa-user-ninja' },
		no: { label: 'Save it' },
		modal: true,
		rejectClose: false,
	});
	if (!confirmed) return;

	const bonus = await appendDamageToRoll(roll, formula, 'Sneak Attack');
	if (!bonus) return;
	activation.sneak = { formula, ...bonus };
}

export function announceSneakAttack(actor, sneak) {
	const breakdown = sneak.faces?.length ? ` → ${sneak.faces.join(', ')}` : '';
	ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: '<strong>Sneak Attack</strong>',
		content:
			`<p><strong>+${sneak.total}</strong> damage (<code>${escape(sneak.formula)}</code>${escape(breakdown)}) added to the critical hit.</p>` +
			'<p><em>Used for this turn.</em></p>',
	});
}

