/**
 * The index's four promises, each of which fails silently if it breaks.
 *
 * A wrong ORDER is a list that still looks like a list. A filter that misses an accented
 * name returns fewer rows, which reads as "the mailbox has no such label" rather than as a
 * defect. And a label Gmail declined to classify, quietly filed under "yours", is a claim
 * about who made it printed on the screen where custody is decided.
 *
 * No mocks and nothing rendered: these are values in and values out, which is the whole
 * reason the decision lives beside the component instead of inside it.
 */

// biome-ignore-all lint/nursery/noBunModules: Bun is the test runner, per CLAUDE.md: 'Bun is the runtime, package manager, workspace manager and test runner.' `bun:test` is the toolchain, not an accidental dependency.
// biome-ignore-all lint/style/useFilenamingConvention: One file named for the thing it exports, matching every other module in its directory.

import { expect, test as it } from "bun:test";

import { type BrowsedLabel, indexLabels } from "@/lib/labelIndex.ts";

const MAILBOX: BrowsedLabel[] = [
  { id: "INBOX", name: "INBOX", kind: "system" },
  { id: "CATEGORY_FORUMS", name: "CATEGORY_FORUMS", kind: "system" },
  { id: "Label_9", name: "Đơn hàng", kind: "user" },
  { id: "Label_2", name: "Github", kind: "user" },
  { id: "Label_7", name: "CI", kind: "user" },
  { id: "Label_4", name: "Kế toán", kind: null },
];

it("sets an admin's own labels ahead of the ones Gmail ships", () => {
  const runs = indexLabels(MAILBOX, "", "vi");

  expect(runs.map((run) => run.kind)).toEqual(["user", null, "system"]);
});

it("orders each run by name, so an index can be read down rather than searched", () => {
  // Collated, not compared byte by byte: Đ is its own letter in the Vietnamese alphabet and
  // files between D and E. A codepoint sort would park it after Z, at the foot of the run,
  // which is where a Vietnamese reader would give up looking for it.
  const runs = indexLabels(MAILBOX, "", "vi");

  expect(runs[0]?.items.map((label) => label.name)).toEqual(["CI", "Đơn hàng", "Github"]);
});

it("leaves a label Gmail did not classify in its own run rather than filing it as yours", () => {
  // The quiet side of the same guard as the test below: three answers in, three runs out.
  const runs = indexLabels(MAILBOX, "", "vi");

  expect(runs.find((run) => run.kind === null)?.items.map((label) => label.name)).toEqual([
    "Kế toán",
  ]);
});

it("produces no run for a kind nothing in the mailbox carries", () => {
  const runs = indexLabels([{ id: "INBOX", name: "INBOX", kind: "system" }], "", "vi");

  expect(runs.map((run) => run.kind)).toEqual(["system"]);
});

it("matches a Vietnamese name typed without its diacritics", () => {
  // The operators type on a keyboard that is often not set to Vietnamese. `don hang`
  // finding nothing while `Đơn hàng` sits in the list reads as a broken list.
  const runs = indexLabels(MAILBOX, "don hang", "vi");

  expect(runs.flatMap((run) => run.items.map((label) => label.name))).toEqual(["Đơn hàng"]);
});

it("matches on any part of a name, not only its opening", () => {
  const runs = indexLabels(MAILBOX, "hub", "vi");

  expect(runs.flatMap((run) => run.items.map((label) => label.name))).toEqual(["Github"]);
});

it("answers a filter nothing matches with nothing, rather than with everything", () => {
  // The quiet side: a filter that fell back to the unfiltered list on a miss would look
  // like a mailbox where every label matches every word.
  const runs = indexLabels(MAILBOX, "xero", "vi");

  expect(runs).toEqual([]);
});

it("treats a filter of only spaces as no filter at all", () => {
  const runs = indexLabels(MAILBOX, "   ", "vi");

  expect(runs.flatMap((run) => run.items)).toHaveLength(MAILBOX.length);
});
