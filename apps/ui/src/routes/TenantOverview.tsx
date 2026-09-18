/**
 * The sources division: the schedule of standing grants.
 *
 * The schedule IS the product -- the screen a new customer lands on is the one an established
 * one uses -- and every source appears whether or not it has ever been connected, because a
 * blank page is not a starting position. The server synthesises the absent ones; see
 * `services/connections.ts`.
 *
 * Each row is a `ConnectionCard`, which states what will be read and what will never be
 * written BEFORE the redirect, not on a help page nobody opens. This route's job is to hand
 * it a grant and three actions and otherwise stay out of the way.
 *
 * Connecting navigates the whole window rather than opening a tab: the consent ends at
 * Google's screen and returns through a server redirect, so a same-tab journey is the one the
 * person is already on. A failed return lands back here with `?connect=failed`, read from the
 * URL rather than from state -- the browser left and came back, and there is no state left.
 */

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { Connection } from "@/api/types";
import { ConnectionCard } from "@/components/ConnectionCard";
import { Errata } from "@/components/Errata";
import { Skeleton } from "@/components/Skeleton";
import { divisionPath } from "@/lib/divisions";
import { trpc } from "@/trpc";

export function TenantOverview({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const utils = trpc.useUtils();
  const connections = trpc.connections.list.useQuery({ tenantId });
  const tenant = trpc.tenants.get.useQuery({ tenantId });

  const invalidate = async () => {
    await utils.connections.list.invalidate({ tenantId });
  };

  const startOAuth = trpc.connections.startOAuth.useMutation({
    onSuccess: (result) => {
      window.location.assign(result.authorizeUrl);
    },
  });
  const disconnect = trpc.connections.disconnect.useMutation({ onSuccess: invalidate });

  if (connections.isPending || tenant.isPending) {
    return <Skeleton rows={5} />;
  }

  if (connections.isError || tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live>
        {t("sources.notLoaded")}
      </Errata>
    );
  }

  const list = connections.data;
  // Hiding is courtesy; the server refuses regardless. A viewer sees the schedule and no
  // live buttons, which is the honest rendering of what they may do.
  const isAdmin = tenant.data.role === "admin";
  const failed = params.get("connect") === "failed";

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <div className="body stack">
        <h1>{t("sources.title")}</h1>
        <p className="prose prose--lead">
          {list.length === 0 ? t("sources.none") : t("sources.count", { count: list.length })}
        </p>

        {failed ? (
          <Errata heading={t("grant.connectFailed")} live>
            {params.get("reason") === "declined"
              ? t("grant.connectDeclined")
              : t("grant.connectFailed")}
          </Errata>
        ) : null}

        {disconnect.isError ? (
          <Errata heading={t("grant.disconnectFailed")} live>
            {disconnect.error.message}
          </Errata>
        ) : null}

        {disconnect.isSuccess && !disconnect.data.revokedUpstream ? (
          // Reported, never assumed: our row is gone but the grant may still stand at
          // Google, and only the customer can finish that.
          <Errata heading={t("grant.disconnected")} live>
            {t("grant.disconnectedNotRevoked")}
          </Errata>
        ) : null}
      </div>

      <div className="band-rule" />

      <div className="head">{t("sources.grantsHead")}</div>
      <div className="body">
        {list.length === 0 ? (
          <p className="note">{t("common.nothingToShow")}</p>
        ) : (
          <div className="schedule">
            {list.map((connection: Connection) => (
              <ConnectionCard
                key={connection.source}
                connection={connection}
                busy={startOAuth.isPending || disconnect.isPending || !isAdmin}
                onConnect={() => {
                  startOAuth.mutate({ tenantId, source: connection.source });
                }}
                onScope={() => {
                  window.location.assign(
                    `${divisionPath("sources", tenantId)}/connect/${connection.source}/scope`,
                  );
                }}
                onDisconnect={() => {
                  disconnect.mutate({ tenantId, source: connection.source });
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
