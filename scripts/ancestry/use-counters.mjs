import { MODULE_ID } from '../core/constants.mjs';
import { addSyntheticRule, hasActiveRule } from '../core/rules.mjs';
import { classQoLEnabled } from '../classes/shared/settings.mjs';

/* ── Ancestry traits that have a limited number of uses ──────────────────────
 *
 * A good third of the ancestries in play carry a trait you may use a fixed
 * number of times — "1/Safe Rest", "1/encounter", the Changething's
 * "(KEY/Safe Rest)" — and every one of them ships as prose with an empty
 * `rules` array. The count exists only in the sentence, so remembering it is
 * the player's job, which is exactly the bookkeeping the class automations
 * already lift off the table for *Coordinated Strike!* and *Fit for Any
 * Battlefield*.
 *
 * The system needs no persuading to track them: nothing in the charge
 * subsystem, the Features tab or the pip control looks at what *kind* of item
 * declares a pool, and the ancestry item carries a `rules` array like any
 * other. So each trait gets a `chargePool`, and the badge, the pips and the
 * Safe Rest refill all come from the system.
 *
 * Unlike a class feature, no `chargeConsumer` goes with it, because a consumer
 * is scoped to the *item* and an ancestry is one item holding several traits.
 * The system collects every consumer an item declares and spends them together,
 * so on an ancestry with two limited traits — the Halfling variants each pair
 * *Elusive* with a tradition trait — using one would spend both, and its
 * pre-use check would refuse the whole card as soon as either pool ran dry.
 * Instead the counter is moved by the click that spends it, which the rail
 * already does for any pool whose item declares no consumer of its own: the
 * trait's card is posted, and exactly the clicked pool goes down by one.
 *
 * What is specific to ancestries is that the number has to be *read* rather
 * than looked up. There is no field for it, and there are 30-odd traits across
 * two modules and the system's own content, so this parses the description the
 * way the Cheat's Sneak Attack scaling table is already parsed: follow the
 * content, and a homebrew ancestry written to the same house style is picked up
 * for free.
 *
 * Nothing is written to the character. These rules live in the item's in-memory
 * map, are rebuilt on every data preparation, and vanish when the module or its
 * setting is switched off — at which point the system's own sync pass drops the
 * pool state with them.
 */

/**
 * How each "per" reads, and the recovery trigger that refills it.
 *
 * `/day` and `/round` are deliberately absent: the system's recovery vocabulary
 * has nothing that means either, and a counter that silently never refills is
 * worse than no counter at all. `/turn` is absent for a different reason — a
 * trait like the Minotaur's *Charge* is a rider on movement rather than a
 * resource anyone tracks, and a pip that refills every turn is noise.
 */
const RECOVERY_BY_PERIOD = {
	'safe rest': 'safeRest',
	'field rest': 'fieldRest',
	encounter: 'encounterStart',
};

/**
 * A use allowance inside a trait's text: "1/Safe Rest", "(KEY/Safe Rest)",
 * "1/encounter". The count is either a number or KEY, the caster's key ability,
 * which the system resolves from `@key` in a formula.
 */
const ALLOWANCE = /(\d+|KEY)\s*\/\s*(Safe\s*Rest|Field\s*Rest|encounter)/i;

/** Strip tags, decode the few entities that appear, and collapse whitespace. */
function plainText(html) {
	return String(html ?? '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&rsquo;/g, "'")
		.replace(/\s+/g, ' ')
		.trim();
}

/** A stable, readable identifier for a trait's pool. */
function slugify(value) {
	return String(value ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Split an ancestry description into its named traits.
 *
 * The house style across both modules and the system's own content is a `
 * <strong>` holding the trait's name, followed by the text that describes it.
 * A section is therefore everything from one `<strong>` up to the next, which
 * also means the variant headers ("Halfling Traditions: Companyfolk") fall out
 * on their own: they are followed by flavour text carrying no allowance, so
 * they produce nothing.
 */
export function ancestryTraitSections(html) {
	const source = String(html ?? '');
	const sections = [];
	const pattern = /<strong>(.*?)<\/strong>/gi;
	const matches = [...source.matchAll(pattern)];

	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index];
		const name = plainText(match[1]).replace(/[:.\s]+$/, '');
		if (!name) continue;
		const start = match.index + match[0].length;
		const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
		sections.push({ name, body: plainText(source.slice(start, end)) });
	}
	return sections;
}

/**
 * Every limited-use trait an ancestry declares: its name, how many uses, and
 * what refills them. Returns an empty array for an ancestry that declares none.
 */
export function ancestryUseAllowances(item) {
	const sections = ancestryTraitSections(item?.system?.description);
	const found = [];
	const seen = new Set();

	for (const section of sections) {
		const match = section.body.match(ALLOWANCE);
		if (!match) continue;

		const period = match[2].replace(/\s+/g, ' ').toLowerCase();
		const trigger = RECOVERY_BY_PERIOD[period];
		if (!trigger) continue;

		const identifier = `nim-plus-ancestry-${slugify(section.name)}`;
		if (seen.has(identifier)) continue;
		seen.add(identifier);

		found.push({
			identifier,
			label: section.name,
			// KEY is the character's key ability modifier; the system resolves
			// `@key` against the actor when it evaluates the pool's max.
			max: match[1].toUpperCase() === 'KEY' ? '@key' : String(Number(match[1])),
			trigger,
		});
	}
	return found;
}

/**
 * Give an ancestry's limited-use traits the counter the content leaves out.
 *
 * Called from item data preparation, so it runs on load, on every update and
 * whenever the ancestry is swapped — there is no install step to miss.
 */
export function ensureAncestryUseCounters(item) {
	if (!classQoLEnabled()) return;
	if (item?.type !== 'ancestry' || !item.rules) return;
	// Any charge pool at all means this is already metered — by a future system
	// update, or by a homebrew edit that deserves to win over ours.
	if (hasActiveRule(item, (rule) => rule.type === 'chargePool')) return;

	let allowances;
	try {
		allowances = ancestryUseAllowances(item);
	} catch (error) {
		console.error(`[${MODULE_ID}] Could not read ${item?.name}'s trait uses`, error);
		return;
	}

	for (const allowance of allowances) {
		addSyntheticRule(item, {
			id: `nimPlusAncestryPool-${allowance.identifier}`,
			type: 'chargePool',
			identifier: allowance.identifier,
			label: allowance.label,
			scope: 'item',
			max: allowance.max,
			dieSize: null,
			initial: 'max',
			recoveries: [{ trigger: allowance.trigger, mode: 'refresh', value: '1' }],
		});
	}
}
