/**
 * Core features this module republishes elsewhere, so the level-up window does
 * not offer the same feature twice.
 *
 * Kept apart from `./superseded-features.mjs` because that module registers
 * hooks: the level-up tactic picker only needs the list, and importing it must
 * not drag those registrations forward in the load order.
 *
 * **Commanding Presence** ships under Combat Tactics in the system's copy of the
 * class (playtest 0.1), where the header promises "1/attack, you can expend a
 * Combat Die to add one of the following effects **to your attack**". It is the
 * only one of the five that is not an attack rider at all, and the Commander 0.2
 * playtest (2026-09) moves it to Commander's Orders outright as a 1/encounter
 * Influence check, so it is republished here as an Order with the 0.2 text.
 *
 * The replacement is a real item in this module's pack, filed under
 * `commanders-orders` at the levels Orders are chosen, so the level-up window
 * offers and grants it through the system's own selection machinery with nothing
 * intercepted. All that is left is taking the core card out of the Combat
 * Tactics group, so the same feature is not on offer twice.
 *
 * As an Order it no longer costs a Combat Die (0.2), and it is given up by
 * Single-Minded Fighter, which foregoes that whole group.
 */
export const SUPERSEDED_CORE_FEATURES = [{ name: 'Commanding Presence', group: 'combat-tactics' }];
