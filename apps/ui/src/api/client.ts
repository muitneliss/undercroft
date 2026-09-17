/**
 * The HTTP client.
 *
 * Same-origin, cookie-authenticated, and deliberately thin. Two behaviours are
 * worth knowing:
 *
 * A **401 is not an error to display** -- it means "not signed in", and the app
 * routes to the sign-in screen rather than showing a red box on every panel.
 *
 * A **404 on a tenant means "you cannot see this"**, which the API returns
 * instead of 403 so that tenant existence does not leak. The UI must therefore
 * not say "this tenant does not exist"; it says the user does not have access,
 * which is true either way.
 */

import type {
  Connection,
  LakeManifests,
  LakeObject,
  Member,
  SessionUser,
  Source,
  Tenant,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail || `request failed with ${status}`);
    this.name = "ApiError";
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403 || this.status === 404;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let detail = "";
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "detail" in body) {
        detail = String(body.detail);
      }
    } catch {
      detail = "";
    }
    throw new ApiError(response.status, detail);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  session: () => request<SessionUser>("/api/auth/session"),
  logout: () => request<{ signed_out: boolean }>("/api/auth/logout", { method: "POST" }),

  tenants: () => request<Tenant[]>("/api/tenants"),
  tenant: (id: string) => request<Tenant>(`/api/tenants/${id}`),
  createTenant: (displayName: string) =>
    request<Tenant>("/api/tenants", {
      method: "POST",
      body: JSON.stringify({ display_name: displayName }),
    }),

  connections: (tenantId: string) => request<Connection[]>(`/api/tenants/${tenantId}/connections`),

  saveConfig: (
    tenantId: string,
    source: Source,
    config: {
      folder_ids?: string[];
      labels?: string[];
      entities?: string[];
      schedule_cron?: string;
    },
  ) =>
    request<Connection>(`/api/tenants/${tenantId}/connections/${source}/config`, {
      method: "PUT",
      body: JSON.stringify({
        folder_ids: config.folder_ids ?? [],
        labels: config.labels ?? [],
        entities: config.entities ?? [],
        schedule_cron: config.schedule_cron ?? "",
      }),
    }),

  disconnect: (tenantId: string, source: Source) =>
    request<void>(`/api/tenants/${tenantId}/connections/${source}`, { method: "DELETE" }),

  /**
   * A full-page navigation, not a fetch: the browser has to follow the redirect
   * to the provider's consent screen, and an XHR cannot.
   */
  authorizeUrl: (tenantId: string, source: Source) =>
    `/api/tenants/${tenantId}/connections/${source}/authorize`,

  /**
   * Start a sync now.
   *
   * Returns only a handle. Since ADR 0007 removed the run ledger there is no
   * history to poll afterwards -- the worker holds the live status in memory and
   * loses it on restart, so the UI reports that a sync started and nothing more.
   *
   * !! NOT IMPLEMENTED BY THE API. No router in `vcdo/api/routers/` serves
   * `POST /api/tenants/{id}/runs`; the registered routers are auth, tenants,
   * connections, oauth, lake and users. The in-memory server in `@/test/server`
   * DOES implement it, which is why the suite stays green over a call that fails
   * against the real service -- precisely the failure `.claude/rules/ui.md`
   * warns about when it says a fake that never refuses makes a broken boundary
   * look fine. The UI behaviour here is the intended one and is pinned by
   * `TenantOverview.test.tsx`; the missing piece is the endpoint.
   */
  startRun: (tenantId: string) =>
    request<{ run_id: string; status: string }>(`/api/tenants/${tenantId}/runs`, {
      method: "POST",
    }),

  lake: (tenantId: string, prefix = "") =>
    request<LakeObject[]>(`/api/tenants/${tenantId}/lake?prefix=${encodeURIComponent(prefix)}`),

  /** The manifests for one object: provenance, without the payload. */
  lakeObject: (tenantId: string, key: string) =>
    request<LakeManifests>(`/api/tenants/${tenantId}/lake/object?key=${encodeURIComponent(key)}`),

  /**
   * Where the bytes are.
   *
   * A link, not a fetch: the response is a file download. It is admin-only and
   * written to the audit log server-side, because these are the customer's
   * invoices and email attachments -- so the interface states that before the
   * click rather than after it.
   */
  lakeDownloadUrl: (tenantId: string, key: string, stamp?: string) => {
    const at = stamp ? `&stamp=${encodeURIComponent(stamp)}` : "";
    return `/api/tenants/${tenantId}/lake/download?key=${encodeURIComponent(key)}${at}`;
  },

  members: (tenantId: string) => request<Member[]>(`/api/tenants/${tenantId}/members`),

  /** The token comes back exactly once; only its digest is stored. */
  invite: (tenantId: string, email: string, role: string) =>
    request<{ token: string; expires_in_days: number }>(
      `/api/tenants/${tenantId}/members/invitations`,
      { method: "POST", body: JSON.stringify({ email, role }) },
    ),

  removeMember: (tenantId: string, userId: string) =>
    request<void>(`/api/tenants/${tenantId}/members/${userId}`, { method: "DELETE" }),
};
