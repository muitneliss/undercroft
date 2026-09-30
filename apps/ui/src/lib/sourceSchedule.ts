/**
 * The schedule narrowed by what the reader asked for, and the counts that do the asking.
 *
 * Both halves of the narrowing live in the address -- `?state=connected|attention` and `?q=` --
 * for the reason the customer index's do: a narrowed schedule is a page a reader can link,
 * reload or come Back to. The query cache still owns every connection; this only decides which
 * of them to show.
 *
 * Every count above the schedule is a door to what it counts (ADR 0039): Connected and Needs
 * attention narrow to exactly the accounts they counted, and Connections and Connector types
 * open the whole schedule, whose accounts and kinds are what they counted. The counts are over
 * every account, never over the narrowed list, so pressing one does not change the others.
 *
 * Which state an account is in is `connectionFacts`' decision, the one the card's own mark is
 * drawn from, so a count can never disagree with the marks it sits above. Needs attention is a
 * grant that will not read until somebody acts -- awaiting its scope, or lapsed -- and never an
 * account nobody has connected, which is a choice not yet made rather than a fault.
 *
 * Narrowing works on accounts, then gathers them by kind: a kind with no account left is not
 * drawn, and a kind's switcher offers only the accounts that matched. Whether a kind holds
 * several accounts is decided over the whole schedule, so a card still names which account it
 * is while a filter shows it alone.
 */

import { type Connection, SOURCE_LABEL } from "@/api/types.ts";
import { connectionFacts, groupByKind, type KindAccounts } from "@/lib/connectionState.ts";
import { divisionPath } from "@/lib/divisions.ts";
import { foldForSearch } from "@/lib/labelIndex.ts";

const STATE_PARAM = "state";
const QUERY_PARAM = "q";

export const SCHEDULE_STATES = ["connected", "attention"] as const;
export type ScheduleState = (typeof SCHEDULE_STATES)[number];

/** What the address narrows the schedule by. An unknown state is ignored, never guessed at. */
export interface ScheduleFilter {
  readonly state: ScheduleState | null;
  readonly query: string;
}

export function scheduleFilter(params: URLSearchParams): ScheduleFilter {
  const asked = params.get(STATE_PARAM);
  return {
    state: SCHEDULE_STATES.find((state) => state === asked) ?? null,
    query: params.get(QUERY_PARAM) ?? "",
  };
}

/** The address with `query` written into it, or removed when empty: `?q=` alone is no search. */
export function withQuery(params: URLSearchParams, query: string): URLSearchParams {
  const next = new URLSearchParams(params);
  if (query === "") {
    next.delete(QUERY_PARAM);
  } else {
    next.set(QUERY_PARAM, query);
  }
  return next;
}

/** The schedule narrowed to `state`, or widened when `state` is null; the search is kept. */
export function schedulePath(tenantId: string, state: ScheduleState | null, query: string): string {
  const params = new URLSearchParams();
  if (state !== null) {
    params.set(STATE_PARAM, state);
  }
  if (query !== "") {
    params.set(QUERY_PARAM, query);
  }
  const search = params.toString();
  const base = divisionPath("sources", tenantId);
  return search === "" ? base : `${base}?${search}`;
}

function stateOf(connection: Connection): ScheduleState | null {
  const { state } = connectionFacts(connection);
  if (state === "connected") {
    return "connected";
  }
  return state === "needs_scope" || state === "needs_reconnect" ? "attention" : null;
}

export interface ScheduleTally {
  readonly connections: number;
  readonly connected: number;
  readonly attention: number;
  readonly kinds: number;
}

export function scheduleTally(list: readonly Connection[]): ScheduleTally {
  const states = list.map(stateOf);
  return {
    connections: list.length,
    connected: states.filter((state) => state === "connected").length,
    attention: states.filter((state) => state === "attention").length,
    kinds: groupByKind(list).length,
  };
}

/** One kind's row as drawn: the accounts that matched, and whether the kind holds several. */
export interface ScheduleRow extends KindAccounts {
  readonly several: boolean;
}

function matches(connection: Connection, filter: ScheduleFilter, needle: string): boolean {
  if (filter.state !== null && stateOf(connection) !== filter.state) {
    return false;
  }
  return [SOURCE_LABEL[connection.kind], connection.externalAccountLabel, connection.source].some(
    (value) => foldForSearch(value).includes(needle),
  );
}

export function narrowSchedule(list: readonly Connection[], filter: ScheduleFilter): ScheduleRow[] {
  const needle = foldForSearch(filter.query.trim());
  return groupByKind(list).flatMap((group) => {
    const [first, ...rest] = group.accounts.filter((account) => matches(account, filter, needle));
    return first === undefined
      ? []
      : [{ kind: group.kind, accounts: [first, ...rest], several: group.accounts.length > 1 }];
  });
}
