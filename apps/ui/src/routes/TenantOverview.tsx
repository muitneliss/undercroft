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
 * A kind that holds several accounts -- two Gmail mailboxes, ADR 0043 -- is still one row: an
 * `AccountSwitcher` above the card says which accounts there are, how each is doing, and which
 * one the card is about, and offers the consent for one more.
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
import { AccountSwitcher } from "@/components/AccountSwitcher.tsx";
import { ConnectionCard, type GrantPending } from "@/components/ConnectionCard.tsx";
import { DisplayNameForm } from "@/components/DisplayNameForm.tsx";
import { Errata } from "@/components/Errata.tsx";
import { IngestKeys } from "@/components/IngestKeys.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { TokenForm } from "@/components/TokenForm.tsx";
import {
  groupByKind,
  type KindAccounts,
  offersAccounts,
  selectedFor,
} from "@/lib/connectionState.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { chosenAccount, useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/**
 * Which sentence a failed consent gets, from the reason the callback redirected with.
 *
 * Three outcomes rather than two. `scope-declined` is not a cancellation: the admin pressed
 * Allow with the one permission that matters unticked, which Google accepts and we refuse.
 * Told only "this source could not be connected", they repeat the exact steps that produced
 * it -- so the case that names the tick to leave alone has to be its own sentence.
 *
 * Two more since a tenant may hold several Google accounts of one kind (ADR 0043), and both
 * are about WHICH account consented rather than whether anybody did. `account-mismatch` is a
 * reconnect finished by somebody else's Google account, or by one already connected under
 * another entry -- most often an admin who meant to add a second mailbox, so its sentence
 * names the plate that does that. `account-unidentified` is Google not saying who consented,
 * and its sentence says the one thing that fixes it.
 *
 * A function rather than a chain inside the JSX, because it is a decision with a name and
 * the compiler checks each key against the catalogue.
 */
function connectFailureKey(
  reason: string | null,
):
  | "grant.connectDeclined"
  | "grant.connectScopeDeclined"
  | "grant.connectAccountMismatch"
  | "grant.connectAccountUnidentified"
  | "grant.connectFailed" {
  switch (reason) {
    case "declined":
      return "grant.connectDeclined";
    case "scope-declined":
      return "grant.connectScopeDeclined";
    case "account-mismatch":
      return "grant.connectAccountMismatch";
    case "account-unidentified":
      return "grant.connectAccountUnidentified";
    default:
      return "grant.connectFailed";
  }
}

/** How often the list re-reads while a run is in progress. A run is minutes; this is not. */
const RUNNING_POLL_MS = 5000;
export function TenantOverview({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params] = useSearchParams();
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

  // Hiding is courtesy; the server refuses regardless. A viewer sees the schedule and no
  // live buttons, which is the honest rendering of what they may do.
  const isAdmin = tenant.data.role === "admin";

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>

      <SourcesBand
        tenantId={tenantId}
        list={connections.data}
        isAdmin={isAdmin}
        failed={params.get("connect") === "failed"}
        reason={params.get("reason")}
      />

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

/** The four mutations a grant can be acted on with, held in one place so a card gets all four. */
interface Actions {
  readonly startOAuth: ReturnType<typeof trpc.connections.startOAuth.useMutation>;
  readonly disconnect: ReturnType<typeof trpc.connections.disconnect.useMutation>;
  readonly runNow: ReturnType<typeof trpc.runs.trigger.useMutation>;
  readonly setCadence: ReturnType<typeof trpc.connections.setCadence.useMutation>;
}

/**
 * The lead, what the last action refused, and the schedule itself.
 *
 * Two bands rather than one because the refusals are read at the top of the page and the
 * grants below the rule -- but they come from the same four mutations, and splitting them
 * into separate components would mean owning those mutations somewhere neither of them is.
 */
function SourcesBand({
  tenantId,
  list,
  isAdmin,
  failed,
  reason,
}: {
  tenantId: string;
  list: readonly Connection[];
  isAdmin: boolean;
  failed: boolean;
  reason: string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  async function invalidate(): Promise<void> {
    await utils.connections.list.invalidate({ tenantId });
  }

  const actions: Actions = {
    startOAuth: trpc.connections.startOAuth.useMutation({
      onSuccess: (result) => {
        globalThis.location.assign(result.authorizeUrl);
      },
    }),
    disconnect: trpc.connections.disconnect.useMutation({ onSuccess: invalidate }),
    runNow: trpc.runs.trigger.useMutation({ onSuccess: invalidate }),
    setCadence: trpc.connections.setCadence.useMutation({ onSuccess: invalidate }),
  };

  return (
    <>
      <div className="body stack">
        <h1>{t("sources.title")}</h1>
        <p className="prose prose--lead">
          {list.length === 0 ? t("sources.none") : t("sources.count", { count: list.length })}
        </p>
        <Refusals actions={actions} failed={failed} reason={reason} />
      </div>

      <div className="band-rule" />

      <div className="head">{t("sources.grantsHead")}</div>
      <div className="body">
        {list.length === 0 ? (
          <p className="note">{t("common.nothingToShow")}</p>
        ) : (
          <SourceCards tenantId={tenantId} list={list} canRun={isAdmin} actions={actions} />
        )}
      </div>
    </>
  );
}

/**
 * Everything this page might have to say it could not do.
 *
 * Each refusal is the SERVER's own sentence -- a run already in progress, a worker that did
 * not answer, a source it refused -- because a local restatement is a second copy to keep in
 * step with the refusal that actually happened.
 */
function Refusals({
  actions,
  failed,
  reason,
}: {
  actions: Actions;
  failed: boolean;
  reason: string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { startOAuth, disconnect, runNow, setCadence } = actions;

  return (
    <>
      {failed ? (
        <Errata heading={t("grant.connectFailed")} live={true}>
          {t(connectFailureKey(reason))}
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
    </>
  );
}

/**
 * The schedule: one row per KIND, each wired to the four mutations.
 *
 * One row per kind rather than per account, so the schedule keeps the shape of the four
 * vendors a customer recognises however many mailboxes they connect. A kind holding several
 * accounts gets a switcher above its card; see `SourceRow`.
 */
function SourceCards({
  tenantId,
  list,
  canRun,
  actions,
}: {
  tenantId: string;
  list: readonly Connection[];
  canRun: boolean;
  actions: Actions;
}): React.JSX.Element {
  const { startOAuth, disconnect, runNow, setCadence } = actions;
  // One action at a time, across every card: the list is about to be invalidated and a
  // second request answers about a schedule that no longer exists. A consent that has been
  // started counts until the browser has left for it (`isSuccess`), not only until the server
  // answered with its address.
  const busy =
    startOAuth.isPending ||
    startOAuth.isSuccess ||
    disconnect.isPending ||
    runNow.isPending ||
    setCadence.isPending ||
    !canRun;

  return (
    <div className="schedule">
      {groupByKind(list).map((group) => (
        <SourceRow
          key={group.kind}
          tenantId={tenantId}
          group={group}
          canRun={canRun}
          busy={busy}
          actions={actions}
        />
      ))}
    </div>
  );
}

/**
 * One kind's row: which of its accounts is on show, and that account's card.
 *
 * The choice is the reader's and lives in the store; the fallback to the first account is
 * derived (`selectedFor`), so disconnecting the chosen account leaves the row showing the next
 * one rather than nothing. Every action on the card sends the card's own `connection.source`,
 * so Run now, Disconnect and the rest act on the account the reader is looking at and never on
 * its sibling.
 *
 * The card is keyed by that source: switching accounts is a different grant, and whatever the
 * card holds open -- a token form, a cadence being chosen -- belonged to the one before.
 */
function SourceRow({
  tenantId,
  group,
  canRun,
  busy,
  actions,
}: {
  tenantId: string;
  group: KindAccounts;
  canRun: boolean;
  busy: boolean;
  actions: Actions;
}): React.JSX.Element {
  const { startOAuth, disconnect, runNow, setCadence } = actions;
  const chosen = useUiStore((state) => chosenAccount(state, tenantId, group.kind));
  const selectAccount = useUiStore((state) => state.selectAccount);
  const connection = selectedFor(group.accounts, chosen);

  return (
    <>
      {offersAccounts(group) ? (
        <AccountSwitcher
          kind={group.kind}
          accounts={group.accounts}
          selected={connection.source}
          onSelect={(source): void => {
            selectAccount(tenantId, group.kind, source);
          }}
          canAdd={canRun}
          busy={busy}
          adding={pendingFor(actions, group.kind, true) === "connect"}
          // The bare kind, never an account's source: adding is a consent for an account
          // nobody here holds yet, and the server resolves which source it lands under.
          onAdd={(): void => {
            startOAuth.mutate({ tenantId, source: group.kind, addAccount: true });
          }}
        />
      ) : null}

      <ConnectionCard
        key={connection.source}
        tenantId={tenantId}
        connection={connection}
        canRun={canRun}
        busy={busy}
        pending={pendingFor(actions, connection.source, false)}
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
        onRun={(): void => {
          runNow.mutate({ tenantId, source: connection.source });
        }}
        onCadence={(cadence): void => {
          setCadence.mutate({ tenantId, source: connection.source, cadence });
        }}
        tokenForm={<TokenForm tenantId={tenantId} source={connection.source} />}
      />
    </>
  );
}

/**
 * Which of `source`'s actions is in flight, read off the mutations' `variables` -- the request
 * each one was last called with -- so no second record of "what was clicked" exists to drift
 * from what was actually sent. A consent counts until the browser has left for it.
 *
 * `addAccount` separates the two consents that can name the same source: the first Gmail
 * account's card and the switcher's "add another" both send `gmail`, and only the one that
 * was pressed should say it is on its way to Google.
 */
function pendingFor(actions: Actions, source: string, addAccount: boolean): GrantPending | null {
  const { startOAuth, disconnect, runNow, setCadence } = actions;
  const consent = startOAuth.isPending || startOAuth.isSuccess ? startOAuth.variables : undefined;
  if (consent?.source === source && (consent.addAccount === true) === addAccount) {
    return "connect";
  }
  if (disconnect.isPending && disconnect.variables.source === source) {
    return "disconnect";
  }
  if (runNow.isPending && runNow.variables.source === source) {
    return "run";
  }
  if (setCadence.isPending && setCadence.variables.source === source) {
    return "cadence";
  }
  return null;
}
