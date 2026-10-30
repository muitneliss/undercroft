/**
 * Agents' calls, kept whole for a platform superadmin (ADR 0151): what a CLI, an MCP client or the
 * assistant sent, what it was answered, and the cause of a failure its caller was told only as
 * `internal_error`.
 *
 * The list is `audit.calls.list`, without bodies; a row unfolds into `audit.calls.get`, read only
 * when it is opened, since a call is up to 256 KB each way. Both refuse anybody but a superadmin,
 * whatever this page offers -- the offer in `Account.tsx` is courtesy.
 *
 * The filters live in the URL (`?email=&customer=&outcome=`), like the lake's search: a page a
 * superadmin pastes to a colleague, read back on reload, typed into uncontrolled fields until
 * Filter is pressed. Which row is unfolded is the store's (`openCall`), for the reason a run's
 * unfolded reason is: a fold is not a place in the product.
 *
 * A body is printed indented but never re-parsed (`lib/calls.ts`), and as stored when it was cut
 * at the cap or is not JSON. An answer kept as its shape says so: it carries a customer's rows,
 * and the control plane keeps no cell of them.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type { CallEntry } from "@/api/types.ts";
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
import { actionLabel } from "@/lib/activity.ts";
import { printedBody } from "@/lib/calls.ts";
import { formatBytes, MISSING } from "@/lib/money.ts";
import { formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const PAGE = 50;

const OUTCOMES = ["ok", "refused", "failed"] as const;
type CallOutcome = (typeof OUTCOMES)[number];

function outcomeOf(value: string | null): CallOutcome | undefined {
  return OUTCOMES.find((outcome) => outcome === value);
}

/** A filter as the URL holds it: a value, or absent -- never `?email=` with nothing after it. */
function filled(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? undefined : trimmed;
}

export function CallLog(): React.JSX.Element {
  const [params] = useSearchParams();
  const email = filled(params.get("email"));
  const tenantId = filled(params.get("customer"));
  const outcome = outcomeOf(params.get("outcome"));
  return (
    <div className="stack">
      <CallFilters email={email} tenantId={tenantId} outcome={outcome} />
      <CallPages email={email} tenantId={tenantId} outcome={outcome} />
    </div>
  );
}

interface Filters {
  readonly email: string | undefined;
  readonly tenantId: string | undefined;
  readonly outcome: CallOutcome | undefined;
}

function CallFilters({ email, tenantId, outcome }: Filters): React.JSX.Element {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const emailId = useId();
  const customerId = useId();
  const outcomeId = useId();
  // Keyed on what the URL says, so a reader who arrives by a pasted link or presses Back sees
  // the fields holding the filter that produced the rows below them.
  const key = `${email ?? ""}|${tenantId ?? ""}|${outcome ?? ""}`;

  return (
    <form
      className="row row--field"
      key={key}
      onSubmit={(event): void => {
        event.preventDefault();
        const typed = new FormData(event.currentTarget);
        const next = new URLSearchParams(params);
        for (const name of ["email", "customer", "outcome"] as const) {
          const value = typed.get(name);
          const kept = typeof value === "string" ? filled(value) : undefined;
          if (kept === undefined) {
            next.delete(name);
          } else {
            next.set(name, kept);
          }
        }
        setParams(next);
      }}
    >
      <label className="field" htmlFor={emailId}>
        <span className="label">{t("calls.filterEmail")}</span>
        <input
          autoComplete="off"
          className="input"
          defaultValue={email ?? ""}
          id={emailId}
          name="email"
          placeholder={t("calls.emailPlaceholder")}
          type="email"
        />
      </label>
      <label className="field" htmlFor={customerId}>
        <span className="label">{t("calls.filterCustomer")}</span>
        <input
          autoComplete="off"
          className="input"
          defaultValue={tenantId ?? ""}
          id={customerId}
          name="customer"
          placeholder={t("calls.customerPlaceholder")}
          type="text"
        />
      </label>
      <label className="field" htmlFor={outcomeId}>
        <span className="label">{t("calls.filterOutcome")}</span>
        <select
          className="input input--select"
          defaultValue={outcome ?? ""}
          id={outcomeId}
          name="outcome"
        >
          <option value="">{t("calls.outcomeAny")}</option>
          {OUTCOMES.map((each) => (
            <option key={each} value={each}>
              {t(`activity.outcome.${each}`)}
            </option>
          ))}
        </select>
      </label>
      <button className="plate plate--primary" type="submit">
        {t("calls.filter")}
      </button>
    </form>
  );
}

function CallPages(filters: Filters): React.JSX.Element {
  const { t } = useTranslation();
  const pages = trpc.audit.calls.list.useInfiniteQuery(
    {
      limit: PAGE,
      ...(filters.email === undefined ? {} : { email: filters.email }),
      ...(filters.tenantId === undefined ? {} : { tenantId: filters.tenantId }),
      ...(filters.outcome === undefined ? {} : { outcome: filters.outcome }),
    },
    { getNextPageParam: (page) => page.nextCursor ?? undefined },
  );
  if (pages.isPending) {
    return <Skeleton rows={4} />;
  }
  if (pages.isError) {
    return <Errata heading={t("common.notLoaded")} live={true} error={pages.error} />;
  }
  const calls = pages.data.pages.flatMap((page) => page.items);
  if (calls.length === 0) {
    return <p className="note">{t("calls.none")}</p>;
  }
  return (
    <div className="stack">
      <div className="table-scroll">
        <CallTable calls={calls} />
      </div>
      {pages.hasNextPage ? (
        <div className="row">
          <button
            className="plate plate--small"
            type="button"
            disabled={pages.isFetchingNextPage}
            onClick={(): void => {
              void pages.fetchNextPage();
            }}
          >
            {pages.isFetchingNextPage ? t("activity.loadingMore") : t("activity.more")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** How many columns a row spans, for the unfolded call beneath it. */
const COLUMNS = 7;

function CallTable({ calls }: { calls: readonly CallEntry[] }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const openCall = useUiStore((state) => state.openCall);
  const toggleCall = useUiStore((state) => state.toggleCall);
  return (
    <Table>
      <TableCaption>{t("calls.caption", { count: calls.length })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("activity.colWhen")}</TableHead>
          <TableHead scope="col">{t("activity.colWho")}</TableHead>
          <TableHead scope="col">{t("calls.colProcedure")}</TableHead>
          <TableHead scope="col">{t("activity.colCustomer")}</TableHead>
          <TableHead scope="col">{t("activity.colChannel")}</TableHead>
          <TableHead scope="col">{t("activity.colOutcome")}</TableHead>
          <TableHead scope="col">{t("calls.colSize")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {calls.flatMap((call) => {
          const open = openCall === call.id;
          const row = (
            <TableRow key={call.id}>
              <TableCell className="datum datum--quiet">
                {formatDateTime(call.at, locale)}
              </TableCell>
              <TableCell className="datum">{call.actor ?? MISSING}</TableCell>
              <TableCell>
                <button
                  aria-expanded={open}
                  className="plate plate--small"
                  type="button"
                  onClick={(): void => {
                    toggleCall(call.id);
                  }}
                >
                  {actionLabel(t, call.path)}
                </button>
                <span className="datum datum--quiet journal__trigger">{call.path}</span>
              </TableCell>
              <TableCell className="datum datum--quiet">{call.tenantId ?? MISSING}</TableCell>
              <TableCell className="datum datum--quiet">
                {t(`activity.channel.${call.channel}`)}
              </TableCell>
              <TableCell>
                <span className="datum">{t(`activity.outcome.${call.outcome}`)}</span>
                {call.reason === null ? null : (
                  <span className="datum datum--quiet journal__trigger">{call.reason}</span>
                )}
              </TableCell>
              <TableCell className="datum datum--quiet">
                <span>
                  {t("calls.sizes", {
                    request: formatBytes(call.requestBytes, locale),
                    response: formatBytes(call.responseBytes, locale),
                  })}
                </span>
                {call.requestTruncated || call.responseTruncated ? (
                  <span className="datum journal__trigger">{t("calls.truncated")}</span>
                ) : null}
                {call.responseKept === "whole" ? null : (
                  <span className="datum journal__trigger">
                    {t(`calls.kept.${call.responseKept}`)}
                  </span>
                )}
              </TableCell>
            </TableRow>
          );
          return open
            ? [
                row,
                <TableRow className="table__hinge" key={`${call.id}:open`}>
                  <TableCell colSpan={COLUMNS}>
                    <CallDetail id={call.id} />
                  </TableCell>
                </TableRow>,
              ]
            : [row];
        })}
      </TableBody>
    </Table>
  );
}

/** One call unfolded: its trace id, request, answer and error, read when it is opened. */
function CallDetail({ id }: { id: string }): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const call = trpc.audit.calls.get.useQuery({ id });
  if (call.isPending) {
    return <Skeleton rows={3} />;
  }
  if (call.isError) {
    return <Errata heading={t("calls.notLoadedOne")} live={true} error={call.error} />;
  }
  const { data } = call;
  return (
    <div className="stack stack--tight">
      <p className="datum datum--quiet">{t("calls.trace", { trace: data.traceId ?? MISSING })}</p>
      <Body
        heading={t("calls.request")}
        text={data.request}
        truncated={data.requestTruncated}
        bytes={formatBytes(data.requestBytes, locale)}
      />
      {data.responseKept === "none" ? (
        <p className="note">{t("calls.keptNone")}</p>
      ) : (
        <>
          {data.responseKept === "shape" ? <p className="note">{t("calls.keptShape")}</p> : null}
          <Body
            heading={t("calls.response")}
            text={data.response}
            truncated={data.responseTruncated}
            bytes={formatBytes(data.responseBytes, locale)}
          />
        </>
      )}
      {data.error === null ? null : (
        <Body
          heading={t("calls.error")}
          text={JSON.stringify(data.error)}
          truncated={false}
          bytes={null}
        />
      )}
    </div>
  );
}

function Body({
  heading,
  text,
  truncated,
  bytes,
}: {
  heading: string;
  text: string | null;
  truncated: boolean;
  bytes: string | null;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (text === null) {
    return (
      <div className="stack stack--tight">
        <span className="label">{heading}</span>
        <p className="note">{t("calls.noBody")}</p>
      </div>
    );
  }
  const printed = printedBody(text, truncated);
  return (
    <div className="stack stack--tight">
      <span className="label">{heading}</span>
      {truncated ? <p className="note">{t("calls.cut", { bytes })}</p> : null}
      {truncated || printed.indented ? null : <p className="note">{t("calls.asStored")}</p>}
      <pre className="payload__text">{printed.text}</pre>
    </div>
  );
}
