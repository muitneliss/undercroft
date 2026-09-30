/**
 * One customer's own page, as a picture: Demo Co.'s facts and the directory of its book, read by
 * its admin, who is also offered the way to the one place its name is corrected. The design
 * draws this page as `#customer/:id`; `docs/runbook/visual-regression.md` says how a baseline is
 * reviewed. ADR 0099.
 */

import { describe, test as it } from "vitest";

import { TENANT, tenant } from "@/test/demoBook.ts";
import { open } from "@/test/visual.tsx";

const ADDRESS = `/tenants/${TENANT}/about`;

describe("a customer's own page, in English", () => {
  it("at 1440 px", async () => {
    await open(ADDRESS, "en", { "tenants.get": tenant("admin") }).matches("customer-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(ADDRESS, "en", { "tenants.get": tenant("admin") }).matches("customer-en-390", 390);
  });
});
