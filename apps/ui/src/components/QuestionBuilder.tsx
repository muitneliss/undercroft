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

import {
  type Aggregate,
  AGGREGATES,
  type Field,
  type VisualDefinition,
} from "@undercroft/contracts/bi";
import { useTranslation } from "react-i18next";

import type { SchemaView } from "@/api/types.ts";
import { FilterList } from "@/components/QuestionFilters.tsx";
import { fieldAliases } from "@/lib/questionDraft.ts";
import { useId } from "react";

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

/** One column of the chosen table, as `bi.schema` describes it. */
type Column = SchemaView["tables"][number]["columns"][number];

export function QuestionBuilder({
  schema,
  definition,
  onPatch,
}: {
  schema: SchemaView;
  definition: VisualDefinition;
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const table = schema.tables.find((candidate) => candidate.name === definition.table);
  const columns = table?.columns ?? [];

  return (
    <div className="stack">
      <TablePicker tables={schema.tables} chosen={definition.table} onPatch={onPatch} />
      <ColumnPicker columns={columns} fields={definition.fields} onPatch={onPatch} />
      <FilterList columns={columns} filters={definition.filters} onPatch={onPatch} />
      <GroupPicker columns={columns} groupBy={definition.groupBy} onPatch={onPatch} />
      <OrderAndLimit definition={definition} onPatch={onPatch} />
    </div>
  );
}

/**
 * Which table the question reads.
 *
 * Changing it resets every other clause, because a column chosen against one table cannot
 * mean anything against another -- and a filter left behind would compile to SQL the tenant's
 * login refuses, which reads as a platform fault rather than as the stale choice it is.
 */
function TablePicker({
  tables,
  chosen,
  onPatch,
}: {
  tables: SchemaView["tables"];
  chosen: string;
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const qTableId = useId();

  return (
    <div className="field">
      <label className="label" htmlFor={qTableId}>
        {t("bi.tableLabel")}
      </label>
      <select
        className="input input--select"
        id={qTableId}
        value={chosen}
        onChange={(event): void => {
          onPatch({
            table: event.currentTarget.value,
            fields: [{ column: "*", aggregate: "count", alias: "count" }],
            filters: [],
            groupBy: [],
            orderBy: [],
          });
        }}
      >
        {tables.map((candidate) => (
          <option key={candidate.name} value={candidate.name}>
            {candidate.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Which columns are read, and what is done to each: the column's own value, or an aggregate. */
function ColumnPicker({
  columns,
  fields,
  onPatch,
}: {
  columns: readonly Column[];
  fields: readonly Field[];
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const countAll = fields.some((f) => f.column === "*");

  return (
    <fieldset className="index">
      <legend className="label index__legend">{t("bi.columnsHead")}</legend>
      <div className="index__cols">
        <label className="punch">
          <input
            type="checkbox"
            checked={countAll}
            onChange={(event): void => {
              onPatch({
                fields: event.currentTarget.checked
                  ? [...fields, { column: "*", aggregate: "count", alias: "count" }]
                  : fields.filter((f) => f.column !== "*"),
              });
            }}
          />
          <span className="punch__box" />
          <span>{t("bi.countAll")}</span>
        </label>
        {columns.map((column) => (
          <ColumnChoice
            key={column.name}
            column={column}
            field={fields.find((f) => f.column === column.name)}
            fields={fields}
            onPatch={onPatch}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** One column's tick, and -- once ticked -- what is done to it. */
function ColumnChoice({
  column,
  field,
  fields,
  onPatch,
}: {
  column: Column;
  field: Field | undefined;
  fields: readonly Field[];
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div className="builder__column">
      <label className="punch">
        <input
          type="checkbox"
          checked={field !== undefined}
          onChange={(event): void => {
            onPatch({ fields: withField(fields, column.name, event.currentTarget.checked) });
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
          onChange={(event): void => {
            onPatch({ fields: withAggregate(fields, column.name, event.currentTarget.value) });
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
}

/** Which columns the rows are grouped by. */
function GroupPicker({
  columns,
  groupBy,
  onPatch,
}: {
  columns: readonly Column[];
  groupBy: readonly string[];
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <fieldset className="index">
      <legend className="label index__legend">{t("bi.groupHead")}</legend>
      <div className="index__cols">
        {columns.map((column) => (
          <label key={column.name} className="punch">
            <input
              type="checkbox"
              checked={groupBy.includes(column.name)}
              onChange={(event): void => {
                onPatch({
                  groupBy: event.currentTarget.checked
                    ? [...groupBy, column.name]
                    : groupBy.filter((g) => g !== column.name),
                });
              }}
            />
            <span className="punch__box" />
            <span>{column.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * How the rows come back: by which alias, which way, and how many.
 *
 * The order is offered by ALIAS rather than by column, because that is what the compiled
 * query names -- ordering by a column that was aggregated away is a refusal from Postgres.
 */
function OrderAndLimit({
  definition,
  onPatch,
}: {
  definition: VisualDefinition;
  onPatch: (patch: Patch) => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const qLimitId = useId();
  const qOrderId = useId();
  const aliases = fieldAliases(definition);
  const [order] = definition.orderBy;

  return (
    <div className="row row--field">
      <div className="field">
        <label className="label" htmlFor={qOrderId}>
          {t("bi.orderHead")}
        </label>
        <select
          className="input input--select"
          id={qOrderId}
          value={order?.by ?? NONE}
          onChange={(event): void => {
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
          onChange={(event): void => {
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
        <label className="label" htmlFor={qLimitId}>
          {t("bi.limitLabel")}
        </label>
        <input
          className="input"
          id={qLimitId}
          max={5000}
          min={1}
          type="number"
          value={definition.limit}
          onChange={(event): void => {
            // parseInt, not Number(): a row count, not an amount.
            const limit = Number.parseInt(event.currentTarget.value, 10);
            if (Number.isFinite(limit) && limit >= 1) {
              onPatch({ limit });
            }
          }}
        />
      </div>
    </div>
  );
}
