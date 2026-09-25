/**
 * HubSpot's choice: which further properties each CRM object reads.
 *
 * A fourth shape among the scope pickers, and the only one whose empty choice is the NARROW
 * reading. The spec names a floor of properties per object that is read whatever is ticked --
 * the incremental cursor's own property among them -- and a tick here only ever adds to it
 * (ADR 0052). So "nothing ticked" says "the standard properties only", never "everything", and
 * the floor is printed as a sentence above each list rather than as ticks that could look
 * undoable.
 *
 * The listing is live from HubSpot, so a portal's own properties are here beside HubSpot's, in
 * a run of their own and first: they are what somebody came to this screen to find. A property
 * the choice holds that HubSpot no longer lists is shown too, in its own run, so it can be
 * unticked -- `@/lib/hubspotProperties` decides all of that; this file gives it words.
 *
 * A portal's contacts can carry five hundred properties, so the lists are indexes, set in the
 * label index's bounded columns, with one filter over all three objects. Every one of them can be
 * ticked and saved -- Select all included: a widened object's properties travel in a batch read's
 * body rather than in a URL, so no choice is too long to send (ADR 0054).
 */

import { useTranslation } from "react-i18next";

import { ChoiceEcho } from "@/components/ChoiceEcho.tsx";
import {
  describeHubspotObject,
  type ListedItem,
  type ObjectProperties,
  propertiesByObject,
} from "@/lib/hubspotProperties.ts";
import { indexLabels, type LabelOwner } from "@/lib/labelIndex.ts";
import { useUiStore } from "@/store.ts";

/** How many properties before the lists need a filter rather than merely a glance. */
const FILTER_FROM = 12;

/** What each run of an object's list is called. HubSpot says whose a property is. */
const RUN_HEAD = {
  user: "scopePicker.propertiesMine",
  system: "scopePicker.propertiesHubspot",
  gone: "scopePicker.propertiesGone",
} as const;

export function HubspotChoice({
  source,
  items,
  chosen,
}: {
  /** Which connection the draft and the filter belong to. */
  source: string;
  items: readonly ListedItem[];
  chosen: Readonly<Record<string, readonly string[]>>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const typed = useUiStore((s) => s.scopeFilter);
  const setFilter = useUiStore((s) => s.setScopeFilter);

  const objects = propertiesByObject(items, chosen);
  if (objects.length === 0) {
    return <p className="note">{t("scopePicker.noProperties")}</p>;
  }

  // Derived, not copied, for the reason the label index gives: a word typed against another
  // source's list cannot still be narrowing this one.
  const filter = typed.source === source ? typed.query : "";
  const total = objects.reduce((count, object) => count + object.choosable.length, 0);
  const shown = objects.reduce(
    (count, object) =>
      count +
      indexLabels(object.choosable, filter, locale).reduce((n, run) => n + run.items.length, 0),
    0,
  );
  const tally = { shown, total };

  return (
    <>
      {total >= FILTER_FROM ? (
        <div className="index__seek">
          <input
            type="search"
            className="input index__filter"
            value={filter}
            placeholder={t("scopePicker.filterPlaceholder")}
            aria-label={t("scopePicker.filterPropertiesLabel")}
            onChange={(event): void => {
              setFilter(source, event.target.value);
            }}
          />
          <span aria-hidden="true" className="datum datum--quiet">
            {filter === ""
              ? t("scopePicker.filterPropertiesTotal", { count: total })
              : t("scopePicker.filterTally", tally)}
          </span>
          <span className="visually-hidden" aria-live="polite">
            {t("scopePicker.filterPropertiesTallyRead", tally)}
          </span>
        </div>
      ) : null}

      {objects.map((object) => (
        <ObjectChoice
          key={object.entity}
          source={source}
          object={object}
          filter={filter}
          chosen={chosen[object.entity] ?? []}
        />
      ))}
    </>
  );
}

/** One object: what is always read, what may be ticked, and what the ticks will read. */
function ObjectChoice({
  source,
  object,
  filter,
  chosen,
}: {
  source: string;
  object: ObjectProperties;
  filter: string;
  chosen: readonly string[];
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((s) => s.locale);
  const toggle = useUiStore((s) => s.toggleScopeProperty);
  const clear = useUiStore((s) => s.clearScopeProperties);
  const selectAll = useUiStore((s) => s.selectAllScopeProperties);

  const { entity } = object;
  const runs = indexLabels(object.choosable, filter, locale);
  const shown = runs.reduce((count, run) => count + run.items.length, 0);
  const named = describeHubspotObject(t, entity);
  // What Select all adds: what HubSpot lists now, never a name it no longer has.
  const offered = object.choosable.flatMap((item) => (item.kind === null ? [] : [item.id]));

  return (
    <>
      <fieldset className="index">
        <legend className="label index__legend">{named}</legend>
        {object.always.length > 0 ? (
          <p className="note">
            {t("scopePicker.propertiesAlways", {
              properties: object.always.map((item) => item.name).join(", "),
            })}
          </p>
        ) : null}
        <div className="index__field">
          {runs.map((run) => (
            <section key={runKey(run.kind)} className="index__run">
              <h2 className="label index__head">{t(RUN_HEAD[runKey(run.kind)])}</h2>
              <div className="index__cols">
                {run.items.map((item) => (
                  <label key={item.id} className="punch">
                    <input
                      type="checkbox"
                      checked={chosen.includes(item.id)}
                      onChange={(): void => {
                        toggle(source, entity, item.id);
                      }}
                    />
                    <span className="punch__box" />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
          {shown === 0 ? (
            <p className="note index__none">
              {filter === "" ? t("scopePicker.nothingToChoose") : t("scopePicker.noPropertyMatch")}
            </p>
          ) : null}
        </div>
      </fieldset>

      <ChoiceEcho
        chosen={chosen}
        offered={offered}
        says={{
          none: t("scopePicker.echoPropertiesStandard"),
          some: t("scope.hubspotChosen", { count: chosen.length }),
          every: t("scopePicker.echoEveryProperty"),
        }}
        onSelectAll={(): void => {
          selectAll(source, entity, offered);
        }}
        onClear={(): void => {
          clear(source, entity);
        }}
      />
    </>
  );
}

/** A property HubSpot no longer lists has no owner to report; its run is named for that. */
function runKey(kind: LabelOwner): keyof typeof RUN_HEAD {
  return kind ?? "gone";
}
