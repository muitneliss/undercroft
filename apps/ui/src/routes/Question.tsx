/**
 * One question, open: built in the form or written as SQL, run, and saved.
 *
 * The draft lives in the store, seeded once per question and kept, as the model draft is.
 * The compiled SQL is shown beside the builder from the server's one compiler, so what the
 * author sees is exactly what will run; switching to SQL mode starts from that text and is
 * one way. Parameters -- `{{name}}` holes -- take their values from the URL, so a run with
 * a filter set is a link, and a run with a hole unfilled is refused before it is sent.
 *
 * Run answers as the tenant's read-only login through the worker; the result is drawn by
 * the one result table, a numeric with every digit. A viewer may run a saved question and
 * see no builder; a member or an admin authors.
 */

import { paramNames } from "@undercroft/contracts/bi";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import type { SchemaView } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import {
  DefinitionBand,
  DeleteBand,
  ParamsBand,
  QuestionHead,
} from "@/components/QuestionBands.tsx";
import { ResultBand } from "@/components/QuestionResult.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { divisionPath } from "@/lib/divisions.ts";
import { paramsFromSearch } from "@/lib/params.ts";
import { draftFromQuestion, newQuestionDraft, type QuestionDraft } from "@/lib/questionDraft.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const NEW = "new";

/**
 * Seed the draft once per question, and hand back the one held for it.
 *
 * A new question waits for the schema, to start from its first table; a saved one waits for
 * itself. A draft already held for this question is kept untouched, which is what lets an
 * author leave the leaf and come back to what they were writing.
 */
function useQuestionDraft(tenantId: string, id: string, isNew: boolean): QuestionDraft | null {
  const draft = useUiStore((state) => state.questionDraft);
  const setQuestionDraft = useUiStore((state) => state.setQuestionDraft);
  const schema = trpc.bi.schema.useQuery({ tenantId });
  const question = trpc.bi.questions.get.useQuery({ tenantId, id }, { enabled: !isNew });

  const held =
    draft !== null && draft.tenantId === tenantId && (isNew ? draft.id === null : draft.id === id)
      ? draft
      : null;

  useEffect(() => {
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
  }, [held, isNew, schema.data, question.data, tenantId, setQuestionDraft]);

  return held;
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

function QuestionLeaf({
  tenantId,
  draft,
  schema,
  canAuthor,
  locale,
  onSaved,
  onDeleted,
}: {
  tenantId: string;
  draft: QuestionDraft;
  schema: SchemaView;
  canAuthor: boolean;
  locale: "vi" | "en";
  onSaved: (id: string) => Promise<void>;
  onDeleted: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [search] = useSearchParams();
  const markQuestionSaved = useUiStore((state) => state.markQuestionSaved);

  // The compiled SQL comes from the server's one compiler, so what the author reads is
  // exactly what will run. A question written as SQL is its own text and compiles nothing.
  const visual = draft.definition.kind === "visual" ? draft.definition : null;
  const compiled = trpc.bi.compile.useQuery(
    { tenantId, definition: draft.definition },
    { enabled: canAuthor && visual !== null },
  );
  const sqlText =
    (draft.definition.kind === "sql" ? draft.definition.sql : null) ?? compiled.data?.sql ?? "";
  const names = paramNames(sqlText);
  const bound = paramsFromSearch(search, names);

  const answer = trpc.bi.answer.useMutation();
  const runSaved = trpc.bi.runQuestion.useMutation();
  const save = trpc.bi.questions.save.useMutation({
    onSuccess: async (saved) => {
      markQuestionSaved(saved.id);
      await onSaved(saved.id);
    },
  });
  const remove = trpc.bi.questions.delete.useMutation({ onSuccess: onDeleted });

  // One request at a time across every band: the list is about to be invalidated, and a
  // second in flight answers about a question that no longer looks like this one.
  const busy = answer.isPending || runSaved.isPending || save.isPending || remove.isPending;

  return (
    <div className="sheet">
      <div className="head head--division">{t("reports.head")}</div>

      <QuestionHead tenantId={tenantId} draft={draft} canAuthor={canAuthor} />

      <DefinitionBand
        tenantId={tenantId}
        draft={draft}
        schema={schema}
        canAuthor={canAuthor}
        sqlText={sqlText}
        compileError={compiled.isError ? compiled.error : null}
      />

      <ParamsBand names={names} bound={bound} />

      <ResultBand
        tenantId={tenantId}
        draft={draft}
        canAuthor={canAuthor}
        locale={locale}
        bound={bound}
        actions={{ answer, runSaved, save, busy }}
      />

      <DeleteBand
        tenantId={tenantId}
        draft={draft}
        canAuthor={canAuthor}
        busy={busy}
        remove={remove}
      />
    </div>
  );
}
