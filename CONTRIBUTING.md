# Contributing / developer notes

Internals for anyone hacking on this module — the runtime helper API, repo layout, build/release pipeline, JSON authoring conventions, and the asset pipeline.

If you're just trying to install the module in Foundry, see the [README](README.md) instead.

## Runtime helpers (`scripts/main.mjs`)

The module's esmodule registers a small API on `globalThis.nimPlus` (and `game.modules.get('nim-plus-package').api`) that some features call from their `system.macro` field:

- `pickDamage(actor, item, options)` — Living Weapon (Berserker / Path of the Titan's Grip): pop a dialog to pick Tiny / Small / Medium and roll the matching damage formula.
- `summonSpiritCompanion(actor, item)` — Spirit Companion (Shepherd / Luminary of Tidings): summon, dismiss, or re-skin a Spirit Companion token; persists die size, name, and image as actor flags.
- `tollTheHour(actor, item)` — Toll the Hour (Shepherd / Luminary of Tidings): pick Jubilation (heal) or Calamity (radiant damage).
- `seasonedJourneyman(actor, item)` — Seasoned Journeyman (Shepherd / Luminary of the Forge): pick Weaponsmith / Armorsmith at Safe Rest. Auto-detects Master of the Hammer (L11) and bumps the bonus from WIL to WIL + STR.
- `sporeAttack(actor, item)` — Sporesphere (Stormshifter / Circle of Spores): scales damage and Reach with owned upgrades (Germination, Mycelium Growth, Sporulation) and offers Decay's Beastshift-charge upgrades (die-size bumps, Blinded, Poisoned).
- `mirageDispatch(actor, item)` — Psion (Adept of Illusions, L11 Mirage 2): dialog picker for Disguise (Blinded/Taunted/Prone on enemy targets) vs. Distortion (Full Cover / Invisible / Source of Fear on ally targets); auto-applies the chosen status to currently-targeted tokens where Foundry/Nimble has a matching status ID.
- `psionicFieldAttack(actor, item)` — Psion (Psionic Field Attack, L1): dialog lists owned weapon-objects (or accepts a manual formula), rolls weapon damage + WIL, and posts the chat card. If the actor owns Psionic Strike, additionally adds +1 damage per current Strain Die. Warns (non-blocking) if Concentration isn't active.
- `feats.{ choose, pending, owned, characterLevel }(actor)` — optional Feats system. `choose` opens the sheet picker and grants the selected feat (excludes owned, greys out unmet ability-score prerequisites); `pending` = feat milestones reached minus feats owned; `owned` lists the actor's feat items; `characterLevel` sums class levels. Gated by the `enableFeats` world setting.
- `feats.{ healerHeal, secondWind }(actor, item)` — activatable feat macros wired via each feat's `system.macro`. `healerHeal` heals the player's targeted creature for KEY HP, once per Safe Rest; `secondWind` spends one Hit Die (blocked at 0), heals its roll + KEY, and decrements `system.attributes.hitDice.<size>.current`, once per day. Both track usage on an item flag reset by the `nimble.rest` safe-rest hook.
- `feats.{ allocateAcademic, chooseElementalSpecialist }(actor, item?)` — grant-time configurators (also re-openable from the sheet Feats panel). `allocateAcademic` distributes Academic's 3 skill points into `system.skills.<key>.points`; `chooseElementalSpecialist` stores the chosen spell school + key stat that the spell-`activate` wrapper reads to add +KEY damage. Both fire automatically from a `createItem` hook when the feat is gained.
- `strain.{ gain, lose, roll, clear, getDieSize }(actor, n?)` — Psion Strain Dice tracker. State stored as integer flag `flags['nim-plus-package'].psion.strainDice`. `getDieSize` reads the Psion class item's `system.classLevel` to return d6 / d8 / d10 / d12 (thresholds L5, L10, L17). `roll` evaluates the pool, posts a chat card, and breaks Concentration on a 1 (with `new-core-ability` letting the Psion ignore exactly one 1).

Several `Hooks.on(...)` listeners auto-apply conditions and clean up state:
- Class-features and Spells compendium views get level / tier badges and level-sorted entries to mirror the system's core class-features pack.
- Activating Apodracosis (Mage / Invoker of Majesty) **or Psionic Field (Psion, L1)** auto-applies Concentration via `nimble.useItem`.
- Sporesphere applies Blinded / Poisoned to hit targets after the activation lands.
- Safe Rest clears the Seasoned Journeyman selection flag via `nimble.rest`.
- **`nimbleCombatTurnEnd`** auto-rolls the Psion's Strain Dice at end of turn (only when the actor has an active Psionic Field). If the Psion owns `i-can-hold`, sheds 1 die first.
- **Psion ability picker is system-native**, not a custom hook — Powerful Mind is wired the same way as Berserker's Savage Arsenal: 12 ability features share `system.group: "psion-abilities"` and `system.gainedAtLevels: [2, 4, 6, 9, 12, 14, 16]`, and the Nimble level-up dialog shows them as a "Psion Abilities (Choose one)" section at each of those levels. There is no `pickPsionicAbility` macro — the system handles selection, ownership tracking, and exclusion of already-owned options. Psionic Strike sits in `psion-progression` with `gainedAtLevels: [2]` so it's auto-granted at L2 alongside the player's pick.
- **`deleteActiveEffect`** filtered by the `concentration` status handles concentration-break: rolls remaining Strain Dice, posts a psychic-damage chat card, applies Incapacitated, fires `nim-plus-package.concentration-broken` for subclass reactors (Mind Collapse / Mind Shield / Big Mind), then clears the strain flag.
- **`deleteCombat`** wipes lingering Strain Dice flags from any combatants at end of encounter.
- **Feats (optional, `enableFeats` setting)** are surfaced two ways. (1) The `setup` `prepareDerivedData` patch appends the `feats` group to every **class** item's `system.groupIdentifiers` (derived data only — never `_source`) when the setting is on. The system's level-up index keys features by `system.class || system.group`, and the dialog fetches the leveling class's `groupIdentifiers` as extra group keys — so the feat features (class-less, `group: "feats"`, `gainedAtLevels: [1,4,8,12,16]`) render as a native "Feats (Choose one)" section at levels 4/8/12/16 with no patching of the Svelte dialog. (2) Level 1 isn't covered by that dialog (the initial class drop runs no level-up flow), so `renderPlayerCharacterSheet` injects a "Feats" panel with a **Choose Feat** button driven by `pendingFeatCount` (milestones reached − feats owned); this also back-fills when the setting is toggled mid-campaign. The button is manual, so it never double-grants against the native dialog.

## Layout

```
nim-plus-package/
├── module.json                 # Foundry manifest (the deployable file)
├── scripts/main.mjs            # esmodule: nimPlus.* API + Foundry hooks
├── assets/                     # 908 webp icons for classes, subclasses, features, spells, items, ancestries, backgrounds, companions
├── package.json
├── build/
│   ├── buildCompendia.mjs      # entry point: pnpm build
│   ├── helpers.mjs
│   ├── release.mjs             # entry point: pnpm release (stages dist/module.zip)
│   └── lib/
│       ├── IdBuilder.mjs       # stable _id allocation, persisted in pack-sources/ids.json
│       ├── Pack.mjs            # JSON → folder organization → LevelDB
│       └── LevelDB.mjs         # Foundry v13 LevelDB writer
├── pack-sources/               # editable JSON authoring (NOT distributed)
│   ├── ids.json                # _id ledger; commit me
│   ├── classes/<class>.json
│   ├── subclasses/<class>/<subclass>.json
│   ├── classFeatures/<class>/<group>/<feature>.json
│   ├── spells/<school>/<spell>.json
│   ├── items/<class>/<group>/<item>.json
│   ├── items/vol1/{starting-kits,gear}/<slug>.json   # Vol I variant starting equipment
│   ├── items/vol4/<category>/<slug>.json             # Vol IV magic items
│   ├── ancestries/exotic/<slug>.json                 # Vol I exotic ancestries
│   ├── ancestries/variants/<group>/<slug>.json       # Vol I ancestry variants
│   ├── backgrounds/<slug>.json                       # Vol I backgrounds (flat dir)
│   ├── feats/<slug>.json        # optional class-agnostic feats (flat dir)
│   └── companions/<companion>.json
└── packs/                      # build output (LevelDB dirs); git-ignored
    ├── nim-plus-classes/
    ├── nim-plus-subclasses/
    ├── nim-plus-class-features/
    ├── nim-plus-spells/
    ├── nim-plus-items/
    ├── nim-plus-ancestries/
    ├── nim-plus-backgrounds/
    └── nim-plus-companions/
```

`module.json` `packs[].path` points at `packs/<pack-name>` directories. `module.json` `packs[].flags.sourceDir` tells the build script which `pack-sources/` subdirectory holds that pack's JSON.

## Build

```sh
pnpm install
pnpm build
```

`pnpm build` runs `node build/buildCompendia.mjs`, which:

1. Walks `pack-sources/` and assigns or reuses stable 16-char `_id`s (recorded in `pack-sources/ids.json`). When a file moves, the IdBuilder generates a new ID for the new path and rewrites any UUID references in other source files automatically.
2. Loads each subdirectory as a Pack, organizes documents into Foundry folders (class folders for subclasses, class + progression / subclass folders for features, school folders for spells), and writes each pack to `packs/<pack-name>/` as a Foundry v13 LevelDB store.

Re-runs are idempotent: existing IDs in `ids.json` are reused; new files get fresh IDs that get appended.

## Installing into Foundry (developer)

Symlink (or copy) the module directory into `Data/modules/nim-plus-package/`. Only `module.json`, `packs/`, `scripts/`, and `assets/` need to be present at runtime. Enable the module in your world's settings. On Linux:

```sh
ln -sfn "$PWD" ~/.local/share/FoundryVTT/Data/modules/nim-plus-package
```

## Releasing

1. Bump `version` in `module.json` and `package.json`, update `CHANGELOG.md`, commit.
2. Tag the commit `vX.Y.Z` and push the tag — `.github/workflows/release.yml` runs `pnpm build && pnpm release`, then publishes a GitHub release with `module.json` and `module.zip` attached. The release script rewrites `manifest`/`download` URLs to point at the just-tagged release using `GITHUB_REPOSITORY`.

To smoke-test the release bundle locally:

```sh
pnpm build
pnpm release      # produces dist/module.json + dist/module.zip
unzip -l dist/module.zip
```

## Authoring conventions

### Class JSON
Top-level: `name`, `type: "class"`, `img`, `effects: []`, `flags: {}`, `_stats`. `system` block (see `pack-sources/classes/hexbinder.json`):
- `identifier` — kebab-case slug, must match the `class` field on every feature and the `parentClass` field on every subclass attached to it.
- `complexity` — 1 / 2 / 3
- `keyAbilityScores`, `hitDieSize`, `savingThrows{advantage,disadvantage}`
- `armorProficiencies[]`, `weaponProficiencies[]`
- `abilityScoreData` — required entries for levels 4, 5, 8, 9, 12, 13, 16, 17, 20
- `groupIdentifiers[]` — feature group ids this class uses
- `mana{formula,recovery}` — empty formula for non-casters
- `description` — HTML

Starting gear is granted via `system.rules[]` of type `grantItem`, referencing UUIDs in `Compendium.nimble.nimble-items.Item.<id>` or `Compendium.nim-plus-package.nim-plus-items.Item.<id>`.

### Subclass JSON
- `system.parentClass` MUST equal the parent class's `system.identifier` exactly. Existing slugs: `berserker`, `commander`, `hunter`, `mage`, `oathsworn`, `shadowmancer`, `shepherd`, `songweaver`, `stormshifter`, `the-cheat`, `zephyr`. New: `hexbinder`, `artificer`, `psion`.
- `system.description` — HTML containing all level-feature flavor text. Individual feature JSONs drive the actual level-up grants.

### Feature JSON
- `system.class` — parent class slug (must match the class's `identifier`).
- `system.group` — feature group id; for progression features use the `<class>-progression` slug, for subclass features use the subclass slug bare (e.g. `coven-of-the-hex`). Pickable pool pattern (Berserker's `savage-arsenal`, Psion's `psion-abilities`): every option shares the same `group` slug AND the same `gainedAtLevels` array — the Nimble level-up dialog auto-renders these as a "(Choose one)" section at each shared `gainedAtLevel`, filtering out options the actor already owns. The class JSON must register the group in `groupIdentifiers`.
- `system.gainedAtLevels` — array of integer levels the feature is granted at.
- `system.subclass` — `true` for subclass features, `false` for class-progression features.
- `system.activation` — `cost.type` is one of `action`, `bonus action`, `reaction`, `none`, etc.
- `system.macro` (optional) — a JS expression run with `(actor, item) => …`. Common pattern: `return nimPlus.<helper>(actor, item);`. The system runs the macro *instead of* the regular activation flow when the actor's `automaticallyExecuteAvailableMacros` flag is true (default).
- `flags.nim-plus-package.showAsAttack: true` (optional) — opts the feature into the sheet's Heroic Actions → Attack panel. The module's `setup` hook injects `system.actionType = 'attack'` at runtime to satisfy the panel's filter.
- `flags.nim-plus-package.strainCost: <number>` (optional, Psion only) — baseline minimum Strain Dice the Psionic Ability costs to use. Used as a tooltip subtitle by the `pickPsionicAbility` picker. The description holds the variable-spend details.

File-path convention drives folder organization in the compendium UI:
- `pack-sources/classFeatures/<class>/<class>-progression/<feature>.json` — progression-style features (rendered in the `<Class> Progression` folder)
- `pack-sources/classFeatures/<class>/<class>-subclasses/<subclass-slug>/<feature>.json` — subclass features (rendered in the `<Subclass>` folder)

### Spell JSON
- `system.school` — drives the compendium folder. Schools currently shipped: `hexbinder`, `earth`, `wind` (Stormshifter), `shepherd`, `muscle-spells` (Berserker / Muscle Mage).
- `system.tier` — 0 (cantrip / mana-bypass) through 5.
- `system.classes[]` — class slugs that can prepare this spell.
- `flags.nim-plus-package.furyDiceCost` (optional) — used by Berserker muscle spells to record the conceptual FD requirement separately from the system's mana cost.

### Item JSON (Nim+ Volume IV magic items)
Vol IV items live under `pack-sources/items/vol4/<category>/<slug>.json`, where `<category>` is one of `weapons`, `armor-and-shields`, `accessories`, `utility-and-exploration`, `consumables-and-wands`, `dverung-runes`, `mystic-michaels` — the build's items folder handler (`Pack.mjs #prepareItemFolderAssignments`) maps each category directory to a compendium folder; items outside `vol4/` (hexbinder, artificer) stay folderless. Each item is an `object` document:
- `system.objectType` — `weapon` / `armor` / `shield` / `consumable` / `misc`.
- **Weapons** carry a full activation damage tree (`system.activation.effects[]`: a `damage` node with `formula` like `1d6+@strength`, `damageType`, and `on.hit/criticalHit/miss` children — copy the shape from the system's core weapons). `properties.selected` holds `light` / `thrown` / `twoHanded` / `range` / `reach` / `load` / `vicious` / `concentration`; STR requirements go on `properties.strengthRequirement.value`.
- **Armor/shields** carry an `armorClass` rule. The system's base AC already includes the DEX mod, so a flat "18 Armor" is `formula: "18-@dexterity"`, "12+DEX (max 2)" is `"12+min(@dexterity,2)-@dexterity"`, and stat-swap armors add the stat directly (`"@influence"`, `"5+@intelligence-@dexterity"`, `"6+@will"`). Rules on objects are auto-disabled while the object is unequipped (the system syncs `rule.disabled` to `system.equipped`).
- **Rules used by Vol IV items** beyond the feat set: `grantMovement` (fly/swim/climb; `speed` accepts formulas like `floor(@attributes.movement.walk/2)`), `applyCondition` (`trigger`: `onHit`/`onCrit`/`onMiss`/self-triggers), `unarmedDamage`, `initiativeMessage`, `healingPotionBonus`, and `chargePool` + `chargeConsumer` (`recoveries[]` triggers: `safeRest`, `fieldRest`, `encounterStart`, …; narrative recharges use an empty `recoveries` list). Predicated rules work off domain tags (e.g. Trollhide Wrap: `predicate: {"$and": ["self:bloodied"]}`).
- `flags.nim-plus-package` markers drive the runtime automation: `vol4Dawnmark` (`onHit` / `radiantSpells` / manual-trigger values), `vol4DawnmarkSplash`, `vol4Rune` (`{slot, key, payload}` consumed by `applyRune`), `vol4DwarfsDelight`, `vol4RegalRest`, `vol4LadlorsTenacity`, `vol4StrengthOMaxer`, `vol4CantripBonus`.
- **Caveat:** items that pair a `system.macro` with a charge pool must decrement the pool inside the macro (`vol4SpendCharge`) — the macro path replaces the regular activation flow, so `chargeConsumer` rules never fire for them.
- The Vol IV `nimPlus.vol4.*` helpers live in the "Nim+ Volume IV — magic item runtime" section of `scripts/main.mjs`: the Dawnmark engine (`dawnmarkApply` / `dawnmarkConsume` + `nimble.useItem` hooks), `applyRune`, `elementalWeapon`, `bloodseeker`, `battlemageInfusion`, `realityFold`, `duneguardBrooch`, `blindOracle`, `elementalGuidance`, `jellybean`, `unicornTear`, plus the Strength-o-Maxer `prepareDerivedData` rider and the Spellslinger's Prism cantrip formula splice.

### Ancestry & Background JSON (Nim+ Volume I)
Ancestries live under `pack-sources/ancestries/` (built into **Nim+ Ancestries**), backgrounds flat under `pack-sources/backgrounds/` (**Nim+ Backgrounds**). The system's character-creation dialog indexes ancestry/background items from **every** pack, so shipped documents appear there automatically.
- **Ancestry** (`type: "ancestry"`): `system.size` (array of `tiny`/`small`/`medium`/`large` — multiple entries render a size choice in the dialog), `system.exotic` (splits the dialog's Core/Exotic sections), `system.rules[]`, HTML `system.description` using the system's `[A]` (automated) / `[M]` (manual) trait-line markers.
- **Ancestry variants** (`ancestries/variants/<group>/`) are *full replacement* ancestries: copy the base ancestry's `img`/`description`/`rules` verbatim from the system pack and append the variant trait (name them `Base (Variant)` so they sort next to the base). The build's ancestries folder handler (`Pack.mjs #prepareAncestryFolderAssignments`) maps `exotic/` and each `variants/<group>/` directory to a compendium folder.
- **Background** (`type: "background"`): just `system.rules[]` + `system.description`.
- Rules used by Vol I docs: `skillBonus`, `speedBonus`, `initiativeBonus`, `armorClass`, `maxHpBonus` (`perLevel: true`), `grantMovement` (swim/fly), `grantProficiency` (languages, INT≥0 predicate), `unarmedDamage`, and a `self:dying`-predicated `damageBonus` (Mousefolk). Situational advantage, 1/encounter reactions, and narrative effects have no rule type — leave them as `[M]` description lines.

### Vol I variant starting-equipment kits
`pack-sources/items/vol1/starting-kits/` holds one `feature` document per kit (two per core class). Each kit's `system.rules[]` is a list of `grantItem` rules (`allowDuplicate: true`, optional `quantity`) pointing at `Compendium.nimble.nimble-items.Item.<id>` or `Compendium.nim-plus-package.nim-plus-items.Item.<id>`; the system grants every listed item the moment the kit is dropped on a character. Kits also surface as extra options in the character creator's Starting Equipment step (`scripts/main.mjs`, "Vol I — Variant Starting Kits" section): the runtime matches kits to the selected class via the `system.identifier` prefix (`<class>-kit-<n>`) and the `flags.nim-plus-package.vol1Kit` flag, so keep both when authoring a new kit. When a kit is chosen there, the module suppresses the standard equipment/gold and grants the kit contents itself — weapons one document per unit, unresolvable grant UUIDs as placeholder objects. Zine-only mundane gear lives in `items/vol1/gear/` as plain `object` documents (`objectType` misc/weapon/consumable). Note the two-phase authoring: gear JSONs must be built once (so the IdBuilder allocates their `_id`s) before kit rules can reference them.

### Feat JSON
Feats live in the flat `pack-sources/feats/<slug>.json` directory (built into the **Nim+ Feats** pack). Each is a `feature` document with:
- `system.identifier` — the kebab-case slug (also the icon filename: `assets/feats/<slug>.webp`).
- `system.group` — **`feats`** (the marker the level-up injection keys on). Do **not** set `system.class` (leave it `""`); a class-less feature indexes under its group, which is what makes feats class-agnostic.
- `system.gainedAtLevels` — `[1, 4, 8, 12, 16]`.
- `system.subclass` — `false`.
- `system.activation.cost.type` — `action` / `bonus action` / `reaction` / `none`, with `quantity` (2 for two-action feats) and `isReaction` set to match the feat.
- `system.description` — HTML; lead with a `<p class="nim-plus-feat-req">` paragraph when the feat has a prerequisite (the picker strips it from its preview).
- `flags.nim-plus-package` — `feat: true` (identifies feat items on an actor), `featReq` (the prerequisite string the picker parses for STR/DEX/INT/WIL gating), `featAction` (the action keyword).

- `system.rules` — feats with an **always-on** mechanical effect carry a system rule so the bonus applies the moment the feat is taken: `skillBonus` (skills like Perception/Influence/Might/Arcana/Stealth/Finesse/Insight/Examination — note Nimble has no Persuasion skill, so it maps to `influence`), `armorClass` (mode `add`), `speedBonus`, `maxWounds`, `maxHitDice` (`dieSize: 0` = class die), `maxHpBonus` (`perLevel: true` for "×LVL" feats), `grantProficiency` (`proficiencyType: "weapons"`, `values: ["all"]`), and `initiativeBonus` (`value: "@key"` — Vigilant; `@key` resolves to the class KEY modifier via `getRollData`). Triggered/active/reaction abilities, allies-only auras, conditional bonuses (no reliable predicate), and situational advantage (Nimble has **no** situation-scoped advantage rule) are left as rules-empty descriptive features.
- **Eight feats need automation the rules engine can't express** and are handled in `scripts/main.mjs` instead (see the "Feats — mechanical automation" section there):
  - **Armor conditionals** — Defensive Duelist (DEX melee weapon, no shield), Dual Wielder (2+ equipped weapons), and the **Bulwark** adjacent-ally aura are added to `system.attributes.armor.value` in a patched `NimbleCharacter.prepareDerivedData` (reached via `CONFIG.NIMBLE.Actor.documentClasses.character`). The predicate domain has no tags for weapon-wielding or aura adjacency, so static `armorClass` rules can't see them. Bulwark recomputes on `updateToken`/`createToken`/`deleteToken`/`canvasReady`. The weapon-armor feats read `system.equipped`, which Nimble's inventory only exposes a control for on rules-bearing objects (armor/shields) — so `syncWeaponEquipToggles()` injects a hand-icon equip toggle onto rules-less weapon rows (Inventory tab), driven by the same per-sheet `MutationObserver` as the Feats section.
  - **Elemental Specialist** — a wrapper on `CONFIG.NIMBLE.Item.documentClasses.spell.prototype.activate` appends `+KEY` to the first damage node of any *tiered* spell whose `system.school` matches the choice stored on the feat flag, then restores the formula (so casts don't accumulate the bonus). This scopes by school, which `damageBonus` rules can't.
  - **Healer / Second Wind** are activatable via `system.macro` → `nimPlus.feats.{healerHeal,secondWind}`; **Academic / Elemental Specialist** are configured by dialogs fired from a `createItem` hook. Per-use feat state lives on item flags under `flags.nim-plus-package` (`healerUsed`, `secondWindUsed`, `academicAllocated`, `elementalChosen`).

The 52 shipped feats were generated from a single dataset; to regenerate or extend, edit the source JSONs directly (the build assigns `_id`s and folders as usual). Levels 4/8/12/16 surface in the native level-up window; level 1 and back-fill go through the character-sheet picker — see the runtime-helpers notes above.

### IDs and references
Source JSONs do not need to set `_id`; the IdBuilder allocates one and writes it back, then persists it in `pack-sources/ids.json`. Cross-document UUID references should use:

```
Compendium.nim-plus-package.<pack-name>.<DocType>.<id>
```

If you rename or move a source file, the IdBuilder will reallocate an ID for the new path; the build's UUID-rewriter will update references inside other source files automatically. Never delete `ids.json` unless you've also dropped the published packs — doing so breaks any worlds that already imported items from the module.

## Asset pipeline

`assets/` ships 908 webp icons covering every class, subclass, feature, spell, item, ancestry, background, and companion the module declares. Feature / spell / item / sigil / ancestry / background icons render at 512 × 512; portraits (class, subclass, companion) at 768 × 768. All saved as lossy webp (q85) to keep the install zip manageable. The Vol IV item and Vol I character-creation icons were generated with the sibling `nim-icon-forge` project (Recraft API, custom style matched to the module's existing ChatGPT-made icons) from the prompt sets in `docs/icon-prompts/items/vol4-*.md` and `docs/icon-prompts/vol1/vol1-*.md`; Vol I uses per-type prompt templates (object / creature-bust / kit still-life).
