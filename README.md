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

Both classes are **official Nimble content**. Each ships with two official subclasses plus one homebrew submission, called out below.

- **Hexbinder** — full progression, afflictions, mystic marks.
  - *Coven of the Hex* (official)
  - *Coven of the Hunt* (official)
  - *Coven of the Cauldron* — **homebrew by DamianRM**
- **Artificer** — full progression, Eureka picks, Inventions, Gadgets.
  - *Forge of the Gadgeteer* (official)
  - *Forge of the Inventor* (official)
  - *Forge of the Mechanic* — **homebrew by Apex**

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

## Contributing

Building from source, the runtime helper API, JSON authoring conventions, the release pipeline, and other developer-facing internals live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

This module stands on the shoulders of two upstream projects.

**The Nimble system** — the underlying game engine, the Hexbinder and Artificer classes, and most of their subclasses, by **Nimble Co**. This module would not exist without it. © 2025 Nimble Co. See <https://nimblerpg.com>.

**Homebrew subclasses for the new classes** — *Coven of the Cauldron* by **DamianRM**, *Forge of the Mechanic* by **Apex**. Reproduced with thanks.

**Nim+ Volume III** — the community content supplement this module adapts for the additional core-class subclasses (submissions June 2025, published July 2025). Curated and edited by **Emil Andersen (Santuric)**, with rules content by:

AJ · Blue · Can Opener · Charles and Jeannine Archibald · DanDraco · Kazok the Goblin · Khan Wick · Nathan Warkentin (Trex) · Rockergage · SanityWithIn · Santuric · Squeekie · Victor Constantinescu (MaleficMist) · Vinícius Conrado

Proofreaders: AJ · Chas · DanDraco · MaleficMist · Methodia · Raford · SanityWithIn · The Pebble · Trex · TwinSteel · VedastusSoFastus.

This Foundry VTT module is a fan adaptation. Any errors in transcription or wiring are mine, not theirs. If you enjoy this content, please support the original authors at <https://santuric.itch.io>.

## Licensing

> Nim+ Package is an independent product published under the Nimble 3rd Party Creator License and is not affiliated with Nimble Co. Nimble © 2025 Nimble Co.

The reproduced Nim+ Volume III rules content is licensed by Santuric and contributors under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/) (CC-BY 4.0).

The code in this repository (build scripts, runtime helpers, packaging tooling) is released under the MIT License — see [LICENSE](LICENSE).

For the full Nimble 3rd Party Creator License terms, see <https://nimblerpg.com/creators>.
