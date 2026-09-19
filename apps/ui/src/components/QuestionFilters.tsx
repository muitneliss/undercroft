/**
 * A visual question's WHERE clause: one row per filter, and the plate that adds another.
 *
 * Its own module because filters are the one clause with real machinery behind them. Which
 * operators a column takes comes from its Postgres type (`lib/biOps.ts`), and how many values
 * an operator takes comes from the operator -- so changing either has to rewrite the other,
 * and that is three decisions rather than a checkbox.
 *
 * A parameter (`{{period_from}}`) is ordinary text here; the compiler binds it, so nothing in
 * this file interpolates anything into SQL.
 */

import type { Filter, FilterOp, VisualDefinition } from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import type { SchemaView } from "@/api/types.ts";
import { arityOf, opLabel, opsFor } from "@/lib/biOps.ts";

type Patch = Partial<Omit<VisualDefinition, "kind">>;
type Column = SchemaView["tables"][number]["columns"][number];

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

/** The filters, in order, and the plate that adds one. */
export function FilterList({
  columns,
  filters,
  onPatch,
}: {
  columns: readonly Column[];
  filters: readonly Filter[];
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="stack stack--tight">
      <span className="label">{t("bi.filtersHead")}</span>
      {filters.map((filter, index) => (
        // Keyed by position: a filter has no identity of its own, and two filters on the
        // same column with the same operator are a legitimate thing to write.
        <FilterRow
          key={index}
          columns={columns}
          filter={filter}
          index={index}
          filters={filters}
          onPatch={onPatch}
        />
      ))}
      <p className="field__hint">{t("bi.paramHint", { example: "{{period_from}}" })}</p>
      {columns.length === 0 ? null : (
        <div className="row">
          <button
            className="plate"
            type="button"
            onClick={(): void => {
              const [first] = columns;
              if (first === undefined) {
                return;
              }
              const [firstOp = "is_null"] = opsFor(first.type);
              onPatch({
                filters: [...filters, { column: first.name, op: firstOp, value: "" }],
              });
            }}
          >
            {t("bi.addFilter")}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * One filter: a column, an operator its type allows, and however many values that takes.
 *
 * The operator list is the column's, so changing the column resets the operator rather than
 * leaving a `>` on a boolean that the tenant's login would refuse.
 */
function FilterRow({
  columns,
  filter,
  index,
  filters,
  onPatch,
}: {
  columns: readonly Column[];
  filter: Filter;
  index: number;
  filters: readonly Filter[];
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const type = columns.find((c) => c.name === filter.column)?.type ?? "";
  const ops = opsFor(type);
  const arity = arityOf(filter.op);

  return (
    <div className="row builder__filter">
      <select
        aria-label={t("bi.filterColumn")}
        className="input input--select"
        value={filter.column}
        onChange={(event): void => {
          const column = event.currentTarget.value;
          const [firstOp = "is_null"] = opsFor(columns.find((c) => c.name === column)?.type ?? "");
          onPatch({
            filters: filters.map((f, i) =>
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
        onChange={(event): void => {
          const chosen = event.currentTarget.value;
          const op = ops.find((candidate) => candidate === chosen);
          if (op === undefined) {
            return;
          }
          onPatch({
            filters: filters.map((f, i) =>
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
        <FilterValue
          arity={arity}
          filter={filter}
          index={index}
          filters={filters}
          onPatch={onPatch}
        />
      )}
      <button
        className="plate plate--small"
        type="button"
        onClick={(): void => {
          onPatch({ filters: filters.filter((_f, i) => i !== index) });
        }}
      >
        {t("bi.removeFilter")}
      </button>
    </div>
  );
}

/**
 * The value or values a filter's operator takes.
 *
 * One box for all three arities, because what a person types is one string either way: a
 * list and a range are both comma-separated, and `valueFor` is the single place that decides
 * what the string means to the operator that holds it.
 */
function FilterValue({
  arity,
  filter,
  index,
  filters,
  onPatch,
}: {
  arity: ReturnType<typeof arityOf>;
  filter: Filter;
  index: number;
  filters: readonly Filter[];
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
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
      onChange={(event): void => {
        const text = event.currentTarget.value;
        onPatch({
          filters: filters.map((f, i) => (i === index ? { ...f, value: valueFor(f.op, text) } : f)),
        });
      }}
    />
  );
}
