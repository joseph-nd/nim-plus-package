/**
 * scripts/core/dialog.mjs — the shared DialogV2 helpers.
 *
 * `v14Wait` reproduces Foundry v14's DialogV2.wait exactly
 * (client/applications/api/dialog.mjs):
 *   - button press → `_onSubmit`: `(await button.callback(event, button, dialog)) ?? button.action`
 *   - close / Escape → the "close" listener: `resolve(result ?? null)` (rejectClose false),
 *     or a rejection with rejectClose true.
 * `button.form` is DialogV2's own <form class="dialog-form"> (verified in Chromium:
 * a nested <form> in the content is dropped by the parser, `button.form` is the wrapper).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importScripts, installFoundry } from '../harness/index.mjs';

/** A form as the browser builds it: `elements` keyed by field name. */
const formOf = (elements = {}) => ({ tagName: 'FORM', className: 'dialog-form standard-form', elements });

function v14Wait(interaction) {
	return async (config) => {
		if (interaction.close) {
			if (config.rejectClose) throw new Error('Dialog was dismissed without pressing a button.');
			return null;
		}
		const button = config.buttons.find((b) => b.action === interaction.press);
		if (!button) throw new Error(`no button ${interaction.press}`);
		const form = interaction.form ?? formOf();
		const element = { querySelector: (sel) => (sel === 'form' || sel === 'form.dialog-form' ? form : null) };
		const buttonEl = { form, dataset: { action: button.action } };
		return (await button.callback?.({}, buttonEl, { element })) ?? button.action;
	};
}

describe('waitDialog — normalises DialogV2 results', () => {
	let d, wait;
	beforeEach(async () => {
		installFoundry();
		d = await importScripts('scripts/core/dialog.mjs');
		wait = (interaction) => {
			const fn = vi.fn(v14Wait(interaction));
			foundry.applications.api.DialogV2.wait = fn;
			return fn;
		};
	});

	const buttons = () => [
		{ action: 'ok', label: 'OK', callback: (_e, button, dialog) => d.readField(d.getDialogForm(button, dialog), 'pick') ?? null },
		{ action: 'other', label: 'No callback' },
		{ action: 'cancel', label: 'Cancel', callback: () => null },
	];

	it('a callback value is returned as-is', async () => {
		wait({ press: 'ok', form: formOf({ pick: { value: 'fire' } }) });
		expect(await d.waitDialog({ buttons: buttons() })).toBe('fire');
	});

	it('Cancel whose callback returns null → null (raw v14 resolves "cancel")', async () => {
		const raw = await v14Wait({ press: 'cancel' })({ buttons: buttons() });
		expect(raw).toBe('cancel'); // the mechanism the helper exists for
		wait({ press: 'cancel' });
		expect(await d.waitDialog({ buttons: buttons() })).toBeNull();
	});

	it('Cancel with no callback at all → null', async () => {
		wait({ press: 'cancel' });
		expect(await d.waitDialog({ buttons: [{ action: 'ok', label: 'OK' }, { action: 'cancel', label: 'Cancel' }] })).toBeNull();
	});

	it('a callback returning null/undefined → null, not the action string ("ok")', async () => {
		wait({ press: 'ok', form: formOf({}) });
		expect(await d.waitDialog({ buttons: buttons() })).toBeNull();
		wait({ press: 'ok' });
		expect(await d.waitDialog({ buttons: [{ action: 'ok', label: 'OK', callback: () => undefined }] })).toBeNull();
	});

	it('a button with no callback still resolves to its action string (Foundry semantics)', async () => {
		wait({ press: 'other' });
		expect(await d.waitDialog({ buttons: buttons() })).toBe('other');
	});

	it('closing (header × / Escape) → null; rejectClose: true rejection → null', async () => {
		wait({ close: true });
		expect(await d.waitDialog({ buttons: buttons() })).toBeNull();
		wait({ close: true });
		expect(await d.waitDialog({ buttons: buttons(), rejectClose: true })).toBeNull();
	});

	it('a failing dialog resolves null and logs', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		foundry.applications.api.DialogV2.wait = vi.fn(async () => {
			throw new Error('boom');
		});
		expect(await d.waitDialog({ buttons: buttons() })).toBeNull();
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('custom cancelActions: every listed button means cancel', async () => {
		const cfg = () => ({ buttons: [{ action: 'go', label: 'Go', callback: () => 1 }, { action: 'later', label: 'Later', callback: () => 'later' }] });
		wait({ press: 'later' });
		expect(await d.waitDialog(cfg())).toBe('later');
		wait({ press: 'later' });
		expect(await d.waitDialog(cfg(), { cancelActions: ['later'] })).toBeNull();
	});

	it('falsy-but-real callback values (0, false, "") pass through', async () => {
		for (const value of [0, false, '']) {
			wait({ press: 'ok' });
			expect(await d.waitDialog({ buttons: [{ action: 'ok', label: 'OK', callback: () => value }] })).toBe(value);
		}
	});

	it('does not mutate the caller config and defaults rejectClose to false', async () => {
		const fn = wait({ press: 'ok', form: formOf({ pick: { value: 'x' } }) });
		const config = { buttons: buttons() };
		const original = config.buttons[2].callback;
		await d.waitDialog(config);
		expect(config.buttons[2].callback).toBe(original);
		expect(fn.mock.calls[0][0].rejectClose).toBe(false);
		expect(fn.mock.calls[0][0].buttons).not.toBe(config.buttons);
	});

	it('works through the harness DialogV2 mock (string answers follow v14 `?? action`)', async () => {
		const env = installFoundry();
		d = await importScripts('scripts/core/dialog.mjs');
		env.dialogs.answer('cancel', null);
		expect(await d.waitDialog({ buttons: buttons() })).toBeNull();
		expect(await d.waitDialog({ buttons: buttons() })).toBeNull();
	});
});

describe('normalizeDialogResult', () => {
	let d;
	beforeEach(async () => {
		installFoundry();
		d = await importScripts('scripts/core/dialog.mjs');
	});

	it.each([
		[undefined, null],
		[null, null],
		['cancel', null],
		['ok', 'ok'],
		[0, 0],
		[false, false],
	])('%j → %j', (raw, expected) => {
		expect(d.normalizeDialogResult(raw)).toBe(expected);
	});

	it('honours custom cancel actions', () => {
		expect(d.normalizeDialogResult('later', ['later'])).toBeNull();
		expect(d.normalizeDialogResult('cancel', ['later'])).toBe('cancel');
	});
});

describe('getDialogForm / read helpers', () => {
	let d;
	beforeEach(async () => {
		installFoundry();
		d = await importScripts('scripts/core/dialog.mjs');
	});

	it('prefers button.form (DialogV2 own form), then the dialog element form, then the element itself', () => {
		const a = formOf();
		const b = formOf();
		const element = { querySelector: (sel) => (sel === 'form.dialog-form' ? b : null) };
		expect(d.getDialogForm({ form: a }, { element })).toBe(a);
		expect(d.getDialogForm(null, { element })).toBe(b);
		expect(d.getDialogForm({}, { element })).toBe(b);
		const plain = { querySelector: () => null };
		expect(d.getDialogForm(null, { element: plain })).toBe(plain);
		expect(d.getDialogForm(null, null)).toBeNull();
		expect(d.getDialogForm(undefined)).toBeNull();
	});

	it('never looks for a nested custom <form> (it does not exist in the real DOM)', () => {
		const wrapper = formOf({ mana: { value: '2' } });
		const querySelector = vi.fn((sel) => (sel === 'form' || sel === 'form.dialog-form' ? wrapper : null));
		expect(d.readNumber(d.getDialogForm(null, { element: { querySelector } }), 'mana')).toBe(2);
		expect(querySelector.mock.calls.every(([sel]) => !/nim-plus/.test(sel))).toBe(true);
	});

	it('readField: value controls, RadioNodeList, single radio/checkbox, missing', () => {
		const rnl = Object.assign([{}, {}], { value: 'taunted' }); // RadioNodeList-like: length, no tagName
		const emptyRnl = Object.assign([{}, {}], { value: '' });
		const form = formOf({
			text: { tagName: 'INPUT', type: 'text', value: 'Wisp' },
			blank: { tagName: 'INPUT', type: 'text', value: '' },
			sel: { tagName: 'SELECT', type: 'select-one', length: 3, value: '8' },
			effect: rnl,
			none: emptyRnl,
			radioOn: { tagName: 'INPUT', type: 'radio', checked: true, value: 'x' },
			radioOff: { tagName: 'INPUT', type: 'radio', checked: false, value: 'x' },
			cbOn: { tagName: 'INPUT', type: 'checkbox', checked: true, value: 'on' },
		});
		expect(d.readField(form, 'text')).toBe('Wisp');
		expect(d.readField(form, 'blank')).toBe('');
		expect(d.readField(form, 'sel')).toBe('8');
		expect(d.readField(form, 'effect')).toBe('taunted');
		expect(d.readField(form, 'none')).toBeUndefined();
		expect(d.readField(form, 'radioOn')).toBe('x');
		expect(d.readField(form, 'radioOff')).toBeUndefined();
		expect(d.readField(form, 'cbOn')).toBe('on');
		expect(d.readField(form, 'missing')).toBeUndefined();
		expect(d.readField(null, 'text')).toBeUndefined();
	});

	it('readField falls back to querySelector for containers without `elements`', () => {
		const checked = { value: 'alert' };
		const root = { querySelector: (sel) => (sel === '[name="feat"]:checked' ? checked : sel === '[name="note"]' ? { type: 'text', value: 'hi' } : null) };
		expect(d.readField(root, 'feat')).toBe('alert');
		expect(d.readField(root, 'note')).toBe('hi');
		expect(d.readField(root, 'other')).toBeUndefined();
	});

	it('readNumber / readText / readChecked', () => {
		const form = formOf({
			n: { value: '3' },
			neg: { value: '-2' },
			blank: { value: '  ' },
			bad: { value: 'abc' },
			name: { value: '  Wisp  ' },
			on: { type: 'checkbox', checked: true },
			off: { type: 'checkbox', checked: false },
		});
		expect(d.readNumber(form, 'n')).toBe(3);
		expect(d.readNumber(form, 'neg')).toBe(-2);
		expect(d.readNumber(form, 'blank', 7)).toBe(7);
		expect(d.readNumber(form, 'bad', 0)).toBe(0);
		expect(d.readNumber(form, 'missing', 5)).toBe(5);
		expect(d.readNumber(null, 'n', 1)).toBe(1);
		expect(d.readText(form, 'name')).toBe('Wisp');
		expect(d.readText(form, 'blank', 'Spirit')).toBe('Spirit');
		expect(d.readText(form, 'missing', 'Spirit')).toBe('Spirit');
		expect(d.readChecked(form, 'on')).toBe(true);
		expect(d.readChecked(form, 'off')).toBe(false);
		expect(d.readChecked(form, 'missing')).toBe(false);
		expect(d.readChecked(null, 'on')).toBe(false);
	});
});
