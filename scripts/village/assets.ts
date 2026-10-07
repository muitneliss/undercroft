/**
 * The village's models (ADR 0115): a subset of three KayKit packs (CC0), reduced to the shapes and
 * the motion the Journal's village draws, and written into `apps/ui/src/assets/village/`.
 *
 * WHY THE PACKS ARE NOT IN THE REPO. They are distributed only through itch.io, they are 60 MB
 * between them, and the village needs about a twentieth of that. The script reads the unzipped
 * packs from a directory outside the repository (`KAYKIT_DIR`), and only its output is committed,
 * beside the pack's own licence and `PROVENANCE.md`, which says what was taken and changed.
 *
 * WHAT IT CHANGES, and why:
 *
 *   textures  dropped. KayKit paints every model from one gradient atlas per pack. The village
 *             never shows those colours: it repaints each atlas cell with a token from
 *             `index.css` at run time (`lib/village/palette.ts`), so the tokens keep one owner
 *             and a token changed there changes the village. What survives is which cell each
 *             vertex was painted from (`_CELL`) and how far down that cell's gradient (`_SHADE`), in
 *             place of its UV, and `atlas.json`, which says what each cell looked like: the colours
 *             at its gradient's two ends, which cells are a building's team colour (the
 *             one a roof wears, so it can wear its division's hue) and which are water.
 *   buildings the blue variant only. The four variants differ only in the team cells, which the
 *             run time repaints anyway; the red variant is read just to find those cells.
 *   motion    nine clips out of 133, sampled at the village's ten frames a second and held
 *             between them (STEP). That is the stop-motion itself, decided once here rather than
 *             at every frame, and it is most of what the clips weigh.
 *   bytes     meshopt-compressed (EXT_meshopt_compression). `three` ships the decoder with its
 *             WebAssembly inlined, so the browser fetches nothing more than the three files.
 *
 * It refuses to run without `KAYKIT_DIR` rather than guessing a path, and it writes nothing if
 * any file it names is missing: a village with a building silently left out is a picture that
 * is wrong in a way nobody would notice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { type Document, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptEncoder } from "meshoptimizer";

import {
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  bundle,
  cellGradients,
  cellsUsed,
  holdOnFrames,
  keepClips,
} from "./gltf.ts";

const HEXAGON = "KayKit_Medieval_Hexagon_Pack_1.0_FREE";
const ADVENTURERS = "KayKit_Adventurers_2.0_FREE";
const ANIMATIONS = "KayKit_Character_Animations_1.1";

/** The set: every piece the layout places, by the name the run time asks for. */
const SET = {
  hex_grass: "tiles/base/hex_grass.gltf",
  hex_water: "tiles/base/hex_water.gltf",
  hall: "buildings/blue/building_church_blue.gltf",
  gate_tower: "buildings/blue/building_tower_A_blue.gltf",
  gate: "buildings/neutral/wall_straight_gate.gltf",
  wall: "buildings/neutral/wall_straight.gltf",
  vault: "buildings/blue/building_mine_blue.gltf",
  reading_room: "buildings/blue/building_home_B_blue.gltf",
  archive: "buildings/blue/building_tower_B_blue.gltf",
  workshop: "buildings/blue/building_blacksmith_blue.gltf",
  press: "buildings/blue/building_market_blue.gltf",
  house: "buildings/blue/building_home_A_blue.gltf",
  well: "buildings/blue/building_well_blue.gltf",
  sign: "decoration/props/flag_blue.gltf",
  crate: "decoration/props/crate_A_small.gltf",
  crate_open: "decoration/props/crate_open.gltf",
  barrel: "decoration/props/barrel.gltf",
  sack: "decoration/props/sack.gltf",
  pallet: "decoration/props/pallet.gltf",
  handcart: "decoration/props/wheelbarrow.gltf",
  fence: "buildings/neutral/fence_wood_straight.gltf",
  trees_large: "decoration/nature/trees_A_large.gltf",
  trees_medium: "decoration/nature/trees_A_medium.gltf",
  trees_small: "decoration/nature/trees_B_small.gltf",
  tree: "decoration/nature/tree_single_A.gltf",
  rock: "decoration/nature/rock_single_A.gltf",
  hill: "decoration/nature/hill_single_A.gltf",
  crate_big: "decoration/props/crate_A_big.gltf",
  crate_long: "decoration/props/crate_long_A.gltf",
  lumber: "decoration/props/resource_lumber.gltf",
  stone: "decoration/props/resource_stone.gltf",
  bucket: "decoration/props/bucket_water.gltf",
  tent: "decoration/props/tent.gltf",
  ladder: "decoration/props/ladder.gltf",
  grain: "buildings/neutral/building_grain.gltf",
  windmill: "buildings/blue/building_windmill_blue.gltf",
  fence_stone: "buildings/neutral/fence_stone_straight.gltf",
  trees_b_large: "decoration/nature/trees_B_large.gltf",
  trees_b_medium: "decoration/nature/trees_B_medium.gltf",
  tree_b: "decoration/nature/tree_single_B.gltf",
  rock_c: "decoration/nature/rock_single_C.gltf",
  rock_e: "decoration/nature/rock_single_E.gltf",
  mountain: "decoration/nature/mountain_A_grass_trees.gltf",
  hills_trees: "decoration/nature/hills_A_trees.gltf",
  lily_a: "decoration/nature/waterlily_A.gltf",
  lily_b: "decoration/nature/waterlily_B.gltf",
  reeds_a: "decoration/nature/waterplant_A.gltf",
  reeds_b: "decoration/nature/waterplant_B.gltf",
  watermill: "buildings/blue/building_watermill_blue.gltf",
  cloud_big: "decoration/nature/cloud_big.gltf",
  cloud_small: "decoration/nature/cloud_small.gltf",
  flag: "decoration/props/flag_blue.gltf",
  ruin: "buildings/neutral/building_destroyed.gltf",
  scaffold: "buildings/neutral/building_scaffolding.gltf",
  tower: "buildings/blue/building_tower_base_blue.gltf",
  barracks: "buildings/blue/building_barracks_blue.gltf",
  tavern: "buildings/blue/building_tavern_blue.gltf",
  lumbermill: "buildings/blue/building_lumbermill_blue.gltf",
} as const;

/** Read only to tell the team cells from the rest: they are what changes between variants. */
const TEAM_PROBES: readonly [string, string][] = [
  ["buildings/blue/building_church_blue.gltf", "buildings/red/building_church_red.gltf"],
  ["buildings/blue/building_market_blue.gltf", "buildings/red/building_market_red.gltf"],
  ["buildings/blue/building_mine_blue.gltf", "buildings/red/building_mine_red.gltf"],
];

/** The cast (`docs/design/village.md`), by the model each role wears. */
const FOLK = ["Ranger", "Rogue", "Mage", "Barbarian", "Knight"] as const;

/** The clips the cast moves through, by the rig file that holds each. */
const CLIPS: Record<string, readonly string[]> = {
  "Rig_Medium_General.glb": ["Idle_A", "Interact", "PickUp", "Use_Item"],
  "Rig_Medium_MovementBasic.glb": ["Walking_A"],
  "Rig_Medium_Simulation.glb": ["Sit_Floor_Idle", "Waving"],
  "Rig_Medium_Tools.glb": ["Hammering", "Working_A", "Holding_A"],
};

const root = process.env.KAYKIT_DIR ?? "";
if (root === "") {
  process.stderr.write(
    "KAYKIT_DIR is not set. Unzip the free KayKit Adventurers, Character Animations and\n" +
      "Medieval Hexagon packs into one directory and pass it: task build:village-assets KAYKIT_DIR=...\n",
  );
  process.exit(1);
}

const hexagonDir = join(root, "kaykit-medieval-hexagon", HEXAGON);
const adventurersDir = join(root, "kaykit-adventurers", ADVENTURERS);
const animationsDir = join(root, "kaykit-character-animations", ANIMATIONS);
const target = fileURLToPath(new URL("../../apps/ui/src/assets/village/", import.meta.url));

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

function need(path: string): string {
  if (!existsSync(path)) {
    process.stderr.write(`missing: ${path}\n`);
    process.exit(1);
  }
  return path;
}

function readHexagon(file: string): Promise<Document> {
  return io.read(need(join(hexagonDir, "Assets/gltf", file)));
}

/** The cells a building's team colour is painted from: those its blue variant uses and red does not. */
async function teamCells(): Promise<number[]> {
  const team = new Set<number>();
  for (const [blue, red] of TEAM_PROBES) {
    const redCells = cellsUsed(await readHexagon(red));
    for (const cell of cellsUsed(await readHexagon(blue))) {
      if (!redCells.has(cell)) {
        team.add(cell);
      }
    }
  }
  return [...team].sort((a, b) => a - b);
}

async function buildSet(): Promise<{ team: number[]; water: number[] }> {
  const docs: Record<string, Document> = {};
  for (const [name, file] of Object.entries(SET)) {
    docs[name] = await readHexagon(file);
  }
  const water = [...cellsUsed(await readHexagon(SET.hex_water))].sort((a, b) => a - b);
  const team = await teamCells();
  await io.write(join(target, "set.glb"), await bundle(docs, MeshoptEncoder));
  return { team, water };
}

async function buildFolk(): Promise<void> {
  const docs: Record<string, Document> = {};
  for (const name of FOLK) {
    docs[name] = await io.read(need(join(adventurersDir, "Characters/gltf", `${name}.glb`)));
  }
  await io.write(join(target, "folk.glb"), await bundle(docs, MeshoptEncoder));
}

/**
 * The clips alone. Each rig file carries a mannequin to show its motion on; the mannequin's
 * meshes go, its bones stay, because a clip's tracks are addressed by bone name and every
 * character in the cast is built on the same medium rig.
 */
async function buildClips(): Promise<void> {
  const docs: Record<string, Document> = {};
  for (const [file, keep] of Object.entries(CLIPS)) {
    const doc = await io.read(need(join(animationsDir, "Animations/gltf/Rig_Medium", file)));
    const lost = keepClips(doc, keep);
    if (lost.length > 0) {
      process.stderr.write(`missing clips in ${file}: ${lost.join(", ")}\n`);
      process.exit(1);
    }
    for (const node of doc.getRoot().listNodes()) {
      node.setMesh(null);
      node.setSkin(null);
    }
    for (const animation of doc.getRoot().listAnimations()) {
      holdOnFrames(doc, animation);
    }
    docs[file.replace(".glb", "")] = doc;
  }
  await io.write(join(target, "clips.glb"), await bundle(docs, MeshoptEncoder));
}

mkdirSync(target, { recursive: true });
const { team, water } = await buildSet();
await buildFolk();
await buildClips();

const atlas = {
  columns: ATLAS_COLUMNS,
  rows: ATLAS_ROWS,
  set: { ...cellGradients(need(join(hexagonDir, "Textures/hexagons_medieval.png"))), team, water },
  folk: Object.fromEntries(
    FOLK.map((name) => [
      name,
      cellGradients(need(join(adventurersDir, "Textures", `${name.toLowerCase()}_texture.png`))),
    ]),
  ),
};
writeFileSync(join(target, "atlas.json"), `${JSON.stringify(atlas)}\n`);
writeFileSync(join(target, "LICENSE.txt"), readFileSync(need(join(adventurersDir, "License.txt"))));
process.stdout.write(`wrote ${target}\n`);
