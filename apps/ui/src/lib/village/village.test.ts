/**
 * What the village promises (ADR 0115): nothing moves without a run behind it, a slip hangs only
 * over a failure, and a hue is worn only by a roof, never by a character.
 */

import { describe, expect, test as it } from "bun:test";

import type { RunEventView, RunView } from "@/api/types.ts";
import atlas from "@/assets/village/atlas.json" with { type: "json" };
import { cellColour, type Tokens } from "@/lib/village/palette.ts";
import { type Actor, deriveVillage, type VillageInput } from "@/lib/village/script.ts";
import { run, runDetail } from "@/test/fixtures.ts";

const NOW = new Date("2026-10-07T09:00:00Z");
const RUNNING = { status: "running", endedAt: null, counts: null } as const;

function village(over: Partial<VillageInput> = {}): ReturnType<typeof deriveVillage> {
  return deriveVillage({
    now: NOW,
    runs: [],
    events: new Map(),
    lastBuild: null,
    connections: [{ source: "hubspot", status: "connected" }],
    ...over,
  });
}

function actor(scene: ReturnType<typeof deriveVillage>, key: string): Actor | undefined {
  return scene.actors.find((candidate) => candidate.key === key);
}

function said(name: string, at = "2026-10-07T08:59:00Z"): RunEventView {
  return { at, level: "info", event: name, entity: "deals", detail: {}, live: false };
}

describe("a courier", () => {
  it("rests while no ingest of its source is running, whatever ran before", () => {
    const scene = village({ runs: [run({ id: "done", status: "ok" })] });

    expect(actor(scene, "courier:hubspot")).toMatchObject({ doing: "resting", runId: null });
  });

  it("goes out along its own road while its source's ingest runs", () => {
    const scene = village({ runs: [run({ id: "live", ...RUNNING })] });

    expect(actor(scene, "courier:hubspot")).toMatchObject({
      doing: "fetching",
      runId: "live",
      slot: 0,
      slip: false,
    });
  });

  it("sits by the gate while its run waits for a worker", () => {
    const scene = village({
      runs: [run({ id: "live", ...RUNNING })],
      events: new Map([
        ["live", [said("run_opened", "2026-10-07T08:58:00Z"), said("run_waiting")]],
      ]),
    });

    expect(actor(scene, "courier:hubspot")?.doing).toBe("waiting");
  });

  it("finds the road barred, without a slip, at a list its grant does not cover", () => {
    const scene = village({
      runs: [run({ id: "live", ...RUNNING })],
      events: new Map([["live", [said("entity_not_granted")]]]),
    });

    expect(actor(scene, "courier:hubspot")).toMatchObject({ doing: "barred", slip: false });
  });

  it("stands under a slip after a failed ingest, until a newer run of the source", () => {
    const failed = run({ id: "failed", status: "failed", startedAt: "2026-10-07T08:00:00Z" });
    const newer = run({ id: "newer", ...RUNNING, startedAt: "2026-10-07T08:50:00Z" });

    expect(actor(village({ runs: [failed] }), "courier:hubspot")).toMatchObject({
      doing: "failed",
      slip: true,
    });
    expect(actor(village({ runs: [newer, failed] }), "courier:hubspot")).toMatchObject({
      doing: "fetching",
      slip: false,
    });
  });

  it("hands its copies over while the build its ingest chained into runs", () => {
    const ingest = run({ id: "ingest", status: "ok" });
    const build = run({
      id: "build",
      kind: "transform",
      source: null,
      parentRunId: "ingest",
      ...RUNNING,
    });

    expect(actor(village({ runs: [build, ingest] }), "courier:hubspot")).toMatchObject({
      doing: "handing",
      runId: "ingest",
    });
  });
});

describe("the workshop", () => {
  const build: RunView = run({ id: "build", kind: "transform", source: null, ...RUNNING });

  it("has its artisan at the bench only while a build runs", () => {
    expect(actor(village({ runs: [build] }), "artisan")?.doing).toBe("building");
    expect(actor(village({ runs: [{ ...build, status: "ok" }] }), "artisan")?.doing).toBe(
      "resting",
    );
  });

  it("has the inspector slip the bench of a closed build whose test failed", () => {
    const closed = runDetail({
      id: "closed",
      kind: "transform",
      testsFailed: 1,
      steps: [
        {
          uniqueId: "test.not_null",
          kind: "test",
          name: "not_null",
          status: "fail",
          failures: 3,
          relation: null,
          message: null,
          executionMs: 12,
        },
      ],
    });

    expect(actor(village({ runs: [closed], lastBuild: closed }), "inspector")).toMatchObject({
      doing: "inspecting",
      slip: true,
    });
  });
});

describe("the village around them", () => {
  it("rings the bell for a scheduled run that has just opened, and not for one a person started", () => {
    const opened = { ...RUNNING, startedAt: "2026-10-07T08:59:57Z" };

    expect(village({ runs: [run({ ...opened, trigger: "schedule" })] }).bellRinging).toBe(true);
    expect(village({ runs: [run({ ...opened, trigger: "manual" })] }).bellRinging).toBe(false);
  });

  it("bars the road of a lapsed grant, and draws none for a disconnected source", () => {
    const scene = village({
      connections: [
        { source: "xero", status: "needs_reconnect" },
        { source: "gmail", status: "disconnected" },
      ],
    });

    expect(scene.roads).toEqual([{ source: "xero", slot: 0, lapsed: true }]);
  });
});

describe("the paint", () => {
  const tokens: Tokens = {
    leaf: "#fbf8f0",
    page: "#f7f3e7",
    bone: "#efe9d9",
    ink: "#16150f",
    ink2: "#56513f",
    ink3: "#6b6450",
    teal: "#0f7673",
    errata: "#cf2f16",
    slip: "#fdf0eb",
  };
  const hue = "#634cb0";

  it("never puts a division's hue on a character", () => {
    for (const facts of Object.values(atlas.folk)) {
      const colours = facts.cells.map((_, cell) => cellColour(tokens, facts, cell, hue));

      expect(colours).not.toContain(hue);
    }
  });

  it("puts the roof's hue on a building's team cells and nowhere else on it", () => {
    const colours = atlas.set.cells.map((_, cell) => cellColour(tokens, atlas.set, cell, hue));
    const roofed = colours.flatMap((colour, cell) => (colour === hue ? [cell] : []));

    expect(roofed).toEqual(atlas.set.team);
  });
});
