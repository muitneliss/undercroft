/**
 * A spec that names an account header sends the provider's account id in it, and refuses to
 * send anything without one. Pinned because the header was declared in the Xero spec and
 * silently never sent -- every request went out addressed to no organisation.
 */

// biome-ignore-all lint/style/noNonNullAssertion: A test asserting on a fixture it created three lines earlier. Biome's unsafe autofix deletes the `!` and leaves `string | undefined` flowing into a `string`, so it does not compile.
// biome-ignore-all lint/style/useNamingConvention: HTTP header names are the provider's own -- `xero-tenant-id` is the header Xero reads -- and strictCase cannot be satisfied by code that talks to another system.

import { describe, expect, test as it } from "bun:test";
import { parseSpec } from "@undercroft/contracts";
import { ConnectorError, TestClock } from "@undercroft/core";

import { readEntity } from "./run.ts";
import { InMemoryFetcher } from "./testing.ts";

const BASE = "https://api.xero.test/api.xro/2.0";

const SPEC = parseSpec(`
apiVersion: undercroft.dev/v1
kind: Connector
id: xero
displayName: Xero
baseUrl: ${BASE}
auth:
  kind: oauth2
  tokenUrl: https://identity.xero.test/connect/token
  accountHeader: xero-tenant-id
defaults:
  pagination: { kind: none }
entities:
  - name: contacts
    request: { kind: list, path: /Contacts }
    envelopePath: Contacts
    idPath: ContactID
`);

async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    // Reading is the point; the records are not.
  }
}

describe("the account header", () => {
  it("carries the provider's account id on every request, under the base URL's own path", async () => {
    // The recorded URL keeps `/api.xro/2.0`: an absolute entity path used to drop it, so
    // every Xero request went to the origin root and no test with a bare-origin base saw it.
    const fetcher = new InMemoryFetcher().on("GET", `${BASE}/Contacts`, {
      body: { Contacts: [{ ContactID: "c-1" }] },
    });

    await drain(
      readEntity(SPEC, SPEC.entities[0]!, {
        fetcher,
        clock: new TestClock(),
        token: () => Promise.resolve("t"),
        accountId: "org-9f2a",
      }),
    );

    expect(fetcher.calls[0]?.headers["xero-tenant-id"]).toBe("org-9f2a");
    expect(fetcher.calls[0]?.headers.authorization).toBe("Bearer t");
  });

  it("refuses to send a request addressed to no organisation", async () => {
    // The quiet side would be a request that goes out without the header and is answered
    // with whichever organisation the provider picks.
    const fetcher = new InMemoryFetcher();
    let refused: unknown;
    try {
      await drain(
        readEntity(SPEC, SPEC.entities[0]!, {
          fetcher,
          clock: new TestClock(),
          token: () => Promise.resolve("t"),
        }),
      );
    } catch (error) {
      refused = error;
    }

    expect(refused).toBeInstanceOf(ConnectorError);
    expect(fetcher.calls).toHaveLength(0);
  });
});
