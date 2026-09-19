import { describe, expect, test as it } from "bun:test";
import { HttpError, InMemoryByteFetcher } from "@undercroft/core";

import { validateCredential } from "./validateCredential.ts";

const PROBE = "https://api.hubapi.com/crm/v3/objects/companies?limit=1";

describe("validateCredential", () => {
  it("a token HubSpot accepts passes, having been sent as the bearer of the smallest read", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", PROBE, { body: { results: [] } });

    const outcome = await validateCredential({ fetcher }, { source: "hubspot", token: "pat-1" });

    expect(outcome).toEqual({ ok: true });
    expect(fetcher.calls[0]?.headers.authorization).toBe("Bearer pat-1");
  });

  it("a token HubSpot refuses is rejected, whether it is unknown or lacks the scope", async () => {
    for (const status of [401, 403]) {
      const fetcher = new InMemoryByteFetcher().on("GET", PROBE, { status, body: {} });
      expect(await validateCredential({ fetcher }, { source: "hubspot", token: "typo" })).toEqual({
        ok: false,
        reason: "rejected",
      });
    }
  });

  it("a provider that is down raises rather than calling the token wrong", async () => {
    const fetcher = new InMemoryByteFetcher().on("GET", PROBE, { status: 503, body: {} });

    await expect(
      validateCredential({ fetcher }, { source: "hubspot", token: "pat-1" }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it("a source with no probe cannot be proven, and says so", async () => {
    const fetcher = new InMemoryByteFetcher();

    expect(await validateCredential({ fetcher }, { source: "xero", token: "t" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
    expect(fetcher.calls).toHaveLength(0);
  });
});
