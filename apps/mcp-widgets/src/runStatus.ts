/**
 * The run widget: one run, followed live until it ends, beside a `runs_trigger` or `runs_get`
 * answer in a host's chat.
 *
 * It asks for the run itself, every two seconds, through the host (`app.callServerTool`) --
 * the same `/mcp` door and the same credential the chat used, so it can read exactly what the
 * person could and nothing more. Both calls are reads, so a read-only grant follows a run as
 * well as a write one. It stops when the run ends, after thirty minutes, and while the frame is
 * hidden: a poll nobody is looking at is load on the server for nothing, and a run that
 * outlives the half hour is still one `runs_get` away.
 *
 * What the two procedures answer is typed from the router (`ToolContentOf`), so a change to a
 * run's shape breaks this file's compile rather than this page in somebody's chat. Both are read
 * whole from the result's `_meta` (`answerOf`): a run's detail can hold a thousand dbt steps and
 * its feed three hundred events, past what the door lets a model read, and the latest events --
 * the ones this page lists -- are the ones a clip would drop.
 */

import type { ToolContentOf } from "@undercroft/control-plane/surface";
import type { Locale } from "@undercroft/core/locale";
import { MISSING } from "@undercroft/core/money";
import {
  answerOf,
  element,
  type Host,
  mount,
  refusalMessage,
  type ToolResult,
  toolFor,
} from "./host.ts";
import type { Words } from "./i18n.ts";
import { cellText } from "./table.ts";

type Run = ToolContentOf<"runs.get">;
type RunEvents = ToolContentOf<"runs.events">["items"];

/** A run's feed as last read, and the door's notes if what arrived was the model's clipped copy. */
interface Feed {
  readonly items: RunEvents;
  readonly clipped: readonly string[];
}

const POLL_MS = 2000;
const FOLLOW_FOR_MS = 30 * 60 * 1000;
/** How many of the latest events the page lists. The journal in the web UI has the rest. */
const EVENTS_SHOWN = 8;

const RUNS_GET = toolFor("runs.get");
const RUNS_EVENTS = toolFor("runs.events");

/**
 * Times read in Asia/Singapore whatever the language, as the web UI's `@/lib/when` does: a time
 * an hour off from the journal beside it is how somebody misreads a run.
 */
function formatAt(iso: string | null, locale: Locale): string {
  if (iso === null) {
    return MISSING;
  }
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-SG", {
    timeZone: "Asia/Singapore",
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(iso));
}

function statusWord(run: Run, t: Words): string {
  if (run.status === "running") {
    return t("runRunning");
  }
  return run.status === "ok" ? t("runOk") : t("runFailed");
}

function drawRun(host: Host, run: Run, feed: Feed | null, stopped: string | null): void {
  const t = host.t();
  const locale = host.locale();
  const facts = [
    t("runStarted", { at: formatAt(run.startedAt, locale) }),
    ...(run.endedAt === null ? [] : [t("runEnded", { at: formatAt(run.endedAt, locale) })]),
    ...(run.counts === null
      ? []
      : [
          t("runLanded", {
            landed: cellText(run.counts.landed, locale, t),
            refused: cellText(run.counts.refused, locale, t),
          }),
        ]),
  ];
  const latest = (feed?.items ?? []).slice(-EVENTS_SHOWN);
  host.root.replaceChildren(
    element(
      "div",
      "run-head",
      element("h1", null, t("runHead", { runId: run.id })),
      element("span", `badge badge--${run.status}`, statusWord(run, t)),
    ),
    element("ul", "facts", ...facts.map((fact) => element("li", null, fact))),
    ...(run.error === null ? [] : [element("p", "note note--error", run.error)]),
    element("p", "note", t("runEvents")),
    latest.length === 0
      ? element("p", "note", t("runNoEvents"))
      : element(
          "ol",
          "events",
          ...latest.map((event) =>
            element(
              "li",
              `level--${event.level}`,
              `${formatAt(event.at, locale)}  ${event.event}${event.entity === null ? "" : ` · ${event.entity}`}`,
            ),
          ),
        ),
    ...(feed?.clipped ?? []).map((note) => element("p", "note", note)),
    ...(stopped === null ? [] : [element("p", "note", stopped)]),
  );
}

function drawProblem(host: Host, message: string): void {
  host.root.replaceChildren(element("p", "note note--error", message));
}

/**
 * A tool result's answer (`answerOf`), as the procedure `P` answers it, or `null` when the host
 * handed over neither copy.
 *
 * The door built it from that procedure's own typed output, as `gridOf` in `table.ts` explains;
 * this is the one place the run widget takes the door at its word.
 */
function contentOf<P extends "runs.get" | "runs.events" | "runs.trigger">(
  result: ToolResult,
): ToolContentOf<P> | null {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the door built this from the named procedure's typed output; see `table.ts`.
  return answerOf(result).content as ToolContentOf<P> | null;
}

/** The feed a `runs_events` answer carries, or the one already drawn when it carries none. */
function feedOf(result: ToolResult, previous: Feed | null): Feed | null {
  const items = result.isError === true ? null : contentOf<"runs.events">(result)?.items;
  return items === undefined || items === null
    ? previous
    : { items, clipped: answerOf(result).clipped };
}

/** Follow one run: draw it, ask again every `POLL_MS`, stop at the first reason to. */
function follow(host: Host, tenantId: string, runId: string, first: Run | null): void {
  const started = Date.now();
  let feed: Feed | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let last = first;

  async function ask(): Promise<void> {
    timer = null;
    if (document.hidden) {
      paused = true;
      if (last !== null) {
        drawRun(host, last, feed, host.t()("runStoppedHidden"));
      }
      return;
    }
    paused = false;
    const args = { tenantId, runId };
    const [got, fed] = await Promise.all([
      host.app.callServerTool({ name: RUNS_GET, arguments: args }),
      host.app.callServerTool({ name: RUNS_EVENTS, arguments: args }),
    ]);
    if (got.isError === true) {
      drawProblem(host, host.t()("runUnreadable", { message: refusalMessage(got) }));
      return;
    }
    const run = contentOf<"runs.get">(got);
    if (run === null) {
      drawProblem(host, host.t()("unavailable"));
      return;
    }
    last = run;
    feed = feedOf(fed, feed);
    if (run.status !== "running") {
      drawRun(host, run, feed, null);
      return;
    }
    if (Date.now() - started >= FOLLOW_FOR_MS) {
      drawRun(host, run, feed, host.t()("runStoppedLong"));
      return;
    }
    drawRun(host, run, feed, null);
    timer = setTimeout(() => void ask(), POLL_MS);
  }

  // A frame shown again picks up where it paused, inside the same half hour.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && paused) {
      void ask();
    }
  });
  host.onTeardown(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });

  if (first !== null) {
    drawRun(host, first, null, null);
  }
  void ask();
}

function draw(result: ToolResult, host: Host): void {
  const t = host.t();
  if (result.isError === true) {
    drawProblem(host, t("refused", { message: refusalMessage(result) }));
    return;
  }
  const call = host.callOf(result);
  if (call === null || call.tenantId === null) {
    drawProblem(host, t("runUnknown"));
    return;
  }
  if (call.path === "runs.get") {
    const run = contentOf<"runs.get">(result);
    if (run === null) {
      drawProblem(host, t("unavailable"));
      return;
    }
    follow(host, call.tenantId, run.id, run);
    return;
  }
  if (call.path === "runs.trigger") {
    const triggered = contentOf<"runs.trigger">(result);
    if (triggered === null) {
      drawProblem(host, t("unavailable"));
      return;
    }
    follow(host, call.tenantId, triggered.runId, null);
    return;
  }
  drawProblem(host, t("runUnknown"));
}

await mount("Undercroft run status", draw);
