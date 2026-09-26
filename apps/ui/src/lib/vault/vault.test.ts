import { describe, expect, it } from "bun:test";

import {
  createVault,
  SOURCE_COUNT,
  STEPS,
  stageAt,
  stepAt,
  type Vault,
} from "@/lib/vault/model.ts";
import { advance, trigger } from "@/lib/vault/reader.ts";

const FRAME = 1 / 60;

/** Runs the vault for `seconds` of simulated time, calling `each` after every frame. */
function run(
  vault: Vault,
  seconds: number,
  reader: (time: number) => number | null = () => null,
  each: () => void = () => undefined,
): void {
  const frames = Math.round(seconds / FRAME);
  for (let frame = 0; frame < frames; frame += 1) {
    advance(vault, FRAME, reader(vault.time));
    each();
  }
}

describe("the vault's data path", () => {
  it("lets a record into the lake only through the one gate, one at a time", () => {
    const vault = createVault(7);
    let most = 0;
    let passed = 0;
    run(vault, 60, undefined, () => {
      const passing = vault.travellers.filter((each) => each.phase === "pass").length;
      most = Math.max(most, passing);
      passed += passing;
    });
    expect(passed).toBeGreaterThan(0);
    expect(most).toBe(1);
  });

  it("never rewrites a laid block, and no two blocks hold the same content", () => {
    const vault = createVault(11);
    run(vault, 20);
    const laid = new Map(vault.blocks.map((block) => [block.id, `${block.hash}/${block.source}`]));
    expect(laid.size).toBeGreaterThan(0);
    run(vault, 20);
    for (const block of vault.blocks) {
      const before = laid.get(block.id);
      if (before !== undefined) {
        expect(`${block.hash}/${block.source}`).toBe(before);
      }
    }
    const hashes = vault.blocks.map((block) => block.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("lands a duplicate on its original instead of laying a copy", () => {
    const vault = createVault(3);
    run(vault, 60);
    expect(vault.blocks.some((block) => block.echoes > 0)).toBe(true);
  });

  it("keeps a refused row on the page rather than dropping it", () => {
    const vault = createVault(5);
    run(vault, 60);
    expect(vault.refused.length).toBeGreaterThan(0);
  });

  it("builds the reports from what the models shaped", () => {
    // The reader held before the first step, so no step can lift a bar: only arrivals do.
    const vault = createVault(5);
    let rises = 0;
    let shapedBefore = 0;
    let previous = [...vault.bars];
    run(
      vault,
      30,
      () => 0,
      () => {
        const rose = vault.bars.some((height, bar) => height > (previous[bar] ?? 0));
        if (rose) {
          rises += 1;
          expect(vault.shaped).toBeGreaterThan(shapedBefore);
        }
        shapedBefore = vault.shaped;
        previous = [...vault.bars];
      },
    );
    expect(rises).toBeGreaterThan(0);
  });

  it("stays bounded however long the page is left open", () => {
    const vault = createVault(9);
    run(vault, 600);
    expect(vault.blocks.length).toBeLessThanOrEqual(80);
    expect(vault.refused.length).toBeLessThanOrEqual(12);
    expect(vault.travellers.length).toBeLessThan(120);
  });

  it("is the same film for the same seed", () => {
    const first = createVault(21);
    const second = createVault(21);
    run(first, 15);
    run(second, 15);
    expect(first.blocks.map((block) => block.hash)).toEqual(
      second.blocks.map((block) => block.hash),
    );
  });
});

describe("the reader's path through it", () => {
  it("a run sends records from every source at once", () => {
    const vault = createVault(1);
    const before = vault.travellers.length;
    trigger(vault, "run");
    const sent = vault.travellers.slice(before);
    expect(sent.length).toBe(SOURCE_COUNT * 2);
    expect(new Set(sent.map((each) => each.source)).size).toBe(SOURCE_COUNT);
  });

  it("fires every step the pointer carries the reader across, and signs them in", () => {
    const vault = createVault(2);
    expect(vault.reader.signedIn).toBe(false);
    run(vault, 12, (time) => Math.min(1, time / 8));
    for (const step of STEPS) {
      expect(vault.flares[step]).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    }
    expect(vault.reader.signedIn).toBe(true);
    expect(vault.reader.step).toBe("ask");
  });

  it("does not fire a step again while the reader stands on it", () => {
    const vault = createVault(2);
    run(vault, 4, () => 0.3);
    const fired = vault.flares.connect;
    expect(fired).toBeGreaterThan(Number.NEGATIVE_INFINITY);
    run(vault, 4, () => 0.3);
    expect(vault.flares.connect).toBe(fired);
  });

  it("walks the path by itself when nobody is pointing", () => {
    const vault = createVault(4);
    const seen = new Set<string>();
    run(vault, 30, undefined, () => {
      if (vault.reader.step !== null) {
        seen.add(vault.reader.step);
      }
    });
    expect(seen.size).toBe(STEPS.length);
  });
});

describe("where a point on the path falls", () => {
  it("names no step before the first and the last one past the end", () => {
    expect(stepAt(0)).toBeNull();
    expect(stepAt(0.1)).toBe("invite");
    expect(stepAt(0.5)).toBe("choose");
    expect(stepAt(1)).toBe("ask");
  });

  it("names the stage whose column holds the point, clamped to the page", () => {
    expect(stageAt(-0.2)).toBe("sources");
    expect(stageAt(0.3)).toBe("raw");
    expect(stageAt(0.6)).toBe("models");
    expect(stageAt(1.4)).toBe("reports");
  });
});
