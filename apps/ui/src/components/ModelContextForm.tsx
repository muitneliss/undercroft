/**
 * The form an admin approves a model's business context with. ADR 0105.
 *
 * The draft lives in the store (`modelContextDraft`), seeded from the server the first time
 * this model's form is opened and kept after, like the SQL's draft: a reader who leaves to
 * check a column in the journal comes back to their own sentences, and a reload asks first.
 *
 * Saving IS approving, and it is of the definition the server holds: the request carries the
 * `basis` `models.get` answered with, and a definition that changed since is refused and
 * shown as worded. So Save waits while the SQL on screen is unsaved -- approving now would be
 * approving the SAVED SQL under different text, and the note says so rather than letting the
 * button do it quietly.
 *
 * Nothing here is filled in for the reader but the column NAMES the last build found: a name
 * is a fact about the table, a definition is a person's to write.
 */

import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { ModelDetail } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import {
  type ContextDraft,
  contextDraftFrom,
  contextFor,
  isContextDirty,
} from "@/lib/modelContextDraft.ts";
import { isModelName } from "@/lib/modelName.ts";
import { useUiStore } from "@/store.ts";
import type { trpc } from "@/trpc.ts";

export type ContextSave = ReturnType<typeof trpc.models.setContext.useMutation>;

/** Seed the draft from the server the first time THIS model's context is opened. */
function useContextDraft(tenantId: string, stored: ModelDetail): ContextDraft | null {
  const draft = useUiStore((state) => state.modelContextDraft);
  const setDraft = useUiStore((state) => state.setModelContextDraft);
  const held =
    draft !== null && draft.tenantId === tenantId && draft.name === stored.name ? draft : null;

  useEffect(() => {
    if (held === null) {
      setDraft(contextDraftFrom(tenantId, stored));
    }
  }, [stored, held, tenantId, setDraft]);

  return held;
}

export function ContextForm({
  tenantId,
  stored,
  sqlDirty,
  busy,
  approve,
}: {
  tenantId: string;
  stored: ModelDetail;
  sqlDirty: boolean;
  busy: boolean;
  approve: ContextSave;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const draft = useContextDraft(tenantId, stored);
  const setDraft = useUiStore((state) => state.setModelContextDraft);

  if (draft === null) {
    return null;
  }
  const dirty = isContextDirty(draft);

  return (
    <details className="tokenform">
      <summary className="plate">{t("models.contextEdit")}</summary>
      <form
        className="hinge stack"
        onSubmit={(event): void => {
          event.preventDefault();
          approve.mutate({
            tenantId,
            name: stored.name,
            basis: stored.context.basis,
            context: contextFor(draft),
          });
        }}
      >
        <p className="prose">{t("models.contextApproveLead")}</p>
        <TextField draftKey="purpose" label={t("models.contextPurpose")} value={draft.purpose} />
        <TextField draftKey="grain" label={t("models.contextGrain")} value={draft.grain} />
        <KeyFields draft={draft} />
        <ColumnFields draft={draft} />
        <RuleFields draft={draft} />
        <div className="row">
          <button className="plate plate--primary" disabled={busy || sqlDirty} type="submit">
            {approve.isPending ? t("models.contextSaving") : t("models.contextSave")}
          </button>
          {dirty ? (
            <button
              className="plate"
              disabled={busy}
              type="button"
              onClick={(): void => {
                setDraft(contextDraftFrom(tenantId, stored));
              }}
            >
              {t("models.discard")}
            </button>
          ) : null}
          {dirty ? <span className="datum datum--quiet">{t("models.unsaved")}</span> : null}
        </div>
        {sqlDirty ? <p className="note">{t("models.contextSaveHint")}</p> : null}
        {approve.isError ? (
          <Errata heading={t("models.contextNotSaved")} live={true} error={approve.error} />
        ) : null}
      </form>
    </details>
  );
}

function TextField({
  draftKey,
  label,
  value,
}: {
  draftKey: "purpose" | "grain";
  label: string;
  value: string;
}): React.JSX.Element {
  const id = useId();
  const edit = useUiStore((state) => state.editModelContext);
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        autoComplete="off"
        className="input"
        id={id}
        maxLength={2000}
        type="text"
        value={value}
        onChange={(event): void => {
          edit({ [draftKey]: event.currentTarget.value });
        }}
      />
    </div>
  );
}

/** One of two answers, chosen; the field under it belongs to the choice. */
function Choice({
  group,
  checked,
  label,
  onChoose,
}: {
  group: string;
  checked: boolean;
  label: string;
  onChoose: () => void;
}): React.JSX.Element {
  return (
    <label className="punch">
      <input checked={checked} name={group} type="radio" onChange={onChoose} />
      <span className="punch__box" />
      <span>{label}</span>
    </label>
  );
}

function KeyFields({ draft }: { draft: ContextDraft }): React.JSX.Element {
  const { t } = useTranslation();
  const groupId = useId();
  const id = useId();
  const edit = useUiStore((state) => state.editModelContext);
  return (
    <fieldset className="field">
      <legend className="label">{t("models.contextKeyDeclared")}</legend>
      <Choice
        checked={draft.keyKind === "declared"}
        group={groupId}
        label={t("models.contextKeyDeclaredOption")}
        onChoose={(): void => {
          edit({ keyKind: "declared" });
        }}
      />
      <Choice
        checked={draft.keyKind === "none"}
        group={groupId}
        label={t("models.contextKeyNoneOption")}
        onChoose={(): void => {
          edit({ keyKind: "none" });
        }}
      />
      {draft.keyKind === null ? null : (
        <div className="field">
          <label className="label" htmlFor={id}>
            {draft.keyKind === "declared"
              ? t("models.contextKeyColumnsLabel")
              : t("models.contextKeyReasonLabel")}
          </label>
          <input
            autoComplete="off"
            className={draft.keyKind === "declared" ? "input mono" : "input"}
            id={id}
            maxLength={2000}
            type="text"
            value={draft.keyKind === "declared" ? draft.keyColumns : draft.keyReason}
            onChange={(event): void => {
              const { value } = event.currentTarget;
              edit(draft.keyKind === "declared" ? { keyColumns: value } : { keyReason: value });
            }}
          />
          {draft.keyKind === "declared" ? (
            <p className="field__hint">{t("models.contextKeyColumnsHint")}</p>
          ) : null}
        </div>
      )}
    </fieldset>
  );
}

function ColumnFields({ draft }: { draft: ContextDraft }): React.JSX.Element {
  const { t } = useTranslation();
  const edit = useUiStore((state) => state.editModelContext);
  function change(index: number, patch: Partial<ContextDraft["columns"][number]>): void {
    edit({
      columns: draft.columns.map((column, at) => (at === index ? { ...column, ...patch } : column)),
    });
  }

  return (
    <div className="stack stack--tight">
      <span className="label">{t("models.contextColumns")}</span>
      {draft.columns.length === 0 ? null : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{t("models.colColumn")}</th>
                <th scope="col">{t("models.colDefinition")}</th>
                <th scope="col">{t("models.colUnit")}</th>
                <th scope="col">{t("models.removeColumn")}</th>
              </tr>
            </thead>
            <tbody>
              {draft.columns.map((column, index) => (
                <tr key={column.name}>
                  <td className="datum">{column.name}</td>
                  <td>
                    <input
                      aria-label={t("models.contextDefinitionLabel", { column: column.name })}
                      autoComplete="off"
                      className="input"
                      maxLength={2000}
                      type="text"
                      value={column.definition}
                      onChange={(event): void => {
                        change(index, { definition: event.currentTarget.value });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={t("models.contextUnitLabel", { column: column.name })}
                      autoComplete="off"
                      className="input mono"
                      maxLength={64}
                      type="text"
                      value={column.unit}
                      onChange={(event): void => {
                        change(index, { unit: event.currentTarget.value });
                      }}
                    />
                  </td>
                  <td>
                    <button
                      className="plate plate--small"
                      type="button"
                      onClick={(): void => {
                        edit({ columns: draft.columns.filter((_, at) => at !== index) });
                      }}
                    >
                      {t("models.removeColumn")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddColumn draft={draft} />
    </div>
  );
}

function RuleFields({ draft }: { draft: ContextDraft }): React.JSX.Element {
  const { t } = useTranslation();
  const groupId = useId();
  const edit = useUiStore((state) => state.editModelContext);

  return (
    <fieldset className="field">
      <legend className="label">{t("models.contextRules")}</legend>
      <Choice
        checked={draft.rulesKind === "listed"}
        group={groupId}
        label={t("models.contextRulesListedOption")}
        onChoose={(): void => {
          edit({ rulesKind: "listed" });
        }}
      />
      <Choice
        checked={draft.rulesKind === "none"}
        group={groupId}
        label={t("models.contextRulesNone")}
        onChoose={(): void => {
          edit({ rulesKind: "none" });
        }}
      />
      {draft.rulesKind === "listed" ? (
        <>
          {draft.rules.map((rule, index) => (
            <div className="row" key={index}>
              <input
                aria-label={t("models.contextRuleLabel", { n: index + 1 })}
                autoComplete="off"
                className="input field--grow"
                maxLength={2000}
                type="text"
                value={rule}
                onChange={(event): void => {
                  const text = event.currentTarget.value;
                  edit({ rules: draft.rules.map((held, at) => (at === index ? text : held)) });
                }}
              />
              <button
                className="plate plate--small"
                type="button"
                onClick={(): void => {
                  edit({ rules: draft.rules.filter((_, at) => at !== index) });
                }}
              >
                {t("models.removeColumn")}
              </button>
            </div>
          ))}
          <div className="row">
            <button
              className="plate"
              type="button"
              onClick={(): void => {
                edit({ rules: [...draft.rules, ""] });
              }}
            >
              {t("models.contextAddRule")}
            </button>
          </div>
        </>
      ) : null}
    </fieldset>
  );
}

/** A column the last build has not found yet, added by name with its definition left blank. */
function AddColumn({ draft }: { draft: ContextDraft }): React.JSX.Element {
  const { t } = useTranslation();
  const id = useId();
  const edit = useUiStore((state) => state.editModelContext);
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <div className="row row--field">
      <div className="field">
        <label className="label" htmlFor={id}>
          {t("models.addColumnLabel")}
        </label>
        <input
          autoComplete="off"
          className="input mono"
          id={id}
          maxLength={63}
          pattern="[a-z][a-z0-9_]*"
          ref={nameRef}
          title={t("models.nameInvalid")}
          type="text"
        />
      </div>
      <button
        className="plate"
        type="button"
        onClick={(): void => {
          const field = nameRef.current;
          const name = field?.value.trim() ?? "";
          if (field === null || !isModelName(name)) {
            field?.reportValidity();
            return;
          }
          if (!draft.columns.some((column) => column.name === name)) {
            edit({ columns: [...draft.columns, { name, definition: "", unit: "" }] });
          }
          field.value = "";
        }}
      >
        {t("models.addColumn")}
      </button>
    </div>
  );
}
