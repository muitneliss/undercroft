import "./workspace.css";
import "./details.css";
import { useEffect, useId, useRef } from "react";
import { GRAPH_LIMIT, PAGE_SIZE } from "./catalog.ts";
import { patchWorkspace, useWords, useWorkspace } from "./hooks.ts";
import { ModelName, Pager } from "./shared.tsx";
import type { Catalog } from "./types.ts";

export function ModelChooser({
  catalog,
  ids,
  root,
  apply,
}: {
  catalog: Catalog;
  ids: string[];
  root: string;
  apply: (table: boolean) => void;
}): React.JSX.Element {
  const { t } = useWords();
  const state = useWorkspace();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const query = state.chooserQuery.trim().toLocaleLowerCase();
  const matches = ids.filter((id) => {
    if (id === root) {
      return false;
    }
    const model = catalog.models.find((item) => item.id === id);
    return [id, model?.title.vi, model?.title.en].join(" ").toLocaleLowerCase().includes(query);
  });
  const rows = state.selectedOnly ? ids.filter((id) => state.selected.includes(id)) : matches;
  const page = Math.min(state.chooserPage, Math.max(1, Math.ceil(rows.length / PAGE_SIZE)));
  const pageIds = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => {
    dialogRef.current?.showModal();
    return (): void => dialogRef.current?.close();
  }, []);
  function close(): void {
    patchWorkspace({ chooser: false, selected: [] });
  }
  return (
    <dialog ref={dialogRef} className="mw-dialog" onCancel={close} aria-labelledby={titleId}>
      <div className="mw-section-head">
        <h2 id={titleId}>{t("modelsWorkspace.chooserTitle")}</h2>
        <button type="button" className="plate" onClick={close}>
          {t("modelsWorkspace.close")}
        </button>
      </div>
      <p>{t("modelsWorkspace.chooserHint")}</p>
      <label className="field">
        <span className="mw-sr">{t("modelsWorkspace.search")}</span>
        <input
          className="input"
          type="search"
          value={state.chooserQuery}
          placeholder={t("modelsWorkspace.search")}
          onChange={(event): void =>
            patchWorkspace({ chooserQuery: event.target.value, chooserPage: 1 })
          }
        />
      </label>
      <SelectionBar pageIds={pageIds} matches={matches} />
      <div className="mw-chooser-rows">
        {pageIds.map((id) => {
          const model = catalog.models.find((item) => item.id === id);
          return (
            <label className="mw-choice" key={id}>
              <input
                type="checkbox"
                checked={state.selected.includes(id)}
                onChange={(): void =>
                  changeSelection(
                    state.selected.includes(id)
                      ? state.selected.filter((item) => item !== id)
                      : [...state.selected, id],
                  )
                }
              />
              <span>{model ? <ModelName model={model} /> : <code>{id}</code>}</span>
            </label>
          );
        })}
        {rows.length === 0 && <p>{t("modelsWorkspace.empty")}</p>}
      </div>
      <Pager
        total={rows.length}
        page={page}
        size={PAGE_SIZE}
        change={(next): void => patchWorkspace({ chooserPage: next })}
      />
      <SelectionFooter apply={apply} />
    </dialog>
  );
}

function SelectionBar({
  pageIds,
  matches,
}: {
  pageIds: string[];
  matches: string[];
}): React.JSX.Element {
  const { t } = useWords();
  const state = useWorkspace();
  const allCheckRef = useRef<HTMLInputElement>(null);
  const pageSelected = pageIds.filter((id) => state.selected.includes(id)).length;
  useEffect(() => {
    if (allCheckRef.current) {
      allCheckRef.current.indeterminate = pageSelected > 0 && pageSelected < pageIds.length;
    }
  }, [pageSelected, pageIds.length]);

  return (
    <div className="mw-selection-bar">
      <label>
        <input
          type="checkbox"
          ref={allCheckRef}
          checked={pageIds.length > 0 && pageSelected === pageIds.length}
          onChange={(): void =>
            changeSelection(
              pageSelected === pageIds.length
                ? state.selected.filter((id) => !pageIds.includes(id))
                : [...state.selected, ...pageIds],
            )
          }
        />
        {t("modelsWorkspace.selectPage")}
      </label>
      <button
        type="button"
        className="mw-link"
        onClick={(): void => changeSelection([...state.selected, ...matches])}
      >
        {t("modelsWorkspace.selectResults", { count: matches.length })}
      </button>
      <button
        type="button"
        className="mw-link"
        onClick={(): void => changeSelection(state.selected.filter((id) => !matches.includes(id)))}
      >
        {t("modelsWorkspace.clearResults")}
      </button>
      <span>
        {t("modelsWorkspace.outsideSelection", {
          count: state.selected.filter((id) => !matches.includes(id)).length,
        })}
      </span>
      <button type="button" className="mw-link" onClick={(): void => changeSelection([])}>
        {t("modelsWorkspace.clearSelection")}
      </button>
      <label>
        <input
          type="checkbox"
          checked={state.selectedOnly}
          onChange={(event): void =>
            patchWorkspace({ selectedOnly: event.target.checked, chooserPage: 1 })
          }
        />
        {t("modelsWorkspace.selectedOnly")}
      </label>
    </div>
  );
}

function SelectionFooter({ apply }: { apply: (table: boolean) => void }): React.JSX.Element {
  const { t } = useWords();
  const state = useWorkspace();
  function close(): void {
    patchWorkspace({ chooser: false, selected: [] });
  }
  return (
    <footer className="mw-selection-footer">
      <strong aria-live="polite">
        {t("modelsWorkspace.selected", { count: state.selected.length })}
      </strong>
      {state.selected.length + 1 > GRAPH_LIMIT && (
        <p>{t("modelsWorkspace.overBudget", { limit: GRAPH_LIMIT })}</p>
      )}
      <div className="mw-actions">
        <button
          className="plate"
          type="button"
          disabled={state.selected.length === 0 || state.selected.length + 1 > GRAPH_LIMIT}
          onClick={(): void => apply(false)}
        >
          {t("modelsWorkspace.apply")}
        </button>
        <button
          className="plate"
          type="button"
          disabled={state.selected.length === 0}
          onClick={(): void => apply(true)}
        >
          {t("modelsWorkspace.selectedTable")}
        </button>
        <button className="plate" type="button" onClick={close}>
          {t("modelsWorkspace.cancel")}
        </button>
      </div>
    </footer>
  );
}

function changeSelection(next: string[]): void {
  patchWorkspace({ selected: [...new Set(next)] });
}
