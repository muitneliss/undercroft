/**
 * The Sources leaf, as a picture: Demo Co.'s seven accounts over four kinds, with the count row
 * and the search above them.
 *
 * Gmail and Google Drive each hold more than one account, so their cards print the account's
 * source ID and carry the switcher; one mailbox needs reconnecting and one Drive account has no
 * scope yet, so both states that need attention are on the page. An admin sees every write plate;
 * a member sees the same schedule with none, which is the design's `10-sources-member.png`.
 *
 * One capture is Vietnamese, at the narrow width, because Vietnamese is the default and its
 * plates run longest: an overflow there is the one an English picture cannot show. ADR 0099.
 */

import { describe, test as it } from "vitest";

import { sourcesAnswers, TENANT } from "@/test/demoBook.ts";
import { open } from "@/test/visual.tsx";

const ADDRESS = `/tenants/${TENANT}`;

describe("the sources leaf, read by an admin", () => {
  it("at 1440 px", async () => {
    await open(ADDRESS, "en", sourcesAnswers("admin")).matches("sources-admin-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(ADDRESS, "en", sourcesAnswers("admin")).matches("sources-admin-en-390", 390);
  });

  it("in Vietnamese, at 390 px", async () => {
    await open(ADDRESS, "vi", sourcesAnswers("admin")).matches("sources-admin-vi-390", 390);
  });
});

describe("the sources leaf, read by a member", () => {
  it("at 1440 px", async () => {
    await open(ADDRESS, "en", sourcesAnswers("member")).matches("sources-member-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(ADDRESS, "en", sourcesAnswers("member")).matches("sources-member-en-390", 390);
  });
});
