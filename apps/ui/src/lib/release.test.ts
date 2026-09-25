/**
 * `replacedBy` decides whether a tab is told to reload, and both of its failures are silent.
 * Too eager, and a tab that loaded after the deploy -- which hears the same `updatefound` for
 * the same new worker -- is told to reload into the build it already runs, until nobody reads
 * the notice. Too shy, and a tab open across a deploy keeps calling the new server with the
 * old bundle and is never told. ADR 0055.
 *
 * `RELEASE` is the real stamp (`src/test/setup.ts` reads the version the build reads), so
 * "another release" is built from it rather than pinned: a pinned tag would one day BE this
 * release, and the test asserting a difference would fail on the commit that made it so.
 */

import { expect, test as it } from "bun:test";

import { RELEASE, replacedBy } from "@/lib/release.ts";

const another = `${RELEASE}-next`;

it("names the release a newly installed worker was built from when it is not this tab's", () => {
  expect(replacedBy(another)).toBe(another);
});

it("stays quiet when the worker was built from the release this tab is running", () => {
  expect(replacedBy(RELEASE)).toBeNull();
});

it("stays quiet on an answer that is not a release tag rather than guessing one", () => {
  expect(replacedBy(undefined)).toBeNull();
  expect(replacedBy("<!doctype html>")).toBeNull();
});
