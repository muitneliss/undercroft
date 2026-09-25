import { HttpError, InMemoryByteFetcher, TestClock } from "@undercroft/core";
import { RefreshRefused } from "@undercroft/db/services";
import { describe, expect, test as it } from "bun:test";

import { GOOGLE_TOKEN_URL, googleRefresher } from "./refresh.ts";

const NOW = new Date("2026-09-17T12:00:00.000Z");

function refresherWith(body: unknown, status = 200) {
  const fetcher = new InMemoryByteFetcher().on("POST", GOOGLE_TOKEN_URL, { status, body });
  return {
    fetcher,
    refresh: googleRefresher({
      clientId: "client.apps.googleusercontent.test",
      clientSecret: "secret",
      fetcher,
      clock: new TestClock(NOW),
    }),
  };
}

describe("googleRefresher", () => {
  it("a fresh access token comes back with its expiry resolved against the clock", async () => {
    const { refresh } = refresherWith({ access_token: "fresh", expires_in: 3599 });

    const credential = await refresh("stored-refresh-token");

    expect(credential.accessToken).toBe("fresh");
    expect(credential.expiresAt).toBe("2026-09-17T12:59:59.000Z");
  });

  it("an absent refresh_token carries the existing one forward", async () => {
    // Google does not return a refresh_token on an ordinary refresh. Reading absent as ""
    // would store a credential that can never refresh again, and the customer would have to
    // re-consent for no reason.
    const { refresh } = refresherWith({ access_token: "fresh", expires_in: 3599 });

    const credential = await refresh("stored-refresh-token");

    expect(credential.refreshToken).toBe("stored-refresh-token");
  });

  it("a rotated refresh_token replaces the old one", async () => {
    // The quiet side: a refresher that always kept the old token would pass the test above
    // and throw away a rotation on any provider that does issue one.
    const { refresh } = refresherWith({
      access_token: "fresh",
      refresh_token: "rotated",
      expires_in: 3599,
    });

    expect((await refresh("stored-refresh-token")).refreshToken).toBe("rotated");
  });

  it("the request carries the grant type and the client credentials", async () => {
    const { refresh, fetcher } = refresherWith({ access_token: "fresh", expires_in: 60 });

    await refresh("stored-refresh-token");

    const sent = new URLSearchParams(fetcher.calls[0]?.body ?? "");
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("stored-refresh-token");
    expect(sent.get("client_id")).toBe("client.apps.googleusercontent.test");
  });

  it("a revoked grant is a refused refresh, and the refusal's body is not carried", async () => {
    // Google answers a revoked or lapsed refresh token with 400 `invalid_grant`. As a bare
    // HttpError it read as an outage, and the connection kept saying "connected" while every
    // run and every browse failed on it (issue 213).
    const { refresh } = refresherWith(
      { error: "invalid_grant", error_description: "Token has been expired or revoked." },
      400,
    );

    const refused = await refresh("revoked").catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(RefreshRefused);
    expect((refused as RefreshRefused).status).toBe(400);
    expect((refused as RefreshRefused).message).not.toContain("invalid_grant");
  });

  it("an outage at the token endpoint, or a refusal of our own client, is not a refused grant", async () => {
    // The quiet side. A 5xx passes; a 401 is `invalid_client`, the deployment's secret, which
    // no customer's reconnect repairs. Reading either as a dead grant would send every
    // connection to re-consent over something that is not theirs.
    for (const status of [503, 401]) {
      const { refresh } = refresherWith({ error: "backend_error" }, status);

      const failure = await refresh("stored").catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(HttpError);
      expect(failure).not.toBeInstanceOf(RefreshRefused);
    }
  });

  it("a 200 carrying no access_token is refused", async () => {
    // The empty string would seal cleanly, read as "connected", and 401 deep inside a sync
    // where it looks like the source is down.
    const { refresh } = refresherWith({ expires_in: 3599 });

    await expect(refresh("stored")).rejects.toThrow(/no access_token/u);
  });

  it("a response with no expires_in records no expiry rather than inventing one", async () => {
    // `needsRefresh` reads a null expiry as fresh. Guessing an hour would refresh a token
    // that did not need it -- the HubSpot private-app failure, in a different costume.
    const { refresh } = refresherWith({ access_token: "fresh" });

    expect((await refresh("stored")).expiresAt).toBeNull();
  });
});
