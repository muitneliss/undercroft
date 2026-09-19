// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/useTopLevelRegex: Worth doing, and deliberately not done here: hoisting these literals touches many files and belongs in its own commit where the diff is reviewable, rather than buried in a lint migration. Recorded rather than silently dropped.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

import { describe, expect, test as it } from "bun:test";
import { InMemoryByteFetcher, TestClock } from "@undercroft/core";

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

  it("a revoked grant raises rather than returning a broken credential", async () => {
    const { refresh } = refresherWith({ error: "invalid_grant" }, 400);

    await expect(refresh("revoked")).rejects.toThrow();
  });
});
