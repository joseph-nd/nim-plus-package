import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import {
	STRAIN_FLAG,
	actorIsPsion,
	strainGain,
	strainGetDieSize,
	strainLose,
	strainRoll,
} from './strain.mjs';

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

export function ensureStrainStyles() {
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

// Inject the stylesheet once the document exists, rather than lazily on first
// render, so the widget never flashes unstyled.
Hooks.once('ready', () => {
	ensureStrainStyles();
});

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

