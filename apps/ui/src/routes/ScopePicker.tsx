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
 */

import { MAX_PROPERTY_QUERY_CHARS, overlongPropertyChoices } from "@undercroft/contracts/scope";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { Connection, Source } from "@/api/types.ts";
import { DriveChoice } from "@/components/DriveChoice.tsx";
import { Errata } from "@/components/Errata.tsx";
import { FileTypeChoice } from "@/components/FileTypeChoice.tsx";
import { GmailChoice } from "@/components/GmailChoice.tsx";
import { HubspotChoice, type Overlong } from "@/components/HubspotChoice.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { XeroChoice } from "@/components/XeroChoice.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import type { ListedItem } from "@/lib/hubspotProperties.ts";
import { isBrowsedLabel } from "@/lib/labelIndex.ts";
import { sourceLabel } from "@/lib/runs.ts";
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

/**
 * Seed the draft from what is already stored, once the grants arrive.
 *
 * An admin changing a selection should see what they chose last time, not an empty form that
 * silently means "everything".
 */
function useStoredScope(source: string, connections: readonly Connection[] | undefined): void {
  const setDraft = useUiStore((s) => s.setScopeDraft);
  const current = connections?.find((c) => c.source === source);

  useEffect(() => {
    if (current === undefined) {
      return;
    }
    setDraft({
      source,
      labels: current.config.labels ?? [],
      // Each pick read back as what it IS. This used to rebuild every pick as a folder from a
      // list of bare ids, so an admin who re-saved without re-picking turned their chosen
      // documents into folder picks -- which list nothing, and refuse.
      files: current.config.files ?? [],
      // The organisation already chosen, by the id a run sends and the name the card shows.
      organisation:
        current.externalAccountId === ""
          ? null
          : { id: current.externalAccountId, name: current.externalAccountLabel },
      entities: current.config.entities ?? [],
      // A connection never scoped at all has no `fileTypes` to read back; PDF-only is what
      // every source has always meant until an admin visits this screen and says otherwise.
      fileTypes: current.config.fileTypes ?? ["application/pdf"],
      // A selection saved before sub-folders could be asked for read one level, and keeps
      // reading one level until somebody here says otherwise. ADR 0031.
      recurse: current.config.recurse ?? false,
      // A HubSpot connection nobody has scoped reads the spec's properties alone, which is
      // exactly what an empty choice here means.
      properties: current.config.properties ?? {},
    });
  }, [current, source, setDraft]);
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
 * The HubSpot objects whose choice would not fit in one request, by the rule the server applies
 * when it is saved -- asked here too so the reader is told under the list, before pressing Save,
 * rather than by a refusal after it.
 */
function overlongFor(kind: Source, chosen: Omit<ScopeDraft, "source">): Overlong[] {
  if (kind !== "hubspot") {
    return [];
  }
  return overlongPropertyChoices({ kind, properties: chosen.properties }).map((over) => ({
    ...over,
    limit: MAX_PROPERTY_QUERY_CHARS,
  }));
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
 * The picker for one connection.
 *
 * `kind` decides the SHAPE of the choice -- the lead, which picker, what gets recorded -- and
 * `source` decides WHICH connection it is recorded against: since ADR 0043 a tenant may hold
 * two mailboxes, and they are scoped one at a time.
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
  const draft = useUiStore((s) => s.scopeDraft);

  const connections = trpc.connections.list.useQuery({ tenantId });
  const labels = trpc.connections.browseScope.useQuery(
    { tenantId, source },
    // Drive is chosen in Google's Picker on this screen. Its server listing (ADR 0047) serves
    // an agent at the CLI, which has no browser; this screen does not ask for it.
    { enabled: BROWSED.has(kind) },
  );
  const setScope = useSaveScope(tenantId, kind, source);

  useStoredScope(source, connections.data);

  if (connections.isPending || (BROWSED.has(kind) && labels.isPending)) {
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
  const overlong = overlongFor(kind, chosen);
  // Xero cannot be saved without an organisation, nor HubSpot with a choice too long to send:
  // the server would refuse either, and saying so beforehand is cheaper than the errata after.
  const unsaveable = (kind === "xero" && chosen.organisation === null) || overlong.length > 0;
  const account = connections.data.find((c) => c.source === source)?.externalAccountLabel ?? "";

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <ScopeLead kind={kind} />

      <div className="band-rule" />

      {/* "Gmail · ops@acme.test" once the tenant holds two mailboxes: an admin scoping one of
          them has to be able to see WHICH, and the vendor's name alone would not say. */}
      <div className="head">{sourceLabel(source, connections.data)}</div>
      <div className="body stack">
        <SourceChoice
          kind={kind}
          source={source}
          account={account}
          items={labels.data?.items ?? []}
          loadError={labels.isError ? labels.error.message : null}
          chosen={chosen}
          overlong={overlong}
        />

        {setScope.isError ? (
          <Errata heading={t("scopePicker.notSaved")} live={true}>
            {setScope.error.message}
          </Errata>
        ) : null}

        {kind === "xero" && chosen.organisation === null ? (
          <p className="note">{t("scopePicker.chooseOrganisation")}</p>
        ) : null}

        <button
          type="button"
          className="plate plate--primary"
          disabled={setScope.isPending || unsaveable}
          onClick={(): void => {
            setScope.mutate({
              tenantId,
              source,
              selection: selectionFor(kind, chosen, labels.data?.items ?? []),
            });
          }}
        >
          {setScope.isPending ? t("scopePicker.saving") : t("scopePicker.save")}
        </button>
      </div>
    </div>
  );
}

/** What this source is about to be asked, in the words its own consent card uses. */
function ScopeLead({ kind }: { kind: Source }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="body stack">
      <h1>{t("scopePicker.title")}</h1>
      <p className="prose prose--lead">{t(LEAD_KEY[kind])}</p>

      {kind === "gmail" ? <p className="note">{t("scopePicker.wholeMailboxHint")}</p> : null}
      {kind === "xero" ? <p className="note">{t("scopePicker.xeroEntitiesHint")}</p> : null}
      {kind === "hubspot" ? <p className="note">{t("scopePicker.hubspotStandardHint")}</p> : null}
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
  overlong,
}: {
  kind: Source;
  source: string;
  /** The connection's account address, or `""` when none is recorded. */
  account: string;
  items: readonly ListedItem[];
  loadError: string | null;
  chosen: Omit<ScopeDraft, "source">;
  overlong: readonly Overlong[];
}): React.JSX.Element | null {
  const { t } = useTranslation();

  if (loadError !== null && BROWSED.has(kind)) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {loadError}
      </Errata>
    );
  }
  if (kind === "hubspot") {
    return (
      <HubspotChoice source={source} items={items} chosen={chosen.properties} overlong={overlong} />
    );
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
