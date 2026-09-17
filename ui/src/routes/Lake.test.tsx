/**
 * What the lake browser tells someone before they open a customer's documents.
 *
 * Downloading from the raw lake hands over the customer's actual invoices and
 * email attachments. The endpoint is admin-only and writes to the audit log
 * against the operator's name, and both of those are facts the person clicking
 * is entitled to know beforehand -- a consequence disclosed afterwards is not a
 * disclosure. This is the same objection `ConnectionCard.test.tsx` makes about
 * the consent copy, one layer further in.
 *
 * The other promise here is that an observation count is not a copy count. The
 * lake is create-only and content-addressed, so three observations of an
 * unchanged object is normal and healthy; a column labelled in a way that reads
 * as "three copies" would have an operator chasing storage that does not exist.
 */

import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { Lake } from "@/routes/Lake";
import { renderApp } from "@/test/render";
import { CASE_A, storeObject } from "@/test/store";

function show() {
  return renderApp(<Lake tenantId={CASE_A} />);
}

describe("opening a customer's documents", () => {
  test("says downloading is restricted and recorded, before the download exists", async () => {
    storeObject(CASE_A, "xero/invoices/INV-001.pdf", [
      { sha256: "a".repeat(64), bytes: 20_480, reason: "first observation" },
    ]);

    show();
    await userEvent.click(await screen.findByRole("button", { name: /provenance/i }));

    expect(
      await screen.findByText(/restricted to administrators and is written to the audit log/i),
    ).toBeInTheDocument();
  });

  test("the download appears only once its provenance is open", async () => {
    storeObject(CASE_A, "xero/invoices/INV-001.pdf", [
      { sha256: "a".repeat(64), bytes: 20_480 },
    ]);

    show();
    await screen.findByRole("button", { name: /provenance/i });

    // Not a link on the list row: taking the bytes is a deliberate act, so it
    // lives beside the observation it belongs to and the notice that governs it.
    expect(screen.queryByRole("link", { name: /download/i })).not.toBeInTheDocument();
  });
});

describe("what a row means", () => {
  test("counts observations rather than copies", async () => {
    // Create-only and content-addressed: an unchanged file costs one manifest,
    // not one copy. Three observations of one object is the healthy reading.
    storeObject(CASE_A, "xero/invoices/INV-001.pdf", [
      { sha256: "a".repeat(64), bytes: 20_480 },
      { sha256: "a".repeat(64), bytes: 20_480 },
      { sha256: "a".repeat(64), bytes: 20_480 },
    ]);

    show();

    expect(await screen.findByRole("columnheader", { name: /observations/i })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "3" })).toBeInTheDocument();
  });

  test("a size nobody recorded is shown as missing, not as zero", async () => {
    // An object whose size was never written is not an object of zero bytes.
    storeObject(CASE_A, "gmail/headers/2026-09.json", [{ sha256: "b".repeat(64) }]);

    show();

    expect(await screen.findByText("gmail/headers/2026-09.json")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "—" })).toBeInTheDocument();
  });
});

describe("an empty lake", () => {
  test("distinguishes nothing stored from nothing matching", async () => {
    show();

    // Nothing has ever been deleted -- the lake is create-only -- so an empty
    // result means nothing was written, and saying so is the difference between
    // a calm empty state and a suspected data loss.
    expect(await screen.findByText(/once a source has been granted/i)).toBeInTheDocument();
  });
});
