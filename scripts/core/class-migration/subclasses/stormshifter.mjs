/**
 * Stormshifter official subclasses — subclass-specific migration steps (Heroes 2.0.3 ⇄
 * Nimble 0.2 playtest). Runs after `../classes/stormshifter.mjs`, with the same `ctx`
 * (`ctx.subclass` is the owned Stormshifter subclass item, or null).
 *
 * The generic pass (`../index.mjs`, whose header documents this interface) has
 * already replaced superseded subclass items and features in place; subclass
 * features that are new in 0.2 are added by the subclass sync that runs after
 * the migration. Put here only what neither can do. Every change `migrate`
 * makes must have a line in `describe`.
 *
 * 0.2 retires Circle of Fang & Claw's Friend of Beasts and Venomous Gaze, and moves
 * Windborne Protector from level 3 to 7 (the generic pass drops it below 7).
 * Migrating back to 2.0.3 re-adds the 2.0.3 features the character is due but
 * no longer owns (see `./restore-203.mjs`).
 */
import { restoreModule } from './restore-203.mjs';

export default restoreModule('stormshifter', ['circle-of-fang-and-claw']);
