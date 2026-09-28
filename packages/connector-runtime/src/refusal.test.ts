/**
 * The one failure a read hands back as "not granted" rather than as a failure (ADR 0075).
 *
 * Everything else must still raise (`.claude/rules/connectors.md`), so the guard is pinned from
 * both sides: HubSpot's own "missing scopes" answer on a list's first request becomes
 * `EntityNotGranted` naming the scope, while a 403 that says anything else, and the same refusal
 * after a page has already been answered, stay the failures they always were.
 */

import { describe, expect, test as it } from "bun:test";
import { parseSpec } from "@undercroft/contracts";
import { ConnectorError, TestClock } from "@undercroft/core";

import { EntityNotGranted } from "./refusal.ts";
import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.refusal.test";

const SPEC = parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: refusal
displayName: Refusal
baseUrl: ${BASE}
auth: { kind: bearer, token: { from: connection }, grantRefusal: hubspot-missing-scopes }
entities:
  - name: quotes
    request: { kind: list, path: /quotes }
    envelopePath: results
    idPath: id
    pagination: { kind: cursor, cursorPath: paging.next.after, param: after }
    readScope: crm.objects.quotes.read
`);

/** HubSpot's answer to a token without a scope, as its error body carries it. */
function missingScopes(context: Record<string, unknown>): unknown {
  return {
    status: "error",
    message: "This app hasn't been granted all required scopes to make this call.",
    category: "MISSING_SCOPES",
    errors: [{ message: "One or more of the following scopes are required.", context }],
  };
}

async function drain(fetcher: InMemoryFetcher): Promise<unknown> {
  const [entity] = SPEC.entities;
  try {
    for await (const _ of readEntity(SPEC, entity!, {
      fetcher,
      clock: new TestClock(),
      token: () => "pat",
    })) {
      // Drained for what the read raises.
    }
    return null;
  } catch (error) {
    return error;
  }
}

describe("a list the token may not read", () => {
  it("is not granted, naming the scope, when HubSpot refuses its first request", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/quotes`, {
      status: 403,
      body: missingScopes({ requiredGranularScopes: ["crm.objects.quotes.read", "e-commerce"] }),
    });

    const error = await drain(fetcher);

    expect(error).toBeInstanceOf(EntityNotGranted);
    // The spec's own scope when HubSpot names it among those it would accept.
    expect((error as EntityNotGranted).scopes).toEqual(["crm.objects.quotes.read"]);
  });

  it("names the scope HubSpot names when it is not the one the spec wrote down", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/quotes`, {
      status: 403,
      body: missingScopes({ missingScopes: ["crm.objects.deals.read"] }),
    });

    expect(((await drain(fetcher)) as EntityNotGranted).scopes).toEqual(["crm.objects.deals.read"]);
  });

  it("stays a failure for a 403 that says anything else", async () => {
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/quotes`, {
      status: 403,
      body: { status: "error", category: "FORBIDDEN", message: "portal suspended" },
    });

    const error = await drain(fetcher);

    expect(error).toBeInstanceOf(ConnectorError);
    expect(error).not.toBeInstanceOf(EntityNotGranted);
  });

  it("stays a failure once a page has been answered: that is a partial read", async () => {
    const fetcher = new InMemoryFetcher()
      .on("GET", `${BASE}/quotes`, {
        body: { results: [{ id: "q1" }], paging: { next: { after: "q1" } } },
      })
      .on("GET", `${BASE}/quotes?after=q1`, {
        status: 403,
        body: missingScopes({ requiredGranularScopes: ["crm.objects.quotes.read"] }),
      });

    const error = await drain(fetcher);

    expect(error).not.toBeInstanceOf(EntityNotGranted);
    expect(String(error)).toContain("failed after 1 records");
  });
});
