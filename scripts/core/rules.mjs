import { MODULE_ID } from './constants.mjs';

/* ── Supplying rules the system's own content leaves out ─────────────────────
 *
 * Some Nimble features describe mechanics the rules engine already supports but
 * ship without the rule that would drive them. Radiant Judgement defines a dice
 * pool and nothing that spends it; Coordinated Strike! documents "INT times per
 * Safe Rest" in prose with no counter behind it; the Commander's Combat Dice
 * refill themselves at Initiative but declare nothing for "lost when combat
 * ends", so one recovery entry is added to the rule that is already there.
 *
 * Reimplementing those mechanics from outside is the wrong move — that is what
 * made the first pass at Radiant Judgement double up against the activation
 * dialog's own dice-spending UI. Instead we build the missing rule out of the
 * system's own rule class and drop it into the item's live rules map, so the
 * engine drives the feature exactly as it would if the content had shipped
 * complete.
 *
 * Nothing is written to the database: `item.system.rules` — the persisted
 * source — is untouched, and the synthetic rule is rebuilt from scratch on
 * every data preparation. Turn the module off and no trace of it remains. Each
 * injector also checks whether an equivalent rule is already present, so on the
 * day Nimble ships these rules itself we quietly stop adding our own.
 *
 * The injectors themselves live with the feature they complete; only the three
 * primitives they share are here.
 */

export function itemRuleValues(item) {
	const rules = item?.rules;
	if (!rules || typeof rules.values !== 'function') return [];
	return Array.from(rules.values());
}

export function hasActiveRule(item, predicate) {
	return itemRuleValues(item).some((rule) => rule && !rule.disabled && predicate(rule));
}

/**
 * Build a rule from the system's own registered data model and attach it to the
 * item's live rules map. Returns null — silently, leaving the feature entirely
 * unautomated — if that rule type is no longer registered.
 */
export function addSyntheticRule(item, source) {
	const RuleClass = CONFIG?.NIMBLE?.ruleDataModels?.[source?.type];
	if (!RuleClass || typeof item?.rules?.set !== 'function') return null;
	try {
		const rule = new RuleClass(source, { parent: item, strict: false });
		item.rules.set(rule.id ?? source.id, rule);
		return rule;
	} catch (error) {
		console.error(
			`[${MODULE_ID}] Could not build a ${source?.type} rule for ${item?.name}`,
			error,
		);
		return null;
	}
}
