# Nim+ Package

A Foundry VTT module that ships extra content for the [Nimble system](https://github.com/Nimble-Co/FoundryVTT-Nimble): the Hexbinder, Artificer, and Psion classes, additional subclasses for every core class, the spells / items / companions those features rely on, and a small runtime helper layer (`nimPlus.*`) that wires up the macros some features use.

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
6. The compendium sidebar will now show nine new **Nim+ …** packs (Classes, Subclasses, Class Features, Spells, Items, Companions, Feats, Ancestries, Backgrounds). Drag content onto your sheet or world like any other compendium.

**Updating.** Foundry auto-checks the manifest URL on launch — when a new tag is published, you'll see an update prompt in **Manage Modules**.

**Uninstall.** Disable in Manage Modules, then **Add-on Modules → Uninstall** removes the module folder. Items already imported into worlds remain (they're per-world copies); to remove them, delete the imported items from the world.

## What's included

The module currently ships **1,020 documents** across **9 compendium packs**:

| Pack | Count | Contents |
|---|---|---|
| **Nim+ Classes** | 3 | Hexbinder, Artificer, Psion |
| **Nim+ Subclasses** | 61 | new subclasses for every core class plus the new classes (see breakdown below) |
| **Nim+ Class Features** | 447 | progression + subclass features for every class above |
| **Nim+ Spells** | 27 | Hexbinder spells (tiers 1–5), plus subclass-specific spells for Stormshifter, Shepherd, and Berserker |
| **Nim+ Items** | 349 | Hexbinder concoctions (8), Artificer inventions and prototypes (7), the full **Nim+ Volume IV magic-item catalogue** (220 — see **Magic Items** below), the **Nim+ Volume I variant starting equipment** (22 kits + 25 gear items — see **Character Creation** below), and the **Expanded Equipment** mundane gear set (67 — see **Expanded Equipment** below) |
| **Nim+ Companions** | 1 | Spirit Companion (Shepherd / Luminary of Tidings summon) |
| **Nim+ Feats** | 52 | optional class-agnostic feats (off by default — see **Optional: Feats** below) |
| **Nim+ Ancestries** | 50 | the **Nim+ Volume I** exotic ancestries (19) and ancestry variants (31 — see **Character Creation** below) |
| **Nim+ Backgrounds** | 30 | the **Nim+ Volume I** backgrounds |

### Magic Items (Nim+ Volume IV)

The **Nim+ Items** pack ships the complete *Nim+ Volume IV* magic-item zine, organized into seven compendium folders matching the zine's structure: **Weapons**, **Armor & Shields**, **Accessories**, **Utility & Exploration**, **Consumables & Wands** (the 100-item Jasper's Warehouse catalogue), **Dverung Runes** (the optional 20-rune upgrade system), and **Mystic Michael's Machinations** (100 whimsical capsule items).

Items are mechanically wired wherever the printed effect can be expressed, not just transcribed: armor and shields apply their Armor formulas when equipped (including conditional ones like Trollhide Wrap's *+2 while Bloodied*); weapons roll their full damage trees with crit/miss riders (Entangling Bow auto-Restrains on crit, Runic Maul knocks you Prone on miss); fly/swim/climb granters set real movement speeds; and limited-use items track charges with the correct 1/encounter, 1/Safe Rest, or narrative-recharge behavior. On top of that, a runtime layer (`nimPlus.vol4.*`) automates the **Dawnmark** stack engine of the Blazing Dawn set, **Dverung Rune melding** (pick an item, capacity enforced, effect permanently added, rune consumed), **Elemental Weapon** enchanting, Bloodseeker's HP-for-damage strikes, Battlemage Glove infusions, the Ladle of the Kobold Champion's death-defiance, and more. Purely narrative or GM-adjudicated effects stay as descriptive notes on the item's chat card.

### Expanded Equipment

The **Nim+ Items** pack also ships the *Expanded Equipment* zine's **67 mundane items**, organized into five compendium folders: **Shields** (8), **Armor** (15), **Bludgeoning Weapons** (13), **Piercing Weapons** (18), and **Slashing Weapons** (13).

Weapons carry full activation damage trees with the system's native properties (two-handed, light, load, range, reach, thrown, vicious), and the three versatile weapons — War Hammer, Spear, Trident — can be re-gripped one- or two-handed in play. Armor and shields apply their Armor formulas when equipped, including the Great Shield, Tower Shield, and Full Plate's Speed penalty. On top of the static rules, a runtime layer automates **Spiked** gear (melee attackers take 1d4 piercing per spiked piece worn), **Parry** (an advisory note when a wielder's Parry weapon should turn aside a glancing hit), **Brittle** durability (a Defend/critical-hit counter that shatters the item at zero — spend and repair it manually via the equip toggle or `nimPlus.equipment`), the Scholar's Outfit's +2 max Mana, and Loud gear's Stealth disadvantage. Properties that need table adjudication (Heavy, Feint, Push, Return, Focus, Partial Cover, and a couple of reaction abilities) stay as description text and chat-card notes.

### Character Creation (Nim+ Volume I)

The **Nim+ Ancestries** and **Nim+ Backgrounds** packs ship the *Nim+ Volume I* character-creation zine. Because Nimble's character-creation dialog gathers ancestry and background documents from **every** available compendium, this content appears there automatically alongside the system's own options — no configuration needed.

- **19 exotic ancestries** (Mousefolk, Otterfolk, Snailfolk, Jotunn, Pixie, Elemental Scion, Changething, …) listed under the dialog's Exotic section, with sizes from Tiny (Pixie) to Large (Jotunn).
- **31 ancestry variants** (the zine's *Ancestry Variants* rule): sub-ancestry versions of every core ancestry — *Dwarf (Mountainborn)*, *Elf (Deep Elf)*, *Orc (Stormkin)*, and so on. Each variant document bundles the base ancestry's full trait with the variant bonus, so you simply **pick the variant instead of the base ancestry** during character creation (they sort right next to it). The zine notes these make heroes stronger than normal — ask your GM. The compendium organizes them into one folder per zine heading (Dwarven Hearths, Elven Clades, Halfling Traditions, …).
- **30 backgrounds**, from *Commoner* to *Stitched back to Life*.
- **Variant starting equipment** (the zine's *Starting Equipment* rule): two alternative kits per core class in the **Nim+ Items** pack (*Vol I — Variant Starting Equipment* folder). Drop a kit on your character and its `grantItem` rules hand out the whole set — including new Vol I gear like the Deck of Cards (a real 1d4+DEX, Light, Thrown 6 weapon), the Fur Cloak, and the Mean Hangover (*Vol I — Adventuring Gear* folder). Choose "gold" (or skip equipment) during character creation, then drop your kit.

As with the rest of the module, everything expressible is mechanically wired (skill/speed/initiative/Armor bonuses, per-level max HP, swim/fly speeds, languages, unarmed damage, Mousefolk's *+WIL while Dying*), and effects needing table adjudication are kept as clearly marked description lines, using the system's own `[A]` (automated) / `[M]` (manual) markers.

### Optional: Feats

A class-agnostic Feats system — **off by default**. Enable it in **Game Settings → Configure Settings → Nim+ Package → Enable Feats**. Once on, any character may choose a feat at levels **1, 4, 8, 12, and 16**:

- At levels **4 / 8 / 12 / 16**, a **"Feats (Choose one)" section appears inside the level-up window**. Pick your feat there and it's granted when you confirm the level-up.
- At **level 1** (character creation has no level-up window), the feat picker opens automatically when you first open the character's sheet.
- The character sheet's **Features** tab also has a dedicated **Feats** section listing your chosen feats (click one to open it), with a **Choose Feat** button for back-fill — e.g. when you enable the setting mid-campaign.
- Feats are previewed at levels 1 / 4 / 8 / 12 / 16 in the class **Progression** tab.

The picker hides feats you already have and greys out any whose ability-score prerequisite (e.g. *Req. 3 STR*) you don't meet; other prerequisites are shown as text for you to honor. Feats are ordinary feature items once granted, so they show in your features list and can be dragged from the **Nim+ Feats** compendium like any other content.

Many feats are **mechanically automated** rather than text-only. Always-on bonuses (skills, Armor, Speed, Wounds, Hit Dice, max HP, weapon proficiency, initiative) apply the instant the feat is taken. Beyond those, eight feats carry deeper automation: **Academic** opens a 3-skill-point allocator; **Bulwark** grants +2 Armor to adjacent allies on the canvas; **Defensive Duelist** / **Dual Wielder** adjust Armor from your equipped weapons (use the hand-icon **equip toggle** the module adds to weapon rows on the **Inventory** tab — solid hand means equipped); **Elemental Specialist** lets you pick a spell school + key stat and then adds that bonus to your tiered spells of that school automatically; and **Healer** / **Second Wind** become click-to-use actions (target-heal and spend-a-Hit-Die-to-heal, respectively), each refreshing on a Safe Rest. The rest remain descriptive prompts for effects that depend on table adjudication.

### New classes

**Hexbinder** and **Artificer** are official Nimble content; each ships with two official subclasses plus one homebrew submission. **Psion** is an early homebrew playtest class (alpha v0.1.1) and its abilities will likely change as the design evolves.

- **Hexbinder** — full progression, afflictions, mystic marks.
  - *Coven of the Hex* (official)
  - *Coven of the Hunt* (official)
  - *Coven of the Cauldron* — **homebrew by DamianRM**
- **Artificer** — full progression, Eureka picks, Inventions, Gadgets.
  - *Forge of the Gadgeteer* (official)
  - *Forge of the Inventor* (official)
  - *Forge of the Mechanic* — **homebrew by Apex**
- **Psion (alpha)** — Psionic Field aura, Strain Dice mechanic, 13 player-pickable Psionic Abilities.
  - *Adept of Bladestorm*
  - *Adept of Illusions*
  - *Adept of Collapse*

### Additional subclasses for core classes

| Class | Subclasses shipped by this module |
|---|---|
| Berserker | Muscle Mage, Path of the Burning Rage, Path of the Exile, Path of the Titan's Grip, Path of the Titans |
| Commander | Champion of the Arena / Battlefield / Phalanx / Pit / Siege Breaker / Stratagem |
| Hunter | Keeper of the Balance, Keeper of the Pack, Keeper of Traps |
| Mage | Invoker of Flame / Frost / Majesty / Perfection / Surges / Wards |
| Oathsworn | Oath of Eternal Valor, Oath of Purification, Oath of Roaring Thunder, Oath of Valor |
| Shadowmancer | Pact of the Ego / Endless Swarm / High Celestial / Void |
| Shepherd | Luminary of Aegis / Darkness / Protection / The Forge / Tidings |
| Songweaver | Herald of Doom, Herald of Legends, Herald of Singing Steel, Herald of Torment |
| Stormshifter | Circle of Blaze & Bloom, Circle of Cinder & Ash, Circle of Spores, Circle of Sun & Moon, Circle of Venom & Web |
| The Cheat | The Honorseeker, Tools of the Gambler / Serpent / Spider / Trickshot |
| Zephyr | Way of Hurricanes / Iron / Shadows / The Dancer / The Drunken Fist |

## Contributing

Building from source, the runtime helper API, JSON authoring conventions, the release pipeline, and other developer-facing internals live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

This module stands on the shoulders of two upstream projects.

**The Nimble system** — the underlying game engine, the Hexbinder and Artificer classes, and most of their subclasses, by **Nimble Co**. This module would not exist without it. © 2025 Nimble Co. See <https://nimblerpg.com>.

**Homebrew subclasses for the official new classes** — *Coven of the Cauldron* by **DamianRM**, *Forge of the Mechanic* by **Apex**. Reproduced with thanks.

**Psion class (alpha homebrew)** — sourced from the *Psion v0.1.1* PDF playtest. Author credit pending confirmation; see the PDF cover at `Psion-0.1.1.pdf`.

**Optional Feats** — the 52 class-agnostic feats shipped in the **Nim+ Feats** pack are homebrew by **maxnomillion** and **funkyrythm**. Reproduced with thanks.

**Nim+ Volume I** — the community character-creation zine this module adapts for the Nim+ Ancestries and Nim+ Backgrounds packs and the variant starting equipment (submissions February 2025, published March 2025). Curated and edited by **Emil Andersen (Santuric)**, with content by:

Chris Lewis (HappyBunny) · Chthonic Duck · DamianRM · EmmaBelotti · Gerke Bouma (TDA) · Kazok the Goblin · LewisH · Plot-Relevant Commoner · Raford · SanityWithIn · Santuric · The Rotten Pixie · Theleftmouseknop · Trex · TwinSteel

Proofreaders: Gary Verhaegen · Gerke Bouma (TDA) · LewisH · SanityWithIn · TwinSteel. Art and assets by MentalMicrowave, Chthonic Duck, Alderdoodle, and Sandra Donoso (the zine's art is not reproduced by this module; all 127 documents ship with original AI-generated icons in the module's house style).

**Nim+ Volume III** — the community content supplement this module adapts for the additional core-class subclasses (submissions June 2025, published July 2025). Curated and edited by **Emil Andersen (Santuric)**, with rules content by:

AJ · Blue · Can Opener · Charles and Jeannine Archibald · DanDraco · Kazok the Goblin · Khan Wick · Nathan Warkentin (Trex) · Rockergage · SanityWithIn · Santuric · Squeekie · Victor Constantinescu (MaleficMist) · Vinícius Conrado

Proofreaders: AJ · Chas · DanDraco · MaleficMist · Methodia · Raford · SanityWithIn · The Pebble · Trex · TwinSteel · VedastusSoFastus.

**Nim+ Volume IV** — the community magic-item zine this module adapts for the Nim+ Items pack (submissions September 2025, published November 2025). Curated and edited by **Emil Andersen (Santuric)**, with item content by:

ApexDM · Can Opener · CheschireCat · DanDraco · Floppy · GrippaNL · Khan Wick · Malikua · Maliloki · Rune Champzzz · SanityWithIn · Santuric · Squeekie · Tauntje · The Adonis · The Pebble · TheMechMuffin · Uruzrune

Proofreaders: DanDraco · Floppy · Raford · Rasczak76 · Rockergage · SanityWithIn · The Pebble · TheMechMuffin. Art and assets by Alderdoodle, RossyDoesDrawings, DanDraco, Lewis Houlston, and Chthonic Duck (the zine's art is not reproduced by this module; all 220 items ship with original AI-generated icons in the module's house style).

This Foundry VTT module is a fan adaptation. Any errors in transcription or wiring are mine, not theirs. If you enjoy this content, please support the original authors at <https://santuric.itch.io>.

## Licensing

> Nim+ Package is an independent product published under the Nimble 3rd Party Creator License and is not affiliated with Nimble Co. Nimble © 2025 Nimble Co.

The reproduced Nim+ Volume I, Volume III, and Volume IV rules content is licensed by Santuric and contributors under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/) (CC-BY 4.0).

The code in this repository (build scripts, runtime helpers, packaging tooling) is released under the MIT License — see [LICENSE](LICENSE).

For the full Nimble 3rd Party Creator License terms, see <https://nimblerpg.com/creators>.
