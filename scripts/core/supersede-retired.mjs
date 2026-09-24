/**
 * System documents the Nimble 0.2 playtest removes outright, with nothing to
 * replace them.
 *
 * Replacements are *not* listed here — a Nim+ copy names what it replaces in its
 * own `flags.nim-plus-package.supersedes`, and `./supersede.mjs` reads that from
 * the pack indexes. This list is only for the documents that simply stop
 * existing in 0.2 (Expert Shifter, Searing Light, Vengeful Blast, the Combat
 * Tactics die-size card, …): while the playtest setting is on they are taken
 * out of the `nimble.*` indexes, and the class migration removes them from
 * existing characters.
 *
 * One entry per document, as its full compendium UUID, with the document's name
 * in a trailing comment:
 *
 *   'Compendium.nimble.nimble-class-features.Item.<16-char id>', // Expert Shifter
 *
 * Kept apart from `./supersede.mjs` so it is a plain data module that the content
 * work can extend without touching the runtime.
 */
export const RETIRED_CORE_UUIDS = [
	'Compendium.nimble.nimble-class-features.Item.KQiBYDr1BBTE0iJq', // Searing Light (Shepherd)
	'Compendium.nimble.nimble-class-features.Item.iM4BY2Pp3mU0L7ka', // Expert Shifter (Stormshifter)
	'Compendium.nimble.nimble-class-features.Item.xfJbfDI18kunAZu9', // Pack Hunter (Keeper of the Shadowpath)
	'Compendium.nimble.nimble-class-features.Item.sUvQUIIhVrs1KMlM', // Martyr Spawn (Reaver)
	'Compendium.nimble.nimble-class-features.Item.KkWqpX2MaeXJAj6W', // Unfailing Courage (Herald of Courage)
	'Compendium.nimble.nimble-class-features.Item.tUbf5RfG5ywDTtdq', // Friend of Beasts (Circle of Fang and Claw)
	'Compendium.nimble.nimble-class-features.Item.xcmchy0Pn48UJoph', // Venomous Gaze (Circle of Fang and Claw)
	'Compendium.nimble.nimble-class-features.Item.te8CRDUXu5xLkna4', // Combat Tactics die-size card (Commander; folded into Master Commander)
	'Compendium.nimble.nimble-class-features.Item.smUoANfxnZS95YVz', // Vengeful Blast (Shadowmancer)
];
