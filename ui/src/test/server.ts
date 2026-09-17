/**
 * A working in-memory implementation of the control plane API.
 *
 * Not a mock: it enforces the same rules the real service does, against the
 * store in `store.ts`. Above all it reproduces the **404-for-a-tenant-you-cannot-
 * see** behaviour, because a test suite whose fake API always answers is green
 * even when authorisation is broken.
 */

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import type { Connection, Source } from "@/api/types";
import { store } from "./store";

function requireUser() {
  if (!store.user) return HttpResponse.json({ detail: "not signed in" }, { status: 401 });
  return null;
}

/** 404 rather than 403: tenant existence must not leak. */
function requireVisible(tenantId: string) {
  if (!store.visible.has(tenantId)) {
    return HttpResponse.json({ detail: "no such tenant" }, { status: 404 });
  }
  return null;
}

export const handlers = [
  http.get("/api/auth/session", () => {
    const denied = requireUser();
    if (denied) return denied;
    return HttpResponse.json(store.user);
  }),

  http.post("/api/auth/logout", () => {
    store.user = null;
    return HttpResponse.json({ signed_out: true });
  }),

  http.get("/api/tenants", () => {
    const denied = requireUser();
    if (denied) return denied;
    return HttpResponse.json(store.tenants.filter((t) => store.visible.has(t.id)));
  }),

  http.get("/api/tenants/:tenantId", ({ params }) => {
    const tenantId = String(params["tenantId"]);
    const denied = requireUser() ?? requireVisible(tenantId);
    if (denied) return denied;
    const tenant = store.tenants.find((t) => t.id === tenantId);
    if (!tenant) return HttpResponse.json({ detail: "no such tenant" }, { status: 404 });
    return HttpResponse.json(tenant);
  }),

  http.get("/api/tenants/:tenantId/connections", ({ params }) => {
    const tenantId = String(params["tenantId"]);
    const denied = requireUser() ?? requireVisible(tenantId);
    if (denied) return denied;
    return HttpResponse.json(store.connections[tenantId] ?? []);
  }),

  http.put("/api/tenants/:tenantId/connections/:source/config", async ({ params, request }) => {
    const tenantId = String(params["tenantId"]);
    const source = String(params["source"]) as Source;
    const denied = requireUser() ?? requireVisible(tenantId);
    if (denied) return denied;

    const body = (await request.json()) as {
      folder_ids: string[];
      labels: string[];
      entities: string[];
      schedule_cron: string;
    };

    // The real API refuses an unscoped Drive connection, because an unscoped
    // listing copies everything the credential can reach into a create-only lake.
    if (source === "drive" && body.folder_ids.length === 0) {
      return HttpResponse.json({ detail: "choose at least one Drive folder" }, { status: 400 });
    }

    const list = store.connections[tenantId] ?? [];
    const found = list.find((c) => c.source === source);
    if (!found) return HttpResponse.json({ detail: "unknown source" }, { status: 404 });

    const updated: Connection = {
      ...found,
      status: "connected",
      config: {
        folder_ids: body.folder_ids,
        labels: body.labels,
        entities: body.entities,
      },
      schedule_cron: body.schedule_cron,
    };
    store.connections[tenantId] = list.map((c) => (c.source === source ? updated : c));
    return HttpResponse.json(updated);
  }),

  http.delete("/api/tenants/:tenantId/connections/:source", ({ params }) => {
    const tenantId = String(params["tenantId"]);
    const source = String(params["source"]) as Source;
    const denied = requireUser() ?? requireVisible(tenantId);
    if (denied) return denied;

    const list = store.connections[tenantId] ?? [];
    store.connections[tenantId] = list.map((c) =>
      c.source === source
        ? { ...c, status: "disconnected", external_account_label: "", expires_at: null }
        : c,
    );
    return new HttpResponse(null, { status: 204 });
  }),

  http.post("/api/tenants/:tenantId/runs", ({ params }) => {
    const tenantId = String(params["tenantId"]);
    const denied = requireUser() ?? requireVisible(tenantId);
    if (denied) return denied;
    return HttpResponse.json({ run_id: "run-started", status: "running" }, { status: 202 });
  }),

  http.get("/api/tenants/:tenantId/members", ({ params }) => {
    const tenantId = String(params["tenantId"]);
    const denied = requireUser() ?? requireVisible(tenantId);
    if (denied) return denied;
    return HttpResponse.json(store.members[tenantId] ?? []);
  }),

  http.get("/api/tenants/:tenantId/lake", ({ params }) => {
    const tenantId = String(params["tenantId"]);
    const denied = requireUser() ?? requireVisible(tenantId);
    if (denied) return denied;
    return HttpResponse.json([]);
  }),
];

export const server = setupServer(...handlers);
