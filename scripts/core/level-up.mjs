/* ── Nimble's level-up window ────────────────────────────────────────────────
 *
 * The level-up window is not a class of its own: the system renders it — along
 * with the level-down window, the character creator and every other Svelte
 * dialog — through a single `GenericDialog` shell, so `renderGenericDialog`
 * fires for all of them and the actor on `app.data.document` is not enough to
 * tell them apart.
 *
 * What does tell them apart is the singleton id the system stamps on the
 * level-up dialog (`<actorId>-level-up`, from `NimbleCharacter#getLevelUpDialogId`).
 * On Foundry v13 it reached us as an ordinary application option, because Foundry
 * read `options.uniqueId` when it built the application's DOM id. Foundry v14
 * overwrites `options.uniqueId` with its own counter (`"61"`) for every
 * ApplicationV2, so that option no longer carries the system's id. The system
 * still keeps the id privately and exposes it through its singleton registry
 * (`GenericDialog.getOpen(id)`), which is registered before `renderGenericDialog`
 * fires; that is the primary match now. The window title is kept as a last
 * fallback — a dialog we cannot identify is one we leave alone.
 *
 * Nothing here registers a hook, so importing it cannot disturb load order.
 */

/**
 * The character whose level-up window this is, or null for any other dialog.
 *
 * Note what is *not* checked: the dialog carries no class identifier. It used to
 * be tested for, and since `GenericDialog` is only ever handed `{ document }`
 * that test could never pass — every injection guarded by it was dead code.
 */
export function levelUpDialogActor(app) {
	const actor = app?.data?.document;
	if (!(actor instanceof Actor) || actor.type !== 'character' || !actor.isOwner) return null;

	const expectedId =
		typeof actor.getLevelUpDialogId === 'function'
			? actor.getLevelUpDialogId()
			: `${actor.id}-level-up`;

	// v13: the system's id survives as the application option.
	if (app?.options?.uniqueId === expectedId) return actor;

	// v14: ask the system's singleton registry which dialog owns the id.
	const registered = app?.constructor?.getOpen?.(expectedId);
	if (registered) return registered === app ? actor : null;

	// No id to match on: fall back to the title, which the system writes as
	// "<name>: Level Up (6 → 7)". The level-down window reads "Level Down", so
	// an explicit test for it is not needed — but it is cheap insurance.
	const title = String(app?.options?.window?.title ?? '');
	if (/level\s*down/i.test(title)) return null;
	return /level\s*up/i.test(title) ? actor : null;
}

/** Poll (via animation frames) for the level-up dialog's body/footer to mount. */
export function waitForLevelUpAnchors(root, tries = 30) {
	return new Promise((resolve) => {
		const check = (n) => {
			if (!root.isConnected) return resolve({});
			const body = root.querySelector('.nimble-sheet__body');
			const footer = root.querySelector('.nimble-sheet__footer');
			if ((body && footer) || n <= 0) return resolve({ body, footer });
			requestAnimationFrame(() => check(n - 1));
		};
		check(tries);
	});
}
