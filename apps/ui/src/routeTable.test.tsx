/**
 * What the URL map promises: a link anyone can paste opens the division it names.
 *
 * The table had no test at all, and the thing that broke it was invisible to every other
 * check in the gate -- half of it was lifted into a component, which typechecks and bundles
 * and then throws `is not a <Route> component` at the first render after sign-in. These pin
 * the map itself rather than that one spelling: every tab on the rail resolves, the links
 * that carry an id resolve, and the catch-all takes only what nothing else claimed.
 *
 * No mocks and no DOM: a real router, given the same table `App` hands to `useRoutes`, does
 * the matching. Nothing renders -- a router matches its initial entry when it is built, and
 * the elements stay untouched until a `RouterProvider` mounts one.
 */

import { describe, expect, test as it } from "bun:test";
import { createMemoryRouter } from "react-router-dom";

import { DIVISIONS, divisionPath } from "@/lib/divisions.ts";
import { consolePath } from "@/lib/lake.ts";
import { appRoutes } from "@/routeTable.tsx";

const routes = appRoutes("ops@example.test");

/** The route pattern a URL lands on, which is the whole of what the table decides. */
function opens(url: string): string | undefined {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  const path = router.state.matches.at(-1)?.route.path;
  router.dispose();
  return path;
}

describe("the book's divisions", () => {
  it("each open at their own route from the tab rail", () => {
    // Derived from DIVISIONS rather than listed, so a division added to the rail without a
    // route fails here instead of on a reader's first click.
    const rail = DIVISIONS.map((d) => divisionPath(d.id, "CASE-0042"));

    expect(rail.map(opens)).toEqual([
      "/tenants",
      "/tenants/:tenantId",
      "/tenants/:tenantId/journal/:runId?",
      "/tenants/:tenantId/lake",
      "/tenants/:tenantId/models",
      "/tenants/:tenantId/reports",
      "/tenants/:tenantId/people",
    ]);
  });
});

describe("a link that carries an id", () => {
  it("opens the page for that id rather than the division's index", () => {
    const deep = [
      "/tenants/CASE-0042/connect/hubspot/scope",
      "/tenants/CASE-0042/journal/run-7",
      "/tenants/CASE-0042/models/orders",
      "/tenants/CASE-0042/reports/questions/q-3",
      "/tenants/CASE-0042/reports/dashboards/d-3",
    ];

    expect(deep.map(opens)).toEqual([
      "/tenants/:tenantId/connect/:source/scope",
      "/tenants/:tenantId/journal/:runId?",
      "/tenants/:tenantId/models/:name",
      "/tenants/:tenantId/reports/questions/:id",
      "/tenants/:tenantId/reports/dashboards/:id",
    ]);
  });
});

describe("the lake's console", () => {
  /**
   * The console is a page UNDER a division's own index, which is the one shape in this table
   * where a wrong answer is silent: `/lake/console` also matches nothing else, so a table
   * that failed to rank it would fall to the catch-all and redirect to the customer list --
   * a door on the lake's leaf that quietly went somewhere else entirely.
   */
  it("opens at its own route rather than at the lake's index or the catch-all", () => {
    expect(opens(consolePath("CASE-0042"))).toBe("/tenants/:tenantId/lake/console");
  });

  /** A stream rides in the search, so the page opens on the rows the index was showing. */
  it("carries the stream the index had open, and still opens the console", () => {
    const opened = consolePath("CASE-0042", { kind: "documents", source: "drive" });

    expect(opened).toBe("/tenants/CASE-0042/lake/console?documents=drive");
    expect(opens(opened)).toBe("/tenants/:tenantId/lake/console");
  });

  /** And the index itself is untouched: the console did not swallow the division it sits in. */
  it("leaves the lake's own index where it was", () => {
    expect(opens("/tenants/CASE-0042/lake")).toBe("/tenants/:tenantId/lake");
  });
});

describe("the account page", () => {
  it("opens at its own route rather than falling to the catch-all", () => {
    expect(opens("/account")).toBe("/account");
  });
});

describe("a URL nothing claims", () => {
  it("falls to the catch-all", () => {
    expect(opens("/nowhere/at/all")).toBe("*");
  });
});
