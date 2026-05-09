# Changelog

All notable changes to this module will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.1] - 2026-05-10

### Fixed
- Release zip now includes `scripts/` so Foundry can resolve `module.json`'s `esmodules: ["scripts/main.mjs"]` entry on install. (v0.1.0 published a bundle without it, which made install fail with "The file scripts/main.mjs included by module nim-plus-package does not exist".)
- CI: dropped the explicit `version: 10` input on `pnpm/action-setup@v4` to avoid `ERR_PNPM_BAD_PM_VERSION` against `package.json`'s `packageManager` field.

### Added
- **Artificer class** (Homebrew/Optional) complete with the **two official subclasses only** (Forge of the Gadgeteer, Forge of the Inventor) and **34 features** across three feature groups:
  - **Progression (13):** Thunder Gauntlets Prototype (with `damage` activation effect, 1d4+INT thunder), Armor Prototype (with `armorClass` rule overriding to INT+DEX), Thunder Gauntlets (L2 upgrade, auto-grants the full Thunder Gauntlets invention), Eureka! (picker host at L2/4/6/8/12/16), Mana Accumulator, Constant Tinkering (description-only at every level 3–18), I've Got JUST the Thing!, Tuned Mana Condenser (L5/10/14), Percussive Maintenance, Mana Recovery Valve, Optimized Mana Compression, Prime Configuration, Grand Mechanist.
  - **Eureka picks (13)** in `artificer-eureka-picks` group, each with `gainedAtLevels: [2,4,6,8,12,16]` and `selectionCountByLevel: 1` per level: 7 Inventions (Thunder Gauntlets, Manabolt Cannon, Manablade, Manaforged Plate w/ `armorClass` rule, Aethertuned Jerkin w/ armor + speed + initiative bonuses, Transmutation Flask, Tethercoil) + 6 Gadgets (Scrapbot Swarm, Homing Missile, Safety Buddy, Stim Pack, Cheer Bot, Propulsive Boots). Each features its own `damage`/`healing` activation effect where appropriate.
  - **Subclass feats (12):** 4 features each at L3/L7/L11/L15 for **Forge of the Gadgeteer** (Gadget Specialist auto-grants Cheer Bot, Improvised Tinkering, Always Be Prepared!, Tinkermaster), **Forge of the Inventor** (Tethercoil Specialist auto-grants Tethercoil, Precision Tuned Smack, Powerful Weaponry, Big Brained Inventor), and **Forge of the Mechanic** (homebrew, sourced from the SBS Notion — It Lives! companion creation w/ Repair Kit healing block + 3 Companion Modules in description, L7 Modular Expansion + Synchronized Strike + Superconductor, L11 Static Discharge w/ lightning damage + Dazed condition activation, L15 Modular Expansion + Overclock Protocol + Independent Power Supply).
- **Artificer subclass icon prompts unified** as a "Forge guild badge" set: shared brass-cog medallion frame with crossed wrenches and sapphire enamel inner disc; only the gold-leaf center emblem (mech-spider for Gadgeteer, blueprint for Inventor, clockwork-companion for Mechanic) changes per Forge. Frame template lives in `docs/icon-prompts/subclasses/artificer/_badge-template.md`. Per-feature icon prompts also added for all Artificer features.
- **Hexbinder spells pack** (`nim-plus-spells`): 9 spells across tiers 1–5 (Life Bloom, Misery, Bloodcurse, Twitch Curse, Frogify, Wyrding Strands, Circle of Thorns, Malediction, Terror) with `school: "hexbinder"`, `classes: ["hexbinder"]`, full `activation.effects` damage/healing blocks. Discovered automatically by the system's `buildSpellIndex` since it walks all enabled compendia, so leveling a Hexbinder picks them up at the right tier-gate.
- **Mana feature rewired**: `mana-and-tier-1-spells.json` `grantSpells` rules now target `schools: ["hexbinder"]` instead of `["necrotic"]`.
- **Concoctions pack** (`nim-plus-items`): 8 Coven-of-the-Cauldron concoctions as `Object`/`consumable` potions (Minor Health, Fitness, Speed, Minor Cure, Delayed Action, Crackling, Smoke, Affliction). Each is a draggable inventory item, thrown range 6, slot 0.25, with clickable `activation.effects` where the system supports them — tempHp healing for Minor Health, condition `charged` for Crackling, condition `invisible` for Smoke. The other four are description-only because the system has no rule type for "+1 stat for 1 min", "+6 speed for 1 min", "end any single condition", or "extra action".
- **Cauldroncraft auto-grants** all 8 concoctions to the player's inventory on first acquiring the feature, so they're discoverable on the sheet at L3.
- **Concoction icon prompts**: 8 new prompts appended to `docs/icon-prompts/subclasses/hexbinder/coven-of-the-cauldron.md`.
- **Hexbinder art**: 41 custom WebP icons under `assets/` covering 3 subclass portraits, 9 progression features, 8 affliction sigils, 8 mystic-mark sigils, and 13 subclass features. Every Hexbinder pack JSON's `img` field rewired to `modules/nim-plus-package/assets/...`.
- Initial scaffold: build pipeline reusing the Nimble system's pack tooling.
- **Hexbinder class** complete: class JSON with starting-gear `grantItem` rules (Adventurer's Garb, Dagger, Bucket-as-Portable-Cauldron pulled from `nimble-items`); both subclasses (Coven of The Hex, Coven of The Hunt) and all 33 features authored across the four feature groups:
  - **Progression (9):** Hex (with `damage` activation effect, 1d4+@level necrotic), Mana and Tier 1 Spells (with predicate-gated `grantSpells` rules for tiers 1–5), Diminution, Consult the BONES, Soothsayer, Blightwielder's Touch, Misery Maker, Doombringer, Sage of Banes.
  - **Afflictions (8):** Brittle, Dimmed, Doomed, Enfeebled, Frenzied, Pestilent, Sundered, Withered.
  - **Mystic Marks (8):** Bramble Mark, Broom Flight, Coven, Mark of Protection, Pact of Enmity, Sigil of Journey, Sigil of Root, Word of Decay.
  - **Subclass feats (13):** Coven of The Hex (Haunted, Spitecurse, Cursespitter, Hexcaster) + Coven of The Hunt (Hexbinder's Familiar, Bind Malady, Empowered Familiar, Mighty Familiar) + **Coven of the Cauldron** (Cauldroncraft with embedded 8-concoction list, Herbal Wisdom, Mixology, Fast Brew, Bottled Echo).
- Eight compendium pack definitions in `module.json`: classes, subclasses, class features, ancestries, backgrounds, items, monsters, legendary monsters.
