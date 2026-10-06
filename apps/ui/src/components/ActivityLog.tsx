/**
 * The audit log (ADR 0112): who did what, through which door, and how it ended.
 *
 * Three readers, one table. Which rows a reader may see is the server's gate on each procedure
 * -- `audit.mine` for anybody, `audit.tenant` for the customer's admin, `audit.all` for a
 * superadmin -- and never a filter here; what changes by scope is only which columns say
 * something. Your own log has no "who", a customer's has no "customer".
 *
 * A refusal is printed with its reason as the server's code (`FORBIDDEN`, `WRITES_DISABLED`):
 * the code is what an agent matches and what a person quotes when asking why, so it is never
 * translated (`i18n.md`).
 *
 * No `useState`: the pages are the infinite query's, and "show more" is its `fetchNextPage`.
 */

import { useTranslation } from "react-i18next";

import type { AuditEntry } from "@/api/types.ts";
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
import { actionLabel, detailNote } from "@/lib/activity.ts";
import { MISSING } from "@/lib/money.ts";
import { formatDateTime } from "@/lib/when.ts";
import { useUiStore } from "@/store.ts";
import { trpc } from "@/trpc.ts";

const PAGE = 50;

/** Whose log: your own, one customer's, or the whole platform's. */
export type ActivityScope =
  | { readonly kind: "mine" }
  | { readonly kind: "tenant"; readonly tenantId: string }
  | { readonly kind: "all" };

/** What the three infinite queries have in common, which is all the table reads. */
interface Pages {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly data:
    | { readonly pages: readonly { readonly items: readonly AuditEntry[] }[] }
    | undefined;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly fetchNextPage: () => Promise<unknown>;
}

const NEXT = {
  getNextPageParam: (page: { nextCursor: string | null }): string | undefined =>
    page.nextCursor ?? undefined,
};

function MineLog(): React.JSX.Element {
  const pages = trpc.audit.mine.useInfiniteQuery({ limit: PAGE }, NEXT);
  return <ActivityPages pages={pages} who={false} customer={true} />;
}

function TenantLog({ tenantId }: { tenantId: string }): React.JSX.Element {
  const pages = trpc.audit.tenant.useInfiniteQuery({ tenantId, limit: PAGE }, NEXT);
  return <ActivityPages pages={pages} who={true} customer={false} />;
}

function AllLog(): React.JSX.Element {
  const pages = trpc.audit.all.useInfiniteQuery({ limit: PAGE }, NEXT);
  return <ActivityPages pages={pages} who={true} customer={true} />;
}

export function ActivityLog({ scope }: { scope: ActivityScope }): React.JSX.Element {
  if (scope.kind === "tenant") {
    return <TenantLog tenantId={scope.tenantId} />;
  }
  return scope.kind === "all" ? <AllLog /> : <MineLog />;
}

function ActivityPages({
  pages,
  who,
  customer,
}: {
  pages: Pages;
  who: boolean;
  customer: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  if (pages.isPending) {
    return <Skeleton rows={4} />;
  }
  if (pages.isError || pages.data === undefined) {
    return (
      <Errata heading={t("common.notLoaded")} live={true}>
        {t("activity.notLoaded")}
      </Errata>
    );
  }
  const entries = pages.data.pages.flatMap((page) => page.items);
  if (entries.length === 0) {
    return <p className="note">{t("activity.none")}</p>;
  }
  return (
    <div className="stack">
      {/* A desk's measure that scrolls on a phone, rather than five columns shredded to fit. */}
      <div className="table-scroll">
        <ActivityTable entries={entries} who={who} customer={customer} />
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

function ActivityTable({
  entries,
  who,
  customer,
}: {
  entries: readonly AuditEntry[];
  who: boolean;
  customer: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  return (
    <Table>
      <TableCaption>{t("activity.caption", { count: entries.length })}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t("activity.colWhen")}</TableHead>
          {who ? <TableHead scope="col">{t("activity.colWho")}</TableHead> : null}
          <TableHead scope="col">{t("activity.colAction")}</TableHead>
          {customer ? <TableHead scope="col">{t("activity.colCustomer")}</TableHead> : null}
          <TableHead scope="col">{t("activity.colChannel")}</TableHead>
          <TableHead scope="col">{t("activity.colOutcome")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="datum datum--quiet">{formatDateTime(entry.at, locale)}</TableCell>
            {who ? <TableCell className="datum">{entry.actor}</TableCell> : null}
            <TableCell>
              <span className="datum">{actionLabel(t, entry.action)}</span>
              <span className="datum datum--quiet journal__trigger">
                {detailNote(entry.detail)}
              </span>
            </TableCell>
            {customer ? (
              <TableCell className="datum datum--quiet">{entry.tenantId ?? MISSING}</TableCell>
            ) : null}
            <TableCell className="datum datum--quiet">
              {entry.channel === null ? MISSING : t(`activity.channel.${entry.channel}`)}
            </TableCell>
            <TableCell>
              <span className="datum">{t(`activity.outcome.${entry.outcome}`)}</span>
              {entry.reason === null ? null : (
                <span className="datum datum--quiet journal__trigger">{entry.reason}</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
