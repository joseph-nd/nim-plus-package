import { MODULE_ID } from '../../core/constants.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Class QoL automation — the Cheat, the Commander, the Oathsworn
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Three per-class quality-of-life automations that remove bookkeeping the
 * player would otherwise have to remember:
 *
 *   • Cheat — Vicious Opportunist. One roll instead of two: tick a box in the
 *     activation dialog, and a hit on a Distracted target is upgraded to a crit
 *     automatically. Natural crits and misses never spend the 1/turn use.
 *   • Cheat — Sneak Attack. Offered as a prompt on a crit, with the extra dice
 *     folded into the attack's own damage roll.
 *   • Commander — Coordinated Strike!. Supplied as a `chargePool` +
 *     `chargeConsumer` rule pair, so the INT-per-Safe-Rest counter is tracked,
 *     spent, and refilled by the system's own charge subsystem.
 *   • Commander — Combat Dice & Combat Tactics. The tactic becomes a choice you
 *     make on the attack: pick it in the activation dialog, its Combat Die rolls
 *     into the attack's own damage, and the die is spent only when the tactic
 *     actually did something. Inerrant Strike is offered on a miss instead.
 *   • Oathsworn — Radiant Judgement. Judgment Dice roll themselves on a missed
 *     incoming attack too, not only when damage lands, and the rolled total is
 *     added to the next melee weapon swing as radiant damage, then expended.
 *
 * ── Update-resilience notes ───────────────────────────────────────────────────
 * Everything under `scripts/classes/` is written to *degrade to nothing* if the
 * Nimble system changes shape underneath it, rather than to break the game:
 *
 *   - Every patch is applied through a named wrapper that always calls the
 *     original, guarded by a `__nimPlus*Patched` sentinel and a try/catch, so a
 *     throw inside our logic can never swallow an attack roll.
 *   - Classes are resolved by *capability* (a prototype that owns the methods we
 *     rely on), never by `constructor.name` — the system ships minified, so
 *     class names are mangled while method names survive.
 *   - Hook names are derived from `game.system.id` rather than hardcoded, so the
 *     `nimble-dev` build works too.
 *   - The dice-pool refill for "an enemy attacked me" is performed by *emitting
 *     the system's own `damageApplied` hook*, which is what the system's
 *     `onAttacked` trigger already listens to — we re-use its refill engine
 *     instead of reimplementing pool maths.
 *   - Feature detection is by `system.identifier`, which the system derives from
 *     the item name, so renames of ids we don't control are tolerated where
 *     practical (the Judgment pool is found by a fuzzy identifier match, which
 *     covers both "judgment" and "judgement" spellings).
 *
 * The whole domain is gated behind one world setting, so a table that would
 * rather do its own bookkeeping can switch it off in a single click. Each entry
 * point calls `classQoLEnabled()` first and stays completely inert when it
 * returns false — no hooks removed, no prototypes unwrapped, just early returns.
 */
const CLASS_QOL_SETTING = 'enableClassAutomation';

export function classQoLEnabled() {
	try {
		return game.settings?.get?.(MODULE_ID, CLASS_QOL_SETTING) !== false;
	} catch (_error) {
		// Settings not registered yet (very early data prep) — stay inert.
		return false;
	}
}

Hooks.once('init', () => {
	game.settings.register(MODULE_ID, CLASS_QOL_SETTING, {
		name: 'Enable Class Automation',
		hint: "Automates bookkeeping for the Cheat (Vicious Opportunist's one-roll crit upgrade, Sneak Attack on a crit), the Commander (Combat Tactics picked on the attack itself, Combat Dice spent and tracked with it, Coordinated Strike! use counter) and the Oathsworn (auto-rolled Judgment Dice, auto-applied radiant damage). Turn off to roll everything by hand.",
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
	});
});
