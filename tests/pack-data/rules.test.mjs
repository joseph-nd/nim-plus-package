/**
 * system.rules over every Nim+ document (companion actors' embedded items included), checked
 * against the rule schemas parsed from ../FoundryVTT-Nimble/src/models/rules/*.ts.
 *
 * The same checks also run over the system packs as a control: if the system's own data fails a
 * check, the check (not Nim+) is wrong.
 */
import { describe, expect, it } from 'vitest';
import {
	allRules,
	checkActivationFormulas,
	checkFormulas,
	checkPoolRefs,
	checkPredicates,
	checkRuleEnums,
	checkRuleFields,
	checkRuleIds,
	checkRuleTypes,
	formulaFields,
	formulaProblem,
	hiddenPools,
	isValidPredicate,
} from './checks.mjs';
import { nimDocs, onlyBug, ruleSchemas, sysDocs, unexplained } from './lib.mjs';

const KNOWN = {
	// Hexbinder "Mana and Tier 1 Spells": grantSpells.schools ["hexbinder"] was not a CONFIG.NIMBLE.spellSchools
	// key; RulesManager builds rules with strict validation, so all 5 tier grants failed to construct.
	// Fixed (0.12.0): the tier grants list their spells by uuid. Kept as a regression matcher.
	'BUG-pack-data-1': (v) => v.includes('hexbinder/hexbinder-progression/mana-and-tier-1-spells.json') && v.includes('"hexbinder" not in'),
};

/**
 * Hidden pools the player never manages: pure rate limiters (the ChargePoolRule `hidden` doc comment
 * describes exactly this use). Anything else hidden is a player resource and must stay visible.
 */
const HIDDEN_GATES = new Set(['coordinated-strike-round']);

/** A throwaway doc entry for negative controls. */
function fake(rules, extra = {}) {
	const doc = { name: 'Fake', type: 'feature', system: { rules, ...extra } };
	return [{ doc, file: 'FAKE', pack: { pkg: 'nim-plus-package', name: 'nim-plus-class-features' }, uuid: 'Compendium.x.y.Item.AAAAAAAAAAAAAAAA' }];
}

describe('pack-data: rule checker self-tests (so a green run means something)', () => {
	it('parses every registered rule type with its declared fields', () => {
		const S = ruleSchemas();
		expect(S.size).toBeGreaterThanOrEqual(45);
		expect(Object.keys(S.get('chargePool'))).toEqual(
			expect.arrayContaining(['id', 'identifier', 'label', 'predicate', 'priority', 'disabled', 'scope', 'max', 'dieSize', 'initial', 'hidden', 'recoveries', 'type']),
		);
		expect(Object.keys(S.get('chargePool').recoveries.nested)).toEqual(['trigger', 'mode', 'value']);
		expect(Object.keys(S.get('grantItem'))).toEqual(expect.arrayContaining(['uuid', 'allowDuplicate', 'inMemoryOnly', 'quantity']));
		expect(formulaFields('chargePool')).toEqual(['max', 'recoveries[].value']);
	});

	it('flags unknown types, undeclared fields, bad enums, bad predicates, bad formulas and dangling pools', () => {
		const docs = fake([
			{ id: 'a', type: 'noSuchRule' },
			{ id: 'b', type: 'chargePool', identifier: 'p', scope: 'galaxy', max: '1 +', recoveries: [{ trigger: 'onSneeze', mode: 'add', value: '1', extra: 1 }], bogus: true },
			{ id: 'c', type: 'chargeConsumer', poolIdentifier: 'nope', poolScope: 'item', cost: '@notAVar', predicate: { $or: [{}] } },
			{ id: 'c', type: 'note' },
		]);
		expect(checkRuleTypes(docs)).toHaveLength(1);
		expect(checkRuleFields(docs).join('\n')).toMatch(/"bogus"[\s\S]*"extra"/);
		expect(checkRuleEnums(docs).join('\n')).toMatch(/"galaxy"[\s\S]*"onSneeze"/);
		expect(checkPredicates(docs)).toHaveLength(1);
		expect(checkFormulas(docs).join('\n')).toMatch(/max: does not parse[\s\S]*@notAVar/);
		expect(checkPoolRefs(docs).join('\n')).toMatch(/pool "nope" \(scope item\) not defined anywhere/);
		expect(checkRuleIds(docs)).toHaveLength(1);
	});

	it('the predicate validator mirrors Predicate.isValid', () => {
		expect(isValidPredicate({})).toBe(true);
		expect(isValidPredicate({ level: { min: 5 } })).toBe(true);
		expect(isValidPredicate({ $or: [{ level: { max: 4 } }, 'self:foo'] })).toBe(true);
		expect(isValidPredicate({ level: { equal: 1, min: 2 } })).toBe(false);
		expect(isValidPredicate({ level: {} })).toBe(false);
		expect(isValidPredicate({ tag: [] })).toBe(false);
		expect(isValidPredicate({ $and: 'x' })).toBe(false);
		expect(isValidPredicate(['x'])).toBe(false);
	});

	it('the formula validator accepts system syntax and rejects garbage', () => {
		expect(formulaProblem('max(@intelligence, 0)')).toBeNull();
		expect(formulaProblem('2d8 + floor(@level / 5) * 4')).toBeNull();
		expect(formulaProblem('@abilities.will.mod')).toBeNull();
		expect(formulaProblem('1d6+(')).toMatch(/unbalanced/);
		expect(formulaProblem('@nope')).toMatch(/unknown roll variable/);
		expect(formulaProblem('1d4 +* 2')).toMatch(/does not parse/);
	});

	describe('control: the system packs pass the same checks', () => {
		it.each([
			['rule types', checkRuleTypes],
			['rule fields', checkRuleFields],
			['rule enums', checkRuleEnums],
			['predicates', checkPredicates],
			['rule formulas', checkFormulas],
			['activation formulas', checkActivationFormulas],
			['pool references', checkPoolRefs],
			['rule ids', checkRuleIds],
		])('%s', (_label, check) => {
			expect(check(sysDocs())).toEqual([]);
		});
	});
});

describe('pack-data: Nim+ rules', () => {
	it('covers a meaningful number of rules', () => {
		expect(allRules().length).toBeGreaterThan(400);
	});

	it('every rule type exists in FoundryVTT-Nimble/src/models/rules', () => {
		expect(checkRuleTypes()).toEqual([]);
	});

	it('every rule field (and nested recoveries/refills/addRefills field) is declared in the rule schema', () => {
		expect(checkRuleFields()).toEqual([]);
	});

	it('enum fields hold a declared choice (static choices, *RuleConfig constants, CONFIG.NIMBLE keys)', () => {
		expect(unexplained(checkRuleEnums(), KNOWN)).toEqual([]);
	});

	it('fixed BUG-pack-data-1: Hexbinder grantSpells rules use a valid spell school (grant by uuid)', () => {
		expect(onlyBug(checkRuleEnums(), KNOWN, 'BUG-pack-data-1')).toEqual([]);
	});

	it('rule ids are unique per item (RulesManager keys rules by id)', () => {
		expect(checkRuleIds()).toEqual([]);
	});

	it('predicates are well formed (rule + recovery/refill predicates)', () => {
		expect(checkPredicates()).toEqual([]);
	});

	it('formula fields parse and use only roll variables the system provides', () => {
		expect(checkFormulas()).toEqual([]);
	});

	it('activation damage/healing formulas parse and use known roll variables', () => {
		expect(checkActivationFormulas()).toEqual([]);
	});

	it('every chargePool/dicePool has a non-empty identifier', () => {
		const bad = allRules()
			.filter(({ rule }) => ['chargePool', 'dicePool'].includes(rule.type) && !String(rule.identifier ?? '').trim())
			.map(({ file, where }) => `${file} ${where}`);
		expect(bad).toEqual([]);
	});

	it('every consumer / modifier / clearPoolsOnEnd resolves to a pool of the right kind and scope, within reach', () => {
		expect(checkPoolRefs()).toEqual([]);
	});

	it('player resources are never hidden pools (only pure rate-limit gates may be)', () => {
		const offenders = hiddenPools().filter((v) => ![...HIDDEN_GATES].some((id) => v.endsWith(`"${id}"`)));
		expect(offenders).toEqual([]);
	});

	it('the allowed hidden gates really are gates: max 1, refreshed every turn/encounter, consumed by the same item', () => {
		for (const { rule, docEntry } of allRules().filter(({ rule }) => rule.type === 'chargePool' && rule.hidden)) {
			expect(HIDDEN_GATES.has(rule.identifier)).toBe(true);
			expect(rule.max).toBe('1');
			expect(rule.recoveries.map((r) => r.mode)).toEqual(expect.arrayContaining(['refresh']));
			const consumers = (docEntry.doc.system.rules ?? []).filter((r) => r.type === 'chargeConsumer' && r.poolIdentifier === rule.identifier);
			expect(consumers).toHaveLength(1);
		}
	});

	it('companion actors: embedded items are covered by the same checks', () => {
		const companions = nimDocs().filter((d) => d.pack.name === 'nim-plus-companions');
		expect(companions.length).toBeGreaterThan(0);
		for (const check of [checkRuleTypes, checkRuleFields, checkRuleEnums, checkPredicates, checkFormulas, checkActivationFormulas]) {
			expect(check(companions)).toEqual([]);
		}
	});
});
