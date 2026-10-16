/**
 * The people division, as pictures: the members of Demo Co., read by the operator who is its
 * only admin -- marked "You", offered no lower role and no removal -- and the invitations view,
 * where the open invitation, the invite form and what each role may do stand together; and the
 * customer's activity, one row for each door and outcome (ADR 0113). ADR 0099.
 */

import { PERMISSIONS } from "@undercroft/contracts/access";
import { describe, test as it } from "vitest";

import { builtInRoles } from "@/test/access.ts";
import { ACTIVITY } from "@/test/activityBook.ts";
import { INVITATIONS, MEMBERS, TENANT, tenant } from "@/test/demoBook.ts";
import { type Answers, open } from "@/test/visual.tsx";

const PEOPLE = `/tenants/${TENANT}/people`;

const ANSWERS: Answers = {
  "tenants.get": tenant("admin"),
  "people.members": MEMBERS,
  "people.invitations": INVITATIONS,
  "roles.list": { roles: builtInRoles(), permissions: [...PERMISSIONS] },
  "audit.tenant": ACTIVITY,
};

describe("the members, read by the last admin", () => {
  it("at 1440 px", async () => {
    await open(PEOPLE, "en", ANSWERS).matches("people-members-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(PEOPLE, "en", ANSWERS).matches("people-members-en-390", 390);
  });
});

describe("the invitations and what each role may do", () => {
  it("at 1440 px", async () => {
    await open(`${PEOPLE}?view=invites`, "en", ANSWERS).matches("people-invites-en-1440", 1440);
  });

  it("at 390 px", async () => {
    await open(`${PEOPLE}?view=invites`, "en", ANSWERS).matches("people-invites-en-390", 390);
  });
});

describe("the customer's activity, read by its admin", () => {
  it("at 1440 px", async () => {
    await open(`${PEOPLE}?view=activity`, "en", ANSWERS).matches("people-activity-en-1440", 1440);
  });

  it("in Vietnamese, at 390 px", async () => {
    await open(`${PEOPLE}?view=activity`, "vi", ANSWERS).matches("people-activity-vi-390", 390);
  });
});
