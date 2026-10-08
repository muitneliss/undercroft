/**
 * The village's made things, the ones KayKit has no model for: the roads, the errata slip, the
 * bell, the copyist's lectern, and the props a run leaves behind (the vault's pile, the crates
 * set aside, the finished pieces, a lapsed road's barrier).
 *
 * The slip is the page's own errata slip in miniature: Slip ground, Vermilion rules top and
 * bottom, and lines standing for the sentence it would carry. No word: the canvas draws none.
 */

import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  type Object3D,
  PlaneGeometry,
  Vector2,
} from "three";

import { BELL, type Point, SET_ASIDE, VAULT_STACK, WORKSHOP_PIECES } from "@/lib/village/layout.ts";
import type { Painter } from "@/lib/village/paint.ts";
import { mix } from "@/lib/village/palette.ts";
import { ribbon } from "@/lib/village/ribbon.ts";
import { barrierAt } from "@/lib/village/roads.ts";
import type { VillageScene } from "@/lib/village/script.ts";

const ROAD_WIDTH = 0.55;
const ROAD_RIM = 0.12;
/**
 * How high a road lies over the board: clear of the ink outline drawn round every tile, which
 * covers anything flatter than this from the camera's angle, and still flat to the eye.
 */
const ROAD_LEVEL = 0.07;
const PILE_SPACING = 0.32;
const CRATE_SCALE = 2.4;
/** A bell's profile, turned about its axis: lip, waist, shoulder, crown. */
const BELL_PROFILE: readonly (readonly [number, number])[] = [
  [0.02, 0],
  [0.3, 0],
  [0.28, 0.06],
  [0.2, 0.2],
  [0.17, 0.4],
  [0.1, 0.5],
  [0.02, 0.52],
];

export function slipTexture(painter: Painter): CanvasTexture {
  const { tokens } = painter;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 44;
  const context = canvas.getContext("2d");
  if (context !== null) {
    context.fillStyle = tokens.slip;
    context.fillRect(0, 0, 64, 44);
    context.fillStyle = tokens.errata;
    context.fillRect(0, 2, 64, 5);
    context.fillRect(0, 37, 64, 5);
    context.fillStyle = mix(tokens.slip, tokens.errata, 0.5);
    for (let line = 0; line < 3; line += 1) {
      context.fillRect(8, 14 + line * 7, line === 2 ? 30 : 48, 2);
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  return texture;
}

/**
 * What makes errata slips on their posts. A slip's card is named, so a figure can tip it in. The
 * parts are made once and shared: the props are rebuilt on every poll, and a slip that brought
 * its own geometry each time would leave a little behind each time.
 */
export function slipMaker(painter: Painter, texture: CanvasTexture): () => Object3D {
  const postGeometry = new CylinderGeometry(0.02, 0.02, 0.5, 6);
  const postMaterial = painter.flat(painter.tokens.ink2);
  const cardGeometry = new PlaneGeometry(0.5, 0.34);
  const cardMaterial = new MeshBasicMaterial({ map: texture, side: DoubleSide });
  return (): Object3D => {
    const holder = new Group();
    const post = new Mesh(postGeometry, postMaterial);
    post.position.y = 0.25;
    const card = new Mesh(cardGeometry, cardMaterial);
    card.position.y = 0.62;
    card.name = "card";
    holder.add(post, card);
    return holder;
  };
}

/**
 * A road along a line: a Page band over a slightly wider rim, each one strip (`ribbon.ts`), flat
 * on the board and catching the shadows that fall across it.
 */
export function roadOf(painter: Painter, line: readonly Point[]): Group {
  const { tokens } = painter;
  const road = new Group();
  const rim = new Mesh(
    ribbon(line, ROAD_WIDTH + ROAD_RIM, ROAD_LEVEL),
    painter.flat(mix(tokens.bone, tokens.ink, 0.3), false),
  );
  const band = new Mesh(
    ribbon(line, ROAD_WIDTH, ROAD_LEVEL + 0.02),
    painter.flat(tokens.page, false),
  );
  for (const strip of [rim, band]) {
    strip.receiveShadow = true;
    road.add(strip);
  }
  return road;
}

/** A bell from a turned profile, hung in a frame of two posts and a beam. Its swing is named. */
export function makeBell(painter: Painter): Object3D {
  const frame = new Group();
  const wood = painter.flat(painter.tokens.ink2);
  for (const side of [-0.45, 0.45]) {
    const post = new Mesh(new BoxGeometry(0.08, 1.3, 0.08), wood);
    post.position.set(side, 0.65, 0);
    frame.add(post);
  }
  const beam = new Mesh(new BoxGeometry(1.06, 0.08, 0.1), wood);
  beam.position.y = 1.3;
  const bell = new Mesh(
    new LatheGeometry(
      BELL_PROFILE.map(([x, y]) => new Vector2(x, y)),
      12,
    ),
    painter.flat(painter.tokens.bone),
  );
  bell.position.y = -0.55;
  const swing = new Group();
  swing.name = "swing";
  swing.position.y = 1.26;
  swing.add(bell);
  frame.add(beam, swing);
  frame.position.set(BELL.x, 0, BELL.z);
  return frame;
}

/** The lectern's post, to the foot of its board: a figure stands about 0.9 tall. */
const LECTERN_HEIGHT = 0.52;
/** How far the board leans back, its low edge toward the reader. */
const LECTERN_LEAN = 0.5;
/** One page of the open book: across, thick, and up the board. */
const PAGE: readonly [number, number, number] = [0.17, 0.012, 0.22];
/** How far a page stands proud of the board, and the leaf proud of its page, so neither flickers. */
const PAGE_LIFT = 0.006;

/**
 * A lectern with an open book on its slanted board, where the copyist copies the text out of a
 * document. The board faces local +Z, its reader's side. The book is two pages of Page either side
 * of the spine; the right one is a leaf hinged at the spine, a group named `leaf` that turns about
 * the spine (its Z axis) so `works.ts` can turn it over. The timber is the bell's.
 */
export function makeLectern(painter: Painter): Object3D {
  const { tokens } = painter;
  const wood = painter.flat(tokens.ink2);
  const paper = painter.flat(tokens.page);
  const [across, thick, up] = PAGE;
  const foot = new Mesh(new BoxGeometry(0.3, 0.04, 0.24), wood);
  foot.position.y = 0.02;
  const post = new Mesh(new BoxGeometry(0.06, LECTERN_HEIGHT, 0.06), wood);
  post.position.y = LECTERN_HEIGHT / 2;
  const board = new Mesh(new BoxGeometry(across * 2 + 0.06, 0.03, up + 0.06), wood);
  const pageGeometry = new BoxGeometry(across, thick, up);
  const page = new Mesh(pageGeometry, paper);
  page.position.set(-across / 2, 0.015 + PAGE_LIFT + thick / 2, 0);
  const sheet = new Mesh(pageGeometry, paper);
  sheet.position.x = across / 2;
  const leaf = new Group();
  leaf.name = "leaf";
  leaf.position.y = 0.015 + PAGE_LIFT * 2 + thick * 1.5;
  leaf.add(sheet);
  const top = new Group();
  top.position.y = LECTERN_HEIGHT;
  top.rotation.x = LECTERN_LEAN;
  top.add(board, page, leaf);
  const lectern = new Group();
  lectern.add(foot, post, top);
  return lectern;
}

export interface PropMakers {
  readonly piece: (name: string) => Object3D;
  readonly slip: () => Object3D;
  /** A source's road by slot; the same object each time it is asked for. */
  readonly sourceRoad: (slot: number) => Object3D;
}

function placed(made: Object3D, at: Point, y: number, scale: number): Object3D {
  made.position.set(at.x, y, at.z);
  made.scale.setScalar(scale);
  return made;
}

/**
 * What the runs left behind, rebuilt from the scene: the vault's pile, one crate set aside per
 * source that refused, the workshop's finished pieces, and a barrier across each lapsed road.
 * All of them gauges or marks, never counts (`script.ts`).
 */
export function placeProps(group: Group, make: PropMakers, scene: VillageScene): void {
  group.clear();
  for (const slot of new Set(scene.roads.map((road) => road.slot))) {
    group.add(make.sourceRoad(slot));
  }
  for (let at = 0; at < scene.vaultLevel; at += 1) {
    const spot = { x: VAULT_STACK.x + (at % 3) * PILE_SPACING, z: VAULT_STACK.z };
    group.add(placed(make.piece("crate"), spot, Math.floor(at / 3) * 0.34, CRATE_SCALE));
  }
  for (let at = 0; at < scene.setAside; at += 1) {
    const spot = { x: SET_ASIDE.x - at * PILE_SPACING * 1.4, z: SET_ASIDE.z };
    group.add(placed(make.piece("crate"), spot, 0, CRATE_SCALE));
    group.add(placed(make.slip(), { x: spot.x, z: spot.z + 0.2 }, 0.1, 0.7));
  }
  for (let at = 0; at < scene.workshopLevel; at += 1) {
    const spot = { x: WORKSHOP_PIECES.x + at * PILE_SPACING * 1.3, z: WORKSHOP_PIECES.z };
    group.add(placed(make.piece("crate_open"), spot, 0, 2));
  }
  for (const road of scene.roads.filter((candidate) => candidate.lapsed)) {
    const at = barrierAt(road.slot);
    const fence = placed(make.piece("fence"), at, 0, 1.5);
    fence.rotation.y = Math.PI / 2;
    group.add(fence, placed(make.slip(), { x: at.x + 0.3, z: at.z + 0.6 }, 0, 1));
  }
}
