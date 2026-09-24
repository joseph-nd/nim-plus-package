import { MODULE_ID } from './constants.mjs';

/**
 * DialogV2 helpers — one place that knows how Foundry v14's DialogV2 really
 * behaves (client/applications/api/dialog.mjs):
 *
 *  1. `_renderHTML` builds its own `<form class="dialog-form">` and sets its
 *     `innerHTML` to the dialog content + button footer. HTML fragment parsing
 *     inside a `<form>` context DROPS any nested `<form>` start tag, so a
 *     `<form class="nim-plus-…">` in `content` never exists in the DOM and
 *     `querySelector('form.nim-plus-…')` always finds nothing. Content must
 *     use a `<div>` wrapper, and fields are read from DialogV2's own form —
 *     the clicked button's `button.form`.
 *  2. `_onSubmit` resolves `(await button.callback(event, button, dialog)) ??
 *     button.action`: a callback returning null/undefined (the usual "Cancel"
 *     callback) resolves to the button's action STRING ("cancel", "ok"…), not
 *     null. Closing the window (header ×, Escape) resolves `null` when
 *     `rejectClose` is false.
 *
 * `waitDialog` normalises (2): callbacks returning nullish, and any button
 * listed in `cancelActions`, resolve to `null` — so callers can keep the
 * natural `if (!result) return null` guard. The read helpers handle (1).
 */

/** Sentinel a wrapped callback returns instead of null (so `?? action` never fires). */
const NOTHING = Symbol(`${MODULE_ID}.dialog.nothing`);

/** Default button actions treated as "the user backed out". */
export const CANCEL_ACTIONS = Object.freeze(['cancel']);

/**
 * `DialogV2.wait` with sane results:
 *  - a button's callback value, as usual;
 *  - `null` when the dialog is closed / Escaped, when a `cancelActions` button
 *    is pressed, or when a callback returns null/undefined;
 *  - a button with NO callback still resolves to its action string (Foundry's
 *    own semantics — handy for "which button" dialogs).
 * Errors (including a rejected close with `rejectClose: true`) resolve `null`
 * and are logged.
 *
 * @param {object} config                          DialogV2.wait configuration
 * @param {object} [options]
 * @param {string[]} [options.cancelActions]       button actions that mean "cancel"
 * @returns {Promise<any|null>}
 */
export async function waitDialog(config = {}, { cancelActions = CANCEL_ACTIONS } = {}) {
	const cancel = new Set(cancelActions);
	const buttons = (config.buttons ?? []).map((button) => {
		if (cancel.has(button.action)) return { ...button, callback: () => NOTHING };
		if (typeof button.callback !== 'function') return button;
		const original = button.callback;
		return { ...button, callback: async (...args) => (await original(...args)) ?? NOTHING };
	});
	let result;
	try {
		result = await foundry.applications.api.DialogV2.wait({ rejectClose: false, ...config, buttons });
	} catch (error) {
		if (config.rejectClose !== true) console.error(`[${MODULE_ID}] dialog failed`, error);
		return null;
	}
	return normalizeDialogResult(result, cancelActions);
}

/**
 * Normalise a raw DialogV2 result: the internal sentinel, `undefined` and any
 * of `cancelActions` (the action string Foundry substitutes for a Cancel
 * callback returning null) become `null`.
 */
export function normalizeDialogResult(result, cancelActions = CANCEL_ACTIONS) {
	if (result === NOTHING || result === undefined || result === null) return null;
	if (typeof result === 'string' && cancelActions.includes(result)) return null;
	return result;
}

/**
 * The form holding the dialog's fields: DialogV2's own `<form class="dialog-form">`.
 * `button.form` is that form for any button inside it (the documented v14
 * pattern); falls back to the form inside `dialog.element`, then the element
 * itself (so render hooks and plain containers work too).
 *
 * @param {HTMLButtonElement|null} button   the callback's `button` argument
 * @param {object|null} [dialog]            the callback's `dialog` (DialogV2) argument, or a render hook's dialog
 * @returns {HTMLFormElement|HTMLElement|null}
 */
export function getDialogForm(button, dialog = null) {
	if (button?.form) return button.form;
	const root = dialog?.element ?? null;
	if (!root) return null;
	return root.querySelector?.('form.dialog-form') ?? root.querySelector?.('form') ?? root;
}

/** The named control (or RadioNodeList) of `form`, if any. */
function control(form, name) {
	return form?.elements?.[name] ?? null;
}

/**
 * The value of field `name`: a text/number/select value, the checked radio's
 * value, or a single checkbox's value when checked. `undefined` when the field
 * is missing or nothing is checked.
 */
export function readField(form, name) {
	if (!form) return undefined;
	const el = control(form, name);
	if (el) {
		const type = typeof el.type === 'string' ? el.type.toLowerCase() : '';
		if (type === 'radio' || type === 'checkbox') return el.checked ? el.value : undefined;
		const value = el.value;
		// RadioNodeList.value is '' when no radio in the group is checked.
		if (value === '' && typeof el.length === 'number' && el.tagName === undefined) return undefined;
		return value ?? undefined;
	}
	const checked = form.querySelector?.(`[name="${name}"]:checked`);
	if (checked) return checked.value;
	const field = form.querySelector?.(`[name="${name}"]`);
	if (field && !['radio', 'checkbox'].includes(String(field.type ?? '').toLowerCase())) return field.value;
	return undefined;
}

/** `readField` trimmed, or `fallback` when blank/missing. */
export function readText(form, name, fallback = '') {
	const value = readField(form, name);
	const text = value === undefined || value === null ? '' : String(value).trim();
	return text || fallback;
}

/** `readField` as a finite number, or `fallback`. */
export function readNumber(form, name, fallback = 0) {
	const value = readField(form, name);
	if (value === undefined || value === null || String(value).trim() === '') return fallback;
	const n = Number(value);
	return Number.isFinite(n) ? n : fallback;
}

/** Whether checkbox `name` is checked. */
export function readChecked(form, name) {
	if (!form) return false;
	const el = control(form, name);
	if (el) return !!el.checked;
	return !!form.querySelector?.(`[name="${name}"]:checked`);
}

/**
 * `DialogV2.confirm` with the module's defaults (modal, `rejectClose: false`)
 * and Foundry's own tri-state result: `true` for Yes, `false` for No, `null`
 * when the window is closed / Escaped. Errors are logged and resolve `null`, so
 * `if (!(await confirmDialog(...))) return;` is the whole guard.
 *
 * @param {object} config   DialogV2.confirm configuration
 * @returns {Promise<boolean|null>}
 */
export async function confirmDialog(config = {}) {
	let result;
	try {
		result = await foundry.applications.api.DialogV2.confirm({ modal: true, rejectClose: false, ...config });
	} catch (error) {
		console.error(`[${MODULE_ID}] confirm dialog failed`, error);
		return null;
	}
	if (result === true) return true;
	if (result === false) return false;
	return null;
}
