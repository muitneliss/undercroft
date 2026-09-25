/**
 * The four connection states, and the two that are easy to conflate.
 *
 * `needs_scope` and `needs_reconnect` both look like "not working yet" and ask
 * the operator for completely different things — one wants a decision, the other
 * wants a trip through a consent screen. Collapsing them produces a card that
 * says "fix this" and cannot say how.
 *
 * There is no clock here any more. A fifth state, `expired`, used to be derived from
 * `expiresAt` against `now`; the timestamp turned out to be the access token's hourly
 * rotation rather than the grant's end, and the derivation was a second owner for a decision
 * the server already makes. The tests that pinned it now pin its absence.
 */

import { describe, expect, test as it } from "bun:test";

import { translatorFor } from "@/i18n/index.ts";
import { connection } from "@/test/fixtures.ts";
import {
  connectsBy,
  offersAccounts,
  presentConnection,
  scopeSummary,
  selectedFor,
  setupProgress,
} from "./connectionState.ts";

// The real catalogue, not a stub that answers anything asked of it. A key these functions
// reach for that no catalogue carries would pass against a stub and render raw on the page.
const t = translatorFor("vi");

describe("presentConnection", () => {
  it("an unconnected source offers to connect", () => {
    const card = presentConnection(t, connection("xero"));

    expect(card.state).toBe("not_connected");
    expect(card.action?.kind).toBe("connect");
    expect(card.complete).toBe(false);
  });

  it("a connected source with a chosen scope is done", () => {
    const card = presentConnection(
      t,
      connection("xero", { status: "connected", externalAccountLabel: "CASE-A1B2C3 Pte Ltd" }),
    );

    expect(card.state).toBe("connected");
    expect(card.action).toBeNull();
    expect(card.complete).toBe(true);
  });

  it("a source awaiting its scope asks for a decision, not a reconnect", () => {
    const card = presentConnection(t, connection("drive", { status: "needs_scope" }));

    expect(card.state).toBe("needs_scope");
    expect(card.action?.kind).toBe("scope");
    expect(card.complete).toBe(false);
  });

  it("a revoked grant asks for a reconnect, not a decision", () => {
    const card = presentConnection(t, connection("gmail", { status: "needs_reconnect" }));

    expect(card.state).toBe("needs_reconnect");
    expect(card.action?.kind).toBe("reconnect");
    expect(card.complete).toBe(false);
  });

  it("a past expiry does not demand a reconnect the status has not asked for", () => {
    // The regression, and the quiet half of the guard above. A date in the past used to be
    // enough on its own to mark a grant lapsed, which meant every freshly consented Google
    // connection asked to be reconnected about an hour later -- the access token's rotation,
    // read as the grant's end. Only a failed refresh ends a grant, and only the worker can
    // see one; it says so by setting the status this function is handed.
    const card = presentConnection(
      t,
      connection("gmail", { status: "connected", expiresAt: "2000-01-01T00:00:00Z" }),
    );

    expect(card.state).toBe("connected");
    expect(card.action).toBeNull();
    expect(card.complete).toBe(true);
  });
});

describe("scopeSummary for Xero", () => {
  it("names the chosen entities in the reader's language, with the ids kept out of sight", () => {
    const xero = connection("xero", {
      status: "connected",
      config: { entities: ["invoices", "credit_notes"] },
    });

    expect(scopeSummary(t, xero)).toBe("Hóa đơn, Giấy báo có");
    expect(scopeSummary(translatorFor("en"), xero)).toBe("Invoices, Credit notes");
  });

  it("no entity chosen is every entity, said in words rather than as a dash", () => {
    const xero = connection("xero", { status: "connected", config: { entities: [] } });

    expect(scopeSummary(t, xero)).toBe(
      "Mọi loại dữ liệu: liên hệ, hóa đơn, thanh toán, giấy báo có",
    );
  });
});

describe("scopeSummary for HubSpot", () => {
  it("nothing chosen is the standard properties, said in words rather than as a dash", () => {
    // A HubSpot connection nobody has scoped still reads something -- the spec's own
    // properties -- so the card may not render it as missing.
    const hubspot = connection("hubspot", { status: "connected", config: {} });

    expect(scopeSummary(t, hubspot)).toBe("Các trường chuẩn của công ty, liên hệ và giao dịch");
  });

  it("counts what was chosen across every object", () => {
    const hubspot = connection("hubspot", {
      status: "connected",
      config: { properties: { companies: ["annualrevenue", "city"], deals: ["x_stage"] } },
    });

    expect(scopeSummary(t, hubspot)).toBe("Các trường chuẩn, cùng 3 trường chọn thêm");
    expect(scopeSummary(translatorFor("en"), hubspot)).toBe(
      "The standard properties, and 3 more chosen",
    );
  });
});

describe("connectsBy", () => {
  it("HubSpot connects by a pasted token; every consent source by its provider's screen", () => {
    expect(connectsBy("hubspot")).toBe("token");
    for (const source of ["xero", "gmail", "drive"] as const) {
      expect(connectsBy(source)).toBe("consent");
    }
  });
});

describe("setupProgress", () => {
  it("counts only the sources that are actually usable", () => {
    const progress = setupProgress([
      connection("hubspot", { status: "connected" }),
      connection("xero", { status: "needs_scope" }),
      connection("gmail"),
      connection("drive"),
    ]);

    expect(progress).toEqual({ done: 1, total: 4, finished: false });
  });

  it("is finished only when every source is connected", () => {
    const all = (["hubspot", "xero", "gmail", "drive"] as const).map((s) =>
      connection(s, { status: "connected" }),
    );

    expect(setupProgress(all).finished).toBe(true);
  });

  it("an empty list is not finished", () => {
    // Otherwise a tenant whose connections failed to load renders as complete.
    expect(setupProgress([]).finished).toBe(false);
  });
});

describe("selectedFor", () => {
  const first = connection("gmail", { status: "connected", externalAccountLabel: "ops@acme.test" });
  const second = connection("gmail.3fa9c1d2e0ab", {
    status: "connected",
    externalAccountLabel: "sales@acme.test",
  });

  it("shows the account the reader chose while it is still listed", () => {
    expect(selectedFor([first, second], "gmail.3fa9c1d2e0ab")).toBe(second);
  });

  it("falls back to the first account once the chosen one is gone", () => {
    // Disconnected and dropped from the list: the row shows the next account, not nothing.
    expect(selectedFor([first], "gmail.3fa9c1d2e0ab")).toBe(first);
  });
});

describe("offersAccounts", () => {
  it("a kind holding a real account offers the switcher, and with it the plate to add one", () => {
    const accounts = [connection("gmail", { status: "connected" })] as const;

    expect(offersAccounts({ kind: "gmail", accounts })).toBe(true);
  });

  it("a kind nobody has connected offers only its card's own Connect", () => {
    // "Add another account" over no account at all would be a second button for one consent.
    const accounts = [connection("gmail")] as const;

    expect(offersAccounts({ kind: "gmail", accounts })).toBe(false);
  });
});
