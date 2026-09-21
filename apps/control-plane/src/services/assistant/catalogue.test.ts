/**
 * The catalogue's own declarations, and the one duplication this feature carries.
 *
 * Two promises, both of which look fine when broken:
 *
 * A mutating tool with no `proofKey` renders a proof the reader cannot read -- a blank slip
 * with two plates on it, which somebody strikes anyway. A read tool WITH one is dead prose
 * nobody prints. Neither shows up in a review of the file, because each entry reads sensibly
 * on its own; only the pairing is wrong.
 *
 * And the browser restates which tools mutate, because it cannot import this file -- the
 * catalogue pulls in zod, the tRPC router and the Anthropic provider, and
 * `.biome/plugins/ui-server-import.grit` allows the UI a TYPE from the control plane and
 * nothing more. So the lists are checked against each other here rather than trusted to stay
 * in step, which is the only kind of duplication worth having.
 */

import { describe, expect, test as it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CATALOGUE, misdeclared, misrouted, mutates, TOOLS } from "./catalogue.ts";

describe("every tool declares what its tier requires", () => {
  it("a mutation has a proof sentence and a read does not", () => {
    expect(misdeclared()).toEqual([]);
  });

  it("there is something to check, so the assertion above is not vacuous", () => {
    const tiers = Object.values(TOOLS).map((spec) => spec.tier);
    expect(tiers).toContain("read");
    expect(tiers).toContain("write");
  });

  it("every tool names a plate the panel has a case for", () => {
    // The model cannot cut a new plate: it picks one of the application's own components. A
    // plate outside the closed set would render as nothing at all.
    const plates = new Set(["table", "chart", "runs", "grants", "questions", "facts", "none"]);
    const unknown = Object.values(TOOLS)
      .map((spec) => spec.plate)
      .filter((plate) => !plates.has(plate));
    expect(unknown).toEqual([]);
  });
});

describe("the browser's copy of which tools mutate agrees with this one", () => {
  /**
   * Read as TEXT rather than imported.
   *
   * `apps/control-plane` does not depend on `apps/ui`, and adding that dependency to check a
   * list would invert the one direction the layering rules exist to keep. Reading the file is
   * blunt and it is honest about being blunt: what is asserted is that the same tool names
   * appear, which is the fact that matters.
   */
  const proofsModule = readFileSync(
    join(import.meta.dirname, "../../../../ui/src/lib/assistantProofs.ts"),
    "utf8",
  );

  it("the panel has a sentence for every mutating tool", () => {
    const missing = Object.entries(TOOLS)
      .filter(([, spec]) => mutates(spec))
      .map(([name]) => name)
      .filter((name) => !proofsModule.includes(`case "${name}":`));
    expect(missing).toEqual([]);
  });

  it("the panel has no sentence for a tool that is not a mutation", () => {
    // The other direction. A sentence left behind after a tool was demoted to the read tier
    // would be unreachable prose claiming an action still needs confirming.
    const stale = Object.entries(CATALOGUE)
      .filter(([, spec]) => !mutates(spec))
      .map(([name]) => name)
      .filter((name) => proofsModule.includes(`case "${name}":`));
    expect(stale).toEqual([]);
  });
});

describe("the navigate tier is not bound to the server at all", () => {
  it("a navigate tool declares no procedure, and everything else declares one", () => {
    // The tier IS that absence: with no server-side `execute`, the SDK hands the call to the
    // browser, so nothing reaches the server that the reader did not then press. A navigate
    // tool WITH a procedure would quietly stop being a navigation; anything else WITHOUT one
    // would be offered to the model and handled by nobody.
    expect(misrouted()).toEqual([]);
  });

  it("there is a navigate tool, so the assertion above is not vacuous", () => {
    expect(Object.values(TOOLS).map((spec) => spec.tier)).toContain("navigate");
  });

  it("a navigate tool needs no proof, because opening a page changes nothing", () => {
    const navigating = Object.values(TOOLS).filter((spec) => spec.tier === "navigate");
    for (const spec of navigating) {
      expect(spec.proofKey).toBeUndefined();
    }
  });
});
