/**
 * How a question's answer is asked, whichever way it may be.
 *
 * A question opens drawn. When the draft would run exactly as it is saved (`savedAnswerId`)
 * and every parameter has a value, its answer is a READ through the query cache
 * (`bi.questions.answer`), the same read a dashboard tile makes -- so the reader sees figures
 * without pressing anything, a tile's question opens on the answer the tile already fetched,
 * and a change of parameter refetches once. Every role reads it that way, by id: a viewer can
 * never send a definition of their own, and this path never sends one.
 *
 * Once an author changes the definition there is no saved answer to read, and the draft on
 * screen runs only when Run is pressed (`bi.answer`, a member's mutation): a builder that
 * queried the warehouse on every tick of a checkbox would run half-built SQL. Run on a
 * question as saved re-reads it.
 */

import { useSearchParams } from "react-router-dom";

import type { TableResult } from "@/api/types.ts";
import type { ServerError } from "@/components/Errata.tsx";
import type { BoundParams } from "@/components/QuestionBands.tsx";
import { withPoint } from "@/lib/chartData.ts";
import { type QuestionDraft, savedAnswerId } from "@/lib/questionDraft.ts";
import { trpc } from "@/trpc.ts";

/** A question's answer as the page holds it, whichever of the two ways it was asked. */
export interface QuestionAnswer {
  readonly result: TableResult | undefined;
  readonly error: ServerError | null;
  /** A request is in flight: the first read, a re-read, or a run of the draft. */
  readonly running: boolean;
  /** Whether Run can do anything: every parameter has a value, and there is a way to ask. */
  readonly runnable: boolean;
  readonly run: () => void;
}

/** Ask `draft` under `bound`, by the one path that may: the saved read, or an author's run. */
export function useQuestionAnswer({
  tenantId,
  draft,
  canAuthor,
  bound,
}: {
  tenantId: string;
  draft: QuestionDraft;
  canAuthor: boolean;
  bound: BoundParams;
}): QuestionAnswer {
  const [, setSearch] = useSearchParams();
  const savedId = savedAnswerId(draft);
  const complete = bound.missing.length === 0;
  const saved = trpc.bi.questions.answer.useQuery(
    { tenantId, id: savedId ?? "", params: bound.params },
    { enabled: savedId !== null && complete },
  );
  const answer = trpc.bi.answer.useMutation();
  const onSaved = savedId !== null;

  return {
    result: onSaved ? saved.data : answer.data,
    error: onSaved ? saved.error : answer.error,
    running: onSaved ? saved.isFetching : answer.isPending,
    runnable: complete && (onSaved || canAuthor),
    run: (): void => {
      if (!complete) {
        return;
      }
      // A selected point names a row of the answer it was chosen on, not of the next one.
      setSearch((current) => withPoint(current, null), { replace: true });
      if (onSaved) {
        void saved.refetch();
      } else if (canAuthor) {
        answer.mutate({ tenantId, definition: draft.definition, params: bound.params });
      }
    },
  };
}
