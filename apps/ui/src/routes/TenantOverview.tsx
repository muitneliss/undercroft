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
 *
 * `DisplayNameForm` at the foot is here rather than on the customers list because it acts on
 * ONE customer and this is that customer's page. Until it existed a mistyped name was
 * permanent: `tenants.create` was the only writer of `ops.tenant`, so the typo outlived the
 * mistake. It changes the label and nothing else -- the tenant id is not an input to
 * `tenants.rename` at all, because it is an object-key prefix in the create-only raw lake and
 * changing it would strand every byte already written under the old one.
 */

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { Connection } from "@/api/types.ts";
import { ConnectionCard } from "@/components/ConnectionCard.tsx";
import { DisplayNameForm } from "@/components/DisplayNameForm.tsx";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { trpc } from "@/trpc.ts";

/**
 * Which sentence a failed consent gets, from the reason the callback redirected with.
 *
 * Three outcomes rather than two. `scope-declined` is not a cancellation: the admin pressed
 * Allow with the one permission that matters unticked, which Google accepts and we refuse.
 * Told only "this source could not be connected", they repeat the exact steps that produced
 * it -- so the case that names the tick to leave alone has to be its own sentence.
 *
 * A function rather than a chain inside the JSX, because it is a decision with a name and
 * the compiler checks each key against the catalogue.
 */
function connectFailureKey(
  reason: string | null,
): "grant.connectDeclined" | "grant.connectScopeDeclined" | "grant.connectFailed" {
  if (reason === "declined") {
    return "grant.connectDeclined";
  }
  if (reason === "scope-declined") {
    return "grant.connectScopeDeclined";
  }
  return "grant.connectFailed";
}

export function TenantOverview({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const utils = trpc.useUtils();
  const connections = trpc.connections.list.useQuery({ tenantId });
  const tenant = trpc.tenants.get.useQuery({ tenantId });

  async function invalidate(): Promise<void> {
    await utils.connections.list.invalidate({ tenantId });
  }

  const startOAuth = trpc.connections.startOAuth.useMutation({
    onSuccess: (result) => {
      globalThis.location.assign(result.authorizeUrl);
    },
  });
  const disconnect = trpc.connections.disconnect.useMutation({ onSuccess: invalidate });

  if (connections.isPending || tenant.isPending) {
    return <Skeleton rows={5} />;
  }

  if (connections.isError || tenant.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
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
          <Errata heading={t("grant.connectFailed")} live={true}>
            {t(connectFailureKey(params.get("reason")))}
          </Errata>
        ) : null}

        {/*
          A refusal to START a consent, which the server now words rather than answering with
          a URL it made up. Without this the navigation below simply never happened and the
          page sat there looking like a dead button.
        */}
        {startOAuth.isError ? (
          <Errata heading={t("grant.connectFailed")} live={true}>
            {startOAuth.error.message}
          </Errata>
        ) : null}

        {disconnect.isError ? (
          <Errata heading={t("grant.disconnectFailed")} live={true}>
            {disconnect.error.message}
          </Errata>
        ) : null}

        {disconnect.isSuccess && !disconnect.data.revokedUpstream ? (
          // Reported, never assumed: our row is gone but the grant may still stand at
          // Google, and only the customer can finish that.
          <Errata heading={t("grant.disconnected")} live={true}>
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
                onConnect={(): void => {
                  startOAuth.mutate({ tenantId, source: connection.source });
                }}
                onScope={(): void => {
                  globalThis.location.assign(
                    `${divisionPath("sources", tenantId)}/connect/${connection.source}/scope`,
                  );
                }}
                onDisconnect={(): void => {
                  disconnect.mutate({ tenantId, source: connection.source });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="band-rule" />

      <div className="head">{t("tenants.renameHead")}</div>
      <div className="body stack">
        <DisplayNameForm
          canEdit={isAdmin}
          displayName={tenant.data.displayName}
          tenantId={tenantId}
        />
      </div>
    </div>
  );
}
