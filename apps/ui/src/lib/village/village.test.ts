/**
 * What the village promises (ADR 0116): nothing moves without a run behind it, a slip hangs only
 * over a failure, and a hue is worn only by a roof, never by a character.
 */

import { readFileSync } from "node:fs";

import { describe, expect, test as it } from "bun:test";

import type { RunEventView, RunView } from "@/api/types.ts";
import atlas from "@/assets/village/atlas.json" with { type: "json" };
import type { ModelLineage } from "@/api/types.ts";
import { DIVISIONS } from "@/lib/divisions.ts";
import { focusOn } from "@/lib/lineage.ts";
import { arrange } from "@/lib/lineageArrange.ts";
import type { RunStage } from "@/lib/runFlowTypes.ts";
import { lineageGraph, runMapGraph } from "@/lib/village/graph.ts";
import { type AtlasFacts, RAMPS, vertexColour } from "@/lib/village/palette.ts";
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
  const shades = [0, 0.5, 1];
  const atlases: AtlasFacts[] = [atlas.set, ...Object.values(atlas.folk)];

  function rgb(hex: string): number[] {
    return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
  }

  /** Whether a colour lies between two neighbouring steps of a ramp, a division's hue left out. */
  function onARamp(colour: string, left: ReadonlySet<string>): boolean {
    const [r = 0, g = 0, b = 0] = rgb(colour);
    return Object.values(RAMPS).some((ramp) => {
      const steps = ramp.filter((step) => !left.has(step)).map(rgb);
      return steps.slice(1).some((above, at) => {
        const below = steps[at] ?? above;
        const span = above.map((channel, c) => channel - (below[c] ?? 0));
        const length = span.reduce((sum, d) => sum + d * d, 0) || 1;
        const share = Math.min(
          1,
          Math.max(
            0,
            ((r - (below[0] ?? 0)) * (span[0] ?? 0) +
              (g - (below[1] ?? 0)) * (span[1] ?? 0) +
              (b - (below[2] ?? 0)) * (span[2] ?? 0)) /
              length,
          ),
        );
        return [r, g, b].every(
          (channel, c) => Math.abs(channel - ((below[c] ?? 0) + share * (span[c] ?? 0))) <= 1.5,
        );
      });
    });
  }

  function everyColour(facts: AtlasFacts, roof: string | null): string[] {
    return facts.top.flatMap((_, cell) =>
      shades.map((shade) => vertexColour(facts, cell, shade, roof)),
    );
  }

  it("paints every vertex along one of the design system's ramps, never in vermilion or a division's hue", () => {
    const forbidden = new Set(["#cf2f16", ...DIVISIONS.map((division) => division.hue)]);
    for (const facts of atlases) {
      const colours = everyColour(facts, null);

      expect(colours.filter((colour) => !onARamp(colour, forbidden))).toEqual([]);
      expect(colours.filter((colour) => forbidden.has(colour))).toEqual([]);
    }
  });

  it("puts a roof's hue on a building's team cells and nowhere else on it", () => {
    // A roof no ink could be by chance, so a cell wearing it can only have been given it.
    const roof = "#010203";
    const roofed = atlas.set.top.flatMap((_, cell) =>
      shades.every((shade) => vertexColour(atlas.set, cell, shade, roof) === roof) ? [cell] : [],
    );

    expect(roofed).toEqual(atlas.set.team);
  });

  it("keeps the inks exactly as the design system's tonal ramps give them", () => {
    const design = JSON.parse(
      readFileSync(new URL("../../../.impeccable/design.json", import.meta.url), "utf8"),
    ) as { extensions: { colorMeta: Record<string, { tonalRamp?: string[] }> } };

    for (const [family, ramp] of Object.entries(RAMPS)) {
      expect(ramp).toEqual(design.extensions.colorMeta[family]?.tonalRamp ?? []);
    }
  });
});

describe("a graph drawn as a village", () => {
  function model(name: string): ModelLineage["nodes"][number] {
    return { kind: "model", id: `model:${name}`, name, undeclared: [] };
  }

  function stage(key: string, kind: RunStage["kind"], mark: RunStage["mark"]): RunStage {
    return {
      key,
      kind,
      label: key,
      mark,
      markLabel: mark,
      detail: null,
      gathered: null,
      href: null,
    };
  }

  it("builds a run's own stages, roads between them, and traffic out of the one still working", () => {
    const stages = [
      stage("link-parent", "link-parent", "granted"),
      stage("entity:deals", "entity", "granted"),
      stage("entity:contacts", "entity", "pending"),
      stage("outcome", "outcome", "pending"),
      stage("link-child", "link-child", "pending"),
    ];

    const graph = runMapGraph(stages);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "entity:deals",
      "entity:contacts",
      "outcome",
    ]);
    expect(graph.edges.map((edge) => [edge.id, edge.flowing])).toEqual([
      ["entity:deals->entity:contacts", false],
      ["entity:contacts->outcome", true],
    ]);
  });

  it("builds every lineage node and declared edge, with traffic exactly on the selection's chains", async () => {
    const lineage: ModelLineage = {
      nodes: [
        { kind: "raw", id: "raw:r", name: "r" },
        model("a"),
        model("b"),
        model("c"),
        model("side"),
        { kind: "missing", id: "missing:gone", name: "gone" },
      ],
      edges: [
        { from: "raw:r", to: "model:a", via: null },
        { from: "model:a", to: "model:b", via: null },
        { from: "model:b", to: "model:c", via: null },
        { from: "raw:r", to: "model:side", via: null },
        { from: "model:c", to: "model:c", via: null },
        { from: "missing:gone", to: "model:side", via: null },
      ],
    };
    const arrangement = await arrange(lineage, lineage);
    if (arrangement === null) {
      throw new Error("the lineage could not be arranged");
    }
    const selected = lineage.nodes.find((node) => node.id === "model:b") ?? null;

    const graph = lineageGraph(lineage, focusOn(lineage, selected), arrangement, new Map());

    expect(graph.nodes.map((node) => node.id)).toEqual(lineage.nodes.map((node) => node.id));
    expect(graph.edges.map((edge) => edge.id).sort()).toEqual(
      [
        "raw:r|model:a",
        "model:a|model:b",
        "model:b|model:c",
        "raw:r|model:side",
        "missing:gone|model:side",
      ].sort(),
    );
    expect(graph.edges.filter((edge) => edge.broken).map((edge) => edge.id)).toEqual([
      "missing:gone|model:side",
    ]);
    expect(
      graph.edges
        .filter((edge) => edge.flowing)
        .map((edge) => edge.id)
        .sort(),
    ).toEqual(["raw:r|model:a", "model:a|model:b", "model:b|model:c"].sort());
    expect(graph.nodes.find((node) => node.id === "model:side")?.state).toBe("dim");
  });
});
