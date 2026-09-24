import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { sysId, sysHook } from '../core/system.mjs';
import { hasActiveRule } from '../core/rules.mjs';
import { classQoLEnabled } from '../classes/shared/settings.mjs';
import { iterateChargePools, setChargePoolCurrent } from '../core/pools.mjs';
import { activationLabel, confirmItemUse } from '../core/item-use.mjs';
import { encounterActive, ENCOUNTER_EDGE_HOOKS } from './encounter.mjs';

/* ── Sheet — feature use counters on the tracker rail ────────────────────────
 *
 * The system's own tracker rail — the little flyout down the left edge of the
 * character sheet, where an Oathsworn's Judgment Dice show up — deliberately
 * skips charge pools that carry no die size, on the grounds that those are
 * "pure counters ... already rendered by ChargeIndicator elsewhere on the
 * sheet". Elsewhere means the Features tab.
 *
 * For a resource you spend several times in the middle of someone else's turn —
 * Coordinated Strike!'s INT uses being the obvious case — a counter you have to
 * change tabs to read is a counter you forget. So those pools are mirrored onto
 * the rail alongside the system's own dice pools (which we leave alone).
 *
 * What gets a counter:
 *  - count-only pools (no die size) from a **class feature or an ancestry** — a
 *    bag of charged magic items belongs on the inventory tab, not here;
 *  - that are not hidden (a hidden pool is an internal gate, not a resource —
 *    Coordinated Strike!'s "once per round" is one);
 *  - and that are **multi-use**: max > 1. Single-use pools — the 1/encounter
 *    reactions such as Hold the Line! or I Can Do This ALL DAY! — stay on the
 *    Features tab with the system's ChargeIndicator only. A lone pip is a
 *    yes/no you can read there, and a big target for a misclick here.
 *    Exceptions: Coordinated Strike!'s encounter and INT pools are always
 *    railed (`ALWAYS_RAILED_POOLS`), and a feature can force its pools on or
 *    off in data with `flags.nim-plus-package.chargeRail: true | false`.
 *  - "max" is the pool's evaluated max at render time (the system writes the
 *    resolved number into the flag). A formula pool that is currently 1 — INT
 *    uses at INT 1 — is therefore off the rail until the formula grows past 1,
 *    and appears on the next redraw once it does.
 *
 * What a click does: nothing on its own. Every pip — spent or available — asks
 * "Use <Feature> (<Reaction|1 Action|…>)?" and, on Yes, runs the sheet's own
 * activation (`actor.activateItem`), so the action / reaction cost, the chat
 * card, any `chargeConsumer` and any refusal at zero all come from the system.
 * A feature with no `chargeConsumer` for its pool has one use moved off the
 * counter after a successful use, so the counter still tracks it. Cancel, a
 * closed dialog or a refused use cost nothing. The pips never set the count:
 * corrections by hand go through the system's own charges dialog (the counter
 * pill on the Features tab, with its +/-). The system does not expose that
 * dialog to modules (GenericDialog / ConfigureChargesDialog are bundle-private),
 * so the rail points at it in the badge tooltip rather than opening it.
 *
 * The rail exists for the moment of play these counters are spent in, so it is
 * there for the fight and gone the rest of the time — the Features tab still
 * carries every counter, including out of combat.
 *
 * Styling borrows the rail's own CSS custom properties rather than copying any
 * values, so it follows the sheet's theme, and the whole thing is re-derived
 * from flag state on every render — there is no state of our own to drift.
 */

const CHARGE_RAIL_CLASS = 'nim-plus-charge-rail';
const CHARGE_RAIL_STYLE_ID = 'nim-plus-charge-rail-styles';

/** Item types whose count-only pools belong on the rail. */
const RAILED_POOL_SOURCES = new Set(['feature', 'ancestry']);

/**
 * Pools that are railed even when single-use: resources spent on someone else's
 * turn that a player has to keep an eye on mid-fight, not a lone reaction. Keyed
 * by pool identifier so the system copy and the Nim+ 0.2 copy share the entry.
 */
const ALWAYS_RAILED_POOLS = new Set(['coordinated-strike-encounter', 'coordinated-strike-uses']);

/**
 * The rail decision for one pool. A source feature can settle it in data with
 * `flags.nim-plus-package.chargeRail` (`true` always, `false` never); otherwise
 * the pools listed above are always railed and the rest only when multi-use.
 */
function isRailed(identifier, max, source) {
	const override = source?.flags?.[MODULE_ID]?.chargeRail;
	if (override === true) return max >= 1;
	if (override === false) return false;
	if (ALWAYS_RAILED_POOLS.has(identifier)) return max >= 1;
	return max > 1;
}

/**
 * Visible, count-only charge pools a feature or ancestry granted that pass
 * `isRailed` (multi-use, or an exception), sorted by label. `max` is the pool's
 * evaluated max right now.
 */
export function featureChargePools(actor) {
	const pools = [];
	for (const entry of iterateChargePools(actor)) {
		const pool = entry.pool;
		if (pool.dieSize != null) continue; // roll-on-spend: the system already rails it
		// A hidden pool is an internal gate rather than a resource — Coordinated
		// Strike!'s "once per round" is one — and the system draws none of them.
		if (pool.hidden) continue;
		const max = Number(pool.max);
		if (!Number.isFinite(max)) continue;

		const source = actor.items?.get?.(pool.sourceItemId) ?? null;
		if (!RAILED_POOL_SOURCES.has(source?.type)) continue;
		// Single-use pools stay on the Features tab only, bar the exceptions (see the header).
		const identifier = String(pool.identifier ?? entry.key.replace(/^actor:/, ''));
		if (!isRailed(identifier, max, source)) continue;

		pools.push({
			...entry,
			max,
			current: Math.max(0, Math.min(Number(pool.current) || 0, max)),
			source,
			label: String(pool.label ?? source.name ?? 'Uses'),
			img: source.img ?? null,
		});
	}
	return pools.sort((a, b) => a.label.localeCompare(b.label));
}

function ensureChargeRailStyles() {
	if (document.getElementById(CHARGE_RAIL_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = CHARGE_RAIL_STYLE_ID;
	style.textContent = `
		.${CHARGE_RAIL_CLASS}__panel {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.625rem;
			padding: 0.25rem;
			background: color-mix(in srgb, var(--nimble-sheet-background) 85%, transparent);
			border: 1px solid var(--nimble-dice-pool-tracker-panel-border-color, currentColor);
			border-left: none;
			border-radius: 0 6px 6px 0;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
		}
		.${CHARGE_RAIL_CLASS}__group {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.125rem;
		}
		.${CHARGE_RAIL_CLASS}__badge {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 1.625rem;
			height: 1.625rem;
			padding: 0;
			overflow: hidden;
			background: var(--nimble-dice-pool-tracker-badge-background, transparent);
			border: 1px solid var(--nimble-dark-text-color, currentColor);
			border-radius: 4px;
			cursor: default;
		}
		.${CHARGE_RAIL_CLASS}__badge img {
			width: 100%;
			height: 100%;
			border: none;
			object-fit: cover;
		}
		.${CHARGE_RAIL_CLASS}__badge i {
			font-size: 0.875rem;
			color: var(--nimble-dark-text-color, currentColor);
		}
		.${CHARGE_RAIL_CLASS}__pip {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 1.625rem;
			height: 1.625rem;
			padding: 0;
			background: var(--nimble-dice-pool-tracker-badge-background, transparent);
			border: 1px solid var(--nimble-dice-pool-tracker-pip-border-color, currentColor);
			border-radius: 4px;
			cursor: pointer;
			transition: border-color 0.15s ease, background 0.15s ease;
		}
		.${CHARGE_RAIL_CLASS}__pip i { font-size: 0.875rem; }
		.${CHARGE_RAIL_CLASS}__pip--available {
			border-color: var(--nimble-dice-pool-tracker-available-color, currentColor);
		}
		.${CHARGE_RAIL_CLASS}__pip--available i {
			color: var(--nimble-dice-pool-tracker-available-color, currentColor);
		}
		.${CHARGE_RAIL_CLASS}__pip--available:hover {
			background: var(--nimble-dice-pool-tracker-pip-hover-background, transparent);
		}
		.${CHARGE_RAIL_CLASS}__pip--spent i { opacity: 0.35; }
	`;
	document.head.append(style);
}

/**
 * Does this feature declare a consumer for its own pool? If it does, using the
 * feature is what spends the charge — moving the counter here as well would
 * spend it twice.
 */
function poolHasChargeConsumer(item, entry) {
	const identifier = String(entry.pool?.identifier ?? entry.key ?? '').toLowerCase();
	if (identifier.length < 1) return false;
	return hasActiveRule(item, (rule) => {
		if (rule.type !== 'chargeConsumer') return false;
		const target = String(rule.poolIdentifier || rule.identifier || rule.id || '').toLowerCase();
		return target === identifier;
	});
}

/**
 * A pip click is a request to use the feature, never a direct edit: confirm,
 * then go through the sheet's own activation path — the same chat card, action /
 * reaction cost, macro and refusal at zero as the Features tab.
 *
 * The spend itself is left to whoever owns it: a feature that declares a
 * `chargeConsumer` has one deducted by the system as part of the use, and only a
 * feature without one needs us to move the counter afterwards. A cancelled
 * confirm, or a use that never produced a card, costs nothing either way.
 */
async function useFromRail(entry) {
	const item = entry.source ?? entry.document;
	const actor = item?.parent;
	if (!(actor instanceof Actor) || typeof actor.activateItem !== 'function') return;

	if (!(await confirmItemUse(item))) return;

	const card = await actor.activateItem(item.id);
	if (!card) return;
	if (!poolHasChargeConsumer(item, entry)) await setChargePoolCurrent(entry, entry.current - 1);
}

function injectChargeRail(app, root) {
	if (!classQoLEnabled()) return;
	const actor = app?.document ?? app?.actor;
	if (!(actor instanceof Actor) || actor.type !== 'character') return;

	root.querySelectorAll(`.${CHARGE_RAIL_CLASS}`).forEach((el) => el.remove());

	const rail = root.querySelector('.nimble-sheet__left-trackers');
	if (!rail) return;

	if (!encounterActive()) return;

	const pools = featureChargePools(actor);
	if (pools.length === 0) return;

	ensureChargeRailStyles();

	const container = document.createElement('div');
	container.className = CHARGE_RAIL_CLASS;

	const panel = document.createElement('div');
	panel.className = `${CHARGE_RAIL_CLASS}__panel`;

	for (const pool of pools) {
		const group = document.createElement('div');
		group.className = `${CHARGE_RAIL_CLASS}__group`;

		const badge = document.createElement('div');
		badge.className = `${CHARGE_RAIL_CLASS}__badge`;
		badge.dataset.tooltip =
			`${pool.label} — ${pool.current}/${pool.max} uses. To correct the count, use its counter on the Features tab.`;
		badge.dataset.tooltipDirection = 'RIGHT';
		badge.innerHTML = pool.img
			? `<img src="${escape(pool.img)}" alt="">`
			: '<i class="fa-solid fa-circle-dot"></i>';
		group.append(badge);

		const cost = activationLabel(pool.source);
		const useTip = cost ? `Use ${pool.label} (${cost})…` : `Use ${pool.label}…`;
		for (let index = 0; index < pool.max; index += 1) {
			const available = index < pool.current;
			const pip = document.createElement('button');
			pip.type = 'button';
			pip.className =
				`${CHARGE_RAIL_CLASS}__pip ${CHARGE_RAIL_CLASS}__pip--${available ? 'available' : 'spent'}`;
			pip.dataset.tooltip = useTip;
			pip.dataset.tooltipDirection = 'RIGHT';
			pip.innerHTML = '<i class="fa-solid fa-circle"></i>';
			// Every pip asks before using the feature; none of them sets the count.
			pip.addEventListener('click', (event) => {
				event?.preventDefault?.();
				useFromRail(pool).catch((error) =>
					console.error(`[${MODULE_ID}] Failed to use ${pool.label}`, error),
				);
			});
			group.append(pip);
		}

		panel.append(group);
	}

	container.append(panel);
	rail.append(container);
}

/**
 * Re-inject on any open character sheet. The sheets are Svelte-rendered and
 * update their own state in place without a Foundry re-render, so a pool change
 * would otherwise leave our pips stale.
 */
export function refreshChargeRails(actorId = null) {
	const apps = foundry.applications?.instances?.values?.() ?? [];
	for (const app of apps) {
		const actor = app?.document ?? app?.actor;
		if (!(actor instanceof Actor) || actor.type !== 'character') continue;
		if (actorId && actor.id !== actorId) continue;
		const root = app.element instanceof HTMLElement ? app.element : null;
		if (!root?.querySelector('.nimble-sheet__left-trackers')) continue;
		try {
			injectChargeRail(app, root);
		} catch (error) {
			console.error(`[${MODULE_ID}] Failed to refresh the use counters`, error);
		}
	}
}

Hooks.on('renderPlayerCharacterSheet', (app, html) => {
	const root = html instanceof HTMLElement ? html : html?.[0];
	if (!root) return;
	try {
		injectChargeRail(app, root);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to add the use counters to the sheet`, error);
	}
});

for (const hook of ['updateItem', 'updateActor']) {
	Hooks.on(hook, (document, changed) => {
		// Only charge-pool writes can change what the rail draws.
		if (!changed?.flags?.[sysId()]?.chargePools) return;
		const actor = document instanceof Actor ? document : (document?.actor ?? null);
		if (actor?.type !== 'character') return;
		refreshChargeRails(actor.id);
	});
}

// Registered at setup, not at load: `sysHook` needs `game.system` to exist.
Hooks.once('setup', () => {
	for (const hook of ['chargePool.changed', 'chargePool.recovered']) {
		Hooks.on(sysHook(hook), () => refreshChargeRails());
	}
});

// The rail only exists during an encounter, so every edge of one redraws it.
for (const hook of ENCOUNTER_EDGE_HOOKS) {
	Hooks.on(hook, () => refreshChargeRails());
}

