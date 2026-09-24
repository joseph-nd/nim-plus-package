/**
 * Nim+ Package — entry point
 *
 * This file is the manifest, not the implementation: it lists the modules that
 * *do something at load time* — register a hook, wrap a document class, declare
 * a setting — in the order those side effects must happen. Foundry loads it as
 * a native ES module (`module.json` → `esmodules`), so there is no bundler and
 * every path below is resolved verbatim by the browser.
 *
 * **The order of these imports is the order the hooks register in.** Foundry
 * calls the handlers of a given hook in registration order, so moving a line
 * here can change behaviour even though nothing else changed. Keep each group
 * in the order it appears, and add new modules next to the feature they belong
 * to rather than at the end.
 *
 * Pure helper modules (`core/constants.mjs`, `core/html.mjs`, `core/rules.mjs`,
 * `core/pools.mjs`, the feature helpers, the CSS modules) are deliberately not
 * listed — they register nothing, and their consumers import them directly.
 *
 * The public API surface lives in `core/api.mjs` and is imported last, once
 * every feature module has registered, so assembling it can never reorder them.
 */

// ── Nimble 0.2 playtest core classes: the setting, then the index filter ─────
// First, so the filter's `init` wrapper is on `CompendiumCollection` before
// anything else can read a pack index.
import './core/playtest-settings.mjs';
import './core/supersede.mjs';

// ── Compendium presentation ─────────────────────────────────────────────────
import './compendium/entry-levels.mjs';

// ── Document-class patches (feats groups, feat AC, spell riders, weapons) ───
import './core/document-patches.mjs';
import './core/subclass-sync.mjs';
import './core/class-migration/index.mjs'; // also starts subclass-sync's ready pass, after its own
import './equipment/weapon-stacking.mjs';

// ── Psion ───────────────────────────────────────────────────────────────────
import './psion/field-aura.mjs';
import './psion/strain-widget.mjs';
import './psion/concentration.mjs';

// ── Feature macros ──────────────────────────────────────────────────────────
import './macros/spore-attack.mjs';
import './macros/seasoned-journeyman.mjs';

// ── Feats (optional, world setting) ─────────────────────────────────────────
import './feats/settings.mjs';
import './feats/sheet-hooks.mjs';
import './feats/levelup.mjs';
import './feats/mechanics/bulwark-hooks.mjs';
import './feats/mechanics/healer-second-wind.mjs';

// ── Nim+ Volume I — character creation kits ─────────────────────────────────
import './vol1/kits.mjs';

// ── Nim+ Volume IV — magic items ────────────────────────────────────────────
import './vol4/dawnmark.mjs';
import './vol4/derived.mjs';

// ── Nim+ Expanded Equipment — mundane gear ──────────────────────────────────
import './equipment/damage-applied.mjs';
import './equipment/hooks.mjs';
import './equipment/derived.mjs';

// ── Class automation — the Cheat, the Commander, the Oathsworn, the Shadowmancer
// See `classes/shared/settings.mjs` for what this covers and how it is written
// to degrade to nothing if the system changes shape underneath it.
import './classes/shared/settings.mjs';
import './classes/shared/activation-dialog.mjs';
import './classes/commander/master-commander.mjs';
import './classes/commander/tactic-levelup.mjs';
import './classes/commander/superseded-features.mjs';
import './classes/berserker/boundless-flames.mjs';
import './ui/combat-dice-tracker.mjs';
import './classes/oathsworn/judgment.mjs';
import './classes/shadowmancer/spell-tiers.mjs';
import './ui/charge-rail.mjs';
import './classes/rule-injection.mjs';
import './classes/activation-lifecycle.mjs';

// ── Macro API, assembled once everything above has registered ───────────────
import './core/api.mjs';
