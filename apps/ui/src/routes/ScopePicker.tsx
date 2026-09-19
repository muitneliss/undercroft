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
 */

// biome-ignore-all lint/nursery/useReactCompiler: The effect seeds a draft from the query cache once the grants arrive, which is a write to the store rather than a render-time computation. The compiler cannot see that the store is the owner; `.claude/rules/state.md` is what makes it correct.

// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/complexity/noVoid: `void` here marks a promise deliberately not awaited, at the two places where that is correct and where dropping the marker would make it look like an oversight.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/noUnresolvedImports: `react` and `pg` resolve through the workspace package that depends on them; Biome's module resolver does not walk a Bun workspace layout. tsc and the build both resolve them.
// biome-ignore-all lint/correctness/useQwikValidLexicalScope: Qwik-domain rule about what may cross a `$()` serialization boundary. There is no Qwik in this repo.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- Better Auth's hooks, tRPC's builders -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on the controls in this file: one form's submit, and one `onChange` per checkbox in the label index. The re-render the rule is about needs a memoised child to bite; these props land on plain DOM elements, which React re-renders with the page whatever identity the handler had.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noNestedTernary: Three chained conditions that map one value onto three outcomes. Written as nested if/else they occupy fifteen lines to say the same thing.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/style/useExportsLast: Reordering modules so every export sits at the bottom would rewrite files whose current order is deliberate -- the route this file is named for first, then the parts of it that exist to keep that function readable. That ordering carries meaning; the rule's preferred one does not.

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
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

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

export function ScopePicker({ tenantId, source }: { tenantId: string; source: Source }) {
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
    { enabled: source === "gmail" },
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
    });
  }, [current, source, setDraft]);

  if (connections.isPending || (source === "gmail" && labels.isPending)) {
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

  function save(): void {
    setScope.mutate({
      tenantId,
      source,
      selection:
        source === "gmail"
          ? {
              labels: chosenLabels.map((name) => ({
                id: labels.data?.items.find((i) => i.name === name)?.id ?? name,
                name,
              })),
            }
          : { files: chosenFiles },
    });
  }

  return (
    <div className="sheet">
      <div className="head head--division">{t("nav.sources")}</div>
      <div className="body stack">
        <h1>{t("scopePicker.title")}</h1>
        <p className="prose prose--lead">
          {source === "gmail" ? t("scopePicker.leadGmail") : t("scopePicker.leadDrive")}
        </p>

        {source === "gmail" ? (
          <p className="note">{t("scopePicker.wholeMailboxHint")}</p>
        ) : (
          <p className="note">{t("scopePicker.directChildrenOnly")}</p>
        )}
      </div>

      <div className="band-rule" />

      <div className="head">{SOURCE_LABEL[source]}</div>
      <div className="body stack">
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
                    onClick={() => {
                      clearLabels(source);
                    }}
                  >
                    {t("scopePicker.clearAll")}
                  </button>
                ) : null}
              </div>
            </>
          )
        ) : (
          <>
            <button
              type="button"
              className="plate"
              disabled={config.data === undefined || config.data === null}
              onClick={() => {
                // Null when no ingestion client is configured; the button is disabled then,
                // and this guard is what makes that a type-level fact rather than a habit.
                const picker = config.data;
                if (picker === undefined || picker === null) {
                  return;
                }
                void openDrivePicker(picker, (picked) => {
                  setDraft({ source, labels: [], files: picked });
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
        )}

        {setScope.isError ? (
          <Errata heading={t("scopePicker.notSaved")} live={true}>
            {setScope.error.message}
          </Errata>
        ) : null}

        <button
          type="button"
          className="plate plate--primary"
          disabled={setScope.isPending}
          onClick={save}
        >
          {setScope.isPending ? t("scopePicker.saving") : t("scopePicker.save")}
        </button>
      </div>
    </div>
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
}) {
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
            onChange={(event) => {
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
                    onChange={() => {
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
