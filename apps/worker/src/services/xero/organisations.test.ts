// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { describe, expect, test as it } from "bun:test";
import { HttpError, InMemoryByteFetcher } from "@undercroft/core";

import { listOrganisations, XERO_CONNECTIONS_URL } from "./organisations.ts";

describe("listOrganisations", () => {
  it("names each organisation the consent can see by Xero's own tenant id", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", XERO_CONNECTIONS_URL, {
      body: [
        {
          id: "conn-1",
          tenantId: "org-9f2a",
          tenantName: "Acme Pte Ltd",
          tenantType: "ORGANISATION",
        },
        { id: "conn-2", tenantId: "org-77", tenantName: "" },
        { id: "conn-3", tenantName: "no id, no entry" },
      ],
    });

    const organisations = await listOrganisations({
      fetcher,
      token: () => Promise.resolve("t"),
    });

    expect(organisations).toEqual([
      { id: "org-9f2a", name: "Acme Pte Ltd", kind: null },
      { id: "org-77", name: "org-77", kind: null },
    ]);
    expect(fetcher.calls[0]?.headers.authorization).toBe("Bearer t");
  });

  it("a refused credential raises with its status, so the caller can say 'reconnect'", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", XERO_CONNECTIONS_URL, {
      status: 401,
      body: { error: "invalid_token" },
    });

    let refused: unknown;
    try {
      await listOrganisations({ fetcher, token: () => Promise.resolve("dead") });
    } catch (error) {
      refused = error;
    }
    if (!(refused instanceof HttpError)) {
      throw new Error("expected Xero's refusal to raise as an HttpError");
    }
    expect(refused.status).toBe(401);
  });
});
