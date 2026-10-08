# The village's models

The Journal's village view (ADR 0116, `docs/design/village.md`) draws from the files beside
this note. They are imported through Vite, so each is served from this origin under a hashed,
immutable name. Nothing is fetched from anyone else to draw the village.

## Source

All three packs are by Kay Lousberg, [kaylousberg.com](https://www.kaylousberg.com). Each was
taken in its free tier from itch.io:

- [KayKit Adventurers](https://kaylousberg.itch.io/kaykit-adventurers), version 2.0 FREE: the
  six characters Knight, Barbarian, Mage, Ranger, Rogue and Rogue_Hooded. The hooded rogue is
  painted from the rogue's atlas, `rogue_texture.png`, which its file embeds; the pack has no
  atlas of its own for it.
- [KayKit Character Animations](https://kaylousberg.itch.io/kaykit-character-animations),
  version 1.1: twelve clips for the medium rig.
  - `Idle_A`, `Interact`, `PickUp` and `Use_Item` from `Rig_Medium_General`.
  - `Walking_A` from `Rig_Medium_MovementBasic`.
  - `Sit_Floor_Idle` and `Waving` from `Rig_Medium_Simulation`.
  - `Hammering`, `Holding_A`, `Sawing` and `Working_B` from `Rig_Medium_Tools`.
  - `Ranged_Magic_Spellcasting` from `Rig_Medium_CombatRanged`.
- [KayKit Medieval Hexagon Pack](https://kaylousberg.itch.io/kaykit-medieval-hexagon), version
  1.0 FREE: the tiles, buildings, props, trees and water plants named in
  `scripts/village/assets.ts`.

## Licence

CC0 1.0 Universal. The pack's own licence text is `LICENSE.txt`, copied from the Adventurers
pack; the other two packs carry the same licence. Attribution is not required, and is given
here anyway.

## Derivation

`task build:village-assets KAYKIT_DIR=<the unzipped packs>` runs `scripts/village/assets.ts`.
The packs themselves are not in the repository. The script makes four changes:

- **Paint.** The textures are dropped. Each vertex's UV is replaced by `_CELL`, the atlas cell it
  was painted from, and `_SHADE`, how far down that cell's gradient. `atlas.json` records the
  colours at each cell's two ends, plus which cells are a building's team colour and which are
  water. The browser paints every vertex along one of the design system's tonal ramps
  (`lib/village/palette.ts`), so no colour from the packs is shown.
- **Variants.** Buildings are taken in their blue variant only. The red variant is read only to
  tell which cells are the team colour.
- **Motion.** Each clip is re-keyed at ten frames a second with STEP interpolation. That is the
  village's stop-motion.
- **Bytes.** Every file is meshopt-compressed (`EXT_meshopt_compression`). `three` ships the
  decoder.

Bundled outputs:

- `set.glb`: every set piece, as top-level nodes named by the layout's names.
- `folk.glb`: the six characters, as top-level nodes named by KayKit's names.
- `clips.glb`: the twelve clips on the medium rig.
