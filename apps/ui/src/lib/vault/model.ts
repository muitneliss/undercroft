/**
 * The public cover's vault: a small, deterministic film of the data path, and of the reader
 * walking through it. This file is its shape -- what exists and where it stands; `flow.ts`
 * moves the data and `reader.ts` moves the reader.
 *
 * WHAT IT DEPICTS IS THE PRODUCT'S OWN RULES, not a generic particle show, so a visitor who
 * watches for ten seconds has seen the three claims the landing page makes in words:
 *
 * - **One writer.** Every record, from every source, queues at one gate and passes it
 *   alone -- `phase === "pass"` is held by at most one traveller at any moment.
 * - **Raw is create-only and content-addressed.** A block is laid once and never rewritten;
 *   a record whose content the lake already holds lands on its original (`echoes`) instead of
 *   laying a copy. Old rows sink out of sight; they are not edited.
 * - **Never guess.** A projection the table refuses is kept in the tray, struck, rather than
 *   dropped.
 *
 * Positions are in path space: `u` runs along the path (0 = the sources, 1 = the reports) and
 * `v` across it (0 = the top of the band). The painter maps them to pixels; nothing here knows
 * about a canvas, which is what lets the rules above be tested in `bun test`.
 *
 * Everything mutates in place: this runs sixty times a second, and a fresh object graph per
 * frame would be garbage for nothing.
 */

/** The four columns of the data path, in the order the data travels. */
export const STAGES = ["sources", "raw", "models", "reports"] as const;
export type StageId = (typeof STAGES)[number];

/** The reader's path, in the order a customer meets it. */
export const STEPS = ["invite", "connect", "choose", "run", "model", "ask"] as const;
export type StepId = (typeof STEPS)[number];

/** The column each step happens in: the first three are all at the sources. */
export const STEP_STAGE: Record<StepId, StageId> = {
  invite: "sources",
  connect: "sources",
  choose: "sources",
  run: "raw",
  model: "models",
  ask: "reports",
};

/** Gmail, Google Drive, HubSpot, Xero. The names are the catalogue's; the model counts them. */
export const SOURCE_COUNT = 4;

export interface Point {
  u: number;
  v: number;
}

export type TravellerKind = "record" | "projection" | "shaped";

export type Phase = "approach" | "queue" | "pass" | "settle" | "table" | "drop" | "lane" | "report";

/** A block in the raw lake: laid once, read many times, never rewritten. */
export interface Block {
  readonly id: number;
  readonly hash: string;
  readonly source: number;
  readonly slot: number;
  readonly laidAt: number;
  echoes: number;
  echoAt: number;
  readAt: number;
}

/**
 * Something moving along the path. A record approaches the gate, queues, passes it and
 * settles into the lake; a projection is a COPY read out of a block toward the table; a shaped
 * row is what a model made of three projections, on its way to a report.
 */
export interface Traveller {
  readonly id: number;
  readonly kind: TravellerKind;
  readonly source: number;
  readonly hash: string;
  phase: Phase;
  from: Point;
  via: Point;
  to: Point;
  start: number;
  duration: number;
  /** Where a settling record lands, as a lake slot; the slot moves when the lake sinks. */
  slot: number;
  /** The model lane or report bar this traveller is bound for. */
  lane: number;
  /** The block already holding this record's content, when the lake had it. */
  original: Block | null;
}

export interface Refusal {
  readonly hash: string;
  readonly at: number;
}

export interface Reader {
  /** Where the reader stands on the path, 0..1. */
  u: number;
  signedIn: boolean;
  step: StepId | null;
}

export interface Vault {
  time: number;
  readonly travellers: Traveller[];
  blocks: Block[];
  readonly refused: Refusal[];
  readonly lanes: number[];
  readonly bars: number[];
  /** Rows of the lake that have sunk out of sight, and the same number smoothed for drawing. */
  sunk: number;
  sinkShown: number;
  shaped: number;
  readonly reader: Reader;
  /** The last time each step fired; minus infinity for never. */
  readonly flares: Record<StepId, number>;
  readonly sourceFlares: number[];
  gateAt: number;
  readonly next: {
    id: number;
    slot: number;
    gate: number;
    project: number;
    readonly emit: number[];
  };
  readonly queue: Traveller[];
  readonly random: () => number;
}

/** The geometry of the band, in path space. The painter reads it; it has no other owner. */
export const LAYOUT = {
  emitterU: 0.04,
  sourceV: (source: number): number => 0.2 + source * 0.2,
  gate: { u: 0.25, v: 0.5 },
  gateMouth: 0.018,
  queueGap: 0.011,
  lake: { u0: 0.3, u1: 0.46, v0: 0.12, v1: 0.84, cols: 6, rows: 8 },
  tableU: 0.52,
  tray: { u: 0.5, v: 0.95, gap: 0.013 },
  laneV: [0.3, 0.5, 0.7] as const,
  laneIn: 0.57,
  laneOut: 0.71,
  bars: { u0: 0.785, u1: 0.965, base: 0.84, height: 0.62, count: 6 },
} as const;

/** Where a new visitor starts: just before the invitation. */
export const WALK_START = -0.06;
export const BAR_FLOOR = 0.18;
const EMIT_FIRST = 0.9;
const MODULUS = 4_294_967_296;

/** Where each step sits on the path: six equal columns, a tick at each centre. */
export function stepU(step: StepId): number {
  return (STEPS.indexOf(step) + 0.5) / STEPS.length;
}

/** The step the reader has most recently reached at `u`, or null before the first. */
export function stepAt(u: number): StepId | null {
  let reached: StepId | null = null;
  for (const step of STEPS) {
    if (u >= stepU(step)) {
      reached = step;
    }
  }
  return reached;
}

/** The column of the data path under `u`, clamped to the page. */
export function stageAt(u: number): StageId {
  const index = Math.floor(u * STAGES.length);
  return STAGES[Math.min(STAGES.length - 1, Math.max(0, index))] ?? "sources";
}

/**
 * A linear congruential generator: the same film for the same seed. Numerical Recipes'
 * constants; every product stays below 2^53, so the arithmetic is exact in a double.
 */
function seeded(seed: number): () => number {
  let state = seed % MODULUS;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % MODULUS;
    return state / MODULUS;
  };
}

/** A content address, as the proof slip prints it: eight hex digits of a sha256. */
export function hexHash(random: () => number): string {
  return Math.floor(random() * MODULUS)
    .toString(16)
    .padStart(8, "0");
}

export function createVault(seed: number): Vault {
  const random = seeded(seed);
  const never = Number.NEGATIVE_INFINITY;
  return {
    time: 0,
    travellers: [],
    blocks: [],
    refused: [],
    lanes: LAYOUT.laneV.map(() => 0),
    bars: Array.from({ length: LAYOUT.bars.count }, () => BAR_FLOOR + random() * 0.3),
    sunk: 0,
    sinkShown: 0,
    shaped: 0,
    reader: { u: WALK_START, signedIn: false, step: null },
    flares: { invite: never, connect: never, choose: never, run: never, model: never, ask: never },
    sourceFlares: Array.from({ length: SOURCE_COUNT }, () => never),
    gateAt: never,
    next: {
      id: 1,
      slot: 0,
      gate: 0,
      project: 0.6,
      emit: Array.from({ length: SOURCE_COUNT }, () => random() * EMIT_FIRST),
    },
    queue: [],
    random,
  };
}

/** The lake row a slot belongs to, counted from the first row ever laid. */
export function slotRow(slot: number): number {
  return Math.floor(slot / LAYOUT.lake.cols);
}

/** The blocks still in sight: the rows above the ones that have sunk. */
export function visibleBlocks(vault: Vault): Block[] {
  return vault.blocks.filter((block) => slotRow(block.slot) >= vault.sunk);
}

/** The centre of a lake slot, allowing for the rows that have sunk. */
export function slotPoint(vault: Vault, slot: number): Point {
  const { lake } = LAYOUT;
  const col = slot % lake.cols;
  const row = slotRow(slot) - vault.sinkShown;
  const cellU = (lake.u1 - lake.u0) / lake.cols;
  const cellV = (lake.v1 - lake.v0) / lake.rows;
  return { u: lake.u0 + (col + 0.5) * cellU, v: lake.v1 - (row + 0.5) * cellV };
}

/** Where the reports' bar stands now: the top of its column. */
export function barPoint(vault: Vault, bar: number): Point {
  const { bars } = LAYOUT;
  const step = (bars.u1 - bars.u0) / bars.count;
  return {
    u: bars.u0 + (bar + 0.5) * step,
    v: bars.base - (vault.bars[bar] ?? 0) * bars.height,
  };
}

/** How far through its current leg a traveller is, 0..1. */
export function progress(vault: Vault, traveller: Traveller): number {
  if (traveller.duration <= 0) {
    return 1;
  }
  return Math.min(1, Math.max(0, (vault.time - traveller.start) / traveller.duration));
}

/** Where a traveller is now: a quadratic curve from `from` through `via` to `to`, eased out. */
export function positionOf(vault: Vault, traveller: Traveller): Point {
  if (traveller.phase === "queue") {
    const place = vault.queue.indexOf(traveller);
    return {
      u: LAYOUT.gate.u - LAYOUT.gateMouth - (place + 1) * LAYOUT.queueGap,
      v: LAYOUT.gate.v,
    };
  }
  const { from, via, phase, slot } = traveller;
  const to = phase === "settle" ? slotPoint(vault, slot) : traveller.to;
  // Ease out on every leg, so a thing arrives rather than stops.
  const t = 1 - (1 - progress(vault, traveller)) ** 3;
  const a = (1 - t) ** 2;
  const b = 2 * (1 - t) * t;
  const c = t ** 2;
  return { u: a * from.u + b * via.u + c * to.u, v: a * from.v + b * via.v + c * to.v };
}
