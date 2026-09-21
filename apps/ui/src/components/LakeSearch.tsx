/**
 * One question over the whole lake: records and document text, Vietnamese and English.
 *
 * WHAT IT ANSWERS that nothing else on this leaf does. The index says how much landed and the
 * browser pages one stream at a time; both need the reader to know WHERE to look first. This is
 * for the reader who does not -- "which of our data mentions this clause, this reference, this
 * name" -- and since ADR 0024 landed the extracted text, most of the answer is in documents the
 * browser can only show the catalogue row of.
 *
 * THE QUESTION LIVES IN THE URL (`?q=`), like the open stream beside it. Three things follow
 * from that and all three are the point: a search is a link an admin can paste to a colleague,
 * a reload lands on the same results, and there is no third owner of state for the query cache
 * and the store to drift away from (`state.md`). The input is uncontrolled with a `defaultValue`
 * and `key`, so typing is the browser's business until Search is pressed.
 *
 * THE HIGHLIGHTING IS OURS, not the server's. The excerpt arrives as the source's own text --
 * diacritics intact -- and `highlightSegments` re-finds the terms through the same fold Postgres
 * matched with. Marked-up HTML on the wire would be markup every reader had to trust.
 *
 * Admin-only, decided by the route and enforced by the server; this file only draws.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { RawSearchHit } from "@/api/types.ts";
import { Errata } from "@/components/Errata.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table.tsx";
import { highlightSegments } from "@/lib/fold.ts";
import { hitNotes, hitWhere, streamParams } from "@/lib/lake.ts";
import { formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

/** Enough to scan on one screen. Narrowing the words beats paging a relevance order. */
const HITS = 20;

/** The excerpt, with every occurrence of a query term marked. */
function Excerpt({ text, query }: { text: string; query: string }): React.JSX.Element {
  return (
    <span className="datum">
      {highlightSegments(text, query).map((segment, index) =>
        segment.match ? (
          // The index is part of the key because the same run of text can legitimately occur
          // twice in one excerpt, and the pair is what makes it unique.
          <mark className="hit" key={`${String(index)}:${segment.text}`}>
            {segment.text}
          </mark>
        ) : (
          <span key={`${String(index)}:${segment.text}`}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

function Hits({
  hits,
  query,
}: {
  hits: readonly RawSearchHit[];
  query: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);

  return (
    <Table>
      <TableCaption>{t("lake.searchHits", { count: hits.length })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("lake.searchColWhere")}</TableHead>
          <TableHead scope="col">{t("lake.searchColMatch")}</TableHead>
          <TableHead scope="col">{t("lake.colObserved")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {hits.map((hit) => {
          const notes = hitNotes(t, hit, locale);
          return (
            <TableRow key={`${hit.kind}:${hit.source}:${hitWhere(hit)}`}>
              <TableCell>
                <span className="label">
                  {hit.kind === "record"
                    ? t("lake.searchKindRecord")
                    : t("lake.searchKindDocument")}
                </span>
                <div className="datum">{hitWhere(hit)}</div>
                {hit.kind === "record" ? (
                  // Into the browser above, on the stream this row belongs to. A document hit
                  // gets no such link: the catalogue is paged by source alone, so it would land
                  // the reader on a list they would then have to search again by eye.
                  <Link
                    className="datum datum--quiet"
                    to={`?${new URLSearchParams(
                      streamParams({ kind: "records", source: hit.source, entity: hit.entity }),
                    ).toString()}`}
                  >
                    {t("lake.searchOpenStream")}
                  </Link>
                ) : null}
              </TableCell>
              <TableCell>
                <Excerpt query={query} text={hit.excerpt} />
                {notes.map((note) => (
                  <div className="note" key={note}>
                    {note}
                  </div>
                ))}
              </TableCell>
              <TableCell className="datum datum--quiet">
                {formatDateTime(hit.observedAt, locale)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The results for whatever the URL is asking, or the reason there are none. */
function Results({ tenantId, query }: { tenantId: string; query: string }): React.JSX.Element {
  const { t } = useTranslation();
  const found = trpc.lake.search.useQuery({ tenantId, q: query, limit: HITS });

  if (found.isPending) {
    return <Skeleton rows={3} />;
  }
  if (found.isError) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("lake.searchNotLoaded")}
      </Errata>
    );
  }
  if (found.data.hits.length === 0) {
    // Absence worded as absence. "Nothing matched" is an answer; an empty table is not.
    return <p className="note">{t("lake.searchNothing", { q: query })}</p>;
  }
  return (
    <div className="stack">
      <Hits hits={found.data.hits} query={query} />
      {found.data.truncated ? <p className="note">{t("lake.searchMore")}</p> : null}
    </div>
  );
}

export function LakeSearch({ tenantId }: { tenantId: string }): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  // A generated id, not a literal: this band is mounted once today, but a duplicate `for`/`id`
  // pair silently points a label at the wrong control, which is the kind of breakage a reader
  // only meets with a screen reader on.
  const inputId = useId();

  return (
    <div className="stack">
      <p className="prose">{t("lake.searchLead")}</p>
      <form
        className="row"
        onSubmit={(event): void => {
          event.preventDefault();
          const typed = new FormData(event.currentTarget).get("q");
          const next = new URLSearchParams(params);
          // Written, or removed: `?q=` with nothing after it is a URL that asks a question
          // nobody typed, and it would be the link a reader pastes.
          if (typeof typed === "string" && typed.trim() !== "") {
            next.set("q", typed.trim());
          } else {
            next.delete("q");
          }
          setParams(next);
        }}
      >
        <label className="field" htmlFor={inputId}>
          <span className="label">{t("lake.searchLabel")}</span>
          <input
            className="input"
            defaultValue={query}
            id={inputId}
            // Keyed on the query so that a reader who arrives by a pasted link, or presses
            // Back, sees the box holding the question that produced the results beside it.
            key={query}
            name="q"
            placeholder={t("lake.searchPlaceholder")}
            type="search"
          />
        </label>
        <button className="plate plate--primary" type="submit">
          {t("lake.searchSubmit")}
        </button>
      </form>
      {query === "" ? (
        <p className="prose prose--quiet">{t("lake.searchIdle")}</p>
      ) : (
        <Results query={query} tenantId={tenantId} />
      )}
    </div>
  );
}
