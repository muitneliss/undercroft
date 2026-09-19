/**
 * The visual builder: a table, its columns with an aggregate each, filters, a grouping, an
 * order and a limit -- every choice a write to the draft in the store, the SQL it compiles
 * to shown beside it by the route.
 *
 * The schema it offers comes from the tenant's read-only login (`bi.schema`), so a column
 * that is offered is a column that can be read. The operators a column takes come from its
 * Postgres type (`lib/biOps.ts`). Nothing here runs anything: the route does, on Run.
 *
 * Controlled inputs whose owner is the store, never `useState`: a `<select>`'s value IS the
 * draft's value, and changing it writes the draft. The one uncontrolled input is a filter's
 * value, which is text a person types and is written on change like the rest.
 */

// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Same functions as noExcessiveLinesPerFunction: one sequential procedure each, whose branches are the states the thing being driven can actually be in.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: These are the functions that hold one decision each -- the connector page loop, the deploy poller, the grant migration -- and the way to shorten them is to split one sequential procedure across several names, which makes the order it happens in harder to follow rather than easier.
// biome-ignore-all lint/correctness/noSolidDestructuredProps: Solid-domain rule: destructuring props defeats Solid's reactivity, because there `props` is a proxy. React props are a plain object and destructuring them is the idiomatic form.
// biome-ignore-all lint/correctness/useUniqueElementIds: Static ids on a single-instance form: the builder renders one question at a time, and the ids are what its <label>s point at.
// biome-ignore-all lint/nursery/useExplicitReturnType: Same set as useExplicitType above: what remains are contextually-typed callbacks and factories whose inferred type is a tRPC router shape hundreds of characters wide.
// biome-ignore-all lint/nursery/useExplicitType: Every site whose type the compiler could print is annotated. What is left is parameters of callbacks passed to third-party APIs -- React's event handlers -- where the type arrives contextually and writing it out means naming a library-internal type that drifts on the next upgrade.
// biome-ignore-all lint/performance/noJsxPropsBind: Inline handlers on the builder's controls. The re-render the rule is about needs a memoised child to bite; these props land on plain DOM elements.
// biome-ignore-all lint/performance/useSolidForComponent: Solid-domain rule: it wants Solid's `<For>`, which does not exist in React. `Array#map` is how React renders a list.
// biome-ignore-all lint/style/noNestedTernary: Three chained conditions that map one value onto three outcomes. Written as nested if/else they occupy fifteen lines to say the same thing.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: One builder, one file: the table, the columns, the filters, the grouping and the order are the parts of one form, and a reader following what a choice does to the draft wants them in the order they sit on the page.
// biome-ignore-all lint/style/noTernary: A ternary selects between two VALUES. The rule wants a statement instead, which means declaring a mutable temporary and separating the condition from the value it chooses. Inside JSX it is additionally the only way to render conditionally inline.
// biome-ignore-all lint/suspicious/noArrayIndexKey: A filter row has no identity but its position: two identical filters are two filters, and the list is edited in place by index, which is the key the edit is made under.
// biome-ignore-all lint/suspicious/noReactSpecificProps: Solid-domain rule: it wants `class` in place of `className`. This is a React app, where `class` is not a valid DOM prop -- Biome's own autofix for it makes `tsc` fail. Every domain is on in biome.jsonc, so the rule is suppressed where it is wrong rather than switched off.

import {
  type Aggregate,
  AGGREGATES,
  type Field,
  type Filter,
  type FilterOp,
  type VisualDefinition,
} from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import type { SchemaView } from "@/api/types.ts";
import { arityOf, opLabel, opsFor } from "@/lib/biOps.ts";
import { fieldAliases } from "@/lib/questionDraft.ts";

type Patch = Partial<Omit<VisualDefinition, "kind">>;

const AGG_KEY = {
  count: "bi.aggCount",
  sum: "bi.aggSum",
  avg: "bi.aggAvg",
  min: "bi.aggMin",
  max: "bi.aggMax",
} as const;

/** The empty aggregate choice: the column's own value. */
const NONE = "";

function withField(fields: readonly Field[], column: string, on: boolean): Field[] {
  const kept = fields.filter((f) => f.column !== column);
  return on ? [...kept, { column }] : kept;
}

function withAggregate(fields: readonly Field[], column: string, aggregate: string): Field[] {
  return fields.map((f) => {
    if (f.column !== column) {
      return f;
    }
    const chosen: Aggregate | undefined = AGGREGATES.find((a) => a === aggregate);
    return chosen === undefined ? { column } : { column, aggregate: chosen };
  });
}

/** A value edited for an operator of a given arity: one string, or a list, or a pair. */
function valueFor(op: FilterOp, text: string): Filter["value"] {
  switch (arityOf(op)) {
    case "none":
      return undefined;
    case "many":
      return text
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v !== "");
    case "two": {
      const [low = "", high = ""] = text.split(",").map((v) => v.trim());
      return [low, high];
    }
    default:
      return text;
  }
}

function textOf(value: Filter["value"]): string {
  if (value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : value.join(", ");
}

export function QuestionBuilder({
  schema,
  definition,
  onPatch,
}: {
  schema: SchemaView;
  definition: VisualDefinition;
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const table = schema.tables.find((candidate) => candidate.name === definition.table);
  const columns = table?.columns ?? [];
  const aliases = fieldAliases(definition);
  const countAll = definition.fields.some((f) => f.column === "*");
  const [order] = definition.orderBy;

  return (
    <div className="stack">
      <div className="field">
        <label className="label" htmlFor="q-table">
          {t("bi.tableLabel")}
        </label>
        <select
          className="input input--select"
          id="q-table"
          value={definition.table}
          onChange={(event) => {
            onPatch({
              table: event.currentTarget.value,
              fields: [{ column: "*", aggregate: "count", alias: "count" }],
              filters: [],
              groupBy: [],
              orderBy: [],
            });
          }}
        >
          {schema.tables.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.name}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="index">
        <legend className="label index__legend">{t("bi.columnsHead")}</legend>
        <div className="index__cols">
          <label className="punch">
            <input
              type="checkbox"
              checked={countAll}
              onChange={(event) => {
                onPatch({
                  fields: event.currentTarget.checked
                    ? [...definition.fields, { column: "*", aggregate: "count", alias: "count" }]
                    : definition.fields.filter((f) => f.column !== "*"),
                });
              }}
            />
            <span className="punch__box" />
            <span>{t("bi.countAll")}</span>
          </label>
          {columns.map((column) => {
            const field = definition.fields.find((f) => f.column === column.name);
            return (
              <div key={column.name} className="builder__column">
                <label className="punch">
                  <input
                    type="checkbox"
                    checked={field !== undefined}
                    onChange={(event) => {
                      onPatch({
                        fields: withField(
                          definition.fields,
                          column.name,
                          event.currentTarget.checked,
                        ),
                      });
                    }}
                  />
                  <span className="punch__box" />
                  <span>
                    {column.name}
                    <span className="datum datum--quiet result__type">{column.type}</span>
                  </span>
                </label>
                {field === undefined ? null : (
                  <select
                    aria-label={`${column.name}: ${t("bi.aggNone")}`}
                    className="input input--select"
                    value={field.aggregate ?? NONE}
                    onChange={(event) => {
                      onPatch({
                        fields: withAggregate(
                          definition.fields,
                          column.name,
                          event.currentTarget.value,
                        ),
                      });
                    }}
                  >
                    <option value={NONE}>{t("bi.aggNone")}</option>
                    {AGGREGATES.map((aggregate) => (
                      <option key={aggregate} value={aggregate}>
                        {t(AGG_KEY[aggregate])}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="stack stack--tight">
        <span className="label">{t("bi.filtersHead")}</span>
        {definition.filters.map((filter, index) => {
          const type = columns.find((c) => c.name === filter.column)?.type ?? "";
          const ops = opsFor(type);
          const arity = arityOf(filter.op);
          return (
            <div key={index} className="row builder__filter">
              <select
                aria-label={t("bi.filterColumn")}
                className="input input--select"
                value={filter.column}
                onChange={(event) => {
                  const column = event.currentTarget.value;
                  const [firstOp = "is_null"] = opsFor(
                    columns.find((c) => c.name === column)?.type ?? "",
                  );
                  onPatch({
                    filters: definition.filters.map((f, i) =>
                      i === index ? { column, op: firstOp, value: undefined } : f,
                    ),
                  });
                }}
              >
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t("bi.filterOp")}
                className="input input--select"
                value={filter.op}
                onChange={(event) => {
                  const chosen = event.currentTarget.value;
                  const op = ops.find((candidate) => candidate === chosen);
                  if (op === undefined) {
                    return;
                  }
                  onPatch({
                    filters: definition.filters.map((f, i) =>
                      i === index ? { ...f, op, value: valueFor(op, textOf(f.value)) } : f,
                    ),
                  });
                }}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {opLabel(t, op)}
                  </option>
                ))}
              </select>
              {arity === "none" ? null : (
                <input
                  aria-label={arity === "many" ? t("bi.filterValues") : t("bi.filterValue")}
                  className="input"
                  placeholder={
                    arity === "many"
                      ? t("bi.filterValues")
                      : arity === "two"
                        ? `${t("bi.filterFrom")}, ${t("bi.filterTo")}`
                        : t("bi.filterValue")
                  }
                  type="text"
                  value={textOf(filter.value)}
                  onChange={(event) => {
                    const text = event.currentTarget.value;
                    onPatch({
                      filters: definition.filters.map((f, i) =>
                        i === index ? { ...f, value: valueFor(f.op, text) } : f,
                      ),
                    });
                  }}
                />
              )}
              <button
                className="plate plate--small"
                type="button"
                onClick={() => {
                  onPatch({ filters: definition.filters.filter((_f, i) => i !== index) });
                }}
              >
                {t("bi.removeFilter")}
              </button>
            </div>
          );
        })}
        <p className="field__hint">{t("bi.paramHint", { example: "{{period_from}}" })}</p>
        {columns.length === 0 ? null : (
          <div className="row">
            <button
              className="plate"
              type="button"
              onClick={() => {
                const [first] = columns;
                if (first === undefined) {
                  return;
                }
                const [firstOp = "is_null"] = opsFor(first.type);
                onPatch({
                  filters: [...definition.filters, { column: first.name, op: firstOp, value: "" }],
                });
              }}
            >
              {t("bi.addFilter")}
            </button>
          </div>
        )}
      </div>

      <fieldset className="index">
        <legend className="label index__legend">{t("bi.groupHead")}</legend>
        <div className="index__cols">
          {columns.map((column) => (
            <label key={column.name} className="punch">
              <input
                type="checkbox"
                checked={definition.groupBy.includes(column.name)}
                onChange={(event) => {
                  onPatch({
                    groupBy: event.currentTarget.checked
                      ? [...definition.groupBy, column.name]
                      : definition.groupBy.filter((g) => g !== column.name),
                  });
                }}
              />
              <span className="punch__box" />
              <span>{column.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="row">
        <div className="field">
          <label className="label" htmlFor="q-order">
            {t("bi.orderHead")}
          </label>
          <select
            className="input input--select"
            id="q-order"
            value={order?.by ?? NONE}
            onChange={(event) => {
              const by = event.currentTarget.value;
              onPatch({ orderBy: by === NONE ? [] : [{ by, dir: order?.dir ?? "asc" }] });
            }}
          >
            <option value={NONE}>{t("bi.orderNone")}</option>
            {aliases.map((alias) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
          </select>
        </div>
        {order === undefined ? null : (
          <select
            aria-label={t("bi.orderHead")}
            className="input input--select"
            value={order.dir}
            onChange={(event) => {
              onPatch({
                orderBy: [
                  { by: order.by, dir: event.currentTarget.value === "desc" ? "desc" : "asc" },
                ],
              });
            }}
          >
            <option value="asc">{t("bi.orderAsc")}</option>
            <option value="desc">{t("bi.orderDesc")}</option>
          </select>
        )}
        <div className="field">
          <label className="label" htmlFor="q-limit">
            {t("bi.limitLabel")}
          </label>
          <input
            className="input"
            id="q-limit"
            max={5000}
            min={1}
            type="number"
            value={definition.limit}
            onChange={(event) => {
              // parseInt, not Number(): a row count, not an amount.
              const limit = Number.parseInt(event.currentTarget.value, 10);
              if (Number.isFinite(limit) && limit >= 1) {
                onPatch({ limit });
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
