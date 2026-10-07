/**
 * What the village shows for one customer's runs: who is out, what each is doing, and what
 * the last runs left behind (`docs/design/village.md`, ADR 0115).
 *
 * NOTHING MOVES WITHOUT A RUN BEHIND IT. Every character's `doing` is derived from a run's
 * status, its events or its steps, and a character with no run is `resting`, which claims
 * nothing. A courier walking a road with no ingest behind it would be a wrong value nobody can
 * see, which is rule 2 broken in a picture.
 *
 * This is a STATE, not a story: the village polls, so each answer says where everyone should be
 * now, and the runtime walks them there. That is also why reduced motion needs nothing from
 * here: the runtime puts everyone straight where this says they are.
 *
 * Counts never leave this module as counts. The vault's pile and the workshop's pieces are
 * gauges, a few steps on a log scale (ADR 0032); the figures stay in the DOM's words.
 */

import type { Connection, RunDetail, RunEventView, RunView } from "@/api/types.ts";
import { ROAD_SLOTS } from "@/lib/village/roads.ts";

export type Role = "courier" | "keeper" | "scribe" | "artisan" | "inspector" | "carter";

export type Doing =
  /** At home. No run, or nothing for this character in the runs there are. */
  | "resting"
  /** Sitting by the gate: the run is waiting for a worker or for tomorrow's read budget. */
  | "waiting"
  /** Walking a source's road and back, carrying crates to the vault. */
  | "fetching"
  /** Finding the road barred: the run met a list its grant does not cover. */
  | "barred"
  /** At the vault door, laying what the couriers bring. */
  | "sealing"
  /** At the archive desk, reading documents. */
  | "reading"
  /** At the workshop bench. */
  | "building"
  /** Checking the bench after a build with tests. */
  | "inspecting"
  /** At the reading room, handing the copies to the build the ingest started. */
  | "handing"
  /** Pushing a handcart up the lake-API road. */
  | "delivering"
  /** Stopped where the work was, under an errata slip, until the next run of the same work. */
  | "failed";

export interface Actor {
  readonly key: string;
  readonly role: Role;
  readonly doing: Doing;
  /** The run behind what the character is doing; `null` while resting. */
  readonly runId: string | null;
  /** The road a courier keeps, by slot. */
  readonly slot: number | null;
  /** The source a courier or a carter works for. */
  readonly source: string | null;
  /** Whether an errata slip hangs over the character. Only a failure or a failed test. */
  readonly slip: boolean;
}

export interface Road {
  readonly source: string;
  readonly slot: number;
  /** The grant has lapsed: the road is barred and the barrier wears the lapsed mark. */
  readonly lapsed: boolean;
}

export interface VillageScene {
  readonly roads: readonly Road[];
  readonly actors: readonly Actor[];
  readonly bellRinging: boolean;
  /** How high the vault's pile stands, 0 to {@link MAX_LEVEL}: a gauge, never a count. */
  readonly vaultLevel: number;
  /** One crate set aside, with its slip, per source whose last run refused a record. */
  readonly setAside: number;
  /** How many finished pieces stand by the workshop, 0 to {@link MAX_LEVEL}. */
  readonly workshopLevel: number;
}

export interface VillageInput {
  readonly now: Date;
  /** The newest runs, newest first, as `runs.list` answers. */
  readonly runs: readonly RunView[];
  /** What each RUNNING run has said so far, by run id, as `runs.events` answers. */
  readonly events: ReadonlyMap<string, readonly RunEventView[]>;
  /** The newest closed transform or build in full, for its steps; `null` if there is none. */
  readonly lastBuild: RunDetail | null;
  readonly connections: readonly Pick<Connection, "source" | "status">[];
}

export const MAX_LEVEL = 5;
/** How long after a scheduled run opens the bell is still ringing for it. */
const RING_MS = 8000;
/** Set-aside crates beyond this many would bury the vault's step; the words say how many. */
const MOST_SET_ASIDE = 4;
const MOST_CARTERS = 2;

const WAITING: ReadonlySet<string> = new Set([
  "run_waiting",
  "whole_read_waiting",
  "whole_read_paused",
]);
const NOT_GRANTED = "entity_not_granted";
const WORK_KINDS: Readonly<Record<"scribe" | "artisan", readonly RunView["kind"][]>> = {
  scribe: ["extract", "semantic", "semantic-init"],
  artisan: ["transform", "build"],
};

/** A pile's height for a number of things: one step per power of ten, so it is never read as one. */
function level(count: number): number {
  return count <= 0 ? 0 : Math.min(MAX_LEVEL, 1 + Math.floor(Math.log10(count)));
}

/** The road each live connection keeps, in a stable order; a sixth source shares the last road. */
function roadsOf(connections: VillageInput["connections"]): Road[] {
  return connections
    .filter((connection) => connection.status !== "disconnected")
    .map((connection) => connection.source)
    .sort()
    .map((source, at) => ({
      source,
      slot: Math.min(at, ROAD_SLOTS - 1),
      lapsed: connections.some((c) => c.source === source && c.status === "needs_reconnect"),
    }));
}

/**
 * What an ingest still running is doing now, from the last thing it said that changes what
 * a courier would be doing. Nothing said yet is a run that has just set out.
 */
function ingestDoing(events: readonly RunEventView[]): "waiting" | "barred" | "fetching" {
  const said = [...events]
    .sort((a, b) => a.at.localeCompare(b.at))
    .filter((event) => event.event !== "run_closed");
  const last = said.at(-1);
  if (last !== undefined && WAITING.has(last.event)) {
    return "waiting";
  }
  if (last?.event === NOT_GRANTED) {
    return "barred";
  }
  return "fetching";
}

function courier(road: Road, input: VillageInput): Actor {
  const base = {
    key: `courier:${road.source}`,
    role: "courier" as const,
    slot: road.slot,
    source: road.source,
  };
  const latest = input.runs.find((run) => run.kind === "ingest" && run.source === road.source);
  if (latest === undefined) {
    return { ...base, doing: "resting", runId: null, slip: false };
  }
  if (latest.status === "running") {
    const doing = ingestDoing(input.events.get(latest.id) ?? []);
    return { ...base, doing, runId: latest.id, slip: false };
  }
  if (latest.status === "failed") {
    return { ...base, doing: "failed", runId: latest.id, slip: true };
  }
  const child = input.runs.find((run) => run.parentRunId === latest.id && run.status === "running");
  if (child !== undefined) {
    return { ...base, doing: "handing", runId: latest.id, slip: false };
  }
  return { ...base, doing: "resting", runId: null, slip: false };
}

/** The scribe and the artisan: at work while their kind of run runs, slipped if it failed. */
function worker(role: "scribe" | "artisan", input: VillageInput): Actor {
  const busy: Doing = role === "scribe" ? "reading" : "building";
  const latest = input.runs.find((run) => WORK_KINDS[role].includes(run.kind));
  const base = { key: role, role, slot: null, source: null };
  if (latest?.status === "running") {
    return { ...base, doing: busy, runId: latest.id, slip: false };
  }
  if (latest?.status === "failed") {
    return { ...base, doing: "failed", runId: latest.id, slip: true };
  }
  return { ...base, doing: "resting", runId: null, slip: false };
}

/**
 * The inspector checks the last build's bench once it has closed with tests, and slips it if a
 * test failed. While a build runs there is nothing to check yet: dbt reports its tests when it
 * finishes, not as it goes.
 */
function inspector(input: VillageInput): Actor {
  const base = { key: "inspector", role: "inspector" as const, slot: null, source: null };
  const building = input.runs.some(
    (run) => WORK_KINDS.artisan.includes(run.kind) && run.status === "running",
  );
  const build = input.lastBuild;
  if (building || build === null || !build.steps.some((step) => step.kind === "test")) {
    return { ...base, doing: "resting", runId: null, slip: false };
  }
  return {
    ...base,
    doing: "inspecting",
    runId: build.id,
    slip: (build.testsFailed ?? 0) > 0,
  };
}

/** One carter per lake-API run still landing, and one stopped under a slip if the last failed. */
function carters(input: VillageInput): Actor[] {
  const api = input.runs.filter((run) => run.kind === "lake-api");
  const running = api.filter((run) => run.status === "running").slice(0, MOST_CARTERS);
  const base = { role: "carter" as const, slot: null };
  if (running.length > 0) {
    return running.map((run) => ({
      ...base,
      source: run.source,
      key: `carter:${run.id}`,
      doing: "delivering",
      runId: run.id,
      slip: false,
    }));
  }
  const [latest] = api;
  return latest?.status === "failed"
    ? [
        {
          ...base,
          source: latest.source,
          key: `carter:${latest.id}`,
          doing: "failed",
          runId: latest.id,
          slip: true,
        },
      ]
    : [];
}

/** The newest closed ingest of each source: what the vault keeps from it. */
function lastClosedIngests(runs: readonly RunView[]): RunView[] {
  const seen = new Set<string>();
  const closed: RunView[] = [];
  for (const run of runs) {
    if (run.kind !== "ingest" || run.status === "running" || run.source === null) {
      continue;
    }
    if (!seen.has(run.source)) {
      seen.add(run.source);
      closed.push(run);
    }
  }
  return closed;
}

export function deriveVillage(input: VillageInput): VillageScene {
  const roads = roadsOf(input.connections);
  const couriers = roads.map((road) => courier(road, input));
  const carts = carters(input);
  // The keeper lays what the couriers and carters bring, so the run behind the keeper is
  // the first of theirs: there is no run of the keeper's own.
  const bringing = [...couriers, ...carts].find(
    (actor) => actor.doing === "fetching" || actor.doing === "delivering",
  );
  const keeper: Actor = {
    key: "keeper",
    role: "keeper",
    doing: bringing === undefined ? "resting" : "sealing",
    runId: bringing?.runId ?? null,
    slot: null,
    source: null,
    slip: false,
  };
  const now = input.now.getTime();
  const closed = lastClosedIngests(input.runs);
  const landed = closed.reduce((sum, run) => sum + (run.counts?.landed ?? 0), 0);
  const refusing = closed.filter((run) => (run.counts?.refused ?? 0) > 0).length;
  const built = (input.lastBuild?.steps ?? []).filter(
    (step) => step.kind === "model" && step.status === "success",
  ).length;
  return {
    roads,
    actors: [
      ...couriers,
      keeper,
      worker("scribe", input),
      worker("artisan", input),
      inspector(input),
      ...carts,
    ],
    bellRinging: input.runs.some((run) => {
      const opened = Date.parse(run.startedAt);
      return run.trigger === "schedule" && opened <= now && now - opened < RING_MS;
    }),
    vaultLevel: level(landed),
    setAside: Math.min(MOST_SET_ASIDE, refusing),
    workshopLevel: level(built),
  };
}
