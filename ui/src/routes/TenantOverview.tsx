/**
 * Home for a tenant: the setup checklist, which becomes the health dashboard.
 *
 * There is no separate onboarding mode and no tour. The checklist IS the
 * product — it degrades into run health once every source is connected, so the
 * screen a new customer lands on is the same screen an established one uses. A
 * tutorial disconnected from the real thing goes stale the first time the real
 * thing changes.
 *
 * The aha moment is deliberately not "connected". A checkbox is not value; a
 * sync that actually ran is. So the run action appears the moment one source
 * works, rather than being buried on another screen.
 *
 * ADR 0007 removed the run ledger, so there is no history to show afterwards.
 * That makes the confirmation below load-bearing rather than decorative: a
 * button that reports nothing when pressed is indistinguishable from a button
 * that does nothing.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Connection, Source } from "@/api/types";
import { ConnectionCard } from "@/components/ConnectionCard";
import { Skeleton } from "@/components/Skeleton";
import { setupProgress } from "@/lib/connectionState";
import { formatCount } from "@/lib/money";

export function TenantOverview({ tenantId }: { tenantId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const connections = useQuery({
    queryKey: ["connections", tenantId],
    queryFn: () => api.connections(tenantId),
  });

  const disconnect = useMutation({
    mutationFn: (source: Source) => api.disconnect(tenantId, source),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["connections", tenantId] }),
  });

  const startRun = useMutation({ mutationFn: () => api.startRun(tenantId) });

  if (connections.isPending) {
    return <Skeleton rows={4} />;
  }

  if (connections.isError) {
    return (
      <p className="error-text" role="alert">
        Could not load this tenant’s connections.
      </p>
    );
  }

  const list: Connection[] = connections.data;
  const progress = setupProgress(list);
  const anyConnected = progress.done > 0;

  return (
    <div className="stack">
      <section className="stack">
        <div className="page-header">
          <div>
            <h2>{progress.finished ? "Connected sources" : "Finish setting up"}</h2>
            <p className="page-header__sub">
              {progress.finished
                ? "All four sources are connected and syncing."
                : `${formatCount(progress.done)} of ${formatCount(progress.total)} connected. Connect a source to start bringing data in.`}
            </p>
          </div>
          {anyConnected ? (
            <button
              className="btn btn--primary"
              onClick={() => startRun.mutate()}
              disabled={startRun.isPending}
            >
              {startRun.isPending ? "Starting…" : "Run sync now"}
            </button>
          ) : null}
        </div>

        {!progress.finished ? (
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Setup progress"
          >
            <div
              className="progress__fill"
              style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
        ) : null}

        {startRun.isError ? (
          <p className="error-text" role="alert">
            {startRun.error instanceof Error && startRun.error.message.includes("already")
              ? "A sync is already running. It will finish shortly."
              : "Could not start a sync."}
          </p>
        ) : null}

        <div className="checklist">
          {list.map((connection) => (
            <ConnectionCard
              key={connection.source}
              connection={connection}
              busy={disconnect.isPending}
              onConnect={() => {
                // A full-page navigation, not a fetch: the browser has to follow
                // the redirect to the provider's consent screen.
                window.location.assign(api.authorizeUrl(tenantId, connection.source));
              }}
              onScope={() =>
                void navigate(`/tenants/${tenantId}/connect/${connection.source}/scope`)
              }
              onDisconnect={() => disconnect.mutate(connection.source)}
            />
          ))}
        </div>
      </section>

      {startRun.isSuccess ? (
        <p className="field__hint" role="status">
          Sync started. It runs in the background and usually takes a few minutes; your
          data appears in the dashboards once it finishes.
        </p>
      ) : null}
    </div>
  );
}
