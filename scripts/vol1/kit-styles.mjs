const KIT_STYLE_ID = 'nim-plus-kit-styles';
const KIT_CSS = `
	.nim-plus-kit-option { position: relative; }
	.nim-plus-kit-option.is-selected {
		border-color: var(--nimble-accent-color, hsl(0, 53%, 36%));
		box-shadow: 0 0 0 2px hsla(var(--nimble-accent-color-values, 0, 53%, 36%), 0.35);
	}
	.nim-plus-kit-option .nim-plus-kit-option__img {
		/* The kit icons are white Foundry-style SVGs. Render them as a mask
		   filled with the theme text color so they match the gold Font
		   Awesome glyphs on the native equipment/gold options. */
		width: 2rem;
		height: 2rem;
		background-color: var(--nimble-dark-text-color, #d9b15a);
		mask: var(--nim-plus-kit-icon) center / contain no-repeat;
		-webkit-mask: var(--nim-plus-kit-icon) center / contain no-repeat;
	}
	.nim-plus-kit-option__badge {
		position: absolute;
		top: 0.35rem;
		right: 0.35rem;
		padding: 1px 6px;
		font-size: 0.65em;
		font-weight: 700;
		letter-spacing: 0.03em;
		border-radius: 999px;
		background: rgba(217, 177, 90, 0.25);
		border: 1px solid rgba(217, 177, 90, 0.5);
	}
	/* Fallback layout in case the Svelte scope hash could not be copied. */
	.nim-plus-kit-option {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem;
		border-radius: 4px;
		cursor: pointer;
	}
	.nim-plus-kit-option ul { text-align: left; font-size: 0.85em; width: 100%; margin: 0.5rem 0 0; }
`;

export function ensureKitStyles() {
	if (document.getElementById(KIT_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = KIT_STYLE_ID;
	style.textContent = KIT_CSS;
	document.head.append(style);
}
