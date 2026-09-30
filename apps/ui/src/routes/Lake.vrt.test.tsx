/**
 * The raw lake narrowed to a run, as a picture: Xero's invoices as run 0101 left them, the one
 * row that still names it with its payload unfolded, and the sentence saying the other was
 * written again by a later run -- so the shorter list is never read as the run's whole output
 * (ADR 0091). Read by an admin, the one reader the rows are shown to.
 *
 * The fold is opened by its own summary, the way a person opens it; a `<details>` holds whether
 * it is open, and nothing else does. ADR 0099.
 */

import { describe, expect, test as it } from "vitest";
import { type Locator, page } from "vitest/browser";

import {
  CONNECTIONS,
  LAKE_SUMMARY,
  TENANT,
  tenant,
  XERO_INVOICES_OF_RUN,
  XERO_RUN,
} from "@/test/demoBook.ts";
import { open } from "@/test/visual.tsx";

const ADDRESS = `/tenants/${TENANT}/lake?source=xero&entity=invoices&run=${XERO_RUN}`;

/**
 * Press a control the way its own click handler hears it, without moving the pointer: a plate
 * under the pointer is drawn hovered, and the pointer's travel scrolls the page, so a pointer
 * press left its mark on the picture -- a hovered plate, a page a few pixels up.
 */
async function press(control: Locator): Promise<void> {
  await expect.element(control).toBeVisible();
  const element = control.element();
  if (!(element instanceof HTMLElement)) {
    throw new TypeError("a control to press is an HTML element");
  }
  element.click();
}

async function narrowedWithPayload(width: number): Promise<void> {
  const screen = open(ADDRESS, "en", {
    "tenants.get": tenant("admin"),
    "connections.list": CONNECTIONS,
    "lake.summary": LAKE_SUMMARY,
    "lake.records": XERO_INVOICES_OF_RUN,
  });
  await press(page.getByText("Show payload"));
  await expect.element(page.getByRole("button", { name: "Copy original string" })).toBeVisible();
  await screen.matches(`lake-run-en-${String(width)}`, width);
}

describe("the raw lake narrowed to one run", () => {
  it("at 1440 px", async () => {
    await narrowedWithPayload(1440);
  });

  it("at 390 px", async () => {
    await narrowedWithPayload(390);
  });
});
