/**
 * The two ways to narrow the source schedule, both written into the address: one count per
 * state, each a door to what it counted, and a search by source or account.
 * `@/lib/sourceSchedule` decides what each narrows to; this gives them words and plates.
 */

import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";

import type { Connection } from "@/api/types.ts";
import { formatCount } from "@/lib/money.ts";
import {
  type ScheduleFilter,
  type ScheduleState,
  schedulePath,
  scheduleTally,
  withQuery,
} from "@/lib/sourceSchedule.ts";
import { useUiStore } from "@/store.ts";

/**
 * One count per state over every account, each a door to what it counted (ADR 0039). The count
 * pressed is punched through, and pressing it again widens the schedule, as the models' build
 * tally does; the search the reader typed is kept either way.
 */
export function SourceTally({
  tenantId,
  list,
  filter,
}: {
  tenantId: string;
  list: readonly Connection[];
  filter: ScheduleFilter;
}): React.JSX.Element {
  const { t } = useTranslation();
  const locale = useUiStore((state) => state.locale);
  const tally = scheduleTally(list);
  const counts: readonly {
    key: string;
    figure: number;
    label: string;
    state: ScheduleState | null;
    current: boolean;
  }[] = [
    {
      key: "connections",
      figure: tally.connections,
      label: t("sources.tallyConnections"),
      state: null,
      current: filter.state === null,
    },
    {
      key: "connected",
      figure: tally.connected,
      label: t("sources.tallyConnected"),
      state: "connected",
      current: filter.state === "connected",
    },
    {
      key: "attention",
      figure: tally.attention,
      label: t("sources.tallyAttention"),
      state: "attention",
      current: filter.state === "attention",
    },
    // Kinds are what the schedule's rows are, so this opens the whole schedule.
    {
      key: "kinds",
      figure: tally.kinds,
      label: t("sources.tallyKinds"),
      state: null,
      current: false,
    },
  ];

  return (
    <nav aria-label={t("sources.tallyLabel")} className="tally">
      {counts.map((count) => (
        <Link
          className="tally__count"
          key={count.key}
          to={schedulePath(tenantId, count.current ? null : count.state, filter.query)}
          {...(count.current ? { "aria-current": "true" as const } : {})}
        >
          <span className="tally__figure">{formatCount(count.figure, locale)}</span>
          <span className="label">{count.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/**
 * The search over the schedule, written into the address as it is typed. Replaced rather than
 * pushed, because a keystroke is not a page and Back should leave the schedule.
 */
export function SourceSearch({ query }: { query: string }): React.JSX.Element {
  const { t } = useTranslation();
  const searchId = useId();
  const [, setParams] = useSearchParams();

  return (
    <div className="field">
      <label className="label" htmlFor={searchId}>
        {t("sources.searchLabel")}
      </label>
      <input
        autoComplete="off"
        className="input"
        id={searchId}
        type="search"
        value={query}
        placeholder={t("sources.searchPlaceholder")}
        onChange={(event): void => {
          setParams((current) => withQuery(current, event.target.value), { replace: true });
        }}
      />
    </div>
  );
}
