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

describe("a URL nothing claims", () => {
  it("falls to the catch-all", () => {
    expect(opens("/nowhere/at/all")).toBe("*");
  });
});
