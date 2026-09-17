/**
 * The sources division: the schedule of standing grants.
 *
 * There is no separate onboarding mode and no tour. The schedule IS the product
 * -- it degrades into grant health once every source is granted, so the screen a
 * new customer lands on is the same screen an established one uses. A tutorial
 * disconnected from the real thing goes stale the first time the real thing
 * changes.
 *
 * The aha moment is deliberately not "connected". A checkbox is not value; a
 * sync that actually ran is. So the run action appears the moment one source
 * works, rather than being buried on another screen.
 *
 * ADR 0007 removed the run ledger, so there is no history to show afterwards.
 * That makes the confirmation below load-bearing rather than decorative: a
 * button that reports nothing when pressed is indistinguishable from a button
 * that does nothing.
 *
 * WHAT LEADS. When any grant has lapsed, the errata slip is the first thing on
 * the leaf, above the schedule and above the heading's own summary. A lapsed
 * grant is the state that actually happens in production -- Xero's refresh token
 * dies after 60 days unused, a customer revokes from their own account page, and
 * a Testing-status Google token lasts a week -- and it is the only reason an
 * operator opens this screen in a hurry.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import type { Connection, Source } from "@/api/types";
import { SOURCE_LABEL } from "@/api/types";
import { ConnectionCard } from "@/components/ConnectionCard";
import { Errata } from "@/components/Errata";
import { ArrowRight } from "@/components/Icon";
import { Skeleton } from "@/components/Skeleton";
import { presentConnection, setupProgress } from "@/lib/connectionState";
import { formatCount } from "@/lib/money";
import { ScopePanel } from "@/routes/ScopePanel";

export function TenantOverview({
  tenantId,
  scopeFor,
}: {
  tenantId: string;
  /** The source whose scope leaf is hinged open, from the route. */
  scopeFor?: Source;
}) {
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
    return <Skeleton rows={5} />;
  }

  if (connections.isError) {
    return (
      <Errata heading="Not loaded" live>
        This customer’s grants could not be loaded, or you do not have access to them.
        Nothing has been changed.
      </Errata>
    );
  }

  const list: Connection[] = connections.data;
  const progress = setupProgress(list);
  const anyConnected = progress.done > 0;
  const lapsed = list.filter((c) => presentConnection(c).mark === "lapsed");

  return (
    <div className="sheet">
      <div className="head head--division">Sources</div>
      <div className="body stack">
        <h1>{progress.finished ? "Connected sources" : "Finish setting up"}</h1>

        <p className="prose prose--lead">
          {progress.finished
            ? "All four sources are connected and syncing."
            : `${formatCount(progress.done)} of ${formatCount(progress.total)} connected. Connect a source to start bringing data in.`}
        </p>

        {!progress.finished ? (
          <div
            className="gathering"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-label="Setup progress"
          >
            {/* Scaled, not resized: see `.gathering__inked`. */}
            <span
              className="gathering__inked"
              style={{
                transform: `scaleX(${String(progress.done / Math.max(progress.total, 1))})`,
              }}
            />
          </div>
        ) : null}

        {/* Terse, and it CARRIES its recovery rather than describing one. An
            errata slip that says "re-granted below" makes the reader hunt for
            the thing the slip exists to hand them; the explanation still lives
            on the row, so the two do not compete. */}
        {lapsed.length > 0 ? (
          <Errata
            heading={lapsed.length === 1 ? "One grant has lapsed" : "Grants have lapsed"}
            action={
              <div className="row">
                {lapsed.map((c) => (
                  <button
                    key={c.source}
                    className="plate plate--primary"
                    onClick={() => {
                      window.location.assign(api.authorizeUrl(tenantId, c.source));
                    }}
                  >
                    Re-grant {SOURCE_LABEL[c.source]}
                    <ArrowRight size={13} />
                  </button>
                ))}
              </div>
            }
          >
            {lapsed.map((c) => SOURCE_LABEL[c.source]).join(", ")}. This customer’s data has
            stopped moving, and nothing has been lost — re-granting resumes where the last
            sync finished.
          </Errata>
        ) : null}

      </div>

      <div className="band-rule" />

      <div className="head">Grants</div>
      <div className="body">
        <div className="schedule">
          {list.map((connection) => (
            <div key={connection.source}>
              <ConnectionCard
                connection={connection}
                busy={disconnect.isPending}
                onConnect={() => {
                  // A full-page navigation, not a fetch: the browser has to
                  // follow the redirect to the provider's consent screen.
                  window.location.assign(api.authorizeUrl(tenantId, connection.source));
                }}
                onScope={() =>
                  void navigate(`/tenants/${tenantId}/connect/${connection.source}/scope`)
                }
                onDisconnect={() => disconnect.mutate(connection.source)}
              />

              {/* The hinge: the scope leaf turns down inside its own row, so the
                  rest of the schedule stays on screen, in the document and in
                  the tab order. `.claude/rules/ui.md` decided this is not a
                  modal, and this is what that looks like in this world. */}
              {scopeFor === connection.source ? (
                <ScopePanel tenantId={tenantId} source={connection.source} />
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/*
       * Running a sync now sits at the FOOT of the schedule, not in the header.
       *
       * Two reasons, both learned from seeing it in the header. It read as a
       * peer of the errata slip's RE-GRANT, which is the one action on this
       * screen that must not have a peer; and the thing it acts on is the
       * schedule, so it belongs after the schedule rather than before it.
       */}
      {anyConnected ? (
        <>
          <div className="band-rule" />
          <div className="head">Run now</div>
          <div className="body stack">
            <div className="row">
              <button
                className="plate"
                onClick={() => startRun.mutate()}
                disabled={startRun.isPending}
              >
                {startRun.isPending ? "Starting…" : "Run sync now"}
              </button>
            </div>

            {/*
             * Disclosed BEFORE the click, not discovered by it.
             *
             * `POST /api/tenants/{id}/runs` is not implemented by any router (see
             * `@/api/client`), so this action fails. An enabled plate identical
             * to every working plate in the product reads as a working trigger,
             * and learning otherwise by pressing it is not disclosure. The
             * action and its tests stay because the product intent is real and
             * ADR-reasoned; what is missing is the endpoint, and saying so here
             * is the honest resting state until it exists.
             */}
            <p className="note">
              Not available yet — the control plane has no endpoint for starting a run, so
              this reports a failure. Each source syncs on its own schedule in the meantime.
            </p>

            {startRun.isError ? (
              <Errata heading="Not started" live>
                {startRun.error instanceof Error && startRun.error.message.includes("already")
                  ? "A sync is already running. It will finish shortly."
                  : "The sync could not be started."}
              </Errata>
            ) : null}

            {startRun.isSuccess ? (
              <p className="note" role="status">
                Sync started. It runs in the background and usually takes a few minutes; the
                data appears in the dashboards once it finishes. There is no run history to
                follow — this message is the whole of the confirmation.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
