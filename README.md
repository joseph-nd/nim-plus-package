# Nim+ Package

A Foundry VTT module that ships extra content for the [Nimble system](https://github.com/Nimble-Co/FoundryVTT-Nimble): the Hexbinder and Artificer classes, additional subclasses for every core class, the spells / items / companions those features rely on, and a small runtime helper layer (`nimPlus.*`) that wires up the macros some features use.

Foundry v13 only. Requires the `nimble` system (≥ 0.8.4).

## Install (end users)

**Prerequisites.** Foundry VTT v13 with the [Nimble system](https://github.com/Nimble-Co/FoundryVTT-Nimble) (≥ 0.8.4) installed and enabled in your world.

1. Open Foundry's setup screen → **Add-on Modules** tab.
2. Click **Install Module**.
3. At the bottom of the dialog, paste this **Manifest URL**:

   ```
   https://github.com/joseph-nd/nim-plus-package/releases/latest/download/module.json
   ```

4. Click **Install**. Foundry downloads the latest tagged release.
5. Launch your Nimble world → **Game Settings → Manage Modules** → tick **Nim+ Package** → **Save Module Settings**.
6. The compendium sidebar will now show six new **Nim+ …** packs (Classes, Subclasses, Class Features, Spells, Items, Companions). Drag content onto your sheet or world like any other compendium.

**Updating.** Foundry auto-checks the manifest URL on launch — when a new tag is published, you'll see an update prompt in **Manage Modules**.

**Uninstall.** Disable in Manage Modules, then **Add-on Modules → Uninstall** removes the module folder. Items already imported into worlds remain (they're per-world copies); to remove them, delete the imported items from the world.

## What's included

The module currently ships **503 documents** across **6 compendium packs**:

| Pack | Count | Contents |
|---|---|---|
| **Nim+ Classes** | 2 | Hexbinder, Artificer |
| **Nim+ Subclasses** | 56 | new subclasses for every core class plus the new classes (see breakdown below) |
| **Nim+ Class Features** | 402 | progression + subclass features for every class above |
| **Nim+ Spells** | 27 | Hexbinder spells (tiers 1–5), plus subclass-specific spells for Stormshifter, Shepherd, and Berserker |
| **Nim+ Items** | 15 | Hexbinder concoctions (8) + Artificer inventions and prototypes (7) |
| **Nim+ Companions** | 1 | Spirit Companion (Shepherd / Luminary of Tidings summon) |

### New classes
- **Hexbinder** — full progression, afflictions, mystic marks. Subclasses: *Coven of the Hex*, *Coven of the Hunt*, *Coven of the Cauldron*.
- **Artificer** — full progression, Eureka picks, Inventions, Gadgets. Subclasses: *Forge of the Gadgeteer*, *Forge of the Inventor*, *Forge of the Mechanic*.

### Additional subclasses for core classes

| Class | Subclasses shipped by this module |
|---|---|
| Berserker | Muscle Mage, Path of the Burning Rage, Path of the Exile, Path of the Titan's Grip |
| Commander | Champion of the Arena / Battlefield / Phalanx / Pit / Siege Breaker / Stratagem |
| Hunter | Keeper of the Balance, Keeper of the Pack, Keeper of Traps |
| Mage | Invoker of Flame / Frost / Majesty / Perfection / Surges / Wards |
| Oathsworn | Oath of Eternal Valor, Oath of Purification, Oath of Roaring Thunder, Oath of Valor |
| Shadowmancer | Pact of the Endless Swarm / High Celestial / Id / Void |
| Shepherd | Luminary of Aegis / Darkness / Protection / The Forge / Tidings |
| Songweaver | Herald of Doom, Herald of Legends, Herald of Singing Steel, Herald of Torment |
| Stormshifter | Circle of Cinder & Ash, Circle of Spores, Circle of Sun & Moon, Circle of Venom & Web |
| The Cheat | The Honorseeker, Tools of the Gambler / Serpent / Spider / Trickshot |
| Zephyr | Way of Hurricanes / Iron / Shadows / The Dancer / The Drunken Fist |

### Runtime helpers (`scripts/main.mjs`)

The module's esmodule registers a small API on `globalThis.nimPlus` (and `game.modules.get('nim-plus-package').api`) that some features call from their `system.macro` field:

- `pickDamage(actor, item, options)` — Living Weapon (Berserker / Path of the Titan's Grip): pop a dialog to pick Tiny / Small / Medium and roll the matching damage formula.
- `summonSpiritCompanion(actor, item)` — Spirit Companion (Shepherd / Luminary of Tidings): summon, dismiss, or re-skin a Spirit Companion token; persists die size, name, and image as actor flags.
- `tollTheHour(actor, item)` — Toll the Hour (Shepherd / Luminary of Tidings): pick Jubilation (heal) or Calamity (radiant damage).
- `seasonedJourneyman(actor, item)` — Seasoned Journeyman (Shepherd / Luminary of the Forge): pick Weaponsmith / Armorsmith at Safe Rest. Auto-detects Master of the Hammer (L11) and bumps the bonus from WIL to WIL + STR.
- `sporeAttack(actor, item)` — Sporesphere (Stormshifter / Circle of Spores): scales damage and Reach with owned upgrades (Germination, Mycelium Growth, Sporulation) and offers Decay's Beastshift-charge upgrades (die-size bumps, Blinded, Poisoned).

Several `Hooks.on(...)` listeners auto-apply conditions and clean up state:
- Class-features and Spells compendium views get level / tier badges and level-sorted entries to mirror the system's core class-features pack.
- Activating Apodracosis (Mage / Invoker of Majesty) auto-applies Concentration via `nimble.useItem`.
- Sporesphere applies Blinded / Poisoned to hit targets after the activation lands.
- Safe Rest clears the Seasoned Journeyman selection flag via `nimble.rest`.

## Layout

```
nim-plus-package/
├── module.json                 # Foundry manifest (the deployable file)
├── scripts/main.mjs            # esmodule: nimPlus.* API + Foundry hooks
├── assets/                     # 470 webp icons for classes, subclasses, features, spells, items, companions
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
│   └── companions/<companion>.json
└── packs/                      # build output (LevelDB dirs); git-ignored
    ├── nim-plus-classes/
    ├── nim-plus-subclasses/
    ├── nim-plus-class-features/
    ├── nim-plus-spells/
    ├── nim-plus-items/
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
- `system.parentClass` MUST equal the parent class's `system.identifier` exactly. Existing slugs: `berserker`, `commander`, `hunter`, `mage`, `oathsworn`, `shadowmancer`, `shepherd`, `songweaver`, `stormshifter`, `the-cheat`, `zephyr`. New: `hexbinder`, `artificer`.
- `system.description` — HTML containing all level-feature flavor text. Individual feature JSONs drive the actual level-up grants.

### Feature JSON
- `system.class` — parent class slug (must match the class's `identifier`).
- `system.group` — feature group id; for progression features use the `<class>-progression` slug, for subclass features use the subclass slug bare (e.g. `coven-of-the-hex`).
- `system.gainedAtLevels` — array of integer levels the feature is granted at.
- `system.subclass` — `true` for subclass features, `false` for class-progression features.
- `system.activation` — `cost.type` is one of `action`, `bonus action`, `reaction`, `none`, etc.
- `system.macro` (optional) — a JS expression run with `(actor, item) => …`. Common pattern: `return nimPlus.<helper>(actor, item);`. The system runs the macro *instead of* the regular activation flow when the actor's `automaticallyExecuteAvailableMacros` flag is true (default).
- `flags.nim-plus-package.showAsAttack: true` (optional) — opts the feature into the sheet's Heroic Actions → Attack panel. The module's `setup` hook injects `system.actionType = 'attack'` at runtime to satisfy the panel's filter.

File-path convention drives folder organization in the compendium UI:
- `pack-sources/classFeatures/<class>/<class>-progression/<feature>.json` — progression-style features (rendered in the `<Class> Progression` folder)
- `pack-sources/classFeatures/<class>/<class>-subclasses/<subclass-slug>/<feature>.json` — subclass features (rendered in the `<Subclass>` folder)

### Spell JSON
- `system.school` — drives the compendium folder. Schools currently shipped: `hexbinder`, `earth`, `wind` (Stormshifter), `shepherd`, `muscle-spells` (Berserker / Muscle Mage).
- `system.tier` — 0 (cantrip / mana-bypass) through 5.
- `system.classes[]` — class slugs that can prepare this spell.
- `flags.nim-plus-package.furyDiceCost` (optional) — used by Berserker muscle spells to record the conceptual FD requirement separately from the system's mana cost.

### IDs and references
Source JSONs do not need to set `_id`; the IdBuilder allocates one and writes it back, then persists it in `pack-sources/ids.json`. Cross-document UUID references should use:

```
Compendium.nim-plus-package.<pack-name>.<DocType>.<id>
```

If you rename or move a source file, the IdBuilder will reallocate an ID for the new path; the build's UUID-rewriter will update references inside other source files automatically. Never delete `ids.json` unless you've also dropped the published packs — doing so breaks any worlds that already imported items from the module.

## Asset pipeline

`assets/` ships 470 webp icons covering every class, subclass, feature, spell, item, and companion the module declares. Feature / spell / item / sigil icons render at 512 × 512; portraits (class, subclass, companion) at 768 × 768. All saved as lossy webp (q85) to keep the install zip under ~30 MB.

## Credits

This module stands on the shoulders of two upstream projects.

**The Nimble system** — the underlying game engine and rule core, by **Nimble Co**. This module would not exist without it. © 2025 Nimble Co. See <https://nimblerpg.com>.

**Nim+ Volume III** — the community content supplement this module adapts (submissions June 2025, published July 2025). Curated and edited by **Emil Andersen (Santuric)**, with rules content by:

AJ · Blue · Can Opener · Charles and Jeannine Archibald · DanDraco · Kazok the Goblin · Khan Wick · Nathan Warkentin (Trex) · Rockergage · SanityWithIn · Santuric · Squeekie · Victor Constantinescu (MaleficMist) · Vinícius Conrado

Proofreaders: AJ · Chas · DanDraco · MaleficMist · Methodia · Raford · SanityWithIn · The Pebble · Trex · TwinSteel · VedastusSoFastus.

This Foundry VTT module is a fan adaptation. Any errors in transcription or wiring are mine, not theirs. If you enjoy this content, please support the original authors at <https://santuric.itch.io>.

## Licensing

> Nim+ Package is an independent product published under the Nimble 3rd Party Creator License and is not affiliated with Nimble Co. Nimble © 2025 Nimble Co.

The reproduced Nim+ Volume III rules content is licensed by Santuric and contributors under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/) (CC-BY 4.0).

The code in this repository (build scripts, runtime helpers, packaging tooling) is released under the MIT License — see [LICENSE](LICENSE).

For the full Nimble 3rd Party Creator License terms, see <https://nimblerpg.com/creators>.
