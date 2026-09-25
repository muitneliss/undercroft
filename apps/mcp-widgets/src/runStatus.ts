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
 * run's shape breaks this file's compile rather than this page in somebody's chat.
 */

import type { ToolContentOf } from "@undercroft/control-plane/surface";
import type { Locale } from "@undercroft/core/locale";
import { MISSING } from "@undercroft/core/money";
import { element, type Host, mount, refusalMessage, type ToolResult } from "./host.ts";
import type { Words } from "./i18n.ts";
import { cellText } from "./table.ts";

type Run = ToolContentOf<"runs.get">;
type RunEvents = ToolContentOf<"runs.events">["items"];

const POLL_MS = 2000;
const FOLLOW_FOR_MS = 30 * 60 * 1000;
/** How many of the latest events the page lists. The journal in the web UI has the rest. */
const EVENTS_SHOWN = 8;

/** A tool's name for a procedure path, as the door names it (`toolName` in `mcpTools.ts`). */
const RUNS_GET = "runs_get";
const RUNS_EVENTS = "runs_events";

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

function drawRun(host: Host, run: Run, events: RunEvents | null, stopped: string | null): void {
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
  const latest = (events ?? []).slice(-EVENTS_SHOWN);
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
    ...(stopped === null ? [] : [element("p", "note", stopped)]),
  );
}

function drawProblem(host: Host, message: string): void {
  host.root.replaceChildren(element("p", "note note--error", message));
}

/**
 * A tool result's structured content, as the procedure `P` answers it.
 *
 * The door built it from that procedure's own typed output, as `gridOf` in `table.ts` explains;
 * this is the one place the run widget takes the door at its word.
 */
function contentOf<P extends "runs.get" | "runs.events" | "runs.trigger">(
  result: ToolResult,
): ToolContentOf<P> {
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: the door built this from the named procedure's typed output; see `table.ts`.
  return result.structuredContent as ToolContentOf<P>;
}

/** Follow one run: draw it, ask again every `POLL_MS`, stop at the first reason to. */
function follow(host: Host, tenantId: string, runId: string, first: Run | null): void {
  const started = Date.now();
  let events: RunEvents | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let paused = false;
  let last = first;

  async function ask(): Promise<void> {
    timer = null;
    if (document.hidden) {
      paused = true;
      if (last !== null) {
        drawRun(host, last, events, host.t()("runStoppedHidden"));
      }
      return;
    }
    paused = false;
    const args = { tenantId, runId };
    const [got, feed] = await Promise.all([
      host.app.callServerTool({ name: RUNS_GET, arguments: args }),
      host.app.callServerTool({ name: RUNS_EVENTS, arguments: args }),
    ]);
    if (got.isError === true) {
      drawProblem(host, host.t()("runUnreadable", { message: refusalMessage(got) }));
      return;
    }
    last = contentOf<"runs.get">(got);
    events = feed.isError === true ? events : contentOf<"runs.events">(feed).items;
    if (last.status !== "running") {
      drawRun(host, last, events, null);
      return;
    }
    if (Date.now() - started >= FOLLOW_FOR_MS) {
      drawRun(host, last, events, host.t()("runStoppedLong"));
      return;
    }
    drawRun(host, last, events, null);
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
    follow(host, call.tenantId, run.id, run);
    return;
  }
  if (call.path === "runs.trigger") {
    follow(host, call.tenantId, contentOf<"runs.trigger">(result).runId, null);
    return;
  }
  drawProblem(host, t("runUnknown"));
}

await mount("Undercroft run status", draw);
