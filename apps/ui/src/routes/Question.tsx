/**
 * One question, open: built in the form or written as SQL, run, and saved.
 *
 * The draft lives in the store, seeded once per question and kept, as the model draft is.
 * The compiled SQL is shown beside the builder from the server's one compiler, so what the
 * author sees is exactly what will run; switching to SQL mode starts from that text and is
 * one way. Parameters -- `{{name}}` holes -- take their values from the URL, so a run with
 * a filter set is a link, and a run with a hole unfilled is refused before it is sent. A
 * dashboard tile's title opens this page on the dashboard's values, carrying the way back
 * (`lib/reportLinks.ts`).
 *
 * A saved question opens READ and drawn: its answer is fetched on arrival, as a dashboard
 * tile's is (`components/QuestionResult.tsx`), under the tenant's read-only login through the
 * worker. Its three panes -- the drawing, the rows that drew it, and how it is defined -- are
 * chosen in the address (`?view=`, `lib/questionPane.ts`), so a link can open on any of them,
 * and every role may read all three. A member or an admin turns to the two-leaf workbench
 * with Edit question (`?edit=1`), the definition on one leaf and its answer on the other; a
 * new question opens there, having nothing yet to read. A viewer never sees the workbench.
 */

import { paramNames } from "@undercroft/contracts/bi";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { QuestionView, SchemaView } from "@/api/types.ts";
import { Errata, type ServerError } from "@/components/Errata.tsx";
import {
  DeleteBand,
  type HeadActions,
  ParamsBand,
  QuestionHead,
} from "@/components/QuestionBands.tsx";
import { DefinitionLeaf } from "@/components/QuestionDefinition.tsx";
import { ReadingBand, ResultLeaf } from "@/components/QuestionResult.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import { useQuestionAnswer } from "@/components/useQuestionAnswer.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { paramsFromSearch, questionParams } from "@/lib/params.ts";
import {
  draftFromQuestion,
  newQuestionDraft,
  ON_TABLE,
  type QuestionDraft,
  questionOnTable,
} from "@/lib/questionDraft.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

import "@/styles/reports.css";

const NEW = "new";
const EDIT = "edit";

/**
 * Seed the draft once per question, and hand back the one held for it.
 *
 * A new question waits for the schema, to start from its first table; a saved one waits for
 * itself. A draft already held for this question is kept untouched, which is what lets an
 * author leave the leaf and come back to what they were writing.
 *
 * The one exception is a new question opened on a table (`ON_TABLE`), the door a built model
 * opens: the link is a fresh request, so it replaces a held new draft rather than losing to
 * it. The key is dropped from the address once read, so a reload keeps the author's edits
 * and a `{{table}}` parameter never reads it as its value.
 */
function useQuestionDraft(tenantId: string, id: string, isNew: boolean): QuestionDraft | null {
  const draft = useUiStore((state) => state.questionDraft);
  const setQuestionDraft = useUiStore((state) => state.setQuestionDraft);
  const schema = trpc.bi.schema.useQuery({ tenantId });
  const question = trpc.bi.questions.get.useQuery({ tenantId, id }, { enabled: !isNew });
  const [search, setSearch] = useSearchParams();
  const onTable = isNew ? search.get(ON_TABLE) : null;

  const held =
    draft !== null && draft.tenantId === tenantId && (isNew ? draft.id === null : draft.id === id)
      ? draft
      : null;

  useEffect(() => {
    if (onTable !== null) {
      if (onTable !== "") {
        setQuestionDraft(questionOnTable(tenantId, onTable));
      }
      setSearch(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete(ON_TABLE);
          return next;
        },
        { replace: true },
      );
      return;
    }
    if (held !== null) {
      return;
    }
    if (isNew) {
      if (schema.data !== undefined) {
        setQuestionDraft(newQuestionDraft(tenantId, schema.data.tables[0]?.name ?? null));
      }
      return;
    }
    if (question.data !== undefined) {
      setQuestionDraft(draftFromQuestion(tenantId, question.data));
    }
  }, [onTable, held, isNew, schema.data, question.data, tenantId, setQuestionDraft, setSearch]);

  // Until the address is cleared, `held` may be the draft the link is about to replace.
  return onTable === null ? held : null;
}

export function Question({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const params = useParams();
  const id = params.id ?? NEW;
  const isNew = id === NEW;
  const locale = useUiStore((state) => state.locale);
  const setQuestionDraft = useUiStore((state) => state.setQuestionDraft);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const tenant = trpc.tenants.get.useQuery({ tenantId });
  const schema = trpc.bi.schema.useQuery({ tenantId });
  const question = trpc.bi.questions.get.useQuery({ tenantId, id }, { enabled: !isNew });
  const held = useQuestionDraft(tenantId, id, isNew);

  if (tenant.isPending || schema.isPending || (!isNew && question.isPending)) {
    return <Skeleton rows={6} />;
  }
  if (tenant.isError || schema.isError || question.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("bi.questionNotLoaded")}
      </Errata>
    );
  }
  if (held === null) {
    return <Skeleton rows={6} />;
  }

  return (
    <QuestionLeaf
      tenantId={tenantId}
      draft={held}
      stored={question.data ?? null}
      schema={schema.data}
      canAuthor={tenant.data.role !== "viewer"}
      locale={locale}
      onSaved={async (savedId): Promise<void> => {
        await utils.bi.questions.list.invalidate({ tenantId });
        await utils.bi.questions.get.invalidate({ tenantId, id: savedId });
        if (isNew) {
          void navigate(`${divisionPath("reports", tenantId)}/questions/${savedId}`, {
            replace: true,
          });
        }
      }}
      onDeleted={async (): Promise<void> => {
        setQuestionDraft(null);
        await utils.bi.questions.list.invalidate({ tenantId });
        void navigate(divisionPath("reports", tenantId));
      }}
    />
  );
}

/**
 * Turning between the reading page and the workbench, and Discard: the two verbs that move
 * the leaf rather than send anything. Edit mode is written to the address; Discard re-seeds
 * the draft from what the server holds, or -- for a question never saved -- drops it and
 * leaves, there being nothing to return to.
 */
function useLeafTurns(
  tenantId: string,
  stored: QuestionView | null,
): Pick<HeadActions, "onEdit" | "onDiscard"> {
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const setQuestionDraft = useUiStore((state) => state.setQuestionDraft);

  return {
    onEdit: (on): void => {
      const next = new URLSearchParams(search);
      if (on) {
        next.set(EDIT, "1");
      } else {
        next.delete(EDIT);
      }
      setSearch(next);
    },
    onDiscard: (): void => {
      if (stored === null) {
        setQuestionDraft(null);
        void navigate(divisionPath("reports", tenantId));
      } else {
        setQuestionDraft(draftFromQuestion(tenantId, stored));
      }
    },
  };
}

/**
 * The draft's SQL as the author reads it beside the builder, and the server's refusal when
 * it will not compile. The text comes from the server's one compiler, so what the author
 * reads is exactly what will run; a question written as SQL is its own text and compiles
 * nothing. A viewer may not call `bi.compile` and gets the empty text, and the route reads a
 * visual question's holes as a tile does.
 */
function useCompiled(
  tenantId: string,
  draft: QuestionDraft,
  canAuthor: boolean,
): { sqlText: string; compileError: ServerError | null } {
  const compiled = trpc.bi.compile.useQuery(
    { tenantId, definition: draft.definition },
    { enabled: canAuthor && draft.definition.kind === "visual" },
  );
  return {
    sqlText:
      (draft.definition.kind === "sql" ? draft.definition.sql : null) ?? compiled.data?.sql ?? "",
    compileError: compiled.isError ? compiled.error : null,
  };
}

/**
 * Save. The answer cached for this question is the answer to the definition it HAD, so it is
 * dropped before the draft reads as saved -- the page then never shows it as the new one's.
 */
function useSave(
  tenantId: string,
  onSaved: (id: string) => Promise<void>,
): ReturnType<typeof trpc.bi.questions.save.useMutation> {
  const utils = trpc.useUtils();
  const markQuestionSaved = useUiStore((state) => state.markQuestionSaved);
  return trpc.bi.questions.save.useMutation({
    onSuccess: async (saved) => {
      await utils.bi.questions.answer.reset({ tenantId, id: saved.id });
      markQuestionSaved(saved.id);
      await onSaved(saved.id);
    },
  });
}

function QuestionLeaf({
  tenantId,
  draft,
  stored,
  schema,
  canAuthor,
  locale,
  onSaved,
  onDeleted,
}: {
  tenantId: string;
  draft: QuestionDraft;
  /** What the server holds, which Discard returns to; null for a question never saved. */
  stored: QuestionView | null;
  schema: SchemaView;
  canAuthor: boolean;
  locale: "vi" | "en";
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const turns = useLeafTurns(tenantId, stored);

  // In the address, as a dashboard's is: a reload mid-edit lands back in the workbench.
  const edit = canAuthor && (draft.id === null || search.get(EDIT) === "1");
  const compiled = useCompiled(tenantId, draft, canAuthor);
  const names =
    compiled.sqlText === "" ? questionParams(draft.definition) : paramNames(compiled.sqlText);
  const bound = paramsFromSearch(search, names);

  const reading = useQuestionAnswer({ tenantId, draft, canAuthor, bound });
  const save = useSave(tenantId, onSaved);
  const remove = trpc.bi.questions.delete.useMutation({ onSuccess: onDeleted });

  // One request at a time across every band: the list is about to be invalidated, and a
  // second in flight answers about a question that no longer looks like this one.
  const busy = reading.running || save.isPending || remove.isPending;

  const actions: HeadActions = { save, busy, ...turns };

  return (
    <div className="sheet">
      <div className="head head--division">{t("reports.head")}</div>

      <QuestionHead
        tenantId={tenantId}
        draft={draft}
        canAuthor={canAuthor}
        edit={edit}
        actions={actions}
      />

      <ParamsBand names={names} bound={bound} />

      {edit ? (
        <>
          <Separator className="band-rule" />
          <div className="head">{t("bi.workbenchHead")}</div>
          <div className="body workbench">
            <DefinitionLeaf tenantId={tenantId} draft={draft} schema={schema} {...compiled} />
            <ResultLeaf draft={draft} reading={reading} locale={locale} busy={busy} />
          </div>
        </>
      ) : (
        <ReadingBand
          tenantId={tenantId}
          draft={draft}
          savedAt={stored?.updatedAt ?? null}
          locale={locale}
          reading={reading}
          busy={busy}
        />
      )}

      {edit ? (
        <DeleteBand
          tenantId={tenantId}
          draft={draft}
          canAuthor={canAuthor}
          busy={busy}
          remove={remove}
        />
      ) : null}
    </div>
  );
}
