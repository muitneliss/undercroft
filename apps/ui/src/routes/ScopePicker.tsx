/**
 * Choosing what a connected source may read.
 *
 * This screen is the difference between a consent card that tells the truth and one that
 * does not. The card promises "PDFs inside the folders you select. No other folder is read"
 * and "headers and PDF attachments in {{labels}}"; without somewhere to make that selection,
 * connecting Gmail would read an entire mailbox while the screen claimed otherwise.
 *
 * THE TWO SOURCES CHOOSE DIFFERENTLY, AND FOR A REASON WORTH KNOWING.
 *
 * **Gmail** is a list of labels, fetched through the worker because it needs a live token.
 * Choosing none is a *recorded decision* meaning the whole mailbox -- not an empty one --
 * which is why the server refuses a connection with no row at all rather than defaulting it.
 *
 * **Drive** is Google's own Picker, running in the browser. Under the `drive.file` scope a
 * server-side folder listing is not merely unnecessary, it is impossible: the credential
 * cannot see anything that has not been picked. That is the point -- Google enforces the
 * promise instead of our query filter, and the scope needs no annual CASA assessment.
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
 * **Xero** is a third shape: one consent can see several organisations, and the platform
 * must be told which one rather than guess. The list comes through the worker like Gmail's
 * labels; the choice is one organisation and any number of the spec's entities, where none
 * means all of them, as with Gmail.
 */

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import type { Connection, Source } from "@/api/types.ts";
import { SOURCE_LABEL } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { LabelIndex } from "@/components/LabelIndex.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { XeroChoice } from "@/components/XeroChoice.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { openDrivePicker } from "@/lib/drivePicker.ts";
import type { BrowsedLabel } from "@/lib/labelIndex.ts";
import { type ChosenFile, type ScopeDraft, useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** Which lead each source's picker opens with. HubSpot never reaches this leaf. */
const LEAD_KEY = {
  gmail: "scopePicker.leadGmail",
  drive: "scopePicker.leadDrive",
  xero: "scopePicker.leadXero",
  hubspot: "scopePicker.leadNone",
} as const;

/** Sources whose choices are listed by the worker, because listing needs a live token. */
const BROWSED: ReadonlySet<Source> = new Set<Source>(["gmail", "xero"]);

/** An empty choice, for a source whose draft has not been made yet. */
const NOTHING_CHOSEN: Omit<ScopeDraft, "source"> = {
  labels: [],
  files: [],
  organisation: null,
  entities: [],
};

/**
 * Seed the draft from what is already stored, once the grants arrive.
 *
 * An admin changing a selection should see what they chose last time, not an empty form that
 * silently means "everything".
 */
function useStoredScope(source: Source, connections: readonly Connection[] | undefined): void {
  const setDraft = useUiStore((s) => s.setScopeDraft);
  const current = connections?.find((c) => c.source === source);

  useEffect(() => {
    if (current === undefined) {
      return;
    }
    setDraft({
      source,
      labels: current.config.labels ?? [],
      files: (current.config.folderIds ?? []).map((id) => ({ id, name: id, kind: "folder" })),
      // The organisation already chosen, by the id a run sends and the name the card shows.
      organisation:
        current.externalAccountId === ""
          ? null
          : { id: current.externalAccountId, name: current.externalAccountLabel },
      entities: current.config.entities ?? [],
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
  source: Source,
  chosen: Omit<ScopeDraft, "source">,
  items: readonly { id: string; name: string }[],
): unknown {
  if (source === "gmail") {
    return {
      labels: chosen.labels.map((name) => ({
        id: items.find((i) => i.name === name)?.id ?? name,
        name,
      })),
    };
  }
  if (source === "xero") {
    return { organisation: chosen.organisation, entities: chosen.entities };
  }
  return { files: chosen.files };
}

export function ScopePicker({
  tenantId,
  source,
}: {
  tenantId: string;
  source: Source;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const draft = useUiStore((s) => s.scopeDraft);

  const connections = trpc.connections.list.useQuery({ tenantId });
  const labels = trpc.connections.browseScope.useQuery(
    { tenantId, source },
    // Drive has no server-side listing to fetch; asking for one would be a guaranteed 400.
    { enabled: BROWSED.has(source) },
  );

  const setScope = trpc.connections.setScope.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate({ tenantId });
      // `navigate` returns a promise in react-router 7; nothing here waits on the
      // transition, and the component unmounts when it lands.
      void navigate(divisionPath("sources", tenantId));
    },
  });

  useStoredScope(source, connections.data);

  if (connections.isPending || (BROWSED.has(source) && labels.isPending)) {
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
  // Xero cannot be saved without an organisation: the server would refuse it, and the
  // plate saying so beforehand is cheaper than the errata afterwards.
  const unsaveable = source === "xero" && chosen.organisation === null;

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <ScopeLead source={source} />

      <div className="band-rule" />

      <div className="head">{SOURCE_LABEL[source]}</div>
      <div className="body stack">
        <SourceChoice
          source={source}
          items={labels.data?.items ?? []}
          loadError={labels.isError ? labels.error.message : null}
          chosen={chosen}
        />

        {setScope.isError ? (
          <Errata heading={t("scopePicker.notSaved")} live={true}>
            {setScope.error.message}
          </Errata>
        ) : null}

        {unsaveable ? <p className="note">{t("scopePicker.chooseOrganisation")}</p> : null}

        <button
          type="button"
          className="plate plate--primary"
          disabled={setScope.isPending || unsaveable}
          onClick={(): void => {
            setScope.mutate({
              tenantId,
              source,
              selection: selectionFor(source, chosen, labels.data?.items ?? []),
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
function ScopeLead({ source }: { source: Source }): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="body stack">
      <h1>{t("scopePicker.title")}</h1>
      <p className="prose prose--lead">{t(LEAD_KEY[source])}</p>

      {source === "gmail" ? <p className="note">{t("scopePicker.wholeMailboxHint")}</p> : null}
      {source === "drive" ? <p className="note">{t("scopePicker.directChildrenOnly")}</p> : null}
      {source === "xero" ? <p className="note">{t("scopePicker.xeroEntitiesHint")}</p> : null}
    </div>
  );
}

/**
 * Which picker this source gets. Three shapes, for the three reasons the file header gives.
 *
 * HubSpot never reaches this leaf -- it has nothing to choose -- and renders nothing rather
 * than an empty frame that reads as a list which failed to load. Drive is never listed by the
 * worker, so a browse error is not its error to report.
 */
function SourceChoice({
  source,
  items,
  loadError,
  chosen,
}: {
  source: Source;
  items: readonly BrowsedLabel[];
  loadError: string | null;
  chosen: Omit<ScopeDraft, "source">;
}): React.JSX.Element | null {
  const { t } = useTranslation();

  if (loadError !== null && BROWSED.has(source)) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {loadError}
      </Errata>
    );
  }
  if (source === "xero") {
    return (
      <XeroChoice
        source={source}
        organisations={items}
        organisation={chosen.organisation}
        entities={chosen.entities}
      />
    );
  }
  if (source === "gmail") {
    return <GmailChoice source={source} items={items} chosen={chosen.labels} />;
  }
  if (source === "drive") {
    return <DriveChoice source={source} files={chosen.files} />;
  }
  return null;
}

/**
 * Gmail's choice: which labels, and what choosing none means said as it is chosen.
 *
 * "Choosing no label means the whole mailbox" is printed above the list, and a hint above a
 * long list is read once and then scrolled away from. So the consequence also stands beneath
 * the control, as a line that changes as the ticks change, in the consent card's own
 * sentence -- and it carries `role="status"`, so a screen reader is told the same thing at
 * the same moment instead of being left to infer it from a checkbox.
 */
function GmailChoice({
  source,
  items,
  chosen,
}: {
  source: Source;
  items: readonly BrowsedLabel[];
  chosen: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const clearLabels = useUiStore((s) => s.clearScopeLabels);

  if (items.length === 0) {
    return <p className="note">{t("scopePicker.nothingToChoose")}</p>;
  }

  return (
    <>
      <LabelIndex source={source} items={items} chosen={chosen} />

      <div className="echo">
        <span className="label">{t("scopePicker.echoHead")}</span>
        <p className="note echo__says" role="status">
          {chosen.length === 0
            ? t("scope.gmailWholeMailbox")
            : t("scopePicker.echoChosen", { count: chosen.length })}
        </p>
        {chosen.length > 0 ? (
          <button
            type="button"
            className="plate plate--small"
            onClick={(): void => {
              clearLabels(source);
            }}
          >
            {t("scopePicker.clearAll")}
          </button>
        ) : null}
      </div>
    </>
  );
}

/**
 * Drive's choice: Google's own Picker, running in the browser.
 *
 * Under the `drive.file` scope a server-side folder listing is not merely unnecessary, it is
 * impossible -- the credential cannot see anything that has not been picked. That is the
 * point: Google enforces the promise instead of our query filter.
 */
function DriveChoice({
  source,
  files,
}: {
  source: Source;
  files: readonly ChosenFile[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const setDraft = useUiStore((s) => s.setScopeDraft);
  const config = trpc.config.google.useQuery();

  return (
    <>
      <button
        type="button"
        className="plate"
        disabled={config.data === undefined || config.data === null}
        onClick={(): void => {
          // Null when no ingestion client is configured; the button is disabled then,
          // and this guard is what makes that a type-level fact rather than a habit.
          const picker = config.data;
          if (picker === undefined || picker === null) {
            return;
          }
          void openDrivePicker(picker, (picked) => {
            setDraft({ source, labels: [], files: picked, organisation: null, entities: [] });
          });
        }}
      >
        {t("scopePicker.pickFromDrive")}
      </button>
      {config.isError ? (
        <p className="note">{t("scopePicker.pickerUnavailable")}</p>
      ) : (
        <ul className="stack stack--tight">
          {files.map((file) => (
            <li key={file.id}>{file.name}</li>
          ))}
        </ul>
      )}
    </>
  );
}
