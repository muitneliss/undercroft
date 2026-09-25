import { describe, expect, test as it } from "bun:test";
import { InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { RefreshRefused } from "@undercroft/db/services";

import { XERO_TOKEN_URL, xeroRefresher } from "./refresh.ts";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function refresherWith(body: unknown, status = 200) {
  const fetcher = new InMemoryByteFetcher().on("POST", XERO_TOKEN_URL, { status, body });
  return {
    fetcher,
    refresh: xeroRefresher({
      clientId: "xero-client",
      clientSecret: "xero-secret",
      fetcher,
      clock: new TestClock(NOW),
    }),
  };
}

describe("xeroRefresher", () => {
  it("returns the rotated pair with the expiry resolved against the clock", async () => {
    const { refresh } = refresherWith({
      access_token: "fresh",
      refresh_token: "rotated",
      expires_in: 1800,
    });

    const credential = await refresh("spent");

    expect(credential).toEqual({
      accessToken: "fresh",
      refreshToken: "rotated",
      expiresAt: "2026-09-17T12:30:00.000Z",
    });
  });

  it("authenticates the client with a Basic header and sends only the grant in the body", async () => {
    const { refresh, fetcher } = refresherWith({
      access_token: "fresh",
      refresh_token: "rotated",
      expires_in: 1800,
    });

    await refresh("spent");

    const [sent] = fetcher.calls;
    expect(sent?.headers.authorization).toBe(
      `Basic ${Buffer.from("xero-client:xero-secret").toString("base64")}`,
    );
    const body = new URLSearchParams(sent?.body ?? "");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("spent");
    expect(body.has("client_secret")).toBe(false);
  });

  it("a 200 with no rotated refresh_token is refused, never carried forward", async () => {
    // Google's reading -- absent means unchanged -- would here store a token Xero has just
    // killed, and the customer would consent again for no visible reason.
    const { refresh } = refresherWith({ access_token: "fresh", expires_in: 1800 });

    await expect(refresh("spent")).rejects.toThrow(/no rotated refresh_token/u);
  });

  it("a revoked grant is a refused refresh, which the connection reads as expired", async () => {
    // The same rule as Google's, from the same owner (`oauthRefresh.ts`): a bare HTTP 400 here
    // read as an outage, and the connection kept saying "connected" (issue 213).
    const { refresh } = refresherWith({ error: "invalid_grant" }, 400);

    await expect(refresh("revoked")).rejects.toBeInstanceOf(RefreshRefused);
  });
});
