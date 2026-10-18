/**
 * The grant form's row rule and hidden columns (ADR 0143), offered when what is granted is one
 * model or reference table: conditions on its columns, all of which a row must meet, and the
 * columns the holder may not read.
 *
 * The columns are the server's: `models.get` answers what the model's last build found (less any
 * the reader cannot see themselves), `seeds.get` what a reference table declares. A model never
 * built has none, and the form says so rather than offer a rule nothing could check. Both need
 * `models:read` (ADR 0147), so for a reader without it nothing is asked and no rule is offered:
 * the grant is of the whole model, which the subset rule still weighs. Whether the
 * rule is narrower than what the reader reaches is the server's subset rule; the form offers, the
 * server decides.
 *
 * The draft is the store's (`grantDraft`, `state.md`): the conditions and the ticks are the
 * reader's until they press Grant.
 */

import { ROW_OPS } from "@undercroft/contracts/rowRules";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { can } from "@/lib/permissions.ts";
import { grantDraftFor, type RuleConditionDraft, useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** The columns of the model or reference table `name`, as the server answers them. */
function useColumns(tenantId: string, name: string, seed: boolean): readonly string[] | undefined {
  const permissions = trpc.tenants.get.useQuery({ tenantId }).data?.permissions;
  const readsModels = can(permissions, "models:read");
  const model = trpc.models.get.useQuery({ tenantId, name }, { enabled: readsModels && !seed });
  const table = trpc.seeds.get.useQuery({ tenantId, name }, { enabled: readsModels && seed });
  if (seed) {
    return table.data?.columns.map((column) => column.name);
  }
  return model.data === undefined ? undefined : (model.data.lastBuild?.columns ?? []);
}

/** One condition: a column, how it compares, and its values one to a line. */
function ConditionRow({
  tenantId,
  condition,
  columns,
  disabled,
}: {
  tenantId: string;
  condition: RuleConditionDraft;
  columns: readonly string[];
  disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const columnId = useId();
  const opId = useId();
  const valuesId = useId();
  const setCondition = useUiStore((state) => state.setRuleCondition);
  const remove = useUiStore((state) => state.removeRuleCondition);
  return (
    <div className="row row--field">
      <div className="field">
        <label className="label" htmlFor={columnId}>
          {t("grantRules.columnLabel")}
        </label>
        <select
          className="input"
          disabled={disabled}
          id={columnId}
          value={condition.column}
          onChange={(event): void => {
            setCondition(tenantId, condition.key, { column: event.currentTarget.value });
          }}
        >
          {columns.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor={opId}>
          {t("grantRules.opLabel")}
        </label>
        <select
          className="input"
          disabled={disabled}
          id={opId}
          value={condition.op}
          onChange={(event): void => {
            const op = ROW_OPS.find((each) => each === event.currentTarget.value);
            if (op !== undefined) {
              setCondition(tenantId, condition.key, { op });
            }
          }}
        >
          <option value="eq">{t("grantRules.opEq")}</option>
          <option value="in">{t("grantRules.opIn")}</option>
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor={valuesId}>
          {condition.op === "eq" ? t("grantRules.valueLabel") : t("grantRules.valuesLabel")}
        </label>
        <textarea
          className="input"
          disabled={disabled}
          id={valuesId}
          rows={condition.op === "eq" ? 1 : 3}
          value={condition.values}
          onChange={(event): void => {
            setCondition(tenantId, condition.key, { values: event.currentTarget.value });
          }}
        />
      </div>
      <button
        className="plate plate--small"
        disabled={disabled}
        type="button"
        onClick={(): void => {
          remove(tenantId, condition.key);
        }}
      >
        {t("grantRules.removeCondition")}
      </button>
    </div>
  );
}

/** The row rule's conditions, and the button that adds one. */
function RowRuleFields({
  tenantId,
  columns,
  disabled,
}: {
  tenantId: string;
  columns: readonly string[];
  disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const hintId = useId();
  const stored = useUiStore((state) => state.grantDraft);
  const { conditions } = grantDraftFor({ grantDraft: stored }, tenantId);
  const add = useUiStore((state) => state.addRuleCondition);
  return (
    <fieldset aria-describedby={hintId} className="field">
      <legend className="label">{t("grantRules.rowsHead")}</legend>
      <div className="stack stack--tight">
        {conditions.map((condition) => (
          <ConditionRow
            key={condition.key}
            tenantId={tenantId}
            condition={condition}
            columns={columns}
            disabled={disabled}
          />
        ))}
        <div className="row">
          <button
            className="plate plate--small"
            disabled={disabled || columns.length === 0}
            type="button"
            onClick={(): void => {
              add(tenantId, columns[0] ?? "");
            }}
          >
            {t("grantRules.addCondition")}
          </button>
        </div>
      </div>
      <p className="field__hint" id={hintId}>
        {conditions.length === 0 ? t("grantRules.rowsNone") : t("grantRules.rowsHint")}
      </p>
    </fieldset>
  );
}

/** The columns to hide, one box each. */
function HiddenColumnFields({
  tenantId,
  columns,
  disabled,
}: {
  tenantId: string;
  columns: readonly string[];
  disabled: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const hintId = useId();
  const stored = useUiStore((state) => state.grantDraft);
  const { hidden } = grantDraftFor({ grantDraft: stored }, tenantId);
  const toggle = useUiStore((state) => state.toggleHiddenColumn);
  return (
    <fieldset aria-describedby={hintId} className="field">
      <legend className="label">{t("grantRules.hiddenHead")}</legend>
      <div className="stack stack--tight">
        {columns.map((column) => (
          <label key={column} className="punch">
            <input
              type="checkbox"
              disabled={disabled}
              checked={hidden.includes(column)}
              onChange={(): void => {
                toggle(tenantId, column);
              }}
            />
            <span className="punch__box" />
            <span className="datum">{column}</span>
          </label>
        ))}
      </div>
      <p className="field__hint" id={hintId}>
        {t("grantRules.hiddenHint")}
      </p>
    </fieldset>
  );
}

/** The rule fields for a grant of the model or reference table `name`. */
export function GrantRuleFields({
  tenantId,
  name,
  seed,
  disabled,
}: {
  tenantId: string;
  name: string;
  seed: boolean;
  disabled: boolean;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const columns = useColumns(tenantId, name, seed);
  if (columns === undefined) {
    return null;
  }
  if (columns.length === 0) {
    return <p className="note">{t("grantRules.noColumns", { name })}</p>;
  }
  return (
    <div className="stack stack--tight">
      <RowRuleFields tenantId={tenantId} columns={columns} disabled={disabled} />
      <HiddenColumnFields tenantId={tenantId} columns={columns} disabled={disabled} />
    </div>
  );
}
