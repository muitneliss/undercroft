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

// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: An inline submit handler on a single form. The re-render the rule is about matters under a memoised list of hundreds; this is one <form>.
// biome-ignore-all lint/style/useGlobalThis: Reading `process` in a composition root on Bun, where it is the documented global.
// biome-ignore-all lint/style/useNamingConvention: Every name this fires on is an identifier owned by something outside this repo, and renaming it would break the call: Postgres column names (tenant_id, expires_at, display_name), the AWS S3 SDK command shape (Bucket, Key, Body), Docker's inspect JSON (State, Status, ExitCode, Config, Image), a source API's payload keys (Invoices, InvoiceID), HTTP header names, and Better Auth's option keys (baseURL, storeOTP) and table names (auth_user). strictCase cannot be satisfied by code that talks to another system.

// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { Connection } from "@/api/types.ts";
import { ConnectionCard } from "@/components/ConnectionCard.tsx";
import { DisplayNameForm } from "@/components/DisplayNameForm.tsx";
import { Errata } from "@/components/Errata.tsx";
import { IngestKeys } from "@/components/IngestKeys.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { TokenForm } from "@/components/TokenForm.tsx";
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

/** How often the list re-reads while a run is in progress. A run is minutes; this is not. */
const RUNNING_POLL_MS = 5000;

export function TenantOverview({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const utils = trpc.useUtils();
  const connections = trpc.connections.list.useQuery(
    { tenantId },
    {
      // Live only while something is live: a run in progress is the one state on this page
      // that changes without anybody pressing anything, so the list polls while one exists
      // and stops the moment it ends. Run now therefore has a visible consequence.
      refetchInterval: (query) =>
        query.state.data?.some((c) => c.lastRun?.status === "running") === true
          ? RUNNING_POLL_MS
          : false,
    },
  );
  const tenant = trpc.tenants.get.useQuery({ tenantId });

  async function invalidate(): Promise<void> {
    await utils.connections.list.invalidate({ tenantId });
  }

  const startOAuth = trpc.connections.startOAuth.useMutation({
    onSuccess: (result) => {
      window.location.assign(result.authorizeUrl);
    },
  });
  const disconnect = trpc.connections.disconnect.useMutation({ onSuccess: invalidate });
  const runNow = trpc.runs.trigger.useMutation({ onSuccess: invalidate });
  const setCadence = trpc.connections.setCadence.useMutation({ onSuccess: invalidate });

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

        {/* The server's own sentence: a run already in progress, a worker that did not
            answer, a source it refused. Each names its remedy; a local restatement would be
            a second copy to keep in step with the refusal that actually happened. */}
        {runNow.isError ? (
          <Errata heading={t("grant.runNotStarted")} live={true}>
            {runNow.error.message}
          </Errata>
        ) : null}

        {setCadence.isError ? (
          <Errata heading={t("grant.cadenceNotSaved")} live={true}>
            {setCadence.error.message}
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
                tenantId={tenantId}
                connection={connection}
                canRun={isAdmin}
                busy={
                  startOAuth.isPending ||
                  disconnect.isPending ||
                  runNow.isPending ||
                  setCadence.isPending ||
                  !isAdmin
                }
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
                onRun={() => {
                  runNow.mutate({ tenantId, source: connection.source });
                }}
                onCadence={(cadence) => {
                  setCadence.mutate({ tenantId, source: connection.source, cadence });
                }}
                tokenForm={<TokenForm tenantId={tenantId} source={connection.source} />}
              />
            ))}
          </div>
        )}
      </div>

      {/* Keys are minted and revoked by admins; a member or viewer is not shown a band they
          cannot act in, and the server refuses regardless. */}
      {isAdmin ? (
        <>
          <div className="band-rule" />
          <div className="head">{t("keys.head")}</div>
          <div className="body stack">
            <IngestKeys tenantId={tenantId} />
          </div>
        </>
      ) : null}

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
