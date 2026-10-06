/**
 * Demo Co.'s audit log (ADR 0113), as the People division's Activity view reads it -- beside
 * `demoBook.ts`, whose people did these things, and like `modelsBook.ts` its own file.
 *
 * Every value is invented (`.claude/rules/pii.md`); times sit a little before `VISUAL_NOW`.
 */

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@undercroft/control-plane/router";

import { TENANT } from "@/test/demoBook.ts";

type Out = inferRouterOutputs<AppRouter>;

/**
 * What was done in Demo Co. lately, newest first (ADR 0113): a sync an agent started over MCP, a
 * role the operator changed in the browser, a write a read-only token was refused, and an
 * invitation accepted at sign-in -- one row for each door and each outcome the table prints.
 */
export const ACTIVITY: Out["audit"]["tenant"] = {
  items: [
    {
      id: "41",
      at: "2026-09-29T09:12:00Z",
      tenantId: TENANT,
      actor: "operator@example.test",
      userId: "user-1",
      channel: "mcp",
      credential: "upat_demo0001",
      action: "runs.trigger",
      outcome: "ok",
      reason: null,
      detail: { source: "xero", runId: "run-0101" },
    },
    {
      id: "40",
      at: "2026-09-29T08:47:00Z",
      tenantId: TENANT,
      actor: "operator@example.test",
      userId: "user-1",
      channel: "web",
      credential: null,
      action: "people.setRole",
      outcome: "ok",
      reason: null,
      detail: { email: "analyst@example.test", role: "member", previousRole: "viewer" },
    },
    {
      id: "39",
      at: "2026-09-29T08:30:00Z",
      tenantId: TENANT,
      actor: "analyst@example.test",
      userId: "user-2",
      channel: "mcp",
      credential: "upat_demo0002",
      action: "models.save",
      outcome: "refused",
      reason: "WRITES_DISABLED",
      detail: {},
    },
    {
      id: "38",
      at: "2026-09-28T16:05:00Z",
      tenantId: TENANT,
      actor: "reader@example.test",
      userId: "user-3",
      channel: null,
      credential: null,
      action: "auth.invitationRedeemed",
      outcome: "ok",
      reason: null,
      detail: { role: "viewer" },
    },
  ],
  nextCursor: null,
};
