import { MODULE_ID } from '../core/constants.mjs';
import { escape } from '../core/html.mjs';
import { ensureKitStyles } from './kit-styles.mjs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Vol I — Variant Starting Kits in the character-creation dialog
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The zine's variant starting kits replace a class's standard starting
 * equipment (and the 50 gp option). The native Starting Equipment step only
 * knows 'equipment' | 'gold', so we inject the selected class's two kits as
 * extra option cards into that step's options grid and intercept the dialog's
 * `submitCharacterCreation`:
 *
 * - Clicking a kit card records the choice on the app instance and then clicks
 *   the native Gold option, which is what advances the Svelte wizard (its
 *   50 gp is suppressed at submit). Clicking a native option directly clears
 *   the kit choice again.
 * - At submit, a chosen kit rewrites `startingEquipmentChoice` to a sentinel
 *   that is neither 'equipment' (so the system disables the class/background
 *   grantItem rules) nor 'gold' (so no 50 gp is added), and after the actor is
 *   created the kit's contents are granted directly: weapons as one document
 *   per unit (so each can be equipped independently), everything else with its
 *   quantity, and a placeholder object for any grant whose compendium UUID no
 *   longer resolves. Granted objects are auto-equipped, mirroring the native
 *   'equipment' path.
 *
 * The dialog is a single reactively-updating Svelte mount, so injection is
 * driven by a MutationObserver (same pattern as the level-up feat section).
 * Injected cards copy the Svelte scope hash off a native option button so the
 * system's own option styles apply to them.
 */

let vol1KitDocsCache = null;
let vol1KitDocsPromise = null;
function loadVol1KitDocs() {
	vol1KitDocsPromise ??= (async () => {
		const pack = game.packs.get(`${MODULE_ID}.nim-plus-items`);
		if (!pack) {
			console.warn(`[${MODULE_ID}] Items compendium not found; starting kits unavailable.`);
			return [];
		}
		// Field-augmented index instead of getDocuments(): plain data with no
		// client-side document construction, and a fraction of the payload.
		const index = await pack.getIndex({
			fields: ['system.identifier', 'system.rules', 'flags'],
		});
		vol1KitDocsCache = index
			.filter((entry) => entry.flags?.[MODULE_ID]?.vol1Kit === true)
			.map((entry) => ({
				id: entry._id,
				uuid: entry.uuid,
				name: entry.name,
				img: entry.img,
				system: {
					identifier: entry.system?.identifier ?? '',
					rules: entry.system?.rules ?? [],
				},
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		console.log(`[${MODULE_ID}] Loaded ${vol1KitDocsCache.length} Vol I starting kits.`);
		return vol1KitDocsCache;
	})().catch((error) => {
		// Do not cache the failure: a later render retries the load.
		vol1KitDocsPromise = null;
		throw error;
	});
	return vol1KitDocsPromise;
}

/** "berserker-kit-1" → "berserker" (matches the class item's identifier). */
function kitClassIdentifier(kit) {
	return String(kit?.system?.identifier ?? '').replace(/-kit-\d+$/, '');
}

/** "The Cheat" → "the-cheat", matching class identifier slugs. */
function classNameToKey(name) {
	return String(name ?? '')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-');
}

/** The kit's grantItem rules, normalised for display and granting. */
function kitContents(kit) {
	return (kit?.system?.rules ?? [])
		.filter((rule) => rule.type === 'grantItem' && !rule.disabled)
		.map((rule) => ({
			uuid: rule.uuid ?? '',
			quantity: Number(rule.quantity) > 0 ? Number(rule.quantity) : 1,
			label:
				String(rule.label ?? '').replace(/^Starting Gear\s*[-–—]\s*/i, '').trim() ||
				'Adventuring Gear',
		}));
}

/**
 * Grant a kit's contents to a freshly created character. Weapons are granted
 * as one document per unit; other objects carry their quantity. A grant whose
 * UUID no longer resolves becomes a placeholder object so nothing is silently
 * lost. All granted objects are auto-equipped, mirroring the system's native
 * starting-equipment path.
 */
async function grantKitContents(actor, kit) {
	const sources = [];
	for (const entry of kitContents(kit)) {
		let doc = null;
		try {
			doc = entry.uuid ? await fromUuid(entry.uuid) : null;
		} catch (_error) {
			doc = null;
		}
		if (doc) {
			const source = doc.toObject();
			delete source._id;
			source._stats = source._stats ?? {};
			source._stats.compendiumSource = doc.uuid;
			const isWeapon = source.type === 'object' && source.system?.objectType === 'weapon';
			if (isWeapon && entry.quantity > 1) {
				source.system.quantity = 1;
				for (let i = 0; i < entry.quantity; i += 1) sources.push(foundry.utils.deepClone(source));
			} else {
				if (source.system && entry.quantity > 1) source.system.quantity = entry.quantity;
				sources.push(source);
			}
		} else {
			console.warn(`[${MODULE_ID}] Kit grant UUID did not resolve: ${entry.uuid} (${entry.label})`);
			sources.push({
				name: entry.label,
				type: 'object',
				img: 'icons/svg/item-bag.svg',
				system: {
					objectType: 'misc',
					quantity: entry.quantity,
					description: {
						public: `<p>Granted by <strong>${escape(kit.name)}</strong>. The original compendium item could not be found, so this placeholder was created — replace it with the real item if it becomes available.</p>`,
					},
				},
			});
		}
	}
	if (sources.length === 0) return;

	const created = await actor.createEmbeddedDocuments('Item', sources);
	for (const item of created ?? []) {
		if (item?.type === 'object' && item.system?.equipped === false) {
			try {
				await item.toggleEquipment?.();
			} catch (error) {
				console.error(`[${MODULE_ID}] Failed to auto-equip ${item.name}`, error);
			}
		}
	}
	ui.notifications?.info(`${actor.name} received the ${kit.name} starting gear.`);
}

/**
 * Wrap the dialog instance's submitCharacterCreation so a chosen kit replaces
 * both the standard equipment and the gold. The actor is captured via the
 * createActor hook for the duration of the original call (the method itself
 * only returns the dialog's close promise).
 */
function wrapCharacterCreationSubmit(app) {
	if (app.__nimPlusKitSubmitWrapped || typeof app.submitCharacterCreation !== 'function') return;
	app.__nimPlusKitSubmitWrapped = true;
	const original = app.submitCharacterCreation.bind(app);
	app.submitCharacterCreation = async function nimPlusSubmitWithKit(results) {
		let kit = app.__nimPlusSelectedKit ?? null;

		// The user may have gone back and switched class after picking a kit;
		// only honour a kit that matches the submitted class.
		if (kit) {
			try {
				const classUuid = results?.origins?.characterClass?.uuid;
				const classDoc = classUuid ? await fromUuid(classUuid) : null;
				const classId =
					classDoc?.system?.identifier ?? classNameToKey(classDoc?.name) ?? '';
				if (kitClassIdentifier(kit) !== classId) kit = null;
			} catch (_error) {
				kit = null;
			}
		}
		if (!kit) return original(results);

		const data = { ...results, startingEquipmentChoice: 'nim-plus-kit' };
		let createdActor = null;
		const capture = (actor, _options, userId) => {
			if (!createdActor && userId === game.user?.id && actor?.type === 'character') {
				createdActor = actor;
			}
		};
		Hooks.on('createActor', capture);
		try {
			return await original(data);
		} finally {
			Hooks.off('createActor', capture);
			if (createdActor) {
				await grantKitContents(createdActor, kit).catch((error) =>
					console.error(`[${MODULE_ID}] Failed to grant the ${kit.name}`, error),
				);
			} else {
				ui.notifications?.warn(
					`Could not find the new character to grant the ${kit.name}. Drag the kit from the Nim+ Items compendium onto the character instead.`,
				);
			}
		}
	};
}

/** The selected class's name, read off the collapsed class step's card. */
function selectedClassNameFromDialog(root) {
	return root.querySelector('[id$="-stage-0"] .nimble-card__title')?.textContent?.trim() ?? null;
}

/**
 * Inject (or refresh) the kit option cards in the Starting Equipment step, and
 * relabel the step's collapsed "gold" summary while a kit is selected.
 * Synchronous and idempotent (guarded by a signature on the options grid), so
 * the MutationObserver can call it freely.
 */
function syncKitOptions(app) {
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;
	const section = root.querySelector('[id$="-stage-3"]');
	if (!section) return;

	const optionsGrid = section.querySelector('.starting-equipment-options');
	const kit = app.__nimPlusSelectedKit ?? null;

	if (!optionsGrid) {
		// Step is collapsed. With a kit selected the native summary claims gold
		// was taken — hide its content (Svelte still owns those nodes, so they
		// are hidden rather than removed) and append our own label.
		const summary = section.querySelector('.selected-choice');
		if (!summary) return;
		if (kit) {
			if (summary.dataset.nimPlusKit === kit.id) return;
			summary.dataset.nimPlusKit = kit.id;
			summary.querySelector('.nim-plus-kit-summary')?.remove();
			for (const el of summary.children) {
				if (!el.classList.contains('nim-plus-kit-summary')) el.style.display = 'none';
			}
			summary.insertAdjacentHTML(
				'beforeend',
				`<span class="nim-plus-kit-summary"><i class="fa-solid fa-person-hiking"></i> Variant starting kit: ${escape(kit.name)}</span>`,
			);
		} else if (summary.dataset.nimPlusKit) {
			delete summary.dataset.nimPlusKit;
			summary.querySelector('.nim-plus-kit-summary')?.remove();
			for (const el of summary.children) el.style.display = '';
		}
		return;
	}

	const className = selectedClassNameFromDialog(root);
	const classKey = className ? classNameToKey(className) : null;

	// Drop a stale kit selection when the class no longer matches.
	if (kit && classKey && kitClassIdentifier(kit) !== classKey) {
		app.__nimPlusSelectedKit = null;
	}

	const kits = (classKey && vol1KitDocsCache)
		? vol1KitDocsCache.filter((k) => kitClassIdentifier(k) === classKey)
		: [];

	const sig = `${classKey ?? ''}|${app.__nimPlusSelectedKit?.id ?? ''}|${kits.length}`;
	const cardsPresent = optionsGrid.querySelector('.nim-plus-kit-option') !== null;
	// Re-inject even on a matching signature if the cards were removed from
	// under us (e.g. by a Svelte re-render that kept the grid element).
	if (optionsGrid.dataset.nimPlusKitSig === sig && (kits.length === 0 || cardsPresent)) return;
	optionsGrid.dataset.nimPlusKitSig = sig;
	optionsGrid.querySelectorAll('.nim-plus-kit-option').forEach((el) => el.remove());
	if (kits.length === 0) return;

	ensureKitStyles();
	const nativeOptions = [
		...optionsGrid.querySelectorAll('.starting-equipment-option:not(.nim-plus-kit-option)'),
	];
	// Svelte scopes the step's styles with a per-component hash class; copying
	// it off a native option makes the system's option styling apply to ours.
	const scopeHash = nativeOptions[0]
		? [...nativeOptions[0].classList].find((c) => c.startsWith('svelte-'))
		: null;
	const scoped = (cls) => (scopeHash ? `${cls} ${scopeHash}` : cls);

	for (const kitDoc of kits) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = `${scoped('starting-equipment-option')} nim-plus-kit-option`;
		if (app.__nimPlusSelectedKit?.id === kitDoc.id) btn.classList.add('is-selected');
		const contentsList = kitContents(kitDoc)
			.map((entry) => `<li>${escape(entry.label)}</li>`)
			.join('');
		btn.innerHTML = `
			<span class="nim-plus-kit-option__badge">Nim+ Vol I</span>
			<span class="nim-plus-kit-option__img" style="--nim-plus-kit-icon: url('${escape(kitDoc.img || 'icons/svg/item-bag.svg')}')"></span>
			<span class="${scoped('option-title')}">${escape(kitDoc.name)}</span>
			<p class="${scoped('option-description')}">Variant rule: take this kit instead of the standard equipment or gold.</p>
			<ul class="${scoped('equipment-list')}">${contentsList}</ul>`;
		btn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			app.__nimPlusSelectedKit = kitDoc;
			// Advance the native wizard by choosing gold; its 50 gp is suppressed
			// at submit and grant rules are disabled for any non-'equipment' choice.
			const goldBtn =
				nativeOptions.find((b) => b.querySelector('.fa-coins')) ?? nativeOptions[1];
			app.__nimPlusKitAutoClick = true;
			try {
				goldBtn?.click();
			} finally {
				app.__nimPlusKitAutoClick = false;
			}
			syncKitOptions(app);
		});
		optionsGrid.appendChild(btn);
	}

	// A direct click on a native option overrides any kit selection.
	if (!optionsGrid.dataset.nimPlusNativeHooked) {
		optionsGrid.dataset.nimPlusNativeHooked = 'true';
		optionsGrid.addEventListener(
			'click',
			(event) => {
				if (app.__nimPlusKitAutoClick) return;
				const nativeBtn = event.target?.closest?.(
					'.starting-equipment-option:not(.nim-plus-kit-option)',
				);
				if (nativeBtn && app.__nimPlusSelectedKit) {
					app.__nimPlusSelectedKit = null;
					syncKitOptions(app);
				}
			},
			true,
		);
	}
}

function syncKitOptionsSafe(app) {
	try {
		syncKitOptions(app);
	} catch (error) {
		console.error(`[${MODULE_ID}] Failed to sync starting-kit options`, error);
	}
}

Hooks.on('renderCharacterCreationDialog', (app) => {
	console.log(`[${MODULE_ID}] Character-creation dialog detected; wiring Vol I starting-kit options.`);
	wrapCharacterCreationSubmit(app);
	const root = app?.element instanceof HTMLElement ? app.element : app?.element?.[0];
	if (!root) return;
	try {
		app.__nimPlusKitObserver?.disconnect();
	} catch (_error) {
		/* previous observer already gone */
	}
	const observer = new MutationObserver(() => syncKitOptionsSafe(app));
	observer.observe(root, { childList: true, subtree: true });
	app.__nimPlusKitObserver = observer;
	// The kit docs load once per session; re-sync when they arrive.
	const kitLoadWatchdog = setTimeout(() => {
		if (vol1KitDocsCache === null) {
			console.warn(
				`[${MODULE_ID}] The Vol I kit index is still loading after 15s — starting-kit options may be missing.`,
			);
		}
	}, 15000);
	loadVol1KitDocs()
		.then(() => syncKitOptionsSafe(app))
		.catch((error) => console.error(`[${MODULE_ID}] Failed to load Vol I kits`, error))
		.finally(() => clearTimeout(kitLoadWatchdog));
	syncKitOptionsSafe(app);
});

Hooks.on('closeCharacterCreationDialog', (app) => {
	try {
		app.__nimPlusKitObserver?.disconnect();
	} catch (_error) {
		/* nothing to disconnect */
	}
});
