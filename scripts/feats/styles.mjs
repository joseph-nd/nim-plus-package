export const FEATS_WIDGET_CLASS = 'nim-plus-feats';
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
	.nim-plus-feats-section__empty { opacity: 0.6; font-style: italic; font-size: 0.9em; padding: 0.4rem 0; }
	.nim-plus-feats-section__list {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0.25rem 0 0 0;
		padding: 0;
		list-style: none;
	}

	/* Replica of the system's (Svelte-scoped, hence unreachable) feature-card
	   styles, built on the same theme variables so it matches either theme. */
	.nim-plus-feat-card {
		--nimble-heading-color: var(--nimble-card-text-color);
		background: var(--nimble-card-background-color);
		border: 1px solid var(--nimble-card-border-color);
		border-radius: 4px;
		box-shadow: var(--nimble-box-shadow);
		color: var(--nimble-card-text-color);
		overflow: hidden;
	}
	.nim-plus-feat-card__header {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		min-height: 2rem;
		padding-inline-end: 0.25rem;
		cursor: pointer;
	}
	.nim-plus-feat-card__img-wrapper {
		position: relative;
		flex-shrink: 0;
		height: 2rem;
		width: 2rem;
		margin-inline-end: 0.5rem;
		border-right: 1px solid var(--nimble-card-border-color);
	}
	.nim-plus-feat-card__img-activate {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.55);
		border: 0;
		color: white;
		cursor: pointer;
		font-size: var(--nimble-sm-text);
		opacity: 0;
		padding: 0;
		transition: opacity var(--nimble-standard-transition);
		z-index: 2;
	}
	.nim-plus-feat-card__img-activate:hover,
	.nim-plus-feat-card__img-activate:focus-visible {
		opacity: 1;
		outline: none;
	}
	.nim-plus-feat-card__img {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
		border-radius: 0;
		background-color: rgba(0, 0, 0, 0.7);
		object-fit: cover;
		object-position: center;
	}
	.nim-plus-feat-card__name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1;
	}
	.nim-plus-feat-card__req {
		flex-shrink: 0;
		font-size: var(--nimble-xs-text, 0.65rem);
		color: var(--nimble-medium-text-color);
		white-space: nowrap;
		margin-inline-end: 0.35rem;
	}

	/* Feats (Choose one) section injected into the native level-up window. */
	.nim-plus-levelup-feats { margin-top: 0.75rem; }
	.nim-plus-levelup-feats__header { margin-bottom: 0.35rem; }
	.nim-plus-levelup-feats__header .nimble-heading { margin: 0; }
`;

export function ensureFeatStyles() {
	if (document.getElementById(FEATS_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = FEATS_STYLE_ID;
	style.textContent = FEATS_WIDGET_CSS;
	document.head.append(style);
}
