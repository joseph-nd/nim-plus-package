import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { sysId, sysHook } from '../core/system.mjs';
import { hasActiveRule } from '../core/rules.mjs';
import { classQoLEnabled } from '../classes/shared/settings.mjs';
import { iterateChargePools, setChargePoolCurrent } from '../core/pools.mjs';
import { encounterActive, ENCOUNTER_EDGE_HOOKS } from './encounter.mjs';

/* ── Sheet — feature use counters on the tracker rail ────────────────────────
 *
 * The system's own tracker rail — the little flyout down the left edge of the
 * character sheet, where an Oathsworn's Judgment Dice show up — deliberately
 * skips charge pools that carry no die size, on the grounds that those are
 * "pure counters ... already rendered by ChargeIndicator elsewhere on the
 * sheet". Elsewhere means the Features tab.
 *
 * For a resource you spend in the middle of someone else's turn — Coordinated
 * Strike! being the obvious case — a counter you have to change tabs to read is
 * a counter you forget. So those pools are mirrored onto the rail alongside the
 * system's own, restricted to pools that come from a **class feature or an
 * ancestry**: a bag full of charged magic items belongs on the inventory tab,
 * not here. Ancestry traits earn their place for the same reason features do —
 * "1/encounter" reactions like the Orc's *Stormstep* are spent on somebody
 * else's turn, and the Features tab is the wrong place to be hunting for them.
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

/** Count-only charge pools a feature or ancestry granted, in sheet order. */
export function featureChargePools(actor) {
	const pools = [];
	for (const entry of iterateChargePools(actor)) {
		const pool = entry.pool;
		if (pool.dieSize != null) continue; // roll-on-spend: the system already rails it
		// A hidden pool is an internal gate rather than a resource — Coordinated
		// Strike!'s "once per round" is one — and the system draws none of them.
		if (pool.hidden) continue;
		const max = Number(pool.max);
		if (!Number.isFinite(max) || max < 1) continue;

		const source = actor.items?.get?.(pool.sourceItemId) ?? null;
		if (!RAILED_POOL_SOURCES.has(source?.type)) continue;

		pools.push({
			...entry,
			max,
			current: Math.max(0, Math.min(Number(pool.current) || 0, max)),
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
 * Spending a single use *is* the feature being used, so it goes through the
 * sheet's own activation path — the same chat card you get from the Features
 * tab, the same macro, the same refusal at zero — rather than quietly moving a
 * number. Anything else the pips can express (restoring a use, or dropping the
 * counter by several at once) is bookkeeping, and only sets the count.
 *
 * The spend itself is left to whoever owns it: a feature that declares a
 * `chargeConsumer` has one deducted by the system as part of the use, and only a
 * feature without one needs us to move the counter afterwards. A use that never
 * produced a card was refused or cancelled, and costs nothing either way.
 */
async function useOrSetChargePool(entry, next) {
	const item = entry.document;
	const actor = item?.parent;
	const spendsOne = next === entry.current - 1;

	if (!spendsOne || !(actor instanceof Actor) || typeof actor.activateItem !== 'function') {
		await setChargePoolCurrent(entry, next);
		return;
	}

	const card = await actor.activateItem(item.id);
	if (!card) return;
	if (!poolHasChargeConsumer(item, entry)) await setChargePoolCurrent(entry, next);
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
		badge.dataset.tooltip = `${pool.label} — ${pool.current}/${pool.max} uses`;
		badge.dataset.tooltipDirection = 'RIGHT';
		badge.innerHTML = pool.img
			? `<img src="${escape(pool.img)}" alt="">`
			: '<i class="fa-solid fa-circle-dot"></i>';
		group.append(badge);

		for (let index = 0; index < pool.max; index += 1) {
			const available = index < pool.current;
			const pip = document.createElement('button');
			pip.type = 'button';
			pip.className =
				`${CHARGE_RAIL_CLASS}__pip ${CHARGE_RAIL_CLASS}__pip--${available ? 'available' : 'spent'}`;
			const usesOne = available && index === pool.current - 1;
			pip.dataset.tooltip = usesOne
				? `Use ${pool.label}`
				: available
					? `Set ${pool.label} to ${index} uses`
					: `Set ${pool.label} to ${index + 1} uses`;
			pip.dataset.tooltipDirection = 'RIGHT';
			pip.innerHTML = '<i class="fa-solid fa-circle"></i>';
			// Clicking an available pip spends down to it; clicking a spent one
			// restores up to it. Both read as "set the counter to here".
			pip.addEventListener('click', () => {
				useOrSetChargePool(pool, available ? index : index + 1).catch((error) =>
					console.error(`[${MODULE_ID}] Failed to adjust ${pool.label}`, error),
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

