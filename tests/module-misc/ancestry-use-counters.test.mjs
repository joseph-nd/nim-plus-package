/**
 * scripts/ancestry/use-counters.mjs — limited-use ancestry traits get a
 * synthetic chargePool, parsed from the description. Table-driven over every
 * ancestry in the Nim+ pack and the Nimble system pack.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { MODULE_ID, NIMBLE_ROOT, REPO_ROOT, setupWorld } from '../harness/index.mjs';

function walk(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.json') ? [path.join(dir, e.name)] : [],
	);
}
const ANCESTRIES = [
	...walk(path.join(REPO_ROOT, 'pack-sources/ancestries')),
	...walk(path.join(NIMBLE_ROOT, 'packs/ancestries')),
]
	.map((f) => JSON.parse(fs.readFileSync(f, 'utf-8')))
	.filter((d) => d.type === 'ancestry');

/** name → [label, max, trigger][] — every ancestry with a limited-use trait. */
const EXPECTED = {
	Badgerfolk: [['Rotund', '1', 'encounterStart']],
	Catfolk: [['Feline Grace', '1', 'safeRest']],
	Changething: [['Mimicry', '@key', 'safeRest']],
	Crustodian: [['Vice Grip', '1', 'encounterStart']],
	'Elemental Scion': [['Elemental Embodiment', '1', 'safeRest']],
	Foxfolk: [['Sly as a… Well, you know', '1', 'encounterStart']],
	Scalekin: [['Arid Scales', '1', 'encounterStart']],
	Snakefolk: [['Toxic Spit', '1', 'encounterStart']],
};

let env, counters;
beforeEach(async () => {
	({ env, mods: [counters] } = await setupWorld({
		scripts: ['scripts/ancestry/use-counters.mjs', 'scripts/classes/shared/settings.mjs'],
		boot: 'setup',
	}));
	CONFIG.NIMBLE.ruleDataModels.chargePool = class ChargePoolRule {
		constructor(source) {
			Object.assign(this, source);
		}
	};
});

const summary = (item) => counters.ancestryUseAllowances(item).map((a) => [a.label, a.max, a.trigger]);
const asItem = (doc) => ({ type: 'ancestry', name: doc.name, system: { description: doc.system.description }, rules: new Map() });

describe('ancestryUseAllowances over real ancestry data', () => {
	it('loaded ancestry data from both the module and the system', () => {
		expect(ANCESTRIES.length).toBeGreaterThan(40);
	});

	it.each(ANCESTRIES.map((d) => [d.name, d]))('%s: allowances are well-formed and match any "N/period" text', (_name, doc) => {
		const found = counters.ancestryUseAllowances(asItem(doc));
		const text = String(doc.system.description ?? '').replace(/<[^>]+>/g, ' ');
		const mentions = [...text.matchAll(/(\d+|KEY)\s*\/\s*(Safe\s*Rest|Field\s*Rest|encounter)/gi)].length;
		// every mention must map to a counter (unless two mentions share a trait)
		expect(found.length).toBeLessThanOrEqual(mentions);
		if (mentions > 0) expect(found.length).toBeGreaterThan(0);
		for (const a of found) {
			expect(a.identifier).toMatch(/^nim-plus-ancestry-[a-z0-9-]+$/);
			expect(['safeRest', 'fieldRest', 'encounterStart']).toContain(a.trigger);
			expect(a.max === '@key' || Number(a.max) > 0).toBe(true);
			expect(a.label.length).toBeGreaterThan(0);
			expect(a.label).not.toMatch(/[:.]$/);
		}
	});

	it.each(Object.entries(EXPECTED))('%s → %j', (name, expected) => {
		const docs = ANCESTRIES.filter((d) => d.name === name);
		expect(docs.length).toBeGreaterThan(0);
		for (const doc of docs) expect(summary(asItem(doc))).toEqual(expected);
	});

	it('halfling variants meter both Elusive and their tradition trait', () => {
		const variants = ANCESTRIES.filter((d) => /halfling/i.test(d.name) && summary(asItem(d)).length > 0);
		expect(variants.length).toBeGreaterThanOrEqual(3);
		for (const d of variants) {
			const labels = summary(asItem(d)).map(([l]) => l);
			expect(labels[0]).toBe('Elusive');
			expect(labels).toHaveLength(2);
		}
	});
});

describe('ancestryTraitSections / parser edge cases', () => {
	it.each([
		['<p><strong>Tough:</strong> 2/Safe Rest</p>', [['Tough', '2', 'safeRest']]],
		['<p><strong>Quick.</strong> 1 / field rest, then more</p>', [['Quick', '1', 'fieldRest']]],
		['<p><strong>Fae</strong> KEY/encounter</p>', [['Fae', '@key', 'encounterStart']]],
		['<p><strong>Daily</strong> 1/day</p>', []],
		['<p><strong>Rounds</strong> 1/round</p>', []],
		['<p>1/Safe Rest with no heading</p>', []],
		['<p><strong>Dup</strong> 1/encounter</p><p><strong>Dup</strong> 1/Safe Rest</p>', [['Dup', '1', 'encounterStart']]],
		['', []],
		[null, []],
	])('%j', (html, expected) => {
		expect(counters.ancestryUseAllowances({ system: { description: html } }).map((a) => [a.label, a.max, a.trigger])).toEqual(expected);
	});

	it('strips tags/entities inside the trait name', () => {
		const sections = counters.ancestryTraitSections('<strong><em>Tongue&nbsp;of Silver</em>:</strong> text');
		expect(sections).toEqual([{ name: 'Tongue of Silver', body: 'text' }]);
	});
});

describe('ensureAncestryUseCounters', () => {
	const ancestry = (html, rules = new Map()) => ({ type: 'ancestry', name: 'A', system: { description: html }, rules });

	it('adds one chargePool rule per allowance with a refresh recovery', () => {
		const item = ancestry('<strong>Wily</strong> 1/encounter <strong>Relentless</strong> 1/Safe Rest');
		counters.ensureAncestryUseCounters(item);
		const rules = [...item.rules.values()];
		expect(rules.map((r) => r.id)).toEqual(['nimPlusAncestryPool-nim-plus-ancestry-wily', 'nimPlusAncestryPool-nim-plus-ancestry-relentless']);
		expect(rules[0]).toMatchObject({
			type: 'chargePool',
			scope: 'item',
			max: '1',
			initial: 'max',
			recoveries: [{ trigger: 'encounterStart', mode: 'refresh', value: '1' }],
		});
	});

	it('is idempotent across repeated data preparation (same ids, no duplicates)', () => {
		const item = ancestry('<strong>Wily</strong> 1/encounter');
		counters.ensureAncestryUseCounters(item);
		// second pass: a chargePool is now present → early return
		counters.ensureAncestryUseCounters(item);
		expect(item.rules.size).toBe(1);
	});

	it('defers to an authored (enabled) chargePool, but not a disabled one', () => {
		const authored = ancestry('<strong>Wily</strong> 1/encounter', new Map([['x', { type: 'chargePool' }]]));
		counters.ensureAncestryUseCounters(authored);
		expect(authored.rules.size).toBe(1);
		const disabled = ancestry('<strong>Wily</strong> 1/encounter', new Map([['x', { type: 'chargePool', disabled: true }]]));
		counters.ensureAncestryUseCounters(disabled);
		expect(disabled.rules.size).toBe(2);
	});

	it('does nothing for non-ancestry items or items without a rules map', () => {
		const feature = { ...ancestry('<strong>Wily</strong> 1/encounter'), type: 'feature' };
		counters.ensureAncestryUseCounters(feature);
		expect(feature.rules.size).toBe(0);
		expect(() => counters.ensureAncestryUseCounters({ type: 'ancestry', system: {} })).not.toThrow();
		expect(() => counters.ensureAncestryUseCounters(null)).not.toThrow();
	});

	it('does nothing when class automation is switched off', async () => {
		await env.settings.set(MODULE_ID, 'enableClassAutomation', false);
		const item = ancestry('<strong>Wily</strong> 1/encounter');
		counters.ensureAncestryUseCounters(item);
		expect(item.rules.size).toBe(0);
	});

	it('does nothing (no throw) when the chargePool rule type is not registered', () => {
		delete CONFIG.NIMBLE.ruleDataModels.chargePool;
		const item = ancestry('<strong>Wily</strong> 1/encounter');
		counters.ensureAncestryUseCounters(item);
		expect(item.rules.size).toBe(0);
	});
});
