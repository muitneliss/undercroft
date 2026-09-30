/**
 * The customer index, as a picture: the three case books of the design review's fixtures, read
 * by an operator who administers one, is a member of one and views one.
 *
 * The fixtures mirror the design's synthetic data rather than inventing new data, so the first
 * capture can be reviewed by eye beside the design's own picture of this screen. The baseline
 * is that reviewed capture, taken by `task ci:visual-update`; the design's PNG is never the
 * reference, because its data and its deliberate differences ("Keep code") could never match.
 * ADR 0099.
 */

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@undercroft/control-plane/router";
import { describe, test as it } from "vitest";

import { open } from "@/test/visual.tsx";

const CUSTOMERS: inferRouterOutputs<AppRouter>["tenants"]["list"] = [
  { id: "CASE-0042", displayName: "Demo Co.", role: "admin" },
  { id: "CASE-0067", displayName: "Atlas Example", role: "member" },
  { id: "CASE-0081", displayName: "Paper & Pine Demo", role: "viewer" },
];

describe("the customer index, in English", () => {
  it("at 1440 px", async () => {
    await open("/tenants", "en", { "tenants.list": CUSTOMERS }).matches("customers-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open("/tenants", "en", { "tenants.list": CUSTOMERS }).matches("customers-en-390", 390);
  });
});
