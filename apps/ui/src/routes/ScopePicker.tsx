/**
 * Choosing what a connected source may read.
 *
 * This screen is the difference between a consent card that tells the truth and one that
 * does not. The card promises "the documents inside the folders you select, in the file types
 * you allow" and "headers and matching attachments in {{labels}}"; without somewhere to make
 * that selection, connecting Gmail would read an entire mailbox while the screen claimed
 * otherwise.
 *
 * THE TWO SOURCES CHOOSE DIFFERENTLY, AND FOR A REASON WORTH KNOWING.
 *
 * **Gmail** is a list of labels, fetched through the worker because it needs a live token.
 * Choosing none is a *recorded decision* meaning the whole mailbox -- not an empty one --
 * which is why the server refuses a connection with no row at all rather than defaulting it.
 *
 * **Drive** is Google's own Picker, running in the browser. The picks it returns are ids and
 * names, recorded as the scope; what a run then reads is decided by the worker's own
 * `'<id>' in parents` query under the connection's `drive.readonly` grant (ADR 0047), not by
 * what the Picker's browser token can see. The worker can also list folders and file types
 * (`connections.browseScope`) for an agent with no browser; this screen keeps the Picker.
 *
 * `useState` is banned, so the in-progress selection lives in the Zustand store: a draft the
 * user has made and no endpoint knows about is exactly what the store is for.
 *
 * ## The labels are an INDEX, not a list
 *
 * A mailbox with sixty labels, set as one column of stacked checkboxes, is not a long screen
 * -- it is a broken one: the fieldset grew without limit, pushed SAVE past the fold, and left
 * two thirds of the leaf blank beside it. A reference manual does not set an index that way.
 * It sets it in columns, bounded by the height of the leaf it is printed on, with a running
 * head over each continued column, and it puts the entries somebody came to look up first.
 * `@/lib/labelIndex` decides the runs and their order; this file gives them their words.
 *
 * ## What will be read is said WHILE it is being chosen
 *
 * "Choosing no label means the whole mailbox" is printed above the list, and a hint above a
 * long list is read once and then scrolled away from. So the consequence also stands beneath
 * the control, as a line that changes as the ticks change, in the consent card's own
 * sentence -- what an admin reads while choosing is verbatim what the record says
 * afterwards. It carries `role="status"`, so a screen reader is told the same thing at the
 * same moment instead of being left to infer it from a checkbox.
 *
 * Every label ticked is said in words of its own, never as the whole-mailbox sentence: the
 * worker queries each chosen label and keeps only mail carrying one of them
 * (`apps/worker/src/services/google/gmail.ts`), so a full list is closed and a label created
 * later is not in it. `ChoiceEcho` owns the three states for every list.
 *
 * **Xero** is a third shape: one consent can see several organisations, and the platform
 * must be told which one rather than guess. The list comes through the worker like Gmail's
 * labels; the choice is one organisation and any number of the spec's entities, where none
 * means all of them, as with Gmail.
 *
 * **HubSpot** is a fourth, and the one whose empty choice is the NARROW reading: per CRM object,
 * the further properties to read beyond the spec's own, listed live from the portal (its own
 * properties included) through the worker. `HubspotChoice` says why. ADR 0052.
 *
 * ## Two steps: choose, then review and save
 *
 * Save is on a second step, `?step=review`, which sets what is saved beside what will apply
 * (`@/lib/scopeChange`) and names what leaves the scope, so the consequence is read before the
 * press rather than inferred from ticks. The step is in the address, so Back returns to the
 * choices; the draft is in the store, so the choices are still there when it does. Discard, on
 * either step, puts the draft back to what is stored and returns to the schedule.
 *
 * ## What saving does to what the lake already holds is said beside Save
 *
 * Dropping a folder from a Drive pick and dropping a label from a Gmail scope look like the same
 * gesture and are not: the next complete Drive read marks what the pick no longer reaches as
 * deleted at source (ADR 0071, 0078), and a Gmail message that stops matching a label is left
 * live, because it was relabelled, not deleted (`settleWalk.ts`). So the sentence beside Save
 * says which, for this kind, and never that anything leaves the lake -- a mark at source is not
 * an erasure. Xero and HubSpot get no sentence until what their next read does has been
 * confirmed against the read itself (ADR 0091); what leaves their scope is still named, because
 * that is a fact of the choice and not a claim about the read.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import type { Connection, Source } from "@/api/types.ts";
import { DriveChoice } from "@/components/DriveChoice.tsx";
import { Errata, type ServerError } from "@/components/Errata.tsx";
import { FileTypeChoice } from "@/components/FileTypeChoice.tsx";
import { GmailChoice } from "@/components/GmailChoice.tsx";
import { HubspotChoice } from "@/components/HubspotChoice.tsx";
import { type SaveHold, ScopeActions, ScopeReview, ScopeSteps } from "@/components/ScopeSteps.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { XeroChoice } from "@/components/XeroChoice.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import type { ListedItem } from "@/lib/hubspotProperties.ts";
import { isBrowsedLabel } from "@/lib/labelIndex.ts";
import { sourceLabel } from "@/lib/runs.ts";
import { storedDraft } from "@/lib/scopeChange.ts";
import { type ScopeDraft, useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** Which lead each source's picker opens with. */
const LEAD_KEY = {
  gmail: "scopePicker.leadGmail",
  drive: "scopePicker.leadDrive",
  xero: "scopePicker.leadXero",
  hubspot: "scopePicker.leadHubspot",
} as const;

/** Sources whose choices are listed by the worker, because listing needs a live token. */
const BROWSED: ReadonlySet<Source> = new Set<Source>(["gmail", "xero", "hubspot"]);

/** An empty choice, for a source whose draft has not been made yet. */
const NOTHING_CHOSEN: Omit<ScopeDraft, "source"> = {
  labels: [],
  files: [],
  organisation: null,
  entities: [],
  fileTypes: [],
  recurse: false,
  properties: {},
};

/** The step the address names. Anything but `review` is the choices, never a guess at a third. */
const STEP_PARAM = "step";
const REVIEW_STEP = "review";

/** Which step the address is at, and where each step is: this screen's path, with or without it. */
function useScopeStep(): { review: boolean; paths: { choose: string; review: string } } {
  const [params] = useSearchParams();
  const here = useLocation().pathname;
  return {
    review: params.get(STEP_PARAM) === REVIEW_STEP,
    paths: { choose: here, review: `${here}?${STEP_PARAM}=${REVIEW_STEP}` },
  };
}

/**
 * What the worker lists for this source to choose from, whether it is still coming, and why it
 * did not come. Drive is chosen in Google's Picker on this screen; its server listing (ADR 0047)
 * serves an agent at the CLI, which has no browser, and this screen does not ask for it.
 */
function useBrowse(
  tenantId: string,
  source: string,
  kind: Source,
): { pending: boolean; items: readonly ListedItem[]; error: ServerError | null } {
  const browsed = BROWSED.has(kind);
  const listing = trpc.connections.browseScope.useQuery({ tenantId, source }, { enabled: browsed });
  return {
    pending: browsed && listing.isPending,
    items: listing.data?.items ?? [],
    error: listing.isError ? listing.error : null,
  };
}

/** Seed the draft from what is already stored, once the grants arrive. */
function useStoredScope(source: string, current: Connection | undefined): void {
  const setDraft = useUiStore((s) => s.setScopeDraft);

  useEffect(() => {
    if (current !== undefined) {
      setDraft(storedDraft(source, current));
    }
  }, [current, source, setDraft]);
}

/**
 * Put the draft back to what is stored and return to the schedule. The draft is re-seeded
 * rather than left behind, so the store holds nothing the reader chose to throw away.
 */
function useDiscard(tenantId: string, source: string, current: Connection | undefined): () => void {
  const navigate = useNavigate();
  const setDraft = useUiStore((s) => s.setScopeDraft);

  return (): void => {
    if (current !== undefined) {
      setDraft(storedDraft(source, current));
    }
    void navigate(divisionPath("sources", tenantId));
  };
}

/**
 * What gets recorded, in the shape `connections.setScope` validates for this source.
 *
 * Gmail's labels travel by id as well as by name: the id is what a run asks Gmail for, and a
 * selection recorded by name alone would start reading nothing the day a label is renamed.
 */
function selectionFor(
  kind: Source,
  chosen: Omit<ScopeDraft, "source">,
  items: readonly { id: string; name: string }[],
): unknown {
  if (kind === "gmail") {
    return {
      labels: chosen.labels.map((name) => ({
        id: items.find((i) => i.name === name)?.id ?? name,
        name,
      })),
      fileTypes: chosen.fileTypes,
    };
  }
  if (kind === "xero") {
    return { organisation: chosen.organisation, entities: chosen.entities };
  }
  if (kind === "hubspot") {
    return { properties: chosen.properties };
  }
  return { files: chosen.files, fileTypes: chosen.fileTypes, recurse: chosen.recurse };
}

/**
 * Record the selection, then go back to the schedule -- showing the account just scoped.
 *
 * For a mailbox added a moment ago that last part matters: without it the schedule would open
 * on the kind's FIRST account, and the one the admin has just finished setting up would be a
 * click away and easy to take for not having worked.
 */
function useSaveScope(
  tenantId: string,
  kind: Source,
  source: string,
): ReturnType<typeof trpc.connections.setScope.useMutation> {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const selectAccount = useUiStore((s) => s.selectAccount);

  return trpc.connections.setScope.useMutation({
    onSuccess: async () => {
      selectAccount(tenantId, kind, source);
      await utils.connections.list.invalidate({ tenantId });
      // `navigate` returns a promise in react-router 7; nothing here waits on the
      // transition, and the component unmounts when it lands.
      void navigate(divisionPath("sources", tenantId));
    },
  });
}

/**
 * Why Save must wait, or null when it need not. Two things hold it back, and a HubSpot choice of
 * any size is not one of them -- its properties travel in a batch read's body, not in a URL
 * (ADR 0054). A reason rather than a yes, so the plates can say which.
 *
 * A list that did not load: nothing was on screen to choose from, so the draft is not a choice
 * anybody made. For Gmail it is worse than empty -- no label is a RECORDED decision meaning the
 * whole mailbox, and one press recorded exactly that from a screen whose only content was an
 * error (issue 213). A deliberate empty choice from a list that DID load still saves as the
 * whole mailbox.
 *
 * Xero without an organisation: the server would refuse it, and saying so beforehand is cheaper
 * than the errata after.
 */
function saveHeldBack(
  kind: Source,
  listFailed: boolean,
  chosen: Omit<ScopeDraft, "source">,
): SaveHold | null {
  if (BROWSED.has(kind) && listFailed) {
    return "list";
  }
  return kind === "xero" && chosen.organisation === null ? "organisation" : null;
}

/**
 * The picker for one connection.
 *
 * `kind` decides the SHAPE of the choice -- the lead, which picker, what gets recorded -- and
 * `source` decides WHICH connection it is recorded against: since ADR 0043 a tenant may hold
 * two mailboxes, and they are scoped one at a time. The band is headed "Gmail · ops@acme.test"
 * once the tenant holds two, because an admin scoping one of them has to be able to see WHICH.
 */
export function ScopePicker({
  tenantId,
  source,
  kind,
}: {
  tenantId: string;
  source: string;
  /** What `source` is. The route has already read it off the URL. */
  kind: Source;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { review, paths } = useScopeStep();
  const draft = useUiStore((s) => s.scopeDraft);
  const connections = trpc.connections.list.useQuery({ tenantId });
  const listing = useBrowse(tenantId, source, kind);
  const setScope = useSaveScope(tenantId, kind, source);
  const current = connections.data?.find((c) => c.source === source);
  const discard = useDiscard(tenantId, source, current);

  useStoredScope(source, current);

  if (connections.isPending || listing.pending) {
    return <Skeleton rows={4} />;
  }

  if (connections.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("sources.notLoaded")}
      </Errata>
    );
  }

  const chosen = draft?.source === source ? draft : NOTHING_CHOSEN;
  const selection = selectionFor(kind, chosen, listing.items);

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <ScopeLead kind={kind} review={review} />

      <div className="band-rule" />

      <div className="head">{sourceLabel(source, connections.data)}</div>
      <div className="body stack">
        <ScopeAccount source={source} account={current?.externalAccountLabel ?? ""} />
        <ScopeSteps paths={paths} review={review} />

        {review ? (
          <ScopeReview
            kind={kind}
            saved={current?.config ?? {}}
            chosen={chosen}
            loadError={listing.error}
          />
        ) : (
          <SourceChoice
            kind={kind}
            source={source}
            account={current?.externalAccountLabel ?? ""}
            items={listing.items}
            loadError={listing.error}
            chosen={chosen}
          />
        )}

        <ScopeActions
          paths={paths}
          review={review}
          heldBack={saveHeldBack(kind, listing.error !== null, chosen)}
          saving={setScope.isPending}
          saveError={setScope.isError ? setScope.error : null}
          onSave={(): void => {
            setScope.mutate({ tenantId, source, selection });
          }}
          onDiscard={discard}
        />
      </div>
    </div>
  );
}

/**
 * Which account this edit is for, and its source ID: fixed for the whole edit, so it is said
 * once above both steps rather than left for the reader to infer from the margin head.
 */
function ScopeAccount({ source, account }: { source: string; account: string }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div className="stack stack--tight">
      <span className="label">{t("scopePicker.accountFor")}</span>
      <p className="datum">{account === "" ? source : `${account} · ${source}`}</p>
    </div>
  );
}

/**
 * What this source is about to be asked, in the words its own consent card uses. The hints on
 * what an empty choice means belong beside the choices, so the review step leaves them out.
 */
function ScopeLead({ kind, review }: { kind: Source; review: boolean }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="body stack">
      <h1>{t("scopePicker.title")}</h1>
      <p className="prose prose--lead">{t(LEAD_KEY[kind])}</p>

      {!review && kind === "gmail" ? (
        <p className="note">{t("scopePicker.wholeMailboxHint")}</p>
      ) : null}
      {!review && kind === "xero" ? (
        <p className="note">{t("scopePicker.xeroEntitiesHint")}</p>
      ) : null}
      {!review && kind === "hubspot" ? (
        <p className="note">{t("scopePicker.hubspotStandardHint")}</p>
      ) : null}
    </div>
  );
}

/**
 * Which picker this source gets. Four shapes, for the four reasons the file header gives.
 *
 * Drive is never listed by the worker, so a browse error is not its error to report.
 */
function SourceChoice({
  kind,
  source,
  account,
  items,
  loadError,
  chosen,
}: {
  kind: Source;
  source: string;
  /** The connection's account address, or `""` when none is recorded. */
  account: string;
  items: readonly ListedItem[];
  loadError: ServerError | null;
  chosen: Omit<ScopeDraft, "source">;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  if (loadError !== null && BROWSED.has(kind)) {
    return <Errata heading={t("common.notLoaded")} live={true} error={loadError} />;
  }
  if (kind === "hubspot") {
    return <HubspotChoice source={source} items={items} chosen={chosen.properties} />;
  }
  const labels = items.filter(isBrowsedLabel);
  if (kind === "xero") {
    return (
      <XeroChoice
        source={source}
        organisations={labels}
        organisation={chosen.organisation}
        entities={chosen.entities}
      />
    );
  }
  if (kind === "gmail") {
    return (
      <>
        <GmailChoice source={source} items={labels} chosen={chosen.labels} />
        <FileTypeChoice source={source} fileTypes={chosen.fileTypes} />
      </>
    );
  }
  if (kind === "drive") {
    return (
      <>
        <DriveChoice source={source} account={account} chosen={chosen} />
        <FileTypeChoice source={source} fileTypes={chosen.fileTypes} />
      </>
    );
  }
  return null;
}
