/**
 * The scope picker's review step, as a picture: the finance Drive account after its admin took
 * "Demo finance" off the pick, set beside what is saved, with what leaves the scope and what the
 * next read does to what the lake already holds.
 *
 * The draft is the store's, seeded from the saved scope when the picker opens, so the only way
 * to a review with a change in it is the one a person takes: press the pick's own Remove on the
 * first step, then Next. Doing it through the page rather than writing the store keeps the
 * picture honest about how the draft got there. ADR 0099.
 */

import { describe, expect, test as it } from "vitest";
import { type Locator, page } from "vitest/browser";

import { TENANT, tenant, CONNECTIONS } from "@/test/demoBook.ts";
import { open } from "@/test/visual.tsx";

const ADDRESS = `/tenants/${TENANT}/connect/drive/scope`;

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

async function reviewAfterUnticking(width: number): Promise<void> {
  const screen = open(ADDRESS, "en", {
    "tenants.get": tenant("admin"),
    "connections.list": CONNECTIONS,
    // No Picker client on this install: the pick is changed by its own Remove, not by Google.
    "config.google": null,
  });
  await press(page.getByRole("button", { name: "Remove Demo finance from the selection" }));
  await press(page.getByRole("button", { name: "Next: review changes" }));
  // Next navigates, and a navigation is nothing the settled check can see in flight: the
  // review is on screen when its own Save is.
  await expect.element(page.getByRole("button", { name: "Save selection" })).toBeVisible();
  await screen.matches(`scope-review-drive-en-${String(width)}`, width);
}

describe("the scope review for Drive, after a folder was taken off", () => {
  it("at 1440 px", async () => {
    await reviewAfterUnticking(1440);
  });

  it("at 390 px", async () => {
    await reviewAfterUnticking(390);
  });
});
