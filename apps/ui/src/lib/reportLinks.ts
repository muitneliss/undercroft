/**
 * The two links between a dashboard and a question on it: a tile's title into its question
 * on the dashboard's filter values, and the question's way back to the dashboard as it was.
 *
 * Both carry values in the address, where every parameter here already lives (`p.<name>`,
 * `lib/params.ts`), so the question runs on the same values with nothing re-entered and the
 * way back lands on the same figures. The tile hands over only the parameters its question
 * takes: a dashboard filter the question does not reach for would sit in the question's
 * address meaning nothing.
 *
 * The way back rides as `from=`, the dashboard's path and its filter values. It is read from
 * an address anyone can write, so it is accepted only as a path to a dashboard in the same
 * tenant's Reports, and rebuilt from its parsed parts rather than echoed: anything else --
 * another origin, `//host`, a path out of Reports -- answers no way back, never a redirect.
 */

import { PARAM_PREFIX } from "@/lib/params.ts";
import { type QuestionPane, withPane } from "@/lib/questionPane.ts";

/** The search key the way back rides under. */
export const FROM = "from";

/** A base no real address has, so a `from` that names any origin at all fails to match it. */
const IN_APP = "http://in-app.invalid";

/** A dashboard's id is one path segment: a uuid, or `new` for one not yet saved. */
const DASHBOARD_ID = /^[\w-]+$/u;

/** The `p.<name>` entries of `search`, and nothing else: no edit mode, no stale key. */
function filterValues(search: URLSearchParams): URLSearchParams {
  const kept = new URLSearchParams();
  for (const [key, value] of search) {
    if (key.startsWith(PARAM_PREFIX) && value !== "") {
      kept.append(key, value);
    }
  }
  return kept;
}

function withSearch(path: string, search: URLSearchParams): string {
  const text = search.toString();
  return text === "" ? path : `${path}?${text}`;
}

/**
 * Where a tile's title leads: `questionPath` with the dashboard's value for each of `names`,
 * the parameters that question takes, and the way back to `dashboardPath` as it stands --
 * opened on `pane` when one is named, as a tile's "View data" opens its rows.
 */
export function tileQuestionHref(link: {
  readonly questionPath: string;
  readonly names: readonly string[];
  readonly dashboardPath: string;
  readonly search: URLSearchParams;
  readonly pane?: QuestionPane;
}): string {
  let next = new URLSearchParams();
  for (const name of link.names) {
    const value = link.search.get(`${PARAM_PREFIX}${name}`);
    if (value !== null && value !== "") {
      next.set(`${PARAM_PREFIX}${name}`, value);
    }
  }
  if (link.pane !== undefined) {
    next = withPane(next, link.pane);
  }
  next.set(FROM, withSearch(link.dashboardPath, filterValues(link.search)));
  return withSearch(link.questionPath, next);
}

/** The dashboard a question was opened from, when `from` names one in `reportsBase`. */
export interface DashboardBack {
  readonly id: string;
  readonly href: string;
}

/** The way back `search` carries, or null when it carries none this page may follow. */
export function dashboardBack(search: URLSearchParams, reportsBase: string): DashboardBack | null {
  const from = search.get(FROM);
  if (from === null || !from.startsWith(`${reportsBase}/dashboards/`)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(from, IN_APP);
  } catch {
    return null;
  }
  const prefix = `${reportsBase}/dashboards/`;
  const id = url.pathname.slice(prefix.length);
  if (url.origin !== IN_APP || !url.pathname.startsWith(prefix) || !DASHBOARD_ID.test(id)) {
    return null;
  }
  return { id, href: withSearch(url.pathname, filterValues(url.searchParams)) };
}
