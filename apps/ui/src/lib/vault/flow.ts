/**
 * How the data moves through the vault: sources send, the one gate admits, the lake lays or
 * echoes by content, the table reads copies and refuses some, the models shape, the reports
 * grow. Each leg is a curve with a duration; arriving at the end of one decides the next.
 *
 * The reasons the film shows each of these -- and why the lake decides a duplicate by its
 * hash and never by chance -- are in `model.ts`.
 */

import {
  BAR_FLOOR,
  type Block,
  barPoint,
  hexHash,
  LAYOUT,
  type Phase,
  type Point,
  positionOf,
  progress,
  SOURCE_COUNT,
  slotPoint,
  slotRow,
  type Traveller,
  type TravellerKind,
  type Vault,
  visibleBlocks,
} from "@/lib/vault/model.ts";

const GATE_INTERVAL = 0.17;
const PASS_TIME = 0.15;
const EMIT_MIN = 0.9;
const EMIT_SPREAD = 0.8;
const PROJECT_INTERVAL = 0.4;
const DUPLICATE_SHARE = 0.2;
const REFUSED_SHARE = 0.14;
const REFUSED_KEPT = 12;
const SHAPE_EVERY = 3;
const BAR_GAIN = 0.17;
const BAR_DECAY = 0.028;
const SINK_FOLLOW = 5;

interface Leg {
  readonly phase: Phase;
  readonly to: Point;
  readonly duration: number;
  readonly via?: Point;
}

/** Starts a traveller on its next leg, from wherever it is now. */
function travel(vault: Vault, traveller: Traveller, leg: Leg): void {
  const here = positionOf(vault, traveller);
  traveller.phase = leg.phase;
  traveller.from = here;
  traveller.to = leg.to;
  traveller.via = leg.via ?? { u: (here.u + leg.to.u) / 2, v: (here.v + leg.to.v) / 2 };
  traveller.start = vault.time;
  traveller.duration = leg.duration;
}

interface Launch {
  readonly kind: TravellerKind;
  readonly source: number;
  readonly hash: string;
  readonly from: Point;
}

function launch(vault: Vault, spec: Launch): Traveller {
  const traveller: Traveller = {
    ...spec,
    id: vault.next.id,
    phase: "approach",
    via: spec.from,
    to: spec.from,
    start: vault.time,
    duration: 0,
    slot: -1,
    lane: -1,
    original: null,
  };
  vault.next.id += 1;
  vault.travellers.push(traveller);
  return traveller;
}

/**
 * A source sends one record toward the gate. Now and then it is content the lake already
 * holds -- the same message fetched twice -- which is what makes the lake's dedupe visible.
 */
export function emit(vault: Vault, source: number): void {
  const v = LAYOUT.sourceV(source) + (vault.random() - 0.5) * 0.05;
  const known = visibleBlocks(vault).filter((block) => block.source === source);
  const again =
    known.length > 0 && vault.random() < DUPLICATE_SHARE
      ? known[Math.floor(vault.random() * known.length)]
      : undefined;
  const hash = again?.hash ?? hexHash(vault.random);
  const record = launch(vault, { kind: "record", source, hash, from: { u: LAYOUT.emitterU, v } });
  travel(vault, record, {
    phase: "approach",
    to: { u: LAYOUT.gate.u - LAYOUT.gateMouth, v: LAYOUT.gate.v },
    duration: 1.1 + vault.random() * 0.5,
    via: { u: 0.17, v: v * 0.6 + LAYOUT.gate.v * 0.4 },
  });
}

/** Where the lake lays its next new block, sinking a row when the visible lake is full. */
function takeSlot(vault: Vault): number {
  const { slot } = vault.next;
  vault.next.slot += 1;
  if (slotRow(slot) - vault.sunk >= LAYOUT.lake.rows) {
    vault.sunk += 1;
  }
  return slot;
}

/**
 * Past the gate the lake looks the content up: a record it already holds lands on its
 * original, anything else lays a new block. The decision is by hash, never by chance.
 */
function settle(vault: Vault, record: Traveller): void {
  const original = vault.blocks.find((block) => block.hash === record.hash) ?? null;
  record.original = original;
  record.slot = original === null ? takeSlot(vault) : original.slot;
  const here = positionOf(vault, record);
  const target = slotPoint(vault, record.slot);
  travel(vault, record, {
    phase: "settle",
    to: target,
    duration: 0.55 + vault.random() * 0.25,
    via: { u: here.u + 0.03, v: (here.v + target.v) / 2 },
  });
}

function land(vault: Vault, record: Traveller): void {
  const { original } = record;
  if (original !== null) {
    // Still counted when the original has sunk from sight: the lake holds it either way.
    original.echoes += 1;
    original.echoAt = vault.time;
    return;
  }
  const block: Block = {
    id: record.id,
    hash: record.hash,
    source: record.source,
    slot: record.slot,
    laidAt: vault.time,
    echoes: 0,
    echoAt: Number.NEGATIVE_INFINITY,
    readAt: Number.NEGATIVE_INFINITY,
  };
  vault.blocks.push(block);
}

/** The table reads a copy out of a visible block. The block itself does not move. */
function project(vault: Vault): void {
  const visible = visibleBlocks(vault);
  const block = visible[Math.floor(vault.random() * visible.length)];
  if (block === undefined) {
    return;
  }
  block.readAt = vault.time;
  const from = slotPoint(vault, block.slot);
  const { source, hash } = block;
  const copy = launch(vault, { kind: "projection", source, hash, from });
  travel(vault, copy, { phase: "table", to: { u: LAYOUT.tableU, v: from.v }, duration: 0.55 });
}

/** At the table's edge a copy is either refused -- and kept, struck -- or read into a model. */
function atTable(vault: Vault, copy: Traveller): void {
  if (vault.random() < REFUSED_SHARE) {
    const place = Math.min(vault.refused.length, REFUSED_KEPT - 1);
    const tray = { u: LAYOUT.tray.u + place * LAYOUT.tray.gap, v: LAYOUT.tray.v };
    travel(vault, copy, {
      phase: "drop",
      to: tray,
      duration: 0.5,
      via: { u: copy.to.u, v: tray.v - 0.1 },
    });
    return;
  }
  const lane = Math.floor(vault.random() * LAYOUT.laneV.length);
  const laneV = LAYOUT.laneV[lane] ?? LAYOUT.gate.v;
  copy.lane = lane;
  travel(vault, copy, {
    phase: "lane",
    to: { u: LAYOUT.laneOut, v: laneV },
    duration: 0.85,
    via: { u: LAYOUT.laneIn, v: laneV },
  });
}

/** A model makes one shaped row out of what reached its lane and sends it to a report. */
export function shape(vault: Vault, lane: number): void {
  vault.lanes[lane] = 0;
  const from = { u: LAYOUT.laneOut + 0.01, v: LAYOUT.laneV[lane] ?? LAYOUT.gate.v };
  const row = launch(vault, { kind: "shaped", source: lane, hash: hexHash(vault.random), from });
  const bar = Math.floor(vault.random() * LAYOUT.bars.count);
  const to = barPoint(vault, bar);
  row.lane = bar;
  travel(vault, row, {
    phase: "report",
    to,
    duration: 0.7,
    via: { u: (from.u + to.u) / 2, v: Math.min(from.v, to.v) },
  });
}

/** Arriving at the end of a leg decides the next one; false means the traveller is done. */
function arrive(vault: Vault, traveller: Traveller): boolean {
  switch (traveller.phase) {
    case "approach":
      traveller.phase = "queue";
      vault.queue.push(traveller);
      return true;
    case "pass":
      settle(vault, traveller);
      return true;
    case "table":
      atTable(vault, traveller);
      return true;
    case "settle":
      land(vault, traveller);
      return false;
    case "drop":
      vault.refused.push({ hash: traveller.hash, at: vault.time });
      if (vault.refused.length > REFUSED_KEPT) {
        vault.refused.shift();
      }
      return false;
    case "lane":
      vault.lanes[traveller.lane] = (vault.lanes[traveller.lane] ?? 0) + 1;
      if ((vault.lanes[traveller.lane] ?? 0) >= SHAPE_EVERY) {
        shape(vault, traveller.lane);
      }
      return false;
    case "report":
      vault.bars[traveller.lane] = Math.min(1, (vault.bars[traveller.lane] ?? 0) + BAR_GAIN);
      vault.shaped += 1;
      return false;
    default:
      return true;
  }
}

/** Each source sends on its own irregular clock. */
function emitDue(vault: Vault): void {
  for (let source = 0; source < SOURCE_COUNT; source += 1) {
    if (vault.time >= (vault.next.emit[source] ?? 0)) {
      emit(vault, source);
      vault.next.emit[source] = vault.time + EMIT_MIN + vault.random() * EMIT_SPREAD;
    }
  }
}

/** The gate admits the head of the queue, alone, and not again until the interval has run. */
function openGate(vault: Vault): void {
  const [head] = vault.queue;
  if (head === undefined || vault.time < vault.next.gate) {
    return;
  }
  vault.queue.shift();
  vault.gateAt = vault.time;
  vault.next.gate = vault.time + GATE_INTERVAL;
  travel(vault, head, {
    phase: "pass",
    to: { u: LAYOUT.gate.u + LAYOUT.gateMouth, v: LAYOUT.gate.v },
    duration: PASS_TIME,
  });
}

function moveTravellers(vault: Vault): void {
  // Arrivals can launch new travellers; those are picked up next frame.
  const current = vault.travellers.splice(0);
  const moving = current.filter(
    (traveller) =>
      traveller.phase === "queue" || progress(vault, traveller) < 1 || arrive(vault, traveller),
  );
  vault.travellers.unshift(...moving);
}

/** Drops blocks sunk well out of sight: the lake still holds them, the picture need not. */
function forgetSunk(vault: Vault): void {
  const deepest = (vault.sunk - 2) * LAYOUT.lake.cols;
  if ((vault.blocks[0]?.slot ?? deepest) < deepest) {
    vault.blocks = vault.blocks.filter((block) => block.slot >= deepest);
  }
}

/** One frame of the data path. */
export function flow(vault: Vault, dt: number): void {
  vault.sinkShown += (vault.sunk - vault.sinkShown) * (1 - Math.exp(-dt * SINK_FOLLOW));
  emitDue(vault);
  openGate(vault);
  if (vault.time >= vault.next.project) {
    project(vault);
    vault.next.project = vault.time + PROJECT_INTERVAL;
  }
  moveTravellers(vault);
  forgetSunk(vault);
  for (let bar = 0; bar < vault.bars.length; bar += 1) {
    vault.bars[bar] = Math.max(BAR_FLOOR, (vault.bars[bar] ?? 0) - BAR_DECAY * dt);
  }
}

/** A run from the reader's hand: two records from every source at once. */
export function runNow(vault: Vault): void {
  for (let source = 0; source < SOURCE_COUNT; source += 1) {
    vault.sourceFlares[source] = vault.time;
    emit(vault, source);
    emit(vault, source);
  }
}
