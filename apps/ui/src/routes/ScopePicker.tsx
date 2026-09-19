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

import type { Source } from "@/api/types.ts";
import { SOURCE_LABEL } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { openDrivePicker } from "@/lib/drivePicker.ts";
import { type BrowsedLabel, indexLabels, type LabelOwner } from "@/lib/labelIndex.ts";
import { describeXeroEntity, XERO_ENTITIES } from "@/lib/xeroEntities.ts";
import { useUiStore } from "@/store.ts";
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

/**
 * How many labels before the index needs to be searchable rather than merely readable.
 *
 * Below this the whole index fits in the frame without scrolling, and a filter over twelve
 * entries is a control that costs a glance and saves nothing.
 */
const FILTER_FROM = 12;

/** What each run of the index is called. Gmail says which run; the catalogue says the word. */
const RUN_HEAD = {
  user: "scopePicker.labelsMine",
  system: "scopePicker.labelsSystem",
  unclassified: "scopePicker.labelsUnclassified",
} as const;

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
  const setDraft = useUiStore((s) => s.setScopeDraft);
  const clearLabels = useUiStore((s) => s.clearScopeLabels);

  const connections = trpc.connections.list.useQuery({ tenantId });
  const labels = trpc.connections.browseScope.useQuery(
    { tenantId, source },
    // Drive has no server-side listing to fetch; asking for one would be a guaranteed 400.
    { enabled: BROWSED.has(source) },
  );
  const config = trpc.config.google.useQuery(undefined, { enabled: source === "drive" });

  const setScope = trpc.connections.setScope.useMutation({
    onSuccess: async () => {
      await utils.connections.list.invalidate({ tenantId });
      // `navigate` returns a promise in react-router 7; nothing here waits on the
      // transition, and the component unmounts when it lands.
      void navigate(divisionPath("sources", tenantId));
    },
  });

  // Seed the draft from what is already stored, once the grants arrive. An admin changing a
  // selection should see what they chose last time, not an empty form that silently means
  // "everything".
  const current = connections.data?.find((c) => c.source === source);
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

  const chosenLabels = draft?.source === source ? draft.labels : [];
  const chosenFiles = draft?.source === source ? draft.files : [];
  const chosenOrganisation = draft?.source === source ? draft.organisation : null;
  const chosenEntities = draft?.source === source ? draft.entities : [];

  function selection(): unknown {
    if (source === "gmail") {
      return {
        labels: chosenLabels.map((name) => ({
          id: labels.data?.items.find((i) => i.name === name)?.id ?? name,
          name,
        })),
      };
    }
    if (source === "xero") {
      return { organisation: chosenOrganisation, entities: chosenEntities };
    }
    return { files: chosenFiles };
  }

  function save(): void {
    setScope.mutate({ tenantId, source, selection: selection() });
  }

  // Xero cannot be saved without an organisation: the server would refuse it, and the
  // plate saying so beforehand is cheaper than the errata afterwards.
  const unsaveable = source === "xero" && chosenOrganisation === null;

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <div className="body stack">
        <h1>{t("scopePicker.title")}</h1>
        <p className="prose prose--lead">{t(LEAD_KEY[source])}</p>

        {source === "gmail" ? <p className="note">{t("scopePicker.wholeMailboxHint")}</p> : null}
        {source === "drive" ? <p className="note">{t("scopePicker.directChildrenOnly")}</p> : null}
        {source === "xero" ? <p className="note">{t("scopePicker.xeroEntitiesHint")}</p> : null}
      </div>

      <div className="band-rule" />

      <div className="head">{SOURCE_LABEL[source]}</div>
      <div className="body stack">
        {source === "xero" ? (
          labels.isError ? (
            <Errata heading={t("common.notLoaded")} live={true}>
              {labels.error.message}
            </Errata>
          ) : (
            <XeroChoice
              source={source}
              organisations={labels.data?.items ?? []}
              organisation={chosenOrganisation}
              entities={chosenEntities}
            />
          )
        ) : null}

        {source === "gmail" ? (
          labels.isError ? (
            <Errata heading={t("common.notLoaded")} live={true}>
              {labels.error.message}
            </Errata>
          ) : (labels.data?.items.length ?? 0) === 0 ? (
            <p className="note">{t("scopePicker.nothingToChoose")}</p>
          ) : (
            <>
              <LabelIndex source={source} items={labels.data?.items ?? []} chosen={chosenLabels} />

              <div className="echo">
                <span className="label">{t("scopePicker.echoHead")}</span>
                <p className="note echo__says" role="status">
                  {chosenLabels.length === 0
                    ? t("scope.gmailWholeMailbox")
                    : t("scopePicker.echoChosen", { count: chosenLabels.length })}
                </p>
                {chosenLabels.length > 0 ? (
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
          )
        ) : null}

        {source === "drive" ? (
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
                {chosenFiles.map((file) => (
                  <li key={file.id}>{file.name}</li>
                ))}
              </ul>
            )}
          </>
        ) : null}

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
          onClick={save}
        >
          {setScope.isPending ? t("scopePicker.saving") : t("scopePicker.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * Xero's choice: one organisation, and which entities.
 *
 * Both halves are read from the store and written to it, for the reason the label index
 * gives. The entity list is the spec's, in the spec's order, with the words a reader sees
 * translated and the ids that get recorded left as they are.
 */
function XeroChoice({
  source,
  organisations,
  organisation,
  entities,
}: {
  source: Source;
  organisations: readonly { id: string; name: string }[];
  organisation: { id: string; name: string } | null;
  entities: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const setOrganisation = useUiStore((s) => s.setScopeOrganisation);
  const toggleEntity = useUiStore((s) => s.toggleScopeEntity);

  if (organisations.length === 0) {
    return <p className="note">{t("scopePicker.noOrganisations")}</p>;
  }

  return (
    <>
      <fieldset className="index">
        <legend className="label index__legend">{t("scopePicker.organisationsHead")}</legend>
        <div className="index__field">
          <div className="index__cols">
            {organisations.map((candidate) => (
              <label key={candidate.id} className="punch">
                <input
                  type="radio"
                  name="organisation"
                  checked={organisation?.id === candidate.id}
                  onChange={(): void => {
                    setOrganisation(source, { id: candidate.id, name: candidate.name });
                  }}
                />
                <span className="punch__box" />
                <span>{candidate.name}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="index">
        <legend className="label index__legend">{t("scopePicker.entitiesHead")}</legend>
        <div className="index__field">
          <div className="index__cols">
            {XERO_ENTITIES.map((entity) => (
              <label key={entity} className="punch">
                <input
                  type="checkbox"
                  checked={entities.includes(entity)}
                  onChange={(): void => {
                    toggleEntity(source, entity);
                  }}
                />
                <span className="punch__box" />
                <span>{describeXeroEntity(t, entity)}</span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="echo">
        <span className="label">{t("scopePicker.echoHead")}</span>
        <p className="note echo__says" role="status">
          {entities.length === 0
            ? t("scope.xeroAll")
            : t("scope.xeroEntities", {
                entities: entities.map((entity) => describeXeroEntity(t, entity)).join(", "),
              })}
        </p>
      </div>
    </>
  );
}

/**
 * The index of labels: a filter, then the runs, inside one bounded frame.
 *
 * Both pieces of state it reads belong to the store rather than to this component -- the
 * ticks because Save has to find them, the filter because `useState` is banned and a second
 * owner of "what is on screen" is how a list and its filter drift apart. Each is read back
 * against the source it was recorded for, so neither can be left over from another one.
 *
 * The tally is said twice on purpose. `14 / 62` beside the field is legible in either
 * language and costs one glance; the sentence beside it is hidden from the page and live for
 * a screen reader, because a pair of bare numerals announced on their own names nothing.
 */
function LabelIndex({
  source,
  items,
  chosen,
}: {
  source: Source;
  items: readonly BrowsedLabel[];
  chosen: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const typed = useUiStore((s) => s.scopeFilter);
  const setFilter = useUiStore((s) => s.setScopeFilter);
  const toggleLabel = useUiStore((s) => s.toggleScopeLabel);

  // Derived, not copied: a word typed against Gmail's labels narrows Gmail's labels and
  // nothing else, and this is what makes that true without an effect to clear it up after.
  const filter = typed.source === source ? typed.query : "";
  const runs = indexLabels(items, filter, locale);
  const shown = runs.reduce((count, run) => count + run.items.length, 0);
  const tally = { shown, total: items.length };

  return (
    <fieldset className="index">
      <legend className="label index__legend">{t("scopePicker.labelsHead")}</legend>

      {items.length >= FILTER_FROM ? (
        <div className="index__seek">
          <input
            type="search"
            className="input index__filter"
            value={filter}
            placeholder={t("scopePicker.filterPlaceholder")}
            aria-label={t("scopePicker.filterLabel")}
            onChange={(event): void => {
              setFilter(source, event.target.value);
            }}
          />
          <span aria-hidden="true" className="datum datum--quiet">
            {/* A ratio only once there is something to be a ratio of. Unfiltered, `62 / 62`
                says the same figure twice; `62 nhãn` says how big the mailbox is, which is
                the fact somebody arriving at this screen does not yet have. */}
            {filter === ""
              ? t("scopePicker.filterTotal", { count: items.length })
              : t("scopePicker.filterTally", tally)}
          </span>
          <span className="visually-hidden" aria-live="polite">
            {t("scopePicker.filterTallyRead", tally)}
          </span>
        </div>
      ) : null}

      <div className="index__field">
        {runs.map((run) => (
          <section key={runKey(run.kind)} className="index__run">
            <h2 className="label index__head">{t(RUN_HEAD[runKey(run.kind)])}</h2>
            <div className="index__cols">
              {run.items.map((label) => (
                <label key={label.id} className="punch">
                  <input
                    type="checkbox"
                    checked={chosen.includes(label.name)}
                    onChange={(): void => {
                      toggleLabel(source, label.name);
                    }}
                  />
                  <span className="punch__box" />
                  <span>{label.name}</span>
                </label>
              ))}
            </div>
          </section>
        ))}
        {shown === 0 ? <p className="note index__none">{t("scopePicker.noMatch")}</p> : null}
      </div>
    </fieldset>
  );
}

/** The null run needs a name to be keyed and headed by; it does not need a third meaning. */
function runKey(kind: LabelOwner): keyof typeof RUN_HEAD {
  return kind ?? "unclassified";
}
